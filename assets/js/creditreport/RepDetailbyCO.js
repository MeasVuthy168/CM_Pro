// ========================================
// Daily Monitoring by Officer — "RepDetail byCO" web port
// Reads GET /api/creditreport/byco (see lib/creditreport-co.js for the
// column mapping behind each figure).
//
// One row per credit officer. Team / ID / Branch are used for filtering
// and sorting but deliberately NOT rendered — only the officer's name
// leads each row, matching the Excel sheet's hidden columns.
// ========================================

const crToken =
    localStorage.getItem("token") ||
    sessionStorage.getItem("token");

const CR_PAR_ALERT = 0.04; // PAR % at or above this renders red

let crData = null; // last successful /byco response

// ========================================
// DAILY HISTORY — "current" (today's live report, unchanged default
// behaviour) vs "history" (a Date column added to this same table, one
// row per officer per day across a date range), same mechanism as
// RepDetailbyBranch.js's own Daily History — backed by CM-backend's
// /api/creditreport/byco/history, which snapshots this exact table once
// a day. No inline expand here (the live table has none either — Own/
// Area are already separate flat fields, not a toggle).
// ========================================
let crMode = "current"; // "current" | "history"
let crHistoryData = null; // { days: [{ date, items, total }, ...] }
let crHistDatesSeeded = false;

// Daily History always narrows to exactly one officer, found via the
// search box below the date range — there's no "all officers" or Total
// row the way Branch's "All Branch" resolves to a combined row. The
// roster backs that search box's custom suggestion dropdown and the
// exact-match check that gates "View History" — see
// crPopulateHistoryOfficerRoster() / crAttachOfficerSuggestions() /
// crResolveSelectedOfficer().
let crOfficerRoster = []; // [{ name, branch }, ...] from the last /byco fetch
const crLoggedInUser = JSON.parse(
    localStorage.getItem("loggedInUser") || sessionStorage.getItem("loggedInUser") || "{}"
);
const crIsAdmin = String(crLoggedInUser.role || "").toLowerCase() === "admin";

// ========================================
// SECTIONS
// ========================================
function crGroupPct(prefix, label) {
    return {
        label,
        fields: [
            { key: prefix + ".count", label: "# Loan" },
            { key: prefix + ".value", label: "Value", money: true },
            { key: prefix + ".parPct", label: "PAR %", pct: true }
        ]
    };
}

const CR_SECTIONS = {
    outstandingArea: {
        groups: [{
            label: "Loan Outstanding_Area",
            fields: [
                { key: "loanOutstandingArea.loan", label: "# Loan" },
                { key: "loanOutstandingArea.client", label: "# Client" },
                { key: "loanOutstandingArea.value", label: "Value", money: true }
            ]
        }]
    },
    outstanding: {
        groups: [{
            label: "Loan Outstanding_Own",
            fields: [
                { key: "loanOutstanding.loan", label: "# Loan" },
                { key: "loanOutstanding.client", label: "# Client" },
                { key: "loanOutstanding.value", label: "Value", money: true }
            ]
        }]
    },
    disburseArea: {
        groups: [{
            label: "Loan Disburse_Area",
            fields: [
                { key: "loanDisburseArea.loan", label: "# Loan" },
                { key: "loanDisburseArea.value", label: "Value", money: true }
            ]
        }]
    },
    disburse: {
        groups: [{
            label: "Loan Disburse_Own",
            fields: [
                { key: "loanDisburse.loan", label: "# Loan" },
                { key: "loanDisburse.value", label: "Value", money: true }
            ]
        }]
    },
    parT24Area: {
        groups: [{
            label: "Balance Loan at Risk (T24)_Area",
            fields: [
                { key: "parT24Area.loan", label: "# Loan" },
                { key: "parT24Area.value", label: "Value", money: true },
                { key: "parT24Area.parPct", label: "PAR %", pct: true }
            ]
        }]
    },
    parT24: {
        groups: [{
            label: "Balance Loan at Risk (T24)_Own",
            fields: [
                { key: "parT24.loan", label: "# Loan" },
                { key: "parT24.value", label: "Value", money: true },
                { key: "parT24.parPct", label: "PAR %", pct: true }
            ]
        }]
    },
    nbcOverdueArea: {
        groups: [
            crGroupPct("nbcOverdueArea.minor", "Minor Default"),
            crGroupPct("nbcOverdueArea.specialMention", "Special Mention"),
            crGroupPct("nbcOverdueArea.subStandard", "Sub-Standard"),
            crGroupPct("nbcOverdueArea.doubtful", "Doubtful"),
            crGroupPct("nbcOverdueArea.loss", "Loss"),
            crGroupPct("nbcOverdueArea.majorDefault", "Major Default"),
            crGroupPct("nbcOverdueArea.nonPerformingLoan", "Non Performing Loan"),
            crGroupPct("nbcOverdueArea.total", "Total NBC Overdue_Area")
        ]
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
            crGroupPct("nbcOverdue.totalOwn", "Total NBC Overdue_Own")
        ]
    },
    writeOffArea: {
        groups: [
            {
                label: "Balance WO_Area",
                fields: [
                    { key: "writeOffArea.balanceWO.count", label: "#" },
                    { key: "writeOffArea.balanceWO.int", label: "Int", money: true },
                    { key: "writeOffArea.balanceWO.prn", label: "Prn", money: true }
                ]
            },
            {
                label: "WO_Area",
                fields: [
                    { key: "writeOffArea.wo.count", label: "#" },
                    { key: "writeOffArea.wo.prn", label: "Prn", money: true }
                ]
            },
            {
                label: "WO Collected_Area",
                fields: [
                    { key: "writeOffArea.woCollected.int", label: "Int", money: true },
                    { key: "writeOffArea.woCollected.prn", label: "Prn", money: true }
                ]
            }
        ]
    },
    writeOff: {
        groups: [
            {
                label: "Balance WO_Own",
                fields: [
                    { key: "writeOffOwn.balanceWO.count", label: "#" },
                    { key: "writeOffOwn.balanceWO.int", label: "Int", money: true },
                    { key: "writeOffOwn.balanceWO.prn", label: "Prn", money: true }
                ]
            },
            {
                label: "WO_Own",
                fields: [
                    { key: "writeOffOwn.wo.count", label: "#" },
                    { key: "writeOffOwn.wo.prn", label: "Prn", money: true }
                ]
            },
            {
                label: "WO Collected_Own",
                fields: [
                    { key: "writeOffOwn.woCollected.int", label: "Int", money: true },
                    { key: "writeOffOwn.woCollected.prn", label: "Prn", money: true }
                ]
            }
        ]
    }
};
CR_SECTIONS.all = {
    groups: [
        ...CR_SECTIONS.outstandingArea.groups,
        ...CR_SECTIONS.outstanding.groups,
        ...CR_SECTIONS.disburseArea.groups,
        ...CR_SECTIONS.disburse.groups,
        ...CR_SECTIONS.parT24Area.groups,
        ...CR_SECTIONS.parT24.groups,
        ...CR_SECTIONS.nbcOverdueArea.groups,
        ...CR_SECTIONS.nbcOverdue.groups,
        ...CR_SECTIONS.writeOffArea.groups,
        ...CR_SECTIONS.writeOff.groups
    ]
};

