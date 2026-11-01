// ========================================
// Daily Monitoring by Location — web port, same style as Daily
// Monitoring by Product (RepDetailbyProduct.js/.css) — filter card,
// sticky first column, PAR alert colour, skeleton loading,
// fullscreen/print. Reads GET /api/creditreport/bylocation (see
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

const t = (key, vars) => window.CMI18n ? CMI18n.t(key, vars) : key;

const crToken =
    localStorage.getItem("token") ||
    sessionStorage.getItem("token");


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
function crGroupPct(prefix, labelKey) {
    return {
        label: t(labelKey),
        fields: [
            { key: prefix + ".count", label: t("creditreport.detail.colLoanHash") },
            { key: prefix + ".value", label: t("creditreport.detail.colValue"), money: true },
            { key: prefix + ".parPct", label: t("creditreport.detail.colParPct"), pct: true }
        ]
    };
}

// Built by a function (not a frozen module-level const) so every label
// picks up the current language when a report is (re)rendered, rather
// than being baked in once at page-load time.
function crSections() {
    const S = {
        outstanding: {
            groups: [{
                label: t("creditreport.detail.sectionOutstanding"),
                fields: [
                    { key: "loanOutstanding.loan", label: t("creditreport.detail.colLoanHash") },
                    { key: "loanOutstanding.client", label: t("creditreport.detail.colClient") },
                    { key: "loanOutstanding.value", label: t("creditreport.detail.colValue"), money: true }
                ]
            }]
        },
        disburse: {
            groups: [{
                label: t("creditreport.detail.sectionDisburse"),
                fields: [
                    { key: "loanDisburse.loan", label: t("creditreport.detail.colLoanHash") },
                    { key: "loanDisburse.value", label: t("creditreport.detail.colValue"), money: true }
                ]
            }]
        },
        parT24: {
            groups: [{
                key: "parT24",
                label: t("creditreport.detail.sectionT24"),
                fields: [
                    { key: "parT24.loan", label: t("creditreport.detail.colLoanHash") },
                    { key: "parT24.value", label: t("creditreport.detail.colValue"), money: true },
                    { key: "parT24.parPct", label: t("creditreport.detail.colParPct"), pct: true }
                ]
            }]
        },
        nbcOverdue: {
            groups: [
                crGroupPct("nbcOverdue.minor", "creditreport.detail.classMinorDefault"),
                crGroupPct("nbcOverdue.specialMention", "creditreport.detail.classSpecialMention"),
                crGroupPct("nbcOverdue.subStandard", "creditreport.detail.classSubStandardHyphen"),
                crGroupPct("nbcOverdue.doubtful", "creditreport.detail.classDoubtful"),
                crGroupPct("nbcOverdue.loss", "creditreport.detail.classLoss"),
                crGroupPct("nbcOverdue.majorDefault", "creditreport.detail.classMajorDefault"),
                crGroupPct("nbcOverdue.nonPerformingLoan", "creditreport.detail.classNonPerformingLoan"),
                crGroupPct("nbcOverdue.total", "creditreport.detail.classTotalNbcOverdue")
            ]
        },
        writeOff: {
            groups: [
                {
                    label: t("creditreport.detail.woBalanceWO"),
                    fields: [
                        { key: "writeOff.balanceWO.cif", label: t("creditreport.detail.colCifHash") },
                        { key: "writeOff.balanceWO.int", label: t("creditreport.detail.colInt"), money: true },
                        { key: "writeOff.balanceWO.prn", label: t("creditreport.detail.colPrn"), money: true }
                    ]
                },
                {
                    label: t("creditreport.detail.woWO"),
                    fields: [
                        { key: "writeOff.wo.count", label: "#" },
                        { key: "writeOff.wo.prn", label: t("creditreport.detail.colPrn"), money: true }
                    ]
                },
                {
                    label: t("creditreport.detail.woCollected"),
                    fields: [
                        { key: "writeOff.woCollected.int", label: t("creditreport.detail.colInt"), money: true },
                        { key: "writeOff.woCollected.prn", label: t("creditreport.detail.colPrn"), money: true }
                    ]
                }
            ]
        }
    };
    S.all = {
        groups: [
            ...S.outstanding.groups,
            ...S.disburse.groups,
            ...S.parT24.groups,
            ...S.nbcOverdue.groups,
            ...S.writeOff.groups
        ]
    };
    return S;
}

