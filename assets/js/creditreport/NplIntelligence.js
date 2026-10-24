// ========================================
// Credit Portfolio Intelligence — NPL Intelligence (Module 02)
// GET /api/credit-intelligence/npl: opening vs closing NPL loans from the
// account-level NPL history, the waterfall and its reconciliation, every
// account that moved, and the reasons officers documented. When the saved
// history doesn't cover the period the server says so and this page
// shows that instead of a figure.
// ========================================

const t = CI.t;
const NPL_PAGE = 50;
const NPL_STEP_TONE = { opening: "base", new: "bad", recovered: "good", balanceChange: null, closing: "base" };

let nplData = null;
let nplTab = "new";
let nplSort = { key: "change", dir: -1 };
let nplShown = NPL_PAGE;
let nplChart = null;
// Remembered on this device: officer side (Daily Report's _Area / _Own)
// and card / list view (cards by default on a phone).
const nplPref = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const nplSave = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } };
let nplSide = nplPref("ci_npl_side") === "area" ? "area" : "own";
let nplView = nplPref("ci_npl_view") || (window.matchMedia("(max-width: 719px)").matches ? "card" : "list");
const nplFilter = { branch: "", cls: "", product: "" };
// Sort choices for the card view (the table headers sort too).
const NPL_SORTS = [
    { id: "change_down", key: "change", dir: -1, label: "creditreport.list.sortChangeDown" },
    { id: "change_up", key: "change", dir: 1, label: "creditreport.list.sortChangeUp" },
    { id: "close_down", key: "closeBal", dir: -1, label: "creditreport.list.sortClosing" },
    { id: "open_down", key: "openBal", dir: -1, label: "creditreport.list.sortOpening" },
    { id: "day_down", key: "day", dir: -1, label: "creditreport.list.sortDays" },
    { id: "name_up", key: "name", dir: 1, label: "creditreport.list.sortName" }
];

function nplExitText(e) {
    return e ? t(`creditreport.npl.exit.${e}`) : "";
}

async function nplLoad() {
    const data = await CI.get("npl", { side: nplSide });
    if (!data) return;
    nplData = data;
    nplRender();
}

function nplRender() {
    const d = nplData;
    if (d.empty) {
        document.getElementById("nplUnavailable").hidden = false;
        document.getElementById("nplUnavailableText").textContent = t("creditreport.pi.noAccess");
        return;
    }
    CI.fillOptions(d.options, d.scope, d.period);
    CI.renderAsOf(document.getElementById("ciAsOf"), d);
    const m = d.movement;
    const off = document.getElementById("nplUnavailable");
    const content = document.getElementById("nplContent");
    if (!m.available) {
        off.hidden = false;
        content.hidden = true;
        document.getElementById("nplUnavailableText").textContent =
            t(`creditreport.npl.reason.${m.reason}`, { first: CI.dmy(m.firstSaved) });
        // Only useful once a later day than the first saved one exists.
        document.getElementById("nplSinceFirst").hidden = !(m.firstSaved && d.asOf && m.firstSaved < d.asOf.osDate);
        return;
    }
    off.hidden = true;
    content.hidden = false;
    document.getElementById("nplRange").textContent = t("creditreport.npl.range", {
        opening: CI.dmy(m.openingDate),
        closing: CI.dmy(m.closingDate) + (m.closingLive ? ` (${t("creditreport.npl.live")})` : "")
    });
    nplRenderWaterfall(m);
    nplRenderSteps(m);
    nplRenderTable();
    nplRenderWhy();
}

function nplStepLabel(step) {
    return t(`creditreport.npl.step.${step}`);
}

function nplRenderWaterfall(m) {
    if (nplChart) { nplChart.destroy(); nplChart = null; }
    if (typeof Chart === "undefined") return;
    const col = CI.chartColors();
    let run = 0;
    const bars = m.waterfall.map(w => {
        if (w.step === "opening" || w.step === "closing") {
            run = w.value;
            return { step: w.step, range: [0, w.value], value: w.value };
        }
        const from = run;
        run += w.value;
        return { step: w.step, range: [from, run], value: w.value };
    });
    const colorOf = b => {
        if (b.step === "opening" || b.step === "closing") return col.a;
        return b.value > 0 ? col.bad : col.good;
    };
    nplChart = new Chart(document.getElementById("nplWaterfall"), {
        type: "bar",
        data: {
            labels: bars.map(b => nplStepLabel(b.step)),
            datasets: [{
                data: bars.map(b => b.range),
                backgroundColor: bars.map(colorOf),
                borderRadius: 4,
                borderSkipped: false,
                maxBarThickness: 46
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: c => `${nplStepLabel(bars[c.dataIndex].step)}: ${CI.money(bars[c.dataIndex].value)}` } }
            },
            scales: {
                x: { grid: { display: false }, ticks: { color: col.text, font: { family: "KRASAR, sans-serif", size: 11 } } },
                y: { grid: { color: col.grid }, border: { display: false }, ticks: { color: col.text, callback: v => CI.money(v) } }
            }
        }
    });
}

