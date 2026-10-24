// ========================================
// Credit Portfolio Intelligence — Risk Intelligence
//   ?view=contributors  Top Risk Contributors (Module 03)
//   ?view=quality       Portfolio Quality (Module 04)
//   ?view=growth        Growth vs Risk (Module 05)
// Contributors and Growth read GET /api/credit-intelligence/risk, Quality
// reads /quality; both take the shared filters plus ?dim=. Every figure
// comes from the server; this page sorts and lays it out. The NPL / PAR
// trend lives on Portfolio Overview only (no duplicate chart here).
// ========================================

const t = CI.t;
const RISK_VIEWS = ["contributors", "quality", "growth"];
const RISK_MIN_LOANS = 10; // ratio rankings skip tiny officer portfolios

let riskView = RISK_VIEWS.includes(new URLSearchParams(location.search).get("view")) ? new URLSearchParams(location.search).get("view") : "contributors";
let riskDim = new URLSearchParams(location.search).get("dim") || "branch";
let riskData = null;
let qualityData = null;
let gChart = null;
let cList = "top";          // Contributors: which top-10 list
let gQuad = "";             // Growth vs Risk: quadrant the table is narrowed to
let gSettingsLoaded = false;

function riskSaveView() {
    const p = new URLSearchParams(location.search);
    p.set("view", riskView);
    p.set("dim", riskDim);
    history.replaceState(null, "", `${location.pathname}?${p.toString()}`);
}

function riskSetView(view) {
    if (!RISK_VIEWS.includes(view) || view === riskView) return;
    riskView = view;
    document.getElementById("riskSummary").hidden = true;
    riskLoad();
}

async function riskLoad() {
    riskSaveView();
    document.querySelectorAll("#riskViews [data-view]").forEach(b => {
        const on = b.dataset.view === riskView;
        b.classList.toggle("is-active", on);
        b.setAttribute("aria-selected", on ? "true" : "false");
    });
    if (riskView === "growth" && !gSettingsLoaded) { gSettingsLoaded = true; gLoadSettings(); }
    document.querySelectorAll("#riskDims [data-dim]").forEach(b => {
        const on = b.dataset.dim === riskDim;
        b.classList.toggle("is-active", on);
        b.setAttribute("aria-selected", on ? "true" : "false");
    });
    ["contributors", "quality", "growth"].forEach(v => {
        document.getElementById(`view${v[0].toUpperCase()}${v.slice(1)}`).hidden = v !== riskView;
    });
    if (riskView === "quality") {
        const data = await CI.get("quality", { dim: riskDim });
        if (!data) return;
        qualityData = data;
        riskCommon(data);
        qRender();
    } else {
        const data = await CI.get("risk", {
            dim: riskDim,
            growth: document.getElementById("gGrowth").value,
            risk: document.getElementById("gRisk").value
        });
        if (!data) return;
        riskData = data;
        riskCommon(data);
        if (riskView === "contributors") cRender();
        else gRender();
    }
}

function riskCommon(d) {
    if (d.empty) return;
    CI.fillOptions(d.options, d.scope, d.period);
    CI.renderAsOf(document.getElementById("ciAsOf"), d);
    // Staff see only their own officer row.
    const staff = d.scope && d.scope.type === "officer";
    document.querySelectorAll("#riskDims [data-dim]").forEach(b => { b.disabled = staff && b.dataset.dim !== "officer"; });
    if (staff && riskDim !== "officer") { riskDim = "officer"; riskLoad(); }
}

function riskName(r) {
    if (riskDim === "location" && !r.name) return t("creditreport.pi.otherAddress");
    return r.name || r.key || "—";
}

// Where a row opens: branch / officer / product open NPL Management
// filtered to that row; a district opens its Daily Monitoring report.
function riskDrill(r, period) {
    const p = period || {};
    const dates = { fromDate: p.fromDate || "", toDate: p.toDate || "" };
    if (riskDim === "branch" && r.name) return `NplIntelligence.html?${new URLSearchParams({ branch: r.name, ...dates })}`;
    if (riskDim === "product" && r.name) return `NplIntelligence.html?${new URLSearchParams({ product: r.name, ...dates })}`;
    if (riskDim === "officer" && (r.id || r.key)) return `NplIntelligence.html?${new URLSearchParams({ officer: r.id || r.key, ...dates })}`;
    if (riskDim === "location") return r.name ? `RepDetailbyLocation.html?${new URLSearchParams({ district: r.name, section: "nbcOverdue" })}` : "";
    return "";
}

