// ========================================
// Chart kit (chart step 3, 26/11/2026): the line-chart rules every
// Credit Report time chart follows, in one place —
//   - a real calendar (calendarOf): one slot per day / month / year, an
//     unsaved day left empty; weekends / Khmer holidays marked crOff
//   - lines drawn across weekends / holidays, broken where a WORKING
//     day (or a month) wasn't saved (gapSegment)
//   - x ticks that fit the width (dailyTicks / pickLevel: 1/8/15/22 →
//     1/15 → the 1st → every 2nd / 3rd month → January)
//   - y labels that don't repeat (uniqueTicks: more decimals while the
//     short ones would)
//   - a tooltip line with the change since the point before
//     (changeLabel), and a tooltip that a tap pins (pin)
// Used by the Daily History chart (cr-chart-view.js), Meeting Report,
// Portfolio Overview and PAR Forecast.
// ========================================
window.CRChartKit = (() => {
    const tr = (key, vars, fallback) => {
        const s = window.CMI18n ? CMI18n.t(`creditreport.chartv.${key}`, vars) : null;
        if (s && s !== `creditreport.chartv.${key}`) return s;
        let out = fallback;
        for (const [k, v] of Object.entries(vars || {})) out = out.replace(`{${k}}`, v);
        return out;
    };
    const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const dayMs = d => Date.parse(`${d}T00:00:00Z`);
    const keyOf = ms => new Date(ms).toISOString().slice(0, 10);

    // Non-working days (owner, 25/11/2026): no data is made on a weekend
    // or a Khmer public holiday. The holidays come once from the server
    // (the list the Productivity heatmaps use); until then, weekends only.
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

    // days: objects with a "YYYY-MM-DD…" date. Returns { days, labels,
    // levels, mode }; days are the saved day objects, or { date, crEmpty }
    // for an empty slot.
    //   "daily": one slot per calendar day; levels = the x tick sets
    //   "monthly": one slot per month — its last saved day
    //   "yearly": one slot per year — its last saved day (crDay), with the
    //     year's month-ends in crMonths
    function calendarOf(days, mode = "daily") {
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

    // x ticks of a daily calendar (cal from calendarOf): the finest level
    // that fits; monthly / yearly: Chart.js's own skipping.
    function dailyTicks(cal, extra = {}) {
        if (!cal.levels) return { maxRotation: 0, autoSkip: true, autoSkipPadding: 12, ...extra };
        return {
            maxRotation: 0, autoSkip: false, ...extra,
            callback: function (v, i) { return pickLevel(cal.levels, this.maxWidth || this.width).has(i) ? cal.labels[i] : null; }
        };
    }

    // Segment colours of a calendar line: transparent across a gap that
    // holds a working day (or a month / year); drawn across weekends /
    // holidays. Chart.js asks per pair of neighbouring slots, so look out
    // to the saved days on either side of the pair.
    function gapSegment(slots) {
        const workingGap = (i, j) => {
            let a = i, b = j;
            while (a > 0 && slots[a].crEmpty) a--;
            while (b < slots.length - 1 && slots[b].crEmpty) b++;
            for (let k = a + 1; k < b; k++) if (slots[k].crEmpty && !slots[k].crOff) return true;
            return false;
        };
        const hide = c => (workingGap(c.p0DataIndex, c.p1DataIndex) ? "transparent" : undefined);
        return { borderColor: hide, backgroundColor: hide };
    }

    // Compact money / numbers; extra = more decimals.
    function compact(n, extra = 0) {
        const abs = Math.abs(n);
        if (abs >= 1e9) return (n / 1e9).toFixed(2 + extra) + "B";
        if (abs >= 1e6) return (n / 1e6).toFixed(2 + extra) + "M";
        if (abs >= 1e3) return (n / 1e3).toFixed(1 + extra) + "K";
        return n.toLocaleString(undefined, { maximumFractionDigits: 2 + extra });
    }

    // y tick callback: fmt(value, extra) with more decimals (up to 3)
    // while two labels would read the same; then full(value).
    function uniqueTicks(fmt, full) {
        const cache = new WeakMap();
        return (v, i, ticks) => {
            if (!ticks || !ticks.length) return fmt(v, 0);
            if (!cache.has(ticks)) {
                let out = null;
                for (let x = 0; x <= 3 && !out; x++) {
                    const l = ticks.map(t => fmt(t.value, x));
                    if (new Set(l).size === l.length) out = l;
                }
                cache.set(ticks, out || ticks.map(t => (full || fmt)(t.value, 4)));
            }
            return cache.get(ticks)[i];
        };
    }

    const yOf = d => (d == null ? null : typeof d === "object" ? (d.y == null ? null : d.y) : d);

    // Tooltip afterLabel: "▲ +$12K vs 14 Nov" — the change since the
    // point before in the same line. delta(d) formats |d|; labelOf(j, c)
    // names that point (default: the x label). Bars and a first point: none.
    function changeLabel(delta, labelOf) {
        return c => {
            if ((c.dataset.type || c.chart.config.type) === "bar") return "";
            const d = c.dataset.data;
            const y = yOf(d[c.dataIndex]);
            if (y == null) return "";
            let j = c.dataIndex - 1;
            while (j >= 0 && yOf(d[j]) == null) j--;
            if (j < 0) return "";
            const dd = y - yOf(d[j]);
            const flat = Math.abs(dd) < 1e-9;
            const name = labelOf ? labelOf(j, c) : c.chart.data.labels[j];
            return `${flat ? "—" : dd > 0 ? "▲ +" : "▼ −"}${flat ? "" : delta(Math.abs(dd))} ${tr("vsPoint", { date: name }, "vs {date}")}`;
        };
    }

    // Tap pins the tooltip (pointer moves are ignored while pinned);
    // tapping the same point again lets it go. Spread `options` into the
    // chart options and add `plugin` to its plugins.
    function pin() {
        let pinned = -1;
        return {
            plugin: {
                id: "crvPin",
                beforeEvent(chart, args) {
                    const t = args.event.type;
                    if (pinned >= 0 && (t === "mousemove" || t === "mouseout")) return false;
                }
            },
            onClick: (e, els) => {
                const i = els.length ? els[0].index : -1;
                pinned = i < 0 || i === pinned ? -1 : i;
            }
        };
    }

    return { MON, dayMs, keyOf, offDay, calendarOf, pickLevel, dailyTicks, gapSegment, compact, uniqueTicks, changeLabel, pin, tr };
})();
