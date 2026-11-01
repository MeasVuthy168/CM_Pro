// ========================================
// Credit Report — Daily Monitoring table helpers (design ក / គ):
// PAR % as a coloured pill, a small bar under a Value showing its size
// against the other rows, compact K / M amounts, and a soft right edge
// while more columns are off-screen. A cell whose text is shortened
// carries the exact figure in data-x, which the Excel / PDF export
// (cr-export.js) uses instead.
// ========================================

window.CRTable = (() => {
    // PAR %: green under 3%, amber under 5%, red from 5%.
    function parPill(v) {
        const n = Number(v) || 0;
        const cls = n < 0.03 ? "ok" : n < 0.05 ? "warn" : "bad";
        return `<span class="cr-pill cr-pill-${cls}">${(n * 100).toFixed(2)}%</span>`;
    }

    // A bar under a Value: its share of the largest row's.
    function bar(v, max) {
        const w = max > 0 ? Math.max(0, Math.min(100, (Number(v) || 0) / max * 100)) : 0;
        return `<div class="cr-bar"><i style="width:${w.toFixed(0)}%"></i></div>`;
    }

    // 3440104 -> "3.44M", 820716 -> "820.7K"
    function compact(v) {
        const n = Math.abs(v);
        const s = n >= 1e6 ? (n / 1e6).toFixed(2) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "K" : String(Math.round(n));
        return (v < 0 ? "-" : "") + s;
    }
    // The exact figure as the export reads it ("-560,047").
    const exact = v => Math.round(v).toLocaleString("en-US");

    // A soft right edge on a scroll box while more columns are off-screen.
    function edgeHint(box) {
        if (!box) return;
        const update = () => box.classList.toggle("cr-more-right", box.scrollLeft + box.clientWidth < box.scrollWidth - 4);
        if (!box._crEdgeHint) {
            box._crEdgeHint = true;
            box.addEventListener("scroll", update, { passive: true });
            window.addEventListener("resize", update);
        }
        requestAnimationFrame(update);
    }


    // ---- Plan vs Actual (shared by the Branch and Officer reports) ----
    const t = (key, vars) => (window.CMI18n ? CMI18n.t(key, vars) : key);
    const get = (obj, path) => path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
    const fmtNum = n => (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });

    // Laid out like Last Month: each group as three blocks, Plan | Actual
    // (highlighted) | % (or ± for a ceiling), every block with the
    // group's own figures as its columns. A group's fields come as runs
    // of [actual, plan, % / ±] (each report's crCompareSection). Each
    // block keeps its own section's label on `sectionLabel` (crBuildThead
    // groups consecutive blocks by it into its own header row, same as
    // the Excel export's section/lane/field header), while `label` is
    // just the lane name — Plan / Actual / % (or ± for a ceiling).
    function planBlocks(section) {
        const yearPlan = t("creditreport.plan.yearPlan");
        const groups = section.groups.flatMap(g => {
            const runs = [];
            g.fields.forEach(f => { if (!f.planCol || !runs.length) runs.push([f]); else runs[runs.length - 1].push(f); });
            const name = run => run[0].label;
            const plans = runs.map(r => ({ ...r[1], label: r[1].label === yearPlan ? yearPlan : name(r) }));
            const actuals = runs.map(r => ({ ...r[0], pvCur: true }));
            const ratios = runs.map(r => ({ ...r[2], label: name(r) }));
            const kinds = new Set(ratios.map(f => f.pv));
            const ratioHead = kinds.size > 1 ? "% / ±" : kinds.has("diff") ? "±" : "%";
            const first = fields => fields.map((f, i) => (i ? f : { ...f, grpStart: true }));
            return [
                { ...g, pvBlock: "plan", sectionLabel: g.label, label: t("creditreport.plan.plan"), fields: first(plans) },
                { ...g, pvBlock: "cur", sectionLabel: g.label, label: t("creditreport.plan.actual"), fields: first(actuals) },
                { ...g, pvBlock: "ratio", sectionLabel: g.label, label: ratioHead, fields: first(ratios) }
            ];
        });
        return { ...section, groups };
    }

    // One Plan vs Actual cell; "—" where there is no plan / no actual.
    function planCell(item, field) {
        const v = get(item, field.key);
        const dash = cls => `<td class="${cls} cr-pv-none">—</td>`;
        // % of plan: the figure with a progress bar (green ≥ 100%, amber ≥ 80%).
        if (field.pv === "ach") {
            if (v === null || v === undefined) return dash("cr-col-pct cr-plan-col");
            const pct = Math.round(v * 100);
            // Loan Disburse is red below 70% of plan; other figures below 80%.
            const redBelow = /^planVs\.disb/.test(field.key) ? 0.7 : 0.8;
            const cls = v >= 1 ? "cr-pv-good" : v >= redBelow ? "cr-pv-warn" : "cr-pv-bad";
            return `<td class="cr-col-pct cr-plan-col cr-ach ${cls}" data-x="${pct}%">${pct}%<div class="cr-ach-bar"><i style="width:${Math.max(0, Math.min(100, pct))}%"></i></div></td>`;
        }
        // ± against a ceiling (NBC Overdue % / NPL %): ▲ above the plan (red), ▼ under it (green).
        if (field.pv === "diff") {
            if (!v || v.plan === null || v.plan === undefined || v.actual === null || v.actual === undefined) return dash("cr-col-pct cr-plan-col");
            const d = Math.round((v.actual - v.plan) * 100) / 100;
            if (!d) return `<td class="cr-col-pct cr-plan-col" data-x="0.00">0.00</td>`;
            return `<td class="cr-col-pct cr-plan-col ${d < 0 ? "cr-pv-good" : "cr-pv-bad"}" data-x="${d.toFixed(2)}"><span class="cr-arrow">${d > 0 ? "▲" : "▼"}</span>${Math.abs(d).toFixed(2)}</td>`;
        }
        const cls = (field.pv === "pct" ? "cr-col-pct" : field.pv === "money" ? "cr-col-money" : "cr-col-num") + (field.planCol ? " cr-plan-col cr-plan-val" : "");
        if (v === null || v === undefined) return dash(cls);
        // An actual % against its ceiling: a pill, green within the plan, red above it.
        if (field.pv === "pct" && !field.planCol) {
            const plan = get(item, field.key.replace(/\.actual$/, ".plan"));
            const ok = plan === null || plan === undefined ? null : Number(v) <= Number(plan);
            const pill = ok === null ? "" : ok ? "cr-pill-ok" : "cr-pill-bad";
            return `<td class="${cls}">${pill ? `<span class="cr-pill ${pill}">${Number(v).toFixed(2)}%</span>` : Number(v).toFixed(2) + "%"}</td>`;
        }
        return `<td class="${cls}">${field.pv === "pct" ? Number(v).toFixed(2) + "%" : fmtNum(v)}</td>`;
    }

    // A cell's td with its block classes (first of a block, the Actual block).
    function blockClasses(html, field) {
        const extra = (field.grpStart ? "cr-grp-start " : "") + (field.pvCur ? "cr-pv-cur " : "");
        return extra ? html.replace('<td class="', `<td class="${extra}`) : html;
    }

    // ---- Section-name header row (Plan vs Actual / Last Month) ----
    // Shared by every Daily Monitoring report's own crBuildThead /
    // crBuildHistoryThead: when the active section's groups carry a
    // sectionLabel (planBlocks / CRLastMonth.expand), a 3rd header row
    // names the section each run of lane blocks belongs to — e.g.
    // "Outstanding" over "Plan" / "Actual" / "%", same shape as the
    // Excel export's section/lane/field header. No sectionLabel anywhere
    // (plain Actual-only view) keeps today's plain 2-row header.
    function headRowCount(section) {
        return section.groups.some(g => g.sectionLabel) ? 3 : 2;
    }
    function sectionLabelRow(section) {
        if (!section.groups.some(g => g.sectionLabel)) return "";
        const runs = [];
        section.groups.forEach(g => {
            const label = g.sectionLabel || g.label;
            const last = runs[runs.length - 1];
            if (last && last.label === label) last.span += g.fields.length;
            else runs.push({ label, span: g.fields.length });
        });
        return runs.map(r => `<th colspan="${r.span}" class="cr-section-head">${r.label}</th>`).join("");
    }

    return { parPill, bar, compact, exact, edgeHint, planBlocks, planCell, blockClasses, headRowCount, sectionLabelRow };
})();
