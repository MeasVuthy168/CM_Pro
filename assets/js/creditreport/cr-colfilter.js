// =========================================================
// Daily Monitoring (Branch / Officer / Product / Location) — Excel-style
// column filters, like Daily Arrears (owner, 28/11/2026). A funnel
// button on every sortable column header opens a sheet with that
// column's values (as the table shows them, among the rows the other
// column filters leave), a search box, Select all, and Sort A→Z / Z→A
// (smallest → largest for numbers). Rows not kept are hidden; the rows
// that hang under one (a branch's CO / FSRO / Digital, "Other Address"
// details) follow it. The Total row then counts the rows kept only
// (owner, 28/11/2026): figures added up, PAR % from the added-up values,
// last month the same way, plans added up (a % plan weighted by the
// outstanding plan) and the % of plan worked out again.
//
// The values come from the rendered table, so a filter works in every
// Comparison mode (its column = the header's data-sort-key). Filters
// live in sessionStorage per page and are dropped for columns no longer
// on screen.
//
//   CRColFilter.init({
//     sort(key, type, dir),  — the page's own sort
//     items(),               — the rows' data (null: no Total of its own, e.g. Daily History);
//                              each main <tr> carries data-colf-i = its index there
//     total(),               — the report's own Total
//     renderTotal(item)      — the Total row's HTML for a Total
//   })
// =========================================================
(function () {
    const STORE_KEY = `cr_colfilters_v1:${location.pathname}`;
    const MAX_LIST = 500;
    const t = (k, vars) => {
        const s = window.CMI18n ? CMI18n.t(k, vars) : k;
        return s === k ? ({ "creditreport.colf.open": "Filter column", "creditreport.colf.search": "Search...", "creditreport.colf.selectAll": "Select all",
            "creditreport.colf.selectAllResults": "Select all search results", "creditreport.colf.blank": "(Blanks)", "creditreport.colf.none": "No values",
            "creditreport.colf.clear": "Clear filter", "creditreport.colf.ok": "OK", "creditreport.colf.sortAZ": "Sort A → Z", "creditreport.colf.sortZA": "Sort Z → A",
            "creditreport.colf.sortAsc": "Sort smallest → largest", "creditreport.colf.sortDesc": "Sort largest → smallest" }[k] || k) : s;
    };
    const esc = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const DEPENDENT = ["cr-breakdown-row", "cr-other-detail-row"];   // rows under the row above them

    let config = { sort: null };
    let filters = new Map();   // key -> Set of cell texts kept
    try {
        const raw = JSON.parse(sessionStorage.getItem(STORE_KEY) || "{}");
        Object.entries(raw).forEach(([k, v]) => { if (Array.isArray(v)) filters.set(k, new Set(v)); });
    } catch (e) { /* none */ }
    function save() {
        try {
            const out = {};
            filters.forEach((s, k) => { out[k] = [...s]; });
            sessionStorage.setItem(STORE_KEY, JSON.stringify(out));
        } catch (e) { /* not kept */ }
    }

    const thead = () => document.getElementById("crThead");
    const tbody = () => document.getElementById("crTbody");
    const headers = () => [...((thead() && thead().querySelectorAll("th[data-sort-key]")) || [])];

    // The body cell index of a header: the name column is cell 0, the
    // figures follow in header order (each report builds both from the
    // same field list).
    function cellIndex(th) {
        if (th.dataset.sortKey === "_name" || th.classList.contains("cr-branch-col")) return 0;
        const figures = headers().filter(h => !(h.dataset.sortKey === "_name" || h.classList.contains("cr-branch-col")));
        return figures.indexOf(th) + 1;
    }

    // What a cell shows, as the filter compares it (no rank, no buttons' arrows).
    function textOf(td) {
        if (!td) return "";
        const c = td.cloneNode(true);
        c.querySelectorAll(".cr-rank, .cr-row-expand-btn, .cr-other-toggle-icon, .cr-ach-bar").forEach(n => n.remove());
        return c.textContent.replace(/\s+/g, " ").trim();
    }

    // Main rows (not the Total, not a row hanging under another).
    function mainRows() {
        return [...((tbody() && tbody().rows) || [])].filter(tr =>
            tr.cells.length > 1 && !tr.classList.contains("cr-total-row") && !DEPENDENT.some(c => tr.classList.contains(c)));
    }

    function columns() {
        const map = new Map();
        headers().forEach(th => { if (!map.has(th.dataset.sortKey)) map.set(th.dataset.sortKey, th); });
        return map;
    }

    function keeps(tr, exceptKey, cols) {
        for (const [key, set] of filters) {
            if (key === exceptKey) continue;
            const th = cols.get(key);
            if (!th) continue;
            if (!set.has(textOf(tr.cells[cellIndex(th)]))) return false;
        }
        return true;
    }

    // Hide the rows the filters don't keep (and the rows under them).
    function applyRows() {
        const cols = columns();
        // A column no longer on screen: its filter goes.
        let dropped = false;
        for (const k of [...filters.keys()]) if (!cols.has(k)) { filters.delete(k); dropped = true; }
        if (dropped) save();
        let hideNext = false, inTotal = false;
        const kept = [];
        [...((tbody() && tbody().rows) || [])].forEach(tr => {
            if (tr.classList.contains("cr-total-row")) { tr.classList.remove("cr-colf-hide"); hideNext = false; inTotal = true; return; }
            if (DEPENDENT.some(c => tr.classList.contains(c))) { tr.classList.toggle("cr-colf-hide", hideNext && !inTotal); return; }
            inTotal = false;
            const hide = tr.cells.length > 1 && filters.size > 0 && !keeps(tr, null, cols);
            tr.classList.toggle("cr-colf-hide", hide);
            hideNext = hide;
            if (!hide && tr.dataset.colfI !== undefined) kept.push(Number(tr.dataset.colfI));
        });
        applyTotal(kept);
    }

    // ---------- the Total of the rows kept ----------
    const PCT_PLANS = ["nbcOverduePct", "nplPct", "projParPct"];
    const strip = it => { const o = { ...it }; delete o.lastMonth; delete o.lastMonthDiff; delete o.planVs; return o; };
    function sumPlans(items) {
        const pvs = items.map(it => it.planVs || {});
        const keys = new Set(pvs.flatMap(p => Object.keys(p)));
        const os = it => Number((it.loanOutstanding || {}).value) || 0;
        const out = {};
        const r2 = n => Math.round(n * 100) / 100;
        keys.forEach(k => {
            const cells = pvs.map(p => p[k] || {});
            const has = f => cells.every(c => c[f] !== null && c[f] !== undefined);
            const sum = f => cells.reduce((s, c) => s + (Number(c[f]) || 0), 0);
            const m = {};
            if (PCT_PLANS.includes(k)) {
                // a % actual: weighted by the rows' outstanding; a % plan:
                // by their outstanding plan (as the server's Total does)
                const w = items.reduce((s, it) => s + os(it), 0);
                m.actual = has("actual") && w ? r2(items.reduce((s, it, i) => s + Number(cells[i].actual) * os(it), 0) / w) : null;
                const planOs = pvs.map(p => (p.osAmount || {}).plan);
                const wp = planOs.every(v => v !== null && v !== undefined) ? planOs.reduce((s, v) => s + Number(v), 0) : 0;
                m.plan = has("plan") && wp ? r2(cells.reduce((s, c, i) => s + Number(c.plan) * Number(planOs[i]), 0) / wp) : null;
            } else {
                m.actual = cells.some(c => c.actual !== null && c.actual !== undefined) ? r2(sum("actual")) : null;
                m.plan = has("plan") ? r2(sum("plan")) : null;
                if (cells.some(c => c.expected !== undefined)) m.expected = has("expected") ? r2(sum("expected")) : null;
                if (cells.some(c => c.detail)) m.detail = { int: r2(cells.reduce((s, c) => s + Number((c.detail || {}).int || 0), 0)), prn: r2(cells.reduce((s, c) => s + Number((c.detail || {}).prn || 0), 0)) };
                if (cells.some(c => c.counts)) m.counts = { ld: cells.reduce((s, c) => s + Number((c.counts || {}).ld || 0), 0), cif: cells.reduce((s, c) => s + Number((c.counts || {}).cif || 0), 0) };
            }
            m.ach = m.plan && m.actual !== null ? r2(m.actual / m.plan) : null;
            out[k] = m;
        });
        // Projection PAR % = PAR Value $ ÷ the outstanding, for the rows kept.
        if (out.projParPct && out.nbcOverdueValue) {
            const w = items.reduce((s, it) => s + os(it), 0);
            out.projParPct.plan = out.nbcOverdueValue.plan !== null && w ? r2(out.nbcOverdueValue.plan / w * 100) : null;
        }
        return out;
    }
    function totalOf(items) {
        const LM = window.CRLastMonth;
        if (!LM || !LM.sumRows) return null;
        const tot = LM.sumRows(items.map(strip));
        if (items.some(it => it.planVs)) tot.planVs = sumPlans(items);
        if (items.some(it => it.lastMonth !== undefined)) {
            const prev = items.map(it => it.lastMonth).filter(Boolean);
            LM.attach(tot, prev.length === items.length ? LM.sumRows(prev) : null);
        }
        return tot;
    }
    // Swap the Total row (and the rows under it) for the rows kept's Total —
    // or back to the report's own one when no filter is on.
    function applyTotal(kept) {
        if (!config.items || !config.renderTotal) return;
        const items = config.items();
        const b = tbody();
        const row = b && [...b.rows].find(tr => tr.classList.contains("cr-total-row"));
        if (!items || !row) return;
        const sig = filters.size ? kept.join(",") : "";
        if ((row.dataset.colfSig || "") === sig) return;
        const tot = sig ? totalOf(kept.map(i => items[i]).filter(Boolean)) : (config.total && config.total());
        if (!tot) return;
        const tmp = document.createElement("tbody");
        tmp.innerHTML = config.renderTotal(tot);
        const rows = [...tmp.rows];
        if (!rows.length) return;
        rows[0].dataset.colfSig = sig;
        // the row and the rows that hang under it
        let next = row.nextElementSibling;
        while (next && DEPENDENT.some(c => next.classList.contains(c))) { const n = next.nextElementSibling; next.remove(); next = n; }
        row.replaceWith(...rows);
    }

    function sortValues(vals, type) {
        const num = v => parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
        return vals.sort((a, b) => {
            if (a === "" || a === "—") return 1;
            if (b === "" || b === "—") return -1;
            if (type === "number") {
                const x = num(a), y = num(b);
                if (!isNaN(x) && !isNaN(y)) return x - y;
            }
            return a.localeCompare(b);
        });
    }

    // ---------- header buttons ----------
    function decorate() {
        headers().forEach(th => {
            let btn = th.querySelector(":scope > .cr-colf-btn");
            if (!btn) {
                btn = document.createElement("button");
                btn.type = "button";
                btn.className = "cr-colf-btn";
                btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h18l-7 8v5l-4 2v-7z"/></svg>';
                th.appendChild(btn);
            }
            const on = filters.has(th.dataset.sortKey);
            btn.classList.toggle("on", on);
            btn.title = t("creditreport.colf.open");
            btn.setAttribute("aria-label", t("creditreport.colf.open"));
            th.classList.toggle("cr-colf-active", on);
        });
    }

    // ---------- the sheet ----------
    let sheet = null, cur = null;
    function ensureSheet() {
        if (sheet) return sheet;
        sheet = document.createElement("div");
        sheet.className = "cr-colf-wrap";
        sheet.hidden = true;
        sheet.innerHTML = `
            <div class="cr-colf-dim" data-colf-close></div>
            <div class="cr-colf-sheet" role="dialog" aria-modal="true">
                <div class="cr-colf-head"><b class="cr-colf-title"></b><button type="button" class="cr-colf-x" data-colf-close aria-label="Close">✕</button></div>
                <div class="cr-colf-sort"><button type="button" data-colf-sort="1"></button><button type="button" data-colf-sort="-1"></button></div>
                <input type="search" class="cr-colf-search" autocomplete="off">
                <label class="cr-colf-all"><input type="checkbox"> <span></span></label>
                <div class="cr-colf-list"></div>
                <div class="cr-colf-more"></div>
                <div class="cr-colf-actions"><button type="button" class="cr-colf-clear"></button><button type="button" class="cr-colf-ok"></button></div>
            </div>`;
        document.body.appendChild(sheet);
        sheet.addEventListener("click", e => {
            if (e.target.closest("[data-colf-close]")) return close();
            const s = e.target.closest("[data-colf-sort]");
            if (s) {
                if (config.sort) config.sort(cur.key, cur.type, Number(s.dataset.colfSort));
                return close();
            }
            if (e.target.closest(".cr-colf-clear")) { filters.delete(cur.key); return done(); }
            if (e.target.closest(".cr-colf-ok")) {
                if (!cur.checked.size) return;
                if (cur.all.every(x => cur.checked.has(x.v))) filters.delete(cur.key);
                else filters.set(cur.key, new Set(cur.checked));
                return done();
            }
        });
        sheet.querySelector(".cr-colf-list").addEventListener("change", e => {
            const cb = e.target.closest("input[data-v]");
            if (!cb) return;
            if (cb.checked) cur.checked.add(cb.dataset.v); else cur.checked.delete(cb.dataset.v);
            syncAll();
        });
        sheet.querySelector(".cr-colf-all input").addEventListener("change", e => {
            visible().forEach(x => { if (e.target.checked) cur.checked.add(x.v); else cur.checked.delete(x.v); });
            renderList();
        });
        sheet.querySelector(".cr-colf-search").addEventListener("input", e => { cur.q = e.target.value.trim().toLowerCase(); renderList(); });
        document.addEventListener("keydown", e => { if (e.key === "Escape" && sheet && !sheet.hidden) close(); });
        return sheet;
    }
    const visible = () => (cur.q ? cur.all.filter(x => (x.v || t("creditreport.colf.blank")).toLowerCase().includes(cur.q)) : cur.all);
    function syncAll() {
        const vis = visible();
        const box = sheet.querySelector(".cr-colf-all input");
        const n = vis.filter(x => cur.checked.has(x.v)).length;
        box.checked = vis.length > 0 && n === vis.length;
        box.indeterminate = n > 0 && n < vis.length;
        sheet.querySelector(".cr-colf-ok").disabled = cur.checked.size === 0;
    }
    function renderList() {
        const vis = visible();
        sheet.querySelector(".cr-colf-all span").textContent = t(cur.q ? "creditreport.colf.selectAllResults" : "creditreport.colf.selectAll");
        sheet.querySelector(".cr-colf-list").innerHTML = vis.length ? vis.slice(0, MAX_LIST).map(x => `
            <label class="cr-colf-item"><input type="checkbox" data-v="${esc(x.v)}" ${cur.checked.has(x.v) ? "checked" : ""}>
                <span class="cr-colf-v${x.v ? "" : " blank"}">${esc(x.v || t("creditreport.colf.blank"))}</span><small>${x.n.toLocaleString()}</small></label>`).join("")
            : `<div class="cr-colf-none">${esc(t("creditreport.colf.none"))}</div>`;
        sheet.querySelector(".cr-colf-more").textContent = vis.length > MAX_LIST ? `… +${(vis.length - MAX_LIST).toLocaleString()}` : "";
        syncAll();
    }
    function open(th) {
        ensureSheet();
        const key = th.dataset.sortKey, cols = columns(), idx = cellIndex(th);
        const counts = new Map();
        mainRows().forEach(tr => {
            if (!keeps(tr, key, cols)) return;
            const v = textOf(tr.cells[idx]);
            counts.set(v, (counts.get(v) || 0) + 1);
        });
        const active = filters.get(key);
        if (active) active.forEach(v => { if (!counts.has(v)) counts.set(v, 0); });
        const type = th.dataset.sortType || "text";
        const all = sortValues([...counts.keys()], type).map(v => ({ v, n: counts.get(v) }));
        // The column's name: its own label (and the group above, for figures).
        const own = textOf(th);
        cur = { key, type, all, q: "", checked: new Set(active ? [...active] : all.map(x => x.v)) };
        sheet.querySelector(".cr-colf-title").textContent = own || key;
        sheet.querySelector('[data-colf-sort="1"]').textContent = t(type === "text" ? "creditreport.colf.sortAZ" : "creditreport.colf.sortAsc");
        sheet.querySelector('[data-colf-sort="-1"]').textContent = t(type === "text" ? "creditreport.colf.sortZA" : "creditreport.colf.sortDesc");
        sheet.querySelector('[data-colf-sort="1"]').parentElement.hidden = !config.sort;
        const clear = sheet.querySelector(".cr-colf-clear");
        clear.textContent = t("creditreport.colf.clear");
        clear.disabled = !active;
        sheet.querySelector(".cr-colf-ok").textContent = t("creditreport.colf.ok");
        const search = sheet.querySelector(".cr-colf-search");
        search.value = "";
        search.placeholder = t("creditreport.colf.search");
        renderList();
        sheet.hidden = false;
        document.body.classList.add("cr-colf-open");
    }
    function close() {
        if (!sheet) return;
        sheet.hidden = true;
        document.body.classList.remove("cr-colf-open");
    }
    function done() {
        save();
        close();
        decorate();
        applyRows();
    }

    // The funnel's click opens the sheet — caught before the header's own
    // click (which sorts).
    document.addEventListener("click", e => {
        const btn = e.target.closest(".cr-colf-btn");
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation();
        open(btn.closest("th"));
    }, true);

    // The tables are re-drawn on every change: decorate the new header
    // and re-apply the filters to the new rows.
    function watch() {
        const h = thead(), b = tbody();
        if (!h || !b) return;
        let busy = false;
        const run = () => {
            if (busy) return;
            busy = true;
            requestAnimationFrame(() => { decorate(); applyRows(); busy = false; });
        };
        new MutationObserver(run).observe(h, { childList: true, subtree: true });
        new MutationObserver(run).observe(b, { childList: true });
        run();
    }
    window.addEventListener("cm-language-changed", decorate);

    window.CRColFilter = {
        init(opts = {}) {
            config = { ...config, ...opts };
            if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", watch); else watch();
        },
        active: () => [...filters.keys()],
        clear() { filters = new Map(); save(); decorate(); applyRows(); },
        refresh() { decorate(); applyRows(); }
    };
})();
