// ========================================
// Credit Portfolio Intelligence — shared filter context
// Every module page (Overview, NPL Intelligence, Risk Intelligence)
// mounts the same filter card, data-as-of line and module switcher from
// here, so the filters mean the same thing everywhere and follow the
// user from one module to the next: they live in the address bar
// (replaceState, so Back returns to the same view) and in sessionStorage
// (so opening another module keeps them). The server enforces scope; the
// locks here only mirror it.
//
//   CI.mountFilters({ onChange })    filter card into #ciFilters
//   CI.query()                       URLSearchParams of the filters
//   CI.fillOptions(options, scope, period)
//   CI.renderAsOf(el, data)          data-as-of + comparison line
//   CI.mountNav(current)             module switcher into #ciNav
//   CI.get(path, params)             GET an /api/credit-intelligence/* body
// ========================================

(function () {
    const t = (k, v) => (window.CMI18n ? CMI18n.t(k, v) : k);
    const token = () => localStorage.getItem("token") || sessionStorage.getItem("token");
    const MULTI = { ciBranch: "branch", ciOfficer: "officer", ciProduct: "product", ciDistrict: "district" };
    const FOCUS = ["ciOfficer", "ciProduct", "ciDistrict"];
    const KEYS = ["fromDate", "toDate", "compare", "compareDate", "branch", "officer", "product", "district"];
    const STORE = "ci_filters";

    const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const num = n => (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
    const money = n => (Number(n) < 0 ? "−$" : "$") + num(Math.abs(Number(n) || 0));
    const pct = (n, d = 2) => (n === null || n === undefined ? "—" : ((Number(n) || 0) * 100).toFixed(d) + "%");
    const signedPct = (n, d = 1) => (n === null || n === undefined ? "—" : `${n >= 0 ? "+" : ""}${(n * 100).toFixed(d)}%`);
    const pts = n => (n === null || n === undefined ? "—" : `${n >= 0 ? "+" : ""}${(n * 100).toFixed(2)} ${t("creditreport.pi.pts")}`);
    const dmy = k => {
        if (!k) return "—";
        const [y, m, d] = String(k).split("-");
        return `${d}/${m}/${y}`;
    };
    const short = k => {
        const [y, m, d] = String(k).split("-");
        return `${d}/${m}/${y.slice(2)}`;
    };

    let onChange = () => {};
    let pending = {};
    let scope = null;
    let debounce = null;

    function picks(id) {
        const el = document.getElementById(id);
        return el && window.MultiSelect && el._msBtn ? MultiSelect.values(el) : [];
    }

    // URL first; else what the last module used in this session.
    function initialParams() {
        const url = new URLSearchParams(location.search);
        if (KEYS.some(k => url.has(k))) return url;
        try {
            return new URLSearchParams(sessionStorage.getItem(STORE) || "");
        } catch (e) {
            return new URLSearchParams();
        }
    }

    function query() {
        const p = new URLSearchParams();
        // Before the card is mounted (module switcher first) nothing is set.
        const v = id => (document.getElementById(id) || {}).value || "";
        if (v("ciFrom")) p.set("fromDate", v("ciFrom"));
        if (v("ciTo")) p.set("toDate", v("ciTo"));
        p.set("compare", v("ciCompare") || "month");
        if (v("ciCompare") === "date" && v("ciCompareDate")) p.set("compareDate", v("ciCompareDate"));
        Object.entries(MULTI).forEach(([id, key]) => {
            const vals = picks(id).length ? picks(id) : (pending[id] || []);
            vals.forEach(x => p.append(key, x));
        });
        return p;
    }

    // Keeps the address bar, the session and the module links in step.
    function persist() {
        const q = query();
        const keep = new URLSearchParams(location.search);
        KEYS.forEach(k => keep.delete(k));
        for (const [k, v] of q) keep.append(k, v);
        history.replaceState(null, "", `${location.pathname}?${keep.toString()}`);
        try { sessionStorage.setItem(STORE, q.toString()); } catch (e) { /* private mode */ }
        updateNav();
    }

    function changed() {
        clearTimeout(debounce);
        debounce = setTimeout(() => { persist(); onChange(); }, 250);
    }

    function setDisabled(id, on) {
        const el = document.getElementById(id);
        el.disabled = on;
        if (el._msBtn) el._msBtn.disabled = on;
        el.closest(".pi-field").classList.toggle("is-disabled", on);
    }

    // One of Officer / Product / District at a time.
    function focusLock() {
        if (scope && scope.type === "officer") return;
        const active = FOCUS.find(id => picks(id).length || (pending[id] || []).length);
        FOCUS.forEach(id => setDisabled(id, !!active && id !== active));
    }

    function fillSelect(id, items) {
        const el = document.getElementById(id);
        const keep = (pending[id] || []).length ? pending[id] : picks(id);
        const all = el.options[0];
        el.innerHTML = "";
        el.appendChild(all);
        items.forEach(({ value, label }) => {
            const o = document.createElement("option");
            o.value = value;
            o.textContent = label;
            el.appendChild(o);
        });
        const have = new Set(items.map(i => i.value));
        if (window.MultiSelect && el._msBtn) MultiSelect.setValues(el, keep.filter(v => have.has(v)));
        pending[id] = [];
    }

    function fillOptions(opt, sc, period) {
        scope = sc || null;
        opt = opt || {};
        fillSelect("ciBranch", (opt.branches || []).map(b => ({ value: b, label: b })));
        fillSelect("ciOfficer", (opt.officers || []).map(o => ({ value: o.id, label: `${o.name || o.id} · ${o.branch}` })));
        fillSelect("ciProduct", (opt.products || []).map(p => ({ value: p, label: p })));
        fillSelect("ciDistrict", (opt.districts || []).map(d => ({ value: d, label: d })));
        setDisabled("ciBranch", !!scope && scope.type !== "all");
        FOCUS.forEach(id => setDisabled(id, !!scope && scope.type === "officer"));
        focusLock();
        if (period) {
            if (!document.getElementById("ciFrom").value) document.getElementById("ciFrom").value = period.fromDate || "";
            if (!document.getElementById("ciTo").value) document.getElementById("ciTo").value = period.toDate || "";
        }
        persist();
    }

    function mountFilters(opts) {
        onChange = opts.onChange || onChange;
        const box = document.getElementById("ciFilters");
        box.className = "pi-card pi-filters";
        box.innerHTML = `
<div class="pi-filters-head">
<h2 class="pi-card-title">${esc(t("creditreport.pi.filters"))}</h2>
<button type="button" class="pi-btn-ghost" id="ciReset">${esc(t("creditreport.pi.reset"))}</button>
</div>
<div class="pi-filter-grid">
<label class="pi-field"><span>${esc(t("creditreport.pi.fromDate"))}</span><input type="date" id="ciFrom"></label>
<label class="pi-field"><span>${esc(t("creditreport.pi.toDate"))}</span><input type="date" id="ciTo"></label>
<label class="pi-field"><span>${esc(t("creditreport.pi.compare"))}</span>
<select id="ciCompare">
<option value="month">${esc(t("creditreport.pi.compareMonth"))}</option>
<option value="prev">${esc(t("creditreport.pi.comparePrev"))}</option>
<option value="year">${esc(t("creditreport.pi.compareYear"))}</option>
<option value="date">${esc(t("creditreport.pi.compareDate"))}</option>
</select></label>
<label class="pi-field" id="ciCompareDateWrap" hidden><span>${esc(t("creditreport.pi.compareOn"))}</span><input type="date" id="ciCompareDate"></label>
<label class="pi-field"><span>${esc(t("creditreport.pi.branch"))}</span><select id="ciBranch"><option value="">${esc(t("creditreport.pi.allBranches"))}</option></select></label>
<label class="pi-field"><span>${esc(t("creditreport.pi.officer"))}</span><select id="ciOfficer"><option value="">${esc(t("creditreport.pi.allOfficers"))}</option></select></label>
<label class="pi-field"><span>${esc(t("creditreport.pi.product"))}</span><select id="ciProduct"><option value="">${esc(t("creditreport.pi.allProducts"))}</option></select></label>
<label class="pi-field"><span>${esc(t("creditreport.pi.district"))}</span><select id="ciDistrict"><option value="">${esc(t("creditreport.pi.allDistricts"))}</option></select></label>
</div>
<p class="pi-note">${esc(t("creditreport.pi.focusNote"))}</p>`;

        const p = initialParams();
        if (p.get("fromDate")) document.getElementById("ciFrom").value = p.get("fromDate");
        if (p.get("toDate")) document.getElementById("ciTo").value = p.get("toDate");
        if (p.get("compare")) document.getElementById("ciCompare").value = p.get("compare");
        if (p.get("compareDate")) document.getElementById("ciCompareDate").value = p.get("compareDate");
        Object.entries(MULTI).forEach(([id, key]) => { pending[id] = p.getAll(key).filter(Boolean); });

        if (window.MultiSelect) Object.keys(MULTI).forEach(id => MultiSelect.enhance(document.getElementById(id), { copyClass: true }));
        const cmp = document.getElementById("ciCompare");
        const syncCmp = () => { document.getElementById("ciCompareDateWrap").hidden = cmp.value !== "date"; };
        syncCmp();
        cmp.addEventListener("change", () => { syncCmp(); if (cmp.value !== "date" || document.getElementById("ciCompareDate").value) changed(); });
        ["ciFrom", "ciTo", "ciCompareDate"].forEach(id => document.getElementById(id).addEventListener("change", changed));
        Object.keys(MULTI).forEach(id => document.getElementById(id).addEventListener("change", () => {
            pending[id] = [];
            if (FOCUS.includes(id)) focusLock();
            changed();
        }));
        document.getElementById("ciReset").addEventListener("click", () => {
            ["ciFrom", "ciTo", "ciCompareDate"].forEach(id => { document.getElementById(id).value = ""; });
            cmp.value = "month";
            syncCmp();
            Object.keys(MULTI).forEach(id => {
                pending[id] = [];
                const el = document.getElementById(id);
                if (window.MultiSelect && el._msBtn) MultiSelect.setValues(el, []);
            });
            focusLock();
            persist();
            onChange();
        });
        persist();
    }

    // ---------- module switcher ----------
    const MODULES = [
        { key: "overview", href: "PortfolioIntelligence.html", label: "creditreport.ci.navOverview" },
        { key: "npl", href: "NplIntelligence.html", label: "creditreport.ci.navNpl" },
        { key: "contributors", href: "RiskIntelligence.html?view=contributors", label: "creditreport.ci.navContributors" },
        { key: "quality", href: "RiskIntelligence.html?view=quality", label: "creditreport.ci.navQuality" },
        { key: "growth", href: "RiskIntelligence.html?view=growth", label: "creditreport.ci.navGrowth" }
    ];
    let navCurrent = null;

    function mountNav(current) {
        navCurrent = current;
        const box = document.getElementById("ciNav");
        if (!box) return;
        box.className = "ci-nav";
        box.setAttribute("aria-label", t("creditreport.ci.modules"));
        box.innerHTML = MODULES.map(m =>
            `<a class="ci-nav-link${m.key === current ? " is-active" : ""}" data-key="${m.key}" data-base="${m.href}"${m.key === current ? ' aria-current="page"' : ""}>${esc(t(m.label))}</a>`
        ).join("");
        updateNav();
        const active = box.querySelector(".is-active");
        if (active && active.scrollIntoView) active.scrollIntoView({ block: "nearest", inline: "center" });
    }

    function updateNav() {
        const q = query().toString();
        document.querySelectorAll("#ciNav .ci-nav-link").forEach(a => {
            const base = a.dataset.base;
            a.href = q ? `${base}${base.includes("?") ? "&" : "?"}${q}` : base;
        });
    }

    // ---------- data-as-of ----------
    function renderAsOf(el, d) {
        const a = d.asOf;
        if (!a) { el.innerHTML = ""; return; }
        const c = d.comparison;
        const status = a.outdated
            ? `<span class="pi-badge pi-badge-bad"><span aria-hidden="true">⚠</span> ${esc(t("creditreport.pi.outdated", { days: a.businessDaysBehind }))}</span>`
            : `<span class="pi-badge pi-badge-good"><span aria-hidden="true">✓</span> ${esc(t("creditreport.pi.upToDate"))}</span>`;
        const cmp = !c ? "" : c.available
            ? t("creditreport.pi.comparedWith", { date: dmy(c.date) })
            : t(`creditreport.pi.cmpReason.${c.reason || "no_snapshot"}`);
        el.innerHTML = `
        <div class="pi-asof-row">
            <span class="pi-asof-label">${esc(t("creditreport.pi.dataAsOf"))}</span>
            <strong>${esc(dmy(a.osDate))}</strong>
            ${status}
        </div>
        <div class="pi-asof-sources">
            <span>${esc(t("creditreport.pi.srcOs"))}: ${esc(a.osText)}</span>
            <span>${esc(t("creditreport.pi.srcOverdue"))}: ${esc(a.overdueText)}</span>
        </div>
        <div class="pi-asof-cmp">${esc(t("creditreport.pi.period", { from: dmy(d.period && d.period.fromDate), to: dmy(d.period && d.period.toDate) }))}${cmp ? ` · ${esc(cmp)}` : ""}</div>`;
    }

    // ---------- fetch ----------
    let seq = 0;
    async function get(path, extra) {
        const mine = ++seq;
        const q = query();
        Object.entries(extra || {}).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== "") q.set(k, v); });
        if (typeof showAppLoading === "function") showAppLoading(t("creditreport.pi.loading"), { progress: true, key: `ci-${path}` });
        try {
            const res = await fetch(`${API.BASE_URL}/api/credit-intelligence/${path}?${q.toString()}`, {
                headers: { Authorization: `Bearer ${token()}` }
            });
            const data = await res.json();
            if (mine !== seq) return null;
            if (!data.ok) {
                toast(data.code === "focus_conflict" ? t("creditreport.pi.focusNote") : (data.message || t("creditreport.pi.loadFailed")), "error");
                return null;
            }
            return data;
        } catch (e) {
            console.error(e);
            if (mine === seq) toast(t("creditreport.pi.loadFailed"), "error");
            return null;
        } finally {
            if (mine === seq && typeof hideAppLoading === "function") hideAppLoading();
        }
    }

    function toast(message, type) {
        if (typeof CMToast !== "undefined" && typeof CMToast.show === "function") {
            CMToast.show({ type, title: message, message: "", duration: 3500 });
        }
    }

    // Validated (dataviz palette check) per surface: navy + gold steps
    // that keep 3:1 contrast and stay apart for colour-blind readers.
    function chartColors() {
        const dark = ["dark", "darkgray"].includes(document.documentElement.getAttribute("data-theme"));
        const css = getComputedStyle(document.documentElement);
        return dark
            ? { a: "#4C7FD9", b: "#B8891A", good: "#4ADE80", bad: "#F87171", grid: "rgba(255,255,255,.08)", text: css.getPropertyValue("--cr-text-muted").trim() || "#8FA0C7", surface: css.getPropertyValue("--cr-card-bg").trim() || "#131C2E" }
            : { a: "#2456A8", b: "#B8860B", good: "#15803D", bad: "#B91C1C", grid: "rgba(0,0,0,.06)", text: css.getPropertyValue("--cr-text-muted").trim() || "#6B7280", surface: css.getPropertyValue("--cr-card-bg").trim() || "#FFFFFF" };
    }

    window.CI = {
        t, esc, num, money, pct, signedPct, pts, dmy, short,
        mountFilters, query, fillOptions, renderAsOf, mountNav, get, toast, chartColors,
        scope: () => scope
    };
})();
