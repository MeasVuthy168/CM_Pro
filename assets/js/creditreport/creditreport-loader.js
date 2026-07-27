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
            if (useCache) {
                sessionStorage.setItem("comp_" + id, html);
            }
        }
        if (id === "topbar-container") {
            initTopbar({
                title: "Credit Report",
                showBack: true,
                showLogo: false,
                showProfile: false
            });

            // initTopbar defaults Back to history.back(), which walks to
            // whatever was viewed previously — including arrears, if the
            // person just came back from there. This hub always belongs
            // under the dashboard, so send Back there explicitly.
            const backBtn = document.getElementById("topbarBackBtn");
            if (backBtn) {
                backBtn.onclick = () => { location.href = "/CM_Pro/index.html"; };
            }
        }
    } catch (error) {
        console.error(error);
    } finally {
        loaded++;
        if (loaded >= 2) {
            setTimeout(() => {
                if (typeof hideGlobalSplash === "function") {
                    hideGlobalSplash();
                }
            }, 300);
        }
    }
}
// =========================
// OFFLINE DETECT
// =========================
function updateOnlineStatus() {
    const banner = document.getElementById("offlineBanner");
    if (banner) {
        banner.style.display = navigator.onLine ? "none" : "block";
    }
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
    if (typeof loadNotificationBadge === "function") {
        loadNotificationBadge();
    }
}, 500);
