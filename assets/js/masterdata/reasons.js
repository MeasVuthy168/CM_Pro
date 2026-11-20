// ========================================
// Master Data > Work to complete > Reason Arrear records
// (pages/masterdata/reasons.html) — every saved Reason Arrear, not only
// today's arrears, with where its loan stands:
//   in arrears / stopped being late (still in OS) / loan closed (not in OS),
// plus stale (in arrears, not updated for 30 days) and poor quality.
//
// GET /api/reasonarrear/records does the scope (like Work to complete),
// filters, counts and paging; this page shows 50 at a time ("Show more"),
// exports every match to Excel, copies a per-officer summary for
// Telegram, and deletes closed-loan records (Excel backup first).
// ========================================

const t = (key) => (window.CMI18n ? CMI18n.t(key) : key);
const tf = (key, vars) => Object.entries(vars || {}).reduce((s, [k, v]) => s.split(`{${k}}`).join(v), t(key));
const $ = id => document.getElementById(id);

const rrUser = (() => {
    try { return JSON.parse(localStorage.getItem("loggedInUser") || sessionStorage.getItem("loggedInUser") || "{}"); }
    catch (e) { return {}; }
})();
const rrRole = String(rrUser.role || "").toLowerCase();
const rrIsAdmin = rrRole === "admin";
// Admin only (the API refuses everyone else too): anyone else goes back
// to Work to complete.
if (!rrIsAdmin) location.replace("/CM_Pro/pages/masterdata/work.html");
const rrIsStaff = rrRole === "viewer_staff";

const PARTS = [
    ["occupationLoan", "arrears.reasonOccLoanLabel"],
    ["occupationNow", "arrears.reasonOccNowLabel"],
    ["purpose", "arrears.reasonPurposeLabel"],
    ["reason", "arrears.reasonReasonLabel"],
    ["solution", "arrears.reasonSolutionOnlyLabel"]
];

const CARD_LABEL = {
    all: "rr.cardAll", arrears: "rr.cardArrears", current: "rr.cardCurrent", closed: "rr.cardClosed",
    stale: "rr.cardStale", poor: "rr.cardPoor", messy: "rr.cardMessy"
};

let rrCard = "all";
let rrPage = 1;
let rrPages = 1;
let rrRows = [];
let rrTotal = 0;
let rrBusy = false;

function rrToken() { return API.getToken ? API.getToken() : (localStorage.getItem("token") || sessionStorage.getItem("token")); }

function escapeHtml(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function notify(message, type = "info") {
    if (typeof CMToast !== "undefined" && CMToast.show) CMToast.show({ type, title: message, message: "", duration: 3000 });
    else alert(message);
}

// Cambodia time (UTC+7), "yyyy-mm-dd hh:mm AM".
function fmtDateTime(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d)) return "";
    const k = new Date(d.getTime() + 7 * 3600 * 1000);
    const pad = n => String(n).padStart(2, "0");
    let h = k.getUTCHours();
    const ampm = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    return `${k.getUTCFullYear()}-${pad(k.getUTCMonth() + 1)}-${pad(k.getUTCDate())} ${pad(h)}:${pad(k.getUTCMinutes())} ${ampm}`;
}
const isoToDMY = v => { const m = String(v || "").match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : ""; };

function filters() {
    return {
        q: $("rrSearch").value.trim(),
        branch: $("rrBranch").value,
        officer: $("rrOfficer").value,
        uploadedBy: $("rrUploader").value,
        from: $("rrFrom").value,
        to: $("rrTo").value
    };
}

function query(extra) {
    const p = new URLSearchParams({ card: rrCard, ...extra });
    Object.entries(filters()).forEach(([k, v]) => { if (v) p.set(k, v); });
    return p.toString();
}

