// ========================================
// BRANCH PRODUCTIVITY — per-branch drill-down from
// RepDetailbyBranch.html (click a branch name there to land here).
//
// Unlike Officer Productivity's Own/Area split, here each category
// splits into CO / FSRO / Digital Loan (Digital Loan = officer ID
// "90000" on the source sheet, a placeholder for digital-channel loans
// that aren't a real CO/FSRO officer — CM-backend's
// lib/creditreport-branch.js computeBranchProductivity()). There's no
// "already-fetched" instant-paint handoff the way Officer Productivity
// has: RepDetailbyBranch.js's own report only ever holds each branch's
// combined Total, never the CO/FSRO/Digital breakdown, so this page
// always fetches its own summary on load (URL query string only —
// branch name + the report's current date filters — no sessionStorage
// cache needed).
//
// BACKEND ENDPOINTS (CM-backend's lib/creditreport-branch.js)
//   GET /api/creditreport/branch-productivity-summary
//     ?branch=<name>&fromDate=&toDate=&woFromDate=&woToDate=
//   -> { ok, branch, meta, co, fsro, digital, total }
//   Each of co/fsro/digital/total has the same shape:
//     { loanOutstanding:{loan,client,value}, loanDisburse:{loan,value},
//       parT24:{loan,value,parPct}, nbcOverdue:{...8 keys...},
//       writeOff:{balanceWO,wo,woCollected} }
//
//   GET /api/creditreport/branch-clients
//     ?branch=<name>&section=<outstanding|disburse|parT24|nbcOverdue|
//               writeOff>&bucket=<co|fsro|digital>
//     &fromDate=&toDate=&woFromDate=&woToDate=
//   -> { ok, items: [...] } — same row shape as Officer Productivity's
//      officer-clients (see that file's own header comment for the
//      full field-by-field breakdown).
//
//   GET /api/creditreport/branch-disburse-chart
//     ?branch=<name>&fromDate=
//   -> { ok, labels, dates, values, counts }
//   Branch-wide daily disbursement (CO+FSRO+Digital Loan combined —
//   one chart, not three), same mechanism as officer-disburse-chart.
//
//   GET /api/creditreport/byco/kh-holidays — reused as-is (not
//   branch-specific), same as Officer Productivity.
//
// CLIENT LIST PAGINATION — a branch can have far more clients under one
// category than a single officer would, so every "List of Client" tab
// here shows only the first 100 rows with a "Show More" button to
// reveal the rest (Export Excel always exports the full set regardless
// of how many rows are currently shown) — see bpRenderClientListInto().
// ========================================

const t = (key, vars) => window.CMI18n ? CMI18n.t(key, vars) : key;

// Built by a function (not a frozen module-level const) so every label
// picks up the current language whenever a card is (re)rendered, rather
// than being baked in once at page-load time.
function bpCategories() {
    const clientLists = () => [
        { bucket: "co", label: t("creditreport.byBranch.teamCo") },
        { bucket: "fsro", label: t("creditreport.byCO.fsro") },
        { bucket: "digital", label: t("creditreport.byBranch.teamDigitalLoan") }
    ];
    const loan = k => ({ k, label: t("creditreport.productivity.colLoan") });
    const value = k => ({ k, label: t("creditreport.detail.colValue"), money: true, main: true });
    const par = k => ({ k, label: t("creditreport.productivity.colPar"), pct: true });
    // fields: the section's figures per CO / FSRO / Digital / Total row
    // (main = the one compared with last month row by row); risk = a
    // rise is bad news; plan: the Monthly Plan metrics it is measured
    // against (head = the one with the bar), none for T24.
    return [
    {
        key: "outstanding",
        icon: '<span class="cr-ico cr-ico-barchart" aria-hidden="true"></span>',
        label: t("creditreport.detail.sectionOutstanding"),
        chart: false,
        fields: [loan("loanOutstanding.loan"), { k: "loanOutstanding.client", label: t("creditreport.productivity.colClient") }, value("loanOutstanding.value")],
        plan: [
            { key: "osCount", label: t("creditreport.plan.loans") },
            { key: "osClients", label: t("creditreport.plan.clients") },
            { key: "osAmount", label: t("creditreport.plan.osAmount"), money: true, head: true }
        ],
        clientLists: clientLists()
    },
    {
        key: "disburse",
        icon: '<span class="cr-ico cr-ico-money" aria-hidden="true"></span>',
        label: t("creditreport.detail.sectionDisburse"),
        chart: true,
        fields: [loan("loanDisburse.loan"), value("loanDisburse.value")],
        plan: [
            { key: "disbCount", label: t("creditreport.plan.loans"), disb: true },
            { key: "disbAmount", label: t("creditreport.plan.amount"), money: true, disb: true, head: true }
        ],
        clientLists: clientLists()
    },
    {
        key: "parT24",
        icon: '<span class="cr-ico cr-ico-trend-up" aria-hidden="true"></span>',
        label: t("creditreport.detail.sectionT24"),
        chart: false,
        risk: true,
        fields: [loan("parT24.loan"), value("parT24.value"), par("parT24.parPct")],
        plan: null,
        clientLists: clientLists()
    },
    {
        key: "nbcOverdue",
        icon: '<span class="cr-ico cr-ico-warning" aria-hidden="true"></span>',
        label: t("creditreport.detail.sectionNbcOverdue"),
        chart: false,
        risk: true,
        fields: [loan("nbcOverdue.total.count"), value("nbcOverdue.total.value"), par("nbcOverdue.total.parPct")],
        plan: [
            { key: "nbcOverduePct", label: t("creditreport.plan.nbcPct"), pctPts: true, lowerBetter: true, head: true },
            { key: "nplPct", label: t("creditreport.plan.nplPct"), pctPts: true, lowerBetter: true }
        ],
        clientLists: clientLists()
    },
    // Shows Balance WO (the outstanding written-off balance, # cif/Int/Prn)
    // rather than the WO period figures, per explicit request 2026-10-01 —
    // same change made to Location/Product Performance/Officer Productivity.
    // Its plan is WO Collected, a yearly plan (the year to date).
    {
        key: "writeOff",
        icon: '<span class="cr-ico cr-ico-writeoff" aria-hidden="true"></span>',
        label: t("creditreport.detail.sectionWriteOff"),
        chart: false,
        risk: true,
        fields: [
            { k: "writeOff.balanceWO.cif", label: t("creditreport.detail.colCifHash") },
            { k: "writeOff.balanceWO.int", label: t("creditreport.detail.colInt"), money: true },
            { k: "writeOff.balanceWO.prn", label: t("creditreport.detail.colPrn"), money: true, main: true }
        ],
        plan: [
            { key: "woCollected", label: `${t("creditreport.perf.woCollected")} (${t("creditreport.plan.yearPlan")})`, money: true, head: true }
        ],
        clientLists: clientLists()
    }
    ];
}

