// ========================================
// Daily Monitoring by Officer — "RepDetail byCO" web port
// Reads GET /api/creditreport/byco (see lib/creditreport-co.js for the
// column mapping behind each figure).
//
// One row per credit officer. Team / ID / Branch are used for filtering
// and sorting but deliberately NOT rendered — only the officer's name
// leads each row, matching the Excel sheet's hidden columns.
// ========================================

const t = (key, vars) => window.CMI18n ? CMI18n.t(key, vars) : key;

const crToken =
    localStorage.getItem("token") ||
    sessionStorage.getItem("token");

const CR_PAR_ALERT = 0.04; // PAR % at or above this renders red

let crData = null; // last successful /byco response
// Plan vs Actual (/api/creditreport/officer-plan-vs-actual), fetched the
// first time Comparison Mode needs it after a report load.
let crPlanData = null;
let crPlanLoading = null;

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
let crHistoryData = null; // { days: [{ date, items, total, combined? }, ...] }
// The officers kept in Daily History's search box (chips) — see
// crChipPicker() in cr-multi.js and the wiring further down.
let crHistOfficerPicker = null;
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
// "_Area"/"_Own" suffixed group labels compose the base section/class
// name with the Area/Own word, rather than needing a dedicated dict
// entry for every base label x suffix combination.
function crAreaLabel(baseKey) { return `${t(baseKey)}_${t("creditreport.detail.area")}`; }
function crOwnLabel(baseKey) { return `${t(baseKey)}_${t("creditreport.detail.own")}`; }

