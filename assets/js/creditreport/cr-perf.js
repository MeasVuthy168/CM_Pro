// ========================================
// Credit Report — Productivity / Performance dashboard pieces (design
// "គ on top + ខ below"): the Comparison switch (Actual Only | Last
// Month | Plan), the 3-figure strip at the top, and each section card's
// comparison table (CO / FSRO / Digital / Total, or the plan metrics).
// Pure HTML builders — each page supplies its own figures.
// ========================================

window.CRPerf = (() => {
    const t = (key, vars) => (window.CMI18n ? CMI18n.t(key, vars) : key);
    const get = (obj, path) => path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
    const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
    const num = v => (typeof v === "number" && Number.isFinite(v) ? v : null);
    const fmtNum = n => (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
    const compact = n => (window.CRTable ? CRTable.compact(n) : fmtNum(n));

    // A figure as shown: % (fraction) as "8.55%", money as K / M when
    // asked, else the whole number.
    function fmt(v, f, short) {
        if (num(v) === null) return "—";
        if (f.pct) return `${(v * 100).toFixed(2)}%`;
        return f.money && short ? compact(v) : fmtNum(v);
    }

    // ▲ / ▼ now − last month: { html, cls } ("" when either is missing).
    // A % moves in points; risk = a rise is bad news (red).
    function delta(cur, prev, f, { withPct = false } = {}) {
        if (num(cur) === null || num(prev) === null) return { html: "", cls: "" };
        const d = cur - prev;
        const shown = f.pct ? Math.round(d * 10000) / 100 : Math.round(d);
        if (!shown) return { html: "0", cls: "" };
        const good = f.risk ? shown < 0 : shown > 0;
        const amount = f.pct ? Math.abs(shown).toFixed(2) : f.money ? compact(Math.abs(d)) : fmtNum(Math.abs(shown));
        const rel = withPct && !f.pct && prev ? ` · ${Math.abs(d / prev * 100).toFixed(1)}%` : "";
        return { html: `<span class="cp-arrow">${shown > 0 ? "▲" : "▼"}</span>${amount}${rel}`, cls: good ? "good" : "bad" };
    }

    const chip = (html, cls) => (html ? `<span class="cp-chip${cls ? ` cp-${cls}` : ""}">${html}</span>` : "");

    // Achievement colour: green from 100%, amber from 80% (70% for
    // Disburse), red below.
    function achCls(ach, disb) {
        if (num(ach) === null) return "";
        return ach >= 1 ? "good" : ach >= (disb ? 0.7 : 0.8) ? "warn" : "bad";
    }

    function bar(ach, cls) {
        const w = Math.max(0, Math.min(100, (Number(ach) || 0) * 100));
        return `<div class="cp-prog"><i class="cp-${cls || "muted"}" style="width:${w.toFixed(0)}%"></i></div>`;
    }

    function ring(ach, cls) {
        const r = 15, c = 2 * Math.PI * r;
        const w = Math.max(0, Math.min(1, Number(ach) || 0));
        return `<svg class="cp-ring cp-${cls || "muted"}" viewBox="0 0 36 36" aria-hidden="true">
          <circle cx="18" cy="18" r="${r}" class="cp-ring-bg"/>
          <circle cx="18" cy="18" r="${r}" class="cp-ring-fg" stroke-dasharray="${(w * c).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 18 18)"/>
          <text x="18" y="21" text-anchor="middle">${num(ach) === null ? "—" : Math.round(ach * 100) + "%"}</text></svg>`;
    }

    // The Comparison switch. modes: [{ key, label }]
    function switcher(modes, active) {
        return `<div class="cp-seg" role="tablist">${modes.map(m =>
            `<button type="button" role="tab" class="cp-seg-btn${m.key === active ? " on" : ""}" data-compare="${m.key}" aria-selected="${m.key === active}">${esc(m.label)}</button>`
        ).join("")}</div>`;
    }

    // The strip: [{ label, value (html), sub (html), ring (html) }]
    function strip(kpis) {
        return `<div class="cp-strip">${kpis.map(k => `
          <div class="cp-kpi">
            <div class="cp-kpi-label">${esc(k.label)}</div>
            ${k.ring || `<div class="cp-kpi-value">${k.value}</div>`}
            <div class="cp-kpi-sub">${k.sub || ""}</div>
          </div>`).join("")}</div>`;
    }

    // Actual Only: rows × fields. rows: [{ label, data, total }]
    function actualTable(rows, fields) {
        return `<table class="cp-table"><thead><tr><th></th>${fields.map(f => `<th>${esc(f.label)}</th>`).join("")}</tr></thead><tbody>
          ${rows.map(r => `<tr${r.total ? ' class="cp-total"' : ""}><td>${esc(r.label)}</td>${fields.map(f => {
              const v = get(r.data, f.k);
              return `<td>${f.pct && num(v) !== null && window.CRTable ? CRTable.parPill(v) : fmt(v, f)}</td>`;
          }).join("")}</tr>`).join("")}
        </tbody></table>`;
    }

    // Last Month: rows × (last | now | ±) of one field, then the other
    // fields' totals with their own ± under the table.
    // rows: [{ label, data, last, total }]
    function lastMonthTable(rows, field, { lastLabel, nowLabel }) {
        const body = rows.map(r => {
            const cur = get(r.data, field.k), prev = r.last ? get(r.last, field.k) : undefined;
            const d = delta(cur, prev, field);
            return `<tr${r.total ? ' class="cp-total"' : ""}><td>${esc(r.label)}</td><td>${fmt(prev, field, true)}</td><td class="cp-now">${fmt(cur, field, true)}</td><td class="cp-${d.cls}">${d.html || "—"}</td></tr>`;
        }).join("");
        return `<table class="cp-table"><thead><tr><th>${esc(field.label)}</th><th>${esc(lastLabel)}</th><th class="cp-now">${esc(nowLabel)}</th><th>±</th></tr></thead><tbody>${body}</tbody></table>`;
    }

    // "Loans 10,354 (▲ 212) · Clients 5,814 (▲ 98)" for the Total row.
    function lastMonthFoot(total, fields) {
        return fields.map(f => {
            const cur = get(total.data, f.k), prev = total.last ? get(total.last, f.k) : undefined;
            const d = delta(cur, prev, f);
            return `<span>${esc(f.label)} <b>${fmt(cur, f)}</b>${d.html ? ` <span class="cp-${d.cls}">(${d.html})</span>` : ""}</span>`;
        }).join("");
    }

    // Plan: one row per planned metric — Plan | Actual | % (a ceiling:
    // ± in points, ▼ = under it, good).
    // metrics: [{ label, m: { plan, actual, ach }, money, pctPts, lowerBetter, disb }]
    function planTable(metrics) {
        const v = (x, mt) => (num(x) === null ? "—" : mt.pctPts ? `${Number(x).toFixed(2)}%` : mt.money ? compact(x) : fmtNum(x));
        const body = metrics.map(mt => {
            const m = mt.m || {};
            let last;
            if (mt.lowerBetter) {
                const d = num(m.plan) !== null && num(m.actual) !== null ? Math.round((m.actual - m.plan) * 100) / 100 : null;
                last = d === null ? "<td>—</td>" : `<td class="cp-${d <= 0 ? "good" : "bad"}"><span class="cp-arrow">${d > 0 ? "▲" : d < 0 ? "▼" : ""}</span>${Math.abs(d).toFixed(2)}</td>`;
            } else {
                const cls = achCls(m.ach, mt.disb);
                last = num(m.ach) === null ? "<td>—</td>" : `<td class="cp-${cls}">${Math.round(m.ach * 100)}%</td>`;
            }
            return `<tr><td>${esc(mt.label)}</td><td>${v(m.plan, mt)}</td><td class="cp-now">${v(m.actual, mt)}</td>${last}</tr>`;
        }).join("");
        return `<table class="cp-table"><thead><tr><th></th><th>${esc(t("creditreport.plan.plan"))}</th><th class="cp-now">${esc(t("creditreport.plan.actual"))}</th><th>%</th></tr></thead><tbody>${body}</tbody></table>`;
    }

    return { fmt, delta, chip, achCls, bar, ring, switcher, strip, actualTable, lastMonthTable, lastMonthFoot, planTable, compact };
})();
