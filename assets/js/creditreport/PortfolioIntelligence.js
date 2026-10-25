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
    piRenderSummary(d);
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
        case "npl_ratio_up": return t("creditreport.pi.alert.npl_ratio_up", { prev: piPct(v.prev), cur: piPct(v.cur), up: piPts(v.cur - v.prev), rule: piPts(v.rule) });
        case "par_up": return t("creditreport.pi.alert.par_up", { prev: piPct(v.prev), cur: piPct(v.cur), up: piPts(v.cur - v.prev), rule: piPts(v.rule) });
        case "branch_npl_high": return t("creditreport.pi.alert.branch_npl_high", { branch: v.branch, cur: piPct(v.cur), portfolio: piPct(v.portfolio), times: v.portfolio ? (v.cur / v.portfolio).toFixed(1) : "—", rule: v.rule });
        default: return a.code;
    }
}

function piRenderAlerts(d) {
    const list = d.alerts || [];
    const card = document.getElementById("piAlertsCard");
    card.hidden = !list.length;
    const icon = { high: "⚠", medium: "▲", info: "ℹ" };
    const label = { high: t("creditreport.pi.levelHigh"), medium: t("creditreport.pi.levelMedium"), info: t("creditreport.pi.levelInfo") };
    // A branch alert opens that branch in NPL Management.
    const link = a => a.code === "branch_npl_high" && a.values && a.values.branch
        ? `NplIntelligence.html?${new URLSearchParams({ branch: a.values.branch, ...piPeriodParams() })}` : "";
    document.getElementById("piAlerts").innerHTML = list.map(a => {
        const url = link(a);
        const tag = url ? "a" : "div";
        return `
        <li><${tag} class="pi-alert pi-alert-${a.level}"${url ? ` href="${piEsc(url)}"` : ""}>
            <span class="pi-alert-level"><span aria-hidden="true">${icon[a.level] || "•"}</span> ${piEsc(label[a.level] || a.level)}</span>
            <span>${piEsc(piAlertText(a))}${url ? ` <span class="pi-alert-go">${piEsc(t("creditreport.pi.openNpl"))} ›</span>` : ""}</span>
        </${tag}></li>`;
    }).join("");
}

const PI_KPIS = [
    { key: "outstanding", label: "creditreport.pi.kOutstanding", fmt: piMoney, sub: k => t("creditreport.pi.loansClients", { loans: piNum(k.loans), clients: piNum(k.clients) }) },
    { key: "disbursement", label: "creditreport.pi.kDisbursement", fmt: piMoney, sub: k => t("creditreport.pi.loans", { loans: piNum(k.loans) }) },
    { key: "nplValue", label: "creditreport.pi.kNplValue", fmt: piMoney },
    { key: "nplAccounts", label: "creditreport.pi.kNplAccounts", fmt: piNum },
    { key: "nplPct", label: "creditreport.pi.kNplPct", fmt: piPct, pts: true },
    { key: "parPct", label: "creditreport.pi.kParPct", fmt: piPct, pts: true, sub: k => piMoney(k.value) }
];

// The figure the previous values come from, in words: "Previous
// month-end (30/09/2026)", or the chosen day itself.
function piCompareName(c, short) {
    if (!c || !c.date) return "";
    const date = short ? piDMY(c.date).slice(0, 5) : piDMY(c.date);
    if (c.mode === "date") return date;
    const name = t({ month: "creditreport.pi.compareMonth", prev: "creditreport.pi.comparePrev", year: "creditreport.pi.compareYear" }[c.mode] || "creditreport.pi.previous");
    return `${name} (${date})`;
}

