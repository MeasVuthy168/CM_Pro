// ========================================
// Credit Portfolio Intelligence — Branch Meeting Report
// One printable report for the meeting with branch management, put
// together from the section's own endpoints (nothing is recalculated
// here, only arranged and worded):
//   1 Summary            /overview (KPIs vs the comparison day) + plain
//                         sentences built from the same figures
//   2 Credit progress    /overview KPIs; /risk by officer (always) and by
//                         branch (All Branches view only); branch-
//                         productivity-summary for the CO/FSRO/Digital
//                         team split (with WO balance)
//   3 Causes of PAR      /causes (confirmed causes only; unclassified shown)
//   4 Solutions          /actions summary; /causes largest loans with the
//                         officer's own cause and solution text
//   5 Forecast           /forecast (Best / Base / Stress, confidence) and
//                         /customers/prediction (only when validated)
//   6 Customers to watch /customers (largest PAR, PAR concentration and
//                         movement since the comparison day)
//   7 Top risk            /risk rows, re-ranked by NPL $ growth and PAR pts
//     contributors        growth, per branch / officer / product
//   8 Decisions          a table typed in during the meeting (printed, not
//                         saved) and signature lines
// Admin and user only (ci-filters.js gate + the server).
// ========================================

const t = CI.t;
const mrToken = () => localStorage.getItem("token") || sessionStorage.getItem("token");
let mrSeq = 0;
let mrBranches = null;

// Parallel GETs (CI.get keeps only the newest call, so it can't be used
// for several at once).
async function mrGet(path, params) {
    const q = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== "") q.set(k, v); });
    try {
        const res = await fetch(`${API.BASE_URL}/api/credit-intelligence/${path}?${q}`, { headers: { Authorization: `Bearer ${mrToken()}` } });
        const data = await res.json();
        return data && data.ok ? data : null;
    } catch (e) {
        console.error(e);
        return null;
    }
}

// CO / FSRO / Digital Loan breakdown — the same endpoint Branch
// Productivity uses (cm-backend's computeBranchProductivity()).
// branch="" asks for every branch combined ("All Branch" is the
// server's own magic value for that, same as tapping the Total row on
// Branch Productivity).
async function mrTeamSplit(branch) {
    try {
        const res = await fetch(`${API.BASE_URL}/api/creditreport/branch-productivity-summary?branch=${encodeURIComponent(branch || "All Branch")}`, { headers: { Authorization: `Bearer ${mrToken()}` } });
        const data = await res.json();
        return data && data.ok ? data : null;
    } catch (e) {
        console.error(e);
        return null;
    }
}

const mrPct = (v, d = 2) => (v === null || v === undefined ? "—" : `${(v * 100).toFixed(d)}%`);
const mrPts = v => (v === null || v === undefined ? "—" : `${v > 0 ? "+" : ""}${(v * 100).toFixed(2)} ${t("creditreport.pi.pts")}`);
const mrMonth = m => { const [y, mo] = String(m || "").split("-"); return y ? `${mo}/${y}` : "—"; };
const mrUser = () => {
    try {
        const u = JSON.parse(localStorage.getItem("loggedInUser") || sessionStorage.getItem("loggedInUser") || "{}");
        return u.fullName || u.name || u.username || "";
    } catch (e) {
        return "";
    }
};

// A change cell: arrow coloured by whether the move is good.
function mrChange(diff, better, fmt) {
    if (diff === null || diff === undefined || !isFinite(diff)) return `<span class="mr-flat">—</span>`;
    if (Math.abs(diff) < 1e-9) return `<span class="mr-flat">0</span>`;
    const good = better === "down" ? diff < 0 : diff > 0;
    return `<span class="${good ? "mr-good" : "mr-bad"}">${diff > 0 ? "▲" : "▼"} ${fmt(Math.abs(diff))}</span>`;
}

// The picked data date ("" = latest). A past date builds the report from
// that day's Daily History snapshots (cm-backend ?asOf=): sections 1, 2
// and 7 only — causes, follow-up, forecast and customers are live-only.
function mrAsOf() {
    const v = (document.getElementById("mrAsOf") || {}).value || "";
    return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "";
}

// 2.3 By team for a saved day: that day's own CO / FSRO / Digital rows
// (branch Daily History), PAR = NBC Overdue like the rest of the report.
async function mrSavedTeamSplit(branch, date) {
    const q = new URLSearchParams({ dateFrom: date, dateTo: date });
    if (branch) q.set("branch", branch); else q.set("totalOnly", "1");
    try {
        const res = await fetch(`${API.BASE_URL}/api/creditreport/summary/history?${q}`, { headers: { Authorization: `Bearer ${mrToken()}` } });
        const data = await res.json();
        const day = data && data.ok && Array.isArray(data.days) ? data.days.find(x => x.date === date) : null;
        const item = day ? (branch ? (day.items || [])[0] : day.total) : null;
        if (!item) return null;
        const nbc = x => (x ? { ...x, parT24: { parPct: ((x.nbcOverdue && x.nbcOverdue.total) || {}).parPct } } : null);
        const bd = item.breakdown || {};
        return { co: nbc(bd.co), fsro: nbc(bd.fsro), digital: nbc(bd.digital), total: nbc(item) };
    } catch (e) {
        console.error(e);
        return null;
    }
}

async function mrLoad() {
    if (!CI.allowed()) return;
    const mine = ++mrSeq;
    const branch = document.getElementById("mrBranch").value;
    const compare = document.getElementById("mrCompare").value;
    const asOf = mrAsOf();
    const base = asOf ? { branch, compare, asOf } : { branch, compare };
    if (typeof showAppLoading === "function") showAppLoading(t("creditreport.pi.loading"), { progress: true, key: "mr" });
    try {
        // The server builds at most 2 section reads at once; asking for
        // 3 at a time keeps one queued without flooding it.
        const none = async () => null;
        const jobs = asOf ? [
            () => mrGet("overview", base),
            () => mrGet("risk", { ...base, dim: "officer" }),
            () => mrGet("risk", { compare, asOf, dim: "branch" }),
            () => mrGet("risk", { ...base, dim: "product" }),
            none, none, none, none, none,
            // The plan of the saved day's month against that day's figures.
            () => CIPlan.branch(branch ? [branch] : [], asOf),
            () => CIPlan.officers(asOf),
            () => CIPlan.branchRows(asOf),
            () => mrSavedTeamSplit(branch, asOf),
            () => mrGet("recovery", { branch, dim: "branch", ytd: "1", toDate: asOf }),
            () => mrGet("recovery", { branch, dim: "officer", ytd: "1", toDate: asOf })
        ] : [
            () => mrGet("overview", base),
            () => mrGet("risk", { ...base, dim: "officer" }),
            () => mrGet("risk", { compare, dim: "branch" }),
            () => mrGet("risk", { ...base, dim: "product" }),
            () => mrGet("causes", { branch, limit: 10 }),
            () => mrGet("actions", { branch, view: "all", limit: 10 }),
            () => mrGet("forecast", { dim: branch ? "branch" : "portfolio", horizon: 3 }),
            () => mrGet("customers/prediction", { branch, unit: "loan", top: 20 }),
            () => mrGet("customers", { branch, compare, top: 10, sort: "par" }),
            () => CIPlan.branch(branch ? [branch] : []),
            () => CIPlan.officers(),
            () => CIPlan.branchRows(),
            () => mrTeamSplit(branch),
            // NPL Collected = NPL recovered (left NPL) year to date, against
            // the NPL Recovery plan as a yearly target — like WO Collected.
            () => mrGet("recovery", { branch, dim: "branch", ytd: "1" }),
            () => mrGet("recovery", { branch, dim: "officer", ytd: "1" })
        ];
        const out = await mrPool(jobs, 3, (n, total) => {
            if (mine === mrSeq && typeof showAppLoading === "function") showAppLoading(t("creditreport.mr.loadingN", { n, total }), { progress: true, key: "mr" });
        });
        const [ov, team, branchRisk, prod, causes, actions, fc, pred, cust, plan, teamPlan, branchPlan, teamSplit, recB, recO] = out;
        if (mine !== mrSeq) return;
        if (!ov) { CI.toast(asOf ? t("creditreport.mr.noSnapshot", { date: CI.dmy(asOf) }) : t("creditreport.pi.loadFailed"), "error"); return; }
        mrFillBranches(ov);
        const g = fc && fc.groups ? (branch ? fc.groups.find(x => x.key === branch) : fc.groups[0]) : null;
        mrRender({ branch, compare, asOf, recB, recO, ov, team, branchRisk, prod, causes, actions, fc, g, pred, cust, plan, teamPlan, branchPlan, teamSplit });
    } finally {
        if (mine === mrSeq && typeof hideAppLoading === "function") hideAppLoading();
    }
}

// Runs the jobs `size` at a time, in order; results keep the jobs' order.
async function mrPool(jobs, size, onProgress) {
    const out = new Array(jobs.length);
    let next = 0, done = 0;
    async function worker() {
        while (next < jobs.length) {
            const i = next++;
            out[i] = await jobs[i]();
            done++;
            if (onProgress) onProgress(done, jobs.length);
        }
    }
    await Promise.all(Array.from({ length: Math.min(size, jobs.length) }, worker));
    return out;
}

function mrFillBranches(ov) {
    if (mrBranches) return;
    mrBranches = (ov.options && ov.options.branches) || [];
    const sel = document.getElementById("mrBranch");
    const keep = sel.value;
    sel.innerHTML = `<option value="">${CI.esc(t("creditreport.mr.allBranches"))}</option>` + mrBranches.map(b => `<option value="${CI.esc(b)}">${CI.esc(b)}</option>`).join("");
    sel.value = keep;
}

