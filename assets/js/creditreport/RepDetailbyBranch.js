// ========================================
// Credit Report — "RepDetail byBranch" Summary Report web port
// Reads from GET /api/creditreport/summary (computed live from
// nbcos/arreast24byco/nbcoverdue/wo/wocolgb — see
// lib/creditreport-report.js on the backend for the exact formulas).
//
// UI note: instead of one 36-column table requiring constant
// horizontal scroll, the person picks ONE metric group at a time
// (crSection dropdown) and only that group's columns render, with
// Branch pinned as the sticky first column. Data is fetched once and
// cached in crData — switching sections just re-renders, no refetch.
// Each row (and the grand Total row) can also expand inline to show its
// CO/FSRO/Digital breakdown — see crToggleBranchExpand() below — or all
// at once via the caret in the Branch column header (crToggleExpandAll()).
// ========================================

const crToken =
    localStorage.getItem("token") ||
    sessionStorage.getItem("token");

let crSummaryData = null;  // { items, total } from /api/creditreport/summary
let crDetailedData = null; // { groups, grand } from /api/creditreport/detailed — fetched lazily
// Branch names whose CO/FSRO/Digital breakdown is currently expanded
// inline under their Total-only row ("All Branch" for the grand Total
// row at the bottom). Several can be open at once (e.g. via Expand All).
let crExpandedBranches = new Set();
// PAR % at or above this is rendered red in every PAR column.
const CR_PAR_ALERT = 0.04;

let crLoanReclass = null;  // { value, count } — rendered in the note under the T24 columns
let crBalancePD = null;    // { value, count } — the other half of that note

// ========================================
// DAILY HISTORY — "current" (today's live report, unchanged default
// behaviour) vs "history" (a Date column added to this same table, one
// row per branch per day across a date range), per explicit request
// 2026-10-01. Backed by CM-backend's /api/creditreport/summary/history,
// which snapshots this exact table once a day — see
// lib/creditreport-branch.js's runBranchDailySnapshotNow().
// ========================================
let crMode = "current"; // "current" | "history"
let crHistoryData = null; // { days: [{ date, items, total }, ...] }
const crLoggedInUser = JSON.parse(
    localStorage.getItem("loggedInUser") || sessionStorage.getItem("loggedInUser") || "{}"
);
const crIsAdmin = String(crLoggedInUser.role || "").toLowerCase() === "admin";

// ========================================
// SECTION DEFINITIONS
// Each field's `key` is a dot-path into a branch item (or `total`).
// money:true -> thousands-formatted number. pct:true -> XX.XX%.
// ========================================
function crGroupPct(prefix, label, labelKh) {
    return {
        label, labelKh,
        fields: [
            { key: prefix + ".count", label: "# Loan" },
            { key: prefix + ".value", label: "Value", money: true },
            { key: prefix + ".parPct", label: "PAR %", pct: true }
        ]
    };
}

const CR_SECTIONS = {
    outstanding: {
        groups: [{
            label: "Loan Outstanding", labelKh: "សមតុល្យឥណទាន",
            fields: [
                { key: "loanOutstanding.loan", label: "# Loan" },
                { key: "loanOutstanding.client", label: "# Client" },
                { key: "loanOutstanding.value", label: "Value", money: true }
            ]
        }]
    },
    disburse: {
        groups: [{
            label: "Loan Disburse",
            fields: [
                { key: "loanDisburse.loan", label: "# Loan" },
                { key: "loanDisburse.value", label: "Value", money: true }
            ]
        }]
    },
    parT24: {
        groups: [{
            label: "Balance Loan at Risk (T24)",
            fields: [
                { key: "parT24.loan", label: "# Loan" },
                { key: "parT24.value", label: "Value", money: true },
                { key: "parT24.parPct", label: "PAR %", pct: true }
            ]
        }]
    },
    nbcOverdue: {
        groups: [
            crGroupPct("nbcOverdue.minor", "Minor Default"),
            crGroupPct("nbcOverdue.specialMention", "Special Mention"),
            crGroupPct("nbcOverdue.subStandard", "Sub-Standard"),
            crGroupPct("nbcOverdue.doubtful", "Doubtful"),
            crGroupPct("nbcOverdue.loss", "Loss"),
            crGroupPct("nbcOverdue.majorDefault", "Major Default"),
            crGroupPct("nbcOverdue.nonPerformingLoan", "Non Performing Loan"),
            crGroupPct("nbcOverdue.total", "Total NBC Overdue")
        ]
    },
    writeOff: {
        groups: [
            {
                label: "Balance WO",
                fields: [
                    { key: "writeOff.balanceWO.cif", label: "# (cif)" },
                    { key: "writeOff.balanceWO.int", label: "Int", money: true },
                    { key: "writeOff.balanceWO.prn", label: "Prn", money: true }
                ]
            },
            {
                label: "WO",
                fields: [
                    { key: "writeOff.wo.count", label: "#" },
                    { key: "writeOff.wo.prn", label: "Prn", money: true }
                ]
            },
            {
                label: "WO Collected",
                fields: [
                    { key: "writeOff.woCollected.int", label: "Int", money: true },
                    { key: "writeOff.woCollected.prn", label: "Prn", money: true }
                ]
            }
        ]
    }
};
CR_SECTIONS.all = {
    groups: [
        ...CR_SECTIONS.outstanding.groups,
        ...CR_SECTIONS.disburse.groups,
        ...CR_SECTIONS.parT24.groups,
        ...CR_SECTIONS.nbcOverdue.groups,
        ...CR_SECTIONS.writeOff.groups
    ]
};

// ========================================
// DATE HELPERS
// ========================================
function crToDMY(dateStr) {
    if (!dateStr) return "";
    const [y, m, d] = dateStr.split("-");
    return `${d}-${m}-${y}`;
}

// Date inputs start EMPTY. On first load we send no date params at all;
// the server derives the defaults from the data itself (latest OS
// disbursement date -> 1st of that month, and Jan 1 - Dec 31 of that year
// for Write Off, mirroring the Excel formulas) and echoes back what it
// used, which we then fill in below. This avoids the client guessing
// "today" when the data's latest date may be older or newer.
let crDatesInitialised = false;

function crApplyServerDates(data) {
    if (crDatesInitialised) return;
    const set = (id, dmy) => {
        if (!dmy) return;
        // server returns yyyy-mm-dd (toDateKey), which is what <input type=date> wants
        document.getElementById(id).value = dmy;
    };
    set("crFromDate", data.fromDate);
    set("crToDate", data.toDate);
    set("crWoFromDate", data.woFromDate);
    set("crWoToDate", data.woToDate);
    crDatesInitialised = true;
}