// ========================================
// HELPERS
// ========================================
function crFmtDateDMY(yyyymmdd) {
    if (!yyyymmdd) return "-";
    const [y, m, d] = yyyymmdd.split("-");
    return `${d}-${m}-${y}`;
}
// table_to_sheet() reads raw DOM text (officer names among it) straight
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
function crFieldClass(f) {
    if (f.pct) return "cr-col-pct";
    if (f.money) return "cr-col-money";
    return "cr-col-num";
}
function crFmtField(item, field) {
    const v = crGetByPath(item, field.key);
    const cls = crFieldClass(field);
    if (field.pct) {
        const n = Number(v) || 0;
        const alert = n >= CR_PAR_ALERT ? " cr-par-high" : "";
        return `<td class="${cls}${alert}">${crFmtPct(n)}</td>`;
    }
    return `<td class="${cls}">${crFmtNum(v)}</td>`;
}

// ========================================
// COLUMN SORT
// Every column header is clickable and cycles through 3 states:
// ascending -> descending -> default (the order the server returned,
// unsorted) -> ascending again. crData.items itself is never mutated —
// crApplySort() returns a sorted COPY (or the original array, untouched,
// once the cycle reaches "default") — so the original fetch order is
// always there to go back to. The Total row always stays pinned at the
// bottom, since it's appended separately in crRenderSection() rather
// than sorted along with the rest.
//
// crRenderSection() keeps the array it actually rendered from in
// crDisplayItems, and the officer-name click handler resolves
// crDisplayItems[idx] (not crData.items[idx]) — idx is baked into each
// row at render time from that same array, so it always matches the
// item's CURRENT on-screen position regardless of sort state.
// ========================================
let crSortState = { key: null, dir: 1 };
let crDisplayItems = [];

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
        key === "_name" ? a.name : crGetByPath(a, key),
        key === "_name" ? b.name : crGetByPath(b, key),
        type
    ));
}

// ========================================
// RENDER
// ========================================
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

    return `
      <tr class="cr-group-row">
        <th rowspan="2" class="cr-name-col${sortCls("_name")}" data-sort-key="_name" data-sort-type="text">Name</th>
        ${groupCells}
      </tr>
      <tr class="cr-sub-row">${subCells}</tr>`;
}

function crBuildRow(item, section, isTotal, idx) {
    const cells = section.groups.map(g =>
        g.fields.map(f => crFmtField(item, f)).join("")
    ).join("");
    const nameCell = isTotal
        ? "Total"
        : `<button type="button" class="cr-officer-link" data-idx="${idx}">${crEscapeHtml(item.name)}</button>`;
    // data-name backs crApplySearchFilter()'s client-side name search —
    // lowercased once here rather than re-lowercasing on every keystroke.
    const nameAttr = isTotal ? "" : ` data-name="${crEscapeHtml((item.name || "").toLowerCase())}"`;
    return `
      <tr${isTotal ? ' class="cr-total-row"' : ""}${nameAttr}>
        <td class="cr-name-col">${nameCell}</td>
        ${cells}
      </tr>`;
}

// Maps the NBC Overdue Loan Class filter's values to the matching group's
// index within CR_SECTIONS.nbcOverdue/nbcOverdueArea.groups (built in this
// same fixed order — see CR_SECTIONS above) — lets the Loan Class filter
// collapse the wide 7-classification table down to just the one selected,
// the same single-group shape parT24/parT24Area already render as. Every
// classification is already present in the API response regardless of
// this filter, so no refetch is needed — this is purely a display choice.
const CR_NBC_CLASS_INDEX = {
    minor: 0, specialMention: 1, subStandard: 2, doubtful: 3,
    loss: 4, majorDefault: 5, nonPerformingLoan: 6, total: 7
};

// Maps the T24 Loan Class filter's values to their matching bucket key
// within parT24ByClass/parT24AreaByClass (added to the backend so Daily
// History can slice by class without a refetch — see
// lib/creditreport-co.js's own T24_CLASS_FILTER_VALUES). "" (All) and
// "total" (Total T24 Overdue) are deliberately absent — both just show
// the flat parT24/parT24Area group unchanged (see crActiveSection()
// below), not a bucket.
const CR_T24_CLASS_INDEX = {
    Normal_to_SpecialMention: "normalToSpecialMention",
    SubStandard_to_Loss: "subStandardToLoss",
    Normal: "normal",
    "Special Mention": "specialMention",
    "Sub Standard": "subStandard",
    Doubtful: "doubtful",
    Loss: "loss"
};

// "Total T24 Overdue" ("total") is the only non-bucket value left now
// that "All" is gone — it still just shows the flat parT24/parT24Area
// group unchanged (see crActiveSection() below), not a bucket.
//
// Each of the 7 classification buckets gets its own # Loan/Value/PAR%,
// same shape as the flat parT24/parT24Area group. Note this reads
// ".loan", a DIFFERENT field than crGroupPct()'s own ".count" (that's
// nbcOverdue/nbcOverdueArea's own convention) — parT24ByClass/
// parT24AreaByClass use ".loan", matching parT24/parT24Area themselves.
function crT24ClassGroup(prefix, label) {
    return {
        label,
        fields: [
            { key: prefix + ".loan", label: "# Loan" },
            { key: prefix + ".value", label: "Value", money: true },
            { key: prefix + ".parPct", label: "PAR %", pct: true }
        ]
    };
}

function crActiveSection() {
    const sectionKey = document.getElementById("crSection").value;
    const section = CR_SECTIONS[sectionKey];

    if (sectionKey === "nbcOverdue" || sectionKey === "nbcOverdueArea") {
        const nbcClass = document.getElementById("crNbcClass").value;
        const idx = CR_NBC_CLASS_INDEX[nbcClass];
        if (idx === undefined) return section;
        return { groups: [section.groups[idx]] };
    }

    // Current mode already narrows parT24/parT24Area server-side (see
    // crBuildQuery's own t24Class) — the flat group already shows the
    // filtered figures, so no swap is needed there. Only History mode
    // (no refetch) needs to pick a different field source for the same
    // single group.
    if ((sectionKey === "parT24" || sectionKey === "parT24Area") && crMode === "history") {
        const t24Class = document.getElementById("crClass").value;
        const bucketKey = CR_T24_CLASS_INDEX[t24Class];
        if (!bucketKey) return section;
        const prefix = sectionKey === "parT24" ? "parT24ByClass" : "parT24AreaByClass";
        const label = section.groups[0].label;
        return { groups: [crT24ClassGroup(`${prefix}.${bucketKey}`, label)] };
    }

    return section;
}

