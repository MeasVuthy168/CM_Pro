// ========================================
// PRODUCT PERFORMANCE — per-product drill-down from
// RepDetailbyProduct.html (click a product name there to land here).
//
// CO / FSRO breakdown — every category splits the same way, just scoped
// by product instead of branch. No Digital Loan bucket here (removed
// 2026-09-29 per explicit request): unlike Branch Productivity, which
// keeps its own 3-way CO/FSRO/Digital split, every row that isn't FSRO
// counts as CO. CM-backend's lib/creditreport-product.js
// computeProductPerformance() reuses the exact same column indices
// already confirmed in lib/creditreport-branch.js for these 5 sheets.
//
// Like Branch Productivity, there's no "already-fetched" instant-paint
// handoff: RepDetailbyProduct.js's own report only ever holds each
// product's combined Total, never the CO/FSRO breakdown, so this page
// always fetches its own summary on load (URL query string only —
// product name + the report's current date filters — no sessionStorage
// cache needed).
//
// BACKEND ENDPOINTS (CM-backend's lib/creditreport-product.js)
//   GET /api/creditreport/product-performance-summary
//     ?product=<name>&fromDate=&toDate=&woFromDate=&woToDate=
//   -> { ok, product, meta, co, fsro, total }
//   Each of co/fsro/total has the same shape:
//     { loanOutstanding:{loan,client,value}, loanDisburse:{loan,value},
//       parT24:{loan,value,parPct}, nbcOverdue:{...8 keys...},
//       writeOff:{balanceWO,wo,woCollected} }
//
//   GET /api/creditreport/product-clients
//     ?product=<name>&section=<outstanding|disburse|parT24|nbcOverdue|
//               writeOff>&bucket=<co|fsro>
//     &fromDate=&toDate=&woFromDate=&woToDate=
//   -> { ok, items: [...] } — same row shape as Branch Productivity's
//      branch-clients (see that file's own header comment for the full
//      field-by-field breakdown).
//
//   GET /api/creditreport/product-disburse-chart
//     ?product=<name>&fromDate=
//   -> { ok, labels, dates, values, counts }
//   Product-wide daily disbursement (CO+FSRO combined — one chart, not
//   two), same mechanism as branch-disburse-chart.
//
//   GET /api/creditreport/byco/kh-holidays — reused as-is (not
//   product-specific), same as Branch/Officer Productivity.
//
// CLIENT LIST PAGINATION — same "Show More" pagination as Branch
// Productivity (a product can carry far more clients under one category
// than a single officer would) — see ppRenderClientListInto().
// ========================================