function piChange(def, k) {
    if (k.prev == null) return `<span class="pi-kpi-change pi-na">${piEsc(t("creditreport.pi.noPrev"))}</span>`;
    const arrow = k.diff > 0 ? "▲" : k.diff < 0 ? "▼" : "■";
    const diffText = def.pts
        ? `${k.diff >= 0 ? "+" : ""}${(k.diff * 100).toFixed(2)} ${t("creditreport.pi.pts")}`
        : `${k.diff >= 0 ? "+" : "−"}${def.fmt(Math.abs(k.diff))}`;
    const pctText = !def.pts && k.pct != null ? ` (${k.pct >= 0 ? "+" : ""}${(k.pct * 100).toFixed(1)}%)` : "";
    const word = k.trend === "good" ? t("creditreport.pi.better") : k.trend === "bad" ? t("creditreport.pi.worse") : t("creditreport.pi.unchanged");
    return `<span class="pi-kpi-change pi-${k.trend}"><span aria-hidden="true">${arrow}</span> ${piEsc(diffText + pctText)} · ${piEsc(word)}</span>`;
}

function piRenderKpis(d) {
    const c = d.comparison || {};
    document.getElementById("piCmpWith").textContent = c.available && c.date
        ? t("creditreport.pi.cmpWith", { what: piCompareName(c) }) : "";
    const prevName = c.available && c.date ? piCompareName(c, true) : t("creditreport.pi.previous");
    // Previous disbursement is the saved day's own disbursement range.
    const disbPrev = c.available && c.fromDate ? `${piDMY(c.fromDate).slice(0, 5)} – ${piDMY(c.toDate).slice(0, 5)}` : prevName;
    document.getElementById("piKpis").innerHTML = PI_KPIS.map(def => {
        const k = d.kpis[def.key];
        const tipKey = `creditreport.pi.tip.${def.key}`;
        return `
        <article class="pi-kpi">
            <div class="pi-kpi-label">${piEsc(t(def.label))}${CI.infoBtn()}</div>
            <div class="pi-kpi-value">${piEsc(def.fmt(k.cur))}</div>
            ${def.sub ? `<div class="pi-kpi-sub">${piEsc(def.sub(k))}</div>` : ""}
            <div class="pi-kpi-prev">${piEsc(def.key === "disbursement" ? disbPrev : prevName)}: ${k.prev == null ? "—" : piEsc(def.fmt(k.prev))}</div>
            ${piChange(def, k)}
            ${CI.tip(tipKey)}
        </article>`;
    }).join("");
}