function riskDimName() {
    return t(`creditreport.risk.dim.${riskDim}`);
}

function riskSummary({ head, tone, sub, parts }) {
    const box = document.getElementById("riskSummary");
    box.hidden = false;
    box.innerHTML = `
        <div class="ci-sum-head is-${tone || "flat"}">${CI.esc(head)}</div>
        ${sub ? `<div class="ci-sum-sub">${CI.esc(sub)}</div>` : ""}
        ${parts && parts.length ? `<div class="ci-sum-parts">${parts.map(([label, v, tn]) => `<span class="ci-sum-part is-${tn || ""}">${CI.esc(label)} <b>${CI.esc(v)}</b></span>`).join("")}</div>` : ""}`;
}

// ---------- Module 03 — Top Risk Contributors ----------
const C_LISTS = [["top", "creditreport.risk.listTop"], ["bottom", "creditreport.risk.listBottom"], ["par", "creditreport.risk.listPar"], ["growth", "creditreport.risk.listGrowth"], ["newNpl", "creditreport.risk.listNew"]];

function cRows() {
    const list = cList;
    const rows = (riskData.rows || []).slice();
    const bigEnough = r => riskDim !== "officer" || (r.loans || 0) >= RISK_MIN_LOANS;
    if (list === "bottom") return rows.filter(r => r.os > 0 && bigEnough(r)).sort((a, b) => b.nplPct - a.nplPct).slice(0, 10);
    if (list === "par") return rows.filter(r => r.os > 0 && bigEnough(r)).sort((a, b) => b.parPct - a.parPct).slice(0, 10);
    if (list === "growth") return rows.filter(r => r.nplChange !== null && r.nplChange > 0).sort((a, b) => b.nplChange - a.nplChange).slice(0, 10);
    if (list === "newNpl") return rows.filter(r => r.newNpl && r.newNpl.value > 0).sort((a, b) => b.newNpl.value - a.newNpl.value).slice(0, 10);
    return rows.filter(r => r.nplValue > 0).sort((a, b) => b.nplValue - a.nplValue).slice(0, 10);
}

function cMetric(r, list) {
    if (list === "bottom") return { value: r.nplPct, text: CI.pct(r.nplPct) };
    if (list === "par") return { value: r.parPct, text: CI.pct(r.parPct) };
    if (list === "growth") return { value: r.nplChange, text: `+${CI.money(r.nplChange)}` };
    if (list === "newNpl") return { value: r.newNpl.value, text: CI.money(r.newNpl.value) };
    return { value: r.nplValue, text: CI.money(r.nplValue) };
}

function cSummary(d) {
    const tot = d.total || {};
    const top = (d.rows || []).filter(r => r.nplValue > 0).sort((a, b) => b.nplValue - a.nplValue)[0];
    const above = (d.rows || []).filter(r => r.os > 0 && r.nplPct > tot.nplPct).length;
    const osShare = top && tot.os ? top.os / tot.os : null;
    riskSummary({
        head: !top ? t("creditreport.risk.sum.none")
            : t(osShare !== null && top.contribution > osShare ? "creditreport.risk.sum.topOver" : "creditreport.risk.sum.top",
                { name: riskName(top), share: CI.pct(top.contribution, 1), npl: CI.money(top.nplValue), os: CI.pct(osShare || 0, 1) }),
        tone: top && osShare !== null && top.contribution > osShare ? "up" : "flat",
        sub: t("creditreport.risk.sum.totals", { npl: CI.money(tot.nplValue), ratio: CI.pct(tot.nplPct), par: CI.pct(tot.parPct) }),
        parts: d.reason === "officer_scope" ? [] : [[t("creditreport.risk.sum.above", { dim: riskDimName() }), CI.num(above), above ? "bad" : "good"]]
    });
}