function mrRender(d) {
    document.getElementById("mrReport").hidden = false;
    const k = d.ov.kpis;
    const cmp = d.ov.comparison || {};
    const branchName = d.branch || t("creditreport.mr.allBranches");
    document.getElementById("mrMeta").innerHTML = [
        [t("creditreport.pi.branch"), branchName],
        [t("creditreport.mr.dataAsOf"), d.asOf ? `${CI.dmy(d.asOf)} (${t("creditreport.mr.fromHistory")})` : d.ov.asOf ? d.ov.asOf.osText : "—"],
        [t("creditreport.mr.compare"), cmp.available ? CI.dmy(cmp.date) : t("creditreport.mr.noCompare")],
        [t("creditreport.mr.preparedOn"), CI.dmy(new Date().toISOString().slice(0, 10))]
    ].map(([a, b]) => `<div><span>${CI.esc(a)}</span><b>${CI.esc(b)}</b></div>`).join("");

    // 1. Summary tiles + sentences
    const tile = (label, value, change, sub) => `<div class="mr-tile"><div class="mr-tile-l">${CI.esc(label)}</div><div class="mr-tile-v">${value}</div><div class="mr-tile-c">${change}</div>${sub ? `<div class="mr-tile-s">${sub}</div>` : ""}</div>`;
    document.getElementById("mrTiles").innerHTML = [
        tile(t("creditreport.mr.k.os"), CI.money(k.outstanding.cur), mrChange(k.outstanding.diff, "up", CI.money)),
        tile(t("creditreport.mr.k.disb"), CI.money(k.disbursement.cur), mrChange(k.disbursement.diff, "up", CI.money)),
        tile("PAR %", mrPct(k.parPct.cur), mrChange(k.parPct.diff, "down", v => `${(v * 100).toFixed(2)} ${t("creditreport.pi.pts")}`), CI.esc(CI.money(k.parPct.value))),
        tile("NPL %", mrPct(k.nplPct.cur), mrChange(k.nplPct.diff, "down", v => `${(v * 100).toFixed(2)} ${t("creditreport.pi.pts")}`), CI.esc(CI.money(k.nplValue.cur))),
        ...mrCollectedTiles(d, tile)
    ].join("");
    document.getElementById("mrPoints").innerHTML = mrPointsOf(d).map(p => `<li class="mr-pt-${p.tone}">${CI.esc(p.text)}</li>`).join("");

    // 2. The 4 Daily Monitoring reports: branch, officer (or branch), product, location
    mrRenderProgress(d);
    mrRenderTeam(d);
    mrRenderCauses(d);
    mrRenderActions(d);
    mrRenderForecast(d);
    mrRenderCustomers(d);
    mrRenderRiskContrib(d);
    mrRenderDecisions();
    mrNumberSections(!!d.asOf);
    document.getElementById("mrFoot").textContent = t("creditreport.mr.foot");
}

// A saved day has no causes / follow-up / forecast / customers (they're
// live-only): those sections are left out and the rest renumbered 1…n.
function mrNumberSections(saved) {
    const live = ["mrS3", "mrS4", "mrS5", "mrS6"];
    let n = 0;
    document.querySelectorAll("#mrReport .mr-sec").forEach(sec => {
        const h = sec.querySelector("h2.mr-h");
        if (h && live.includes(h.id)) sec.hidden = saved;
        if (sec.hidden) return;
        n++;
        const num = sec.querySelector(".mr-n");
        if (num) num.textContent = String(n);
        sec.querySelectorAll(".mr-n2").forEach(x => {
            if (!x.dataset.sub) x.dataset.sub = x.textContent.split(".")[1] || "";
            x.textContent = `${n}.${x.dataset.sub}`;
        });
    });
}

// ---------- WO Collected / NPL Collected ----------
// WO Collected: write-offs collected (interest + principal), year to date,
// against the yearly plan (the branch plan's woCollected). NPL Collected:
// NPL loans that left NPL year to date (Recovery Performance's
// "recovered", ?ytd=1), against the NPL Recovery plan taken as a yearly
// target. A saved day closes on that day's saved NPL list.
function mrNplCollected(d) {
    const mv = d.recB && d.recB.movement;
    const k = mv && mv.available ? d.recB.kpis : null;
    if (!k) return null;
    return {
        actual: k.recovered.value, loans: k.recovered.count, plan: k.target && k.target.value ? k.target.value : null,
        // NPL history younger than the year: measured from its first day.
        since: mv.openedLate ? mv.openingDate : null
    };
}
// "Year to date · n loans left NPL", or "Since dd/mm/yyyy · …".
function mrNplCollectedSub(npl) {
    if (!npl) return t("creditreport.mr.nplNoHistory");
    return npl.since
        ? t("creditreport.mr.nplCollectedSince", { date: CI.dmy(npl.since), n: CI.num(npl.loans) })
        : t("creditreport.mr.nplCollectedSub", { n: CI.num(npl.loans) });
}
function mrAchText(actual, plan) {
    return plan ? t("creditreport.mr.ofPlan", { pct: `${Math.round((actual / plan) * 100)}%` }) : t("creditreport.mr.noTarget");
}
function mrCollectedTiles(d, tile) {
    const wo = d.plan && d.plan.metrics ? d.plan.metrics.woCollected : null;
    const npl = mrNplCollected(d);
    const tone = (a, p) => (!p ? "mr-flat" : a / p >= 1 ? "mr-good" : a / p >= 0.9 ? "mr-flat" : "mr-bad");
    return [
        tile(t("creditreport.mr.k.woCollected"),
            wo && wo.actual !== null && wo.actual !== undefined ? CI.money(wo.actual) : "—",
            wo && wo.actual !== null && wo.actual !== undefined ? `<span class="${tone(wo.actual, wo.plan)}">${CI.esc(mrAchText(wo.actual, wo.plan))}</span>` : "",
            CI.esc(t("creditreport.mr.ytd"))),
        tile(t("creditreport.mr.k.nplCollected"),
            npl ? CI.money(npl.actual) : "—",
            npl ? `<span class="${tone(npl.actual, npl.plan)}">${CI.esc(mrAchText(npl.actual, npl.plan))}</span>` : "",
            CI.esc(mrNplCollectedSub(npl)))
    ];
}
// Per row (officer / branch): WO Collected (actual, yearly plan) and NPL
// Collected (recovered this month, the branch's target).
function mrRecoveryByKey(rec) {
    const rows = rec && rec.movement && rec.movement.available ? rec.byDim || [] : null;
    return rows ? new Map(rows.map(r => [String(r.key), r])) : new Map();
}
function mrCollectedCells(wo, rec) {
    const F = CIPlan.fmt;
    const w = wo || {};
    return `<td class="num">${F("amount", w.actual)}</td><td class="num">${F("amount", w.plan)}</td>` +
        `<td class="num">${rec ? CI.money(rec.left.value) : "—"}</td><td class="num">${rec && rec.target ? CI.money(rec.target) : "—"}</td>`;
}
// The NPL Collected row of 2.1 (added to CIPlan.table's own rows).
function mrNplCollectedRow(d, withLm) {
    const npl = mrNplCollected(d);
    const cell = npl ? { actual: npl.actual, plan: npl.plan, ach: npl.plan ? npl.actual / npl.plan : null } : null;
    const sub = mrNplCollectedSub(npl);
    return `<tr><td>${CI.esc(t("creditreport.mr.k.nplCollected"))}<div class="ci-plan-sub">${CI.esc(sub)}</div></td><td class="num"><b>${npl ? CI.money(npl.actual) : "—"}</b></td>${withLm ? `<td class="num">—</td>` : ""}<td class="num">${npl && npl.plan ? CI.money(npl.plan) : "—"}</td><td class="num ci-plan-ach">${CIPlan.achCell({ kind: "amount" }, cell)}</td></tr>`;
}

// 2.1 for a saved day: the day against the comparison day (no Monthly
// Plan — it only exists against the live figures).
function mrSavedProgress(d) {
    const k = d.ov.kpis;
    const cmp = d.ov.comparison || {};
    const money = v => (v === null || v === undefined ? "—" : CI.money(v));
    const num = v => (v === null || v === undefined ? "—" : CI.num(v));
    const rows = [
        [t("creditreport.mr.k.os"), money(k.outstanding.cur), money(k.outstanding.prev), mrChange(k.outstanding.diff, "up", CI.money)],
        [t("creditreport.plan.m.osCount"), num(k.outstanding.loans), "—", ""],
        [t("creditreport.mr.k.disb"), money(k.disbursement.cur), money(k.disbursement.prev), mrChange(k.disbursement.diff, "up", CI.money)],
        ["PAR %", mrPct(k.parPct.cur), mrPct(k.parPct.prev), mrChange(k.parPct.diff, "down", v => `${(v * 100).toFixed(2)} ${t("creditreport.pi.pts")}`)],
        ["NPL %", mrPct(k.nplPct.cur), mrPct(k.nplPct.prev), mrChange(k.nplPct.diff, "down", v => `${(v * 100).toFixed(2)} ${t("creditreport.pi.pts")}`)],
        [t("creditreport.mr.nplValue"), money(k.nplValue.cur), money(k.nplValue.prev), mrChange(k.nplValue.diff, "down", CI.money)],
        [t("creditreport.mr.nplAccounts"), num(k.nplAccounts.cur), num(k.nplAccounts.prev), mrChange(k.nplAccounts.diff, "down", CI.num)]
    ];
    return `<thead><tr><th>${CI.esc(t("creditreport.mr.metric"))}</th><th class="num">${CI.esc(CI.dmy(d.asOf))}</th><th class="num">${CI.esc(cmp.available ? CI.dmy(cmp.date) : t("creditreport.mr.noCompare"))}</th><th class="num">${CI.esc(t("creditreport.mr.change"))}</th></tr></thead><tbody>
        ${rows.map(([a, b, c, e]) => `<tr><td>${CI.esc(a)}</td><td class="num">${b}</td><td class="num">${c}</td><td class="num">${e}</td></tr>`).join("")}</tbody>`;
}

