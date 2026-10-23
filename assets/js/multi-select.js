// ========================================
// Multi-select for a plain <select>
// MultiSelect.enhance(select) turns a filter <select> (first option
// value "" = All) into a button that opens a checklist sheet: pick any
// number of values, search long lists, Select all / Clear, OK. The
// <select> stays in the page (hidden, `multiple`) as the source of
// truth, so code that fills its options keeps working; read the picks
// with MultiSelect.values(select). OK fires the select's "change".
// ========================================

(function () {
    const tr = (key, vars) => (window.CMI18n ? CMI18n.t(key, vars) : key);
    const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const SEARCH_FROM = 8; // show the search box for lists longer than this

    const values = el => [...el.options].filter(o => o.selected && o.value !== "").map(o => o.value);

    function setValues(el, vals) {
        const want = new Set((vals || []).map(String));
        let any = false;
        [...el.options].forEach(o => {
            o.selected = o.value !== "" && want.has(o.value);
            if (o.selected) any = true;
        });
        // Nothing picked = the "All" option, so el.value reads "" as before.
        const all = [...el.options].find(o => o.value === "");
        if (all) all.selected = !any;
        sync(el);
    }

    function label(el) {
        const picked = [...el.options].filter(o => o.selected && o.value !== "");
        if (!picked.length) {
            const all = [...el.options].find(o => o.value === "");
            return { text: all ? all.textContent : tr("ms.all"), more: "", n: 0 };
        }
        return { text: picked[0].textContent, more: picked.length > 1 ? `+${picked.length - 1}` : "", n: picked.length };
    }

    function sync(el) {
        const btn = el._msBtn;
        if (!btn) return;
        const { text, more, n } = label(el);
        btn.querySelector(".ms-text").textContent = text;
        btn.querySelector(".ms-more").textContent = more;
        btn.classList.toggle("ms-on", n > 0);
        btn.title = values(el).join(", ");
    }

    // ---------- the sheet (one, shared) ----------
    let sheet = null;
    let current = null;     // the <select> being edited
    let picked = null;      // Set of values ticked in the sheet

    function buildSheet() {
        sheet = document.createElement("div");
        sheet.className = "ms-dim";
        sheet.hidden = true;
        sheet.innerHTML = `
<div class="ms-sheet" role="dialog" aria-modal="true" aria-labelledby="msTitle">
  <div class="ms-head">
    <div class="ms-title" id="msTitle">-</div>
    <button type="button" class="ms-x" data-ms-close aria-label="Close">×</button>
  </div>
  <div class="ms-search" hidden><input type="search" class="ms-q" autocomplete="off"></div>
  <div class="ms-tools">
    <span class="ms-count"></span>
    <button type="button" class="ms-link" data-ms="all"></button>
    <button type="button" class="ms-link" data-ms="none"></button>
  </div>
  <div class="ms-list" role="listbox" aria-multiselectable="true"></div>
  <div class="ms-foot"><button type="button" class="ms-ok" data-ms="ok"></button></div>
</div>`;
        document.body.appendChild(sheet);
        sheet.addEventListener("click", e => {
            if (e.target === sheet || e.target.closest("[data-ms-close]")) return close();
            const row = e.target.closest(".ms-item");
            if (row) {
                const v = row.dataset.v;
                if (picked.has(v)) picked.delete(v); else picked.add(v);
                row.classList.toggle("on", picked.has(v));
                row.setAttribute("aria-selected", picked.has(v) ? "true" : "false");
                paintCount();
                return;
            }
            const act = e.target.closest("[data-ms]")?.dataset.ms;
            if (act === "all") { visibleItems().forEach(r => picked.add(r.dataset.v)); paintList(); }
            if (act === "none") { picked.clear(); paintList(); }
            if (act === "ok") apply();
        });
        sheet.querySelector(".ms-q").addEventListener("input", paintList);
        document.addEventListener("keydown", e => { if (e.key === "Escape" && sheet && !sheet.hidden) close(); });
    }

    const visibleItems = () => [...sheet.querySelectorAll(".ms-item")];

    function paintCount() {
        sheet.querySelector(".ms-count").textContent = picked.size ? tr("ms.selectedN", { n: picked.size }) : tr("ms.noneMeansAll");
        sheet.querySelector(".ms-ok").textContent = picked.size ? `${tr("ms.ok")} (${picked.size})` : tr("ms.ok");
    }

    function paintList() {
        const q = sheet.querySelector(".ms-q").value.trim().toLowerCase();
        const opts = [...current.options].filter(o => o.value !== "" && (!q || o.textContent.toLowerCase().includes(q)));
        sheet.querySelector(".ms-list").innerHTML = opts.length
            ? opts.map(o => {
                const on = picked.has(o.value);
                return `<button type="button" class="ms-item${on ? " on" : ""}" role="option" aria-selected="${on}" data-v="${esc(o.value)}"><span class="ms-box" aria-hidden="true"></span><span>${esc(o.textContent)}</span></button>`;
            }).join("")
            : `<div class="ms-empty">${esc(tr("ms.noMatch"))}</div>`;
        paintCount();
    }

    function open(el) {
        if (!sheet) buildSheet();
        current = el;
        picked = new Set(values(el));
        sheet.querySelector("#msTitle").textContent = el._msLabel ? el._msLabel.textContent.trim() : "";
        const q = sheet.querySelector(".ms-q");
        q.value = "";
        q.placeholder = tr("ms.search");
        sheet.querySelector(".ms-search").hidden = el.options.length - 1 <= SEARCH_FROM;
        sheet.querySelector('[data-ms="all"]').textContent = tr("ms.selectAll");
        sheet.querySelector('[data-ms="none"]').textContent = tr("ms.clear");
        paintList();
        sheet.hidden = false;
        document.body.classList.add("ms-open");
    }

    function close() {
        sheet.hidden = true;
        document.body.classList.remove("ms-open");
        current = null;
    }

    function apply() {
        const el = current;
        const before = values(el).join("\u0001");
        setValues(el, [...picked]);
        close();
        if (values(el).join("\u0001") !== before) el.dispatchEvent(new Event("change", { bubbles: true }));
    }

    function enhance(el) {
        if (!el || el._msBtn) return;
        el.multiple = true;
        el.classList.add("ms-native");
        el.tabIndex = -1;
        el.setAttribute("aria-hidden", "true");
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "ms-btn";
        btn.innerHTML = `<span class="ms-text"></span><span class="ms-more"></span><span class="ms-caret" aria-hidden="true"></span>`;
        btn.addEventListener("click", () => open(el));
        el.after(btn);
        el._msBtn = btn;
        if (el.id) {
            btn.id = `${el.id}Btn`;
            const lab = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
            if (lab) { lab.htmlFor = btn.id; el._msLabel = lab; }
        }
        setValues(el, values(el));
        // Options rebuilt or relabelled (data reload, language change).
        new MutationObserver(() => sync(el)).observe(el, { childList: true, subtree: true, characterData: true });
    }

    window.addEventListener("cm-language-changed", () => {
        document.querySelectorAll("select.ms-native").forEach(sync);
    });

    window.MultiSelect = { enhance, values, setValues, sync };
})();
