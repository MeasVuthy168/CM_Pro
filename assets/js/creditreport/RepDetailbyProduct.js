// ========================================
// Daily Monitoring by Product — web port, same style as Daily
// Monitoring by Officer (RepDetailbyCO.js/.css) — filter card, sticky
// first column, PAR alert colour, skeleton loading, landscape/print.
// Reads GET /api/creditreport/byproduct (see lib/creditreport-product.js
// for the column mapping behind each figure).
//
// One row per Product Type. Unlike Officer, there's no Branch/Team
// picker (a product isn't "owned" by one branch or team the way an
// officer's row is) and no Own/Area split (that distinction is about a
// loan's disbursing officer vs. the client's address, which doesn't
// apply once rows are grouped by product) — every section here is a
// single combined figure. Clicking a product name (or the Total row)
// opens the Product Performance drill-down page for it — see
// ProductPerformance.js.
// ========================================

const t = (key, vars) => window.CMI18n ? CMI18n.t(key, vars) : key;

const crToken =
    localStorage.getItem("token") ||
    sessionStorage.getItem("token");

const CR_PAR_ALERT = 0.04; // PAR % at or above this renders red

let crData = null; // last successful /byproduct response

// ========================================
// DAILY HISTORY — "current" (today's live report, unchanged default
// behaviour) vs "history" (a Date column added to this same table, one
// row per product per day across a date range), same mechanism as
// RepDetailbyBranch.js's own Daily History — backed by CM-backend's
// /api/creditreport/byproduct/history, which snapshots this exact table
// once a day. No CO/FSRO/Digital breakdown here (the live table has none
// either — see the header note above).
// ========================================
let crMode = "current"; // "current" | "history"
let crHistoryData = null; // { days: [{ date, items, total }, ...] }
let crHistDatesSeeded = false;

// Daily History always narrows to exactly one product, found via the
// search box below the date range — there's no "every product + Total"
// list the way the old default view worked. The roster backs that
// search box's custom suggestion dropdown and the exact-match check
// that gates "View History" — see crPopulateHistoryProductRoster() /
// crAttachSuggestions() / crResolveSelectedProduct().
let crProductRoster = []; // [productName, ...] from the last /byproduct fetch
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
// table_to_sheet() reads raw DOM text (product names among it) straight
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
        key === "_name" ? a.product : crGetByPath(a, key),
        key === "_name" ? b.product : crGetByPath(b, key),
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
        <th rowspan="2" class="cr-name-col${sortCls("_name")}" data-sort-key="_name" data-sort-type="text">${t("creditreport.compare.dimProduct")}</th>
        ${groupCells}
      </tr>
      <tr class="cr-sub-row">${subCells}</tr>`;
}

function crBuildRow(item, section, isTotal) {
    const cells = section.groups.map(g =>
        g.fields.map(f => crFmtField(item, f)).join("")
    ).join("");
    // Product name opens Product Performance for that product — same
    // pattern as RepDetailbyBranch.js's own cr-branch-link, including the
    // Total row (drills into the "All Product" aggregate).
    const productKey = isTotal ? "All Product" : item.product;
    const productLabel = isTotal ? t("common.total") : item.product;
    const nameCell = `<button type="button" class="cr-product-link" data-product="${crEscapeHtml(productKey)}">${crEscapeHtml(productLabel)}</button>`;
    // data-name backs crApplySearchFilter()'s client-side name search —
    // lowercased once here rather than re-lowercasing on every keystroke.
    const nameAttr = isTotal ? "" : ` data-name="${crEscapeHtml((item.product || "").toLowerCase())}"`;
    return `
      <tr${isTotal ? ' class="cr-total-row"' : ""}${nameAttr}>
        <td class="cr-name-col">${nameCell}</td>
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
// by class without a refetch — see lib/creditreport-product.js's own
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