// ========================================
// HELPERS
// ========================================
function crFmtDateDMY(yyyymmdd) {
    if (!yyyymmdd) return "-";
    const [y, m, d] = yyyymmdd.split("-");
    return `${d}-${m}-${y}`;
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
// Value bars (Actual Only): the largest location figure per Value
// column, and the location rows that get a bar (not the Total, not the
// addresses listed under Other Address).
let crBarMax = null;
let crBarItems = new Set();

function crFmtField(item, field) {
    if (field.lm) return CRLastMonth.cell(item, field);
    const v = crGetByPath(item, field.key);
    const cls = crFieldClass(field);
    // PAR % as a coloured pill (cr-table.js: green < 3%, amber < 5%, red).
    if (field.pct) return `<td class="${cls}">${CRTable.parPill(v)}</td>`;
    // A location's Value with a bar: its size against the largest location's.
    const max = crBarMax && crBarItems.has(item) ? crBarMax[field.key] : 0;
    return `<td class="${cls}">${crFmtNum(v)}${max ? CRTable.bar(v, max) : ""}</td>`;
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
        `<th colspan="${g.fields.length}" class="${g.fields[0] && g.fields[0].secStart ? "cr-sec-start " : ""}${g.lm ? `cr-lm-${g.lm}` : ""}">${g.label}</th>`
    ).join("");
    const subCells = section.groups.map(g =>
        g.fields.map(f => `<th class="${crFieldClass(f)}${f.secStart ? " cr-sec-start" : ""}${f.lm ? ` cr-lm-${f.lm}` : ""}${sortCls(f.key)}" data-sort-key="${f.key}" data-sort-type="number">${f.label}</th>`).join("")
    ).join("");

    const rows = CRTable.headRowCount(section);
    const sectionRow = CRTable.sectionLabelRow(section);
    const leadCells = `
        <th rowspan="${rows}" class="cr-name-col${sortCls("_name")}" data-sort-key="_name" data-sort-type="text">${t("creditreport.compare.dimLocation")}</th>
        <th rowspan="${rows}" class="cr-col-num${sortCls("families")}" data-sort-key="families" data-sort-type="number">${t("creditreport.byLocation.colFamily")}</th>
        <th rowspan="${rows}" class="cr-col-pct${sortCls("segmentationPct")}" data-sort-key="segmentationPct" data-sort-type="number">${t("creditreport.byLocation.colSegmentationPct")}</th>`;
    return `
      ${sectionRow ? `<tr class="cr-thead-section">${leadCells}${sectionRow}</tr>` : ""}
      <tr class="cr-group-row">
        ${sectionRow ? "" : leadCells}
        ${groupCells}
      </tr>
      <tr class="cr-sub-row">${subCells}</tr>`;
}

let crOtherAddressExpanded = false;

// Row number (Actual Only) before a location's name.
function crRank(idx) {
    return idx !== undefined && crCompareMode() === "actual" ? `<span class="cr-rank">${idx + 1}</span>` : "";
}

function crBuildRow(item, section, isTotal, opts = {}) {
    const { isOtherAddress = false, isDetail = false, idx } = opts;
    const cells = section.groups.map(g =>
        g.fields.map(f => crFmtField(item, f)).join("")
    ).join("");
    const locationLabel = isTotal ? t("common.total") : item.location;
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
        // Display label only — the server's raw "Other Address" bucket
        // name (item.location / isOtherAddress comparisons elsewhere)
        // stays untranslated so matching against it keeps working.
        nameCellContent = `${crRank(idx)}<button type="button" class="cr-other-toggle" aria-expanded="${crOtherAddressExpanded}"><span class="cr-other-toggle-icon">${crOtherAddressExpanded ? "▾" : "▸"}</span>${crEscapeHtml(t("creditreport.byLocation.otherAddress"))}</button>`;
    } else if (isDetail) {
        // A raw address bucketed under "Other Address" isn't a recognized
        // location — no Location Performance page to drill into.
        nameCellContent = crEscapeHtml(locationLabel);
    } else {
        // Opens Location Performance for that location — same pattern as
        // RepDetailbyProduct.js's own cr-product-link. The Total row
        // drills into the "All Location" aggregate.
        const locationKey = isTotal ? "All Location" : item.location;
        nameCellContent = `${isTotal ? "" : crRank(idx)}<button type="button" class="cr-location-link" data-location="${crEscapeHtml(locationKey)}">${crEscapeHtml(locationLabel)}</button>`;
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
    loss: 4, majorDefault: 5, nonPerformingLoan: 6, total: 7
};

// Maps the T24 Loan Class filter's values to their matching bucket key
// within parT24ByClass (added to the backend so Daily History can slice
// by class without a refetch — see lib/creditreport-location.js's own
// T24_CLASS_FILTER_VALUES). "" (All) and "total" (Total T24 Overdue) are
// deliberately absent — both just show the flat parT24 group unchanged
// (see crActiveSection() below), not a bucket.
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
// that "All" is gone — it still just shows the flat parT24 group
// unchanged (see crActiveSection() below), not a bucket.
//
// Each of the 7 classification buckets gets its own # Loan/Value/PAR%,
// same shape as the flat parT24 group. Note this reads ".loan", a
// DIFFERENT field than crGroupPct()'s own ".count" (that's nbcOverdue's
// own convention) — parT24ByClass uses ".loan", matching parT24 itself.
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

// Several sections picked: each one's groups side by side (crCombinedSection).
function crActiveSection() {
    if (crCompareMode() === "lastMonth") return CRTable.tagSectionStarts(crLastMonth.expand(crCombinedSection(crSectionFor)));
    return CRTable.tagSectionStarts(crCombinedSection(crSectionFor));
}

function crSectionFor(sectionKey) {
    const section = crSections()[sectionKey];

    if (sectionKey === "nbcOverdue") {
        // Several classes picked: one group each, in the order listed.
        const idxs = crPicks("crNbcClass").map(v => CR_NBC_CLASS_INDEX[v]).filter(i => i !== undefined);
        if (!idxs.length) return section;
        return { groups: idxs.sort((a, b) => a - b).map(i => section.groups[i]) };
    }

    // Current mode already narrows parT24 server-side (see
    // crBuildQuery's own t24Class) — the flat group already shows the
    // filtered figures, so no swap is needed there. Only History mode
    // (no refetch) needs to pick a different field source for the same
    // single group.
    if (sectionKey === "parT24" && crMode === "history") {
        const picks = crPicks("crClass").filter(v => CR_T24_CLASS_INDEX[v]);
        if (!picks.length) return section;
        const label = section.groups[0].label;
        const optText = v => [...document.getElementById("crClass").options].find(o => o.value === v)?.textContent.trim() || v;
        return {
            groups: picks.map(v => crT24ClassGroup(`parT24ByClass.${CR_T24_CLASS_INDEX[v]}`,
                picks.length > 1 ? `${label} — ${optText(v)}` : label))
        };
    }

    return section;
}

