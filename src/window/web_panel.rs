//! Render slots for the personal browser. All AppKit state stays on macOS.
use super::AppWindow;
use crate::layout::Node;
use gpui::{AnyElement, Context, IntoElement, ParentElement, Styled, div};

mod browser;

#[derive(Default)]
pub(super) struct Panels {
    #[cfg(target_os = "macos")]
    state: mac::Panels,
}

pub(super) struct Frame {
    #[cfg(target_os = "macos")]
    state: mac::Frame,
}

impl Panels {
    pub(super) fn frame(&self, layout: &str, tree: &Node) -> Frame {
        #[cfg(not(target_os = "macos"))]
        let _ = (layout, tree);
        Frame {
            #[cfg(target_os = "macos")]
            state: self.state.frame(layout, tree),
        }
    }
}

impl Frame {
    pub(super) fn element(frame: Option<&Self>, id: &str, url: &str) -> AnyElement {
        let message = if frame.is_none() {
            "Web panels must be regular blocks in the window layout."
        } else if cfg!(target_os = "macos") {
            "The web panel needs macOS 14 or later and a native window."
        } else {
            "The web panel is only available on macOS."
        };
        let el = div()
            .size_full()
            .relative()
            .flex()
            .items_center()
            .justify_center()
            .child(message);
        #[cfg(not(target_os = "macos"))]
        let _ = (id, url);
        #[cfg(target_os = "macos")]
        let el = if let Some(frame) = frame {
            el.child(frame.state.slot(id, url))
        } else {
            el
        };
        el.into_any_element()
    }

    pub(super) fn finish(self, cx: &mut Context<AppWindow>) -> Option<AnyElement> {
        #[cfg(not(target_os = "macos"))]
        {
            let _ = cx;
            None
        }
        #[cfg(target_os = "macos")]
        self.state.finish(cx)
    }
}

