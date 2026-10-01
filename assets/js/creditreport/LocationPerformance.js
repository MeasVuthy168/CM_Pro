// ========================================
// LOCATION PERFORMANCE — per-location drill-down from
// RepDetailbyLocation.html (click a location name there to land here).
//
// CO / FSRO / Digital breakdown — every category splits the same way,
// just scoped by location instead of branch/product. Digital here is the
// OFFICER-ID-driven concept Branch Productivity uses (officer ID "90000"),
// not Product Performance's product-driven one — a location isn't tied to
// one product the way a Product Performance page is, so the geographic
// (Branch-style) definition fits. CM-backend's computeLocationPerformance()
// reuses the exact same column indices already confirmed in
// lib/creditreport-branch.js for these 5 sheets.
//
// Like Branch/Product Performance, there's no "already-fetched" instant-
// paint handoff: RepDetailbyLocation.js's own report only ever holds each
// location's combined Total, never the CO/FSRO/Digital breakdown, so this
// page always fetches its own summary on load (URL query string only —
// location name + the report's current date filters — no sessionStorage
// cache needed).
//
// BACKEND ENDPOINTS (CM-backend's lib/creditreport-location.js)
//   GET /api/creditreport/location-performance-summary
//     ?location=<name>&fromDate=&toDate=&woFromDate=&woToDate=
//   -> { ok, location, meta, co, fsro, digital, total }
//   Each of co/fsro/digital/total has the same shape:
//     { loanOutstanding:{loan,client,value}, loanDisburse:{loan,value},
//       parT24:{loan,value,parPct}, nbcOverdue:{...8 keys...},
//       writeOff:{balanceWO,wo,woCollected} }
//
//   GET /api/creditreport/location-clients
//     ?location=<name>&section=<outstanding|disburse|parT24|nbcOverdue|
//               writeOff>&bucket=<co|fsro|digital>
//     &fromDate=&toDate=&woFromDate=&woToDate=
//   -> { ok, items: [...] } — same row shape as Branch Productivity's
//      branch-clients.
//
//   GET /api/creditreport/location-disburse-chart
//     ?location=<name>&fromDate=
//   -> { ok, labels, dates, values, counts }
//   Location-wide daily disbursement (CO+FSRO+Digital combined — one
//   chart, not three), same mechanism as branch-disburse-chart.
//
//   GET /api/creditreport/byco/kh-holidays — reused as-is (not
//   location-specific), same as Branch/Officer/Product Performance.
//
// CLIENT LIST PAGINATION — same "Show More" pagination as Branch/Product
// Performance (a location can carry far more clients under one category
// than a single officer would) — see lpRenderClientListInto().
// ========================================

const LP_CATEGORIES = [
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
            ] },
            { label: "Digital", fields: [
                { key: "digital.loanOutstanding.loan", label: "Loan" },
                { key: "digital.loanOutstanding.client", label: "Client" },
                { key: "digital.loanOutstanding.value", label: "Value", money: true }
            ] }
        ],
        clientLists: [
            { bucket: "co", label: "CO" },
            { bucket: "fsro", label: "FSRO" },
            { bucket: "digital", label: "Digital" }
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
            ] },
            { label: "Digital", fields: [
                { key: "digital.loanDisburse.loan", label: "Loan" },
                { key: "digital.loanDisburse.value", label: "Value", money: true }
            ] }
        ],
        clientLists: [
            { bucket: "co", label: "CO" },
            { bucket: "fsro", label: "FSRO" },
            { bucket: "digital", label: "Digital" }
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
            ] },
            { label: "Digital", fields: [
                { key: "digital.parT24.loan", label: "Loan" },
                { key: "digital.parT24.value", label: "Value", money: true },
                { key: "digital.parT24.parPct", label: "PAR", pct: true }
            ] }
        ],
        clientLists: [
            { bucket: "co", label: "CO" },
            { bucket: "fsro", label: "FSRO" },
            { bucket: "digital", label: "Digital" }
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
            ] },
            { label: "Digital", fields: [
                { key: "digital.nbcOverdue.total.count", label: "Loan" },
                { key: "digital.nbcOverdue.total.value", label: "Value", money: true },
                { key: "digital.nbcOverdue.total.parPct", label: "PAR", pct: true }
            ] }
        ],
        clientLists: [
            { bucket: "co", label: "CO" },
            { bucket: "fsro", label: "FSRO" },
            { bucket: "digital", label: "Digital" }
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
            ] },
            { label: "Digital", fields: [
                { key: "digital.writeOff.wo.count", label: "Loan" },
                { key: "digital.writeOff.wo.prn", label: "Prn", money: true }
            ] }
        ],
        clientLists: [
            { bucket: "co", label: "CO" },
            { bucket: "fsro", label: "FSRO" },
            { bucket: "digital", label: "Digital" }
        ]
    }
];