function crRenderSection() {
    if (!crData) return;
    const section = crActiveSection();

    const displayItems = crApplySort(crData.items);
    crBarItems = new Set(crData.items);
    crBarMax = crCompareMode() === "actual" ? {} : null;
    if (crBarMax) {
        section.groups.forEach(g => g.fields.forEach(f => {
            if (f.money && /\.value$/.test(f.key)) crBarMax[f.key] = Math.max(0, ...crData.items.map(it => Number(crGetByPath(it, f.key)) || 0));
        }));
    }

    document.getElementById("crThead").innerHTML = crBuildThead(section);

    const bodyHtml = displayItems.map((it, idx) => {
        const isOtherAddress = it.location === "Other Address";
        const rowHtml = crBuildRow(it, section, false, { isOtherAddress, idx });
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
    CRTable.edgeHint(document.getElementById("crTableScroll"));
    crRenderTableHead();
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
        `<th colspan="${g.fields.length}"${g.fields[0] && g.fields[0].secStart ? ' class="cr-sec-start"' : ""}>${g.label}</th>`
    ).join("");
    const subCells = section.groups.map(g =>
        g.fields.map(f => `<th class="${crFieldClass(f)}${f.secStart ? " cr-sec-start" : ""}">${f.label}</th>`).join("")
    ).join("");
    const rows = CRTable.headRowCount(section);
    const sectionRow = CRTable.sectionLabelRow(section);
    const leadCells = `
        <th rowspan="${rows}" class="cr-name-col">Location</th>
        <th rowspan="${rows}" class="cr-date-col">Date</th>
        <th rowspan="${rows}" class="cr-col-num"># Family</th>
        <th rowspan="${rows}" class="cr-col-pct">Segmentation%</th>`;
    return `
      ${sectionRow ? `<tr class="cr-thead-section">${leadCells}${sectionRow}</tr>` : ""}
      <tr class="cr-group-row">
        ${sectionRow ? "" : leadCells}
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
    return section.groups.some(g => g.key === "parT24");
}

function crBuildHistoryRow(dateKey, item, section, opts = {}) {
    const { isTotal = false, isOtherAddress = false, isDetail = false, t24AsOfText = "" } = opts;
    const cells = section.groups.map(g =>
        g.fields.map(f => crFmtField(item, f)).join("")
    ).join("");
    const nameLabel = isTotal ? t("common.total") : item.location;

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
        ? `<div class="cr-t24-asof" title="${t("creditreport.detail.t24AsOfTooltip")}">T24: ${crEscapeHtml(t24AsOfText)}</div>`
        : "";

    // Admin-only — lets an admin remove a single day's saved snapshot
    // (e.g. one filed under an unexpected date — see crGridMergeDateKey's
    // own comment in the backend). Never on the "Other Address" detail
    // sub-rows — they share the same saved snapshot document as their
    // parent date's main row.
    const delBtn = (crIsAdmin && !isDetail)
        ? `<button type="button" class="cr-row-delete-btn" data-hist-del="${crEscapeHtml(dateKey)}" title="${t("creditreport.detail.deleteDaySnapshotTitle")}"><span class="cr-ico cr-ico-trash" aria-hidden="true"></span></button>`
        : "";
    // Admin-only — re-pulls currently-live T24 into this date's saved
    // snapshot (T24 is otherwise frozen once a date is first saved).
    // Same exclusion as delBtn: never on the "Other Address" detail rows.
    const refreshBtn = (crIsAdmin && !isDetail)
        ? `<button type="button" class="cr-row-refresh-btn" data-hist-refresh="${crEscapeHtml(dateKey)}" title="${t("creditreport.detail.refreshT24Title")}"><span class="cr-ico cr-ico-refresh" aria-hidden="true"></span></button>`
        : "";

    const rowClass = isTotal ? ' class="cr-total-row"' : isOtherAddress ? ' class="cr-other-row"' : isDetail ? ' class="cr-other-detail-row"' : "";
    return `
      <tr${rowClass}>
        <td class="cr-name-col${isDetail ? " cr-other-detail-name" : ""}">${nameCellContent}</td>
        <td class="cr-date-col"><div class="cr-date-main">${crFmtDateDMY(dateKey)}${refreshBtn}${delBtn}</div>${t24Note}</td>
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
        crShowEmpty(t("creditreport.detail.noHistorySaved"));
        return;
    }

    // One row per date, in order, for the locations kept in the search box
    // (crHistItemForDay(): that location's own row, or several kept — their
    // combined row). Nothing kept: nothing to show. Other Address expands
    // in place per-date (its own otherAddressDetail for that day) when it
    // is the one location kept.
    const location = crResolveSelectedLocation();
    if (!location) {
        document.getElementById("crTbody").innerHTML = "";
        crShowEmpty(t("creditreport.byLocation.selectThenViewHistory", { viewHistory: t("creditreport.detail.viewHistory") }));
        return;
    }
    // Other Address expands only when it is the one location kept.
    const isOtherAddress = location === "Other Address" && crHistLocations().length === 1;

    let rowsHtml = "";
    for (const day of crHistoryData.days) {
        const item = crHistItemForDay(day);
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
    CRTable.edgeHint(document.getElementById("crTableScroll"));
    crRenderTableHead();
}

async function crFetchHistory() {
    const dateFrom = document.getElementById("crHistFromDate").value;
    const dateTo = document.getElementById("crHistToDate").value;
    if (!dateFrom || !dateTo) return;

    // Ask only for the kept locations — the full all-location snapshot
    // for a 2-week range is large enough to time out on the backend's
    // throttled database link. A different set afterwards re-fetches
    // (see crHistLocationPicker).
    const params = new URLSearchParams({ dateFrom, dateTo });
    // Several locations: one param each.
    const picks = crHistLocations();
    picks.forEach(v => params.append("location", v));

    crShowLoading();
    try {
        const url = `${API.BASE_URL}/api/creditreport/bylocation/history?${params.toString()}`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${crToken}` } });
        const data = await res.json();
        crHideLoading();

        if (!data.ok) {
            crShowEmpty(data.message || t("creditreport.detail.failedLoadHistory"));
            return;
        }
        crHistoryData = data;
        crHistoryData.location = picks.length ? crHistLocationPicker.key() : null;
        crRenderHistory();
    } catch (e) {
        console.error(e);
        crHideLoading();
        crShowEmpty(t("creditreport.detail.networkErrorHistory"));
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
    // Comparison is for the current report only.
    document.getElementById("crCompareRow").style.display = mode === "history" ? "none" : "";
    crUpdateClassVisibility();
    crUpdateHistRunButtonState();
    crUpdateChartButtonVisibility();
    crLastMonth.note();

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
// The kept locations (chips under the search box — see crChipPicker() in
// cr-multi.js); the first one, or null; one day's row for them: that
// location's own, or — several kept — the server's combined row (added up,
// PAR % recomputed).
let crHistLocationPicker = null;
function crHistLocations() {
    return crHistLocationPicker ? crHistLocationPicker.list() : [];
}
function crResolveSelectedLocation() {
    return crHistLocations()[0] || null;
}
function crHistItemForDay(day) {
    const picks = crHistLocations();
    if (picks.length > 1) return day.combined || null;
    return picks.length ? day.items.find(it => it.location === picks[0]) || null : null;
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
    const sectionRow = document.querySelector("#crTable thead tr.cr-thead-section");
    const groupRow = document.querySelector("#crTable thead tr.cr-group-row");
    const subRow = document.querySelector("#crTable thead tr.cr-sub-row");
    if (!groupRow || !subRow) return;
    const sectionH = sectionRow ? sectionRow.getBoundingClientRect().height : 0;
    groupRow.querySelectorAll("th").forEach(th => { th.style.top = sectionH + "px"; });
    const h = sectionH + groupRow.getBoundingClientRect().height;
    subRow.querySelectorAll("th").forEach(th => { th.style.top = h + "px"; });
}
window.addEventListener("resize", crSetHeaderOffsets);
window.addEventListener("orientationchange", () => setTimeout(crSetHeaderOffsets, 200));

// ========================================
// LOADING STATES
// ========================================
// True from a Refresh's server reply until the re-run report is done: the
// re-run's own crShowLoading() then keeps the Refresh bar going instead of
// restarting it at 0% as a plain load.
let crRefreshing = false;
// Progress-mode overlay (% bar, topbar / bottom nav stay usable);
// `key` keeps a separate time estimate per kind of load.
function crShowLoading(message = t("creditreport.loadingReportData"), key = "load") {
    document.getElementById("crSkeleton").style.display = "block";
    document.getElementById("crSearchWrap").style.display = "none";
    document.getElementById("crTableScroll").style.display = "none";
    document.getElementById("crEmptyMsg").style.display = "none";
    if (!crRefreshing && typeof showAppLoading === "function") showAppLoading(message, { progress: true, key: `crByLocation:${key}` });
}
function crHideLoading() {
    crRefreshing = false;
    document.getElementById("crSkeleton").style.display = "none";
    if (typeof hideAppLoading === "function") hideAppLoading();
}
function crShowEmpty(msg) {
    const el = document.getElementById("crEmptyMsg");
    el.textContent = msg;
    el.style.display = "block";
    document.getElementById("crSearchWrap").style.display = "none";
    document.getElementById("crTableScroll").style.display = "none";
    document.getElementById("crTblHead").hidden = true;
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

    // One param per picked value; "total" (Total T24 Overdue) is the
    // class filter's All — never sent.
    crPicks("crClass").forEach(v => parts.push(`t24Class=${encodeURIComponent(v)}`));
    crPicks("crProduct").forEach(v => parts.push(`t24Product=${encodeURIComponent(v)}`));

    // crNbcClass is NOT sent — every classification is already in the
    // response (see crActiveSection() above), so it's a display-only pick.
    crPicks("crNbcProduct").forEach(v => parts.push(`nbcProduct=${encodeURIComponent(v)}`));

    // Branch/Officer/District/Commune: before crPopulateFilters() has run
    // (i.e. on the very first request of a page load), these selects have
    // no options yet to carry a restored URL value — fall back to the raw
    // value read straight off the URL at crReadStateFromUrl() time. Once
    // populated, the select itself is always the source of truth (see
    // crPopulateFilters()), so the pending value is never consulted again.
    const picks = (id, pending) => (crFiltersInitialised ? crPicks(id) : pending);
    picks("crBranch", crPendingBranch).forEach(v => parts.push(`branch=${encodeURIComponent(v)}`));
    picks("crOfficer", crPendingOfficerId).forEach(v => parts.push(`officerId=${encodeURIComponent(v)}`));
    picks("crDistrict", crPendingDistrict).forEach(v => parts.push(`district=${encodeURIComponent(v)}`));
    picks("crCommune", crPendingCommune).forEach(v => parts.push(`commune=${encodeURIComponent(v)}`));

    return parts.length ? `?${parts.join("&")}` : "";
}

// The T24 Loan Class/Product Type filters only mean something for the
// Balance Loan at Risk (T24) section, and the NBC Overdue Loan
// Class/Product Type filters only for the NBC Overdue section — hide
// each pair otherwise so they can't be mistaken for applying to a
// section they don't affect.
function crUpdateClassVisibility() {
    const isT24 = crHasSection("parT24");
    const isNbc = crHasSection("nbcOverdue");
    // History rows are precomputed daily snapshots with every
    // classification/product already in them (see crActiveSection()) —
    // the T24/NBC Product Type filters need a server-side recompute this
    // view doesn't do, so they're hidden in History mode. The T24/NBC
    // Loan Class pickers stay: both are now a local display pick among
    // the already-fetched classifications (parT24ByClass), same as in
    // Current mode.
    const isHistory = crMode === "history";
    document.getElementById("crClassRow").style.display = isT24 ? "" : "none";
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
// Each a list (several picked); [] = All.
let crPendingBranch = [], crPendingOfficerId = [], crPendingDistrict = [], crPendingCommune = [];
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

// Rebuilds #crCommune's options to just the selected Districts' own
// communes (every commune when no District is selected), keeping the
// picks that are still on the new list.
function crRebuildCommuneOptions() {
    const districts = crPicks("crDistrict");
    const communeSel = document.getElementById("crCommune");
    const current = crPicks("crCommune");
    const allowed = districts.length
        ? [...new Set(districts.flatMap(d => crDistrictCommunes[d] || []))].sort((a, b) => a.localeCompare(b))
        : crCommunesList;

    communeSel.innerHTML = `<option value="" data-i18n="creditreport.detail.all">${t("creditreport.detail.all")}</option>` +
        allowed.map(c => `<option value="${crEscapeHtml(c)}">${crEscapeHtml(c)}</option>`).join("");
    crRestorePicks("crCommune", current.filter(c => allowed.includes(c)));
}

// Rebuilds #crOfficer's options to just the selected Branches' own
// officers (every officer when no Branch is selected), keeping the
// picks that are still on the new list.
function crRebuildOfficerOptions() {
    const branches = crPicks("crBranch");
    const officerSel = document.getElementById("crOfficer");
    const current = crPicks("crOfficer");
    const allowed = branches.length ? crOfficerRoster.filter(o => branches.includes(o.branch)) : crOfficerRoster;

    officerSel.innerHTML = `<option value="" data-i18n="creditreport.detail.all">${t("creditreport.detail.all")}</option>` +
        allowed.map(o => `<option value="${crEscapeHtml(o.id)}">${crEscapeHtml(o.name)}</option>`).join("");
    crRestorePicks("crOfficer", current.filter(id => allowed.some(o => o.id === id)));
}

function crPopulateFilters(data) {
    if (crFiltersInitialised) return;

    crCommunesList = data.communes || [];
    crOfficerRoster = data.officers || [];
    crDistrictCommunes = data.districtCommunes || {};

    crPopulateSelectOptions(document.getElementById("crBranch"), data.branches || []);
    crPopulateSelectOptions(document.getElementById("crDistrict"), data.districts || []);

    const restore = (id, pending) => crRestorePicks(id, pending);
    // Branch/District first — Officer/Commune cascade off whichever values
    // end up restored here.
    restore("crBranch", crPendingBranch);
    restore("crDistrict", crPendingDistrict);

    crRebuildCommuneOptions();
    restore("crCommune", crPendingCommune);

    crRebuildOfficerOptions();
    restore("crOfficer", crPendingOfficerId);

    crFiltersInitialised = true;
}

// ========================================
// COMPARISON — Actual Only (the report as it was) or Last Month: each
// figure next to last month's (the last saved Daily History day of
// last month, see cr-last-month.js) and the change. Current mode only.
// A T24 Loan Class pick compares with last month's same classes; a
// Product Type pick blanks only its own section. Branch / Officer aren't
// saved and change each location's figures, so with one picked every
// Last Month cell is "—"; with District / Commune picked the saved
// Total (every location) isn't the total on screen. "Other Address"'s
// own breakdown rows are not compared.
// ========================================
function crCompareMode() {
    if (crMode !== "current") return "actual";
    return document.getElementById("crCompare")?.value === "lastMonth" ? "lastMonth" : "actual";
}

// Branch / Officer change every location's figures and aren't saved.
function crLastMonthFilters() {
    const names = [];
    if (crPicks("crBranch").length) names.push(t("creditreport.detail.branch"));
    if (crPicks("crOfficer").length) names.push(t("creditreport.detail.officer"));
    return names;
}

// The T24 / NBC filters only change their own section (cr-last-month.js).
function crLastMonthSectionFilters() {
    return { t24Class: crPicks("crClass"), t24Product: crPicks("crProduct"), nbcProduct: crPicks("crNbcProduct") };
}

const crLastMonth = CRLastMonth.controller({
    endpoint: "/api/creditreport/bylocation/history",
    token: crToken,
    active: () => crCompareMode() === "lastMonth",
    data: () => crData,
    keyOf: it => it.location,
    totalBlocked: () => crPicks("crDistrict").length > 0 || crPicks("crCommune").length > 0,
    blockedBy: crLastMonthFilters,
    sectionFilters: crLastMonthSectionFilters,
    render: () => crRenderSection(),
    noteEl: "crLmNote",
    compact: true,
    fmtDate: v => crFmtDateDMY(v),
    onError: () => notify(t("creditreport.lastMonth.loadFailed"), "error")
});

document.getElementById("crCompare").addEventListener("change", () => {
    crRenderSection();
    crLastMonth.ensure();
    crSyncStateToUrl();
});

// ========================================
// TABLE TITLE + SCREENSHOT — over the table: the report's name, the
// section(s) shown, the comparison and its dates, and a Screenshot
// button (only once a section is picked, not All Sections) that copies
// the whole table card as an image to paste into Telegram (cr-shot.js).
// ========================================
function crTableHeadMeta() {
    const chip = text => `<span class="cr-tbl-chip">${crEscapeHtml(text)}</span>`;
    const span = text => `<span>${crEscapeHtml(text)}</span>`;
    if (crMode === "history") {
        const from = document.getElementById("crHistFromDate").value, to = document.getElementById("crHistToDate").value;
        return chip(t("creditreport.detail.dailyHistory")) + (from && to ? span(`${crFmtDateDMY(from)} → ${crFmtDateDMY(to)}`) : "");
    }
    const sel = document.getElementById("crCompare");
    const compareText = [...sel.options].find(o => o.value === sel.value)?.textContent.trim() || "";
    const d = crData || {};
    const parts = [chip(compareText)];
    if (crCompareMode() === "lastMonth") {
        const last = crLastMonth.lastLabel();
        if (last) parts.push(span(`${last} → ${CRLastMonth.shortDate(d.toDate)}`));
    } else {
        parts.push(span(t("creditreport.tblhead.asOf", { date: document.getElementById("crOsGridMerge").textContent.trim() })));
    }
    const keys = crSectionKeys();
    const has = k => !keys.length || keys.includes(k);
    if (has("disburse")) parts.push(span(t("creditreport.tblhead.disb", { from: crFmtDateDMY(d.fromDate), to: crFmtDateDMY(d.toDate) })));
    if (has("writeOff")) parts.push(span(t("creditreport.tblhead.wo", { from: crFmtDateDMY(d.woFromDate), to: crFmtDateDMY(d.woToDate) })));
    if (has("parT24")) parts.push(span(`T24 ${document.getElementById("crArrearsPenalty").textContent.trim()}`));
    return parts.join("");
}

function crRenderTableHead() {
    const keys = crSectionKeys();
    const sel = document.getElementById("crSection");
    const optText = v => [...sel.options].find(o => o.value === v)?.textContent.trim() || v;
    document.getElementById("crTblSub").textContent = keys.length ? keys.map(optText).join(" · ") : optText("all");
    document.getElementById("crTblMeta").innerHTML = crTableHeadMeta();
    document.getElementById("crTblHead").hidden = false;
    document.getElementById("btnCrShot").hidden = !keys.length;
}

document.getElementById("btnCrShot").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
        const name = `MonitoringByLocation_${(crData && crData.toDate) || ""}.png`;
        const how = await CRShot.capture(document.getElementById("crTableCard"), name);
        if (how !== "cancelled") notify(t(`creditreport.shot.${how}`), "success");
    } catch (err) {
        console.error("screenshot failed:", err);
        notify(t("creditreport.shot.failed"), "error");
    } finally {
        btn.disabled = false;
    }
});


// ========================================
// URL STATE
// Mirrors section/dates into the address bar via history.replaceState
// (no new history entries) — same mechanism as RepDetailbyCO.js, minus
// the branch/team bits this page doesn't have.
// ========================================
function crReadStateFromUrl() {
    const p = new URLSearchParams(location.search);

    crRestoreSections(p, crSections());

    crRestorePicks("crClass", p.getAll("t24Class"));

    crRestorePicks("crProduct", p.getAll("t24Product"));

    crRestorePicks("crNbcClass", p.getAll("nbcClass"));

    crRestorePicks("crNbcProduct", p.getAll("nbcProduct"));

    if (p.get("compare") === "lastMonth") document.getElementById("crCompare").value = "lastMonth";

    // Branch/Officer/District/Commune selects have no options yet at this
    // point (they're populated from the first API response) — stash the
    // raw URL value for crBuildQuery()'s first request and crPopulateFilters()
    // to restore once the options exist.
    crPendingBranch = p.getAll("branch").filter(Boolean);
    crPendingOfficerId = p.getAll("officerId").filter(Boolean);
    crPendingDistrict = p.getAll("district").filter(Boolean);
    crPendingCommune = p.getAll("commune").filter(Boolean);
}

function crSyncStateToUrl() {
    const p = new URLSearchParams();
    crAddSections(p);

    crAddPicks(p, "t24Class", "crClass");
    crAddPicks(p, "t24Product", "crProduct");
    crAddPicks(p, "nbcClass", "crNbcClass");
    crAddPicks(p, "nbcProduct", "crNbcProduct");
    if (document.getElementById("crCompare").value !== "actual") p.set("compare", document.getElementById("crCompare").value);
    // Only reached after crPopulateFilters() has already run (see
    // crRunReport()), so these selects always hold the live, restored value.
    crAddPicks(p, "branch", "crBranch");
    crAddPicks(p, "officerId", "crOfficer");
    crAddPicks(p, "district", "crDistrict");
    crAddPicks(p, "commune", "crCommune");

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
            crShowEmpty(data.message || t("creditreport.detail.failedLoadReport"));
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
            t("creditreport.detail.dateRange", { from: crFmtDateDMY(data.fromDate), to: crFmtDateDMY(data.toDate) });
        document.getElementById("crWoPeriod").textContent =
            t("creditreport.detail.dateRange", { from: crFmtDateDMY(data.woFromDate), to: crFmtDateDMY(data.woToDate) });
        document.getElementById("crLocationCount").textContent =
            `${(data.items || []).length}`;

        if (!data.items || !data.items.length) {
            crShowEmpty(t("creditreport.byLocation.noLocationsMatch"));
            return;
        }

        crData = data;
        crPopulateHistoryLocationRoster(data.items);
        crSeedHistoryDates(data);
        document.getElementById("crSearchWrap").style.display = "flex";
        document.getElementById("crTableScroll").style.display = "block";
        crRenderSection();
        crLastMonth.ensure();
    } catch (e) {
        console.error(e);
        crHideLoading();
        crShowEmpty(t("creditreport.detail.networkErrorReport"));
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
// In History mode, the T24 Loan Class filter is a local display pick
// among the already-fetched parT24ByClass buckets (see
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
    if (typeof CMToast !== "undefined" && CMToast.show) CMToast.show({ type, title: message, message: "", duration: 3500 });
    else if (typeof showToast === "function") showToast(message, type);
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
// EXPORT EXCEL / PDF, PRINT, FULLSCREEN — the report on screen, same
// engine and look as Daily Arrears (cr-export.js, arrears-export.js).
// ========================================
CRExport.wire({ name: "MonitoringByLocation", beforeExport: crClearSearchForExport });

// ========================================
// SNAPSHOT — admin only, per explicit request 2026-10-08. Same
// endpoint the Credit Report hub's own "Snapshot All" button already
// calls for Location; offered here too as a page-local shortcut.
// ========================================
if (crIsAdmin) {
    const snapBtn = document.getElementById("btnCrSnapshot");
    if (snapBtn) snapBtn.style.display = "";
}
async function crRunSnapshotNow() {
    if (typeof showAppLoading === "function") showAppLoading(t("creditreport.compare.savingSnapshot"));
    try {
        const res = await fetch(`${API.BASE_URL}/api/creditreport/bylocation/snapshot/run`, {
            method: "POST",
            headers: { Authorization: `Bearer ${crToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({})
        });
        const data = await res.json();
        if (data.ok) {
            notify(t("creditreport.compare.snapshotSavedFor", { date: data.date }), "success");
        } else {
            notify(data.message || t("creditreport.compare.snapshotFailed"), "error");
        }
    } catch (e) {
        console.error(e);
        notify(t("creditreport.compare.snapshotFailed"), "error");
    } finally {
        if (typeof hideAppLoading === "function") hideAppLoading();
    }
}
document.getElementById("btnCrSnapshot")?.addEventListener("click", crRunSnapshotNow);

