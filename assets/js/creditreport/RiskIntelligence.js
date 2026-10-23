// ========================================
// Credit Portfolio Intelligence — Risk Intelligence
//   ?view=contributors  Top Risk Contributors (Module 03)
//   ?view=quality       Portfolio Quality (Module 04)
//   ?view=growth        Growth vs Risk (Module 05)
// Contributors and Growth read GET /api/credit-intelligence/risk, Quality
// reads /quality; both take the shared filters plus ?dim=. Every figure
// comes from the server; this page sorts and lays it out.
// ========================================

const t = CI.t;
const RISK_VIEWS = ["contributors", "quality", "growth"];
const RISK_MIN_LOANS = 10; // ratio rankings skip tiny officer portfolios

let riskView = RISK_VIEWS.includes(new URLSearchParams(location.search).get("view")) ? new URLSearchParams(location.search).get("view") : "contributors";
let riskDim = new URLSearchParams(location.search).get("dim") || "branch";
let riskData = null;
let qualityData = null;
let qGrain = "monthly";
let qChart = null;
let gChart = null;

function riskSaveView() {
    const p = new URLSearchParams(location.search);
    p.set("view", riskView);
    p.set("dim", riskDim);
    history.replaceState(null, "", `${location.pathname}?${p.toString()}`);
}