const BP_LIST_PAGE_SIZE = 100;

const bpToken =
    localStorage.getItem("token") ||
    sessionStorage.getItem("token");

let bpState = { branch: null, meta: null, data: null };

// Last-fetched Loan Disburse heatmap data — kept around so the
// fullscreen view can re-render without re-fetching.
let bpDisburseChartData = null;

// ========================================
// HELPERS
// ========================================
function bpGet(obj, path) {
    return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function bpFmtNum(n) {
    n = Number(n) || 0;
    return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}
function bpFmtDateDMY(s) {
    if (!s) return "-";
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (!m) return s;
    return `${m[3]}-${m[2]}-${m[1]}`;
}
function bpFmtDateDDMMYY(s) {
    if (!s) return "-";
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (!m) return s;
    return `${m[3]}/${m[2]}/${m[1].slice(2)}`;
}
function bpToDMY(yyyymmdd) {
    const [y, m, d] = yyyymmdd.split("-");
    return `${d}-${m}-${y}`;
}
function bpEscapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text == null ? "" : String(text);
    return div.innerHTML;
}
function bpSkeletonHtml() {
    return `<div class="op-skel-line" style="width:90%"></div>
             <div class="op-skel-line" style="width:75%"></div>
             <div class="op-skel-line" style="width:82%"></div>`;
}
function bpErrorHtml(err) {
    return `<div class="op-state op-state-error">${bpEscapeHtml((err && err.message) || t("voice.genericError"))}</div>`;
}

// ========================================
// READ BRANCH + FILTERS FROM THE URL
// ========================================
function bpReadParams() {
    const params = new URLSearchParams(location.search);
    return {
        branch: params.get("branch") || "",
        meta: {
            fromDate: params.get("fromDate") || "",
            toDate: params.get("toDate") || "",
            woFromDate: params.get("woFromDate") || "",
            woToDate: params.get("woToDate") || ""
        }
    };
}

function bpBuildQuery(meta) {
    const parts = [];
    if (meta.fromDate) parts.push(`fromDate=${bpToDMY(meta.fromDate)}`);
    if (meta.toDate) parts.push(`toDate=${bpToDMY(meta.toDate)}`);
    if (meta.woFromDate) parts.push(`woFromDate=${bpToDMY(meta.woFromDate)}`);
    if (meta.woToDate) parts.push(`woToDate=${bpToDMY(meta.woToDate)}`);
    return parts.length ? `&${parts.join("&")}` : "";
}

async function bpFetchSummary(branch, meta) {
    const url = `${API.BASE_URL}/api/creditreport/branch-productivity-summary?branch=${encodeURIComponent(branch)}${bpBuildQuery(meta)}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${bpToken}` } });
    const data = await res.json();
    if (!data.ok) throw new Error(data.message || t("creditreport.productivity.failedLoadBranchData"));
    return data;
}

// ========================================
// RENDER — HEADER + CARDS
// ========================================
function bpRenderHeader() {
    const branch = bpState.branch;
    const meta = bpState.meta;

    document.getElementById("bpAvatar").textContent =
        (branch || "?").trim().charAt(0).toUpperCase() || "?";
    document.getElementById("bpBranchName").textContent = branch || "-";

    const chips = [];
    if (meta.fromDate && meta.toDate) {
        chips.push(`${bpFmtDateDMY(meta.fromDate)} – ${bpFmtDateDMY(meta.toDate)}`);
    }
    document.getElementById("bpBranchMeta").innerHTML =
        chips.map(c => `<span class="op-meta-chip">${bpEscapeHtml(c)}</span>`).join("");

    document.getElementById("bpHeaderCard").style.display = "flex";
}

// ========================================
// COMPARISON — Actual Only | Last Month | Plan (cr-perf.js builds the
// pieces). Last Month = the branch's last saved Daily History day of
// last month (CRLastMonth, T24 from its NBC Overdue); Plan = the
// branch's Monthly Plan from Plan vs Actual (whole branch, not split
// into CO / FSRO / Digital).
// ========================================
const BP_BUCKETS = ["co", "fsro", "digital", "total"];
const bpCompare = { mode: "actual", lm: null, lmState: "", plan: null, planData: null, planState: "" };

function bpBucketLabel(b) {
    return b === "co" ? t("creditreport.byBranch.teamCo")
        : b === "fsro" ? t("creditreport.byCO.fsro")
            : b === "digital" ? t("creditreport.byBranch.teamDigital")
                : t("common.total");
}

function bpIsAllBranch() {
    return String(bpState.branch || "").toLowerCase() === "all branch";
}

// Last month's row for a bucket (null = not saved).
function bpLastRow(bucket) {
    const lm = bpCompare.lm;
    if (!lm) return null;
    return bucket === "total" ? lm : (lm.breakdown && lm.breakdown[bucket]) || null;
}

function bpRows() {
    return BP_BUCKETS.map(b => ({ label: bpBucketLabel(b), data: bpState.data[b], last: bpLastRow(b), total: b === "total" }));
}

async function bpLoadLastMonth() {
    if (bpCompare.lmState) return;
    bpCompare.lmState = "loading";
    try {
        const info = await CRLastMonth.load({
            endpoint: "/api/creditreport/summary/history",
            token: bpToken,
            toDate: bpState.data.toDate || bpState.meta.toDate,
            query: bpIsAllBranch() ? { totalOnly: "1" } : { branch: bpState.branch }
        });
        const day = info && info.day;
        const raw = day ? (bpIsAllBranch() ? day.total : (day.items || [])[0]) : null;
        bpCompare.lm = raw ? CRLastMonth.scopeSaved(raw, { t24Class: [], t24Product: [], nbcProduct: [] }) : null;
        bpCompare.lmInfo = info;
        bpCompare.lmState = "done";
    } catch (e) {
        console.error("last month failed:", e);
        bpCompare.lmState = "error";
    }
    bpRenderCompare();
}

async function bpLoadPlan() {
    if (bpCompare.planState) return;
    bpCompare.planState = "loading";
    try {
        const res = await fetch(`${API.BASE_URL}/api/creditreport/plan-vs-actual`, { headers: { Authorization: `Bearer ${bpToken}` } });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.message || `HTTP ${res.status}`);
        bpCompare.planData = data;
        const row = bpIsAllBranch() ? data.total : (data.rows || []).find(r => r.branch === bpState.branch);
        bpCompare.plan = row ? row.metrics : null;
        bpCompare.planState = "done";
    } catch (e) {
        console.error("plan failed:", e);
        bpCompare.planState = "error";
    }
    bpRenderCompare();
}

