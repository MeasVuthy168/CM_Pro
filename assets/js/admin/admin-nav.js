/* =====================================================
   admin-nav.js
   Single source of truth for the admin tool list. Renders
   the sidebar (on every /pages/admin/*.html page) and the
   tool-card grid (on the hub page only).

   To add a new admin tool later: add ONE entry below and
   flip its status to "live" once the page exists — every
   page's sidebar updates automatically, no per-page edits.
   ===================================================== */
const CM_ADMIN_TOOLS = [
  { key: "hub",       label: "Overview",        labelKey: "admin.nav.hub",           icon: "🏠", href: "/CM_Pro/pages/admin/index.html",      status: "live" },
  { key: "bandwidth", label: "Bandwidth Stats",  labelKey: "admin.nav.bandwidth",     icon: "📶", href: "/CM_Pro/pages/admin/bandwidth.html",  status: "live" },
  { key: "users",     label: "User Management",  labelKey: "admin.nav.users",        icon: "👥", href: "/CM_Pro/pages/admin/users.html",       status: "live" },
  { key: "logs",      label: "Activity Logs",    labelKey: "admin.nav.logs",         icon: "🧾", href: "/CM_Pro/pages/admin/activitylogs.html",status: "live" },
  { key: "notifications", label: "Notifications", labelKey: "admin.nav.notifications", icon: "🔔", href: "/CM_Pro/pages/admin/notifications.html", status: "live" },
  { key: "wallpaper", label: "Wallpaper",        labelKey: "admin.nav.wallpaper",     icon: "🖼️", href: "/CM_Pro/pages/admin/wallpaper.html",   status: "live" },
  { key: "versions",  label: "App Versions",     labelKey: "admin.nav.versions",     icon: "📦", href: "/CM_Pro/pages/admin/appversions.html", status: "live" }
];

// t(): small helper so this file's hardcoded UI strings go through the
// i18n dictionary (shared/i18n/admin.js) when it's loaded, and fall
// back to the key itself (or the English literal passed as 2nd arg)
// if i18n hasn't loaded yet.
const t = (key, vars) => (window.CMI18n ? CMI18n.t(key, vars) : key);

function cmRenderAdminNav(activeKey) {
  const container = document.getElementById("admSidebar");
  if (!container) return;

  container.innerHTML = CM_ADMIN_TOOLS.map((tool) => {
    const isActive = tool.key === activeKey;
    const isSoon = tool.status === "soon";
    const classes = ["adm-nav-link"];
    if (isActive) classes.push("adm-nav-active");
    if (isSoon) classes.push("adm-nav-disabled");

    const tag = isSoon ? "div" : "a";
    const hrefAttr = isSoon ? "" : `href="${tool.href}"`;

    return `<${tag} ${hrefAttr} class="${classes.join(" ")}">
      <span class="adm-nav-icon">${tool.icon}</span>
      <span class="adm-nav-text" data-i18n="${tool.labelKey}">${t(tool.labelKey)}</span>
      ${isSoon ? `<span class="adm-nav-badge" data-i18n="admin.nav.soonBadge">${t("admin.nav.soonBadge")}</span>` : ""}
    </${tag}>`;
  }).join("");
}

function cmRenderToolCards(containerId, excludeKey) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const items = CM_ADMIN_TOOLS.filter((tool) => tool.key !== excludeKey);

  container.innerHTML = items.map((tool) => {
    const isSoon = tool.status === "soon";
    const tag = isSoon ? "div" : "a";
    const hrefAttr = isSoon ? "" : `href="${tool.href}"`;

    return `<${tag} ${hrefAttr} class="adm-tool-card${isSoon ? " adm-tool-soon" : ""}">
      <div class="adm-tool-icon">${tool.icon}</div>
      <div class="adm-tool-label" data-i18n="${tool.labelKey}">${t(tool.labelKey)}</div>
      ${isSoon
        ? `<span class="adm-nav-badge" data-i18n="admin.nav.comingSoonBadge">${t("admin.nav.comingSoonBadge")}</span>`
        : '<span class="adm-tool-arrow">→</span>'}
    </${tag}>`;
  }).join("");
}

document.addEventListener("DOMContentLoaded", () => {
  const activeKey = document.body.dataset.admPage || "";
  cmRenderAdminNav(activeKey);
  renderTopbarActions();

  if (document.getElementById("admToolsGrid")) {
    cmRenderToolCards("admToolsGrid", activeKey);
  }

  const userLabelEl = document.getElementById("admUserLabel");
  if (userLabelEl && window.CMAdmin) {
    // Starts tagged data-i18n="admin.common.adminFallback" — drop it now
    // that JS owns this element's content, so a later CMI18n.apply()
    // pass can't stomp a real admin name back to the fallback label.
    userLabelEl.removeAttribute("data-i18n");
    userLabelEl.textContent = window.CMAdmin.fullname || window.CMAdmin.username || t("admin.common.adminFallback");
  }
});

function renderTopbarActions() {
  const container = document.getElementById("admTopbarActions");
  if (!container) return;

  container.innerHTML = `
    <a href="/CM_Pro/index.html" class="adm-btn adm-topbar-btn" title="${t("admin.nav.backToApp")}" data-i18n-title="admin.nav.backToApp">
      <span>⬅️</span><span class="adm-topbar-btn-text" data-i18n="admin.nav.backToApp">${t("admin.nav.backToApp")}</span>
    </a>
    <button type="button" class="adm-btn adm-topbar-btn adm-topbar-logout" id="admLogoutBtn" title="${t("admin.nav.logout")}" data-i18n-title="admin.nav.logout">
      <span>🚪</span><span class="adm-topbar-btn-text" data-i18n="admin.nav.logout">${t("admin.nav.logout")}</span>
    </button>
  `;

  const logoutBtn = document.getElementById("admLogoutBtn");
  logoutBtn?.addEventListener("click", () => {
    if (typeof logout === "function") {
      logout(); // shared/logout.js — handles confirm + clear storage + redirect
    } else {
      // shared/logout.js wasn't loaded on this page — fall back inline
      if (confirm(t("admin.nav.logoutConfirm"))) {
        localStorage.removeItem("token");
        localStorage.removeItem("loggedInUser");
        sessionStorage.clear();
        window.location.replace("/CM_Pro/login.html");
      }
    }
  });
}

window.CM_ADMIN_TOOLS = CM_ADMIN_TOOLS;
window.cmRenderAdminNav = cmRenderAdminNav;
window.cmRenderToolCards = cmRenderToolCards;