// One line on how the portfolio moved, from the server's own KPI
// comparison (direction and good/bad come from the server).
function piRenderSummary(d) {
    const box = document.getElementById("piSummary");
    const k = d.kpis || {};
    const npl = k.nplPct;
    if (!npl) { box.hidden = true; return; }
    const c = d.comparison || {};
    const has = npl.prev != null;
    const dir = !has ? "flat" : npl.diff < 0 ? "down" : npl.diff > 0 ? "up" : "flat";
    const head = !has
        ? t("creditreport.pi.sum.now", { cur: piPct(npl.cur) })
        : t(`creditreport.pi.sum.${dir}`, { prev: piPct(npl.prev), cur: piPct(npl.cur) });
    const tone = x => x && x.prev != null ? (x.trend === "good" ? "good" : x.trend === "bad" ? "bad" : "") : "";
    const money = x => x.prev == null ? piMoney(x.cur) : `${x.diff >= 0 ? "+" : "−"}${piMoney(Math.abs(x.diff))}${x.pct != null ? ` (${x.pct >= 0 ? "+" : ""}${(x.pct * 100).toFixed(1)}%)` : ""}`;
    const parts = [
        k.outstanding && [t("creditreport.pi.kOutstanding"), money(k.outstanding), tone(k.outstanding)],
        k.disbursement && [t("creditreport.pi.kDisbursement"), piMoney(k.disbursement.cur), tone(k.disbursement)],
        k.nplValue && [t("creditreport.pi.kNplValue"), money(k.nplValue), tone(k.nplValue)],
        k.parPct && [t("creditreport.pi.kParPct"), k.parPct.prev == null ? piPct(k.parPct.cur) : `${piPct(k.parPct.prev)} → ${piPct(k.parPct.cur)}`, tone(k.parPct)]
    ].filter(Boolean);
    box.hidden = false;
    box.innerHTML = `
        <div class="ci-sum-head is-${dir}"><span aria-hidden="true">${dir === "down" ? "▼" : dir === "up" ? "▲" : "■"}</span> ${piEsc(head)}</div>
        <div class="ci-sum-sub">${piEsc(has && c.date ? t("creditreport.pi.cmpWith", { what: piCompareName(c) }) : t("creditreport.pi.noPrev"))}</div>
        <div class="ci-sum-parts">${parts.map(([label, v, tn]) => `<span class="ci-sum-part is-${tn}">${piEsc(label)} <b>${piEsc(v)}</b></span>`).join("")}</div>`;
    if (window.CIExplain) CI.explain(box, CIExplain.overview(d, t));
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
    let pts = tr[piGrain] || tr.points;
    // Daily keeps the last two months; Weekly / Monthly show the longer run.
    if (piGrain === "daily" && pts.length) {
        const last = piDay(pts[pts.length - 1].date);
        pts = pts.filter(p => last - piDay(p.date) <= PI_DAILY_DAYS);
    }
    table.innerHTML = `<thead><tr><th>${piEsc(t("creditreport.pi.date"))}</th><th>${piEsc(t("creditreport.pi.kOutstanding"))}</th><th>${piEsc(t("creditreport.pi.kNplValue"))}</th><th>${piEsc(t("creditreport.pi.kNplPct"))}</th><th>${piEsc(t("creditreport.pi.kParPct"))}</th></tr></thead><tbody>` +
        pts.map(p => `<tr><td>${piEsc(piDMY(p.date))}${p.live ? " *" : ""}</td><td>${piMoney(p.os)}</td><td>${piMoney(p.nplValue)}</td><td>${piPct(p.nplPct)}</td><td>${piPct(p.parPct)}</td></tr>`).join("") +
        `</tbody><caption>${piEsc(t("creditreport.pi.liveNote"))}</caption>`;
    if (typeof Chart === "undefined") return;
    const col = CI.chartColors();
    const font = { family: "KRASAR, sans-serif", size: 11 };
    // The x axis is in days, so points sit at their real distance apart
    // (closed months keep only their month-end day).
    const xy = f => pts.map(p => ({ x: piDay(p.date), y: f(p) }));
    const dayText = v => { const p = pts.find(q => piDay(q.date) === v); return p ? piShortMonth(p.date) + (p.live ? " *" : "") : piShortMonth(piKeyOf(v)); };
    const base = {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        animation: false,
        scales: {
            x: { type: "linear", min: pts.length ? piDay(pts[0].date) : undefined, max: pts.length ? piDay(pts[pts.length - 1].date) : undefined, grid: { display: false }, ticks: { color: col.text, font, maxRotation: 0, autoSkip: true, maxTicksLimit: 5, callback: v => piShortMonth(piKeyOf(v)) } },
            y: { grid: { color: col.grid }, border: { display: false }, ticks: { color: col.text, font } }
        }
    };
    piCharts.push(new Chart(document.getElementById("piChartOs"), {
        type: "line",
        data: { datasets: [{ label: t("creditreport.pi.kOutstanding"), data: xy(p => p.os), borderColor: col.a, backgroundColor: col.a, borderWidth: 2, pointRadius: pts.length > 20 ? 2 : 4, tension: 0.25 }] },
        options: {
            ...base,
            plugins: { legend: { display: false }, tooltip: { callbacks: { title: c => dayText(c[0].parsed.x), label: c => `${c.dataset.label}: ${piMoney(c.parsed.y)}` } } },
            scales: { ...base.scales, y: { ...base.scales.y, ticks: { ...base.scales.y.ticks, callback: v => piCompact(v) } } }
        }
    }));
    piCharts.push(new Chart(document.getElementById("piChartRisk"), {
        type: "line",
        data: {
            datasets: [
                { label: t("creditreport.pi.kNplPct"), data: xy(p => p.nplPct * 100), borderColor: col.a, backgroundColor: col.a, borderWidth: 2, pointRadius: pts.length > 20 ? 2 : 4, tension: 0.25 },
                { label: t("creditreport.pi.kParPct"), data: xy(p => p.parPct * 100), borderColor: col.b, backgroundColor: col.b, borderWidth: 2, pointRadius: pts.length > 20 ? 2 : 4, pointStyle: "rectRot", borderDash: [6, 3], tension: 0.25 }
            ]
        },
        options: {
            ...base,
            plugins: {
                legend: { display: true, position: "top", align: "start", labels: { color: col.text, font, usePointStyle: true, boxWidth: 8, boxHeight: 8 } },
                tooltip: { callbacks: { title: c => dayText(c[0].parsed.x), label: c => `${c.dataset.label}: ${c.parsed.y.toFixed(2)}%` } }
            },
            scales: { ...base.scales, y: { ...base.scales.y, ticks: { ...base.scales.y.ticks, callback: v => `${v}%` } } }
        }
    }));
}

