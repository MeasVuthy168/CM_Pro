// shared/i18n.js
//
// Minimal DOM translation layer. Elements tagged data-i18n="<key>" get
// their textContent set to the translation for the current language
// (window.CMLanguage, from shared/language.js, STORAGE_KEY "cm_language").
// Each page/section registers its own strings via CMI18n.register({...})
// so many small dictionary files can load independently instead of all
// editing one shared object (keeps parallel work on different pages
// conflict-free).
//
// HOW TO ADD THIS TO A PAGE:
// 1. Load order in <body>, before the page's own feature JS:
//      <script src="/CM_Pro/shared/language.js"></script>
//      <script src="/CM_Pro/shared/i18n.js"></script>
//      <script src="/CM_Pro/shared/i18n/core.js"></script>
//      <script src="/CM_Pro/shared/i18n/<page>.js"></script>  (if this
//        page has its own strings — see shared/i18n/ for examples)
// 2. Tag translatable elements:
//      <span data-i18n="settings.title">Settings</span>
//    For attributes instead of text content, use:
//      data-i18n-placeholder, data-i18n-title, data-i18n-aria-label,
//      data-i18n-value
//    For a string that needs inline markup, use data-i18n-html
//    (sets innerHTML — only for static, dictionary-authored strings,
//    never anything derived from user input).
// 3. CMI18n.apply() runs automatically on DOMContentLoaded, again
//    whenever the language changes (the "cm-language-changed" event
//    language.js fires), and on any DOM node added afterwards (a
//    MutationObserver on <body>) — covers topbar/bottomnav and any
//    other HTML injected at runtime without every injection site
//    needing to remember to call it. Calling CMI18n.apply(container)
//    yourself is only needed if you add content before <body> exists
//    or want to force a sync re-translate.

(function () {
  const DICT = {};

  function register(entries) {
    Object.assign(DICT, entries);
  }

  function currentLang() {
    return window.CMLanguage ? window.CMLanguage.get() : "km";
  }

  // vars: optional { name: value } map, substituted for "{name}" in
  // the translated string (e.g. t("dashboard.greeting", { name: "Vuthy" })).
  function t(key, vars) {
    const entry = DICT[key];
    let str = entry ? (entry[currentLang()] || entry.km || entry.en || key) : key;
    if (vars) {
      Object.keys(vars).forEach(k => {
        str = str.split("{" + k + "}").join(vars[k]);
      });
    }
    return str;
  }

  function apply(root) {
    const scope = root || document;
    if (!scope.querySelectorAll) return;

    scope.querySelectorAll("[data-i18n]").forEach(el => {
      el.textContent = t(el.getAttribute("data-i18n"));
    });

    // Only for static, dictionary-authored strings that need inline
    // markup (e.g. "Tap <b>Share</b>") — never for anything derived
    // from user input, since this sets innerHTML.
    scope.querySelectorAll("[data-i18n-html]").forEach(el => {
      el.innerHTML = t(el.getAttribute("data-i18n-html"));
    });

    scope.querySelectorAll("[data-i18n-placeholder]").forEach(el => {
      el.setAttribute("placeholder", t(el.getAttribute("data-i18n-placeholder")));
    });

    scope.querySelectorAll("[data-i18n-title]").forEach(el => {
      el.setAttribute("title", t(el.getAttribute("data-i18n-title")));
    });

    scope.querySelectorAll("[data-i18n-aria-label]").forEach(el => {
      el.setAttribute("aria-label", t(el.getAttribute("data-i18n-aria-label")));
    });

    scope.querySelectorAll("[data-i18n-value]").forEach(el => {
      el.value = t(el.getAttribute("data-i18n-value"));
    });
  }

  document.addEventListener("DOMContentLoaded", () => apply());
  window.addEventListener("cm-language-changed", () => apply());

  // Components like topbar/bottomnav (and any JS-rendered list/table)
  // are injected via innerHTML well after DOMContentLoaded, from
  // dozens of independent loadComponent()-style call sites across the
  // app — rather than editing every one of them to call apply() after
  // injecting, just watch for new nodes and translate them as they
  // land.
  function watchForDynamicContent() {
    if (!window.MutationObserver || !document.body) return;

    const SELECTOR = "[data-i18n],[data-i18n-html],[data-i18n-placeholder],[data-i18n-title],[data-i18n-aria-label],[data-i18n-value]";

    new MutationObserver(mutations => {
      for (const m of mutations) {
        m.addedNodes.forEach(node => {
          if (node.nodeType !== 1) return;
          if (node.matches && node.matches(SELECTOR)) apply(node.parentNode || document);
          if (node.querySelector && node.querySelector(SELECTOR)) apply(node);
        });
      }
    }).observe(document.body, { childList: true, subtree: true });
  }

  if (document.body) {
    watchForDynamicContent();
  } else {
    document.addEventListener("DOMContentLoaded", watchForDynamicContent);
  }

  window.CMI18n = { register, t, apply, lang: currentLang };
})();
