// Native view, navigation and responder handling for the personal macOS browser.
#import <AppKit/AppKit.h>
#import <WebKit/WebKit.h>
#include <stdbool.h>

// The Rust callback returns bit 0 to consume the key, bit 1 to restore AppKit focus.
typedef unsigned char (*BrowserEvent)(const void *, unsigned char, const void *);
enum { BrowserKey, BrowserLeave };

static BOOL webURL(NSURL *url) {
    NSString *scheme = url.scheme.lowercaseString;
    return url.host.length && ([scheme isEqualToString:@"https"] || [scheme isEqualToString:@"http"]);
}

// Plain-data helpers in `web_panel/browser.rs`.
char *brudr_bookmarks_list(const char *path);
int brudr_bookmarks_toggle(const char *path, const char *url, const char *title);
bool brudr_bookmarks_ensure(const char *path);
void brudr_string_free(char *text);
size_t brudr_tab_after_close(size_t count, size_t current, size_t closed);
size_t brudr_tab_limit(void);

static void *const TabObservation = (void *)&TabObservation;

// Heights of the tab strip and the address bar; keep in step with HEADER in web_panel.rs.
static const CGFloat TabStripHeight = 26, ToolbarHeight = 32;

@interface BrudrWebPanel : NSView <WKNavigationDelegate>
@property (strong) WKWebsiteDataStore *store;
@property (copy) NSString *home;
@property (copy) NSString *bookmarksPath;
@property (strong) NSMutableArray<WKWebView *> *tabs;
@property NSUInteger current;
@property (strong) NSView *pages;
@property (strong) NSSegmentedControl *strip;
@property (strong) NSButton *addTab;
@property (strong) NSButton *closeTab;
@property (strong) NSTextField *address;
@property (strong) NSButton *back;
@property (strong) NSButton *forward;
@property (strong) NSButton *star;
-(instancetype)initWithStore:(WKWebsiteDataStore *)store URL:(NSString *)url bookmarks:(NSString *)bookmarks;
@end

static NSButton *barButton(NSString *title, NSString *tip, id target, SEL action) {
    NSButton *button = [NSButton buttonWithTitle:title target:target action:action];
    button.toolTip = tip;
    return button;
}

static NSVisualEffectView *barBackground(NSView *content) {
    NSVisualEffectView *bar = [NSVisualEffectView new];
    bar.material = NSVisualEffectMaterialWindowBackground;
    bar.blendingMode = NSVisualEffectBlendingModeWithinWindow;
    bar.translatesAutoresizingMaskIntoConstraints = NO;
    content.translatesAutoresizingMaskIntoConstraints = NO;
    [bar addSubview:content];
    [NSLayoutConstraint activateConstraints:@[
        [content.leadingAnchor constraintEqualToAnchor:bar.leadingAnchor constant:5],
        [content.trailingAnchor constraintEqualToAnchor:bar.trailingAnchor constant:-5],
        [content.centerYAnchor constraintEqualToAnchor:bar.centerYAnchor],
    ]];
    return bar;
}