async function fetchRecords(extra) {
    const res = await fetch(`${API.BASE_URL}/api/reasonarrear/records?${query(extra)}`, {
        headers: { Authorization: `Bearer ${rrToken()}` }
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.message || `HTTP ${res.status}`);
    return data;
}

// page 1 replaces the list; later pages append ("Show more").
async function load(page = 1) {
    if (rrBusy) return;
    rrBusy = true;
    const first = page === 1;
    if (first && typeof showAppLoading === "function") showAppLoading(t("common.loading"));
    try {
        const data = await fetchRecords({ page, limit: 50 });
        rrPage = data.page;
        rrPages = data.pages;
        rrTotal = data.total;
        rrRows = first ? data.rows : rrRows.concat(data.rows);
        if (first) { rrSel.clear(); rrAllSelected = false; }   // new card / filters: start over
        renderCounts(data);
        renderFacets(data.facets);
        renderList();
        loadStaffNames();
    } catch (err) {
        console.error("[reasons] load failed:", err);
        notify(t("rr.loadFailed"), "error");
        if (first) $("rrList").innerHTML = `<div class="oa-empty">${escapeHtml(t("rr.loadFailed"))}</div>`;
    } finally {
        rrBusy = false;
        if (first && typeof hideAppLoading === "function") hideAppLoading();
    }
}

function renderCounts(data) {
    const c = data.counts || {};
    ["all", "arrears", "current", "closed", "stale", "poor", "messy"].forEach(k => {
        $(`rrCount-${k}`).textContent = (c[k] || 0).toLocaleString();
    });
    $("rrStaleLabel").textContent = tf("rr.cardStaleN", { n: data.staleDays || 30 });
    document.querySelectorAll("[data-rr-card]").forEach(b => b.classList.toggle("active", b.dataset.rrCard === rrCard));
    $("rrSub").textContent = data.osLoaded === false ? t("rr.noOs") : tf("rr.subTotal", { n: (c.all || 0).toLocaleString() });
    const del = $("btnRrDelete");
    del.hidden = !(rrIsAdmin && rrCard === "closed" && (c.closed || 0) > 0);
    $("rrDeleteText").textContent = tf("rr.delBtn", { n: (c.closed || 0).toLocaleString() });
    rrPendingCount = data.pendingCount || 0;
    paintPendingBanner();
}

function paintPendingBanner() {
    $("btnRrPending").hidden = !rrIsAdmin || !rrPendingCount;
    $("rrPendingText").textContent = tf("rr.pendingBtn", { n: rrPendingCount.toLocaleString() });
}

// ---------- waiting for approval (Admin) ----------
// An officer's change to a reason Admin corrected is held on the server
// (lib/reason-review.js) until Admin approves or rejects it here.
let rrPendingCount = 0;
let rrPendingItems = [];

function showPendingView(on) {
    $("rrPendingView").hidden = !on;
    $("rrMainCard").hidden = on;
    if (on) requestAnimationFrame(() => {
        const y = $("rrPendingView").getBoundingClientRect().top + window.scrollY - 70;
        window.scrollTo({ top: Math.max(0, y), behavior: "smooth" });
    });
}

async function loadPending() {
    if (typeof showAppLoading === "function") showAppLoading(t("common.loading"));
    try {
        const res = await fetch(`${API.BASE_URL}/api/reasonarrear/pending`, { headers: { Authorization: `Bearer ${rrToken()}` } });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.message || `HTTP ${res.status}`);
        rrPendingItems = data.items || [];
        rrPendingCount = rrPendingItems.length;
        renderPending();
        paintPendingBanner();
        showPendingView(true);
    } catch (err) {
        console.error("[reasons] pending failed:", err);
        notify(t("rr.loadFailed"), "error");
    } finally {
        if (typeof hideAppLoading === "function") hideAppLoading();
    }
}

