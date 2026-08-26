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