@implementation BrudrWebPanel
-(instancetype)initWithStore:(WKWebsiteDataStore *)store URL:(NSString *)url bookmarks:(NSString *)bookmarks {
    if (!(self = [super initWithFrame:NSZeroRect])) return nil;
    self.store = store;
    self.home = url;
    self.bookmarksPath = bookmarks;
    self.tabs = [NSMutableArray array];

    // Tab strip: one segment per tab (titles cut to fit), then new and close-this-tab.
    self.strip = [NSSegmentedControl segmentedControlWithLabels:@[@""]
                                                   trackingMode:NSSegmentSwitchTrackingSelectOne
                                                         target:self action:@selector(pickTab:)];
    self.strip.segmentDistribution = NSSegmentDistributionFillEqually;
    self.strip.controlSize = NSControlSizeSmall;
    self.strip.font = [NSFont systemFontOfSize:NSFont.smallSystemFontSize];
    [self.strip setContentCompressionResistancePriority:NSLayoutPriorityDefaultLow
                                          forOrientation:NSLayoutConstraintOrientationHorizontal];
    self.addTab = barButton(@"+", @"New tab", self, @selector(newTab:));
    self.closeTab = barButton(@"×", @"Close this tab", self, @selector(closeCurrentTab:));
    for (NSButton *button in @[self.addTab, self.closeTab]) button.controlSize = NSControlSizeSmall;
    NSStackView *tabRow = [NSStackView stackViewWithViews:@[self.strip, self.addTab, self.closeTab]];
    tabRow.orientation = NSUserInterfaceLayoutOrientationHorizontal;
    tabRow.spacing = 3;
    tabRow.distribution = NSStackViewDistributionFill;
    [self.strip setContentHuggingPriority:1 forOrientation:NSLayoutConstraintOrientationHorizontal];
    NSVisualEffectView *tabBar = barBackground(tabRow);

    // Address bar: back, forward, reload, address, save and bookmarks menu.
    self.address = [NSTextField textFieldWithString:url];
    self.address.placeholderString = @"https://example.com";
    self.address.target = self;
    self.address.action = @selector(go:);
    [self.address setContentCompressionResistancePriority:NSLayoutPriorityDefaultLow
                                            forOrientation:NSLayoutConstraintOrientationHorizontal];
    self.back = barButton(@"←", @"Back", self, @selector(goBack:));
    self.back.enabled = NO;
    self.forward = barButton(@"→", @"Forward", self, @selector(goForward:));
    self.forward.enabled = NO;
    NSButton *reload = barButton(@"↻", @"Reload", self, @selector(reload:));
    self.star = barButton(@"☆", @"Bookmark this page", self, @selector(toggleBookmark:));
    NSButton *menu = barButton(@"▾", @"Bookmarks", self, @selector(showBookmarks:));
    NSStackView *bar = [NSStackView stackViewWithViews:@[self.back, self.forward, reload, self.address, self.star, menu]];
    bar.orientation = NSUserInterfaceLayoutOrientationHorizontal;
    bar.spacing = 3;
    NSVisualEffectView *toolbar = barBackground(bar);

    // Every tab's web view lives here; only the shown one is visible.
    self.pages = [NSView new];
    self.pages.translatesAutoresizingMaskIntoConstraints = NO;
    [self addSubview:self.pages];
    [self addSubview:tabBar];
    [self addSubview:toolbar];
    [NSLayoutConstraint activateConstraints:@[
        [tabBar.topAnchor constraintEqualToAnchor:self.topAnchor],
        [tabBar.leadingAnchor constraintEqualToAnchor:self.leadingAnchor],
        [tabBar.trailingAnchor constraintEqualToAnchor:self.trailingAnchor],
        [tabBar.heightAnchor constraintEqualToConstant:TabStripHeight],
        [toolbar.topAnchor constraintEqualToAnchor:tabBar.bottomAnchor],
        [toolbar.leadingAnchor constraintEqualToAnchor:self.leadingAnchor],
        [toolbar.trailingAnchor constraintEqualToAnchor:self.trailingAnchor],
        [toolbar.heightAnchor constraintEqualToConstant:ToolbarHeight],
        [self.pages.topAnchor constraintEqualToAnchor:toolbar.bottomAnchor],
        [self.pages.bottomAnchor constraintEqualToAnchor:self.bottomAnchor],
        [self.pages.leadingAnchor constraintEqualToAnchor:self.leadingAnchor],
        [self.pages.trailingAnchor constraintEqualToAnchor:self.trailingAnchor],
    ]];
    [self openTab:nil];
    return self;
}

-(void)dealloc {
    for (WKWebView *web in self.tabs) [self forget:web];
}

-(BOOL)wantsDefaultClipping { return YES; }

-(WKWebView *)web { return self.tabs[self.current]; }

#pragma mark Tabs

