// ========================================
// REPORT COMPARISON — pick any two backed-up dates and see what changed,
// per explicit request 2026-10-01, extended 2026-10-07 into a 5-section
// dashboard (Loan Outstanding / Loan Disburse / Balance Loan at Risk
// (T24) / Balance Loan at Risk (NBC Overdue) / Write Off) sliceable by
// Officer/Branch/Product/Location.
//
// BACKEND ENDPOINTS (CM-backend's lib/creditreport-compare.js)
//   GET  /api/creditreport/snapshot/dates -> { ok, dates:[...], today }
//   POST /api/creditreport/snapshot/run   (admin only) -> { ok, date, counts }
//   GET  /api/creditreport/compare?dateA=&dateB=
//     -> { ok, dateA, dateB, diff:{ os, disburse, wo, overdue, t24 } }
//     os/disburse: { total:{countA,countB,countDiff,...valueA/B/Diff},
//                    branch:[{key,countA,countB,countDiff,...valueA/B/Diff}],
//                    officerId:[...], product:[...], location:[...] }
//       (pre-aggregated across the whole loan book — no client-level list;
//        os's value fields are loanSizeSum/osUsdSum, disburse's is valueSum)
//     wo:      { summary:{countA,countB,countDiff,intA/B/Diff,prnA/B/Diff},
//                entered:[{cif,khName,branch,officerId,location,int,prn}], exited:[...] }
//                (no `product` field — WO has no Product Type column)
//     overdue: { summary:{byClassA,byClassB,byClassDiff},
//                changed:[{cif,loanNumber,name,branch,officerId,product,location,
//                          fromClass,toClass,direction}], entered:[...], exited:[...] }
//     t24:     { summary:{countA,countB,countDiff,valA/B/Diff},
//                changed:[...same shape as overdue.changed...],
//                entered:[{cif,loanNumber,name,branch,officerId,product,location,val}], exited:[...] }
// ========================================

const rcToken =
    localStorage.getItem("token") ||
    sessionStorage.getItem("token");

const rcUser = JSON.parse(
    localStorage.getItem("loggedInUser") || sessionStorage.getItem("loggedInUser") || "{}"
);
const rcIsAdmin = String(rcUser.role || "").toLowerCase() === "admin";

let rcDates = [];
let rcDiff = null;
// The two dates the current rcDiff actually compares — echoed back by
// the compare endpoint rather than read from the selects, so the label
// always matches what's on screen even if the selects change afterward.
let rcDiffDateA = "";
let rcDiffDateB = "";
let rcActiveTab = "os";
let rcSubTab = { wo: "entered", overdue: "changed", t24: "entered" };
// Officer is the default dimension — there's no neutral "Overall" option
// (removed per explicit request 2026-10-08), so a dimension is always active.
let rcDim = "officerId";
let rcDimValue = "";

const RC_DIMENSIONS = { officerId: "Officer", branch: "Branch", product: "Product", location: "Location" };
// `title` is the short label shown on the tab chip and as the section
// head's own headline (per explicit request 2026-10-08); `full` is the
// plain-English name shown as a small subtitle under it.
const RC_SECTION_META = {
    os: { icon: "💰", title: "OS", full: "Loan Outstanding" },
    disburse: { icon: "🏦", title: "Disb", full: "Loan Disburse" },
    t24: { icon: "⏱", title: "T24 OV", full: "Balance Loan at Risk (T24)" },
    overdue: { icon: "📉", title: "NBC OV", full: "Balance Loan at Risk (NBC Overdue)" },
    wo: { icon: "✍️", title: "WO", full: "Write Off" }
};
// WO has no Product Type column in its source sheet — the Product
// dimension chip is disabled whenever this tab is active.
const RC_DIM_UNAVAILABLE = { wo: new Set(["product"]) };

// ========================================
// TABLE SORTING — click a header to sort by that column, per explicit
// request 2026-10-08, scoped to the T24/NBC Overdue/Write Off tables
// (their breakdown table and entered/exited/changed client lists).
// State is keyed per table ("<tab>:dimbreak", "<tab>:<subtab>") so
// switching tabs/sub-tabs/dimension never mixes up one table's sort
// with another's, and a 3rd click of the same column returns to that
// table's own default order rather than getting stuck toggling asc/desc.
// ========================================
const rcSortState = {};

function rcCycleSort(stateKey, col, type) {
    const s = rcSortState[stateKey];
    if (!s || s.col !== col) {
        rcSortState[stateKey] = { col, type, dir: 1 };
    } else if (s.dir === 1) {
        s.dir = -1;
    } else {
        delete rcSortState[stateKey];
    }
}

// Ascending-comparator for one field, by column type. Missing/blank
// values always sort last regardless of direction.
function rcCompareForSort(a, b, type) {
    const blank = v => v === "" || v == null;
    if (type === "number") {
        const na = blank(a) ? Infinity : Number(a);
        const nb = blank(b) ? Infinity : Number(b);
        return na - nb;
    }
    const sa = blank(a) ? "￿" : String(a).toLowerCase();
    const sb = blank(b) ? "￿" : String(b).toLowerCase();
    return sa < sb ? -1 : sa > sb ? 1 : 0;
}

