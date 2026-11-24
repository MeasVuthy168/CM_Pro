// ========================================
// Credit Report — multi-select filters
// Every filter on the Daily Monitoring pages (by Officer / Branch /
// Product / Location) picks several values (assets/js/multi-select.js),
// "Showing" (crSection) included. The <select> stays the source of
// truth: its "All" option is the one marked data-ms-all (or value ""),
// so until several values are picked its .value still reads what the
// page's code always read.
//
//   crMultiEnhance(ids)        turn the filters into multi-selects
//   crPicks(id)                the picked values ([] = All)
//   crAddPicks(params, key, id) one ?key=value per pick (URLSearchParams)
//   crRestorePicks(id, values) put picks back (from the URL), once the
//                              options exist; returns the ones not found
//
// Showing (crSection):
//   crSectionKeys()            the picked sections, in list order ([] = All)
//   crHasSection(...keys)      is any of these sections on screen
//   crCombinedSection(build)   one table from every picked section:
//                              build(key) gives each one's groups, side by
//                              side in list order; none picked = "all"
// ========================================

// ========================================
// NBC Overdue — Non Performing Loan items (approved 23/11/2026)
// Loan Class "Non Performing Loan" shows up to three groups, picked in
// the sub-filter #crNplItems (shown only while that class is picked;
// All = the three):
//   nplPct     NPL % — ceiling (the class's own group)
//   nplYtd     NPL Collect YTD          ({prefix}.ytd.ld/cif/value)
//   nplPeriod  NPL Collect This Period  ({prefix}.period.ld/cif/value)
// Days saved before the columns existed carry no figures: "—".
// ========================================
const CR_NPL_ITEMS = ["nplPct", "nplYtd", "nplPeriod"];

function crNplItems() {
    if (!crPicks("crNbcClass").includes("nonPerformingLoan")) return CR_NPL_ITEMS;
    const picks = crPicks("crNplItems").filter(v => CR_NPL_ITEMS.includes(v));
    return picks.length ? picks : CR_NPL_ITEMS;
}

// nplGroup: the NPL % group; prefix: the rows' field (nplCollect /
// nplCollectOwn / nplCollectArea); labelOf: the group label from an i18n
// key (by Officer adds _Own / _Area).
function crNplGroups(nplGroup, prefix, labelOf = k => t(k)) {
    const items = crNplItems();
    const groups = {
        nplPct: nplGroup,
        nplYtd: {
            label: labelOf("creditreport.mr.k.nplCollected"),
            fields: [
                { key: `${prefix}.ytd.ld`, label: "#LD" },
                { key: `${prefix}.ytd.cif`, label: "#CIF" },
                { key: `${prefix}.ytd.value`, label: t("creditreport.detail.colValue"), money: true }
            ]
        },
        nplPeriod: {
            label: labelOf("creditreport.mr.k.nplPeriod"),
            fields: [
                { key: `${prefix}.period.ld`, label: "#LD" },
                { key: `${prefix}.period.cif`, label: "#CIF" },
                { key: `${prefix}.period.value`, label: t("creditreport.detail.colValue"), money: true }
            ]
        }
    };
    return CR_NPL_ITEMS.filter(i => items.includes(i)).map(i => groups[i]);
}

// The NBC section's groups for the picked classes (All = every class),
// the NPL class expanded into its picked items.
function crNbcGroups(section, prefix, labelOf) {
    const picked = crPicks("crNbcClass").map(v => CR_NBC_CLASS_INDEX[v]).filter(i => i !== undefined);
    const idxs = picked.length ? picked.sort((a, b) => a - b) : section.groups.map((_, i) => i);
    return {
        groups: idxs.flatMap(i => i === CR_NBC_CLASS_INDEX.nonPerformingLoan
            ? crNplGroups(section.groups[i], prefix, labelOf)
            : [section.groups[i]])
    };
}

// Show the sub-filter only while the Loan Class row is on screen with
// "Non Performing Loan" picked.
function crNplSyncRow() {
    const row = document.getElementById("crNplItemsRow");
    const cls = document.getElementById("crNbcClassRow");
    if (!row) return;
    row.style.display = cls && cls.style.display !== "none" && crPicks("crNbcClass").includes("nonPerformingLoan") ? "" : "none";
}

