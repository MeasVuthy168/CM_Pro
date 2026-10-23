// ========================================
// Credit Report — multi-select filters
// Every filter on the Daily Monitoring pages (by Officer / Branch /
// Product / Location) picks several values (assets/js/multi-select.js),
// except "Showing" (crSection), which picks one section. The <select>
// stays the source of truth: its "All" option is the one marked
// data-ms-all (or value ""), so until several values are picked its
// .value still reads what the page's code always read.
//
//   crMultiEnhance(ids)        turn the filters into multi-selects
//   crPicks(id)                the picked values ([] = All)
//   crAddPicks(params, key, id) one ?key=value per pick (URLSearchParams)
//   crRestorePicks(id, values) put picks back (from the URL), once the
//                              options exist; returns the ones not found
// ========================================

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
