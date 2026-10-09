// ========================================
// BRANCH PRODUCTIVITY — per-branch drill-down from
// RepDetailbyBranch.html (click a branch name there to land here).
//
// Unlike Officer Productivity's Own/Area split, here each category
// splits into CO / FSRO / Digital Loan (Digital Loan = officer ID
// "90000" on the source sheet, a placeholder for digital-channel loans
// that aren't a real CO/FSRO officer — CM-backend's
// lib/creditreport-branch.js computeBranchProductivity()). There's no
// "already-fetched" instant-paint handoff the way Officer Productivity
// has: RepDetailbyBranch.js's own report only ever holds each branch's
// combined Total, never the CO/FSRO/Digital breakdown, so this page
// always fetches its own summary on load (URL query string only —
// branch name + the report's current date filters — no sessionStorage
// cache needed).
//
// BACKEND ENDPOINTS (CM-backend's lib/creditreport-branch.js)
//   GET /api/creditreport/branch-productivity-summary
//     ?branch=<name>&fromDate=&toDate=&woFromDate=&woToDate=
//   -> { ok, branch, meta, co, fsro, digital, total }
//   Each of co/fsro/digital/total has the same shape:
//     { loanOutstanding:{loan,client,value}, loanDisburse:{loan,value},
//       parT24:{loan,value,parPct}, nbcOverdue:{...8 keys...},
//       writeOff:{balanceWO,wo,woCollected} }
//
//   GET /api/creditreport/branch-clients
//     ?branch=<name>&section=<outstanding|disburse|parT24|nbcOverdue|
//               writeOff>&bucket=<co|fsro|digital>
//     &fromDate=&toDate=&woFromDate=&woToDate=
//   -> { ok, items: [...] } — same row shape as Officer Productivity's
//      officer-clients (see that file's own header comment for the
//      full field-by-field breakdown).
//
//   GET /api/creditreport/branch-disburse-chart
//     ?branch=<name>&fromDate=
//   -> { ok, labels, dates, values, counts }
//   Branch-wide daily disbursement (CO+FSRO+Digital Loan combined —
//   one chart, not three), same mechanism as officer-disburse-chart.
//
//   GET /api/creditreport/byco/kh-holidays — reused as-is (not
//   branch-specific), same as Officer Productivity.
//
// CLIENT LIST PAGINATION — a branch can have far more clients under one
// category than a single officer would, so every "List of Client" tab
// here shows only the first 100 rows with a "Show More" button to
// reveal the rest (Export Excel always exports the full set regardless
// of how many rows are currently shown) — see bpRenderClientListInto().
// ========================================

const t = (key, vars) => window.CMI18n ? CMI18n.t(key, vars) : key;