#[cfg(target_os = "macos")]
mod mac {
    use super::*;
    use crate::layout::Content;
    use gpui::{
        App, AsyncWindowContext, Bounds, FocusHandle, InteractiveElement, Pixels, WeakEntity,
        Window, canvas, px,
    };
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};
    use sha2::{Digest, Sha256};
    use std::cell::RefCell;
    use std::collections::HashMap;
    use std::ffi::{CString, c_char, c_void};
    use std::path::Path;
    use std::ptr::NonNull;
    use std::rc::Rc;

    type Callback = extern "C" fn(*const c_void, u8, *const c_void) -> u8;
    unsafe extern "C" {
        fn brudr_web_create(
            parent: *mut c_void,
            profile: *const c_char,
            bookmarks: *const c_char,
            callback: Callback,
            context: *const c_void,
        ) -> *mut c_void;
        fn brudr_web_destroy(host: *mut c_void);
        fn brudr_web_show(
            host: *mut c_void,
            id: *const c_char,
            url: *const c_char,
            x: f64,
            y: f64,
            w: f64,
            h: f64,
        );
        fn brudr_web_hide(host: *mut c_void, id: *const c_char, destroy: bool) -> bool;
        fn brudr_web_release_focus(host: *mut c_void);
    }

    // A deterministic UUID for this app home. Distinct homes (including demos) never
    // use the daily profile. The UUID namespace is private to brudr, not Safari.
    fn profile_id(home: &Path) -> String {
        let mut hash = Sha256::new();
        hash.update(b"brudr/wk-profile/v1\0");
        hash.update(home.as_os_str().as_encoded_bytes());
        let hash = hash.finalize();
        let mut uuid = [0; 16];
        uuid.copy_from_slice(&hash[..16]);
        uuid[6] = (uuid[6] & 15) | 0x80;
        uuid[8] = (uuid[8] & 63) | 0x80;
        let hex = uuid.map(|n| format!("{n:02x}")).concat();
        format!(
            "{}-{}-{}-{}-{}",
            &hex[..8],
            &hex[8..12],
            &hex[12..16],
            &hex[16..20],
            &hex[20..]
        )
    }

    struct Router {
        window: AsyncWindowContext,
        app: WeakEntity<AppWindow>,
        focus: FocusHandle,
    }

    impl Router {
        fn restore(&self, window: &mut Window, cx: &mut App) {
            if self.focus.is_focused(window) {
                let _ = self.app.update(cx, |app, cx| app.restore_focus(window, cx));
            }
        }
    }

    extern "C" fn event(context: *const c_void, kind: u8, native_event: *const c_void) -> u8 {
        // The bridge holds only a borrowed pointer. Dispatch can close the window,
        // so keep the router alive independently for the duration of the callback.
        let router = unsafe {
            let raw = context.cast::<Router>();
            Rc::increment_strong_count(raw);
            Rc::from_raw(raw)
        };
        router
            .window
            .clone()
            .update(|window, cx| match kind {
                0 => {
                    router.focus.focus(window, cx);
                    let Some(input) = (unsafe { gpui_macos::embedded_key_down(native_event) })
                    else {
                        return 0;
                    };
                    let handled = !window.dispatch_event(input, cx).propagate;
                    u8::from(handled)
                        | if router.focus.is_focused(window) {
                            0
                        } else {
                            2
                        }
                }
                1 => {
                    router.restore(window, cx);
                    0
                }
                _ => 0,
            })
            .unwrap_or(0)
    }

    struct Host {
        native: NonNull<c_void>,
        router: Rc<Router>,
        loaded: HashMap<String, Loaded>,
    }

    struct Loaded {
        url: String,
        rect: Option<[f64; 4]>,
    }

    impl Host {
        fn new(
            window: &Window,
            focus: FocusHandle,
            app: WeakEntity<AppWindow>,
            cx: &App,
        ) -> Option<Self> {
            let handle = HasWindowHandle::window_handle(window).ok()?;
            let RawWindowHandle::AppKit(handle) = handle.as_raw() else {
                return None;
            };
            let home = crate::mods::app_dir();
            let home = home.canonicalize().unwrap_or(home);
            let profile = CString::new(profile_id(&home)).ok()?;
            let bookmarks = super::browser::bookmarks_path(&home);
            let bookmarks = CString::new(bookmarks.as_os_str().as_encoded_bytes()).ok()?;
            let router = Rc::new(Router {
                window: window.to_async(cx),
                app,
                focus,
            });
            let native = unsafe {
                brudr_web_create(
                    handle.ns_view.as_ptr(),
                    profile.as_ptr(),
                    bookmarks.as_ptr(),
                    event,
                    Rc::as_ptr(&router).cast(),
                )
            };
            Some(Self {
                native: NonNull::new(native)?,
                router,
                loaded: HashMap::new(),
            })
        }

        fn sync(
            &mut self,
            declared: &HashMap<String, String>,
            visible: HashMap<String, Placement>,
            window: &mut Window,
            cx: &mut App,
        ) {
            let native = self.native.as_ptr();
            let mut lost_focus = false;
            self.loaded.retain(|id, panel| {
                let availability = availability(declared, &visible, id, &panel.url);
                if availability != Availability::Visible
                    && (panel.rect.is_some() || availability == Availability::Removed)
                {
                    // Only IDs successfully passed to native creation enter this map.
                    let id = CString::new(id.as_str()).expect("previously validated panel id");
                    lost_focus |= unsafe {
                        brudr_web_hide(native, id.as_ptr(), availability == Availability::Removed)
                    };
                    panel.rect = None;
                }
                availability != Availability::Removed
            });
            for (id, placement) in visible {
                if self
                    .loaded
                    .get(&id)
                    .is_some_and(|p| p.rect == Some(placement.rect))
                {
                    continue;
                }
                let (Ok(key), Ok(url)) = (
                    CString::new(id.as_str()),
                    CString::new(placement.url.as_str()),
                ) else {
                    continue;
                };
                let [x, y, w, h] = placement.rect;
                unsafe { brudr_web_show(native, key.as_ptr(), url.as_ptr(), x, y, w, h) };
                self.loaded.insert(
                    id,
                    Loaded {
                        url: placement.url,
                        rect: Some(placement.rect),
                    },
                );
            }
            if lost_focus {
                self.router.restore(window, cx);
            } else if !self.router.focus.is_focused(window) {
                unsafe { brudr_web_release_focus(native) };
            }
        }
    }

    impl Drop for Host {
        fn drop(&mut self) {
            // Unregister the local monitor before releasing the Rust callback context.
            unsafe { brudr_web_destroy(self.native.as_ptr()) };
        }
    }

    #[derive(Default)]
    pub(super) struct Panels(Rc<RefCell<State>>);

    #[derive(Default)]
    struct State {
        host: Option<Host>,
        layout: String,
        focus: Option<FocusHandle>,
    }

    struct Placement {
        url: String,
        rect: [f64; 4],
    }

    pub(super) struct Frame {
        state: Rc<RefCell<State>>,
        visible: Rc<RefCell<HashMap<String, Placement>>>,
        declared: HashMap<String, String>,
        layout: String,
    }

    fn declared(tree: &Node) -> HashMap<String, String> {
        tree.walk()
            .into_iter()
            .filter_map(|n| match n.content() {
                Some(Content::Web { web }) => Some((n.id.clone(), web.url.clone())),
                _ => None,
            })
            .collect()
    }

    #[derive(Debug, Eq, PartialEq)]
    enum Availability {
        Visible,
        Hidden,
        Removed,
    }

    fn availability<T>(
        declared: &HashMap<String, String>,
        visible: &HashMap<String, T>,
        id: &str,
        previous_url: &str,
    ) -> Availability {
        if declared.get(id).is_none_or(|url| url != previous_url) {
            Availability::Removed
        } else if visible.contains_key(id) {
            Availability::Visible
        } else {
            Availability::Hidden
        }
    }

    /// The tab strip (26 points) and the address bar (32) above the page; keep in
    /// step with `web_panel.m`.
    const HEADER: f64 = 58.0;

    fn placed_rect(bounds: Bounds<Pixels>, clip: Bounds<Pixels>) -> Option<[f64; 4]> {
        let clipped = bounds.intersect(&clip);
        let p = |v: Pixels| f64::from(f32::from(v));
        let result = [
            p(clipped.origin.x),
            p(clipped.origin.y),
            p(clipped.size.width),
            p(clipped.size.height),
        ];
        // A tiny/fully clipped slot cannot contain the browser's bars.
        (result.iter().all(|n| n.is_finite()) && result[2] >= 1.0 && result[3] > HEADER)
            .then_some(result)
    }

    impl Panels {
        pub(super) fn frame(&self, layout: &str, tree: &Node) -> Frame {
            Frame {
                state: self.0.clone(),
                visible: Default::default(),
                declared: declared(tree),
                layout: layout.to_owned(),
            }
        }
    }

    impl Frame {
        pub(super) fn slot(&self, id: &str, url: &str) -> impl IntoElement + use<> {
            let (id, url, visible) = (id.to_owned(), url.to_owned(), self.visible.clone());
            canvas(
                move |bounds, window, _| {
                    if let Some(rect) = placed_rect(bounds, window.content_mask().bounds) {
                        visible.borrow_mut().insert(id, Placement { url, rect });
                    }
                },
                |_, _, _, _| {},
            )
            .absolute()
            .size_full()
        }

        pub(super) fn finish(self, cx: &mut Context<AppWindow>) -> Option<AnyElement> {
            if self.declared.is_empty() && self.state.borrow().host.is_none() {
                return None;
            }
            let focus = self
                .state
                .borrow_mut()
                .focus
                .get_or_insert_with(|| cx.focus_handle())
                .clone();
            let tracked_focus = focus.clone();
            let app = cx.weak_entity();
            // This last canvas paints after the normal layout. Apply native changes
            // once outside GPUI's paint phase, including a frame with no visible slots.
            let end = canvas(
                |_, _, _| {},
                move |_, _, window, cx| {
                    window.defer(cx, move |window, cx| {
                        let visible = self.visible.take();
                        let mut state = self.state.borrow_mut();
                        if state.layout != self.layout || self.declared.is_empty() {
                            if let Some(host) = state.host.take() {
                                host.sync_empty(window, cx);
                            }
                            state.layout = self.layout;
                        }
                        if !visible.is_empty() && state.host.is_none() {
                            state.host = Host::new(window, focus, app, cx);
                        }
                        if let Some(host) = state.host.as_mut() {
                            host.sync(&self.declared, visible, window, cx);
                        }
                    });
                },
            );
            Some(
                div()
                    .absolute()
                    .size(px(0.0))
                    .track_focus(&tracked_focus)
                    .child(end)
                    .into_any_element(),
            )
        }
    }

    impl Host {
        fn sync_empty(mut self, window: &mut Window, cx: &mut App) {
            self.sync(&HashMap::new(), HashMap::new(), window, cx);
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use gpui::{point, size};

        #[test]
        fn places_in_points_clips_to_the_visible_body_and_skips_tiny_slots() {
            let rect = |x, y, w, h| Bounds::new(point(px(x), px(y)), size(px(w), px(h)));
            let slot = rect(10.5, 20.0, 300.0, 180.0);
            assert_eq!(
                placed_rect(slot, rect(0.0, 30.0, 200.0, 140.0)),
                Some([10.5, 30.0, 189.5, 140.0])
            );
            assert_eq!(placed_rect(slot, rect(320.0, 30.0, 100.0, 150.0)), None);
            assert_eq!(placed_rect(slot, rect(0.0, 0.0, 100.0, 45.0)), None);
            assert_eq!(placed_rect(slot, rect(0.0, 0.0, 100.0, 78.0)), None);
            assert_eq!(
                placed_rect(slot, rect(0.0, 0.0, 100.0, 79.0)),
                Some([10.5, 20.0, 89.5, 59.0])
            );
        }

        #[test]
        fn stack_switch_hides_the_old_web_view_and_reuses_it_when_shown_again() {
            let mut tree: Node = serde_json::from_str(
                r#"{
              "id":"stack", "type":"stack", "children":[
                {"id":"web", "type":"block", "content":{"web":{"url":"https://example.com"}}},
                {"id":"other", "type":"block", "content":{"mod":"blank"}}
              ], "active":"web"
            }"#,
            )
            .unwrap();
            let former = "https://example.com";
            let visible = |tree: &Node| {
                tree.visible_blocks()
                    .into_iter()
                    .filter_map(|n| {
                        matches!(n.content(), Some(Content::Web { .. })).then(|| (n.id.clone(), ()))
                    })
                    .collect::<HashMap<_, _>>()
            };
            assert_eq!(
                availability(&declared(&tree), &visible(&tree), "web", former),
                Availability::Visible
            );
            assert!(tree.select("stack", "other"));
            assert_eq!(
                availability(&declared(&tree), &visible(&tree), "web", former),
                Availability::Hidden
            );
            assert!(tree.select("stack", "web"));
            assert_eq!(
                availability(&declared(&tree), &visible(&tree), "web", former),
                Availability::Visible
            );
            assert_eq!(
                availability(
                    &declared(&tree),
                    &visible(&tree),
                    "web",
                    "https://obsolete.example"
                ),
                Availability::Removed
            );
            tree.find_mut("web").unwrap().hidden = true;
            assert_eq!(
                availability(&declared(&tree), &visible(&tree), "web", former),
                Availability::Hidden
            );
        }

        #[test]
        fn profile_is_stable_for_one_home_but_distinct_across_homes() {
            let id = profile_id(Path::new("/tmp/brudr-first"));
            assert_eq!(id, profile_id(Path::new("/tmp/brudr-first")));
            assert_ne!(id, profile_id(Path::new("/tmp/brudr-second")));
            assert_eq!(id.len(), 36);
            assert_eq!(id.as_bytes()[14], b'8');
        }
    }
}