// ========================================
// URL STATE
// Mirrors the current section/dates into the address bar via
// history.replaceState (no new history entries added, so this doesn't
// turn every dropdown click into its own back-button stop) — so
// navigating away (e.g. to Setting via the bottom nav) and back via
// the topbar's back arrow (history.back()) lands on the exact same
// report instead of the blank defaults.
// ========================================
function crReadStateFromUrl() {
    const p = new URLSearchParams(location.search);

    const section = p.get("section");
    if (section && CR_SECTIONS[section]) {
        document.getElementById("crSection").value = section;
    }

    // Dates restored from the URL take priority over the server's
    // data-derived defaults — same reasoning as a person having typed
    // them in by hand.
    let hasDateParam = false;
    const setDate = (id, param) => {
        const v = p.get(param);
        if (v) {
            document.getElementById(id).value = v;
            hasDateParam = true;
        }
    };
    setDate("crFromDate", "fromDate");
    setDate("crToDate", "toDate");
    setDate("crWoFromDate", "woFromDate");
    setDate("crWoToDate", "woToDate");
    if (hasDateParam) crDatesInitialised = true;

    const t24Class = p.get("t24Class");
    if (t24Class) {
        const classSel = document.getElementById("crClass");
        if ([...classSel.options].some(o => o.value === t24Class)) {
            classSel.value = t24Class;
        }
    }

    const t24Product = p.get("t24Product");
    if (t24Product) {
        const productSel = document.getElementById("crProduct");
        if ([...productSel.options].some(o => o.value === t24Product)) {
            productSel.value = t24Product;
        }
    }

    const nbcClass = p.get("nbcClass");
    if (nbcClass) {
        const nbcClassSel = document.getElementById("crNbcClass");
        if ([...nbcClassSel.options].some(o => o.value === nbcClass)) {
            nbcClassSel.value = nbcClass;
        }
    }

    const nbcProduct = p.get("nbcProduct");
    if (nbcProduct) {
        const nbcProductSel = document.getElementById("crNbcProduct");
        if ([...nbcProductSel.options].some(o => o.value === nbcProduct)) {
            nbcProductSel.value = nbcProduct;
        }
    }
}

function crSyncStateToUrl() {
    const p = new URLSearchParams();
    p.set("section", document.getElementById("crSection").value);

    const addDate = (param, id) => {
        const v = document.getElementById(id).value;
        if (v) p.set(param, v);
    };
    addDate("fromDate", "crFromDate");
    addDate("toDate", "crToDate");
    addDate("woFromDate", "crWoFromDate");
    addDate("woToDate", "crWoToDate");

    const t24Class = document.getElementById("crClass").value;
    if (t24Class) p.set("t24Class", t24Class);

    const t24Product = document.getElementById("crProduct").value;
    if (t24Product) p.set("t24Product", t24Product);

    const nbcClass = document.getElementById("crNbcClass").value;
    if (nbcClass) p.set("nbcClass", nbcClass);

    const nbcProduct = document.getElementById("crNbcProduct").value;
    if (nbcProduct) p.set("nbcProduct", nbcProduct);

    history.replaceState(null, "", `${location.pathname}?${p.toString()}`);
}

// ========================================
// META — report "as of" dates + Loan Reclass summary.
// These come from the data, not from the filters, so they don't change
// when the person picks different dates.
// ========================================
function crRenderMeta(meta) {
    if (!meta) return;

    // These arrive pre-formatted from the server (dd/mm/yyyy, plus HH:MM
    // where the source cell carried a time) — no client-side reformatting.
    document.getElementById("crOsGridMerge").textContent = meta.osGridMergeText || "-";
    document.getElementById("crOverdueGridMerge").textContent = meta.overdueGridMergeText || "-";
    document.getElementById("crArrearsPenalty").textContent = meta.arrearsPenaltyText || "-";

    // Held for the table note — it renders under the T24 columns, not here.
    crLoanReclass = meta.loanReclass || { value: 0, count: 0 };
    crBalancePD = meta.balancePD || { value: 0, count: 0 };
}

// Shows how the T24 figure relates to Reclass and Balance PD. Rendered
// as a note under the table whenever the T24 columns are on screen,
// rather than as standalone stats in the info card.
function crRenderReclassNote(sectionKey) {
    const el = document.getElementById("crReclassNote");
    // Only on the dedicated T24 section. In "All Sections" the T24
    // columns are one group among many, so a note referring to them
    // sits too far from what it describes to be readable.
    const showsT24 = sectionKey === "parT24";

    if (!showsT24 || !crLoanReclass) {
        el.style.display = "none";
        return;
    }

    const rc = crLoanReclass;
    const pd = crBalancePD || { value: 0, count: 0 };

    // Uses the full "Balance Loan at Risk (T24)" name rather than the
    // "T24" shorthand so each line stands on its own when read aloud or
    // exported, without depending on the column header above it.
    el.innerHTML =
        `<div class="cr-note-item">` +
          `<span class="cr-note-lead">សំគាល់:</span> ` +
          `<span class="cr-note-label">Balance Loan at Risk (T24) រួមបញ្ចូល Reclass ` +
            `<span class="cr-note-value">$${crFmtNum(rc.value)} · ${crFmtNum(rc.count)} LD</span>` +
            ` និងដកចេញ Balance PD ` +
            `<span class="cr-note-value cr-note-out">$${crFmtNum(pd.value)} · ${crFmtNum(pd.count)} LD</span>` +
          `</span>` +
        `</div>` +
        `<div class="cr-note-item cr-note-warn">` +
          `<span class="cr-note-lead">ប្រុងប្រយ័ត្នៈ</span> ` +
          `<span class="cr-note-label">ឥណទាន\u200bដែលមាន Balance PD ត្រូវតែ\u200b PD ` +
            `អោយបានរួចរាល់ទាំងអស់ក្នុងថ្ងៃ\u200b ។</span>` +
        `</div>`;
    el.style.display = "";
}

function crFmtDateDMY(yyyymmdd) {
    if (!yyyymmdd) return "-";
    const [y, m, d] = yyyymmdd.split("-");
    return `${d}-${m}-${y}`;
}

