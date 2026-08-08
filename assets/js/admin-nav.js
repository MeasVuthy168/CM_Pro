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
  { key: "hub",       label: "Overview",        icon: "🏠", href: "/CM_Pro/pages/admin/index.html",      status: "live" },
  { key: "bandwidth", label: "Bandwidth Stats",  icon: "📶", href: "/CM_Pro/pages/admin/bandwidth.html",  status: "live" },
  { key: "users",     label: "User Management",  icon: "👥", href: "#",                                    status: "soon" },
  { key: "uploads",   label: "Data Uploads",     icon: "⬆️", href: "#",                                    status: "soon" },
  { key: "logs",      label: "Activity Logs",    icon: "🧾", href: "#",                                    status: "soon" },
  { key: "versions",  label: "App Versions",     icon: "📦", href: "#",                                    status: "soon" }
];

function cmRenderAdminNav(activeKey) {
  const container = document.getElementById("admSidebar");
  if (!container) return;

  container.innerHTML = CM_ADMIN_TOOLS.map((t) => {
    const isActive = t.key === activeKey;
    const isSoon = t.status === "soon";
    const classes = ["adm-nav-link"];
    if (isActive) classes.push("adm-nav-active");
    if (isSoon) classes.push("adm-nav-disabled");

    const tag = isSoon ? "div" : "a";
    const hrefAttr = isSoon ? "" : `href="${t.href}"`;

    return `<${tag} ${hrefAttr} class="${classes.join(" ")}">
      <span class="adm-nav-icon">${t.icon}</span>
      <span class="adm-nav-text">${t.label}</span>
      ${isSoon ? '<span class="adm-nav-badge">Soon</span>' : ""}
    </${tag}>`;
  }).join("");
}

function cmRenderToolCards(containerId, excludeKey) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const items = CM_ADMIN_TOOLS.filter((t) => t.key !== excludeKey);

  container.innerHTML = items.map((t) => {
    const isSoon = t.status === "soon";
    const tag = isSoon ? "div" : "a";
    const hrefAttr = isSoon ? "" : `href="${t.href}"`;

    return `<${tag} ${hrefAttr} class="adm-tool-card${isSoon ? " adm-tool-soon" : ""}">
      <div class="adm-tool-icon">${t.icon}</div>
      <div class="adm-tool-label">${t.label}</div>
      ${isSoon
        ? '<span class="adm-nav-badge">Coming soon</span>'
        : '<span class="adm-tool-arrow">→</span>'}
    </${tag}>`;
  }).join("");
}

document.addEventListener("DOMContentLoaded", () => {
  const activeKey = document.body.dataset.admPage || "";
  cmRenderAdminNav(activeKey);

  if (document.getElementById("admToolsGrid")) {
    cmRenderToolCards("admToolsGrid", activeKey);
  }

  const userLabelEl = document.getElementById("admUserLabel");
  if (userLabelEl && window.CMAdmin) {
    userLabelEl.textContent = window.CMAdmin.fullname || window.CMAdmin.username || "Admin";
  }
});

window.CM_ADMIN_TOOLS = CM_ADMIN_TOOLS;
window.cmRenderAdminNav = cmRenderAdminNav;
window.cmRenderToolCards = cmRenderToolCards;