function rcApplySort(rows, stateKey) {
    const s = rcSortState[stateKey];
    if (!s) return rows;
    return rows.slice().sort((a, b) => s.dir * rcCompareForSort(a[s.col], b[s.col], s.type));
}

// `col.sortable === false` opts a column out (e.g. an icon-only column
// with no meaningful header label to click).
function rcTableThHtml(col, stateKey) {
    if (col.sortable === false) return `<th>${rcEscapeHtml(col.label)}</th>`;
    const s = rcSortState[stateKey];
    const active = s && s.col === col.key;
    const cls = active ? ` class="${s.dir === 1 ? "op-sort-asc" : "op-sort-desc"}"` : "";
    return `<th data-sort-key="${rcEscapeHtml(col.key)}" data-sort-type="${col.type || "text"}" data-sort-table="${rcEscapeHtml(stateKey)}"${cls}>${rcEscapeHtml(col.label)}</th>`;
}

function rcEscapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function rcFmtNum(n) {
    n = Number(n) || 0;
    return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}
function rcFmtPct(n) {
    n = Number(n) || 0;
    return (n * 100).toFixed(2) + "%";
}
function rcFmtDiffCell(n) {
    n = Number(n) || 0;
    const cls = n > 0 ? "positive" : n < 0 ? "negative" : "zero";
    const sign = n > 0 ? "+" : "";
    return `<span class="rc-bd-diff ${cls}">${sign}${rcFmtNum(n)}</span>`;
}
function rcNotify(message, type) {
    if (typeof CMToast !== "undefined" && CMToast.show) {
        CMToast.show({ type: type === "error" ? "error" : "backup", title: type === "error" ? "Error" : "Success", message });
    } else {
        alert(message);
    }
}
function rcShowEmpty(msg) {
    const el = document.getElementById("rcEmpty");
    el.textContent = msg;
    el.style.display = "block";
    document.getElementById("rcTransitionsCard").style.display = "none";
}
function rcHideEmpty() {
    document.getElementById("rcEmpty").style.display = "none";
}

async function rcApiGet(path) {
    const res = await fetch(`${API.BASE_URL}${path}`, { headers: { Authorization: `Bearer ${rcToken}` } });
    return res.json();
}

// ========================================
// DATE PICKERS
// ========================================
async function rcLoadDates() {
    const data = await rcApiGet("/api/creditreport/snapshot/dates");
    if (!data.ok) { rcShowEmpty(data.message || "Failed to load snapshot dates."); return; }
    rcDates = data.dates || [];

    const selA = document.getElementById("rcDateA");
    const selB = document.getElementById("rcDateB");
    if (!rcDates.length) {
        // The page's own "Snapshot Now" button was absorbed into the
        // Credit Report hub's single "Snapshot All" control 2026-10-08.
        rcShowEmpty(
            rcIsAdmin
                ? "No backup yet — use Snapshot All on the Credit Report hub to start."
                : "No backup yet — ask an admin to run Snapshot All on the Credit Report hub."
        );
        selA.innerHTML = "";
        selB.innerHTML = "";
        return;
    }

    const optsHtml = rcDates.map(d => `<option value="${d}">${d}</option>`).join("");
    selA.innerHTML = optsHtml;
    selB.innerHTML = optsHtml;
    // Default: compare the most recent backup against the one right
    // before it (e.g. "today" vs "yesterday"), but either side stays
    // freely changeable to any backed-up date.
    selB.value = rcDates[0];
    selA.value = rcDates[1] || rcDates[0];
}

// ========================================
// SECTION HEAD — icon + bilingual title naming the active tab, and the
// data-tab attribute the CSS reads for that section's growth/risk accent.
// ========================================
function rcRenderSectionHead() {
    const meta = RC_SECTION_META[rcActiveTab];
    document.getElementById("rcTransitionsCard").dataset.tab = rcActiveTab;
    const dates = (rcDiffDateA && rcDiffDateB)
        ? `<span class="rc-section-dates">${rcEscapeHtml(rcDiffDateA)} → ${rcEscapeHtml(rcDiffDateB)}</span>`
        : "";
    document.getElementById("rcSectionHead").innerHTML = `
      <span class="rc-section-icon">${meta.icon}</span>
      <div class="rc-section-head-text">
        <div class="rc-section-title">${rcEscapeHtml(meta.title)}</div>
        <div class="rc-section-subtitle">${rcEscapeHtml(meta.full)}</div>
      </div>
      ${dates}`;
}

