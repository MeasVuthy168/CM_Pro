// shared/theme.js
//
// App-wide light/dark theme toggle.
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
//    toggle API (window.CMTheme).
//
// 3. In that page's own CSS, add a [data-theme="dark"] block that
//    re-declares its CSS custom properties with dark values. This
//    ONLY works for CSS files already written with :root variables
//    (currently: spotcheck.css, settings.css). Files with hardcoded
//    hex colors (arrears.css, customers.css, turnover.css,
//    retirement.css, notification.css, loanCalculate.css) need to be
//    retrofitted to use variables before dark mode will do anything
//    on those pages — the toggle will still SAVE their preference
//    globally, it just won't visually change those specific pages
//    yet.

(function () {
  const STORAGE_KEY = "cm_theme";

  function getStoredTheme() {
    return localStorage.getItem(STORAGE_KEY) || "light";
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
  }

  function setTheme(theme) {
    localStorage.setItem(STORAGE_KEY, theme);
    applyTheme(theme);
  }

  // Re-apply in case this file loads after the inline head snippet
  // for some reason (defensive — the head snippet should already
  // have done this before first paint).
  applyTheme(getStoredTheme());

  window.CMTheme = {
    get: getStoredTheme,
    set: setTheme,
    toggle: function () {
      const next = getStoredTheme() === "dark" ? "light" : "dark";
      setTheme(next);
      return next;
    },
  };
})();
