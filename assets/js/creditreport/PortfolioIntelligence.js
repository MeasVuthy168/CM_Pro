// ========================================
// Credit Portfolio Intelligence — Portfolio Overview (Module 01)
// One request to GET /api/credit-intelligence/overview, which builds
// every figure on the server from the 4 Daily Monitoring reports' own
// engines and Daily History snapshots, scoped to the user's role. This
// page only lays the answer out — it never computes a financial figure
// itself, and shows "—" where the server says a figure isn't available.
// Filters live in the address bar (replaceState) so Back returns here
// with the same view, like the reports.
// ========================================

const piToken = localStorage.getItem("token") || sessionStorage.getItem("token");
const t = (key, vars) => (window.CMI18n ? CMI18n.t(key, vars) : key);

const PI_MULTI = { piBranch: "branch", piOfficer: "officer", piProduct: "product", piDistrict: "district" };
const PI_FOCUS = ["piOfficer", "piProduct", "piDistrict"];

let piData = null;
let piCompTab = "branch";
let piReqSeq = 0;
let piCharts = [];

// ---------- formatting ----------
function piEsc(text) {
    return String(text ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function piNum(n) {
    return (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
}
function piMoney(n) {
    return "$" + piNum(n);
}
function piPct(n, digits = 2) {
    return ((Number(n) || 0) * 100).toFixed(digits) + "%";
}
function piPts(n) {
    return `${((Number(n) || 0) * 100).toFixed(2)} ${t("creditreport.pi.pts")}`;
}
function piDMY(k) {
    if (!k) return "—";
    const [y, m, d] = k.split("-");
    return `${d}/${m}/${y}`;
}
function piShortMonth(k) {
    const [y, m, d] = k.split("-");
    return `${d}/${m}/${y.slice(2)}`;
}

// ---------- filters <-> URL ----------
function piPicks(id) {
    const el = document.getElementById(id);
    return el && window.MultiSelect && el._msBtn ? MultiSelect.values(el) : [];
}

function piQuery() {
    const p = new URLSearchParams();
    const from = document.getElementById("piFrom").value;
    const to = document.getElementById("piTo").value;
    if (from) p.set("fromDate", from);
    if (to) p.set("toDate", to);
    const cmp = document.getElementById("piCompare").value;
    p.set("compare", cmp);
    const cmpDate = document.getElementById("piCompareDate").value;
    if (cmp === "date" && cmpDate) p.set("compareDate", cmpDate);
    Object.entries(PI_MULTI).forEach(([id, key]) => piPicks(id).forEach(v => p.append(key, v)));
    return p;
}

// Picks from the URL, applied once the options exist.
const piPending = (() => {
    const p = new URLSearchParams(location.search);
    const out = {};
    Object.entries(PI_MULTI).forEach(([id, key]) => { out[id] = p.getAll(key).filter(Boolean); });
    if (p.get("fromDate")) document.getElementById("piFrom").value = p.get("fromDate");
    if (p.get("toDate")) document.getElementById("piTo").value = p.get("toDate");
    if (p.get("compare")) document.getElementById("piCompare").value = p.get("compare");
    if (p.get("compareDate")) document.getElementById("piCompareDate").value = p.get("compareDate");
    return out;
})();

function piQueryFromPending() {
    const p = piQuery();
    Object.entries(PI_MULTI).forEach(([id, key]) => {
        if (!piPicks(id).length) (piPending[id] || []).forEach(v => p.append(key, v));
    });
    return p;
}

// ---------- options ----------
function piFillSelect(id, items) {
    const el = document.getElementById(id);
    const keep = piPending[id] && piPending[id].length ? piPending[id] : piPicks(id);
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
    piPending[id] = [];
}

function piFillOptions(opt, scope) {
    piFillSelect("piBranch", (opt.branches || []).map(b => ({ value: b, label: b })));
    piFillSelect("piOfficer", (opt.officers || []).map(o => ({ value: o.id, label: `${o.name || o.id} · ${o.branch}` })));
    piFillSelect("piProduct", (opt.products || []).map(p => ({ value: p, label: p })));
    piFillSelect("piDistrict", (opt.districts || []).map(d => ({ value: d, label: d })));
    // Someone limited to one branch or their own officer row can't widen
    // it here (the server enforces it either way).
    const lockBranch = scope && scope.type !== "all";
    const lockAll = scope && scope.type === "officer";
    piSetDisabled("piBranch", lockBranch);
    PI_FOCUS.forEach(id => piSetDisabled(id, lockAll));
    if (!lockAll) piApplyFocusLock();
}

function piSetDisabled(id, on) {
    const el = document.getElementById(id);
    el.disabled = on;
    if (el._msBtn) el._msBtn.disabled = on;
    el.closest(".pi-field").classList.toggle("is-disabled", on);
}

// One of Officer / Product / District at a time.
function piApplyFocusLock() {
    const active = PI_FOCUS.find(id => piPicks(id).length);
    PI_FOCUS.forEach(id => piSetDisabled(id, !!active && id !== active));
}

// ---------- load ----------
async function piLoad({ initial = false } = {}) {
    const seq = ++piReqSeq;
    const q = initial ? piQueryFromPending() : piQuery();
    history.replaceState(null, "", `${location.pathname}?${q.toString()}`);
    if (typeof showAppLoading === "function") showAppLoading(t("creditreport.pi.loading"), { progress: true, key: "pi-overview" });
    try {
        const res = await fetch(`${API.BASE_URL}/api/credit-intelligence/overview?${q.toString()}`, {
            headers: { Authorization: `Bearer ${piToken}` }
        });
        const data = await res.json();
        if (seq !== piReqSeq) return;
        if (!data.ok) {
            piToast(data.code === "focus_conflict" ? t("creditreport.pi.focusNote") : (data.message || t("creditreport.pi.loadFailed")), "error");
            return;
        }
        piData = data;
        piRender();
    } catch (e) {
        console.error(e);
        if (seq === piReqSeq) piToast(t("creditreport.pi.loadFailed"), "error");
    } finally {
        if (seq === piReqSeq && typeof hideAppLoading === "function") hideAppLoading();
    }
}

function piToast(message, type) {
    if (typeof CMToast !== "undefined" && typeof CMToast.show === "function") {
        CMToast.show({ type, title: message, message: "", duration: 3500 });
    }
}

// ---------- render ----------
function piRender() {
    const d = piData;
    if (d.empty) {
        document.getElementById("piKpis").innerHTML = `<p class="pi-note">${piEsc(t("creditreport.pi.noAccess"))}</p>`;
        return;
    }
    piFillOptions(d.options || {}, d.scope);
    if (!document.getElementById("piFrom").value) document.getElementById("piFrom").value = d.period.fromDate || "";
    if (!document.getElementById("piTo").value) document.getElementById("piTo").value = d.period.toDate || "";
    piRenderAsOf(d);
    piRenderAlerts(d);
    piRenderKpis(d);
    piRenderTrend(d);
    piRenderComp();
    piRenderTop();
}

function piRenderAsOf(d) {
    const a = d.asOf;
    const c = d.comparison;
    const status = a.outdated
        ? `<span class="pi-badge pi-badge-bad"><span aria-hidden="true">⚠</span> ${piEsc(t("creditreport.pi.outdated", { days: a.businessDaysBehind }))}</span>`
        : `<span class="pi-badge pi-badge-good"><span aria-hidden="true">✓</span> ${piEsc(t("creditreport.pi.upToDate"))}</span>`;
    const cmp = c.available
        ? t("creditreport.pi.comparedWith", { date: piDMY(c.date) })
        : t(`creditreport.pi.cmpReason.${c.reason || "no_snapshot"}`);
    document.getElementById("piAsOf").innerHTML = `
        <div class="pi-asof-row">
            <span class="pi-asof-label">${piEsc(t("creditreport.pi.dataAsOf"))}</span>
            <strong>${piEsc(piDMY(a.osDate))}</strong>
            ${status}
        </div>
        <div class="pi-asof-sources">
            <span>${piEsc(t("creditreport.pi.srcOs"))}: ${piEsc(a.osText)}</span>
            <span>${piEsc(t("creditreport.pi.srcOverdue"))}: ${piEsc(a.overdueText)}</span>
            <span>${piEsc(t("creditreport.pi.srcT24"))}: ${piEsc(a.t24Text)}</span>
        </div>
        <div class="pi-asof-cmp">${piEsc(t("creditreport.pi.period", { from: piDMY(d.period.fromDate), to: piDMY(d.period.toDate) }))} · ${piEsc(cmp)}</div>`;
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

function piChartColors() {
    const dark = ["dark", "darkgray"].includes(document.documentElement.getAttribute("data-theme"));
    const css = getComputedStyle(document.documentElement);
    // Validated (dataviz palette check) for each surface: navy + gold
    // steps that keep 3:1 contrast and stay apart for colour-blind readers.
    return dark
        ? { a: "#4C7FD9", b: "#B8891A", grid: "rgba(255,255,255,.08)", text: css.getPropertyValue("--cr-text-muted").trim() || "#8FA0C7" }
        : { a: "#2456A8", b: "#B8860B", grid: "rgba(0,0,0,.06)", text: css.getPropertyValue("--cr-text-muted").trim() || "#6B7280" };
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
    const pts = tr.points;
    const labels = pts.map(p => piShortMonth(p.date) + (p.live ? " *" : ""));
    table.innerHTML = `<thead><tr><th>${piEsc(t("creditreport.pi.date"))}</th><th>${piEsc(t("creditreport.pi.kOutstanding"))}</th><th>${piEsc(t("creditreport.pi.kNplValue"))}</th><th>${piEsc(t("creditreport.pi.kNplPct"))}</th><th>${piEsc(t("creditreport.pi.kParPct"))}</th></tr></thead><tbody>` +
        pts.map(p => `<tr><td>${piEsc(piDMY(p.date))}${p.live ? " *" : ""}</td><td>${piMoney(p.os)}</td><td>${piMoney(p.nplValue)}</td><td>${piPct(p.nplPct)}</td><td>${piPct(p.parPct)}</td></tr>`).join("") +
        `</tbody><caption>${piEsc(t("creditreport.pi.liveNote"))}</caption>`;
    if (typeof Chart === "undefined") return;
    const col = piChartColors();
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
        data: { labels, datasets: [{ label: t("creditreport.pi.kOutstanding"), data: pts.map(p => p.os), borderColor: col.a, backgroundColor: col.a, borderWidth: 2, pointRadius: 4, tension: 0.25 }] },
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
                { label: t("creditreport.pi.kNplPct"), data: pts.map(p => p.nplPct * 100), borderColor: col.a, backgroundColor: col.a, borderWidth: 2, pointRadius: 4, tension: 0.25 },
                { label: t("creditreport.pi.kParPct"), data: pts.map(p => p.parPct * 100), borderColor: col.b, backgroundColor: col.b, borderWidth: 2, pointRadius: 4, pointStyle: "rectRot", borderDash: [6, 3], tension: 0.25 }
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
let piDebounce = null;
function piChanged() {
    clearTimeout(piDebounce);
    piDebounce = setTimeout(() => piLoad(), 250);
}

document.addEventListener("DOMContentLoaded", () => {
    if (window.MultiSelect) Object.keys(PI_MULTI).forEach(id => MultiSelect.enhance(document.getElementById(id), { copyClass: true }));
    const cmp = document.getElementById("piCompare");
    const syncCmp = () => { document.getElementById("piCompareDateWrap").hidden = cmp.value !== "date"; };
    syncCmp();
    cmp.addEventListener("change", () => { syncCmp(); if (cmp.value !== "date" || document.getElementById("piCompareDate").value) piChanged(); });
    ["piFrom", "piTo", "piCompareDate"].forEach(id => document.getElementById(id).addEventListener("change", piChanged));
    Object.keys(PI_MULTI).forEach(id => document.getElementById(id).addEventListener("change", () => {
        if (PI_FOCUS.includes(id)) piApplyFocusLock();
        piChanged();
    }));
    document.getElementById("piReset").addEventListener("click", () => {
        ["piFrom", "piTo", "piCompareDate"].forEach(id => { document.getElementById(id).value = ""; });
        cmp.value = "month";
        syncCmp();
        Object.keys(PI_MULTI).forEach(id => {
            const el = document.getElementById(id);
            if (!el.disabled || PI_FOCUS.includes(id)) {
                if (window.MultiSelect && el._msBtn) MultiSelect.setValues(el, []);
            }
        });
        if (!piData || !piData.scope || piData.scope.type !== "officer") piApplyFocusLock();
        piLoad();
    });
    document.getElementById("piCompTabs").addEventListener("click", e => {
        const b = e.target.closest("[data-tab]");
        if (!b || !piData) return;
        piCompTab = b.dataset.tab;
        piRenderComp();
    });
    document.getElementById("piTopPick").addEventListener("change", () => { if (piData) piRenderTop(); });
    // Charts read the theme's colours when drawn.
    new MutationObserver(() => { if (piData && !piData.empty) piRenderTrend(piData); })
        .observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    piLoad({ initial: true });
});