function renderPending() {
    const n = rrPendingItems.length;
    $("rrPendingTitle").textContent = tf("rr.pendingTitle", { n: n.toLocaleString() });
    $("btnRrApproveAll").disabled = $("btnRrRejectAll").disabled = !n;
    const list = $("rrPendingList");
    if (!n) {
        list.innerHTML = `<div class="oa-empty">${escapeHtml(t("rr.pendingEmpty"))}</div>`;
        return;
    }
    const fields = PARTS.concat([["al", "rr.promise"]]);
    list.innerHTML = rrPendingItems.map(it => {
        const rows = fields.map(([k, key]) => {
            const a = (it.current && it.current[k]) || "";
            const b = (it.proposed && it.proposed[k]) || "";
            const show = v => (k === "al" ? isoToDMY(v) : v) || "—";
            const diff = a !== b;
            return `<div class="rr-cmp-row${diff ? " diff" : ""}">
                <span class="rr-cmp-label">${escapeHtml(t(key))}</span>
                <span class="rr-cmp-a">${escapeHtml(show(a))}</span>
                <span class="rr-cmp-b">${escapeHtml(show(b))}</span>
            </div>`;
        }).join("");
        const ld = String(it.cif).split("-");
        return `<div class="oa-item rr-pending-item" data-rr-pending="${escapeHtml(it.cif)}">
            <div class="oa-item-main">
                <div class="oa-item-name">${escapeHtml(it.customer || it.cif)}</div>
                <div class="oa-item-sub">${escapeHtml(ld[0])}${ld[1] ? ` · CIF ${escapeHtml(ld[1])}` : ""}${it.officer ? ` · ${escapeHtml(it.officer)}` : ""}${it.branch ? ` · ${escapeHtml(it.branch)}` : ""}</div>
                <div class="rr-cmp">
                    <div class="rr-cmp-row rr-cmp-head"><span></span><span>${escapeHtml(tf("rr.cmpAdmin", { by: it.adminBy || "Admin" }))}</span><span>${escapeHtml(tf("rr.cmpOfficer", { by: it.submittedName || it.submittedBy || "-" }))}</span></div>
                    ${rows}
                </div>
                <div class="rr-by">${escapeHtml(tf("rr.pendingBy", { by: it.submittedName || it.submittedBy || "-", at: fmtDateTime(it.submittedAt) || "-", src: it.source === "excel" ? "Excel" : "App" }))}</div>
                <div class="rr-pending-actions">
                    <button type="button" class="rr-pending-btn no" data-rr-decide="reject">${escapeHtml(t("rr.reject"))}</button>
                    <button type="button" class="rr-pending-btn ok" data-rr-decide="approve">${escapeHtml(t("rr.approve"))}</button>
                </div>
            </div>
        </div>`;
    }).join("");
}

async function decidePending(cifs, action) {
    if (!cifs.length) return;
    if (cifs.length > 1 && !confirm(tf(action === "approve" ? "rr.approveAllConfirm" : "rr.rejectAllConfirm", { n: cifs.length.toLocaleString() }))) return;
    if (typeof showAppLoading === "function") showAppLoading(t("common.loading"));
    try {
        const res = await fetch(`${API.BASE_URL}/api/reasonarrear/pending/decide`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${rrToken()}` },
            body: JSON.stringify({ cifs, action })
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.message || `HTTP ${res.status}`);
        notify(tf(action === "approve" ? "rr.approvedN" : "rr.rejectedN", { n: cifs.length.toLocaleString() }), "success");
        const gone = new Set(cifs);
        rrPendingItems = rrPendingItems.filter(it => !gone.has(it.cif));
        rrPendingCount = rrPendingItems.length;
        renderPending();
        paintPendingBanner();
    } catch (err) {
        console.error("[reasons] decide failed:", err);
        notify(err.message || t("rr.decideFailed"), "error");
    } finally {
        if (typeof hideAppLoading === "function") hideAppLoading();
    }
}

// Who submitted, as "Name-ID" (20/11/2026): a username that is a Staff
// ID gets its List Staff name (leading zeros ignored); a name, admin or
// an ID not on List Staff stays as it is. List Staff is read once; the
// list and the user picker re-draw when it arrives.
let rrStaff = null;          // Map id -> name, once loaded
let rrStaffLoading = null;
function loadStaffNames() {
    if (!rrStaffLoading) {
        rrStaffLoading = fetch(`${API.BASE_URL}/api/creditofficer/list`, { headers: { Authorization: `Bearer ${API.getToken()}` } })
            .then(res => res.json())
            .then(data => {
                rrStaff = new Map(((data && data.items) || [])
                    .map(o => [String(o.officerId || "").trim().replace(/^0+(?=.)/, ""), String(o.name || "").trim()])
                    .filter(([id, name]) => id && name));
                if (rrFacets) renderFacets(rrFacets);
                renderList();
            })
            .catch(() => { rrStaffLoading = null; });
    }
    return rrStaffLoading;
}
function userLabel(by) {
    const id = String(by || "").trim();
    if (!rrStaff || !/^\d+$/.test(id)) return id;
    const name = rrStaff.get(id.replace(/^0+(?=.)/, ""));
    return name ? `${name}-${id}` : id;
}

// Pickers keep the chosen value even if it falls out of the list.
// label(v): the text shown for a value (the value itself by default).
function fillSelect(el, values, allKey, label = v => v) {
    const cur = el.value;
    const opts = [`<option value="">${escapeHtml(t(allKey))}</option>`]
        .concat(values.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(label(v))}</option>`));
    if (cur && !values.includes(cur)) opts.push(`<option value="${escapeHtml(cur)}">${escapeHtml(label(cur))}</option>`);
    el.innerHTML = opts.join("");
    el.value = cur;
}