// Built by a function (not a frozen module-level const) so every label
// picks up the current language whenever a card is (re)rendered, rather
// than being baked in once at page-load time.
function bpCategories() {
    const clientLists = () => [
        { bucket: "co", label: t("creditreport.byBranch.teamCo") },
        { bucket: "fsro", label: t("creditreport.byCO.fsro") },
        { bucket: "digital", label: t("creditreport.byBranch.teamDigitalLoan") }
    ];
    return [
    {
        key: "outstanding",
        icon: "📊",
        label: t("creditreport.detail.sectionOutstanding"),
        chart: false,
        statGroups: [
            { label: t("common.total"), total: true, fields: [
                { key: "total.loanOutstanding.loan", label: t("creditreport.productivity.colLoan") },
                { key: "total.loanOutstanding.client", label: t("creditreport.productivity.colClient") },
                { key: "total.loanOutstanding.value", label: t("creditreport.detail.colValue"), money: true }
            ] },
            { label: t("creditreport.byBranch.teamCo"), fields: [
                { key: "co.loanOutstanding.loan", label: t("creditreport.productivity.colLoan") },
                { key: "co.loanOutstanding.client", label: t("creditreport.productivity.colClient") },
                { key: "co.loanOutstanding.value", label: t("creditreport.detail.colValue"), money: true }
            ] },
            { label: t("creditreport.byCO.fsro"), fields: [
                { key: "fsro.loanOutstanding.loan", label: t("creditreport.productivity.colLoan") },
                { key: "fsro.loanOutstanding.client", label: t("creditreport.productivity.colClient") },
                { key: "fsro.loanOutstanding.value", label: t("creditreport.detail.colValue"), money: true }
            ] },
            { label: t("creditreport.byBranch.teamDigital"), fields: [
                { key: "digital.loanOutstanding.loan", label: t("creditreport.productivity.colLoan") },
                { key: "digital.loanOutstanding.client", label: t("creditreport.productivity.colClient") },
                { key: "digital.loanOutstanding.value", label: t("creditreport.detail.colValue"), money: true }
            ] }
        ],
        clientLists: clientLists()
    },
    {
        key: "disburse",
        icon: "💵",
        label: t("creditreport.detail.sectionDisburse"),
        chart: true,
        statGroups: [
            { label: t("common.total"), total: true, fields: [
                { key: "total.loanDisburse.loan", label: t("creditreport.productivity.colLoan") },
                { key: "total.loanDisburse.value", label: t("creditreport.detail.colValue"), money: true }
            ] },
            { label: t("creditreport.byBranch.teamCo"), fields: [
                { key: "co.loanDisburse.loan", label: t("creditreport.productivity.colLoan") },
                { key: "co.loanDisburse.value", label: t("creditreport.detail.colValue"), money: true }
            ] },
            { label: t("creditreport.byCO.fsro"), fields: [
                { key: "fsro.loanDisburse.loan", label: t("creditreport.productivity.colLoan") },
                { key: "fsro.loanDisburse.value", label: t("creditreport.detail.colValue"), money: true }
            ] },
            { label: t("creditreport.byBranch.teamDigital"), fields: [
                { key: "digital.loanDisburse.loan", label: t("creditreport.productivity.colLoan") },
                { key: "digital.loanDisburse.value", label: t("creditreport.detail.colValue"), money: true }
            ] }
        ],
        clientLists: clientLists()
    },
    {
        key: "parT24",
        icon: "📈",
        label: t("creditreport.detail.sectionT24"),
        chart: false,
        statGroups: [
            { label: t("common.total"), total: true, fields: [
                { key: "total.parT24.loan", label: t("creditreport.productivity.colLoan") },
                { key: "total.parT24.value", label: t("creditreport.detail.colValue"), money: true },
                { key: "total.parT24.parPct", label: t("creditreport.productivity.colPar"), pct: true }
            ] },
            { label: t("creditreport.byBranch.teamCo"), fields: [
                { key: "co.parT24.loan", label: t("creditreport.productivity.colLoan") },
                { key: "co.parT24.value", label: t("creditreport.detail.colValue"), money: true },
                { key: "co.parT24.parPct", label: t("creditreport.productivity.colPar"), pct: true }
            ] },
            { label: t("creditreport.byCO.fsro"), fields: [
                { key: "fsro.parT24.loan", label: t("creditreport.productivity.colLoan") },
                { key: "fsro.parT24.value", label: t("creditreport.detail.colValue"), money: true },
                { key: "fsro.parT24.parPct", label: t("creditreport.productivity.colPar"), pct: true }
            ] },
            { label: t("creditreport.byBranch.teamDigital"), fields: [
                { key: "digital.parT24.loan", label: t("creditreport.productivity.colLoan") },
                { key: "digital.parT24.value", label: t("creditreport.detail.colValue"), money: true },
                { key: "digital.parT24.parPct", label: t("creditreport.productivity.colPar"), pct: true }
            ] }
        ],
        clientLists: clientLists()
    },
    {
        key: "nbcOverdue",
        icon: "⚠️",
        label: t("creditreport.detail.sectionNbcOverdue"),
        chart: false,
        statGroups: [
            { label: t("common.total"), total: true, fields: [
                { key: "total.nbcOverdue.total.count", label: t("creditreport.productivity.colLoan") },
                { key: "total.nbcOverdue.total.value", label: t("creditreport.detail.colValue"), money: true },
                { key: "total.nbcOverdue.total.parPct", label: t("creditreport.productivity.colPar"), pct: true }
            ] },
            { label: t("creditreport.byBranch.teamCo"), fields: [
                { key: "co.nbcOverdue.total.count", label: t("creditreport.productivity.colLoan") },
                { key: "co.nbcOverdue.total.value", label: t("creditreport.detail.colValue"), money: true },
                { key: "co.nbcOverdue.total.parPct", label: t("creditreport.productivity.colPar"), pct: true }
            ] },
            { label: t("creditreport.byCO.fsro"), fields: [
                { key: "fsro.nbcOverdue.total.count", label: t("creditreport.productivity.colLoan") },
                { key: "fsro.nbcOverdue.total.value", label: t("creditreport.detail.colValue"), money: true },
                { key: "fsro.nbcOverdue.total.parPct", label: t("creditreport.productivity.colPar"), pct: true }
            ] },
            { label: t("creditreport.byBranch.teamDigital"), fields: [
                { key: "digital.nbcOverdue.total.count", label: t("creditreport.productivity.colLoan") },
                { key: "digital.nbcOverdue.total.value", label: t("creditreport.detail.colValue"), money: true },
                { key: "digital.nbcOverdue.total.parPct", label: t("creditreport.productivity.colPar"), pct: true }
            ] }
        ],
        clientLists: clientLists()
    },
    // Shows Balance WO (the outstanding written-off balance, # cif/Int/Prn)
    // rather than the WO period figures, per explicit request 2026-10-01 —
    // same change made to Location/Product Performance/Officer Productivity.
    {
        key: "writeOff",
        icon: "✂️",
        label: t("creditreport.detail.sectionWriteOff"),
        chart: false,
        statGroups: [
            { label: t("common.total"), total: true, fields: [
                { key: "total.writeOff.balanceWO.cif", label: t("creditreport.detail.colCifHash") },
                { key: "total.writeOff.balanceWO.int", label: t("creditreport.detail.colInt"), money: true },
                { key: "total.writeOff.balanceWO.prn", label: t("creditreport.detail.colPrn"), money: true }
            ] },
            { label: t("creditreport.byBranch.teamCo"), fields: [
                { key: "co.writeOff.balanceWO.cif", label: t("creditreport.detail.colCifHash") },
                { key: "co.writeOff.balanceWO.int", label: t("creditreport.detail.colInt"), money: true },
                { key: "co.writeOff.balanceWO.prn", label: t("creditreport.detail.colPrn"), money: true }
            ] },
            { label: t("creditreport.byCO.fsro"), fields: [
                { key: "fsro.writeOff.balanceWO.cif", label: t("creditreport.detail.colCifHash") },
                { key: "fsro.writeOff.balanceWO.int", label: t("creditreport.detail.colInt"), money: true },
                { key: "fsro.writeOff.balanceWO.prn", label: t("creditreport.detail.colPrn"), money: true }
            ] },
            { label: t("creditreport.byBranch.teamDigital"), fields: [
                { key: "digital.writeOff.balanceWO.cif", label: t("creditreport.detail.colCifHash") },
                { key: "digital.writeOff.balanceWO.int", label: t("creditreport.detail.colInt"), money: true },
                { key: "digital.writeOff.balanceWO.prn", label: t("creditreport.detail.colPrn"), money: true }
            ] }
        ],
        clientLists: clientLists()
    }
    ];
}

const BP_LIST_PAGE_SIZE = 100;

const bpToken =
    localStorage.getItem("token") ||
    sessionStorage.getItem("token");

let bpState = { branch: null, meta: null, data: null };

// Last-fetched Loan Disburse heatmap data — kept around so the
// fullscreen view can re-render without re-fetching.
let bpDisburseChartData = null;