// ========================================
// Data dates, compact (UX phase 1, approved 24/11/2026): the five-row
// "Loan Disbursement from / Write Off from / NBC OS / NBC Overdue /
// Payment in Arrears" box becomes one line — NBC OS · NBC Overdue · T24
// — like Credit Portfolio's; "Details" opens the full box. The
// disbursement / write-off periods also stay in the report's own heading.
// The T24 (penalty) row hides while it has no date.
// ========================================
function crInfoCompact() {
    const block = document.querySelector(".filter-card .cr-info-block");
    if (!block || block.dataset.compact) return;
    block.dataset.compact = "1";
    // Removed from the page (owner, 24/11/2026): the data dates show on
    // the hub and in the table's own heading (As of …, Disburse …,
    // Write Off …, T24 …). The box stays in the page, hidden, as the
    // reports still fill its fields.
    block.hidden = true;
    return;
    const val = id => { const el = document.getElementById(id); return el ? el.textContent.trim() : ""; };
    const has = v => v && v !== "-";
    const esc = s => String(s).replace(/[<>&]/g, "");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cr-info-sum";
    btn.setAttribute("aria-expanded", "false");
    block.before(btn);
    let open = false;
    const draw = () => {
        const item = (label, v) => (has(v) ? `<span class="cr-info-sum-item">${esc(label)} <b>${esc(v)}</b></span>` : "");
        btn.innerHTML = `<span class="cr-info-sum-items">${item(t("creditreport.ci.dataOs"), val("crOsGridMerge"))}${item(t("creditreport.ci.dataOd"), val("crOverdueGridMerge"))}${item("T24", val("crArrearsPenalty"))}</span>` +
            `<span class="cr-info-sum-more">${esc(t(open ? "creditreport.detail.hideDetails" : "creditreport.detail.showDetails"))} <span aria-hidden="true">${open ? "▴" : "▾"}</span></span>`;
        const pen = document.getElementById("crArrearsPenalty");
        const row = pen && pen.closest(".cr-info-row");
        if (row) row.hidden = !has(val("crArrearsPenalty"));
    };
    const set = o => { open = o; block.hidden = !o; btn.setAttribute("aria-expanded", String(o)); draw(); };
    btn.addEventListener("click", () => set(!open));
    new MutationObserver(draw).observe(block, { childList: true, subtree: true, characterData: true });
    set(false);
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", crInfoCompact); else crInfoCompact();

// ========================================
// Reset filters (owner, 24/11/2026): once anything differs from the
// defaults — a filter, a Comparison, Showing or a chosen day — a
// "Reset filters" button shows at the foot of the filter card; it clears
// them all (the URL and the chosen-day state) and reloads the report
// with its defaults: latest data, All Sections, Actual Only.
// ========================================
function crResetFilters() {
    const card = document.querySelector(".filter-card");
    if (!card || document.getElementById("crResetFilters")) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.id = "crResetFilters";
    btn.className = "cr-reset-btn";
    btn.hidden = true;
    btn.innerHTML = `<span aria-hidden="true">↺</span> <span data-i18n="creditreport.detail.resetFilters">${t("creditreport.detail.resetFilters")}</span>`;
    card.appendChild(btn);
    const savedKey = `cr_saved|${location.pathname}`;
    const changed = () => {
        let base = false;
        try { base = !!(JSON.parse(sessionStorage.getItem(savedKey) || "{}") || {}).baseOn; } catch (e) { /* private mode */ }
        // Defaults the pages also write to the URL don't count.
        const q = new URLSearchParams(location.search);
        const off = [...q.entries()].filter(([k, v]) => v && !(k === "section" && v === "all") && !(k === "compare" && v === "actual"));
        return off.length > 0 || base;
    };
    const sync = () => { btn.hidden = !changed(); };
    // The pages write their filters to the URL right after a change.
    card.addEventListener("change", () => setTimeout(sync, 300), true);
    card.addEventListener("click", () => setTimeout(sync, 300), true);
    setTimeout(sync, 1500);
    btn.addEventListener("click", () => {
        try { sessionStorage.removeItem(savedKey); } catch (e) { /* private mode */ }
        location.replace(location.pathname);
    });
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", crResetFilters); else crResetFilters();

// ========================================
// Section colours (owner, 24/11/2026): each section's header its own
// colour, same order as the Excel export (cr-export-all.js) — Plan /
// Last Month lanes keep their own colours (only the top section row is
// coloured then). Runs after every render of the report's tables.
// ========================================
const CR_SECTION_COLORS = ["#1F3A5F", "#0F6E6E", "#5B3A8C", "#8A5A12", "#2E6B3A", "#8C2F39", "#275D9E", "#5C6B1F", "#7B2D63", "#3F4E5E"];
function crColorSections(table) {
    const thead = table && table.tHead;
    if (!thead) return;
    const rows = [...thead.rows];
    if (!rows.length) return;
    const total = rows.length;
    const top = rows[0];
    const lead = [...top.cells].filter(c => (c.rowSpan || 1) >= total);
    const leadCols = lead.reduce((n, c) => n + (c.colSpan || 1), 0);
    // top row: one cell per section
    const spans = [];
    let col = leadCols;
    [...top.cells].filter(c => !lead.includes(c)).forEach((c, i) => {
        const color = CR_SECTION_COLORS[i % CR_SECTION_COLORS.length];
        c.style.background = color; c.style.color = "#FFFFFF";
        spans.push({ from: col, to: col + (c.colSpan || 1), color });
        col += c.colSpan || 1;
    });
    // a plain 2-row header (Actual Only): the field row too, a lighter shade
    if (total === 2) {
        let x = 0;
        [...rows[1].cells].forEach(c => {
            const at = leadCols + x;
            const s = spans.find(r => at >= r.from && at < r.to);
            if (s) { c.style.background = s.color + "D9"; c.style.color = "#FFFFFF"; }
            x += c.colSpan || 1;
        });
    }
}
function crColorSectionsWatch() {
    const card = document.querySelector(".table-card");
    if (!card) return;
    let pending = false;
    const run = () => { pending = false; card.querySelectorAll("table").forEach(crColorSections); };
    new MutationObserver(() => { if (!pending) { pending = true; requestAnimationFrame(run); } })
        .observe(card, { childList: true, subtree: true });
    run();
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", crColorSectionsWatch); else crColorSectionsWatch();

function crMultiEnhance(ids) {
    if (!window.MultiSelect) return;
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) MultiSelect.enhance(el, { copyClass: true });
    });
}

