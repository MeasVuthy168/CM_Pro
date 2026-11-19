// ========================================
// Master Data > Work to complete — ការងារត្រូវបំពេញ (Reason Arrear)
// The officer's to-do list on its own page: loans with no reason yet,
// expired promises and today's — tap one to fill its reason.
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
// Reason Arrear records (reasons.html) is admin only.
if (wkRole === "admin") document.getElementById("wkGoRecords")?.removeAttribute("hidden");

const wkParams = new URLSearchParams(location.search);
let wkRows = [];
// The tiles (= the tabs): five "not filled yet" — one per reason field
// (layout v2), each with how much of it is filled — then expired /
// promised today.
const UNFILLED_TABS = {
    unOccLoan: "occupationLoan",
    unOccNow: "occupationNow",
    unPurpose: "purpose",
    unReason: "reason",
    unSolution: "solution"
};
const WK_TABS = [...Object.keys(UNFILLED_TABS), "expired", "today"];
const isUnfilledTab = tab => tab in UNFILLED_TABS;
let wkTab = (() => {
    const q = wkParams.get("tab");
    if (q === "unfilled") return "unReason";   // older links (Early Warning)
    return WK_TABS.includes(q) ? q : WK_TABS[0];
})();
let wkBranch = wkParams.get("branch") || "";
// ?q=<loan> (from Early Warning): open on the tab that holds that loan,
// with it searched — straight into its editor when it is the only match.
// Opened as an editor for loans handed over by Daily Arrears or by
// Reason Arrear records (?from=arrears / ?from=records).
const wkFrom = ["arrears", "records"].includes(wkParams.get("from")) ? wkParams.get("from") : "";
let wkQuery = wkFrom ? "" : (wkParams.get("q") || "").trim();
let wkTeam = "";          // "" | "Credit Officer" | "FSRO"
// "officer": the list is the officers (CO / FSRO), tap one for their
// clients; "clients": every client. Managers start by officer; the
// choice is remembered on this device.
const WK_VIEW_KEY = "cm_work_view";
let wkView = (() => {
    if (!wkShowFilters) return "clients";
    try {
        const v = localStorage.getItem(WK_VIEW_KEY);
        if (v === "officer" || v === "clients") return v;
    } catch (e) {}
    return /^viewer_manager_/.test(wkRole) ? "officer" : "clients";
})();
let wkOfficer = "";       // the officer picked in the "officer" view
let wkShown = [];         // the list as currently filtered (also what ‹ › walks)
let wkRow = null;         // the loan open in the detail screen
let wkBaseline = null;    // field values it was opened with (dirty check)
let wkAutoFill = false;   // the purpose was filled from the product, not yet saved
let wkStoredAt = "";      // when the server's record was last submitted ("" = none)
let wkBusy = false;       // a submit is running

const $ = id => document.getElementById(id);
// The five reason fields (layout v2), keyed by their record field.
const partEls = {
    occupationLoan: $("reasonOccLoan"),
    occupationNow: $("reasonOccNow"),
    purpose: $("reasonPurpose"),
    reason: $("reasonReason"),
    solution: $("reasonSolution")
};
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

// Expired = promise date (AL) before today (as the officer reminders).
function isExpired(row) { return !!row.al && row.al < todayKey(); }
function isPartEmpty(row, part) { return String(row[part] || "").trim() === ""; }
function inTab(row, tab) {
    if (isUnfilledTab(tab)) return isPartEmpty(row, UNFILLED_TABS[tab]);
    if (tab === "expired") return isExpired(row);
    return row.al === todayKey();   // "today"
}

// Local drafts (saved, not yet submitted) win over the server values.
function applyPending(rows) {
    const map = ReasonKit.getPending();
    rows.forEach(row => {
        // Rows handed over by Daily Arrears carry only the combined text.
        if (!ReasonKit.PARTS.every(k => typeof row[k] === "string")) Object.assign(row, ReasonKit.partsOf(row));
        const p = map[row.concate];
        row.__pending = !!p;
        if (!p) return;
        setRowReason(row, p);
        row.al = p.al ? String(p.al).slice(0, 10) : "";
    });
}

// A row's reason from a record / draft / the form: the five parts, and
// the combined aj / ak the list shows (the record's own when it has
// them, else put together from the parts).
function setRowReason(row, src) {
    const p = ReasonKit.partsOf(src);
    Object.assign(row, p);
    row.aj = typeof src?.aj === "string" ? src.aj : ReasonKit.composeOccupation(p.occupationLoan, p.occupationNow);
    row.ak = typeof src?.ak === "string" ? src.ak : ReasonKit.composeReason(p.reason, p.solution);
}

function fillParts(src) {
    const p = ReasonKit.partsOf(src);
    ReasonKit.PARTS.forEach(k => { partEls[k].value = p[k]; });
    // A blank purpose takes the product's (ReasonKit.purposeForProduct),
    // as the server fills saved ones.
    wkAutoFill = false;
    if (!partEls.purpose.value.trim() && wkRow) {
        partEls.purpose.value = ReasonKit.purposeForProduct(wkRow.product);
        wkAutoFill = !!partEls.purpose.value;
    }
}

