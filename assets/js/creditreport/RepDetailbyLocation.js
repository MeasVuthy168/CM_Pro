// ========================================
// Daily Monitoring by Location — web port, same style as Daily
// Monitoring by Product (RepDetailbyProduct.js/.css) — filter card,
// sticky first column, PAR alert colour, skeleton loading,
// landscape/print. Reads GET /api/creditreport/bylocation (see
// lib/creditreport-location.js for the column mapping behind each
// figure).
//
// One row per Location — grouped by each sheet's own raw location value,
// not a parsed village/commune/district (per explicit request). Like
// Product, there's no Own/Area split — every section here is a single
// combined figure. Clicking a location name (or the Total row) opens the
// Location Performance drill-down page for it (added 2026-10-01) — see
// LocationPerformance.js. "Other Address" (added 2026-10-01) has no such
// link — it's a synthetic bucket of unrecognized addresses, not a real
// location to drill into.
//
// Branch/Officer/District/Commune (added 2026-10-01) are server-side
// filters — narrowing the rows before they're grouped by location — not a
// different "Showing" view, so changing any of them triggers a full
// crRunReport() refetch, same as the T24/NBC Loan Class/Product Type
// filters already do. Commune narrows to the selected District's own
// communes, and Officer narrows to the selected Branch's own officers —
// both a local option-list rebuild (crRebuildCommuneOptions()/
// crRebuildOfficerOptions()), not a refetch by themselves. Selecting an
// Officer shows the addresses assigned to them in the Address sheet
// (their coverage), not just addresses where they personally disbursed a
// loan — see lib/creditreport-location.js's own comment for why.
//
// # Family / Segmentation% (added 2026-10-01) are two always-visible
// columns right after Location — the Address sheet's own per-location
// household count, and # Client / # Family. Shown regardless of
// "Showing", same as Location itself; both read 0 for "Other Address"
// and its detail rows (no Address match to read a family count from).
//
// "Other Address" is a synthetic row the server folds every unrecognized
// location into (see lib/creditreport-location.js) — it expands in place
// to show the individual raw addresses behind it (crData.otherAddressDetail),
// toggled by crOtherAddressExpanded.
// ========================================

const crToken =
    localStorage.getItem("token") ||
    sessionStorage.getItem("token");

const CR_PAR_ALERT = 0.04; // PAR % at or above this renders red

let crData = null; // last successful /bylocation response

// ========================================
// DAILY HISTORY — "current" (today's live report, unchanged default
// behaviour) vs "history" (a Date column added to this same table, one
// row per location per day across a date range), same mechanism as
// RepDetailbyBranch.js's own Daily History — backed by CM-backend's
// /api/creditreport/bylocation/history, which snapshots this exact
// table (including #Family/Segmentation% and the "Other Address"
// bucketing) once a day.
// ========================================
let crMode = "current"; // "current" | "history"
let crHistoryData = null; // { days: [{ date, items, otherAddressDetail, total }, ...] }
let crHistDatesSeeded = false;
let crHistOtherAddressExpanded = new Set(); // dateKey(s) whose "Other Address" row is expanded