// ========================================
// FORMAT HELPERS
// ========================================
// table_to_sheet() reads raw DOM text (branch names among it) straight
// into cells — Excel treats a cell string starting with =, +, -, @, or a
// tab/CR as a formula when the file is opened, so this neutralizes any
// such string cell (a leading apostrophe forces plain text) before the
// workbook is written. Only touches string cells (t:"s"); numeric report
// figures are untouched.
function crSanitizeSheetFormulas(ws) {
    if (!ws["!ref"]) return;
    const range = XLSX.utils.decode_range(ws["!ref"]);
    for (let r = range.s.r; r <= range.e.r; r++) {
        for (let c = range.s.c; c <= range.e.c; c++) {
            const cell = ws[XLSX.utils.encode_cell({ r, c })];
            if (cell && cell.t === "s" && /^[=+\-@\t\r]/.test(cell.v)) {
                cell.v = `'${cell.v}`;
                if (cell.w) cell.w = cell.v;
            }
        }
    }
}

function crEscapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text == null ? "" : String(text);
    return div.innerHTML.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function crFmtNum(n) {
    n = Number(n) || 0;
    return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}
function crFmtPct(n) {
    n = Number(n) || 0;
    return (n * 100).toFixed(2) + "%";
}
function crGetByPath(obj, path) {
    return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function crFmtField(item, field) {
    const v = crGetByPath(item, field.key);
    const cls = crFieldClass(field);
    if (field.pct) {
        const n = Number(v) || 0;
        // Anything at or above 4% is flagged red across every PAR column.
        const parCls = n >= CR_PAR_ALERT ? " cr-par-high" : "";
        return `<td class="${cls}${parCls}">${crFmtPct(n)}</td>`;
    }
    return `<td class="${cls}">${crFmtNum(v)}</td>`;
}

// ========================================
// RENDER: build thead + tbody for the selected section
// ========================================
function crFieldClass(field) {
    if (field.pct) return "cr-col-pct";
    if (field.money) return "cr-col-money";
    return "cr-col-num";
}

// All branch keys a full Expand All would open — every real branch plus
// "All Branch" (the grand Total row's own key, see crBuildRow).
function crAllBranchKeys() {
    if (!crSummaryData) return [];
    return ["All Branch", ...crSummaryData.items.map(it => it.branch)];
}
function crIsAllExpanded() {
    const keys = crAllBranchKeys();
    return keys.length > 0 && !!crDetailedData && keys.every(k => crExpandedBranches.has(k));
}

// ========================================
// COLUMN SORT
// Every column header is clickable and cycles through 3 states:
// ascending -> descending -> default (the order the server returned,
// unsorted) -> ascending again. crSummaryData.items itself is never
// mutated — crApplySort() returns a sorted COPY (or the original array,
// untouched, once the cycle reaches "default") — so the original fetch
// order is always there to go back to. The grand Total row always stays
// pinned at the bottom, since it's appended separately in
// crRenderSummary() rather than sorted along with the rest.
// Expand/collapse state (crExpandedBranches, keyed by branch name) and
// crDetailedData's own group lookup (also by branch name) are both
// unaffected by row order, so sorting is safe to apply regardless of
// which rows are currently expanded.
// ========================================
let crSortState = { key: null, dir: 1 };

function crCompareForSort(a, b, type) {
    const blank = v => v === "" || v == null;
    if (type === "text") {
        const sa = blank(a) ? "" : String(a).toLowerCase();
        const sb = blank(b) ? "" : String(b).toLowerCase();
        return sa < sb ? -1 : sa > sb ? 1 : 0;
    }
    const na = blank(a) ? -Infinity : Number(a);
    const nb = blank(b) ? -Infinity : Number(b);
    return (isNaN(na) ? -Infinity : na) - (isNaN(nb) ? -Infinity : nb);
}

function crApplySort(items) {
    if (!crSortState.key) return items;
    const { key, dir, type } = crSortState;
    return items.slice().sort((a, b) => dir * crCompareForSort(
        key === "_name" ? a.branch : crGetByPath(a, key),
        key === "_name" ? b.branch : crGetByPath(b, key),
        type
    ));
}

function crBuildThead(section) {
    const sortCls = key => {
        if (crSortState.key !== key) return "";
        return crSortState.dir === 1 ? " cr-sort-asc" : " cr-sort-desc";
    };
    const groupCells = section.groups.map(g =>
        `<th colspan="${g.fields.length}">${g.label}</th>`
    ).join("");

    const subCells = section.groups.map(g =>
        g.fields.map(f => `<th class="${crFieldClass(f)}${sortCls(f.key)}" data-sort-key="${f.key}" data-sort-type="number">${f.label}</th>`).join("")
    ).join("");

    const allExpanded = crIsAllExpanded();

    return `
      <tr class="cr-group-row">
        <th rowspan="2" class="cr-branch-col${sortCls("_name")}" data-sort-key="_name" data-sort-type="text">
          <button type="button" id="crExpandAllBtn" class="cr-row-expand-btn cr-expand-all-btn${allExpanded ? " open" : ""}" aria-expanded="${allExpanded}" aria-label="Expand or collapse all rows">▾</button>
          Branch
        </th>
        ${groupCells}
      </tr>
      <tr class="cr-sub-row">
        ${subCells}
      </tr>`;
}

// One CO/FSRO/Digital line nested under a row's own Total-only figures —
// same column count as crBuildRow (one leading cell, then the section's
// fields) so it fits the thead.
function crBuildSummaryBreakdownRow(item, section, team) {
    const cells = section.groups.map(g =>
        g.fields.map(f => crFmtField(item, f)).join("")
    ).join("");
    return `
      <tr class="cr-breakdown-row">
        <td class="cr-branch-col">${crEscapeHtml(team)}</td>
        ${cells}
      </tr>`;
}

function crBuildRow(item, section, isTotal) {
    const cells = section.groups.map(g =>
        g.fields.map(f => crFmtField(item, f)).join("")
    ).join("");
    const branchKey = isTotal ? "All Branch" : item.branch;
    const branchLabel = isTotal ? "Total" : item.branch;
    const isExpanded = crExpandedBranches.has(branchKey);
    const branchCell = `
        <button type="button" class="cr-row-expand-btn${isExpanded ? " open" : ""}" data-branch="${crEscapeHtml(branchKey)}" aria-expanded="${isExpanded}" aria-label="Toggle CO/FSRO/Digital breakdown">▾</button>
        <button type="button" class="cr-branch-link" data-branch="${crEscapeHtml(branchKey)}">${crEscapeHtml(branchLabel)}</button>`;

    let html = `
      <tr${isTotal ? ' class="cr-total-row"' : ""}>
        <td class="cr-branch-col">${branchCell}</td>
        ${cells}
      </tr>`;

    if (isExpanded && crDetailedData) {
        let co, fsro, digital;
        if (isTotal) {
            ({ co, fsro, digital } = crDetailedData.grand);
        } else {
            const group = crDetailedData.groups.find(g => g.branch === item.branch);
            if (group) [co, fsro, digital] = group.rows;
        }
        if (co) {
            html +=
                crBuildSummaryBreakdownRow(co, section, "CO") +
                crBuildSummaryBreakdownRow(fsro, section, "FSRO") +
                crBuildSummaryBreakdownRow(digital, section, "Digital");
        }
    }
    return html;
}

// Maps the NBC Overdue Loan Class filter's values to the matching group's
// index within CR_SECTIONS.nbcOverdue.groups (built in this same fixed
// order — see CR_SECTIONS above) — lets the Loan Class filter collapse
// the wide 7-classification table down to just the one selected, the
// same single-group shape parT24 already renders as. Every classification
// is already present in the API response regardless of this filter, so
// no refetch is needed — this is purely a display choice.
const CR_NBC_CLASS_INDEX = {
    minor: 0, specialMention: 1, subStandard: 2, doubtful: 3,
    loss: 4, majorDefault: 5, nonPerformingLoan: 6
};

function crActiveSection(sectionKey) {
    const section = CR_SECTIONS[sectionKey];
    if (sectionKey !== "nbcOverdue") return section;

    const nbcClass = document.getElementById("crNbcClass").value;
    const idx = CR_NBC_CLASS_INDEX[nbcClass];
    if (idx === undefined) return section;
    return { groups: [section.groups[idx]] };
}

function crRenderSummary() {
    if (!crSummaryData) return;
    const sectionKey = document.getElementById("crSection").value;
    const section = crActiveSection(sectionKey);

    const displayItems = crApplySort(crSummaryData.items);

    document.getElementById("crThead").innerHTML = crBuildThead(section);
    document.getElementById("crTbody").innerHTML =
        displayItems.map(it => crBuildRow(it, section, false)).join("") +
        crBuildRow(crSummaryData.total, section, true);

    crRenderReclassNote(sectionKey);
    requestAnimationFrame(crSetHeaderOffsets);
}

// ========================================
// HISTORY MODE — same section/field definitions as the live table
// (crActiveSection, crFmtField, crFieldClass all reused as-is), just
// with an extra Date column and one row per (branch, date) instead of
// one row per branch. Each row can also expand inline to its own
// CO/FSRO/Digital breakdown — same idea as crToggleBranchExpand() for
// the live table, but the data is already on the item (item.breakdown,
// saved by the daily snapshot itself) so no extra fetch is needed.
// ========================================
// (branch|date) keys of history rows currently expanded — separate from
// crExpandedBranches, which is keyed by branch name alone and belongs to
// the live table's own expand/collapse state.
let crHistoryExpandedRows = new Set();

function crHistoryRowKey(branchKey, dateKey) {
    return `${branchKey}|${dateKey}`;
}

function crBuildHistoryThead(section) {
    const groupCells = section.groups.map(g =>
        `<th colspan="${g.fields.length}">${g.label}</th>`
    ).join("");
    const subCells = section.groups.map(g =>
        g.fields.map(f => `<th class="${crFieldClass(f)}">${f.label}</th>`).join("")
    ).join("");
    return `
      <tr class="cr-group-row">
        <th rowspan="2" class="cr-branch-col">Branch</th>
        <th rowspan="2" class="cr-date-col">Date</th>
        ${groupCells}
      </tr>
      <tr class="cr-sub-row">
        ${subCells}
      </tr>`;
}

function crBuildHistoryRow(dateKey, item, section, isTotal) {
    const cells = section.groups.map(g =>
        g.fields.map(f => crFmtField(item, f)).join("")
    ).join("");
    const branchKey = isTotal ? "All Branch" : item.branch;
    const branchLabel = isTotal ? "Total" : item.branch;
    const rowKey = crHistoryRowKey(branchKey, dateKey);
    const isExpanded = crHistoryExpandedRows.has(rowKey);
    const branchCell = item.breakdown
        ? `<button type="button" class="cr-row-expand-btn${isExpanded ? " open" : ""}" data-hist-key="${crEscapeHtml(rowKey)}" aria-expanded="${isExpanded}" aria-label="Toggle CO/FSRO/Digital breakdown">▾</button>${crEscapeHtml(branchLabel)}`
        : crEscapeHtml(branchLabel);

    let html = `
      <tr${isTotal ? ' class="cr-total-row"' : ""}>
        <td class="cr-branch-col">${branchCell}</td>
        <td class="cr-date-col">${crFmtDateDMY(dateKey)}</td>
        ${cells}
      </tr>`;

    if (isExpanded && item.breakdown) {
        html +=
            crBuildHistoryBreakdownRow(dateKey, item.breakdown.co, section, "CO") +
            crBuildHistoryBreakdownRow(dateKey, item.breakdown.fsro, section, "FSRO") +
            crBuildHistoryBreakdownRow(dateKey, item.breakdown.digital, section, "Digital");
    }
    return html;
}

// Same shape as crBuildSummaryBreakdownRow (the live table's own), with
// the same Date as its parent row so every row still carries a date.
function crBuildHistoryBreakdownRow(dateKey, item, section, team) {
    const cells = section.groups.map(g =>
        g.fields.map(f => crFmtField(item, f)).join("")
    ).join("");
    return `
      <tr class="cr-breakdown-row">
        <td class="cr-branch-col">${crEscapeHtml(team)}</td>
        <td class="cr-date-col">${crFmtDateDMY(dateKey)}</td>
        ${cells}
      </tr>`;
}

function crRenderHistory() {
    if (!crHistoryData) return;
    const sectionKey = document.getElementById("crSection").value;
    const section = crActiveSection(sectionKey);

    document.getElementById("crThead").innerHTML = crBuildHistoryThead(section);

    if (!crHistoryData.days.length) {
        document.getElementById("crTbody").innerHTML = "";
        crShowEmpty("គ្មានទិន្នន័យសម្រាប់ចន្លោះកាលបរិច្ឆេទនេះទេ / No history saved for this date range yet.");
        return;
    }

    // Grouped by branch (each branch's day-by-day run together), in the
    // same branch order the first day's items came back in — then one
    // "Total" block, both in chronological date order within each block.
    const branchOrder = crHistoryData.days[0].items.map(it => it.branch);
    let rowsHtml = "";
    for (const branch of branchOrder) {
        for (const day of crHistoryData.days) {
            const item = day.items.find(it => it.branch === branch);
            if (item) rowsHtml += crBuildHistoryRow(day.date, item, section, false);
        }
    }
    for (const day of crHistoryData.days) {
        rowsHtml += crBuildHistoryRow(day.date, day.total, section, true);
    }

    document.getElementById("crTbody").innerHTML = rowsHtml;
    document.getElementById("crTableScroll").style.display = "block";
    document.getElementById("crEmptyMsg").style.display = "none";
    requestAnimationFrame(crSetHeaderOffsets);
}

async function crFetchHistory() {
    const dateFrom = document.getElementById("crHistFromDate").value;
    const dateTo = document.getElementById("crHistToDate").value;
    if (!dateFrom || !dateTo) return;

    crShowLoading();
    try {
        const url = `${API.BASE_URL}/api/creditreport/summary/history?dateFrom=${dateFrom}&dateTo=${dateTo}`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${crToken}` } });
        const data = await res.json();
        crHideLoading();

        if (!data.ok) {
            crShowEmpty(data.message || "Failed to load history.");
            return;
        }
        crHistoryData = data;
        crRenderHistory();
    } catch (e) {
        console.error(e);
        crHideLoading();
        crShowEmpty("Network error loading history.");
    }
}

function crSetMode(mode) {
    crMode = mode;
    document.getElementById("crModeCurrentBtn").classList.toggle("active", mode === "current");
    document.getElementById("crModeHistoryBtn").classList.toggle("active", mode === "history");
    document.getElementById("crHistoryPanel").style.display = mode === "history" ? "block" : "none";
    crUpdateClassVisibility();

    if (mode === "current") {
        if (crSummaryData) {
            document.getElementById("crTableScroll").style.display = "block";
            document.getElementById("crEmptyMsg").style.display = "none";
            crRenderSummary();
        }
    } else if (crHistoryData) {
        crRenderHistory();
    } else {
        document.getElementById("crTableScroll").style.display = "none";
        crShowEmpty("ជ្រើសរើសចន្លោះកាលបរិច្ឆេទ រួចចុច \"មើលប្រវត្តិ\" / Pick a date range, then click \"View History\".");
    }
}

// ========================================
// BRANCH DRILL-DOWN
// Clicking a branch name opens Branch Productivity for it — same
// pattern as RepDetailbyCO.js's officer-name drill-down, but simpler:
// Branch Productivity always fetches its own summary (there's no
// already-fetched CO/FSRO/Digital Loan breakdown to hand off — this
// report only ever has each branch's combined Total), so only the
// branch name + current date filters need to travel in the URL, no
// sessionStorage cache.
// ========================================
// INLINE EXPAND/COLLAPSE (CO/FSRO/Digital)
// Toggling a row (or Expand All, in the Branch header) fetches
// /api/creditreport/detailed on first use, cached in crDetailedData so
// every expand after the first — one row or all of them — is instant.
// A failed fetch leaves the already-working table alone rather than
// replacing it with an empty state.
// ========================================
// Ensures crDetailedData is populated, fetching once if needed. Returns
// true on success (including when already cached); callers add to
// crExpandedBranches and re-render themselves, only once this resolves.
async function crEnsureDetailedData() {
    if (crDetailedData) return true;

    if (typeof showAppLoading === "function") showAppLoading("Loading breakdown...");
    try {
        const url = `${API.BASE_URL}/api/creditreport/detailed${crBuildDateQuery()}`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${crToken}` } });
        const data = await res.json();
        if (!data.ok || !data.groups || !data.groups.length) {
            throw new Error(data.message || "Could not load the breakdown.");
        }
        crDetailedData = data;
        return true;
    } catch (e) {
        console.error(e);
        if (typeof showToast === "function") {
            showToast("Could not load the breakdown. Please try again.", "error");
        }
        return false;
    } finally {
        if (typeof hideAppLoading === "function") hideAppLoading();
    }
}