let rrFacets = null;
function renderFacets(f) {
    if (!f) return;
    rrFacets = f;
    fillSelect($("rrBranch"), f.branches || [], "rr.allBranches");
    fillSelect($("rrOfficer"), f.officers || [], "rr.allOfficers");
    // By name (A-Z), the value stays the username the filter sends.
    const uploaders = [...(f.uploaders || [])].sort((a, b) => userLabel(a).localeCompare(userLabel(b)));
    fillSelect($("rrUploader"), uploaders, "rr.allUploaders", userLabel);
    // One branch / one officer only: no point offering the picker.
    $("rrBranch").hidden = rrIsStaff || (f.branches || []).length < 2;
    $("rrOfficer").hidden = rrIsStaff;
    const any = Object.values(filters()).some(Boolean);
    $("btnRrClear").hidden = !any;
}

const STATUS_CSS = { arrears: "rr-st-arrears", current: "rr-st-current", closed: "rr-st-closed", unknown: "rr-st-closed" };

const rrOpenParts = new Set();   // cards whose long answers are shown whole
function renderList() {
    const cardLabel = t(CARD_LABEL[rrCard]);
    $("rrSubtitle").textContent = tf("rr.subtitle", { tab: cardLabel, n: rrTotal.toLocaleString() });
    const list = $("rrList");
    if (!rrRows.length) {
        list.innerHTML = `<div class="oa-empty oa-empty-art">
            <span class="oa-empty-ico"><span class="ui-ico ui-ico-clipboard" aria-hidden="true"></span></span>
            <strong>${escapeHtml(t("arrears.oaEmpty"))}</strong></div>`;
    } else {
        list.innerHTML = rrRows.map(r => {
            const parts = PARTS.map(([k, key]) => {
                const v = r[k];
                return `<div class="rr-part${v ? "" : " rr-part-empty"}"><span>${escapeHtml(t(key))}</span><b>${escapeHtml(v || "—")}</b></div>`;
            }).join("");
            // Long answers are cut to 2 lines; "More" shows them whole.
            const long = PARTS.some(([k]) => String(r[k] || "").length > 45);
            const open = rrOpenParts.has(r.cif);
            const flags = [
                `<span class="rr-chip ${STATUS_CSS[r.status] || ""}">${escapeHtml(t(`rr.st.${r.status}`))}</span>`,
                r.stale ? `<span class="rr-chip rr-st-stale">${escapeHtml(t("rr.flagStale"))}</span>` : "",
                r.poor ? `<span class="rr-chip rr-st-poor">${escapeHtml(t("rr.flagPoor"))}</span>` : "",
                r.messy ? `<span class="rr-chip rr-st-messy">${escapeHtml(t("rr.cardMessy"))}</span>` : "",
                r.adminBy ? `<span class="rr-chip rr-st-admin">${escapeHtml(tf("rr.flagAdmin", { by: r.adminBy }))}</span>` : ""
            ].join("");
            const edit = `<button type="button" class="rr-edit" data-rr-edit="${escapeHtml(r.cif)}"><span class="ui-ico ui-ico-edit" aria-hidden="true"></span> ${escapeHtml(t("rr.edit"))}</button>`;
            const on = rrAllSelected || rrSel.has(r.cif);
            return `<div class="oa-item rr-item${on ? " rr-sel" : ""}" data-rr-cif="${escapeHtml(r.cif)}" role="checkbox" aria-checked="${on}" tabindex="0">
                <span class="rr-check" aria-hidden="true">${on ? "✓" : ""}</span>
                <div class="oa-item-main">
                    <div class="oa-item-name">${escapeHtml(r.customer || "-")}</div>
                    <div class="oa-item-sub">${escapeHtml(r.loanNumber)}${r.customerCif ? ` · CIF ${escapeHtml(r.customerCif)}` : ""}${r.day ? ` · ${escapeHtml(r.day)} ${escapeHtml(t("arrears.cardDays"))}` : ""}</div>
                    <div class="rr-flags">${flags}</div>
                    <div class="rr-parts${open ? " rr-parts-open" : ""}">${parts}${long ? `<button type="button" class="rr-parts-more" data-rr-more="${escapeHtml(r.cif)}">${escapeHtml(t(open ? "rr.less" : "rr.moreText"))}</button>` : ""}</div>
                    <div class="oa-item-meta">
                        ${r.coResponse ? `<span><span class="ui-ico ui-ico-officer" aria-hidden="true"></span> ${escapeHtml(r.coResponse)}</span>` : ""}
                        ${r.al ? `<span class="wk-chip">${escapeHtml(tf("work.promiseOn", { d: isoToDMY(r.al) }))}</span>` : ""}
                    </div>
                    <div class="rr-by">${escapeHtml(tf("rr.by", { by: userLabel(r.uploadedBy) || "-", at: fmtDateTime(r.uploadedAt) || "-" }))}</div>
                </div>
                ${edit}
            </div>`;
        }).join("");
    }
    const more = $("btnRrMore");
    more.hidden = rrPage >= rrPages;
    more.textContent = tf("rr.more", { n: (rrTotal - rrRows.length).toLocaleString() });
    renderSelBar();
}