function crRenderSection() {
    if (!crData) return;
    const section = crActiveSection();

    crDisplayItems = crApplySort(crData.items);

    document.getElementById("crThead").innerHTML = crBuildThead(section);
    document.getElementById("crTbody").innerHTML =
        crDisplayItems.map((it, idx) => crBuildRow(it, section, false, idx)).join("") +
        crBuildRow(crData.total, section, true);

    // Re-render (switching "Showing", or a fresh branch/team fetch)
    // rebuilds every row from scratch, so whatever the user already
    // typed needs re-applying rather than being silently dropped.
    crApplySearchFilter();
    requestAnimationFrame(crSetHeaderOffsets);
}

// ========================================
// HISTORY MODE — same section/field definitions as the live table
// (crActiveSection, crFmtField, crFieldClass all reused as-is), just
// with an extra Date column and one row per (officer, date). Officer
// names stay plain text here (no Officer Productivity drill-down link)
// since that page only ever shows live data, not a specific historical
// day.
// ========================================
function crBuildHistoryThead(section) {
    const groupCells = section.groups.map(g =>
        `<th colspan="${g.fields.length}">${g.label}</th>`
    ).join("");
    const subCells = section.groups.map(g =>
        g.fields.map(f => `<th class="${crFieldClass(f)}">${f.label}</th>`).join("")
    ).join("");
    return `
      <tr class="cr-group-row">
        <th rowspan="2" class="cr-name-col">Name</th>
        <th rowspan="2" class="cr-date-col">Date</th>
        ${groupCells}
      </tr>
      <tr class="cr-sub-row">${subCells}</tr>`;
}

// Balance Loan at Risk (T24) is never date-filtered (see
// computeOfficerRows in creditreport-co.js) — it always reflects
// whatever is live in the ArreasT24ByCO feed at snapshot time, which can
// carry its own "as of" moment (t24AsOfText) different from this row's
// own Date (the NBC OS Grid Merge date), same as Branch's own History —
// per explicit follow-up request 2026-10-02. This page's Own/Area T24
// groups are suffixed ("...(T24)_Own"/"...(T24)_Area"), so the check is
// a prefix match rather than an exact one.
function crSectionHasT24(section) {
    return section.groups.some(g => g.label.startsWith("Balance Loan at Risk (T24)"));
}

function crBuildHistoryRow(dateKey, item, section, isTotal, t24AsOfText) {
    const cells = section.groups.map(g =>
        g.fields.map(f => crFmtField(item, f)).join("")
    ).join("");
    const nameLabel = isTotal ? "Total" : item.name;
    const t24Note = (crSectionHasT24(section) && t24AsOfText)
        ? `<div class="cr-t24-asof" title="Balance Loan at Risk (T24) is as of its own ArreasT24ByCO feed, not this row's Date">T24: ${crEscapeHtml(t24AsOfText)}</div>`
        : "";
    // Admin-only — lets an admin remove a single day's saved snapshot
    // (e.g. one filed under an unexpected date — see crGridMergeDateKey's
    // own comment in the backend).
    const delBtn = crIsAdmin
        ? `<button type="button" class="cr-row-delete-btn" data-hist-del="${crEscapeHtml(dateKey)}" title="Delete this day's snapshot">🗑</button>`
        : "";
    return `
      <tr${isTotal ? ' class="cr-total-row"' : ""}>
        <td class="cr-name-col">${crEscapeHtml(nameLabel)}</td>
        <td class="cr-date-col"><div class="cr-date-main">${crFmtDateDMY(dateKey)}${delBtn}</div>${t24Note}</td>
        ${cells}
      </tr>`;
}

function crRenderHistory() {
    if (!crHistoryData) return;
    const section = crActiveSection();

    document.getElementById("crThead").innerHTML = crBuildHistoryThead(section);

    if (!crHistoryData.days.length) {
        document.getElementById("crTbody").innerHTML = "";
        crShowEmpty("No history saved for this date range yet.");
        return;
    }

    // Always exactly one officer — matched via the search box above
    // (see crResolveSelectedOfficer()) — in chronological date order, no
    // "every officer" list and no Total row (there's only ever the one
    // officer being plotted).
    const officer = crResolveSelectedOfficer();
    if (!officer) {
        document.getElementById("crTbody").innerHTML = "";
        crShowEmpty("Search and select an officer, then click \"View History\".");
        return;
    }

    let rowsHtml = "";
    for (const day of crHistoryData.days) {
        const item = day.items.find(it => it.name === officer.name && it.branch === officer.branch);
        if (item) rowsHtml += crBuildHistoryRow(day.date, item, section, false, day.t24AsOfText);
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
        const url = `${API.BASE_URL}/api/creditreport/byco/history?dateFrom=${dateFrom}&dateTo=${dateTo}`;
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
    document.getElementById("crHistOfficerRow").style.display = mode === "history" ? "" : "none";
    document.getElementById("crSearchWrap").style.display = mode === "current" && crData ? "flex" : "none";
    crUpdateClassVisibility();
    crUpdateHistRunButtonState();
    crUpdateChartButtonVisibility();

    if (mode === "current") {
        if (crData) {
            document.getElementById("crTableScroll").style.display = "block";
            document.getElementById("crEmptyMsg").style.display = "none";
            crRenderSection();
        }
    } else {
        if (crHistoryData) {
            crRenderHistory();
        } else {
            document.getElementById("crTableScroll").style.display = "none";
            crShowEmpty("Search and select an officer, then click \"View History\".");
        }
    }
}

// ========================================
// OFFICER SEARCH
// Client-side name filter over the already-loaded table (crData.items)
// — no refetch, unlike Branch/Team/date filters. The Total row (no
// data-name attribute) always stays visible regardless of the query.
// ========================================
function crApplySearchFilter() {
    const input = document.getElementById("crSearchInput");
    const clearBtn = document.getElementById("crSearchClear");
    const q = (input?.value || "").trim().toLowerCase();
    if (clearBtn) clearBtn.hidden = !q;

    document.querySelectorAll("#crTbody tr").forEach(tr => {
        if (!tr.dataset.name) return; // Total row — always shown
        tr.style.display = (!q || tr.dataset.name.includes(q)) ? "" : "none";
    });
}

document.getElementById("crSearchInput")?.addEventListener("input", crApplySearchFilter);
document.getElementById("crSearchInput")?.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    e.target.value = "";
    crApplySearchFilter();
    e.target.blur();
});
document.getElementById("crSearchClear")?.addEventListener("click", () => {
    const input = document.getElementById("crSearchInput");
    if (!input) return;
    input.value = "";
    crApplySearchFilter();
    input.focus();
});