// Daily History always narrows to exactly one location, found via the
// search box below the date range — there's no "every location + Total"
// list the way the old default view worked. "Other Address" is a
// regular, selectable entry (its own per-day expand toggle still works
// once it's the one matched location — see crHistOtherAddressExpanded
// above). The roster backs the search box's custom suggestion dropdown
// and the exact-match check that gates "View History" — see
// crPopulateHistoryLocationRoster() / crAttachSuggestions() /
// crResolveSelectedLocation().
let crHistLocationRoster = []; // [locationName, ...] from the last /bylocation fetch
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
// HELPERS
// ========================================
function crFmtDateDMY(yyyymmdd) {
    if (!yyyymmdd) return "-";
    const [y, m, d] = yyyymmdd.split("-");
    return `${d}-${m}-${y}`;
}
// table_to_sheet() reads raw DOM text (location names among it) straight
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
        key === "_name" ? a.location : crGetByPath(a, key),
        key === "_name" ? b.location : crGetByPath(b, key),
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
        <th rowspan="2" class="cr-name-col${sortCls("_name")}" data-sort-key="_name" data-sort-type="text">Location</th>
        <th rowspan="2" class="cr-col-num${sortCls("families")}" data-sort-key="families" data-sort-type="number"># Family</th>
        <th rowspan="2" class="cr-col-pct${sortCls("segmentationPct")}" data-sort-key="segmentationPct" data-sort-type="number">Segmentation%</th>
        ${groupCells}
      </tr>
      <tr class="cr-sub-row">${subCells}</tr>`;
}

let crOtherAddressExpanded = false;

function crBuildRow(item, section, isTotal, opts = {}) {
    const { isOtherAddress = false, isDetail = false } = opts;
    const cells = section.groups.map(g =>
        g.fields.map(f => crFmtField(item, f)).join("")
    ).join("");
    const locationLabel = isTotal ? "Total" : item.location;
    // data-name backs crApplySearchFilter()'s client-side name search —
    // lowercased once here rather than re-lowercasing on every keystroke.
    // Detail rows share "Other Address"'s own search key, so they always
    // show/hide together with the row they expand from rather than being
    // independently searchable by their own raw address text.
    const nameAttr = isTotal
        ? ""
        : ` data-name="${crEscapeHtml(isDetail ? "other address" : (item.location || "").toLowerCase())}"`;

    let nameCellContent;
    if (isOtherAddress) {
        nameCellContent = `<button type="button" class="cr-other-toggle" aria-expanded="${crOtherAddressExpanded}"><span class="cr-other-toggle-icon">${crOtherAddressExpanded ? "▾" : "▸"}</span>${crEscapeHtml(locationLabel)}</button>`;
    } else if (isDetail) {
        // A raw address bucketed under "Other Address" isn't a recognized
        // location — no Location Performance page to drill into.
        nameCellContent = crEscapeHtml(locationLabel);
    } else {
        // Opens Location Performance for that location — same pattern as
        // RepDetailbyProduct.js's own cr-product-link. The Total row
        // drills into the "All Location" aggregate.
        const locationKey = isTotal ? "All Location" : item.location;
        nameCellContent = `<button type="button" class="cr-location-link" data-location="${crEscapeHtml(locationKey)}">${crEscapeHtml(locationLabel)}</button>`;
    }

    // # Family (the Address sheet's own per-location headcount) and
    // Segmentation% (# Client / # Family) — always shown regardless of
    // "Showing", same as Location itself. The server attaches both to
    // every item uniformly (including Total and "Other Address"'s own
    // detail rows), reading 0/0 wherever there's no Address match.
    const familyCells = `
        <td class="cr-col-num">${crFmtNum(item.families)}</td>
        <td class="cr-col-pct">${crFmtPct(item.segmentationPct)}</td>`;

    const rowClass = isTotal ? ' class="cr-total-row"' : isOtherAddress ? ' class="cr-other-row"' : isDetail ? ' class="cr-other-detail-row"' : "";
    return `
      <tr${rowClass}${nameAttr}>
        <td class="cr-name-col${isDetail ? " cr-other-detail-name" : ""}">${nameCellContent}</td>
        ${familyCells}
        ${cells}
      </tr>`;
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

function crActiveSection() {
    const sectionKey = document.getElementById("crSection").value;
    const section = CR_SECTIONS[sectionKey];
    if (sectionKey !== "nbcOverdue") return section;

    const nbcClass = document.getElementById("crNbcClass").value;
    const idx = CR_NBC_CLASS_INDEX[nbcClass];
    if (idx === undefined) return section;
    return { groups: [section.groups[idx]] };
}

function crRenderSection() {
    if (!crData) return;
    const section = crActiveSection();

    const displayItems = crApplySort(crData.items);

    document.getElementById("crThead").innerHTML = crBuildThead(section);

    const bodyHtml = displayItems.map(it => {
        const isOtherAddress = it.location === "Other Address";
        const rowHtml = crBuildRow(it, section, false, { isOtherAddress });
        if (!isOtherAddress || !crOtherAddressExpanded) return rowHtml;
        const detailHtml = (crData.otherAddressDetail || [])
            .map(d => crBuildRow(d, section, false, { isDetail: true }))
            .join("");
        return rowHtml + detailHtml;
    }).join("");

    document.getElementById("crTbody").innerHTML = bodyHtml + crBuildRow(crData.total, section, true);

    // Re-render (switching "Showing") rebuilds every row from scratch,
    // so whatever the user already typed needs re-applying rather than
    // being silently dropped.
    crApplySearchFilter();
    requestAnimationFrame(crSetHeaderOffsets);
}

// ========================================
// HISTORY MODE — same section/field definitions as the live table
// (crActiveSection, crFmtField, crFieldClass all reused as-is), plus the
// same #Family/Segmentation% columns and "Other Address" expand — just
// with an extra Date column and one row per (location, date). Location
// names stay plain text here (no Location Performance drill-down link)
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
        <th rowspan="2" class="cr-name-col">Location</th>
        <th rowspan="2" class="cr-date-col">Date</th>
        <th rowspan="2" class="cr-col-num"># Family</th>
        <th rowspan="2" class="cr-col-pct">Segmentation%</th>
        ${groupCells}
      </tr>
      <tr class="cr-sub-row">${subCells}</tr>`;
}