// ---------- the editor's state (19/11/2026) ----------
// Save / Submit follow what is on screen: Save only while there are
// changes, "✓ Saved" once a draft is stored; Submit only when the five
// fields are filled; once submitted the yellow button becomes "Next
// client ›". A chip by the name tells the loan's stage.
const WK_REVIEW_KEY = "cm_work_review_v1";   // loans whose submit waits for admin
function reviewSet() {
    try { return new Set(JSON.parse(sessionStorage.getItem(WK_REVIEW_KEY) || "[]")); } catch (e) { return new Set(); }
}
function markReview(concates) {
    try {
        const set = reviewSet();
        (concates || []).forEach(c => set.add(c));
        sessionStorage.setItem(WK_REVIEW_KEY, JSON.stringify([...set]));
    } catch (e) {}
}
// A field holds an answer: not empty, not only "." / "-" and the like.
const hasAnswer = v => /[\p{L}\p{N}]/u.test(String(v || ""));
function requiredMissing(values) {
    return ReasonKit.PARTS.filter(k => !hasAnswer(values[k]));
}
const PART_LABEL = {
    occupationLoan: "arrears.reasonOccLoanLabel", occupationNow: "arrears.reasonOccNowLabel",
    purpose: "arrears.reasonPurposeLabel", reason: "arrears.reasonReasonLabel", solution: "arrears.reasonSolutionOnlyLabel"
};
function nextRow() {
    const i = wkShown.indexOf(wkRow);
    return i >= 0 ? wkShown[i + 1] || null : null;
}

function refreshActions() {
    if (!wkRow) return;
    const save = $("btnWkSave"), submit = $("btnWkSubmit");
    const pending = !!ReasonKit.getPending()[wkRow.concate];
    const changed = isDirty() || wkAutoFill;
    const missing = requiredMissing(currentValues());
    const toSubmit = changed || pending;
    // Save
    save.disabled = wkBusy || !changed;
    save.textContent = !changed && pending ? `✓ ${t("work.savedState")}` : t("common.save");
    save.classList.toggle("wk-done", !changed && pending);
    // Submit / Next
    submit.dataset.mode = "submit";
    submit.classList.remove("wk-done");
    if (wkBusy) {
        submit.disabled = true;
        submit.textContent = t("work.submittingShort");
    } else if (toSubmit) {
        submit.disabled = missing.length > 0;
        submit.textContent = t("work.submit");
    } else if (wkStoredAt) {
        const next = nextRow();
        submit.dataset.mode = next ? "next" : "done";
        submit.disabled = !next;
        submit.textContent = next ? `${t("work.nextClient")} ›` : `✓ ${t("work.submittedState")}`;
        submit.classList.toggle("wk-done", !next);
    } else {
        submit.disabled = true;
        submit.textContent = t("work.submit");
    }
    // Required fields: marked only while there is something to submit.
    const showMissing = toSubmit && missing.length > 0;
    ReasonKit.PARTS.forEach(k => partEls[k].classList.toggle("wk-missing", showMissing && missing.includes(k)));
    const hint = $("wkRequiredHint");
    if (hint) {
        hint.hidden = !showMissing;
        hint.textContent = showMissing ? tf("work.requiredHint", { fields: missing.map(k => t(PART_LABEL[k])).join(", ") }) : "";
    }
    paintStatus(changed, pending);
}

function paintStatus(changed, pending) {
    let el = $("wkStatusChip");
    if (!el) {
        el = document.createElement("div");
        el.id = "wkStatusChip";
        $("wkSub").after(el);
    }
    let cls = "", text = "";
    if (changed) { cls = "unsaved"; text = t("work.stUnsaved"); }
    else if (pending) { cls = "draft"; text = t("work.stDraft"); }
    else if (reviewSet().has(wkRow.concate)) { cls = "review"; text = t("work.stReview"); }
    else if (wkStoredAt) { cls = "done"; text = tf("work.stSubmitted", { at: fmtDateTime(wkStoredAt) }); }
    else { cls = "empty"; text = t("work.stEmpty"); }
    el.className = `wk-status-chip wk-st-${cls}`;
    el.textContent = text;
}

