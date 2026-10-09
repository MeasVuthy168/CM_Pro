// shared/theme.js
//
// App-wide theme picker: Auto (follows the OS), Light, or Dark.
//
// HOW TO ADD THIS TO A PAGE:
// 1. In <head>, BEFORE your CSS <link> tags, add this tiny inline
//    snippet (prevents a flash of the wrong theme on load — it has
//    to resolve "auto" itself since this file hasn't loaded yet):
//
//      <script>
//        document.documentElement.setAttribute(
//          "data-theme",
//          (function(){var t=localStorage.getItem("cm_theme")||"auto";return t==="auto"?(window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):t;})()
//        );
//      </script>
//
// 2. Include this file (shared/theme.js) anywhere in <body> for the
//    toggle API (window.CMTheme) and the theme list (CM_THEME_LIST).
//
// 3. That page's own CSS only needs :root (light) and
//    [data-theme="dark"] blocks — data-theme is never literally
//    "auto", only ever the resolved "light" or "dark".

(function () {
  const STORAGE_KEY = "cm_theme";

  // Single source of truth for the picker UI (Settings page). id must
  // match the [data-theme="id"] selectors used across the CSS files,
  // except "auto" which has no CSS of its own — it just resolves to
  // whichever of light/dark the OS currently prefers.
  const CM_THEME_LIST = [
    { id: "auto", label: "Auto", labelKey: "settings.theme.auto" },
    { id: "light", label: "Light", labelKey: "settings.theme.light" },
    { id: "dark", label: "Dark", labelKey: "settings.theme.dark" }
  ];
  const VALID_THEME_IDS = CM_THEME_LIST.map(t => t.id);

  function getStoredTheme() {
    const stored = localStorage.getItem(STORAGE_KEY) || "auto";
    // Guards against a stale/invalid value (e.g. an old build that
    // stored "gold"/"darkgray", or manually-edited localStorage)
    // resulting in an unstyled page.
    return VALID_THEME_IDS.includes(stored) ? stored : "auto";
  }

  function resolveTheme(theme) {
    if (theme === "auto") {
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    return theme;
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", resolveTheme(theme));
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

  // While "auto" is selected, follow the OS theme live instead of
  // only picking it up on the next full page load.
  if (window.matchMedia) {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function () {
      if (getStoredTheme() === "auto") applyTheme("auto");
    });
  }

  window.CM_THEME_LIST = CM_THEME_LIST;

  window.CMTheme = {
    get: getStoredTheme,
    set: setTheme,
    list: function () { return CM_THEME_LIST; },
    // Kept for any old binary light/dark callers.
    toggle: function () {
      const next = resolveTheme(getStoredTheme()) === "dark" ? "light" : "dark";
      setTheme(next);
      return next;
    },
  };
})();