// ========================================
// HELPERS
// ========================================
function bpGet(obj, path) {
    return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function bpFmtNum(n) {
    n = Number(n) || 0;
    return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}
function bpFmtPct(n) {
    n = Number(n) || 0;
    return (n * 100).toFixed(2) + "%";
}
function bpFmtDateDMY(s) {
    if (!s) return "-";
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (!m) return s;
    return `${m[3]}-${m[2]}-${m[1]}`;
}
function bpFmtDateDDMMYY(s) {
    if (!s) return "-";
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (!m) return s;
    return `${m[3]}/${m[2]}/${m[1].slice(2)}`;
}
function bpToDMY(yyyymmdd) {
    const [y, m, d] = yyyymmdd.split("-");
    return `${d}-${m}-${y}`;
}
function bpEscapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text == null ? "" : String(text);
    return div.innerHTML;
}
function bpSkeletonHtml() {
    return `<div class="op-skel-line" style="width:90%"></div>
             <div class="op-skel-line" style="width:75%"></div>
             <div class="op-skel-line" style="width:82%"></div>`;
}
function bpErrorHtml(err) {
    return `<div class="op-state op-state-error">${bpEscapeHtml((err && err.message) || t("voice.genericError"))}</div>`;
}

// ========================================
// READ BRANCH + FILTERS FROM THE URL
// ========================================
function bpReadParams() {
    const params = new URLSearchParams(location.search);
    return {
        branch: params.get("branch") || "",
        meta: {
            fromDate: params.get("fromDate") || "",
            toDate: params.get("toDate") || "",
            woFromDate: params.get("woFromDate") || "",
            woToDate: params.get("woToDate") || ""
        }
    };
}

function bpBuildQuery(meta) {
    const parts = [];
    if (meta.fromDate) parts.push(`fromDate=${bpToDMY(meta.fromDate)}`);
    if (meta.toDate) parts.push(`toDate=${bpToDMY(meta.toDate)}`);
    if (meta.woFromDate) parts.push(`woFromDate=${bpToDMY(meta.woFromDate)}`);
    if (meta.woToDate) parts.push(`woToDate=${bpToDMY(meta.woToDate)}`);
    return parts.length ? `&${parts.join("&")}` : "";
}

async function bpFetchSummary(branch, meta) {
    const url = `${API.BASE_URL}/api/creditreport/branch-productivity-summary?branch=${encodeURIComponent(branch)}${bpBuildQuery(meta)}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${bpToken}` } });
    const data = await res.json();
    if (!data.ok) throw new Error(data.message || t("creditreport.productivity.failedLoadBranchData"));
    return data;
}

// ========================================
// RENDER — HEADER + CARDS
// ========================================
function bpRenderHeader() {
    const branch = bpState.branch;
    const meta = bpState.meta;

    document.getElementById("bpAvatar").textContent =
        (branch || "?").trim().charAt(0).toUpperCase() || "?";
    document.getElementById("bpBranchName").textContent = branch || "-";

    const chips = [];
    if (meta.fromDate && meta.toDate) {
        chips.push(`${bpFmtDateDMY(meta.fromDate)} – ${bpFmtDateDMY(meta.toDate)}`);
    }
    document.getElementById("bpBranchMeta").innerHTML =
        chips.map(c => `<span class="op-meta-chip">${bpEscapeHtml(c)}</span>`).join("");

    document.getElementById("bpHeaderCard").style.display = "flex";
}

function bpStatFieldHtml(f, data) {
    const v = bpGet(data, f.key);
    const text = f.pct ? bpFmtPct(v) : bpFmtNum(v);
    return `<span>${bpEscapeHtml(f.label)}: <b>${text}</b></span>`;
}
function bpStatGroupHtml(g, data) {
    return `
      <div class="op-card-stats">
        <span class="op-card-stats-group-label">${bpEscapeHtml(g.label)}:</span>
        ${g.fields.map(f => bpStatFieldHtml(f, data)).join("")}
      </div>`;
}
// The Total row always shows; CO/FSRO/Digital only reveal once the card
// is expanded (see .bp-card-stats-buckets in BranchProductivity.css).
function bpCardStatsHtml(cat, data) {
    const totalHtml = cat.statGroups.filter(g => g.total).map(g => bpStatGroupHtml(g, data)).join("");
    const bucketHtml = cat.statGroups.filter(g => !g.total).map(g => bpStatGroupHtml(g, data)).join("");
    return `${totalHtml}<div class="bp-card-stats-buckets">${bucketHtml}</div>`;
}

function bpCardMarkup(cat, data) {
    const listTabsHtml = cat.clientLists.map((cl, i) =>
        `<button type="button" class="op-mode-tab${i === 0 ? " active" : ""}" data-mode="list:${cl.bucket}">👥 ${t("creditreport.productivity.listOfClient")} ${bpEscapeHtml(cl.label)}</button>`
    ).join("");

    const chartTabHtml = cat.chart
        ? `<button type="button" class="op-mode-tab" data-mode="chart">📈 ${t("creditreport.detail.chart")}</button>`
        : "";

    return `
      <div class="op-card" data-key="${cat.key}">
        <button type="button" class="op-card-head" aria-expanded="false">
          <div class="op-card-icon">${cat.icon}</div>
          <div class="op-card-title">
            <div class="op-card-label">${bpEscapeHtml(cat.label)}</div>
            ${bpCardStatsHtml(cat, data)}
          </div>
          <div class="op-card-caret">▾</div>
        </button>
        <div class="op-card-panel">
          <div class="op-mode-tabs">
            ${listTabsHtml}
            ${chartTabHtml}
          </div>
          <div class="op-mode-body" data-mode-body></div>
        </div>
      </div>`;
}

function bpRenderCards() {
    const wrap = document.getElementById("bpCards");
    wrap.innerHTML = bpCategories().map(cat => bpCardMarkup(cat, bpState.data)).join("");
    wrap.style.display = "flex";
    bpFitStatsToWidth();
}

