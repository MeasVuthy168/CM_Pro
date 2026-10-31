// ========================================
// Credit Portfolio Intelligence — PAR Forecast (Phase 4)
// GET /api/credit-intelligence/forecast: PAR amount and PAR % for the
// next months (Best / Base / Stress) from the month-end Daily History up
// to a cutoff month only, with the model's backtest record, its
// confidence, the data's gaps, and PAR flows from the account history.
// Every assumption is shown; OS growth can be tried here (not saved) and
// an admin can change the saved ones. Nothing here is a fact — it says so.
// ========================================

const t = CI.t;
let pfData = null;
let pfDim = "portfolio";
let pfPick = null;      // the group shown in the chart
let pfMeasure = "pct";
let pfChart = null;

const pfPct = v => (v === null || v === undefined ? "—" : `${(v * 100).toFixed(2)}%`);
const pfMonth = m => { const [y, mo] = String(m || "").split("-"); return y ? `${mo}/${y}` : "—"; };
const pfToken = () => localStorage.getItem("token") || sessionStorage.getItem("token");

async function pfLoad() {
    const q = new URLSearchParams({ dim: pfDim, horizon: document.getElementById("pfHorizon").value });
    const cutoff = document.getElementById("pfCutoff").value;
    const g = document.getElementById("pfGrowth").value;
    if (cutoff) q.set("cutoff", cutoff);
    if (g !== "") q.set("osGrowth", g);
    if (typeof showAppLoading === "function") showAppLoading(t("creditreport.pi.loading"), { progress: true, key: "pf" });
    try {
        const res = await fetch(`${API.BASE_URL}/api/credit-intelligence/forecast?${q}`, { headers: { Authorization: `Bearer ${pfToken()}` } });
        const data = await res.json();
        if (!data.ok) throw new Error(data.message || "");
        pfData = data;
        if (!pfData.groups || !pfData.groups.some(x => x.key === pfPick)) pfPick = pfData.groups && pfData.groups[0] ? pfData.groups[0].key : null;
        pfRender();
    } catch (e) {
        console.error(e);
        CI.toast(t("creditreport.pi.loadFailed"), "error");
    } finally {
        if (typeof hideAppLoading === "function") hideAppLoading();
    }
}

function pfGroup() {
    return (pfData.groups || []).find(g => g.key === pfPick) || null;
}

function pfRender() {
    const d = pfData;
    document.querySelectorAll("#pfDims [data-dim]").forEach(b => {
        const on = b.dataset.dim === (d.dim === "officer" ? "portfolio" : pfDim);
        b.classList.toggle("is-active", on);
        b.hidden = d.scope && d.scope.type === "officer" && b.dataset.dim !== "portfolio";
    });
    const cut = document.getElementById("pfCutoff");
    if (d.lastComplete) cut.max = d.lastComplete;
    if (!cut.value && d.cutoff) cut.value = d.cutoff;
    const note = document.getElementById("pfNote");
    if (d.empty) { note.textContent = t("creditreport.pi.noAccess"); return; }
    if (d.available === false) {
        note.textContent = t(`creditreport.pf.r.${d.reason}`);
        ["pfSummary", "pfChartCard", "pfGroupsCard", "pfBtCard"].forEach(id => { document.getElementById(id).hidden = true; });
        pfRenderAssumptions(d);
        return;
    }
    note.textContent = t("creditreport.pf.cutoffNote", { cutoff: pfMonth(d.cutoff), latest: CI.dmy(d.latestSaved) });
    pfRenderSummary();
    pfRenderGroups();
    pfRenderChart();
    pfRenderBacktest();
    pfRenderFlows(d.flows);
    pfRenderAssumptions(d);
}

function pfRenderSummary() {
    const g = pfGroup();
    const box = document.getElementById("pfSummary");
    if (!g) { box.hidden = true; return; }
    box.hidden = false;
    const last = g.history[g.history.length - 1];
    if (!g.available) {
        box.innerHTML = `<div class="ci-sum-head">${CI.esc(t("creditreport.pf.r.insufficient_history"))}</div>
            <div class="ci-sum-sub">${CI.esc(t("creditreport.pf.haveMonths", { n: g.history.length, need: g.need }))}</div>`;
        return;
    }
    const h = g.forecast.base.length;
    const b = g.forecast.base[h - 1], lo = g.forecast.best[h - 1], hi = g.forecast.stress[h - 1];
    const up = b.parPct > (last.parPct || 0);
    box.innerHTML = `
        <div class="ci-sum-head is-${up ? "up" : "down"}"><span aria-hidden="true">${up ? "▲" : "▼"}</span> ${CI.esc(t("creditreport.pf.sum.head", { month: pfMonth(b.month), pct: pfPct(b.parPct), par: CI.money(b.par), now: pfPct(last.parPct) }))}</div>
        <div class="ci-sum-sub">${CI.esc(t("creditreport.pf.sum.range", { best: pfPct(lo.parPct), stress: pfPct(hi.parPct) }))}</div>
        <div class="ci-sum-parts"><span class="pf-conf pf-conf-${g.confidence.level}">${CI.esc(t(`creditreport.pf.conf.${g.confidence.level}`))}</span>
        <span class="ci-sum-part">${CI.esc(t("creditreport.pf.notFact"))}</span></div>`;
}