function cRender() {
    const d = riskData;
    const list = cList;
    cSummary(d);
    document.getElementById("riskList").innerHTML = C_LISTS.map(([key, label]) =>
        `<button type="button" role="tab" class="pi-chip${key === list ? " is-active" : ""}" data-list="${key}" aria-selected="${key === list}">${CI.esc(t(label))}</button>`).join("");
    const note = document.getElementById("riskListNote");
    if (d.reason === "officer_scope") note.textContent = t("creditreport.risk.officerScope");
    else if (list === "growth" && !d.comparison.available) note.textContent = t(`creditreport.pi.cmpReason.${d.comparison.reason || "no_snapshot"}`);
    else if (list === "newNpl" && !d.newNpl.available) note.textContent = t(`creditreport.npl.reason.${d.newNpl.reason}`, { first: CI.dmy(d.newNpl.firstSaved) });
    else if ((list === "bottom" || list === "par") && riskDim === "officer") note.textContent = t("creditreport.pi.parMinNote", { n: RISK_MIN_LOANS });
    else note.textContent = list === "top" ? t("creditreport.risk.absNote") : list === "bottom" ? t("creditreport.risk.relNote") : "";

    const rows = cRows();
    const max = Math.max(...rows.map(r => Math.abs(cMetric(r, list).value) || 0), 1e-9);
    const totOs = (d.total || {}).os || 0;
    // Share of NPL against share of outstanding: red when a row holds more
    // of the NPL than of the loans.
    const shares = r => {
        const osShare = totOs ? r.os / totOs : null;
        const tone = osShare === null ? "" : r.contribution > osShare ? " pi-bad" : " pi-good";
        return `<span class="pi-rate${tone}">${CI.esc(t("creditreport.risk.contribution"))} ${CI.pct(r.contribution, 1)}</span>` +
            (osShare === null ? "" : ` / ${CI.esc(t("creditreport.risk.osShare"))} ${CI.pct(osShare, 1)}`);
    };
    document.getElementById("riskBars").innerHTML = rows.length ? rows.map(r => {
        const m = cMetric(r, list);
        const url = riskDrill(r, d.period);
        const tag = url ? "a" : "div";
        const sub = riskDim === "officer" ? `${r.branch} · ` : "";
        return `<${tag} class="pi-bar-row"${url ? ` href="${CI.esc(url)}"` : ""}>
            <div class="pi-bar-head"><span class="pi-bar-name">${CI.esc(riskName(r))}</span><span class="pi-bar-val">${CI.esc(m.text)}</span></div>
            <div class="pi-bar-track"><span class="pi-bar-fill" style="width:${(Math.abs(m.value) / max * 100).toFixed(1)}%"></span></div>
            <div class="pi-bar-meta">${CI.esc(sub)}${CI.esc(t("creditreport.pi.kOutstanding"))} ${CI.money(r.os)} · ${CI.esc(t("creditreport.pi.kNplPct"))} ${CI.pct(r.nplPct)}</div>
            <div class="pi-bar-meta">${shares(r)}</div>
        </${tag}>`;
    }).join("") : `<p class="pi-note">${CI.esc(t("creditreport.pi.nothing"))}</p>`;
    document.getElementById("riskHint").textContent = !rows.length ? ""
        : riskDim === "location" ? t("creditreport.pi.drillHint") : t("creditreport.risk.openNplHint");

    const cols = [
        ["name", "creditreport.risk.colName"], ["os", "creditreport.pi.kOutstanding"], ["nplValue", "creditreport.pi.kNplValue"],
        ["npl", "creditreport.pi.kNplAccounts"], ["nplPct", "creditreport.pi.kNplPct"], ["parPct", "creditreport.pi.kParPct"],
        ["nplGrowth", "creditreport.risk.colNplGrowth"], ["newNpl", "creditreport.risk.colNewNpl"], ["contribution", "creditreport.risk.contribution"]
    ];
    const cell = (r, k) => {
        if (k === "name") return `<td>${CI.esc(riskName(r))}${riskDim === "officer" ? `<div class="ci-sub">${CI.esc(r.branch)}</div>` : ""}</td>`;
        if (k === "os" || k === "nplValue") return `<td class="num">${CI.money(r[k])}</td>`;
        if (k === "npl") return `<td class="num">${CI.num(r.npl)}</td>`;
        if (k === "nplGrowth") return `<td class="num${r.nplGrowth > 0 ? " ci-bad" : r.nplGrowth < 0 ? " ci-good" : ""}">${CI.signedPct(r.nplGrowth)}</td>`;
        if (k === "newNpl") return `<td class="num">${r.newNpl ? CI.money(r.newNpl.value) : "—"}</td>`;
        if (k === "contribution") return `<td class="num">${CI.pct(r.contribution, 1)}</td>`;
        return `<td class="num">${CI.pct(r[k])}</td>`;
    };
    const tot = d.total || {};
    document.getElementById("riskTable").innerHTML =
        `<thead><tr>${cols.map(([k, l]) => `<th${k === "name" ? "" : ' class="num"'}>${CI.esc(t(l))}</th>`).join("")}</tr></thead>` +
        `<tbody>${rows.map(r => `<tr>${cols.map(([k]) => cell(r, k)).join("")}</tr>`).join("")}</tbody>` +
        `<tfoot><tr><th>${CI.esc(t("creditreport.risk.total"))}</th><th class="num">${CI.money(tot.os)}</th><th class="num">${CI.money(tot.nplValue)}</th><th class="num">${CI.num(tot.npl)}</th><th class="num">${CI.pct(tot.nplPct)}</th><th class="num">${CI.pct(tot.parPct)}</th><th class="num">${CI.signedPct(tot.nplGrowth)}</th><th></th><th class="num">100%</th></tr></tfoot>`;

    // The four dimensions add up to the same portfolio. When one doesn't
    // (loans with no officer / product / district in the lists), say why
    // in a folded note instead of a line of jargon under the table.
    const rc = d.reconciliation || {};
    const base = rc.branch;
    const gaps = base ? ["officer", "product", "location"].filter(k => rc[k] && Math.abs(rc[k].nplValue - base.nplValue) >= 0.5) : [];
    document.getElementById("riskReconBox").hidden = !gaps.length;
    document.getElementById("riskRecon").innerHTML = gaps.length
        ? gaps.map(k => CI.esc(t("creditreport.risk.reconLine", { dim: t(`creditreport.risk.dim.${k}`), npl: CI.money(rc[k].nplValue), diff: CI.money(Math.abs(rc[k].nplValue - base.nplValue)) }))).join("<br>") +
          `<br>${CI.esc(t("creditreport.risk.reconWhy", { npl: CI.money(base.nplValue) }))}`
        : "";
}