// Plain sentences from the figures (no new numbers).
function mrPointsOf(d) {
    const k = d.ov.kpis;
    const out = [];
    const pts = v => `${(Math.abs(v) * 100).toFixed(2)} ${t("creditreport.pi.pts")}`;
    if (k.parPct.diff !== null && k.parPct.diff !== undefined) {
        out.push({ tone: k.parPct.diff > 0 ? "bad" : "good", text: t(k.parPct.diff > 0 ? "creditreport.mr.p.parUp" : "creditreport.mr.p.parDown", { pct: mrPct(k.parPct.cur), pts: pts(k.parPct.diff) }) });
    }
    if (k.nplPct.diff !== null && k.nplPct.diff !== undefined) {
        out.push({ tone: k.nplPct.diff > 0 ? "bad" : "good", text: t(k.nplPct.diff > 0 ? "creditreport.mr.p.nplUp" : "creditreport.mr.p.nplDown", { pct: mrPct(k.nplPct.cur), pts: pts(k.nplPct.diff), n: CI.num(k.nplAccounts.cur) }) });
    }
    if (k.outstanding.pct !== null && k.outstanding.pct !== undefined) {
        out.push({ tone: k.outstanding.diff >= 0 ? "good" : "bad", text: t("creditreport.mr.p.os", { os: CI.money(k.outstanding.cur), pct: CI.signedPct(k.outstanding.pct) }) });
    }
    const top = mrTopCause(d.causes);
    if (top) out.push({ tone: "info", text: t("creditreport.mr.p.cause", { cause: t(`creditreport.rc.c.${top.key}`), share: mrPct(top.share, 0) }) });
    if (d.causes && d.causes.classified && d.causes.classified.pct !== null && d.causes.classified.pct < 0.8) {
        out.push({ tone: "warn", text: t("creditreport.mr.p.unclassified", { pct: mrPct(1 - d.causes.classified.pct, 0) }) });
    }
    const s = d.actions && d.actions.summary;
    if (s && (s.noAction.loans || s.followUpOverdue.loans || s.ptpBroken.loans)) {
        out.push({ tone: "warn", text: t("creditreport.mr.p.actions", { none: CI.num(s.noAction.loans), late: CI.num(s.followUpOverdue.loans), broken: CI.num(s.ptpBroken.loans) }) });
    }
    if (d.g && d.g.available) {
        const b = d.g.forecast.base[d.g.forecast.base.length - 1];
        out.push({ tone: "info", text: t("creditreport.mr.p.forecast", { month: mrMonth(b.month), pct: mrPct(b.parPct), conf: t(`creditreport.pf.conf.${d.g.confidence.level}`) }) });
    }
    if (d.pred && d.pred.display && d.pred.summary.expectedRoll !== null) {
        out.push({ tone: "warn", text: t("creditreport.mr.p.roll", { amt: CI.money(d.pred.summary.expectedRoll), days: d.pred.model.horizon }) });
    }
    return out;
}

function mrTopCause(c) {
    if (!c || !c.byCause || !c.total) return null;
    const list = Object.entries(c.byCause).filter(([key]) => key !== "unclassified").map(([key, v]) => ({ key, ...v, share: v.par / c.total }));
    list.sort((a, b) => b.par - a.par);
    return list[0] && list[0].par > 0 ? list[0] : null;
}

function mrRenderProgress(d) {
    const k = d.ov.kpis;
    const p = d.plan;
    const month = p && p.month ? p.month.split("-").reverse().join("/") : "—";
    const planNote = !p ? t("creditreport.plan.none")
        : p.hasPlan ? t("creditreport.plan.note", { month, to: CI.dmy(p.toDate), done: p.daysDone, days: p.daysInMonth })
        : t("creditreport.plan.notSet", { month });
    // A saved day: say the figures are that day's Daily History (PAR = NBC).
    document.getElementById("mrPlanNote").textContent = d.asOf ? `${t("creditreport.mr.savedNote")} ${planNote}` : planNote;
    document.getElementById("mrBranchTitle").textContent = d.branch ? `${t("creditreport.mr.byBranchOne")} — ${d.branch}` : t("creditreport.mr.byBranchAll");
    const avail = d.ov.comparison && d.ov.comparison.available;
    const lm = avail ? {
        osAmount: k.outstanding.prev, disbAmount: k.disbursement.prev,
        nbcOverduePct: k.parPct.prev === null || k.parPct.prev === undefined ? null : k.parPct.prev * 100,
        nplPct: k.nplPct.prev === null || k.nplPct.prev === undefined ? null : k.nplPct.prev * 100
    } : null;
    document.getElementById("mrProgress").innerHTML = d.asOf && !(p && p.metrics) ? mrSavedProgress(d) : p && p.metrics
        ? CIPlan.table(p, { lastMonth: lm, lmLabel: d.compare === "month" ? "creditreport.plan.lastMonth" : "creditreport.mr.before", keys: ["osAmount", "osCount", "osClients", "osKhr", "osSmall", "disbAmount", "disbCount", "losCount", "nbcOverduePct", "nplPct", "woCollected", "woYtd"] })
            .replace(/<\/tbody>$/, `${mrNplCollectedRow(d, !!lm)}</tbody>`)
        : "";
    mrRenderTeamSplit(d);
    mrRenderTeam(d);
    mrRenderBranchDim(d);
    mrRenderDim("mrProduct", d.prod, 12);
    mrRenderDaily(d);
    mrChartPlan(d);
    mrChartMonthly(d);
    const blocked = [d.prod].some(x => x && x.rows && x.rows.length && x.rows.every(r => !r.prev));
    document.getElementById("mrLmNote").textContent = [
        d.branch && blocked ? t("creditreport.mr.lmAllOnly") : "",
        t("creditreport.mr.planDims")
    ].filter(Boolean).join(" ");
}

// Officers — of the branch when one is picked, every officer company-wide
// otherwise (with the branch shown under each name): Actual · last month ·
// plan. Always "by officer" now; the branch-level view lives in its own
// block (mrRenderBranchDim), shown only when no branch is picked.
function mrRenderTeam(d) {
    mrChartTeam(d);
    const showBranch = !d.branch;
    const rows = d.team && d.team.rows ? d.team.rows.slice().sort((a, b) => b.os - a.os).slice(0, 25) : [];
    const plans = new Map(((d.teamPlan && d.teamPlan.rows) || []).map(r => [String(r.id), r.metrics]));
    const rec = mrRecoveryByKey(d.recO);
    const F = CIPlan.fmt;
    const ach = (m, c) => CIPlan.achCell(CIPlan.METRICS.find(x => x.key === m), c);
    const pct = v => (v === null || v === undefined ? "—" : `${(v * 100).toFixed(2)}%`);
    document.getElementById("mrTeam").innerHTML = rows.length ? `<thead>
        <tr><th rowspan="2">${CI.esc(t("creditreport.mr.officer"))}</th><th colspan="4" class="mr-grp">${CI.esc(t("creditreport.mr.k.os"))}</th><th colspan="3" class="mr-grp">${CI.esc(t("creditreport.mr.k.disb"))}</th><th colspan="3" class="mr-grp">PAR %</th><th colspan="2" class="mr-grp">NPL %</th><th colspan="2" class="mr-grp">${CI.esc(t("creditreport.mr.k.woCollected"))}</th><th colspan="2" class="mr-grp">${CI.esc(t("creditreport.mr.k.nplCollected"))}</th></tr>
        <tr>${[["plan.actual"], ["plan.lastMonth"], ["plan.plan"], ["plan.ach"], ["plan.actual"], ["plan.plan"], ["plan.ach"], ["plan.actual"], ["plan.lastMonth"], ["plan.plan"], ["plan.actual"], ["plan.plan"], ["plan.actual"], ["plan.plan"], ["plan.actual"], ["mr.target"]].map(([k]) => `<th class="num">${CI.esc(t(`creditreport.${k}`))}</th>`).join("")}</tr></thead><tbody>
        ${rows.map(r => {
            const pm = plans.get(String(r.key)) || {};
            const os = pm.osAmount || { actual: r.os, plan: null };
            const db = pm.disbAmount || { actual: r.disb, plan: null };
            const par = pm.nbcOverduePct || {};
            const npl = pm.nplPct || {};
            return `<tr><td>${CI.esc(r.name || r.key)}${showBranch && r.branch ? `<div class="mr-sub">${CI.esc(r.branch)}</div>` : ""}</td>
                <td class="num">${F("amount", r.os)}</td><td class="num">${r.prev ? F("amount", r.prev.os) : "—"}</td><td class="num">${F("amount", os.plan)}</td><td class="num ci-plan-ach">${ach("osAmount", { ...os, actual: r.os })}</td>
                <td class="num">${F("amount", r.disb)}</td><td class="num">${F("amount", db.plan)}</td><td class="num ci-plan-ach">${ach("disbAmount", { ...db, actual: r.disb })}</td>
                <td class="num">${pct(r.parPct)}</td><td class="num">${r.prev ? pct(r.prev.parPct) : "—"}</td><td class="num">${F("pct", par.plan)}</td>
                <td class="num">${pct(r.nplPct)}</td><td class="num">${F("pct", npl.plan)}</td>
                ${mrCollectedCells(pm.woCollected, rec.get(String(r.key)))}</tr>`;
        }).join("")}</tbody>` : `<tbody><tr><td>${CI.esc(t("creditreport.pi.nothing"))}</td></tr></tbody>`;
}