function pfRenderGroups() {
    const card = document.getElementById("pfGroupsCard");
    const groups = pfData.groups || [];
    card.hidden = groups.length < 2;
    if (card.hidden) return;
    document.getElementById("pfGroupsTitle").textContent = t(pfDim === "product" ? "creditreport.pf.byProduct" : "creditreport.pf.byBranch");
    document.getElementById("pfGroups").innerHTML = groups.map(g => {
        const last = g.history[g.history.length - 1] || {};
        const end = g.available ? g.forecast.base[g.forecast.base.length - 1] : null;
        return `<button type="button" class="ci-card pf-group${g.key === pfPick ? " is-active" : ""}" data-key="${CI.esc(g.key)}">
            <div class="ci-card-top"><b>${CI.esc(g.label)}</b><span class="pf-conf pf-conf-${g.available ? g.confidence.level : "none"}">${CI.esc(g.available ? t(`creditreport.pf.conf.${g.confidence.level}`) : t("creditreport.pf.noForecast"))}</span></div>
            <div class="crk-facts"><span>${CI.esc(t("creditreport.pf.now"))} <b>${pfPct(last.parPct)}</b></span>${end ? `<span>${CI.esc(pfMonth(end.month))} <b>${pfPct(end.parPct)}</b></span>` : ""}<span>${CI.money(last.par)}</span></div>
        </button>`;
    }).join("");
}

function pfRenderChart() {
    const g = pfGroup();
    const card = document.getElementById("pfChartCard");
    card.hidden = !g;
    if (!g) return;
    document.getElementById("pfChartTitle").textContent = g.key === "portfolio" ? t("creditreport.pf.portfolioOf", { name: g.label === "portfolio" ? t("creditreport.pf.allBranches") : g.label }) : g.label;
    const val = p => (pfMeasure === "pct" ? (p.parPct === null ? null : p.parPct * 100) : p.par);
    const hist = g.history;
    const fc = g.available ? g.forecast : { base: [], best: [], stress: [] };
    const labels = hist.map(p => pfMonth(p.month)).concat(fc.base.map(p => pfMonth(p.month)));
    const pad = n => Array(n).fill(null);
    const join = arr => pad(hist.length - 1).concat([val(hist[hist.length - 1])], arr.map(val));
    const c = CI.chartColors();
    const ds = [
        { label: t("creditreport.pf.actual"), data: hist.map(val).concat(pad(fc.base.length)), borderColor: c.a, backgroundColor: c.a, tension: 0.2 },
        ...(g.available ? [
            { label: t("creditreport.pf.base"), data: join(fc.base), borderColor: c.b, borderDash: [6, 4], pointRadius: 2, tension: 0.2 },
            { label: t("creditreport.pf.best"), data: join(fc.best), borderColor: c.good, borderDash: [2, 4], pointRadius: 0, tension: 0.2 },
            { label: t("creditreport.pf.stress"), data: join(fc.stress), borderColor: c.bad, borderDash: [2, 4], pointRadius: 0, tension: 0.2 }
        ] : [])
    ];
    if (pfChart) pfChart.destroy();
    if (typeof Chart === "undefined") return;
    pfChart = new Chart(document.getElementById("pfChart"), {
        type: "line",
        data: { labels, datasets: ds },
        options: {
            responsive: true, maintainAspectRatio: false, spanGaps: false,
            plugins: { legend: { labels: { color: c.text, font: { family: "KRASAR" } } },
                tooltip: { callbacks: { label: x => `${x.dataset.label}: ${x.raw === null ? "—" : pfMeasure === "pct" ? `${x.raw.toFixed(2)}%` : CI.money(x.raw)}` } } },
            scales: { x: { ticks: { color: c.text }, grid: { color: c.grid } }, y: { ticks: { color: c.text, callback: v => (pfMeasure === "pct" ? `${v}%` : CI.money(v)) }, grid: { color: c.grid } } }
        }
    });
    const rows = g.available ? fc.base.map((b, i) => `<tr><td>${CI.esc(pfMonth(b.month))}</td><td class="num">${pfPct(fc.best[i].parPct)}</td><td class="num"><b>${pfPct(b.parPct)}</b></td><td class="num">${pfPct(fc.stress[i].parPct)}</td><td class="num">${CI.money(b.par)}</td><td class="num">${CI.money(b.os)}</td></tr>`).join("") : "";
    document.getElementById("pfTable").innerHTML = g.available ? `<thead><tr><th>${CI.esc(t("creditreport.crk.hDate"))}</th><th class="num">${CI.esc(t("creditreport.pf.best"))}</th><th class="num">${CI.esc(t("creditreport.pf.base"))}</th><th class="num">${CI.esc(t("creditreport.pf.stress"))}</th><th class="num">${CI.esc(t("creditreport.pf.parBase"))}</th><th class="num">${CI.esc(t("creditreport.pf.osBase"))}</th></tr></thead><tbody>${rows}</tbody>` : "";
}