// ========================================
// FIT STATS ROWS TO SCREEN WIDTH
// Each CO/FSRO/Digital Loan line must always fit within the card —
// no wrapping (fixed by CSS), and no horizontal scroll either.
// Content length varies (long values, wide numbers), so a fixed
// font-size can't guarantee that on its own — this measures each row
// after render and shrinks its own font-size in small steps until it
// stops overflowing (or hits a legibility floor). Resets to the CSS
// default before each measurement so a resize (e.g. rotating the
// phone, or a wider screen) can recover full size again instead of
// staying shrunk from a previous, narrower measurement.
// ========================================
function bpFitStatsToWidth() {
    const rows = document.querySelectorAll("#bpCards .op-card-stats");
    rows.forEach(row => {
        row.style.fontSize = "";
        let size = parseFloat(getComputedStyle(row).fontSize);
        const minSize = 7;
        while (row.scrollWidth > row.clientWidth + 0.5 && size > minSize) {
            size -= 0.5;
            row.style.fontSize = `${size}px`;
        }
    });
}

let bpFitResizeTimer;
window.addEventListener("resize", () => {
    clearTimeout(bpFitResizeTimer);
    bpFitResizeTimer = setTimeout(bpFitStatsToWidth, 150);
});

// ========================================
// ACCORDION + MODE SWITCHING
// ========================================
document.getElementById("bpCards").addEventListener("click", (e) => {
    const head = e.target.closest(".op-card-head");
    if (head) {
        const card = head.closest(".op-card");
        const willOpen = !card.classList.contains("open");
        document.querySelectorAll("#bpCards .op-card.open").forEach(c => {
            if (c !== card) { c.classList.remove("open"); c.querySelector(".op-card-head").setAttribute("aria-expanded", "false"); }
        });
        card.classList.toggle("open", willOpen);
        head.setAttribute("aria-expanded", willOpen ? "true" : "false");
        // CO/FSRO/Digital rows are hidden until expanded, so they were
        // skipped by the last width-fit pass — measure them now that
        // they're visible.
        bpFitStatsToWidth();
        if (willOpen) {
            const activeTab = card.querySelector(".op-mode-tab.active");
            bpEnsureModeLoaded(card, activeTab ? activeTab.dataset.mode : "list");
        }
        return;
    }

    const tab = e.target.closest(".op-mode-tab");
    if (tab) {
        const card = tab.closest(".op-card");
        card.querySelectorAll(".op-mode-tab").forEach(t => t.classList.remove("active"));
        tab.classList.add("active");
        bpEnsureModeLoaded(card, tab.dataset.mode);
    }
});

async function bpEnsureModeLoaded(card, mode) {
    const key = card.dataset.key;
    const body = card.querySelector("[data-mode-body]");

    if (mode.startsWith("list:")) {
        const bucket = mode.slice(5);
        card._bpListCache = card._bpListCache || {};
        const renderOpts = {
            arrears: BP_ARREARS_CATEGORIES.has(key),
            filenamePrefix: `${bpState.branch || "branch"}_${key}_${bucket}`
        };
        if (card._bpListCache[mode]) {
            bpRenderClientListInto(body, card._bpListCache[mode], renderOpts);
            return;
        }
        body.innerHTML = bpSkeletonHtml();
        try {
            const rows = await bpFetchClientListRows(key, bucket);
            card._bpListCache[mode] = rows;
            bpRenderClientListInto(body, rows, renderOpts);
        } catch (err) {
            body.innerHTML = bpErrorHtml(err);
        }
        return;
    }

    // Chart (calendar heatmap) — always re-fetches/re-renders on reselect,
    // same rationale as Officer Productivity's own chart tab.
    body.innerHTML = `<div class="op-chart-wrap">${bpSkeletonHtml()}</div>`;
    const chartWrap = body.querySelector(".op-chart-wrap");
    try {
        await bpRenderDisburseChart(chartWrap);
    } catch (err) {
        chartWrap.innerHTML = bpErrorHtml(err);
    }
}

// parT24 and NBC Overdue's client lists use the richer arrears-style
// table (bpArrearsTableHtml) instead of the generic one — same
// convention as Officer Productivity's OP_ARREARS_SECTIONS, keyed by
// category (cat.key) here since bucket is the only other axis.
const BP_ARREARS_CATEGORIES = new Set(["parT24", "nbcOverdue"]);

async function bpFetchClientListRows(section, bucket) {
    const q = bpBuildQuery(bpState.meta);
    const url = `${API.BASE_URL}/api/creditreport/branch-clients?branch=${encodeURIComponent(bpState.branch)}` +
        `&section=${encodeURIComponent(section)}&bucket=${encodeURIComponent(bucket)}${q}`;

    const res = await fetch(url, { headers: { Authorization: `Bearer ${bpToken}` } });
    if (!res.ok) throw new Error(t("creditreport.productivity.clientListLoadFailedRetry"));
    const data = await res.json();
    if (!data.ok) throw new Error(data.message || t("creditreport.productivity.clientListLoadFailed"));
    return data.items || [];
}

// ---- Column specs (same shape as Officer Productivity's own) ----
// Functions (not frozen consts) so labels pick up the current language.
function bpClientTableCols() {
    return [
        { key: "name", label: t("creditreport.compare.colName"), type: "text" },
        { key: "cif", label: t("creditreport.compare.colCif"), type: "text" },
        { key: "loanNumber", label: t("creditreport.productivity.colLoanNumber"), type: "text" },
        { key: "disburseDate", label: t("creditreport.productivity.colDisburseDate"), type: "date" },
        { key: "address", label: t("creditreport.productivity.colAddress"), type: "text" },
        { key: "productType", label: t("creditreport.detail.productType"), type: "text" },
        { key: "loanSize", label: t("creditreport.productivity.colLoanSize"), type: "number" },
        { key: "osUsd", label: t("creditreport.productivity.colOsUsd"), type: "number" }
    ];
}