// ========================================
// KPI CARD — per explicit request 2026-10-08:
//   Outstanding: #Loan, #Client, Value   Disburse: #Loan, Value
//   T24 / NBC Overdue: #Loan, #Client, PAR   Write Off: #(cif), Int, Prn
// `polarity` colors the delta badge: "growth" (more is good, green-up)
// for Outstanding/Disburse, "risk" (more is bad, red-up) for the other
// three — a write-off or PAR increase is never good news.
// ========================================
function rcKpiCell(label, valueB, diff, fmt, polarity) {
    fmt = fmt || rcFmtNum;
    const d = Number(diff) || 0;
    const valueA = valueB - d;
    const good = polarity === "risk" ? d < 0 : d > 0;
    const cls = d === 0 ? "zero" : good ? "positive" : "negative";
    const arrow = d > 0 ? "▲" : d < 0 ? "▼" : "•";
    const sign = d > 0 ? "+" : "";
    return `
      <div class="rc-kpi-cell">
        <div class="rc-kpi-label">${rcEscapeHtml(label)}</div>
        <div class="rc-kpi-value">${fmt(valueB)}</div>
        <div class="rc-kpi-sub">was ${fmt(valueA)}</div>
        <div class="rc-kpi-delta ${cls}">${arrow} ${sign}${fmt(Math.abs(d))}</div>
      </div>`;
}
function rcKpiCellPct(label, valueB, diff) {
    const d = Number(diff) || 0;
    const valueA = valueB - d;
    // Risk metric (PAR) — an increase is bad, so the usual polarity flips.
    const cls = d === 0 ? "zero" : d < 0 ? "positive" : "negative";
    const arrow = d > 0 ? "▲" : d < 0 ? "▼" : "•";
    const sign = d > 0 ? "+" : "";
    return `
      <div class="rc-kpi-cell">
        <div class="rc-kpi-label">${rcEscapeHtml(label)}</div>
        <div class="rc-kpi-value">${rcFmtPct(valueB)}</div>
        <div class="rc-kpi-sub">was ${rcFmtPct(valueA)}</div>
        <div class="rc-kpi-delta ${cls}">${arrow} ${sign}${(Math.abs(d) * 100).toFixed(2)}pp</div>
      </div>`;
}

// PAR% = that section's risk value / total Outstanding value on the same
// date — same "balance at risk over total book" definition the live
// Daily Monitoring reports already use for parPct.
function rcParPct(riskValue, osValue) {
    return osValue ? riskValue / osValue : 0;
}

function rcRenderKpiCard() {
    const diff = rcDiff;
    let html;

    if (rcActiveTab === "os") {
        const row = (rcDim && rcDimValue) ? diff.os[rcDim].find(r => r.key === rcDimValue) : null;
        const d = row || diff.os.total;
        html = `<div class="rc-kpi-card">` +
            rcKpiCell("# Loan", d.countB, d.countDiff, rcFmtNum, "growth") +
            rcKpiCell("# Client", d.clientCountB, d.clientCountDiff, rcFmtNum, "growth") +
            rcKpiCell("Value (USD)", d.osUsdSumB, d.osUsdSumDiff, rcFmtNum, "growth") +
            `</div>`;
    } else if (rcActiveTab === "disburse") {
        const row = (rcDim && rcDimValue) ? diff.disburse[rcDim].find(r => r.key === rcDimValue) : null;
        const d = row || diff.disburse.total;
        html = `<div class="rc-kpi-card">` +
            rcKpiCell("# Loan", d.countB, d.countDiff, rcFmtNum, "growth") +
            rcKpiCell("Value (USD)", d.valueSumB, d.valueSumDiff, rcFmtNum, "growth") +
            `</div>`;
    } else if (rcActiveTab === "t24") {
        const s = diff.t24.summary;
        const parA = rcParPct(s.valA, diff.os.total.osUsdSumA), parB = rcParPct(s.valB, diff.os.total.osUsdSumB);
        html = `<div class="rc-kpi-card">` +
            rcKpiCell("# Loan", s.countB, s.countDiff, rcFmtNum, "risk") +
            rcKpiCell("# Client", s.clientCountB, s.clientCountDiff, rcFmtNum, "risk") +
            rcKpiCellPct("PAR", parB, parB - parA) +
            `</div>`;
    } else if (rcActiveTab === "overdue") {
        const s = diff.overdue.summary;
        const parA = rcParPct(s.valA, diff.os.total.osUsdSumA), parB = rcParPct(s.valB, diff.os.total.osUsdSumB);
        html = `<div class="rc-kpi-card">` +
            rcKpiCell("# Loan", s.countB, s.countDiff, rcFmtNum, "risk") +
            rcKpiCell("# Client", s.clientCountB, s.clientCountDiff, rcFmtNum, "risk") +
            rcKpiCellPct("PAR", parB, parB - parA) +
            `</div>`;
    } else if (rcActiveTab === "wo") {
        const s = diff.wo.summary;
        html = `<div class="rc-kpi-card">` +
            rcKpiCell("# (CIF)", s.countB, s.countDiff, rcFmtNum, "risk") +
            rcKpiCell("Int", s.intB, s.intDiff, rcFmtNum, "risk") +
            rcKpiCell("Prn", s.prnB, s.prnDiff, rcFmtNum, "risk") +
            `</div>`;
    }

    document.getElementById("rcKpiCard").innerHTML = html;
}

// ========================================
// DIMENSION PICKER — "filter or tap of Officer/Branch/Product/Location".
// Picks which dimension the active tab's breakdown/client-list is
// sliced by; an optional specific value (rcDimValueSelect) narrows it
// further to one Officer/Branch/Product/Location.
// ========================================
function rcUpdateDimChipsAvailability() {
    const unavailable = RC_DIM_UNAVAILABLE[rcActiveTab] || new Set();
    document.querySelectorAll("#rcDimChips .rc-dim-chip").forEach(chip => {
        const isUnavailable = unavailable.has(chip.dataset.dim);
        chip.disabled = isUnavailable;
        chip.title = isUnavailable ? "Not tracked for Write Off" : "";
    });
    // Fall back to the first available dimension (Officer) rather than
    // leaving the now-unavailable one selected — there's no neutral
    // "Overall" state to fall back to any more.
    if (unavailable.has(rcDim)) {
        rcDim = "officerId";
        rcDimValue = "";
        document.querySelectorAll("#rcDimChips .rc-dim-chip").forEach(c => c.classList.toggle("active", c.dataset.dim === rcDim));
    }
}