async function crToggleBranchExpand(branch) {
    if (crExpandedBranches.has(branch)) {
        crExpandedBranches.delete(branch);
        crRenderSummary();
        return;
    }
    if (!(await crEnsureDetailedData())) return;
    crExpandedBranches.add(branch);
    crRenderSummary();
}

async function crToggleExpandAll() {
    if (crIsAllExpanded()) {
        crExpandedBranches.clear();
        crRenderSummary();
        return;
    }
    if (!(await crEnsureDetailedData())) return;
    crAllBranchKeys().forEach(k => crExpandedBranches.add(k));
    crRenderSummary();
}

document.getElementById("crThead").addEventListener("click", (e) => {
    if (e.target.closest("#crExpandAllBtn")) {
        crToggleExpandAll();
        return;
    }
    // Clicking a column header cycles it through ascending -> descending
    // -> default (unsorted, the order the server returned) -> ascending
    // again. Clicking a different header always starts that header fresh
    // at ascending. Guarded above so a click on the Expand All caret
    // (nested inside the Branch header cell) never also triggers a sort.
    const th = e.target.closest("th[data-sort-key]");
    if (!th) return;
    const key = th.dataset.sortKey;
    const type = th.dataset.sortType || "text";
    if (crSortState.key !== key) {
        crSortState = { key, type, dir: 1 };
    } else if (crSortState.dir === 1) {
        crSortState = { key, type, dir: -1 };
    } else {
        crSortState = { key: null, type: null, dir: 1 };
    }
    crRenderSummary();
});