function bpArrearsTableCols() {
    return [
        { key: "name", label: t("creditreport.productivity.colCustomer"), type: "text" },
        { key: "loanNumber", label: t("creditreport.productivity.colLoanNumber"), type: "text" },
        { key: "class", label: t("creditreport.compare.colClass"), type: "text" },
        { key: "productType", label: t("creditreport.detail.productType"), type: "text" },
        { key: "address", label: t("creditreport.compare.dimLocation"), type: "text" },
        { key: "disburseDate", label: t("creditreport.productivity.colDisDate"), type: "date" },
        { key: "prnOS", label: t("creditreport.productivity.colPrnOs"), type: "number" },
        { key: "intOS", label: t("creditreport.productivity.colIntOs"), type: "number" },
        { key: "prnDue", label: t("creditreport.productivity.colPrnDue"), type: "number" },
        { key: "intDue", label: t("creditreport.productivity.colIntDue"), type: "number" },
        { key: "penalty", label: t("creditreport.productivity.colPenalty"), type: "number" },
        { key: "arreas", label: t("creditreport.productivity.colArreas"), type: "number" },
        { key: "day", label: t("creditreport.productivity.colDay"), type: "number" },
        { key: "balance", label: t("creditreport.productivity.colBalnce"), type: "number" },
        { key: "accountLoan", label: t("creditreport.productivity.colAccountLoan"), type: "text" },
        { key: "cif", label: t("creditreport.compare.colCif"), type: "text" }
    ];
}

function bpTableThHtml(col) {
    return `<th data-sort-key="${col.key}" data-sort-type="${col.type}">${bpEscapeHtml(col.label)}</th>`;
}
function bpTableTdHtml(col, row) {
    const v = row[col.key];
    if (v === "" || v == null) return "<td></td>";
    if (col.type === "number") return `<td>${bpEscapeHtml(bpFmtNum(v))}</td>`;
    if (col.type === "date") return `<td>${bpEscapeHtml(bpFmtDateDMY(v))}</td>`;
    return `<td>${bpEscapeHtml(v)}</td>`;
}

function bpClientTableHtml(rows, { showDate = true } = {}) {
    if (!rows.length) return `<div class="op-state">${t("creditreport.productivity.noClientsFound")}</div>`;
    const allCols = bpClientTableCols();
    const cols = showDate ? allCols : allCols.filter(c => c.key !== "disburseDate");
    return `
      <div class="op-client-table-wrap">
        <table class="op-client-table">
          <thead><tr>${cols.map(bpTableThHtml).join("")}</tr></thead>
          <tbody>${rows.map(r => `<tr>${cols.map(c => bpTableTdHtml(c, r)).join("")}</tr>`).join("")}</tbody>
        </table>
      </div>`;
}

function bpArrearsTableHtml(rows) {
    if (!rows.length) return `<div class="op-state">${t("creditreport.productivity.noClientsFound")}</div>`;
    const cols = bpArrearsTableCols();
    return `
      <div class="op-client-table-wrap">
        <table class="op-client-table">
          <thead><tr><th>${t("creditreport.productivity.colNo")}</th>${cols.map(bpTableThHtml).join("")}</tr></thead>
          <tbody>${rows.map((r, i) => `<tr><td>${i + 1}</td>${cols.map(c => bpTableTdHtml(c, r)).join("")}</tr>`).join("")}</tbody>
        </table>
      </div>`;
}

function bpCompareForSort(a, b, type) {
    const blank = v => v === "" || v == null;
    if (type === "number") {
        const na = blank(a) ? Infinity : Number(a);
        const nb = blank(b) ? Infinity : Number(b);
        return na - nb;
    }
    if (type === "date") {
        const da = blank(a) ? "9999-99-99" : a;
        const db = blank(b) ? "9999-99-99" : b;
        return da < db ? -1 : da > db ? 1 : 0;
    }
    const sa = blank(a) ? "￿" : String(a).toLowerCase();
    const sb = blank(b) ? "￿" : String(b).toLowerCase();
    return sa < sb ? -1 : sa > sb ? 1 : 0;
}

function bpExportRowsToExcel(rows, cols, filenamePrefix) {
    if (typeof XLSX === "undefined") {
        if (typeof showToast === "function") showToast(t("creditreport.detail.excelLibFailed"), "error");
        return;
    }
    if (!rows.length) {
        if (typeof showToast === "function") showToast(t("creditreport.detail.nothingToExport"), "warning");
        return;
    }
    const sheetData = rows.map((r, i) => {
        const out = { [t("creditreport.productivity.colNo")]: i + 1 };
        cols.forEach(c => {
            const v = r[c.key];
            out[c.label] = c.type === "date" ? bpFmtDateDMY(v) : (v === "" || v == null ? "" : v);
        });
        return out;
    });
    const ws = XLSX.utils.json_to_sheet(sheetData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Clients");
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "");
    XLSX.writeFile(wb, `${filenamePrefix}_${stamp}.xlsx`);
}