function crPicks(id) {
    const el = document.getElementById(id);
    if (!el) return [];
    if (window.MultiSelect && el._msBtn) return MultiSelect.values(el);
    const opt = el.options[el.selectedIndex];
    return opt && opt.value !== "" && !opt.hasAttribute("data-ms-all") ? [opt.value] : [];
}

function crAddPicks(params, key, id) {
    crPicks(id).forEach(v => params.append(key, v));
    return params;
}

function crRestorePicks(id, values) {
    const el = document.getElementById(id);
    const want = (values || []).filter(Boolean);
    if (!el || !want.length) return want;
    const have = new Set([...el.options].map(o => o.value));
    const found = want.filter(v => have.has(v));
    if (window.MultiSelect && el._msBtn) MultiSelect.setValues(el, found);
    else if (found.length) el.value = found[0];
    return want.filter(v => !have.has(v));
}

// ========================================
// Daily History search that keeps several picks (officers, products,
// locations) as chips under the search box: a picked suggestion — or
// text typed to an exact match — becomes a chip and the box clears for
// the next search; ✕ on a chip removes it. onChange runs after each.
//
//   const picker = crChipPicker({ row, keyOf, labelOf, onChange });
//   picker.add(item) / picker.list() / picker.key()
// ========================================
function crChipPicker({ row, keyOf, labelOf, onChange }) {
    const items = [];
    const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const box = document.createElement("div");
    box.className = "cr-chips";
    box.hidden = true;
    row.after(box);
    // Follows the search row in and out of view (History mode only).
    new MutationObserver(paint).observe(row, { attributes: true, attributeFilter: ["style", "hidden"] });

    function paint() {
        box.hidden = !items.length || row.style.display === "none" || row.hidden;
        box.innerHTML = items.map((it, i) =>
            `<span class="cr-chip"><span class="cr-chip-text">${esc(labelOf(it))}</span>` +
            `<button type="button" class="cr-chip-x" data-i="${i}" aria-label="✕">✕</button></span>`).join("");
    }
    box.addEventListener("click", e => {
        const x = e.target.closest(".cr-chip-x");
        if (!x) return;
        items.splice(Number(x.dataset.i), 1);
        paint();
        onChange();
    });
    return {
        list: () => items.slice(),
        key: () => items.map(keyOf).join("\u0001"),
        add(item) {
            if (!item || items.some(x => keyOf(x) === keyOf(item))) return;
            items.push(item);
            paint();
            onChange();
        }
    };
}

function crSectionKeys() {
    return crPicks("crSection");
}
function crHasSection(...keys) {
    const picked = crSectionKeys();
    return keys.some(k => picked.includes(k));
}
function crCombinedSection(build) {
    const keys = crSectionKeys();
    if (keys.length <= 1) return build(keys[0] || "all");
    return { groups: keys.flatMap(k => build(k).groups) };
}
// Section(s) from the URL: ?section=a&section=b (old links: one value,
// or "all").
function crRestoreSections(params, sections) {
    crRestorePicks("crSection", params.getAll("section").filter(k => k !== "all" && sections[k]));
}
function crAddSections(params) {
    const keys = crSectionKeys();
    if (!keys.length) params.set("section", "all");
    else keys.forEach(k => params.append("section", k));
    return params;
}