// Leaving with unsaved changes: Save and go / Discard / Stay.
// Resolves "save" | "discard" | "stay".
function askLeave() {
    return new Promise(resolve => {
        const wrap = document.createElement("div");
        wrap.className = "wk-leave-backdrop";
        wrap.innerHTML = `<div class="wk-leave-box" role="dialog" aria-modal="true">
            <div class="wk-leave-title">${escapeHtml(t("work.leaveTitle"))}</div>
            <div class="wk-leave-text">${escapeHtml(t("work.leaveText"))}</div>
            <div class="wk-leave-btns">
              <button type="button" data-a="save" class="wk-leave-save">${escapeHtml(t("work.leaveSave"))}</button>
              <button type="button" data-a="discard" class="wk-leave-discard">${escapeHtml(t("work.leaveDiscard"))}</button>
              <button type="button" data-a="stay" class="wk-leave-stay">${escapeHtml(t("work.leaveStay"))}</button>
            </div></div>`;
        const done = a => { wrap.remove(); document.removeEventListener("keydown", onKey); resolve(a); };
        const onKey = e => { if (e.key === "Escape") done("stay"); };
        wrap.addEventListener("click", e => {
            const b = e.target.closest("[data-a]");
            if (b) done(b.dataset.a); else if (e.target === wrap) done("stay");
        });
        document.addEventListener("keydown", onKey);
        document.body.appendChild(wrap);
        wrap.querySelector(".wk-leave-save").focus();
    });
}
// true when it is fine to leave this client (saved first if asked).
async function okToLeave() {
    if (!wkRow || !isDirty()) return true;
    const a = await askLeave();
    if (a === "stay") return false;
    if (a === "save") return !!saveDraft();
    return true;
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
    let only = null;
    if (wkQuery) {
        const q = wkQuery.toLowerCase();
        const hits = wkRows.filter(r => String(r.loanNumber || "").toLowerCase() === q);
        const tab = WK_TABS.find(tb => hits.some(r => inTab(r, tb)));
        if (tab) wkTab = tab;
        wkView = "clients";
        $("wkSearch").value = wkQuery;
        if (hits.length === 1) only = hits[0];
        wkQuery = "";
    }
    renderChips();
    renderList();
    if (only) openDetail(only);
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
    if (!wkFrom) return null;
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
        label.dataset.i18n = wkFrom === "records" ? "rr.pageTitle" : "dashboard.dailyArrears";
        label.textContent = t(label.dataset.i18n);
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
    // Handed over by Reason Arrear records: back there (it reloads).
    if (wkFrom === "records") {
        try { if (flash) sessionStorage.setItem("cm_records_flash_v1", JSON.stringify({ at: Date.now(), ...flash })); } catch (e) {}
        if (/\/pages\/masterdata\/reasons\.html/.test(document.referrer) && history.length > 1) history.back();
        else cmNav.back("/CM_Pro/pages/masterdata/reasons.html");
        return;
    }
    try {
        sessionStorage.setItem("cm_arrears_back_v1", String(Date.now()));
        if (flash) sessionStorage.setItem("cm_work_flash_v1", JSON.stringify({ at: Date.now(), ...flash }));
    } catch (e) {}
    if (/\/pages\/arrears\//.test(document.referrer) && history.length > 1) history.back();
    else cmNav.back("/CM_Pro/pages/arrears/index.html");
}

// ---------- list ----------
function scopedRows() {
    return wkRows.filter(r => (!wkBranch || r.branch === wkBranch) && (!wkTeam || teamOf(r) === wkTeam) &&
        (!wkOfficer || (r.coResponse || "-") === wkOfficer));
}

function teamLabel(team) {
    return team === "FSRO" ? "FSRO" : "CO";
}

function renderViewBar() {
    const bar = $("wkViewBar");
    const officerBar = $("wkOfficerBar");
    if (!wkShowFilters) {
        bar.hidden = true;
        officerBar.hidden = true;
        return;
    }
    bar.hidden = false;
    const seg = (v, icon, key) => `<button type="button" class="${wkView === v ? "on" : ""}" data-wk-view="${v}" title="${escapeHtml(t(key))}" aria-label="${escapeHtml(t(key))}"><span class="ui-ico ui-ico-${icon}" aria-hidden="true"></span></button>`;
    bar.innerHTML = `
        <div class="wk-viewseg" role="group" aria-label="${escapeHtml(t("work.viewAria"))}">
            ${seg("officer", "officer", "work.viewOfficer")}${seg("clients", "users", "work.viewClients")}
        </div>`;
    officerBar.hidden = !wkOfficer;
    officerBar.innerHTML = wkOfficer ? `<button type="button" class="wk-officer-chip" data-wk-officer-clear>
            <span class="ui-ico ui-ico-officer" aria-hidden="true"></span>${escapeHtml(wkOfficer)}<span class="wk-officer-x" aria-label="${escapeHtml(t("common.close"))}">✕</span>
        </button>` : "";
}

// The officers in the current branch / team / tab, most loans first.
function renderOfficers(list, scoped, q) {
    const map = new Map();
    scoped.filter(r => inTab(r, wkTab)).forEach(r => {
        const k = r.coResponse || "-";
        const o = map.get(k) || { name: k, team: teamOf(r), branch: r.branch || "", n: 0, maxDay: 0 };
        o.n++;
        o.maxDay = Math.max(o.maxDay, parseInt(r.day, 10) || 0);
        map.set(k, o);
    });
    const officers = [...map.values()]
        .filter(o => !q || o.name.toLowerCase().includes(q))
        .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
    $("wkSubtitle").textContent = tf("work.subtitleOfficers", {
        n: officers.length.toLocaleString(),
        tab: t(`work.tab${wkTab[0].toUpperCase()}${wkTab.slice(1)}`)
    });
    wkShown = [];
    if (!officers.length) {
        list.innerHTML = `<div class="oa-empty oa-empty-art">
            <span class="oa-empty-ico"><span class="ui-ico ui-ico-clipboard" aria-hidden="true"></span></span>
            <strong>${escapeHtml(t((isUnfilledTab(wkTab) || wkTab === "expired") && !q ? "work.emptyDone" : "arrears.oaEmpty"))}</strong>
        </div>`;
        return;
    }
    const multiBranch = new Set(officers.map(o => o.branch)).size > 1;
    list.innerHTML = officers.map(o => `
        <div class="oa-item wk-officer" role="button" tabindex="0" data-officer="${escapeHtml(o.name)}">
            <span class="wk-officer-ico"><span class="ui-ico ui-ico-officer" aria-hidden="true"></span></span>
            <div class="oa-item-main">
                <div class="oa-item-name">${escapeHtml(o.name)} <span class="wk-team wk-team-${o.team === "FSRO" ? "fsro" : "co"}">${teamLabel(o.team)}</span></div>
                ${multiBranch && o.branch ? `<div class="oa-item-sub">${escapeHtml(o.branch)}</div>` : ""}
            </div>
            <div class="oa-item-side">
                <span class="wk-officer-n wk-officer-n-${isUnfilledTab(wkTab) ? "unfilled" : wkTab}">${o.n.toLocaleString()} <small>LD</small></span>
                <span class="oa-item-chevron" aria-hidden="true">›</span>
            </div>
        </div>`).join("");
}

function pickOfficer(name) {
    wkOfficer = name;
    $("wkSearch").value = "";
    renderList();
    window.scrollTo(0, 0);
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
    // All | CO | FSRO with this tab's counts at this branch (like the chat).
    const inBranch = wkRows.filter(r => (!wkBranch || r.branch === wkBranch) && inTab(r, wkTab));
    const nTeam = team => inBranch.filter(r => !team || teamOf(r) === team).length;
    const seg = (team, label) => `<button type="button" class="${wkTeam === team ? "on" : ""}" data-team="${team}">${escapeHtml(label)} <small>${nTeam(team).toLocaleString()}</small></button>`;
    teamWrap.innerHTML = `<div class="wk-viewseg wk-teamseg" role="group" aria-label="CO / FSRO">${seg("", t("arrears.optionAll"))}${seg("Credit Officer", "CO")}${seg("FSRO", "FSRO")}</div>`;
}

// The tiles (= the tabs): counts for the branch / team / officer, and
// how many loans that is out of (the field tiles' "% filled").
function workCounts(scoped) {
    const c = { total: scoped.length };
    WK_TABS.forEach(tab => { c[tab] = scoped.filter(r => inTab(r, tab)).length; });
    return c;
}

// The share of the loans here with this field filled (null: no loans).
function filledPct(c, tab) {
    return c.total ? Math.floor((c.total - c[tab]) / c.total * 100) : null;
}

function renderStats(scoped) {
    const c = workCounts(scoped);
    WK_TABS.forEach(tab => {
        $(`wkCount-${tab}`).textContent = c[tab].toLocaleString();
    });
    // Total once, in the hero; each field tile: a bar of how much of it
    // is filled (red < 50%, yellow to 90%, green above).
    $("wkTotal").textContent = tf("work.totalLd", { n: c.total.toLocaleString() });
    Object.keys(UNFILLED_TABS).forEach(tab => {
        const pct = filledPct(c, tab);
        const bar = $(`wkBar-${tab}`);
        bar.style.width = `${pct ?? 0}%`;
        bar.className = "wk-tile-fill" + (pct == null ? "" : pct < 50 ? " low" : pct <= 90 ? " mid" : " high");
        $(`wkPct-${tab}`).textContent = pct == null ? "" : tf("work.pctFilled", { p: pct });
    });
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
    renderViewBar();

    const q = $("wkSearch").value.trim().toLowerCase();
    if (wkView === "officer" && !wkOfficer && wkShowFilters) return renderOfficers($("wkList"), scoped, q);
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
        const done = (isUnfilledTab(wkTab) || wkTab === "expired") && !q;
        list.innerHTML = `<div class="oa-empty oa-empty-art">
            <span class="oa-empty-ico"><span class="ui-ico ui-ico-clipboard" aria-hidden="true"></span></span>
            <strong>${escapeHtml(t(done ? "work.emptyDone" : "arrears.oaEmpty"))}</strong>
        </div>`;
        return;
    }
    // How many LDs each customer (CIF) has in the work list — "1 LD", "2 LD"…
    const ldPerCif = new Map();
    wkRows.forEach(x => { if (x.cif) ldPerCif.set(x.cif, (ldPerCif.get(x.cif) || 0) + 1); });
    list.innerHTML = shown.map((r, i) => {
        const day = parseInt(r.day, 10);
        const nLd = ldPerCif.get(r.cif) || 1;
        const amt = amount(r.arreas);
        const status = isExpired(r)
            ? `<span class="wk-chip wk-chip-expired">${escapeHtml(tf("work.expiredOn", { d: isoToDMY(r.al) }))}</span>`
            : r.al ? `<span class="wk-chip">${escapeHtml(tf("work.promiseOn", { d: isoToDMY(r.al) }))}</span>` : "";
        return `<div class="oa-item${r.__pending ? " wk-item-pending" : ""}" role="button" tabindex="0" data-i="${i}">
            <div class="oa-item-main">
                <div class="oa-item-name">${escapeHtml(r.customer || "-")} <span class="wk-ld-count${nLd > 1 ? " multi" : ""}">${nLd.toLocaleString()} LD</span></div>
                <div class="oa-item-sub">${escapeHtml(r.loanNumber || r.concate)} · CIF ${escapeHtml(r.cif)}</div>
                ${r.location ? `<div class="oa-item-addr"><span class="ui-ico ui-ico-pin" aria-hidden="true"></span> ${escapeHtml(r.location)}</div>` : ""}
                <div class="oa-item-meta">
                    ${wkShowFilters && r.coResponse ? `<span><span class="ui-ico ui-ico-officer" aria-hidden="true"></span> ${escapeHtml(r.coResponse)}</span>` : ""}
                    ${amt ? `<span class="oa-item-amt">${escapeHtml(amt)}${r.ccy ? ` ${escapeHtml(r.ccy)}` : ""}</span>` : ""}
                    ${status}
                    ${r.__pending ? `<span class="wk-chip wk-chip-pending">${escapeHtml(t("work.notSubmitted"))}</span>` : ""}
                </div>
            </div>
            <div class="oa-item-side">
                ${Number.isFinite(day) ? `<span class="arr-day-badge">${day.toLocaleString()} <small>${escapeHtml(t("arrears.cardDays"))}</small></span>` : ""}
                <span class="oa-item-chevron" aria-hidden="true">›</span>
            </div>
        </div>`;
    }).join("");
}