// Every tab shares the panel's data store, so one sign-in serves all of them.
-(WKWebView *)openTab:(NSURLRequest *)request {
    WKWebViewConfiguration *config = [WKWebViewConfiguration new];
    config.websiteDataStore = self.store;
    WKWebView *web = [[WKWebView alloc] initWithFrame:NSZeroRect configuration:config];
    web.navigationDelegate = self;
    web.translatesAutoresizingMaskIntoConstraints = NO;
    web.hidden = YES;
    [self.pages addSubview:web];
    [NSLayoutConstraint activateConstraints:@[
        [web.topAnchor constraintEqualToAnchor:self.pages.topAnchor],
        [web.bottomAnchor constraintEqualToAnchor:self.pages.bottomAnchor],
        [web.leadingAnchor constraintEqualToAnchor:self.pages.leadingAnchor],
        [web.trailingAnchor constraintEqualToAnchor:self.pages.trailingAnchor],
    ]];
    for (NSString *key in @[@"title", @"URL"]) {
        [web addObserver:self forKeyPath:key options:0 context:TabObservation];
    }
    [self.tabs addObject:web];
    [self showTab:self.tabs.count - 1];
    if (request) {
        [web loadRequest:request];
    } else {
        self.address.stringValue = self.home;
        [self go:nil];
    }
    return web;
}

-(void)forget:(WKWebView *)web {
    for (NSString *key in @[@"title", @"URL"]) [web removeObserver:self forKeyPath:key context:TabObservation];
    web.navigationDelegate = nil;
}

-(BOOL)hasFocus:(NSView *)view {
    NSResponder *responder = self.window.firstResponder;
    return [responder isKindOfClass:NSView.class] && [(NSView *)responder isDescendantOf:view];
}

// A hidden tab keeps its page but gets no clicks or keys; keyboard focus moves along.
-(void)showTab:(NSUInteger)index {
    WKWebView *old = self.current < self.tabs.count ? self.tabs[self.current] : nil;
    WKWebView *web = self.tabs[index];
    BOOL focused = old && old != web && [self hasFocus:old];
    self.current = index;
    for (WKWebView *tab in self.tabs) tab.hidden = tab != web;
    if (focused) [self.window makeFirstResponder:web];
    [self updateLocation:web];
    [self updateTabs];
}

-(void)newTab:(id)sender {
    if (self.tabs.count >= brudr_tab_limit()) {
        NSBeep();
        return;
    }
    [self openTab:nil];
    [self.window makeFirstResponder:self.address];
}

-(void)pickTab:(NSSegmentedControl *)sender {
    if (sender.selectedSegment >= 0 && (NSUInteger)sender.selectedSegment < self.tabs.count) {
        [self showTab:sender.selectedSegment];
    }
}

-(void)closeCurrentTab:(id)sender {
    NSUInteger count = self.tabs.count, closed = self.current;
    if (count < 2) return;
    WKWebView *web = self.tabs[closed];
    BOOL focused = [self hasFocus:web];
    [self forget:web];
    [web stopLoading];
    [web removeFromSuperview];
    [self.tabs removeObjectAtIndex:closed];
    self.current = brudr_tab_after_close(count, closed, closed);
    [self showTab:self.current];
    if (focused) [self.window makeFirstResponder:self.web];
}

-(NSString *)labelFor:(WKWebView *)web {
    if (web.title.length) return web.title;
    return web.URL.host.length ? web.URL.host : @"New tab";
}

-(void)updateTabs {
    NSSegmentedControl *strip = self.strip;
    strip.segmentCount = self.tabs.count;
    for (NSUInteger i = 0; i < self.tabs.count; i++) {
        [strip setLabel:[self labelFor:self.tabs[i]] forSegment:i];
        [strip setToolTip:self.tabs[i].URL.absoluteString forSegment:i];
    }
    strip.selectedSegment = self.current;
    self.closeTab.enabled = self.tabs.count > 1;
    self.addTab.enabled = self.tabs.count < brudr_tab_limit();
}