function crActiveSection() {
    const sectionKey = document.getElementById("crSection").value;
    const section = crSections()[sectionKey];

    if (sectionKey === "nbcOverdue") {
        const nbcClass = document.getElementById("crNbcClass").value;
        const idx = CR_NBC_CLASS_INDEX[nbcClass];
        if (idx === undefined) return section;
        return { groups: [section.groups[idx]] };
    }

    // Current mode already narrows parT24 server-side (see
    // crBuildDateQuery's own t24Class) — the flat group already shows
    // the filtered figures, so no swap is needed there. Only History
    // mode (no refetch) needs to pick a different field source for the
    // same single group.
    if (sectionKey === "parT24" && crMode === "history") {
        const t24Class = document.getElementById("crClass").value;
        const bucketKey = CR_T24_CLASS_INDEX[t24Class];
        if (!bucketKey) return section;
        return { groups: [crT24ClassGroup(`parT24ByClass.${bucketKey}`, section.groups[0].label)] };
    }

    return section;
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
// HISTORY MODE — same section/field definitions as the live table
// (crActiveSection, crFmtField, crFieldClass all reused as-is), just
// with an extra Date column and one row per (product, date). Product
// names stay plain text here (no Product Performance drill-down link)
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
        <th rowspan="2" class="cr-name-col">Product</th>
        <th rowspan="2" class="cr-date-col">Date</th>
        ${groupCells}
      </tr>
      <tr class="cr-sub-row">${subCells}</tr>`;
}

// Balance Loan at Risk (T24) is never date-filtered (see
// computeProductRows in creditreport-product.js) — it always reflects
// whatever is live in the ArreasT24ByCO feed at snapshot time, which can
// carry its own "as of" moment (t24AsOfText) different from this row's
// own Date (the NBC OS Grid Merge date), same as Branch's own History —
// per explicit follow-up request 2026-10-02.
function crSectionHasT24(section) {
    return section.groups.some(g => g.key === "parT24");
}

function crBuildHistoryRow(dateKey, item, section, isTotal, t24AsOfText) {
    const cells = section.groups.map(g =>
        g.fields.map(f => crFmtField(item, f)).join("")
    ).join("");
    const nameLabel = isTotal ? t("common.total") : item.product;
    const t24Note = (crSectionHasT24(section) && t24AsOfText)
        ? `<div class="cr-t24-asof" title="${t("creditreport.detail.t24AsOfTooltip")}">T24: ${crEscapeHtml(t24AsOfText)}</div>`
        : "";
    // Admin-only — lets an admin remove a single day's saved snapshot
    // (e.g. one filed under an unexpected date — see crGridMergeDateKey's
    // own comment in the backend).
    const delBtn = crIsAdmin
        ? `<button type="button" class="cr-row-delete-btn" data-hist-del="${crEscapeHtml(dateKey)}" title="${t("creditreport.detail.deleteDaySnapshotTitle")}">🗑</button>`
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
        crShowEmpty(t("creditreport.detail.noHistorySaved"));
        return;
    }

    // Always exactly one product — matched via the search box above
    // (see crResolveSelectedProduct()) — in chronological date order, no
    // "every product" list and no Total row (there's only ever the one
    // product being plotted).
    const product = crResolveSelectedProduct();
    if (!product) {
        document.getElementById("crTbody").innerHTML = "";
        crShowEmpty(t("creditreport.byProduct.selectThenViewHistory", { viewHistory: t("creditreport.detail.viewHistory") }));
        return;
    }

    let rowsHtml = "";
    for (const day of crHistoryData.days) {
        const item = day.items.find(it => it.product === product);
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
        const url = `${API.BASE_URL}/api/creditreport/byproduct/history?dateFrom=${dateFrom}&dateTo=${dateTo}`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${crToken}` } });
        const data = await res.json();
        crHideLoading();

        if (!data.ok) {
            crShowEmpty(data.message || t("creditreport.detail.failedLoadHistory"));
            return;
        }
        crHistoryData = data;
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
    document.getElementById("crHistProductRow").style.display = mode === "history" ? "" : "none";
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
            crShowEmpty("Search and select a product, then click \"View History\".");
        }
    }
}