const PP_CATEGORIES = [
    {
        key: "outstanding",
        icon: "📊",
        label: "Loan Outstanding",
        chart: false,
        statGroups: [
            { label: "Total", total: true, fields: [
                { key: "total.loanOutstanding.loan", label: "Loan" },
                { key: "total.loanOutstanding.client", label: "Client" },
                { key: "total.loanOutstanding.value", label: "Value", money: true }
            ] },
            { label: "CO", fields: [
                { key: "co.loanOutstanding.loan", label: "Loan" },
                { key: "co.loanOutstanding.client", label: "Client" },
                { key: "co.loanOutstanding.value", label: "Value", money: true }
            ] },
            { label: "FSRO", fields: [
                { key: "fsro.loanOutstanding.loan", label: "Loan" },
                { key: "fsro.loanOutstanding.client", label: "Client" },
                { key: "fsro.loanOutstanding.value", label: "Value", money: true }
            ] }
        ],
        clientLists: [
            { bucket: "co", label: "CO" },
            { bucket: "fsro", label: "FSRO" }
        ]
    },
    {
        key: "disburse",
        icon: "💵",
        label: "Loan Disburse",
        chart: true,
        statGroups: [
            { label: "Total", total: true, fields: [
                { key: "total.loanDisburse.loan", label: "Loan" },
                { key: "total.loanDisburse.value", label: "Value", money: true }
            ] },
            { label: "CO", fields: [
                { key: "co.loanDisburse.loan", label: "Loan" },
                { key: "co.loanDisburse.value", label: "Value", money: true }
            ] },
            { label: "FSRO", fields: [
                { key: "fsro.loanDisburse.loan", label: "Loan" },
                { key: "fsro.loanDisburse.value", label: "Value", money: true }
            ] }
        ],
        clientLists: [
            { bucket: "co", label: "CO" },
            { bucket: "fsro", label: "FSRO" }
        ]
    },
    {
        key: "parT24",
        icon: "📈",
        label: "Balance Loan at Risk (T24)",
        chart: false,
        statGroups: [
            { label: "Total", total: true, fields: [
                { key: "total.parT24.loan", label: "Loan" },
                { key: "total.parT24.value", label: "Value", money: true },
                { key: "total.parT24.parPct", label: "PAR", pct: true }
            ] },
            { label: "CO", fields: [
                { key: "co.parT24.loan", label: "Loan" },
                { key: "co.parT24.value", label: "Value", money: true },
                { key: "co.parT24.parPct", label: "PAR", pct: true }
            ] },
            { label: "FSRO", fields: [
                { key: "fsro.parT24.loan", label: "Loan" },
                { key: "fsro.parT24.value", label: "Value", money: true },
                { key: "fsro.parT24.parPct", label: "PAR", pct: true }
            ] }
        ],
        clientLists: [
            { bucket: "co", label: "CO" },
            { bucket: "fsro", label: "FSRO" }
        ]
    },
    {
        key: "nbcOverdue",
        icon: "⚠️",
        label: "Balance Loan at Risk (NBC Overdue)",
        chart: false,
        statGroups: [
            { label: "Total", total: true, fields: [
                { key: "total.nbcOverdue.total.count", label: "Loan" },
                { key: "total.nbcOverdue.total.value", label: "Value", money: true },
                { key: "total.nbcOverdue.total.parPct", label: "PAR", pct: true }
            ] },
            { label: "CO", fields: [
                { key: "co.nbcOverdue.total.count", label: "Loan" },
                { key: "co.nbcOverdue.total.value", label: "Value", money: true },
                { key: "co.nbcOverdue.total.parPct", label: "PAR", pct: true }
            ] },
            { label: "FSRO", fields: [
                { key: "fsro.nbcOverdue.total.count", label: "Loan" },
                { key: "fsro.nbcOverdue.total.value", label: "Value", money: true },
                { key: "fsro.nbcOverdue.total.parPct", label: "PAR", pct: true }
            ] }
        ],
        clientLists: [
            { bucket: "co", label: "CO" },
            { bucket: "fsro", label: "FSRO" }
        ]
    },
    {
        key: "writeOff",
        icon: "✂️",
        label: "Write Off",
        chart: false,
        statGroups: [
            { label: "Total", total: true, fields: [
                { key: "total.writeOff.wo.count", label: "Loan" },
                { key: "total.writeOff.wo.prn", label: "Prn", money: true }
            ] },
            { label: "CO", fields: [
                { key: "co.writeOff.wo.count", label: "Loan" },
                { key: "co.writeOff.wo.prn", label: "Prn", money: true }
            ] },
            { label: "FSRO", fields: [
                { key: "fsro.writeOff.wo.count", label: "Loan" },
                { key: "fsro.writeOff.wo.prn", label: "Prn", money: true }
            ] }
        ],
        clientLists: [
            { bucket: "co", label: "CO" },
            { bucket: "fsro", label: "FSRO" }
        ]
    }
];

const PP_LIST_PAGE_SIZE = 100;

const ppToken =
    localStorage.getItem("token") ||
    sessionStorage.getItem("token");

let ppState = { product: null, meta: null, data: null };

// Last-fetched Loan Disburse heatmap data — kept around so the
// fullscreen view can re-render without re-fetching.
let ppDisburseChartData = null;

// ========================================
// HELPERS
// ========================================
function ppGet(obj, path) {
    return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function ppFmtNum(n) {
    n = Number(n) || 0;
    return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}
function ppFmtPct(n) {
    n = Number(n) || 0;
    return (n * 100).toFixed(2) + "%";
}
function ppFmtDateDMY(s) {
    if (!s) return "-";
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (!m) return s;
    return `${m[3]}-${m[2]}-${m[1]}`;
}
function ppFmtDateDDMMYY(s) {
    if (!s) return "-";
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (!m) return s;
    return `${m[3]}/${m[2]}/${m[1].slice(2)}`;
}
function ppToDMY(yyyymmdd) {
    const [y, m, d] = yyyymmdd.split("-");
    return `${d}-${m}-${y}`;
}
function ppEscapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text == null ? "" : String(text);
    return div.innerHTML;
}
function ppSkeletonHtml() {
    return `<div class="op-skel-line" style="width:90%"></div>
             <div class="op-skel-line" style="width:75%"></div>
             <div class="op-skel-line" style="width:82%"></div>`;
}
function ppErrorHtml(err) {
    return `<div class="op-state op-state-error">${ppEscapeHtml((err && err.message) || "Something went wrong.")}</div>`;
}

