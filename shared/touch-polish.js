// shared/touch-polish.js
//
// Makes the PWA feel like a native app instead of a web page on
// mobile: no long-press "peek" context menu (Copy link address /
// Open in Chrome browser / Copy image / Download image) on links,
// buttons, cards, or images.
//
// The CSS side of this (assets/css/base.css: -webkit-touch-callout,
// -webkit-tap-highlight-color) handles iOS Safari's own long-press
// callout bubble. It does NOT stop Android Chrome's link/image
// "peek" menu — that one is only suppressed by preventing the
// browser's own `contextmenu` event, which is what this does. Scoped
// to just links/images/buttons (not the whole document) so normal
// text selection elsewhere — e.g. copying a loan number out of a
// table cell — still works.
//
// This does NOT touch click/tap navigation at all: `contextmenu` is
// a separate event from `click`, so preventing it here has no effect
// on normal taps, button presses, or page navigation.

document.addEventListener("contextmenu", (e) => {
    if (e.target.closest("a, img, button")) {
        e.preventDefault();
    }
});

// =========================================================
// HAPTIC TAP (20/11/2026) — the dashboard's 9 cards, the bottom bar
// (Home / Settings / Notifications) and anything marked data-haptic
// (Work to complete's Save / Submit / ‹ ›).
//
//   Android: navigator.vibrate(15).
//   iPhone:  there is no Vibration API, and a switch clicked from code
//            no longer buzzes on newer iOS (owner's iOS 27: haptic-test
//            methods 1 and 3 buzzed, 2 and 4 didn't). A REAL tap on a
//            native switch does — so each of these carries an invisible
//            <input type="checkbox" switch> over its face. The finger
//            lands on it and iOS plays its haptic; the tap still reaches
//            the button (its handlers run), and a link is followed by
//            code (a tap on a form control inside a link isn't).
// =========================================================
(function () {
    const SEL = ".dashboard-card, .bottom-nav-item, [data-haptic]";
    const IOS = /iphone|ipad|ipod/i.test(navigator.userAgent) ||
        (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

    if (!IOS) {
        document.addEventListener("click", (e) => {
            const el = e.target.closest && e.target.closest(SEL);
            if (!el || el.disabled) return;
            try { if (navigator.vibrate) navigator.vibrate(15); } catch (err) { /* none */ }
        }, true);
        return;
    }

    const style = document.createElement("style");
    style.textContent =
        ".cm-haptic-host{position:relative}" +
        ".cm-haptic-hit{position:absolute;inset:0;z-index:3;margin:0;border-radius:inherit;opacity:.011;" +
        "-webkit-tap-highlight-color:transparent;cursor:pointer}" +
        ".cm-haptic-hit input{position:absolute;inset:0;width:100%;height:100%;margin:0;opacity:.011}" +
        "button:disabled>.cm-haptic-hit,[aria-disabled=true]>.cm-haptic-hit{display:none}";
    (document.head || document.documentElement).appendChild(style);

    function attach(el) {
        if (el.querySelector(":scope > .cm-haptic-hit")) return;
        el.classList.add("cm-haptic-host");
        const label = document.createElement("label");
        label.className = "cm-haptic-hit";
        label.setAttribute("aria-hidden", "true");
        const input = document.createElement("input");
        input.type = "checkbox";
        input.setAttribute("switch", "");
        input.tabIndex = -1;
        label.appendChild(input);
        // The switch covers the whole face, so a tap is a click on it,
        // which goes on to the button / link (their handlers run once).
        // Should a tap land on the label instead, the label repeats it
        // on the switch: keep only that repeat, so it is still once.
        label.addEventListener("click", (e) => { if (e.target === label) e.stopPropagation(); });
        if (el.matches("a[href]")) {
            input.addEventListener("change", () => {
                let to;
                try { to = new URL(el.href, location.href); } catch (err) { return; }
                // The page we're on: page-transition already scrolled it to the top.
                if (to.pathname === location.pathname && !to.hash) return;
                location.href = el.href;
            });
        }
        el.appendChild(label);
    }

    function scan(root) {
        if (!root || root.nodeType !== 1) return;
        if (root.matches(SEL)) attach(root);
        root.querySelectorAll(SEL).forEach(attach);
    }

    function start() {
        scan(document.body);
        // Bottom bars load later, and buttons get their text rewritten
        // (textContent drops the switch): put it back whenever needed.
        new MutationObserver((list) => {
            for (const m of list) {
                if (m.target.nodeType === 1 && m.target.matches(SEL)) attach(m.target);
                m.addedNodes.forEach(scan);
            }
        }).observe(document.body, { childList: true, subtree: true });
    }
    if (document.body) start();
    else document.addEventListener("DOMContentLoaded", start);
})();