-(void)observeValueForKeyPath:(NSString *)key ofObject:(id)object change:(NSDictionary *)change context:(void *)context {
    if (context != TabObservation) {
        [super observeValueForKeyPath:key ofObject:object change:change context:context];
        return;
    }
    if ([key isEqualToString:@"URL"] && object == self.web) [self updateLocation:object];
    [self updateTabs];
}

#pragma mark Navigation

-(void)go:(id)sender {
    NSString *text = [self.address.stringValue stringByTrimmingCharactersInSet:
                      NSCharacterSet.whitespaceAndNewlineCharacterSet];
    if (text.length && ![text containsString:@"://"]) text = [@"https://" stringByAppendingString:text];
    NSURL *url = [NSURL URLWithString:text];
    if (webURL(url)) {
        self.address.toolTip = nil;
        self.address.stringValue = url.absoluteString;
        [self.web loadRequest:[NSURLRequest requestWithURL:url]];
        if (sender) [self.window makeFirstResponder:self.web];
    } else {
        self.address.toolTip = @"Enter an HTTP or HTTPS address.";
        if (sender) NSBeep();
    }
}

-(void)goBack:(id)sender { [self.web goBack]; }
-(void)goForward:(id)sender { [self.web goForward]; }
-(void)reload:(id)sender {
    if (self.web.URL) [self.web reload];
    else [self go:sender];
}

-(void)webView:(WKWebView *)view decidePolicyForNavigationAction:(WKNavigationAction *)action
  decisionHandler:(void (^)(WKNavigationActionPolicy))decide {
    if (!action.targetFrame) { // A link for a new window opens a tab here; never another app.
        decide(WKNavigationActionPolicyCancel);
        if (action.navigationType == WKNavigationTypeLinkActivated && webURL(action.request.URL)) {
            if (self.tabs.count < brudr_tab_limit()) [self openTab:action.request];
            else [view loadRequest:action.request];
        }
    } else {
        NSString *scheme = action.request.URL.scheme.lowercaseString;
        BOOL subframe = !action.targetFrame.mainFrame && [@[@"about", @"blob", @"data"] containsObject:scheme ?: @""];
        BOOL allowed = subframe || webURL(action.request.URL);
        decide(allowed ? WKNavigationActionPolicyAllow : WKNavigationActionPolicyCancel);
    }
}

// The bars follow the shown tab only.
-(void)updateLocation:(WKWebView *)view {
    if (view != self.web) return;
    if (view.URL && !self.address.currentEditor) {
        self.address.stringValue = view.URL.absoluteString;
    }
    self.back.enabled = view.canGoBack;
    self.forward.enabled = view.canGoForward;
    [self updateStar];
}

-(void)webView:(WKWebView *)view didCommitNavigation:(WKNavigation *)nav { [self updateLocation:view]; }
-(void)webView:(WKWebView *)view didFinishNavigation:(WKNavigation *)nav { [self updateLocation:view]; }
-(void)webView:(WKWebView *)view didFailNavigation:(WKNavigation *)nav withError:(NSError *)error {
    if (view == self.web && error.code != NSURLErrorCancelled) self.address.toolTip = error.localizedDescription;
    [self updateLocation:view];
}
-(void)webView:(WKWebView *)view didFailProvisionalNavigation:(WKNavigation *)nav withError:(NSError *)error {
    [self webView:view didFailNavigation:nav withError:error];
}

#pragma mark Bookmarks

// Read the file on every use, so a hand edit shows at the next menu or page.
-(NSArray<NSArray<NSString *> *> *)bookmarks {
    char *raw = brudr_bookmarks_list(self.bookmarksPath.fileSystemRepresentation);
    if (!raw) return @[];
    NSString *text = @(raw);
    brudr_string_free(raw);
    NSMutableArray *list = [NSMutableArray array];
    for (NSString *line in [text componentsSeparatedByString:@"\n"]) {
        NSRange tab = [line rangeOfString:@"\t"];
        if (tab.location == NSNotFound) continue;
        [list addObject:@[[line substringToIndex:tab.location], [line substringFromIndex:NSMaxRange(tab)]]];
    }
    return list;
}