// ---------- Module 04 — Portfolio Quality ----------
const Q_CLASSES = [
    ["minor", "creditreport.quality.clsNormal", false], ["specialMention", "creditreport.quality.clsSm", false],
    ["subStandard", "creditreport.quality.clsSub", true], ["doubtful", "creditreport.quality.clsDoubtful", true], ["loss", "creditreport.quality.clsLoss", true]
];

function qRender() {
    const d = qualityData;
    const a = d.aging;
    const npl = Q_CLASSES.filter(c => c[2]).map(c => d.classes[c[0]]);
    const nplSum = { count: npl.reduce((s, c) => s + c.count, 0), value: npl.reduce((s, c) => s + c.value, 0), pct: npl.reduce((s, c) => s + c.pct, 0) };
    riskSummary({
        head: t("creditreport.risk.sum.par30", { pct: CI.pct(a.par30.pct), value: CI.money(a.par30.value), n: CI.num(a.par30.count) }),
        tone: "flat",
        sub: t("creditreport.risk.sum.nplClasses", { value: CI.money(nplSum.value), n: CI.num(nplSum.count), pct: CI.pct(nplSum.pct) }),
        parts: [["PAR 1", CI.pct(a.par1.pct)], ["PAR 60", CI.pct(a.par60.pct)], ["PAR 90", CI.pct(a.par90.pct)]]
    });
    document.getElementById("qAging").innerHTML = [1, 30, 60, 90].map(n => {
        const x = a[`par${n}`];
        return `<div class="ci-age"><div class="pi-kpi-label">PAR ${n}${CI.infoBtn()}</div><div class="ci-step-value">${CI.pct(x.pct)}</div><div class="pi-kpi-sub">${CI.money(x.value)} · ${CI.esc(t("creditreport.npl.accountsN", { n: CI.num(x.count) }))}</div>${CI.tip(`creditreport.risk.tip.par${n}`)}</div>`;
    }).join("");
    document.getElementById("qAgingNote").textContent = t("creditreport.quality.agingNote", { os: CI.money(d.outstanding), date: CI.dmy(d.overdueAsOf) });

    // NBC classes with a bar each; the three NPL classes are marked and totalled.
    const maxPct = Math.max(...Q_CLASSES.map(c => d.classes[c[0]].pct), 1e-9);
    document.getElementById("qClasses").innerHTML =
        `<thead><tr><th>${CI.esc(t("creditreport.quality.class"))}</th><th class="num">${CI.esc(t("creditreport.quality.accounts"))}</th><th class="num">${CI.esc(t("creditreport.quality.amount"))}</th><th class="num">${CI.esc(t("creditreport.quality.ofOs"))}</th></tr></thead><tbody>` +
        Q_CLASSES.map(([k, label, isNpl]) => {
            const c = d.classes[k];
            return `<tr${isNpl ? ' class="ci-npl-cls"' : ""}><td>${CI.esc(t(label))}${isNpl ? ' <span class="ci-npl-tag">NPL</span>' : ""}</td><td class="num">${CI.num(c.count)}</td><td class="num">${CI.money(c.value)}</td><td class="num">${CI.pct(c.pct)}<div class="ci-mini${isNpl ? " is-bad" : ""}"><span style="width:${(c.pct / maxPct * 100).toFixed(1)}%"></span></div></td></tr>`;
        }).join("") + "</tbody>" +
        `<tfoot><tr><th>${CI.esc(t("creditreport.risk.nplTotal"))}</th><th class="num">${CI.num(nplSum.count)}</th><th class="num">${CI.money(nplSum.value)}</th><th class="num">${CI.pct(nplSum.pct)}</th></tr></tfoot>`;

    // Risk distribution as cards: each rate red above the portfolio's, green below.
    const os = d.outstanding || 0;
    const avg = {
        par1: a.par1.pct, par30: a.par30.pct, par60: a.par60.pct, par90: a.par90.pct,
        npl: os ? nplSum.value / os : null,
        par: os ? Q_CLASSES.reduce((s, c) => s + d.classes[c[0]].value, 0) / os : null
    };
    const rate = (label, v, ref) => {
        const tone = ref == null ? "" : v > ref ? " pi-bad" : v < ref ? " pi-good" : "";
        return `<span class="ci-dist-rate pi-rate${tone}">${CI.esc(label)} <b>${CI.pct(v)}</b></span>`;
    };
    document.getElementById("qDistLegend").textContent = t("creditreport.risk.distLegend");
    const dist = (d.distribution || []).slice().sort((x, y) => y.par30.value - x.par30.value);
    document.getElementById("qDist").innerHTML = dist.length ? dist.map(r => {
        const url = riskDrill(r, d.period);
        const tag = url ? "a" : "div";
        const name = riskDim === "location" && !r.name ? t("creditreport.pi.otherAddress") : r.name;
        return `<${tag} class="ci-dist-row"${url ? ` href="${CI.esc(url)}"` : ""}>
            <div class="pi-bar-head"><span class="pi-bar-name">${CI.esc(name)}${riskDim === "officer" && r.branch ? ` <small class="ci-sub">${CI.esc(r.branch)}</small>` : ""}</span><span class="pi-bar-val">${CI.money(r.os)}</span></div>
            <div class="ci-dist-rates">${rate("PAR 1", r.par1.pct, avg.par1)}${rate("PAR 30", r.par30.pct, avg.par30)}${rate("PAR 60", r.par60.pct, avg.par60)}${rate("PAR 90", r.par90.pct, avg.par90)}${rate(t("creditreport.pi.kNplPct"), r.nplPct, avg.npl)}</div>
        </${tag}>`;
    }).join("") : `<p class="pi-note">${CI.esc(t("creditreport.pi.nothing"))}</p>`;
    try { document.getElementById("qTrendLink").href = `PortfolioIntelligence.html?${CI.query().toString()}`; } catch (e) { /* keep the plain link */ }
}

