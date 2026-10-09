// shared/language.js
//
// App-wide language preference: Khmer (default) or English. Mirrors
// shared/theme.js's exact shape/API (window.CMLanguage + the picker's
// own source list) so the Settings page can render this picker the
// same way it already renders the theme one. Stores the choice for
// whatever future UI reads it; this file is only the source of truth
// for the stored preference, not a translation engine.
//
// HOW TO ADD THIS TO A PAGE:
// Include this file (shared/language.js) anywhere in <body> for the
// toggle API (window.CMLanguage) and the language list (CM_LANGUAGE_LIST).

(function () {
  const STORAGE_KEY = "cm_language";

  const CM_LANGUAGE_LIST = [
    { id: "en", label: "English", flag: "🇬🇧" },
    { id: "km", label: "Khmer", flag: "🇰🇭" }
  ];
  const VALID_LANGUAGE_IDS = CM_LANGUAGE_LIST.map(l => l.id);

  function getStoredLanguage() {
    const stored = localStorage.getItem(STORAGE_KEY) || "km";
    // Guards against a stale/invalid value the same way getStoredTheme()
    // does in shared/theme.js.
    return VALID_LANGUAGE_IDS.includes(stored) ? stored : "km";
  }

  function setLanguage(language) {
    if (!VALID_LANGUAGE_IDS.includes(language)) return;
    localStorage.setItem(STORAGE_KEY, language);
  }

  window.CM_LANGUAGE_LIST = CM_LANGUAGE_LIST;

  window.CMLanguage = {
    get: getStoredLanguage,
    set: setLanguage,
    list: function () { return CM_LANGUAGE_LIST; }
  };
})();
