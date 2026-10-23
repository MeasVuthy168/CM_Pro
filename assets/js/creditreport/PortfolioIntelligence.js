// ========================================
// Credit Portfolio Intelligence — Portfolio Overview (Module 01)
// One request to GET /api/credit-intelligence/overview, which builds
// every figure on the server from the 4 Daily Monitoring reports' own
// engines and Daily History snapshots, scoped to the user's role. This
// page only lays the answer out — it never computes a financial figure
// itself, and shows "—" where the server says a figure isn't available.
// Filters, data-as-of and the module switcher are shared with the other
// modules (ci-filters.js).
// ========================================

const t = CI.t;

let piData = null;
let piCompTab = "branch";
let piCharts = [];
// Trend grain, remembered on this device.
let piGrain = (() => { try { return localStorage.getItem("ci_trend_grain") || "daily"; } catch (e) { return "daily"; } })();

// ---------- formatting ----------
const piEsc = CI.esc;
const piNum = CI.num;
const piMoney = CI.money;
const piPct = (n, digits = 2) => CI.pct(n || 0, digits);
const piDMY = CI.dmy;
const piShortMonth = CI.short;
function piPts(n) {
    return `${((Number(n) || 0) * 100).toFixed(2)} ${t("creditreport.pi.pts")}`;
}

// ---------- load ----------
async function piLoad() {
    const data = await CI.get("overview");
    if (!data) return;
    piData = data;
    piRender();
}
// ---------- render ----------
function piRender() {
    const d = piData;
    if (d.empty) {
        document.getElementById("piKpis").innerHTML = `<p class="pi-note">${piEsc(t("creditreport.pi.noAccess"))}</p>`;
        return;
    }
    CI.fillOptions(d.options || {}, d.scope, d.period);
    CI.renderAsOf(document.getElementById("piAsOf"), d);
    piRenderAlerts(d);
    piRenderKpis(d);
    piRenderTrend(d);
    piRenderComp();
    piRenderTop();
}

function piAlertText(a) {
    const v = a.values || {};
    switch (a.code) {
        case "data_outdated": return t("creditreport.pi.alert.data_outdated", { date: piDMY(v.date), days: v.days });
        case "compare_unavailable": return t(`creditreport.pi.cmpReason.${v.reason || "no_snapshot"}`);
        case "npl_ratio_up": return t("creditreport.pi.alert.npl_ratio_up", { prev: piPct(v.prev), cur: piPct(v.cur), rule: piPts(v.rule) });
        case "par_up": return t("creditreport.pi.alert.par_up", { prev: piPct(v.prev), cur: piPct(v.cur), rule: piPts(v.rule) });
        case "branch_npl_high": return t("creditreport.pi.alert.branch_npl_high", { branch: v.branch, cur: piPct(v.cur), portfolio: piPct(v.portfolio), rule: v.rule });
        default: return a.code;
    }
}

function piRenderAlerts(d) {
    const list = d.alerts || [];
    const card = document.getElementById("piAlertsCard");
    card.hidden = !list.length;
    const icon = { high: "⚠", medium: "▲", info: "ℹ" };
    const label = { high: t("creditreport.pi.levelHigh"), medium: t("creditreport.pi.levelMedium"), info: t("creditreport.pi.levelInfo") };
    document.getElementById("piAlerts").innerHTML = list.map(a => `
        <li class="pi-alert pi-alert-${a.level}">
            <span class="pi-alert-level"><span aria-hidden="true">${icon[a.level] || "•"}</span> ${piEsc(label[a.level] || a.level)}</span>
            <span>${piEsc(piAlertText(a))}</span>
        </li>`).join("");
}

const PI_KPIS = [
    { key: "outstanding", label: "creditreport.pi.kOutstanding", fmt: piMoney, sub: k => t("creditreport.pi.loansClients", { loans: piNum(k.loans), clients: piNum(k.clients) }) },
    { key: "disbursement", label: "creditreport.pi.kDisbursement", fmt: piMoney, sub: k => t("creditreport.pi.loans", { loans: piNum(k.loans) }) },
    { key: "nplValue", label: "creditreport.pi.kNplValue", fmt: piMoney },
    { key: "nplAccounts", label: "creditreport.pi.kNplAccounts", fmt: piNum },
    { key: "nplPct", label: "creditreport.pi.kNplPct", fmt: piPct, pts: true },
    { key: "parPct", label: "creditreport.pi.kParPct", fmt: piPct, pts: true, sub: k => piMoney(k.value) }
];

