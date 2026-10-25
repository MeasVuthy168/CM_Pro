/* =========================================================
   CI EXPLAIN (CM Pro AI — Phase 4: explain the figures)
   Turns a Credit Portfolio Intelligence response into a few plain
   sentences: what moved, and why, in the user's language.

   Rule-based on purpose (approved 25/10/2026): no AI service, nothing
   leaves the server. Every number in a sentence is a figure the
   backend already computed (or a count of its rows) — this module
   only picks, compares and formats; it never computes a financial
   figure. tests/ci-explain.test.js checks that rule on sample data.

   Used by the CM Pro AI chat (Home) and by the "💬 Explain" fold on
   each Credit Portfolio page.

   CIExplain.<topic>(data, t) → [sentence, ...]
     topics: overview | npl | recovery | risk | quality | growth | warning
   CIExplain.fmt — the formatters the sentences use.
========================================================= */
(function (root) {
    "use strict";

    const num = n => Math.round(Math.abs(Number(n) || 0)).toLocaleString("en-US");
    const money = n => (Number(n) < 0 ? "−$" : "$") + num(n);
    const signedMoney = n => (Number(n) > 0 ? "+" : Number(n) < 0 ? "−" : "") + "$" + num(n);
    const pct = (n, d = 2) => ((Number(n) || 0) * 100).toFixed(d) + "%";
    const dmy = k => {
        if (!k) return "—";
        const [y, m, d] = String(k).slice(0, 10).split("-");
        return `${d}/${m}/${y}`;
    };
    const fmt = { num, money, signedMoney, pct, dmy };

    const maxBy = (rows, f) => rows.reduce((best, r) => (best === null || f(r) > f(best) ? r : best), null);
    const nameOf = r => r.name || r.key || "—";

    // ---------- Portfolio Overview ----------
    function overview(d, t) {
        if (!d || d.empty) return [t("ex.none")];
        const k = d.kpis || {};
        const c = d.comparison || {};
        const out = [];
        const when = c.available && c.date ? dmy(c.date) : null;
        const os = k.outstanding;
        if (os) {
            out.push(os.prev != null && when
                ? t("ex.ov.os", { cur: money(os.cur), diff: signedMoney(os.diff), date: when })
                : t("ex.ov.osNow", { cur: money(os.cur) }));
        }
        const npl = k.nplPct;
        if (npl) {
            out.push(npl.prev != null
                ? t(`ex.ov.npl.${npl.trend === "good" ? "better" : npl.trend === "bad" ? "worse" : "same"}`, { prev: pct(npl.prev), cur: pct(npl.cur), value: money((k.nplValue || {}).cur) })
                : t("ex.ov.nplNow", { cur: pct(npl.cur), value: money((k.nplValue || {}).cur) }));
        }
        const par = k.parPct;
        if (par && par.prev != null) out.push(t("ex.ov.par", { prev: pct(par.prev), cur: pct(par.cur) }));
        const branches = ((d.composition || {}).branch || []).filter(r => r.os > 0);
        if (branches.length > 1 && npl) {
            const worst = maxBy(branches, r => r.nplPct);
            if (worst.nplPct > npl.cur) out.push(t("ex.ov.worstBranch", { name: nameOf(worst), pct: pct(worst.nplPct), avg: pct(npl.cur) }));
        }
        const high = (d.alerts || []).filter(a => a.level === "high").length;
        if (high) out.push(t("ex.ov.alerts", { n: high }));
        return out;
    }

    // ---------- NPL Movement ----------
    function npl(d, t) {
        const m = d && d.movement;
        if (!m || !m.available) return [t("ex.npl.na")];
        const tt = m.totals;
        const ex = m.exits || { recovered: tt.recovered, writeOff: { count: 0, bal: 0 }, moved: { count: 0, bal: 0 } };
        const out = [t("ex.npl.range", { open: money(tt.opening.bal), from: dmy(m.openingDate), close: money(tt.closing.bal), to: dmy(m.closingDate) })];
        out.push(t("ex.npl.new", { bal: money(tt.new.bal), n: num(tt.new.count) }));
        out.push(t("ex.npl.recovered", { bal: money(ex.recovered.bal), n: num(ex.recovered.count) }));
        if (ex.writeOff && ex.writeOff.count) out.push(t("ex.npl.wo", { bal: money(ex.writeOff.bal), n: num(ex.writeOff.count) }));
        if (ex.moved && ex.moved.count) out.push(t("ex.npl.moved", { bal: money(ex.moved.bal), n: num(ex.moved.count) }));
        if (tt.balanceChange) out.push(t("ex.npl.balance", { bal: signedMoney(tt.balanceChange) }));
        // Which side drove the change: compares the backend's own totals.
        const up = tt.closing.bal > tt.opening.bal;
        const down = tt.closing.bal < tt.opening.bal;
        if (up) out.push(t(tt.new.bal >= ex.recovered.bal ? "ex.npl.whyUpNew" : "ex.npl.whyUpOther"));
        else if (down) out.push(t(ex.recovered.bal >= tt.new.bal ? "ex.npl.whyDownRec" : "ex.npl.whyDownOther"));
        else out.push(t("ex.npl.flat"));
        return out;
    }

    // ---------- NPL Recovery ----------
    function recovery(d, t) {
        if (!d || !d.movement || !d.movement.available) return [t("ex.npl.na")];
        const k = d.kpis;
        const out = [t("ex.rec.main", { value: money(k.recovered.value), n: num(k.recovered.count), rate: pct(k.recoveryRate, 1), open: money(k.opening) })];
        if (k.target && k.target.value) {
            out.push(t(k.target.achievement >= 1 ? "ex.rec.targetMet" : "ex.rec.targetMiss", { ach: pct(k.target.achievement, 0), target: money(k.target.value) }));
        }
        out.push(t("ex.rec.new", { value: money(k.newNpl.value), n: num(k.newNpl.count), net: signedMoney(k.net) }));
        const rows = (d.byDim || []).filter(r => r.opening > 0);
        if (rows.length > 1) {
            const best = maxBy(rows, r => r.recoveryRate);
            const worst = maxBy(rows, r => -r.recoveryRate);
            out.push(t("ex.rec.bestWorst", { best: nameOf(best), bestRate: pct(best.recoveryRate, 1), worst: nameOf(worst), worstRate: pct(worst.recoveryRate, 1) }));
        }
        return out;
    }

    // ---------- Risk Contributors ----------
    function risk(d, t) {
        const rows = ((d && d.rows) || []).filter(r => r.os > 0 || r.nplValue > 0);
        const tot = (d && d.total) || {};
        if (!rows.length) return [t("ex.none")];
        const out = [];
        const top = maxBy(rows, r => r.nplValue);
        if (top && top.nplValue > 0) {
            out.push(t("ex.risk.top", { name: nameOf(top), npl: money(top.nplValue), share: pct(top.contribution, 1), total: money(tot.nplValue), os: money(top.os), totalOs: money(tot.os) }));
        }
        const worst = maxBy(rows.filter(r => r.os > 0), r => r.nplPct);
        if (worst && worst.nplPct > tot.nplPct) out.push(t("ex.risk.ratio", { name: nameOf(worst), pct: pct(worst.nplPct), avg: pct(tot.nplPct) }));
        const rise = maxBy(rows.filter(r => r.nplChange > 0), r => r.nplChange);
        if (rise) out.push(t("ex.risk.rise", { name: nameOf(rise), change: signedMoney(rise.nplChange) }));
        const above = rows.filter(r => r.os > 0 && r.nplPct > tot.nplPct).length;
        out.push(t("ex.risk.above", { n: above, total: rows.length }));
        return out;
    }

    // ---------- Portfolio Quality ----------
    function quality(d, t) {
        if (!d || !d.aging) return [t("ex.none")];
        const a = d.aging;
        const out = [t("ex.q.par", { p1: pct(a.par1.pct), p30: pct(a.par30.pct), p90: pct(a.par90.pct), v90: money(a.par90.value) })];
        const nb = d.normal;
        if (nb && nb.bands && nb.total && nb.total.count) {
            const big = maxBy(nb.bands, b => b.value);
            out.push(t("ex.q.normal", { from: big.from, to: big.to, value: money(big.value), share: pct(big.ofNormal, 1) }));
        }
        const c = d.classes || {};
        if (c.loss && c.loss.value) out.push(t("ex.q.loss", { value: money(c.loss.value), n: num(c.loss.count), pct: pct(c.loss.pct) }));
        const dist = (d.distribution || []).filter(r => r.os > 0);
        if (dist.length > 1) {
            const worst = maxBy(dist, r => r.par30.pct);
            out.push(t("ex.q.worst", { name: nameOf(worst), pct: pct(worst.par30.pct), avg: pct(a.par30.pct) }));
        }
        return out;
    }

    // ---------- Growth vs Risk ----------
    function growth(d, t) {
        const gr = d && d.growthRisk;
        const rows = ((d && d.rows) || []).filter(r => r.quadrant);
        if (!gr || !rows.length) return [t("ex.growth.na")];
        const n = q => rows.filter(r => r.quadrant === q).length;
        const out = [t("ex.growth.counts", { healthy: n("healthy"), risky: n("risky"), weak: n("weak"), stable: n("stable"), total: rows.length })];
        const weak = rows.filter(r => r.quadrant === "weak").sort((a, b) => b.os - a.os);
        if (weak.length) out.push(t("ex.growth.weak", { names: weak.slice(0, 3).map(nameOf).join(", ") }));
        const risky = rows.filter(r => r.quadrant === "risky").sort((a, b) => b.os - a.os);
        if (risky.length) out.push(t("ex.growth.risky", { names: risky.slice(0, 3).map(nameOf).join(", ") }));
        const th = gr.thresholds || {};
        if (th.growth != null && th.risk != null) out.push(t("ex.growth.th", { g: pct(th.growth, 1), r: pct(th.risk) }));
        return out;
    }

    // ---------- Early Warning ----------
    function warning(d, t) {
        const s = d && d.summary;
        if (!s) return [t("ex.none")];
        const total = s.high + s.medium + s.low;
        if (!total) return [t("ex.ew.none")];
        const out = [t("ex.ew.levels", { high: num(s.high), hbal: money(s.balance.high), medium: num(s.medium), low: num(s.low) })];
        const by = s.byRule || {};
        const topRule = Object.keys(by).sort((a, b) => by[b] - by[a])[0];
        if (topRule) out.push(t("ex.ew.topRule", { rule: t(`ex.rule.${topRule}`), n: num(by[topRule]) }));
        if (by.nopromise || by.noreason) out.push(t("ex.ew.todo", { np: num(by.nopromise || 0), nr: num(by.noreason || 0) }));
        const high = (d.rows || []).filter(r => r.level === "high");
        if (high.length) {
            const per = new Map();
            for (const r of high) {
                const id = r.officerName || r.officerId;
                per.set(id, (per.get(id) || 0) + 1);
            }
            const [who, n] = [...per.entries()].sort((a, b) => b[1] - a[1])[0];
            out.push(t("ex.ew.officer", { name: who, n }));
        }
        return out;
    }

    const api = { overview, npl, recovery, risk, quality, growth, warning, fmt };
    root.CIExplain = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
