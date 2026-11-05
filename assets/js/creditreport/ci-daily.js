// ========================================
// Credit Portfolio Intelligence — Daily Monitoring by Branch, in detail
// (shared by the Branch Meeting Report and the Overview page)
//
// The Daily Report by Branch's own figures, section by section (Loan
// Outstanding, KHR, ≤ $50,000, Disbursement, LOS, Balance at Risk T24,
// NBC Overdue / NPL, Write-off), each split by team (CO / FSRO /
// Digital, + the branch total), next to:
//   last month  the report's last saved Daily History day of last month
//               (same rule as its Comparison "Last Month"; T24 against
//               last month's NBC Overdue, as the report does)
//   plan        the branch Monthly Plan (Total row only — plans are per
//               branch, not per team)
// Read from the report's own endpoints (nothing recalculated here):
//   GET /api/creditreport/detailed              teams + total, month to date
//   GET /api/creditreport/summary/history?latest=1   last month (CRLastMonth.load)
//   GET /api/creditreport/plan-vs-actual        (CIPlan)
//   CIDaily.load(branch)   → data (branch "" = all branches)
//   CIDaily.html(data)     → the sections as HTML
// ========================================
(function () {
    const t = (k, v) => (window.CMI18n ? CMI18n.t(k, v) : k);
    const token = () => localStorage.getItem("token") || sessionStorage.getItem("token");
    const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const num = n => (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
    const money = n => (Number(n) < 0 ? "−$" : "$") + num(Math.abs(Number(n) || 0));
    const get = (o, p) => p.split(".").reduce((x, k) => (x == null ? undefined : x[k]), o);
    const woColl = it => { const w = get(it, "writeOff.woCollected"); return w ? (Number(w.int) || 0) + (Number(w.prn) || 0) : undefined; };

    // kind: num | money | pct (a fraction); risk: lower is better;
    // plan: the Monthly Plan metric (pct plans are in %, i.e. ×100);
    // lm: where last month's figure is read when not the same path.
    const SECTIONS = [
        { key: "outstanding", label: "creditreport.detail.sectionOutstanding", metrics: [
            { path: "loanOutstanding.loan", label: "creditreport.detail.colLoanHash", kind: "num", plan: "osCount" },
            { path: "loanOutstanding.client", label: "creditreport.detail.colClient", kind: "num", plan: "osClients" },
            { path: "loanOutstanding.value", label: "creditreport.detail.colValue", kind: "money", plan: "osAmount" }] },
        { key: "khr", label: "creditreport.detail.sectionKhr", metrics: [
            { path: "osMix.khr", label: "creditreport.detail.colValue", kind: "money", plan: "osKhr" }] },
        { key: "small", label: "creditreport.detail.sectionSmall", metrics: [
            { path: "osMix.small", label: "creditreport.detail.colValue", kind: "money", plan: "osSmall" }] },
        { key: "disburse", label: "creditreport.detail.sectionDisburse", metrics: [
            { path: "loanDisburse.loan", label: "creditreport.detail.colLoanHash", kind: "num", plan: "disbCount", toDate: true },
            { path: "loanDisburse.value", label: "creditreport.detail.colValue", kind: "money", plan: "disbAmount", toDate: true }] },
        { key: "los", label: "creditreport.detail.sectionLos", metrics: [
            { path: "loanLos.loan", label: "creditreport.detail.colLoanHash", kind: "num" }] },
        { key: "parT24", label: "creditreport.detail.sectionT24", note: "creditreport.cd.t24Note", metrics: [
            { path: "parT24.value", label: "creditreport.detail.colValue", kind: "money", risk: true, lm: "nbcOverdue.total.value" },
            { path: "parT24.parPct", label: "creditreport.detail.colParPct", kind: "pct", risk: true, lm: "nbcOverdue.total.parPct" }] },
        { key: "nbc", label: "creditreport.detail.sectionNbcOverdue", metrics: [
            { path: "nbcOverdue.total.value", label: "creditreport.cd.parAmount", kind: "money", risk: true },
            { path: "nbcOverdue.total.parPct", label: "creditreport.detail.colParPct", kind: "pct", risk: true, plan: "nbcOverduePct" },
            { path: "nbcOverdue.nonPerformingLoan.value", label: "creditreport.cd.nplAmount", kind: "money", risk: true },
            { path: "nbcOverdue.nonPerformingLoan.parPct", label: "creditreport.cd.nplPct", kind: "pct", risk: true, plan: "nplPct" }] },
        { key: "wo", label: "creditreport.cd.sectionWo", metrics: [
            { path: "woCollected", label: "creditreport.detail.woCollected", kind: "money", read: woColl },
            { path: "writeOff.wo.prn", label: "creditreport.detail.woWO", kind: "money", risk: true },
            { path: "writeOff.balanceWO.prn", label: "creditreport.detail.woBalanceWO", kind: "money", risk: true }] }
    ];
    const TEAMS = [["total", "creditreport.cd.teamTotal"], ["co", "creditreport.byBranch.teamCo"], ["fsro", "creditreport.byCO.fsro"], ["digital", "creditreport.byBranch.teamDigital"]];

    let detailedP = null;
    function detailed() {
        if (!detailedP) {
            detailedP = fetch(`${API.BASE_URL}/api/creditreport/detailed`, { headers: { Authorization: `Bearer ${token()}` } })
                .then(r => r.json()).then(d => (d && d.ok ? d : null))
                .catch(e => { console.error("detailed failed:", e); detailedP = null; return null; });
        }
        return detailedP;
    }

    async function load(branch) {
        const d = await detailed();
        if (!d) return null;
        let cur;
        if (branch) {
            const g = (d.groups || []).find(x => x.branch === branch);
            if (!g) return null;
            const by = Object.fromEntries(g.rows.map(r => [String(r.team).toLowerCase(), r]));
            cur = { total: by.total, co: by.co, fsro: by.fsro, digital: by.digital };
        } else {
            cur = d.grand;
        }
        let lm = null;
        try {
            const info = await CRLastMonth.load({ endpoint: "/api/creditreport/summary/history", token: token(), toDate: d.toDate });
            const day = info && info.day;
            if (day) {
                const it = branch ? (day.items || []).find(x => x.branch === branch) : day.total;
                if (it) lm = { date: info.date, total: it, ...(it.breakdown || {}) };
            }
        } catch (e) {
            console.error("last month failed:", e);
        }
        const plan = window.CIPlan ? await CIPlan.branch(branch ? [branch] : []) : null;
        return { branch, fromDate: d.fromDate, toDate: d.toDate, cur, lm, plan };
    }

    function fmt(kind, v) {
        if (v === null || v === undefined || Number.isNaN(v)) return "—";
        if (kind === "pct") return `${(v * 100).toFixed(2)}%`;
        return kind === "money" ? money(v) : num(v);
    }
    function change(m, cur, prev) {
        if (cur === undefined || cur === null || prev === undefined || prev === null) return `<span class="cd-flat">—</span>`;
        const d = cur - prev;
        if (Math.abs(d) < 1e-9) return `<span class="cd-flat">0</span>`;
        const good = m.risk ? d < 0 : d > 0;
        const txt = m.kind === "pct" ? `${(Math.abs(d) * 100).toFixed(2)} ${t("creditreport.pi.pts")}` : m.kind === "money" ? money(Math.abs(d)) : num(Math.abs(d));
        return `<span class="${good ? "cd-good" : "cd-bad"}">${d > 0 ? "▲" : "▼"} ${txt}</span>`;
    }
    const read = (m, it, lm) => (it == null ? undefined : m.read ? m.read(it) : get(it, lm && m.lm ? m.lm : m.path));

    // The plan cells of a metric on the Total row.
    function planCells(m, p) {
        const c = m.plan && p && p.metrics ? p.metrics[m.plan] : null;
        if (!c || c.plan === null || c.plan === undefined) return `<td class="num cd-plan">—</td><td class="num cd-plan">—</td>`;
        const metric = window.CIPlan ? CIPlan.METRICS.find(x => x.key === m.plan) : null;
        const plan = m.kind === "pct" ? c.plan / 100 : c.plan;
        const ach = metric ? CIPlan.achCell(metric, c) : "—";
        return `<td class="num cd-plan">${fmt(m.kind, plan)}${m.toDate && c.expected ? `<div class="cd-sub">${esc(t("creditreport.plan.expected", { v: fmt(m.kind, c.expected) }))}</div>` : ""}</td><td class="num cd-plan ci-plan-ach">${ach}</td>`;
    }

    function html(d, opts = {}) {
        if (!d) return `<p class="pi-note">${esc(t("creditreport.cd.none"))}</p>`;
        const lmHead = d.lm ? t("creditreport.cd.lmOf", { date: CI.dmy(d.lm.date) }) : t("creditreport.plan.lastMonth");
        const sections = (opts.sections ? SECTIONS.filter(s => opts.sections.includes(s.key)) : SECTIONS).map((s, i) => {
            const rows = [];
            for (const m of s.metrics) {
                TEAMS.forEach(([team, label], k) => {
                    const it = d.cur[team];
                    if (!it) return;
                    const cur = read(m, it);
                    const prev = d.lm ? read(m, d.lm[team], true) : undefined;
                    const first = k === 0;
                    rows.push(`<tr class="${first ? "cd-total" : "cd-team"}">
                        ${first ? `<td rowspan="${TEAMS.filter(([tm]) => d.cur[tm]).length}" class="cd-metric">${esc(t(m.label))}</td>` : ""}
                        <td class="cd-teamname">${esc(t(label))}</td>
                        <td class="num"><b>${fmt(m.kind, cur)}</b></td>
                        <td class="num">${fmt(m.kind, prev)}</td>
                        <td class="num">${change(m, cur, prev)}</td>
                        ${first ? planCells(m, d.plan) : `<td class="num cd-plan"></td><td class="num cd-plan"></td>`}
                    </tr>`);
                });
            }
            return `<div class="cd-sec">
                <h4 class="cd-h"><span class="cd-n">${opts.prefix ? `${opts.prefix}.${i + 1}` : i + 1}</span> ${esc(t(s.label))}</h4>
                ${s.note ? `<p class="cd-note">${esc(t(s.note))}</p>` : ""}
                <div class="cd-wrap"><table class="cd-table">
                <thead><tr><th>${esc(t("creditreport.plan.metric"))}</th><th>${esc(t("creditreport.cd.team"))}</th><th class="num">${esc(t("creditreport.plan.actual"))}</th><th class="num">${esc(lmHead)}</th><th class="num">±</th><th class="num">${esc(t("creditreport.plan.plan"))}</th><th class="num">${esc(t("creditreport.plan.ach"))}</th></tr></thead>
                <tbody>${rows.join("")}</tbody></table></div></div>`;
        }).join("");
        const head = `<p class="cd-note">${esc(t("creditreport.cd.intro", { from: CI.dmy(d.fromDate), to: CI.dmy(d.toDate), lm: d.lm ? CI.dmy(d.lm.date) : "—" }))}</p>`;
        return head + sections;
    }

    window.CIDaily = { load, html, SECTIONS };
})();