function piRenderKpis(d) {
    const html = PI_KPIS.map(def => {
        const k = d.kpis[def.key];
        let change = `<span class="pi-kpi-change pi-na">${piEsc(t("creditreport.pi.noPrev"))}</span>`;
        if (k.prev != null) {
            const arrow = k.diff > 0 ? "▲" : k.diff < 0 ? "▼" : "■";
            const diffText = def.pts
                ? `${k.diff >= 0 ? "+" : ""}${(k.diff * 100).toFixed(2)} ${t("creditreport.pi.pts")}`
                : `${k.diff >= 0 ? "+" : "−"}${def.fmt(Math.abs(k.diff))}`;
            const pctText = !def.pts && k.pct != null ? ` (${k.pct >= 0 ? "+" : ""}${(k.pct * 100).toFixed(1)}%)` : "";
            const word = k.trend === "good" ? t("creditreport.pi.better") : k.trend === "bad" ? t("creditreport.pi.worse") : t("creditreport.pi.unchanged");
            change = `<span class="pi-kpi-change pi-${k.trend}"><span aria-hidden="true">${arrow}</span> ${piEsc(diffText + pctText)} · ${piEsc(word)}</span>`;
        }
        return `
        <article class="pi-kpi">
            <div class="pi-kpi-label">${piEsc(t(def.label))}</div>
            <div class="pi-kpi-value">${piEsc(def.fmt(k.cur))}</div>
            ${def.sub ? `<div class="pi-kpi-sub">${piEsc(def.sub(k))}</div>` : ""}
            <div class="pi-kpi-prev">${piEsc(t("creditreport.pi.previous"))}: ${k.prev == null ? "—" : piEsc(def.fmt(k.prev))}</div>
            ${change}
        </article>`;
    }).join("");
    const c = d.comparison;
    const note = c.available && c.fromDate
        ? `<p class="pi-note pi-kpi-note">${piEsc(t("creditreport.pi.disbPrevNote", { from: piDMY(c.fromDate), to: piDMY(c.toDate) }))}</p>`
        : "";
    document.getElementById("piKpis").innerHTML = html + note;
}