// ========================================
// READ PRODUCT + FILTERS FROM THE URL
// ========================================
function ppReadParams() {
    const params = new URLSearchParams(location.search);
    return {
        product: params.get("product") || "",
        meta: {
            fromDate: params.get("fromDate") || "",
            toDate: params.get("toDate") || "",
            woFromDate: params.get("woFromDate") || "",
            woToDate: params.get("woToDate") || ""
        }
    };
}

function ppBuildQuery(meta) {
    const parts = [];
    if (meta.fromDate) parts.push(`fromDate=${ppToDMY(meta.fromDate)}`);
    if (meta.toDate) parts.push(`toDate=${ppToDMY(meta.toDate)}`);
    if (meta.woFromDate) parts.push(`woFromDate=${ppToDMY(meta.woFromDate)}`);
    if (meta.woToDate) parts.push(`woToDate=${ppToDMY(meta.woToDate)}`);
    return parts.length ? `&${parts.join("&")}` : "";
}

async function ppFetchSummary(product, meta) {
    const url = `${API.BASE_URL}/api/creditreport/product-performance-summary?product=${encodeURIComponent(product)}${ppBuildQuery(meta)}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${ppToken}` } });
    const data = await res.json();
    if (!data.ok) throw new Error(data.message || "Failed to load product data.");
    return data;
}

// ========================================
// RENDER — HEADER + CARDS
// ========================================
function ppRenderHeader() {
    const product = ppState.product;
    const meta = ppState.meta;

    document.getElementById("ppAvatar").textContent =
        (product || "?").trim().charAt(0).toUpperCase() || "?";
    document.getElementById("ppProductName").textContent = product || "-";

    const chips = [];
    if (meta.fromDate && meta.toDate) {
        chips.push(`${ppFmtDateDMY(meta.fromDate)} – ${ppFmtDateDMY(meta.toDate)}`);
    }
    document.getElementById("ppProductMeta").innerHTML =
        chips.map(c => `<span class="op-meta-chip">${ppEscapeHtml(c)}</span>`).join("");

    document.getElementById("ppHeaderCard").style.display = "flex";
}

function ppStatFieldHtml(f, data) {
    const v = ppGet(data, f.key);
    const text = f.pct ? ppFmtPct(v) : ppFmtNum(v);
    return `<span>${ppEscapeHtml(f.label)}: <b>${text}</b></span>`;
}
function ppStatGroupHtml(g, data) {
    return `
      <div class="op-card-stats">
        <span class="op-card-stats-group-label">${ppEscapeHtml(g.label)}:</span>
        ${g.fields.map(f => ppStatFieldHtml(f, data)).join("")}
      </div>`;
}
// The Total row always shows; CO/FSRO only reveal once the card is
// expanded (see .bp-card-stats-buckets in BranchProductivity.css, reused
// here as-is).
function ppCardStatsHtml(cat, data) {
    const totalHtml = cat.statGroups.filter(g => g.total).map(g => ppStatGroupHtml(g, data)).join("");
    const bucketHtml = cat.statGroups.filter(g => !g.total).map(g => ppStatGroupHtml(g, data)).join("");
    return `${totalHtml}<div class="bp-card-stats-buckets">${bucketHtml}</div>`;
}

