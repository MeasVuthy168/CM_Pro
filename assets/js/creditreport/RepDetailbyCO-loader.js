// =========================
// COMPONENT LOADER
// =========================
let loaded = 0;
async function loadComponent(id, file) {
    try {
        const useCache = id !== "topbar-container";
        const cached = useCache ? sessionStorage.getItem("comp_" + id) : null;
        if (cached) {
            document.getElementById(id).innerHTML = cached;
        } else {
            const response = await fetch(file);
            const html = await response.text();
            document.getElementById(id).innerHTML = html;
            if (useCache) sessionStorage.setItem("comp_" + id, html);
        }
        if (id === "topbar-container") {
            initTopbar({
                title: "Daily Monitoring by Officer",
                showBack: true,
                showLogo: false,
                showProfile: false
            });

            // This page is only reachable from the Credit Report hub, so
            // Back goes there explicitly rather than via history.back()
            // (which breaks on reload/bookmark/PWA restore).
            const backBtn = document.getElementById("topbarBackBtn");
            if (backBtn) {
                backBtn.onclick = () => { location.href = "/CM_Pro/pages/creditreport/index.html"; };
            }

            // Move the page's own "..." menu into the topbar. The existing
            // elements are relocated rather than rebuilt, so the handlers
            // already wired in RepDetailbyCO.js keep working.
            const menuWrap = document.getElementById("crMenuWrap");
            const topbarRight = document.querySelector("#topbar-container .topbar-right");
            if (menuWrap && topbarRight) {
                topbarRight.insertBefore(menuWrap, topbarRight.firstChild);
            }
        }
    } catch (error) {
        console.error(error);
    } finally {
        loaded++;
        if (loaded >= 2) {
            setTimeout(() => {
                if (typeof hideGlobalSplash === "function") hideGlobalSplash();
            }, 300);
        }
    }
}
// =========================
// OFFLINE DETECT
// =========================
function updateOnlineStatus() {
    const banner = document.getElementById("offlineBanner");
    if (banner) banner.style.display = navigator.onLine ? "none" : "block";
}
window.addEventListener("online", updateOnlineStatus);
window.addEventListener("offline", updateOnlineStatus);
updateOnlineStatus();
// =========================
// LOAD COMPONENTS
// =========================
loadComponent("topbar-container", "/CM_Pro/components/topbar.html");
loadComponent("bottomnav-container", "/CM_Pro/components/bottomnav.html");
// =========================
// NOTIFICATION BADGE
// =========================
setTimeout(() => {
    if (typeof loadNotificationBadge === "function") loadNotificationBadge();
}, 500);