document.getElementById("crTbody").addEventListener("click", (e) => {
    const expandBtn = e.target.closest(".cr-row-expand-btn");
    if (expandBtn && expandBtn.dataset.histKey) {
        // History rows already carry their own CO/FSRO/Digital breakdown
        // (saved by the daily snapshot itself) — no fetch needed, just
        // toggle and re-render.
        const key = expandBtn.dataset.histKey;
        if (crHistoryExpandedRows.has(key)) crHistoryExpandedRows.delete(key);
        else crHistoryExpandedRows.add(key);
        crRenderHistory();
        return;
    }
    if (expandBtn) {
        crToggleBranchExpand(expandBtn.dataset.branch);
        return;
    }

    const link = e.target.closest(".cr-branch-link");
    if (!link) return;

    const q = new URLSearchParams({
        branch: link.dataset.branch,
        fromDate: document.getElementById("crFromDate").value,
        toDate: document.getElementById("crToDate").value,
        woFromDate: document.getElementById("crWoFromDate").value,
        woToDate: document.getElementById("crWoToDate").value
    });
    location.href = `BranchProductivity.html?${q.toString()}`;
});

document.getElementById("crSection").addEventListener("change", () => {
    crUpdateClassVisibility();
    if (crMode === "history") crRenderHistory(); else crRenderSummary();
    crSyncStateToUrl();
});
document.getElementById("crClass").addEventListener("change", crRunReport);
document.getElementById("crProduct").addEventListener("change", crRunReport);
// crNbcClass only picks which already-fetched classification to display
// (see crActiveSection()) — local re-render, no refetch, same as
// switching "Showing" itself.
document.getElementById("crNbcClass").addEventListener("change", () => {
    if (crMode === "history") crRenderHistory(); else crRenderSummary();
    crSyncStateToUrl();
});
document.getElementById("crNbcProduct").addEventListener("change", crRunReport);

