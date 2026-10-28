// ========================================
// Credit Report — Comparison "Last Month", shared by the 4 Daily
// Monitoring reports (by Branch / Officer / Product / Location).
//
// Last month = the report's last saved Daily History day on or before
// the last day of the month before the report's own OS date (e.g. an
// OS date of 27/10/2026 → the snapshot of 30/09/2026, or the newest day
// before it when that one wasn't saved), fetched from the report's own
// history endpoint with ?latest=1. Each group on screen becomes three
// blocks, as in the Excel report: last month | now | (+/-); flows
// (Disburse, WO Collected …) are compared with the whole of last month,
// as saved.
//
// Snapshots are saved without the Loan Class / Product Type filters,
// so a report with such a filter picked shows "—" (see block below).
// ========================================

window.CRLastMonth = (() => {
    const t = (key, vars) => (window.CMI18n ? CMI18n.t(key, vars) : key);
    const cache = new Map(); // endpoint|cutoff -> Promise<{ date, day } | null>

    // Figures where a rise is bad news (the ± is red when it goes up).
    const RISK = /^(parT24|parT24Area|parT24ByClass|parT24AreaByClass|nbcOverdue|nbcOverdueArea|writeOff\.(balanceWO|wo)\.|writeOffOwn\.(balanceWO|wo)\.|writeOffArea\.(balanceWO|wo)\.)/;

    const pad = n => String(n).padStart(2, "0");

    // "2026-10-27" -> "2026-09-30"
    function cutoff(toDate) {
        const [y, m] = String(toDate || "").split("-").map(Number);
        if (!y || !m) return null;
        const d = new Date(Date.UTC(y, m - 1, 0));
        return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    }

    function daysBefore(dateKey, n) {
        const [y, m, d] = dateKey.split("-").map(Number);
        const x = new Date(Date.UTC(y, m - 1, d - n));
        return `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}`;
    }

    // The last saved day on or before last month's end: { date, day } or
    // null when none was saved in the 2 months before it.
    function load({ endpoint, token, toDate }) {
        const to = cutoff(toDate);
        if (!to) return Promise.resolve(null);
        const key = `${endpoint}|${to}`;
        if (!cache.has(key)) {
            const params = new URLSearchParams({ dateFrom: daysBefore(to, 62), dateTo: to, latest: "1" });
            cache.set(key, (async () => {
                const res = await fetch(`${API.BASE_URL}${endpoint}?${params}`, { headers: { Authorization: `Bearer ${token}` } });
                const data = await res.json();
                if (!res.ok || !data.ok) throw new Error(data.message || `HTTP ${res.status}`);
                const day = (data.days || [])[0];
                return day ? { date: day.date, cutoff: to, day } : { date: null, cutoff: to, day: null };
            })().catch(e => { cache.delete(key); throw e; }));
        }
        return cache.get(key);
    }

    // Every number in cur minus the same one in prev (same shape).
    function diffTree(cur, prev) {
        if (typeof cur === "number" && typeof prev === "number") return cur - prev;
        if (!cur || !prev || typeof cur !== "object" || typeof prev !== "object") return undefined;
        const out = {};
        for (const k of Object.keys(cur)) {
            const d = diffTree(cur[k], prev[k]);
            if (d !== undefined) out[k] = d;
        }
        return out;
    }

    function attach(item, prev) {
        if (!item) return;
        item.lastMonth = prev || null;
        item.lastMonthDiff = prev ? diffTree(item, prev) : null;
    }

    // "2026-09-30" -> "30-Sep-26"
    const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    function shortDate(dateKey) {
        const [y, m, d] = String(dateKey || "").split("-");
        return y && m && d ? `${d}-${MON[Number(m) - 1]}-${y.slice(2)}` : "";
    }

    // Each group as three blocks side by side, like the Excel report:
    // last month (its date) | now (the OS date) | (+/-), each with the
    // group's own columns. dates: { last, now } (date keys; last may be
    // unknown while loading).
    function expand(section, dates = {}) {
        // One group: just the date, as in the Excel report; several: "group · date".
        const head = (label, tail) => (section.groups.length > 1 ? `${label} · ${tail}` : tail);
        const lastLabel = dates.last ? shortDate(dates.last) : t("creditreport.lastMonth.col");
        return {
            ...section,
            groups: section.groups.flatMap(g => [
                { ...g, lm: "value", label: head(g.label, lastLabel),
                    fields: g.fields.map(f => ({ ...f, key: `lastMonth.${f.key}`, lm: "value" })) },
                { ...g, lm: "cur", label: head(g.label, dates.now ? shortDate(dates.now) : t("creditreport.lastMonth.now")),
                    fields: g.fields.map(f => ({ ...f, lm: "cur" })) },
                { ...g, lm: "diff", label: head(g.label, "(+/-)"),
                    fields: g.fields.map(f => ({ ...f, key: `lastMonthDiff.${f.key}`, lm: "diff", risk: RISK.test(f.key) })) }
            ])
        };
    }

    const get = (obj, path) => path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
    const fmtNum = n => Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 });
    const cls = f => (f.pct ? "cr-col-pct" : f.money ? "cr-col-money" : "cr-col-num") + ` cr-lm-${f.lm}`;
    const PAR_ALERT = 0.04; // same red as the reports' own PAR columns

    function cell(item, field) {
        let v = get(item, field.key);
        if (field.lm === "cur" && (typeof v !== "number" || !Number.isFinite(v))) {
            // The report's own figure: "—" only where it may be missing.
            if (field.optional) return `<td class="${cls(field)} cr-lm-none">—</td>`;
            v = Number(v) || 0;
        }
        if (typeof v !== "number" || !Number.isFinite(v)) return `<td class="${cls(field)} cr-lm-none">—</td>`;
        if (field.lm !== "diff") {
            if (field.pct) return `<td class="${cls(field)}${v >= PAR_ALERT ? " cr-par-high" : ""}">${(v * 100).toFixed(2)}%</td>`;
            return `<td class="${cls(field)}">${fmtNum(v)}</td>`;
        }
        // (+/-): points for a %, else the amount; 0 stays plain.
        const shown = field.pct ? Math.round(v * 10000) / 100 : Math.round(v);
        if (!shown) return `<td class="${cls(field)}">0</td>`;
        const good = field.risk ? shown < 0 : shown > 0;
        const text = field.pct ? shown.toFixed(2) + "%" : fmtNum(shown);
        return `<td class="${cls(field)} ${good ? "cr-lm-good" : "cr-lm-bad"}">${shown > 0 ? "+" : ""}${text}</td>`;
    }

    // The note under the table: which day "Last Month" is, and why some
    // figures show "—".
    function renderNote(el, { info, error, blocked, totalBlocked, filters, fmtDate }) {
        if (!el) return;
        el.style.display = "";
        const lines = [];
        if (error) lines.push(t("creditreport.lastMonth.loadFailed"));
        else if (!info) lines.push(t("creditreport.plan.loading"));
        else if (!info.date) lines.push(t("creditreport.lastMonth.noSnapshot", { date: fmtDate(info.cutoff) }));
        else lines.push(t("creditreport.lastMonth.noteDate", { date: fmtDate(info.date) }), t("creditreport.lastMonth.noteFlows"));
        if (blocked) lines.push(t("creditreport.lastMonth.noteFilters", { filters }));
        else if (totalBlocked) lines.push(t("creditreport.lastMonth.noteTotal"));
        const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
        el.innerHTML = lines.map(l => `<span>${esc(l)}</span>`).join("");
    }

    function hideNote(el) {
        if (el) el.style.display = "none";
    }

    // One report's Last Month state. opts:
    //   endpoint  its Daily History URL ("/api/creditreport/…/history")
    //   token     the JWT
    //   active()  true while Comparison = Last Month (Current mode)
    //   data()    the loaded report: { toDate, items, total }
    //   keyOf(it) a row's match key, the same for live and saved rows
    //   blockedBy()  names of picked filters the snapshot lacks ([] = none)
    //   totalBlocked() true when the rows on screen are a subset (the
    //             saved total then isn't theirs)
    //   render()  re-draws the table; noteEl the note's element id
    function controller(opts) {
        let info = null, error = false;
        const byKey = () => new Map(((info && info.day && info.day.items) || []).map(it => [opts.keyOf(it), it]));

        // The saved row for a live row (null = show "—"); "total" for the Total row.
        function itemFor(key) {
            if (!info || !info.day || opts.blockedBy().length) return null;
            if (key === "total") return opts.totalBlocked && opts.totalBlocked() ? null : info.day.total || null;
            return byKey().get(key) || null;
        }

        function note() {
            const el = document.getElementById(opts.noteEl);
            if (!opts.active()) return hideNote(el);
            const blocked = opts.blockedBy();
            renderNote(el, {
                info, error, blocked: blocked.length > 0, filters: blocked.join(" / "),
                totalBlocked: !!(opts.totalBlocked && opts.totalBlocked()), fmtDate: opts.fmtDate
            });
        }

        async function ensure() {
            const data = opts.data();
            if (!data || !opts.active()) return note();
            note();
            try {
                info = await load({ endpoint: opts.endpoint, token: opts.token, toDate: data.toDate });
                error = false;
                const map = byKey();
                const blocked = opts.blockedBy().length > 0;
                (data.items || []).forEach(it => attach(it, blocked || !info.day ? null : map.get(opts.keyOf(it)) || null));
                attach(data.total, itemFor("total"));
                opts.render();
            } catch (e) {
                console.error("last month failed:", e);
                error = true;
                if (opts.onError) opts.onError(e);
            }
            note();
        }

        // The report's section as last month | now | (+/-) blocks.
        function expandSection(section) {
            const data = opts.data();
            return expand(section, { last: info && info.date, now: data && data.toDate });
        }

        return { ensure, note, itemFor, expand: expandSection };
    }

    return { cutoff, shortDate, load, attach, diffTree, expand, cell, renderNote, hideNote, controller };
})();