// A plan metric: { plan, actual, ach } or null when not planned.
function bpPlanMetric(key) {
    const m = bpCompare.plan && bpCompare.plan[key];
    return m && m.plan !== null && m.plan !== undefined ? m : null;
}

function bpMainField(cat) {
    return cat.fields.find(f => f.main);
}

// The big figure (+ chip) in a card's head.
function bpHeadFigsHtml(cat) {
    const total = bpState.data.total;
    const main = { ...bpMainField(cat), risk: cat.risk };
    const parField = cat.fields.find(f => f.pct);
    const pill = parField ? CRTable.parPill(bpGet(total, parField.k)) : "";
    const big = `<span class="cp-big">${CRPerf.fmt(bpGet(total, main.k), main, true)}</span>`;
    const mode = bpCompare.mode;
    if (mode === "lastMonth" && bpCompare.lm) {
        const d = CRPerf.delta(bpGet(total, main.k), bpGet(bpCompare.lm, main.k), main, { withPct: true });
        return big + pill + CRPerf.chip(d.html, d.cls);
    }
    if (mode === "plan" && bpCompare.planState === "done") {
        const head = cat.plan && cat.plan.find(p => p.head);
        const m = head && bpPlanMetric(head.key);
        if (!head) return big + pill + CRPerf.chip(bpEscapeHtml(t("creditreport.perf.noPlanSection")), "muted");
        if (!m) return big + pill;
        if (head.lowerBetter) {
            // The PAR % shown (the page's own figure) against the ceiling.
            const d = Math.round(((Number(bpGet(total, parField.k)) || 0) * 100 - m.plan) * 100) / 100;
            return `${big}${pill}<span class="cp-of">${bpEscapeHtml(t("creditreport.plan.planMax"))} ${Number(m.plan).toFixed(2)}%</span>${CRPerf.chip(`<span class="cp-arrow">${d > 0 ? "▲" : "▼"}</span>${Math.abs(d).toFixed(2)}`, d <= 0 ? "good" : "bad")}`;
        }
        const cls = CRPerf.achCls(m.ach, head.disb);
        return `<span class="cp-big">${CRPerf.fmt(m.actual, head, true)}</span><span class="cp-of">/ ${CRPerf.fmt(m.plan, head, true)}</span>${CRPerf.chip(m.ach === null ? "" : `${Math.round(m.ach * 100)}%`, cls)}`;
    }
    return big + pill;
}

function bpLoadingHtml() {
    return `<div class="cp-empty">${bpEscapeHtml(t("common.loading"))}</div>`;
}

// The table under a card's head.
function bpBodyHtml(cat) {
    const rows = bpRows();
    const actual = () => CRPerf.actualTable(rows, cat.fields);
    const mode = bpCompare.mode;
    if (mode === "lastMonth") {
        if (bpCompare.lmState !== "done" && bpCompare.lmState !== "error") return bpLoadingHtml();
        if (!bpCompare.lm) return actual();
        const main = { ...bpMainField(cat), risk: cat.risk };
        const lastLabel = CRLastMonth.shortDate(bpCompare.lmInfo.date);
        const nowLabel = CRLastMonth.shortDate(bpState.data.toDate);
        const others = cat.fields.filter(f => !f.main).map(f => ({ ...f, risk: cat.risk }));
        return CRPerf.lastMonthTable(rows, main, { lastLabel, nowLabel })
            + (others.length ? `<div class="cp-foot">${CRPerf.lastMonthFoot(rows[rows.length - 1], others)}</div>` : "");
    }
    if (mode === "plan") {
        if (bpCompare.planState !== "done" && bpCompare.planState !== "error") return bpLoadingHtml();
        if (!cat.plan) return `<div class="cp-empty">${bpEscapeHtml(t("creditreport.perf.noPlanSection"))}</div>${actual()}`;
        const metrics = cat.plan.map(p => ({ ...p, m: bpPlanMetric(p.key) })).filter(p => p.m);
        // No plan at all: the note at the top says so once.
        if (!metrics.length) return bpCompare.plan ? `<div class="cp-empty">${bpEscapeHtml(t("creditreport.plan.noPlan"))}</div>${actual()}` : actual();
        const head = metrics.find(p => p.head && !p.lowerBetter);
        const bar = head && head.m.ach !== null
            ? `<div class="cp-ach cp-${CRPerf.achCls(head.m.ach, head.disb)}">${CRPerf.bar(head.m.ach, CRPerf.achCls(head.m.ach, head.disb))}<span>${Math.round(head.m.ach * 100)}%</span></div>`
            : "";
        return bar + CRPerf.planTable(metrics);
    }
    return actual();
}

// The 3 figures at the top: Outstanding, NBC Overdue PAR, Disburse.
function bpStripHtml() {
    const total = bpState.data.total;
    const mode = bpCompare.mode;
    const lm = mode === "lastMonth" ? bpCompare.lm : null;
    const pl = mode === "plan" && bpCompare.planState === "done";
    const os = { k: "loanOutstanding.value", money: true };
    const nbc = { k: "nbcOverdue.total.parPct", pct: true, risk: true };
    const disb = { k: "loanDisburse.value", money: true };
    const cur = f => bpGet(total, f.k);
    const deltaChip = f => { const d = CRPerf.delta(cur(f), bpGet(lm, f.k), f, { withPct: true }); return CRPerf.chip(d.html, d.cls); };

    const osM = pl && bpPlanMetric("osAmount");
    const nbcM = pl && bpPlanMetric("nbcOverduePct");
    const disbM = pl && bpPlanMetric("disbAmount");
    const kpis = [
        {
            label: t("creditreport.perf.kpiOutstanding"),
            value: CRPerf.fmt(cur(os), os, true),
            sub: lm ? deltaChip(os)
                : osM ? CRPerf.chip(`${Math.round(osM.ach * 100)}% · ${CRPerf.fmt(osM.plan, os, true)}`, CRPerf.achCls(osM.ach))
                    : `${bpEscapeHtml(t("creditreport.productivity.colLoan"))} ${bpFmtNum(bpGet(total, "loanOutstanding.loan"))}`
        },
        {
            label: t("creditreport.perf.kpiNbc"),
            value: CRTable.parPill(cur(nbc)),
            sub: lm ? deltaChip(nbc)
                : nbcM ? CRPerf.chip(`${bpEscapeHtml(t("creditreport.plan.planMax"))} ${Number(nbcM.plan).toFixed(2)}%`, (Number(cur(nbc)) || 0) * 100 <= nbcM.plan ? "good" : "bad")
                    : CRPerf.fmt(bpGet(total, "nbcOverdue.total.value"), os, true)
        },
        {
            label: t("creditreport.perf.kpiDisburse"),
            value: CRPerf.fmt(cur(disb), disb, true),
            ring: disbM ? CRPerf.ring(disbM.ach, CRPerf.achCls(disbM.ach, true)) : "",
            sub: lm ? deltaChip(disb)
                : disbM ? `<span class="cp-muted">${CRPerf.fmt(disbM.actual, disb, true)} / ${CRPerf.fmt(disbM.plan, disb, true)}</span>`
                    : `${bpEscapeHtml(t("creditreport.productivity.colLoan"))} ${bpFmtNum(bpGet(total, "loanDisburse.loan"))}`
        }
    ];
    return CRPerf.strip(kpis);
}