function pfRenderBacktest() {
    const g = pfGroup();
    const card = document.getElementById("pfBtCard");
    card.hidden = !g || !g.available;
    if (card.hidden) return;
    const q = g.quality;
    document.getElementById("pfBt").innerHTML = `<thead><tr><th>${CI.esc(t("creditreport.pf.monthsAhead"))}</th><th class="num">${CI.esc(t("creditreport.pf.tests"))}</th><th class="num">${CI.esc(t("creditreport.pf.mae"))}</th><th class="num">${CI.esc(t("creditreport.pf.mape"))}</th><th class="num">${CI.esc(t("creditreport.pf.coverage"))}</th></tr></thead><tbody>
        ${g.backtest.byHorizon.map(b => `<tr><td>${b.h}</td><td class="num">${b.n}</td><td class="num">${b.maePp === null ? "—" : `${b.maePp.toFixed(2)} ${t("creditreport.pi.pts")}`}</td><td class="num">${b.mape === null ? "—" : `${(b.mape * 100).toFixed(1)}%`}</td><td class="num">${b.coverage === null ? "—" : `${Math.round(b.coverage * 100)}%`}</td></tr>`).join("")}
        </tbody><caption class="pi-note">${CI.esc(t("creditreport.pf.quality", { n: q.months, first: pfMonth(q.first), last: pfMonth(q.last), missing: q.missingMonths.length ? q.missingMonths.map(pfMonth).join(", ") : t("creditreport.pf.none") }))}</caption>`;
}

function pfRenderFlows(f) {
    const note = document.getElementById("pfFlowNote");
    const tb = document.getElementById("pfFlows");
    const mig = document.getElementById("pfMig");
    if (!f || !f.available) {
        note.textContent = t(`creditreport.pf.r.${f ? f.reason : "account_history_short"}`);
        tb.innerHTML = "";
        mig.innerHTML = "";
        return;
    }
    note.textContent = t("creditreport.pf.flowsNote");
    tb.innerHTML = `<thead><tr><th>${CI.esc(t("creditreport.crk.hDate"))}</th><th class="num">${CI.esc(t("creditreport.pf.opening"))}</th><th class="num">${CI.esc(t("creditreport.pf.inflow"))}</th><th class="num">${CI.esc(t("creditreport.pf.left"))}</th><th class="num">${CI.esc(t("creditreport.pf.balChange"))}</th><th class="num">${CI.esc(t("creditreport.pf.closing"))}</th></tr></thead><tbody>
        ${f.months.map(m => `<tr><td>${CI.esc(pfMonth(m.month))}</td><td class="num">${CI.money(m.opening)}</td><td class="num">+${CI.money(m.inflow.par)} (${CI.num(m.inflow.loans)})</td><td class="num">−${CI.money(m.left.par)} (${CI.num(m.left.loans)})</td><td class="num">${CI.money(m.balanceChange)}</td><td class="num">${CI.money(m.closing)}${m.reconciles ? "" : " ⚠"}</td></tr>`).join("")}</tbody>`;
    const last = f.months[f.months.length - 1];
    const heads = f.buckets.concat([t("creditreport.pf.leftShort")]);
    mig.innerHTML = `<caption class="pi-note">${CI.esc(t("creditreport.pf.migration", { month: pfMonth(last.month) }))}</caption><thead><tr><th>${CI.esc(t("creditreport.pf.fromTo"))}</th>${heads.map(h => `<th class="num">${CI.esc(h)}</th>`).join("")}</tr></thead><tbody>
        ${last.migration.map((row, i) => `<tr><td>${CI.esc(f.buckets[i])}</td>${row.map(v => `<td class="num">${CI.num(v)}</td>`).join("")}</tr>`).join("")}</tbody>`;
}