// Every branch, side by side — shown only in the All Branches view (one
// branch already has its own progress in 2.1, so a one-row table here
// would be redundant).
function mrRenderBranchDim(d) {
    const block = document.getElementById("mrBranchDimBlock");
    if (d.branch) {
        block.hidden = true;
        mrChart("mrChBranchDim", null);
        return;
    }
    block.hidden = false;
    mrChartBranchDim(d);
    const rows = d.branchRisk && d.branchRisk.rows ? d.branchRisk.rows.slice().sort((a, b) => b.os - a.os).slice(0, 25) : [];
    const plans = new Map(((d.branchPlan && d.branchPlan.rows) || []).map(r => [String(r.id), r.metrics]));
    const rec = mrRecoveryByKey(d.recB);
    const F = CIPlan.fmt;
    const ach = (m, c) => CIPlan.achCell(CIPlan.METRICS.find(x => x.key === m), c);
    const pct = v => (v === null || v === undefined ? "—" : `${(v * 100).toFixed(2)}%`);
    document.getElementById("mrBranchDim").innerHTML = rows.length ? `<thead>
        <tr><th rowspan="2">${CI.esc(t("creditreport.pi.branch"))}</th><th colspan="4" class="mr-grp">${CI.esc(t("creditreport.mr.k.os"))}</th><th colspan="3" class="mr-grp">${CI.esc(t("creditreport.mr.k.disb"))}</th><th colspan="3" class="mr-grp">PAR %</th><th colspan="2" class="mr-grp">NPL %</th><th colspan="2" class="mr-grp">${CI.esc(t("creditreport.mr.k.woCollected"))}</th><th colspan="2" class="mr-grp">${CI.esc(t("creditreport.mr.k.nplCollected"))}</th></tr>
        <tr>${[["plan.actual"], ["plan.lastMonth"], ["plan.plan"], ["plan.ach"], ["plan.actual"], ["plan.plan"], ["plan.ach"], ["plan.actual"], ["plan.lastMonth"], ["plan.plan"], ["plan.actual"], ["plan.plan"], ["plan.actual"], ["plan.plan"], ["plan.actual"], ["mr.target"]].map(([k]) => `<th class="num">${CI.esc(t(`creditreport.${k}`))}</th>`).join("")}</tr></thead><tbody>
        ${rows.map(r => {
            const pm = plans.get(String(r.name || r.key)) || {};
            const os = pm.osAmount || { actual: r.os, plan: null };
            const db = pm.disbAmount || { actual: r.disb, plan: null };
            const par = pm.nbcOverduePct || {};
            const npl = pm.nplPct || {};
            return `<tr><td>${CI.esc(r.name || r.key)}</td>
                <td class="num">${F("amount", r.os)}</td><td class="num">${r.prev ? F("amount", r.prev.os) : "—"}</td><td class="num">${F("amount", os.plan)}</td><td class="num ci-plan-ach">${ach("osAmount", { ...os, actual: r.os })}</td>
                <td class="num">${F("amount", r.disb)}</td><td class="num">${F("amount", db.plan)}</td><td class="num ci-plan-ach">${ach("disbAmount", { ...db, actual: r.disb })}</td>
                <td class="num">${pct(r.parPct)}</td><td class="num">${r.prev ? pct(r.prev.parPct) : "—"}</td><td class="num">${F("pct", par.plan)}</td>
                <td class="num">${pct(r.nplPct)}</td><td class="num">${F("pct", npl.plan)}</td>
                ${mrCollectedCells(pm.woCollected, rec.get(String(r.key)))}</tr>`;
        }).join("")}</tbody>` : `<tbody><tr><td>${CI.esc(t("creditreport.pi.nothing"))}</td></tr></tbody>`;
}

// CO / FSRO / Digital Loan — one branch (or every branch combined when
// none is picked), from branch-productivity-summary.
function mrRenderTeamSplit(d) {
    const s = d.teamSplit;
    mrChartTeamSplit(s);
    const box = document.getElementById("mrTeamSplit");
    if (!s) { box.innerHTML = `<tbody><tr><td>${CI.esc(t("creditreport.pi.nothing"))}</td></tr></tbody>`; return; }
    const buckets = [
        ["co", t("creditreport.byBranch.teamCo")],
        ["fsro", t("creditreport.byCO.fsro")],
        ["digital", t("creditreport.byBranch.teamDigital")],
        ["total", t("creditreport.risk.total")]
    ];
    const pct = v => (v === null || v === undefined ? "—" : `${(v * 100).toFixed(2)}%`);
    box.innerHTML = `<thead><tr><th>${CI.esc(t("creditreport.mr.byTeam"))}</th><th class="num">${CI.esc(t("creditreport.mr.k.os"))}</th><th class="num">${CI.esc(t("creditreport.mr.k.disb"))}</th><th class="num">PAR %</th><th class="num">NPL %</th><th class="num">${CI.esc(t("creditreport.detail.woBalanceWO"))}</th></tr></thead><tbody>
        ${buckets.map(([key, label]) => {
            const b = s[key] || {};
            const os = (b.loanOutstanding || {}).value;
            const disb = (b.loanDisburse || {}).value;
            const par = (b.parT24 || {}).parPct;
            const npl = (b.nbcOverdue && b.nbcOverdue.nonPerformingLoan || {}).parPct;
            const wo = (b.writeOff || {}).balanceWO || {};
            const woCell = wo.prn === undefined ? "—" : `${CI.money(wo.prn)}${wo.cif ? `<div class="mr-sub">${CI.num(wo.cif)} ${CI.esc(t("creditreport.detail.colCifHash"))}</div>` : ""}`;
            return `<tr${key === "total" ? ' class="mr-total"' : ""}><td>${CI.esc(label)}</td><td class="num">${CI.money(os)}</td><td class="num">${CI.money(disb)}</td><td class="num">${pct(par)}</td><td class="num">${pct(npl)}</td><td class="num">${woCell}</td></tr>`;
        }).join("")}</tbody>`;
}

// Product / location: now and last month (no plan for these reports).
function mrRenderDim(id, data, top) {
    const rows = data && data.rows ? data.rows.slice().sort((a, b) => b.os - a.os).slice(0, top) : [];
    const pct = v => (v === null || v === undefined ? "—" : `${(v * 100).toFixed(2)}%`);
    document.getElementById(id).innerHTML = rows.length ? `<thead><tr><th>${CI.esc(t("creditreport.mr.name"))}</th><th class="num">${CI.esc(t("creditreport.mr.k.os"))}</th><th class="num">${CI.esc(t("creditreport.plan.lastMonth"))}</th><th class="num">${CI.esc(t("creditreport.mr.k.disb"))}</th><th class="num">PAR %</th><th class="num">${CI.esc(t("creditreport.plan.lastMonth"))}</th><th class="num">NPL %</th></tr></thead><tbody>
        ${rows.map(r => `<tr><td>${CI.esc(r.name || r.key || "—")}</td><td class="num">${CI.money(r.os)}</td><td class="num">${r.prev ? CI.money(r.prev.os) : "—"}</td><td class="num">${CI.money(r.disb)}</td><td class="num">${pct(r.parPct)}${r.prev ? ` ${mrChange(r.parChange, "down", v => (v * 100).toFixed(2))}` : ""}</td><td class="num">${r.prev ? pct(r.prev.parPct) : "—"}</td><td class="num">${pct(r.nplPct)}</td></tr>`).join("")}</tbody>` : `<tbody><tr><td>${CI.esc(t("creditreport.pi.nothing"))}</td></tr></tbody>`;
}

function mrRenderCauses(d) {
    const c = d.causes;
    mrChartCauses(c);
    const box = document.getElementById("mrCauses");
    if (!c) { box.innerHTML = ""; document.getElementById("mrCauseNote").textContent = t("creditreport.pi.loadFailed"); return; }
    document.getElementById("mrCauseNote").textContent = t("creditreport.mr.causeNote", { pct: mrPct(c.classified.pct, 0), par: CI.money(c.total), n: CI.num(c.loans) });
    const list = Object.entries(c.byCause).map(([key, v]) => ({ key, ...v })).filter(x => x.loans > 0).sort((a, b) => (a.key === "unclassified") - (b.key === "unclassified") || b.par - a.par);
    box.innerHTML = `<thead><tr><th>${CI.esc(t("creditreport.mr.cause"))}</th><th class="num">${CI.esc(t("creditreport.cp.loans"))}</th><th class="num">PAR</th><th class="num">${CI.esc(t("creditreport.mr.share"))}</th></tr></thead><tbody>
        ${list.map(x => `<tr${x.key === "unclassified" ? ' class="mr-muted"' : ""}><td>${CI.esc(t(x.key === "unclassified" ? "creditreport.rc.unclassified" : `creditreport.rc.c.${x.key}`))}</td><td class="num">${CI.num(x.loans)}</td><td class="num">${CI.money(x.par)}</td><td class="num"><span class="mr-bar"><span style="width:${c.total ? Math.round((x.par / c.total) * 100) : 0}%"></span></span>${mrPct(c.total ? x.par / c.total : null, 0)}</td></tr>`).join("")}</tbody>`;
}