-(void)updateStar {
    NSString *url = self.web.URL.absoluteString;
    BOOL saved = NO;
    if (url) for (NSArray *item in self.bookmarks) saved |= [item[0] isEqualToString:url];
    self.star.title = saved ? @"★" : @"☆";
    self.star.toolTip = saved ? @"Remove this bookmark" : @"Bookmark this page";
}

-(void)toggleBookmark:(id)sender {
    NSURL *url = self.web.URL;
    if (!webURL(url) || brudr_bookmarks_toggle(self.bookmarksPath.fileSystemRepresentation,
                                               url.absoluteString.UTF8String,
                                               (self.web.title ?: @"").UTF8String) < 0) {
        NSBeep();
    }
    [self updateStar];
}

-(void)showBookmarks:(NSButton *)sender {
    NSMenu *menu = [NSMenu new];
    menu.autoenablesItems = NO;
    for (NSArray<NSString *> *item in self.bookmarks) {
        NSMenuItem *entry = [menu addItemWithTitle:item[1] action:@selector(openBookmark:) keyEquivalent:@""];
        entry.target = self;
        entry.toolTip = item[0];
        entry.representedObject = item[0];
    }
    if (!menu.numberOfItems) [menu addItemWithTitle:@"No bookmarks yet" action:nil keyEquivalent:@""].enabled = NO;
    [menu addItem:NSMenuItem.separatorItem];
    NSMenuItem *edit = [menu addItemWithTitle:@"Edit bookmarks file…" action:@selector(editBookmarks:) keyEquivalent:@""];
    edit.target = self;
    edit.toolTip = self.bookmarksPath;
    NSPoint below = NSMakePoint(0, sender.isFlipped ? NSMaxY(sender.bounds) + 2 : -2);
    [menu popUpMenuPositioningItem:nil atLocation:below inView:sender];
}

-(void)openBookmark:(NSMenuItem *)item {
    self.address.stringValue = item.representedObject;
    [self go:item];
}

-(void)editBookmarks:(id)sender {
    if (!brudr_bookmarks_ensure(self.bookmarksPath.fileSystemRepresentation)) {
        NSBeep();
        return;
    }
    [NSWorkspace.sharedWorkspace openURL:[NSURL fileURLWithPath:self.bookmarksPath]];
}
@end

@interface BrudrWebHost : NSObject
@property (weak) NSView *parent;
@property (strong) WKWebsiteDataStore *store;
@property (copy) NSString *bookmarks;
@property (strong) NSMutableDictionary<NSString *, BrudrWebPanel *> *panels;
@property (strong) id monitor;
@property const void *context;
@property BrowserEvent callback;
@property BOOL routing;
@end

@implementation BrudrWebHost
-(BrudrWebPanel *)panelContaining:(NSResponder *)responder {
    // The address field shares the window's field editor instead of owning it.
    if ([responder isKindOfClass:NSTextView.class] && [(NSTextView *)responder isFieldEditor]) {
        responder = (NSResponder *)[(NSTextView *)responder delegate];
    }
    if (![responder isKindOfClass:NSView.class]) return nil;
    for (BrudrWebPanel *panel in self.panels.objectEnumerator) {
        if (!panel.hidden && [(NSView *)responder isDescendantOf:panel]) return panel;
    }
    return nil;
}

-(NSEvent *)route:(NSEvent *)event {
    NSWindow *window = self.parent.window;
    if (!window || event.window != window) return event;
    BrudrWebPanel *focused = [self panelContaining:window.firstResponder];
    if (event.type == NSEventTypeKeyDown) {
        if (!focused) return event;
        unsigned char result = self.callback(self.context, BrowserKey, (__bridge const void *)event);
        self.routing = !(result & 2);
        if (!self.routing) [window makeFirstResponder:self.parent];
        return result & 1 ? nil : event;
    }
    if (!focused && !self.routing) return event;
    for (BrudrWebPanel *panel in self.panels.objectEnumerator) {
        if (!panel.hidden && [panel mouse:[panel convertPoint:event.locationInWindow fromView:nil]
                                   inRect:panel.bounds]) return event;
    }
    if (focused) [window makeFirstResponder:self.parent];
    if (self.routing) {
        self.routing = NO;
        self.callback(self.context, BrowserLeave, NULL);
    }
    return event;
}
@end