function ppCardMarkup(cat, data) {
    const listTabsHtml = cat.clientLists.map((cl, i) =>
        `<button type="button" class="op-mode-tab${i === 0 ? " active" : ""}" data-mode="list:${cl.bucket}">👥 List of Client ${ppEscapeHtml(cl.label)}</button>`
    ).join("");

    const chartTabHtml = cat.chart
        ? `<button type="button" class="op-mode-tab" data-mode="chart">📈 Chart</button>`
        : "";

    return `
      <div class="op-card" data-key="${cat.key}">
        <button type="button" class="op-card-head" aria-expanded="false">
          <div class="op-card-icon">${cat.icon}</div>
          <div class="op-card-title">
            <div class="op-card-label">${ppEscapeHtml(cat.label)}</div>
            ${ppCardStatsHtml(cat, data)}
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

function ppRenderCards() {
    const wrap = document.getElementById("ppCards");
    wrap.innerHTML = PP_CATEGORIES.map(cat => ppCardMarkup(cat, ppState.data)).join("");
    wrap.style.display = "flex";
    ppFitStatsToWidth();
}

// ========================================
// FIT STATS ROWS TO SCREEN WIDTH
// Same rationale as Branch Productivity's own bpFitStatsToWidth().
// ========================================
function ppFitStatsToWidth() {
    const rows = document.querySelectorAll("#ppCards .op-card-stats");
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

let ppFitResizeTimer;
window.addEventListener("resize", () => {
    clearTimeout(ppFitResizeTimer);
    ppFitResizeTimer = setTimeout(ppFitStatsToWidth, 150);
});

// ========================================
// ACCORDION + MODE SWITCHING
// ========================================
document.getElementById("ppCards").addEventListener("click", (e) => {
    const head = e.target.closest(".op-card-head");
    if (head) {
        const card = head.closest(".op-card");
        const willOpen = !card.classList.contains("open");
        document.querySelectorAll("#ppCards .op-card.open").forEach(c => {
            if (c !== card) { c.classList.remove("open"); c.querySelector(".op-card-head").setAttribute("aria-expanded", "false"); }
        });
        card.classList.toggle("open", willOpen);
        head.setAttribute("aria-expanded", willOpen ? "true" : "false");
        // CO/FSRO rows are hidden until expanded, so they were skipped by
        // the last width-fit pass — measure them now that they're
        // visible.
        ppFitStatsToWidth();
        if (willOpen) {
            const activeTab = card.querySelector(".op-mode-tab.active");
            ppEnsureModeLoaded(card, activeTab ? activeTab.dataset.mode : "list");
        }
        return;
    }

    const tab = e.target.closest(".op-mode-tab");
    if (tab) {
        const card = tab.closest(".op-card");
        card.querySelectorAll(".op-mode-tab").forEach(t => t.classList.remove("active"));
        tab.classList.add("active");
        ppEnsureModeLoaded(card, tab.dataset.mode);
    }
});

async function ppEnsureModeLoaded(card, mode) {
    const key = card.dataset.key;
    const body = card.querySelector("[data-mode-body]");

    if (mode.startsWith("list:")) {
        const bucket = mode.slice(5);
        card._ppListCache = card._ppListCache || {};
        const renderOpts = {
            arrears: PP_ARREARS_CATEGORIES.has(key),
            filenamePrefix: `${ppState.product || "product"}_${key}_${bucket}`
        };
        if (card._ppListCache[mode]) {
            ppRenderClientListInto(body, card._ppListCache[mode], renderOpts);
            return;
        }
        body.innerHTML = ppSkeletonHtml();
        try {
            const rows = await ppFetchClientListRows(key, bucket);
            card._ppListCache[mode] = rows;
            ppRenderClientListInto(body, rows, renderOpts);
        } catch (err) {
            body.innerHTML = ppErrorHtml(err);
        }
        return;
    }

    // Chart (calendar heatmap) — always re-fetches/re-renders on reselect,
    // same rationale as Branch Productivity's own chart tab.
    body.innerHTML = `<div class="op-chart-wrap">${ppSkeletonHtml()}</div>`;
    const chartWrap = body.querySelector(".op-chart-wrap");
    try {
        await ppRenderDisburseChart(chartWrap);
    } catch (err) {
        chartWrap.innerHTML = ppErrorHtml(err);
    }
}

// parT24 and NBC Overdue's client lists use the richer arrears-style
// table (ppArrearsTableHtml) instead of the generic one — same
// convention as Branch Productivity's BP_ARREARS_CATEGORIES.
const PP_ARREARS_CATEGORIES = new Set(["parT24", "nbcOverdue"]);

async function ppFetchClientListRows(section, bucket) {
    const q = ppBuildQuery(ppState.meta);
    const url = `${API.BASE_URL}/api/creditreport/product-clients?product=${encodeURIComponent(ppState.product)}` +
        `&section=${encodeURIComponent(section)}&bucket=${encodeURIComponent(bucket)}${q}`;

    const res = await fetch(url, { headers: { Authorization: `Bearer ${ppToken}` } });
    if (!res.ok) throw new Error("Could not load the client list. Please try again.");
    const data = await res.json();
    if (!data.ok) throw new Error(data.message || "Could not load the client list.");
    return data.items || [];
}

// ---- Column specs (same shape as Branch Productivity's own) ----
const PP_CLIENT_TABLE_COLS = [
    { key: "name", label: "Name", type: "text" },
    { key: "cif", label: "CIF", type: "text" },
    { key: "loanNumber", label: "Loan Number", type: "text" },
    { key: "disburseDate", label: "Disburse Date", type: "date" },
    { key: "address", label: "Address", type: "text" },
    { key: "loanSize", label: "Loan Size", type: "number" },
    { key: "osUsd", label: "OS USD", type: "number" }
];

const PP_ARREARS_TABLE_COLS = [
    { key: "name", label: "Customer", type: "text" },
    { key: "loanNumber", label: "Loan Number", type: "text" },
    { key: "class", label: "Class", type: "text" },
    { key: "address", label: "Location", type: "text" },
    { key: "disburseDate", label: "DisDate", type: "date" },
    { key: "prnOS", label: "Prn.OS", type: "number" },
    { key: "intOS", label: "Int.OS", type: "number" },
    { key: "prnDue", label: "Prn.Due", type: "number" },
    { key: "intDue", label: "Int.Due", type: "number" },
    { key: "penalty", label: "Penalty", type: "number" },
    { key: "arreas", label: "Arreas", type: "number" },
    { key: "day", label: "Day", type: "number" },
    { key: "balance", label: "Balnce", type: "number" },
    { key: "accountLoan", label: "Account Loan", type: "text" },
    { key: "cif", label: "CIF", type: "text" }
];

function ppTableThHtml(col) {
    return `<th data-sort-key="${col.key}" data-sort-type="${col.type}">${ppEscapeHtml(col.label)}</th>`;
}
function ppTableTdHtml(col, row) {
    const v = row[col.key];
    if (v === "" || v == null) return "<td></td>";
    if (col.type === "number") return `<td>${ppEscapeHtml(ppFmtNum(v))}</td>`;
    if (col.type === "date") return `<td>${ppEscapeHtml(ppFmtDateDMY(v))}</td>`;
    return `<td>${ppEscapeHtml(v)}</td>`;
}

function ppClientTableHtml(rows, { showDate = true } = {}) {
    if (!rows.length) return `<div class="op-state">No clients found for this category.</div>`;
    const cols = showDate ? PP_CLIENT_TABLE_COLS : PP_CLIENT_TABLE_COLS.filter(c => c.key !== "disburseDate");
    return `
      <div class="op-client-table-wrap">
        <table class="op-client-table">
          <thead><tr>${cols.map(ppTableThHtml).join("")}</tr></thead>
          <tbody>${rows.map(r => `<tr>${cols.map(c => ppTableTdHtml(c, r)).join("")}</tr>`).join("")}</tbody>
        </table>
      </div>`;
}

function ppArrearsTableHtml(rows) {
    if (!rows.length) return `<div class="op-state">No clients found for this category.</div>`;
    return `
      <div class="op-client-table-wrap">
        <table class="op-client-table">
          <thead><tr><th>No</th>${PP_ARREARS_TABLE_COLS.map(ppTableThHtml).join("")}</tr></thead>
          <tbody>${rows.map((r, i) => `<tr><td>${i + 1}</td>${PP_ARREARS_TABLE_COLS.map(c => ppTableTdHtml(c, r)).join("")}</tr>`).join("")}</tbody>
        </table>
      </div>`;
}

function ppCompareForSort(a, b, type) {
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

function ppExportRowsToExcel(rows, cols, filenamePrefix) {
    if (typeof XLSX === "undefined") {
        if (typeof showToast === "function") showToast("Excel export library failed to load.", "error");
        return;
    }
    if (!rows.length) {
        if (typeof showToast === "function") showToast("Nothing to export.", "warning");
        return;
    }
    const sheetData = rows.map((r, i) => {
        const out = { No: i + 1 };
        cols.forEach(c => {
            const v = r[c.key];
            out[c.label] = c.type === "date" ? ppFmtDateDMY(v) : (v === "" || v == null ? "" : v);
        });
        return out;
    });
    const ws = XLSX.utils.json_to_sheet(sheetData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Clients");
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "");
    XLSX.writeFile(wb, `${filenamePrefix}_${stamp}.xlsx`);
}

// One-stop render for any client list on this page — same "Show More"
// pagination as Branch Productivity's own bpRenderClientListInto().
//
// Column headers cycle through 3 states: ascending -> descending ->
// default (the order `rows` arrived in) -> ascending again. `rows`
// itself is never mutated — originalRows is a pristine snapshot taken
// once up front, and every render computes a sorted VIEW from it — so
// the "default" state always has an intact original order to return to.
function ppRenderClientListInto(container, rows, { arrears = false, showDate = true, filenamePrefix = "clients" } = {}) {
    const cols = arrears ? PP_ARREARS_TABLE_COLS : (showDate ? PP_CLIENT_TABLE_COLS : PP_CLIENT_TABLE_COLS.filter(c => c.key !== "disburseDate"));
    const buildTableHtml = arrears ? ppArrearsTableHtml : (rs => ppClientTableHtml(rs, { showDate }));

    const originalRows = rows.slice();
    let visibleCount = Math.min(PP_LIST_PAGE_SIZE, rows.length);
    let sortKey = null;
    let sortDir = 1;
    let sortType = "text";

    function getDisplayRows() {
        if (!sortKey) return originalRows;
        return originalRows.slice().sort((a, b) => sortDir * ppCompareForSort(a[sortKey], b[sortKey], sortType));
    }

    function render() {
        const displayRows = getDisplayRows();
        const visibleRows = displayRows.slice(0, visibleCount);
        const exportBtnHtml = rows.length
            ? `<div class="op-list-actions"><button type="button" class="op-list-export-btn">⬇ Export Excel</button></div>`
            : "";
        const countHtml = rows.length
            ? `<div class="op-list-count">Showing ${visibleRows.length.toLocaleString()} of ${rows.length.toLocaleString()}</div>`
            : "";
        const moreHtml = visibleCount < rows.length
            ? `<div class="op-list-more-wrap"><button type="button" class="op-list-more-btn">Show More</button></div>`
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
            ppExportRowsToExcel(getDisplayRows(), cols, filenamePrefix);
        });
        container.querySelector(".op-list-more-btn")?.addEventListener("click", () => {
            visibleCount = Math.min(visibleCount + PP_LIST_PAGE_SIZE, rows.length);
            render();
        });
    }

    render();
}

// ========================================
// LOAN DISBURSE — CALENDAR HEATMAP
// Same mechanism as Branch Productivity's own (bpBuildDisburseHeatmapHtml
// etc.) — product-wide (CO+FSRO combined into one chart, not split in
// two), reused function-for-function under the pp prefix.
// ========================================
function ppHeatBucket(value, maxValue) {
    if (!value || value <= 0 || !maxValue) return 0;
    const pct = value / maxValue;
    if (pct > 0.7) return 4;
    if (pct > 0.45) return 3;
    if (pct > 0.2) return 2;
    return 1;
}

const PP_HEAT_DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

let ppKhHolidays = new Set();
let ppKhHolidaysPromise = null;
function ppEnsureKhHolidays() {
    if (!ppKhHolidaysPromise) {
        ppKhHolidaysPromise = fetch(`${API.BASE_URL}/api/creditreport/byco/kh-holidays`, {
            headers: { Authorization: `Bearer ${ppToken}` }
        })
            .then(res => res.json())
            .then(data => {
                if (data && data.ok && Array.isArray(data.holidays)) {
                    ppKhHolidays = new Set(data.holidays.map(h => h.date));
                }
            })
            .catch(err => console.error("kh-holidays fetch failed:", err));
    }
    return ppKhHolidaysPromise;
}

function ppBuildDisburseHeatmapHtml(dates, values, counts, product, meta, totalData) {
    const maxValue = Math.max(0, ...values);
    const firstDow = new Date(dates[0] + "T00:00:00").getDay();

    let cells = PP_HEAT_DOW.map(d => `<div class="op-heat-dow">${d}</div>`).join("");
    for (let i = 0; i < firstDow; i++) cells += `<div class="op-heat-cell op-heat-pad"></div>`;

    dates.forEach((dateStr, i) => {
        const day = Number(dateStr.slice(8, 10));
        const value = values[i] || 0;
        const count = counts[i] || 0;
        const bucket = ppHeatBucket(value, maxValue);
        const dow = new Date(dateStr + "T00:00:00").getDay();

        const classes = ["op-heat-cell"];
        if (bucket) classes.push(`op-heat-h${bucket}`);
        if (dow === 0 || dow === 6) classes.push("op-heat-weekend");
        if (ppKhHolidays.has(dateStr)) classes.push("op-heat-holiday");

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
        period = `${ppFmtDateDDMMYY(meta.fromDate)}-${ppFmtDateDDMMYY(meta.toDate)}`;
        totalLoan = ppGet(totalData, "loanDisburse.loan");
        totalValue = ppGet(totalData, "loanDisburse.value");
    } else {
        period = `${ppFmtDateDDMMYY(dates[0])}-${ppFmtDateDDMMYY(dates[dates.length - 1])}`;
        totalLoan = counts.reduce((sum, c) => sum + (c || 0), 0);
        totalValue = values.reduce((sum, v) => sum + (v || 0), 0);
    }

    const monthLabel = new Date(dates[0] + "T00:00:00")
        .toLocaleString("en-US", { month: "long", year: "numeric" });

    return `
      <div class="op-heat-title">Daily Loan Disbursement — ${ppEscapeHtml(product)}</div>
      <div class="op-heat-subtitle-group">
        <div class="op-heat-subtitle-line">Period Date: ${period}</div>
        <div class="op-heat-subtitle-line">Total  Disburse: ${ppFmtNum(totalLoan)}LD, USD${ppFmtNum(totalValue)}</div>
      </div>
      <div class="op-heat-grid">${cells}</div>
      <div class="op-heat-legend">
        <span>Less</span>
        <span class="op-heat-sw op-heat-h0"></span>
        <span class="op-heat-sw op-heat-h1"></span>
        <span class="op-heat-sw op-heat-h2"></span>
        <span class="op-heat-sw op-heat-h3"></span>
        <span class="op-heat-sw op-heat-h4"></span>
        <span>More</span>
      </div>
      <div class="op-heat-legend op-heat-legend-2">
        <span class="op-heat-sw op-heat-ring-weekend"></span><span>Weekend</span>
        <span class="op-heat-sw op-heat-ring-holiday"></span><span>Holiday</span>
      </div>
      <div class="op-heat-nav">
        <button type="button" class="op-heat-nav-btn" data-dir="prev" aria-label="Previous month">‹</button>
        <span class="op-heat-nav-label">${ppEscapeHtml(monthLabel)}</span>
        <button type="button" class="op-heat-nav-btn" data-dir="next" aria-label="Next month">›</button>
      </div>
      <div class="op-heat-day-panel"></div>`;
}

function ppWireDisburseNav(container, onNavigate) {
    container.querySelectorAll(".op-heat-nav-btn").forEach(btn => {
        btn.addEventListener("click", e => {
            e.stopPropagation();
            onNavigate(btn.dataset.dir === "next" ? 1 : -1);
        });
    });
}

function ppShiftMonthKey(anchorKey, delta) {
    const [y, m] = anchorKey.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

let ppHeatTooltipEl = null;
function ppEnsureHeatTooltip() {
    if (!ppHeatTooltipEl) {
        ppHeatTooltipEl = document.createElement("div");
        ppHeatTooltipEl.className = "op-heat-tooltip";
        document.body.appendChild(ppHeatTooltipEl);
    }
    return ppHeatTooltipEl;
}

function ppShowHeatTooltip(cell, tooltip) {
    const date = cell.dataset.date;
    const value = Number(cell.dataset.value);
    const count = Number(cell.dataset.count);
    const [, mm, dd] = date.split("-");
    tooltip.innerHTML = `<span class="op-heat-tt-date">${dd}-${mm}:</span> ` + (
        value > 0 ? `${ppFmtNum(value)} · ${count} loan${count > 1 ? "s" : ""}` : "No disbursement"
    );
    tooltip.classList.add("show");
}

function ppWireHeatmapTooltips(container) {
    const tooltip = ppEnsureHeatTooltip();
    container.querySelectorAll(".op-heat-cell:not(.op-heat-pad)").forEach(cell => {
        cell.addEventListener("mouseenter", () => ppShowHeatTooltip(cell, tooltip));
        cell.addEventListener("mousemove", e => {
            tooltip.style.transform = "";
            tooltip.style.left = `${e.clientX + 14}px`;
            tooltip.style.top = `${e.clientY + 14}px`;
        });
        cell.addEventListener("mouseleave", () => tooltip.classList.remove("show"));
    });
}

// Unlike Officer Productivity's per-day panel (one officer, one bucket
// implicitly), a product day's disbursements can span CO/FSRO — the
// heatmap itself is combined, so the day-click panel fetches both
// buckets in parallel and merges them, rather than adding a bucket-less
// "all" mode to the product-clients endpoint just for this.
async function ppFetchDayClients(dateKey) {
    const q = ppBuildQuery({ ...ppState.meta, fromDate: dateKey, toDate: dateKey });
    const buckets = ["co", "fsro"];
    const results = await Promise.all(buckets.map(async bucket => {
        const url = `${API.BASE_URL}/api/creditreport/product-clients?product=${encodeURIComponent(ppState.product)}` +
            `&section=disburse&bucket=${bucket}${q}`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${ppToken}` } });
        if (!res.ok) throw new Error("Could not load clients for this day. Please try again.");
        const data = await res.json();
        if (!data.ok) throw new Error(data.message || "Could not load clients for this day.");
        return data.items || [];
    }));
    return results.flat();
}