// Built by a function (not a frozen module-level const) so every label
// picks up the current language when a report is (re)rendered, rather
// than being baked in once at page-load time.
function crSections() {
    const S = {
        outstandingArea: {
            groups: [{
                label: crAreaLabel("creditreport.detail.sectionOutstanding"),
                fields: [
                    { key: "loanOutstandingArea.loan", label: t("creditreport.detail.colLoanHash") },
                    { key: "loanOutstandingArea.client", label: t("creditreport.detail.colClient") },
                    { key: "loanOutstandingArea.value", label: t("creditreport.detail.colValue"), money: true }
                ]
            }]
        },
        outstanding: {
            groups: [{
                label: crOwnLabel("creditreport.detail.sectionOutstanding"),
                fields: [
                    { key: "loanOutstanding.loan", label: t("creditreport.detail.colLoanHash") },
                    { key: "loanOutstanding.client", label: t("creditreport.detail.colClient") },
                    { key: "loanOutstanding.value", label: t("creditreport.detail.colValue"), money: true }
                ]
            }]
        },
        disburseArea: {
            groups: [{
                label: crAreaLabel("creditreport.detail.sectionDisburse"),
                fields: [
                    { key: "loanDisburseArea.loan", label: t("creditreport.detail.colLoanHash") },
                    { key: "loanDisburseArea.value", label: t("creditreport.detail.colValue"), money: true }
                ]
            }]
        },
        disburse: {
            groups: [{
                label: crOwnLabel("creditreport.detail.sectionDisburse"),
                fields: [
                    { key: "loanDisburse.loan", label: t("creditreport.detail.colLoanHash") },
                    { key: "loanDisburse.value", label: t("creditreport.detail.colValue"), money: true }
                ]
            }]
        },
        // KHR loans / loans ≤ $50,000 ($ outstanding), Area / Own.
        khrArea: {
            groups: [{
                label: crAreaLabel("creditreport.detail.sectionKhr"),
                fields: [
                    { key: "osMixArea.khr", label: t("creditreport.detail.colValue"), money: true, optional: true }
                ]
            }]
        },
        khr: {
            groups: [{
                label: crOwnLabel("creditreport.detail.sectionKhr"),
                fields: [
                    { key: "osMix.khr", label: t("creditreport.detail.colValue"), money: true, optional: true }
                ]
            }]
        },
        smallArea: {
            groups: [{
                label: crAreaLabel("creditreport.detail.sectionSmall"),
                fields: [
                    { key: "osMixArea.small", label: t("creditreport.detail.colValue"), money: true, optional: true }
                ]
            }]
        },
        small: {
            groups: [{
                label: crOwnLabel("creditreport.detail.sectionSmall"),
                fields: [
                    { key: "osMix.small", label: t("creditreport.detail.colValue"), money: true, optional: true }
                ]
            }]
        },
        losArea: {
            groups: [{
                label: crAreaLabel("creditreport.detail.sectionLos"),
                fields: [
                    { key: "loanLosArea.loan", label: t("creditreport.detail.colLoanHash") }
                ]
            }]
        },
        los: {
            groups: [{
                label: crOwnLabel("creditreport.detail.sectionLos"),
                fields: [
                    { key: "loanLos.loan", label: t("creditreport.detail.colLoanHash") }
                ]
            }]
        },
        parT24Area: {
            groups: [{
                key: "parT24",
                label: crAreaLabel("creditreport.detail.sectionT24"),
                fields: [
                    { key: "parT24Area.loan", label: t("creditreport.detail.colLoanHash") },
                    { key: "parT24Area.value", label: t("creditreport.detail.colValue"), money: true },
                    { key: "parT24Area.parPct", label: t("creditreport.detail.colParPct"), pct: true }
                ]
            }]
        },
        parT24: {
            groups: [{
                key: "parT24",
                label: crOwnLabel("creditreport.detail.sectionT24"),
                fields: [
                    { key: "parT24.loan", label: t("creditreport.detail.colLoanHash") },
                    { key: "parT24.value", label: t("creditreport.detail.colValue"), money: true },
                    { key: "parT24.parPct", label: t("creditreport.detail.colParPct"), pct: true }
                ]
            }]
        },
        nbcOverdueArea: {
            groups: [
                crGroupPct("nbcOverdueArea.minor", "creditreport.detail.classMinorDefault"),
                crGroupPct("nbcOverdueArea.specialMention", "creditreport.detail.classSpecialMention"),
                crGroupPct("nbcOverdueArea.subStandard", "creditreport.detail.classSubStandardHyphen"),
                crGroupPct("nbcOverdueArea.doubtful", "creditreport.detail.classDoubtful"),
                crGroupPct("nbcOverdueArea.loss", "creditreport.detail.classLoss"),
                crGroupPct("nbcOverdueArea.majorDefault", "creditreport.detail.classMajorDefault"),
                crGroupPct("nbcOverdueArea.nonPerformingLoan", "creditreport.detail.classNonPerformingLoan"),
                { label: crAreaLabel("creditreport.detail.classTotalNbcOverdue"), fields: [
                    { key: "nbcOverdueArea.total.count", label: t("creditreport.detail.colLoanHash") },
                    { key: "nbcOverdueArea.total.value", label: t("creditreport.detail.colValue"), money: true },
                    { key: "nbcOverdueArea.total.parPct", label: t("creditreport.detail.colParPct"), pct: true }
                ] }
            ]
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
                { label: crOwnLabel("creditreport.detail.classTotalNbcOverdue"), fields: [
                    { key: "nbcOverdue.totalOwn.count", label: t("creditreport.detail.colLoanHash") },
                    { key: "nbcOverdue.totalOwn.value", label: t("creditreport.detail.colValue"), money: true },
                    { key: "nbcOverdue.totalOwn.parPct", label: t("creditreport.detail.colParPct"), pct: true }
                ] }
            ]
        },
        writeOffArea: {
            groups: [
                {
                    label: crAreaLabel("creditreport.detail.woBalanceWO"),
                    fields: [
                        { key: "writeOffArea.balanceWO.count", label: "#" },
                        { key: "writeOffArea.balanceWO.int", label: t("creditreport.detail.colInt"), money: true },
                        { key: "writeOffArea.balanceWO.prn", label: t("creditreport.detail.colPrn"), money: true }
                    ]
                },
                {
                    label: crAreaLabel("creditreport.detail.woWO"),
                    fields: [
                        { key: "writeOffArea.wo.count", label: "#" },
                        { key: "writeOffArea.wo.prn", label: t("creditreport.detail.colPrn"), money: true }
                    ]
                },
                {
                    label: crAreaLabel("creditreport.detail.woCollected"),
                    fields: [
                        { key: "writeOffArea.woCollected.int", label: t("creditreport.detail.colInt"), money: true },
                        { key: "writeOffArea.woCollected.prn", label: t("creditreport.detail.colPrn"), money: true }
                    ]
                }
            ]
        },
        writeOff: {
            groups: [
                {
                    label: crOwnLabel("creditreport.detail.woBalanceWO"),
                    fields: [
                        { key: "writeOffOwn.balanceWO.count", label: "#" },
                        { key: "writeOffOwn.balanceWO.int", label: t("creditreport.detail.colInt"), money: true },
                        { key: "writeOffOwn.balanceWO.prn", label: t("creditreport.detail.colPrn"), money: true }
                    ]
                },
                {
                    label: crOwnLabel("creditreport.detail.woWO"),
                    fields: [
                        { key: "writeOffOwn.wo.count", label: "#" },
                        { key: "writeOffOwn.wo.prn", label: t("creditreport.detail.colPrn"), money: true }
                    ]
                },
                {
                    label: crOwnLabel("creditreport.detail.woCollected"),
                    fields: [
                        { key: "writeOffOwn.woCollected.int", label: t("creditreport.detail.colInt"), money: true },
                        { key: "writeOffOwn.woCollected.prn", label: t("creditreport.detail.colPrn"), money: true }
                    ]
                }
            ]
        }
    };
    S.all = {
        groups: [
            ...S.outstandingArea.groups,
            ...S.outstanding.groups,
            ...S.disburseArea.groups,
            ...S.disburse.groups,
            ...S.khrArea.groups,
            ...S.khr.groups,
            ...S.smallArea.groups,
            ...S.small.groups,
            ...S.losArea.groups,
            ...S.los.groups,
            ...S.parT24Area.groups,
            ...S.parT24.groups,
            ...S.nbcOverdueArea.groups,
            ...S.nbcOverdue.groups,
            ...S.writeOffArea.groups,
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
function crFmtField(item, field) {
    if (field.pv) return crFmtPlanField(item, field);
    const v = crGetByPath(item, field.key);
    const cls = crFieldClass(field);
    if (field.pct) {
        const n = Number(v) || 0;
        const alert = n >= CR_PAR_ALERT ? " cr-par-high" : "";
        return `<td class="${cls}${alert}">${crFmtPct(n)}</td>`;
    }
    // optional: a figure older snapshots don't have — "—", not 0.
    if (field.optional && (v === undefined || v === null)) return `<td class="${cls}">—</td>`;
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
        g.fields.map(f => `<th class="${crFieldClass(f)}${f.planCol ? " cr-plan-col" : ""}${sortCls(f.key)}" data-sort-key="${f.key}" data-sort-type="number">${f.label}</th>`).join("")
    ).join("");

    return `
      <tr class="cr-group-row">
        <th rowspan="2" class="cr-name-col${sortCls("_name")}" data-sort-key="_name" data-sort-type="text">${t("creditreport.compare.colName")}</th>
        ${groupCells}
      </tr>
      <tr class="cr-sub-row">${subCells}</tr>`;
}

function crBuildRow(item, section, isTotal, idx) {
    const cells = section.groups.map(g =>
        g.fields.map(f => crFmtField(item, f)).join("")
    ).join("");
    const nameCell = isTotal
        ? t("common.total")
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

// ========================================
// COMPARISON MODE — Actual Only (the report as it was) or Plan vs
// Actual: each officer's Own figures (OS!AA = the officer's ID) next to
// their officer plan of the month, from
// /api/creditreport/officer-plan-vs-actual (item.planVs) — the month to
// date (1st of the month to the OS date), without the class / product
// filters, with the report's branch / officer-type filters. Area
// sections have no plan and are left out. Same columns and colours as
// the Daily Report by Branch. Current mode only; never part of the
// daily snapshot.
// ========================================
function crCompareMode() {
    if (crMode !== "current") return "actual";
    return document.getElementById("crCompare")?.value === "plan" ? "plan" : "actual";
}

// Plan columns of one metric: plan, then % (or ± for a
// ceiling). withActual adds the actual first (from planVs).
function crPlanFields(metric, { money = false, ceiling = false, withActual = false, actualLabel, planLabel } = {}) {
    const base = `planVs.${metric}`;
    const kind = ceiling ? "pct" : money ? "money" : "num";
    const f = [];
    if (withActual) f.push({ key: `${base}.actual`, label: actualLabel || t("creditreport.plan.actual"), pv: kind });
    f.push({ key: `${base}.plan`, label: planLabel || t(ceiling ? "creditreport.plan.planMax" : "creditreport.plan.plan"), pv: kind, planCol: true });
    f.push(ceiling
        ? { key: base, label: "±", pv: "diff", planCol: true }
        : { key: `${base}.ach`, label: "%", pv: "ach", planCol: true });
    return f;
}

function crWithPlanAfter(field, metric, opts) {
    return [field, ...crPlanFields(metric, opts)];
}

// Own sections with a plan, in table order (All Sections in Plan vs Actual).
const CR_PLAN_SECTIONS = ["outstanding", "khr", "small", "disburse", "los", "nbcOverdue", "writeOff"];

// One section's groups in Plan vs Actual: only the planned Own figures,
// each followed by its plan columns.
function crCompareSection(section) {
    const groups = [];
    for (const g of section.groups) {
        const first = (g.fields[0] || {}).key || "";
        if (first.startsWith("loanOutstanding.")) {
            const plan = { "loanOutstanding.loan": ["osCount"], "loanOutstanding.client": ["osClients"], "loanOutstanding.value": ["osAmount", { money: true }] };
            groups.push({ ...g, fields: g.fields.flatMap(f => plan[f.key] ? crWithPlanAfter(f, ...plan[f.key]) : []) });
        } else if (first === "osMix.khr" || first === "osMix.small") {
            groups.push({ ...g, fields: crWithPlanAfter(g.fields[0], first === "osMix.khr" ? "osKhr" : "osSmall", { money: true }) });
        } else if (first.startsWith("loanDisburse.")) {
            groups.push({
                ...g,
                fields: g.fields.flatMap(f =>
                    f.key === "loanDisburse.loan" ? crWithPlanAfter(f, "disbCount")
                        : f.key === "loanDisburse.value" ? crWithPlanAfter(f, "disbAmount", { money: true })
                            : [])
            });
        } else if (first.startsWith("loanLos.")) {
            // LOS is a yearly plan: the year to date's # loans vs that plan.
            groups.push({ ...g, fields: crPlanFields("losCount", { withActual: true, actualLabel: t("creditreport.plan.thisYear"), planLabel: t("creditreport.plan.yearPlan") }) });
        } else if (first.startsWith("nbcOverdue.totalOwn.") || first.startsWith("nbcOverdue.nonPerformingLoan.")) {
            const metric = first.startsWith("nbcOverdue.totalOwn.") ? "nbcOverduePct" : "nplPct";
            groups.push({ ...g, fields: crPlanFields(metric, { ceiling: true, withActual: true, actualLabel: t("creditreport.detail.colParPct") }) });
        } else if (first.startsWith("writeOffOwn.woCollected.")) {
            groups.push({ ...g, fields: crPlanFields("woCollected", { money: true, withActual: true, actualLabel: t("creditreport.plan.thisMonth") }) });
        }
    }
    return { groups };
}

// One Plan vs Actual cell; "—" where there is no plan / no actual.
function crFmtPlanField(item, field) {
    const v = crGetByPath(item, field.key);
    const dash = cls => `<td class="${cls} cr-pv-none">—</td>`;
    if (field.pv === "ach") {
        if (v === null || v === undefined) return dash("cr-col-pct cr-plan-col");
        const cls = v >= 1 ? "cr-pv-good" : v >= 0.8 ? "cr-pv-warn" : "cr-pv-bad";
        return `<td class="cr-col-pct cr-plan-col ${cls}">${Math.round(v * 100)}%</td>`;
    }
    if (field.pv === "diff") {
        if (!v || v.plan === null || v.plan === undefined || v.actual === null || v.actual === undefined) return dash("cr-col-pct cr-plan-col");
        const d = Math.round((v.actual - v.plan) * 100) / 100;
        return `<td class="cr-col-pct cr-plan-col ${d <= 0 ? "cr-pv-good" : "cr-pv-bad"}">${d > 0 ? "+" : ""}${d.toFixed(2)}</td>`;
    }
    const cls = (field.pv === "pct" ? "cr-col-pct" : field.pv === "money" ? "cr-col-money" : "cr-col-num") + (field.planCol ? " cr-plan-col" : "");
    if (v === null || v === undefined) return dash(cls);
    return `<td class="${cls}">${field.pv === "pct" ? Number(v).toFixed(2) + "%" : crFmtNum(v)}</td>`;
}

// Officer IDs in the plan carry no leading zeros.
function crPlanKey(id) {
    return String(id ?? "").trim().replace(/^0+(?=.)/, "");
}

// Fetch Plan vs Actual (once per report load, same branch / type
// filters) and hang each officer's metrics on its row as item.planVs.
async function crEnsurePlan() {
    if (!crData || crCompareMode() === "actual") return crRenderPlanNote();
    if (crPlanData) return crRenderPlanNote();
    if (!crPlanLoading) {
        const q = new URLSearchParams();
        crAddPicks(q, "branch", "crBranch");
        crAddPicks(q, "team", "crTeam");
        crPlanLoading = (async () => {
            const res = await fetch(`${API.BASE_URL}/api/creditreport/officer-plan-vs-actual?${q.toString()}`, { headers: { Authorization: `Bearer ${crToken}` } });
            const data = await res.json();
            if (!res.ok || !data.ok) throw new Error(data.message || `HTTP ${res.status}`);
            return data;
        })();
    }
    try {
        const data = await crPlanLoading;
        crPlanData = data;
        const byId = new Map((data.rows || []).map(r => [r.branch, r.metrics]));
        crData.items.forEach(it => { it.planVs = byId.get(crPlanKey(it.id)) || null; });
        if (crData.total) crData.total.planVs = data.total ? data.total.metrics : null;
        crRenderSection();
    } catch (e) {
        console.error("officer plan vs actual failed:", e);
        notify(t("creditreport.plan.loadFailed"), "error");
    } finally {
        crPlanLoading = null;
        crRenderPlanNote();
    }
}

function crRenderPlanNote() {
    const el = document.getElementById("crPlanNote");
    if (!el) return;
    const show = crCompareMode() !== "actual";
    el.style.display = show ? "" : "none";
    if (!show) return;
    if (!crPlanData) {
        el.innerHTML = `<span>${crEscapeHtml(t("creditreport.plan.loading"))}</span>`;
        return;
    }
    const [y, m] = crPlanData.month.split("-");
    const lines = [
        t("creditreport.plan.noteMonth", {
            month: `${m}-${y}`,
            from: crFmtDateDMY(crPlanData.fromDate),
            to: crFmtDateDMY(crPlanData.toDate),
            done: crPlanData.daysDone,
            days: crPlanData.daysInMonth
        }),
        t("creditreport.plan.noteOwn"),
        t("creditreport.plan.noteLos", { from: crFmtDateDMY(crPlanData.ytdFrom), to: crFmtDateDMY(crPlanData.toDate) }),
        t("creditreport.plan.noteRules")
    ];
    if (crPicks("crNbcProduct").length || crPicks("crClass").length || crPicks("crProduct").length) lines.push(t("creditreport.plan.noteFilters"));
    let html = lines.map(l => `<span>${crEscapeHtml(l)}</span>`).join("");
    if (!crPlanData.hasPlan) {
        html += `<span class="cr-plan-missing">${crEscapeHtml(t("creditreport.plan.noPlan"))}${crIsAdmin ? ` <a href="/CM_Pro/pages/masterdata/plan.html">${crEscapeHtml(t("creditreport.plan.setPlan"))} ›</a>` : ""}</span>`;
    }
    el.innerHTML = html;
}

// Several sections picked: each one's groups side by side (crCombinedSection).
function crActiveSection() {
    if (crCompareMode() === "actual") return crCombinedSection(crSectionFor);
    return crCombinedSection(k => k === "all"
        ? { groups: CR_PLAN_SECTIONS.flatMap(sk => crCompareSection(crSections()[sk]).groups) }
        : crCompareSection(crSectionFor(k)));
}

function crSectionFor(sectionKey) {
    const section = crSections()[sectionKey];

    // Several classes picked: one group each, in the order listed.
    if (sectionKey === "nbcOverdue" || sectionKey === "nbcOverdueArea") {
        const idxs = crPicks("crNbcClass").map(v => CR_NBC_CLASS_INDEX[v]).filter(i => i !== undefined);
        if (!idxs.length) return section;
        return { groups: idxs.sort((a, b) => a - b).map(i => section.groups[i]) };
    }

    // Current mode already narrows parT24/parT24Area server-side (see
    // crBuildQuery's own t24Class) — the flat group already shows the
    // filtered figures, so no swap is needed there. Only History mode
    // (no refetch) needs to pick a different field source for the same
    // single group.
    if ((sectionKey === "parT24" || sectionKey === "parT24Area") && crMode === "history") {
        const picks = crPicks("crClass").filter(v => CR_T24_CLASS_INDEX[v]);
        if (!picks.length) return section;
        const prefix = sectionKey === "parT24" ? "parT24ByClass" : "parT24AreaByClass";
        const label = section.groups[0].label;
        const optText = v => [...document.getElementById("crClass").options].find(o => o.value === v)?.textContent.trim() || v;
        return {
            groups: picks.map(v => crT24ClassGroup(`${prefix}.${CR_T24_CLASS_INDEX[v]}`,
                picks.length > 1 ? `${label} — ${optText(v)}` : label))
        };
    }

    return section;
}

function crRenderSection() {
    if (!crData) return;
    const section = crActiveSection();

    // Plan vs Actual with only sections that have no plan (Area, T24).
    if (!section.groups.length) {
        document.getElementById("crThead").innerHTML = "";
        document.getElementById("crTbody").innerHTML =
            `<tr><td class="cr-plan-empty">${crEscapeHtml(t("creditreport.plan.noPlannedSectionOfficer"))}</td></tr>`;
        return;
    }

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
    return section.groups.some(g => g.key === "parT24");
}

function crBuildHistoryRow(dateKey, item, section, isTotal, t24AsOfText) {
    const cells = section.groups.map(g =>
        g.fields.map(f => crFmtField(item, f)).join("")
    ).join("");
    const nameLabel = isTotal ? t("common.total") : item.name;
    const t24Note = (crSectionHasT24(section) && t24AsOfText)
        ? `<div class="cr-t24-asof" title="${t("creditreport.detail.t24AsOfTooltip")}">T24: ${crEscapeHtml(t24AsOfText)}</div>`
        : "";
    // Admin-only — lets an admin remove a single day's saved snapshot
    // (e.g. one filed under an unexpected date — see crGridMergeDateKey's
    // own comment in the backend).
    const delBtn = crIsAdmin
        ? `<button type="button" class="cr-row-delete-btn" data-hist-del="${crEscapeHtml(dateKey)}" title="${t("creditreport.detail.deleteDaySnapshotTitle")}"><span class="cr-ico cr-ico-trash" aria-hidden="true"></span></button>`
        : "";
    // Admin-only — re-pulls currently-live T24 into this date's saved
    // snapshot (T24 is otherwise frozen once a date is first saved).
    // Harmless no-op on today's own row — shown uniformly on every row.
    const refreshBtn = crIsAdmin
        ? `<button type="button" class="cr-row-refresh-btn" data-hist-refresh="${crEscapeHtml(dateKey)}" title="${t("creditreport.detail.refreshT24Title")}"><span class="cr-ico cr-ico-refresh" aria-hidden="true"></span></button>`
        : "";
    return `
      <tr${isTotal ? ' class="cr-total-row"' : ""}>
        <td class="cr-name-col">${crEscapeHtml(nameLabel)}</td>
        <td class="cr-date-col"><div class="cr-date-main">${crFmtDateDMY(dateKey)}${refreshBtn}${delBtn}</div>${t24Note}</td>
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

    // One row per date, in order, for the officers kept in the search box
    // (crHistItemForDay(): that officer's own row, or several kept — their
    // combined row). Nothing kept: nothing to show.
    const officer = crResolveSelectedOfficer();
    if (!officer) {
        document.getElementById("crTbody").innerHTML = "";
        crShowEmpty(t("creditreport.byCO.selectThenViewHistory", { viewHistory: t("creditreport.detail.viewHistory") }));
        return;
    }

    let rowsHtml = "";
    for (const day of crHistoryData.days) {
        const item = crHistItemForDay(day);
        if (item) rowsHtml += crBuildHistoryRow(day.date, item, section, false, day.t24AsOfText);
    }

    document.getElementById("crTbody").innerHTML = rowsHtml;
    document.getElementById("crTableScroll").style.display = "block";
    document.getElementById("crEmptyMsg").style.display = "none";
    requestAnimationFrame(crSetHeaderOffsets);
}

function crHistOfficerKey(officer) {
    return `${officer.name ?? ""}\u0000${officer.branch ?? ""}`;
}

// The kept officers; one day's row for them: that officer's own, or —
// several kept — the server's combined row (added up, PAR % recomputed).
function crHistOfficers() {
    return crHistOfficerPicker ? crHistOfficerPicker.list() : [];
}
function crHistItemForDay(day) {
    const picks = crHistOfficers();
    if (picks.length > 1) return day.combined || null;
    const o = picks[0];
    return o ? day.items.find(it => it.name === o.name && it.branch === o.branch) : null;
}

async function crFetchHistory() {
    const dateFrom = document.getElementById("crHistFromDate").value;
    const dateTo = document.getElementById("crHistToDate").value;
    if (!dateFrom || !dateTo) return;

    // Ask only for the kept officers — the full all-officer snapshot for
    // a 2-week range is large enough to time out on the backend's
    // throttled database link. A different set afterwards re-fetches
    // (see crHistOfficerPicker).
    // Several officers: one officerName/officerBranch pair each.
    const officers = crHistOfficers();
    const params = new URLSearchParams({ dateFrom, dateTo });
    officers.forEach(o => {
        params.append("officerName", o.name ?? "");
        params.append("officerBranch", o.branch ?? "");
    });

    crShowLoading();
    try {
        const url = `${API.BASE_URL}/api/creditreport/byco/history?${params.toString()}`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${crToken}` } });
        const data = await res.json();
        crHideLoading();

        if (!data.ok) {
            crShowEmpty(data.message || t("creditreport.detail.failedLoadHistory"));
            return;
        }
        crHistoryData = data;
        crHistoryData.officerKey = officers.length ? crHistOfficerPicker.key() : null;
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
    document.getElementById("crHistOfficerRow").style.display = mode === "history" ? "" : "none";
    document.getElementById("crSearchWrap").style.display = mode === "current" && crData ? "flex" : "none";
    // Comparison Mode is for the current report only.
    document.getElementById("crCompareRow").style.display = mode === "history" ? "none" : "";
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
            crShowEmpty(t("creditreport.byCO.selectThenViewHistory", { viewHistory: t("creditreport.detail.viewHistory") }));
        }
    }
    crRenderPlanNote();
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

    // The officer's own branch, and the team when exactly one is picked
    // (Officer Productivity takes one of each).
    const teams = crPicks("crTeam");
    const meta = {
        branch: item.branch || "All Branch",
        team: teams.length === 1 ? teams[0] : "All Team",
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
    if (!crRefreshing && typeof showAppLoading === "function") showAppLoading(message, { progress: true, key: `crByCO:${key}` });
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
}