// ---------- select records -> edit them in Work to complete ----------
// Tap a card to select it (or Select all: every match of the card and
// filters). "Open in the work list" hands them to Work to complete's
// editor (?from=records), which walks them with ‹ › and comes back here.
const MAX_OPEN = 1000;              // what the hand-over carries
const rrSel = new Map();            // cif -> record
let rrAllSelected = false;

function selCount() { return rrAllSelected ? rrTotal : rrSel.size; }

function renderSelBar() {
    const bar = $("rrSelBar");
    const n = selCount();
    bar.hidden = n === 0;
    document.body.classList.toggle("rr-selecting", n > 0);
    if (!n) return;
    const nav = document.querySelector(".bottom-nav");
    bar.style.bottom = `${(nav ? nav.getBoundingClientRect().height : 0) + 10}px`;
    $("rrSelN").textContent = tf("rr.selectedN", { n: n.toLocaleString() });
    const all = $("btnRrSelAll");
    all.textContent = rrAllSelected ? t("rr.unselectAll") : tf("rr.selectAll", { n: rrTotal.toLocaleString() });
    $("btnRrOpenWork").textContent = tf("rr.openInWork", { n: Math.min(n, MAX_OPEN).toLocaleString() });
}

function clearSelection() {
    rrSel.clear();
    rrAllSelected = false;
    renderList();
}

function toggleCard(cif) {
    if (rrAllSelected) {
        // Leaving "all" for a hand-picked set: keep what's on screen, minus this one.
        rrAllSelected = false;
        rrRows.forEach(r => rrSel.set(r.cif, r));
    }
    if (rrSel.has(cif)) rrSel.delete(cif);
    else { const r = rrRows.find(x => x.cif === cif); if (r) rrSel.set(cif, r); }
    renderList();
}

// A record as Work to complete's rows look (GET /api/arreast24byco/work).
function toWorkRow(r) {
    return {
        loanNumber: r.loanNumber, customer: r.customer, location: r.location || "", arreas: r.arreas || "", day: r.day || "",
        accountLoan: r.accountLoan || "", tell: r.tell || "", cif: r.customerCif || "", occu: r.occu || "", ministry: r.ministry || "",
        branch: r.branch || "", coId: r.coId || "", coResponse: r.coResponse || "", ccy: r.ccy || "", teamLeader: "", class: r.class || "",
        concate: r.cif, product: r.product || "", al: r.al || "", recStatus: r.status || "", user: r.uploadedBy || "", dateBackup: r.uploadedAt || "",
        occupationLoan: r.occupationLoan || "", occupationNow: r.occupationNow || "", purpose: r.purpose || "",
        reason: r.reason || "", solution: r.solution || "", aj: "", ak: ""
    };
}

function openInWork(records, startCif) {
    const rows = records.slice(0, MAX_OPEN);
    if (!rows.length) return;
    if (records.length > MAX_OPEN) notify(tf("rr.tooMany", { max: MAX_OPEN.toLocaleString(), n: records.length.toLocaleString() }), "warning");
    const focus = {
        at: Date.now(),
        username: rrUser.username || "",
        concate: startCif && rows.some(r => r.cif === startCif) ? startCif : rows[0].cif,
        nav: rows.map(r => r.cif),
        rows: rows.map(toWorkRow),
        applyAll: false,
        suggest: {}
    };
    try {
        sessionStorage.setItem("cm_work_focus_v1", JSON.stringify(focus));
    } catch (e) {
        return notify(t("rr.openFailed"), "error");
    }
    location.href = "/CM_Pro/pages/masterdata/work.html?from=records";
}