// ========================================
// OFFICER DRILL-DOWN
// Clicking an officer's name hands the row's already-fetched data
// (crDisplayItems[idx] — the array the table was last rendered from, so
// idx always resolves the right officer regardless of sort order) plus
// the report's current filters to OfficerProductivity.html via
// sessionStorage — see that page's own header comment for why (instant
// first paint, no refetch) and its fallback path if this cache is
// missing/stale.
// ========================================
document.getElementById("crTbody").addEventListener("click", (e) => {
    const link = e.target.closest(".cr-officer-link");
    if (!link || !crData) return;
    const item = crDisplayItems[Number(link.dataset.idx)];
    if (!item) return;

    const meta = {
        branch: document.getElementById("crBranch").value,
        team: document.getElementById("crTeam").value,
        fromDate: crData?.fromDate || "",
        toDate: crData?.toDate || "",
        woFromDate: crData?.woFromDate || "",
        woToDate: crData?.woToDate || ""
    };
    sessionStorage.setItem("cr_officer_detail", JSON.stringify({ officer: item, meta }));

    const q = new URLSearchParams({
        name: item.name,
        branch: meta.branch,
        team: meta.team,
        fromDate: meta.fromDate,
        toDate: meta.toDate,
        woFromDate: meta.woFromDate,
        woToDate: meta.woToDate
    });
    location.href = `OfficerProductivity.html?${q.toString()}`;
});

// Sub-header row sticks under the group row; the group row's height
// varies with text wrapping, so it's measured rather than hardcoded.
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
// LOADING STATES
// ========================================
function crShowLoading(message = "Loading Report Data...") {
    document.getElementById("crSkeleton").style.display = "block";
    document.getElementById("crSearchWrap").style.display = "none";
    document.getElementById("crTableScroll").style.display = "none";
    document.getElementById("crEmptyMsg").style.display = "none";
    if (typeof showAppLoading === "function") showAppLoading(message);
}
function crHideLoading() {
    document.getElementById("crSkeleton").style.display = "none";
    if (typeof hideAppLoading === "function") hideAppLoading();
}
function crShowEmpty(msg) {
    const el = document.getElementById("crEmptyMsg");
    el.textContent = msg;
    el.style.display = "block";
    document.getElementById("crSearchWrap").style.display = "none";
    document.getElementById("crTableScroll").style.display = "none";
}

// ========================================
// LOAD
// ========================================
// The report's own date range is no longer user-settable (the "Set
// Report Date" picker was removed 2026-10-02 per explicit request), so
// no date params are ever sent; the server always uses its own
// data-derived default.
function crBuildQuery() {
    const parts = [];

    parts.push(`branch=${encodeURIComponent(crPendingBranch || document.getElementById("crBranch").value)}`);
    parts.push(`team=${encodeURIComponent(document.getElementById("crTeam").value)}`);

    // "total" (Total T24 Overdue) isn't a server-side filter value — it
    // just means unfiltered, same as "" (All), so it's never sent.
    const t24Class = document.getElementById("crClass").value;
    if (t24Class && t24Class !== "total") parts.push(`t24Class=${encodeURIComponent(t24Class)}`);

    const t24Product = document.getElementById("crProduct").value;
    if (t24Product) parts.push(`t24Product=${encodeURIComponent(t24Product)}`);

    // crNbcClass is NOT sent — every classification is already in the
    // response (see crActiveSection() above), so it's a display-only pick.
    const nbcProduct = document.getElementById("crNbcProduct").value;
    if (nbcProduct) parts.push(`nbcProduct=${encodeURIComponent(nbcProduct)}`);
    return `?${parts.join("&")}`;
}

// The T24 Loan Class/Product Type filters only mean something for the
// Balance Loan at Risk (T24) sections, and the NBC Overdue Loan
// Class/Product Type filters only for the NBC Overdue sections — hide
// each pair otherwise so they can't be mistaken for applying to a
// section they don't affect.
function crUpdateClassVisibility() {
    const section = document.getElementById("crSection").value;
    const isT24 = section === "parT24" || section === "parT24Area";
    const isNbc = section === "nbcOverdue" || section === "nbcOverdueArea";
    // History rows are precomputed daily snapshots covering every
    // officer with every classification/product already in them — the
    // Branch/Team scope and the T24/NBC Product Type filters all need a
    // server-side recompute this view doesn't do, so they're hidden in
    // History mode. The T24/NBC Loan Class pickers stay: both are now a
    // local display pick among the already-fetched classifications
    // (parT24ByClass/parT24AreaByClass), same as in Current mode — see
    // crActiveSection().
    const isHistory = crMode === "history";
    document.getElementById("crBranchRow").style.display = isHistory ? "none" : "";
    document.getElementById("crTeamRow").style.display = isHistory ? "none" : "";
    document.getElementById("crClassRow").style.display = isT24 ? "" : "none";
    document.getElementById("crProductRow").style.display = (isT24 && !isHistory) ? "" : "none";
    document.getElementById("crNbcClassRow").style.display = isNbc ? "" : "none";
    document.getElementById("crNbcProductRow").style.display = (isNbc && !isHistory) ? "" : "none";
}

let crBranchesInitialised = false;
// Branch restored from the URL, held here until the real <option> list
// exists (crBranch starts with only "All Branch" — the rest are appended
// after the first fetch) — see crReadStateFromUrl()/crPopulateBranches().
let crPendingBranch = null;
function crPopulateBranches(list) {
    if (crBranchesInitialised || !Array.isArray(list)) return;
    const sel = document.getElementById("crBranch");
    for (const b of list) {
        const opt = document.createElement("option");
        opt.value = b;
        opt.textContent = b;
        sel.appendChild(opt);
    }
    crBranchesInitialised = true;

    if (crPendingBranch) {
        sel.value = crPendingBranch;
        crPendingBranch = null;
    }
}

// "Name — Branch" disambiguates officers who share a name across
// different branches — plain names alone wouldn't resolve to a single
// real officer.
function crOfficerRosterLabel(officer) {
    return `${officer.name} — ${officer.branch}`;
}

// Rebuilt on every /byco fetch (not just once, unlike crPopulateBranches)
// since which officers exist depends on whatever Branch/Team filter is
// currently applied in Current mode.
function crPopulateHistoryOfficerRoster(items) {
    crOfficerRoster = (items || []).map(it => ({ name: it.name, branch: it.branch }));
}

