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

function nplExitText(e) {
    return e ? t(`creditreport.npl.exit.${e}`) : "";
}

async function nplLoad() {
    const data = await CI.get("npl");
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
    { key: "officerName", label: "creditreport.pi.officer" },
    { key: "product", label: "creditreport.pi.product" },
    { key: "location", label: "creditreport.npl.colLocation" },
    { key: "prevCls", label: "creditreport.npl.colPrev" },
    { key: "curCls", label: "creditreport.npl.colCur" },
    { key: "openBal", label: "creditreport.npl.colOpening", money: true },
    { key: "closeBal", label: "creditreport.npl.colClosing", money: true },
    { key: "change", label: "creditreport.npl.colChange", money: true },
    { key: "category", label: "creditreport.npl.colCategory" },
    { key: "reason", label: "creditreport.npl.colReason" }
];

function nplRowsOfTab() {
    const all = nplData.accounts || [];
    if (nplTab === "balance") return all.filter(a => a.category === "continuing" && a.change !== 0);
    return all.filter(a => a.category === nplTab);
}

function nplVisibleRows() {
    const q = document.getElementById("nplSearch").value.trim().toLowerCase();
    let rows = nplRowsOfTab();
    if (q) {
        rows = rows.filter(a => [a.ld, a.cif, a.name, a.branch, a.officerName, a.officerId, a.product, a.location, a.reason]
            .some(v => String(v || "").toLowerCase().includes(q)));
    }
    const { key, dir } = nplSort;
    const col = NPL_COLS.find(c => c.key === key);
    return rows.slice().sort((a, b) => {
        if (col && col.money) return dir * ((Number(a[key]) || 0) - (Number(b[key]) || 0));
        return dir * String(a[key] || "").localeCompare(String(b[key] || ""));
    });
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
    const rows = nplVisibleRows();
    document.getElementById("nplCount").textContent = t("creditreport.npl.accountsN", { n: CI.num(rows.length) });
    const head = `<thead><tr>${NPL_COLS.map(c => {
        const on = nplSort.key === c.key;
        return `<th${c.money ? ' class="num"' : ""} aria-sort="${on ? (nplSort.dir > 0 ? "ascending" : "descending") : "none"}"><button type="button" class="ci-sort" data-key="${c.key}">${CI.esc(t(c.label))}${on ? (nplSort.dir > 0 ? " ▲" : " ▼") : ""}</button></th>`;
    }).join("")}${CI.canCreateAction() ? `<th>${CI.esc(t("creditreport.act.col"))}</th>` : ""}</tr></thead>`;
    const withAction = CI.canCreateAction();
    const body = rows.slice(0, nplShown).map(a => `<tr>${NPL_COLS.map(c => {
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
    }).join("")}${withAction ? `<td>${a.category === "recovered" ? "" : `<a class="ci-link" href="${CI.esc(CI.actionLink({
        loan: a.ld, branch: a.branch, officer: a.officerId, customer: a.name, source: "npl",
        desc: t(a.category === "new" ? "creditreport.act.descNplNew" : "creditreport.act.descNplCont", { cls: a.curCls, bal: CI.money(a.closeBal) })
    }))}">${CI.esc(t("creditreport.act.add"))}</a>`}</td>` : ""}</tr>`).join("");
    document.getElementById("nplTable").innerHTML = head + `<tbody>${body || `<tr><td colspan="${NPL_COLS.length + 1}" class="pi-note">${CI.esc(t("creditreport.pi.nothing"))}</td></tr>`}</tbody>`;
    document.getElementById("nplMore").hidden = rows.length <= nplShown;
}

function nplRenderWhy() {
    const rows = (nplData.accounts || []).filter(a => a.category !== "recovered");
    const documented = rows.filter(a => a.reason);
    document.getElementById("nplWhyNote").textContent = t("creditreport.npl.whyNote", {
        documented: CI.num(documented.length), total: CI.num(rows.length)
    });
    // Grouped by the exact text officers wrote — not interpreted.
    const groups = new Map();
    for (const a of documented) {
        const k = a.reason.trim();
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
        if (c.money) return Number(a[c.key]) || 0;
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