// Rows carrying officerId/branch/product/location this tab's client
// lists are built from — used both to group-count by dimension and to
// populate the specific-value dropdown. Outstanding/Disburse aren't
// here — they're pre-aggregated server-side (rcDiff[tab][dim] directly).
function rcClientRowArrays(tab) {
    const d = rcDiff[tab];
    if (tab === "wo") return { entered: d.entered, exited: d.exited };
    if (tab === "t24" || tab === "overdue") return { entered: d.entered, exited: d.exited, changed: d.changed };
    return {};
}

function rcDimValuesForClientTab(tab, dim) {
    const arrays = rcClientRowArrays(tab);
    const set = new Set();
    for (const rows of Object.values(arrays)) {
        for (const r of rows) { const v = r[dim]; if (v) set.add(v); }
    }
    return [...set].sort((a, b) => a.localeCompare(b));
}

function rcPopulateDimValueSelect() {
    const sel = document.getElementById("rcDimValueSelect");
    const values = (rcActiveTab === "os" || rcActiveTab === "disburse")
        ? (rcDiff[rcActiveTab][rcDim] || []).map(r => r.key)
        : rcDimValuesForClientTab(rcActiveTab, rcDim);

    if (rcDimValue && !values.includes(rcDimValue)) rcDimValue = "";

    const label = RC_DIMENSIONS[rcDim];
    sel.innerHTML = `<option value="">All ${rcEscapeHtml(label)}s</option>` +
        values.map(v => `<option value="${rcEscapeHtml(v)}"${v === rcDimValue ? " selected" : ""}>${rcEscapeHtml(v)}</option>`).join("");
    sel.style.display = "";
}

function rcApplyDimFilter(rows) {
    if (!rcDim || !rcDimValue) return rows;
    return rows.filter(r => r[rcDim] === rcDimValue);
}