// ========================================
// STICKY HEADER OFFSET
// The sub-header row must stick right under the group-header row,
// but the group row's height changes with text wrapping — measure
// the real rendered height instead of guessing a fixed px value.
// ========================================
function crSetHeaderOffsets() {
    const groupRow = document.querySelector("#crTable thead tr.cr-group-row");
    const subRow = document.querySelector("#crTable thead tr.cr-sub-row");
    if (!groupRow || !subRow) return;
    const h = groupRow.getBoundingClientRect().height;
    subRow.querySelectorAll("th").forEach(th => { th.style.top = h + "px"; });
}
window.addEventListener("resize", crSetHeaderOffsets);
window.addEventListener("orientationchange", () => setTimeout(crSetHeaderOffsets, 200));

// ========================================
// LOADING STATE
// ========================================
// Uses the app-wide loading overlay (shared/loading.js) rather than an
// in-button spinner — the button lives inside the collapsible date panel,
// which is usually closed, so a spinner there would often be invisible
// while the report was actually loading.
function crShowLoading(message = "Loading Report Data...") {
    document.getElementById("crSkeleton").style.display = "block";
    document.getElementById("crTableScroll").style.display = "none";
    document.getElementById("crEmptyMsg").style.display = "none";
    document.getElementById("crReclassNote").style.display = "none";
    document.getElementById("btnCrRun").disabled = true;
    if (typeof showAppLoading === "function") {
        showAppLoading(message);
    }
}
function crHideLoading() {
    document.getElementById("crSkeleton").style.display = "none";
    document.getElementById("btnCrRun").disabled = false;
    if (typeof hideAppLoading === "function") {
        hideAppLoading();
    }
}
function crShowEmpty(msg) {
    const empty = document.getElementById("crEmptyMsg");
    empty.textContent = msg;
    empty.style.display = "block";
    document.getElementById("crTableScroll").style.display = "none";
    document.getElementById("crReclassNote").style.display = "none";
}

// Builds the ?fromDate=...&toDate=... query string, OMITTING any date the
// person hasn't set. A missing param tells the server to use its own
// data-derived default rather than us guessing one client-side.
function crBuildDateQuery() {
    const parts = [];
    const add = (param, id) => {
        const v = document.getElementById(id).value;
        if (v) parts.push(`${param}=${crToDMY(v)}`);
    };
    add("fromDate", "crFromDate");
    add("toDate", "crToDate");
    add("woFromDate", "crWoFromDate");
    add("woToDate", "crWoToDate");

    const t24Class = document.getElementById("crClass").value;
    if (t24Class) parts.push(`t24Class=${encodeURIComponent(t24Class)}`);

    const t24Product = document.getElementById("crProduct").value;
    if (t24Product) parts.push(`t24Product=${encodeURIComponent(t24Product)}`);

    // crNbcClass is NOT sent — every classification is already in the
    // response (see crActiveSection() above), so it's a display-only pick.
    const nbcProduct = document.getElementById("crNbcProduct").value;
    if (nbcProduct) parts.push(`nbcProduct=${encodeURIComponent(nbcProduct)}`);
    return parts.length ? `?${parts.join("&")}` : "";
}

// The T24 Loan Class/Product Type filters only mean something for the
// Balance Loan at Risk (T24) section, and the NBC Overdue Loan
// Class/Product Type filters only for the NBC Overdue section — hide
// each pair otherwise so they can't be mistaken for applying to a
// section they don't affect.
function crUpdateClassVisibility() {
    const section = document.getElementById("crSection").value;
    const isT24 = section === "parT24";
    const isNbc = section === "nbcOverdue";
    // History rows are precomputed daily snapshots with every
    // classification/product already in them (see crActiveSection()) —
    // the T24/NBC Product Type filters need a server-side recompute this
    // view doesn't do, so they're hidden in History mode. The NBC Loan
    // Class picker stays: it's a local display pick among the
    // already-fetched classifications, same as in Current mode.
    const isHistory = crMode === "history";
    document.getElementById("crClassRow").style.display = (isT24 && !isHistory) ? "" : "none";
    document.getElementById("crProductRow").style.display = (isT24 && !isHistory) ? "" : "none";
    document.getElementById("crNbcClassRow").style.display = isNbc ? "" : "none";
    document.getElementById("crNbcProductRow").style.display = (isNbc && !isHistory) ? "" : "none";
}