function nplRenderSteps(m) {
    const tt = m.totals;
    const exits = Object.entries(tt.recovered.byExit || {})
        .map(([k, v]) => `${nplExitText(k)} ${v.count} · ${CI.money(v.bal)}`).join(" · ");
    const card = (step, value, count, sub, tone) => `
        <div class="ci-step ci-step-${tone || "base"}">
            <div class="pi-kpi-label">${CI.esc(nplStepLabel(step))}</div>
            <div class="ci-step-value">${CI.esc(step === "recovered" ? CI.money(-Math.abs(value)) : (step === "new" ? "+" : "") + CI.money(value))}</div>
            <div class="pi-kpi-sub">${CI.esc(t("creditreport.npl.accountsN", { n: CI.num(count) }))}${sub ? ` · ${CI.esc(sub)}` : ""}</div>
        </div>`;
    const bc = tt.balanceChange;
    document.getElementById("nplSteps").innerHTML =
        card("opening", tt.opening.bal, tt.opening.count, "", "base") +
        card("new", tt.new.bal, tt.new.count, "", "bad") +
        card("recovered", tt.recovered.bal, tt.recovered.count, exits, "good") +
        card("balanceChange", bc, tt.continuing.count, t("creditreport.npl.continuingN", { n: CI.num(tt.continuing.count) }), bc > 0 ? "bad" : bc < 0 ? "good" : "base") +
        card("closing", tt.closing.bal, tt.closing.count, "", "base");
    const r = tt.reconciliation;
    document.getElementById("nplRecon").innerHTML = r.ok
        ? `<span class="pi-badge pi-badge-good"><span aria-hidden="true">✓</span> ${CI.esc(t("creditreport.npl.reconOk"))}</span> ${CI.esc(t("creditreport.npl.reconFormula", { opening: CI.money(tt.opening.bal), add: CI.money(tt.new.bal), sub: CI.money(tt.recovered.bal), chg: CI.money(bc), closing: CI.money(tt.closing.bal) }))}`
        : `<span class="pi-badge pi-badge-bad"><span aria-hidden="true">⚠</span> ${CI.esc(t("creditreport.npl.reconBad", { diff: CI.money(r.diff) }))}</span>`;
}

// ---------- accounts ----------
const NPL_COLS = [
    { key: "ld", label: "creditreport.npl.colLoan" },
    { key: "name", label: "creditreport.npl.colCustomer" },
    { key: "branch", label: "creditreport.pi.branch" },
    { key: "areaOfficer", label: "creditreport.list.colAreaOfficer" },
    { key: "ownOfficer", label: "creditreport.list.colOwnOfficer" },
    { key: "product", label: "creditreport.pi.product" },
    { key: "location", label: "creditreport.npl.colLocation" },
    { key: "prevCls", label: "creditreport.npl.colPrev" },
    { key: "curCls", label: "creditreport.npl.colCur" },
    { key: "openBal", label: "creditreport.npl.colOpening", money: true },
    { key: "closeBal", label: "creditreport.npl.colClosing", money: true },
    { key: "change", label: "creditreport.npl.colChange", money: true },
    { key: "day", label: "creditreport.list.colDays", num: true },
    { key: "category", label: "creditreport.npl.colCategory" },
    { key: "reason", label: "creditreport.npl.colReason" }
];

function nplRowsOfTab() {
    const all = nplData.accounts || [];
    if (nplTab === "balance") return all.filter(a => a.category === "continuing" && a.change !== 0);
    return all.filter(a => a.category === nplTab);
}

const nplClsOf = a => a.curCls || a.prevCls || "";