// ========================================
// LOAN OUTSTANDING / LOAN DISBURSE — dimension breakdown table, straight
// from the backend's already-aggregated, already-sorted per-dimension
// array (no client-level list for these two — see the backend's own
// comment on why: full daily OS rows would be too large to store).
// ========================================
function rcRenderOsDisburseBreakdown(valueLabel, valueField) {
    const rows = rcDiff[rcActiveTab][rcDim] || [];
    const filtered = rcDimValue ? rows.filter(r => r.key === rcDimValue) : rows;
    if (!filtered.length) return `<div class="op-empty">No rows.</div>`;
    return `
      <div class="rc-breakdown-table-wrap">
        <table class="rc-breakdown-table">
          <thead><tr><th>${rcEscapeHtml(RC_DIMENSIONS[rcDim])}</th><th># Loan</th><th>${rcEscapeHtml(valueLabel)}</th></tr></thead>
          <tbody>
            ${filtered.map(r => `
              <tr>
                <td>${rcEscapeHtml(r.key)}</td>
                <td>${rcFmtNum(r.countA)} → ${rcFmtNum(r.countB)} ${rcFmtDiffCell(r.countDiff)}</td>
                <td>${rcFmtNum(r[`${valueField}A`])} → ${rcFmtNum(r[`${valueField}B`])} ${rcFmtDiffCell(r[`${valueField}Diff`])}</td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>`;
}

// ========================================
// WRITE OFF / T24 / NBC OVERDUE — dimension breakdown, grouped client-
// side from the entered/exited(/changed) arrays (count per dimension
// value) — shown when a dimension is picked but no specific value yet.
// ========================================
function rcGroupCounts(rows, dim) {
    const m = new Map();
    for (const r of rows) {
        const key = r[dim];
        if (!key) continue;
        m.set(key, (m.get(key) || 0) + 1);
    }
    return m;
}

function rcRenderClientDimBreakdown() {
    const arrays = rcClientRowArrays(rcActiveTab);
    const enteredBy = rcGroupCounts(arrays.entered || [], rcDim);
    const exitedBy = rcGroupCounts(arrays.exited || [], rcDim);
    const hasChanged = !!arrays.changed;
    const upgradeBy = hasChanged ? rcGroupCounts(arrays.changed.filter(r => r.direction === "upgrade"), rcDim) : null;
    const downgradeBy = hasChanged ? rcGroupCounts(arrays.changed.filter(r => r.direction === "downgrade"), rcDim) : null;

    const keys = new Set([...enteredBy.keys(), ...exitedBy.keys(), ...(hasChanged ? arrays.changed.map(r => r[rcDim]).filter(Boolean) : [])]);
    if (!keys.size) return `<div class="op-empty">No rows.</div>`;

    const score = k => (enteredBy.get(k) || 0) + (exitedBy.get(k) || 0) + (hasChanged ? (upgradeBy.get(k) || 0) + (downgradeBy.get(k) || 0) : 0);
    // Default order (no column sort picked yet): busiest dimension value first.
    const rows = [...keys].sort((a, b) => score(b) - score(a)).map(k => ({
        key: k,
        entered: enteredBy.get(k) || 0,
        exited: exitedBy.get(k) || 0,
        upgrade: hasChanged ? (upgradeBy.get(k) || 0) : 0,
        downgrade: hasChanged ? (downgradeBy.get(k) || 0) : 0
    }));

    const stateKey = `${rcActiveTab}:dimbreak`;
    const cols = [
        { key: "key", label: RC_DIMENSIONS[rcDim], type: "text" },
        { key: "entered", label: "✅ Entered", type: "number" },
        { key: "exited", label: "↩️ Exited", type: "number" },
        ...(hasChanged ? [
            { key: "upgrade", label: "⬆ Upgrade", type: "number" },
            { key: "downgrade", label: "⬇ Downgrade", type: "number" }
        ] : [])
    ];
    const sorted = rcApplySort(rows, stateKey);

    return `
      <div class="rc-breakdown-table-wrap">
        <table class="rc-breakdown-table">
          <thead><tr>${cols.map(c => rcTableThHtml(c, stateKey)).join("")}</tr></thead>
          <tbody>
            ${sorted.map(r => `
              <tr>
                <td>${rcEscapeHtml(r.key)}</td>
                <td>${r.entered}</td>
                <td>${r.exited}</td>
                ${hasChanged ? `<td>${r.upgrade}</td><td>${r.downgrade}</td>` : ""}
              </tr>`).join("")}
          </tbody>
        </table>
      </div>`;
}

// ========================================
// CLIENT LIST TABLES (List Client) — WO / T24 / NBC Overdue only.
// ========================================
function rcClientTableHtml(rows, cols, stateKey) {
    if (!rows.length) {
        return `<div class="op-empty">No rows in this category.</div>`;
    }
    const sorted = stateKey ? rcApplySort(rows, stateKey) : rows;
    return `
      <div class="op-client-table-wrap">
        <table class="op-client-table">
          <thead><tr>${cols.map(c => rcTableThHtml(c, stateKey)).join("")}</tr></thead>
          <tbody>
            ${sorted.map(r => `<tr>${cols.map(c => `<td>${c.render ? c.render(r) : rcEscapeHtml(r[c.key])}</td>`).join("")}</tr>`).join("")}
          </tbody>
        </table>
      </div>`;
}

function rcWoCols() {
    return [
        { key: "cif", label: "CIF", type: "text" },
        { key: "khName", label: "Name", type: "text" },
        { key: "branch", label: "Branch", type: "text" },
        { key: "officerId", label: "Officer", type: "text" },
        { key: "int", label: "Int", type: "number", render: r => rcFmtNum(r.int) },
        { key: "prn", label: "Prn", type: "number", render: r => rcFmtNum(r.prn) }
    ];
}
function rcChangedCols() {
    return [
        { key: "cif", label: "CIF", type: "text" },
        { key: "loanNumber", label: "Loan #", type: "text" },
        { key: "name", label: "Name", type: "text" },
        { key: "branch", label: "Branch", type: "text" },
        { key: "officerId", label: "Officer", type: "text" },
        { key: "toClass", label: "Class", type: "text", render: r => `${rcEscapeHtml(r.fromClass)} → ${rcEscapeHtml(r.toClass)}` },
        { key: "direction", label: "", sortable: false, render: r => `<span class="rc-badge ${r.direction}">${r.direction === "downgrade" ? "⬇ Downgrade" : "⬆ Upgrade"}</span>` }
    ];
}
function rcEnterExitCols() {
    return [
        { key: "cif", label: "CIF", type: "text" },
        { key: "loanNumber", label: "Loan #", type: "text" },
        { key: "name", label: "Name", type: "text" },
        { key: "branch", label: "Branch", type: "text" },
        { key: "officerId", label: "Officer", type: "text" },
        { key: "cls", label: "Class", type: "text" }
    ];
}
function rcT24EnterExitCols() {
    return [
        { key: "cif", label: "CIF", type: "text" },
        { key: "loanNumber", label: "Loan #", type: "text" },
        { key: "name", label: "Name", type: "text" },
        { key: "branch", label: "Branch", type: "text" },
        { key: "officerId", label: "Officer", type: "text" },
        { key: "val", label: "Value", type: "number", render: r => rcFmtNum(r.val) }
    ];
}

// ========================================
// TAB BODY
// ========================================
function rcRenderTabBody() {
    const diff = rcDiff;
    let html = "";

    if (rcActiveTab === "os" || rcActiveTab === "disburse") {
        const valueField = rcActiveTab === "os" ? "osUsdSum" : "valueSum";
        const valueLabel = rcActiveTab === "os" ? "OS (USD)" : "Disbursed (USD)";
        html += rcRenderOsDisburseBreakdown(valueLabel, valueField);
    } else if (rcActiveTab === "wo") {
        if (!rcDimValue) html += rcRenderClientDimBreakdown();
        html += `
          <div class="rc-sub-tabs">
            <button type="button" class="rc-sub-tab${rcSubTab.wo === "entered" ? " active" : ""}" data-sub="entered">✅ Entered (${rcApplyDimFilter(diff.wo.entered).length})</button>
            <button type="button" class="rc-sub-tab${rcSubTab.wo === "exited" ? " active" : ""}" data-sub="exited">↩️ Exited (${rcApplyDimFilter(diff.wo.exited).length})</button>
          </div>`;
        html += rcClientTableHtml(rcApplyDimFilter(diff.wo[rcSubTab.wo]), rcWoCols(), `wo:${rcSubTab.wo}`);
    } else if (rcActiveTab === "overdue") {
        if (!rcDimValue) html += rcRenderClientDimBreakdown();
        html += `
          <div class="rc-sub-tabs">
            <button type="button" class="rc-sub-tab${rcSubTab.overdue === "changed" ? " active" : ""}" data-sub="changed">🔀 Changed (${rcApplyDimFilter(diff.overdue.changed).length})</button>
            <button type="button" class="rc-sub-tab${rcSubTab.overdue === "entered" ? " active" : ""}" data-sub="entered">✅ New Overdue (${rcApplyDimFilter(diff.overdue.entered).length})</button>
            <button type="button" class="rc-sub-tab${rcSubTab.overdue === "exited" ? " active" : ""}" data-sub="exited">↩️ Resolved (${rcApplyDimFilter(diff.overdue.exited).length})</button>
          </div>`;
        if (rcSubTab.overdue === "changed") html += rcClientTableHtml(rcApplyDimFilter(diff.overdue.changed), rcChangedCols(), "overdue:changed");
        else html += rcClientTableHtml(rcApplyDimFilter(diff.overdue[rcSubTab.overdue]), rcEnterExitCols(), `overdue:${rcSubTab.overdue}`);
    } else if (rcActiveTab === "t24") {
        if (!rcDimValue) html += rcRenderClientDimBreakdown();
        html += `
          <div class="rc-sub-tabs">
            <button type="button" class="rc-sub-tab${rcSubTab.t24 === "changed" ? " active" : ""}" data-sub="changed">🔀 Changed (${rcApplyDimFilter(diff.t24.changed).length})</button>
            <button type="button" class="rc-sub-tab${rcSubTab.t24 === "entered" ? " active" : ""}" data-sub="entered">✅ Entered (${rcApplyDimFilter(diff.t24.entered).length})</button>
            <button type="button" class="rc-sub-tab${rcSubTab.t24 === "exited" ? " active" : ""}" data-sub="exited">↩️ Exited (${rcApplyDimFilter(diff.t24.exited).length})</button>
          </div>`;
        if (rcSubTab.t24 === "changed") html += rcClientTableHtml(rcApplyDimFilter(diff.t24.changed), rcChangedCols(), "t24:changed");
        else html += rcClientTableHtml(rcApplyDimFilter(diff.t24[rcSubTab.t24]), rcT24EnterExitCols(), `t24:${rcSubTab.t24}`);
    }

    document.getElementById("rcTabBody").innerHTML = html;
}

function rcRenderAll() {
    rcRenderSectionHead();
    rcRenderKpiCard();
    rcRenderTabBody();
}

// ========================================
// COMPARE
// ========================================
// Covers both "open the page" (rcInit runs this once dates are loaded)
// and a manual Compare click — one place, per explicit request
// 2026-10-08 — using the app-wide loading overlay (shared/loading.js),
// same convention/message as the 4 Daily Monitoring reports' own
// crShowLoading("Loading Report Data...").
async function rcRunCompare() {
    const dateA = document.getElementById("rcDateA").value;
    const dateB = document.getElementById("rcDateB").value;
    if (!dateA || !dateB) return;

    rcHideEmpty();
    document.getElementById("rcTransitionsCard").style.display = "none";
    document.getElementById("rcPageSkel").style.display = "flex";
    if (typeof showAppLoading === "function") showAppLoading("Loading Report Data...");

    try {
        const data = await rcApiGet(`/api/creditreport/compare?dateA=${encodeURIComponent(dateA)}&dateB=${encodeURIComponent(dateB)}`);
        document.getElementById("rcPageSkel").style.display = "none";
        if (!data.ok) { rcShowEmpty(data.message || "Failed to compare."); return; }

        rcDiff = data.diff;
        rcDiffDateA = data.dateA || dateA;
        rcDiffDateB = data.dateB || dateB;
        document.getElementById("rcTransitionsCard").style.display = "block";
        rcUpdateDimChipsAvailability();
        rcPopulateDimValueSelect();
        rcRenderAll();
    } catch (e) {
        console.error(e);
        document.getElementById("rcPageSkel").style.display = "none";
        rcShowEmpty("Server error while comparing.");
    } finally {
        if (typeof hideAppLoading === "function") hideAppLoading();
    }
}

// ========================================
// DELETE SNAPSHOT — "⋮" menu + calendar picker (admin only), per
// explicit request 2026-10-08. The calendar reuses OfficerProductivity
// .css's .op-heat-* grid/nav, the same one Branch Productivity's own
// Daily Loan Disbursement heatmap is built from — snapshot presence is
// binary here, so cells get one highlight class (rc-snap-has) instead
// of that heatmap's 5-level magnitude ramp. Highlighted dates come
// straight from rcDates (already fetched for the Date A/B selects),
// so opening the calendar needs no extra request.
// ========================================
const RC_CAL_DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
let rcCalMonthKey = ""; // "YYYY-MM-01" — the month currently shown
let rcCalPendingDelete = "";

function rcFmtDateDMY(dateKey) {
    if (!dateKey) return "";
    const [y, m, d] = dateKey.split("-");
    return `${d}-${m}-${y}`;
}

// Menu open/close itself (toggleTopbarMenu + outside-click) now lives
// in the shared shared/topbar-menu.js, reused as-is here.

function rcCalShiftMonth(anchorKey, delta) {
    const [y, m] = anchorKey.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function rcBuildDeleteCalHtml(monthKey) {
    if (!rcDates.length) {
        return `<div class="rc-del-cal-empty">No snapshots saved yet.</div>`;
    }
    const snapSet = new Set(rcDates);
    const [y, m] = monthKey.split("-").map(Number);
    const daysInMonth = new Date(y, m, 0).getDate();
    const firstDow = new Date(y, m - 1, 1).getDay();

    let cells = RC_CAL_DOW.map(d => `<div class="op-heat-dow">${d}</div>`).join("");
    for (let i = 0; i < firstDow; i++) cells += `<div class="op-heat-cell op-heat-pad"></div>`;
    for (let day = 1; day <= daysInMonth; day++) {
        const dateKey = `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        const hasSnap = snapSet.has(dateKey);
        cells += `
          <div class="op-heat-cell${hasSnap ? " rc-snap-has" : ""}" data-date="${dateKey}">
            <span class="op-heat-day">${day}</span>
          </div>`;
    }

    const monthLabel = new Date(y, m - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });

    return `
      <div class="op-heat-grid">${cells}</div>
      <div class="rc-del-cal-legend"><span class="op-heat-sw"></span><span>Has saved snapshot — tap to delete</span></div>
      <div class="op-heat-nav">
        <button type="button" class="op-heat-nav-btn" data-dir="prev" aria-label="Previous month">‹</button>
        <span class="op-heat-nav-label">${rcEscapeHtml(monthLabel)}</span>
        <button type="button" class="op-heat-nav-btn" data-dir="next" aria-label="Next month">›</button>
      </div>`;
}

