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

const t = (key, vars) => window.CMI18n ? CMI18n.t(key, vars) : key;

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
// Plan vs Actual (/api/creditreport/plan-vs-actual), fetched the first
// time that section is shown after a (re)load; null = not fetched.
let crPlanData = null;
let crPlanLoading = null;
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
let crHistDatesSeeded = false;
const crLoggedInUser = JSON.parse(
    localStorage.getItem("loggedInUser") || sessionStorage.getItem("loggedInUser") || "{}"
);
const crIsAdmin = String(crLoggedInUser.role || "").toLowerCase() === "admin";

// ========================================
// SECTION DEFINITIONS
// Each field's `key` is a dot-path into a branch item (or `total`).
// money:true -> thousands-formatted number. pct:true -> XX.XX%.
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
        los: {
            groups: [{
                label: t("creditreport.detail.sectionLos"),
                fields: [
                    { key: "loanLos.loan", label: t("creditreport.detail.colLoanHash") }
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
            ...S.los.groups,
            ...S.parT24.groups,
            ...S.nbcOverdue.groups,
            ...S.writeOff.groups
        ]
    };
    return S;
}

// ========================================
// COMPARISON MODE — Actual Only (the report as it was) or Plan vs
// Actual (only what has a Monthly Plan, each figure next to its plan).
// Plans and their actuals come from /api/creditreport/plan-vs-actual
// (item.planVs): the branch plan of the month and the actual for the
// report's period (1st of the month to the OS date), without the
// class / product filters. Disbursement also shows what the plan comes
// to by the report's last day. NBC Overdue % and NPL % are ceilings,
// shown as points above (+) or below (−) the plan. WO Collected is
// compared for this month (the WO columns themselves cover the year).
// KHR loans and loans ≤ $50,000 have a plan but no actual yet.
// Current mode only; never part of the daily snapshot.
// ========================================
function crCompareMode() {
    if (crMode !== "current") return "actual";
    const v = document.getElementById("crCompare")?.value;
    return v === "plan" ? "plan" : "actual";
}

// Plan columns of one metric: plan [, due to date], then % (or ± for a
// ceiling). withActual adds the actual first (from planVs, for figures
// the report table doesn't already show for the same period / filters).
function crPlanFields(metric, { money = false, ceiling = false, toDate = false, withActual = false, actualLabel } = {}) {
    const base = `planVs.${metric}`;
    const kind = ceiling ? "pct" : money ? "money" : "num";
    const f = [];
    if (withActual) f.push({ key: `${base}.actual`, label: actualLabel || t("creditreport.plan.actual"), pv: kind });
    f.push({ key: `${base}.plan`, label: t(ceiling ? "creditreport.plan.planMax" : "creditreport.plan.plan"), pv: kind, planCol: true });
    if (toDate) f.push({ key: `${base}.expected`, label: t("creditreport.plan.expected"), pv: kind, planCol: true });
    f.push(ceiling
        ? { key: base, label: "±", pv: "diff", planCol: true }
        : { key: `${base}.ach`, label: "%", pv: "ach", planCol: true });
    return f;
}

// A field with its plan columns after it (the field stays as it is).
function crWithPlanAfter(field, metric, opts) {
    return [field, ...crPlanFields(metric, opts)];
}

// One section's groups for the Comparison Mode in use: in Plan vs
// Actual, only the planned figures, each followed by its plan columns.
function crCompareSection(sectionKey, section) {
    if (crCompareMode() === "actual") return section;
    const groups = [];
    for (const g of section.groups) {
        const first = (g.fields[0] || {}).key || "";
        if (first.startsWith("loanOutstanding.")) {
            const f = [];
            for (const field of g.fields) {
                if (field.key === "loanOutstanding.loan") f.push(...crWithPlanAfter(field, "osCount"));
                else if (field.key === "loanOutstanding.client") f.push(...crWithPlanAfter(field, "osClients"));
                else if (field.key === "loanOutstanding.value") f.push(...crWithPlanAfter(field, "osAmount", { money: true }));
            }
            f.push(...crPlanFields("osKhr", { money: true, withActual: true, actualLabel: t("creditreport.plan.khr") }));
            f.push(...crPlanFields("osSmall", { money: true, withActual: true, actualLabel: t("creditreport.plan.small") }));
            groups.push({ ...g, fields: f });
        } else if (first.startsWith("loanDisburse.")) {
            groups.push({
                ...g,
                fields: g.fields.flatMap(field =>
                    field.key === "loanDisburse.loan" ? crWithPlanAfter(field, "disbCount", { toDate: true })
                        : field.key === "loanDisburse.value" ? crWithPlanAfter(field, "disbAmount", { money: true, toDate: true })
                            : [])
            });
        } else if (first.startsWith("loanLos.")) {
            groups.push({ ...g, fields: crWithPlanAfter(g.fields[0], "losCount", { toDate: true }) });
        } else if (first.startsWith("nbcOverdue.total.") || first.startsWith("nbcOverdue.nonPerformingLoan.")) {
            const metric = first.startsWith("nbcOverdue.total.") ? "nbcOverduePct" : "nplPct";
            groups.push({
                ...g,
                fields: crPlanFields(metric, { ceiling: true, withActual: true, actualLabel: t("creditreport.detail.colParPct") })
            });
        } else if (first.startsWith("writeOff.woCollected.")) {
            groups.push({ ...g, fields: crPlanFields("woCollected", { money: true, withActual: true, actualLabel: t("creditreport.plan.thisMonth") }) });
        }
    }
    // Plan vs Actual with only unplanned sections picked (e.g. T24).
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

// Fetch Plan vs Actual (once per report load) and hang each branch's
// metrics on its row as item.planVs, the Total's on the Total row.
async function crEnsurePlan() {
    if (!crSummaryData || crCompareMode() === "actual") return crRenderPlanNote();
    if (crPlanData) return crRenderPlanNote();
    if (!crPlanLoading) {
        crPlanLoading = (async () => {
            const res = await fetch(`${API.BASE_URL}/api/creditreport/plan-vs-actual`, { headers: { Authorization: `Bearer ${crToken}` } });
            const data = await res.json();
            if (!res.ok || !data.ok) throw new Error(data.message || `HTTP ${res.status}`);
            return data;
        })();
    }
    try {
        const data = await crPlanLoading;
        crPlanData = data;
        const byBranch = new Map((data.rows || []).map(r => [r.branch, r.metrics]));
        crSummaryData.items.forEach(it => { it.planVs = byBranch.get(it.branch) || null; });
        if (crSummaryData.total) crSummaryData.total.planVs = data.total ? data.total.metrics : null;
        crRenderSummary();
    } catch (e) {
        console.error("plan vs actual failed:", e);
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
        t("creditreport.plan.noteRules")
    ];
    if (crPicks("crNbcProduct").length || crPicks("crClass").length || crPicks("crProduct").length) lines.push(t("creditreport.plan.noteFilters"));
    let html = lines.map(l => `<span>${crEscapeHtml(l)}</span>`).join("");
    if (!crPlanData.hasPlan) {
        html += `<span class="cr-plan-missing">${crEscapeHtml(t("creditreport.plan.noPlan"))}${crIsAdmin ? ` <a href="/CM_Pro/pages/masterdata/plan.html">${crEscapeHtml(t("creditreport.plan.setPlan"))} ›</a>` : ""}</span>`;
    }
    el.innerHTML = html;
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

    crRestoreSections(p, crSections());

    crRestorePicks("crClass", p.getAll("t24Class"));

    crRestorePicks("crProduct", p.getAll("t24Product"));

    crRestorePicks("crNbcClass", p.getAll("nbcClass"));

    crRestorePicks("crNbcProduct", p.getAll("nbcProduct"));

    const compare = p.get("compare");
    if (compare === "plan") document.getElementById("crCompare").value = compare;
}

function crSyncStateToUrl() {
    const p = new URLSearchParams();
    crAddSections(p);

    crAddPicks(p, "t24Class", "crClass");
    crAddPicks(p, "t24Product", "crProduct");
    crAddPicks(p, "nbcClass", "crNbcClass");
    crAddPicks(p, "nbcProduct", "crNbcProduct");
    const compare = document.getElementById("crCompare").value;
    if (compare !== "actual") p.set("compare", compare);
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
    if (field.pv) return crFmtPlanField(item, field);
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
        g.fields.map(f => `<th class="${crFieldClass(f)}${f.planCol ? " cr-plan-col" : ""}${sortCls(f.key)}" data-sort-key="${f.key}" data-sort-type="number">${f.label}</th>`).join("")
    ).join("");

    const allExpanded = crIsAllExpanded();

    return `
      <tr class="cr-group-row">
        <th rowspan="2" class="cr-branch-col${sortCls("_name")}" data-sort-key="_name" data-sort-type="text">
          <button type="button" id="crExpandAllBtn" class="cr-row-expand-btn cr-expand-all-btn${allExpanded ? " open" : ""}" aria-expanded="${allExpanded}" aria-label="${t("creditreport.byBranch.expandAllAria")}">▾</button>
          ${t("creditreport.detail.branch")}
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
    const branchLabel = isTotal ? t("common.total") : item.branch;
    const isExpanded = crExpandedBranches.has(branchKey);
    const branchCell = `
        <button type="button" class="cr-row-expand-btn${isExpanded ? " open" : ""}" data-branch="${crEscapeHtml(branchKey)}" aria-expanded="${isExpanded}" aria-label="${t("creditreport.byBranch.toggleBreakdownAria")}">▾</button>
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
                crBuildSummaryBreakdownRow(co, section, t("creditreport.byBranch.teamCo")) +
                crBuildSummaryBreakdownRow(fsro, section, t("creditreport.byCO.fsro")) +
                crBuildSummaryBreakdownRow(digital, section, t("creditreport.byBranch.teamDigital"));
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
    loss: 4, majorDefault: 5, nonPerformingLoan: 6, total: 7
};

// Maps the T24 Loan Class filter's values to their matching bucket key
// within parT24ByClass (added to the backend so Daily History can slice
// by class without a refetch — see lib/creditreport-branch.js's own
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
// DIFFERENT field than crGroupPct()'s own ".count" (that's
// nbcOverdue/nbcOverdueArea's own convention) — parT24ByClass uses
// ".loan", matching parT24 itself.
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
    if (crCompareMode() === "actual") return crCombinedSection(crSectionFor);
    // All Sections: each section's own groups, so the plan columns land
    // beside the figures they belong to.
    return crCombinedSection(k => k === "all"
        ? { groups: ["outstanding", "disburse", "los", "parT24", "nbcOverdue", "writeOff"].flatMap(sk => crCompareSection(sk, crSections()[sk]).groups) }
        : crCompareSection(k, crSectionFor(k)));
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
    // crBuildDateQuery's own t24Class) — the flat group already shows
    // the filtered figures, so no swap is needed there. Only History
    // mode (no refetch) needs to pick a different field source for the
    // same single group.
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

function crRenderSummary() {
    if (!crSummaryData) return;
    const section = crActiveSection();

    // Plan vs Actual with only sections that have no plan (e.g. T24).
    if (!section.groups.length) {
        document.getElementById("crThead").innerHTML = "";
        document.getElementById("crTbody").innerHTML =
            `<tr><td class="cr-plan-empty">${crEscapeHtml(t("creditreport.plan.noPlannedSection"))}</td></tr>`;
        crRenderReclassNote("none");
        return;
    }

    const displayItems = crApplySort(crSummaryData.items);

    document.getElementById("crThead").innerHTML = crBuildThead(section);
    document.getElementById("crTbody").innerHTML =
        displayItems.map(it => crBuildRow(it, section, false)).join("") +
        crBuildRow(crSummaryData.total, section, true);

    // The note sits under the T24 section only when it's the one shown.
    const keys = crSectionKeys();
    crRenderReclassNote(keys.length === 1 ? keys[0] : "all");
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
        <th rowspan="2" class="cr-branch-col">${t("creditreport.detail.branch")}</th>
        <th rowspan="2" class="cr-date-col">${t("creditreport.byBranch.colDate")}</th>
        ${groupCells}
      </tr>
      <tr class="cr-sub-row">
        ${subCells}
      </tr>`;
}

// Balance Loan at Risk (T24) is never date-filtered (see
// computeBranchData in creditreport-branch.js) — it always reflects
// whatever is live in the ArreasT24ByCO feed at snapshot time, which can
// carry its own "as of" moment (t24AsOfText) different from this row's
// own Date (the NBC OS Grid Merge date), same as the live table's own
// info card already shows two separate values. Shown as a small label
// under the Date cell, only while a T24 column is actually part of the
// active section, per explicit request 2026-10-02.
function crSectionHasT24(section) {
    return section.groups.some(g => g.key === "parT24");
}

function crBuildHistoryRow(dateKey, item, section, isTotal, t24AsOfText) {
    const cells = section.groups.map(g =>
        g.fields.map(f => crFmtField(item, f)).join("")
    ).join("");
    const branchKey = isTotal ? "All Branch" : item.branch;
    const branchLabel = isTotal ? t("creditreport.byCO.allBranch") : item.branch;
    const rowKey = crHistoryRowKey(branchKey, dateKey);
    const isExpanded = crHistoryExpandedRows.has(rowKey);
    const branchCell = item.breakdown
        ? `<button type="button" class="cr-row-expand-btn${isExpanded ? " open" : ""}" data-hist-key="${crEscapeHtml(rowKey)}" aria-expanded="${isExpanded}" aria-label="${t("creditreport.byBranch.toggleBreakdownAria")}">▾</button>${crEscapeHtml(branchLabel)}`
        : crEscapeHtml(branchLabel);

    const t24Note = (crSectionHasT24(section) && t24AsOfText)
        ? `<div class="cr-t24-asof" title="${t("creditreport.detail.t24AsOfTooltip")}">T24: ${crEscapeHtml(t24AsOfText)}</div>`
        : "";

    // Admin-only — lets an admin remove a single day's saved snapshot
    // (e.g. one filed under an unexpected date — see crGridMergeDateKey's
    // own comment in the backend). Only on this top-level row, never on
    // the CO/FSRO/Digital breakdown rows below it — they all share the
    // same saved snapshot document for this date.
    const delBtn = crIsAdmin
        ? `<button type="button" class="cr-row-delete-btn" data-hist-del="${crEscapeHtml(dateKey)}" title="${t("creditreport.detail.deleteDaySnapshotTitle")}"><span class="cr-ico cr-ico-trash" aria-hidden="true"></span></button>`
        : "";
    // Admin-only — re-pulls currently-live T24 into this date's saved
    // snapshot (see the backend's runBranchDailySnapshotNow freeze
    // comment: T24 is otherwise frozen once a date is first saved).
    // Harmless no-op on today's own row, which is never frozen to begin
    // with — shown on every row uniformly rather than special-casing
    // "is this today" on the client.
    const refreshBtn = crIsAdmin
        ? `<button type="button" class="cr-row-refresh-btn" data-hist-refresh="${crEscapeHtml(dateKey)}" title="${t("creditreport.detail.refreshT24Title")}"><span class="cr-ico cr-ico-refresh" aria-hidden="true"></span></button>`
        : "";

    let html = `
      <tr${isTotal ? ' class="cr-total-row"' : ""}>
        <td class="cr-branch-col">${branchCell}</td>
        <td class="cr-date-col"><div class="cr-date-main">${crFmtDateDMY(dateKey)}${refreshBtn}${delBtn}</div>${t24Note}</td>
        ${cells}
      </tr>`;

    if (isExpanded && item.breakdown) {
        html +=
            crBuildHistoryBreakdownRow(dateKey, item.breakdown.co, section, t("creditreport.byBranch.teamCo"), t24AsOfText) +
            crBuildHistoryBreakdownRow(dateKey, item.breakdown.fsro, section, t("creditreport.byCO.fsro"), t24AsOfText) +
            crBuildHistoryBreakdownRow(dateKey, item.breakdown.digital, section, t("creditreport.byBranch.teamDigital"), t24AsOfText);
    }
    return html;
}

// Same shape as crBuildSummaryBreakdownRow (the live table's own), with
// the same Date (and the same T24-as-of note, per explicit request
// 2026-10-02 — CO/FSRO/Digital all share their parent branch's single
// ArreasT24ByCO snapshot moment) as its parent row.
function crBuildHistoryBreakdownRow(dateKey, item, section, team, t24AsOfText) {
    const cells = section.groups.map(g =>
        g.fields.map(f => crFmtField(item, f)).join("")
    ).join("");
    const t24Note = (crSectionHasT24(section) && t24AsOfText)
        ? `<div class="cr-t24-asof" title="${t("creditreport.detail.t24AsOfTooltip")}">T24: ${crEscapeHtml(t24AsOfText)}</div>`
        : "";
    return `
      <tr class="cr-breakdown-row">
        <td class="cr-branch-col">${crEscapeHtml(team)}</td>
        <td class="cr-date-col"><div class="cr-date-main">${crFmtDateDMY(dateKey)}</div>${t24Note}</td>
        ${cells}
      </tr>`;
}

// Pulls the figures to display for one history row: the branch's own
// combined total, or — when a Team is selected — that branch's own
// CO/FSRO/Digital breakdown (already on the item, saved by the daily
// snapshot itself; no extra fetch).
// The row a stored day shows for the History Branch / Team picks: one
// branch's own row (or the All Branch total) and one team's breakdown —
// or, with several branches / teams picked, the server's `combined` row
// (those branches' picked teams added up, PAR % recomputed).
function crHistoryPicks() {
    return { branches: crPicks("crHistBranch"), teams: crPicks("crHistTeam") };
}
function crHistoryKey(picks) {
    return JSON.stringify(picks);
}
function crHistoryItemForDay(day, picks = crHistoryPicks()) {
    if (picks.branches.length > 1 || picks.teams.length > 1) return day.combined || null;
    const raw = picks.branches.length ? day.items.find(it => it.branch === picks.branches[0]) : day.total;
    return crResolveHistoryItem(raw, picks.teams[0] || "");
}

function crResolveHistoryItem(rawItem, team) {
    if (!rawItem) return null;
    return team ? (rawItem.breakdown ? rawItem.breakdown[team] : null) : rawItem;
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

    const picks = crHistoryPicks();

    // Always exactly one row-stream, in chronological date order — a
    // specific branch's own figures, or "All Branch" (the cross-branch
    // aggregate) when no branch is picked — never a list of every
    // branch at once. The Team filter additionally swaps each row's
    // figures for that team's own breakdown instead of the combined
    // total (already on the item, saved by the daily snapshot itself).
    let rowsHtml = "";
    for (const day of crHistoryData.days) {
        const item = crHistoryItemForDay(day, picks);
        if (item) rowsHtml += crBuildHistoryRow(day.date, item, section, picks.branches.length !== 1, day.t24AsOfText);
    }

    document.getElementById("crTbody").innerHTML = rowsHtml;
    document.getElementById("crTableScroll").style.display = "block";
    document.getElementById("crEmptyMsg").style.display = "none";
    requestAnimationFrame(crSetHeaderOffsets);
    crUpdateChartButtonVisibility();
}

async function crFetchHistory() {
    const dateFrom = document.getElementById("crHistFromDate").value;
    const dateTo = document.getElementById("crHistToDate").value;
    if (!dateFrom || !dateTo) return;

    // History only ever shows one row-stream: the picked branch's own
    // rows, or the All Branch total — so ask for just that part of each
    // day instead of every branch. Switching the Branch filter afterwards
    // re-fetches (see crHistBranch's handler).
    // Several branches / teams: the server also adds them up per day.
    const picks = crHistoryPicks();
    const params = new URLSearchParams({ dateFrom, dateTo });
    if (picks.branches.length) picks.branches.forEach(b => params.append("branch", b));
    else params.set("totalOnly", "1");
    if (picks.branches.length > 1 || picks.teams.length > 1) picks.teams.forEach(tm => params.append("team", tm));

    crShowLoading();
    try {
        const url = `${API.BASE_URL}/api/creditreport/summary/history?${params.toString()}`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${crToken}` } });
        const data = await res.json();
        crHideLoading();

        if (!data.ok) {
            crShowEmpty(data.message || t("creditreport.detail.failedLoadHistory"));
            return;
        }
        crHistoryData = data;
        crHistoryData.key = crHistoryKey(picks);
        crRenderHistory();
    } catch (e) {
        console.error(e);
        crHideLoading();
        crShowEmpty(t("creditreport.detail.networkErrorHistory"));
    }
}

