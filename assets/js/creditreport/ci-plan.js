// ========================================
// Credit Portfolio Intelligence — Plan vs actual (shared)
// The Monthly Plan the Daily Monitoring reports already use, read from
// the same endpoints (nothing recalculated here):
//   GET /api/creditreport/plan-vs-actual          branch plan, month to date
//   GET /api/creditreport/officer-plan-vs-actual  officer plan (Own figures)
// For several branches the rows are added up the way the server's Total
// is: counts and amounts summed, a % weighted by Loan Outstanding (actual
// by actual OS, plan by planned OS); a plan only when every row has it.
//   CIPlan.branch(branches)  → { month, toDate, daysDone, daysInMonth, hasPlan, metrics } | null
//   CIPlan.officers()        → { month, rows: [{ id, metrics }] } | null
//   CIPlan.table(p, opts)    → <table> inner HTML (Actual | Plan | Achievement)
// ========================================
(function () {
    const t = (k, v) => (window.CMI18n ? CMI18n.t(k, v) : k);
    const token = () => localStorage.getItem("token") || sessionStorage.getItem("token");
    const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const num = n => (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
    const money = n => (Number(n) < 0 ? "−$" : "$") + num(Math.abs(Number(n) || 0));

    // Shown in this order; kind: amount | count | pct (0-100, lower is better)
    const METRICS = [
        { key: "osAmount", kind: "amount", label: "creditreport.plan.m.osAmount" },
        { key: "osCount", kind: "count", label: "creditreport.plan.m.osCount" },
        { key: "osClients", kind: "count", label: "creditreport.plan.m.osClients" },
        { key: "disbAmount", kind: "amount", label: "creditreport.plan.m.disbAmount", toDate: true },
        { key: "disbCount", kind: "count", label: "creditreport.plan.m.disbCount", toDate: true },
        { key: "nbcOverduePct", kind: "pct", label: "creditreport.plan.m.parPct" },
        { key: "nplPct", kind: "pct", label: "creditreport.plan.m.nplPct" },
        { key: "woCollected", kind: "amount", label: "creditreport.plan.m.woCollected", yearly: true }
    ];

    const cache = new Map();
    async function get(path) {
        if (cache.has(path)) return cache.get(path);
        const p = (async () => {
            try {
                const res = await fetch(`${API.BASE_URL}${path}`, { headers: { Authorization: `Bearer ${token()}` } });
                const body = await res.json().catch(() => ({}));
                return res.ok && body.ok ? body : null;
            } catch (e) {
                console.error("plan load failed:", e);
                return null;
            }
        })();
        cache.set(path, p);
        return p;
    }

    function combine(rows) {
        const out = {};
        const os = r => (r.metrics.osAmount || {}).actual || 0;
        const osPlan = r => (r.metrics.osAmount || {}).plan;
        for (const m of METRICS) {
            const cells = rows.map(r => r.metrics[m.key] || {});
            let actual = null, plan = null, expected = null;
            if (m.kind === "pct") {
                const w = rows.reduce((s, r) => s + os(r), 0);
                if (w && cells.every(c => c.actual !== null && c.actual !== undefined)) actual = rows.reduce((s, r, i) => s + cells[i].actual * os(r), 0) / w;
                const wp = rows.reduce((s, r) => s + (osPlan(r) || 0), 0);
                if (wp && cells.every((c, i) => c.plan !== null && c.plan !== undefined && osPlan(rows[i]))) plan = rows.reduce((s, r, i) => s + cells[i].plan * osPlan(r), 0) / wp;
            } else {
                if (cells.some(c => c.actual !== null && c.actual !== undefined)) actual = cells.reduce((s, c) => s + (Number(c.actual) || 0), 0);
                if (cells.every(c => c.plan !== null && c.plan !== undefined)) plan = cells.reduce((s, c) => s + Number(c.plan), 0);
                if (m.toDate && cells.every(c => c.expected !== null && c.expected !== undefined)) expected = cells.reduce((s, c) => s + Number(c.expected), 0);
            }
            out[m.key] = { actual, plan, expected, ach: plan && actual !== null ? actual / plan : null };
        }
        return out;
    }

    // branches: [] / null = every branch the user may see (the Total).
    async function branch(branches) {
        const d = await get("/api/creditreport/plan-vs-actual");
        if (!d) return null;
        const pick = (branches || []).filter(Boolean);
        let metrics;
        if (!pick.length) metrics = d.total ? combine([d.total]) : null;
        else {
            const rows = (d.rows || []).filter(r => pick.includes(r.branch));
            metrics = rows.length ? combine(rows) : null;
        }
        return { month: d.month, fromDate: d.fromDate, toDate: d.toDate, daysDone: d.daysDone, daysInMonth: d.daysInMonth, hasPlan: !!d.hasPlan, metrics };
    }

    // Every branch's own plan row (for a by-branch table).
    async function branchRows() {
        const d = await get("/api/creditreport/plan-vs-actual");
        if (!d) return null;
        return { month: d.month, toDate: d.toDate, hasPlan: !!d.hasPlan, rows: (d.rows || []).map(r => ({ id: r.branch, metrics: combine([r]) })) };
    }

    async function officers() {
        const d = await get("/api/creditreport/officer-plan-vs-actual");
        if (!d) return null;
        return { month: d.month, toDate: d.toDate, hasPlan: !!d.hasPlan, rows: (d.rows || []).map(r => ({ id: String(r.branch), metrics: combine([r]) })) };
    }

    function fmt(kind, v) {
        if (v === null || v === undefined) return "—";
        if (kind === "pct") return `${Number(v).toFixed(2)}%`;
        return kind === "amount" ? money(v) : num(v);
    }
    // Achievement cell: for a % ceiling, at or under the plan is good.
    function achCell(m, c) {
        if (!c || c.plan === null || c.plan === undefined || c.actual === null) return `<span class="ci-plan-na">—</span>`;
        if (m.kind === "pct") {
            const ok = c.actual <= c.plan;
            return `<span class="${ok ? "ci-plan-ok" : "ci-plan-bad"}">${ok ? "✓" : "▲"} ${(c.actual - c.plan > 0 ? "+" : "")}${(c.actual - c.plan).toFixed(2)} ${esc(t("creditreport.pi.pts"))}</span>`;
        }
        const target = m.toDate && c.expected ? c.actual / c.expected : c.ach;
        const pct = Math.round((c.ach || 0) * 100);
        const tone = target >= 1 ? "ok" : target >= 0.9 ? "warn" : "bad";
        return `<span class="ci-plan-bar"><span class="ci-plan-${tone}-bg" style="width:${Math.min(100, pct)}%"></span></span><span class="ci-plan-${tone}">${pct}%</span>`;
    }

    // opts.lastMonth: { key: value } (same units) adds a Last month column.
    function table(p, opts = {}) {
        if (!p || !p.metrics) return "";
        const lm = opts.lastMonth || null;
        const rows = METRICS.filter(m => opts.keys ? opts.keys.includes(m.key) : true).map(m => {
            const c = p.metrics[m.key] || {};
            const note = m.toDate && c.expected ? `<div class="ci-plan-sub">${esc(t("creditreport.plan.expected", { v: fmt(m.kind, c.expected) }))}</div>`
                : m.yearly ? `<div class="ci-plan-sub">${esc(t("creditreport.plan.ytd"))}</div>` : "";
            return `<tr><td>${esc(t(m.label))}${note}</td><td class="num"><b>${fmt(m.kind, c.actual)}</b></td>${lm ? `<td class="num">${fmt(m.kind, lm[m.key])}</td>` : ""}<td class="num">${fmt(m.kind, c.plan)}</td><td class="num ci-plan-ach">${achCell(m, c)}</td></tr>`;
        }).join("");
        return `<thead><tr><th>${esc(t("creditreport.plan.metric"))}</th><th class="num">${esc(t("creditreport.plan.actual"))}</th>${lm ? `<th class="num">${esc(t(opts.lmLabel || "creditreport.plan.lastMonth"))}</th>` : ""}<th class="num">${esc(t("creditreport.plan.plan"))}</th><th class="num">${esc(t("creditreport.plan.ach"))}</th></tr></thead><tbody>${rows}</tbody>`;
    }

    window.CIPlan = { branch, branchRows, officers, table, combine, fmt, achCell, METRICS };
})();
