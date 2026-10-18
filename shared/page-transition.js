// =========================
// PAGE TRANSITIONS (native-app style)
// Cross-document View Transitions: every same-origin navigation between
// CM_Pro pages animates instead of hard-cutting.
//   forward  → new page slides in from the right, old one drifts left
//   back     → current page slides out to the right, previous one returns
//   tab      → bottom-nav switch between the 3 root pages: quick crossfade
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
        "  html:active-view-transition-type(tab)::view-transition-old(root) { animation: 180ms ease both cmPtFadeOut; }",
        "  html:active-view-transition-type(tab)::view-transition-new(root) { animation: 220ms ease both cmPtFadeIn; box-shadow: none; }",
        "}",
        "@keyframes cmPtInRight { from { transform: translateX(100%); } to { transform: none; } }",
        "@keyframes cmPtOutLeft { from { transform: none; filter: none; } to { transform: translateX(-28%); filter: brightness(.82); } }",
        "@keyframes cmPtOutRight { from { transform: none; } to { transform: translateX(100%); } }",
        "@keyframes cmPtInLeft { from { transform: translateX(-28%); filter: brightness(.82); } to { transform: none; filter: none; } }",
        "@keyframes cmPtFadeOut { from { opacity: 1; } to { opacity: 0; } }",
        "@keyframes cmPtFadeIn { from { opacity: 0; } to { opacity: 1; } }"
    ].join("\n");

    var style = document.createElement("style");
    style.id = "cmPageTransition";
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);

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
        if (isTraverseBack) return "back";
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