// The line under the switch: what is compared with what.
function bpCompareNote() {
    const mode = bpCompare.mode;
    if (mode === "lastMonth") {
        if (bpCompare.lmState === "error") return t("creditreport.lastMonth.loadFailed");
        if (bpCompare.lmState !== "done") return t("common.loading");
        const info = bpCompare.lmInfo;
        if (!info || !info.date || !bpCompare.lm) return t("creditreport.lastMonth.noSnapshot", { date: bpFmtDateDMY(info && info.cutoff) });
        return t("creditreport.perf.lmNote", { date: bpFmtDateDMY(info.date) });
    }
    if (mode === "plan") {
        if (bpCompare.planState === "error") return t("creditreport.plan.loadFailed");
        if (bpCompare.planState !== "done") return t("creditreport.plan.loading");
        const d = bpCompare.planData;
        if (!bpCompare.plan || !d.hasPlan) return t("creditreport.plan.noPlan");
        const [y, m] = String(d.month || "").split("-");
        return [
            t("creditreport.plan.noteMonth", { month: `${m}-${y}`, from: bpFmtDateDMY(d.fromDate), to: bpFmtDateDMY(d.toDate), done: d.daysDone, days: d.daysInMonth }),
            t("creditreport.perf.planWhole"),
            t("creditreport.perf.planRules")
        ].join(" ");
    }
    return "";
}

function bpRenderCompare() {
    const box = document.getElementById("bpCompare");
    box.innerHTML = CRPerf.switcher([
        { key: "actual", label: t("creditreport.plan.compareActual") },
        { key: "lastMonth", label: t("creditreport.plan.compareLastMonth") },
        { key: "plan", label: t("creditreport.plan.plan") }
    ], bpCompare.mode) + `<div class="cp-note">${bpEscapeHtml(bpCompareNote())}</div>`;
    box.style.display = "";
    const strip = document.getElementById("bpStrip");
    strip.innerHTML = bpStripHtml();
    strip.style.display = "";
    const cats = bpCategories();
    document.querySelectorAll("#bpCards .op-card").forEach(card => {
        const cat = cats.find(c => c.key === card.dataset.key);
        if (!cat) return;
        card.querySelector(".cp-head-figs").innerHTML = bpHeadFigsHtml(cat);
        card.querySelector(".cp-body").innerHTML = bpBodyHtml(cat);
    });
}

function bpSetCompare(mode) {
    bpCompare.mode = ["lastMonth", "plan"].includes(mode) ? mode : "actual";
    const params = new URLSearchParams(location.search);
    if (bpCompare.mode === "actual") params.delete("compare"); else params.set("compare", bpCompare.mode);
    history.replaceState(history.state, "", `${location.pathname}?${params}`);
    if (bpCompare.mode === "lastMonth") bpLoadLastMonth();
    if (bpCompare.mode === "plan") bpLoadPlan();
    bpRenderCompare();
}

document.getElementById("bpCompare").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-compare]");
    if (btn) bpSetCompare(btn.dataset.compare);
});

function bpCardMarkup(cat) {
    const listTabsHtml = cat.clientLists.map((cl, i) =>
        `<button type="button" class="op-mode-tab${i === 0 ? " active" : ""}" data-mode="list:${cl.bucket}"><span class="cr-ico cr-ico-users" aria-hidden="true"></span> ${t("creditreport.productivity.listOfClient")} ${bpEscapeHtml(cl.label)}</button>`
    ).join("");

    const chartTabHtml = cat.chart
        ? `<button type="button" class="op-mode-tab" data-mode="chart"><span class="cr-ico cr-ico-trend-up" aria-hidden="true"></span> ${t("creditreport.detail.chart")}</button>`
        : "";

    // The head opens the client lists; the figures (cp-head-figs,
    // cp-body) are filled by bpRenderCompare().
    return `
      <div class="op-card" data-key="${cat.key}">
        <button type="button" class="op-card-head" aria-expanded="false">
          <div class="op-card-icon">${cat.icon}</div>
          <div class="op-card-title">
            <div class="op-card-label">${bpEscapeHtml(cat.label)}</div>
            <div class="cp-head-figs"></div>
          </div>
          <div class="op-card-caret">▾</div>
        </button>
        <div class="cp-body"></div>
        <div class="op-card-panel">
          <div class="op-mode-tabs">
            ${listTabsHtml}
            ${chartTabHtml}
          </div>
          <div class="op-mode-body" data-mode-body></div>
        </div>
      </div>`;
}

function bpRenderCards() {
    const wrap = document.getElementById("bpCards");
    wrap.innerHTML = bpCategories().map(cat => bpCardMarkup(cat)).join("");
    wrap.style.display = "flex";
    bpSetCompare(new URLSearchParams(location.search).get("compare"));
}

// ========================================
// ACCORDION + MODE SWITCHING
// ========================================
document.getElementById("bpCards").addEventListener("click", (e) => {
    const head = e.target.closest(".op-card-head");
    if (head) {
        const card = head.closest(".op-card");
        const willOpen = !card.classList.contains("open");
        document.querySelectorAll("#bpCards .op-card.open").forEach(c => {
            if (c !== card) { c.classList.remove("open"); c.querySelector(".op-card-head").setAttribute("aria-expanded", "false"); }
        });
        card.classList.toggle("open", willOpen);
        head.setAttribute("aria-expanded", willOpen ? "true" : "false");
        if (willOpen) {
            const activeTab = card.querySelector(".op-mode-tab.active");
            bpEnsureModeLoaded(card, activeTab ? activeTab.dataset.mode : "list");
        }
        return;
    }

    const tab = e.target.closest(".op-mode-tab");
    if (tab) {
        const card = tab.closest(".op-card");
        card.querySelectorAll(".op-mode-tab").forEach(t => t.classList.remove("active"));
        tab.classList.add("active");
        bpEnsureModeLoaded(card, tab.dataset.mode);
    }
});