function rcRenderDeleteCal() {
    document.getElementById("rcDeleteCalBody").innerHTML = rcBuildDeleteCalHtml(rcCalMonthKey);
}

function rcOpenDeleteCal() {
    rcCalMonthKey = rcDates.length ? rcDates[0].slice(0, 7) + "-01" : rcCalMonthKey || rcMonthStartKeyFallback();
    rcRenderDeleteCal();
    document.getElementById("rcDeleteCalDialog").classList.add("show");
}
// Only reached when rcDates is already empty (no month to anchor to) —
// falls back to this calendar month so the dialog still has something
// sane to render nav labels from if dates ever arrive later in-session.
function rcMonthStartKeyFallback() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

// Applies a new snapshot-dates array everywhere it's reflected — the
// calendar's highlighted cells, the Date A/B selects (keeping each
// side's CURRENT selection where it's still valid, instead of
// rcLoadDates()'s own reset-to-most-recent-two default, since deleting
// some unrelated old date shouldn't silently change what's on screen)
// — and re-renders. Used both as an immediate, optimistic update right
// after a successful delete/snapshot response (so the UI never waits
// on — or depends on — a second round trip to reflect what the server
// just confirmed) and again when that follow-up /snapshot/dates fetch
// resolves, to reconcile with the server's own canonical list.
function rcApplyDatesUpdate(dates) {
    rcDates = dates;
    rcRenderDeleteCal();

    const selA = document.getElementById("rcDateA");
    const selB = document.getElementById("rcDateB");
    const prevA = selA.value, prevB = selB.value;

    if (!rcDates.length) {
        selA.innerHTML = "";
        selB.innerHTML = "";
        rcShowEmpty(
            rcIsAdmin
                ? "No backup yet — use Snapshot All on the Credit Report hub to start."
                : "No backup yet — ask an admin to run Snapshot All on the Credit Report hub."
        );
        return;
    }

    const optsHtml = rcDates.map(d => `<option value="${d}">${d}</option>`).join("");
    selA.innerHTML = optsHtml;
    selB.innerHTML = optsHtml;
    selA.value = rcDates.includes(prevA) ? prevA : (rcDates[1] || rcDates[0]);
    selB.value = rcDates.includes(prevB) ? prevB : rcDates[0];

    const wasHidden = document.getElementById("rcTransitionsCard").style.display === "none";
    if (wasHidden || prevA !== selA.value || prevB !== selB.value) {
        rcRunCompare();
    }
}