function nplVisibleRows() {
    const q = document.getElementById("nplSearch").value.trim().toLowerCase();
    let rows = nplRowsOfTab();
    if (nplFilter.branch) rows = rows.filter(a => a.branch === nplFilter.branch);
    if (nplFilter.cls) rows = rows.filter(a => nplClsOf(a) === nplFilter.cls);
    if (nplFilter.product) rows = rows.filter(a => a.product === nplFilter.product);
    if (q) {
        rows = rows.filter(a => [a.ld, a.cif, a.name, a.branch, a.areaOfficer, a.ownOfficer, a.officerId, a.product, a.location, a.district, a.reason]
            .some(v => String(v || "").toLowerCase().includes(q)));
    }
    const { key, dir } = nplSort;
    const col = NPL_COLS.find(c => c.key === key);
    return rows.slice().sort((a, b) => {
        if (col && (col.money || col.num)) return dir * ((Number(a[key]) || 0) - (Number(b[key]) || 0));
        return dir * String(a[key] || "").localeCompare(String(b[key] || ""));
    });
}

// Filter choices from the current tab's rows, keeping a still-valid pick.
function nplFillFilters() {
    const rows = nplRowsOfTab();
    const fill = (id, key, values, allLabel) => {
        const el = document.getElementById(id);
        const list = [...new Set(values.filter(Boolean))].sort();
        if (nplFilter[key] && !list.includes(nplFilter[key])) nplFilter[key] = "";
        el.innerHTML = `<option value="">${CI.esc(t(allLabel))}</option>` + list.map(v => `<option value="${CI.esc(v)}">${CI.esc(v)}</option>`).join("");
        el.value = nplFilter[key];
        el.classList.toggle("is-set", !!nplFilter[key]);
    };
    fill("nplFBranch", "branch", rows.map(a => a.branch), "creditreport.pi.allBranches");
    fill("nplFCls", "cls", rows.map(nplClsOf), "creditreport.list.allClasses");
    fill("nplFProduct", "product", rows.map(a => a.product), "creditreport.pi.allProducts");
    const sort = document.getElementById("nplSortSel");
    const cur = NPL_SORTS.find(o => o.key === nplSort.key && o.dir === nplSort.dir);
    sort.innerHTML = (cur ? "" : `<option value="">${CI.esc(t("creditreport.list.sortCustom"))}</option>`) +
        NPL_SORTS.map(o => `<option value="${o.id}">${CI.esc(t(o.label))}</option>`).join("");
    sort.value = cur ? cur.id : "";
    document.getElementById("nplClear").hidden = !(nplFilter.branch || nplFilter.cls || nplFilter.product || document.getElementById("nplSearch").value);
    const seg = (id, attr, val) => document.querySelectorAll(`#${id} [data-${attr}]`).forEach(b => {
        const on = b.dataset[attr] === val;
        b.classList.toggle("is-active", on);
        b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    seg("nplSide", "side", nplSide);
    seg("nplView", "view", nplView);
}

function nplCategoryText(a) {
    const base = t(`creditreport.npl.cat.${a.category}`);
    return a.exit ? `${base} · ${nplExitText(a.exit)}` : base;
}

function nplRenderTable() {
    document.querySelectorAll("#nplTabs [data-tab]").forEach(b => {
        const on = b.dataset.tab === nplTab;
        b.classList.toggle("is-active", on);
        b.setAttribute("aria-selected", on ? "true" : "false");
    });
    nplFillFilters();
    const rows = nplVisibleRows();
    document.getElementById("nplCount").textContent = t("creditreport.npl.accountsN", { n: CI.num(rows.length) });
    const cards = nplView === "card";
    document.getElementById("nplCards").hidden = !cards;
    document.getElementById("nplTableWrap").hidden = cards;
    document.getElementById("nplMore").hidden = rows.length <= nplShown;
    if (cards) { nplRenderCards(rows); return; }
    const head = `<thead><tr>${NPL_COLS.map(c => {
        const on = nplSort.key === c.key;
        return `<th${c.money || c.num ? ' class="num"' : ""} aria-sort="${on ? (nplSort.dir > 0 ? "ascending" : "descending") : "none"}"><button type="button" class="ci-sort" data-key="${c.key}">${CI.esc(t(c.label))}${on ? (nplSort.dir > 0 ? " ▲" : " ▼") : ""}</button></th>`;
    }).join("")}${CI.canCreateAction() ? `<th>${CI.esc(t("creditreport.act.col"))}</th>` : ""}</tr></thead>`;
    const withAction = CI.canCreateAction();
    const body = rows.slice(0, nplShown).map(a => `<tr>${NPL_COLS.map(c => {
        if (c.num) return `<td class="num">${a[c.key] ? CI.num(a[c.key]) : "—"}</td>`;
        if (c.money) {
            const v = Number(a[c.key]) || 0;
            const tone = c.key === "change" && v ? (v > 0 ? " ci-bad" : " ci-good") : "";
            return `<td class="num${tone}">${CI.esc(CI.money(v))}</td>`;
        }
        if (c.key === "category") return `<td>${CI.esc(nplCategoryText(a))}</td>`;
        if (c.key === "location") return `<td>${CI.esc(a.district || a.location || "")}</td>`;
        if (c.key === "reason") return `<td class="ci-reason">${CI.esc(a.reason || "—")}</td>`;
        if (c.key === "name") return `<td>${CI.esc(a.name)}<div class="ci-sub">${CI.esc(a.cif)}</div></td>`;
        return `<td>${CI.esc(a[c.key] || "")}</td>`;
    }).join("")}${withAction ? `<td>${nplActionLink(a)}</td>` : ""}</tr>`).join("");
    document.getElementById("nplTable").innerHTML = head + `<tbody>${body || `<tr><td colspan="${NPL_COLS.length + 1}" class="pi-note">${CI.esc(t("creditreport.pi.nothing"))}</td></tr>`}</tbody>`;
}

function nplActionLink(a) {
    if (!CI.canCreateAction() || a.category === "recovered") return "";
    return `<a class="ci-link" href="${CI.esc(CI.actionLink({
        loan: a.ld, branch: a.branch, officer: a.officerId, customer: a.name, source: "npl",
        desc: t(a.category === "new" ? "creditreport.act.descNplNew" : "creditreport.act.descNplCont", { cls: a.curCls, bal: CI.money(a.closeBal) })
    }))}">${CI.esc(t("creditreport.act.add"))}</a>`;
}

// One card per account — the phone-friendly view of the same rows.
function nplRenderCards(rows) {
    const officer = a => (nplSide === "area" ? a.areaOfficer || a.ownOfficer : a.ownOfficer || a.areaOfficer) || "";
    const tone = a => a.category === "new" ? "is-bad" : a.category === "recovered" ? "is-good" : a.change > 0 ? "is-bad" : a.change < 0 ? "is-good" : "";
    document.getElementById("nplCards").innerHTML = rows.length ? rows.slice(0, nplShown).map(a => {
        const chg = Number(a.change) || 0;
        return `<li class="ci-card ${tone(a)}">
            <div class="ci-card-top"><span class="ci-card-id">${CI.esc(a.ld)}</span><span class="ci-pill ci-pill-low">${CI.esc(nplCategoryText(a))}</span></div>
            <div><span class="ci-card-name">${CI.esc(a.name)}</span> <span class="ci-sub">${CI.esc(a.cif)}</span></div>
            <div class="ci-sub">${CI.esc([a.branch, officer(a), a.product, a.district || a.location].filter(Boolean).join(" · "))}</div>
            <div class="ci-card-row"><span class="ci-cls">${CI.esc(a.prevCls || "—")} → <b>${CI.esc(a.curCls || "—")}</b>${a.day ? ` · ${CI.esc(t("creditreport.list.daysN", { n: CI.num(a.day) }))}` : ""}</span>
                <span class="ci-card-amt${chg > 0 ? " ci-bad" : chg < 0 ? " ci-good" : ""}">${chg > 0 ? "+" : ""}${CI.esc(CI.money(chg))}</span></div>
            <div class="ci-sub">${CI.esc(CI.money(a.openBal))} → ${CI.esc(CI.money(a.closeBal))}</div>
            ${a.cause || a.reason ? `<div class="ci-sub ci-reason">${CI.esc(a.cause || a.reason)}</div>` : ""}
            ${nplActionLink(a) ? `<div class="ci-card-foot"><span></span>${nplActionLink(a)}</div>` : ""}
        </li>`;
    }).join("") : `<li class="pi-note">${CI.esc(t("creditreport.pi.nothing"))}</li>`;
}

function nplRenderWhy() {
    const rows = (nplData.accounts || []).filter(a => a.category !== "recovered");
    const documented = rows.filter(a => a.cause || a.reason);
    document.getElementById("nplWhyNote").textContent = t("creditreport.npl.whyNote", {
        documented: CI.num(documented.length), total: CI.num(rows.length)
    });
    // Grouped by the reason (មូលហេតុ) part officers wrote — the solution
    // part is left out; the words themselves are not interpreted.
    const groups = new Map();
    for (const a of documented) {
        const k = (a.cause || a.reason).trim();
        const g = groups.get(k) || { count: 0, value: 0 };
        g.count++;
        g.value += Number(a.closeBal) || 0;
        groups.set(k, g);
    }
    const top = [...groups.entries()].sort((a, b) => b[1].value - a[1].value).slice(0, 10);
    document.getElementById("nplWhy").innerHTML = top.length
        ? top.map(([text, g]) => `<li><div class="pi-rank-row"><span class="pi-rank-main"><span class="pi-rank-name ci-wrap">${CI.esc(text)}</span><span class="pi-rank-sub">${CI.esc(t("creditreport.npl.accountsN", { n: g.count }))}</span></span><span class="pi-rank-val">${CI.esc(CI.money(g.value))}</span></div></li>`).join("")
        : `<li class="pi-note">${CI.esc(t("creditreport.npl.noReasons"))}</li>`;
}

function nplExport() {
    if (typeof XLSX === "undefined") {
        CI.toast(t("creditreport.npl.exportNotReady"), "error");
        return;
    }
    const rows = nplVisibleRows();
    const aoa = [NPL_COLS.map(c => t(c.label))].concat(rows.map(a => NPL_COLS.map(c => {
        if (c.money || c.num) return Number(a[c.key]) || 0;
        if (c.key === "category") return nplCategoryText(a);
        if (c.key === "location") return a.district || a.location || "";
        return a[c.key] || "";
    })));
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = NPL_COLS.map(c => ({ wch: c.key === "reason" ? 40 : c.money ? 14 : 18 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "NPL");
    const m = nplData.movement;
    XLSX.writeFile(wb, `NPL_${nplTab}_${m.openingDate}_${m.closingDate}.xlsx`);
}

document.addEventListener("DOMContentLoaded", () => {
    CI.mountFilters({ dates: true, compare: false, onChange: () => { nplShown = NPL_PAGE; nplLoad(); } });
    document.getElementById("nplTabs").addEventListener("click", e => {
        const b = e.target.closest("[data-tab]");
        if (!b || !nplData) return;
        nplTab = b.dataset.tab;
        nplShown = NPL_PAGE;
        nplRenderTable();
    });
    document.getElementById("nplTable").addEventListener("click", e => {
        const b = e.target.closest(".ci-sort");
        if (!b) return;
        nplSort = nplSort.key === b.dataset.key ? { key: b.dataset.key, dir: -nplSort.dir } : { key: b.dataset.key, dir: -1 };
        nplRenderTable();
    });
    let typing = null;
    document.getElementById("nplSearch").addEventListener("input", () => {
        clearTimeout(typing);
        typing = setTimeout(() => { nplShown = NPL_PAGE; if (nplData) nplRenderTable(); }, 200);
    });
    document.getElementById("nplMore").addEventListener("click", () => { nplShown += NPL_PAGE; nplRenderTable(); });
    [["nplFBranch", "branch"], ["nplFCls", "cls"], ["nplFProduct", "product"]].forEach(([id, k]) =>
        document.getElementById(id).addEventListener("change", e => { nplFilter[k] = e.target.value; nplShown = NPL_PAGE; nplRenderTable(); }));
    document.getElementById("nplSortSel").addEventListener("change", e => {
        const o = NPL_SORTS.find(x => x.id === e.target.value);
        if (o) { nplSort = { key: o.key, dir: o.dir }; nplRenderTable(); }
    });
    document.getElementById("nplClear").addEventListener("click", () => {
        Object.keys(nplFilter).forEach(k => { nplFilter[k] = ""; });
        document.getElementById("nplSearch").value = "";
        nplShown = NPL_PAGE;
        nplRenderTable();
    });
    document.getElementById("nplView").addEventListener("click", e => {
        const b = e.target.closest("[data-view]");
        if (!b) return;
        nplView = b.dataset.view;
        nplSave("ci_npl_view", nplView);
        if (nplData) nplRenderTable();
    });
    // Area / Own changes which loans an officer pick covers — refetch.
    document.getElementById("nplSide").addEventListener("click", e => {
        const b = e.target.closest("[data-side]");
        if (!b || b.dataset.side === nplSide) return;
        nplSide = b.dataset.side;
        nplSave("ci_npl_side", nplSide);
        nplShown = NPL_PAGE;
        nplLoad();
    });
    document.getElementById("nplExport").addEventListener("click", nplExport);
    // Movement needs a saved day before From: start the day after the first one.
    document.getElementById("nplSinceFirst").addEventListener("click", () => {
        const first = nplData && nplData.movement && nplData.movement.firstSaved;
        if (!first) return;
        const d = new Date(`${first}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() + 1);
        const from = document.getElementById("ciFrom");
        from.value = d.toISOString().slice(0, 10);
        from.dispatchEvent(new Event("change"));
    });
    new MutationObserver(() => { if (nplData && nplData.movement && nplData.movement.available) nplRenderWaterfall(nplData.movement); })
        .observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    nplLoad();
});
