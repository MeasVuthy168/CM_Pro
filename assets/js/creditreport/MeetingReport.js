// ========================================
// Credit Portfolio Intelligence — Branch Meeting Report
// One printable report for the meeting with branch management, put
// together from the section's own endpoints (nothing is recalculated
// here, only arranged and worded):
//   1 Summary            /overview (KPIs vs the comparison day) + plain
//                         sentences built from the same figures
//   2 Credit progress    /overview KPIs; /risk by officer (one branch) or
//                         by branch (all)
//   3 Causes of PAR      /causes (confirmed causes only; unclassified shown)
//   4 Solutions          /actions summary; /causes largest loans with the
//                         officer's own cause and solution text
//   5 Forecast           /forecast (Best / Base / Stress, confidence) and
//                         /customers/prediction (only when validated)
//   6 Customers to watch /customers (largest PAR)
//   7 Decisions          a table typed in during the meeting (printed, not
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

async function mrLoad() {
    if (!CI.allowed()) return;
    const mine = ++mrSeq;
    const branch = document.getElementById("mrBranch").value;
    const compare = document.getElementById("mrCompare").value;
    const base = { branch, compare };
    if (typeof showAppLoading === "function") showAppLoading(t("creditreport.pi.loading"), { progress: true, key: "mr" });
    try {
        // The server builds at most 2 section reads at once; asking for
        // 3 at a time keeps one queued without flooding it.
        const jobs = [
            () => mrGet("overview", base),
            () => mrGet("risk", { ...base, dim: branch ? "officer" : "branch" }),
            () => mrGet("risk", { ...base, dim: "product" }),
            () => mrGet("causes", { branch, limit: 10 }),
            () => mrGet("actions", { branch, view: "all", limit: 10 }),
            () => mrGet("forecast", { dim: branch ? "branch" : "portfolio", horizon: 3 }),
            () => mrGet("customers/prediction", { branch, unit: "loan", top: 20 }),
            () => mrGet("customers", { branch, compare, top: 10, sort: "par" }),
            () => CIPlan.branch(branch ? [branch] : []),
            () => (branch ? CIPlan.officers() : CIPlan.branchRows())
        ];
        const out = await mrPool(jobs, 3, (n, total) => {
            if (mine === mrSeq && typeof showAppLoading === "function") showAppLoading(t("creditreport.mr.loadingN", { n, total }), { progress: true, key: "mr" });
        });
        const [ov, team, prod, causes, actions, fc, pred, cust, plan, teamPlan] = out;
        if (mine !== mrSeq) return;
        if (!ov) { CI.toast(t("creditreport.pi.loadFailed"), "error"); return; }
        mrFillBranches(ov);
        const g = fc && fc.groups ? (branch ? fc.groups.find(x => x.key === branch) : fc.groups[0]) : null;
        mrRender({ branch, compare, ov, team, prod, causes, actions, fc, g, pred, cust, plan, teamPlan });
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
        [t("creditreport.mr.dataAsOf"), d.ov.asOf ? d.ov.asOf.osText : "—"],
        [t("creditreport.mr.compare"), cmp.available ? CI.dmy(cmp.date) : t("creditreport.mr.noCompare")],
        [t("creditreport.mr.preparedOn"), CI.dmy(new Date().toISOString().slice(0, 10))]
    ].map(([a, b]) => `<div><span>${CI.esc(a)}</span><b>${CI.esc(b)}</b></div>`).join("");

    // 1. Summary tiles + sentences
    const tile = (label, value, change, sub) => `<div class="mr-tile"><div class="mr-tile-l">${CI.esc(label)}</div><div class="mr-tile-v">${value}</div><div class="mr-tile-c">${change}</div>${sub ? `<div class="mr-tile-s">${sub}</div>` : ""}</div>`;
    document.getElementById("mrTiles").innerHTML = [
        tile(t("creditreport.mr.k.os"), CI.money(k.outstanding.cur), mrChange(k.outstanding.diff, "up", CI.money)),
        tile(t("creditreport.mr.k.disb"), CI.money(k.disbursement.cur), mrChange(k.disbursement.diff, "up", CI.money)),
        tile("PAR %", mrPct(k.parPct.cur), mrChange(k.parPct.diff, "down", v => `${(v * 100).toFixed(2)} ${t("creditreport.pi.pts")}`), CI.esc(CI.money(k.parPct.value))),
        tile("NPL %", mrPct(k.nplPct.cur), mrChange(k.nplPct.diff, "down", v => `${(v * 100).toFixed(2)} ${t("creditreport.pi.pts")}`), CI.esc(CI.money(k.nplValue.cur)))
    ].join("");
    document.getElementById("mrPoints").innerHTML = mrPointsOf(d).map(p => `<li class="mr-pt-${p.tone}">${CI.esc(p.text)}</li>`).join("");

    // 2. The 4 Daily Monitoring reports: branch, officer (or branch), product, location
    mrRenderProgress(d);
    mrRenderTeam(d);
    mrRenderCauses(d);
    mrRenderActions(d);
    mrRenderForecast(d);
    mrRenderCustomers(d);
    mrRenderDecisions();
    document.getElementById("mrFoot").textContent = t("creditreport.mr.foot");
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
    document.getElementById("mrPlanNote").textContent = !p ? t("creditreport.plan.none")
        : p.hasPlan ? t("creditreport.plan.note", { month, to: CI.dmy(p.toDate), done: p.daysDone, days: p.daysInMonth })
        : t("creditreport.plan.notSet", { month });
    document.getElementById("mrBranchTitle").textContent = d.branch ? `${t("creditreport.mr.byBranchOne")} — ${d.branch}` : t("creditreport.mr.byBranchAll");
    const avail = d.ov.comparison && d.ov.comparison.available;
    const lm = avail ? {
        osAmount: k.outstanding.prev, disbAmount: k.disbursement.prev,
        nbcOverduePct: k.parPct.prev === null || k.parPct.prev === undefined ? null : k.parPct.prev * 100,
        nplPct: k.nplPct.prev === null || k.nplPct.prev === undefined ? null : k.nplPct.prev * 100
    } : null;
    document.getElementById("mrProgress").innerHTML = p && p.metrics
        ? CIPlan.table(p, { lastMonth: lm, lmLabel: d.compare === "month" ? "creditreport.plan.lastMonth" : "creditreport.mr.before", keys: ["osAmount", "osCount", "osClients", "disbAmount", "disbCount", "nbcOverduePct", "nplPct", "woCollected"] })
        : "";
    mrRenderTeam(d);
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

// Officers of the branch (or every branch): Actual · last month · plan.
function mrRenderTeam(d) {
    mrChartTeam(d);
    const byOfficer = !!d.branch;
    document.getElementById("mrTeamTitle").textContent = t(byOfficer ? "creditreport.mr.byOfficer" : "creditreport.mr.byBranch");
    const rows = d.team && d.team.rows ? d.team.rows.slice().sort((a, b) => b.os - a.os).slice(0, 25) : [];
    const plans = new Map(((d.teamPlan && d.teamPlan.rows) || []).map(r => [String(r.id), r.metrics]));
    const F = CIPlan.fmt;
    const ach = (m, c) => CIPlan.achCell(CIPlan.METRICS.find(x => x.key === m), c);
    const pct = v => (v === null || v === undefined ? "—" : `${(v * 100).toFixed(2)}%`);
    document.getElementById("mrTeam").innerHTML = rows.length ? `<thead>
        <tr><th rowspan="2">${CI.esc(t(byOfficer ? "creditreport.mr.officer" : "creditreport.pi.branch"))}</th><th colspan="4" class="mr-grp">${CI.esc(t("creditreport.mr.k.os"))}</th><th colspan="3" class="mr-grp">${CI.esc(t("creditreport.mr.k.disb"))}</th><th colspan="3" class="mr-grp">PAR %</th><th colspan="2" class="mr-grp">NPL %</th></tr>
        <tr>${[["plan.actual"], ["plan.lastMonth"], ["plan.plan"], ["plan.ach"], ["plan.actual"], ["plan.plan"], ["plan.ach"], ["plan.actual"], ["plan.lastMonth"], ["plan.plan"], ["plan.actual"], ["plan.plan"]].map(([k]) => `<th class="num">${CI.esc(t(`creditreport.${k}`))}</th>`).join("")}</tr></thead><tbody>
        ${rows.map(r => {
            const pm = plans.get(String(r.key)) || {};
            const os = pm.osAmount || { actual: r.os, plan: null };
            const db = pm.disbAmount || { actual: r.disb, plan: null };
            const par = pm.nbcOverduePct || {};
            const npl = pm.nplPct || {};
            return `<tr><td>${CI.esc(r.name || r.key)}</td>
                <td class="num">${F("amount", r.os)}</td><td class="num">${r.prev ? F("amount", r.prev.os) : "—"}</td><td class="num">${F("amount", os.plan)}</td><td class="num ci-plan-ach">${ach("osAmount", { ...os, actual: r.os })}</td>
                <td class="num">${F("amount", r.disb)}</td><td class="num">${F("amount", db.plan)}</td><td class="num ci-plan-ach">${ach("disbAmount", { ...db, actual: r.disb })}</td>
                <td class="num">${pct(r.parPct)}</td><td class="num">${r.prev ? pct(r.prev.parPct) : "—"}</td><td class="num">${F("pct", par.plan)}</td>
                <td class="num">${pct(r.nplPct)}</td><td class="num">${F("pct", npl.plan)}</td></tr>`;
        }).join("")}</tbody>` : `<tbody><tr><td>${CI.esc(t("creditreport.pi.nothing"))}</td></tr></tbody>`;
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
    const rows = d.cust && d.cust.rows ? d.cust.rows : [];
    document.getElementById("mrCustomers").innerHTML = rows.length ? `<thead><tr><th>#</th><th>${CI.esc(t("creditreport.mr.customer"))}</th><th>${CI.esc(t("creditreport.mr.officer"))}</th><th class="num">PAR</th><th class="num">${CI.esc(t("creditreport.crk.colDpd"))}</th><th>${CI.esc(t("creditreport.mr.class"))}</th><th>${CI.esc(t("creditreport.mr.status"))}</th></tr></thead><tbody>
        ${rows.map((r, i) => `<tr><td>${i + 1}</td><td>${CI.esc(r.name || "—")}<div class="mr-sub">${CI.esc(r.cif || "")}${r.loans > 1 ? ` · ${CI.esc(t("creditreport.crk.loansN", { n: r.loans }))}` : ""}</div></td><td>${CI.esc((r.officers || []).map(o => o.name).join(", "))}</td><td class="num">${CI.money(r.par)}</td><td class="num">${CI.num(r.day)}</td><td>${CI.esc(CI.clsName(r.cls))}</td><td>${r.status ? CI.esc(t(`creditreport.crk.st.${r.status}`)) : "—"}</td></tr>`).join("")}</tbody>` : "";
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
    document.getElementById("mrPrint").addEventListener("click", () => window.print());
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
function mrRenderDaily(d) {
    const pts = (d.ov.trend && d.ov.trend.daily) || [];
    const note = document.getElementById("mrDailyNote");
    const tb = document.getElementById("mrDaily");
    if (!pts.length) {
        note.textContent = t("creditreport.mr.dailyNone");
        tb.innerHTML = "";
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
    const rows = pts.slice().reverse();
    const delta = (cur, prev, fmt, better) => (prev === undefined ? "" : ` ${mrChange(cur - prev, better, fmt)}`);
    tb.innerHTML = `<thead><tr><th>${CI.esc(t("creditreport.mr.date"))}</th><th class="num">${CI.esc(t("creditreport.mr.k.os"))}</th><th class="num">${CI.esc(t("creditreport.mr.k.disb"))}</th><th class="num">PAR %</th><th class="num">NPL</th><th class="num">NPL %</th></tr></thead><tbody>
        ${rows.map((p, i) => {
            const prev = rows[i + 1];
            return `<tr><td>${CI.esc(CI.dmy(p.date))}</td><td class="num">${CI.money(p.os)}${prev ? delta(p.os, prev.os, mrShort, "up") : ""}</td><td class="num">${CI.money(p.disb)}</td><td class="num">${mrPct(p.parPct)}${prev ? delta(p.parPct, prev.parPct, v => (v * 100).toFixed(2), "down") : ""}</td><td class="num">${CI.money(p.nplValue)}</td><td class="num">${mrPct(p.nplPct)}</td></tr>`;
        }).join("")}</tbody>`;
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