void *brudr_web_create(void *parent, const char *profile, const char *bookmarks, BrowserEvent callback,
                       const void *context) {
    if (@available(macOS 14.0, *)) {
        NSUUID *uuid = [[NSUUID alloc] initWithUUIDString:@(profile)];
        if (!uuid) return NULL;
        BrudrWebHost *host = [BrudrWebHost new];
        host.parent = (__bridge NSView *)parent;
        host.store = [WKWebsiteDataStore dataStoreForIdentifier:uuid];
        host.bookmarks = [NSFileManager.defaultManager stringWithFileSystemRepresentation:bookmarks
                                                                                  length:strlen(bookmarks)];
        host.panels = [NSMutableDictionary dictionary];
        host.callback = callback;
        host.context = context;
        __weak BrudrWebHost *weak = host;
        host.monitor = [NSEvent addLocalMonitorForEventsMatchingMask:
                        NSEventMaskKeyDown | NSEventMaskLeftMouseDown | NSEventMaskRightMouseDown
                        handler:^NSEvent *(NSEvent *event) {
            BrudrWebHost *strong = weak;
            return strong ? [strong route:event] : event;
        }];
        return (__bridge_retained void *)host;
    }
    return NULL;
}

void brudr_web_destroy(void *ptr) {
    BrudrWebHost *host = (__bridge_transfer BrudrWebHost *)ptr;
    if (host.monitor) [NSEvent removeMonitor:host.monitor];
    for (BrudrWebPanel *panel in host.panels.objectEnumerator) [panel removeFromSuperview];
}

// Return true if hiding/removing a panel ended its native keyboard focus.
bool brudr_web_hide(void *ptr, const char *id, bool destroy) {
    BrudrWebHost *host = (__bridge BrudrWebHost *)ptr;
    NSString *key = @(id);
    BrudrWebPanel *panel = host.panels[key];
    if (!panel) return false;
    NSWindow *window = host.parent.window;
    bool hadFocus = [host panelContaining:window.firstResponder] == panel;
    if (hadFocus) {
        host.routing = NO;
        [window makeFirstResponder:host.parent];
    }
    panel.hidden = YES;
    if (destroy) {
        [panel removeFromSuperview];
        [host.panels removeObjectForKey:key];
    }
    return hadFocus;
}

void brudr_web_release_focus(void *ptr) {
    BrudrWebHost *host = (__bridge BrudrWebHost *)ptr;
    if (!host.routing) return;
    host.routing = NO;
    NSWindow *window = host.parent.window;
    if ([host panelContaining:window.firstResponder]) [window makeFirstResponder:host.parent];
}

void brudr_web_show(void *ptr, const char *id, const char *url, double x, double y, double w, double h) {
    BrudrWebHost *host = (__bridge BrudrWebHost *)ptr;
    NSView *parent = host.parent;
    if (!parent) return;
    NSString *key = @(id);
    BrudrWebPanel *panel = host.panels[key];
    if (!panel) {
        panel = [[BrudrWebPanel alloc] initWithStore:host.store URL:@(url) bookmarks:host.bookmarks];
        panel.hidden = YES;
        host.panels[key] = panel;
        [parent addSubview:panel];
    }
    // GPUI uses top-left, AppKit uses its parent view's orientation. Both use logical points.
    NSRect bounds = parent.bounds;
    NSRect rect = NSMakeRect(NSMinX(bounds) + x, parent.isFlipped ? NSMinY(bounds) + y : NSMaxY(bounds) - y - h, w, h);
    if (!NSEqualRects(panel.frame, rect)) panel.frame = rect;
    panel.hidden = NO;
}