const LP_LIST_PAGE_SIZE = 100;

const lpToken =
    localStorage.getItem("token") ||
    sessionStorage.getItem("token");

let lpState = { location: null, meta: null, data: null };

// Last-fetched Loan Disburse heatmap data — kept around so the
// fullscreen view can re-render without re-fetching.
let lpDisburseChartData = null;

// ========================================
// HELPERS
// ========================================
function lpGet(obj, path) {
    return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function lpFmtNum(n) {
    n = Number(n) || 0;
    return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}
function lpFmtPct(n) {
    n = Number(n) || 0;
    return (n * 100).toFixed(2) + "%";
}
function lpFmtDateDMY(s) {
    if (!s) return "-";
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (!m) return s;
    return `${m[3]}-${m[2]}-${m[1]}`;
}
function lpFmtDateDDMMYY(s) {
    if (!s) return "-";
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (!m) return s;
    return `${m[3]}/${m[2]}/${m[1].slice(2)}`;
}
function lpToDMY(yyyymmdd) {
    const [y, m, d] = yyyymmdd.split("-");
    return `${d}-${m}-${y}`;
}
function lpEscapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text == null ? "" : String(text);
    return div.innerHTML;
}
function lpSkeletonHtml() {
    return `<div class="op-skel-line" style="width:90%"></div>
             <div class="op-skel-line" style="width:75%"></div>
             <div class="op-skel-line" style="width:82%"></div>`;
}
function lpErrorHtml(err) {
    return `<div class="op-state op-state-error">${lpEscapeHtml((err && err.message) || "Something went wrong.")}</div>`;
}

// ========================================
// READ LOCATION + FILTERS FROM THE URL
// ========================================
function lpReadParams() {
    const params = new URLSearchParams(location.search);
    return {
        location: params.get("location") || "",
        meta: {
            fromDate: params.get("fromDate") || "",
            toDate: params.get("toDate") || "",
            woFromDate: params.get("woFromDate") || "",
            woToDate: params.get("woToDate") || ""
        }
    };
}

function lpBuildQuery(meta) {
    const parts = [];
    if (meta.fromDate) parts.push(`fromDate=${lpToDMY(meta.fromDate)}`);
    if (meta.toDate) parts.push(`toDate=${lpToDMY(meta.toDate)}`);
    if (meta.woFromDate) parts.push(`woFromDate=${lpToDMY(meta.woFromDate)}`);
    if (meta.woToDate) parts.push(`woToDate=${lpToDMY(meta.woToDate)}`);
    return parts.length ? `&${parts.join("&")}` : "";
}

async function lpFetchSummary(locationName, meta) {
    const url = `${API.BASE_URL}/api/creditreport/location-performance-summary?location=${encodeURIComponent(locationName)}${lpBuildQuery(meta)}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${lpToken}` } });
    const data = await res.json();
    if (!data.ok) throw new Error(data.message || "Failed to load location data.");
    return data;
}