function pfRenderAssumptions(d) {
    const a = d.assumptions || {};
    const g = pfData && pfGroup();
    const used = g && g.available ? g.fit.osGrowthUsed : null;
    const hist = g && g.available ? g.fit.osGrowthHistorical : null;
    document.getElementById("pfAssumptions").innerHTML = `
        <p>${CI.esc(t("creditreport.pf.a.horizon", { n: a.horizon }))}</p>
        <p>${CI.esc(t("creditreport.pf.a.lookback", { n: a.lookback }))}</p>
        <p>${CI.esc(t("creditreport.pf.a.minHistory", { n: a.minHistory }))}</p>
        <p>${CI.esc(t("creditreport.pf.a.damping", { v: a.damping }))}</p>
        <p>${CI.esc(t("creditreport.pf.a.growth", { v: used === null ? "—" : `${(used * 100).toFixed(2)}%`, from: t(`creditreport.pf.from.${a.osGrowthFrom || "historical"}`), hist: hist === null ? "—" : `${(hist * 100).toFixed(2)}%` }))}</p>
        <p>${CI.esc(t("creditreport.pf.a.scenario", { best: a.scenario ? a.scenario.best : "—", stress: a.scenario ? a.scenario.stress : "—" }))}</p>
        <p class="pf-method">${CI.esc(t("creditreport.pf.method"))}</p>`;
}

// ---------- admin ----------
function pfIsAdmin() {
    try {
        const u = JSON.parse(localStorage.getItem("loggedInUser") || sessionStorage.getItem("loggedInUser") || "{}");
        return String(u.role || "").toLowerCase() === "admin";
    } catch (e) {
        return false;
    }
}
async function pfAdminLoad() {
    const res = await fetch(`${API.BASE_URL}/api/admin/credit-intelligence/forecast-assumptions`, { headers: { Authorization: `Bearer ${pfToken()}` } });
    const data = await res.json();
    if (!data.ok) return;
    const a = data.assumptions;
    const f = (k, label, v, step = 1) => `<label class="pi-field"><span>${CI.esc(t(label))}</span><input type="number" step="${step}" data-k="${k}" value="${v === null ? "" : v}" class="pi-top-pick"></label>`;
    document.getElementById("pfAdminFields").innerHTML =
        f("horizon", "creditreport.pf.horizon", a.horizon) + f("lookback", "creditreport.pf.f.lookback", a.lookback) +
        f("minHistory", "creditreport.pf.f.minHistory", a.minHistory) + f("damping", "creditreport.pf.f.damping", a.damping, 0.05) +
        f("osGrowth", "creditreport.pf.osGrowth", a.osGrowth === null ? null : +(a.osGrowth * 100).toFixed(4), 0.1) +
        f("best", "creditreport.pf.f.best", a.scenario.best, 0.1) + f("stress", "creditreport.pf.f.stress", a.scenario.stress, 0.1);
}
async function pfAdminSave() {
    const v = k => document.querySelector(`#pfAdminFields [data-k="${k}"]`).value;
    const assumptions = {
        horizon: v("horizon"), lookback: v("lookback"), minHistory: v("minHistory"), damping: v("damping"),
        osGrowth: v("osGrowth") === "" ? null : Number(v("osGrowth")) / 100,
        scenario: { best: v("best"), stress: v("stress") }
    };
    try {
        const res = await fetch(`${API.BASE_URL}/api/admin/credit-intelligence/forecast-assumptions`, {
            method: "PUT", headers: { Authorization: `Bearer ${pfToken()}`, "Content-Type": "application/json" }, body: JSON.stringify({ assumptions })
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.message || "");
        CI.toast(t("creditreport.growth.saved"), "success");
        pfLoad();
    } catch (e) {
        console.error(e);
        CI.toast(t("creditreport.pi.loadFailed"), "error");
    }
}

document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("pfDims").addEventListener("click", e => {
        const b = e.target.closest("[data-dim]");
        if (!b || b.dataset.dim === pfDim) return;
        pfDim = b.dataset.dim;
        pfPick = null;
        pfLoad();
    });
    document.getElementById("pfGroups").addEventListener("click", e => {
        const b = e.target.closest("[data-key]");
        if (!b) return;
        pfPick = b.dataset.key;
        pfRender();
    });
    document.getElementById("pfMeasure").addEventListener("click", e => {
        const b = e.target.closest("[data-m]");
        if (!b) return;
        pfMeasure = b.dataset.m;
        document.querySelectorAll("#pfMeasure [data-m]").forEach(x => x.classList.toggle("is-active", x === b));
        pfRenderChart();
    });
    let typing = null;
    ["pfCutoff", "pfHorizon", "pfGrowth"].forEach(id => document.getElementById(id).addEventListener("change", () => { clearTimeout(typing); typing = setTimeout(pfLoad, 200); }));
    if (pfIsAdmin()) {
        const box = document.getElementById("pfAdmin");
        box.hidden = false;
        box.addEventListener("toggle", () => { if (box.open) pfAdminLoad(); });
        document.getElementById("pfAdminSave").addEventListener("click", pfAdminSave);
    }
    pfLoad();
});