// ---------- Module 05 — Growth vs Risk ----------
const G_QUADS = ["healthy", "risky", "weak", "stable"];

function gRender() {
    const d = riskData;
    const gr = d.growthRisk;
    const th = gr.thresholds;
    const gLabel = t(gr.growthField === "disbGrowth" ? "creditreport.growth.disbGrowth" : "creditreport.growth.osGrowth");
    const rLabel = t(gr.riskField === "parPct" ? "creditreport.pi.kParPct" : "creditreport.pi.kNplPct");
    const noTh = th.growth === null || th.risk === null;
    const thText = noTh
        ? t(`creditreport.pi.cmpReason.${d.comparison.reason || "no_snapshot"}`)
        : t(th.mode === "fixed" ? "creditreport.growth.thFixed" : "creditreport.growth.thAverage", {
            growth: CI.signedPct(th.growth), risk: CI.pct(th.risk), gLabel, rLabel
        });
    const rows = (d.rows || []).filter(r => r.quadrant);
    const counts = Object.fromEntries(G_QUADS.map(q => [q, rows.filter(r => r.quadrant === q).length]));
    const weak = rows.filter(r => r.quadrant === "weak").sort((a, b) => b.os - a.os);
    riskSummary({
        head: noTh || !rows.length ? thText
            : weak.length ? t("creditreport.risk.sum.weak", { n: weak.length, total: rows.length, dim: riskDimName(), names: weak.slice(0, 3).map(riskName).join(", ") + (weak.length > 3 ? "…" : "") })
            : t("creditreport.risk.sum.noWeak", { dim: riskDimName() }),
        tone: noTh || !rows.length ? "flat" : weak.length ? "up" : "down",
        sub: noTh ? "" : thText
    });
    if (gQuad && !counts[gQuad]) gQuad = "";
    document.getElementById("gQuads").innerHTML = G_QUADS.map(q =>
        `<button type="button" class="ci-quad ci-quad-${q}${gQuad === q ? " is-active" : ""}" data-q="${q}" aria-pressed="${gQuad === q}"><span class="ci-quad-dot" aria-hidden="true"></span><span>${CI.esc(t(`creditreport.growth.q.${q}`))}</span><strong>${counts[q]}</strong></button>`).join("");
    document.getElementById("gQuadNote").textContent = gQuad ? `${t(`creditreport.risk.qdef.${gQuad}`)} ${t("creditreport.risk.quadTap")}` : t("creditreport.risk.quadHint");
    document.getElementById("gQuadDefs").innerHTML = G_QUADS.map(q =>
        `<li class="ci-quad-${q}"><span class="ci-quad-dot" aria-hidden="true"></span><b>${CI.esc(t(`creditreport.growth.q.${q}`))}</b> — ${CI.esc(t(`creditreport.risk.qdef.${q}`))}</li>`).join("");

    if (gChart) { gChart.destroy(); gChart = null; }
    const empty = document.getElementById("gEmpty");
    const box = document.getElementById("gChart").parentElement;
    empty.hidden = !!rows.length;
    box.hidden = !rows.length;
    if (!rows.length) empty.textContent = t(`creditreport.pi.cmpReason.${d.comparison.reason || "no_snapshot"}`);

    if (rows.length && typeof Chart !== "undefined") {
        const col = CI.chartColors();
        const colorOf = { healthy: col.good, risky: col.b, weak: col.bad, stable: col.a };
        const maxOs = Math.max(...rows.map(r => r.os), 1);
        const font = { family: "KRASAR, sans-serif", size: 11 };
        const ds = G_QUADS.map(q => ({
            label: t(`creditreport.growth.q.${q}`),
            data: rows.filter(r => r.quadrant === q).map(r => ({
                x: r[gr.growthField] * 100, y: r[gr.riskField] * 100,
                r: 4 + 14 * Math.sqrt(r.os / maxOs), name: riskName(r), os: r.os
            })),
            backgroundColor: colorOf[q] + "B3",
            borderColor: col.surface,
            borderWidth: 2
        }));
        // Names next to the bubbles (the largest few when there are many),
        // and each quadrant's name in its corner.
        const named = new Set((rows.length > 12 ? rows.slice().sort((a, b) => b.os - a.os).slice(0, 8) : rows).map(riskName));
        const guide = {
            id: "ciQuadLines",
            afterDatasetsDraw(chart) {
                const { ctx } = chart;
                ctx.save();
                ctx.font = "11px KRASAR, sans-serif";
                ctx.fillStyle = col.text;
                ctx.textBaseline = "middle";
                ctx.textAlign = "left";
                const a = chart.chartArea;
                // Corner names first, so bubble names keep clear of them.
                const used = [[a.left, a.top, a.left + 110, a.top + 22], [a.right - 110, a.top, a.right, a.top + 22],
                    [a.left, a.bottom - 20, a.left + 110, a.bottom], [a.right - 110, a.bottom - 20, a.right, a.bottom]];
                const hits = b => used.some(u => b[0] < u[2] && b[2] > u[0] && b[1] < u[3] && b[3] > u[1]);
                chart.data.datasets.forEach((set, i) => {
                    chart.getDatasetMeta(i).data.forEach((el, j) => {
                        const raw = set.data[j];
                        if (!raw || !named.has(raw.name)) return;
                        const w = ctx.measureText(raw.name).width;
                        // Right, left, below, above the bubble — the first spot that is free.
                        const spots = [[el.x + raw.r + 4, el.y], [el.x - raw.r - 4 - w, el.y], [el.x - w / 2, el.y + raw.r + 9], [el.x - w / 2, el.y - raw.r - 9]];
                        const spot = spots.map(([x, y]) => [x, y, [x, y - 7, x + w, y + 7]])
                            .find(([x, y, b]) => b[0] >= a.left && b[2] <= a.right && b[1] >= a.top && b[3] <= a.bottom && !hits(b));
                        if (!spot) return;
                        used.push(spot[2]);
                        ctx.fillText(raw.name, spot[0], spot[1]);
                    });
                });
                ctx.restore();
            },
            afterDraw(chart) {
                const { ctx, chartArea: a, scales: { x, y } } = chart;
                ctx.save();
                ctx.font = "bold 10.5px KRASAR, sans-serif";
                ctx.globalAlpha = 0.85;
                [["weak", a.left + 6, a.top + 12, "left"], ["risky", a.right - 6, a.top + 12, "right"],
                 ["stable", a.left + 6, a.bottom - 10, "left"], ["healthy", a.right - 6, a.bottom - 10, "right"]].forEach(([q, qx, qy, align]) => {
                    ctx.fillStyle = colorOf[q];
                    ctx.textAlign = align;
                    ctx.fillText(t(`creditreport.growth.q.${q}`), qx, qy);
                });
                ctx.globalAlpha = 1;
                ctx.strokeStyle = col.text;
                ctx.setLineDash([4, 4]);
                ctx.lineWidth = 1;
                const px = x.getPixelForValue(th.growth * 100);
                const py = y.getPixelForValue(th.risk * 100);
                if (px >= a.left && px <= a.right) { ctx.beginPath(); ctx.moveTo(px, a.top); ctx.lineTo(px, a.bottom); ctx.stroke(); }
                if (py >= a.top && py <= a.bottom) { ctx.beginPath(); ctx.moveTo(a.left, py); ctx.lineTo(a.right, py); ctx.stroke(); }
                ctx.restore();
            }
        };
        gChart = new Chart(document.getElementById("gChart"), {
            type: "bubble",
            data: { datasets: ds },
            plugins: [guide],
            options: {
                responsive: true, maintainAspectRatio: false, animation: false,
                plugins: {
                    // The quadrant chips above the chart are its legend (with counts).
                    legend: { display: false },
                    tooltip: { callbacks: { label: c => `${c.raw.name}: ${gLabel} ${c.raw.x.toFixed(1)}% · ${rLabel} ${c.raw.y.toFixed(2)}% · ${CI.money(c.raw.os)}` } }
                },
                scales: {
                    x: { title: { display: true, text: gLabel, color: col.text, font }, grid: { color: col.grid }, ticks: { color: col.text, font, callback: v => `${v}%` } },
                    y: { grace: "25%", title: { display: true, text: rLabel, color: col.text, font }, grid: { color: col.grid }, border: { display: false }, ticks: { color: col.text, font, callback: v => `${v}%` } }
                }
            }
        });
    }

    const all = (d.rows || []).filter(r => !gQuad || r.quadrant === gQuad).sort((a, b) => b.os - a.os);
    document.getElementById("gTable").innerHTML =
        `<thead><tr><th>${CI.esc(t("creditreport.risk.colName"))}</th><th class="num">${CI.esc(t("creditreport.growth.osGrowth"))}</th><th class="num">${CI.esc(t("creditreport.growth.disbGrowth"))}</th><th class="num">${CI.esc(t("creditreport.risk.colNplGrowth"))}</th><th class="num">${CI.esc(t("creditreport.growth.parChange"))}</th><th class="num">${CI.esc(t("creditreport.risk.colNewNpl"))}</th><th>${CI.esc(t("creditreport.growth.quadrant"))}</th></tr></thead><tbody>` +
        all.map(r => `<tr><td>${CI.esc(riskName(r))}${riskDim === "officer" ? `<div class="ci-sub">${CI.esc(r.branch)}</div>` : ""}</td><td class="num">${CI.signedPct(r.osGrowth)}</td><td class="num">${CI.signedPct(r.disbGrowth)}</td><td class="num">${CI.signedPct(r.nplGrowth)}</td><td class="num">${CI.pts(r.parChange)}</td><td class="num">${r.newNpl ? CI.money(r.newNpl.value) : "—"}</td><td>${r.quadrant ? CI.esc(t(`creditreport.growth.q.${r.quadrant}`)) : "—"}</td></tr>`).join("") + "</tbody>";
}