async function openSelected() {
    if (!rrAllSelected) {
        // In list order.
        const order = new Map(rrRows.map((r, i) => [r.cif, i]));
        return openInWork([...rrSel.values()].sort((a, b) => (order.get(a.cif) ?? 1e9) - (order.get(b.cif) ?? 1e9)));
    }
    if (typeof showAppLoading === "function") showAppLoading(t("common.loading"));
    try {
        const data = await fetchRecords({ export: "1" });
        openInWork(data.rows || []);
    } catch (err) {
        notify(t("rr.loadFailed"), "error");
    } finally {
        if (typeof hideAppLoading === "function") hideAppLoading();
    }
}

$("rrList").addEventListener("click", e => {
    const more = e.target.closest("[data-rr-more]");
    if (more) {
        e.stopPropagation();   // not a card selection
        const cif = more.dataset.rrMore;
        if (rrOpenParts.has(cif)) rrOpenParts.delete(cif); else rrOpenParts.add(cif);
        const box = more.closest(".rr-parts");
        const open = rrOpenParts.has(cif);
        box.classList.toggle("rr-parts-open", open);
        more.textContent = t(open ? "rr.less" : "rr.moreText");
        return;
    }
    const edit = e.target.closest("[data-rr-edit]");
    if (edit) {
        e.stopPropagation();
        // This one first; ‹ › walks the records on screen.
        return openInWork(rrRows, edit.dataset.rrEdit);
    }
    const card = e.target.closest("[data-rr-cif]");
    if (card) toggleCard(card.dataset.rrCif);
});
$("rrList").addEventListener("keydown", e => {
    if (e.key !== " " && e.key !== "Enter") return;
    const card = e.target.closest("[data-rr-cif]");
    if (card && !e.target.closest("[data-rr-edit]")) { e.preventDefault(); toggleCard(card.dataset.rrCif); }
});