// ========================================
// LOAD REPORT
// ========================================
async function crRunReport() {
    crShowLoading();

    // Dates changed — any cached Detailed data is now stale, and any
    // inline breakdown expanded under a Summary row no longer applies.
    crDetailedData = null;
    crExpandedBranches.clear();

    try {
        const url = `${API.BASE_URL}/api/creditreport/summary${crBuildDateQuery()}`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${crToken}` } });
        const data = await res.json();

        crHideLoading();

        if (!data.ok) {
            crShowEmpty(data.message || "Failed to load report.");
            return;
        }

        // Server echoes back the dates it actually used — on first load
        // these are its data-derived defaults, so fill the empty inputs.
        crApplyServerDates(data);
        crSyncStateToUrl();
        crRenderMeta(data.meta);

        document.getElementById("crDisbPeriod").textContent =
            `${crFmtDateDMY(data.fromDate)} to ${crFmtDateDMY(data.toDate)}`;
        document.getElementById("crWoPeriod").textContent =
            `${crFmtDateDMY(data.woFromDate)} to ${crFmtDateDMY(data.woToDate)}`;

        if (!data.items || !data.items.length) {
            crShowEmpty("No data.");
            return;
        }

        crSummaryData = data;
        document.getElementById("crTableScroll").style.display = "block";
        crRenderSummary();
    } catch (e) {
        console.error(e);
        crHideLoading();
        crShowEmpty("Network error loading report.");
    }
}
// ========================================
// "Set Report Date" — collapses/expands the date pickers.
// Collapsed by default: the info block above already shows which
// periods are in effect, so most visits never need to open this.
// ========================================
const crDatePanel = document.getElementById("crDatePanel");
const btnCrToggleDates = document.getElementById("btnCrToggleDates");

function crSetDatePanelOpen(open) {
    crDatePanel.classList.toggle("open", open);
    btnCrToggleDates.setAttribute("aria-expanded", open ? "true" : "false");
    btnCrToggleDates.classList.toggle("open", open);
}

btnCrToggleDates.addEventListener("click", () => {
    crSetDatePanelOpen(!crDatePanel.classList.contains("open"));
});

document.getElementById("btnCrRun").addEventListener("click", () => {
    crRunReport();
    crSetDatePanelOpen(false); // collapse once applied — result is shown above
});

// ========================================
// MESSAGE HELPER
// ========================================
function notify(message, type = "info") {
    if (typeof showToast === "function") {
        showToast(message, type);
    } else {
        alert(message);
    }
}

// ========================================
// EXPORT EXCEL (exports the currently visible section/view)
// ========================================
function crExportExcel() {
    if (typeof XLSX === "undefined") {
        notify("Excel export library failed to load — check your connection and try again.", "error");
        return;
    }
    const table = document.getElementById("crTable");
    if (!table || !document.getElementById("crTbody").children.length) {
        notify("Nothing to export.", "warning");
        return;
    }
    const ws = XLSX.utils.table_to_sheet(table);
    crSanitizeSheetFormulas(ws);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "CreditReport");
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "");
    XLSX.writeFile(wb, `CreditReport_${stamp}.xlsx`);
    document.getElementById("crMenuDropdown")?.classList.remove("show");
}
document.getElementById("btnCrExport")?.addEventListener("click", crExportExcel);

// ========================================
// EXPORT PDF
// Ported from arrears.js's technique: html2canvas only captures
// whatever's on screen at current viewport width, so every level of
// container is temporarily forced to its full natural content width
// before capture (otherwise only the columns visible without
// horizontal scroll get exported). A naive fixed-height canvas slice
// per page can also cut a table row in half at a page break, so this
// measures each <tr>'s real position and only cuts between rows,
// repeating the header row on every page after the first.
// ========================================
function extractPrintCss() {
    let css = "";
    for (const sheet of document.styleSheets) {
        let rules;
        try {
            rules = sheet.cssRules;
        } catch (err) {
            continue; // cross-origin stylesheet (e.g. a CDN font) — can't read its rules, skip
        }
        for (const rule of rules) {
            if (rule.type === CSSRule.MEDIA_RULE && rule.media.mediaText.includes("print")) {
                for (const inner of rule.cssRules) {
                    css += inner.cssText + "\n";
                }
            }
        }
    }
    return css;
}

async function crExportPdf() {
    if (typeof html2canvas === "undefined" || typeof window.jspdf === "undefined") {
        notify("PDF export library failed to load — check your connection and try again.", "error");
        return;
    }
    if (!document.getElementById("crTbody").children.length) {
        notify("Nothing to export.", "warning");
        return;
    }

    if (typeof showAppLoading === "function") {
        showAppLoading("Generating PDF...");
    }

    const tempStyleEl = document.createElement("style");
    tempStyleEl.id = "pdf-export-temp-style";
    tempStyleEl.textContent = extractPrintCss() + `
        html, body { overflow-x: visible !important; width: max-content !important; }
        .page-container { width: max-content !important; min-width: 100%; overflow: visible !important; }
        .table-card { width: max-content !important; overflow: visible !important; }
        .table-scroll { width: max-content !important; max-width: none !important; overflow: visible !important; }
        .table-card table { width: max-content !important; }
    `;
    document.head.appendChild(tempStyleEl);

    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    try {
        const container = document.querySelector(".page-container");
        const thead = document.querySelector(".table-card thead");
        const rows = Array.from(document.querySelectorAll(".table-card tbody tr"));

        const SCALE = 2;
        const fullCanvas = await html2canvas(container, { scale: SCALE, backgroundColor: "#ffffff" });
        const theadCanvas = thead
            ? await html2canvas(thead, { scale: SCALE, backgroundColor: "#ffffff" })
            : null;

        const pageWidthMm = 297, pageHeightMm = 210, marginMm = 10;
        const usablePageWidthMm = pageWidthMm - marginMm * 2;
        const usablePageHeightMm = pageHeightMm - marginMm * 2;
        const capturePageHeightPx = fullCanvas.width * (usablePageHeightMm / usablePageWidthMm);

        const containerRect = container.getBoundingClientRect();
        const rowBoundaries = rows.map(tr => {
            const r = tr.getBoundingClientRect();
            return (r.bottom - containerRect.top) * SCALE;
        });

        const theadHeightPx = theadCanvas ? theadCanvas.height : 0;

        const slices = [];
        let sliceStart = 0;
        let firstSlice = true;
        while (sliceStart < fullCanvas.height - 2) {
            const availableHeight = firstSlice ? capturePageHeightPx : (capturePageHeightPx - theadHeightPx);
            let sliceEnd = sliceStart + availableHeight;

            let bestCut = sliceEnd;
            for (const b of rowBoundaries) {
                if (b > sliceStart && b <= sliceEnd) bestCut = b;
            }
            if (bestCut <= sliceStart) bestCut = Math.min(sliceEnd, fullCanvas.height);

            slices.push({ start: sliceStart, end: Math.min(bestCut, fullCanvas.height), repeatHeader: !firstSlice });
            sliceStart = bestCut;
            firstSlice = false;
        }

        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

        slices.forEach((slice, i) => {
            if (i > 0) pdf.addPage();

            const sliceHeightPx = slice.end - slice.start;
            const pageCanvas = document.createElement("canvas");
            pageCanvas.width = fullCanvas.width;
            pageCanvas.height = sliceHeightPx + (slice.repeatHeader ? theadHeightPx : 0);
            const ctx = pageCanvas.getContext("2d");
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);

            let yOffset = 0;
            if (slice.repeatHeader && theadCanvas) {
                ctx.drawImage(theadCanvas, 0, 0);
                yOffset = theadHeightPx;
            }
            ctx.drawImage(
                fullCanvas,
                0, slice.start, fullCanvas.width, sliceHeightPx,
                0, yOffset, fullCanvas.width, sliceHeightPx
            );

            const imgData = pageCanvas.toDataURL("image/jpeg", 0.92);
            const imgHeightMm = usablePageWidthMm * (pageCanvas.height / pageCanvas.width);
            pdf.addImage(imgData, "JPEG", marginMm, marginMm, usablePageWidthMm, imgHeightMm);
        });

        const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
        pdf.save(`CreditReport_${stamp}.pdf`);
    } catch (err) {
        console.error("[export pdf] failed:", err);
        notify("Could not generate the PDF.", "error");
    } finally {
        tempStyleEl.remove();
        void document.body.offsetHeight;
        if (typeof hideAppLoading === "function") {
            hideAppLoading();
        }
    }
}
document.getElementById("btnCrExportPdf")?.addEventListener("click", () => {
    crExportPdf();
    document.getElementById("crMenuDropdown")?.classList.remove("show");
});

// ========================================
// PRINT
// ========================================
document.getElementById("btnCrPrint")?.addEventListener("click", () => {
    window.print();
    document.getElementById("crMenuDropdown")?.classList.remove("show");
});

// ========================================
// "..." MENU — closes on: picking an action, clicking outside, Escape.
// ========================================
const crMenuToggle = document.getElementById("btnCrMenu");
const crMenuDropdown = document.getElementById("crMenuDropdown");

if (crMenuToggle && crMenuDropdown) {
    crMenuToggle.addEventListener("click", (e) => {
        e.stopPropagation();
        crMenuDropdown.classList.toggle("show");
    });

    crMenuDropdown.addEventListener("click", (e) => {
        if (e.target.closest("button")) {
            crMenuDropdown.classList.remove("show");
        }
    });

    document.addEventListener("click", (e) => {
        if (!crMenuDropdown.contains(e.target) && e.target !== crMenuToggle) {
            crMenuDropdown.classList.remove("show");
        }
    });

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") crMenuDropdown.classList.remove("show");
    });
}

// ========================================
// LANDSCAPE VIEW TOGGLE
// Only .table-card is rotated (via CSS), not the whole page — see
// creditreport.css for why. Bars auto-hide after 3s, tapping the
// table brings them back.
// ========================================
// ========================================
// REFRESH DATA
// Clears the server's raw-row cache (which otherwise holds Mongo data for
// up to 10 min) then re-runs the report, so a fresh VBA upload shows up
// immediately instead of waiting out the TTL.
//
// Note this makes the NEXT request pay the full slow fetch again — that's
// the whole point, but it means this button is deliberately not something
// to press casually.
// ========================================
async function crRefreshData() {
    document.getElementById("crMenuDropdown")?.classList.remove("show");
    crShowLoading("Refreshing from database...");

    try {
        const res = await fetch(`${API.BASE_URL}/api/creditreport/refresh`, {
            method: "POST",
            headers: { Authorization: `Bearer ${crToken}` }
        });
        const data = await res.json();

        if (!data.ok) {
            crHideLoading();
            crShowEmpty(data.message || "Could not refresh data.");
            return;
        }

        // Local caches are now stale too — drop them so the re-run refetches.
        crSummaryData = null;
        crDetailedData = null;

        await crRunReport();
    } catch (e) {
        console.error("[refresh data] failed:", e);
        crHideLoading();
        crShowEmpty("Network error refreshing data.");
    }
}
document.getElementById("btnCrRefreshData")?.addEventListener("click", crRefreshData);

const btnCrLandscape = document.getElementById("btnCrLandscape");
const btnCrExitLandscape = document.getElementById("btnCrExitLandscape");
const crLandscapeTopBar = document.getElementById("landscapeTopBar");
const crLandscapeBottomBar = document.getElementById("landscapeBottomBar");
const crLandscapeRowCount = document.getElementById("crLandscapeRowCount");

let crLandscapeHideTimer = null;

function crShowLandscapeBars() {
    if (crLandscapeTopBar) crLandscapeTopBar.classList.remove("hidden");
    if (crLandscapeBottomBar) crLandscapeBottomBar.classList.remove("hidden");
    clearTimeout(crLandscapeHideTimer);
    crLandscapeHideTimer = setTimeout(crHideLandscapeBars, 3000);
}
function crHideLandscapeBars() {
    if (crLandscapeTopBar) crLandscapeTopBar.classList.add("hidden");
    if (crLandscapeBottomBar) crLandscapeBottomBar.classList.add("hidden");
}

if (btnCrLandscape) {
    btnCrLandscape.addEventListener("click", () => {
        document.body.classList.add("cr-force-landscape");
        if (crLandscapeRowCount) {
            const rowCount = document.getElementById("crTbody").children.length;
            crLandscapeRowCount.textContent = `${rowCount.toLocaleString()} rows`;
        }
        crShowLandscapeBars();
        document.getElementById("crMenuDropdown")?.classList.remove("show");
    });
}
if (btnCrExitLandscape) {
    btnCrExitLandscape.addEventListener("click", () => {
        clearTimeout(crLandscapeHideTimer);
        document.body.classList.remove("cr-force-landscape");
    });
}
document.querySelector(".table-card")?.addEventListener("click", (e) => {
    if (!document.body.classList.contains("cr-force-landscape")) return;
    if (e.target.closest(".landscape-bar")) return;
    crShowLandscapeBars();
});
window.addEventListener("pageshow", () => {
    clearTimeout(crLandscapeHideTimer);
    document.body.classList.remove("cr-force-landscape");
});

// ========================================
// HISTORY MODE — UI wiring
// ========================================
document.getElementById("crModeCurrentBtn").addEventListener("click", () => crSetMode("current"));
document.getElementById("crModeHistoryBtn").addEventListener("click", () => crSetMode("history"));
document.getElementById("btnCrHistRun").addEventListener("click", crFetchHistory);

if (crIsAdmin) {
    document.getElementById("btnCrHistSnapshot").style.display = "";
    document.getElementById("btnCrHistSnapshot").addEventListener("click", async () => {
        const btn = document.getElementById("btnCrHistSnapshot");
        btn.disabled = true;
        try {
            const res = await fetch(`${API.BASE_URL}/api/creditreport/summary/snapshot/run`, {
                method: "POST",
                headers: { Authorization: `Bearer ${crToken}`, "Content-Type": "application/json" },
                body: "{}"
            });
            const data = await res.json();
            if (data.ok) {
                notify(`Snapshot saved for ${data.date}`, "success");
            } else {
                notify(data.message || "Snapshot failed", "error");
            }
        } catch (e) {
            console.error(e);
            notify("Snapshot failed", "error");
        } finally {
            btn.disabled = false;
        }
    });
}

// Default history range: the 1st of the current month through today —
// matches the "01/10/2026...31/10/2026" example from the request.
(function crSeedHistoryDates() {
    const now = new Date();
    const p = n => String(n).padStart(2, "0");
    const monthStart = `${now.getFullYear()}-${p(now.getMonth() + 1)}-01`;
    const today = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
    document.getElementById("crHistFromDate").value = monthStart;
    document.getElementById("crHistToDate").value = today;
})();

// ========================================
// INIT
// ========================================
crReadStateFromUrl();
crUpdateClassVisibility();
crRunReport();
