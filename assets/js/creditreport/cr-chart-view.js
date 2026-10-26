// ========================================
// Daily History chart view — shared by the 4 Daily Monitoring pages
// (RepDetailbyBranch/CO/Product/Location.js). Draws the whole chart
// popup from the already-fetched history days (no API calls):
//   - header: section icon / name, unit, scope + date-range chips
//   - hero card: the picked figure on the latest day, its change since
//     the first day, and — where a Monthly Plan exists (Branch /
//     Officer) — plan, achievement bar and status badge
//   - chart card: the daily line(s), the dashed plan line, the band
//     above / below plan, peak and latest-value markers
//   - small cards for the section's other figures (Was / change / plan)
//   - "About this chart" and Key Insights worked out from the days
//
//   crChartInstance = CRChartView.render({
//     section, days, metricLabel, scopeParts: ["Svay Rieng", "All Team"],
//     xLabels, colors, getItemForDay, getByPath, fmtNum,
//     getPlan,      // optional: (field, dateKey) → { value, ceiling } | null
//     hasPlanFor,   // optional: fieldKey → true when the field can have a plan
//     planDataset   // optional: (field) → the dashed plan dataset (CRPlanLine)
//   });
// ========================================
(function () {
    const tr = (key, vars, fallback) => {
        const s = window.CMI18n ? CMI18n.t(`creditreport.chartv.${key}`, vars) : null;
        if (s && s !== `creditreport.chartv.${key}`) return s;
        let out = fallback;
        for (const [k, v] of Object.entries(vars || {})) out = out.replace(`{${k}}`, v);
        return out;
    };

    function esc(text) {
        const div = document.createElement("div");
        div.textContent = text == null ? "" : String(text);
        return div.innerHTML.replace(/"/g, "&quot;");
    }

    const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const parts = key => String(key || "").split("-").map(Number);
    function fmtDay(key) {
        const [, m, d] = parts(key);
        return m ? `${d} ${MONTHS[m - 1]}` : "";
    }
    function fmtRange(a, b) {
        const [ya, ma, da] = parts(a);
        const [yb, mb, db] = parts(b);
        if (!ya || !yb) return "";
        if (a === b) return `${db} ${MONTHS[mb - 1]} ${yb}`;
        if (ya === yb && ma === mb) return `${da}–${db} ${MONTHS[mb - 1]} ${yb}`;
        if (ya === yb) return `${da} ${MONTHS[ma - 1]} – ${db} ${MONTHS[mb - 1]} ${yb}`;
        return `${da} ${MONTHS[ma - 1]} ${ya} – ${db} ${MONTHS[mb - 1]} ${yb}`;
    }

    // A rise is bad news for these (overdue, PAR, write-off balance / new
    // write-offs) — same rule as the growth cards had.
    function higherIsWorse(key) {
        return /^(parT24|nbcOverdue)/.test(key) || /^writeOff\w*\.(balanceWO|wo)\./.test(key);
    }
    // Month-to-date figures restart on the 1st, so a drop there is no dip.
    function monthToDate(key) {
        return /^loanDisburse|^loanLos/.test(key);
    }

    function icon(key) {
        const name = /^loanOutstanding|^osMix/.test(key) ? "money-bag"
            : /^loanDisburse|^loanLos/.test(key) ? "money"
            : /^parT24/.test(key) ? "warning"
            : /^nbcOverdue/.test(key) ? "stopwatch-alert"
            : /^writeOff/.test(key) ? "writeoff"
            : "barchart";
        return `<span class="cr-ico cr-ico-${name}" aria-hidden="true"></span>`;
    }

    function compact(n) {
        const abs = Math.abs(n);
        if (abs >= 1e9) return (n / 1e9).toFixed(2) + "B";
        if (abs >= 1e6) return (n / 1e6).toFixed(2) + "M";
        if (abs >= 1e3) return (n / 1e3).toFixed(1) + "K";
        return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
    }

    // Formats for one field: full, short (chart labels), and a change.
    function formatter(field, fmtNum) {
        if (field.pct) {
            const p = v => (v * 100).toFixed(2) + "%";
            return { full: p, short: p, delta: d => (d * 100).toFixed(2) + " pt", unit: "%" };
        }
        if (field.money) {
            const m = v => (v < 0 ? "-$" : "$") + fmtNum(Math.abs(v));
            return { full: m, short: v => "$" + compact(v), delta: d => "$" + fmtNum(Math.abs(d)), unit: "USD" };
        }
        return { full: v => fmtNum(v), short: v => compact(v), delta: d => fmtNum(Math.abs(d)), unit: "" };
    }

    function pointsOf(days, getItemForDay, getByPath, key) {
        return days.map(day => {
            const item = getItemForDay(day);
            const raw = item ? getByPath(item, key) : null;
            const v = raw == null || raw === "" ? null : Number(raw);
            return { date: day.date, value: Number.isFinite(v) ? v : null };
        });
    }

    // Change since the first day: { d, rel, tone, arrow }. None for a
    // month-to-date figure over more than one month (it restarts on the 1st).
    function changeOf(field, pts) {
        const have = pts.filter(p => p.value !== null);
        if (have.length < 2) return null;
        const first = have[0], last = have[have.length - 1];
        if (monthToDate(field.key) && first.date.slice(0, 7) !== last.date.slice(0, 7)) return null;
        const d = last.value - first.value;
        const flat = Math.abs(d) < 1e-9;
        const up = d > 0;
        const tone = flat ? "flat" : up !== higherIsWorse(field.key) ? "good" : "bad";
        const rel = !field.pct && first.value ? d / Math.abs(first.value) : null;
        return { first, last, d, rel, flat, tone, arrow: flat ? "—" : up ? "▲" : "▼" };
    }

    function chip(field, f, ch) {
        if (!ch) return "";
        const sign = ch.flat ? "" : ch.d > 0 ? "+" : "−";
        const rel = ch.rel === null || ch.flat ? "" : ` (${sign}${(Math.abs(ch.rel) * 100).toFixed(1)}%)`;
        return `<span class="crv-chip ${ch.tone}"><span aria-hidden="true">${ch.arrow}</span> ${esc(sign + f.delta(ch.d) + rel)}</span>`;
    }

    // Plan block of a figure: { html, status, ach } — status for the badge.
    function planOf(field, f, value, plan, { big }) {
        if (!plan || plan.value == null) return null;
        const scale = Math.max(value, plan.value) || 1;
        const fill = Math.max(0, Math.min(1, value / scale));
        const mark = Math.max(0, Math.min(1, plan.value / scale));
        if (plan.ceiling) {
            const ok = value <= plan.value;
            const gap = Math.abs(value - plan.value);
            const html = `
                <div class="crv-plan-row"><span>${esc(tr("ceiling", null, "Ceiling"))} <b>≤ ${esc(f.full(plan.value))}</b></span>
                    <span class="crv-ach ${ok ? "good" : "bad"}">${esc(ok ? tr("within", null, "Within") : tr("above", null, "Above"))}</span></div>
                <div class="crv-bar ${ok ? "good" : "bad"}"><i style="width:${(fill * 100).toFixed(1)}%"></i><b style="left:${(mark * 100).toFixed(1)}%"></b></div>
                ${big ? `<div class="crv-plan-note">${esc(ok
                    ? tr("underCeiling", { gap: f.delta(gap) }, "{gap} under the ceiling")
                    : tr("overCeiling", { gap: f.delta(gap) }, "{gap} over the ceiling"))}</div>` : ""}`;
            return { html, status: ok ? "good" : "bad", ach: null };
        }
        const ach = plan.value ? value / plan.value : null;
        const tone = ach === null ? "" : ach >= 1 ? "good" : ach >= 0.8 ? "warn" : "bad";
        const gap = value - plan.value;
        const html = `
            <div class="crv-plan-row"><span>${esc(tr("plan", null, "Plan"))} <b>${esc(f.full(plan.value))}</b></span>
                <span class="crv-ach ${tone}">${ach === null ? "—" : (ach * 100).toFixed(1) + "%"}</span></div>
            <div class="crv-bar ${tone}"><i style="width:${(fill * 100).toFixed(1)}%"></i><b style="left:${(mark * 100).toFixed(1)}%"></b></div>
            ${big ? `<div class="crv-plan-note">${esc(gap >= 0
                ? tr("abovePlan", { gap: "+" + f.delta(gap) }, "{gap} above plan")
                : tr("belowPlan", { gap: "−" + f.delta(gap) }, "{gap} below plan"))}</div>` : ""}`;
        return { html, status: tone, ach };
    }

    function badge(status, ceiling) {
        if (!status) return "";
        const text = ceiling
            ? (status === "good" ? tr("withinCeiling", null, "Within ceiling") : tr("aboveCeiling", null, "Above ceiling"))
            : { good: tr("onTrack", null, "On track"), warn: tr("watch", null, "Watch"), bad: tr("behind", null, "Behind") }[status];
        return `<span class="crv-badge ${status}">${esc(text)}</span>`;
    }

    // ---------- Key insights (worked out from the days only) ----------
    function insightsOf(field, f, pts, getPlan, groupFields, days, getItemForDay, getByPath) {
        const have = pts.filter(p => p.value !== null);
        const out = [];
        if (have.length < 2) return out;
        const worse = higherIsWorse(field.key);
        const last = have[have.length - 1];

        // 1) Against the plan / ceiling.
        const plan = getPlan ? getPlan(field, last.date) : null;
        if (plan && plan.value != null) {
            const planned = have.map(p => ({ p, plan: getPlan(field, p.date) })).filter(x => x.plan && x.plan.value != null);
            if (plan.ceiling) {
                const ok = last.value <= plan.value;
                const allOk = planned.every(x => x.p.value <= x.plan.value);
                out.push({
                    tone: ok ? "good" : "bad",
                    title: ok ? (allOk ? tr("inCeilingAll", null, "Within the ceiling every day.") : tr("inCeiling", null, "Within the ceiling.")) : tr("overCeilingT", null, "Above the ceiling."),
                    text: tr("ceilingText", { value: f.full(last.value), plan: f.full(plan.value) }, "{value} against a ceiling of {plan}.")
                });
            } else {
                const ach = last.value / plan.value;
                const gap = last.value - plan.value;
                const allAbove = planned.every(x => x.p.value >= x.plan.value);
                out.push({
                    tone: ach >= 1 ? "good" : ach >= 0.8 ? "warn" : "bad",
                    title: ach >= 1 ? (allAbove ? tr("aboveAll", null, "Above plan every day.") : tr("aboveNow", null, "Above plan.")) : tr("belowNow", null, "Below plan."),
                    text: gap >= 0
                        ? tr("aboveText", { pct: (ach * 100).toFixed(1) + "%", gap: f.delta(gap) }, "Ends at {pct} of plan, {gap} above it.")
                        : tr("belowText", { pct: (ach * 100).toFixed(1) + "%", gap: f.delta(gap) }, "Ends at {pct} of plan, {gap} short.")
                });
            }
        }

        // 2) The biggest fall (or, where a rise is bad news, the biggest
        //    rise). Month-to-date figures restart on the 1st — skipped.
        if (!monthToDate(field.key)) {
            let best = null;
            let ref = have[0];
            for (const p of have) {
                if (worse ? p.value < ref.value : p.value > ref.value) ref = p;
                const move = worse ? p.value - ref.value : ref.value - p.value;
                if (move > 0 && (!best || move > best.move)) best = { move, from: ref, to: p };
            }
            const size = Math.abs(ref.value) || 1;
            if (best && (field.pct ? best.move >= 0.0005 : best.move / size >= 0.002)) {
                out.push({
                    tone: "bad",
                    title: worse ? tr("biggestRise", null, "Biggest rise.") : tr("biggestDip", null, "Biggest dip."),
                    text: tr(worse ? "riseText" : "dipText", { amt: f.delta(best.move), from: fmtDay(best.from.date), to: fmtDay(best.to.date) },
                        worse ? "Up {amt} between {from} and {to}." : "About {amt} fell between {from} and {to}.")
                });
            }
        }

        // 3) The latest run: days in a row moving the same way.
        let n = 0, dir = 0, since = last;
        for (let i = have.length - 1; i > 0; i--) {
            const d = have[i].value - have[i - 1].value;
            const s = d > 0 ? 1 : d < 0 ? -1 : 0;
            if (!s) break;
            if (dir && s !== dir) break;
            dir = s;
            n++;
            since = have[i - 1];
        }
        if (n >= 2) {
            const good = (dir > 0) !== worse;
            out.push({
                tone: good ? "good" : "bad",
                title: dir > 0 ? tr("risingSince", { date: fmtDay(since.date) }, "Rising since {date}.") : tr("fallingSince", { date: fmtDay(since.date) }, "Falling since {date}."),
                text: tr("streakText", { n, amt: f.delta(last.value - since.value) }, "{n} days in a row, {amt} in all.")
            });
        }

        // 4) Average loan size, where the section has # loans and a value.
        const loanF = groupFields.find(x => /\.loan$/.test(x.key));
        const valueF = groupFields.find(x => x.money && /\.value$/.test(x.key));
        if (loanF && valueF) {
            const lp = pointsOf(days, getItemForDay, getByPath, loanF.key).filter(p => p.value);
            const vp = pointsOf(days, getItemForDay, getByPath, valueF.key);
            const avg = p => { const v = vp.find(x => x.date === p.date); return v && v.value !== null ? v.value / p.value : null; };
            if (lp.length >= 2) {
                const a = avg(lp[0]), b = avg(lp[lp.length - 1]);
                if (a !== null && b !== null && Math.abs(b - a) / a >= 0.005) {
                    const fm = v => "$" + Math.round(v).toLocaleString("en-US");
                    out.push({
                        tone: "info",
                        title: b < a ? tr("smallerTickets", null, "Smaller tickets.") : tr("biggerTickets", null, "Bigger tickets."),
                        text: tr("ticketText", { from: fm(a), to: fm(b) }, "Average loan size went from {from} to {to}.")
                    });
                }
            }
        }

        // 5) Nothing stood out: the overall change.
        const ch = changeOf(field, pts);
        if (!out.length && ch) {
            out.push({
                tone: ch.tone === "flat" ? "info" : ch.tone,
                title: ch.flat ? tr("steady", null, "Steady.") : tr("overall", null, "Over the period."),
                text: tr("overallText", { from: f.full(ch.first.value), to: f.full(ch.last.value) }, "From {from} to {to}.")
            });
        }
        return out;
    }

    // ---------- Chart.js: peak label, latest-value bubble, plan label ----------
    function markersPlugin(primaryIndex, planIndex, f, colors) {
        return {
            id: "crvMarkers",
            afterDatasetsDraw(chart) {
                const { ctx, chartArea } = chart;
                const ds = chart.data.datasets[primaryIndex];
                const meta = chart.getDatasetMeta(primaryIndex);
                if (!ds || !meta || meta.hidden) return;
                const style = getComputedStyle(document.documentElement);
                const text = style.getPropertyValue("--cr-text").trim() || "#333";
                const surface = style.getPropertyValue("--cr-chart-surface").trim() || "#fff";
                ctx.save();
                ctx.font = "600 11px system-ui, sans-serif";
                ctx.textBaseline = "bottom";
                let lastIdx = -1, peakIdx = -1;
                ds.data.forEach((v, i) => {
                    if (v === null) return;
                    lastIdx = i;
                    if (peakIdx < 0 || v > ds.data[peakIdx]) peakIdx = i;
                });
                if (peakIdx >= 0 && peakIdx !== lastIdx && ds.data.filter(v => v !== null).length > 2) {
                    const p = meta.data[peakIdx];
                    const label = `${tr("peak", null, "Peak")} ${f.short(ds.data[peakIdx])}`;
                    ctx.fillStyle = text;
                    ctx.textAlign = "center";
                    const x = Math.min(Math.max(p.x, chartArea.left + 30), chartArea.right - 30);
                    ctx.fillText(label, x, p.y - 8);
                }
                if (lastIdx >= 0) {
                    const p = meta.data[lastIdx];
                    const label = f.short(ds.data[lastIdx]);
                    const w = ctx.measureText(label).width + 12, h = 18;
                    const x = Math.min(p.x - w / 2, chartArea.right - w);
                    const y = Math.max(p.y - h - 10, chartArea.top);
                    ctx.fillStyle = colors[0];
                    ctx.beginPath();
                    if (ctx.roundRect) ctx.roundRect(x, y, w, h, 5); else ctx.rect(x, y, w, h);
                    ctx.fill();
                    ctx.fillStyle = "#fff";
                    ctx.textAlign = "center";
                    ctx.textBaseline = "middle";
                    ctx.fillText(label, x + w / 2, y + h / 2 + 0.5);
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
                    ctx.fillStyle = surface;
                    ctx.fill();
                    ctx.lineWidth = 2.5;
                    ctx.strokeStyle = colors[0];
                    ctx.stroke();
                }
                if (planIndex >= 0) {
                    const pd = chart.data.datasets[planIndex];
                    const pm = chart.getDatasetMeta(planIndex);
                    // At the start of the last plan level, clear of the
                    // latest-value bubble on the right.
                    let i = pd.data.length - 1;
                    while (i >= 0 && pd.data[i] === null) i--;
                    if (i >= 0) {
                        let s = i;
                        while (s > 0 && pd.data[s - 1] === pd.data[i]) s--;
                        const above = ds.data[s] !== null && ds.data[s] < pd.data[i];
                        ctx.fillStyle = pd.borderColor;
                        ctx.textAlign = "left";
                        ctx.textBaseline = above ? "bottom" : "top";
                        ctx.fillText(`${tr("plan", null, "Plan")} ${f.short(pd.data[i])}`,
                            Math.min(pm.data[s].x + 4, chartArea.right - 90), pm.data[s].y + (above ? -5 : 5));
                    }
                }
                ctx.restore();
            }
        };
    }

    // Chart | Analysis: the popup fits the screen without scrolling, so
    // Key insights sit on their own view. Kept across re-renders.
    let view = "chart";

    function setView(panel, v) {
        view = v === "insights" ? "insights" : "chart";
        panel.dataset.crvView = view;
        panel.querySelectorAll(".crv-view-btn").forEach(b => b.classList.toggle("active", b.dataset.view === view));
    }

    function render(opts) {
        const { section, days, metricLabel, scopeParts = [], xLabels, colors, getItemForDay, getByPath, fmtNum,
            getPlan, hasPlanFor, planDataset } = opts;
        const groups = section.groups.filter(g => g.fields.some(f => f.label === metricLabel));
        if (!groups.length || !days.length) return null;
        const group = groups[0];
        const field = group.fields.find(x => x.label === metricLabel);
        const f = formatter(field, fmtNum);
        const pts = pointsOf(days, getItemForDay, getByPath, field.key);
        const have = pts.filter(p => p.value !== null);
        const last = have[have.length - 1] || null;
        const first = have[0] || null;
        const range = fmtRange(days[0].date, days[days.length - 1].date);
        const worse = higherIsWorse(field.key);

        // ---- header ----
        const headerRoot = document.getElementById("crChartTitle");
        const title = group.label;
        const unit = field.pct ? "%" : field.money ? "USD" : field.label;
        headerRoot.innerHTML = `
            <div class="crv-head">
                <div class="crv-head-icon">${icon(field.key)}</div>
                <div class="crv-head-text">
                    <div class="crv-title">${esc(title)}</div>
                    <div class="crv-sub">${esc([unit, ...scopeParts.filter(Boolean), range].join(" · "))}</div>
                </div>
            </div>`;

        // ---- hero ----
        const hero = document.getElementById("crChartHero");
        const ch = changeOf(field, pts);
        const plan = last && getPlan ? getPlan(field, last.date) : null;
        const pb = last ? planOf(field, f, last.value, plan, { big: true }) : null;
        hero.innerHTML = last ? `
            <div class="crv-hero-top">
                <span class="crv-kicker">${esc(tr("asOf", { metric: field.label, date: fmtDay(last.date) }, "{metric} as of {date}"))}</span>
                ${pb ? badge(pb.status, plan.ceiling) : ""}
            </div>
            <div class="crv-hero-main">
                <span class="crv-hero-value">${esc(f.full(last.value))}</span>
                ${ch ? `<span class="crv-hero-change" title="${esc(tr("vsFirst", { value: f.full(ch.first.value), date: fmtDay(ch.first.date) }, "vs. {value} on {date}"))}">${chip(field, f, ch)}</span>` : ""}
            </div>
            ${ch ? `<div class="crv-muted crv-vs">${esc(tr("vsFirst", { value: f.full(ch.first.value), date: fmtDay(ch.first.date) }, "vs. {value} on {date}"))}</div>` : ""}
            ${pb ? `<div class="crv-hero-plan">${pb.html}</div>`
                : hasPlanFor && hasPlanFor(field.key) && getPlan ? `<div class="crv-muted crv-noplan">${esc(tr("noPlan", null, "No plan set"))}</div>` : ""}
        ` : `<div class="crv-muted">${esc(tr("noData", null, "No figures for these days."))}</div>`;
        hero.hidden = false;

        // ---- Chart | Analysis switch ----
        const panel = hero.closest(".cr-chart-panel");
        let views = document.getElementById("crChartViews");
        if (!views) {
            views = document.createElement("div");
            views.id = "crChartViews";
            views.className = "crv-views";
            views.setAttribute("role", "tablist");
            hero.after(views);
            views.addEventListener("click", e => {
                const b = e.target.closest(".crv-view-btn");
                if (b) setView(panel, b.dataset.view);
            });
        }
        views.innerHTML = `
            <button type="button" class="crv-view-btn" data-view="chart" role="tab">${esc(tr("viewChart", null, "Chart"))}</button>
            <button type="button" class="crv-view-btn" data-view="insights" role="tab">${esc(tr("viewInsights", null, "Analysis"))}</button>`;
        panel.classList.add("crv-fit");
        setView(panel, view);

        // ---- chart card head + datasets ----
        const datasets = [];
        let planIndex = -1;
        const goodShade = "rgba(46,160,110,.16)", badShade = "rgba(214,69,69,.14)";
        groups.forEach((g, idx) => {
            const fl = g.fields.find(x => x.label === metricLabel);
            const data = pointsOf(days, getItemForDay, getByPath, fl.key).map(p => p.value);
            const color = colors[idx % colors.length];
            datasets.push({
                label: g.label, data, borderColor: color, backgroundColor: color,
                pointRadius: data.length > 20 ? 0 : 3, pointHoverRadius: 5, pointBackgroundColor: color,
                borderWidth: 2.5, tension: 0.15, cubicInterpolationMode: "monotone"
            });
            const pds = planDataset ? planDataset(fl) : null;
            if (pds && idx === 0) {
                pds.label = tr("plan", null, "Plan");
                datasets.push(pds);
                planIndex = datasets.length - 1;
            }
        });
        // The band between the line and the plan (above / below), or a
        // soft area under a single line.
        if (groups.length === 1) {
            datasets[0].fill = planIndex >= 0
                ? { target: planIndex, above: worse ? badShade : goodShade, below: worse ? goodShade : badShade }
                : { target: "start", above: "rgba(57,135,229,.10)" };
        }
        const legend = [
            ...groups.map((g, i) => `<span class="crv-key"><i class="line" style="background:${colors[i % colors.length]}"></i>${esc(groups.length > 1 ? g.label : tr("actual", null, "Actual"))}</span>`),
            planIndex >= 0 ? `<span class="crv-key"><i class="dash"></i>${esc(tr("plan", null, "Plan"))}</span>` : "",
            planIndex >= 0 && groups.length === 1 ? `<span class="crv-key"><i class="band"></i>${esc(tr("abovePlanKey", null, "Above plan"))}</span>` : ""
        ].join("");
        document.getElementById("crChartCardHead").innerHTML = `
            <div class="crv-legend">${legend}${monthToDate(field.key) ? `<span class="crv-key crv-mtd">${esc(tr("mtd", null, "month to date"))}</span>` : ""}</div>`;

        // ---- other figures + insights ----
        const others = group.fields.filter(x => x.key !== field.key).map(x => {
            const xf = formatter(x, fmtNum);
            const xp = pointsOf(days, getItemForDay, getByPath, x.key);
            const xh = xp.filter(p => p.value !== null);
            if (!xh.length) return "";
            const xl = xh[xh.length - 1];
            const xch = changeOf(x, xp);
            const xplan = getPlan ? getPlan(x, xl.date) : null;
            const xpb = planOf(x, xf, xl.value, xplan, { big: false });
            return `
                <article class="crv-mini">
                    <div class="crv-mini-top"><span class="crv-kicker">${esc(x.label)}</span>${xch ? chip(x, xf, xch) : ""}</div>
                    <div class="crv-mini-value">${esc(xf.full(xl.value))}</div>
                    ${xpb ? `<div class="crv-mini-plan">${xpb.html}</div>`
                        : xch ? `<div class="crv-muted">${esc(tr("was", { value: xf.full(xch.first.value) }, "Was {value}"))}${hasPlanFor && hasPlanFor(x.key) && getPlan ? " · " + esc(tr("noPlan", null, "No plan set")) : ""}</div>` : ""}
                </article>`;
        }).filter(Boolean);

        const insights = insightsOf(field, f, pts, getPlan, group.fields, days, getItemForDay, getByPath);
        const scopeText = scopeParts.filter(Boolean).join(" — ");
        const about = [
            tr("aboutText", { metric: `${group.label} · ${field.label}`, scope: scopeText, range }, "{metric} for {scope}, day by day over {range}."),
            planIndex >= 0 ? tr("aboutPlan", null, "The solid line is the actual figure; the dashed gold line is the monthly plan, and the shaded band is the gap between them.") : "",
            monthToDate(field.key) ? tr("aboutMtd", null, "This figure is month to date, so it starts again on the 1st of each month.") : ""
        ].filter(Boolean).join(" ");
        const dash = document.getElementById("crGrowthDashboard");
        dash.innerHTML = `
            ${others.length ? `<div class="crv-minis" style="--crv-cols:${Math.min(others.length, 2)}">${others.join("")}</div>` : ""}
            <section class="crv-card crv-about">
                <div class="crv-card-title"><span class="crv-info" aria-hidden="true">i</span>${esc(tr("aboutTitle", null, "About this chart"))}</div>
                <p>${esc(about)}</p>
                ${insights.length ? `
                    <div class="crv-kicker crv-insights-title">${esc(tr("insights", null, "Key insights"))}</div>
                    <ul class="crv-insights">${insights.map(i => `<li class="${i.tone}"><b>${esc(i.title)}</b> ${esc(i.text)}</li>`).join("")}</ul>` : ""}
                <div class="crv-foot">${esc(tr("updated", { date: last ? fmtRange(last.date, last.date) : "" }, "Updated {date} · Source: daily snapshot"))}</div>
            </section>`;
        dash.hidden = false;

        // ---- chart ----
        const style = getComputedStyle(document.documentElement);
        const textMuted = style.getPropertyValue("--cr-text-muted").trim();
        const grid = style.getPropertyValue("--cr-chart-grid").trim();
        const values = datasets.flatMap(ds => ds.data).filter(v => v != null);
        const min = values.length ? Math.min(...values) : 0;
        const max = values.length ? Math.max(...values) : 0;
        const pad = Math.max((max - min) * 0.18, Math.abs(max) * 0.01, field.pct ? 0.001 : 1);
        return new Chart(document.getElementById("crChartCanvas").getContext("2d"), {
            type: "line",
            // "29-Sep-26" → "29 Sep": short enough for a phone's width.
            data: { labels: xLabels.map(l => String(l).replace(/^(\d{1,2})-([A-Za-z]{3})-\d{2}/, "$1 $2")), datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                layout: { padding: { top: 18, right: 8 } },
                interaction: { mode: "index", intersect: false },
                plugins: {
                    legend: { display: false },
                    tooltip: { callbacks: { label: c => c.parsed.y == null ? null : `${c.dataset.label}: ${f.full(c.parsed.y)}` } }
                },
                scales: {
                    y: {
                        suggestedMin: Math.max(0, min - pad),
                        suggestedMax: max + pad,
                        ticks: { color: textMuted, maxTicksLimit: 5, callback: v => f.short(v) },
                        grid: { color: grid },
                        border: { display: false }
                    },
                    x: { ticks: { color: textMuted, maxRotation: 0, autoSkip: true, autoSkipPadding: 14, maxTicksLimit: 4 }, grid: { display: false } }
                }
            },
            plugins: [markersPlugin(0, planIndex, f, colors)]
        });
    }

    window.CRChartView = { render, fmtDay, fmtRange, higherIsWorse };
})();