// Re-fetches the canonical snapshot date list in the background and
// reconciles the UI with it — a failure here is logged but never
// undoes whatever optimistic update already ran.
function rcReconcileDates() {
    rcApiGet("/api/creditreport/snapshot/dates")
        .then(data => { if (data.ok) rcApplyDatesUpdate(data.dates || []); })
        .catch(e => console.error(e));
}

function rcAskDeleteSnapshot(dateKey) {
    rcCalPendingDelete = dateKey;
    document.getElementById("rcDeleteConfirmText").textContent =
        `Delete the saved snapshot for ${rcFmtDateDMY(dateKey)}? This cannot be undone.`;
    document.getElementById("rcDeleteConfirmDialog").classList.add("show");
}

async function rcConfirmDeleteSnapshot() {
    const dateKey = rcCalPendingDelete;
    rcCalPendingDelete = "";
    document.getElementById("rcDeleteConfirmDialog").classList.remove("show");
    if (!dateKey) return;

    try {
        const res = await fetch(`${API.BASE_URL}/api/creditreport/snapshot/delete`, {
            method: "POST",
            headers: { Authorization: `Bearer ${rcToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({ date: dateKey })
        });
        const data = await res.json();
        if (data.ok) {
            rcNotify(`Snapshot deleted for ${rcFmtDateDMY(dateKey)}`, "success");
            // Immediate: the backend just confirmed this date is gone —
            // the calendar highlight and Date A/B selects must never
            // lag behind a successful delete waiting on a second
            // round trip.
            rcApplyDatesUpdate(rcDates.filter(d => d !== dateKey));
            rcReconcileDates();
        } else {
            rcNotify(data.message || "Delete failed", "error");
        }
    } catch (e) {
        console.error(e);
        rcNotify("Delete failed", "error");
    }
}

// "📸 Snapshot" menu item — the page's own single-report snapshot
// (formerly the standalone "Snapshot Now" button, absorbed into the
// hub's "Snapshot All" 2026-10-08, now also offered back here for
// convenience per explicit request). Same endpoint as Snapshot All's
// own "Compare" target.
async function rcRunSnapshotNow() {
    document.getElementById("topbarMenu").style.display = "none";
    if (typeof showAppLoading === "function") showAppLoading("Saving snapshot...");
    try {
        const res = await fetch(`${API.BASE_URL}/api/creditreport/snapshot/run`, {
            method: "POST",
            headers: { Authorization: `Bearer ${rcToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({})
        });
        const data = await res.json();
        if (data.ok) {
            rcNotify(`Snapshot saved for ${data.date}`, "success");
            rcReconcileDates();
        } else {
            rcNotify(data.message || "Snapshot failed", "error");
        }
    } catch (e) {
        console.error(e);
        rcNotify("Snapshot failed", "error");
    } finally {
        if (typeof hideAppLoading === "function") hideAppLoading();
    }
}

// ========================================
// EVENTS
// ========================================
document.addEventListener("click", (e) => {
    const menuSnapshotBtn = e.target.closest("#rcMenuSnapshot");
    if (menuSnapshotBtn) {
        rcRunSnapshotNow();
        return;
    }
    const menuDeleteBtn = e.target.closest("#rcMenuDeleteSnapshot");
    if (menuDeleteBtn) {
        document.getElementById("topbarMenu").style.display = "none";
        rcOpenDeleteCal();
        return;
    }
    const calClose = e.target.closest("#rcDeleteCalClose");
    if (calClose) {
        document.getElementById("rcDeleteCalDialog").classList.remove("show");
        return;
    }
    const calNavBtn = e.target.closest("#rcDeleteCalBody .op-heat-nav-btn");
    if (calNavBtn) {
        rcCalMonthKey = rcCalShiftMonth(rcCalMonthKey, calNavBtn.dataset.dir === "next" ? 1 : -1);
        rcRenderDeleteCal();
        return;
    }
    const calCell = e.target.closest("#rcDeleteCalBody .op-heat-cell.rc-snap-has");
    if (calCell) {
        rcAskDeleteSnapshot(calCell.dataset.date);
        return;
    }
    const delNo = e.target.closest("#rcDeleteConfirmNo");
    if (delNo) {
        rcCalPendingDelete = "";
        document.getElementById("rcDeleteConfirmDialog").classList.remove("show");
        return;
    }
    const delYes = e.target.closest("#rcDeleteConfirmYes");
    if (delYes) {
        rcConfirmDeleteSnapshot();
        return;
    }
    const mainTab = e.target.closest("#rcTabs .rc-main-tab");
    if (mainTab) {
        document.querySelectorAll("#rcTabs .rc-main-tab").forEach(t => t.classList.remove("active"));
        mainTab.classList.add("active");
        rcActiveTab = mainTab.dataset.tab;
        rcUpdateDimChipsAvailability();
        rcPopulateDimValueSelect();
        rcRenderAll();
        return;
    }
    const dimChip = e.target.closest("#rcDimChips .rc-dim-chip");
    if (dimChip && !dimChip.disabled) {
        document.querySelectorAll("#rcDimChips .rc-dim-chip").forEach(c => c.classList.remove("active"));
        dimChip.classList.add("active");
        rcDim = dimChip.dataset.dim;
        rcDimValue = "";
        rcPopulateDimValueSelect();
        rcRenderAll();
        return;
    }
    const subTab = e.target.closest(".rc-sub-tab");
    if (subTab) {
        rcSubTab[rcActiveTab] = subTab.dataset.sub;
        rcRenderTabBody();
        return;
    }
    const sortTh = e.target.closest("#rcTabBody th[data-sort-key]");
    if (sortTh) {
        rcCycleSort(sortTh.dataset.sortTable, sortTh.dataset.sortKey, sortTh.dataset.sortType);
        rcRenderTabBody();
        return;
    }
});

document.getElementById("rcDimValueSelect").addEventListener("change", (e) => {
    rcDimValue = e.target.value;
    rcRenderAll();
});

function rcInit() {
    document.getElementById("rcCompareBtn").addEventListener("click", rcRunCompare);

    rcLoadDates().then(() => {
        if (rcDates.length) rcRunCompare();
    });
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", rcInit);
} else {
    rcInit();
}
