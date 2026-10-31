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

    // A row's class: bold for a total, indented for a part of the row above.
    const trCls = r => (r.total ? ' class="cp-total"' : r.sub ? ' class="cp-sub"' : "");

    // Actual Only: rows × fields. rows: [{ label, data, total }]
    function actualTable(rows, fields) {
        return `<table class="cp-table"><thead><tr><th></th>${fields.map(f => `<th>${esc(f.label)}</th>`).join("")}</tr></thead><tbody>
          ${rows.map(r => `<tr${trCls(r)}><td>${esc(r.label)}</td>${fields.map(f => {
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
            return `<tr${trCls(r)}><td>${esc(r.label)}</td><td>${fmt(prev, field, true)}</td><td class="cp-now">${fmt(cur, field, true)}</td><td class="cp-${d.cls}">${d.html || "—"}</td></tr>`;
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

    // ---- The page controller ----
    // One page's Comparison: the switch, the note under it, the strip
    // and every card's figures, re-drawn on each change. o:
    //   ids        { compare, note, strip, cards } element ids
    //   cats()     the cards: { key, fields: [{ k, label, money, pct,
    //              main }], risk, plan: [{ key, label, money, pctPts,
    //              lowerBetter, disb, head }] | null }
    //   rows(cat, last)  the card's table rows: [{ label, data, last,
    //              total, head }] — head = the row the big figure shows;
    //              last = last month's saved row (null = not loaded)
    //   current()  the figures the strip shows; strip: [{ label, k,
    //              money, pct, risk, plan, ring, sub(cur) }]
    //   toDate()   the report's OS date ("yyyy-mm-dd")
    //   loadLastMonth()  -> { info, row } (CRLastMonth info, saved row)
    //   loadPlan()  -> { data, metrics } (Plan vs Actual response, this
    //              page's metrics) — omit when the page has no plan
    //   planNote   the plan's scope, as a sentence
    //   lastMonthNote  anything more to say about last month, as a sentence
    function controller(o) {
        const st = { mode: "actual", lm: { state: "" }, plan: { state: "" } };
        const modes = [
            { key: "actual", label: t("creditreport.plan.compareActual") },
            { key: "lastMonth", label: t("creditreport.plan.compareLastMonth") }
        ];
        if (o.loadPlan) modes.push({ key: "plan", label: t("creditreport.plan.plan") });
        const fmtDate = d => {
            const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || "");
            return m ? `${m[3]}-${m[2]}-${m[1]}` : "-";
        };
        const lmRow = () => (st.lm.state === "done" ? st.lm.row : null);
        const planOk = () => st.plan.state === "done" && st.plan.metrics;
        const planMetric = key => {
            const m = planOk() && st.plan.metrics[key];
            return m && num(m.plan) !== null ? m : null;
        };
        const loading = () => `<div class="cp-empty">${esc(t("common.loading"))}</div>`;

        async function ensure(kind) {
            const slot = st[kind];
            if (slot.state) return;
            slot.state = "loading";
            try {
                Object.assign(slot, kind === "lm" ? await o.loadLastMonth() : await o.loadPlan());
                slot.state = "done";
            } catch (e) {
                console.error(`${kind} failed:`, e);
                slot.state = "error";
            }
            render();
        }

        function headFigs(cat) {
            const rows = o.rows(cat, lmRow());
            const row = rows.find(r => r.head) || rows[rows.length - 1];
            const main = { ...cat.fields.find(f => f.main), risk: cat.risk };
            const parField = cat.fields.find(f => f.pct);
            const parV = parField ? get(row.data, parField.k) : null;
            const pill = parField && window.CRTable ? CRTable.parPill(parV) : "";
            const big = `<span class="cp-big">${fmt(get(row.data, main.k), main, true)}</span>`;
            if (st.mode === "lastMonth" && row.last) {
                const d = delta(get(row.data, main.k), get(row.last, main.k), main, { withPct: true });
                return big + pill + chip(d.html, d.cls);
            }
            if (st.mode === "plan" && planOk()) {
                const head = cat.plan && cat.plan.find(p => p.head);
                if (!head) return big + pill + chip(esc(t("creditreport.perf.noPlanSection")), "muted");
                const m = planMetric(head.key);
                if (!m) return big + pill;
                if (head.lowerBetter) {
                    // The PAR % shown (the page's own figure) against the ceiling.
                    const d = Math.round(((Number(parV) || 0) * 100 - m.plan) * 100) / 100;
                    return `${big}${pill}<span class="cp-of">${esc(t("creditreport.plan.planMax"))} ${Number(m.plan).toFixed(2)}%</span>${chip(`<span class="cp-arrow">${d > 0 ? "▲" : "▼"}</span>${Math.abs(d).toFixed(2)}`, d <= 0 ? "good" : "bad")}`;
                }
                return `<span class="cp-big">${fmt(m.actual, head, true)}</span><span class="cp-of">/ ${fmt(m.plan, head, true)}</span>${chip(num(m.ach) === null ? "" : `${Math.round(m.ach * 100)}%`, achCls(m.ach, head.disb))}`;
            }
            return big + pill;
        }

        function body(cat) {
            const rows = o.rows(cat, lmRow());
            const actual = () => actualTable(rows, cat.fields);
            if (st.mode === "lastMonth") {
                if (st.lm.state !== "done" && st.lm.state !== "error") return loading();
                if (!lmRow()) return actual();
                const main = { ...cat.fields.find(f => f.main), risk: cat.risk };
                const others = cat.fields.filter(f => !f.main).map(f => ({ ...f, risk: cat.risk }));
                const head = rows.find(r => r.head) || rows[rows.length - 1];
                return lastMonthTable(rows, main, { lastLabel: CRLastMonth.shortDate(st.lm.info.date), nowLabel: CRLastMonth.shortDate(o.toDate()) })
                    + (others.length ? `<div class="cp-foot">${lastMonthFoot(head, others)}</div>` : "");
            }
            if (st.mode === "plan") {
                if (st.plan.state !== "done" && st.plan.state !== "error") return loading();
                if (!cat.plan) return `<div class="cp-empty">${esc(t("creditreport.perf.noPlanSection"))}</div>${actual()}`;
                const metrics = cat.plan.map(p => ({ ...p, m: planMetric(p.key) })).filter(p => p.m);
                // No plan at all: the note at the top says so once.
                if (!metrics.length) return planOk() ? `<div class="cp-empty">${esc(t("creditreport.plan.noPlan"))}</div>${actual()}` : actual();
                const head = metrics.find(p => p.head && !p.lowerBetter);
                const cls = head && achCls(head.m.ach, head.disb);
                const top = head && num(head.m.ach) !== null
                    ? `<div class="cp-ach cp-${cls}">${bar(head.m.ach, cls)}<span>${Math.round(head.m.ach * 100)}%</span></div>`
                    : "";
                return top + planTable(metrics);
            }
            return actual();
        }

        function stripHtml() {
            const cur = o.current();
            const last = st.mode === "lastMonth" ? lmRow() : null;
            const pl = st.mode === "plan" && planOk();
            return strip(o.strip.map(k => {
                const v = get(cur, k.k);
                const m = pl && k.plan ? planMetric(k.plan) : null;
                let sub = k.sub ? k.sub(cur) : "";
                if (last) {
                    const d = delta(v, get(last, k.k), k, { withPct: true });
                    sub = chip(d.html, d.cls);
                } else if (m && k.pct) {
                    sub = chip(`${esc(t("creditreport.plan.planMax"))} ${Number(m.plan).toFixed(2)}%`, (Number(v) || 0) * 100 <= m.plan ? "good" : "bad");
                } else if (m && k.ring) {
                    sub = `<span class="cp-muted">${fmt(m.actual, k, true)} / ${fmt(m.plan, k, true)}</span>`;
                } else if (m) {
                    sub = chip(`${Math.round(m.ach * 100)}% · ${fmt(m.plan, k, true)}`, achCls(m.ach));
                }
                return {
                    label: k.label,
                    value: k.pct && window.CRTable ? CRTable.parPill(v) : fmt(v, k, true),
                    ring: m && k.ring ? ring(m.ach, achCls(m.ach, true)) : "",
                    sub
                };
            }));
        }

        function note() {
            if (st.mode === "lastMonth") {
                if (st.lm.state === "error") return t("creditreport.lastMonth.loadFailed");
                if (st.lm.state !== "done") return t("common.loading");
                const info = st.lm.info;
                if (!info || !info.date || !st.lm.row) return t("creditreport.lastMonth.noSnapshot", { date: fmtDate(info && info.cutoff) });
                return [t("creditreport.perf.lmNote", { date: fmtDate(info.date) }), o.lastMonthNote || ""].join(" ").trim();
            }
            if (st.mode === "plan") {
                if (st.plan.state === "error") return t("creditreport.plan.loadFailed");
                if (st.plan.state !== "done") return t("creditreport.plan.loading");
                const d = st.plan.data;
                if (!st.plan.metrics || !d.hasPlan) return t("creditreport.plan.noPlan");
                const [y, m] = String(d.month || "").split("-");
                return [
                    t("creditreport.plan.noteMonth", { month: `${m}-${y}`, from: fmtDate(d.fromDate), to: fmtDate(d.toDate), done: d.daysDone, days: d.daysInMonth }),
                    o.planNote || "",
                    t("creditreport.perf.planRules")
                ].join(" ");
            }
            return "";
        }

        function render() {
            const box = document.getElementById(o.ids.compare);
            box.innerHTML = switcher(modes, st.mode);
            box.style.display = "";
            document.getElementById(o.ids.note).textContent = note();
            const stripEl = document.getElementById(o.ids.strip);
            stripEl.innerHTML = stripHtml();
            stripEl.style.display = "";
            const cats = o.cats();
            document.querySelectorAll(`#${o.ids.cards} .op-card`).forEach(card => {
                const cat = cats.find(c => c.key === card.dataset.key);
                if (!cat) return;
                card.querySelector(".cp-head-figs").innerHTML = headFigs(cat);
                card.querySelector(".cp-body").innerHTML = body(cat);
            });
        }

        // mode: "actual" | "lastMonth" | "plan"; kept in the URL (compare=).
        function set(mode) {
            st.mode = modes.some(m => m.key === mode) ? mode : "actual";
            const params = new URLSearchParams(location.search);
            if (st.mode === "actual") params.delete("compare"); else params.set("compare", st.mode);
            history.replaceState(history.state, "", `${location.pathname}?${params}`);
            if (st.mode === "lastMonth") ensure("lm");
            if (st.mode === "plan") ensure("plan");
            render();
        }

        document.getElementById(o.ids.compare).addEventListener("click", e => {
            const btn = e.target.closest("[data-compare]");
            if (btn) set(btn.dataset.compare);
        });

        // reset(): another officer / branch — what was loaded is not theirs.
        const reset = () => { st.lm = { state: "" }; st.plan = { state: "" }; };
        return { set, render, reset, start: () => set(new URLSearchParams(location.search).get("compare")) };
    }

    // The empty spots a card needs (cp-head-figs under its label, cp-body
    // under its head), filled by the controller.
    const headSlot = '<div class="cp-head-figs"></div>';
    const bodySlot = '<div class="cp-body"></div>';

    return { fmt, delta, chip, achCls, bar, ring, switcher, strip, actualTable, lastMonthTable, lastMonthFoot, planTable, compact, controller, headSlot, bodySlot };
})();
