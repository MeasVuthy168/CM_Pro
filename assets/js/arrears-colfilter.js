// =========================================================
// DAILY ARREARS — EXCEL-STYLE COLUMN FILTERS
// A ▾ button on every sortable column header (LD and CIF tables). It
// opens a sheet with that column's values (only those left by the other
// filters, like Excel's AutoFilter), a search box, Select all, and
// A→Z / Z→A. A filtered column's button is highlighted; the filter also
// shows as a chip with the page's other filters and is cleared by
// "Clear filters".
//
// arrears.js calls ArrColFilter.match(row) in applyFilters(); the base
// rows (all other page filters applied) are passed in so the value lists
// cascade. State lives in sessionStorage, so it survives a trip to Work
// to complete and back.
// =========================================================

(function () {
    const STORE_KEY = "arr_colfilters_v1";
    const MAX_LIST = 500;          // values rendered at once (search narrows)
    const t = (k, vars) => (window.CMI18n ? CMI18n.t(k, vars) : k);
    const esc = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

    // key -> Set of display values kept (a key present = filter active)
    let filters = new Map();
    try {
        const raw = JSON.parse(sessionStorage.getItem(STORE_KEY) || "{}");
        Object.entries(raw).forEach(([k, vals]) => { if (Array.isArray(vals)) filters.set(k, new Set(vals)); });
    } catch (e) {}

    function save() {
        try {
            const out = {};
            filters.forEach((set, k) => { out[k] = [...set]; });
            sessionStorage.setItem(STORE_KEY, JSON.stringify(out));
        } catch (e) {}
    }

    // What the cell shows, as the filter compares it.
    function valueOf(row, key) {
        let v;
        switch (key) {
            case "alFollowup": v = typeof formatRowDateDMY === "function" ? formatRowDateDMY(row.alFollowup) : row.alFollowup; break;
            case "dateBackup": v = typeof formatRowDateDMY === "function" ? formatRowDateDMY(row.dateBackup) : row.dateBackup; break;
            case "tell": v = typeof formatPhone === "function" ? formatPhone(row.tell) : row.tell; break;
            case "balanceDg": v = typeof balanceDgText === "function" ? balanceDgText(row.balanceDg) : row.balanceDg; break;
            default: v = row[key];
        }
        return String(v == null ? "" : v).trim();
    }

    function match(row, exceptKey) {
        for (const [key, set] of filters) {
            if (key === exceptKey) continue;
            if (!set.has(valueOf(row, key))) return false;
        }
        return true;
    }

    // Sort the value list like the column: numbers, dates (dd/mm/yyyy), text.
    function sortValues(vals, type) {
        const num = v => parseFloat(String(v).replace(/,/g, ""));
        const dmy = v => { const m = String(v).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? Date.UTC(+m[3], +m[2] - 1, +m[1]) : NaN; };
        return vals.sort((a, b) => {
            if (a === "") return 1;               // blanks last
            if (b === "") return -1;
            if (type === "number") {
                const x = num(a), y = num(b);
                if (!isNaN(x) && !isNaN(y)) return x - y;
            } else if (type === "date") {
                const x = dmy(a), y = dmy(b);
                if (!isNaN(x) && !isNaN(y)) return x - y;
            }
            return a.localeCompare(b);
        });
    }

    // ---------- header buttons ----------
    function decorateHeaders() {
        ["arrearsHeadRow", "arrCifHeadRow"].forEach(id => {
            document.querySelectorAll(`#${id} th[data-sort-key]`).forEach(th => {
                let btn = th.querySelector(".arr-colf-btn");
                if (!btn) {
                    btn = document.createElement("button");
                    btn.type = "button";
                    btn.className = "arr-colf-btn";
                    btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h18l-7 8v5l-4 2v-7z"/></svg>';
                    th.appendChild(btn);
                }
                const on = filters.has(th.dataset.sortKey);
                btn.classList.toggle("on", on);
                btn.setAttribute("aria-label", t("arrears.colf.open"));
                btn.title = t("arrears.colf.open");
                th.classList.toggle("arr-colf-active", on);
            });
        });
    }

    // ---------- the sheet ----------
    let sheet = null;
    let cur = null;   // { key, type, label, table, all: [{v, n}], checked: Set, q }

    function ensureSheet() {
        if (sheet) return sheet;
        sheet = document.createElement("div");
        sheet.className = "arr-colf-wrap";
        sheet.hidden = true;
        sheet.innerHTML = `
            <div class="arr-colf-dim" data-colf-close></div>
            <div class="arr-colf-sheet" role="dialog" aria-modal="true">
                <div class="arr-colf-head">
                    <b class="arr-colf-title"></b>
                    <button type="button" class="arr-colf-x" data-colf-close aria-label="${esc(t("common.close"))}">✕</button>
                </div>
                <div class="arr-colf-sort">
                    <button type="button" data-colf-sort="1"></button>
                    <button type="button" data-colf-sort="-1"></button>
                </div>
                <input type="search" class="arr-colf-search" autocomplete="off">
                <label class="arr-colf-all"><input type="checkbox"> <span></span></label>
                <div class="arr-colf-list"></div>
                <div class="arr-colf-more"></div>
                <div class="arr-colf-actions">
                    <button type="button" class="arr-colf-clear"></button>
                    <button type="button" class="arr-colf-ok"></button>
                </div>
            </div>`;
        document.body.appendChild(sheet);

        sheet.addEventListener("click", e => {
            if (e.target.closest("[data-colf-close]")) return close();
            const s = e.target.closest("[data-colf-sort]");
            if (s) {
                const dir = Number(s.dataset.colfSort);
                const state = { key: cur.key, type: cur.type, dir };
                if (cur.table === "cif" && typeof setCifSort === "function") setCifSort(state);
                else if (typeof setLdSort === "function") setLdSort(state);
                return close();
            }
            if (e.target.closest(".arr-colf-clear")) {
                filters.delete(cur.key);
                return apply();
            }
            if (e.target.closest(".arr-colf-ok")) {
                const allVals = cur.all.map(x => x.v);
                if (!cur.checked.size) return;            // nothing ticked: keep the sheet open
                if (allVals.every(v => cur.checked.has(v))) filters.delete(cur.key);
                else filters.set(cur.key, new Set(cur.checked));
                return apply();
            }
        });
        sheet.querySelector(".arr-colf-list").addEventListener("change", e => {
            const cb = e.target.closest("input[data-v]");
            if (!cb) return;
            const v = cb.dataset.v;
            if (cb.checked) cur.checked.add(v); else cur.checked.delete(v);
            syncAll();
        });
        sheet.querySelector(".arr-colf-all input").addEventListener("change", e => {
            visible().forEach(x => { if (e.target.checked) cur.checked.add(x.v); else cur.checked.delete(x.v); });
            renderList();
        });
        sheet.querySelector(".arr-colf-search").addEventListener("input", e => {
            cur.q = e.target.value.trim().toLowerCase();
            renderList();
        });
        document.addEventListener("keydown", e => { if (e.key === "Escape" && sheet && !sheet.hidden) close(); });
        return sheet;
    }

    function visible() {
        return cur.q ? cur.all.filter(x => (x.v || t("arrears.colf.blank")).toLowerCase().includes(cur.q)) : cur.all;
    }

    function syncAll() {
        const vis = visible();
        const allBox = sheet.querySelector(".arr-colf-all input");
        const n = vis.filter(x => cur.checked.has(x.v)).length;
        allBox.checked = vis.length > 0 && n === vis.length;
        allBox.indeterminate = n > 0 && n < vis.length;
        sheet.querySelector(".arr-colf-ok").disabled = cur.checked.size === 0;
    }

    function renderList() {
        const vis = visible();
        const shown = vis.slice(0, MAX_LIST);
        sheet.querySelector(".arr-colf-all span").textContent =
            cur.q ? t("arrears.colf.selectAllResults") : t("arrears.colf.selectAll");
        sheet.querySelector(".arr-colf-list").innerHTML = shown.length ? shown.map(x => `
            <label class="arr-colf-item">
                <input type="checkbox" data-v="${esc(x.v)}" ${cur.checked.has(x.v) ? "checked" : ""}>
                <span class="arr-colf-v${x.v ? "" : " blank"}">${esc(x.v || t("arrears.colf.blank"))}</span>
                <small>${x.n.toLocaleString()}</small>
            </label>`).join("") : `<div class="arr-colf-none">${esc(t("arrears.colf.none"))}</div>`;
        sheet.querySelector(".arr-colf-more").textContent =
            vis.length > MAX_LIST ? t("arrears.colf.more", { n: (vis.length - MAX_LIST).toLocaleString() }) : "";
        syncAll();
    }

    function open(th) {
        ensureSheet();
        const key = th.dataset.sortKey;
        const table = th.closest("#arrCifHeadRow") ? "cif" : "ld";
        const base = typeof arrearsBaseRows !== "undefined" ? arrearsBaseRows : [];
        const counts = new Map();
        base.forEach(r => {
            if (!match(r, key)) return;
            const v = valueOf(r, key);
            counts.set(v, (counts.get(v) || 0) + 1);
        });
        // Values still kept by this filter but absent now stay listed (ticked).
        const active = filters.get(key);
        if (active) active.forEach(v => { if (!counts.has(v)) counts.set(v, 0); });
        const type = th.dataset.sortType || "text";
        const all = sortValues([...counts.keys()], type).map(v => ({ v, n: counts.get(v) }));
        cur = {
            key, type, table, all, q: "",
            label: th.firstChild ? th.textContent.trim() : key,
            checked: new Set(active ? [...active] : all.map(x => x.v))
        };
        sheet.querySelector(".arr-colf-title").textContent = cur.label;
        sheet.querySelector('[data-colf-sort="1"]').textContent = t(type === "text" ? "arrears.colf.sortAZ" : "arrears.colf.sortAsc");
        sheet.querySelector('[data-colf-sort="-1"]').textContent = t(type === "text" ? "arrears.colf.sortZA" : "arrears.colf.sortDesc");
        sheet.querySelector(".arr-colf-clear").textContent = t("arrears.colf.clear");
        sheet.querySelector(".arr-colf-clear").disabled = !active;
        sheet.querySelector(".arr-colf-ok").textContent = t("arrears.colf.ok");
        const search = sheet.querySelector(".arr-colf-search");
        search.value = "";
        search.placeholder = t("arrears.colf.search");
        renderList();
        sheet.hidden = false;
        document.body.classList.add("arr-colf-open");
    }

    function close() {
        if (!sheet) return;
        sheet.hidden = true;
        document.body.classList.remove("arr-colf-open");
    }

    function apply() {
        save();
        close();
        decorateHeaders();
        const run = () => { if (typeof applyFilters === "function") applyFilters(); };
        if (typeof runWithLoading === "function") runWithLoading(run, t("common.loading")); else run();
    }

    // Header button clicks (the headers' own click sorts — arrears.js
    // ignores clicks that land on the button).
    document.addEventListener("click", e => {
        const btn = e.target.closest(".arr-colf-btn");
        if (!btn) return;
        e.preventDefault();
        open(btn.closest("th"));
    });

    window.addEventListener("cm-language-changed", decorateHeaders);
    decorateHeaders();
    // Translated headers (data-i18n) get their text replaced after load,
    // which drops the button: put it back whenever one goes missing.
    const missing = () => document.querySelector(
        "#arrearsHeadRow th[data-sort-key]:not(:has(.arr-colf-btn)), #arrCifHeadRow th[data-sort-key]:not(:has(.arr-colf-btn))");
    const watch = new MutationObserver(() => { if (missing()) decorateHeaders(); });
    ["arrearsHeadRow", "arrCifHeadRow"].forEach(id => {
        const row = document.getElementById(id);
        if (row) watch.observe(row, { childList: true, subtree: true, characterData: true });
    });

    window.ArrColFilter = {
        match,
        valueOf,
        active: () => [...filters.keys()],
        label: key => {
            const th = document.querySelector(`#arrearsHeadRow th[data-sort-key="${key}"], #arrCifHeadRow th[data-sort-key="${key}"]`);
            return th ? th.textContent.trim() : key;
        },
        values: key => [...(filters.get(key) || [])],
        remove(key) { filters.delete(key); save(); decorateHeaders(); },
        clear() { filters = new Map(); save(); decorateHeaders(); },
        refresh: decorateHeaders
    };
})();