async function bpEnsureModeLoaded(card, mode) {
    const key = card.dataset.key;
    const body = card.querySelector("[data-mode-body]");

    if (mode.startsWith("list:")) {
        const bucket = mode.slice(5);
        card._bpListCache = card._bpListCache || {};
        const renderOpts = {
            arrears: BP_ARREARS_CATEGORIES.has(key),
            filenamePrefix: `${bpState.branch || "branch"}_${key}_${bucket}`
        };
        if (card._bpListCache[mode]) {
            bpRenderClientListInto(body, card._bpListCache[mode], renderOpts);
            return;
        }
        body.innerHTML = bpSkeletonHtml();
        try {
            const rows = await bpFetchClientListRows(key, bucket);
            card._bpListCache[mode] = rows;
            bpRenderClientListInto(body, rows, renderOpts);
        } catch (err) {
            body.innerHTML = bpErrorHtml(err);
        }
        return;
    }

    // Chart (calendar heatmap) — always re-fetches/re-renders on reselect,
    // same rationale as Officer Productivity's own chart tab.
    body.innerHTML = `<div class="op-chart-wrap">${bpSkeletonHtml()}</div>`;
    const chartWrap = body.querySelector(".op-chart-wrap");
    try {
        await bpRenderDisburseChart(chartWrap);
    } catch (err) {
        chartWrap.innerHTML = bpErrorHtml(err);
    }
}

// parT24 and NBC Overdue's client lists use the richer arrears-style
// table (bpArrearsTableHtml) instead of the generic one — same
// convention as Officer Productivity's OP_ARREARS_SECTIONS, keyed by
// category (cat.key) here since bucket is the only other axis.
const BP_ARREARS_CATEGORIES = new Set(["parT24", "nbcOverdue"]);

async function bpFetchClientListRows(section, bucket) {
    const q = bpBuildQuery(bpState.meta);
    const url = `${API.BASE_URL}/api/creditreport/branch-clients?branch=${encodeURIComponent(bpState.branch)}` +
        `&section=${encodeURIComponent(section)}&bucket=${encodeURIComponent(bucket)}${q}`;

    const res = await fetch(url, { headers: { Authorization: `Bearer ${bpToken}` } });
    if (!res.ok) throw new Error(t("creditreport.productivity.clientListLoadFailedRetry"));
    const data = await res.json();
    if (!data.ok) throw new Error(data.message || t("creditreport.productivity.clientListLoadFailed"));
    return data.items || [];
}

// ---- Column specs (same shape as Officer Productivity's own) ----
// Functions (not frozen consts) so labels pick up the current language.
function bpClientTableCols() {
    return [
        { key: "name", label: t("creditreport.compare.colName"), type: "text" },
        { key: "cif", label: t("creditreport.compare.colCif"), type: "text" },
        { key: "loanNumber", label: t("creditreport.productivity.colLoanNumber"), type: "text" },
        { key: "disburseDate", label: t("creditreport.productivity.colDisburseDate"), type: "date" },
        { key: "address", label: t("creditreport.productivity.colAddress"), type: "text" },
        { key: "productType", label: t("creditreport.detail.productType"), type: "text" },
        { key: "loanSize", label: t("creditreport.productivity.colLoanSize"), type: "number" },
        { key: "osUsd", label: t("creditreport.productivity.colOsUsd"), type: "number" }
    ];
}

function bpArrearsTableCols() {
    return [
        { key: "name", label: t("creditreport.productivity.colCustomer"), type: "text" },
        { key: "loanNumber", label: t("creditreport.productivity.colLoanNumber"), type: "text" },
        { key: "class", label: t("creditreport.compare.colClass"), type: "text" },
        { key: "productType", label: t("creditreport.detail.productType"), type: "text" },
        { key: "address", label: t("creditreport.compare.dimLocation"), type: "text" },
        { key: "disburseDate", label: t("creditreport.productivity.colDisDate"), type: "date" },
        { key: "prnOS", label: t("creditreport.productivity.colPrnOs"), type: "number" },
        { key: "intOS", label: t("creditreport.productivity.colIntOs"), type: "number" },
        { key: "prnDue", label: t("creditreport.productivity.colPrnDue"), type: "number" },
        { key: "intDue", label: t("creditreport.productivity.colIntDue"), type: "number" },
        { key: "penalty", label: t("creditreport.productivity.colPenalty"), type: "number" },
        { key: "arreas", label: t("creditreport.productivity.colArreas"), type: "number" },
        { key: "day", label: t("creditreport.productivity.colDay"), type: "number" },
        { key: "balance", label: t("creditreport.productivity.colBalnce"), type: "number" },
        { key: "accountLoan", label: t("creditreport.productivity.colAccountLoan"), type: "text" },
        { key: "cif", label: t("creditreport.compare.colCif"), type: "text" }
    ];
}

function bpTableThHtml(col) {
    return `<th data-sort-key="${col.key}" data-sort-type="${col.type}">${bpEscapeHtml(col.label)}</th>`;
}
function bpTableTdHtml(col, row) {
    const v = row[col.key];
    if (v === "" || v == null) return "<td></td>";
    if (col.type === "number") return `<td>${bpEscapeHtml(bpFmtNum(v))}</td>`;
    if (col.type === "date") return `<td>${bpEscapeHtml(bpFmtDateDMY(v))}</td>`;
    return `<td>${bpEscapeHtml(v)}</td>`;
}

function bpClientTableHtml(rows, { showDate = true } = {}) {
    if (!rows.length) return `<div class="op-state">${t("creditreport.productivity.noClientsFound")}</div>`;
    const allCols = bpClientTableCols();
    const cols = showDate ? allCols : allCols.filter(c => c.key !== "disburseDate");
    return `
      <div class="op-client-table-wrap">
        <table class="op-client-table">
          <thead><tr>${cols.map(bpTableThHtml).join("")}</tr></thead>
          <tbody>${rows.map(r => `<tr>${cols.map(c => bpTableTdHtml(c, r)).join("")}</tr>`).join("")}</tbody>
        </table>
      </div>`;
}

function bpArrearsTableHtml(rows) {
    if (!rows.length) return `<div class="op-state">${t("creditreport.productivity.noClientsFound")}</div>`;
    const cols = bpArrearsTableCols();
    return `
      <div class="op-client-table-wrap">
        <table class="op-client-table">
          <thead><tr><th>${t("creditreport.productivity.colNo")}</th>${cols.map(bpTableThHtml).join("")}</tr></thead>
          <tbody>${rows.map((r, i) => `<tr><td>${i + 1}</td>${cols.map(c => bpTableTdHtml(c, r)).join("")}</tr>`).join("")}</tbody>
        </table>
      </div>`;
}

function bpCompareForSort(a, b, type) {
    const blank = v => v === "" || v == null;
    if (type === "number") {
        const na = blank(a) ? Infinity : Number(a);
        const nb = blank(b) ? Infinity : Number(b);
        return na - nb;
    }
    if (type === "date") {
        const da = blank(a) ? "9999-99-99" : a;
        const db = blank(b) ? "9999-99-99" : b;
        return da < db ? -1 : da > db ? 1 : 0;
    }
    const sa = blank(a) ? "￿" : String(a).toLowerCase();
    const sb = blank(b) ? "￿" : String(b).toLowerCase();
    return sa < sb ? -1 : sa > sb ? 1 : 0;
}

