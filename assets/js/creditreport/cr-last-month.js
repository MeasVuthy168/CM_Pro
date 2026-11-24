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
//
// Balance Loan at Risk (T24) is compared with last month's Balance Loan
// at Risk (NBC Overdue): the NBC figures are the month-end ones (EOD /
// EOM), the saved T24 ones only what T24 showed when the day was saved.
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
    // null when none was saved in the 2 months before it. query: extra
    // parameters for the history endpoint (e.g. { branch }).
    // at: a date key to use instead of last month's end (Saved date
    // compare / Saved & Compare) — the last saved day on or before it.
    function load({ endpoint, token, toDate, query, at }) {
        const to = at || cutoff(toDate);
        if (!to) return Promise.resolve(null);
        const params = new URLSearchParams({ ...(query || {}), dateFrom: daysBefore(to, 62), dateTo: to, latest: "1" });
        const key = `${endpoint}|${params}`;
        if (!cache.has(key)) {
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
    // dates.compact: design គ — amounts as K / M, (+/-) with ▲ / ▼.
    // Each block keeps its own group's label on `sectionLabel` (crBuildThead
    // groups consecutive blocks by it into its own header row, same as the
    // Excel export's section/lane/field header) — `label` is just the lane
    // name (the date, or "(+/-)").
    function expand(section, dates = {}) {
        const c = dates.compact ? { compact: true } : {};
        const lastLabel = dates.last ? shortDate(dates.last) : t("creditreport.lastMonth.col");
        return {
            ...section,
            groups: section.groups.flatMap(g => [
                { ...g, lm: "value", sectionLabel: g.label, label: lastLabel,
                    fields: g.fields.map(f => ({ ...f, ...c, key: `lastMonth.${f.key}`, lm: "value" })) },
                { ...g, lm: "cur", sectionLabel: g.label, label: dates.now ? shortDate(dates.now) : t("creditreport.lastMonth.now"),
                    fields: g.fields.map(f => ({ ...f, ...c, lm: "cur" })) },
                { ...g, lm: "diff", sectionLabel: g.label, label: "(+/-)",
                    fields: g.fields.map(f => ({ ...f, ...c, key: `lastMonthDiff.${f.key}`, lm: "diff", risk: RISK.test(f.key) })) }
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
        if (field.compact) return compactCell(field, v);
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

    // Design គ: an amount as K / M (the exact figure in data-x, for the
    // export), (+/-) as ▲ / ▼ in green or red; a % in points.
    function compactCell(field, v) {
        const money = field.money && window.CRTable;
        const text = n => (field.pct ? (n * 100).toFixed(2) + (field.lm === "diff" ? "" : "%") : money ? CRTable.compact(n) : fmtNum(n));
        const x = field.pct ? `${(v * 100).toFixed(2)}%` : money ? CRTable.exact(v) : null;
        const dx = x !== null && money ? ` data-x="${x}"` : "";
        if (field.lm !== "diff") return `<td class="${cls(field)}"${dx}>${text(v)}</td>`;
        const shown = field.pct ? Math.round(v * 10000) / 100 : Math.round(v);
        if (!shown) return `<td class="${cls(field)}"${dx}>0</td>`;
        const good = field.risk ? shown < 0 : shown > 0;
        const ex = ` data-x="${x !== null ? x : fmtNum(v)}"`;
        return `<td class="${cls(field)} ${good ? "cr-lm-good" : "cr-lm-bad"}"${ex}><span class="cr-arrow">${shown > 0 ? "▲" : "▼"}</span>${text(Math.abs(v))}</td>`;
    }

    // The note under the table: which day "Last Month" is, and why some
    // figures show "—".
    function renderNote(el, { showsT24, info, error, blocked, totalBlocked, filters, productSections, t24Class, fmtDate, savedMode }) {
        if (!el) return;
        el.style.display = "";
        const lines = [];
        const k = savedMode ? "creditreport.saved" : "creditreport.lastMonth";
        if (error) lines.push(t("creditreport.lastMonth.loadFailed"));
        else if (!info) lines.push(t("creditreport.plan.loading"));
        else if (!info.date) lines.push(t("creditreport.lastMonth.noSnapshot", { date: fmtDate(info.cutoff) }));
        else lines.push(t(`${k}.noteDate`, { date: fmtDate(info.date) }), t(`${k}.noteFlows`));
        if (showsT24) lines.push(t(`${k}.noteT24`));
        if (blocked) lines.push(t("creditreport.lastMonth.noteFilters", { filters }));
        if (productSections) lines.push(t("creditreport.lastMonth.noteProduct", { sections: productSections }));
        if (t24Class) lines.push(t("creditreport.lastMonth.noteClass"));
        else if (totalBlocked) lines.push(t("creditreport.lastMonth.noteTotal"));
        const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
        el.innerHTML = lines.map(l => `<span>${esc(l)}</span>`).join("");
    }

    function hideNote(el) {
        if (el) el.style.display = "none";
    }

    // ---- Section filters ----
    // The T24 Loan Class / Product Type and NBC Product Type filters only
    // change their own section (T24, NBC Overdue) — the other sections
    // still compare as they are. Snapshots keep T24 per Loan Class
    // (parT24ByClass), so a Loan Class pick is compared with last month's
    // same classes added up; Product Type isn't saved, so those columns
    // show "—".
    const T24_BASE = {
        Normal: ["normal"], "Special Mention": ["specialMention"], "Sub Standard": ["subStandard"],
        Doubtful: ["doubtful"], Loss: ["loss"],
        Normal_to_SpecialMention: ["normal", "specialMention"],
        SubStandard_to_Loss: ["subStandard", "doubtful", "loss"]
    };
    const T24_KEYS = ["parT24", "parT24Area", "parT24ByClass", "parT24AreaByClass"];
    const NBC_KEYS = ["nbcOverdue", "nbcOverdueArea"];

    // The picked classes' buckets added up (any of them, like the server's
    // filter); null when a bucket is missing from the snapshot.
    function sumClasses(byClass, picks) {
        if (!byClass) return null;
        const keys = [...new Set(picks.flatMap(p => T24_BASE[p] || []))];
        if (!keys.length || keys.some(k => !byClass[k])) return null;
        const out = { loan: 0, value: 0, parPct: 0 };
        for (const k of keys) {
            out.loan += Number(byClass[k].loan) || 0;
            out.value += Number(byClass[k].value) || 0;
            out.parPct += Number(byClass[k].parPct) || 0;
        }
        return out;
    }

    // Last month's T24 = its NBC Overdue: the total (an officer's own
    // total on the Officer report) and each class, Normal = Minor
    // Default, as { loan, value, parPct } like T24. null without NBC.
    function t24FromNbc(nbc, totalKey) {
        if (!nbc || !nbc[totalKey]) return null;
        const cv = (...cs) => cs.reduce((o, c) => ({
            loan: o.loan + (Number(c && c.count) || 0),
            value: o.value + (Number(c && c.value) || 0),
            parPct: o.parPct + (Number(c && c.parPct) || 0)
        }), { loan: 0, value: 0, parPct: 0 });
        return {
            flat: cv(nbc[totalKey]),
            byClass: {
                normal: cv(nbc.minor), specialMention: cv(nbc.specialMention), subStandard: cv(nbc.subStandard),
                doubtful: cv(nbc.doubtful), loss: cv(nbc.loss),
                normalToSpecialMention: cv(nbc.minor, nbc.specialMention),
                subStandardToLoss: cv(nbc.subStandard, nbc.doubtful, nbc.loss)
            }
        };
    }

    function t24LastMonth(out) {
        // The officer report's Area by team (CO / FSRO / Digital).
        // Snapshots saved from 09/11/2026 carry no T24 at all (backend
        // lib/snapshot-t24.js), so map from NBC whenever NBC is there.
        if (out.parT24AreaByTeam || out.nbcOverdueAreaByTeam) {
            const nbc = out.nbcOverdueAreaByTeam;
            out.parT24AreaByTeam = nbc ? Object.fromEntries(Object.keys(out.parT24AreaByTeam || nbc).map(k => {
                const t = t24FromNbc({ total: nbc[k] }, "total");
                return [k, t ? t.flat : null];
            })) : null;
        }
        for (const [flat, byClass, nbcKey] of [["parT24", "parT24ByClass", "nbcOverdue"], ["parT24Area", "parT24AreaByClass", "nbcOverdueArea"]]) {
            if (!(flat in out) && !(nbcKey in out)) continue;
            const nbc = out[nbcKey];
            const t = t24FromNbc(nbc, nbcKey === "nbcOverdue" && nbc && nbc.totalOwn ? "totalOwn" : "total");
            if (t) {
                out[flat] = { ...out[flat], ...t.flat };
                out[byClass] = t.byClass;
            } else {
                delete out[flat];
                delete out[byClass];
            }
        }
    }

    // A saved row narrowed like the live one: f = { t24Class, t24Product,
    // nbcProduct } (picked values). Works on a copy, breakdown rows too.
    function scopeSaved(prev, f) {
        if (!prev || typeof prev !== "object") return prev;
        // f.teams (By Branch's Team filter): the row's picked teams from
        // its saved CO / FSRO / Digital breakdown, added up.
        const teams = (f.teams || []).filter(x => prev.breakdown && prev.breakdown[x]);
        if (teams.length && teams.length < 3) {
            const names = Object.fromEntries(Object.entries(prev).filter(([, v]) => typeof v === "string"));
            return scopeSaved({ ...sumRows(teams.map(x => prev.breakdown[x])), ...names }, { ...f, teams: [] });
        }
        const out = { ...prev };
        t24LastMonth(out);
        if (f.t24Product.length) {
            T24_KEYS.forEach(k => delete out[k]);
        } else if (f.t24Class.length) {
            for (const [flat, byClass] of [["parT24", "parT24ByClass"], ["parT24Area", "parT24AreaByClass"]]) {
                if (!(flat in out)) continue;
                const sum = sumClasses(out[byClass], f.t24Class);
                if (sum) out[flat] = { ...out[flat], ...sum };
                else delete out[flat];
            }
        }
        if (f.nbcProduct.length) NBC_KEYS.forEach(k => delete out[k]);
        if (out.breakdown) {
            out.breakdown = Object.fromEntries(Object.entries(out.breakdown).map(([k, v]) => [k, scopeSaved(v, f)]));
        }
        return out;
    }

    // One report's Last Month state. opts:
    //   endpoint  its Daily History URL ("/api/creditreport/…/history")
    //   token     the JWT
    //   active()  true while Comparison = Last Month (Current mode)
    //   data()    the loaded report: { toDate, items, total }
    //   keyOf(it) a row's match key, the same for live and saved rows
    //   sectionFilters()  { t24Class, t24Product, nbcProduct } picked
    //   blockedBy()  names of picked filters that change every figure and
    //             the snapshot lacks ([] = none) — all Last Month is "—"
    //   totalBlocked() true when the rows on screen are a subset (the
    //             saved total then isn't theirs)
    //   render()  re-draws the table; noteEl the note's element id
    //   reload()  fetches the live report again (Saved & Compare on / off)
    function controller(opts) {
        let info = null, error = false;
        let baseInfo = null, baseMsg = "", baseSummed = false;
        const filters = () => {
            const f = (opts.sectionFilters && opts.sectionFilters()) || {};
            return { t24Class: f.t24Class || [], t24Product: f.t24Product || [], nbcProduct: f.nbcProduct || [] };
        };
        const byKey = () => new Map(((info && info.day && info.day.items) || []).map(it => [opts.keyOf(it), it]));

        // The saved row for a live row, narrowed like it (null = show "—");
        // "total" for the Total row.
        function itemFor(key) {
            if (!info || !info.day || opts.blockedBy().length) return null;
            const raw = key === "total"
                ? (opts.totalBlocked && opts.totalBlocked() ? null : info.day.total)
                : byKey().get(key);
            return raw ? scopeSaved(raw, filters()) : null;
        }

        function note() {
            syncUi();
            const el = document.getElementById(opts.noteEl);
            if (!opts.active()) return hideNote(el);
            const blocked = opts.blockedBy();
            const f = filters();
            const sections = [];
            if (f.t24Product.length) sections.push(t("creditreport.detail.sectionT24"));
            if (f.nbcProduct.length) sections.push(t("creditreport.detail.sectionNbcOverdue"));
            // T24 on screen: All Sections, or a T24 section picked.
            const keys = typeof crSectionKeys === "function" ? crSectionKeys() : [];
            renderNote(el, {
                showsT24: !keys.length || keys.some(k => /^parT24/.test(k)),
                info, error, blocked: blocked.length > 0, filters: blocked.join(" / "),
                productSections: blocked.length ? "" : sections.join(" / "),
                t24Class: !blocked.length && !f.t24Product.length && f.t24Class.length > 0,
                totalBlocked: !!(opts.totalBlocked && opts.totalBlocked()), fmtDate: opts.fmtDate,
                savedMode: savedCompare()
            });
        }

        async function ensure() {
            const data = opts.data();
            syncUi();
            if (!data || !opts.active()) return note();
            if (savedCompare() && !saved.cmpAt) { saved.cmpAt = daysBefore(String(data.toDate).slice(0, 10), 1); persist(); syncUi(); }
            info = null;
            note();
            try {
                info = await load({ endpoint: opts.endpoint, token: opts.token, toDate: data.toDate, at: compareAt() || undefined });
                error = false;
                (data.items || []).forEach(it => attach(it, itemFor(opts.keyOf(it))));
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
            return expand(section, { last: info && info.date, now: data && data.toDate, compact: !!opts.compact });
        }

        // Last month's saved date as the table shows it ("30-Sep-26"), or "".
        const lastLabel = () => (opts.active() && info && info.date ? shortDate(info.date) : "");

        // ---- Saved & Compare: the table shows a saved day instead of
        // the live report. Called by the page right after the live fetch
        // (the live rows keep the page's own filters and scope); each row
        // takes that day's saved figures. false = nothing to show
        // (baseMessage() says why).
        async function applyBase() {
            const data = opts.data();
            baseInfo = null; baseMsg = ""; baseSummed = false; shownBase = "";
            if (!baseOn() || !data) { syncUi(); return true; }
            const liveTo = String(data.toDate || "").slice(0, 10);
            if (!saved.baseAt) { saved.baseAt = daysBefore(liveTo, 1); persist(); }
            const blocked = opts.blockedBy();
            if (blocked.length) { baseMsg = t("creditreport.saved.blocked", { filters: blocked.join(" / ") }); syncUi(); return false; }
            const got = await load({ endpoint: opts.endpoint, token: opts.token, at: saved.baseAt });
            if (!got || !got.day) { baseMsg = t("creditreport.lastMonth.noSnapshot", { date: opts.fmtDate(saved.baseAt) }); syncUi(); return false; }
            const f = filters();
            const byKey = new Map((got.day.items || []).map(it => [opts.keyOf(it), it]));
            const seen = new Set(), rows = [];
            for (const it of data.items || []) {
                const k = opts.keyOf(it), prev = byKey.get(k);
                if (!prev) continue;
                swapFigures(it, scopeSaved(prev, f));
                seen.add(k); rows.push(it);
            }
            const subset = !!(opts.totalBlocked && opts.totalBlocked());
            // Rows saved that day but gone from the live list (an officer
            // who left …) — only when the list isn't narrowed by a filter.
            if (!subset) for (const [k, prev] of byKey) if (!seen.has(k)) rows.push(scopeSaved(prev, f));
            data.items = rows;
            if (data.total) {
                if (subset) { swapFigures(data.total, sumRows(rows)); baseSummed = true; }
                else if (got.day.total) swapFigures(data.total, scopeSaved(got.day.total, f));
            }
            const [y, m] = got.date.split("-");
            data.live = data.live || { toDate: data.toDate, fromDate: data.fromDate, woFromDate: data.woFromDate, woToDate: data.woToDate };
            data.toDate = got.date; data.fromDate = `${y}-${m}-01`;
            data.woFromDate = `${y}-01-01`; data.woToDate = `${y}-12-31`;
            data.savedBase = got.date;
            baseInfo = got; shownBase = got.date;
            syncUi();
            return true;
        }
        const baseMessage = () => baseMsg;

        // ---- the controls (added once, to the page's own filter card) ----
        function syncUi() {
            const ui = mountUi();
            if (!ui) return;
            const { cmpRow, cmpInput, baseRow, baseInput, baseText, compareRow, latestBtn } = ui;
            // Latest & Compare only (the Comparison row hides in Daily History).
            const inCurrent = compareRow.style.display !== "none";
            cmpRow.style.display = inCurrent && savedCompare() ? "" : "none";
            if (cmpInput.value !== (saved.cmpAt || "")) cmpInput.value = saved.cmpAt || "";
            // Choose Data: the latest data's date by default, or the saved day picked.
            baseRow.style.display = inCurrent ? "" : "none";
            const want = baseOn() ? saved.baseAt || "" : liveDate();
            if (baseInput.value !== want) baseInput.value = want;
            latestBtn.hidden = !baseOn();
            // its box takes no room while hidden (rows evenly spaced)
            if (latestBtn.parentElement) latestBtn.parentElement.style.display = baseOn() ? "" : "none";
            const lines = [];
            if (baseOn()) {
                if (baseInfo) {
                    lines.push(t("creditreport.saved.baseShowing", { date: opts.fmtDate(baseInfo.date) }));
                    if (baseInfo.date !== saved.baseAt) lines.push(t("creditreport.saved.baseNearest", { picked: opts.fmtDate(saved.baseAt) }));
                    if (baseSummed) lines.push(t("creditreport.saved.totalSum"));
                } else if (baseMsg) lines.push(baseMsg);
            }
            baseText.textContent = lines.join(" ");
        }
        // The latest data's day (the live report's OS date).
        function liveDate() {
            const d = opts.data();
            return d ? String((d.live && d.live.toDate) || d.toDate || "").slice(0, 10) : "";
        }

        function chips(kind) {
            const list = kind === "base"
                ? [["prev", "creditreport.saved.chipPrev"], ["monthEnd", "creditreport.saved.chipMonthEnd"], ["yearEnd", "creditreport.saved.chipYearEnd"]]
                : [["prev", "creditreport.saved.chipPrev"], ["week", "creditreport.saved.chipWeek"], ["monthEnd", "creditreport.saved.chipMonthEnd"]];
            return list.map(([k, key]) => `<button type="button" class="cr-saved-chip" data-chip="${k}">${t(key)}</button>`).join("");
        }
        function chipDate(chip, from) {
            if (!from) return "";
            if (chip === "prev") return daysBefore(from, 1);
            if (chip === "week") return daysBefore(from, 7);
            if (chip === "monthEnd") return cutoff(from);
            if (chip === "yearEnd") return `${Number(from.slice(0, 4)) - 1}-12-31`;
            return "";
        }
        let ui = null;
        // Choose Data (owner, 24/11/2026): Latest & Compare shows the latest
        // data by default, or a saved day picked here — the Saved & Compare
        // tab is gone. Every Comparison works on the day chosen (Plan vs
        // Actual = that day against its month's plan, ?asOf=).
        function mountUi() {
            if (ui) return ui;
            const sel = document.getElementById("crCompare");
            const compareRow = document.getElementById("crCompareRow");
            const modeRow = document.querySelector(".cr-mode-row");
            if (!sel || !compareRow || !modeRow) return null;
            const opt = document.createElement("option");
            opt.value = SAVED; opt.textContent = t("creditreport.saved.compareOption");
            sel.appendChild(opt);
            if (pendingCompare === SAVED) sel.value = SAVED;
            const today = phnomPenhToday();
            // The page's own row / label / field classes (By Branch uses
            // cr-section-*, the other reports cr-select-*), so the rows look
            // like the page's Comparison row.
            const rowCls = compareRow.className || "cr-section-row";
            const labelCls = (compareRow.querySelector("label") || {}).className || "cr-section-label";
            const fieldCls = sel.className || "cr-section-select";
            const row = (id, label, kind) => {
                const r = document.createElement("div");
                r.className = `${rowCls} cr-saved-row`; r.id = id; r.style.display = "none";
                r.innerHTML = `<label class="${labelCls}" for="${id}Date">${t(label)}</label>
                    <div class="cr-saved-pick"><input type="date" id="${id}Date" class="${fieldCls} cr-saved-date" max="${today}">
                    ${kind === "cmp" ? `<div class="cr-saved-chips">${chips(kind)}</div>` : ""}${kind === "base" ? `<div class="cr-saved-chips"><button type="button" class="cr-saved-chip" id="crSavedLatest" hidden>${t("creditreport.saved.backLatest")}</button></div><div class="cr-saved-text" id="${id}Text"></div>` : ""}</div>`;
                return r;
            };
            const cmpRow = row("crSavedCmpRow", "creditreport.saved.compareWith", "cmp");
            compareRow.after(cmpRow);
            const baseRow = row("crSavedBaseRow", "creditreport.saved.chooseData", "base");
            modeRow.after(baseRow);
            // Comparison (and its Compare with date) right under Choose Data:
            // the day shown, then what it is compared with (owner, 24/11/2026).
            baseRow.after(compareRow);
            compareRow.after(cmpRow);
            ui = { sel, compareRow, cmpRow, cmpInput: cmpRow.querySelector("input"), baseRow, baseInput: baseRow.querySelector("input"),
                baseText: baseRow.querySelector(".cr-saved-text"), latestBtn: baseRow.querySelector("#crSavedLatest") };

            const setCmp = v => { if (!v || v === saved.cmpAt) return; saved.cmpAt = v; persist(); ensure(); };
            const leaveBase = () => {
                if (!baseOn()) return syncUi();
                saved.baseOn = false; persist(); baseInfo = null; baseMsg = "";
                syncUi();
                if (opts.reload) opts.reload();
            };
            // A day on / after the latest data = the latest data.
            const chooseDay = v => {
                const live = liveDate();
                if (!v || (live && v >= live)) return leaveBase();
                if (baseOn() && v === saved.baseAt) return;
                saved.baseAt = v; saved.baseOn = true; persist();
                syncUi();
                if (opts.reload) opts.reload();
            };
            ui.cmpInput.addEventListener("change", () => setCmp(ui.cmpInput.value));
            ui.baseInput.addEventListener("change", () => chooseDay(ui.baseInput.value));
            ui.latestBtn.addEventListener("click", leaveBase);
            cmpRow.addEventListener("click", e => {
                const b = e.target.closest("[data-chip]"); if (!b) return;
                const d = opts.data();
                setCmp(chipDate(b.dataset.chip, d && String(d.toDate || "").slice(0, 10)));
            });
            sel.addEventListener("change", syncUi);
            document.getElementById("crModeHistoryBtn")?.addEventListener("click", leaveBase);
            // Follows the Comparison row (Latest & Compare only).
            new MutationObserver(syncUi).observe(compareRow, { attributes: true, attributeFilter: ["style"] });
            return ui;
        }
        mountUi();

        return { ensure, note, itemFor, expand: expandSection, lastLabel, applyBase, baseMessage, syncUi };
    }

    // ---------- Saved date compare + Saved & Compare (18/11/2026) ----------
    // Comparison "Saved date…": the same blocks as Last Month, against the
    // last saved day on or before a picked date. Saved & Compare: the
    // table shows a saved day instead of the live report (controller.
    // applyBase), and compares it with its own last month or a saved
    // date. Picks are kept per page for the browser session.
    const SAVED = "savedDate";
    const stKey = () => `cr_saved|${location.pathname}`;
    const saved = (() => { try { return JSON.parse(sessionStorage.getItem(stKey()) || "{}") || {}; } catch (e) { return {}; } })();
    function persist() { try { sessionStorage.setItem(stKey(), JSON.stringify(saved)); } catch (e) { /* private mode */ } }
    // compare=savedDate in the URL, set before the option exists.
    const pendingCompare = (() => { try { return new URLSearchParams(location.search).get("compare"); } catch (e) { return null; } })();
    function savedCompare() { const s = document.getElementById("crCompare"); return !!s && s.value === SAVED; }
    function isSavedCompare(v) { return v === SAVED; }
    function compareAt() { return savedCompare() ? saved.cmpAt || "" : ""; }
    function baseOn() { return !!saved.baseOn; }
    // The table's title line while Saved & Compare shows a saved day: its
    // own date, not the live report's (the panel above stays live).
    const dmyKey = k => { const [y, m, d] = String(k || "").split("-"); return y && m && d ? `${d}/${m}/${y}` : ""; };
    function headAsOf(data, liveText) {
        return data && data.savedBase ? `${dmyKey(data.savedBase)} (${t("creditreport.saved.headSaved")})` : liveText;
    }
    function headT24(data, liveText) {
        return data && data.savedBase ? t("creditreport.saved.headT24", { date: dmyKey(data.savedBase) }) : liveText;
    }
    // The saved day the table actually shows (the picked one, or the last
    // saved day before it) — what Excel exports.
    let shownBase = "";
    function baseAt() { return baseOn() ? shownBase || "" : ""; }

    // A row takes a saved day's figures: every non-text field is replaced,
    // the row's own names (branch, officer, product …) stay.
    function swapFigures(it, prev) {
        if (!it || !prev) return;
        for (const k of Object.keys(it)) if (typeof it[k] !== "string") delete it[k];
        for (const k of Object.keys(prev)) if (typeof prev[k] !== "string" || !(k in it)) it[k] = prev[k];
    }
    // The rows shown added up (a filtered list's Total): counts and
    // amounts summed; PAR % = value over the outstanding (Area figures
    // over the Area outstanding).
    function sumRows(rows) {
        const out = {};
        const add = (o, src) => {
            for (const [k, v] of Object.entries(src || {})) {
                if (typeof v === "number") { if (k !== "parPct") o[k] = (o[k] || 0) + (Number.isFinite(v) ? v : 0); }
                else if (v && typeof v === "object" && !Array.isArray(v)) { if (!o[k] || typeof o[k] !== "object") o[k] = {}; add(o[k], v); }
            }
        };
        rows.forEach(r => add(out, r));
        const setPct = (node, d) => {
            if (!node || typeof node !== "object") return;
            if (typeof node.value === "number") node.parPct = d ? node.value / d : 0;
            for (const v of Object.values(node)) if (v && typeof v === "object") setPct(v, d);
        };
        for (const k of Object.keys(out)) {
            if (!/^(parT24|nbcOverdue)/.test(k)) continue;
            const den = /Area/.test(k) ? (out.loanOutstandingArea || {}).value : (out.loanOutstanding || {}).value;
            setPct(out[k], den);
        }
        return out;
    }

    // ---------- Daily History: T24 of past days = NBC Overdue ----------
    // Owner's rule (08/11/2026): Balance Loan at Risk (T24) is a live
    // figure, so only TODAY shows T24; every earlier day shows that day's
    // NBC Overdue (EOD) in the T24 section — the same mapping as the Last
    // Month comparison (t24LastMonth: flat, by class, officer Own / Area,
    // Area by team, CO / FSRO / Digital). Display only: the saved day is
    // not changed. Today = the Phnom Penh calendar day.
    function phnomPenhToday() {
        try {
            return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Phnom_Penh", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
        } catch (e) {
            const d = new Date(Date.now() + 7 * 3600 * 1000);
            return d.toISOString().slice(0, 10);
        }
    }
    function nbcAsT24(it) {
        if (!it || typeof it !== "object") return it;
        const out = { ...it };
        t24LastMonth(out);
        if (out.breakdown) out.breakdown = Object.fromEntries(Object.entries(out.breakdown).map(([k, v]) => [k, nbcAsT24(v)]));
        return out;
    }
    // data: a history response { days: [{ date, items, total, combined?,
    // otherAddressDetail?, t24AsOfText }] } — changed in place, returned.
    function t24FromNbcHistory(data, today = phnomPenhToday()) {
        if (!data || !Array.isArray(data.days)) return data;
        data.days = data.days.map(day => {
            // Every saved day (none carries T24 any more; older ones' saved
            // T24 is ignored). Today's T24 is the live row (addLiveToday).
            if (!day || day.liveToday) return day;
            const out = { ...day, t24FromNbc: true, t24AsOfText: "" };
            for (const k of ["items", "otherAddressDetail"]) if (Array.isArray(day[k])) out[k] = day[k].map(nbcAsT24);
            for (const k of ["total", "combined"]) if (day[k]) out[k] = nbcAsT24(day[k]);
            return out;
        });
        return data;
    }
    // The note under the table while Daily History shows the T24 section.
    function t24HistNote(show) {
        const el = document.getElementById("crT24HistNote");
        if (!el) return;
        el.style.display = show ? "" : "none";
        if (show) el.textContent = t("creditreport.detail.t24HistFromNbc");
    }

    // Saved snapshots are keyed by the NBC date, which runs a day behind
    // the calendar — so no saved day is ever "today". For the T24 view,
    // add today as a live row (the plain live report, no filters — same
    // shape as a snapshot), once the picked range reaches the latest NBC
    // day. Shown only when every shown section is T24 (see liveDayShown).
    let liveDate = null;
    async function fetchLive(path, token) {
        try {
            const res = await fetch(`${API.BASE_URL}${path}`, { headers: { Authorization: `Bearer ${token}` } });
            const d = await res.json();
            return d && d.ok ? d : null;
        } catch (e) { return null; }
    }
    function addLiveToday(data, live, dateTo, today = phnomPenhToday()) {
        liveDate = null;
        if (!data || !Array.isArray(data.days) || !live || !live.toDate || !dateTo) return data;
        if (data.days.some(d => String(d.date) >= today)) return data;
        if (String(dateTo) < String(live.toDate).slice(0, 10)) return data;
        data.days.push({
            date: today, liveToday: true,
            t24AsOfText: (live.meta && live.meta.arrearsPenaltyText) || "",
            items: live.items || [], total: live.total || null,
            otherAddressDetail: live.otherAddressDetail || []
        });
        liveDate = today;
        return data;
    }
    function liveDayShown(day, section) {
        if (!day || !day.liveToday) return true;
        return !!section && section.groups.length > 0 && section.groups.every(g => g.key === "parT24");
    }
    function isLiveDate(dateKey) { return !!liveDate && dateKey === liveDate; }
    // ↻ re-pulls live T24 into a saved day; past days now show NBC, so
    // only a saved day dated today (if any) keeps it.
    // T24 is no longer saved in snapshots — nothing to refresh.
    function canRefreshT24() { return false; }

    return { cutoff, shortDate, load, attach, diffTree, expand, cell, renderNote, hideNote, scopeSaved, controller, t24FromNbcHistory, t24HistNote, phnomPenhToday, fetchLive, addLiveToday, liveDayShown, isLiveDate, canRefreshT24,
        SAVED, isSavedCompare, compareAt, baseAt, sumRows, headAsOf, headT24 };
})();