// ========================================
// RENDER — HEADER + CARDS
// ========================================
function lpRenderHeader() {
    const locationName = lpState.location;
    const meta = lpState.meta;

    document.getElementById("lpAvatar").textContent =
        (locationName || "?").trim().charAt(0).toUpperCase() || "?";
    document.getElementById("lpLocationName").textContent = locationName || "-";

    const chips = [];
    if (meta.fromDate && meta.toDate) {
        chips.push(`${lpFmtDateDMY(meta.fromDate)} – ${lpFmtDateDMY(meta.toDate)}`);
    }
    document.getElementById("lpLocationMeta").innerHTML =
        chips.map(c => `<span class="op-meta-chip">${lpEscapeHtml(c)}</span>`).join("");

    document.getElementById("lpHeaderCard").style.display = "flex";
}

function lpStatFieldHtml(f, data) {
    const v = lpGet(data, f.key);
    const text = f.pct ? lpFmtPct(v) : lpFmtNum(v);
    return `<span>${lpEscapeHtml(f.label)}: <b>${text}</b></span>`;
}
function lpStatGroupHtml(g, data) {
    return `
      <div class="op-card-stats">
        <span class="op-card-stats-group-label">${lpEscapeHtml(g.label)}:</span>
        ${g.fields.map(f => lpStatFieldHtml(f, data)).join("")}
      </div>`;
}
// The Total row always shows; CO/FSRO/Digital only reveal once the card
// is expanded (see .bp-card-stats-buckets in BranchProductivity.css,
// reused here as-is).
function lpCardStatsHtml(cat, data) {
    const totalHtml = cat.statGroups.filter(g => g.total).map(g => lpStatGroupHtml(g, data)).join("");
    const bucketHtml = cat.statGroups.filter(g => !g.total).map(g => lpStatGroupHtml(g, data)).join("");
    return `${totalHtml}<div class="bp-card-stats-buckets">${bucketHtml}</div>`;
}