// Custom dropdown rather than a native <datalist> — iOS/WebView browsers
// never render datalist suggestions as the user types (the attribute
// exists in the DOM but nothing visibly pops up), so the search box
// looked broken there even though the roster was populated. Same
// pattern as arrears.js's own attachSuggestions() for its AJ/AK fields.
function crAttachOfficerSuggestions(fieldEl, wrapEl) {
    const list = document.createElement("ul");
    list.className = "suggestion-list";
    wrapEl.appendChild(list);

    function hide() {
        list.classList.remove("show");
        list.innerHTML = "";
    }

    function showSuggestionsFor(query) {
        const q = query.trim().toLowerCase();
        if (!q) { hide(); return; }

        const matches = crOfficerRoster
            .map(crOfficerRosterLabel)
            .filter(label => label.toLowerCase().includes(q) && label.toLowerCase() !== q)
            .slice(0, 8);

        if (!matches.length) { hide(); return; }

        list.innerHTML = "";
        matches.forEach(label => {
            const li = document.createElement("li");
            li.textContent = label;
            li.addEventListener("mousedown", (e) => {
                // mousedown (not click) so this fires before the field's
                // own blur event closes the dropdown first
                e.preventDefault();
                fieldEl.value = label;
                hide();
                fieldEl.dispatchEvent(new Event("input", { bubbles: true }));
            });
            list.appendChild(li);
        });
        list.classList.add("show");
    }

    fieldEl.addEventListener("input", () => showSuggestionsFor(fieldEl.value));
    fieldEl.addEventListener("focus", () => showSuggestionsFor(fieldEl.value));
    fieldEl.addEventListener("blur", hide);
}

// Free text never stops at the dropdown alone — only an exact match
// against "Name — Branch" counts as a real, resolvable officer, same
// "always resolve to exactly one entity" rule Branch's Daily History
// redesign already established for its own Branch/Team filters.
function crResolveSelectedOfficer() {
    const typed = document.getElementById("crHistOfficerSearch").value.trim();
    if (!typed) return null;
    return crOfficerRoster.find(o => crOfficerRosterLabel(o) === typed) || null;
}

// "View History" stays disabled until the typed text exactly matches one
// roster officer — not just any non-empty text — per explicit request
// 2026-10-02. Only gates the initial fetch; once crHistoryData is
// loaded, re-searching re-filters client-side without re-fetching.
function crUpdateHistRunButtonState() {
    const btn = document.getElementById("btnCrHistRun");
    if (!btn) return;
    // Visible only in Daily History mode — per explicit follow-up
    // request 2026-10-05 (moving it next to Chart, which is also
    // History-only, left it with no mode-based visibility of its own).
    btn.style.display = crMode === "history" ? "" : "none";
    btn.disabled = !crResolveSelectedOfficer();
}

// ========================================
// URL STATE
// Mirrors section/branch/team/dates into the address bar via
// history.replaceState (no new history entries) — see the identical
// mechanism on RepDetailbyBranch.js for the full rationale: it's what
// lets the shared back arrow / bottom-nav Home tab return to the exact
// same report instead of its blank defaults.
// ========================================
function crReadStateFromUrl() {
    const p = new URLSearchParams(location.search);

    const section = p.get("section");
    if (section && CR_SECTIONS[section]) {
        document.getElementById("crSection").value = section;
    }

    const team = p.get("team");
    if (team) {
        const teamSel = document.getElementById("crTeam");
        if ([...teamSel.options].some(o => o.value === team)) {
            teamSel.value = team;
        }
    }

    // crBranch's real options don't exist yet (only "All Branch" until
    // the first fetch populates them) — hold the value for
    // crPopulateBranches() to apply, and let crBuildQuery() use it
    // directly so the very first request is already filtered correctly.
    const branch = p.get("branch");
    if (branch && branch !== "All Branch") {
        crPendingBranch = branch;
    }

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
    p.set("branch", crPendingBranch || document.getElementById("crBranch").value);
    p.set("team", document.getElementById("crTeam").value);

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

// Default Daily History range: the 1st of the month through the NBC
// Loan Outstanding Grid Merge date itself (data.fromDate/toDate, already
// anchored to that date by the server), NOT the calendar month we
// happen to be in today — the Grid Merge date can lag behind today, so
// seeding from today's calendar month would default to a range with no
// data in it. Seeded once, from whichever report load resolves first.
function crSeedHistoryDates(data) {
    if (crHistDatesSeeded) return;
    crHistDatesSeeded = true;
    document.getElementById("crHistFromDate").value = data.fromDate;
    document.getElementById("crHistToDate").value = data.toDate;
}

async function crRunReport() {
    crShowLoading();
    try {
        const res = await fetch(`${API.BASE_URL}/api/creditreport/byco${crBuildQuery()}`, {
            headers: { Authorization: `Bearer ${crToken}` }
        });
        const data = await res.json();
        crHideLoading();

        if (!data.ok) {
            crShowEmpty(data.message || "Failed to load report.");
            return;
        }

        crPopulateBranches(data.branches);
        crSyncStateToUrl();

        // Pre-formatted server-side (dd/mm/yyyy, plus HH:MM where the
        // source cell carried a time) — no client-side reformatting.
        const meta = data.meta || {};
        document.getElementById("crOsGridMerge").textContent = meta.osGridMergeText || "-";
        document.getElementById("crOverdueGridMerge").textContent = meta.overdueGridMergeText || "-";
        document.getElementById("crArrearsPenalty").textContent = meta.arrearsPenaltyText || "-";

        document.getElementById("crDisbPeriod").textContent =
            `${crFmtDateDMY(data.fromDate)} to ${crFmtDateDMY(data.toDate)}`;
        document.getElementById("crWoPeriod").textContent =
            `${crFmtDateDMY(data.woFromDate)} to ${crFmtDateDMY(data.woToDate)}`;
        document.getElementById("crOfficerCount").textContent =
            `${(data.items || []).length}`;

        if (!data.items || !data.items.length) {
            crShowEmpty("No officers match these filters.");
            return;
        }

        crData = data;
        crPopulateHistoryOfficerRoster(data.items);
        crSeedHistoryDates(data);
        document.getElementById("crSearchWrap").style.display = "flex";
        document.getElementById("crTableScroll").style.display = "block";
        crRenderSection();
    } catch (e) {
        console.error(e);
        crHideLoading();
        crShowEmpty("Network error loading report.");
    }
}

// Section switching is local (no refetch); branch/team are applied
// server-side, so those do need a round trip.
document.getElementById("crSection").addEventListener("change", () => {
    crUpdateClassVisibility();
    if (crMode === "history") {
        crUpdateChartButtonVisibility();
        crRenderHistory();
    } else {
        crRenderSection();
    }
    crSyncStateToUrl();
});
document.getElementById("crBranch").addEventListener("change", crRunReport);
document.getElementById("crTeam").addEventListener("change", crRunReport);
// In History mode, the T24 Loan Class filter is a local display pick
// among the already-fetched parT24ByClass/parT24AreaByClass buckets (see
// crActiveSection()) — no refetch, same as crNbcClass below. In Current
// mode it still narrows the data server-side, so it keeps refetching.
document.getElementById("crClass").addEventListener("change", () => {
    if (crMode === "history") {
        crUpdateChartButtonVisibility();
        crRenderHistory();
        crSyncStateToUrl();
    } else {
        crRunReport();
    }
});
document.getElementById("crProduct").addEventListener("change", crRunReport);
// crNbcClass only picks which already-fetched classification to display
// (see crActiveSection()) — local re-render, no refetch, same as
// switching "Showing" itself.
document.getElementById("crNbcClass").addEventListener("change", () => {
    crUpdateChartButtonVisibility();
    if (crMode === "history") crRenderHistory(); else crRenderSection();
    crSyncStateToUrl();
});
document.getElementById("crNbcProduct").addEventListener("change", crRunReport);

// Clicking a column header cycles it through ascending -> descending ->
// default (unsorted, the order the server returned) -> ascending again.
// Clicking a different header always starts that header fresh at
// ascending. The Total row is unaffected (see crApplySort()/crRenderSection()).
document.getElementById("crThead").addEventListener("click", (e) => {
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
    crRenderSection();
});

// ========================================
// MESSAGE HELPER
// ========================================
function notify(message, type = "info") {
    if (typeof showToast === "function") showToast(message, type);
    else alert(message);
}

// Export/print always cover every officer, regardless of whatever the
// user happened to be typing in the search box — an official report
// export silently missing rows because a search was still active would
// be a much worse surprise than the search box just getting cleared.
function crClearSearchForExport() {
    const input = document.getElementById("crSearchInput");
    if (input && input.value) {
        input.value = "";
        crApplySearchFilter();
    }
}

// ========================================
// EXPORT EXCEL
// ========================================
document.getElementById("btnCrExport")?.addEventListener("click", () => {
    crClearSearchForExport();
    if (typeof XLSX === "undefined") {
        notify("Excel export library failed to load.", "error");
        return;
    }
    if (!document.getElementById("crTbody").children.length) {
        notify("Nothing to export.", "warning");
        return;
    }
    const ws = XLSX.utils.table_to_sheet(document.getElementById("crTable"));
    crSanitizeSheetFormulas(ws);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "ByOfficer");
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "");
    XLSX.writeFile(wb, `MonitoringByOfficer_${stamp}.xlsx`);
    document.getElementById("crMenuDropdown")?.classList.remove("show");
});