function mrRenderActions(d) {
    const s = d.actions && d.actions.summary;
    const tile = (label, v, tone) => `<div class="mr-tile mr-tile-${tone}"><div class="mr-tile-l">${CI.esc(label)}</div><div class="mr-tile-v">${CI.num(v.loans)}</div><div class="mr-tile-s">${CI.money(v.par ?? v.amount ?? 0)}</div></div>`;
    document.getElementById("mrActions").innerHTML = s ? [
        tile(t("creditreport.mr.a.noAction"), s.noAction, "bad"),
        tile(t("creditreport.mr.a.followLate"), s.followUpOverdue, "warn"),
        tile(t("creditreport.mr.a.ptpBroken"), s.ptpBroken, "bad"),
        tile(t("creditreport.mr.a.escalated"), s.escalated, "info"),
        tile(t("creditreport.mr.a.reportedPaid"), s.reportedPaid, "good")
    ].join("") : "";
    const acc = d.causes && d.causes.accounts ? d.causes.accounts.slice(0, 10) : [];
    document.getElementById("mrSolutions").innerHTML = acc.length ? `<thead><tr><th>${CI.esc(t("creditreport.mr.customer"))}</th><th>${CI.esc(t("creditreport.mr.officer"))}</th><th class="num">PAR</th><th class="num">${CI.esc(t("creditreport.crk.colDpd"))}</th><th>${CI.esc(t("creditreport.mr.cause"))}</th><th>${CI.esc(t("creditreport.mr.solution"))}</th></tr></thead><tbody>
        ${acc.map(a => `<tr><td>${CI.esc(a.name || a.cif)}<div class="mr-sub">${CI.esc(a.ld)}</div></td><td>${CI.esc(a.officerName || a.officerId)}</td><td class="num">${CI.money(a.par)}</td><td class="num">${CI.num(a.day)}</td><td>${a.category ? `<b>${CI.esc(t(`creditreport.rc.c.${a.category}`))}</b>` : ""}${a.reasonCause ? `<div class="mr-sub">${CI.esc(a.reasonCause)}</div>` : a.category ? "" : `<span class="mr-flat">${CI.esc(t("creditreport.mr.noReason"))}</span>`}</td><td>${a.reasonSolution ? CI.esc(a.reasonSolution) : `<span class="mr-flat">—</span>`}</td></tr>`).join("")}</tbody>` : "";
}

function mrRenderForecast(d) {
    const g = d.g;
    mrChartForecast(g);
    const note = document.getElementById("mrFcNote");
    const tb = document.getElementById("mrForecast");
    if (!g || !g.available) {
        note.textContent = t("creditreport.mr.noForecast");
        tb.innerHTML = "";
    } else {
        const last = g.history[g.history.length - 1];
        note.textContent = t("creditreport.mr.fcNote", { conf: t(`creditreport.pf.conf.${g.confidence.level}`), now: mrPct(last.parPct), month: mrMonth(last.month) });
        tb.innerHTML = `<thead><tr><th>${CI.esc(t("creditreport.mr.month"))}</th><th class="num">${CI.esc(t("creditreport.pf.best"))}</th><th class="num">${CI.esc(t("creditreport.pf.base"))}</th><th class="num">${CI.esc(t("creditreport.pf.stress"))}</th><th class="num">${CI.esc(t("creditreport.pf.parBase"))}</th></tr></thead><tbody>
            ${g.forecast.base.map((b, i) => `<tr><td>${CI.esc(mrMonth(b.month))}</td><td class="num">${mrPct(g.forecast.best[i].parPct)}</td><td class="num"><b>${mrPct(b.parPct)}</b></td><td class="num">${mrPct(g.forecast.stress[i].parPct)}</td><td class="num">${CI.money(b.par)}</td></tr>`).join("")}</tbody>`;
    }
    const p = d.pred;
    document.getElementById("mrPredNote").textContent = !p ? "" : p.display
        ? t("creditreport.mr.predOk", { amt: CI.money(p.summary.expectedRoll), par: CI.money(p.summary.par), days: p.model.horizon, n: CI.num((p.summary.bands.find(b => b.key === "high") || {}).loans || 0) })
        : t("creditreport.mr.predHidden");
}

function mrRenderCustomers(d) {
    const c = d.cust;
    const rows = c && c.rows ? c.rows : [];
    document.getElementById("mrCustomers").innerHTML = rows.length ? `<thead><tr><th>#</th><th>${CI.esc(t("creditreport.mr.customer"))}</th><th>${CI.esc(t("creditreport.mr.officer"))}</th><th class="num">PAR</th><th class="num">${CI.esc(t("creditreport.crk.colDpd"))}</th><th>${CI.esc(t("creditreport.mr.class"))}</th><th>${CI.esc(t("creditreport.mr.status"))}</th></tr></thead><tbody>
        ${rows.map((r, i) => `<tr><td>${i + 1}</td><td>${CI.esc(r.name || "—")}<div class="mr-sub">${CI.esc(r.cif || "")}${r.loans > 1 ? ` · ${CI.esc(t("creditreport.crk.loansN", { n: r.loans }))}` : ""}</div></td><td>${CI.esc((r.officers || []).map(o => o.name).join(", "))}</td><td class="num">${CI.money(r.par)}</td><td class="num">${CI.num(r.day)}</td><td>${CI.esc(CI.clsName(r.cls))}</td><td>${r.status ? CI.esc(t(`creditreport.crk.st.${r.status}`)) : "—"}</td></tr>`).join("")}</tbody>` : "";
    mrRenderCustConc(c);
}

// PAR concentration (top-N share, half-of-PAR count) and customer
// movement since the comparison day — both already in the /customers
// response fetched for the table above, just not shown until now.
function mrRenderCustConc(c) {
    const box = document.getElementById("mrCustConc");
    const note = document.getElementById("mrCustConcNote");
    if (!c || !c.concentration) { box.innerHTML = ""; note.textContent = ""; return; }
    const k = c.concentration;
    const tile = (label, value, sub) => `<div class="mr-tile"><div class="mr-tile-l">${CI.esc(label)}</div><div class="mr-tile-v">${value}</div>${sub ? `<div class="mr-tile-s">${sub}</div>` : ""}</div>`;
    const tops = (k.tops || []).slice(0, 3);
    const mv = c.movement && c.movement.customers;
    box.innerHTML = [
        ...tops.map(x => tile(t("creditreport.crk.topN", { n: x.top }), mrPct(x.share, 1), CI.esc(t("creditreport.crk.topMeta", { n: CI.num(x.customers), par: CI.money(x.par) })))),
        mv ? tile(t("creditreport.crk.st.new"), CI.num(mv.new.count), CI.money(mv.new.par)) : "",
        mv ? tile(t("creditreport.crk.st.deteriorating"), CI.num(mv.deteriorating.count), CI.money(mv.deteriorating.par)) : "",
        mv ? tile(t("creditreport.crk.st.improved"), CI.num(mv.improved.count), CI.money(mv.improved.par)) : ""
    ].join("");
    note.textContent = k.total ? t("creditreport.crk.half", { n: CI.num(k.halfOfPar), total: CI.num((c.counts || {}).customers) }) : "";
}

// Top contributors to the PAR / NPL increase, per branch, officer and
// product — reuses the same /risk rows already fetched for 2.4/2.5/2.6
// (nplChange: $ NPL grew since the comparison day; parChange: points PAR
// % grew). Branches are company-wide even inside a one-branch report, so
// that block is hidden there (it would be off-topic); officer and
// product rows are already scoped to the branch when one is picked.
function mrRiskContribRows(data, limit = 5) {
    const rows = (data && data.rows) || [];
    return rows
        .filter(r => (r.nplChange !== null && r.nplChange !== undefined && r.nplChange > 0) || (r.parChange !== null && r.parChange !== undefined && r.parChange > 0))
        .sort((a, b) => (b.nplChange || 0) - (a.nplChange || 0) || (b.parChange || 0) - (a.parChange || 0))
        .slice(0, limit);
}

function mrRenderRiskTable(id, data, withBranch) {
    const rows = mrRiskContribRows(data);
    const pct = v => (v === null || v === undefined ? "—" : `${(v * 100).toFixed(2)}%`);
    document.getElementById(id).innerHTML = rows.length ? `<thead><tr>
        <th>${CI.esc(t("creditreport.risk.colName"))}</th><th class="num">${CI.esc(t("creditreport.mr.k.os"))}</th>
        <th class="num">PAR %</th><th class="num">${CI.esc(t("creditreport.growth.parChange"))}</th>
        <th class="num">NPL %</th><th class="num">${CI.esc(t("creditreport.mr.nplIncrease"))}</th>
        </tr></thead><tbody>
        ${rows.map(r => `<tr><td>${CI.esc(r.name || r.key || "—")}${withBranch && r.branch ? `<div class="mr-sub">${CI.esc(r.branch)}</div>` : ""}</td>
            <td class="num">${CI.money(r.os)}</td>
            <td class="num">${pct(r.parPct)}</td><td class="num">${mrPts(r.parChange)}</td>
            <td class="num">${pct(r.nplPct)}</td><td class="num">${r.nplChange > 0 ? `+${CI.money(r.nplChange)}` : "—"}</td>
            </tr>`).join("")}</tbody>` : `<tbody><tr><td>${CI.esc(t("creditreport.pi.nothing"))}</td></tr></tbody>`;
}

function mrRenderRiskContrib(d) {
    const block = document.getElementById("mrRiskBranchBlock");
    block.hidden = !!d.branch;
    if (!d.branch) mrRenderRiskTable("mrRiskBranch", d.branchRisk, false);
    mrRenderRiskTable("mrRiskOfficer", d.team, !d.branch);
    mrRenderRiskTable("mrRiskProduct", d.prod, false);
}