// One-stop render for any client list on this page — a branch can carry
// far more clients per category than one officer would, so only the
// first BP_LIST_PAGE_SIZE (sorted) rows render at a time, with a "Show
// More" button revealing the next page; Export Excel always exports the
// FULL row set (in whatever order is currently sorted), not just what's
// currently visible. Re-renders the whole block on every sort/Show More
// click (simpler than patching just the tbody, and cheap at a 100-row
// page size).
//
// Column headers cycle through 3 states: ascending -> descending ->
// default (the order `rows` arrived in) -> ascending again. `rows`
// itself is never mutated — originalRows is a pristine snapshot taken
// once up front, and every render computes a sorted VIEW from it — so
// the "default" state always has an intact original order to return to.
function bpRenderClientListInto(container, rows, { arrears = false, showDate = true, filenamePrefix = "clients" } = {}) {
    const allCols = bpClientTableCols();
    const cols = arrears ? bpArrearsTableCols() : (showDate ? allCols : allCols.filter(c => c.key !== "disburseDate"));
    const buildTableHtml = arrears ? bpArrearsTableHtml : (rs => bpClientTableHtml(rs, { showDate }));

    const originalRows = rows.slice();
    let visibleCount = Math.min(BP_LIST_PAGE_SIZE, rows.length);
    let sortKey = null;
    let sortDir = 1;
    let sortType = "text";

    function getDisplayRows() {
        if (!sortKey) return originalRows;
        return originalRows.slice().sort((a, b) => sortDir * bpCompareForSort(a[sortKey], b[sortKey], sortType));
    }

    function render() {
        const displayRows = getDisplayRows();
        const visibleRows = displayRows.slice(0, visibleCount);
        const exportBtnHtml = rows.length
            ? `<div class="op-list-actions"><button type="button" class="op-list-export-btn">⬇ ${t("creditreport.menu.exportExcel")}</button></div>`
            : "";
        const countHtml = rows.length
            ? `<div class="op-list-count">${t("creditreport.productivity.showingXOfY", { shown: visibleRows.length.toLocaleString(), total: rows.length.toLocaleString() })}</div>`
            : "";
        const moreHtml = visibleCount < rows.length
            ? `<div class="op-list-more-wrap"><button type="button" class="op-list-more-btn">${t("creditreport.productivity.showMore")}</button></div>`
            : "";
        container.innerHTML = exportBtnHtml + buildTableHtml(visibleRows) + countHtml + moreHtml;
        if (!rows.length) return;

        const thead = container.querySelector("thead");
        if (thead) {
            thead.querySelectorAll("th[data-sort-key]").forEach(th => {
                if (th.dataset.sortKey === sortKey) th.classList.add(sortDir === 1 ? "op-sort-asc" : "op-sort-desc");
                th.addEventListener("click", () => {
                    const key = th.dataset.sortKey;
                    const type = th.dataset.sortType || "text";
                    if (sortKey !== key) {
                        sortKey = key; sortType = type; sortDir = 1;
                    } else if (sortDir === 1) {
                        sortDir = -1;
                    } else {
                        sortKey = null; sortType = "text"; sortDir = 1;
                    }
                    render();
                });
            });
        }

        container.querySelector(".op-list-export-btn")?.addEventListener("click", () => {
            bpExportRowsToExcel(getDisplayRows(), cols, filenamePrefix);
        });
        container.querySelector(".op-list-more-btn")?.addEventListener("click", () => {
            visibleCount = Math.min(visibleCount + BP_LIST_PAGE_SIZE, rows.length);
            render();
        });
    }

    render();
}

// ========================================
// LOAN DISBURSE — CALENDAR HEATMAP
// Same mechanism as Officer Productivity's own (opBuildDisburseHeatmapHtml
// etc.) — branch-wide (CO+FSRO+Digital Loan combined into one chart, not
// split into three), reused function-for-function under the bp prefix.
// ========================================
function bpHeatBucket(value, maxValue) {
    if (!value || value <= 0 || !maxValue) return 0;
    const pct = value / maxValue;
    if (pct > 0.7) return 4;
    if (pct > 0.45) return 3;
    if (pct > 0.2) return 2;
    return 1;
}

function bpHeatDow() {
    return [
        t("creditreport.compare.dowSun"), t("creditreport.compare.dowMon"), t("creditreport.compare.dowTue"),
        t("creditreport.compare.dowWed"), t("creditreport.compare.dowThu"), t("creditreport.compare.dowFri"),
        t("creditreport.compare.dowSat")
    ];
}

let bpKhHolidays = new Set();
let bpKhHolidaysPromise = null;
function bpEnsureKhHolidays() {
    if (!bpKhHolidaysPromise) {
        bpKhHolidaysPromise = fetch(`${API.BASE_URL}/api/creditreport/byco/kh-holidays`, {
            headers: { Authorization: `Bearer ${bpToken}` }
        })
            .then(res => res.json())
            .then(data => {
                if (data && data.ok && Array.isArray(data.holidays)) {
                    bpKhHolidays = new Set(data.holidays.map(h => h.date));
                }
            })
            .catch(err => console.error("kh-holidays fetch failed:", err));
    }
    return bpKhHolidaysPromise;
}

