// ========================================
// Master Data > Work to complete — ការងារត្រូវបំពេញ (Reason Arrear)
// The officer's to-do list on its own page: loans with no reason yet,
// expired promises, and what's filled — tap one to fill its reason.
//
// Rows come from GET /api/arreast24byco/work (the user's scope, with the
// saved reasonarrear record already applied). Saving and submitting use
// the local pending store and API in assets/js/reason-kit.js, which Daily
// Arrears reads too, so a draft saved here shows there.
//
// It is also Daily Arrears' Reason Arrear editor: tapping a loan there
// opens ?from=arrears on that loan (see "Opened from Daily Arrears").
// ========================================

const t = (key) => (window.CMI18n ? CMI18n.t(key) : key);
const tf = (key, vars) => Object.entries(vars || {}).reduce((s, [k, v]) => s.replace(`{${k}}`, v), t(key));

const wkUser = (() => {
    try {
        return JSON.parse(localStorage.getItem("loggedInUser") || sessionStorage.getItem("loggedInUser") || "{}");
    } catch (e) {
        return {};
    }
})();
const wkRole = String(wkUser.role || "").toLowerCase();
// Viewer_Staff only ever has their own loans — no branch / team filters.
const wkShowFilters = wkRole !== "viewer_staff";

const wkParams = new URLSearchParams(location.search);
let wkRows = [];
let wkTab = ["unfilled", "expired", "filled"].includes(wkParams.get("tab")) ? wkParams.get("tab") : "unfilled";
let wkBranch = wkParams.get("branch") || "";
let wkTeam = "";          // "" | "Credit Officer" | "FSRO"
let wkShown = [];         // the list as currently filtered (also what ‹ › walks)
let wkRow = null;         // the loan open in the detail screen
let wkBaseline = null;    // field values it was opened with (dirty check)

const $ = id => document.getElementById(id);
const reasonAJ = $("reasonAJ");
const reasonAK = $("reasonAK");
const reasonAL = $("reasonAL");
const reasonGPS = $("reasonGPS");

function notify(message, type = "info") {
    if (typeof CMToast !== "undefined" && CMToast.show) {
        CMToast.show({ type, title: message, message: "", duration: 3000 });
    } else {
        alert(message);
    }
}

function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text == null ? "" : String(text);
    return div.innerHTML.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function amount(value) {
    const n = parseFloat(String(value ?? "").replace(/,/g, ""));
    return Number.isFinite(n) ? n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "";
}