function piRenderTrend(d) {
    piCharts.forEach(c => c.destroy && c.destroy());
    piCharts = [];
    const tr = d.trend;
    const empty = document.getElementById("piTrendEmpty");
    const box = document.getElementById("piTrend");
    const table = document.getElementById("piTrendTable");
    if (!tr.available) {
        empty.hidden = false;
        empty.textContent = t(`creditreport.pi.cmpReason.${tr.reason || "no_snapshot"}`);
        box.hidden = true;
        table.innerHTML = "";
        return;
    }
    empty.hidden = true;
    box.hidden = false;
    document.querySelectorAll("#piGrain [data-grain]").forEach(b => {
        const on = b.dataset.grain === piGrain;
        b.classList.toggle("is-active", on);
        b.setAttribute("aria-selected", on ? "true" : "false");
    });
    document.getElementById("piGrainNote").textContent = t(`creditreport.pi.grainNote.${piGrain}`);
    const pts = tr[piGrain] || tr.points;
    const labels = pts.map(p => piShortMonth(p.date) + (p.live ? " *" : ""));
    table.innerHTML = `<thead><tr><th>${piEsc(t("creditreport.pi.date"))}</th><th>${piEsc(t("creditreport.pi.kOutstanding"))}</th><th>${piEsc(t("creditreport.pi.kNplValue"))}</th><th>${piEsc(t("creditreport.pi.kNplPct"))}</th><th>${piEsc(t("creditreport.pi.kParPct"))}</th></tr></thead><tbody>` +
        pts.map(p => `<tr><td>${piEsc(piDMY(p.date))}${p.live ? " *" : ""}</td><td>${piMoney(p.os)}</td><td>${piMoney(p.nplValue)}</td><td>${piPct(p.nplPct)}</td><td>${piPct(p.parPct)}</td></tr>`).join("") +
        `</tbody><caption>${piEsc(t("creditreport.pi.liveNote"))}</caption>`;
    if (typeof Chart === "undefined") return;
    const col = CI.chartColors();
    const font = { family: "KRASAR, sans-serif", size: 11 };
    const base = {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        animation: false,
        scales: {
            x: { grid: { display: false }, ticks: { color: col.text, font, maxRotation: 0, autoSkip: true } },
            y: { grid: { color: col.grid }, border: { display: false }, ticks: { color: col.text, font } }
        }
    };
    piCharts.push(new Chart(document.getElementById("piChartOs"), {
        type: "line",
        data: { labels, datasets: [{ label: t("creditreport.pi.kOutstanding"), data: pts.map(p => p.os), borderColor: col.a, backgroundColor: col.a, borderWidth: 2, pointRadius: pts.length > 20 ? 2 : 4, tension: 0.25 }] },
        options: {
            ...base,
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${piMoney(c.parsed.y)}` } } },
            scales: { ...base.scales, y: { ...base.scales.y, ticks: { ...base.scales.y.ticks, callback: v => piCompact(v) } } }
        }
    }));
    piCharts.push(new Chart(document.getElementById("piChartRisk"), {
        type: "line",
        data: {
            labels,
            datasets: [
                { label: t("creditreport.pi.kNplPct"), data: pts.map(p => p.nplPct * 100), borderColor: col.a, backgroundColor: col.a, borderWidth: 2, pointRadius: pts.length > 20 ? 2 : 4, tension: 0.25 },
                { label: t("creditreport.pi.kParPct"), data: pts.map(p => p.parPct * 100), borderColor: col.b, backgroundColor: col.b, borderWidth: 2, pointRadius: pts.length > 20 ? 2 : 4, pointStyle: "rectRot", borderDash: [6, 3], tension: 0.25 }
            ]
        },
        options: {
            ...base,
            plugins: {
                legend: { display: true, position: "top", align: "start", labels: { color: col.text, font, usePointStyle: true, boxWidth: 8, boxHeight: 8 } },
                tooltip: { callbacks: { label: c => `${c.dataset.label}: ${c.parsed.y.toFixed(2)}%` } }
            },
            scales: { ...base.scales, y: { ...base.scales.y, ticks: { ...base.scales.y.ticks, callback: v => `${v}%` } } }
        }
    }));
}

function piCompact(v) {
    const a = Math.abs(v);
    if (a >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
    if (a >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
    return `$${v}`;
}

// Where a row opens in the existing reports (their own URL parameters).
function piDrillUrl(kind, name) {
    const d = piData.period;
    const dates = { fromDate: d.fromDate || "", toDate: d.toDate || "" };
    if (kind === "branch") return `BranchProductivity.html?${new URLSearchParams({ branch: name, ...dates })}`;
    if (kind === "product") return `ProductPerformance.html?${new URLSearchParams({ product: name, ...dates })}`;
    if (kind === "location") return name ? `RepDetailbyLocation.html?${new URLSearchParams({ district: name, section: "nbcOverdue" })}` : "";
    if (kind === "officerBranch") return `RepDetailbyCO.html?${new URLSearchParams({ branch: name, section: "nbcOverdue" })}`;
    return "";
}

function piRenderComp() {
    document.querySelectorAll("#piCompTabs [data-tab]").forEach(b => {
        const on = b.dataset.tab === piCompTab;
        b.classList.toggle("is-active", on);
        b.setAttribute("aria-selected", on ? "true" : "false");
    });
    const rows = (piData.composition || {})[piCompTab] || [];
    const box = document.getElementById("piComp");
    if (!rows.length) {
        box.innerHTML = `<p class="pi-note">${piEsc(t("creditreport.pi.nothing"))}</p>`;
        return;
    }
    const max = Math.max(...rows.map(r => r.share), 0.0001);
    box.innerHTML = rows.map(r => {
        const name = r.name || t("creditreport.pi.otherAddress");
        const url = piDrillUrl(piCompTab, r.name);
        const tag = url ? "a" : "div";
        return `
        <${tag} class="pi-bar-row"${url ? ` href="${piEsc(url)}"` : ""}>
            <div class="pi-bar-head"><span class="pi-bar-name">${piEsc(name)}</span><span class="pi-bar-val">${piMoney(r.os)} · ${piPct(r.share, 1)}</span></div>
            <div class="pi-bar-track"><span class="pi-bar-fill" style="width:${(r.share / max * 100).toFixed(1)}%"></span></div>
            <div class="pi-bar-meta">${piEsc(t("creditreport.pi.kNplPct"))} ${piPct(r.nplPct)} · ${piEsc(t("creditreport.pi.kParPct"))} ${piPct(r.parPct)}</div>
        </${tag}>`;
    }).join("");
}

function piRenderTop() {
    const pick = document.getElementById("piTopPick").value;
    const top = piData.top || {};
    const rows = top[pick] || [];
    const note = document.getElementById("piTopNote");
    note.textContent = pick === "officersPar" ? t("creditreport.pi.parMinNote", { n: top.parMinLoans || 0 })
        : pick === "officersNplRise" ? (top.officersNplRiseSince ? t("creditreport.pi.riseSince", { date: piDMY(top.officersNplRiseSince) }) : t("creditreport.pi.cmpReason.no_snapshot"))
        : "";
    const box = document.getElementById("piTop");
    if (!rows.length) {
        box.innerHTML = `<li class="pi-note">${piEsc(t("creditreport.pi.nothing"))}</li>`;
        return;
    }
    const kind = pick.startsWith("officers") ? "officerBranch" : pick.startsWith("branches") ? "branch" : pick.startsWith("products") ? "product" : "location";
    box.innerHTML = rows.map(r => {
        const value = pick === "officersPar" ? piPct(r.parPct)
            : pick === "branchesNplPct" ? piPct(r.nplPct)
            : pick === "officersNplRise" ? `+${piMoney(r.rise)}`
            : piMoney(r.nplValue);
        const sub = pick.startsWith("officers")
            ? `${r.branch} · ${t("creditreport.pi.kOutstanding")} ${piMoney(r.os)}`
            : `${t("creditreport.pi.kOutstanding")} ${piMoney(r.os)} · ${t("creditreport.pi.kNplPct")} ${piPct(r.nplPct)}`;
        const url = piDrillUrl(kind, kind === "officerBranch" ? r.branch : r.name);
        const name = r.name || t("creditreport.pi.otherAddress");
        return `<li><a class="pi-rank-row" ${url ? `href="${piEsc(url)}"` : ""}>
            <span class="pi-rank-main"><span class="pi-rank-name">${piEsc(name)}</span><span class="pi-rank-sub">${piEsc(sub)}</span></span>
            <span class="pi-rank-val">${piEsc(value)}</span></a></li>`;
    }).join("");
}

// ---------- wiring ----------
document.addEventListener("DOMContentLoaded", () => {
    CI.mountNav("overview");
    CI.mountFilters({ onChange: piLoad });
    document.getElementById("piCompTabs").addEventListener("click", e => {
        const b = e.target.closest("[data-tab]");
        if (!b || !piData) return;
        piCompTab = b.dataset.tab;
        piRenderComp();
    });
    document.getElementById("piTopPick").addEventListener("change", () => { if (piData) piRenderTop(); });
    document.getElementById("piGrain").addEventListener("click", e => {
        const b = e.target.closest("[data-grain]");
        if (!b) return;
        piGrain = b.dataset.grain;
        try { localStorage.setItem("ci_trend_grain", piGrain); } catch (e2) { /* private mode */ }
        if (piData && !piData.empty) piRenderTrend(piData);
    });
    // Charts read the theme's colours when drawn.
    new MutationObserver(() => { if (piData && !piData.empty) piRenderTrend(piData); })
        .observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    piLoad();
});