function bpExportRowsToExcel(rows, cols, filenamePrefix) {
    if (typeof XLSX === "undefined") {
        if (typeof showToast === "function") showToast(t("creditreport.detail.excelLibFailed"), "error");
        return;
    }
    if (!rows.length) {
        if (typeof showToast === "function") showToast(t("creditreport.detail.nothingToExport"), "warning");
        return;
    }
    const sheetData = rows.map((r, i) => {
        const out = { [t("creditreport.productivity.colNo")]: i + 1 };
        cols.forEach(c => {
            const v = r[c.key];
            out[c.label] = c.type === "date" ? bpFmtDateDMY(v) : (v === "" || v == null ? "" : v);
        });
        return out;
    });
    const ws = XLSX.utils.json_to_sheet(sheetData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Clients");
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "");
    XLSX.writeFile(wb, `${filenamePrefix}_${stamp}.xlsx`);
}

// One-stop render for any client list on this page — a branch can carry
// far more clients per category than one officer would, so only the
// first BP_LIST_PAGE_SIZE (sorted) rows render at a time, with a "Show
// More" button revealing the next page; Export Excel always exports the
// FULL row set (in whatever order is currently sorted), not just what's
// currently visible. Re-renders the whole block on every sort/Show More
// click (simpler than patching just the tbody, and cheap at a 100-row
// page size).
//
// Column headers cycle through 3 states: ascending -> descending ->
// default (the order `rows` arrived in) -> ascending again. `rows`
// itself is never mutated — originalRows is a pristine snapshot taken
// once up front, and every render computes a sorted VIEW from it — so
// the "default" state always has an intact original order to return to.
function bpRenderClientListInto(container, rows, { arrears = false, showDate = true, filenamePrefix = "clients" } = {}) {
    const allCols = bpClientTableCols();
    const cols = arrears ? bpArrearsTableCols() : (showDate ? allCols : allCols.filter(c => c.key !== "disburseDate"));
    const buildTableHtml = arrears ? bpArrearsTableHtml : (rs => bpClientTableHtml(rs, { showDate }));

    const originalRows = rows.slice();
    let visibleCount = Math.min(BP_LIST_PAGE_SIZE, rows.length);
    let sortKey = null;
    let sortDir = 1;
    let sortType = "text";

    function getDisplayRows() {
        if (!sortKey) return originalRows;
        return originalRows.slice().sort((a, b) => sortDir * bpCompareForSort(a[sortKey], b[sortKey], sortType));
    }

    function render() {
        const displayRows = getDisplayRows();
        const visibleRows = displayRows.slice(0, visibleCount);
        const exportBtnHtml = rows.length
            ? `<div class="op-list-actions"><button type="button" class="op-list-export-btn"><span class="cr-ico cr-ico-download" aria-hidden="true"></span> ${t("creditreport.menu.exportExcel")}</button></div>`
            : "";
        const countHtml = rows.length
            ? `<div class="op-list-count">${t("creditreport.productivity.showingXOfY", { shown: visibleRows.length.toLocaleString(), total: rows.length.toLocaleString() })}</div>`
            : "";
        const moreHtml = visibleCount < rows.length
            ? `<div class="op-list-more-wrap"><button type="button" class="op-list-more-btn">${t("creditreport.productivity.showMore")}</button></div>`
            : "";
        container.innerHTML = exportBtnHtml + buildTableHtml(visibleRows) + countHtml + moreHtml;
        if (!rows.length) return;

        const thead = container.querySelector("thead");
        if (thead) {
            thead.querySelectorAll("th[data-sort-key]").forEach(th => {
                if (th.dataset.sortKey === sortKey) th.classList.add(sortDir === 1 ? "op-sort-asc" : "op-sort-desc");
                th.addEventListener("click", () => {
                    const key = th.dataset.sortKey;
                    const type = th.dataset.sortType || "text";
                    if (sortKey !== key) {
                        sortKey = key; sortType = type; sortDir = 1;
                    } else if (sortDir === 1) {
                        sortDir = -1;
                    } else {
                        sortKey = null; sortType = "text"; sortDir = 1;
                    }
                    render();
                });
            });
        }

        container.querySelector(".op-list-export-btn")?.addEventListener("click", () => {
            bpExportRowsToExcel(getDisplayRows(), cols, filenamePrefix);
        });
        container.querySelector(".op-list-more-btn")?.addEventListener("click", () => {
            visibleCount = Math.min(visibleCount + BP_LIST_PAGE_SIZE, rows.length);
            render();
        });
    }

    render();
}

// ========================================
// LOAN DISBURSE — CALENDAR HEATMAP
// Same mechanism as Officer Productivity's own (opBuildDisburseHeatmapHtml
// etc.) — branch-wide (CO+FSRO+Digital Loan combined into one chart, not
// split into three), reused function-for-function under the bp prefix.
// ========================================
function bpHeatBucket(value, maxValue) {
    if (!value || value <= 0 || !maxValue) return 0;
    const pct = value / maxValue;
    if (pct > 0.7) return 4;
    if (pct > 0.45) return 3;
    if (pct > 0.2) return 2;
    return 1;
}

function bpHeatDow() {
    return [
        t("creditreport.compare.dowSun"), t("creditreport.compare.dowMon"), t("creditreport.compare.dowTue"),
        t("creditreport.compare.dowWed"), t("creditreport.compare.dowThu"), t("creditreport.compare.dowFri"),
        t("creditreport.compare.dowSat")
    ];
}

let bpKhHolidays = new Set();
let bpKhHolidaysPromise = null;
function bpEnsureKhHolidays() {
    if (!bpKhHolidaysPromise) {
        bpKhHolidaysPromise = fetch(`${API.BASE_URL}/api/creditreport/byco/kh-holidays`, {
            headers: { Authorization: `Bearer ${bpToken}` }
        })
            .then(res => res.json())
            .then(data => {
                if (data && data.ok && Array.isArray(data.holidays)) {
                    bpKhHolidays = new Set(data.holidays.map(h => h.date));
                }
            })
            .catch(err => console.error("kh-holidays fetch failed:", err));
    }
    return bpKhHolidaysPromise;
}