// ========================================
// EXPORT PDF
// html2canvas only captures what's laid out at the current viewport
// width, so every container is temporarily forced to its full natural
// width — otherwise columns past the horizontal scroll are cropped out.
// Page slicing cuts only at row boundaries so no row is split in half.
// ========================================
function extractPrintCss() {
    let css = "";
    for (const sheet of document.styleSheets) {
        let rules;
        try { rules = sheet.cssRules; } catch (e) { continue; } // cross-origin
        for (const rule of rules) {
            if (rule.type === CSSRule.MEDIA_RULE && rule.media.mediaText.includes("print")) {
                for (const inner of rule.cssRules) css += inner.cssText + "\n";
            }
        }
    }
    return css;
}

document.getElementById("btnCrExportPdf")?.addEventListener("click", async () => {
    document.getElementById("crMenuDropdown")?.classList.remove("show");
    crClearSearchForExport();
    if (typeof html2canvas === "undefined" || typeof window.jspdf === "undefined") {
        notify("PDF export library failed to load.", "error");
        return;
    }
    if (!document.getElementById("crTbody").children.length) {
        notify("Nothing to export.", "warning");
        return;
    }
    if (typeof showAppLoading === "function") showAppLoading("Generating PDF...");

    const tempStyle = document.createElement("style");
    tempStyle.textContent = extractPrintCss() + `
        html, body { overflow-x: visible !important; width: max-content !important; }
        .page-container { width: max-content !important; min-width: 100%; overflow: visible !important; }
        .table-card { width: max-content !important; overflow: visible !important; }
        .table-scroll { width: max-content !important; max-width: none !important; overflow: visible !important; }
        .table-card table { width: max-content !important; }
    `;
    document.head.appendChild(tempStyle);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    try {
        const container = document.querySelector(".page-container");
        const thead = document.querySelector(".table-card thead");
        const rows = Array.from(document.querySelectorAll(".table-card tbody tr"));

        const SCALE = 2;
        const full = await html2canvas(container, { scale: SCALE, backgroundColor: "#ffffff" });
        const headCanvas = thead ? await html2canvas(thead, { scale: SCALE, backgroundColor: "#ffffff" }) : null;

        const pageW = 297, pageH = 210, margin = 10;
        const usableW = pageW - margin * 2;
        const usableH = pageH - margin * 2;
        const sliceH = full.width * (usableH / usableW);

        const cRect = container.getBoundingClientRect();
        const bounds = rows.map(tr => (tr.getBoundingClientRect().bottom - cRect.top) * SCALE);
        const headH = headCanvas ? headCanvas.height : 0;

        const slices = [];
        let start = 0, first = true;
        while (start < full.height - 2) {
            const avail = first ? sliceH : sliceH - headH;
            let end = start + avail;
            let cut = end;
            for (const b of bounds) if (b > start && b <= end) cut = b;
            if (cut <= start) cut = Math.min(end, full.height);
            slices.push({ start, end: Math.min(cut, full.height), repeatHeader: !first });
            start = cut;
            first = false;
        }

        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

        slices.forEach((s, i) => {
            if (i > 0) pdf.addPage();
            const h = s.end - s.start;
            const canvas = document.createElement("canvas");
            canvas.width = full.width;
            canvas.height = h + (s.repeatHeader ? headH : 0);
            const ctx = canvas.getContext("2d");
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            let y = 0;
            if (s.repeatHeader && headCanvas) { ctx.drawImage(headCanvas, 0, 0); y = headH; }
            ctx.drawImage(full, 0, s.start, full.width, h, 0, y, full.width, h);

            const imgH = usableW * (canvas.height / canvas.width);
            pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", margin, margin, usableW, imgH);
        });

        pdf.save(`MonitoringByOfficer_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}.pdf`);
    } catch (err) {
        console.error("[export pdf] failed:", err);
        notify("Could not generate the PDF.", "error");
    } finally {
        tempStyle.remove();
        void document.body.offsetHeight;
        if (typeof hideAppLoading === "function") hideAppLoading();
    }
});