$("wkList").addEventListener("click", e => {
    const off = e.target.closest("[data-officer]");
    if (off) return pickOfficer(off.dataset.officer);
    const item = e.target.closest("[data-i]");
    if (item) openDetail(wkShown[Number(item.dataset.i)]);
});
$("wkList").addEventListener("keydown", e => {
    if (e.key !== "Enter") return;
    const off = e.target.closest("[data-officer]");
    if (off) return pickOfficer(off.dataset.officer);
    const item = e.target.closest("[data-i]");
    if (item) openDetail(wkShown[Number(item.dataset.i)]);
});
$("wkOfficerBar").addEventListener("click", e => {
    if (!e.target.closest("[data-wk-officer-clear]")) return;
    wkOfficer = "";
    renderList();
});
$("wkViewBar").addEventListener("click", e => {
    const v = e.target.closest("[data-wk-view]");
    if (!v) return;
    wkView = v.dataset.wkView;
    wkOfficer = "";
    try { localStorage.setItem(WK_VIEW_KEY, wkView); } catch (e2) {}
    renderList();
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
    wkOfficer = "";
    renderChips();
    renderList();
});
$("wkTeamChips").addEventListener("click", e => {
    const c = e.target.closest("[data-team]");
    if (!c) return;
    wkTeam = c.dataset.team;
    wkOfficer = "";
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
    const parts = {};
    ReasonKit.PARTS.forEach(k => { parts[k] = partEls[k].value.trim(); });
    return {
        ...parts,
        al: reasonAL.value ? `${reasonAL.value}T00:00:00.000Z` : "",
        gps: tidyGps(reasonGPS.value)
    };
}

// A valid location written as "lat, lng" (else as typed): coordinates
// keep their own digits; a Plus Code or a Maps link becomes its
// coordinates (6 decimals, ~0.1 m).
function tidyGps(text) {
    const v = String(text || "").trim();
    const g = ReasonKit.parseGps(v);
    if (!g) return v;
    if (g.kind === "coords") return v.replace(/^[(\[]\s*|\s*[)\]]$/g, "").split(/\s*(?:[,;/，]\s*|\s+)/).join(", ");
    return `${g.lat.toFixed(6)}, ${g.lng.toFixed(6)}`;
}

function isDirty() {
    if (!wkBaseline) return false;
    const now = currentValues();
    return [...ReasonKit.PARTS, "al", "gps"].some(k => now[k] !== wkBaseline[k]);
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
    // Runs after every row load, so the date's × follows loaded values.
    syncDateClear();
}

// A date input has no :placeholder-shown, so its × is toggled here.
function syncDateClear() {
    const wrap = reasonAL.parentElement;
    if (wrap && wrap.classList.contains("wk-clear-wrap")) wrap.classList.toggle("wk-empty", !reasonAL.value);
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

// Loan class colour, same scale as Daily Arrears (Normal green through
// Loss dark red).
function classChipCss(value) {
    const v = String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "");
    return { normal: "wk-class-normal", specialmention: "wk-class-sm", substandard: "wk-class-ss",
        doubtful: "wk-class-doubtful", loss: "wk-class-loss" }[v] || "";
}

// The loan's summary at the top of the editor.
function paintSummary(row) {
    const day = parseInt(row.day, 10);
    const amt = amount(row.arreas);
    const recStatus = row.recStatus === "current" ? "rr.cardCurrent" : row.recStatus === "closed" ? "rr.cardClosed" : "";
    $("wkName").textContent = row.customer || "-";
    $("wkSub").innerHTML = `
        <span>${escapeHtml(row.loanNumber || row.concate)} · CIF ${escapeHtml(row.cif)}</span>
        ${Number.isFinite(day) ? `<span class="arr-day-badge">${day.toLocaleString()} <small>${escapeHtml(t("arrears.cardDays"))}</small></span>` : ""}
        ${recStatus ? `<span class="wk-rec-chip wk-rec-${row.recStatus}">${escapeHtml(t(recStatus))}</span>` : ""}
        ${row.class ? `<span class="wk-class-chip ${classChipCss(row.class)}">${escapeHtml(row.class)}</span>` : ""}
        ${amt ? `<span class="oa-hero-arrears">Arrears ${escapeHtml(amt)}${row.ccy ? ` ${escapeHtml(row.ccy)}` : ""}</span>` : ""}`;
    $("wkInfo").innerHTML =
        infoRow("pin", t("work.address"), row.location, true) +
        infoRow("phone", t("work.phone"), row.tell) +
        infoRow("idcard", t("work.accountLoan"), row.accountLoan) +
        infoRow("officer", t("work.officer"), row.coResponse) +
        infoRow("package", t("work.product"), row.product) +
        // e.g. "Gov - គ្រូបង្រៀន"
        infoRow("users", t("work.occuMinistry"), [row.occu, row.ministry].map(v => String(v || "").trim()).filter(v => v && v !== "-").join(" - "), true);
}

// Handed over by Reason Arrear records: a loan no longer on the arrears
// sheet carries no summary, so read its address / phone / product from OS once.
async function loadRecordDetail(row) {
    if (row.recStatus !== "current" || row.__detail) return;
    row.__detail = true;
    try {
        const res = await fetch(`${API.BASE_URL}/api/reasonarrear/records/detail?cif=${encodeURIComponent(row.concate)}`, {
            headers: { Authorization: `Bearer ${API.getToken()}` }
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.message || `HTTP ${res.status}`);
        if (!data.detail) return;
        if (!row.location) row.location = data.detail.location || "";
        if (!row.tell) row.tell = data.detail.tell || "";
        if (!row.product) row.product = data.detail.product || "";
        if (wkRow === row) paintSummary(row);
    } catch (err) {
        row.__detail = false;   // try again next time it is opened
    }
}

async function openDetail(row) {
    if (!row) return;
    wkRow = row;
    showScreen(true);

    paintSummary(row);
    if (wkFrom === "records") loadRecordDetail(row);

    // One reason for every LD of the CIF (only offered when it has several).
    const n = siblings(row).length;
    $("reasonApplyAllWrap").hidden = n < 2;
    $("reasonApplyAllText").textContent = t("arrears.applyAllLd").replace("{n}", n.toLocaleString());

    const pending = ReasonKit.getPending()[row.concate];
    fillParts(pending || row);
    reasonAL.value = pending ? String(pending.al || "").slice(0, 10) : row.al || "";
    reasonGPS.value = pending ? pending.gps || "" : "";
    setGpsHint("", "");
    $("reasonMeta").textContent = "";
    paintPendingNote(pending);
    updateGpsButtons();
    updateNav();
    wkBaseline = currentValues();
    wkStoredAt = "";
    refreshActions();

    // The saved record: GPS and who last submitted it (and fresher values
    // when there's no local draft).
    const found = (await ReasonKit.fetchReasons([row.concate], API.getToken())).get(row.concate);
    if (wkRow !== row || !found) return;
    wkStoredAt = found.uploadedAt || (found.uploadedBy ? "-" : "");
    if (found.uploadedBy) {
        $("reasonMeta").textContent = tf("work.lastUpdated", { by: found.uploadedBy, at: found.uploadedAt ? fmtDateTime(found.uploadedAt) : "" });
    }
    if (!pending && !isDirty()) {
        fillParts(found);
        reasonAL.value = found.al ? found.al.slice(0, 10) : "";
        reasonGPS.value = found.gps || "";
        updateGpsButtons();
        wkBaseline = currentValues();
    }
    refreshActions();
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
    setRowReason(row, found || {});
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
        setRowReason(r, v);
        r.al = v.al ? v.al.slice(0, 10) : "";
        r.__pending = true;
        ReasonKit.setPending(r.concate, v, v.al, v.gps);
    });
    wkBaseline = currentValues();
    wkAutoFill = false;
    return targets.length;
}