function mrRenderDecisions() {
    const tb = document.getElementById("mrDecisions");
    if (!tb.dataset.ready) {
        const cell = () => `<td contenteditable="true"></td>`;
        tb.innerHTML = `<thead><tr><th>#</th><th>${CI.esc(t("creditreport.mr.d.issue"))}</th><th>${CI.esc(t("creditreport.mr.d.action"))}</th><th>${CI.esc(t("creditreport.mr.d.owner"))}</th><th>${CI.esc(t("creditreport.mr.d.due"))}</th></tr></thead><tbody>
            ${[1, 2, 3, 4, 5].map(i => `<tr><td>${i}</td>${cell()}${cell()}${cell()}${cell()}</tr>`).join("")}</tbody>`;
        tb.dataset.ready = "1";
    }
    const who = mrUser();
    document.getElementById("mrSign").innerHTML = [
        [t("creditreport.mr.sign.prepared"), who],
        [t("creditreport.mr.sign.branch"), ""],
        [t("creditreport.mr.sign.approved"), ""]
    ].map(([a, b]) => `<div class="mr-sign-box"><div class="mr-sign-line"></div><div>${CI.esc(a)}</div><div class="mr-sub">${CI.esc(b)}</div></div>`).join("");
}

document.addEventListener("DOMContentLoaded", () => {
    if (!CI.allowed()) return;
    const p = new URLSearchParams(location.search);
    const sel = document.getElementById("mrBranch");
    if (p.get("branch")) sel.innerHTML = `<option value="${CI.esc(p.get("branch"))}">${CI.esc(p.get("branch"))}</option>`;
    sel.addEventListener("change", mrLoad);
    document.getElementById("mrCompare").addEventListener("change", mrLoad);
    const asOf = document.getElementById("mrAsOf");
    asOf.max = CI.today ? CI.today() : new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(p.get("date") || "")) asOf.value = p.get("date");
    asOf.addEventListener("change", mrLoad);
    document.getElementById("mrAsOfClear").addEventListener("click", () => { if (asOf.value) { asOf.value = ""; mrLoad(); } });
    document.getElementById("mrPrint").addEventListener("click", () => window.print());
    document.getElementById("mrWord").addEventListener("click", mrExportWord);
    mrLoad();
});