function ppWireDayClientPanel(container) {
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

            panel.innerHTML = heading + ppSkeletonHtml();
            try {
                const rows = await ppFetchDayClients(date);
                if (activeDate !== date) return;
                panel.innerHTML = heading + `<div class="op-heat-day-panel-body"></div>`;
                ppRenderClientListInto(panel.querySelector(".op-heat-day-panel-body"), rows, {
                    showDate: false,
                    filenamePrefix: `${ppState.product || "product"}_disburse_${date}`
                });
            } catch (err) {
                if (activeDate !== date) return;
                panel.innerHTML = heading + ppErrorHtml(err);
            }
        });
    });
}

let ppDisburseChartAnchor = null;

async function ppFetchDisburseChartData(monthOverride) {
    const metaForQuery = monthOverride ? { ...ppState.meta, fromDate: monthOverride } : ppState.meta;
    const q = ppBuildQuery(metaForQuery);
    const url = `${API.BASE_URL}/api/creditreport/product-disburse-chart?product=${encodeURIComponent(ppState.product)}${q}`;

    const holidaysReady = ppEnsureKhHolidays();

    const res = await fetch(url, { headers: { Authorization: `Bearer ${ppToken}` } });
    if (!res.ok) throw new Error("Could not load the disbursement chart. Please try again.");
    const data = await res.json();
    if (!data.ok) throw new Error(data.message || "Could not load the disbursement chart.");
    await holidaysReady;

    const dates = data.dates || [];
    if (!dates.length) {
        ppDisburseChartData = null;
        return null;
    }
    ppDisburseChartData = { dates, values: data.values || [], counts: data.counts || [] };
    ppDisburseChartAnchor = `${dates[0].slice(0, 7)}-01`;
    return ppDisburseChartData;
}