function bpBuildDisburseHeatmapHtml(dates, values, counts, branch, meta, totalData) {
    const maxValue = Math.max(0, ...values);
    const firstDow = new Date(dates[0] + "T00:00:00").getDay();

    let cells = bpHeatDow().map(d => `<div class="op-heat-dow">${d}</div>`).join("");
    for (let i = 0; i < firstDow; i++) cells += `<div class="op-heat-cell op-heat-pad"></div>`;

    dates.forEach((dateStr, i) => {
        const day = Number(dateStr.slice(8, 10));
        const value = values[i] || 0;
        const count = counts[i] || 0;
        const bucket = bpHeatBucket(value, maxValue);
        const dow = new Date(dateStr + "T00:00:00").getDay();

        const classes = ["op-heat-cell"];
        if (bucket) classes.push(`op-heat-h${bucket}`);
        if (dow === 0 || dow === 6) classes.push("op-heat-weekend");
        if (bpKhHolidays.has(dateStr)) classes.push("op-heat-holiday");

        cells += `
          <div class="${classes.join(" ")}"
               data-date="${dateStr}" data-value="${value}" data-count="${count}">
            <span class="op-heat-day">${day}</span>
            ${count > 0 ? `<span class="op-heat-badge">${count}</span>` : ""}
          </div>`;
    });

    const displayedMonthKey = dates[0].slice(0, 7);
    const isOriginalMonth = meta && meta.fromDate && displayedMonthKey === meta.fromDate.slice(0, 7);

    let period, totalLoan, totalValue;
    if (isOriginalMonth && meta.toDate) {
        period = `${bpFmtDateDDMMYY(meta.fromDate)}-${bpFmtDateDDMMYY(meta.toDate)}`;
        totalLoan = bpGet(totalData, "loanDisburse.loan");
        totalValue = bpGet(totalData, "loanDisburse.value");
    } else {
        period = `${bpFmtDateDDMMYY(dates[0])}-${bpFmtDateDDMMYY(dates[dates.length - 1])}`;
        totalLoan = counts.reduce((sum, c) => sum + (c || 0), 0);
        totalValue = values.reduce((sum, v) => sum + (v || 0), 0);
    }

    const monthLabel = new Date(dates[0] + "T00:00:00")
        .toLocaleString("en-US", { month: "long", year: "numeric" });

    return `
      <div class="op-heat-title">${t("creditreport.productivity.dailyLoanDisbursement")} — ${bpEscapeHtml(branch)}</div>
      <div class="op-heat-subtitle-group">
        <div class="op-heat-subtitle-line">${t("creditreport.productivity.periodDate")}: ${period}</div>
        <div class="op-heat-subtitle-line">${t("creditreport.productivity.totalDisburse")}: ${bpFmtNum(totalLoan)}LD, USD${bpFmtNum(totalValue)}</div>
      </div>
      <div class="op-heat-grid">${cells}</div>
      <div class="op-heat-legend">
        <span>${t("creditreport.productivity.less")}</span>
        <span class="op-heat-sw op-heat-h0"></span>
        <span class="op-heat-sw op-heat-h1"></span>
        <span class="op-heat-sw op-heat-h2"></span>
        <span class="op-heat-sw op-heat-h3"></span>
        <span class="op-heat-sw op-heat-h4"></span>
        <span>${t("creditreport.productivity.more")}</span>
      </div>
      <div class="op-heat-legend op-heat-legend-2">
        <span class="op-heat-sw op-heat-ring-weekend"></span><span>${t("creditreport.productivity.weekend")}</span>
        <span class="op-heat-sw op-heat-ring-holiday"></span><span>${t("creditreport.productivity.holiday")}</span>
      </div>
      <div class="op-heat-nav">
        <button type="button" class="op-heat-nav-btn" data-dir="prev" aria-label="${t("creditreport.compare.prevMonth")}">‹</button>
        <span class="op-heat-nav-label">${bpEscapeHtml(monthLabel)}</span>
        <button type="button" class="op-heat-nav-btn" data-dir="next" aria-label="${t("creditreport.compare.nextMonth")}">›</button>
      </div>
      <div class="op-heat-day-panel"></div>`;
}

function bpWireDisburseNav(container, onNavigate) {
    container.querySelectorAll(".op-heat-nav-btn").forEach(btn => {
        btn.addEventListener("click", e => {
            e.stopPropagation();
            onNavigate(btn.dataset.dir === "next" ? 1 : -1);
        });
    });
}