// ---------- export (every match, Excel) ----------
// pre: rows already fetched (the delete's backup), else every match now.
// Returns true once the file is saved.
async function exportExcel(pre) {
    if (typeof ArrExport === "undefined") return false;
    if (!pre && typeof showAppLoading === "function") showAppLoading(t("rr.exporting"));
    try {
        const data = pre || await fetchRecords({ export: "1" });
        const text = key => ({ type: "text", value: r => r[key] || null });
        const cols = [
            { label: "No", type: "int", value: (r, i) => i + 1 },
            { label: t("rr.colCustomer"), ...text("customer"), maxChars: 30 },
            { label: "LD", ...text("loanNumber") },
            { label: "CIF", ...text("customerCif") },
            { label: t("rr.colBranch"), ...text("branch") },
            { label: t("rr.colOfficer"), ...text("coResponse") },
            { label: t("rr.colStatus"), type: "text", value: r => t(`rr.st.${r.status}`) },
            ...PARTS.map(([k, key]) => ({ label: t(key), ...text(k), maxChars: 40 })),
            { label: t("arrears.reasonPromiseDateLabel"), type: "text", value: r => isoToDMY(r.al) || null },
            { label: t("rr.colStale"), type: "text", value: r => (r.stale ? "✓" : null) },
            { label: t("rr.colPoor"), type: "text", value: r => (r.poor ? "✓" : null) },
            { label: t("rr.cardMessy"), type: "text", value: r => (r.messy ? "✓" : null) },
            { label: "User", type: "text", value: r => userLabel(r.uploadedBy) || null },
            { label: "DateBackUpReasonArrear", type: "text", value: r => fmtDateTime(r.uploadedAt) || null }
        ];
        const f = filters();
        const info = [`${t("rr.heroTitle")} · ${t(CARD_LABEL[rrCard])} · ${data.rows.length.toLocaleString()}`]
            .concat(Object.entries(f).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`));
        const stamp = new Date().toISOString().slice(0, 10);
        await ArrExport.excel({
            filename: `ReasonArrear_${pre ? "deleted_" : ""}${rrCard}_${stamp}.xlsx`,
            sheets: [{ name: "Reason Arrear", title: t("rr.heroTitle"), info, cols, rows: data.rows }]
        });
        return true;
    } catch (err) {
        console.error("[reasons] export failed:", err);
        notify(t("rr.exportFailed"), "error");
        return false;
    } finally {
        if (!pre && typeof hideAppLoading === "function") hideAppLoading();
    }
}

// ---------- copy for Telegram ----------
// The filtered records: the cards, then one block per officer (most
// stale + poor first) with only what's above 0. "▪️" so Telegram keeps
// the layout.
async function copyReport() {
    try {
        const data = await fetchRecords({ summary: "1" });
        const c = data.counts || {};
        const f = filters();
        const where = [f.branch, f.officer, f.uploadedBy && `${t("rr.colUser")}: ${f.uploadedBy}`,
            (f.from || f.to) && `${f.from || "…"} → ${f.to || "…"}`, f.q && `"${f.q}"`].filter(Boolean).join(" · ");
        const n = v => (v || 0).toLocaleString();
        const lines = [
            `📋 ${t("rr.heroTitle")}`,
            `📅 ${isoToDMY(new Date(Date.now() + 7 * 3600e3).toISOString())}${where ? " · " + where : ""}`,
            `📊 ${tf("rr.subTotal", { n: n(c.all) })}`,
            "",
            `🔴 ${t("rr.cardArrears")}: ${n(c.arrears)}`,
            `🟢 ${t("rr.cardCurrent")}: ${n(c.current)}`,
            `⚫ ${t("rr.cardClosed")}: ${n(c.closed)}`,
            `🕒 ${tf("rr.cardStaleN", { n: data.staleDays || 30 })}: ${n(c.stale)}`,
            `✏️ ${t("rr.cardPoor")}: ${n(c.poor)}`,
            `⚠️ ${t("rr.cardMessy")}: ${n(c.messy)}`,
            "",
            `👤 ${t("rr.rpByOfficer")}`
        ];
        const MAX = 40;
        const offs = data.byOfficer || [];
        offs.slice(0, MAX).forEach(o => {
            const items = [
                o.arrears && `${t("rr.cardArrears")} ${n(o.arrears)}`,
                o.stale && `${t("rr.rpStale")} ${n(o.stale)}`,
                o.poor && `${t("rr.rpPoor")} ${n(o.poor)}`,
                o.closed && `${t("rr.cardClosed")} ${n(o.closed)}`
            ].filter(Boolean);
            lines.push(`▪️ ${o.officer === "-" ? t("rr.noOfficer") : o.officer} — ${n(o.total)}`);
            if (items.length) lines.push(`   ${items.join(" · ")}`);
        });
        if (offs.length > MAX) lines.push(tf("rr.rpMore", { n: n(offs.length - MAX) }));
        await copyText(lines.join("\n"));
        notify(t("rr.copied"), "success");
    } catch (err) {
        console.error("[reasons] copy failed:", err);
        notify(t("rr.copyFailed"), "error");
    }
}

async function copyText(text) {
    try {
        await navigator.clipboard.writeText(text);
    } catch (e) {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        ta.parentNode.removeChild(ta);
        if (!ok) throw e;
    }
}

// ---------- delete closed-loan records (admin) ----------
// The "loan closed" records matching the filters: confirm, save them to
// Excel first, then delete. The server re-checks each against a fresh
// read of OS and only deletes those still closed.
async function deleteClosed() {
    if (!rrIsAdmin || rrCard !== "closed") return;
    if (typeof showAppLoading === "function") showAppLoading(t("common.loading"));
    let data;
    try {
        data = await fetchRecords({ export: "1" });
    } catch (err) {
        if (typeof hideAppLoading === "function") hideAppLoading();
        notify(t("rr.loadFailed"), "error");
        return;
    }
    if (typeof hideAppLoading === "function") hideAppLoading();
    const rows = (data.rows || []).filter(r => r.status === "closed");
    if (!rows.length) return notify(t("arrears.oaEmpty"), "info");
    if (!confirm(tf("rr.delConfirm", { n: rows.length.toLocaleString() }))) return;
    if (typeof showAppLoading === "function") showAppLoading(t("rr.delBackup"));
    try {
        // Backup first: no file, no delete.
        if (!(await exportExcel({ ...data, rows }))) return;
        if (typeof showAppLoading === "function") showAppLoading(tf("rr.deleting", { n: rows.length.toLocaleString() }));
        const res = await fetch(`${API.BASE_URL}/api/reasonarrear/records/delete-closed`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${rrToken()}` },
            body: JSON.stringify({ cifs: rows.map(r => r.cif) })
        });
        const out = await res.json();
        if (!res.ok || !out.ok) throw new Error(out.message || `HTTP ${res.status}`);
        notify(tf("rr.deleted", { n: (out.deletedCount || 0).toLocaleString() }) +
            (out.skipped ? " " + tf("rr.delSkipped", { n: out.skipped.toLocaleString() }) : ""), "success");
    } catch (err) {
        console.error("[reasons] delete failed:", err);
        notify(err.message || t("rr.delFailed"), "error");
    } finally {
        if (typeof hideAppLoading === "function") hideAppLoading();
        load(1);
    }
}