function ppRenderDisburseHeatmapInto(container, fullscreen) {
    const { dates, values, counts } = ppDisburseChartData;
    const btnHtml = fullscreen
        ? ""
        : `<button type="button" class="op-chart-fullscreen-btn" aria-label="Fullscreen chart">⛶</button>`;
    container.innerHTML = btnHtml + ppBuildDisburseHeatmapHtml(dates, values, counts, ppState.product, ppState.meta, ppState.data?.total);

    ppWireHeatmapTooltips(container);
    ppWireDayClientPanel(container);
    if (!fullscreen) ppWireChartFullscreenTriggers(container);
    ppWireDisburseNav(container, delta => ppNavigateDisburseMonth(delta, container, fullscreen));
}

async function ppNavigateDisburseMonth(delta, container, fullscreen) {
    const newAnchor = ppShiftMonthKey(ppDisburseChartAnchor, delta);
    container.innerHTML = ppSkeletonHtml();
    try {
        const chartData = await ppFetchDisburseChartData(newAnchor);
        if (!chartData) {
            container.innerHTML = `<div class="op-state">No disbursement data for this period.</div>`;
            return;
        }
        ppRenderDisburseHeatmapInto(container, fullscreen);
    } catch (err) {
        container.innerHTML = ppErrorHtml(err);
    }
}

