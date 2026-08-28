// =========================
// COMPONENT LOADER
// Same pattern as RepDetailbyCO-loader.js.
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
                title: "Officer Productivity",
                showBack: true,
                showLogo: false,
                showProfile: false
            });

            // Always reachable by clicking an officer's name on
            // RepDetailbyCO.html — Back returns there explicitly rather
            // than via history.back() (breaks on reload/bookmark/PWA
            // restore), matching that page's own back-button override.
            const backBtn = document.getElementById("topbarBackBtn");
            if (backBtn) {
                backBtn.onclick = () => { location.href = "/CM_Pro/pages/creditreport/RepDetailbyCO.html"; };
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