// "View History" stays disabled until Showing is narrowed to a specific
// section (away from "All Sections") — Branch/Team no longer need to be
// narrowed too, per explicit follow-up request 2026-10-05 (the earlier
// "pick any 2 of Branch/Team/Showing" rule required more than just
// picking a focused Showing). Shared with crUpdateChartButtonVisibility
// below so Chart's own visibility always matches this button's enabled
// state, not a separately-maintained condition. This only gates the
// initial fetch trigger; once crHistoryData is loaded, Branch/Team/
// Showing (including switching back to any "All" default) still filter
// it client-side exactly as before, no re-fetch needed.
function crHistoryFocused() {
    return crSectionKeys().length > 0;
}

function crUpdateHistRunButtonState() {
    const btn = document.getElementById("btnCrHistRun");
    if (!btn) return;
    // Visible only in Daily History mode — per explicit follow-up
    // request 2026-10-05 (moving it next to Chart, which is also
    // History-only, left it with no mode-based visibility of its own).
    btn.style.display = crMode === "history" ? "" : "none";
    btn.disabled = !crHistoryFocused();
}

function crSetMode(mode) {
    crMode = mode;
    document.getElementById("crModeCurrentBtn").classList.toggle("active", mode === "current");
    document.getElementById("crModeHistoryBtn").classList.toggle("active", mode === "history");
    document.getElementById("crHistoryPanel").style.display = mode === "history" ? "block" : "none";
    document.getElementById("crHistBranchRow").style.display = mode === "history" ? "" : "none";
    document.getElementById("crHistTeamRow").style.display = mode === "history" ? "" : "none";
    // Comparison Mode is for the current report only.
    document.getElementById("crCompareRow").style.display = mode === "history" ? "none" : "";
    crUpdateClassVisibility();
    crUpdateChartButtonVisibility();
    crUpdateHistRunButtonState();

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
        crShowEmpty("Pick a Showing section, then click \"View History\".");
    }
    crEnsurePlan();
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

    if (typeof showAppLoading === "function") showAppLoading(t("creditreport.byBranch.loadingBreakdown"));
    try {
        const url = `${API.BASE_URL}/api/creditreport/detailed${crBuildDateQuery()}`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${crToken}` } });
        const data = await res.json();
        if (!data.ok || !data.groups || !data.groups.length) {
            throw new Error(data.message || t("creditreport.byBranch.breakdownLoadFailed"));
        }
        crDetailedData = data;
        return true;
    } catch (e) {
        console.error(e);
        if (typeof showToast === "function") {
            showToast(t("creditreport.byBranch.breakdownLoadFailedRetry"), "error");
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
        fromDate: crSummaryData?.fromDate || "",
        toDate: crSummaryData?.toDate || "",
        woFromDate: crSummaryData?.woFromDate || "",
        woToDate: crSummaryData?.woToDate || ""
    });
    location.href = `BranchProductivity.html?${q.toString()}`;
});

document.getElementById("crCompare").addEventListener("change", () => {
    crEnsurePlan();
    crRenderSummary();
    crSyncStateToUrl();
});

document.getElementById("crSection").addEventListener("change", () => {
    crUpdateClassVisibility();
    crUpdateChartButtonVisibility();
    if (crMode === "history") {
        crUpdateHistRunButtonState();
        crRenderHistory();
    } else {
        crRenderSummary();
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
// True from a Refresh's server reply until the re-run report is done: the
// re-run's own crShowLoading() then keeps the Refresh bar going instead of
// restarting it at 0% as a plain load.
let crRefreshing = false;
// Progress-mode overlay (% bar, topbar / bottom nav stay usable);
// `key` keeps a separate time estimate per kind of load.
function crShowLoading(message = t("creditreport.loadingReportData"), key = "load") {
    document.getElementById("crSkeleton").style.display = "block";
    document.getElementById("crTableScroll").style.display = "none";
    document.getElementById("crEmptyMsg").style.display = "none";
    document.getElementById("crReclassNote").style.display = "none";
    if (!crRefreshing && typeof showAppLoading === "function") {
        showAppLoading(message, { progress: true, key: `crByBranch:${key}` });
    }
}
function crHideLoading() {
    crRefreshing = false;
    document.getElementById("crSkeleton").style.display = "none";
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

// Builds the ?t24Class=...&t24Product=... query string — the report's
// own date range is no longer user-settable (the "Set Report Date"
// picker was removed 2026-10-02 per explicit request), so no date
// params are ever sent; the server always uses its own data-derived
// default.
function crBuildDateQuery() {
    const parts = [];

    // One param per picked value; "total" (Total T24 Overdue) is the
    // class filter's All — never sent.
    crPicks("crClass").forEach(v => parts.push(`t24Class=${encodeURIComponent(v)}`));
    crPicks("crProduct").forEach(v => parts.push(`t24Product=${encodeURIComponent(v)}`));

    // crNbcClass is NOT sent — every classification is already in the
    // response (see crActiveSection() above), so it's a display-only pick.
    crPicks("crNbcProduct").forEach(v => parts.push(`nbcProduct=${encodeURIComponent(v)}`));
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

// Default Daily History range: the 1st of the month through the NBC
// Loan Outstanding Grid Merge date itself (data.fromDate/toDate, already
// anchored to that date by the server — see lib/creditreport-branch.js's
// crComputeMeta()), NOT the calendar month we happen to be in today — per
// explicit request 2026-10-01: the Grid Merge date can lag behind today
// (e.g. still 30/09 a couple of days into October), so seeding from
// today's calendar month would default to a range with no data in it.
// Seeded once, from whichever report load resolves first, so it never
// overwrites a range the person has since picked by hand.
function crSeedHistoryDates(data) {
    if (crHistDatesSeeded) return;
    crHistDatesSeeded = true;
    document.getElementById("crHistFromDate").value = data.fromDate;
    document.getElementById("crHistToDate").value = data.toDate;
}

// Daily History's own Branch filter — populated from whichever branches
// this user's own report actually carries (a branch manager's /summary
// response already only ever has their one branch, via resolveBranchScope
// server-side), rather than a hardcoded list that could drift from it.
let crHistBranchFilterPopulated = false;
function crPopulateHistoryBranchFilter(data) {
    if (crHistBranchFilterPopulated) return;
    crHistBranchFilterPopulated = true;
    const sel = document.getElementById("crHistBranch");
    const branches = (data.items || []).map(it => it.branch);
    sel.insertAdjacentHTML("beforeend",
        branches.map(b => `<option value="${crEscapeHtml(b)}">${crEscapeHtml(b)}</option>`).join(""));
}

// ========================================
// LOAD REPORT
// ========================================
async function crRunReport() {
    crShowLoading();

    // Dates changed — any cached Detailed data is now stale, and any
    // inline breakdown expanded under a Summary row no longer applies.
    crDetailedData = null;
    crPlanData = null;
    crExpandedBranches.clear();

    try {
        const url = `${API.BASE_URL}/api/creditreport/summary${crBuildDateQuery()}`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${crToken}` } });
        const data = await res.json();

        crHideLoading();

        if (!data.ok) {
            crShowEmpty(data.message || t("creditreport.detail.failedLoadReport"));
            return;
        }

        crSyncStateToUrl();
        crRenderMeta(data.meta);

        document.getElementById("crDisbPeriod").textContent =
            t("creditreport.detail.dateRange", { from: crFmtDateDMY(data.fromDate), to: crFmtDateDMY(data.toDate) });
        document.getElementById("crWoPeriod").textContent =
            t("creditreport.detail.dateRange", { from: crFmtDateDMY(data.woFromDate), to: crFmtDateDMY(data.woToDate) });

        if (!data.items || !data.items.length) {
            crShowEmpty(t("common.noData"));
            return;
        }

        crSummaryData = data;
        crSeedHistoryDates(data);
        crPopulateHistoryBranchFilter(data);
        document.getElementById("crTableScroll").style.display = "block";
        crRenderSummary();
        crEnsurePlan();
    } catch (e) {
        console.error(e);
        crHideLoading();
        crShowEmpty(t("creditreport.detail.networkErrorReport"));
    }
}
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
// EXPORT EXCEL / PDF, PRINT, FULLSCREEN — the report on screen, same
// engine and look as Daily Arrears (cr-export.js, arrears-export.js).
// ========================================
CRExport.wire({ name: "MonitoringByBranch" });