function lpCardMarkup(cat, data) {
    const listTabsHtml = cat.clientLists.map((cl, i) =>
        `<button type="button" class="op-mode-tab${i === 0 ? " active" : ""}" data-mode="list:${cl.bucket}">👥 List of Client ${lpEscapeHtml(cl.label)}</button>`
    ).join("");

    const chartTabHtml = cat.chart
        ? `<button type="button" class="op-mode-tab" data-mode="chart">📈 Chart</button>`
        : "";

    return `
      <div class="op-card" data-key="${cat.key}">
        <button type="button" class="op-card-head" aria-expanded="false">
          <div class="op-card-icon">${cat.icon}</div>
          <div class="op-card-title">
            <div class="op-card-label">${lpEscapeHtml(cat.label)}</div>
            ${lpCardStatsHtml(cat, data)}
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

function lpRenderCards() {
    const wrap = document.getElementById("lpCards");
    wrap.innerHTML = LP_CATEGORIES.map(cat => lpCardMarkup(cat, lpState.data)).join("");
    wrap.style.display = "flex";
    lpFitStatsToWidth();
}

// ========================================
// FIT STATS ROWS TO SCREEN WIDTH
// Same rationale as Branch/Product Performance's own *FitStatsToWidth().
// ========================================
function lpFitStatsToWidth() {
    const rows = document.querySelectorAll("#lpCards .op-card-stats");
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

let lpFitResizeTimer;
window.addEventListener("resize", () => {
    clearTimeout(lpFitResizeTimer);
    lpFitResizeTimer = setTimeout(lpFitStatsToWidth, 150);
});

// ========================================
// ACCORDION + MODE SWITCHING
// ========================================
document.getElementById("lpCards").addEventListener("click", (e) => {
    const head = e.target.closest(".op-card-head");
    if (head) {
        const card = head.closest(".op-card");
        const willOpen = !card.classList.contains("open");
        document.querySelectorAll("#lpCards .op-card.open").forEach(c => {
            if (c !== card) { c.classList.remove("open"); c.querySelector(".op-card-head").setAttribute("aria-expanded", "false"); }
        });
        card.classList.toggle("open", willOpen);
        head.setAttribute("aria-expanded", willOpen ? "true" : "false");
        // CO/FSRO/Digital rows are hidden until expanded, so they were
        // skipped by the last width-fit pass — measure them now that
        // they're visible.
        lpFitStatsToWidth();
        if (willOpen) {
            const activeTab = card.querySelector(".op-mode-tab.active");
            lpEnsureModeLoaded(card, activeTab ? activeTab.dataset.mode : "list");
        }
        return;
    }

    const tab = e.target.closest(".op-mode-tab");
    if (tab) {
        const card = tab.closest(".op-card");
        card.querySelectorAll(".op-mode-tab").forEach(t => t.classList.remove("active"));
        tab.classList.add("active");
        lpEnsureModeLoaded(card, tab.dataset.mode);
    }
});

async function lpEnsureModeLoaded(card, mode) {
    const key = card.dataset.key;
    const body = card.querySelector("[data-mode-body]");

    if (mode.startsWith("list:")) {
        const bucket = mode.slice(5);
        card._lpListCache = card._lpListCache || {};
        const renderOpts = {
            arrears: LP_ARREARS_CATEGORIES.has(key),
            filenamePrefix: `${lpState.location || "location"}_${key}_${bucket}`
        };
        if (card._lpListCache[mode]) {
            lpRenderClientListInto(body, card._lpListCache[mode], renderOpts);
            return;
        }
        body.innerHTML = lpSkeletonHtml();
        try {
            const rows = await lpFetchClientListRows(key, bucket);
            card._lpListCache[mode] = rows;
            lpRenderClientListInto(body, rows, renderOpts);
        } catch (err) {
            body.innerHTML = lpErrorHtml(err);
        }
        return;
    }

    // Chart (calendar heatmap) — always re-fetches/re-renders on reselect,
    // same rationale as Branch/Product Performance's own chart tab.
    body.innerHTML = `<div class="op-chart-wrap">${lpSkeletonHtml()}</div>`;
    const chartWrap = body.querySelector(".op-chart-wrap");
    try {
        await lpRenderDisburseChart(chartWrap);
    } catch (err) {
        chartWrap.innerHTML = lpErrorHtml(err);
    }
}

// parT24 and NBC Overdue's client lists use the richer arrears-style
// table (lpArrearsTableHtml) instead of the generic one — same
// convention as Branch/Product Performance's own *_ARREARS_CATEGORIES.
const LP_ARREARS_CATEGORIES = new Set(["parT24", "nbcOverdue"]);

async function lpFetchClientListRows(section, bucket) {
    const q = lpBuildQuery(lpState.meta);
    const url = `${API.BASE_URL}/api/creditreport/location-clients?location=${encodeURIComponent(lpState.location)}` +
        `&section=${encodeURIComponent(section)}&bucket=${encodeURIComponent(bucket)}${q}`;

    const res = await fetch(url, { headers: { Authorization: `Bearer ${lpToken}` } });
    if (!res.ok) throw new Error("Could not load the client list. Please try again.");
    const data = await res.json();
    if (!data.ok) throw new Error(data.message || "Could not load the client list.");
    return data.items || [];
}

// ---- Column specs (same shape as Branch/Product Performance's own) ----
const LP_CLIENT_TABLE_COLS = [
    { key: "name", label: "Name", type: "text" },
    { key: "cif", label: "CIF", type: "text" },
    { key: "loanNumber", label: "Loan Number", type: "text" },
    { key: "disburseDate", label: "Disburse Date", type: "date" },
    { key: "address", label: "Address", type: "text" },
    { key: "loanSize", label: "Loan Size", type: "number" },
    { key: "osUsd", label: "OS USD", type: "number" }
];

const LP_ARREARS_TABLE_COLS = [
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

function lpTableThHtml(col) {
    return `<th data-sort-key="${col.key}" data-sort-type="${col.type}">${lpEscapeHtml(col.label)}</th>`;
}
function lpTableTdHtml(col, row) {
    const v = row[col.key];
    if (v === "" || v == null) return "<td></td>";
    if (col.type === "number") return `<td>${lpEscapeHtml(lpFmtNum(v))}</td>`;
    if (col.type === "date") return `<td>${lpEscapeHtml(lpFmtDateDMY(v))}</td>`;
    return `<td>${lpEscapeHtml(v)}</td>`;
}

function lpClientTableHtml(rows, { showDate = true } = {}) {
    if (!rows.length) return `<div class="op-state">No clients found for this category.</div>`;
    const cols = showDate ? LP_CLIENT_TABLE_COLS : LP_CLIENT_TABLE_COLS.filter(c => c.key !== "disburseDate");
    return `
      <div class="op-client-table-wrap">
        <table class="op-client-table">
          <thead><tr>${cols.map(lpTableThHtml).join("")}</tr></thead>
          <tbody>${rows.map(r => `<tr>${cols.map(c => lpTableTdHtml(c, r)).join("")}</tr>`).join("")}</tbody>
        </table>
      </div>`;
}

function lpArrearsTableHtml(rows) {
    if (!rows.length) return `<div class="op-state">No clients found for this category.</div>`;
    return `
      <div class="op-client-table-wrap">
        <table class="op-client-table">
          <thead><tr><th>No</th>${LP_ARREARS_TABLE_COLS.map(lpTableThHtml).join("")}</tr></thead>
          <tbody>${rows.map((r, i) => `<tr><td>${i + 1}</td>${LP_ARREARS_TABLE_COLS.map(c => lpTableTdHtml(c, r)).join("")}</tr>`).join("")}</tbody>
        </table>
      </div>`;
}

function lpCompareForSort(a, b, type) {
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

function lpExportRowsToExcel(rows, cols, filenamePrefix) {
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
            out[c.label] = c.type === "date" ? lpFmtDateDMY(v) : (v === "" || v == null ? "" : v);
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
// pagination as Branch/Product Performance's own *RenderClientListInto().
//
// Column headers cycle through 3 states: ascending -> descending ->
// default (the order `rows` arrived in) -> ascending again. `rows`
// itself is never mutated — originalRows is a pristine snapshot taken
// once up front, and every render computes a sorted VIEW from it — so
// the "default" state always has an intact original order to return to.
function lpRenderClientListInto(container, rows, { arrears = false, showDate = true, filenamePrefix = "clients" } = {}) {
    const cols = arrears ? LP_ARREARS_TABLE_COLS : (showDate ? LP_CLIENT_TABLE_COLS : LP_CLIENT_TABLE_COLS.filter(c => c.key !== "disburseDate"));
    const buildTableHtml = arrears ? lpArrearsTableHtml : (rs => lpClientTableHtml(rs, { showDate }));

    const originalRows = rows.slice();
    let visibleCount = Math.min(LP_LIST_PAGE_SIZE, rows.length);
    let sortKey = null;
    let sortDir = 1;
    let sortType = "text";

    function getDisplayRows() {
        if (!sortKey) return originalRows;
        return originalRows.slice().sort((a, b) => sortDir * lpCompareForSort(a[sortKey], b[sortKey], sortType));
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
            lpExportRowsToExcel(getDisplayRows(), cols, filenamePrefix);
        });
        container.querySelector(".op-list-more-btn")?.addEventListener("click", () => {
            visibleCount = Math.min(visibleCount + LP_LIST_PAGE_SIZE, rows.length);
            render();
        });
    }

    render();
}

// ========================================
// LOAN DISBURSE — CALENDAR HEATMAP
// Same mechanism as Branch/Product Performance's own (*BuildDisburseHeatmapHtml
// etc.) — location-wide (CO+FSRO+Digital combined into one chart, not
// split into three), reused function-for-function under the lp prefix.
// ========================================
function lpHeatBucket(value, maxValue) {
    if (!value || value <= 0 || !maxValue) return 0;
    const pct = value / maxValue;
    if (pct > 0.7) return 4;
    if (pct > 0.45) return 3;
    if (pct > 0.2) return 2;
    return 1;
}

const LP_HEAT_DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

let lpKhHolidays = new Set();
let lpKhHolidaysPromise = null;
function lpEnsureKhHolidays() {
    if (!lpKhHolidaysPromise) {
        lpKhHolidaysPromise = fetch(`${API.BASE_URL}/api/creditreport/byco/kh-holidays`, {
            headers: { Authorization: `Bearer ${lpToken}` }
        })
            .then(res => res.json())
            .then(data => {
                if (data && data.ok && Array.isArray(data.holidays)) {
                    lpKhHolidays = new Set(data.holidays.map(h => h.date));
                }
            })
            .catch(err => console.error("kh-holidays fetch failed:", err));
    }
    return lpKhHolidaysPromise;
}

function lpBuildDisburseHeatmapHtml(dates, values, counts, locationName, meta, totalData) {
    const maxValue = Math.max(0, ...values);
    const firstDow = new Date(dates[0] + "T00:00:00").getDay();

    let cells = LP_HEAT_DOW.map(d => `<div class="op-heat-dow">${d}</div>`).join("");
    for (let i = 0; i < firstDow; i++) cells += `<div class="op-heat-cell op-heat-pad"></div>`;

    dates.forEach((dateStr, i) => {
        const day = Number(dateStr.slice(8, 10));
        const value = values[i] || 0;
        const count = counts[i] || 0;
        const bucket = lpHeatBucket(value, maxValue);
        const dow = new Date(dateStr + "T00:00:00").getDay();

        const classes = ["op-heat-cell"];
        if (bucket) classes.push(`op-heat-h${bucket}`);
        if (dow === 0 || dow === 6) classes.push("op-heat-weekend");
        if (lpKhHolidays.has(dateStr)) classes.push("op-heat-holiday");

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
        period = `${lpFmtDateDDMMYY(meta.fromDate)}-${lpFmtDateDDMMYY(meta.toDate)}`;
        totalLoan = lpGet(totalData, "loanDisburse.loan");
        totalValue = lpGet(totalData, "loanDisburse.value");
    } else {
        period = `${lpFmtDateDDMMYY(dates[0])}-${lpFmtDateDDMMYY(dates[dates.length - 1])}`;
        totalLoan = counts.reduce((sum, c) => sum + (c || 0), 0);
        totalValue = values.reduce((sum, v) => sum + (v || 0), 0);
    }

    const monthLabel = new Date(dates[0] + "T00:00:00")
        .toLocaleString("en-US", { month: "long", year: "numeric" });

    return `
      <div class="op-heat-title">Daily Loan Disbursement — ${lpEscapeHtml(locationName)}</div>
      <div class="op-heat-subtitle-group">
        <div class="op-heat-subtitle-line">Period Date: ${period}</div>
        <div class="op-heat-subtitle-line">Total  Disburse: ${lpFmtNum(totalLoan)}LD, USD${lpFmtNum(totalValue)}</div>
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
        <span class="op-heat-nav-label">${lpEscapeHtml(monthLabel)}</span>
        <button type="button" class="op-heat-nav-btn" data-dir="next" aria-label="Next month">›</button>
      </div>
      <div class="op-heat-day-panel"></div>`;
}

function lpWireDisburseNav(container, onNavigate) {
    container.querySelectorAll(".op-heat-nav-btn").forEach(btn => {
        btn.addEventListener("click", e => {
            e.stopPropagation();
            onNavigate(btn.dataset.dir === "next" ? 1 : -1);
        });
    });
}

function lpShiftMonthKey(anchorKey, delta) {
    const [y, m] = anchorKey.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

let lpHeatTooltipEl = null;
function lpEnsureHeatTooltip() {
    if (!lpHeatTooltipEl) {
        lpHeatTooltipEl = document.createElement("div");
        lpHeatTooltipEl.className = "op-heat-tooltip";
        document.body.appendChild(lpHeatTooltipEl);
    }
    return lpHeatTooltipEl;
}

function lpShowHeatTooltip(cell, tooltip) {
    const date = cell.dataset.date;
    const value = Number(cell.dataset.value);
    const count = Number(cell.dataset.count);
    const [, mm, dd] = date.split("-");
    tooltip.innerHTML = `<span class="op-heat-tt-date">${dd}-${mm}:</span> ` + (
        value > 0 ? `${lpFmtNum(value)} · ${count} loan${count > 1 ? "s" : ""}` : "No disbursement"
    );
    tooltip.classList.add("show");
}

function lpWireHeatmapTooltips(container) {
    const tooltip = lpEnsureHeatTooltip();
    container.querySelectorAll(".op-heat-cell:not(.op-heat-pad)").forEach(cell => {
        cell.addEventListener("mouseenter", () => lpShowHeatTooltip(cell, tooltip));
        cell.addEventListener("mousemove", e => {
            tooltip.style.transform = "";
            tooltip.style.left = `${e.clientX + 14}px`;
            tooltip.style.top = `${e.clientY + 14}px`;
        });
        cell.addEventListener("mouseleave", () => tooltip.classList.remove("show"));
    });
}

// Unlike Officer Productivity's per-day panel (one officer, one bucket
// implicitly), a location day's disbursements can span CO/FSRO/Digital —
// the heatmap itself is combined, so the day-click panel fetches all
// three buckets in parallel and merges them, rather than adding a
// bucket-less "all" mode to the location-clients endpoint just for this.
async function lpFetchDayClients(dateKey) {
    const q = lpBuildQuery({ ...lpState.meta, fromDate: dateKey, toDate: dateKey });
    const buckets = ["co", "fsro", "digital"];
    const results = await Promise.all(buckets.map(async bucket => {
        const url = `${API.BASE_URL}/api/creditreport/location-clients?location=${encodeURIComponent(lpState.location)}` +
            `&section=disburse&bucket=${bucket}${q}`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${lpToken}` } });
        if (!res.ok) throw new Error("Could not load clients for this day. Please try again.");
        const data = await res.json();
        if (!data.ok) throw new Error(data.message || "Could not load clients for this day.");
        return data.items || [];
    }));
    return results.flat();
}

