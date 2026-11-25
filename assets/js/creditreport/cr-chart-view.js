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
//     planDataset,  // optional: (field, slots, series) → the dashed plan dataset (CRPlanLine)
//     history,      // { path, params, token } of the Daily History request —
//                   //   Monthly / Yearly re-ask it with ?monthEnd=1
//     rerender,     // () → draws the chart again (once those days arrive)
//     loadPlan      // optional: (days) → the plan series for those days
//   });
// getPlan / planDataset get a 3rd argument in Monthly / Yearly: the plan
// series loaded for that period (undefined in Daily: the page's own).
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

    // extra: more decimals, for axis labels that would otherwise repeat.
    function compact(n, extra = 0) {
        const abs = Math.abs(n);
        if (abs >= 1e9) return (n / 1e9).toFixed(2 + extra) + "B";
        if (abs >= 1e6) return (n / 1e6).toFixed(2 + extra) + "M";
        if (abs >= 1e3) return (n / 1e3).toFixed(1 + extra) + "K";
        return n.toLocaleString(undefined, { maximumFractionDigits: 2 + extra });
    }

    // Formats for one field: full, short (chart labels), and a change.
    function formatter(field, fmtNum) {
        if (field.pct) {
            const p = v => (v * 100).toFixed(2) + "%";
            return { full: p, short: p, shortX: (v, x) => (v * 100).toFixed(2 + x) + "%", delta: d => (d * 100).toFixed(2) + " pt", unit: "%" };
        }
        if (field.money) {
            const m = v => (v < 0 ? "-$" : "$") + fmtNum(Math.abs(v));
            return { full: m, short: v => "$" + compact(v), shortX: (v, x) => "$" + compact(v, x), delta: d => "$" + fmtNum(Math.abs(d)), unit: "USD" };
        }
        return { full: v => fmtNum(v), short: v => compact(v), shortX: (v, x) => compact(v, x), delta: d => fmtNum(Math.abs(d)), unit: "" };
    }

    // Change { d, rel, tone, arrow }. Daily: since the first day — none
    // for a month-to-date figure over more than one month (it restarts on
    // the 1st). Monthly / Yearly: since the month / year before (MoM / YoY).
    function changeOf(field, pts, mode = "daily") {
        const have = pts.filter(p => p.value !== null);
        if (have.length < 2) return null;
        const first = mode === "daily" ? have[0] : have[have.length - 2], last = have[have.length - 1];
        if (mode === "daily" && monthToDate(field.key) && first.date.slice(0, 7) !== last.date.slice(0, 7)) return null;
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
    function insightsOf(field, f, pts, getPlan, groupFields, ptsOf, mode, lab) {
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
                    text: tr(worse ? "riseText" : "dipText", { amt: f.delta(best.move), from: lab(best.from.date), to: lab(best.to.date) },
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
                title: dir > 0 ? tr("risingSince", { date: lab(since.date) }, "Rising since {date}.") : tr("fallingSince", { date: lab(since.date) }, "Falling since {date}."),
                text: mode === "monthly" ? tr("streakTextMonthly", { n, amt: f.delta(last.value - since.value) }, "{n} months in a row, {amt} in all.")
                    : mode === "yearly" ? tr("streakTextYearly", { n, amt: f.delta(last.value - since.value) }, "{n} years in a row, {amt} in all.")
                    : tr("streakText", { n, amt: f.delta(last.value - since.value) }, "{n} days in a row, {amt} in all.")
            });
        }

        // 4) Average loan size, where the section has # loans and a value.
        const loanF = groupFields.find(x => /\.loan$/.test(x.key));
        const valueF = groupFields.find(x => x.money && /\.value$/.test(x.key));
        if (loanF && valueF) {
            const lp = ptsOf(loanF.key).filter(p => p.value);
            const vp = ptsOf(valueF.key);
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
        const ch = changeOf(field, pts, mode);
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
    // ---------- the chart's own calendar (chart step 1, 24/11/2026) ----------
    // The saved days are not every day (none for months, two a day …), so
    // the line used to space them evenly and mix a year-end with October's
    // days. The chart now lays them on a real calendar:
    //   up to ~3 months (92 days): one slot per calendar day — a day not
    //     saved is an empty slot, so the line breaks there;
    //   longer: one slot per month — that month's last saved day — so a
    //     long range reads month by month (a month with no save: a gap).
    // Returns { days, labels, ticks, mode }; days are the saved day
    // objects, or { date, crEmpty: true } for an empty slot.
    const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    // Non-working days (owner, 25/11/2026): the line runs across a
    // weekend or a Khmer public holiday (no data is made then) and breaks
    // only where a WORKING day wasn't saved. The holidays come once from
    // the server (the same list the Productivity heatmaps use); until
    // they arrive, weekends only.
    const holidays = new Set();
    try {
        const token = localStorage.getItem("token") || sessionStorage.getItem("token");
        if (token && window.API && API.BASE_URL) {
            fetch(`${API.BASE_URL}/api/creditreport/byco/kh-holidays`, { headers: { Authorization: `Bearer ${token}` } })
                .then(r => r.json())
                .then(d => (d && d.holidays || []).forEach(h => holidays.add(String(h.date || h).slice(0, 10))))
                .catch(() => {});
        }
    } catch (e) { /* weekends only */ }
    const offDay = k => { const wd = new Date(`${k}T00:00:00Z`).getUTCDay(); return wd === 0 || wd === 6 || holidays.has(k); };
    const dayMs = d => Date.parse(`${d}T00:00:00Z`);
    const keyOf = ms => new Date(ms).toISOString().slice(0, 10);
    // mode "daily": one slot per calendar day (an unsaved day is empty;
    //   weekends / holidays marked crOff). levels: the x ticks from fine
    //   to coarse (1/8/15/22 → 1/15 → the 1st → every 2nd / 3rd month →
    //   January) — the chart picks the finest that fits its width.
    // mode "monthly": one slot per month — its last saved day.
    // mode "yearly": one slot per year — its last saved day, with the
    //   year's month-ends in crMonths (month-to-date figures add them up).
    function calendarOf(days, mode) {
        const ds = days.filter(d => d && /^\d{4}-\d{2}-\d{2}/.test(String(d.date))).slice()
            .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
        if (!ds.length) return { days: [], labels: [], levels: null, mode };
        const first = String(ds[0].date).slice(0, 10), last = String(ds[ds.length - 1].date).slice(0, 10);
        if (mode === "yearly") {
            const byYear = new Map();
            ds.forEach(d => {
                const k = String(d.date).slice(0, 10);
                const e = byYear.get(k.slice(0, 4)) || { day: d, months: new Map() };
                e.day = d;
                e.months.set(k.slice(0, 7), d);
                byYear.set(k.slice(0, 4), e);
            });
            const out = [], labels = [];
            for (let y = Number(first.slice(0, 4)); y <= Number(last.slice(0, 4)); y++) {
                const e = byYear.get(String(y));
                out.push(e ? { date: String(e.day.date).slice(0, 10), crDay: e.day, crMonths: [...e.months.values()] } : { date: `${y}-12-31`, crEmpty: true });
                labels.push(String(y));
            }
            return { days: out, labels, levels: null, mode };
        }
        if (mode === "monthly") {
            const lastOfMonth = new Map();
            ds.forEach(d => lastOfMonth.set(String(d.date).slice(0, 7), d));
            const out = [], labels = [];
            let [y, m] = first.slice(0, 7).split("-").map(Number);
            const [ly, lm] = last.slice(0, 7).split("-").map(Number);
            while (y < ly || (y === ly && m <= lm)) {
                const mk = `${y}-${String(m).padStart(2, "0")}`;
                out.push(lastOfMonth.get(mk) || { date: `${mk}-28`, crEmpty: true });
                labels.push(`${MON[m - 1]} ${String(y).slice(2)}`);
                m++; if (m > 12) { m = 1; y++; }
            }
            return { days: out, labels, levels: null, mode };
        }
        const byDate = new Map(ds.map(d => [String(d.date).slice(0, 10), d]));
        const out = [], labels = [], meta = [];
        for (let t = dayMs(first); t <= dayMs(last); t += 86400000) {
            const k = keyOf(t);
            out.push(byDate.get(k) || { date: k, crEmpty: true, crOff: offDay(k) });
            const dd = Number(k.slice(8, 10)), mm = Number(k.slice(5, 7));
            labels.push(`${dd} ${MON[mm - 1]}`);
            meta.push({ dd, mm });
        }
        const levels = [
            x => [1, 8, 15, 22].includes(x.dd),
            x => x.dd === 1 || x.dd === 15,
            x => x.dd === 1,
            x => x.dd === 1 && x.mm % 2 === 1,
            x => x.dd === 1 && x.mm % 3 === 1,
            x => x.dd === 1 && x.mm === 1
        ].map(fn => {
            const s = new Set();
            meta.forEach((x, i) => { if (fn(x)) s.add(i); });
            if (!s.size || out.length <= 10) s.add(0);
            return s;
        });
        return { days: out, labels, levels, mode };
    }

    // The finest tick level whose labels fit the axis (~56px a label).
    function pickLevel(levels, width) {
        const max = Math.max(2, Math.floor((width || 300) / 56));
        return levels.find(s => s.size <= max) || levels[levels.length - 1];
    }

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
                    const label = `${tr("peak", null, "Peak")} ${f.shortX(ds.data[peakIdx], 1)}`;
                    ctx.fillStyle = text;
                    ctx.textAlign = "center";
                    const x = Math.min(Math.max(p.x, chartArea.left + 30), chartArea.right - 30);
                    ctx.fillText(label, x, p.y - 8);
                }
                if (lastIdx >= 0) {
                    const p = meta.data[lastIdx];
                    const label = f.shortX(ds.data[lastIdx], 1);
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
                        ctx.fillText(`${tr("plan", null, "Plan")} ${f.shortX(pd.data[i], 1)}`,
                            Math.min(pm.data[s].x + 4, chartArea.right - 90), pm.data[s].y + (above ? -5 : 5));
                    }
                }
                ctx.restore();
            }
        };
    }

    // ---------- Daily | Monthly | Yearly (chart step 2, 25/11/2026) ----------
    // Daily: the Daily History days. Monthly: the last 12 months; Yearly:
    // every year — each fetched on its own with month-end days only
    // (?monthEnd=1), whatever range Daily History shows. The pick holds
    // while the same history is open; a new history goes back to the
    // automatic one (Daily up to 3 months, Monthly beyond).
    const PERIODS = ["daily", "monthly", "yearly"];
    let periodPick = null, periodKey = "", lastDays = null, rerenderLast = null;
    const periodCache = new Map();
    const chartClosed = () => { const ov = document.getElementById("crChartOverlay"); return !!(ov && ov.hidden); };

    function periodQuery(hq, mode, days) {
        const p = new URLSearchParams(hq.params);
        const to = p.get("dateTo") || String(days[days.length - 1].date).slice(0, 10);
        let from = "2000-01-01";
        if (mode === "monthly") {
            let [y, m] = to.slice(0, 7).split("-").map(Number);
            m -= 11;
            while (m < 1) { m += 12; y--; }
            from = `${y}-${String(m).padStart(2, "0")}-01`;
        }
        p.set("dateFrom", from);
        p.set("dateTo", to);
        p.set("monthEnd", "1");
        p.delete("latest");
        return `${hq.path}?${p.toString()}`;
    }

    // { days, plan, failed }; days null while it loads (then re-renders).
    function periodData(hq, mode, days, opts) {
        const q = periodQuery(hq, mode, days);
        if (periodCache.has(q)) return periodCache.get(q);
        const entry = { days: null, plan: null, failed: false };
        periodCache.set(q, entry);
        const key = periodKey;
        fetch(`${API.BASE_URL}${q}`, { headers: { Authorization: `Bearer ${hq.token}` } })
            .then(r => r.json())
            .then(async data => {
                if (!data || !data.ok) throw new Error((data && data.message) || "history failed");
                const d = window.CRLastMonth && CRLastMonth.t24FromNbcHistory ? CRLastMonth.t24FromNbcHistory(data) : data;
                const ds = d.days || [];
                if (opts.loadPlan && ds.length) {
                    try { entry.plan = await opts.loadPlan(ds); } catch (e) { entry.plan = null; }
                }
                entry.days = ds;
            })
            .catch(e => { console.error("chart period failed:", e); entry.failed = true; })
            .finally(() => { if (key === periodKey && rerenderLast && !chartClosed()) rerenderLast(); });
        return entry;
    }

    // The latest day Daily shows (today's live T24 row included) stands
    // for its month when it is newer than that month's saved month-end.
    function withLatest(ends, days, getItemForDay) {
        const tail = days.reduce((a, d) => (!a || String(d.date) > String(a.date) ? d : a), null);
        if (!tail || !getItemForDay(tail)) return ends;
        const tk = String(tail.date).slice(0, 10);
        const lastKey = ends.length ? String(ends[ends.length - 1].date).slice(0, 10) : "";
        if (tk <= lastKey) return ends;
        return [...ends.filter(d => String(d.date).slice(0, 7) !== tk.slice(0, 7)), tail];
    }

    // Chart | Analysis: the popup fits the screen without scrolling, so
    // Key insights sit on their own view. Kept across re-renders.
    let view = "chart";

    function setView(panel, v) {
        view = v === "insights" ? "insights" : "chart";
        panel.dataset.crvView = view;
        panel.querySelectorAll(".crv-view-btn").forEach(b => b.classList.toggle("active", b.dataset.view === view));
    }

    // ---------- Copy: the chart popup as a picture for Telegram ----------
    // The header, latest figure, chart card and small cards (or the
    // Analysis view) as a PNG on the clipboard — the same CRShot the
    // table's Screenshot uses (share sheet / download where the browser
    // can't copy an image). Buttons and tabs are left out of the picture.
    let copyName = "Chart";
    function copyButton(headerRoot) {
        const header = headerRoot && headerRoot.closest(".cr-chart-header");
        if (!header || !window.CRShot) return;
        let btn = header.querySelector(".crv-copy-btn");
        if (!btn) {
            btn = document.createElement("button");
            btn.type = "button";
            btn.className = "cr-shot-btn crv-copy-btn";
            btn.innerHTML = '<span class="cr-ico cr-ico-camera" aria-hidden="true"></span><span class="crv-copy-text"></span>';
            header.insertBefore(btn, header.querySelector(".cr-chart-close"));
            btn.addEventListener("click", copyChart);
        }
        btn.querySelector(".crv-copy-text").textContent = tr("copy", null, "Copy");
    }

    async function copyChart(e) {
        const btn = e.currentTarget;
        const panel = btn.closest(".cr-chart-panel");
        const say = (msg, type) => (typeof window.notify === "function" ? window.notify(msg, type) : null);
        btn.disabled = true;
        try {
            const how = await CRShot.capture(panel, `${copyName}.png`, {
                keepWidth: true,
                // (the header icon is a CSS mask, which html2canvas can't draw)
                ignore: ["cr-chart-close", "crv-views", "cr-chart-metric-row", "crv-head-icon"],
                // The panel as tall as what's in the picture (the tabs left
                // out don't stretch the chart card); Analysis: the whole
                // view, not only the part scrolled to.
                onclone: doc => {
                    const p = doc.querySelector(".cr-chart-panel");
                    if (!p) return;
                    p.style.height = "auto";
                    p.style.maxHeight = "none";
                    p.style.overflow = "visible";
                    const card = panel.querySelector(".crv-chart-card"), copy = p.querySelector(".crv-chart-card");
                    if (card && copy && card.offsetHeight) { copy.style.flex = "none"; copy.style.height = `${card.offsetHeight}px`; }
                }
            });
            if (how !== "cancelled") say(tr(`copy_${how}`, null, { copied: "Chart image copied — paste it into Telegram", shared: "Chart image shared", saved: "Chart image saved" }[how] || ""), "success");
        } catch (err) {
            console.error("chart copy failed:", err);
            say(tr("copy_failed", null, "Could not copy the chart"), "error");
        } finally {
            btn.disabled = false;
        }
    }

    function render(opts) {
        const { section, days, metricLabel, scopeParts = [], colors, getItemForDay, getByPath, fmtNum,
            getPlan, hasPlanFor, planDataset, history } = opts;
        const groups = section.groups.filter(g => g.fields.some(f => f.label === metricLabel));
        if (!groups.length || !days.length) return null;
        const group = groups[0];
        const field = group.fields.find(x => x.label === metricLabel);
        const f = formatter(field, fmtNum);
        const worse = higherIsWorse(field.key);

        // ---- the period: Daily | Monthly | Yearly ----
        const hkey = history ? `${history.path}?${history.params}` : "";
        if (hkey !== periodKey) { periodKey = hkey; periodPick = null; }
        if (days !== lastDays) { lastDays = days; periodCache.clear(); }
        rerenderLast = opts.rerender || null;
        const keys = days.map(d => String(d.date).slice(0, 10)).filter(k => /^\d{4}-\d{2}-\d{2}$/.test(k)).sort();
        const span = keys.length ? (dayMs(keys[keys.length - 1]) - dayMs(keys[0])) / 86400000 : 0;
        const mode = periodPick || (span > 92 ? "monthly" : "daily");
        let src = days, series, loading = false;
        if (mode !== "daily" && history && window.API) {
            const e = periodData(history, mode, days, opts);
            if (e.days && e.days.length) { src = withLatest(e.days, days, getItemForDay); series = e.plan; } else if (!e.days && !e.failed) loading = true;
        }
        const cal = calendarOf(src, mode);
        const numOf = (item, key) => {
            const raw = item ? getByPath(item, key) : null;
            const v = raw == null || raw === "" ? null : Number(raw);
            return Number.isFinite(v) ? v : null;
        };
        // A year's month-to-date figure: the sum of its month-ends.
        const valueAt = (s, key) => {
            if (s.crEmpty) return null;
            if (s.crMonths && monthToDate(key)) {
                let sum = null;
                s.crMonths.forEach(d => { const v = numOf(getItemForDay(d), key); if (v !== null) sum = (sum || 0) + v; });
                return sum;
            }
            return numOf(getItemForDay(s.crDay || s), key);
        };
        const ptsOf = key => cal.days.map(s => ({ date: String(s.date).slice(0, 10), value: valueAt(s, key) }));
        const lab = date => {
            const [y, m] = parts(date);
            return mode === "yearly" ? String(y) : mode === "monthly" ? `${MONTHS[m - 1]} ${y}` : fmtDay(date);
        };
        // The monthly plan doesn't fit a year's sum of months.
        const gp = getPlan ? (fl, dk) => (mode === "yearly" && monthToDate(fl.key) ? null : getPlan(fl, dk, series)) : null;
        const pts = ptsOf(field.key);
        const have = pts.filter(p => p.value !== null);
        const last = have[have.length - 1] || null;
        const range = have.length ? fmtRange(have[0].date, last.date) : fmtRange(days[0].date, days[days.length - 1].date);
        copyName = ["Chart", group.label, field.label, mode, last ? last.date : ""].filter(Boolean).join("_").replace(/[^\w\-]+/g, "_");

        // ---- header ----
        const headerRoot = document.getElementById("crChartTitle");
        copyButton(headerRoot);
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
        const ch = changeOf(field, pts, mode);
        const vsText = !ch ? "" : mode === "monthly"
            ? tr("vsPrevMonth", { value: f.full(ch.first.value), month: lab(ch.first.date) }, "vs. {value} at the end of {month} (month on month)")
            : mode === "yearly"
                ? tr("vsPrevYear", { value: f.full(ch.first.value), year: lab(ch.first.date) }, "vs. {value} at the end of {year} (year on year)")
                : tr("vsFirst", { value: f.full(ch.first.value), date: fmtDay(ch.first.date) }, "vs. {value} on {date}");
        const plan = last && gp ? gp(field, last.date) : null;
        const pb = last ? planOf(field, f, last.value, plan, { big: true }) : null;
        hero.innerHTML = last ? `
            <div class="crv-hero-top">
                <span class="crv-kicker">${esc(tr("asOf", { metric: field.label, date: fmtDay(last.date) }, "{metric} as of {date}"))}</span>
                ${pb ? badge(pb.status, plan.ceiling) : ""}
            </div>
            <div class="crv-hero-main">
                <span class="crv-hero-value">${esc(f.full(last.value))}</span>
                ${ch ? `<span class="crv-hero-change" title="${esc(vsText)}">${chip(field, f, ch)}</span>` : ""}
            </div>
            ${ch ? `<div class="crv-muted crv-vs">${esc(vsText)}</div>` : ""}
            ${pb ? `<div class="crv-hero-plan">${pb.html}</div>`
                : hasPlanFor && hasPlanFor(field.key) && gp && !(mode === "yearly" && monthToDate(field.key)) ? `<div class="crv-muted crv-noplan">${esc(tr("noPlan", null, "No plan set"))}</div>` : ""}
        ` : `<div class="crv-muted">${esc(loading ? tr("loading", null, "Loading…") : tr("noData", null, "No figures for these days."))}</div>`;
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
        // A gap that holds a working day (or a month / year) stays a gap;
        // one of weekends / holidays only is drawn across. Chart.js asks
        // per pair of neighbouring slots (19→20, 20→21 …), so look out to
        // the saved days on either side of the pair.
        const workingGap = (i, j) => {
            let a = i, b = j;
            while (a > 0 && cal.days[a].crEmpty) a--;
            while (b < cal.days.length - 1 && cal.days[b].crEmpty) b++;
            for (let k = a + 1; k < b; k++) if (cal.days[k].crEmpty && !cal.days[k].crOff) return true;
            return false;
        };
        const hide = c => (workingGap(c.p0DataIndex, c.p1DataIndex) ? "transparent" : undefined);
        const bridge = { borderColor: hide, backgroundColor: hide };
        const badShade = "rgba(214,69,69,.10)";
        groups.forEach((g, idx) => {
            const fl = g.fields.find(x => x.label === metricLabel);
            const data = cal.days.map(s => valueAt(s, fl.key));
            const color = colors[idx % colors.length];
            const n = data.filter(v => v !== null).length;
            // Straight lines between the points, a dot on each, a break
            // where a working day / month / year wasn't saved.
            datasets.push({
                label: g.label, data, borderColor: color, backgroundColor: color,
                pointRadius: n > 62 ? 1.5 : 2.5, pointHoverRadius: 5, pointBackgroundColor: color,
                borderWidth: 2, tension: 0, spanGaps: true, segment: bridge
            });
            const pds = planDataset && !(mode === "yearly" && monthToDate(fl.key)) ? planDataset(fl, cal.days, series) : null;
            if (pds && idx === 0) {
                pds.label = tr("plan", null, "Plan");
                datasets.push(pds);
                planIndex = datasets.length - 1;
            }
        });
        // Shading only where the line is on the wrong side of the plan /
        // ceiling; none without a plan (a plain line reads cleaner).
        if (groups.length === 1) {
            datasets[0].fill = planIndex >= 0
                ? { target: planIndex, above: worse ? badShade : "transparent", below: worse ? "transparent" : badShade }
                : false;
        }
        const legend = [
            ...groups.map((g, i) => `<span class="crv-key"><i class="line" style="background:${colors[i % colors.length]}"></i>${esc(groups.length > 1 ? g.label : tr("actual", null, "Actual"))}</span>`),
            planIndex >= 0 ? `<span class="crv-key"><i class="dash"></i>${esc(tr("plan", null, "Plan"))}</span>` : "",
            planIndex >= 0 && groups.length === 1 ? `<span class="crv-key"><i class="band bad"></i>${esc(worse ? tr("aboveCeiling", null, "Above ceiling") : tr("belowPlanKey", null, "Below plan"))}</span>` : ""
        ].join("");
        const mtdKey = !monthToDate(field.key) ? ""
            : mode === "yearly" ? tr("mtdYear", null, "sum of the year's months")
                : mode === "monthly" ? tr("mtdMonth", null, "month total at month-end") : tr("mtd", null, "month to date");
        const names = { daily: tr("periodDaily", null, "Daily"), monthly: tr("periodMonthly", null, "Monthly"), yearly: tr("periodYearly", null, "Yearly") };
        const head = document.getElementById("crChartCardHead");
        head.innerHTML = `
            <div class="crv-head-row">
                <div class="crv-period" role="tablist">${PERIODS.map(p => `<button type="button" class="crv-period-btn${p === mode ? " active" : ""}" data-period="${p}" role="tab" aria-selected="${p === mode}">${esc(names[p])}</button>`).join("")}</div>
                <div class="crv-legend">${legend}${loading ? `<span class="crv-key crv-mtd">${esc(tr("loading", null, "Loading…"))}</span>` : ""}${mtdKey ? `<span class="crv-key crv-mtd">${esc(mtdKey)}</span>` : ""}</div>
            </div>`;
        if (!head.dataset.crvPeriod) {
            head.dataset.crvPeriod = "1";
            head.addEventListener("click", e => {
                const b = e.target.closest(".crv-period-btn");
                if (!b || !PERIODS.includes(b.dataset.period)) return;
                periodPick = b.dataset.period;
                if (rerenderLast) rerenderLast();
            });
        }

        // ---- other figures + insights ----
        const others = group.fields.filter(x => x.key !== field.key).map(x => {
            const xf = formatter(x, fmtNum);
            const xp = ptsOf(x.key);
            const xh = xp.filter(p => p.value !== null);
            if (!xh.length) return "";
            const xl = xh[xh.length - 1];
            const xch = changeOf(x, xp, mode);
            const xplan = gp ? gp(x, xl.date) : null;
            const xpb = planOf(x, xf, xl.value, xplan, { big: false });
            return `
                <article class="crv-mini">
                    <div class="crv-mini-top"><span class="crv-kicker">${esc(x.label)}</span>${xch ? chip(x, xf, xch) : ""}</div>
                    <div class="crv-mini-value">${esc(xf.full(xl.value))}</div>
                    ${xpb ? `<div class="crv-mini-plan">${xpb.html}</div>`
                        : xch ? `<div class="crv-muted">${esc(tr("was", { value: xf.full(xch.first.value) }, "Was {value}"))}${hasPlanFor && hasPlanFor(x.key) && gp ? " · " + esc(tr("noPlan", null, "No plan set")) : ""}</div>` : ""}
                </article>`;
        }).filter(Boolean);

        const insights = insightsOf(field, f, pts, gp, group.fields, ptsOf, mode, lab);
        const scopeText = scopeParts.filter(Boolean).join(" — ");
        const metric = `${group.label} · ${field.label}`;
        const about = [
            mode === "monthly" ? tr("aboutTextMonthly", { metric, scope: scopeText, range }, "{metric} for {scope}, month by month over {range}.")
                : mode === "yearly" ? tr("aboutTextYearly", { metric, scope: scopeText, range }, "{metric} for {scope}, year by year over {range}.")
                    : tr("aboutText", { metric, scope: scopeText, range }, "{metric} for {scope}, day by day over {range}."),
            mode === "monthly" ? tr("aboutMonthly", null, "Monthly shows the last 12 months, each at its month-end (the month's last saved day); a month with none is left as a gap.")
                : mode === "yearly" ? tr("aboutYearly", null, "Yearly shows every year at its year-end (the year's last saved day); this year runs to the latest day.")
                    : tr("aboutGaps", null, "The line runs across weekends and public holidays; a working day that wasn't saved is left as a gap."),
            planIndex >= 0 ? tr("aboutPlan", null, "The solid line is the actual figure; the dashed gold line is the monthly plan, and red shading marks where it is on the wrong side of the plan.") : "",
            monthToDate(field.key) ? (mode === "yearly"
                ? tr("aboutYearSum", null, "This figure is month to date, so each year adds up its months; no monthly plan is compared.")
                : tr("aboutMtd", null, "This figure is month to date, so it starts again on the 1st of each month.")) : "",
            tr("aboutTap", null, "Tap a point to pin its details; tap it again to let go.")
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
        // y labels: more decimals while the short ones would repeat.
        const yCache = new WeakMap();
        const yLabels = ticks => {
            if (yCache.has(ticks)) return yCache.get(ticks);
            let out = null;
            for (let x = 0; x <= 3 && !out; x++) {
                const l = ticks.map(t => f.shortX(t.value, x));
                if (new Set(l).size === l.length) out = l;
            }
            out = out || ticks.map(t => f.full(t.value));
            yCache.set(ticks, out);
            return out;
        };
        const ceiling = !!(plan && plan.ceiling);
        const slotDate = i => String(cal.days[i].date).slice(0, 10);
        // Tap pins the tooltip (pointer moves are ignored while pinned);
        // tapping the same point again lets it go.
        let pinned = -1;
        const pin = {
            id: "crvPin",
            beforeEvent(chart, args) {
                const t = args.event.type;
                if (pinned >= 0 && (t === "mousemove" || t === "mouseout")) return false;
            }
        };
        return new Chart(document.getElementById("crChartCanvas").getContext("2d"), {
            type: "line",
            data: { labels: cal.labels, datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                layout: { padding: { top: 18, right: 8 } },
                interaction: { mode: "index", intersect: false },
                onClick: (e, els) => {
                    const i = els.length ? els[0].index : -1;
                    pinned = i < 0 || i === pinned ? -1 : i;
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        filter: c => c.parsed.y != null,
                        callbacks: {
                            title: items => {
                                if (!items[0]) return "";
                                const d = slotDate(items[0].dataIndex);
                                return mode === "daily" ? fmtRange(d, d) : `${lab(d)} · ${fmtDay(d)}`;
                            },
                            label: c => (c.parsed.y == null ? null : `${c.dataset.label}: ${f.full(c.parsed.y)}`),
                            // The change since the point before.
                            afterLabel: c => {
                                if (c.datasetIndex === planIndex || c.parsed.y == null) return "";
                                const d = c.dataset.data;
                                let j = c.dataIndex - 1;
                                while (j >= 0 && d[j] == null) j--;
                                if (j < 0) return "";
                                if (mode === "daily" && monthToDate(field.key) && slotDate(j).slice(0, 7) !== slotDate(c.dataIndex).slice(0, 7)) return "";
                                const dd = c.parsed.y - d[j];
                                const flat = Math.abs(dd) < 1e-9;
                                return `${flat ? "—" : dd > 0 ? "▲ +" : "▼ −"}${flat ? "" : f.delta(dd)} ${tr("vsPoint", { date: lab(slotDate(j)) }, "vs {date}")}`;
                            },
                            footer: items => {
                                if (planIndex < 0 || !items[0]) return "";
                                const i = items[0].dataIndex;
                                const v = datasets[0].data[i], p = datasets[planIndex].data[i];
                                if (v == null || p == null || !p) return "";
                                return ceiling ? (v <= p ? tr("withinCeiling", null, "Within ceiling") : tr("aboveCeiling", null, "Above ceiling"))
                                    : tr("ofPlan", { pct: (v / p * 100).toFixed(1) + "%" }, "{pct} of plan");
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        suggestedMin: Math.max(0, min - pad),
                        suggestedMax: max + pad,
                        ticks: { color: textMuted, maxTicksLimit: 5, callback: (v, i, ticks) => yLabels(ticks)[i] },
                        grid: { color: grid },
                        border: { display: false }
                    },
                    // Daily: the finest of 1/8/15/22 … that fits the width;
                    // Monthly / Yearly: the months / years.
                    x: {
                        ticks: cal.levels
                            ? { color: textMuted, maxRotation: 0, autoSkip: false, callback: function (v, i) { return pickLevel(cal.levels, this.maxWidth || this.width).has(i) ? cal.labels[i] : null; } }
                            : { color: textMuted, maxRotation: 0, autoSkip: true, autoSkipPadding: 12 },
                        grid: { display: false }
                    }
                }
            },
            plugins: [markersPlugin(0, planIndex, f, colors), pin]
        });
    }

    window.CRChartView = { render, fmtDay, fmtRange, higherIsWorse };
})();