function bpShiftMonthKey(anchorKey, delta) {
    const [y, m] = anchorKey.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

let bpHeatTooltipEl = null;
function bpEnsureHeatTooltip() {
    if (!bpHeatTooltipEl) {
        bpHeatTooltipEl = document.createElement("div");
        bpHeatTooltipEl.className = "op-heat-tooltip";
        document.body.appendChild(bpHeatTooltipEl);
    }
    return bpHeatTooltipEl;
}

function bpShowHeatTooltip(cell, tooltip) {
    const date = cell.dataset.date;
    const value = Number(cell.dataset.value);
    const count = Number(cell.dataset.count);
    const [, mm, dd] = date.split("-");
    tooltip.innerHTML = `<span class="op-heat-tt-date">${dd}-${mm}:</span> ` + (
        value > 0 ? `${bpFmtNum(value)} · ${t("creditreport.productivity.loanCount", { count })}` : t("creditreport.productivity.noDisbursement")
    );
    tooltip.classList.add("show");
}

function bpWireHeatmapTooltips(container) {
    const tooltip = bpEnsureHeatTooltip();
    container.querySelectorAll(".op-heat-cell:not(.op-heat-pad)").forEach(cell => {
        cell.addEventListener("mouseenter", () => bpShowHeatTooltip(cell, tooltip));
        cell.addEventListener("mousemove", e => {
            tooltip.style.transform = "";
            tooltip.style.left = `${e.clientX + 14}px`;
            tooltip.style.top = `${e.clientY + 14}px`;
        });
        cell.addEventListener("mouseleave", () => tooltip.classList.remove("show"));
    });
}

// Unlike Officer Productivity's per-day panel (one officer, one bucket
// implicitly), a branch day's disbursements can span CO/FSRO/Digital
// Loan — the heatmap itself is combined, so the day-click panel fetches
// all three buckets in parallel and merges them, rather than adding a
// bucket-less "all" mode to the branch-clients endpoint just for this.
async function bpFetchDayClients(dateKey) {
    const q = bpBuildQuery({ ...bpState.meta, fromDate: dateKey, toDate: dateKey });
    const buckets = ["co", "fsro", "digital"];
    const results = await Promise.all(buckets.map(async bucket => {
        const url = `${API.BASE_URL}/api/creditreport/branch-clients?branch=${encodeURIComponent(bpState.branch)}` +
            `&section=disburse&bucket=${bucket}${q}`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${bpToken}` } });
        if (!res.ok) throw new Error(t("creditreport.productivity.dayClientsLoadFailedRetry"));
        const data = await res.json();
        if (!data.ok) throw new Error(data.message || t("creditreport.productivity.dayClientsLoadFailed"));
        return data.items || [];
    }));
    return results.flat();
}

function bpWireDayClientPanel(container) {
    const panel = container.querySelector(".op-heat-day-panel");
    if (!panel) return;
    let activeDate = null;

    container.querySelectorAll(".op-heat-cell:not(.op-heat-pad)").forEach(cell => {
        cell.addEventListener("click", async e => {
            e.stopPropagation();
            const date = cell.dataset.date;

            container.querySelectorAll(".op-heat-cell.op-heat-cell-selected")
                .forEach(c => c.classList.remove("op-heat-cell-selected"));

            if (activeDate === date) {
                activeDate = null;
                panel.innerHTML = "";
                return;
            }
            activeDate = date;
            cell.classList.add("op-heat-cell-selected");

            const [, mm, dd] = date.split("-");
            const count = Number(cell.dataset.count) || 0;
            const heading = `<div class="op-heat-day-panel-head">${dd}-${mm}: ${count} loan${count === 1 ? "" : "s"}</div>`;

            if (count === 0) {
                panel.innerHTML = `<div class="op-heat-day-panel-head">${dd}-${mm}: No disbursement</div>`;
                return;
            }

            panel.innerHTML = heading + bpSkeletonHtml();
            try {
                const rows = await bpFetchDayClients(date);
                if (activeDate !== date) return;
                panel.innerHTML = heading + `<div class="op-heat-day-panel-body"></div>`;
                bpRenderClientListInto(panel.querySelector(".op-heat-day-panel-body"), rows, {
                    showDate: false,
                    filenamePrefix: `${bpState.branch || "branch"}_disburse_${date}`
                });
            } catch (err) {
                if (activeDate !== date) return;
                panel.innerHTML = heading + bpErrorHtml(err);
            }
        });
    });
}

let bpDisburseChartAnchor = null;

async function bpFetchDisburseChartData(monthOverride) {
    const metaForQuery = monthOverride ? { ...bpState.meta, fromDate: monthOverride } : bpState.meta;
    const q = bpBuildQuery(metaForQuery);
    const url = `${API.BASE_URL}/api/creditreport/branch-disburse-chart?branch=${encodeURIComponent(bpState.branch)}${q}`;

    const holidaysReady = bpEnsureKhHolidays();

    const res = await fetch(url, { headers: { Authorization: `Bearer ${bpToken}` } });
    if (!res.ok) throw new Error(t("creditreport.productivity.chartLoadFailedRetry"));
    const data = await res.json();
    if (!data.ok) throw new Error(data.message || t("creditreport.productivity.chartLoadFailed"));
    await holidaysReady;

    const dates = data.dates || [];
    if (!dates.length) {
        bpDisburseChartData = null;
        return null;
    }
    bpDisburseChartData = { dates, values: data.values || [], counts: data.counts || [] };
    bpDisburseChartAnchor = `${dates[0].slice(0, 7)}-01`;
    return bpDisburseChartData;
}

function bpRenderDisburseHeatmapInto(container, fullscreen) {
    const { dates, values, counts } = bpDisburseChartData;
    const btnHtml = fullscreen
        ? ""
        : `<button type="button" class="op-chart-fullscreen-btn" aria-label="${t("creditreport.productivity.fullscreenChartAria")}"><span class="cr-ico cr-ico-fullscreen" aria-hidden="true"></span></button>`;
    container.innerHTML = btnHtml + bpBuildDisburseHeatmapHtml(dates, values, counts, bpState.branch, bpState.meta, bpState.data?.total);

    bpWireHeatmapTooltips(container);
    bpWireDayClientPanel(container);
    if (!fullscreen) bpWireChartFullscreenTriggers(container);
    bpWireDisburseNav(container, delta => bpNavigateDisburseMonth(delta, container, fullscreen));
}

async function bpNavigateDisburseMonth(delta, container, fullscreen) {
    const newAnchor = bpShiftMonthKey(bpDisburseChartAnchor, delta);
    container.innerHTML = bpSkeletonHtml();
    try {
        const chartData = await bpFetchDisburseChartData(newAnchor);
        if (!chartData) {
            container.innerHTML = `<div class="op-state">No disbursement data for this period.</div>`;
            return;
        }
        bpRenderDisburseHeatmapInto(container, fullscreen);
    } catch (err) {
        container.innerHTML = bpErrorHtml(err);
    }
}

async function bpRenderDisburseChart(wrap) {
    const chartData = await bpFetchDisburseChartData();
    if (!chartData) {
        wrap.innerHTML = `<div class="op-state">No disbursement data for this period.</div>`;
        return;
    }
    bpRenderDisburseHeatmapInto(wrap, false);
}

function bpWireChartFullscreenTriggers(wrap) {
    wrap.addEventListener("click", bpOpenChartFullscreen);
}

async function bpOpenChartFullscreen() {
    if (!bpDisburseChartData) return;
    const overlay = document.getElementById("bpChartFsOverlay");
    const body = document.getElementById("bpChartFsBody");
    if (!overlay || !body) return;

    overlay.hidden = false;
    document.body.style.overflow = "hidden";

    bpRenderDisburseHeatmapInto(body, true);

    try {
        if (overlay.requestFullscreen) await overlay.requestFullscreen();
        else if (overlay.webkitRequestFullscreen) overlay.webkitRequestFullscreen();
    } catch (e) { /* not supported / denied — the CSS overlay alone still works */ }
}

function bpCloseChartFullscreen() {
    const overlay = document.getElementById("bpChartFsOverlay");
    if (!overlay || overlay.hidden) return;

    overlay.hidden = true;
    document.body.style.overflow = "";

    if (document.fullscreenElement === overlay) {
        try { document.exitFullscreen(); } catch (e) { /* no-op */ }
    }
}

document.getElementById("bpChartFsClose")?.addEventListener("click", bpCloseChartFullscreen);

document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement) bpCloseChartFullscreen();
});

// ========================================
// INIT
// ========================================
function bpFinishLoad() {
    document.getElementById("bpPageSkel").style.display = "none";
    bpRenderHeader();
    bpRenderCards();
}

function bpShowEmpty(msg) {
    document.getElementById("bpPageSkel").style.display = "none";
    const el = document.getElementById("bpEmpty");
    el.textContent = msg;
    el.style.display = "block";
}

async function bpInit() {
    const { branch, meta } = bpReadParams();
    bpState.meta = meta;

    if (!branch) {
        bpShowEmpty(t("creditreport.productivity.noBranchSpecified"));
        return;
    }
    bpState.branch = branch;

    try {
        const data = await bpFetchSummary(branch, meta);
        bpState.data = data;
        bpFinishLoad();
    } catch (err) {
        console.error(err);
        bpShowEmpty(err.message || t("creditreport.productivity.networkErrorBranchData"));
    }
}

bpInit();