// ========================================
// SNAPSHOT — admin only, per explicit request 2026-10-08. Same
// endpoint the Credit Report hub's own "Snapshot All" button already
// calls for Branch; offered here too as a page-local shortcut.
// ========================================
if (crIsAdmin) {
    const snapBtn = document.getElementById("btnCrSnapshot");
    if (snapBtn) snapBtn.style.display = "";
}
async function crRunSnapshotNow() {
    if (typeof showAppLoading === "function") showAppLoading(t("creditreport.compare.savingSnapshot"));
    try {
        const res = await fetch(`${API.BASE_URL}/api/creditreport/summary/snapshot/run`, {
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
    crShowLoading(t("creditreport.detail.refreshingFromDb"), "refresh");

    try {
        const res = await fetch(`${API.BASE_URL}/api/creditreport/refresh`, {
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

        // Local caches are now stale too — drop them so the re-run refetches.
        crSummaryData = null;
        crDetailedData = null;

        await crRunReport();
        if (crRefreshing) crHideLoading();
    } catch (e) {
        console.error("[refresh data] failed:", e);
        crHideLoading();
        crShowEmpty(t("creditreport.detail.networkErrorRefresh"));
    }
}
document.getElementById("btnCrRefreshData")?.addEventListener("click", crRefreshData);

// ========================================
// DAILY HISTORY CHART — a line chart of the currently filtered
// Branch/Team (see crResolveHistoryItem()), over the fetched date
// range, for whichever fields the active "Showing" section carries.
// Visible only once Branch or Team narrows down from "All" — with
// both left at "All" there's no single entity left to plot a line for.
// Reuses Chart.js the same way assets/js/admin/admin.js already does
// elsewhere in this app (same CDN build, same instance-reuse pattern).
// ========================================
let crChartInstance = null;
let crChartMetricLabel = null; // persists across re-opens until a Showing/metric change resets it

// Chart is visible only when "View History" is also enabled — same
// crHistoryFocused() condition (Showing narrowed away from "All
// Sections") — per explicit follow-up request 2026-10-05. Branch/Team no
// longer gate it either way: Branch always resolves to exactly one
// row-stream (a specific branch, or "All Branch"), so there's always a
// definite single entity to chart once Showing itself is focused. The
// one further exception: "Showing: Balance Loan at Risk (NBC Overdue)"
// with its own Loan Class left at "All" plots all 7 classifications at
// once, which isn't a focused-enough chart either — hidden until a
// specific classification (or "Total NBC Overdue") is picked — per
// explicit follow-up request 2026-10-05. T24's own Loan Class filter has
// no "All" value any more (same date — "Total T24 Overdue" already
// covers that unfiltered view), so unlike NBC Overdue there's nothing
// left to hide Chart on there beyond crHistoryFocused() itself.
function crUpdateChartButtonVisibility() {
    const btn = document.getElementById("btnCrHistChart");
    if (!btn) return;
    // The chart follows one section, and one classification within it.
    const keys = crSectionKeys();
    const sectionFilter = keys.length === 1 ? keys[0] : "";
    // The chart follows one classification: hidden for All NBC classes,
    // and when several NBC / T24 classes are picked.
    const nbcClassAll = (sectionFilter === "nbcOverdue" && crPicks("crNbcClass").length !== 1) ||
        (sectionFilter === "parT24" && crPicks("crClass").length > 1);
    btn.style.display = (crMode === "history" && keys.length === 1 && !nbcClassAll) ? "" : "none";
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

function crChartTitle() {
    const { branches, teams } = crHistoryPicks();
    const teamName = tm => ({ co: t("creditreport.byBranch.teamCo"), fsro: t("creditreport.byCO.fsro"), digital: t("creditreport.byBranch.teamDigital") }[tm] || tm);
    const teamLabel = teams.length ? teams.map(teamName).join(", ") : t("creditreport.byCO.allTeam");
    return `${branches.length ? branches.join(", ") : t("creditreport.byCO.allBranch")} — ${teamLabel}`;
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
    const metricOptions = crChartMetricOptions(section);
    if (!metricOptions.length) return;
    if (!metricOptions.some(f => f.label === crChartMetricLabel)) {
        // Prefer the first money field (the usual headline figure) when
        // (re)picking a default — e.g. switching "Showing" resets it.
        crChartMetricLabel = (metricOptions.find(f => f.money) || metricOptions[0]).label;
    }
    crRenderChartMetricTabs(section, metricOptions);

    const days = crHistoryData.days;
    CRGrowthDashboard.render(document.getElementById("crGrowthDashboard"), {
        headerRoot: document.getElementById("crChartTitle"),
        section,
        days: crHistoryData.days,
        scope: crChartTitle(),
        getItemForDay: day => crHistoryItemForDay(day),
        getByPath: crGetByPath,
        fmtNum: crFmtNum,
        fmtPct: crFmtPct
    });
    // Balance Loan at Risk (T24) is never date-filtered — it always
    // reflects whichever ArreasT24ByCO data was live at snapshot time,
    // which can carry its own "as of" moment different from each row's
    // own Date (same reason crBuildHistoryRow shows a separate "T24: ..."
    // note under Date for this section). The chart's own X axis follows
    // that same T24 "as of" moment instead of the row Date whenever
    // Showing is T24, per explicit request 2026-10-05.
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
            const item = crHistoryItemForDay(day);
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
// HISTORY MODE — UI wiring
// ========================================
document.getElementById("crModeCurrentBtn").addEventListener("click", () => crSetMode("current"));
document.getElementById("crModeHistoryBtn").addEventListener("click", () => crSetMode("history"));
document.getElementById("btnCrHistRun").addEventListener("click", crFetchHistory);
// Loaded history only carries the branches (or All Branch total) it was
// fetched for, and a combined row only for the teams it was fetched
// with — so other branches, or other teams while several branches /
// teams are picked, need their own fetch. One team switched on what's
// loaded just re-renders.
function crOnHistoryPicksChange() {
    crUpdateHistRunButtonState();
    if (!crHistoryData) return;
    const now = crHistoryPicks();
    const was = JSON.parse(crHistoryData.key);
    const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
    const combined = now.branches.length > 1 || now.teams.length > 1;
    if (!same(now.branches, was.branches) || (combined && !same(now.teams, was.teams))) crFetchHistory();
    else crRenderHistory();
}
document.getElementById("crHistBranch").addEventListener("change", crOnHistoryPicksChange);
document.getElementById("crHistTeam").addEventListener("change", crOnHistoryPicksChange);

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
            const res = await fetch(`${API.BASE_URL}/api/creditreport/summary/snapshot/delete`, {
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

    // Re-pulls live T24 into one date's already-frozen snapshot (see
    // crBuildHistoryRow's comment on refreshBtn above). Simplest correct
    // refresh is to just re-fetch the whole visible date range afterward
    // — crFetchHistory() already re-renders — rather than reconstruct
    // the updated row client-side from the endpoint's minimal response.
    document.getElementById("crTbody").addEventListener("click", async (e) => {
        const btn = e.target.closest(".cr-row-refresh-btn");
        if (!btn) return;
        const dateKey = btn.getAttribute("data-hist-refresh");
        if (!dateKey) return;
        if (!confirm(t("creditreport.compare.confirmRefreshT24", { date: crFmtDateDMY(dateKey) }))) return;

        btn.disabled = true;
        try {
            const res = await fetch(`${API.BASE_URL}/api/creditreport/summary/snapshot/refresh-t24`, {
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
// INIT
// ========================================
// Every filter picks several values, Showing (crSection) included.
crMultiEnhance(["crSection", "crHistBranch", "crHistTeam", "crClass", "crProduct", "crNbcClass", "crNbcProduct"]);
crReadStateFromUrl();
crUpdateClassVisibility();
crRunReport();