// ========================================
// PRINT
// ========================================
document.getElementById("btnCrPrint")?.addEventListener("click", () => {
    crClearSearchForExport();
    window.print();
    document.getElementById("crMenuDropdown")?.classList.remove("show");
});

// ========================================
// REFRESH DATA — clears the server's row cache, then reloads.
// ========================================
document.getElementById("btnCrRefreshData")?.addEventListener("click", async () => {
    document.getElementById("crMenuDropdown")?.classList.remove("show");
    crShowLoading("Refreshing from database...");
    try {
        const res = await fetch(`${API.BASE_URL}/api/creditreport/byco/refresh`, {
            method: "POST",
            headers: { Authorization: `Bearer ${crToken}` }
        });
        const data = await res.json();
        if (!data.ok) {
            crHideLoading();
            crShowEmpty(data.message || "Could not refresh data.");
            return;
        }
        crData = null;
        await crRunReport();
    } catch (e) {
        console.error("[refresh data] failed:", e);
        crHideLoading();
        crShowEmpty("Network error refreshing data.");
    }
});

// ========================================
// "..." MENU
// ========================================
const crMenuToggle = document.getElementById("btnCrMenu");
const crMenuDropdown = document.getElementById("crMenuDropdown");
if (crMenuToggle && crMenuDropdown) {
    crMenuToggle.addEventListener("click", e => {
        e.stopPropagation();
        crMenuDropdown.classList.toggle("show");
    });
    document.addEventListener("click", e => {
        if (!crMenuDropdown.contains(e.target) && e.target !== crMenuToggle) {
            crMenuDropdown.classList.remove("show");
        }
    });
    document.addEventListener("keydown", e => {
        if (e.key === "Escape") crMenuDropdown.classList.remove("show");
    });
}

// ========================================
// LANDSCAPE
// ========================================
const crLandscapeTopBar = document.getElementById("landscapeTopBar");
const crLandscapeBottomBar = document.getElementById("landscapeBottomBar");
let crLandscapeTimer = null;

function crShowLandscapeBars() {
    crLandscapeTopBar?.classList.remove("hidden");
    crLandscapeBottomBar?.classList.remove("hidden");
    clearTimeout(crLandscapeTimer);
    crLandscapeTimer = setTimeout(() => {
        crLandscapeTopBar?.classList.add("hidden");
        crLandscapeBottomBar?.classList.add("hidden");
    }, 3000);
}

document.getElementById("btnCrLandscape")?.addEventListener("click", () => {
    document.body.classList.add("cr-force-landscape");
    const count = document.getElementById("crTbody").children.length;
    const el = document.getElementById("crLandscapeRowCount");
    if (el) el.textContent = `${count.toLocaleString()} rows`;
    crShowLandscapeBars();
    document.getElementById("crMenuDropdown")?.classList.remove("show");
});
document.getElementById("btnCrExitLandscape")?.addEventListener("click", () => {
    clearTimeout(crLandscapeTimer);
    document.body.classList.remove("cr-force-landscape");
});
document.querySelector(".table-card")?.addEventListener("click", e => {
    if (!document.body.classList.contains("cr-force-landscape")) return;
    if (e.target.closest(".landscape-bar")) return;
    crShowLandscapeBars();
});
window.addEventListener("pageshow", () => {
    clearTimeout(crLandscapeTimer);
    document.body.classList.remove("cr-force-landscape");
});

// ========================================
// HISTORY MODE — UI wiring
// ========================================
document.getElementById("crModeCurrentBtn").addEventListener("click", () => crSetMode("current"));
document.getElementById("crModeHistoryBtn").addEventListener("click", () => crSetMode("history"));
document.getElementById("btnCrHistRun").addEventListener("click", crFetchHistory);
document.getElementById("crHistOfficerSearch").addEventListener("input", (e) => {
    document.getElementById("crHistOfficerClear").hidden = !e.target.value;
    crUpdateHistRunButtonState();
    crUpdateChartButtonVisibility();
    if (crHistoryData) crRenderHistory();
});
document.getElementById("crHistOfficerSearch").addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    e.target.value = "";
    e.target.dispatchEvent(new Event("input", { bubbles: true }));
    e.target.blur();
});
document.getElementById("crHistOfficerClear").addEventListener("click", () => {
    const input = document.getElementById("crHistOfficerSearch");
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.focus();
});
crAttachOfficerSuggestions(
    document.getElementById("crHistOfficerSearch"),
    document.querySelector("#crHistOfficerRow .cr-officer-search-wrap")
);

if (crIsAdmin) {
    // Delegated — rows are rebuilt wholesale on every crRenderHistory()
    // call, so a listener bound to individual buttons would be lost each
    // time; binding to the table body once survives re-renders.
    document.getElementById("crTbody").addEventListener("click", async (e) => {
        const btn = e.target.closest(".cr-row-delete-btn");
        if (!btn) return;
        const dateKey = btn.getAttribute("data-hist-del");
        if (!dateKey) return;
        if (!confirm(`Delete the saved snapshot for ${crFmtDateDMY(dateKey)}? This cannot be undone.`)) return;

        btn.disabled = true;
        try {
            const res = await fetch(`${API.BASE_URL}/api/creditreport/byco/snapshot/delete`, {
                method: "POST",
                headers: { Authorization: `Bearer ${crToken}`, "Content-Type": "application/json" },
                body: JSON.stringify({ date: dateKey })
            });
            const data = await res.json();
            if (data.ok) {
                crHistoryData.days = crHistoryData.days.filter(d => d.date !== dateKey);
                crRenderHistory();
                notify(`Snapshot deleted for ${crFmtDateDMY(dateKey)}`, "success");
            } else {
                notify(data.message || "Delete failed", "error");
                btn.disabled = false;
            }
        } catch (err) {
            console.error(err);
            notify("Delete failed", "error");
            btn.disabled = false;
        }
    });
}

// ========================================
// DAILY HISTORY CHART — a line chart of the one matched officer (see
// crResolveSelectedOfficer()), over the fetched date range, for
// whichever fields the active "Showing" section carries. Reuses Chart.js
// the same way RepDetailbyBranch.js's own Daily History chart does (same
// CDN build, same instance-reuse pattern, same --cr-series-N palette).
// ========================================
let crChartInstance = null;
let crChartMetricLabel = null; // persists across re-opens until a Showing/metric change resets it