// Balance Loan at Risk (T24) is never date-filtered (see
// computeLocationRows in creditreport-location.js) — it always reflects
// whatever is live in the ArreasT24ByCO feed at snapshot time, which can
// carry its own "as of" moment (t24AsOfText) different from this row's
// own Date (the NBC OS Grid Merge date), same as Branch's own History —
// per explicit follow-up request 2026-10-02.
function crSectionHasT24(section) {
    return section.groups.some(g => g.label === "Balance Loan at Risk (T24)");
}

function crBuildHistoryRow(dateKey, item, section, opts = {}) {
    const { isTotal = false, isOtherAddress = false, isDetail = false, t24AsOfText = "" } = opts;
    const cells = section.groups.map(g =>
        g.fields.map(f => crFmtField(item, f)).join("")
    ).join("");
    const nameLabel = isTotal ? "Total" : item.location;

    let nameCellContent;
    if (isOtherAddress) {
        const expanded = crHistOtherAddressExpanded.has(dateKey);
        nameCellContent = `<button type="button" class="cr-other-toggle" data-hist-date="${crEscapeHtml(dateKey)}" aria-expanded="${expanded}"><span class="cr-other-toggle-icon">${expanded ? "▾" : "▸"}</span>${crEscapeHtml(nameLabel)}</button>`;
    } else {
        nameCellContent = crEscapeHtml(nameLabel);
    }

    const familyCells = `
        <td class="cr-col-num">${crFmtNum(item.families)}</td>
        <td class="cr-col-pct">${crFmtPct(item.segmentationPct)}</td>`;

    const t24Note = (crSectionHasT24(section) && t24AsOfText)
        ? `<div class="cr-t24-asof" title="Balance Loan at Risk (T24) is as of its own ArreasT24ByCO feed, not this row's Date">T24: ${crEscapeHtml(t24AsOfText)}</div>`
        : "";

    const rowClass = isTotal ? ' class="cr-total-row"' : isOtherAddress ? ' class="cr-other-row"' : isDetail ? ' class="cr-other-detail-row"' : "";
    return `
      <tr${rowClass}>
        <td class="cr-name-col${isDetail ? " cr-other-detail-name" : ""}">${nameCellContent}</td>
        <td class="cr-date-col"><div class="cr-date-main">${crFmtDateDMY(dateKey)}</div>${t24Note}</td>
        ${familyCells}
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

    // Always exactly one location — matched via the search box above
    // (see crResolveSelectedLocation()) — in chronological date order, no
    // "every location" list and no Total row. "Other Address" still
    // expands in place per-date (its own otherAddressDetail for that
    // day) when it's the one matched location, same toggle as before.
    const location = crResolveSelectedLocation();
    if (!location) {
        document.getElementById("crTbody").innerHTML = "";
        crShowEmpty("Search and select a location, then click \"View History\".");
        return;
    }
    const isOtherAddress = location === "Other Address";

    let rowsHtml = "";
    for (const day of crHistoryData.days) {
        const item = day.items.find(it => it.location === location);
        if (!item) continue;
        rowsHtml += crBuildHistoryRow(day.date, item, section, { isOtherAddress, t24AsOfText: day.t24AsOfText });
        if (isOtherAddress && crHistOtherAddressExpanded.has(day.date)) {
            rowsHtml += (day.otherAddressDetail || [])
                .map(d => crBuildHistoryRow(day.date, d, section, { isDetail: true, t24AsOfText: day.t24AsOfText }))
                .join("");
        }
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
        const url = `${API.BASE_URL}/api/creditreport/bylocation/history?dateFrom=${dateFrom}&dateTo=${dateTo}`;
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
    document.getElementById("crGeoFilterGrid").style.display = mode === "history" ? "none" : "";
    document.getElementById("crHistLocationRow").style.display = mode === "history" ? "" : "none";
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
            crShowEmpty("Search and select a location, then click \"View History\".");
        }
    }
}

// Expands/collapses "Other Address"'s own breakdown — see the file header
// comment. Delegated on the tbody since the row is rebuilt on every render.
document.getElementById("crTbody").addEventListener("click", (e) => {
    const histToggle = e.target.closest(".cr-other-toggle[data-hist-date]");
    if (histToggle) {
        const dateKey = histToggle.dataset.histDate;
        if (crHistOtherAddressExpanded.has(dateKey)) crHistOtherAddressExpanded.delete(dateKey);
        else crHistOtherAddressExpanded.add(dateKey);
        crRenderHistory();
        return;
    }
    const toggle = e.target.closest(".cr-other-toggle");
    if (!toggle) return;
    crOtherAddressExpanded = !crOtherAddressExpanded;
    crRenderSection();
});

// ========================================
// LOCATION DRILL-DOWN
// Clicking a location name (or the Total row) opens Location Performance
// for it — same pattern as RepDetailbyBranch.js's own branch-name
// drill-down: Location Performance always fetches its own summary
// (there's no already-fetched CO/FSRO/Digital breakdown to hand off —
// this report only ever has each location's combined Total), so only the
// location name + current date filters need to travel in the URL, no
// sessionStorage cache. "Other Address" and its detail rows have no link
// (see crBuildRow()) so this never fires for them.
// ========================================
document.getElementById("crTbody").addEventListener("click", (e) => {
    const link = e.target.closest(".cr-location-link");
    if (!link) return;

    const q = new URLSearchParams({
        location: link.dataset.location,
        fromDate: crData?.fromDate || "",
        toDate: crData?.toDate || "",
        woFromDate: crData?.woFromDate || "",
        woToDate: crData?.woToDate || ""
    });
    location.href = `LocationPerformance.html?${q.toString()}`;
});

// ========================================
// DAILY HISTORY LOCATION SEARCH — resolves the search box to exactly one
// location (locations don't repeat the way an officer's name can across
// branches, so the roster is just a plain name list, no disambiguation
// needed). "Other Address" is a regular roster entry like any other.
// ========================================
function crPopulateHistoryLocationRoster(items) {
    crHistLocationRoster = (items || []).map(it => it.location);
}

// Custom dropdown rather than a native <datalist> — iOS/WebView browsers
// never render datalist suggestions as the user types (the attribute
// exists in the DOM but nothing visibly pops up). Same pattern as
// arrears.js's own attachSuggestions() for its AJ/AK fields.
function crAttachSuggestions(fieldEl, wrapEl, getRoster) {
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

        const matches = getRoster()
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
// against a roster location counts as a real, resolvable location, same
// "always resolve to exactly one entity" rule Branch's/Officer's own
// Daily History redesigns already established.
function crResolveSelectedLocation() {
    const typed = document.getElementById("crHistLocationSearch").value.trim();
    if (!typed) return null;
    return crHistLocationRoster.find(l => l === typed) || null;
}

// "View History" stays disabled until the typed text exactly matches one
// roster location — not just any non-empty text. Only gates the initial
// fetch; once crHistoryData is loaded, re-searching re-filters
// client-side without re-fetching.
function crUpdateHistRunButtonState() {
    const btn = document.getElementById("btnCrHistRun");
    if (!btn) return;
    // Visible only in Daily History mode — per explicit follow-up
    // request 2026-10-05 (moving it next to Chart, which is also
    // History-only, left it with no mode-based visibility of its own).
    btn.style.display = crMode === "history" ? "" : "none";
    btn.disabled = !crResolveSelectedLocation();
}

// ========================================
// LOCATION SEARCH
// Client-side name filter over the already-loaded table (crData.items)
// — no refetch. The Total row (no data-name attribute) always stays
// visible regardless of the query.
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

    const t24Class = document.getElementById("crClass").value;
    if (t24Class) parts.push(`t24Class=${encodeURIComponent(t24Class)}`);

    const t24Product = document.getElementById("crProduct").value;
    if (t24Product) parts.push(`t24Product=${encodeURIComponent(t24Product)}`);

    // crNbcClass is NOT sent — every classification is already in the
    // response (see crActiveSection() above), so it's a display-only pick.
    const nbcProduct = document.getElementById("crNbcProduct").value;
    if (nbcProduct) parts.push(`nbcProduct=${encodeURIComponent(nbcProduct)}`);

    // Branch/Officer/District/Commune: before crPopulateFilters() has run
    // (i.e. on the very first request of a page load), these selects have
    // no options yet to carry a restored URL value — fall back to the raw
    // value read straight off the URL at crReadStateFromUrl() time. Once
    // populated, the select itself is always the source of truth (see
    // crPopulateFilters()), so the pending value is never consulted again.
    const branch = crFiltersInitialised ? document.getElementById("crBranch").value : crPendingBranch;
    if (branch) parts.push(`branch=${encodeURIComponent(branch)}`);

    const officerId = crFiltersInitialised ? document.getElementById("crOfficer").value : crPendingOfficerId;
    if (officerId) parts.push(`officerId=${encodeURIComponent(officerId)}`);

    const district = crFiltersInitialised ? document.getElementById("crDistrict").value : crPendingDistrict;
    if (district) parts.push(`district=${encodeURIComponent(district)}`);

    const commune = crFiltersInitialised ? document.getElementById("crCommune").value : crPendingCommune;
    if (commune) parts.push(`commune=${encodeURIComponent(commune)}`);

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
// BRANCH / OFFICER / DISTRICT / COMMUNE FILTERS
// Options come from the API response itself (data.branches/officers/
// districts/communes/districtCommunes) rather than being hardcoded, since
// Officer and District/Commune in particular depend on live data (the
// CreditOfficer roster and the Address lookup sheet) this page has no
// other access to. Populated once; a URL-restored value (read early by
// crReadStateFromUrl() into the crPending* variables, before these selects
// have any options to hold it) is applied here, the only place it's ever
// consulted again.
//
// Commune cascades to the selected District, and Officer cascades to the
// selected Branch — both a local rebuild of that one select's options
// (crRebuildCommuneOptions()/crRebuildOfficerOptions()) off data already
// in hand, not a second fetch. crCommunesList/crOfficerRoster/
// crDistrictCommunes hold the full, unfiltered option data those rebuilds
// read from.
// ========================================
let crFiltersInitialised = false;
let crPendingBranch = "", crPendingOfficerId = "", crPendingDistrict = "", crPendingCommune = "";
let crCommunesList = [];
let crOfficerRoster = [];
let crDistrictCommunes = {};

function crPopulateSelectOptions(selectEl, items) {
    const optionsHtml = items.map(it => {
        const value = typeof it === "string" ? it : it.id;
        const label = typeof it === "string" ? it : it.name;
        return `<option value="${crEscapeHtml(value)}">${crEscapeHtml(label)}</option>`;
    }).join("");
    selectEl.insertAdjacentHTML("beforeend", optionsHtml);
}

// Rebuilds #crCommune's options to just the selected District's own
// communes (every commune when no District is selected), preserving the
// current selection only if it's still valid under the new list.
function crRebuildCommuneOptions() {
    const district = document.getElementById("crDistrict").value;
    const communeSel = document.getElementById("crCommune");
    const currentValue = communeSel.value;
    const allowed = district ? (crDistrictCommunes[district] || []) : crCommunesList;

    communeSel.innerHTML = '<option value="">All</option>' +
        allowed.map(c => `<option value="${crEscapeHtml(c)}">${crEscapeHtml(c)}</option>`).join("");
    if (allowed.includes(currentValue)) communeSel.value = currentValue;
}

// Rebuilds #crOfficer's options to just the selected Branch's own
// officers (every officer when no Branch is selected), preserving the
// current selection only if it's still valid under the new list.
function crRebuildOfficerOptions() {
    const branch = document.getElementById("crBranch").value;
    const officerSel = document.getElementById("crOfficer");
    const currentValue = officerSel.value;
    const allowed = branch ? crOfficerRoster.filter(o => o.branch === branch) : crOfficerRoster;

    officerSel.innerHTML = '<option value="">All</option>' +
        allowed.map(o => `<option value="${crEscapeHtml(o.id)}">${crEscapeHtml(o.name)}</option>`).join("");
    if (allowed.some(o => o.id === currentValue)) officerSel.value = currentValue;
}

function crPopulateFilters(data) {
    if (crFiltersInitialised) return;

    crCommunesList = data.communes || [];
    crOfficerRoster = data.officers || [];
    crDistrictCommunes = data.districtCommunes || {};

    crPopulateSelectOptions(document.getElementById("crBranch"), data.branches || []);
    crPopulateSelectOptions(document.getElementById("crDistrict"), data.districts || []);

    const restore = (id, pending) => {
        const sel = document.getElementById(id);
        if (pending && [...sel.options].some(o => o.value === pending)) sel.value = pending;
    };
    // Branch/District first — Officer/Commune cascade off whichever value
    // ends up restored here.
    restore("crBranch", crPendingBranch);
    restore("crDistrict", crPendingDistrict);

    crRebuildCommuneOptions();
    restore("crCommune", crPendingCommune);

    crRebuildOfficerOptions();
    restore("crOfficer", crPendingOfficerId);

    crFiltersInitialised = true;
}

// ========================================
// URL STATE
// Mirrors section/dates into the address bar via history.replaceState
// (no new history entries) — same mechanism as RepDetailbyCO.js, minus
// the branch/team bits this page doesn't have.
// ========================================
function crReadStateFromUrl() {
    const p = new URLSearchParams(location.search);

    const section = p.get("section");
    if (section && CR_SECTIONS[section]) {
        document.getElementById("crSection").value = section;
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

    // Branch/Officer/District/Commune selects have no options yet at this
    // point (they're populated from the first API response) — stash the
    // raw URL value for crBuildQuery()'s first request and crPopulateFilters()
    // to restore once the options exist.
    crPendingBranch = p.get("branch") || "";
    crPendingOfficerId = p.get("officerId") || "";
    crPendingDistrict = p.get("district") || "";
    crPendingCommune = p.get("commune") || "";
}

function crSyncStateToUrl() {
    const p = new URLSearchParams();
    p.set("section", document.getElementById("crSection").value);

    const t24Class = document.getElementById("crClass").value;
    if (t24Class) p.set("t24Class", t24Class);

    const t24Product = document.getElementById("crProduct").value;
    if (t24Product) p.set("t24Product", t24Product);

    const nbcClass = document.getElementById("crNbcClass").value;
    if (nbcClass) p.set("nbcClass", nbcClass);

    const nbcProduct = document.getElementById("crNbcProduct").value;
    if (nbcProduct) p.set("nbcProduct", nbcProduct);

    // Only reached after crPopulateFilters() has already run (see
    // crRunReport()), so these selects always hold the live, restored value.
    const branch = document.getElementById("crBranch").value;
    if (branch) p.set("branch", branch);

    const officerId = document.getElementById("crOfficer").value;
    if (officerId) p.set("officerId", officerId);

    const district = document.getElementById("crDistrict").value;
    if (district) p.set("district", district);

    const commune = document.getElementById("crCommune").value;
    if (commune) p.set("commune", commune);

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
        const res = await fetch(`${API.BASE_URL}/api/creditreport/bylocation${crBuildQuery()}`, {
            headers: { Authorization: `Bearer ${crToken}` }
        });
        const data = await res.json();
        crHideLoading();

        if (!data.ok) {
            crShowEmpty(data.message || "Failed to load report.");
            return;
        }

        crPopulateFilters(data);
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
        document.getElementById("crLocationCount").textContent =
            `${(data.items || []).length}`;

        if (!data.items || !data.items.length) {
            crShowEmpty("No locations match these filters.");
            return;
        }

        crData = data;
        crPopulateHistoryLocationRoster(data.items);
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

// Section switching is local (no refetch).
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
document.getElementById("crClass").addEventListener("change", crRunReport);
document.getElementById("crProduct").addEventListener("change", crRunReport);
// crNbcClass only picks which already-fetched classification to display
// (see crActiveSection()) — local re-render, no refetch, same as
// switching "Showing" itself.
document.getElementById("crNbcClass").addEventListener("change", () => {
    if (crMode === "history") crRenderHistory(); else crRenderSection();
    crSyncStateToUrl();
});
document.getElementById("crNbcProduct").addEventListener("change", crRunReport);

// Branch/Officer/District/Commune are server-side filters, same as the
// T24/NBC Loan Class/Product Type filters above — any change refetches.
// Branch/District additionally cascade Officer/Commune's own option list
// first (see crRebuildOfficerOptions()/crRebuildCommuneOptions()).
document.getElementById("crBranch").addEventListener("change", () => {
    crRebuildOfficerOptions();
    crRunReport();
});
document.getElementById("crOfficer").addEventListener("change", crRunReport);
document.getElementById("crDistrict").addEventListener("change", () => {
    crRebuildCommuneOptions();
    crRunReport();
});
document.getElementById("crCommune").addEventListener("change", crRunReport);

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

// Export/print always cover every location, regardless of whatever the
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
    XLSX.utils.book_append_sheet(wb, ws, "ByLocation");
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "");
    XLSX.writeFile(wb, `MonitoringByLocation_${stamp}.xlsx`);
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

        pdf.save(`MonitoringByLocation_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}.pdf`);
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
        const res = await fetch(`${API.BASE_URL}/api/creditreport/bylocation/refresh`, {
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
document.getElementById("crHistLocationSearch").addEventListener("input", (e) => {
    document.getElementById("crHistLocationClear").hidden = !e.target.value;
    crUpdateHistRunButtonState();
    crUpdateChartButtonVisibility();
    if (crHistoryData) crRenderHistory();
});
document.getElementById("crHistLocationSearch").addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    e.target.value = "";
    e.target.dispatchEvent(new Event("input", { bubbles: true }));
    e.target.blur();
});
document.getElementById("crHistLocationClear").addEventListener("click", () => {
    const input = document.getElementById("crHistLocationSearch");
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.focus();
});
crAttachSuggestions(
    document.getElementById("crHistLocationSearch"),
    document.querySelector("#crHistLocationRow .cr-hist-search-wrap"),
    () => crHistLocationRoster
);

if (crIsAdmin) {
    document.getElementById("btnCrHistSnapshot").style.display = "";
    document.getElementById("btnCrHistSnapshot").addEventListener("click", async () => {
        const btn = document.getElementById("btnCrHistSnapshot");
        btn.disabled = true;
        try {
            const res = await fetch(`${API.BASE_URL}/api/creditreport/bylocation/snapshot/run`, {
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

// ========================================
// DAILY HISTORY CHART — a line chart of the one matched location (see
// crResolveSelectedLocation()), over the fetched date range, for
// whichever fields the active "Showing" section carries. Reuses Chart.js
// the same way RepDetailbyCO.js's own Daily History chart does (same
// CDN build, same instance-reuse pattern, same --cr-series-N palette).
// ========================================
let crChartInstance = null;
let crChartMetricLabel = null; // persists across re-opens until a Showing/metric change resets it

// Visible only once BOTH boxes are set — a real location matched AND a
// specific "Showing" section picked (not left at "All Sections").
function crUpdateChartButtonVisibility() {
    const btn = document.getElementById("btnCrHistChart");
    if (!btn) return;
    const sectionFilter = document.getElementById("crSection").value;
    btn.style.display = (crMode === "history" && crResolveSelectedLocation() && sectionFilter !== "all") ? "" : "none";
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
    const matchedLocation = crResolveSelectedLocation();
    if (!matchedLocation) return;
    const metricOptions = crChartMetricOptions(section);
    if (!metricOptions.length) return;
    if (!metricOptions.some(f => f.label === crChartMetricLabel)) {
        // Prefer the first money field (the usual headline figure) when
        // (re)picking a default — e.g. switching "Showing" resets it.
        crChartMetricLabel = (metricOptions.find(f => f.money) || metricOptions[0]).label;
    }
    crRenderChartMetricTabs(section, metricOptions);

    const days = crHistoryData.days;
    const labels = days.map(d => crFmtDateDMY(d.date));
    const colors = crChartSeriesColors();
    const activeField = metricOptions.find(f => f.label === crChartMetricLabel);

    const datasets = [];
    section.groups.forEach((g, idx) => {
        const field = g.fields.find(f => f.label === crChartMetricLabel);
        if (!field) return;
        const data = days.map(day => {
            const item = day.items.find(it => it.location === matchedLocation);
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
        `${matchedLocation} — ${section.groups.length === 1 ? section.groups[0].label : "Showing"}`;

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
    if (!crResolveSelectedLocation()) return;
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