const PI_DAILY_DAYS = 62;
// "YYYY-MM-DD" <-> day number (UTC), for the time-scaled x axis.
function piDay(key) {
    const [y, m, d] = String(key).slice(0, 10).split("-").map(Number);
    return Date.UTC(y, m - 1, d) / 864e5;
}
function piKeyOf(day) {
    return new Date(Math.round(day) * 864e5).toISOString().slice(0, 10);
}

function piCompact(v) {
    const a = Math.abs(v);
    if (a >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
    if (a >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
    return `$${v}`;
}

function piPeriodParams() {
    const d = (piData && piData.period) || {};
    return { fromDate: d.fromDate || "", toDate: d.toDate || "" };
}

// Where a row opens in the existing reports (their own URL parameters).
// An officer opens NPL Management filtered to that officer.
function piDrillUrl(kind, name) {
    if (kind === "officerNpl") return name ? `NplIntelligence.html?${new URLSearchParams({ officer: name, ...piPeriodParams() })}` : "";
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
    // Each row's NPL ratio / PAR % is red above the whole portfolio's, green below.
    const k = piData.kpis || {};
    const avgNpl = k.nplPct ? k.nplPct.cur : null;
    const avgPar = k.parPct ? k.parPct.cur : null;
    document.getElementById("piCompLegend").textContent = avgNpl == null ? ""
        : t("creditreport.pi.compLegend", { npl: piPct(avgNpl), par: piPct(avgPar) });
    const rate = (label, v, avg) => {
        const tone = avg == null ? "" : v > avg ? " pi-bad" : v < avg ? " pi-good" : "";
        return `<span class="pi-rate${tone}">${piEsc(label)} ${piPct(v)}</span>`;
    };
    box.innerHTML = rows.map(r => {
        const name = r.name || t("creditreport.pi.otherAddress");
        const url = piDrillUrl(piCompTab, r.name);
        const tag = url ? "a" : "div";
        return `
        <${tag} class="pi-bar-row"${url ? ` href="${piEsc(url)}"` : ""}>
            <div class="pi-bar-head"><span class="pi-bar-name">${piEsc(name)}</span><span class="pi-bar-val">${piMoney(r.os)} · ${piPct(r.share, 1)}</span></div>
            <div class="pi-bar-track"><span class="pi-bar-fill" style="width:${(r.share / max * 100).toFixed(1)}%"></span></div>
            <div class="pi-bar-meta">${rate(t("creditreport.pi.kNplPct"), r.nplPct, avgNpl)} · ${rate(t("creditreport.pi.kParPct"), r.parPct, avgPar)}</div>
        </${tag}>`;
    }).join("");
}

const PI_TOP = [
    ["officersNpl", "creditreport.pi.topOfficersNpl"],
    ["officersNplRise", "creditreport.pi.topOfficersRise"],
    ["officersPar", "creditreport.pi.topOfficersPar"],
    ["branchesNplPct", "creditreport.pi.topBranchesNpl"],
    ["productsNpl", "creditreport.pi.topProductsNpl"],
    ["locationsNpl", "creditreport.pi.topDistrictsNpl"]
];
let piTopPick = "officersNpl";

function piRenderTop() {
    const pick = piTopPick;
    document.getElementById("piTopPick").innerHTML = PI_TOP.map(([key, label]) =>
        `<button type="button" role="tab" class="pi-chip${key === pick ? " is-active" : ""}" data-pick="${key}" aria-selected="${key === pick}">${piEsc(t(label))}</button>`).join("");
    const top = piData.top || {};
    const rows = top[pick] || [];
    const note = document.getElementById("piTopNote");
    note.textContent = pick === "officersPar" ? t("creditreport.pi.parMinNote", { n: top.parMinLoans || 0 })
        : pick === "officersNplRise" ? (top.officersNplRiseSince ? t("creditreport.pi.riseSince", { date: piDMY(top.officersNplRiseSince) }) : t("creditreport.pi.cmpReason.no_snapshot"))
        : "";
    // Officer rankings leave out Stop Disburse officers (their loans still
    // count in every total) — say how many, so nothing looks missing.
    const ex = top.stopDisburseExcluded;
    if (pick.startsWith("officers") && ex && ex.count) {
        note.textContent = [note.textContent, t("creditreport.pi.stopExcluded", { n: ex.count, npl: piMoney(ex.nplValue) })].filter(Boolean).join(" · ");
    }
    const box = document.getElementById("piTop");
    if (!rows.length) {
        box.innerHTML = `<li class="pi-note">${piEsc(t("creditreport.pi.nothing"))}</li>`;
        return;
    }
    const kind = pick === "officersPar" ? "officerBranch" : pick.startsWith("officers") ? "officerNpl" : pick.startsWith("branches") ? "branch" : pick.startsWith("products") ? "product" : "location";
    const raw = r => pick === "officersPar" ? r.parPct : pick === "branchesNplPct" ? r.nplPct : pick === "officersNplRise" ? r.rise : r.nplValue;
    const max = Math.max(...rows.map(raw), 0) || 1;
    box.innerHTML = rows.map(r => {
        const value = pick === "officersPar" ? piPct(r.parPct)
            : pick === "branchesNplPct" ? piPct(r.nplPct)
            : pick === "officersNplRise" ? `+${piMoney(r.rise)}`
            : piMoney(r.nplValue);
        const sub = pick.startsWith("officers")
            ? `${r.branch} · ${t("creditreport.pi.kOutstanding")} ${piMoney(r.os)}`
            : `${t("creditreport.pi.kOutstanding")} ${piMoney(r.os)} · ${t("creditreport.pi.kNplPct")} ${piPct(r.nplPct)}`;
        const url = piDrillUrl(kind, kind === "officerBranch" ? r.branch : kind === "officerNpl" ? r.id : r.name);
        const name = r.name || t("creditreport.pi.otherAddress");
        return `<li><a class="pi-rank-row" ${url ? `href="${piEsc(url)}"` : ""}>
            <span class="pi-rank-main"><span class="pi-rank-name">${piEsc(name)}</span><span class="pi-rank-sub">${piEsc(sub)}</span></span>
            <span class="pi-rank-val">${piEsc(value)}<span class="ci-mini"><span style="width:${(raw(r) / max * 100).toFixed(1)}%"></span></span></span></a></li>`;
    }).join("");
}

// ---------- wiring ----------
document.addEventListener("DOMContentLoaded", () => {
    CI.mountFilters({ onChange: piLoad });
    document.getElementById("piCompTabs").addEventListener("click", e => {
        const b = e.target.closest("[data-tab]");
        if (!b || !piData) return;
        piCompTab = b.dataset.tab;
        piRenderComp();
    });
    document.getElementById("piTopPick").addEventListener("click", e => {
        const b = e.target.closest("[data-pick]");
        if (!b || !piData) return;
        piTopPick = b.dataset.pick;
        piRenderTop();
    });
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