async function ppRenderDisburseChart(wrap) {
    const chartData = await ppFetchDisburseChartData();
    if (!chartData) {
        wrap.innerHTML = `<div class="op-state">No disbursement data for this period.</div>`;
        return;
    }
    ppRenderDisburseHeatmapInto(wrap, false);
}

function ppWireChartFullscreenTriggers(wrap) {
    wrap.addEventListener("click", ppOpenChartFullscreen);
}

async function ppOpenChartFullscreen() {
    if (!ppDisburseChartData) return;
    const overlay = document.getElementById("ppChartFsOverlay");
    const body = document.getElementById("ppChartFsBody");
    if (!overlay || !body) return;

    overlay.hidden = false;
    document.body.style.overflow = "hidden";

    ppRenderDisburseHeatmapInto(body, true);

    try {
        if (overlay.requestFullscreen) await overlay.requestFullscreen();
        else if (overlay.webkitRequestFullscreen) overlay.webkitRequestFullscreen();
    } catch (e) { /* not supported / denied — the CSS overlay alone still works */ }
}

function ppCloseChartFullscreen() {
    const overlay = document.getElementById("ppChartFsOverlay");
    if (!overlay || overlay.hidden) return;

    overlay.hidden = true;
    document.body.style.overflow = "";

    if (document.fullscreenElement === overlay) {
        try { document.exitFullscreen(); } catch (e) { /* no-op */ }
    }
}

document.getElementById("ppChartFsClose")?.addEventListener("click", ppCloseChartFullscreen);

document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement) ppCloseChartFullscreen();
});

// ========================================
// INIT
// ========================================
function ppFinishLoad() {
    document.getElementById("ppPageSkel").style.display = "none";
    ppRenderHeader();
    ppRenderCards();
}

function ppShowEmpty(msg) {
    document.getElementById("ppPageSkel").style.display = "none";
    const el = document.getElementById("ppEmpty");
    el.textContent = msg;
    el.style.display = "block";
}

async function ppInit() {
    const { product, meta } = ppReadParams();
    ppState.meta = meta;

    if (!product) {
        ppShowEmpty("No product was specified. Go back and select a product from the report.");
        return;
    }
    ppState.product = product;

    try {
        const data = await ppFetchSummary(product, meta);
        ppState.data = data;
        ppFinishLoad();
    } catch (err) {
        console.error(err);
        ppShowEmpty(err.message || "Network error loading product data.");
    }
}

ppInit();
