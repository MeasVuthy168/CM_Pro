// ========================================
// Master Data > Edit Out-of-Area Arrears — កែសម្រួលArrearក្រៅតំបន់
// Its own page, running the shared editor (assets/js/outarea-editor.js)
// on just the rows it needs: GET /api/arreast24byco/outarea returns the
// NoCoRespone loans plus each branch's officers, instead of every
// arrears row the Daily Arrears page loads.
// Upload roles (Admin / User) only — same rule as the backend's
// save / delete; anyone else is sent back to Master Data.
// ========================================

const oaUser = (() => {
    try {
        return JSON.parse(localStorage.getItem("loggedInUser") || sessionStorage.getItem("loggedInUser") || "{}");
    } catch (e) {
        return {};
    }
})();
const oaRole = String(oaUser.role || "").toLowerCase();
const oaCanEdit = oaRole === "admin" || oaRole === "user";

if (!oaCanEdit) location.replace("/CM_Pro/pages/masterdata/index.html");

const t = (key) => (window.CMI18n ? CMI18n.t(key) : key);

let oaRows = [];
const oaOfficersByBranch = new Map();

OutAreaEditor.init({
    token: () => API.getToken(),
    getCandidateRows: () => oaRows,
    getAllRows: () => oaRows,
    getOfficerNames: branch => oaOfficersByBranch.get(branch) || [],
    canEdit: oaCanEdit,
    // A saved loan leaves the NoCoRespone list on its own (its row object
    // is patched); Daily Arrears' cached rows are now out of date, so
    // drop them and it reloads on its next visit.
    onSaved: () => {
        try {
            sessionStorage.removeItem("arrears_raw_rows_cache_v1");
            sessionStorage.removeItem("arrears_raw_rows_cache_v1_own");
        } catch (e) {}
    }
});

function oaShowState(html) {
    const list = document.getElementById("outAreaTbody");
    if (list) list.innerHTML = `<div class="oa-page-state">${html}</div>`;
}

async function oaLoad() {
    if (!oaCanEdit) return;
    if (typeof showAppLoading === "function") {
        showAppLoading(t("masterdata.outArea.loading"), { progress: true, key: "masterdata:outarea" });
    }
    try {
        const res = await fetch(`${API.BASE_URL}/api/arreast24byco/outarea`, {
            headers: { Authorization: `Bearer ${API.getToken()}` }
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.message || "Failed to load.");

        oaRows = data.rows || [];
        oaOfficersByBranch.clear();
        (data.officers || []).forEach(o => {
            if (!oaOfficersByBranch.has(o.branch)) oaOfficersByBranch.set(o.branch, []);
            oaOfficersByBranch.get(o.branch).push(o.coResponse);
        });
        oaOfficersByBranch.forEach(list => list.sort((a, b) => a.localeCompare(b)));

        OutAreaEditor.open();
    } catch (err) {
        console.error("[outArea page] load failed:", err);
        oaShowState(`${t("masterdata.outArea.loadFailed")}<br><button type="button" id="btnOaRetry">${t("masterdata.outArea.retry")}</button>`);
        document.getElementById("btnOaRetry")?.addEventListener("click", oaLoad);
    } finally {
        if (typeof hideAppLoading === "function") hideAppLoading();
    }
}

oaLoad();

// ========================================
// COMPONENT LOADER (topbar + bottomnav)
// ========================================
let oaLoaded = 0;
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
                titleKey: "masterdata.hub.outArea",
                showBack: true,
                showLogo: false,
                showProfile: false
            });
            // Belongs under Master Data — Back goes there, not history.back().
            const backBtn = document.getElementById("topbarBackBtn");
            if (backBtn) {
                backBtn.onclick = () => { location.href = "/CM_Pro/pages/masterdata/index.html"; };
            }
        }
    } catch (error) {
        console.error(error);
    } finally {
        oaLoaded++;
        if (oaLoaded >= 2) {
            setTimeout(() => {
                if (typeof hideGlobalSplash === "function") {
                    hideGlobalSplash();
                }
            }, 300);
        }
    }
}
loadComponent("topbar-container", "/CM_Pro/components/topbar.html");
loadComponent("bottomnav-container", "/CM_Pro/components/bottomnav.html");

// ========================================
// OFFLINE DETECT
// ========================================
function updateOnlineStatus() {
    const banner = document.getElementById("offlineBanner");
    if (banner) {
        banner.style.display = navigator.onLine ? "none" : "block";
    }
}
window.addEventListener("online", updateOnlineStatus);
window.addEventListener("offline", updateOnlineStatus);
updateOnlineStatus();

setTimeout(() => {
    if (typeof loadNotificationBadge === "function") {
        loadNotificationBadge();
    }
}, 500);