function lpWireDayClientPanel(container) {
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

            panel.innerHTML = heading + lpSkeletonHtml();
            try {
                const rows = await lpFetchDayClients(date);
                if (activeDate !== date) return;
                panel.innerHTML = heading + `<div class="op-heat-day-panel-body"></div>`;
                lpRenderClientListInto(panel.querySelector(".op-heat-day-panel-body"), rows, {
                    showDate: false,
                    filenamePrefix: `${lpState.location || "location"}_disburse_${date}`
                });
            } catch (err) {
                if (activeDate !== date) return;
                panel.innerHTML = heading + lpErrorHtml(err);
            }
        });
    });
}

let lpDisburseChartAnchor = null;

async function lpFetchDisburseChartData(monthOverride) {
    const metaForQuery = monthOverride ? { ...lpState.meta, fromDate: monthOverride } : lpState.meta;
    const q = lpBuildQuery(metaForQuery);
    const url = `${API.BASE_URL}/api/creditreport/location-disburse-chart?location=${encodeURIComponent(lpState.location)}${q}`;

    const holidaysReady = lpEnsureKhHolidays();

    const res = await fetch(url, { headers: { Authorization: `Bearer ${lpToken}` } });
    if (!res.ok) throw new Error("Could not load the disbursement chart. Please try again.");
    const data = await res.json();
    if (!data.ok) throw new Error(data.message || "Could not load the disbursement chart.");
    await holidaysReady;

    const dates = data.dates || [];
    if (!dates.length) {
        lpDisburseChartData = null;
        return null;
    }
    lpDisburseChartData = { dates, values: data.values || [], counts: data.counts || [] };
    lpDisburseChartAnchor = `${dates[0].slice(0, 7)}-01`;
    return lpDisburseChartData;
}

