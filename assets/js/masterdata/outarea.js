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
    standalone: true,
    onCounts: oaPaintHero,
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

// Summary card: loans still to move, saved moves, branches involved.
function oaPaintHero(view, n) {
    const set = (id, v) => {
        const el = document.getElementById(id);
        if (el) el.textContent = Number.isFinite(v) ? v.toLocaleString() : "-";
    };
    if (view === "edited") return set("oaPhEdited", n);
    set("oaPhToEdit", n);
    const todo = oaRows.filter(r => (r.coResponse || "").toLowerCase().includes("nocorespone"));
    set("oaPhBranches", new Set(todo.map(r => r.branch).filter(Boolean)).size);
}

// "2026-10-19 04:06 PM" (Cambodia time) for the data date line.
function oaFormatDateTime(value) {
    const d = new Date(value);
    if (!value || isNaN(d)) return "-";
    const k = new Date(d.getTime() + 7 * 3600 * 1000);
    const pad = n => String(n).padStart(2, "0");
    let h = k.getUTCHours();
    const ampm = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    return `${k.getUTCFullYear()}-${pad(k.getUTCMonth() + 1)}-${pad(k.getUTCDate())} ${pad(h)}:${pad(k.getUTCMinutes())} ${ampm}`;
}

async function oaLoadInfo() {
    try {
        const res = await fetch(`${API.BASE_URL}/api/arreast24byco/info`, {
            headers: { Authorization: `Bearer ${API.getToken()}` }
        });
        const data = await res.json();
        document.getElementById("oaPhUpdated").textContent = data.ok ? oaFormatDateTime(data.lastUploadAt) : "-";
    } catch (e) {
        document.getElementById("oaPhUpdated").textContent = "-";
    }
}

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

// ---------- Add an LD-CIF by hand ----------
// Any loan, not only the NoCoRespone list: one already with an officer
// (saving moves it), or one not in Daily Arrears yet (the saved move is
// applied by the Excel sync once it appears). Opens the same reassign
// screen as a list pick; the save is flagged manual.
const oaManual = {
    btn: document.getElementById("btnOaManual"),
    panel: document.getElementById("oaManualPanel"),
    input: document.getElementById("oaManualLdCif"),
    next: document.getElementById("btnOaManualNext"),
    err: document.getElementById("oaManualErr")
};

function oaManualError(msg) {
    oaManual.err.textContent = msg || "";
    oaManual.err.hidden = !msg;
}

oaManual.btn?.addEventListener("click", () => {
    oaManual.panel.hidden = !oaManual.panel.hidden;
    oaManualError("");
    if (!oaManual.panel.hidden) oaManual.input.focus();
});

async function oaManualGet(path, init) {
    const res = await fetch(`${API.BASE_URL}${path}`, {
        ...init,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${API.getToken()}` }
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.message || "Lookup failed.");
    return data;
}

async function oaManualOpen() {
    const ldCif = oaManual.input.value.replace(/\s+/g, "").toUpperCase();
    if (!/^LD\d{6,}-\d+$/.test(ldCif)) return oaManualError(t("arrears.oaManualBad"));
    oaManualError("");
    oaManual.next.disabled = true;
    try {
        let row;
        const loan = await oaManualGet(`/api/arreast24byco/loan?ldCif=${encodeURIComponent(ldCif)}`);
        if (loan.found) {
            row = { ...loan.row };
            const co = row.coResponse || "";
            if (co && !/nocorespone/i.test(co)) {
                row.manualNote = t("arrears.oaManualHasOfficer").replace("{co}", co);
            }
        } else {
            const os = await oaManualGet("/api/grid/lookup-batch", { method: "POST", body: JSON.stringify({ ldCifs: [ldCif] }) });
            const m = (os.items || {})[ldCif];
            row = m
                ? { concate: ldCif, customer: m.name || "-", location: m.address || "", branch: m.branch || "", branchCode: m.branchCode || "", coId: m.coOwner || "", coResponse: m.coOwner || "" }
                : { concate: ldCif, customer: t("arrears.oaPreEntered"), location: "", branch: "", coId: "", coResponse: "" };
            row.manualNote = t(m ? "arrears.oaManualNotInArrears" : "arrears.oaManualNotFound");
        }
        row.manual = true;
        oaManual.panel.hidden = true;
        oaManual.input.value = "";
        OutAreaEditor.select(row);
    } catch (e) {
        console.error("[outArea page] manual lookup failed:", e);
        oaManualError(t("arrears.oaManualFailed"));
    } finally {
        oaManual.next.disabled = false;
    }
}

oaManual.next?.addEventListener("click", oaManualOpen);
oaManual.input?.addEventListener("keydown", e => { if (e.key === "Enter") oaManualOpen(); });

oaLoad();
oaLoadInfo();

document.getElementById("btnOaRefresh")?.addEventListener("click", () => {
    oaLoad();
    oaLoadInfo();
});

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
                backBtn.onclick = () => cmNav.back("/CM_Pro/pages/masterdata/index.html");
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