async function submitAll() {
    const map = ReasonKit.getPending();
    const concates = Object.keys(map);
    if (!concates.length) {
        notify(t("work.nothingToSubmit"), "warning");
        return false;
    }
    // Every draft sent needs its five fields (required, 19/11/2026).
    const incomplete = concates.filter(c => requiredMissing(ReasonKit.partsOf(map[c])).length);
    if (incomplete.length) {
        notify(tf("work.draftsIncomplete", { n: incomplete.length.toLocaleString() }), "warning");
        return false;
    }
    if (typeof showAppLoading === "function") showAppLoading(tf("work.submitting", { n: concates.length.toLocaleString() }));
    try {
        const review = await ReasonKit.upsertPending(concates, map, API.getToken(), wkUser.fullname || "unknown");
        markReview(review && review.pending);
        // Confirm from the server (the VBA's View step), then clear drafts.
        const saved = await ReasonKit.fetchReasons(concates, API.getToken());
        wkRows.forEach(r => {
            const found = saved.get(r.concate);
            if (!found) return;
            setRowReason(r, found);
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
        const note = ReasonKit.reviewNote(review);
        if (note) setTimeout(() => notify(note, "warning"), 600);
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

$("btnWkBack").addEventListener("click", async () => {
    if (!(await okToLeave())) return;
    if (wkFocus) return backToArrears();
    backToList();
});

// Save and Submit keep the editor open on this client (‹ › for the next
// one, Back to leave); the lists behind it pick the changes up on return.
$("btnWkSave").addEventListener("click", () => {
    const n = saveDraft();
    if (!n) return;
    const message = n > 1 ? t("arrears.savedAllLd").replace("{n}", n.toLocaleString()) : t("work.savedToast");
    notify(message, "success");
    paintPendingNote(ReasonKit.getPending()[wkRow.concate]);
    updateNav();
    refreshActions();
});

$("btnWkSubmit").addEventListener("click", async () => {
    const btn = $("btnWkSubmit");
    if (wkBusy || btn.disabled) return;
    // Once submitted, the yellow button moves on to the next client.
    if (btn.dataset.mode === "next") return step(1);
    if (requiredMissing(currentValues()).length) return refreshActions();
    if ((isDirty() || wkAutoFill) && !saveDraft()) return;
    wkBusy = true; refreshActions();
    let ok = false;
    try { ok = await submitAll(); } finally { wkBusy = false; }
    if (!ok) return refreshActions();
    // Show what the server now holds (and who saved it).
    openDetail(wkRow);
});

$("btnWkSubmitAll").addEventListener("click", async () => {
    if (await submitAll()) renderList();
});

// ‹ › — the list as filtered; unsaved edits are asked about, not dropped.
async function step(delta) {
    const i = wkShown.indexOf(wkRow);
    const target = wkShown[i + delta];
    if (!target) return;
    if (!(await okToLeave())) return;
    openDetail(target);
}
$("btnWkPrev").addEventListener("click", () => step(-1));
$("btnWkNext").addEventListener("click", () => step(1));

// ---------- fields: suggestions, GPS ----------
// Previously used answers per field: from the rows here, plus (opened
// from Daily Arrears) the combined answers it handed over, split.
let suggestCache = {};
let suggestFor = null;   // the wkRows the cache was built from
function distinct(part) {
    if (suggestFor !== wkRows) { suggestCache = {}; suggestFor = wkRows; }
    if (suggestCache[part]) return suggestCache[part];
    const seen = new Set();
    const add = v => { v = String(v || "").trim(); if (v) seen.add(v); };
    wkRows.forEach(r => add(ReasonKit.partsOf(r)[part]));
    (wkFocus?.suggest?.aj || []).forEach(x => add(ReasonKit.partsOf({ aj: x })[part]));
    (wkFocus?.suggest?.ak || []).forEach(x => add(ReasonKit.partsOf({ ak: x })[part]));
    return (suggestCache[part] = [...seen].sort((a, b) => a.localeCompare(b)));
}
ReasonKit.PARTS.forEach(k => ReasonKit.attachSuggestions(partEls[k], () => distinct(k)));

// A × inside the right of Occupation, Reason / Solution, Promised
// Payment Date and GPS that empties the field. CSS hides it while the
// field is empty (:placeholder-shown; the date via syncDateClear), so it
// follows values set in code too.
[...Object.values(partEls), reasonAL, reasonGPS].forEach(field => {
    const wrap = document.createElement("div");
    wrap.className = "wk-clear-wrap";
    field.before(wrap);
    wrap.appendChild(field);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "wk-clear";
    btn.innerHTML = "×";
    const label = () => { btn.setAttribute("aria-label", t("work.clear")); btn.title = t("work.clear"); };
    label();
    window.addEventListener("cm-language-changed", label);
    // mousedown keeps the field's focus from moving first (its blur
    // handlers would run before the clear).
    btn.addEventListener("mousedown", e => e.preventDefault());
    btn.addEventListener("click", () => {
        field.value = "";
        field.dispatchEvent(new Event("input", { bubbles: true }));
        field.dispatchEvent(new Event("change", { bubbles: true }));
    });
    wrap.appendChild(btn);
});
// Every edit re-checks Save / Submit, the required marks and the chip.
["input", "change"].forEach(ev => $("wkDetailScreen").addEventListener(ev, () => { if (wkRow) refreshActions(); }));
reasonAL.addEventListener("input", syncDateClear);
reasonAL.addEventListener("change", syncDateClear);
syncDateClear();

// iOS's number pad (inputmode="decimal") has no "," or space, so a ","
// key sits inside the field; on leaving it, "lat lng" / "lat;lng" is
// written back as "lat, lng".
(() => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "wk-gps-comma";
    btn.textContent = ",";
    const label = () => { btn.setAttribute("aria-label", t("work.gpsComma")); btn.title = t("work.gpsComma"); };
    label();
    window.addEventListener("cm-language-changed", label);
    btn.addEventListener("mousedown", e => e.preventDefault());   // keep the keyboard up
    btn.addEventListener("click", () => {
        const v = reasonGPS.value;
        const at = reasonGPS.selectionStart ?? v.length, end = reasonGPS.selectionEnd ?? at;
        const before = v.slice(0, at).replace(/[\s,]+$/, ""), after = v.slice(end).replace(/^[\s,]+/, "");
        reasonGPS.value = `${before}, ${after}`;
        const pos = before.length + 2;
        reasonGPS.focus();
        try { reasonGPS.setSelectionRange(pos, pos); } catch (e) {}
        reasonGPS.dispatchEvent(new Event("input", { bubbles: true }));
    });
    reasonGPS.parentElement.appendChild(btn);
    reasonGPS.parentElement.classList.add("wk-gps-wrap");
    // Paste: what was copied in Google Maps (Plus Code, coordinates or a
    // link) goes straight in, written as "lat, lng".
    const paste = document.createElement("button");
    paste.type = "button";
    paste.id = "btnGpsPaste";
    paste.className = "reason-gps-btn";
    const pasteLabel = () => { paste.innerHTML = `<span class="ui-ico ui-ico-copy" aria-hidden="true"></span> <span>${escapeHtml(t("work.gpsPaste"))}</span>`; };
    pasteLabel();
    window.addEventListener("cm-language-changed", pasteLabel);
    paste.addEventListener("click", async () => {
        let text = "";
        try { text = await navigator.clipboard.readText(); } catch (e) { text = ""; }
        if (!String(text || "").trim()) return notify(t("work.gpsPasteHow"), "info");
        reasonGPS.value = String(text).trim();
        reasonGPS.dispatchEvent(new Event("input", { bubbles: true }));
        const tidy = tidyGps(reasonGPS.value);
        if (ReasonKit.parseGps(tidy)) {
            const hint = $("reasonGpsHint").textContent, cls = $("reasonGpsHint").className;
            reasonGPS.value = tidy;
            reasonGPS.dispatchEvent(new Event("input", { bubbles: true }));
            $("reasonGpsHint").textContent = hint; $("reasonGpsHint").className = cls;   // keep "Plus Code … →"
        }
    });
    document.querySelector(".reason-gps-row")?.appendChild(paste);
    reasonGPS.addEventListener("blur", () => {
        const tidy = tidyGps(reasonGPS.value);
        if (ReasonKit.parseGps(tidy) && tidy !== reasonGPS.value) {
            const hint = $("reasonGpsHint").textContent, cls = $("reasonGpsHint").className;
            reasonGPS.value = tidy;
            reasonGPS.dispatchEvent(new Event("input", { bubbles: true }));
            $("reasonGpsHint").textContent = hint; $("reasonGpsHint").className = cls;   // keep "Plus Code … →"
        }
    });
})();

reasonGPS.addEventListener("input", () => {
    updateGpsButtons();
    const raw = reasonGPS.value.trim();
    if (!raw) return setGpsHint("", "");
    const g = ReasonKit.parseGps(raw);
    if (!g) {
        // A short share link (maps.app.goo.gl …) carries no coordinates.
        return setGpsHint(/goo\.gl|maps\.app|g\.co\//i.test(raw) ? t("work.gpsShortLink") : t("work.badGps"), "bad");
    }
    const ll = `${g.lat.toFixed(6)}, ${g.lng.toFixed(6)}`;
    setGpsHint(g.kind === "plus" ? tf("work.gpsFromPlus", { code: g.code, ll })
        : g.kind === "url" ? tf("work.gpsFromLink", { ll })
        : g.kind === "deg" ? tf("work.gpsFromDeg", { ll }) : t("work.gpsOk"), "ok");
});

$("btnGpsHere").addEventListener("click", () => {
    setGpsHint(t("work.gpsLocating"), "");
    ReasonKit.locateHere(
        (lat, lng, acc) => {
            reasonGPS.value = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
            updateGpsButtons();
            refreshActions();
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
            refreshActions();
            setGpsHint(t("work.gpsFromMap"), "ok");
        }
    });
});

$("btnGpsOpen").addEventListener("click", () => {
    const c = ReasonKit.parseGps(reasonGPS.value);
    if (c) ReasonKit.openInMaps(c.lat, c.lng);
});

ReasonKit.onPendingChange(renderPendingBar);

// ---------- copy report (Telegram) ----------
// Field labels in the report: full in the summary, short per officer /
// client.
const FIELD_LABEL = {
    occupationLoan: "arrears.reasonOccLoanLabel",
    occupationNow: "arrears.reasonOccNowLabel",
    purpose: "work.tilePurpose",
    reason: "arrears.reasonReasonLabel",
    solution: "arrears.reasonSolutionOnlyLabel"
};
const pctDot = pct => (pct == null ? "⚪" : pct < 50 ? "🔴" : pct <= 90 ? "🟡" : "🟢");
const missingParts = row => ReasonKit.PARTS.filter(k => isPartEmpty(row, k));

// What's on screen as plain text, for Telegram: the summary (fields worst
// first, coloured like the tiles' bars), then one block per officer (the
// by-officer view) or per client — each listed once, with only what's
// still missing. "▪️" rather than "1." so Telegram keeps the layout.
function buildReport() {
    const scoped = scopedRows();
    const c = workCounts(scoped);
    const d = isoToDMY(todayKey());
    const where = [wkBranch || (wkShowFilters ? t("work.allBranches") : ""), wkTeam ? teamLabel(wkTeam) : "", wkOfficer].filter(Boolean).join(" · ");
    const fields = Object.entries(UNFILLED_TABS)
        .map(([tab, part]) => ({ tab, part, n: c[tab], pct: filledPct(c, tab) }))
        .sort((a, b) => (a.pct ?? 101) - (b.pct ?? 101) || b.n - a.n);
    const lines = [
        `📋 ${t("work.heroTitle")}`,
        `📅 ${d}${where ? " · " + where : ""}`,
        `📊 ${tf("work.totalLd", { n: c.total.toLocaleString() })}`,
        "",
        `✍️ ${t("work.rpUnfilledHead")}`,
        ...fields.map(f => `${pctDot(f.pct)} ${t(FIELD_LABEL[f.part])}: ${f.n.toLocaleString()}${f.pct == null ? "" : ` (${f.pct}%)`}`),
        `⏰ ${t("work.tabExpired")}: ${c.expired.toLocaleString()}`,
        `📆 ${t("work.tabToday")}: ${c.today.toLocaleString()}`,
        ""
    ];
    const short = k => t(`work.short.${k}`);
    const isToday = r => r.al === todayKey();
    const MAX = 30;

    if (wkView === "officer" && !wkOfficer && wkShowFilters) {
        // Officer -> loans still missing something, count per field.
        const map = new Map();
        scoped.forEach(r => {
            const miss = missingParts(r);
            const exp = isExpired(r);
            const tod = isToday(r);
            if (!miss.length && !exp && !tod) return;
            const k = r.coResponse || "-";
            const o = map.get(k) || { name: k, n: 0, parts: {}, expired: 0, today: 0 };
            if (miss.length) o.n++;
            miss.forEach(p => { o.parts[p] = (o.parts[p] || 0) + 1; });
            if (exp) o.expired++;
            if (tod) o.today++;
            map.set(k, o);
        });
        const officers = [...map.values()].sort((a, b) => b.n - a.n || b.expired - a.expired || a.name.localeCompare(b.name));
        lines.push(`👤 ${t("work.rpByOfficer")}`);
        officers.slice(0, MAX).forEach(o => {
            const items = Object.entries(o.parts).sort((a, b) => b[1] - a[1])
                .map(([p, n]) => `${short(p)} ${n.toLocaleString()}`);
            if (o.expired) items.push(`${short("expired")} ${o.expired.toLocaleString()}`);
            if (o.today) items.push(`${short("today")} ${o.today.toLocaleString()}`);
            lines.push(`▪️ ${o.name} — ${o.n.toLocaleString()} LD`, `   ${items.join(" · ")}`);
        });
        if (officers.length > MAX) lines.push(tf("work.reportMore", { n: (officers.length - MAX).toLocaleString() }));
        if (!officers.length) lines.push(t("work.emptyDone"));
    } else {
        // Clients still missing something (or whose promise is due /
        // expired), most days late first.
        const list = scoped.filter(r => missingParts(r).length || isExpired(r) || isToday(r))
            .sort((a, b) => (parseInt(b.day, 10) || 0) - (parseInt(a.day, 10) || 0));
        lines.push(`👥 ${t("work.rpClients")} (${list.length.toLocaleString()} LD)`);
        list.slice(0, MAX).forEach(r => {
            const head = [r.customer || "-", r.loanNumber || r.concate, `${parseInt(r.day, 10) || 0} ${t("arrears.cardDays")}`];
            if (!wkOfficer && wkShowFilters && r.coResponse) head.push(r.coResponse);
            const notes = [];
            const miss = missingParts(r);
            if (miss.length) notes.push(tf("work.rpMissing", { list: miss.map(short).join(", ") }));
            if (isExpired(r)) notes.push(`⏰ ${t("work.promiseShort").replace("{d}", isoToDMY(r.al))}`);
            else if (isToday(r)) notes.push(`📆 ${t("work.tabToday")}`);
            lines.push(`▪️ ${head.join(" · ")}`, `   ${notes.join(" · ")}`);
        });
        if (list.length > MAX) lines.push(tf("work.reportMore", { n: (list.length - MAX).toLocaleString() }));
        if (!list.length) lines.push(t("work.emptyDone"));
    }
    return lines.join("\n").trim();
}

async function copyReport() {
    const text = buildReport();
    let ok = false;
    try {
        await navigator.clipboard.writeText(text);
        ok = true;
    } catch (e) {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        try { ok = document.execCommand("copy"); } catch (e2) {}
        ta.remove();
    }
    notify(t(ok ? "work.reportCopied" : "work.reportCopyFailed"), ok ? "success" : "error");
}

$("btnWkCopy").addEventListener("click", copyReport);

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
                    // An officer's clients: back to the officers.
                    if (wkOfficer) {
                        wkOfficer = "";
                        return renderList();
                    }
                    // Opened from Daily Arrears' button: go back there.
                    if (/\/pages\/arrears\//.test(document.referrer)) return history.back();
                    if (wkFrom === "records") return backToArrears();
                    cmNav.back("/CM_Pro/pages/masterdata/index.html");
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
