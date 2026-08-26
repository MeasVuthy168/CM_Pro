// shared/theme.js
//
// App-wide theme picker: light, dark, gold — each with its own page
// and card background (not just an accent/border swap).
//
// HOW TO ADD THIS TO A PAGE:
// 1. In <head>, BEFORE your CSS <link> tags, add this tiny inline
//    snippet (prevents a flash of the wrong theme on load):
//
//      <script>
//        document.documentElement.setAttribute(
//          "data-theme",
//          localStorage.getItem("cm_theme") || "light"
//        );
//      </script>
//
// 2. Include this file (shared/theme.js) anywhere in <body> for the
//    toggle API (window.CMTheme) and the theme list (CM_THEME_LIST).
//
// 3. In that page's own CSS, each theme needs a matching
//    [data-theme="<id>"] block re-declaring that file's CSS custom
//    properties. Most page CSS files already carry the full set
//    (light default in :root + dark/gold/green/purple overrides);
//    a few very simple pages only vary their page background and
//    don't need per-accent-theme overrides at all.

(function () {
  const STORAGE_KEY = "cm_theme";

  // Single source of truth for the picker UI (Settings page) — id
  // must match the [data-theme="id"] selectors used across the CSS
  // files, swatch is what the picker button renders as its color
  // preview, label is the Khmer name shown next to it.
  const CM_THEME_LIST = [
    { id: "light", label: "ស", swatch: "#FFFFFF" },
    { id: "dark", label: "ខ្មៅ", swatch: "#003B8B" },
    { id: "gold", label: "មាស", swatch: "#D4AF37" },
    { id: "darkgray", label: "ប្រផេះ", swatch: "#3A3F47" }
  ];
  const VALID_THEME_IDS = CM_THEME_LIST.map(t => t.id);

  function getStoredTheme() {
    const stored = localStorage.getItem(STORAGE_KEY) || "light";
    // Guards against a stale/invalid value (e.g. an old build, or
    // manually-edited localStorage) resulting in an unstyled page.
    return VALID_THEME_IDS.includes(stored) ? stored : "light";
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
  }

  function setTheme(theme) {
    if (!VALID_THEME_IDS.includes(theme)) return;
    localStorage.setItem(STORAGE_KEY, theme);
    applyTheme(theme);
  }

  // Re-apply in case this file loads after the inline head snippet
  // for some reason (defensive — the head snippet should already
  // have done this before first paint).
  applyTheme(getStoredTheme());

  window.CM_THEME_LIST = CM_THEME_LIST;

  window.CMTheme = {
    get: getStoredTheme,
    set: setTheme,
    list: function () { return CM_THEME_LIST; },
    // Kept for any old binary light/dark callers — cycles back to
    // light from gold too, rather than getting stuck flipping between
    // just two of the three theme values.
    toggle: function () {
      const next = getStoredTheme() === "dark" ? "light" : "dark";
      setTheme(next);
      return next;
    },
  };
})();