// ========================================
// LOAD
// ========================================
// The report's own date range is no longer user-settable (the "Set
// Report Date" picker was removed 2026-10-02 per explicit request), so
// no date params are ever sent; the server always uses its own
// data-derived default.
// Each filter sends one param per picked value (?branch=A&branch=B);
// none picked = not sent = All.
function crBuildQuery() {
    const p = new URLSearchParams();

    if (crPendingBranches) crPendingBranches.forEach(b => p.append("branch", b));
    else crAddPicks(p, "branch", "crBranch");
    crAddPicks(p, "team", "crTeam");

    // "total" (Total T24 Overdue) is the class filter's All — never sent.
    crAddPicks(p, "t24Class", "crClass");
    crAddPicks(p, "t24Product", "crProduct");

    // crNbcClass is NOT sent — every classification is already in the
    // response (see crActiveSection() above), so it's a display-only pick.
    crAddPicks(p, "nbcProduct", "crNbcProduct");
    const q = p.toString();
    return q ? `?${q}` : "";
}

// The T24 Loan Class/Product Type filters only mean something for the
// Balance Loan at Risk (T24) sections, and the NBC Overdue Loan
// Class/Product Type filters only for the NBC Overdue sections — hide
// each pair otherwise so they can't be mistaken for applying to a
// section they don't affect.
function crUpdateClassVisibility() {
    const isT24 = crHasSection("parT24", "parT24Area");
    const isNbc = crHasSection("nbcOverdue", "nbcOverdueArea");
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
// Branches restored from the URL, held here until the real <option> list
// exists (crBranch starts with only "All Branch" — the rest are appended
// after the first fetch) — see crReadStateFromUrl()/crPopulateBranches().
let crPendingBranches = null;
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

    if (crPendingBranches) {
        crRestorePicks("crBranch", crPendingBranches);
        crPendingBranches = null;
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
// The first kept officer (chips under the search box), or null.
function crResolveSelectedOfficer() {
    return crHistOfficers()[0] || null;
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

    crRestoreSections(p, crSections());

    crRestorePicks("crTeam", p.getAll("team"));

    // crBranch's real options don't exist yet (only "All Branch" until
    // the first fetch populates them) — hold the values for
    // crPopulateBranches() to apply, and let crBuildQuery() use them
    // directly so the very first request is already filtered correctly.
    const branches = p.getAll("branch").filter(b => b && b !== "All Branch");
    if (branches.length) crPendingBranches = branches;

    crRestorePicks("crClass", p.getAll("t24Class"));
    crRestorePicks("crProduct", p.getAll("t24Product"));
    crRestorePicks("crNbcClass", p.getAll("nbcClass"));
    crRestorePicks("crNbcProduct", p.getAll("nbcProduct"));

    if (p.get("compare") === "plan") document.getElementById("crCompare").value = "plan";
}

function crSyncStateToUrl() {
    const p = new URLSearchParams();
    crAddSections(p);
    if (crPendingBranches) crPendingBranches.forEach(b => p.append("branch", b));
    else crAddPicks(p, "branch", "crBranch");
    crAddPicks(p, "team", "crTeam");
    crAddPicks(p, "t24Class", "crClass");
    crAddPicks(p, "t24Product", "crProduct");
    crAddPicks(p, "nbcClass", "crNbcClass");
    crAddPicks(p, "nbcProduct", "crNbcProduct");
    if (document.getElementById("crCompare").value !== "actual") p.set("compare", document.getElementById("crCompare").value);

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
    // Branch / type changed: the plan rows are fetched again.
    crPlanData = null;
    try {
        const res = await fetch(`${API.BASE_URL}/api/creditreport/byco${crBuildQuery()}`, {
            headers: { Authorization: `Bearer ${crToken}` }
        });
        const data = await res.json();
        crHideLoading();

        if (!data.ok) {
            crShowEmpty(data.message || t("creditreport.detail.failedLoadReport"));
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
            t("creditreport.detail.dateRange", { from: crFmtDateDMY(data.fromDate), to: crFmtDateDMY(data.toDate) });
        document.getElementById("crWoPeriod").textContent =
            t("creditreport.detail.dateRange", { from: crFmtDateDMY(data.woFromDate), to: crFmtDateDMY(data.woToDate) });
        document.getElementById("crOfficerCount").textContent =
            `${(data.items || []).length}`;

        if (!data.items || !data.items.length) {
            crShowEmpty(t("creditreport.byCO.noOfficersMatch"));
            return;
        }

        crData = data;
        crPopulateHistoryOfficerRoster(data.items);
        crSeedHistoryDates(data);
        document.getElementById("crSearchWrap").style.display = "flex";
        document.getElementById("crTableScroll").style.display = "block";
        crRenderSection();
        crEnsurePlan();
    } catch (e) {
        console.error(e);
        crHideLoading();
        crShowEmpty(t("creditreport.detail.networkErrorReport"));
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
document.getElementById("crCompare").addEventListener("change", () => {
    crEnsurePlan();
    crRenderSection();
    crSyncStateToUrl();
});
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
// EXPORT EXCEL / PDF, PRINT, FULLSCREEN — the report on screen, same
// engine and look as Daily Arrears (cr-export.js, arrears-export.js).
// ========================================
CRExport.wire({ name: "MonitoringByOfficer", beforeExport: crClearSearchForExport });

// ========================================
// SNAPSHOT — admin only, per explicit request 2026-10-08. Same
// endpoint the Credit Report hub's own "Snapshot All" button already
// calls for Officer; offered here too as a page-local shortcut.
// ========================================
if (crIsAdmin) {
    const snapBtn = document.getElementById("btnCrSnapshot");
    if (snapBtn) snapBtn.style.display = "";
}
async function crRunSnapshotNow() {
    if (typeof showAppLoading === "function") showAppLoading(t("creditreport.compare.savingSnapshot"));
    try {
        const res = await fetch(`${API.BASE_URL}/api/creditreport/byco/snapshot/run`, {
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
        const res = await fetch(`${API.BASE_URL}/api/creditreport/byco/refresh`, {
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
// Search keeps several officers: an exact match (a picked suggestion)
// becomes a chip and the box clears for the next one. Loaded history only
// carries the officers it was fetched for, so a different set re-fetches.
crHistOfficerPicker = crChipPicker({
    row: document.getElementById("crHistOfficerRow"),
    keyOf: crHistOfficerKey,
    labelOf: crOfficerRosterLabel,
    onChange: () => {
        crUpdateHistRunButtonState();
        crUpdateChartButtonVisibility();
        if (!crHistoryData) return;
        if (crHistOfficers().length && crHistOfficerPicker.key() !== crHistoryData.officerKey) crFetchHistory();
        else crRenderHistory();
    }
});
document.getElementById("crHistOfficerSearch").addEventListener("input", (e) => {
    const typed = e.target.value.trim();
    const match = typed && crOfficerRoster.find(o => crOfficerRosterLabel(o) === typed);
    if (match) {
        e.target.value = "";
        crHistOfficerPicker.add(match);
    }
    document.getElementById("crHistOfficerClear").hidden = !e.target.value;
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
        if (!confirm(t("creditreport.compare.confirmDeleteSnapshot", { date: crFmtDateDMY(dateKey) }))) return;

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
            const res = await fetch(`${API.BASE_URL}/api/creditreport/byco/snapshot/refresh-t24`, {
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
    // The chart follows one section.
    const keys = crSectionKeys();
    const sectionFilter = keys.length === 1 ? keys[0] : "all";
    const isNbc = sectionFilter === "nbcOverdue" || sectionFilter === "nbcOverdueArea";
    const isT24 = sectionFilter === "parT24" || sectionFilter === "parT24Area";
    // The chart follows one classification: hidden for All NBC classes,
    // and when several NBC / T24 classes are picked.
    const nbcClassAll = isNbc && crPicks("crNbcClass").length !== 1;
    const t24Several = isT24 && crPicks("crClass").length > 1;
    btn.style.display = (crMode === "history" && crResolveSelectedOfficer() && sectionFilter !== "all" && !nbcClassAll && !t24Several) ? "" : "none";
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

    CRGrowthDashboard.render(document.getElementById("crGrowthDashboard"), {
        headerRoot: document.getElementById("crChartTitle"),
        section,
        days: crHistoryData.days,
        scope: crHistOfficers().map(crOfficerRosterLabel).join(", "),
        getItemForDay: crHistItemForDay,
        getByPath: crGetByPath,
        fmtNum: crFmtNum,
        fmtPct: crFmtPct
    });

    const days = crHistoryData.days;
    // Balance Loan at Risk (T24)_Own/_Area is never date-filtered — it
    // always reflects whichever ArreasT24ByCO data was live at snapshot
    // time, which can carry its own "as of" moment different from each
    // row's own Date (same reason crBuildHistoryRow shows a separate
    // "T24: ..." note under Date for this section). The chart's own X
    // axis follows that same T24 "as of" moment instead of the row Date
    // whenever Showing is T24, per explicit request 2026-10-05.
    const labels = days.map(d => crSectionHasT24(section) && d.t24AsOfText
        ? CRGrowthDashboard.fmtShortDateTime(d.t24AsOfText)
        : CRGrowthDashboard.fmtShortDate(d.date));
    const colors = crChartSeriesColors();
    const activeField = metricOptions.find(f => f.label === crChartMetricLabel);

    const datasets = [];
    section.groups.forEach((g, idx) => {
        const field = g.fields.find(f => f.label === crChartMetricLabel);
        if (!field) return;
        const data = days.map(day => {
            const item = crHistItemForDay(day);
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


    const isPct = !!activeField?.pct;
    // A slow-moving aggregate (e.g. Loan Outstanding) barely changes day to
    // day relative to its own size, so an axis anchored at 0 flattens every
    // real move into an invisible near-straight line. Zooming to the data's
    // own range (padded) makes that movement visible — skipped for % fields,
    // where 0 is a meaningful, bounded reference point worth keeping.
    const crChartValues = datasets.flatMap(ds => ds.data).filter(v => v != null);
    const crChartMin = crChartValues.length ? Math.min(...crChartValues) : 0;
    const crChartMax = crChartValues.length ? Math.max(...crChartValues) : 0;
    const crChartPad = Math.max((crChartMax - crChartMin) * 0.1, Math.abs(crChartMax) * 0.02, 1);
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
                    beginAtZero: isPct,
                    min: isPct ? undefined : Math.max(0, crChartMin - crChartPad),
                    max: isPct ? undefined : crChartMax + crChartPad,
                    ticks: {
                        color: textMuted,
                        // Money axis in short form (132.00M); the tooltip keeps the full figure.
                        callback: (v) => isPct ? crFmtPct(v) : activeField?.money ? CRGrowthDashboard.fmtCompact(v) : crFmtNum(v)
                    },
                    title: { display: !!activeField?.money, text: "USD", color: textMuted },
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
crMultiEnhance(["crSection", "crBranch", "crTeam", "crClass", "crProduct", "crNbcClass", "crNbcProduct"]);
crReadStateFromUrl();
crUpdateClassVisibility();
crRunReport();