function lpRenderDisburseHeatmapInto(container, fullscreen) {
    const { dates, values, counts } = lpDisburseChartData;
    const btnHtml = fullscreen
        ? ""
        : `<button type="button" class="op-chart-fullscreen-btn" aria-label="Fullscreen chart">⛶</button>`;
    container.innerHTML = btnHtml + lpBuildDisburseHeatmapHtml(dates, values, counts, lpState.location, lpState.meta, lpState.data?.total);

    lpWireHeatmapTooltips(container);
    lpWireDayClientPanel(container);
    if (!fullscreen) lpWireChartFullscreenTriggers(container);
    lpWireDisburseNav(container, delta => lpNavigateDisburseMonth(delta, container, fullscreen));
}

async function lpNavigateDisburseMonth(delta, container, fullscreen) {
    const newAnchor = lpShiftMonthKey(lpDisburseChartAnchor, delta);
    container.innerHTML = lpSkeletonHtml();
    try {
        const chartData = await lpFetchDisburseChartData(newAnchor);
        if (!chartData) {
            container.innerHTML = `<div class="op-state">No disbursement data for this period.</div>`;
            return;
        }
        lpRenderDisburseHeatmapInto(container, fullscreen);
    } catch (err) {
        container.innerHTML = lpErrorHtml(err);
    }
}