// ========================================
// DAILY HISTORY PRODUCT SEARCH — resolves the search box to exactly one
// product (unlike Officer's roster, products don't repeat under
// different branches, so the roster is just a plain name list, no
// "Name — Branch" disambiguation needed).
// ========================================
function crPopulateHistoryProductRoster(items) {
    crProductRoster = (items || []).map(it => it.product);
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
// against a roster product counts as a real, resolvable product, same
// "always resolve to exactly one entity" rule Branch's/Officer's own
// Daily History redesigns already established.
function crResolveSelectedProduct() {
    const typed = document.getElementById("crHistProductSearch").value.trim();
    if (!typed) return null;
    return crProductRoster.find(p => p === typed) || null;
}

// "View History" stays disabled until the typed text exactly matches one
// roster product — not just any non-empty text. Only gates the initial
// fetch; once crHistoryData is loaded, re-searching re-filters
// client-side without re-fetching.
function crUpdateHistRunButtonState() {
    const btn = document.getElementById("btnCrHistRun");
    if (!btn) return;
    // Visible only in Daily History mode — per explicit follow-up
    // request 2026-10-05 (moving it next to Chart, which is also
    // History-only, left it with no mode-based visibility of its own).
    btn.style.display = crMode === "history" ? "" : "none";
    btn.disabled = !crResolveSelectedProduct();
}

// ========================================
// PRODUCT SEARCH
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
function crShowLoading(message = t("creditreport.loadingReportData")) {
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
// URL STATE
// Mirrors section/dates into the address bar via history.replaceState
// (no new history entries) — same mechanism as RepDetailbyCO.js, minus
// the branch/team bits this page doesn't have.
// ========================================
function crReadStateFromUrl() {
    const p = new URLSearchParams(location.search);

    const section = p.get("section");
    if (section && crSections()[section]) {
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
        const res = await fetch(`${API.BASE_URL}/api/creditreport/byproduct${crBuildQuery()}`, {
            headers: { Authorization: `Bearer ${crToken}` }
        });
        const data = await res.json();
        crHideLoading();

        if (!data.ok) {
            crShowEmpty(data.message || t("creditreport.detail.failedLoadReport"));
            return;
        }

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
        document.getElementById("crProductCount").textContent =
            `${(data.items || []).length}`;

        if (!data.items || !data.items.length) {
            crShowEmpty(t("creditreport.byProduct.noProductsMatch"));
            return;
        }

        crData = data;
        crPopulateHistoryProductRoster(data.items);
        crSeedHistoryDates(data);
        document.getElementById("crSearchWrap").style.display = "flex";
        document.getElementById("crTableScroll").style.display = "block";
        crRenderSection();
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
// PRODUCT DRILL-DOWN
// Clicking a product name opens Product Performance for it — same
// pattern as RepDetailbyBranch.js's own branch-name drill-down: Product
// Performance always fetches its own summary (there's no already-fetched
// CO/FSRO/Digital breakdown to hand off — this report only ever has each
// product's combined Total), so only the product name + current date
// filters need to travel in the URL, no sessionStorage cache.
// ========================================
document.getElementById("crTbody").addEventListener("click", (e) => {
    const link = e.target.closest(".cr-product-link");
    if (!link) return;

    const q = new URLSearchParams({
        product: link.dataset.product,
        fromDate: crData?.fromDate || "",
        toDate: crData?.toDate || "",
        woFromDate: crData?.woFromDate || "",
        woToDate: crData?.woToDate || ""
    });
    location.href = `ProductPerformance.html?${q.toString()}`;
});

// ========================================
// MESSAGE HELPER
// ========================================
function notify(message, type = "info") {
    if (typeof showToast === "function") showToast(message, type);
    else alert(message);
}

// Export/print always cover every product, regardless of whatever the
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
        notify(t("creditreport.detail.excelLibFailed"), "error");
        return;
    }
    if (!document.getElementById("crTbody").children.length) {
        notify(t("creditreport.detail.nothingToExport"), "warning");
        return;
    }
    const ws = XLSX.utils.table_to_sheet(document.getElementById("crTable"));
    crSanitizeSheetFormulas(ws);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "ByProduct");
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "");
    XLSX.writeFile(wb, `MonitoringByProduct_${stamp}.xlsx`);
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
        notify(t("creditreport.detail.pdfLibFailed"), "error");
        return;
    }
    if (!document.getElementById("crTbody").children.length) {
        notify(t("creditreport.detail.nothingToExport"), "warning");
        return;
    }
    if (typeof showAppLoading === "function") showAppLoading(t("creditreport.detail.generatingPdf"));

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

        pdf.save(`MonitoringByProduct_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}.pdf`);
    } catch (err) {
        console.error("[export pdf] failed:", err);
        notify(t("creditreport.detail.pdfGenerateFailed"), "error");
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
// SNAPSHOT — admin only, per explicit request 2026-10-08. Same
// endpoint the Credit Report hub's own "Snapshot All" button already
// calls for Product; offered here too as a page-local shortcut.
// ========================================
if (crIsAdmin) {
    const snapBtn = document.getElementById("btnCrSnapshot");
    if (snapBtn) snapBtn.style.display = "";
}
async function crRunSnapshotNow() {
    if (typeof showAppLoading === "function") showAppLoading(t("creditreport.compare.savingSnapshot"));
    try {
        const res = await fetch(`${API.BASE_URL}/api/creditreport/byproduct/snapshot/run`, {
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
    crShowLoading(t("creditreport.detail.refreshingFromDb"));
    try {
        const res = await fetch(`${API.BASE_URL}/api/creditreport/byproduct/refresh`, {
            method: "POST",
            headers: { Authorization: `Bearer ${crToken}` }
        });
        const data = await res.json();
        if (!data.ok) {
            crHideLoading();
            crShowEmpty(data.message || t("creditreport.detail.refreshFailed"));
            return;
        }
        crData = null;
        await crRunReport();
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
    if (el) el.textContent = t("creditreport.detail.rowsCount", { count: count.toLocaleString() });
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
document.getElementById("crHistProductSearch").addEventListener("input", (e) => {
    document.getElementById("crHistProductClear").hidden = !e.target.value;
    crUpdateHistRunButtonState();
    crUpdateChartButtonVisibility();
    if (crHistoryData) crRenderHistory();
});
document.getElementById("crHistProductSearch").addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    e.target.value = "";
    e.target.dispatchEvent(new Event("input", { bubbles: true }));
    e.target.blur();
});
document.getElementById("crHistProductClear").addEventListener("click", () => {
    const input = document.getElementById("crHistProductSearch");
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.focus();
});
crAttachSuggestions(
    document.getElementById("crHistProductSearch"),
    document.querySelector("#crHistProductRow .cr-hist-search-wrap"),
    () => crProductRoster
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
            const res = await fetch(`${API.BASE_URL}/api/creditreport/byproduct/snapshot/delete`, {
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
}

// ========================================
// DAILY HISTORY CHART — a line chart of the one matched product (see
// crResolveSelectedProduct()), over the fetched date range, for
// whichever fields the active "Showing" section carries. Reuses Chart.js
// the same way RepDetailbyCO.js's own Daily History chart does (same
// CDN build, same instance-reuse pattern, same --cr-series-N palette).
// ========================================
let crChartInstance = null;
let crChartMetricLabel = null; // persists across re-opens until a Showing/metric change resets it

// Visible only once BOTH boxes are set — a real product matched AND a
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
    const sectionFilter = document.getElementById("crSection").value;
    const nbcClassAll = sectionFilter === "nbcOverdue" && !document.getElementById("crNbcClass").value;
    btn.style.display = (crMode === "history" && crResolveSelectedProduct() && sectionFilter !== "all" && !nbcClassAll) ? "" : "none";
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
    const product = crResolveSelectedProduct();
    if (!product) return;
    const metricOptions = crChartMetricOptions(section);
    if (!metricOptions.length) return;
    if (!metricOptions.some(f => f.label === crChartMetricLabel)) {
        // Prefer the first money field (the usual headline figure) when
        // (re)picking a default — e.g. switching "Showing" resets it.
        crChartMetricLabel = (metricOptions.find(f => f.money) || metricOptions[0]).label;
    }
    crRenderChartMetricTabs(section, metricOptions);

    const days = crHistoryData.days;
    // Balance Loan at Risk (T24) is never date-filtered — it always
    // reflects whichever ArreasT24ByCO data was live at snapshot time,
    // which can carry its own "as of" moment different from each row's
    // own Date (same reason crBuildHistoryRow shows a separate "T24: ..."
    // note under Date for this section). The chart's own X axis follows
    // that same T24 "as of" moment instead of the row Date whenever
    // Showing is T24, per explicit request 2026-10-05.
    const labels = days.map(d => crSectionHasT24(section) && d.t24AsOfText ? d.t24AsOfText : crFmtDateDMY(d.date));
    const colors = crChartSeriesColors();
    const activeField = metricOptions.find(f => f.label === crChartMetricLabel);

    const datasets = [];
    section.groups.forEach((g, idx) => {
        const field = g.fields.find(f => f.label === crChartMetricLabel);
        if (!field) return;
        const data = days.map(day => {
            const item = day.items.find(it => it.product === product);
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
        `${product} — ${section.groups.length === 1 ? section.groups[0].label : t("creditreport.detail.showing")}`;

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
    if (!crResolveSelectedProduct()) return;
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
crReadStateFromUrl();
crUpdateClassVisibility();
crRunReport();