// Admin: the thresholds every user's chart uses.
async function gLoadSettings() {
    const user = JSON.parse(localStorage.getItem("loggedInUser") || sessionStorage.getItem("loggedInUser") || "{}");
    if (String(user.role || "").toLowerCase() !== "admin") return;
    const box = document.getElementById("gAdmin");
    box.hidden = false;
    try {
        const res = await fetch(`${API.BASE_URL}/api/admin/credit-intelligence/settings`, {
            headers: { Authorization: `Bearer ${localStorage.getItem("token") || sessionStorage.getItem("token")}` }
        });
        const data = await res.json();
        if (!data.ok) return;
        document.getElementById("gMode").value = data.growthRisk.mode;
        document.getElementById("gGrowthPct").value = data.growthRisk.growthPct ?? "";
        document.getElementById("gRiskPct").value = data.growthRisk.riskPct ?? "";
    } catch (e) {
        console.error(e);
    }
}

async function gSaveSettings() {
    const body = {
        growthRisk: {
            mode: document.getElementById("gMode").value,
            growthPct: document.getElementById("gGrowthPct").value,
            riskPct: document.getElementById("gRiskPct").value
        }
    };
    try {
        const res = await fetch(`${API.BASE_URL}/api/admin/credit-intelligence/settings`, {
            method: "PUT",
            headers: { Authorization: `Bearer ${localStorage.getItem("token") || sessionStorage.getItem("token")}`, "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.message || "");
        if (body.growthRisk.mode === "fixed" && data.growthRisk.mode !== "fixed") CI.toast(t("creditreport.growth.needBoth"), "error");
        else CI.toast(t("creditreport.growth.saved"), "success");
        riskLoad();
    } catch (e) {
        console.error(e);
        CI.toast(t("creditreport.pi.loadFailed"), "error");
    }
}

document.addEventListener("DOMContentLoaded", () => {
    CI.mountFilters({ onChange: riskLoad });
    document.getElementById("riskDims").addEventListener("click", e => {
        const b = e.target.closest("[data-dim]");
        if (!b || b.disabled) return;
        riskDim = b.dataset.dim;
        riskLoad();
    });
    document.getElementById("riskViews").addEventListener("click", e => {
        const b = e.target.closest("[data-view]");
        if (b) riskSetView(b.dataset.view);
    });
    document.getElementById("riskList").addEventListener("click", e => {
        const b = e.target.closest("[data-list]");
        if (!b || !riskData) return;
        cList = b.dataset.list;
        cRender();
    });
    document.getElementById("gQuads").addEventListener("click", e => {
        const b = e.target.closest("[data-q]");
        if (!b || !riskData) return;
        gQuad = gQuad === b.dataset.q ? "" : b.dataset.q;
        gRender();
    });
    ["gGrowth", "gRisk"].forEach(id => document.getElementById(id).addEventListener("change", riskLoad));
    document.getElementById("gSave").addEventListener("click", gSaveSettings);
    new MutationObserver(() => {
        if (riskView === "growth" && riskData) gRender();
    }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    riskLoad();
});