// ========================================
// REFRESH DATA — clears the server's row cache, then reloads.
// ========================================
document.getElementById("btnCrRefreshData")?.addEventListener("click", async () => {
    document.getElementById("crMenuDropdown")?.classList.remove("show");
    crShowLoading(t("creditreport.detail.refreshingFromDb"), "refresh");
    try {
        const res = await fetch(`${API.BASE_URL}/api/creditreport/bylocation/refresh`, {
            method: "POST",
            headers: { Authorization: `Bearer ${crToken}` }
        });
        const data = await res.json();
        // One continuous "Refreshing from DB" bar through the re-run below,
        // timed by the server's last Mongo read (expectMs) when it has one.
        if (data.ok) {
            crRefreshing = true;
            if (data.expectMs > 0 && typeof setAppLoadingExpect === "function") setAppLoadingExpect(data.expectMs + 1500);
        }
        if (!data.ok) {
            crHideLoading();
            crShowEmpty(data.message || t("creditreport.detail.refreshFailed"));
            return;
        }
        crData = null;
        await crRunReport();
        if (crRefreshing) crHideLoading();
    } catch (e) {
        console.error("[refresh data] failed:", e);
        crHideLoading();
        crShowEmpty(t("creditreport.detail.networkErrorRefresh"));
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
// HISTORY MODE — UI wiring
// ========================================
document.getElementById("crModeCurrentBtn").addEventListener("click", () => crSetMode("current"));
document.getElementById("crModeHistoryBtn").addEventListener("click", () => crSetMode("history"));
document.getElementById("btnCrHistRun").addEventListener("click", crFetchHistory);
// Search keeps several locations: an exact match (a picked suggestion)
// becomes a chip and the box clears for the next one. Loaded history only
// carries the locations it was fetched for, so a different set re-fetches.
crHistLocationPicker = crChipPicker({
    row: document.getElementById("crHistLocationRow"),
    keyOf: v => v,
    labelOf: v => v,
    onChange: () => {
        crUpdateHistRunButtonState();
        crUpdateChartButtonVisibility();
        if (!crHistoryData) return;
        if (crHistLocations().length && crHistLocationPicker.key() !== crHistoryData.location) crFetchHistory();
        else crRenderHistory();
    }
});
document.getElementById("crHistLocationSearch").addEventListener("input", (e) => {
    const typed = e.target.value.trim();
    const match = typed && crHistLocationRoster.find(v => v === typed);
    if (match) {
        e.target.value = "";
        crHistLocationPicker.add(match);
    }
    document.getElementById("crHistLocationClear").hidden = !e.target.value;
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
    // Delegated — rows are rebuilt wholesale on every crRenderHistory()
    // call, so a listener bound to individual buttons would be lost each
    // time; binding to the table body once survives re-renders.
    document.getElementById("crTbody").addEventListener("click", async (e) => {
        const btn = e.target.closest(".cr-row-delete-btn");
        if (!btn) return;
        const dateKey = btn.getAttribute("data-hist-del");
        if (!dateKey) return;
        if (!confirm(t("creditreport.compare.confirmDeleteSnapshot", { date: crFmtDateDMY(dateKey) }))) return;

        btn.disabled = true;
        try {
            const res = await fetch(`${API.BASE_URL}/api/creditreport/bylocation/snapshot/delete`, {
                method: "POST",
                headers: { Authorization: `Bearer ${crToken}`, "Content-Type": "application/json" },
                body: JSON.stringify({ date: dateKey })
            });
            const data = await res.json();
            if (data.ok) {
                crHistoryData.days = crHistoryData.days.filter(d => d.date !== dateKey);
                crRenderHistory();
                notify(t("creditreport.compare.snapshotDeletedFor", { date: crFmtDateDMY(dateKey) }), "success");
            } else {
                notify(data.message || t("creditreport.compare.deleteFailed"), "error");
                btn.disabled = false;
            }
        } catch (err) {
            console.error(err);
            notify(t("creditreport.compare.deleteFailed"), "error");
            btn.disabled = false;
        }
    });

    // Re-pulls live T24 into one date's already-frozen snapshot. Simplest
    // correct refresh is to just re-fetch the whole visible date range
    // afterward — crFetchHistory() already re-renders.
    document.getElementById("crTbody").addEventListener("click", async (e) => {
        const btn = e.target.closest(".cr-row-refresh-btn");
        if (!btn) return;
        const dateKey = btn.getAttribute("data-hist-refresh");
        if (!dateKey) return;
        if (!confirm(t("creditreport.compare.confirmRefreshT24", { date: crFmtDateDMY(dateKey) }))) return;

        btn.disabled = true;
        try {
            const res = await fetch(`${API.BASE_URL}/api/creditreport/bylocation/snapshot/refresh-t24`, {
                method: "POST",
                headers: { Authorization: `Bearer ${crToken}`, "Content-Type": "application/json" },
                body: JSON.stringify({ date: dateKey })
            });
            const data = await res.json();
            if (data.ok) {
                await crFetchHistory();
                notify(t("creditreport.compare.t24RefreshedFor", { date: crFmtDateDMY(dateKey) }), "success");
            } else {
                notify(data.message || t("creditreport.compare.t24RefreshFailed"), "error");
                btn.disabled = false;
            }
        } catch (err) {
            console.error(err);
            notify(t("creditreport.compare.t24RefreshFailed"), "error");
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
// specific "Showing" section picked (not left at "All Sections"). Same
// idea for "Balance Loan at Risk (NBC Overdue)" with its own Loan Class
// left at "All" — plotting all 7 classifications at once isn't a
// focused chart either, hidden until a specific classification (or the
// "Total NBC Overdue" option) is picked — per explicit follow-up
// request 2026-10-05.
// T24's own Loan Class filter has no "All" value any more (removed per
// explicit request 2026-10-05 — "Total T24 Overdue" already covers that
// unfiltered view), so unlike NBC Overdue there's nothing left to hide
// Chart on there: it's always visible once Showing is parT24.
function crUpdateChartButtonVisibility() {
    const btn = document.getElementById("btnCrHistChart");
    if (!btn) return;
    // The chart follows one section, and one classification within it.
    const keys = crSectionKeys();
    const sectionFilter = keys.length === 1 ? keys[0] : "all";
    // The chart follows one classification: hidden for All NBC classes,
    // and when several NBC / T24 classes are picked.
    const nbcClassAll = (sectionFilter === "nbcOverdue" && crPicks("crNbcClass").length !== 1) ||
        (sectionFilter === "parT24" && crPicks("crClass").length > 1);
    btn.style.display = (crMode === "history" && crResolveSelectedLocation() && sectionFilter !== "all" && !nbcClassAll) ? "" : "none";
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
    // Balance Loan at Risk (T24) is never date-filtered — it reflects the
    // ArreasT24ByCO data live at snapshot time, so with T24 shown the X
    // axis follows that "as of" moment instead of the row Date.
    const xLabels = days.map(d => crSectionHasT24(section) && d.t24AsOfText
        ? CRGrowthDashboard.fmtShortDateTime(d.t24AsOfText)
        : CRGrowthDashboard.fmtShortDate(d.date));
    // Header, hero card, chart card, other figures and Key insights —
    // cr-chart-view.js.
    if (crChartInstance) crChartInstance.destroy();
    crChartInstance = CRChartView.render({
        section,
        days,
        metricLabel: crChartMetricLabel,
        scopeParts: crHistLocations(),
        xLabels,
        colors: crChartSeriesColors(),
        getItemForDay: crHistItemForDay,
        getByPath: crGetByPath,
        fmtNum: crFmtNum
    });
}

function crOpenChart() {
    if (!crHistoryData || !crHistoryData.days.length) return;
    if (!crResolveSelectedLocation()) return;
    if (typeof Chart === "undefined") {
        notify(t("creditreport.detail.chartLibFailed"), "error");
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
// Every filter picks several values, Showing (crSection) included.
crMultiEnhance(["crSection", "crDistrict", "crCommune", "crBranch", "crOfficer", "crClass", "crProduct", "crNbcClass", "crNbcProduct"]);
crReadStateFromUrl();
crUpdateClassVisibility();
crRunReport();
