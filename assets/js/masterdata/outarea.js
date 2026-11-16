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

// ---------- Add loans by hand: CIF / LD / LD-CIF ----------
// Any loan, not only the NoCoRespone list: one already with an officer
// (saving moves it), or one not in Daily Arrears yet (the saved move is
// applied by the Excel sync once it appears). A CIF alone lists every LD
// of the customer (GET /api/arreast24byco/find-loans); the ones picked
// open the same reassign screen, which can save them all at once.
const oaManual = {
    btn: document.getElementById("btnOaManual"),
    panel: document.getElementById("oaManualPanel"),
    input: document.getElementById("oaManualLdCif"),
    next: document.getElementById("btnOaManualNext"),
    err: document.getElementById("oaManualErr"),
    results: document.getElementById("oaManualResults")
};
let oaManualItems = [];        // the last search's loans
const oaManualPicked = new Set(); // their concate keys, ticked

const tv = (key, vars) => {
    let s = t(key);
    Object.entries(vars || {}).forEach(([k, v]) => { s = s.split(`{${k}}`).join(v); });
    return s;
};
const oaEsc = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function oaManualError(msg) {
    oaManual.err.textContent = msg || "";
    oaManual.err.hidden = !msg;
}

function oaManualReset() {
    oaManualItems = [];
    oaManualPicked.clear();
    oaManual.results.hidden = true;
    oaManual.results.innerHTML = "";
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

// The row the reassign screen works on: today's list row when the loan
// is on it (so a save takes it off "to edit"), else the found one.
function oaManualRow(item) {
    const listed = item.inArrears ? oaRows.find(r => String(r.concate).toUpperCase() === item.concate.toUpperCase()) : null;
    // A copy: the list row itself is only patched on save (listRef).
    const row = { ...(listed || item), listRef: listed || null };
    const co = row.coResponse || "";
    row.manualNote = !item.inArrears
        ? t("arrears.oaManualNotInArrears")
        : (co && !/nocorespone/i.test(co) ? t("arrears.oaManualHasOfficer").replace("{co}", co) : "");
    row.manual = true;
    return row;
}

function oaManualOpenRows(rows) {
    if (!rows.length) return oaManualError(t("arrears.oaManualPickOne"));
    const first = rows[0];
    first.applyGroup = rows.length > 1 ? rows : null;
    oaManual.panel.hidden = true;
    oaManual.input.value = "";
    oaManualReset();
    OutAreaEditor.select(first);
}

function oaManualPaint() {
    const n = oaManualItems.length;
    const all = oaManualPicked.size === n;
    oaManual.results.innerHTML = `
        <div class="oa-manual-head">
            <span>${oaEsc(tv("arrears.oaManualFound", { n }))}</span>
            <button type="button" class="oa-manual-all" id="btnOaManualAll">${oaEsc(t(all ? "arrears.oaManualUnselectAll" : "arrears.oaManualSelectAll"))}</button>
        </div>
        <div class="oa-manual-list">${oaManualItems.map(it => {
            const day = parseInt(it.day, 10);
            const co = it.coResponse && !/nocorespone/i.test(it.coResponse) ? it.coResponse : t("arrears.oaManualNoCo");
            return `
            <label class="oa-manual-item${oaManualPicked.has(it.concate) ? " on" : ""}">
                <input type="checkbox" data-oa-pick="${oaEsc(it.concate)}"${oaManualPicked.has(it.concate) ? " checked" : ""}>
                <span class="oa-manual-item-text">
                    <b>${oaEsc(it.customer || "-")}</b>
                    <small>${oaEsc(it.concate)}${it.product ? " · " + oaEsc(it.product) : ""}</small>
                    <small>${oaEsc([it.branch, co].filter(Boolean).join(" · "))}</small>
                </span>
                <span class="oa-manual-state ${it.inArrears ? "late" : "os"}">${oaEsc(it.inArrears && Number.isFinite(day) ? tv("arrears.oaManualLate", { n: day }) : t("arrears.oaManualNotLate"))}</span>
            </label>`;
        }).join("")}</div>
        <button type="button" class="oa-manual-go" id="btnOaManualGo"${oaManualPicked.size ? "" : " disabled"}>${oaEsc(tv("arrears.oaManualGo", { n: oaManualPicked.size }))}</button>`;
    oaManual.results.hidden = false;
}

oaManual.results?.addEventListener("change", e => {
    const key = e.target.dataset?.oaPick;
    if (!key) return;
    if (e.target.checked) oaManualPicked.add(key); else oaManualPicked.delete(key);
    oaManualPaint();
});
oaManual.results?.addEventListener("click", e => {
    if (e.target.closest("#btnOaManualAll")) {
        if (oaManualPicked.size === oaManualItems.length) oaManualPicked.clear();
        else oaManualItems.forEach(it => oaManualPicked.add(it.concate));
        return oaManualPaint();
    }
    if (e.target.closest("#btnOaManualGo")) {
        oaManualOpenRows(oaManualItems.filter(it => oaManualPicked.has(it.concate)).map(oaManualRow));
    }
});

async function oaManualFind() {
    const q = oaManual.input.value.replace(/\s+/g, "").toUpperCase();
    const isLdCif = /^LD\d{6,}-\d+$/.test(q);
    if (!isLdCif && !/^LD\d{6,}$/.test(q) && !/^\d{3,}$/.test(q)) return oaManualError(t("arrears.oaManualBad"));
    oaManualError("");
    oaManualReset();
    oaManual.next.disabled = true;
    try {
        const data = await oaManualGet(`/api/arreast24byco/find-loans?q=${encodeURIComponent(q)}`);
        oaManualItems = data.items || [];
        if (!oaManualItems.length) {
            // A full LD-CIF not anywhere yet: save it ahead, as before.
            if (isLdCif) {
                return oaManualOpenRows([{ concate: q, customer: t("arrears.oaPreEntered"), location: "", branch: "", coId: "", coResponse: "",
                    manual: true, manualNote: t("arrears.oaManualNotFound") }]);
            }
            return oaManualError(tv("arrears.oaManualNone", { q }));
        }
        if (oaManualItems.length === 1) return oaManualOpenRows([oaManualRow(oaManualItems[0])]);
        oaManualItems.forEach(it => oaManualPicked.add(it.concate));
        oaManualPaint();
    } catch (e) {
        console.error("[outArea page] manual lookup failed:", e);
        oaManualError(t("arrears.oaManualFailed"));
    } finally {
        oaManual.next.disabled = false;
    }
}

oaManual.next?.addEventListener("click", oaManualFind);
oaManual.input?.addEventListener("keydown", e => { if (e.key === "Enter") oaManualFind(); });

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