// Visible only once BOTH boxes are set — a real officer matched AND a
// specific "Showing" section picked (not left at "All Sections") — per
// explicit follow-up request 2026-10-02. With Showing still at "All
// Sections" there's no single focused metric left to plot a line for.
// Same idea for "Balance Loan at Risk (NBC Overdue)_Own/_Area" with its
// own Loan Class left at "All" — plotting all 7 classifications at once
// isn't a focused chart either, hidden until a specific classification
// (or the "Total NBC Overdue" option) is picked — per explicit
// follow-up request 2026-10-05. T24's own Loan Class filter has no "All"
// value any more (removed the same day — "Total T24 Overdue" already
// covers that unfiltered view), so unlike NBC there's nothing left to
// hide Chart on there.
function crUpdateChartButtonVisibility() {
    const btn = document.getElementById("btnCrHistChart");
    if (!btn) return;
    const sectionFilter = document.getElementById("crSection").value;
    const isNbc = sectionFilter === "nbcOverdue" || sectionFilter === "nbcOverdueArea";
    const nbcClassAll = isNbc && !document.getElementById("crNbcClass").value;
    btn.style.display = (crMode === "history" && crResolveSelectedOfficer() && sectionFilter !== "all" && !nbcClassAll) ? "" : "none";
}

function crChartSeriesColors() {
    const cs = getComputedStyle(document.documentElement);
    const slot = n => cs.getPropertyValue(`--cr-series-${n}`).trim();
    return [1, 2, 3, 4, 5, 6, 7, 8].map(slot);
}

// Dedupes the active section's fields by label ("# Loan", "Value",
// "PAR %"...) — switching between them is how one chart stays on a
// single axis/unit instead of mixing counts, money, and percentages.
function crChartMetricOptions(section) {
    const seen = new Map();
    for (const g of section.groups) {
        for (const f of g.fields) {
            if (!seen.has(f.label)) seen.set(f.label, f);
        }
    }
    return [...seen.values()];
}

function crRenderChartMetricTabs(section, metricOptions) {
    const row = document.getElementById("crChartMetricRow");
    // A single metric needs no tab row to switch between — same "no
    // legend for one series" idea, one level up.
    if (metricOptions.length < 2) {
        row.innerHTML = "";
        return;
    }
    row.innerHTML = metricOptions.map(f =>
        `<button type="button" class="cr-chart-metric-btn${f.label === crChartMetricLabel ? " active" : ""}" data-metric="${crEscapeHtml(f.label)}">${crEscapeHtml(f.label)}</button>`
    ).join("");
}

function crRenderChart(section) {
    const officer = crResolveSelectedOfficer();
    if (!officer) return;
    const metricOptions = crChartMetricOptions(section);
    if (!metricOptions.length) return;
    if (!metricOptions.some(f => f.label === crChartMetricLabel)) {
        // Prefer the first money field (the usual headline figure) when
        // (re)picking a default — e.g. switching "Showing" resets it.
        crChartMetricLabel = (metricOptions.find(f => f.money) || metricOptions[0]).label;
    }
    crRenderChartMetricTabs(section, metricOptions);

    const days = crHistoryData.days;
    // Balance Loan at Risk (T24)_Own/_Area is never date-filtered — it
    // always reflects whichever ArreasT24ByCO data was live at snapshot
    // time, which can carry its own "as of" moment different from each
    // row's own Date (same reason crBuildHistoryRow shows a separate
    // "T24: ..." note under Date for this section). The chart's own X
    // axis follows that same T24 "as of" moment instead of the row Date
    // whenever Showing is T24, per explicit request 2026-10-05.
    const labels = days.map(d => crSectionHasT24(section) && d.t24AsOfText ? d.t24AsOfText : crFmtDateDMY(d.date));
    const colors = crChartSeriesColors();
    const activeField = metricOptions.find(f => f.label === crChartMetricLabel);

    const datasets = [];
    section.groups.forEach((g, idx) => {
        const field = g.fields.find(f => f.label === crChartMetricLabel);
        if (!field) return;
        const data = days.map(day => {
            const item = day.items.find(it => it.name === officer.name && it.branch === officer.branch);
            const v = item ? crGetByPath(item, field.key) : null;
            return v == null ? null : Number(v) || 0;
        });
        const color = colors[idx % colors.length];
        datasets.push({
            label: g.label,
            data,
            borderColor: color,
            backgroundColor: color,
            pointBackgroundColor: color,
            pointBorderColor: getComputedStyle(document.documentElement).getPropertyValue("--cr-chart-surface").trim(),
            pointBorderWidth: 2,
            pointRadius: 4,
            borderWidth: 2,
            tension: 0
        });
    });

    document.getElementById("crChartTitle").textContent =
        `${crOfficerRosterLabel(officer)} — ${section.groups.length === 1 ? section.groups[0].label : "Showing"}`;

    const isPct = !!activeField?.pct;
    const ctx = document.getElementById("crChartCanvas").getContext("2d");
    const textMuted = getComputedStyle(document.documentElement).getPropertyValue("--cr-text-muted").trim();
    const grid = getComputedStyle(document.documentElement).getPropertyValue("--cr-chart-grid").trim();

    const config = {
        type: "line",
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: "index", intersect: false },
            plugins: {
                legend: { display: datasets.length > 1, labels: { color: textMuted, boxWidth: 12 } },
                tooltip: {
                    callbacks: {
                        label: (ctx2) => `${ctx2.dataset.label}: ${isPct ? crFmtPct(ctx2.parsed.y) : crFmtNum(ctx2.parsed.y)}`
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        color: textMuted,
                        callback: (v) => isPct ? crFmtPct(v) : crFmtNum(v)
                    },
                    grid: { color: grid }
                },
                x: {
                    ticks: { color: textMuted },
                    grid: { display: false }
                }
            }
        }
    };

    if (crChartInstance) crChartInstance.destroy();
    crChartInstance = new Chart(ctx, config);
}

function crOpenChart() {
    if (!crHistoryData || !crHistoryData.days.length) return;
    if (!crResolveSelectedOfficer()) return;
    if (typeof Chart === "undefined") {
        notify("Chart library failed to load — check your connection and refresh.", "error");
        return;
    }
    const section = crActiveSection();
    document.getElementById("crChartOverlay").hidden = false;
    document.body.style.overflow = "hidden";
    crRenderChart(section);
}

function crCloseChart() {
    document.getElementById("crChartOverlay").hidden = true;
    document.body.style.overflow = "";
    if (crChartInstance) {
        crChartInstance.destroy();
        crChartInstance = null;
    }
}

document.getElementById("crChartMetricRow").addEventListener("click", (e) => {
    const btn = e.target.closest(".cr-chart-metric-btn");
    if (!btn) return;
    crChartMetricLabel = btn.dataset.metric;
    crRenderChart(crActiveSection());
});

document.getElementById("btnCrHistChart").addEventListener("click", crOpenChart);
document.getElementById("btnCrChartClose").addEventListener("click", crCloseChart);
document.getElementById("crChartOverlay").addEventListener("click", (e) => {
    if (e.target.id === "crChartOverlay") crCloseChart();
});

// ========================================
// INIT
// ========================================
crReadStateFromUrl();
crUpdateClassVisibility();
crRunReport();
