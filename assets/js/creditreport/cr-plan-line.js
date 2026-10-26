// ========================================
// Plan line of the Daily History chart (Daily Report by Branch /
// Officer): each day's plan — the Monthly Plan of that day's month —
// next to the day's figure, from /api/creditreport/plan-series.
//   CRPlanLine.load({ dim, keys, days, token })   → series (or null)
//   CRPlanLine.planFor(series, fieldKey, dateKey) → plan in the field's
//     own unit (a PAR % plan as a fraction), or null
//   CRPlanLine.dataset(series, field, days, label) → Chart.js dataset or null
// Only fields with a monthly plan get a line: Loan Outstanding, KHR /
// ≤ $50,000, Loan Disburse (month to date), NBC Overdue % and NPL %
// (ceilings). LOS and WO Collected are yearly plans and are left out.
// ========================================
(function () {
    // field key → [plan metric, is a % ceiling]
    const FIELD_METRIC = {
        "loanOutstanding.loan": ["osCount"],
        "loanOutstanding.client": ["osClients"],
        "loanOutstanding.value": ["osAmount"],
        "osMix.khr": ["osKhr"],
        "osMix.small": ["osSmall"],
        "loanDisburse.loan": ["disbCount"],
        "loanDisburse.value": ["disbAmount"],
        "nbcOverdue.total.parPct": ["nbcOverduePct", true],
        "nbcOverdue.totalOwn.parPct": ["nbcOverduePct", true],
        "nbcOverdue.nonPerformingLoan.parPct": ["nplPct", true]
    };
    const cache = new Map();

    function monthOf(dateKey) {
        return String(dateKey || "").slice(0, 7);
    }

    function hasPlan(fieldKey) {
        return !!FIELD_METRIC[fieldKey];
    }

    // series: { "YYYY-MM": { metric: plan } } for the days' months.
    async function load({ dim, keys, days, token }) {
        if (!days || !days.length) return null;
        const months = days.map(d => monthOf(d.date)).filter(Boolean).sort();
        const q = new URLSearchParams({ dim, from: months[0], to: months[months.length - 1] });
        (keys || []).forEach(k => q.append("key", k));
        const url = `${API.BASE_URL}/api/creditreport/plan-series?${q.toString()}`;
        if (cache.has(url)) return cache.get(url);
        try {
            const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
            const body = await res.json().catch(() => ({}));
            const series = res.ok && body.ok ? body.months || {} : null;
            cache.set(url, series);
            return series;
        } catch (e) {
            console.error("plan series failed:", e);
            return null;
        }
    }

    function planFor(series, fieldKey, dateKey) {
        const m = FIELD_METRIC[fieldKey];
        if (!series || !m) return null;
        const v = (series[monthOf(dateKey)] || {})[m[0]];
        if (v === undefined || v === null) return null;
        return m[1] ? v / 100 : v;
    }

    function isCeiling(fieldKey) {
        return !!(FIELD_METRIC[fieldKey] || [])[1];
    }

    // A dashed gold line, stepping at each month's start.
    function dataset(series, field, days, label) {
        if (!field || !hasPlan(field.key)) return null;
        const data = days.map(d => planFor(series, field.key, d.date));
        if (!data.some(v => v !== null)) return null;
        const gold = getComputedStyle(document.documentElement).getPropertyValue("--cr-plan-line").trim() || "#D4A017";
        return {
            label,
            data,
            borderColor: gold,
            backgroundColor: gold,
            borderDash: [6, 4],
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 3,
            stepped: true,
            spanGaps: false,
            crPlan: true
        };
    }

    window.CRPlanLine = { load, planFor, dataset, hasPlan, isCeiling };
})();