// ---------- charts (Chart.js) ----------
// Fixed colours that read on screen in both themes and on white paper.
const MR_C = { navy: "#2456A8", gold: "#C8961E", good: "#16A34A", bad: "#DC2626", grey: "#94A3B8", text: "#6B7280", grid: "rgba(127,127,127,.18)" };
const mrCharts = new Map();
function mrChart(id, config) {
    if (mrCharts.has(id)) { mrCharts.get(id).destroy(); mrCharts.delete(id); }
    const el = document.getElementById(id);
    if (!el || typeof Chart === "undefined") return;
    const fig = el.closest(".mr-fig");
    if (!config) { if (fig) fig.hidden = true; return; }
    if (fig) fig.hidden = false;
    const base = {
        responsive: true, maintainAspectRatio: false, animation: false,
        plugins: { legend: { labels: { color: MR_C.text, boxWidth: 12, font: { family: "KRASAR", size: 11 } } } },
        scales: {}
    };
    config.options = Object.assign(base, config.options || {});
    config.options.plugins = Object.assign(base.plugins, (config.options || {}).plugins || {});
    mrCharts.set(id, new Chart(el, config));
}
const mrAxis = (fmt, extra = {}) => ({ ticks: { color: MR_C.text, font: { size: 10 }, callback: fmt }, grid: { color: MR_C.grid }, ...extra });
const mrX = () => ({ ticks: { color: MR_C.text, font: { size: 10 }, maxRotation: 0, autoSkip: true }, grid: { display: false } });
const mrShort = v => { const n = Math.abs(v); return n >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${Math.round(v / 1e3)}K` : `$${v}`; };
const mrDM = k => { const [, m, d] = String(k).split("-"); return `${d}/${m}`; };

// Achieved % of each planned figure (100% = on plan; PAR / NPL: plan ÷ actual, so above 100% = under the ceiling).
function mrChartPlan(d) {
    const p = d.plan && d.plan.metrics;
    if (!p) return mrChart("mrChPlan", null);
    const keys = [["osAmount", "creditreport.plan.m.osAmount"], ["osCount", "creditreport.plan.m.osCount"], ["disbAmount", "creditreport.plan.m.disbAmount"], ["nbcOverduePct", "PAR %"], ["nplPct", "NPL %"]];
    const rows = keys.map(([k, label]) => {
        const c = p[k] || {};
        if (!c.plan || c.actual === null || c.actual === undefined) return null;
        const pctKind = k === "nbcOverduePct" || k === "nplPct";
        const target = k === "disbAmount" && c.expected ? c.expected : c.plan;
        const v = pctKind ? (c.actual ? c.plan / c.actual : null) : c.actual / target;
        return v === null ? null : { label: label.startsWith("creditreport.") ? t(label) : label, v: Math.round(v * 100) };
    }).filter(Boolean);
    if (!rows.length) return mrChart("mrChPlan", null);
    mrChart("mrChPlan", {
        type: "bar",
        data: { labels: rows.map(r => r.label), datasets: [{ data: rows.map(r => r.v), backgroundColor: rows.map(r => (r.v >= 100 ? MR_C.good : r.v >= 90 ? MR_C.gold : MR_C.bad)), borderRadius: 4 }] },
        options: {
            indexAxis: "y",
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: x => `${x.raw}%` } } },
            scales: { x: mrAxis(v => `${v}%`, { suggestedMin: 0, suggestedMax: 110 }), y: mrX() }
        }
    });
}

function mrChartMonthly(d) {
    const pts = (d.ov.trend && d.ov.trend.monthly) || [];
    if (pts.length < 2) return mrChart("mrChMonthly", null);
    mrChart("mrChMonthly", {
        data: {
            labels: pts.map(p => { const [y, m] = p.date.split("-"); return `${m}/${y.slice(2)}`; }),
            datasets: [
                { type: "bar", label: t("creditreport.mr.k.os"), data: pts.map(p => p.os), backgroundColor: "rgba(36,86,168,.35)", yAxisID: "y", order: 2 },
                { type: "line", label: "PAR %", data: pts.map(p => +(p.parPct * 100).toFixed(2)), borderColor: MR_C.bad, backgroundColor: MR_C.bad, pointRadius: 2, tension: 0.25, yAxisID: "y1", order: 1 },
                { type: "line", label: "NPL %", data: pts.map(p => +(p.nplPct * 100).toFixed(2)), borderColor: MR_C.gold, backgroundColor: MR_C.gold, pointRadius: 2, tension: 0.25, yAxisID: "y1", order: 1 }
            ]
        },
        options: { scales: { x: mrX(), y: mrAxis(mrShort, { position: "left" }), y1: mrAxis(v => `${v}%`, { position: "right", grid: { display: false } }) } }
    });
}

// Every saved day of the Daily History (the last 45 kept), newest first in the table.
// Daily history as trend charts only (no day-by-day list — owner's
// ask: the detail belongs in section 2.2's two charts, not a long table).
function mrRenderDaily(d) {
    const pts = (d.ov.trend && d.ov.trend.daily) || [];
    const note = document.getElementById("mrDailyNote");
    if (!pts.length) {
        note.textContent = t("creditreport.mr.dailyNone");
        mrChart("mrChDailyOs", null);
        mrChart("mrChDailyRisk", null);
        return;
    }
    note.textContent = t("creditreport.mr.dailyNote", { n: pts.length, first: CI.dmy(pts[0].date), last: CI.dmy(pts[pts.length - 1].date) });
    const labels = pts.map(p => mrDM(p.date));
    mrChart("mrChDailyOs", {
        data: {
            labels,
            datasets: [
                { type: "line", label: t("creditreport.mr.k.os"), data: pts.map(p => p.os), borderColor: MR_C.navy, backgroundColor: MR_C.navy, pointRadius: 1.5, tension: 0.2, yAxisID: "y" },
                { type: "bar", label: t("creditreport.mr.k.disb"), data: pts.map(p => p.disb), backgroundColor: "rgba(200,150,30,.45)", yAxisID: "y1" }
            ]
        },
        options: { scales: { x: mrX(), y: mrAxis(mrShort), y1: mrAxis(mrShort, { position: "right", grid: { display: false } }) } }
    });
    mrChart("mrChDailyRisk", {
        type: "line",
        data: {
            labels,
            datasets: [
                { label: "PAR %", data: pts.map(p => +(p.parPct * 100).toFixed(2)), borderColor: MR_C.bad, backgroundColor: MR_C.bad, pointRadius: 1.5, tension: 0.2 },
                { label: "NPL %", data: pts.map(p => +(p.nplPct * 100).toFixed(2)), borderColor: MR_C.gold, backgroundColor: MR_C.gold, pointRadius: 1.5, tension: 0.2 }
            ]
        },
        options: { scales: { x: mrX(), y: mrAxis(v => `${v}%`) } }
    });
}

// CO / FSRO / Digital Loan: PAR % and NPL % side by side.
function mrChartTeamSplit(s) {
    if (!s) return mrChart("mrChTeamSplit", null);
    const buckets = [
        ["co", t("creditreport.byBranch.teamCo")],
        ["fsro", t("creditreport.byCO.fsro")],
        ["digital", t("creditreport.byBranch.teamDigital")]
    ];
    const par = buckets.map(([key]) => { const v = (s[key] && s[key].parT24 || {}).parPct; return v === null || v === undefined ? null : +(v * 100).toFixed(2); });
    const npl = buckets.map(([key]) => { const v = (s[key] && s[key].nbcOverdue && s[key].nbcOverdue.nonPerformingLoan || {}).parPct; return v === null || v === undefined ? null : +(v * 100).toFixed(2); });
    if (par.every(v => v === null) && npl.every(v => v === null)) return mrChart("mrChTeamSplit", null);
    mrChart("mrChTeamSplit", {
        type: "bar",
        data: {
            labels: buckets.map(([, label]) => label),
            datasets: [
                { label: "PAR %", data: par, backgroundColor: MR_C.bad, borderRadius: 3 },
                { label: "NPL %", data: npl, backgroundColor: MR_C.gold, borderRadius: 3 }
            ]
        },
        options: { scales: { x: mrX(), y: mrAxis(v => `${v}%`, { beginAtZero: true }) } }
    });
}

function mrChartTeam(d) {
    const rows = d.team && d.team.rows ? d.team.rows.slice().sort((a, b) => b.os - a.os).slice(0, 15) : [];
    if (!rows.length) return mrChart("mrChTeam", null);
    const plans = new Map(((d.teamPlan && d.teamPlan.rows) || []).map(r => [String(r.id), r.metrics]));
    const plan = rows.map(r => { const c = (plans.get(String(r.key)) || {}).nbcOverduePct; return c && c.plan !== null && c.plan !== undefined ? c.plan : null; });
    const fig = document.getElementById("mrChTeam").closest(".mr-chart");
    if (fig) fig.style.height = `${Math.max(180, rows.length * 26 + 60)}px`;
    mrChart("mrChTeam", {
        data: {
            labels: rows.map(r => r.name || r.key),
            datasets: [
                { type: "bar", label: t("creditreport.plan.actual"), data: rows.map(r => +(r.parPct * 100).toFixed(2)), backgroundColor: rows.map((r, i) => (plan[i] !== null && r.parPct * 100 > plan[i] ? MR_C.bad : MR_C.navy)), borderRadius: 3 },
                ...(plan.some(v => v !== null) ? [{ type: "line", label: t("creditreport.plan.plan"), data: plan, borderColor: MR_C.gold, backgroundColor: MR_C.gold, showLine: false, pointStyle: "line", pointRadius: 9, pointBorderWidth: 3 }] : [])
            ]
        },
        options: { indexAxis: "y", scales: { x: mrAxis(v => `${v}%`, { beginAtZero: true }), y: mrX() } }
    });
}

// Every branch's PAR % against its plan ceiling — the branch counterpart
// of mrChartTeam, shown only in the All Branches view.
function mrChartBranchDim(d) {
    const rows = d.branchRisk && d.branchRisk.rows ? d.branchRisk.rows.slice().sort((a, b) => b.os - a.os).slice(0, 15) : [];
    if (!rows.length) return mrChart("mrChBranchDim", null);
    const plans = new Map(((d.branchPlan && d.branchPlan.rows) || []).map(r => [String(r.id), r.metrics]));
    const plan = rows.map(r => { const c = (plans.get(String(r.name || r.key)) || {}).nbcOverduePct; return c && c.plan !== null && c.plan !== undefined ? c.plan : null; });
    const fig = document.getElementById("mrChBranchDim").closest(".mr-chart");
    if (fig) fig.style.height = `${Math.max(180, rows.length * 26 + 60)}px`;
    mrChart("mrChBranchDim", {
        data: {
            labels: rows.map(r => r.name || r.key),
            datasets: [
                { type: "bar", label: t("creditreport.plan.actual"), data: rows.map(r => +(r.parPct * 100).toFixed(2)), backgroundColor: rows.map((r, i) => (plan[i] !== null && r.parPct * 100 > plan[i] ? MR_C.bad : MR_C.navy)), borderRadius: 3 },
                ...(plan.some(v => v !== null) ? [{ type: "line", label: t("creditreport.plan.plan"), data: plan, borderColor: MR_C.gold, backgroundColor: MR_C.gold, showLine: false, pointStyle: "line", pointRadius: 9, pointBorderWidth: 3 }] : [])
            ]
        },
        options: { indexAxis: "y", scales: { x: mrAxis(v => `${v}%`, { beginAtZero: true }), y: mrX() } }
    });
}

function mrChartCauses(c) {
    if (!c || !c.byCause || !c.total) return mrChart("mrChCauses", null);
    const list = Object.entries(c.byCause).map(([key, v]) => ({ key, ...v })).filter(x => x.par > 0).sort((a, b) => (a.key === "unclassified") - (b.key === "unclassified") || b.par - a.par);
    if (!list.length) return mrChart("mrChCauses", null);
    const palette = ["#2456A8", "#C8961E", "#DC2626", "#16A34A", "#7C3AED", "#0D9488", "#EA580C", "#64748B"];
    mrChart("mrChCauses", {
        type: "doughnut",
        data: {
            labels: list.map(x => t(x.key === "unclassified" ? "creditreport.rc.unclassified" : `creditreport.rc.c.${x.key}`)),
            datasets: [{ data: list.map(x => x.par), backgroundColor: list.map((x, i) => (x.key === "unclassified" ? MR_C.grey : palette[i % palette.length])), borderWidth: 0 }]
        },
        options: {
            cutout: "58%",
            plugins: { legend: { position: "right", labels: { color: MR_C.text, boxWidth: 10, font: { family: "KRASAR", size: 11 } } }, tooltip: { callbacks: { label: x => `${x.label}: ${CI.money(x.raw)} (${Math.round((x.raw / c.total) * 100)}%)` } } }
        }
    });
}

function mrChartForecast(g) {
    if (!g || !g.available) return mrChart("mrChForecast", null);
    const hist = g.history.slice(-12);
    const fc = g.forecast;
    const labels = hist.map(p => mrMonth(p.month)).concat(fc.base.map(p => mrMonth(p.month)));
    const pad = n => Array(n).fill(null);
    const v = p => (p.parPct === null || p.parPct === undefined ? null : +(p.parPct * 100).toFixed(2));
    const join = arr => pad(hist.length - 1).concat([v(hist[hist.length - 1])], arr.map(v));
    mrChart("mrChForecast", {
        type: "line",
        data: {
            labels,
            datasets: [
                { label: t("creditreport.pf.actual"), data: hist.map(v).concat(pad(fc.base.length)), borderColor: MR_C.navy, backgroundColor: MR_C.navy, pointRadius: 2, tension: 0.2 },
                { label: t("creditreport.pf.base"), data: join(fc.base), borderColor: MR_C.gold, borderDash: [6, 4], pointRadius: 2, tension: 0.2 },
                { label: t("creditreport.pf.best"), data: join(fc.best), borderColor: MR_C.good, borderDash: [2, 4], pointRadius: 0, tension: 0.2 },
                { label: t("creditreport.pf.stress"), data: join(fc.stress), borderColor: MR_C.bad, borderDash: [2, 4], pointRadius: 0, tension: 0.2 }
            ]
        },
        options: { spanGaps: false, scales: { x: mrX(), y: mrAxis(v2 => `${v2}%`) } }
    });
}

// Charts follow the page width; redraw them at the paper's width to print.
window.addEventListener("beforeprint", () => mrCharts.forEach(c => c.resize()));
window.addEventListener("afterprint", () => mrCharts.forEach(c => c.resize()));

// ---------- Export Word (.docx) ----------
// An editable Word file of the report as it is on screen: headings, the
// summary tiles, notes, every table (merged header cells kept) and the
// charts as pictures, A4 portrait. Built in the browser with the docx
// library (loaded on first use, like Chart.js), then shared (phones:
// Save to Files, Telegram, …) or downloaded. Khmer text uses the
// "Khmer OS Siemreap" font for complex script; Word falls back to
// another Khmer font when it isn't installed.
const MR_DOCX_LIB = "https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.js";
const mrScripts = {};
function mrLoadScript(url) {
    if (!mrScripts[url]) {
        mrScripts[url] = new Promise((resolve, reject) => {
            const el = document.createElement("script");
            el.src = url;
            el.onload = resolve;
            el.onerror = () => { delete mrScripts[url]; reject(new Error(`Could not load ${url}`)); };
            document.head.appendChild(el);
        });
    }
    return mrScripts[url];
}
const mrFrame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

function mrFileName(ext) {
    const asOf = mrAsOf();
    const d = new Date();
    const pad = n => String(n).padStart(2, "0");
    const stamp = asOf ? asOf.replace(/-/g, "") : `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
    const b = (document.getElementById("mrBranch").value || "AllBranches").replace(/[^\w-]+/g, "");
    return `MeetingReport_${b}_${stamp}.${ext}`;
}

const MR_DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
async function mrSaveFile(blob, name, type) {
    const file = typeof File === "function" ? new File([blob], name, { type }) : null;
    const touch = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
    if (touch && file && navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
            await navigator.share({ files: [file], title: name });
            return;
        } catch (e) {
            if (e && e.name === "AbortError") return;   // the user closed the share sheet
        }
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}