// Phnom Penh date as YYYY-MM-DD (UTC+7, no DST).
function todayKey() {
    return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

// "YYYY-MM-DD" -> "dd/mm/yyyy" (what ReasonKit.computeStatus reads).
function isoToDMY(iso) {
    const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

// "2026-10-19 04:06 PM" (Cambodia time).
function fmtDateTime(value) {
    const d = new Date(value);
    if (!value || isNaN(d)) return value || "";
    const k = new Date(d.getTime() + 7 * 3600 * 1000);
    const pad = n => String(n).padStart(2, "0");
    let h = k.getUTCHours();
    const ampm = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    return `${k.getUTCFullYear()}-${pad(k.getUTCMonth() + 1)}-${pad(k.getUTCDate())} ${pad(h)}:${pad(k.getUTCMinutes())} ${ampm}`;
}

function teamOf(row) {
    return String(row.teamLeader || "").trim().toUpperCase() === "FSRO" ? "FSRO" : "Credit Officer";
}

// The same rules as the officer reminders and Daily Arrears' Work to
// complete: no Solution (AK) yet / promise date (AL) before today.
function isUnfilled(row) { return String(row.ak || "").trim() === ""; }
function isExpired(row) { return !!row.al && row.al < todayKey(); }
function inTab(row, tab) {
    if (tab === "unfilled") return isUnfilled(row);
    if (tab === "expired") return isExpired(row);
    return !isUnfilled(row) && !isExpired(row);
}

// Local drafts (saved, not yet submitted) win over the server values.
function applyPending(rows) {
    const map = ReasonKit.getPending();
    rows.forEach(row => {
        const p = map[row.concate];
        row.__pending = !!p;
        if (!p) return;
        row.aj = p.aj || "";
        row.ak = p.ak || "";
        row.al = p.al ? String(p.al).slice(0, 10) : "";
    });
}

// ---------- load ----------
// Coming from Daily Arrears, its rows (reasons already applied) are handed
// over in sessionStorage, so the page opens instantly instead of loading
// everything a second time. Used only when it's this user's, under 10
// minutes old, and older than no submit made here since (a submit makes
// Daily Arrears' copy out of date) — otherwise load as usual.
const WK_SNAPSHOT_KEY = "cm_work_snapshot_v1";
const WK_SUBMITTED_KEY = "cm_work_submitted_at";

function takeSnapshot() {
    try {
        const snap = JSON.parse(sessionStorage.getItem(WK_SNAPSHOT_KEY) || "null");
        if (!snap || !Array.isArray(snap.rows)) return null;
        const submittedAt = Number(localStorage.getItem(WK_SUBMITTED_KEY)) || 0;
        const fresh = Date.now() - snap.at < 10 * 60 * 1000 && snap.at > submittedAt;
        if (!fresh || snap.username !== (wkUser.username || "")) return null;
        return snap;
    } catch (e) {
        return null;
    }
}

function useRows(rows) {
    wkRows = rows;
    applyPending(wkRows);
    renderChips();
    renderList();
}

async function wkLoad({ fresh = false } = {}) {
    const snap = fresh ? null : takeSnapshot();
    if (snap) {
        useRows(snap.rows);
        if (snap.lastUploadAt) $("wkUpdated").textContent = fmtDateTime(snap.lastUploadAt);
        return;
    }
    if (typeof showAppLoading === "function") {
        showAppLoading(t("work.loading"), { progress: true, key: "masterdata:work" });
    }
    try {
        const res = await fetch(`${API.BASE_URL}/api/arreast24byco/work`, {
            headers: { Authorization: `Bearer ${API.getToken()}` }
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.message || "Failed to load.");
        useRows(data.rows || []);
    } catch (err) {
        console.error("[work] load failed:", err);
        $("wkList").innerHTML = `<div class="oa-page-state">${escapeHtml(t("masterdata.outArea.loadFailed"))}<br><button type="button" id="btnWkRetry">${escapeHtml(t("masterdata.outArea.retry"))}</button></div>`;
        $("btnWkRetry")?.addEventListener("click", wkLoad);
    } finally {
        if (typeof hideAppLoading === "function") hideAppLoading();
    }
}

async function wkLoadInfo() {
    try {
        const res = await fetch(`${API.BASE_URL}/api/arreast24byco/info`, {
            headers: { Authorization: `Bearer ${API.getToken()}` }
        });
        const data = await res.json();
        $("wkUpdated").textContent = data.ok ? fmtDateTime(data.lastUploadAt) || "-" : "-";
    } catch (e) {
        $("wkUpdated").textContent = "-";
    }
}

// ---------- opened from Daily Arrears on one loan ----------
// Daily Arrears hands over the loan, the rows ‹ › walks there (its filter
// and sort, or one customer's LDs), those customers' other LDs and its
// answer suggestions. The page is then just the editor: Back, Save and
// Submit all return to Daily Arrears, which puts its filters back and
// scrolls to the same loan.
const WK_FOCUS_KEY = "cm_work_focus_v1";
const wkFocus = (() => {
    if (wkParams.get("from") !== "arrears") return null;
    try {
        const f = JSON.parse(sessionStorage.getItem(WK_FOCUS_KEY) || "null");
        if (!f || !Array.isArray(f.rows) || f.username !== (wkUser.username || "")) return null;
        return f;
    } catch (e) {
        return null;
    }
})();

function openFocus() {
    const label = document.querySelector("#btnWkBack [data-i18n]");
    if (label) {
        label.dataset.i18n = "dashboard.dailyArrears";
        label.textContent = t("dashboard.dailyArrears");
    }
    $("reasonApplyAll").checked = !!wkFocus.applyAll;
    wkRows = wkFocus.rows;
    applyPending(wkRows);
    const byConcate = new Map(wkRows.map(r => [r.concate, r]));
    wkShown = wkFocus.nav.map(c => byConcate.get(c)).filter(Boolean);
    openDetail(byConcate.get(wkFocus.concate) || wkShown[0]);
}

// Back to Daily Arrears, with a message for it to show there.
function backToArrears(flash) {
    try {
        sessionStorage.setItem("cm_arrears_back_v1", String(Date.now()));
        if (flash) sessionStorage.setItem("cm_work_flash_v1", JSON.stringify({ at: Date.now(), ...flash }));
    } catch (e) {}
    if (/\/pages\/arrears\//.test(document.referrer) && history.length > 1) history.back();
    else location.href = "/CM_Pro/pages/arrears/index.html";
}

// ---------- list ----------
function scopedRows() {
    return wkRows.filter(r => (!wkBranch || r.branch === wkBranch) && (!wkTeam || teamOf(r) === wkTeam));
}

function chip(attr, value, label, n, active) {
    return `<button type="button" class="oa-filter-chip ${active ? "active" : ""}" ${attr}="${escapeHtml(value)}">${escapeHtml(label)}${n != null ? ` <span>${n.toLocaleString()}</span>` : ""}</button>`;
}

function renderChips() {
    const branchWrap = $("wkBranchChips");
    const teamWrap = $("wkTeamChips");
    if (!wkShowFilters) {
        branchWrap.innerHTML = "";
        teamWrap.innerHTML = "";
        return;
    }
    const counts = new Map();
    wkRows.filter(r => inTab(r, wkTab)).forEach(r => counts.set(r.branch || "-", (counts.get(r.branch || "-") || 0) + 1));
    const branches = [...new Set(wkRows.map(r => r.branch).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    if (wkBranch && !branches.includes(wkBranch)) wkBranch = "";
    branchWrap.innerHTML = branches.length < 2 ? "" :
        chip("data-branch", "", t("work.allBranches"), null, !wkBranch) +
        branches.map(b => chip("data-branch", b, b, counts.get(b) || 0, wkBranch === b)).join("");
    teamWrap.innerHTML =
        chip("data-team", "", t("arrears.optionAll"), null, !wkTeam) +
        chip("data-team", "Credit Officer", "CO", null, wkTeam === "Credit Officer") +
        chip("data-team", "FSRO", "FSRO", null, wkTeam === "FSRO");
}

function renderStats(scoped) {
    const n = tab => scoped.filter(r => inTab(r, tab)).length;
    const unfilled = n("unfilled");
    const expired = n("expired");
    ["unfilled", "expired", "filled"].forEach(tab => {
        $(`wkCount-${tab}`).textContent = (tab === "unfilled" ? unfilled : tab === "expired" ? expired : n("filled")).toLocaleString();
    });
    $("wkStatUnfilled").textContent = unfilled.toLocaleString();
    $("wkStatExpired").textContent = expired.toLocaleString();
    $("wkStatPct").textContent = scoped.length ? `${Math.floor((scoped.length - unfilled) / scoped.length * 100)}%` : "-";
}

function renderPendingBar() {
    const n = ReasonKit.pendingCount();
    $("wkPending").hidden = n === 0;
    $("wkPendingText").textContent = tf("work.pendingCount", { n: n.toLocaleString() });
}

function renderList() {
    document.querySelectorAll("[data-wk-tab]").forEach(b => b.classList.toggle("active", b.dataset.wkTab === wkTab));
    const scoped = scopedRows();
    renderStats(scoped);
    renderPendingBar();

    const q = $("wkSearch").value.trim().toLowerCase();
    wkShown = scoped
        .filter(r => inTab(r, wkTab))
        .filter(r => !q || [r.customer, r.loanNumber, r.cif, r.concate, r.coResponse].some(v => String(v || "").toLowerCase().includes(q)))
        .sort((a, b) => (parseInt(b.day, 10) || 0) - (parseInt(a.day, 10) || 0));

    const shown = wkShown.slice(0, 300);
    $("wkSubtitle").textContent = tf(wkShown.length > 300 ? "work.subtitleCapped" : "work.subtitle", {
        n: wkShown.length.toLocaleString(),
        tab: t(`work.tab${wkTab[0].toUpperCase()}${wkTab.slice(1)}`)
    });

    const list = $("wkList");
    if (!shown.length) {
        const done = wkTab !== "filled" && !q;
        list.innerHTML = `<div class="oa-empty oa-empty-art">
            <span class="oa-empty-ico"><span class="ui-ico ui-ico-clipboard" aria-hidden="true"></span></span>
            <strong>${escapeHtml(t(done ? "work.emptyDone" : "arrears.oaEmpty"))}</strong>
        </div>`;
        return;
    }
    list.innerHTML = shown.map((r, i) => {
        const day = parseInt(r.day, 10);
        const amt = amount(r.arreas);
        const status = isExpired(r)
            ? `<span class="wk-chip wk-chip-expired">${escapeHtml(tf("work.expiredOn", { d: isoToDMY(r.al) }))}</span>`
            : r.al ? `<span class="wk-chip">${escapeHtml(tf("work.promiseOn", { d: isoToDMY(r.al) }))}</span>` : "";
        return `<div class="oa-item${r.__pending ? " wk-item-pending" : ""}" role="button" tabindex="0" data-i="${i}">
            <div class="oa-item-main">
                <div class="oa-item-name">${escapeHtml(r.customer || "-")}</div>
                <div class="oa-item-sub">${escapeHtml(r.loanNumber || r.concate)} · CIF ${escapeHtml(r.cif)}</div>
                ${r.location ? `<div class="oa-item-addr"><span class="ui-ico ui-ico-pin" aria-hidden="true"></span> ${escapeHtml(r.location)}</div>` : ""}
                <div class="oa-item-meta">
                    ${wkShowFilters && r.coResponse ? `<span><span class="ui-ico ui-ico-officer" aria-hidden="true"></span> ${escapeHtml(r.coResponse)}</span>` : ""}
                    ${amt ? `<span class="oa-item-amt">${escapeHtml(amt)}${r.ccy ? ` ${escapeHtml(r.ccy)}` : ""}</span>` : ""}
                    ${status}
                    ${r.__pending ? `<span class="wk-chip wk-chip-pending">${escapeHtml(t("work.notSubmitted"))}</span>` : ""}
                </div>
                ${wkTab === "filled" && r.ak ? `<div class="wk-item-reason">${escapeHtml(r.ak)}</div>` : ""}
            </div>
            <div class="oa-item-side">
                ${Number.isFinite(day) ? `<span class="arr-day-badge">${day.toLocaleString()} <small>${escapeHtml(t("arrears.cardDays"))}</small></span>` : ""}
                <span class="oa-item-chevron" aria-hidden="true">›</span>
            </div>
        </div>`;
    }).join("");
}

$("wkList").addEventListener("click", e => {
    const item = e.target.closest("[data-i]");
    if (item) openDetail(wkShown[Number(item.dataset.i)]);
});
$("wkList").addEventListener("keydown", e => {
    const item = e.target.closest("[data-i]");
    if (item && e.key === "Enter") openDetail(wkShown[Number(item.dataset.i)]);
});

document.querySelectorAll("[data-wk-tab]").forEach(btn => btn.addEventListener("click", () => {
    wkTab = btn.dataset.wkTab;
    renderChips();
    renderList();
}));
$("wkBranchChips").addEventListener("click", e => {
    const c = e.target.closest("[data-branch]");
    if (!c) return;
    wkBranch = c.dataset.branch;
    renderChips();
    renderList();
});
$("wkTeamChips").addEventListener("click", e => {
    const c = e.target.closest("[data-team]");
    if (!c) return;
    wkTeam = c.dataset.team;
    renderChips();
    renderList();
});
$("wkSearch").addEventListener("input", () => {
    clearTimeout(window.__wkSearch);
    window.__wkSearch = setTimeout(renderList, 200);
});

// ---------- detail ----------
function showScreen(detail) {
    $("wkListScreen").style.display = detail ? "none" : "block";
    $("wkDetailScreen").style.display = detail ? "block" : "none";
    document.body.scrollTo?.(0, 0);
    window.scrollTo(0, 0);
}

function currentValues() {
    return {
        aj: reasonAJ.value,
        ak: reasonAK.value,
        al: reasonAL.value ? `${reasonAL.value}T00:00:00.000Z` : "",
        gps: reasonGPS.value.trim()
    };
}

function isDirty() {
    if (!wkBaseline) return false;
    const now = currentValues();
    return ["aj", "ak", "al", "gps"].some(k => now[k] !== wkBaseline[k]);
}

function siblings(row) {
    return wkRows.filter(r => r.cif && r.cif === row.cif);
}

function setGpsHint(message, kind) {
    const el = $("reasonGpsHint");
    el.textContent = message || "";
    el.className = "reason-gps-hint" + (kind ? " " + kind : "");
}

function updateGpsButtons() {
    $("btnGpsOpen").style.display = ReasonKit.parseGps(reasonGPS.value) ? "" : "none";
}

function updateNav() {
    const i = wkShown.indexOf(wkRow);
    $("wkNavPos").textContent = i >= 0 ? `· ${i + 1} / ${wkShown.length}` : "";
    $("btnWkPrev").disabled = i <= 0;
    $("btnWkNext").disabled = i < 0 || i >= wkShown.length - 1;
}

function infoRow(icon, label, value, wide) {
    if (!String(value ?? "").trim()) return "";
    return `<div class="oa-info-row${wide ? " wk-info-wide" : ""}">
        <span class="oa-info-ico"><span class="ui-ico ui-ico-${icon}" aria-hidden="true"></span></span>
        <div class="oa-info-text">
            <div class="oa-info-label">${escapeHtml(label)}</div>
            <div class="oa-info-value">${escapeHtml(value)}</div>
        </div>
    </div>`;
}

async function openDetail(row) {
    if (!row) return;
    wkRow = row;
    showScreen(true);

    const day = parseInt(row.day, 10);
    const amt = amount(row.arreas);
    $("wkName").textContent = row.customer || "-";
    $("wkSub").innerHTML = `
        <span>${escapeHtml(row.loanNumber || row.concate)} · CIF ${escapeHtml(row.cif)}</span>
        ${Number.isFinite(day) ? `<span class="arr-day-badge">${day.toLocaleString()} <small>${escapeHtml(t("arrears.cardDays"))}</small></span>` : ""}
        ${amt ? `<span class="oa-hero-arrears">Arrears ${escapeHtml(amt)}${row.ccy ? ` ${escapeHtml(row.ccy)}` : ""}</span>` : ""}`;
    $("wkInfo").innerHTML =
        infoRow("pin", t("work.address"), row.location, true) +
        infoRow("phone", t("work.phone"), row.tell) +
        infoRow("idcard", t("work.accountLoan"), row.accountLoan) +
        infoRow("officer", t("work.officer"), row.coResponse) +
        infoRow("package", t("work.product"), [row.product, row.class].filter(Boolean).join(" · "));

    // One reason for every LD of the CIF (only offered when it has several).
    const n = siblings(row).length;
    $("reasonApplyAllWrap").hidden = n < 2;
    $("reasonApplyAllText").textContent = t("arrears.applyAllLd").replace("{n}", n.toLocaleString());

    const pending = ReasonKit.getPending()[row.concate];
    reasonAJ.value = pending ? pending.aj || "" : row.aj || "";
    reasonAK.value = pending ? pending.ak || "" : row.ak || "";
    reasonAL.value = pending ? String(pending.al || "").slice(0, 10) : row.al || "";
    reasonGPS.value = pending ? pending.gps || "" : "";
    setGpsHint("", "");
    $("reasonMeta").textContent = "";
    paintPendingNote(pending);
    updateGpsButtons();
    updateNav();
    wkBaseline = currentValues();

    // The saved record: GPS and who last submitted it (and fresher values
    // when there's no local draft).
    const found = (await ReasonKit.fetchReasons([row.concate], API.getToken())).get(row.concate);
    if (wkRow !== row || !found) return;
    if (found.uploadedBy) {
        $("reasonMeta").textContent = tf("work.lastUpdated", { by: found.uploadedBy, at: found.uploadedAt ? fmtDateTime(found.uploadedAt) : "" });
    }
    if (!pending && !isDirty()) {
        reasonAJ.value = found.aj || "";
        reasonAK.value = found.ak || "";
        reasonAL.value = found.al ? found.al.slice(0, 10) : "";
        reasonGPS.value = found.gps || "";
        updateGpsButtons();
        wkBaseline = currentValues();
    }
}

function paintPendingNote(pending) {
    const note = $("reasonPendingNote");
    note.innerHTML = "";
    note.classList.toggle("show", !!pending);
    if (!pending) return;
    note.append(tf("work.savedLocal", { at: new Date(pending.savedAt).toLocaleString() }) + " ");
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "reason-pending-cancel-link";
    cancel.textContent = t("common.cancel");
    cancel.addEventListener("click", () => discardDraft(wkRow));
    note.appendChild(cancel);
}

// Drops this loan's local draft and goes back to the saved record.
async function discardDraft(row) {
    ReasonKit.removePending([row.concate]);
    const found = (await ReasonKit.fetchReasons([row.concate], API.getToken())).get(row.concate);
    row.aj = found ? found.aj || "" : "";
    row.ak = found ? found.ak || "" : "";
    row.al = found && found.al ? found.al.slice(0, 10) : "";
    row.__pending = false;
    notify(t("work.draftDiscarded"), "success");
    openDetail(row);
}

// Writes the form to the local pending store (and the rows). Returns
// false (and says why) when the form can't be saved as it is.
function saveDraft() {
    const v = currentValues();
    if (v.gps && !ReasonKit.parseGps(v.gps)) {
        notify(t("work.badGps"), "warning");
        reasonGPS.focus();
        return false;
    }
    const targets = $("reasonApplyAll").checked && !$("reasonApplyAllWrap").hidden ? siblings(wkRow) : [wkRow];
    targets.forEach(r => {
        r.aj = v.aj;
        r.ak = v.ak;
        r.al = v.al ? v.al.slice(0, 10) : "";
        r.__pending = true;
        ReasonKit.setPending(r.concate, v.aj, v.ak, v.al, v.gps);
    });
    wkBaseline = currentValues();
    return targets.length;
}

async function submitAll() {
    const map = ReasonKit.getPending();
    const concates = Object.keys(map);
    if (!concates.length) {
        notify(t("work.nothingToSubmit"), "warning");
        return false;
    }
    if (typeof showAppLoading === "function") showAppLoading(tf("work.submitting", { n: concates.length.toLocaleString() }));
    try {
        await ReasonKit.upsertPending(concates, map, API.getToken(), wkUser.fullname || "unknown");
        // Confirm from the server (the VBA's View step), then clear drafts.
        const saved = await ReasonKit.fetchReasons(concates, API.getToken());
        wkRows.forEach(r => {
            const found = saved.get(r.concate);
            if (!found) return;
            r.aj = found.aj || "";
            r.ak = found.ak || "";
            r.al = found.al ? found.al.slice(0, 10) : "";
            r.__pending = false;
        });
        ReasonKit.removePending(concates);
        // Daily Arrears' handed-over copy no longer matches the server;
        // it shows these values until its own reload confirms them.
        try {
            localStorage.setItem(WK_SUBMITTED_KEY, String(Date.now()));
            const recent = JSON.parse(sessionStorage.getItem("cm_work_recent_v1") || "{}");
            saved.forEach((v, concate) => {
                recent[concate] = { aj: v.aj || "", ak: v.ak || "", al: v.al || "", uploadedBy: v.uploadedBy || "", uploadedAt: v.uploadedAt || "" };
            });
            sessionStorage.setItem("cm_work_recent_v1", JSON.stringify(recent));
        } catch (e) {}
        notify(tf("work.submitted", { n: concates.length.toLocaleString() }), "success");
        return true;
    } catch (err) {
        console.error("[work] submit failed:", err);
        notify(err.message || t("work.submitFailed"), "error");
        return false;
    } finally {
        if (typeof hideAppLoading === "function") hideAppLoading();
    }
}

function backToList() {
    wkRow = null;
    wkBaseline = null;
    showScreen(false);
    renderChips();
    renderList();
}

$("btnWkBack").addEventListener("click", () => {
    if (isDirty() && !confirm(t("work.leaveUnsaved"))) return;
    if (wkFocus) return backToArrears();
    backToList();
});

$("btnWkSave").addEventListener("click", () => {
    const n = saveDraft();
    if (!n) return;
    const message = n > 1 ? t("arrears.savedAllLd").replace("{n}", n.toLocaleString()) : t("work.savedToast");
    if (wkFocus) return backToArrears({ message, type: "success" });
    notify(message, "success");
    backToList();
});

$("btnWkSubmit").addEventListener("click", async () => {
    if (isDirty() && !saveDraft()) return;
    const n = ReasonKit.pendingCount();
    if (!(await submitAll())) return;
    if (wkFocus) return backToArrears({ message: tf("work.submitted", { n: n.toLocaleString() }), type: "success" });
    backToList();
});

$("btnWkSubmitAll").addEventListener("click", async () => {
    if (await submitAll()) renderList();
});

// ‹ › — the list as filtered; unsaved edits are asked about, not dropped.
function step(delta) {
    const i = wkShown.indexOf(wkRow);
    const target = wkShown[i + delta];
    if (!target) return;
    if (isDirty()) {
        if (confirm(t("work.keepEdits"))) {
            if (!saveDraft()) return;
        }
    }
    openDetail(target);
}
$("btnWkPrev").addEventListener("click", () => step(-1));
$("btnWkNext").addEventListener("click", () => step(1));

// ---------- fields: templates, suggestions, GPS ----------
ReasonKit.attachTemplates(reasonAJ, reasonAK);
const distinct = field => wkFocus?.suggest?.[field] ||
    [...new Set(wkRows.map(r => String(r[field] || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
ReasonKit.attachSuggestions(reasonAJ, () => distinct("aj"));
ReasonKit.attachSuggestions(reasonAK, () => distinct("ak"));

reasonGPS.addEventListener("input", () => {
    updateGpsButtons();
    const raw = reasonGPS.value.trim();
    if (!raw) return setGpsHint("", "");
    const ok = !!ReasonKit.parseGps(raw);
    setGpsHint(ok ? t("work.gpsOk") : t("work.badGps"), ok ? "ok" : "bad");
});

$("btnGpsHere").addEventListener("click", () => {
    setGpsHint(t("work.gpsLocating"), "");
    ReasonKit.locateHere(
        (lat, lng, acc) => {
            reasonGPS.value = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
            updateGpsButtons();
            setGpsHint(`±${Math.round(acc)}m`, "ok");
        },
        err => setGpsHint(err && err.code === 1 ? t("work.gpsDenied") : t("work.gpsFailed"), "bad")
    );
});

$("btnGpsPick").addEventListener("click", () => {
    ReasonKit.openMapPicker({
        initial: reasonGPS.value,
        notify,
        confirm: (lat, lng) => {
            reasonGPS.value = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
            updateGpsButtons();
            setGpsHint(t("work.gpsFromMap"), "ok");
        }
    });
});

$("btnGpsOpen").addEventListener("click", () => {
    const c = ReasonKit.parseGps(reasonGPS.value);
    if (c) ReasonKit.openInMaps(c.lat, c.lng);
});

ReasonKit.onPendingChange(renderPendingBar);

$("btnWkRefresh").addEventListener("click", () => {
    wkLoad({ fresh: true });
    wkLoadInfo();
});

if (wkFocus) {
    openFocus();
} else {
    wkLoad();
    if (!takeSnapshot()) wkLoadInfo();
}

// ========================================
// COMPONENT LOADER (topbar + bottomnav)
// ========================================
let wkLoaded = 0;
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
                titleKey: "masterdata.hub.work",
                showBack: true,
                showLogo: false,
                showProfile: false
            });
            // Back from a loan goes to the list; from the list, to Master Data.
            const backBtn = document.getElementById("topbarBackBtn");
            if (backBtn) {
                backBtn.onclick = () => {
                    if ($("wkDetailScreen").style.display === "block") return $("btnWkBack").click();
                    // Opened from Daily Arrears' button: go back there.
                    if (/\/pages\/arrears\//.test(document.referrer)) return history.back();
                    location.href = "/CM_Pro/pages/masterdata/index.html";
                };
            }
        }
    } catch (error) {
        console.error(error);
    } finally {
        wkLoaded++;
        if (wkLoaded >= 2) {
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
