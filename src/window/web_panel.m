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

@interface BrudrWebPanel : NSView <WKNavigationDelegate>
@property (strong) WKWebView *web;
@property (strong) NSTextField *address;
@property (strong) NSButton *back;
@property (strong) NSButton *forward;
-(instancetype)initWithStore:(WKWebsiteDataStore *)store URL:(NSString *)url;
@end

@implementation BrudrWebPanel
-(instancetype)initWithStore:(WKWebsiteDataStore *)store URL:(NSString *)url {
    if (!(self = [super initWithFrame:NSZeroRect])) return nil;

    WKWebViewConfiguration *config = [WKWebViewConfiguration new];
    config.websiteDataStore = store;
    self.web = [[WKWebView alloc] initWithFrame:NSZeroRect configuration:config];
    self.web.navigationDelegate = self;
    self.web.translatesAutoresizingMaskIntoConstraints = NO;
    [self addSubview:self.web];

    self.address = [NSTextField textFieldWithString:url];
    self.address.placeholderString = @"https://example.com";
    self.address.target = self;
    self.address.action = @selector(go:);
    [self.address setContentCompressionResistancePriority:NSLayoutPriorityDefaultLow
                                            forOrientation:NSLayoutConstraintOrientationHorizontal];
    self.back = [NSButton buttonWithTitle:@"←" target:self action:@selector(goBack:)];
    self.back.toolTip = @"Back";
    self.back.enabled = NO;
    self.forward = [NSButton buttonWithTitle:@"→" target:self action:@selector(goForward:)];
    self.forward.toolTip = @"Forward";
    self.forward.enabled = NO;
    NSButton *reload = [NSButton buttonWithTitle:@"↻" target:self action:@selector(reload:)];
    reload.toolTip = @"Reload";
    NSStackView *bar = [NSStackView stackViewWithViews:@[self.back, self.forward, reload, self.address]];
    bar.orientation = NSUserInterfaceLayoutOrientationHorizontal;
    bar.spacing = 3;
    bar.translatesAutoresizingMaskIntoConstraints = NO;
    NSVisualEffectView *toolbar = [NSVisualEffectView new];
    toolbar.material = NSVisualEffectMaterialWindowBackground;
    toolbar.blendingMode = NSVisualEffectBlendingModeWithinWindow;
    toolbar.translatesAutoresizingMaskIntoConstraints = NO;
    [toolbar addSubview:bar];
    [self addSubview:toolbar];
    [NSLayoutConstraint activateConstraints:@[
        [toolbar.topAnchor constraintEqualToAnchor:self.topAnchor],
        [toolbar.leadingAnchor constraintEqualToAnchor:self.leadingAnchor],
        [toolbar.trailingAnchor constraintEqualToAnchor:self.trailingAnchor],
        [toolbar.heightAnchor constraintEqualToConstant:32],
        [bar.leadingAnchor constraintEqualToAnchor:toolbar.leadingAnchor constant:5],
        [bar.trailingAnchor constraintEqualToAnchor:toolbar.trailingAnchor constant:-5],
        [bar.centerYAnchor constraintEqualToAnchor:toolbar.centerYAnchor],
        [self.web.topAnchor constraintEqualToAnchor:toolbar.bottomAnchor],
        [self.web.bottomAnchor constraintEqualToAnchor:self.bottomAnchor],
        [self.web.leadingAnchor constraintEqualToAnchor:self.leadingAnchor],
        [self.web.trailingAnchor constraintEqualToAnchor:self.trailingAnchor],
    ]];
    [self go:nil];
    return self;
}

-(BOOL)wantsDefaultClipping { return YES; }

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
    if (!action.targetFrame) { // Keep new-window links in this panel; do not open another app.
        decide(WKNavigationActionPolicyCancel);
        if (action.navigationType == WKNavigationTypeLinkActivated && webURL(action.request.URL)) {
            [view loadRequest:action.request];
        }
    } else {
        NSString *scheme = action.request.URL.scheme.lowercaseString;
        BOOL subframe = !action.targetFrame.mainFrame && [@[@"about", @"blob", @"data"] containsObject:scheme ?: @""];
        BOOL allowed = subframe || webURL(action.request.URL);
        decide(allowed ? WKNavigationActionPolicyAllow : WKNavigationActionPolicyCancel);
    }
}

-(void)updateLocation:(WKWebView *)view {
    if (view.URL && !self.address.currentEditor) {
        self.address.stringValue = view.URL.absoluteString;
    }
    self.back.enabled = view.canGoBack;
    self.forward.enabled = view.canGoForward;
}

-(void)webView:(WKWebView *)view didCommitNavigation:(WKNavigation *)nav { [self updateLocation:view]; }
-(void)webView:(WKWebView *)view didFinishNavigation:(WKNavigation *)nav { [self updateLocation:view]; }
-(void)webView:(WKWebView *)view didFailNavigation:(WKNavigation *)nav withError:(NSError *)error {
    if (error.code != NSURLErrorCancelled) self.address.toolTip = error.localizedDescription;
    [self updateLocation:view];
}
-(void)webView:(WKWebView *)view didFailProvisionalNavigation:(WKNavigation *)nav withError:(NSError *)error {
    [self webView:view didFailNavigation:nav withError:error];
}
@end

@interface BrudrWebHost : NSObject
@property (weak) NSView *parent;
@property (strong) WKWebsiteDataStore *store;
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

void *brudr_web_create(void *parent, const char *profile, BrowserEvent callback, const void *context) {
    if (@available(macOS 14.0, *)) {
        NSUUID *uuid = [[NSUUID alloc] initWithUUIDString:@(profile)];
        if (!uuid) return NULL;
        BrudrWebHost *host = [BrudrWebHost new];
        host.parent = (__bridge NSView *)parent;
        host.store = [WKWebsiteDataStore dataStoreForIdentifier:uuid];
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
        panel = [[BrudrWebPanel alloc] initWithStore:host.store URL:@(url)];
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