// ---------- events ----------
document.querySelectorAll("[data-rr-card]").forEach(btn => btn.addEventListener("click", () => {
    rrCard = btn.dataset.rrCard;
    load(1);
}));
let searchTimer = null;
$("rrSearch").addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => load(1), 350); });
["rrBranch", "rrOfficer", "rrUploader", "rrFrom", "rrTo"].forEach(id => $(id).addEventListener("change", () => load(1)));
$("btnRrClear").addEventListener("click", () => {
    $("rrSearch").value = "";
    ["rrBranch", "rrOfficer", "rrUploader", "rrFrom", "rrTo"].forEach(id => { $(id).value = ""; });
    load(1);
});
$("btnRrMore").addEventListener("click", () => load(rrPage + 1));
$("btnRrRefresh").addEventListener("click", () => load(1));
$("btnRrExport").addEventListener("click", () => exportExcel());
$("btnRrCopy").addEventListener("click", copyReport);
$("btnRrDelete").addEventListener("click", deleteClosed);
$("btnRrPending").addEventListener("click", loadPending);
$("btnRrPendingBack").addEventListener("click", () => { showPendingView(false); load(1); });
$("btnRrApproveAll").addEventListener("click", () => decidePending(rrPendingItems.map(it => it.cif), "approve"));
$("btnRrRejectAll").addEventListener("click", () => decidePending(rrPendingItems.map(it => it.cif), "reject"));
$("rrPendingList").addEventListener("click", e => {
    const b = e.target.closest("[data-rr-decide]");
    if (!b) return;
    const cif = b.closest("[data-rr-pending]")?.dataset.rrPending;
    if (cif) decidePending([cif], b.dataset.rrDecide);
});
window.addEventListener("cm-language-changed", () => load(1));

// ========================================
// COMPONENT LOADER (topbar + bottomnav)
// ========================================
let rrLoaded = 0;
async function loadComponent(id, file) {
    try {
        const useCache = id !== "topbar-container";
        const cached = useCache ? sessionStorage.getItem("comp_" + id) : null;
        if (cached) {
            document.getElementById(id).innerHTML = cached;
        } else {
            const html = await (await fetch(file)).text();
            document.getElementById(id).innerHTML = html;
            if (useCache) sessionStorage.setItem("comp_" + id, html);
        }
        if (id === "topbar-container") {
            initTopbar({ titleKey: "rr.pageTitle", showBack: true, showLogo: false, showProfile: false });
            const backBtn = document.getElementById("topbarBackBtn");
            if (backBtn) backBtn.onclick = () => cmNav.back("/CM_Pro/pages/masterdata/work.html");
        }
    } catch (error) {
        console.error(error);
    } finally {
        rrLoaded++;
        if (rrLoaded >= 2) setTimeout(() => { if (typeof hideGlobalSplash === "function") hideGlobalSplash(); }, 300);
    }
}
loadComponent("topbar-container", "/CM_Pro/components/topbar.html");
loadComponent("bottomnav-container", "/CM_Pro/components/bottomnav.html");

function updateOnlineStatus() {
    const banner = document.getElementById("offlineBanner");
    if (banner) banner.style.display = navigator.onLine ? "none" : "block";
}
window.addEventListener("online", updateOnlineStatus);
window.addEventListener("offline", updateOnlineStatus);
updateOnlineStatus();

// Back from the editor: its message (e.g. "submitted n").
try {
    const flash = JSON.parse(sessionStorage.getItem("cm_records_flash_v1") || "null");
    sessionStorage.removeItem("cm_records_flash_v1");
    if (flash && Date.now() - flash.at < 60000 && flash.message) setTimeout(() => notify(flash.message, flash.type || "success"), 400);
} catch (e) {}

$("btnRrSelAll").addEventListener("click", () => {
    if (rrAllSelected) return clearSelection();
    rrAllSelected = true;
    rrSel.clear();
    renderList();
});
$("btnRrSelCancel").addEventListener("click", clearSelection);
$("btnRrOpenWork").addEventListener("click", openSelected);

load(1);
// From the "Waiting for Approval" notification: open that list.
if (rrIsAdmin && new URLSearchParams(location.search).get("view") === "pending") loadPending();
