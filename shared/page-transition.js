// =========================
// PAGE TRANSITIONS (native-app style)
// Cross-document View Transitions: every same-origin navigation between
// CM_Pro pages animates instead of hard-cutting.
//   forward  → new page slides in from the right, old one drifts left
//   back     → current page slides out to the right, previous one returns
//   tab      → bottom-nav switch between the 3 root pages: content swaps
//              with a short fade and the gold active-tab indicator slides
//              over to the new tab
// Browsers without cross-document view transitions (or with "reduce
// motion" on) simply navigate as before.
//
// Loaded as a plain <script> in <head> on purpose: the opt-in style must
// exist on the old page when the navigation starts, and the pagereveal
// listener must be registered on the new page before its first frame.
// =========================

(function () {

    var TAB_ROOTS = [
        "/CM_Pro/",
        "/CM_Pro/index.html",
        "/CM_Pro/pages/settings/index.html",
        "/CM_Pro/pages/notifications/index.html"
    ];

    function isTabRoot(url) {
        try {
            return TAB_ROOTS.indexOf(new URL(url, location.href).pathname) !== -1;
        } catch (e) {
            return false;
        }
    }

    var css = [
        "@view-transition { navigation: auto; }",
        "@media (prefers-reduced-motion: reduce) {",
        "  ::view-transition-group(*), ::view-transition-old(*), ::view-transition-new(*) { animation: none !important; }",
        "}",
        "@media (prefers-reduced-motion: no-preference) {",
        "  ::view-transition-group(root) { animation-duration: 300ms; animation-timing-function: cubic-bezier(.2,.8,.2,1); }",
        // forward (default)
        "  ::view-transition-old(root) { animation: 300ms cubic-bezier(.2,.8,.2,1) both cmPtOutLeft; }",
        "  ::view-transition-new(root) { animation: 300ms cubic-bezier(.2,.8,.2,1) both cmPtInRight; box-shadow: -8px 0 24px rgba(0,0,0,.18); }",
        // back
        "  html:active-view-transition-type(back)::view-transition-old(root) { animation: 280ms cubic-bezier(.2,.8,.2,1) both cmPtOutRight; z-index: 2; box-shadow: -8px 0 24px rgba(0,0,0,.18); }",
        "  html:active-view-transition-type(back)::view-transition-new(root) { animation: 280ms cubic-bezier(.2,.8,.2,1) both cmPtInLeft; z-index: 1; box-shadow: none; }",
        // tab switch
        "  html:active-view-transition-type(tab)::view-transition-old(root) { animation: 140ms ease both cmPtFadeOut; }",
        "  html:active-view-transition-type(tab)::view-transition-new(root) { animation: 140ms ease both cmPtFadeIn; box-shadow: none; }",
        // plus-lighter: pixels that are the same on both pages (the
        // bottom bar, the header background) stay fully solid through
        // the crossfade instead of dipping — only what changed fades.
        "  html:active-view-transition-type(tab)::view-transition-image-pair(root) { isolation: isolate; }",
        "  html:active-view-transition-type(tab)::view-transition-old(root), html:active-view-transition-type(tab)::view-transition-new(root) { mix-blend-mode: plus-lighter; }",
        // the active-tab indicator is its own layer and glides to its
        // new spot. (The bottom bar itself must NOT get a
        // view-transition-name: pages re-render it from their loader
        // mid-transition, and Chrome then cuts the whole transition.)
        "  ::view-transition-group(cm-tabind) { animation-duration: 380ms; animation-timing-function: cubic-bezier(.3,1.25,.5,1); }",
        "  ::view-transition-old(cm-tabind), ::view-transition-new(cm-tabind) { animation: none; }",
        "  ::view-transition-old(cm-tabind) { opacity: 0; }",
        "}",
        
        "#cmTabInd { position: fixed; z-index: 1000; height: 3px; width: 44px; border-radius: 0 0 4px 4px; background: #FFD700; box-shadow: 0 0 10px 1px rgba(255,215,0,.55); pointer-events: none; display: none; view-transition-name: cm-tabind; }",
        "@keyframes cmPtInRight { from { transform: translateX(100%); } to { transform: none; } }",
        "@keyframes cmPtOutLeft { from { transform: none; filter: none; } to { transform: translateX(-28%); filter: brightness(.82); } }",
        "@keyframes cmPtOutRight { from { transform: none; } to { transform: translateX(100%); } }",
        "@keyframes cmPtInLeft { from { transform: translateX(-28%); filter: brightness(.82); } to { transform: none; filter: none; } }",
        "@keyframes cmPtFadeOut { from { opacity: 1; } to { opacity: 0; } }",
        "@keyframes cmPtFadeIn { from { opacity: 0; } to { opacity: 1; } }",
        // First-paint calm: no CSS transitions while the page is still
        // filling itself in (switches sliding from off to on, colors
        // fading) — those read as jank inside the slide/fade.
        "html.cm-pt-init *, html.cm-pt-init *::before, html.cm-pt-init *::after { transition: none !important; }",
        // Press feedback on anything tappable. :where() has no
        // specificity, so a component's own :active style still wins.
        ":where(a[href], button, [role=button], .bottom-nav-item):active { opacity: .7; }",
        // Thin loading bar, shown only when a page change is slow.
        "#cmNavBar { position: fixed; z-index: 2147483000; top: env(safe-area-inset-top, 0px); left: 0; height: 3px; width: 0; background: #FFD700; box-shadow: 0 0 8px rgba(255,215,0,.6); border-radius: 0 3px 3px 0; pointer-events: none; opacity: 0; }",
        "#cmNavBar.on { opacity: 1; width: 85%; transition: width 4s cubic-bezier(.1,.7,.2,1), opacity .15s; }"
    ].join("\n");

    var style = document.createElement("style");
    style.id = "cmPageTransition";
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);

    // ----- first-paint calm (see the style above) -----
    var root = document.documentElement;
    root.classList.add("cm-pt-init");
    function endInit() { root.classList.remove("cm-pt-init"); }
    window.addEventListener("load", function () { setTimeout(endInit, 350); });
    setTimeout(endInit, 2500);

    // ----- instant header / bottom bar -----
    // Most pages fetch components/topbar.html + bottomnav.html after the
    // page has already painted, so the new page slid in without its
    // header and the header popped in afterwards. Each page leaves a
    // copy of its own rendered header/bottom bar in sessionStorage when
    // navigated away from; the next visit to that same page puts the
    // copy in place the moment the empty container is parsed. The
    // page's own loader then replaces it with the live version (same
    // markup, plus its click handlers) as before.
    var SNAP_KEY = "cm_pt_snap:" + location.pathname;
    var IDS = ["topbar-container", "bottomnav-container"];
    var GENERIC_KEY = "cm_pt_snap_any:";

    function photoSrc() {
        try {
            var u = JSON.parse(localStorage.getItem("loggedInUser") || "{}").username;
            return (u && localStorage.getItem("cm_user_photo_" + u)) || "/CM_Pro/assets/images/profile.jpg";
        } catch (e) {
            return "/CM_Pro/assets/images/profile.jpg";
        }
    }

    function saveSnap() {
        try {
            var snap = {};
            IDS.forEach(function (id) {
                var el = document.getElementById(id);
                if (el && el.innerHTML.trim()) snap[id] = el.innerHTML;
            });
            if (snap[IDS[0]] || snap[IDS[1]]) sessionStorage.setItem(SNAP_KEY, JSON.stringify(snap));

            // Generic fallbacks for a page visited for the first time:
            // any sub-page header (back arrow shown) and any bottom bar.
            var back = document.getElementById("topbarBackBtn");
            if (snap[IDS[0]] && back && back.style.display !== "none") {
                sessionStorage.setItem(GENERIC_KEY + "top", snap[IDS[0]]);
            }
            if (snap[IDS[1]]) sessionStorage.setItem(GENERIC_KEY + "nav", snap[IDS[1]]);
        } catch (e) {}
    }
    window.addEventListener("pageswap", saveSnap);
    window.addEventListener("pagehide", saveSnap);

    var snap = null;
    try { snap = JSON.parse(sessionStorage.getItem(SNAP_KEY) || "null"); } catch (e) {}

    // First visit to this page: borrow a sub-page header with its title
    // blanked (the page's own loader writes the real one moments later)
    // and a bottom bar with no tab highlighted. Root/tab pages have
    // their own distinct headers, so they only use their own copy.
    if (!snap) {
        try {
            var gTop = isTabRoot(location.href) ? null : sessionStorage.getItem(GENERIC_KEY + "top");
            var gNav = sessionStorage.getItem(GENERIC_KEY + "nav");
            if (gTop || gNav) {
                snap = {};
                if (gTop) snap[IDS[0]] = gTop.replace(/<([a-z]+)([^>]*id="topbarTitle"[^>]*)>[\s\S]*?<\/\1>/, function (m, tag, attrs) {
                    return "<" + tag + attrs.replace(/\sdata-i18n="[^"]*"/, "") + "></" + tag + ">";
                });
                if (gNav) snap[IDS[1]] = gNav.replace(/\bactive\b/g, "");
            }
        } catch (e) {}
    }

    // ----- bottom bar highlight -----
    // A gold bar on the top edge of the active tab. It lives outside the
    // bottom bar (its own fixed element, #cmTabInd) because most pages
    // re-render the bar from their own loader while the transition is
    // still running — an indicator inside it would be swapped out
    // mid-slide and jump. With its own view-transition-name it glides
    // from the old tab's position to the new one between pages.
    var tabInd = null;

    function placeTabInd() {
        var nav = document.querySelector(".bottom-nav");
        var item = nav && nav.querySelector(".bottom-nav-item.active");
        if (!item) {
            if (tabInd) tabInd.style.display = "none";
            return;
        }
        if (!tabInd) {
            tabInd = document.createElement("div");
            tabInd.id = "cmTabInd";
            tabInd.setAttribute("aria-hidden", "true");
            (document.body || root).appendChild(tabInd);
        }
        var r = item.getBoundingClientRect();
        var n = nav.getBoundingClientRect();
        if (!r.width) return;
        tabInd.style.left = Math.round(r.left + r.width / 2 - 22) + "px";
        tabInd.style.top = Math.round(n.top) + "px";
        tabInd.style.display = "block";
    }

    // A root page's own tab is highlighted in the copy straight away, so
    // the indicator is already in place for the transition's new frame.
    function markActiveTab(container) {
        if (!isTabRoot(location.href)) return;
        var here = new URL(location.href).pathname;
        if (here === "/CM_Pro/") here = "/CM_Pro/index.html";
        var links = container.querySelectorAll(".bottom-nav-item");
        for (var i = 0; i < links.length; i++) {
            var path = "";
            try { path = new URL(links[i].getAttribute("href"), location.href).pathname; } catch (e) {}
            links[i].classList.toggle("active", path === here);
        }
    }

    if (window.MutationObserver) {
        // The bar (and which tab is active) is set by each page's own
        // loader; follow it whenever it is (re)rendered.
        new MutationObserver(function (list) {
            for (var i = 0; i < list.length; i++) {
                var t = list[i].target;
                if (t.id === "bottomnav-container" || (t.closest && t.closest(".bottom-nav"))) {
                    placeTabInd();
                    return;
                }
            }
        }).observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
    }
    window.addEventListener("resize", placeTabInd);
    window.addEventListener("load", placeTabInd);
    window.addEventListener("pageshow", placeTabInd);

    if (snap && window.MutationObserver) {
        var pending = IDS.filter(function (id) { return snap[id]; });
        var fill = function (el) {
            if (el.innerHTML.trim()) return;
            // blob: photo URLs die with the page that made them.
            el.innerHTML = snap[el.id].replace(/src="blob:[^"]*"/g, 'src="' + photoSrc() + '"');
            if (el.id === IDS[1]) {
                markActiveTab(el);
                placeTabInd();
            }
        };
        var mo = new MutationObserver(function () {
            pending = pending.filter(function (id) {
                var el = document.getElementById(id);
                if (!el) return true;
                fill(el);
                return false;
            });
            if (!pending.length) mo.disconnect();
        });
        mo.observe(root, { childList: true, subtree: true });
        document.addEventListener("DOMContentLoaded", function () { mo.disconnect(); });
    }

    // ----- back navigation -----
    // cmNav.goBack(): the browser's back when the previous page is one
    // of ours; otherwise (opened from a notification, a cold PWA launch,
    // a reload) the page's parent, so Back never does nothing.
    // cmNav.back(url): open a page *as* going back — it slides in from
    // the left like a real history back, not as a forward step.
    var BACK_KEY = "cm_pt_back";

    function parentOf(path) {
        var m = path.match(/^\/CM_Pro\/pages\/([^/]+)\/([^/]*)$/);
        if (m && m[2] && m[2] !== "index.html" &&
            ["settings", "notifications", "creditreport", "masterdata"].indexOf(m[1]) !== -1) {
            return "/CM_Pro/pages/" + m[1] + "/index.html";
        }
        return "/CM_Pro/index.html";
    }

    function cameFromApp() {
        try {
            var act = window.navigation && navigation.activation;
            if (window.navigation && "canGoBack" in navigation && !navigation.canGoBack) return false;
            var ref = (act && act.from && act.from.url) || document.referrer;
            var refUrl = ref ? new URL(ref) : null;
            return history.length > 1 && !!refUrl && refUrl.origin === location.origin &&
                refUrl.pathname.indexOf("/CM_Pro/") === 0 && !/\/login\.html$/.test(refUrl.pathname);
        } catch (e) {
            return false;
        }
    }

    window.cmNav = {
        back: function (url) {
            try {
                var to = new URL(url, location.href).pathname;
                sessionStorage.setItem(BACK_KEY, JSON.stringify({ to: to, at: Date.now() }));
            } catch (e) {}
            location.href = url;
        },
        goBack: function (fallback) {
            if (cameFromApp()) return history.back();
            window.cmNav.back(fallback || parentOf(location.pathname));
        }
    };

    function markedBack() {
        try {
            var m = JSON.parse(sessionStorage.getItem(BACK_KEY) || "null");
            sessionStorage.removeItem(BACK_KEY);
            return !!m && m.to === location.pathname && Date.now() - m.at < 15000;
        } catch (e) {
            return false;
        }
    }
    var arrivedBack = markedBack();

    // ----- page changes: tab re-tap, double-tap guard, loading bar -----
    // Tapping the page you're already on (e.g. the active bottom tab)
    // scrolls to the top instead of reloading it. A second tap while a
    // page change is under way is ignored (it used to start a second
    // navigation). A slow change shows a thin gold bar along the top.
    var NAV_GUARD_MS = 4000;
    var navStartedAt = 0;
    var navBar = null;
    var navBarTimer = null;

    function samePage(url) {
        var a = url.pathname === "/CM_Pro/" ? "/CM_Pro/index.html" : url.pathname;
        var b = location.pathname === "/CM_Pro/" ? "/CM_Pro/index.html" : location.pathname;
        return a === b && url.search === location.search;
    }

    function startNavBar() {
        clearTimeout(navBarTimer);
        navBarTimer = setTimeout(function () {
            if (!navBar) {
                navBar = document.createElement("div");
                navBar.id = "cmNavBar";
                navBar.setAttribute("aria-hidden", "true");
                (document.body || root).appendChild(navBar);
            }
            navBar.getBoundingClientRect(); // start the width transition from 0
            navBar.classList.add("on");
        }, 250);
    }

    function resetNav() {
        navStartedAt = 0;
        clearTimeout(navBarTimer);
        if (navBar) navBar.classList.remove("on");
    }

    document.addEventListener("click", function (e) {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        var a = e.target.closest && e.target.closest("a[href]");
        if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
        var url;
        try { url = new URL(a.href, location.href); } catch (err) { return; }
        if (url.origin !== location.origin || url.pathname.indexOf("/CM_Pro/") !== 0) return;

        if (samePage(url)) {
            if (url.hash) return;
            e.preventDefault();
            // Some pages scroll <body> rather than the window.
            [document.scrollingElement, document.body].forEach(function (el) {
                if (el && el.scrollTop > 0) el.scrollTo({ top: 0, behavior: "smooth" });
            });
            window.scrollTo({ top: 0, behavior: "smooth" });
            return;
        }
        if (navStartedAt && Date.now() - navStartedAt < NAV_GUARD_MS) {
            e.preventDefault();
            return;
        }
        // Decided after every other click handler has run: one that
        // cancels the link (opens a modal instead) isn't a page change.
        setTimeout(function () {
            if (e.defaultPrevented) return;
            navStartedAt = Date.now();
            startNavBar();
            // A navigation that never happens (offline) frees the guard.
            setTimeout(function () { if (navStartedAt && Date.now() - navStartedAt >= NAV_GUARD_MS) resetNav(); }, NAV_GUARD_MS + 50);
        }, 0);
    });

    // Page changes started from script (location.href = …) get the
    // loading bar too where the Navigation API exists (Chrome/Android).
    if (window.navigation && navigation.addEventListener) {
        navigation.addEventListener("navigate", function (e) {
            if (e.hashChange || e.downloadRequest || e.navigationType === "reload") return;
            try {
                if (new URL(e.destination.url).origin !== location.origin) return;
            } catch (err) { return; }
            startNavBar();
        });
    }

    // Coming back from the back/forward cache: the old page is shown
    // again as it was, so drop its loading bar and guard.
    window.addEventListener("pageshow", function (e) { if (e.persisted) resetNav(); });

    // ----- prepare the next page on touch (Chrome / Android) -----
    // Speculation Rules: the moment a finger presses an in-app link,
    // Chrome starts loading and running that page in the background, so
    // it's ready (or nearly) when the tap ends. "conservative" waits for
    // the press itself, so pages nobody opens are never loaded. Pages
    // that change something just by opening (Notification detail marks
    // it read), login and admin are left out. Safari ignores this.
    try {
        if (HTMLScriptElement.supports && HTMLScriptElement.supports("speculationrules")) {
            var rules = document.createElement("script");
            rules.type = "speculationrules";
            rules.textContent = JSON.stringify({
                prerender: [{
                    where: { and: [
                        { href_matches: "/CM_Pro/*" },
                        { not: { href_matches: "/CM_Pro/login.html" } },
                        { not: { href_matches: "/CM_Pro/pages/notifications/detail.html" } },
                        { not: { href_matches: "/CM_Pro/pages/notifications/detail.html?*" } },
                        { not: { href_matches: "/CM_Pro/pages/admin/*" } },
                        { not: { selector_matches: "[data-no-prerender]" } }
                    ] },
                    eagerness: "conservative"
                }]
            });
            (document.head || root).appendChild(rules);
        }
    } catch (e) {}

    // ----- BroadcastChannel that keeps Back instant -----
    // An open BroadcastChannel can keep a page out of the browser's
    // back/forward cache, so Back reloads it from scratch. cmChannel()
    // closes it while the page is cached and opens it again on return.
    window.cmChannel = function (name, onMessage) {
        var ch = null;
        function open() {
            if (ch || !("BroadcastChannel" in window)) return;
            ch = new BroadcastChannel(name);
            ch.onmessage = onMessage;
        }
        open();
        window.addEventListener("pagehide", function (e) {
            if (e.persisted && ch) { ch.close(); ch = null; }
        });
        window.addEventListener("pageshow", function (e) { if (e.persisted) open(); });
        return {
            postMessage: function (msg) { if (ch) ch.postMessage(msg); }
        };
    };

    // Which way did we arrive? Navigation API where available (Chrome/
    // Android); otherwise the classic navigation timing type (Safari).
    function directionOf(e) {

        var fromUrl = document.referrer;
        var isTraverseBack = false;
        var navType = "";

        try {
            var act = window.navigation && navigation.activation;
            if (act) {
                navType = act.navigationType;
                if (act.from && act.from.url) fromUrl = act.from.url;
                isTraverseBack = navType === "traverse" &&
                    act.from && act.entry && act.entry.index < act.from.index;
            } else {
                var nt = performance.getEntriesByType("navigation")[0];
                navType = nt ? nt.type : "";
                isTraverseBack = navType === "back_forward";
            }
        } catch (err) {}

        if (navType === "reload") return null;

        var fromTab = fromUrl ? isTabRoot(fromUrl) : false;
        var toTab = isTabRoot(location.href);

        if (fromTab && toTab) return "tab";
        if (isTraverseBack || arrivedBack) return "back";
        // Leaving a sub-page for one of the root pages (e.g. Save in
        // Manage PIN → Settings) reads as going back up, not forward.
        if (toTab && !fromTab) return "back";
        return "forward";
    }

    window.addEventListener("pagereveal", function (e) {
        if (!e.viewTransition) return;
        var dir = directionOf(e);
        if (!dir) {
            e.viewTransition.skipTransition();
            return;
        }
        try { e.viewTransition.types.add(dir); } catch (err) {}
    });

})();
