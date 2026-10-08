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
let rcActiveTab = "os";
let rcSubTab = { wo: "entered", overdue: "changed", t24: "entered" };
let rcDim = "";
let rcDimValue = "";

const RC_DIMENSIONS = { officerId: "Officer", branch: "Branch", product: "Product", location: "Location" };
const RC_SECTION_META = {
    os: { icon: "💰", titleEn: "Loan Outstanding", titleKh: "សមតុល្យឥណទាន" },
    disburse: { icon: "🏦", titleEn: "Loan Disburse", titleKh: "ឥណទានផ្ដល់ឱ្យថ្មី" },
    t24: { icon: "⏱", titleEn: "Balance Loan at Risk (T24)", titleKh: "ហានិភ័យឥណទាន T24" },
    overdue: { icon: "📉", titleEn: "Balance Loan at Risk (NBC Overdue)", titleKh: "ហានិភ័យឥណទាន NBC" },
    wo: { icon: "✍️", titleEn: "Write Off", titleKh: "ឥណទានលុបចោល" }
};
// WO has no Product Type column in its source sheet — the Product
// dimension chip is disabled whenever this tab is active.
const RC_DIM_UNAVAILABLE = { wo: new Set(["product"]) };

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
async function rcApiPost(path, body) {
    const res = await fetch(`${API.BASE_URL}${path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${rcToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(body || {})
    });
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
        rcShowEmpty("មិនទាន់មានទិន្នន័យបម្រុងទុកទេ — សូមចុច Snapshot Now ដើម្បីចាប់ផ្ដើម។ / No backup yet — click Snapshot Now to start.");
        selA.innerHTML = "";
        selB.innerHTML = "";
        if (rcIsAdmin) document.getElementById("rcSnapshotBtn").style.display = "inline-flex";
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

    if (rcIsAdmin) document.getElementById("rcSnapshotBtn").style.display = "inline-flex";
}

// ========================================
// SECTION HEAD — icon + bilingual title naming the active tab, and the
// data-tab attribute the CSS reads for that section's growth/risk accent.
// ========================================
function rcRenderSectionHead() {
    const meta = RC_SECTION_META[rcActiveTab];
    document.getElementById("rcTransitionsCard").dataset.tab = rcActiveTab;
    document.getElementById("rcSectionHead").innerHTML = `
      <span class="rc-section-icon">${meta.icon}</span>
      <div class="rc-section-head-text">
        <div class="rc-section-title">${rcEscapeHtml(meta.titleEn)}</div>
        <div class="rc-section-subtitle">${rcEscapeHtml(meta.titleKh)}</div>
      </div>`;
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
        const dim = chip.dataset.dim;
        const isUnavailable = dim && unavailable.has(dim);
        chip.disabled = isUnavailable;
        chip.title = isUnavailable ? "Not tracked for Write Off" : "";
    });
    if (rcDim && unavailable.has(rcDim)) {
        rcDim = "";
        rcDimValue = "";
        document.querySelectorAll("#rcDimChips .rc-dim-chip").forEach(c => c.classList.toggle("active", c.dataset.dim === ""));
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
    if (!rcDim) { sel.style.display = "none"; sel.innerHTML = ""; return; }

    const values = (rcActiveTab === "os" || rcActiveTab === "disburse")
        ? (rcDiff[rcActiveTab][rcDim] || []).map(r => r.key)
        : rcDimValuesForClientTab(rcActiveTab, rcDim);

    if (rcDimValue && !values.includes(rcDimValue)) rcDimValue = "";

    const label = RC_DIMENSIONS[rcDim];
    sel.innerHTML = `<option value="">គ្រប់ទាំងអស់ / All ${rcEscapeHtml(label)}s</option>` +
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
    if (!filtered.length) return `<div class="op-empty">គ្មានទិន្នន័យ / No rows.</div>`;
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
    if (!keys.size) return `<div class="op-empty">គ្មានទិន្នន័យ / No rows.</div>`;

    const score = k => (enteredBy.get(k) || 0) + (exitedBy.get(k) || 0) + (hasChanged ? (upgradeBy.get(k) || 0) + (downgradeBy.get(k) || 0) : 0);
    const rows = [...keys].sort((a, b) => score(b) - score(a));

    return `
      <div class="rc-breakdown-table-wrap">
        <table class="rc-breakdown-table">
          <thead><tr>
            <th>${rcEscapeHtml(RC_DIMENSIONS[rcDim])}</th>
            <th>✅ Entered</th>
            <th>↩️ Exited</th>
            ${hasChanged ? `<th>⬆ Upgrade</th><th>⬇ Downgrade</th>` : ""}
          </tr></thead>
          <tbody>
            ${rows.map(k => `
              <tr>
                <td>${rcEscapeHtml(k)}</td>
                <td>${enteredBy.get(k) || 0}</td>
                <td>${exitedBy.get(k) || 0}</td>
                ${hasChanged ? `<td>${upgradeBy.get(k) || 0}</td><td>${downgradeBy.get(k) || 0}</td>` : ""}
              </tr>`).join("")}
          </tbody>
        </table>
      </div>`;
}

// ========================================
// CLIENT LIST TABLES (List Client) — WO / T24 / NBC Overdue only.
// ========================================
function rcClientTableHtml(rows, cols) {
    if (!rows.length) {
        return `<div class="op-empty">គ្មានទិន្នន័យ / No rows in this category.</div>`;
    }
    return `
      <div class="op-client-table-wrap">
        <table class="op-client-table">
          <thead><tr>${cols.map(c => `<th>${rcEscapeHtml(c.label)}</th>`).join("")}</tr></thead>
          <tbody>
            ${rows.map(r => `<tr>${cols.map(c => `<td>${c.render ? c.render(r) : rcEscapeHtml(r[c.key])}</td>`).join("")}</tr>`).join("")}
          </tbody>
        </table>
      </div>`;
}

function rcWoCols() {
    return [
        { key: "cif", label: "CIF" },
        { key: "khName", label: "ឈ្មោះ / Name" },
        { key: "branch", label: "សាខា / Branch" },
        { key: "officerId", label: "មន្ត្រី / Officer" },
        { key: "int", label: "Int", render: r => rcFmtNum(r.int) },
        { key: "prn", label: "Prn", render: r => rcFmtNum(r.prn) }
    ];
}
function rcChangedCols() {
    return [
        { key: "cif", label: "CIF" },
        { key: "loanNumber", label: "Loan #" },
        { key: "name", label: "ឈ្មោះ / Name" },
        { key: "branch", label: "សាខា / Branch" },
        { key: "officerId", label: "មន្ត្រី / Officer" },
        { key: "change", label: "ចំណាត់ថ្នាក់ / Class", render: r => `${rcEscapeHtml(r.fromClass)} → ${rcEscapeHtml(r.toClass)}` },
        { key: "direction", label: "", render: r => `<span class="rc-badge ${r.direction}">${r.direction === "downgrade" ? "⬇ Downgrade" : "⬆ Upgrade"}</span>` }
    ];
}
function rcEnterExitCols() {
    return [
        { key: "cif", label: "CIF" },
        { key: "loanNumber", label: "Loan #" },
        { key: "name", label: "ឈ្មោះ / Name" },
        { key: "branch", label: "សាខា / Branch" },
        { key: "officerId", label: "មន្ត្រី / Officer" },
        { key: "cls", label: "ចំណាត់ថ្នាក់ / Class" }
    ];
}
function rcT24EnterExitCols() {
    return [
        { key: "cif", label: "CIF" },
        { key: "loanNumber", label: "Loan #" },
        { key: "name", label: "ឈ្មោះ / Name" },
        { key: "branch", label: "សាខា / Branch" },
        { key: "officerId", label: "មន្ត្រី / Officer" },
        { key: "val", label: "Value", render: r => rcFmtNum(r.val) }
    ];
}

// ========================================
// TAB BODY
// ========================================
function rcRenderTabBody() {
    const diff = rcDiff;
    let html = "";

    if (rcActiveTab === "os" || rcActiveTab === "disburse") {
        if (!rcDim) {
            html += `<div class="op-empty">ជ្រើសរើស មន្ត្រី/សាខា/ផលិតផល/ទីតាំង ដើម្បីមើលការបែងចែក។<br>Pick Officer/Branch/Product/Location above to see a breakdown.</div>`;
        } else {
            const valueField = rcActiveTab === "os" ? "osUsdSum" : "valueSum";
            const valueLabel = rcActiveTab === "os" ? "OS (USD)" : "Disbursed (USD)";
            html += rcRenderOsDisburseBreakdown(valueLabel, valueField);
        }
    } else if (rcActiveTab === "wo") {
        if (rcDim && !rcDimValue) html += rcRenderClientDimBreakdown();
        html += `
          <div class="rc-sub-tabs">
            <button type="button" class="rc-sub-tab${rcSubTab.wo === "entered" ? " active" : ""}" data-sub="entered">✅ ចូលថ្មី / Entered (${rcApplyDimFilter(diff.wo.entered).length})</button>
            <button type="button" class="rc-sub-tab${rcSubTab.wo === "exited" ? " active" : ""}" data-sub="exited">↩️ ចេញ / Exited (${rcApplyDimFilter(diff.wo.exited).length})</button>
          </div>`;
        html += rcClientTableHtml(rcApplyDimFilter(diff.wo[rcSubTab.wo]), rcWoCols());
    } else if (rcActiveTab === "overdue") {
        if (rcDim && !rcDimValue) html += rcRenderClientDimBreakdown();
        html += `
          <div class="rc-sub-tabs">
            <button type="button" class="rc-sub-tab${rcSubTab.overdue === "changed" ? " active" : ""}" data-sub="changed">🔀 ប្ដូរថ្នាក់ / Changed (${rcApplyDimFilter(diff.overdue.changed).length})</button>
            <button type="button" class="rc-sub-tab${rcSubTab.overdue === "entered" ? " active" : ""}" data-sub="entered">✅ ចូលថ្មី / New Overdue (${rcApplyDimFilter(diff.overdue.entered).length})</button>
            <button type="button" class="rc-sub-tab${rcSubTab.overdue === "exited" ? " active" : ""}" data-sub="exited">↩️ ដោះស្រាយ / Resolved (${rcApplyDimFilter(diff.overdue.exited).length})</button>
          </div>`;
        if (rcSubTab.overdue === "changed") html += rcClientTableHtml(rcApplyDimFilter(diff.overdue.changed), rcChangedCols());
        else html += rcClientTableHtml(rcApplyDimFilter(diff.overdue[rcSubTab.overdue]), rcEnterExitCols());
    } else if (rcActiveTab === "t24") {
        if (rcDim && !rcDimValue) html += rcRenderClientDimBreakdown();
        html += `
          <div class="rc-sub-tabs">
            <button type="button" class="rc-sub-tab${rcSubTab.t24 === "changed" ? " active" : ""}" data-sub="changed">🔀 ប្ដូរថ្នាក់ / Changed (${rcApplyDimFilter(diff.t24.changed).length})</button>
            <button type="button" class="rc-sub-tab${rcSubTab.t24 === "entered" ? " active" : ""}" data-sub="entered">✅ ចូលថ្មី / Entered (${rcApplyDimFilter(diff.t24.entered).length})</button>
            <button type="button" class="rc-sub-tab${rcSubTab.t24 === "exited" ? " active" : ""}" data-sub="exited">↩️ ចេញ / Exited (${rcApplyDimFilter(diff.t24.exited).length})</button>
          </div>`;
        if (rcSubTab.t24 === "changed") html += rcClientTableHtml(rcApplyDimFilter(diff.t24.changed), rcChangedCols());
        else html += rcClientTableHtml(rcApplyDimFilter(diff.t24[rcSubTab.t24]), rcT24EnterExitCols());
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
async function rcRunCompare() {
    const dateA = document.getElementById("rcDateA").value;
    const dateB = document.getElementById("rcDateB").value;
    if (!dateA || !dateB) return;

    rcHideEmpty();
    document.getElementById("rcTransitionsCard").style.display = "none";
    document.getElementById("rcPageSkel").style.display = "flex";

    try {
        const data = await rcApiGet(`/api/creditreport/compare?dateA=${encodeURIComponent(dateA)}&dateB=${encodeURIComponent(dateB)}`);
        document.getElementById("rcPageSkel").style.display = "none";
        if (!data.ok) { rcShowEmpty(data.message || "Failed to compare."); return; }

        rcDiff = data.diff;
        document.getElementById("rcTransitionsCard").style.display = "block";
        rcUpdateDimChipsAvailability();
        rcPopulateDimValueSelect();
        rcRenderAll();
    } catch (e) {
        console.error(e);
        document.getElementById("rcPageSkel").style.display = "none";
        rcShowEmpty("Server error while comparing.");
    }
}

// ========================================
// EVENTS
// ========================================
document.addEventListener("click", (e) => {
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
});

document.getElementById("rcDimValueSelect").addEventListener("change", (e) => {
    rcDimValue = e.target.value;
    rcRenderAll();
});

function rcInit() {
    document.getElementById("rcCompareBtn").addEventListener("click", rcRunCompare);
    document.getElementById("rcSnapshotBtn").addEventListener("click", async () => {
        const btn = document.getElementById("rcSnapshotBtn");
        btn.disabled = true;
        try {
            const data = await rcApiPost("/api/creditreport/snapshot/run", {});
            if (data.ok) {
                rcNotify(`Snapshot saved for ${data.date}`, "success");
                // A failure here (date list refresh) shouldn't be reported
                // as the snapshot itself having failed — it already saved.
                try { await rcLoadDates(); } catch (e) { console.error(e); }
            } else {
                rcNotify(data.message || "Snapshot failed", "error");
            }
        } catch (e) {
            console.error(e);
            rcNotify("Snapshot failed", "error");
        } finally {
            btn.disabled = false;
        }
    });

    rcLoadDates().then(() => {
        if (rcDates.length) rcRunCompare();
    });
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", rcInit);
} else {
    rcInit();
}