async function riskLoad() {
    riskSaveView();
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

// Where a row opens in the existing reports.
function riskDrill(r) {
    const p = riskData ? riskData.period : qualityData.period;
    const dates = { fromDate: p.fromDate || "", toDate: p.toDate || "" };
    if (riskDim === "branch") return `BranchProductivity.html?${new URLSearchParams({ branch: r.name, ...dates })}`;
    if (riskDim === "product") return `ProductPerformance.html?${new URLSearchParams({ product: r.name, ...dates })}`;
    if (riskDim === "location") return r.name ? `RepDetailbyLocation.html?${new URLSearchParams({ district: r.name, section: "nbcOverdue" })}` : "";
    if (riskDim === "officer") return `RepDetailbyCO.html?${new URLSearchParams({ branch: r.branch || "", section: "nbcOverdue" })}`;
    return "";
}

// ---------- Module 03 — Top Risk Contributors ----------
function cRows() {
    const list = document.getElementById("riskList").value;
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

function cRender() {
    const d = riskData;
    const list = document.getElementById("riskList").value;
    const note = document.getElementById("riskListNote");
    if (d.reason === "officer_scope") note.textContent = t("creditreport.risk.officerScope");
    else if (list === "growth" && !d.comparison.available) note.textContent = t(`creditreport.pi.cmpReason.${d.comparison.reason || "no_snapshot"}`);
    else if (list === "newNpl" && !d.newNpl.available) note.textContent = t(`creditreport.npl.reason.${d.newNpl.reason}`, { first: CI.dmy(d.newNpl.firstSaved) });
    else if ((list === "bottom" || list === "par") && riskDim === "officer") note.textContent = t("creditreport.pi.parMinNote", { n: RISK_MIN_LOANS });
    else note.textContent = list === "top" ? t("creditreport.risk.absNote") : list === "bottom" ? t("creditreport.risk.relNote") : "";

    const rows = cRows();
    const max = Math.max(...rows.map(r => Math.abs(cMetric(r, list).value) || 0), 1e-9);
    document.getElementById("riskBars").innerHTML = rows.length ? rows.map(r => {
        const m = cMetric(r, list);
        const url = riskDrill(r);
        const tag = url ? "a" : "div";
        const sub = riskDim === "officer" ? `${r.branch} · ` : "";
        return `<${tag} class="pi-bar-row"${url ? ` href="${CI.esc(url)}"` : ""}>
            <div class="pi-bar-head"><span class="pi-bar-name">${CI.esc(riskName(r))}</span><span class="pi-bar-val">${CI.esc(m.text)}</span></div>
            <div class="pi-bar-track"><span class="pi-bar-fill" style="width:${(Math.abs(m.value) / max * 100).toFixed(1)}%"></span></div>
            <div class="pi-bar-meta">${CI.esc(sub)}${CI.esc(t("creditreport.pi.kOutstanding"))} ${CI.money(r.os)} · ${CI.esc(t("creditreport.pi.kNplPct"))} ${CI.pct(r.nplPct)} · ${CI.esc(t("creditreport.risk.contribution"))} ${CI.pct(r.contribution, 1)}</div>
        </${tag}>`;
    }).join("") : `<p class="pi-note">${CI.esc(t("creditreport.pi.nothing"))}</p>`;

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

    // The four dimensions add up to the same portfolio — or the gap is shown.
    const rc = d.reconciliation || {};
    const base = rc.branch;
    const gaps = base ? ["officer", "product", "location"].filter(k => rc[k] && Math.abs(rc[k].nplValue - base.nplValue) >= 0.5)
        .map(k => t("creditreport.risk.reconGap", { dim: t(`creditreport.risk.dim.${k}`), diff: CI.money(rc[k].nplValue - base.nplValue) })) : [];
    document.getElementById("riskRecon").textContent = !base ? "" : gaps.length
        ? `${t("creditreport.risk.reconTitle", { npl: CI.money(base.nplValue) })} ${gaps.join(" · ")}`
        : t("creditreport.risk.reconOk", { npl: CI.money(base.nplValue) });
}

// ---------- Module 04 — Portfolio Quality ----------
function qRender() {
    const d = qualityData;
    const a = d.aging;
    document.getElementById("qAging").innerHTML = [1, 30, 60, 90].map(n => {
        const x = a[`par${n}`];
        return `<div class="ci-age"><div class="pi-kpi-label">PAR ${n}</div><div class="ci-step-value">${CI.pct(x.pct)}</div><div class="pi-kpi-sub">${CI.money(x.value)} · ${CI.esc(t("creditreport.npl.accountsN", { n: CI.num(x.count) }))}</div></div>`;
    }).join("");
    document.getElementById("qAgingNote").textContent = t("creditreport.quality.agingNote", { os: CI.money(d.outstanding), date: CI.dmy(d.overdueAsOf) });

    const names = { minor: "creditreport.quality.clsNormal", specialMention: "creditreport.quality.clsSm", subStandard: "creditreport.quality.clsSub", doubtful: "creditreport.quality.clsDoubtful", loss: "creditreport.quality.clsLoss" };
    document.getElementById("qClasses").innerHTML =
        `<thead><tr><th>${CI.esc(t("creditreport.quality.class"))}</th><th class="num">${CI.esc(t("creditreport.quality.accounts"))}</th><th class="num">${CI.esc(t("creditreport.quality.amount"))}</th><th class="num">${CI.esc(t("creditreport.quality.ofOs"))}</th></tr></thead><tbody>` +
        Object.keys(names).map(k => {
            const c = d.classes[k];
            return `<tr><td>${CI.esc(t(names[k]))}</td><td class="num">${CI.num(c.count)}</td><td class="num">${CI.money(c.value)}</td><td class="num">${CI.pct(c.pct)}</td></tr>`;
        }).join("") + "</tbody>";

    const dist = (d.distribution || []).slice().sort((x, y) => y.par30.value - x.par30.value);
    document.getElementById("qDist").innerHTML =
        `<thead><tr><th>${CI.esc(t("creditreport.risk.colName"))}</th><th class="num">${CI.esc(t("creditreport.pi.kOutstanding"))}</th><th class="num">PAR 1</th><th class="num">PAR 30</th><th class="num">PAR 90</th><th class="num">${CI.esc(t("creditreport.pi.kNplPct"))}</th><th class="num">${CI.esc(t("creditreport.pi.kParPct"))}</th></tr></thead><tbody>` +
        (dist.length ? dist.map(r => `<tr><td>${CI.esc(riskDim === "location" && !r.name ? t("creditreport.pi.otherAddress") : r.name)}${riskDim === "officer" ? `<div class="ci-sub">${CI.esc(r.branch || "")}</div>` : ""}</td><td class="num">${CI.money(r.os)}</td><td class="num">${CI.pct(r.par1.pct)}</td><td class="num">${CI.pct(r.par30.pct)}</td><td class="num">${CI.pct(r.par90.pct)}</td><td class="num">${CI.pct(r.nplPct)}</td><td class="num">${CI.pct(r.parPct)}</td></tr>`).join("")
            : `<tr><td colspan="7" class="pi-note">${CI.esc(t("creditreport.pi.nothing"))}</td></tr>`) + "</tbody>";
    qRenderTrend();
}

function qRenderTrend() {
    const d = qualityData;
    document.querySelectorAll("#qGrain [data-grain]").forEach(b => {
        const on = b.dataset.grain === qGrain;
        b.classList.toggle("is-active", on);
        b.setAttribute("aria-selected", on ? "true" : "false");
    });
    if (qChart) { qChart.destroy(); qChart = null; }
    const pts = d.trend[qGrain] || [];
    const empty = document.getElementById("qTrendEmpty");
    const box = document.getElementById("qTrend").parentElement;
    if (!d.trend.available || pts.length < 2) {
        empty.hidden = false;
        empty.textContent = t(`creditreport.pi.cmpReason.${d.trend.reason || "no_snapshot"}`);
        box.hidden = true;
        return;
    }
    empty.hidden = true;
    box.hidden = false;
    if (typeof Chart === "undefined") return;
    const col = CI.chartColors();
    const font = { family: "KRASAR, sans-serif", size: 11 };
    const line = (label, key, color, extra) => ({ label, data: pts.map(p => p[key] * 100), borderColor: color, backgroundColor: color, borderWidth: 2, pointRadius: 3, tension: 0.25, ...extra });
    qChart = new Chart(document.getElementById("qTrend"), {
        type: "line",
        data: {
            labels: pts.map(p => CI.short(p.date)),
            datasets: [
                line(t("creditreport.pi.kParPct"), "parPct", col.b, { borderDash: [6, 3], pointStyle: "rectRot" }),
                line(t("creditreport.pi.kNplPct"), "nplPct", col.a, {})
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false, animation: false,
            interaction: { mode: "index", intersect: false },
            plugins: {
                legend: { position: "top", align: "start", labels: { color: col.text, font, usePointStyle: true, boxWidth: 8, boxHeight: 8 } },
                tooltip: { callbacks: { label: c => `${c.dataset.label}: ${c.parsed.y.toFixed(2)}%` } }
            },
            scales: {
                x: { grid: { display: false }, ticks: { color: col.text, font, maxRotation: 0, autoSkip: true } },
                y: { grid: { color: col.grid }, border: { display: false }, ticks: { color: col.text, font, callback: v => `${v}%` } }
            }
        }
    });
}

// ---------- Module 05 — Growth vs Risk ----------
const G_QUADS = ["healthy", "risky", "weak", "stable"];

function gRender() {
    const d = riskData;
    const gr = d.growthRisk;
    const th = gr.thresholds;
    const gLabel = t(gr.growthField === "disbGrowth" ? "creditreport.growth.disbGrowth" : "creditreport.growth.osGrowth");
    const rLabel = t(gr.riskField === "parPct" ? "creditreport.pi.kParPct" : "creditreport.pi.kNplPct");
    document.getElementById("gThresholds").textContent = th.growth === null || th.risk === null
        ? t(`creditreport.pi.cmpReason.${d.comparison.reason || "no_snapshot"}`)
        : t(th.mode === "fixed" ? "creditreport.growth.thFixed" : "creditreport.growth.thAverage", {
            growth: CI.signedPct(th.growth), risk: CI.pct(th.risk), gLabel, rLabel
        });
    const rows = (d.rows || []).filter(r => r.quadrant);
    const counts = Object.fromEntries(G_QUADS.map(q => [q, rows.filter(r => r.quadrant === q).length]));
    document.getElementById("gQuads").innerHTML = G_QUADS.map(q =>
        `<div class="ci-quad ci-quad-${q}"><span class="ci-quad-dot" aria-hidden="true"></span><span>${CI.esc(t(`creditreport.growth.q.${q}`))}</span><strong>${counts[q]}</strong></div>`).join("");

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
        const guide = {
            id: "ciQuadLines",
            afterDraw(chart) {
                const { ctx, chartArea: a, scales: { x, y } } = chart;
                ctx.save();
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
                    y: { title: { display: true, text: rLabel, color: col.text, font }, grid: { color: col.grid }, border: { display: false }, ticks: { color: col.text, font, callback: v => `${v}%` } }
                }
            }
        });
    }

    const all = (d.rows || []).slice().sort((a, b) => b.os - a.os);
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
    CI.mountNav(riskView);
    CI.mountFilters({ onChange: riskLoad });
    document.getElementById("riskDims").addEventListener("click", e => {
        const b = e.target.closest("[data-dim]");
        if (!b || b.disabled) return;
        riskDim = b.dataset.dim;
        riskLoad();
    });
    document.getElementById("riskList").addEventListener("change", () => { if (riskData) cRender(); });
    document.getElementById("qGrain").addEventListener("click", e => {
        const b = e.target.closest("[data-grain]");
        if (!b || !qualityData) return;
        qGrain = b.dataset.grain;
        qRenderTrend();
    });
    ["gGrowth", "gRisk"].forEach(id => document.getElementById(id).addEventListener("change", riskLoad));
    document.getElementById("gSave").addEventListener("click", gSaveSettings);
    new MutationObserver(() => {
        if (riskView === "quality" && qualityData) qRenderTrend();
        if (riskView === "growth" && riskData) gRender();
    }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    if (riskView === "growth") gLoadSettings();
    riskLoad();
});