function bpBuildDisburseHeatmapHtml(dates, values, counts, branch, meta, totalData) {
    const maxValue = Math.max(0, ...values);
    const firstDow = new Date(dates[0] + "T00:00:00").getDay();

    let cells = bpHeatDow().map(d => `<div class="op-heat-dow">${d}</div>`).join("");
    for (let i = 0; i < firstDow; i++) cells += `<div class="op-heat-cell op-heat-pad"></div>`;

    dates.forEach((dateStr, i) => {
        const day = Number(dateStr.slice(8, 10));
        const value = values[i] || 0;
        const count = counts[i] || 0;
        const bucket = bpHeatBucket(value, maxValue);
        const dow = new Date(dateStr + "T00:00:00").getDay();

        const classes = ["op-heat-cell"];
        if (bucket) classes.push(`op-heat-h${bucket}`);
        if (dow === 0 || dow === 6) classes.push("op-heat-weekend");
        if (bpKhHolidays.has(dateStr)) classes.push("op-heat-holiday");

        cells += `
          <div class="${classes.join(" ")}"
               data-date="${dateStr}" data-value="${value}" data-count="${count}">
            <span class="op-heat-day">${day}</span>
            ${count > 0 ? `<span class="op-heat-badge">${count}</span>` : ""}
          </div>`;
    });

    const displayedMonthKey = dates[0].slice(0, 7);
    const isOriginalMonth = meta && meta.fromDate && displayedMonthKey === meta.fromDate.slice(0, 7);

    let period, totalLoan, totalValue;
    if (isOriginalMonth && meta.toDate) {
        period = `${bpFmtDateDDMMYY(meta.fromDate)}-${bpFmtDateDDMMYY(meta.toDate)}`;
        totalLoan = bpGet(totalData, "loanDisburse.loan");
        totalValue = bpGet(totalData, "loanDisburse.value");
    } else {
        period = `${bpFmtDateDDMMYY(dates[0])}-${bpFmtDateDDMMYY(dates[dates.length - 1])}`;
        totalLoan = counts.reduce((sum, c) => sum + (c || 0), 0);
        totalValue = values.reduce((sum, v) => sum + (v || 0), 0);
    }

    const monthLabel = new Date(dates[0] + "T00:00:00")
        .toLocaleString("en-US", { month: "long", year: "numeric" });

    return `
      <div class="op-heat-title">${t("creditreport.productivity.dailyLoanDisbursement")} — ${bpEscapeHtml(branch)}</div>
      <div class="op-heat-subtitle-group">
        <div class="op-heat-subtitle-line">${t("creditreport.productivity.periodDate")}: ${period}</div>
        <div class="op-heat-subtitle-line">${t("creditreport.productivity.totalDisburse")}: ${bpFmtNum(totalLoan)}LD, USD${bpFmtNum(totalValue)}</div>
      </div>
      <div class="op-heat-grid">${cells}</div>
      <div class="op-heat-legend">
        <span>${t("creditreport.productivity.less")}</span>
        <span class="op-heat-sw op-heat-h0"></span>
        <span class="op-heat-sw op-heat-h1"></span>
        <span class="op-heat-sw op-heat-h2"></span>
        <span class="op-heat-sw op-heat-h3"></span>
        <span class="op-heat-sw op-heat-h4"></span>
        <span>${t("creditreport.productivity.more")}</span>
      </div>
      <div class="op-heat-legend op-heat-legend-2">
        <span class="op-heat-sw op-heat-ring-weekend"></span><span>${t("creditreport.productivity.weekend")}</span>
        <span class="op-heat-sw op-heat-ring-holiday"></span><span>${t("creditreport.productivity.holiday")}</span>
      </div>
      <div class="op-heat-nav">
        <button type="button" class="op-heat-nav-btn" data-dir="prev" aria-label="${t("creditreport.compare.prevMonth")}">‹</button>
        <span class="op-heat-nav-label">${bpEscapeHtml(monthLabel)}</span>
        <button type="button" class="op-heat-nav-btn" data-dir="next" aria-label="${t("creditreport.compare.nextMonth")}">›</button>
      </div>
      <div class="op-heat-day-panel"></div>`;
}

function bpWireDisburseNav(container, onNavigate) {
    container.querySelectorAll(".op-heat-nav-btn").forEach(btn => {
        btn.addEventListener("click", e => {
            e.stopPropagation();
            onNavigate(btn.dataset.dir === "next" ? 1 : -1);
        });
    });
}