// The report's DOM → docx blocks, in reading order.
function mrDocxBlocks(D, el) {
    const FONT = { ascii: "Calibri", hAnsi: "Calibri", cs: "Khmer OS Siemreap", eastAsia: "Khmer OS Siemreap" };
    const NAVY = "1A2E57", MUTED = "6B7280";
    const visible = n => !n.closest("[hidden]") && !n.closest(".no-print") && getComputedStyle(n).display !== "none";
    const clean = s => String(s || "").replace(/ /g, " ").replace(/[ \t]+/g, " ").trim();
    const run = (text, o = {}) => new D.TextRun({
        text, font: FONT, size: o.size || 20, sizeComplexScript: o.size || 20,
        bold: !!o.bold, boldComplexScript: !!o.bold, italics: !!o.italic, italicsComplexScript: !!o.italic,
        color: o.color
    });
    // Line breaks inside a block become breaks inside one paragraph.
    const runs = (text, o) => clean(text).split(/\s*\n\s*/).filter(Boolean)
        .flatMap((l, i) => (i ? [new D.TextRun({ break: 1 }), run(l, o)] : [run(l, o)]));
    const para = (text, o = {}) => new D.Paragraph({
        children: runs(text, o), heading: o.heading, alignment: o.align, bullet: o.bullet ? { level: 0 } : undefined,
        spacing: { before: o.before || 0, after: o.after === undefined ? 80 : o.after }
    });
    const border = { style: D.BorderStyle.SINGLE, size: 4, color: "C9CED8" };
    const borders = { top: border, bottom: border, left: border, right: border };
    const cellText = c => {
        // A cell's own sub-lines (.mr-sub) go on their own lines.
        const parts = [];
        c.childNodes.forEach(ch => parts.push(ch.nodeType === 3 ? ch.textContent : (ch.classList && ch.classList.contains("mr-sub") ? `\n${ch.innerText}` : ch.innerText || ch.textContent)));
        return parts.join("");
    };
    const table = tb => {
        const rows = [...tb.rows].filter(r => r.cells.length);
        if (!rows.length) return null;
        return new D.Table({
            width: { size: 100, type: D.WidthType.PERCENTAGE },
            rows: rows.map(r => {
                const head = r.parentElement.tagName === "THEAD";
                const total = r.classList.contains("mr-total");
                return new D.TableRow({
                    tableHeader: head,
                    children: [...r.cells].map(c => new D.TableCell({
                        columnSpan: c.colSpan > 1 ? c.colSpan : undefined,
                        rowSpan: c.rowSpan > 1 ? c.rowSpan : undefined,
                        borders,
                        shading: head ? { fill: "E8EDF6", type: D.ShadingType.CLEAR, color: "auto" } : total ? { fill: "F4F6FA", type: D.ShadingType.CLEAR, color: "auto" } : undefined,
                        margins: { top: 40, bottom: 40, left: 80, right: 80 },
                        children: [new D.Paragraph({
                            alignment: c.classList.contains("num") ? D.AlignmentType.RIGHT : head ? D.AlignmentType.CENTER : D.AlignmentType.LEFT,
                            children: runs(cellText(c) || " ", { size: 16, bold: head || total })
                        })]
                    }))
                });
            })
        });
    };
    const image = canvas => {
        const data = canvas.toDataURL("image/png");
        const bin = atob(data.split(",")[1]);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const w = 600, h = Math.round(w * (canvas.height / canvas.width || 0.5));
        return new D.Paragraph({ alignment: D.AlignmentType.CENTER, children: [new D.ImageRun({ data: bytes, transformation: { width: w, height: h } })], spacing: { after: 120 } });
    };
    const out = [];
    const sel = ".mr-head-brand, .mr-head-title, #mrMeta, h2.mr-h, h3.mr-h3, p.mr-note, .mr-tiles, ul.mr-points, table.mr-table, figure.mr-fig, .mr-sign, .mr-foot";
    el.querySelectorAll(sel).forEach(n => {
        if (!visible(n)) return;
        if (n.matches(".mr-head-brand")) out.push(para(n.innerText, { size: 18, bold: true, color: NAVY, after: 40 }));
        else if (n.matches(".mr-head-title")) out.push(para(n.innerText, { heading: D.HeadingLevel.TITLE, size: 32, bold: true, color: NAVY, after: 120 }));
        else if (n.matches("#mrMeta")) {
            n.querySelectorAll(":scope > div").forEach(m => {
                const k = m.querySelector("span"), v = m.querySelector("b");
                out.push(new D.Paragraph({ children: [run(`${clean(k && k.innerText)}: `, { color: MUTED }), run(clean(v && v.innerText), { bold: true })], spacing: { after: 20 } }));
            });
            out.push(para("", { after: 120 }));
        } else if (n.matches("h2.mr-h")) out.push(para(n.innerText.replace(/\s*\n\s*/g, ". "), { heading: D.HeadingLevel.HEADING_1, size: 28, bold: true, color: NAVY, before: 240, after: 120 }));
        else if (n.matches("h3.mr-h3")) out.push(para(n.innerText, { heading: D.HeadingLevel.HEADING_2, size: 23, bold: true, color: NAVY, before: 160, after: 80 }));
        else if (n.matches("p.mr-note")) { if (clean(n.innerText)) out.push(para(n.innerText, { size: 17, italic: true, color: MUTED })); }
        else if (n.matches(".mr-tiles")) {
            const tiles = [...n.querySelectorAll(".mr-tile")];
            if (!tiles.length) return;
            const per = 4;
            const rows = [];
            for (let i = 0; i < tiles.length; i += per) rows.push(tiles.slice(i, i + per));
            out.push(new D.Table({
                width: { size: 100, type: D.WidthType.PERCENTAGE },
                rows: rows.map(group => new D.TableRow({
                    children: [...group, ...Array(per - group.length).fill(null)].map(tl => new D.TableCell({
                        borders,
                        margins: { top: 60, bottom: 60, left: 100, right: 100 },
                        children: tl ? [
                            para(tl.querySelector(".mr-tile-l") ? tl.querySelector(".mr-tile-l").innerText : "", { size: 16, color: MUTED, after: 20 }),
                            para(tl.querySelector(".mr-tile-v") ? tl.querySelector(".mr-tile-v").innerText : "", { size: 26, bold: true, after: 20 }),
                            ...[".mr-tile-c", ".mr-tile-s"].map(c => tl.querySelector(c)).filter(Boolean).map(x => para(x.innerText, { size: 16, after: 0 }))
                        ] : [new D.Paragraph("")]
                    }))
                }))
            }));
            out.push(para("", { after: 80 }));
        } else if (n.matches("ul.mr-points")) n.querySelectorAll("li").forEach(li => out.push(para(li.innerText, { bullet: true, size: 20 })));
        else if (n.matches("table.mr-table")) { const tb = table(n); if (tb) { out.push(tb); out.push(para("", { after: 80 })); } }
        else if (n.matches("figure.mr-fig")) {
            const cv = n.querySelector("canvas");
            const cap = n.querySelector("figcaption");
            if (cap) out.push(para(cap.innerText, { size: 18, bold: true, after: 40 }));
            if (cv && cv.width && cv.height) out.push(image(cv));
        } else if (n.matches(".mr-sign")) {
            const boxes = [...n.querySelectorAll(".mr-sign-box")];
            if (!boxes.length) return;
            const none = { style: D.BorderStyle.NONE, size: 0, color: "FFFFFF" };
            out.push(para("", { after: 400 }));
            out.push(new D.Table({
                width: { size: 100, type: D.WidthType.PERCENTAGE },
                rows: [new D.TableRow({
                    children: boxes.map(b => new D.TableCell({
                        borders: { top: { style: D.BorderStyle.SINGLE, size: 6, color: "6B7280" }, bottom: none, left: none, right: none },
                        margins: { top: 60, left: 120, right: 120 },
                        children: [...b.children].filter(x => !x.classList.contains("mr-sign-line")).map(x => para(x.innerText || " ", { size: 18, align: D.AlignmentType.CENTER, after: 20 }))
                    }))
                })]
            }));
        } else if (n.matches(".mr-foot")) { if (clean(n.innerText)) out.push(para(n.innerText, { size: 16, color: MUTED, before: 240 })); }
    });
    return out;
}

async function mrExportWord() {
    const el = document.getElementById("mrReport");
    if (!el || el.hidden) return;
    if (typeof showAppLoading === "function") showAppLoading(t("creditreport.mr.makingWord"), { progress: true, key: "mr-word" });
    const progress = f => window.setAppLoadingProgress && window.setAppLoadingProgress(f * 100, t("creditreport.mr.makingWord"));
    document.activeElement && document.activeElement.blur && document.activeElement.blur();
    try {
        await mrLoadScript(MR_DOCX_LIB);
        const D = window.docx;
        if (!D || !D.Document) throw new Error("docx library missing");
        progress(0.2);
        // Light, A4-wide layout so the charts are drawn for paper.
        document.body.classList.add("mr-pdf-mode");
        mrCharts.forEach(c => c.resize());
        await mrFrame();
        progress(0.4);
        const children = mrDocxBlocks(D, el);
        progress(0.7);
        const doc = new D.Document({
            creator: "CM Pro",
            title: t("creditreport.mr.docTitle"),
            styles: { default: { document: { run: { font: { ascii: "Calibri", hAnsi: "Calibri", cs: "Khmer OS Siemreap", eastAsia: "Khmer OS Siemreap" }, size: 20 } } } },
            sections: [{
                properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 850, bottom: 850, left: 850, right: 850 } } },
                footers: {
                    default: new D.Footer({ children: [new D.Paragraph({ alignment: D.AlignmentType.RIGHT, children: [new D.TextRun({ children: ["CM Pro · ", D.PageNumber.CURRENT, " / ", D.PageNumber.TOTAL_PAGES], size: 16, color: "6B7280" })] })] })
                },
                children
            }]
        });
        const blob = await D.Packer.toBlob(doc);
        progress(0.95);
        await mrSaveFile(blob, mrFileName("docx"), MR_DOCX_MIME);
    } catch (err) {
        console.error("[meeting report word] failed:", err);
        CI.toast(t("creditreport.mr.wordFailed"), "error");
    } finally {
        document.body.classList.remove("mr-pdf-mode");
        mrCharts.forEach(c => c.resize());
        if (typeof hideAppLoading === "function") hideAppLoading();
    }
}
