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
// combined figure. Unlike Product, a location name is plain text, not a
// link — there's no Location Performance drill-down page.
//
// Branch/Officer/District/Commune (added 2026-10-01) are server-side
// filters — narrowing the rows before they're grouped by location — not a
// different "Showing" view, so changing any of them triggers a full
// crRunReport() refetch, same as the T24/NBC Loan Class/Product Type
// filters already do.
// ========================================

const crToken =
    localStorage.getItem("token") ||
    sessionStorage.getItem("token");

const CR_PAR_ALERT = 0.04; // PAR % at or above this renders red

let crData = null; // last successful /bylocation response

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
function crToDMY(dateStr) {
    if (!dateStr) return "";
    const [y, m, d] = dateStr.split("-");
    return `${d}-${m}-${y}`;
}
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
        ${groupCells}
      </tr>
      <tr class="cr-sub-row">${subCells}</tr>`;
}

function crBuildRow(item, section, isTotal) {
    const cells = section.groups.map(g =>
        g.fields.map(f => crFmtField(item, f)).join("")
    ).join("");
    // Location is plain text, not a link — there's no Location
    // Performance drill-down page (unlike RepDetailbyProduct.js's own
    // cr-product-link).
    const locationLabel = isTotal ? "Total" : item.location;
    // data-name backs crApplySearchFilter()'s client-side name search —
    // lowercased once here rather than re-lowercasing on every keystroke.
    const nameAttr = isTotal ? "" : ` data-name="${crEscapeHtml((item.location || "").toLowerCase())}"`;
    return `
      <tr${isTotal ? ' class="cr-total-row"' : ""}${nameAttr}>
        <td class="cr-name-col">${crEscapeHtml(locationLabel)}</td>
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
    document.getElementById("crTbody").innerHTML =
        displayItems.map(it => crBuildRow(it, section, false)).join("") +
        crBuildRow(crData.total, section, true);

    // Re-render (switching "Showing") rebuilds every row from scratch,
    // so whatever the user already typed needs re-applying rather than
    // being silently dropped.
    crApplySearchFilter();
    requestAnimationFrame(crSetHeaderOffsets);
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
    document.getElementById("btnCrRun").disabled = true;
    if (typeof showAppLoading === "function") showAppLoading(message);
}
function crHideLoading() {
    document.getElementById("crSkeleton").style.display = "none";
    document.getElementById("btnCrRun").disabled = false;
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
// Dates start empty; omitting them lets the server derive its defaults
// from the data (latest OS disbursement date) and echo back what it used.
function crBuildQuery() {
    const parts = [];
    const addDate = (param, id) => {
        const v = document.getElementById(id).value;
        if (v) parts.push(`${param}=${crToDMY(v)}`);
    };
    addDate("fromDate", "crFromDate");
    addDate("toDate", "crToDate");
    addDate("woFromDate", "crWoFromDate");
    addDate("woToDate", "crWoToDate");

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
    document.getElementById("crClassRow").style.display = isT24 ? "" : "none";
    document.getElementById("crProductRow").style.display = isT24 ? "" : "none";
    document.getElementById("crNbcClassRow").style.display = isNbc ? "" : "none";
    document.getElementById("crNbcProductRow").style.display = isNbc ? "" : "none";
}

let crDatesInitialised = false;
function crApplyServerDates(data) {
    if (crDatesInitialised) return;
    const set = (id, v) => { if (v) document.getElementById(id).value = v; };
    set("crFromDate", data.fromDate);
    set("crToDate", data.toDate);
    set("crWoFromDate", data.woFromDate);
    set("crWoToDate", data.woToDate);
    crDatesInitialised = true;
}

// ========================================
// BRANCH / OFFICER / DISTRICT / COMMUNE FILTERS
// Options come from the API response itself (data.branches/officers/
// districts/communes) rather than being hardcoded, since Officer and
// District/Commune in particular depend on live data (the CreditOfficer
// roster and the Address lookup sheet) this page has no other access to.
// Populated once; a URL-restored value (read early by crReadStateFromUrl()
// into the crPending* variables, before these selects have any options to
// hold it) is applied here, the only place it's ever consulted again.
// ========================================
let crFiltersInitialised = false;
let crPendingBranch = "", crPendingOfficerId = "", crPendingDistrict = "", crPendingCommune = "";

function crPopulateSelectOptions(selectEl, items) {
    const optionsHtml = items.map(it => {
        const value = typeof it === "string" ? it : it.id;
        const label = typeof it === "string" ? it : it.name;
        return `<option value="${crEscapeHtml(value)}">${crEscapeHtml(label)}</option>`;
    }).join("");
    selectEl.insertAdjacentHTML("beforeend", optionsHtml);
}

function crPopulateFilters(data) {
    if (crFiltersInitialised) return;

    crPopulateSelectOptions(document.getElementById("crBranch"), data.branches || []);
    crPopulateSelectOptions(document.getElementById("crOfficer"), data.officers || []);
    crPopulateSelectOptions(document.getElementById("crDistrict"), data.districts || []);
    crPopulateSelectOptions(document.getElementById("crCommune"), data.communes || []);

    const restore = (id, pending) => {
        const sel = document.getElementById(id);
        if (pending && [...sel.options].some(o => o.value === pending)) sel.value = pending;
    };
    restore("crBranch", crPendingBranch);
    restore("crOfficer", crPendingOfficerId);
    restore("crDistrict", crPendingDistrict);
    restore("crCommune", crPendingCommune);

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

        crApplyServerDates(data);
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
    crRenderSection();
    crSyncStateToUrl();
});
document.getElementById("crClass").addEventListener("change", crRunReport);
document.getElementById("crProduct").addEventListener("change", crRunReport);
// crNbcClass only picks which already-fetched classification to display
// (see crActiveSection()) — local re-render, no refetch, same as
// switching "Showing" itself.
document.getElementById("crNbcClass").addEventListener("change", () => {
    crRenderSection();
    crSyncStateToUrl();
});
document.getElementById("crNbcProduct").addEventListener("change", crRunReport);

// Branch/Officer/District/Commune are server-side filters, same as the
// T24/NBC Loan Class/Product Type filters above — any change refetches.
document.getElementById("crBranch").addEventListener("change", crRunReport);
document.getElementById("crOfficer").addEventListener("change", crRunReport);
document.getElementById("crDistrict").addEventListener("change", crRunReport);
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
// DATE PANEL
// ========================================
const crDatePanel = document.getElementById("crDatePanel");
const btnCrToggleDates = document.getElementById("btnCrToggleDates");

function crSetDatePanelOpen(open) {
    crDatePanel.classList.toggle("open", open);
    btnCrToggleDates.classList.toggle("open", open);
    btnCrToggleDates.setAttribute("aria-expanded", open ? "true" : "false");
}
btnCrToggleDates.addEventListener("click", () => {
    crSetDatePanelOpen(!crDatePanel.classList.contains("open"));
});
document.getElementById("btnCrRun").addEventListener("click", () => {
    crRunReport();
    crSetDatePanelOpen(false);
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
// INIT
// ========================================
crReadStateFromUrl();
crUpdateClassVisibility();
crRunReport();
