//! The plain-data parts of the personal browser: the bookmarks file and tab
//! bookkeeping. The native panel (`web_panel.m`) calls these through the C
//! functions at the end; everything else here is ordinary, testable Rust.
//!
//! The bookmarks file is meant to be edited by hand too. One bookmark per
//! line: the address, whitespace, then the title. Blank lines, lines starting
//! with `#` and lines whose first word is not an http(s) address are ignored.
//! Saving appends one line; removing drops only the lines with that address,
//! so comments and the order of the other lines stay as written.
#![cfg_attr(not(target_os = "macos"), allow(dead_code))]

use std::io::{self, Read};
use std::path::{Path, PathBuf};

/// Larger files are read only up to here and never rewritten.
pub const FILE_LIMIT: u64 = 1 << 20;
/// Titles are cut to this many characters when saved or read.
pub const TITLE_LIMIT: usize = 200;
/// A panel holds at most this many tabs.
pub const TAB_LIMIT: usize = 12;

const HEADER: &str = "\
# brudr: preferiti del pannello Browser.
# Una riga per preferito: l'indirizzo, uno spazio, poi il titolo. Esempio:
# https://www.google.com/ Google
# Le righe vuote e quelle che iniziano con # non contano.
";

/// The bookmarks file of an app home: outside WebKit's data, beside the mods' data.
pub fn bookmarks_path(home: &Path) -> PathBuf {
    home.join("data")
        .join("brudr-browser")
        .join("preferiti.txt")
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Bookmark {
    pub url: String,
    pub title: String,
}

/// An http(s) address with a host and no whitespace or control characters.
pub fn is_web_url(text: &str) -> bool {
    let Some((scheme, rest)) = text.split_once("://") else {
        return false;
    };
    let host = rest.split(['/', '?', '#']).next().unwrap_or_default();
    (scheme.eq_ignore_ascii_case("https") || scheme.eq_ignore_ascii_case("http"))
        && !host.is_empty()
        && !text.chars().any(|c| c.is_whitespace() || c.is_control())
}

fn host(url: &str) -> &str {
    let rest = url.split_once("://").map_or(url, |(_, rest)| rest);
    rest.split(['/', '?', '#']).next().unwrap_or(rest)
}

/// One line of words: whitespace and control characters become single spaces.
fn clean_title(title: &str) -> String {
    let words = title.split(|c: char| c.is_whitespace() || c.is_control());
    let line = words
        .filter(|w| !w.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    line.chars().take(TITLE_LIMIT).collect()
}

fn line_url(line: &str) -> Option<&str> {
    let line = line.trim();
    if line.starts_with('#') {
        return None;
    }
    let url = line.split_whitespace().next()?;
    is_web_url(url).then_some(url)
}

/// The bookmarks in file order, the first line winning for a repeated address.
pub fn parse(text: &str) -> Vec<Bookmark> {
    let mut out: Vec<Bookmark> = Vec::new();
    for line in text.lines() {
        let Some(url) = line_url(line) else { continue };
        if out.iter().any(|b| b.url == url) {
            continue;
        }
        let title = clean_title(line.trim()[url.len()..].trim());
        let title = if title.is_empty() {
            host(url).to_owned()
        } else {
            title
        };
        out.push(Bookmark {
            url: url.to_owned(),
            title,
        });
    }
    out
}

/// The file text after saving `url` (true) or, when it is already saved,
/// removing it (false). None for an address the panel cannot open.
pub fn toggled(text: &str, url: &str, title: &str) -> Option<(String, bool)> {
    if !is_web_url(url) {
        return None;
    }
    if parse(text).iter().any(|b| b.url == url) {
        let kept: String = text
            .split_inclusive('\n')
            .filter(|line| line_url(line) != Some(url))
            .collect();
        return Some((kept, false));
    }
    let mut out = if text.trim().is_empty() {
        HEADER.to_owned()
    } else {
        text.to_owned()
    };
    if !out.ends_with('\n') {
        out.push('\n');
    }
    let title = clean_title(title);
    let title = if title.is_empty() {
        host(url).to_owned()
    } else {
        title
    };
    out.push_str(&format!("{url} {title}\n"));
    Some((out, true))
}

/// The file's text up to FILE_LIMIT; a missing file is empty.
pub fn read(path: &Path) -> String {
    let mut bytes = Vec::new();
    match std::fs::File::open(path) {
        Ok(file) => {
            let _ = file.take(FILE_LIMIT).read_to_end(&mut bytes);
        }
        Err(_) => return String::new(),
    }
    String::from_utf8_lossy(&bytes).into_owned()
}

/// Write the whole file at once, through a link if the file is one.
fn write(path: &Path, text: &str) -> io::Result<()> {
    let target = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_owned());
    let dir = target
        .parent()
        .ok_or_else(|| io::Error::other("no folder"))?;
    std::fs::create_dir_all(dir)?;
    let name = target
        .file_name()
        .ok_or_else(|| io::Error::other("no file name"))?;
    let tmp = dir.join(format!(
        ".{}.{}.tmp",
        name.to_string_lossy(),
        std::process::id()
    ));
    std::fs::write(&tmp, text)?;
    std::fs::rename(&tmp, &target).inspect_err(|_| {
        let _ = std::fs::remove_file(&tmp);
    })
}

/// Save or remove `url`; returns whether it is saved now.
pub fn toggle(path: &Path, url: &str, title: &str) -> io::Result<bool> {
    if std::fs::metadata(path).is_ok_and(|m| m.len() > FILE_LIMIT) {
        return Err(io::Error::other("bookmarks file too large to rewrite"));
    }
    let text = match std::fs::read_to_string(path) {
        Ok(text) => text,
        Err(err) if err.kind() == io::ErrorKind::NotFound => String::new(),
        Err(err) => return Err(err),
    };
    let (text, saved) =
        toggled(&text, url, title).ok_or_else(|| io::Error::other("not a web address"))?;
    write(path, &text)?;
    Ok(saved)
}

/// Create the file with its explanation, for editing by hand. An existing file stays.
pub fn ensure(path: &Path) -> io::Result<()> {
    if std::fs::symlink_metadata(path).is_ok() {
        return Ok(());
    }
    write(path, HEADER)
}

/// The tab to show after closing tab `closed` of `count` while `current` was shown:
/// the one to its right takes a closed current tab's place, the last one at the end.
pub fn after_close(count: usize, current: usize, closed: usize) -> usize {
    let left = count.saturating_sub(1);
    let next = match current.cmp(&closed) {
        std::cmp::Ordering::Greater => current - 1,
        std::cmp::Ordering::Equal => closed,
        std::cmp::Ordering::Less => current,
    };
    next.min(left.saturating_sub(1))
}

#[cfg(target_os = "macos")]
mod ffi {
    //! For `web_panel.m`. Strings in are UTF-8 C strings; a string out is freed
    //! with `brudr_string_free`.
    use super::*;
    use std::ffi::{CStr, CString, c_char};

    unsafe fn text<'a>(ptr: *const c_char) -> Option<&'a str> {
        (!ptr.is_null())
            .then(|| unsafe { CStr::from_ptr(ptr) }.to_str().ok())
            .flatten()
    }

    /// "url\ttitle\n" per bookmark.
    #[unsafe(no_mangle)]
    pub extern "C" fn brudr_bookmarks_list(path: *const c_char) -> *mut c_char {
        let Some(path) = (unsafe { text(path) }) else {
            return std::ptr::null_mut();
        };
        let list: String = parse(&read(Path::new(path)))
            .iter()
            .map(|b| format!("{}\t{}\n", b.url, b.title))
            .collect();
        CString::new(list).map_or(std::ptr::null_mut(), CString::into_raw)
    }

    /// 1 saved, 0 removed, -1 failed.
    #[unsafe(no_mangle)]
    pub extern "C" fn brudr_bookmarks_toggle(
        path: *const c_char,
        url: *const c_char,
        title: *const c_char,
    ) -> i32 {
        let (Some(path), Some(url)) = (unsafe { text(path) }, unsafe { text(url) }) else {
            return -1;
        };
        let title = unsafe { text(title) }.unwrap_or_default();
        match toggle(Path::new(path), url, title) {
            Ok(saved) => i32::from(saved),
            Err(err) => {
                tracing::warn!("browser bookmarks: {err}");
                -1
            }
        }
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn brudr_bookmarks_ensure(path: *const c_char) -> bool {
        unsafe { text(path) }.is_some_and(|path| ensure(Path::new(path)).is_ok())
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn brudr_string_free(ptr: *mut c_char) {
        if !ptr.is_null() {
            drop(unsafe { CString::from_raw(ptr) });
        }
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn brudr_tab_after_close(count: usize, current: usize, closed: usize) -> usize {
        after_close(count, current, closed)
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn brudr_tab_limit() -> usize {
        TAB_LIMIT
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn b(url: &str, title: &str) -> Bookmark {
        Bookmark {
            url: url.into(),
            title: title.into(),
        }
    }

    #[test]
    fn reads_hand_written_lines_and_skips_the_rest() {
        let text = "# comment\n\n  https://www.google.com/   Google  Search \nhttp://example.com\n\
                    ftp://files.example nope\nnot a url\nhttps:// no host\n\
                    https://www.google.com/ again\nHTTPS://Caps.example/x?y#z\tTab title\r\n";
        assert_eq!(
            parse(text),
            [
                b("https://www.google.com/", "Google Search"),
                b("http://example.com", "example.com"),
                b("HTTPS://Caps.example/x?y#z", "Tab title"),
            ]
        );
        assert_eq!(parse(""), []);
    }

    #[test]
    fn saving_appends_one_line_and_keeps_the_file_as_written() {
        let (text, saved) = toggled("", "https://www.google.com/", "Google").unwrap();
        assert!(saved);
        assert!(text.starts_with(HEADER));
        assert!(text.ends_with("\nhttps://www.google.com/ Google\n"));
        assert_eq!(parse(&text), [b("https://www.google.com/", "Google")]);

        let mine = "# my list\nhttps://a.example/ A";
        let (text, saved) = toggled(mine, "https://b.example/", "B\n\tline\u{7}two").unwrap();
        assert!(saved);
        assert_eq!(
            text,
            "# my list\nhttps://a.example/ A\nhttps://b.example/ B line two\n"
        );
    }

    #[test]
    fn saving_a_saved_address_removes_only_its_lines() {
        let text = "# keep\nhttps://a.example/ A\n# https://b.example/ comment stays\n\
                    https://b.example/ B\nhttps://c.example/ C\nhttps://b.example/ twice\n";
        let (text, saved) = toggled(text, "https://b.example/", "ignored").unwrap();
        assert!(!saved);
        assert_eq!(
            text,
            "# keep\nhttps://a.example/ A\n# https://b.example/ comment stays\nhttps://c.example/ C\n"
        );
    }

    #[test]
    fn refuses_addresses_the_panel_cannot_open() {
        for url in [
            "",
            "about:blank",
            "file:///etc/hosts",
            "javascript:alert(1)",
            "https://",
            "https://a b.example/",
            "https://a.example/\n",
        ] {
            assert_eq!(toggled("", url, "x"), None, "{url:?}");
        }
    }

    #[test]
    fn titles_are_one_line_and_cut_to_the_limit() {
        let long = "é".repeat(TITLE_LIMIT + 50);
        let (text, _) = toggled("", "https://a.example/", &long).unwrap();
        assert_eq!(parse(&text)[0].title.chars().count(), TITLE_LIMIT);
        let (text, _) = toggled("", "https://a.example/path", "  \n ").unwrap();
        assert_eq!(parse(&text)[0].title, "a.example");
    }

    #[test]
    fn file_round_trip_creates_the_folder_and_follows_a_link() {
        let dir = std::env::temp_dir().join(format!("brudr-bookmarks-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let path = bookmarks_path(&dir);
        assert_eq!(read(&path), "");
        assert!(toggle(&path, "https://www.google.com/", "Google").unwrap());
        assert_eq!(
            parse(&read(&path)),
            [b("https://www.google.com/", "Google")]
        );
        assert!(!toggle(&path, "https://www.google.com/", "Google").unwrap());
        assert_eq!(parse(&read(&path)), []);
        assert!(read(&path).starts_with(HEADER), "the explanation stays");
        assert!(toggle(&path, "javascript:x", "x").is_err());

        // A file kept elsewhere and linked here stays a link.
        let real = dir.join("real.txt");
        std::fs::write(&real, "https://a.example/ A\n").unwrap();
        std::fs::remove_file(&path).unwrap();
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&real, &path).unwrap();
            assert!(toggle(&path, "https://b.example/", "B").unwrap());
            assert!(
                std::fs::symlink_metadata(&path)
                    .unwrap()
                    .file_type()
                    .is_symlink()
            );
            assert_eq!(
                std::fs::read_to_string(&real).unwrap(),
                "https://a.example/ A\nhttps://b.example/ B\n"
            );
        }
        let leftovers: Vec<_> = std::fs::read_dir(path.parent().unwrap())
            .unwrap()
            .flatten()
            .filter(|e| e.file_name().to_string_lossy().ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn ensure_writes_the_explanation_once() {
        let dir =
            std::env::temp_dir().join(format!("brudr-bookmarks-ensure-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let path = bookmarks_path(&dir);
        ensure(&path).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), HEADER);
        std::fs::write(&path, "https://a.example/ A\n").unwrap();
        ensure(&path).unwrap();
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            "https://a.example/ A\n"
        );
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn large_files_are_read_up_to_the_limit_and_never_rewritten() {
        let dir =
            std::env::temp_dir().join(format!("brudr-bookmarks-large-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let path = bookmarks_path(&dir);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let mut text = String::from("https://first.example/ First\n");
        text.push_str(&"#".repeat(FILE_LIMIT as usize));
        text.push_str("\nhttps://late.example/ Late\n");
        std::fs::write(&path, &text).unwrap();
        assert_eq!(parse(&read(&path)), [b("https://first.example/", "First")]);
        assert!(toggle(&path, "https://new.example/", "New").is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), text);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn closing_a_tab_shows_its_right_neighbour_or_keeps_the_shown_one() {
        // Closing the shown tab: the one to its right moves into its place.
        assert_eq!(after_close(3, 1, 1), 1);
        // The shown tab was the last: its left neighbour.
        assert_eq!(after_close(3, 2, 2), 1);
        // Closing a tab left of the shown one shifts the index, right of it does not.
        assert_eq!(after_close(4, 2, 0), 1);
        assert_eq!(after_close(4, 1, 3), 1);
        // Two tabs down to one.
        assert_eq!(after_close(2, 0, 0), 0);
        assert_eq!(after_close(2, 1, 1), 0);
        assert_eq!(after_close(2, 1, 0), 0);
        // Never past the end, even for inputs the panel does not send.
        assert_eq!(after_close(1, 0, 0), 0);
        assert_eq!(after_close(0, 0, 0), 0);
    }
}