async function lpRenderDisburseChart(wrap) {
    const chartData = await lpFetchDisburseChartData();
    if (!chartData) {
        wrap.innerHTML = `<div class="op-state">No disbursement data for this period.</div>`;
        return;
    }
    lpRenderDisburseHeatmapInto(wrap, false);
}

function lpWireChartFullscreenTriggers(wrap) {
    wrap.addEventListener("click", lpOpenChartFullscreen);
}

async function lpOpenChartFullscreen() {
    if (!lpDisburseChartData) return;
    const overlay = document.getElementById("lpChartFsOverlay");
    const body = document.getElementById("lpChartFsBody");
    if (!overlay || !body) return;

    overlay.hidden = false;
    document.body.style.overflow = "hidden";

    lpRenderDisburseHeatmapInto(body, true);

    try {
        if (overlay.requestFullscreen) await overlay.requestFullscreen();
        else if (overlay.webkitRequestFullscreen) overlay.webkitRequestFullscreen();
    } catch (e) { /* not supported / denied — the CSS overlay alone still works */ }
}

function lpCloseChartFullscreen() {
    const overlay = document.getElementById("lpChartFsOverlay");
    if (!overlay || overlay.hidden) return;

    overlay.hidden = true;
    document.body.style.overflow = "";

    if (document.fullscreenElement === overlay) {
        try { document.exitFullscreen(); } catch (e) { /* no-op */ }
    }
}

document.getElementById("lpChartFsClose")?.addEventListener("click", lpCloseChartFullscreen);

document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement) lpCloseChartFullscreen();
});

// ========================================
// INIT
// ========================================
function lpFinishLoad() {
    document.getElementById("lpPageSkel").style.display = "none";
    lpRenderHeader();
    lpRenderCards();
}

function lpShowEmpty(msg) {
    document.getElementById("lpPageSkel").style.display = "none";
    const el = document.getElementById("lpEmpty");
    el.textContent = msg;
    el.style.display = "block";
}

async function lpInit() {
    const { location: locationName, meta } = lpReadParams();
    lpState.meta = meta;

    if (!locationName) {
        lpShowEmpty("No location was specified. Go back and select a location from the report.");
        return;
    }
    lpState.location = locationName;

    try {
        const data = await lpFetchSummary(locationName, meta);
        lpState.data = data;
        lpFinishLoad();
    } catch (err) {
        console.error(err);
        lpShowEmpty(err.message || "Network error loading location data.");
    }
}

lpInit();