function bpShiftMonthKey(anchorKey, delta) {
    const [y, m] = anchorKey.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

let bpHeatTooltipEl = null;
function bpEnsureHeatTooltip() {
    if (!bpHeatTooltipEl) {
        bpHeatTooltipEl = document.createElement("div");
        bpHeatTooltipEl.className = "op-heat-tooltip";
        document.body.appendChild(bpHeatTooltipEl);
    }
    return bpHeatTooltipEl;
}

function bpShowHeatTooltip(cell, tooltip) {
    const date = cell.dataset.date;
    const value = Number(cell.dataset.value);
    const count = Number(cell.dataset.count);
    const [, mm, dd] = date.split("-");
    tooltip.innerHTML = `<span class="op-heat-tt-date">${dd}-${mm}:</span> ` + (
        value > 0 ? `${bpFmtNum(value)} · ${t("creditreport.productivity.loanCount", { count })}` : t("creditreport.productivity.noDisbursement")
    );
    tooltip.classList.add("show");
}

function bpWireHeatmapTooltips(container) {
    const tooltip = bpEnsureHeatTooltip();
    container.querySelectorAll(".op-heat-cell:not(.op-heat-pad)").forEach(cell => {
        cell.addEventListener("mouseenter", () => bpShowHeatTooltip(cell, tooltip));
        cell.addEventListener("mousemove", e => {
            tooltip.style.transform = "";
            tooltip.style.left = `${e.clientX + 14}px`;
            tooltip.style.top = `${e.clientY + 14}px`;
        });
        cell.addEventListener("mouseleave", () => tooltip.classList.remove("show"));
    });
}

// Unlike Officer Productivity's per-day panel (one officer, one bucket
// implicitly), a branch day's disbursements can span CO/FSRO/Digital
// Loan — the heatmap itself is combined, so the day-click panel fetches
// all three buckets in parallel and merges them, rather than adding a
// bucket-less "all" mode to the branch-clients endpoint just for this.
async function bpFetchDayClients(dateKey) {
    const q = bpBuildQuery({ ...bpState.meta, fromDate: dateKey, toDate: dateKey });
    const buckets = ["co", "fsro", "digital"];
    const results = await Promise.all(buckets.map(async bucket => {
        const url = `${API.BASE_URL}/api/creditreport/branch-clients?branch=${encodeURIComponent(bpState.branch)}` +
            `&section=disburse&bucket=${bucket}${q}`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${bpToken}` } });
        if (!res.ok) throw new Error(t("creditreport.productivity.dayClientsLoadFailedRetry"));
        const data = await res.json();
        if (!data.ok) throw new Error(data.message || t("creditreport.productivity.dayClientsLoadFailed"));
        return data.items || [];
    }));
    return results.flat();
}

function bpWireDayClientPanel(container) {
    const panel = container.querySelector(".op-heat-day-panel");
    if (!panel) return;
    let activeDate = null;

    container.querySelectorAll(".op-heat-cell:not(.op-heat-pad)").forEach(cell => {
        cell.addEventListener("click", async e => {
            e.stopPropagation();
            const date = cell.dataset.date;

            container.querySelectorAll(".op-heat-cell.op-heat-cell-selected")
                .forEach(c => c.classList.remove("op-heat-cell-selected"));

            if (activeDate === date) {
                activeDate = null;
                panel.innerHTML = "";
                return;
            }
            activeDate = date;
            cell.classList.add("op-heat-cell-selected");

            const [, mm, dd] = date.split("-");
            const count = Number(cell.dataset.count) || 0;
            const heading = `<div class="op-heat-day-panel-head">${dd}-${mm}: ${count} loan${count === 1 ? "" : "s"}</div>`;

            if (count === 0) {
                panel.innerHTML = `<div class="op-heat-day-panel-head">${dd}-${mm}: No disbursement</div>`;
                return;
            }

            panel.innerHTML = heading + bpSkeletonHtml();
            try {
                const rows = await bpFetchDayClients(date);
                if (activeDate !== date) return;
                panel.innerHTML = heading + `<div class="op-heat-day-panel-body"></div>`;
                bpRenderClientListInto(panel.querySelector(".op-heat-day-panel-body"), rows, {
                    showDate: false,
                    filenamePrefix: `${bpState.branch || "branch"}_disburse_${date}`
                });
            } catch (err) {
                if (activeDate !== date) return;
                panel.innerHTML = heading + bpErrorHtml(err);
            }
        });
    });
}

let bpDisburseChartAnchor = null;

async function bpFetchDisburseChartData(monthOverride) {
    const metaForQuery = monthOverride ? { ...bpState.meta, fromDate: monthOverride } : bpState.meta;
    const q = bpBuildQuery(metaForQuery);
    const url = `${API.BASE_URL}/api/creditreport/branch-disburse-chart?branch=${encodeURIComponent(bpState.branch)}${q}`;

    const holidaysReady = bpEnsureKhHolidays();

    const res = await fetch(url, { headers: { Authorization: `Bearer ${bpToken}` } });
    if (!res.ok) throw new Error(t("creditreport.productivity.chartLoadFailedRetry"));
    const data = await res.json();
    if (!data.ok) throw new Error(data.message || t("creditreport.productivity.chartLoadFailed"));
    await holidaysReady;

    const dates = data.dates || [];
    if (!dates.length) {
        bpDisburseChartData = null;
        return null;
    }
    bpDisburseChartData = { dates, values: data.values || [], counts: data.counts || [] };
    bpDisburseChartAnchor = `${dates[0].slice(0, 7)}-01`;
    return bpDisburseChartData;
}

function bpRenderDisburseHeatmapInto(container, fullscreen) {
    const { dates, values, counts } = bpDisburseChartData;
    const btnHtml = fullscreen
        ? ""
        : `<button type="button" class="op-chart-fullscreen-btn" aria-label="${t("creditreport.productivity.fullscreenChartAria")}">⛶</button>`;
    container.innerHTML = btnHtml + bpBuildDisburseHeatmapHtml(dates, values, counts, bpState.branch, bpState.meta, bpState.data?.total);

    bpWireHeatmapTooltips(container);
    bpWireDayClientPanel(container);
    if (!fullscreen) bpWireChartFullscreenTriggers(container);
    bpWireDisburseNav(container, delta => bpNavigateDisburseMonth(delta, container, fullscreen));
}

async function bpNavigateDisburseMonth(delta, container, fullscreen) {
    const newAnchor = bpShiftMonthKey(bpDisburseChartAnchor, delta);
    container.innerHTML = bpSkeletonHtml();
    try {
        const chartData = await bpFetchDisburseChartData(newAnchor);
        if (!chartData) {
            container.innerHTML = `<div class="op-state">No disbursement data for this period.</div>`;
            return;
        }
        bpRenderDisburseHeatmapInto(container, fullscreen);
    } catch (err) {
        container.innerHTML = bpErrorHtml(err);
    }
}

async function bpRenderDisburseChart(wrap) {
    const chartData = await bpFetchDisburseChartData();
    if (!chartData) {
        wrap.innerHTML = `<div class="op-state">No disbursement data for this period.</div>`;
        return;
    }
    bpRenderDisburseHeatmapInto(wrap, false);
}

function bpWireChartFullscreenTriggers(wrap) {
    wrap.addEventListener("click", bpOpenChartFullscreen);
}

async function bpOpenChartFullscreen() {
    if (!bpDisburseChartData) return;
    const overlay = document.getElementById("bpChartFsOverlay");
    const body = document.getElementById("bpChartFsBody");
    if (!overlay || !body) return;

    overlay.hidden = false;
    document.body.style.overflow = "hidden";

    bpRenderDisburseHeatmapInto(body, true);

    try {
        if (overlay.requestFullscreen) await overlay.requestFullscreen();
        else if (overlay.webkitRequestFullscreen) overlay.webkitRequestFullscreen();
    } catch (e) { /* not supported / denied — the CSS overlay alone still works */ }
}

function bpCloseChartFullscreen() {
    const overlay = document.getElementById("bpChartFsOverlay");
    if (!overlay || overlay.hidden) return;

    overlay.hidden = true;
    document.body.style.overflow = "";

    if (document.fullscreenElement === overlay) {
        try { document.exitFullscreen(); } catch (e) { /* no-op */ }
    }
}

document.getElementById("bpChartFsClose")?.addEventListener("click", bpCloseChartFullscreen);

document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement) bpCloseChartFullscreen();
});

// ========================================
// INIT
// ========================================
function bpFinishLoad() {
    document.getElementById("bpPageSkel").style.display = "none";
    bpRenderHeader();
    bpRenderCards();
}

function bpShowEmpty(msg) {
    document.getElementById("bpPageSkel").style.display = "none";
    const el = document.getElementById("bpEmpty");
    el.textContent = msg;
    el.style.display = "block";
}

async function bpInit() {
    const { branch, meta } = bpReadParams();
    bpState.meta = meta;

    if (!branch) {
        bpShowEmpty(t("creditreport.productivity.noBranchSpecified"));
        return;
    }
    bpState.branch = branch;

    try {
        const data = await bpFetchSummary(branch, meta);
        bpState.data = data;
        bpFinishLoad();
    } catch (err) {
        console.error(err);
        bpShowEmpty(err.message || t("creditreport.productivity.networkErrorBranchData"));
    }
}

bpInit();
