// ========================================
// Credit Portfolio Intelligence — Customer Risk Prediction (Phase 5)
// GET /api/credit-intelligence/customers/prediction: today's overdue
// loans (Customer Risk rows: same scope and filters) with the probability
// each rolls to a later days bucket within the horizon, per loan or per
// customer (highest loan; expected PAR rolling = Σ p × PAR).
// Probabilities come from a transparent lookup table (days bucket × trend)
// fitted on the saved account history, and are shown ONLY after its
// roll-forward validation passes the admin's gate. The validation record
// (AUC, Brier skill, calibration, coverage, expected vs actual) is always
// shown. Nothing is computed here but display.
// ========================================

const t = CI.t;
let cpData = null;
let cpUnit = "customer";
let cpAll = false;      // also list loans at 180+ days (they can't roll)
let cpCal = null;

const cpPct = (v, d = 0) => (v === null || v === undefined ? "—" : `${(v * 100).toFixed(d)}%`);
const cpFix = (v, d = 2) => (v === null || v === undefined ? "—" : Number(v).toFixed(d));
const cpToken = () => localStorage.getItem("token") || sessionStorage.getItem("token");

function cpParams() {
    return {
        unit: cpUnit,
        sort: document.getElementById("cpSort").value,
        top: document.getElementById("cpTop").value,
        q: document.getElementById("cpSearch").value.trim(),
        all: cpAll ? "1" : ""
    };
}

async function cpLoad() {
    const data = await CI.get("customers/prediction", cpParams());
    if (!data) return;
    cpData = data;
    cpRender();
}

function cpRender() {
    const d = cpData;
    if (d.empty) {
        document.getElementById("cpList").innerHTML = `<p class="pi-note">${CI.esc(t("creditreport.pi.noAccess"))}</p>`;
        return;
    }
    CI.fillOptions(d.options, d.scope, d.period);
    CI.renderAsOf(document.getElementById("ciAsOf"), d);
    document.getElementById("cpSort").value = d.sort;
    cpRenderSummary(d);
    cpRenderKpis(d);
    cpRenderList(d);
    cpRenderValidation(d);
    cpRenderTable(d);
    cpRenderMethod(d);
}

function cpReasons(g) {
    return (g.reasons || []).map(r => t(`creditreport.cp.r.${r}`)).join(" · ");
}

function cpRenderSummary(d) {
    const box = document.getElementById("cpSummary");
    box.hidden = false;
    const s = d.summary;
    if (!d.display) {
        // Not enough saved history yet: say when it will be, plainly.
        const short = d.model.history && d.model.history.lookbackDay === null;
        box.innerHTML = `
            <div class="ci-sum-head"><span aria-hidden="true">⏳</span> ${CI.esc(t(short ? "creditreport.cp.sum.short" : "creditreport.cp.sum.hidden"))}</div>
            <div class="ci-sum-sub">${CI.esc(short
                ? t("creditreport.cp.sum.shortSub", { first: CI.dmy(d.model.history.firstSaved), days: d.model.lookback + d.model.horizon, ready: CI.dmy(d.readyFrom) })
                : cpReasons(d.gate))}</div>
            <div class="ci-sum-parts"><span class="ci-sum-part">${CI.esc(t("creditreport.cp.sum.hiddenSub"))}</span></div>`;
        return;
    }
    const high = s.bands.find(b => b.key === "high");
    const med = s.bands.find(b => b.key === "medium");
    box.innerHTML = `
        <div class="ci-sum-head is-up"><span aria-hidden="true">▲</span> ${CI.esc(t("creditreport.cp.sum.head", { amt: CI.money(s.expectedRoll), par: CI.money(s.par), days: d.model.horizon }))}</div>
        <div class="ci-sum-sub">${CI.esc(high.loans ? t("creditreport.cp.sum.sub", { n: CI.num(high.loans), par: CI.money(high.par) }) : t("creditreport.cp.sum.subMedium", { n: CI.num(med.loans), par: CI.money(med.par) }))}</div>
        <div class="ci-sum-parts">
            <span class="ci-sum-part">${CI.esc(t("creditreport.cp.sum.auc", { auc: cpFix(d.validation.auc) }))}</span>
            <span class="ci-sum-part">${CI.esc(t("creditreport.cp.notFact"))}</span>
        </div>`;
}

function cpRenderKpis(d) {
    const s = d.summary;
    document.getElementById("cpTarget").textContent = t("creditreport.cp.target", { days: d.model.horizon, asOf: CI.dmy(d.overdueAsOf) });
    const kpi = (label, value, sub) => `<div class="pi-kpi"><div class="pi-kpi-label">${CI.esc(label)}</div><div class="pi-kpi-value">${value}</div><div class="pi-kpi-sub">${sub || ""}</div></div>`;
    const bands = s.bands || [];
    const band = k => bands.find(b => b.key === k) || { loans: 0, par: 0, expected: 0 };
    document.getElementById("cpKpis").innerHTML = [
        kpi(t("creditreport.cp.k.expected"), d.display ? CI.money(s.expectedRoll) : "—", CI.esc(t("creditreport.cp.k.ofPar", { par: CI.money(s.par) }))),
        kpi(t("creditreport.cp.k.high"), d.display ? CI.num(band("high").loans) : "—", d.display ? CI.esc(t("creditreport.cp.k.bandPar", { par: CI.money(band("high").par) })) : ""),
        kpi(t("creditreport.cp.k.medium"), d.display ? CI.num(band("medium").loans) : "—", d.display ? CI.esc(t("creditreport.cp.k.bandPar", { par: CI.money(band("medium").par) })) : ""),
        kpi(t("creditreport.cp.k.predicted"), `${CI.num(s.predicted)} / ${CI.num(s.loans)}`,
            CI.esc(t("creditreport.cp.k.lastBucket", { n: CI.num(s.lastBucket) })))
    ].join("");
}

function cpProb(p) {
    if (p === null || p === undefined) return "";
    const cls = p >= 0.6 ? "is-high" : p < 0.3 ? "is-low" : "";
    return `<div class="cp-prob"><div class="cp-prob-bar ${cls}"><span style="width:${Math.round(p * 100)}%"></span></div><b>${cpPct(p)}</b></div>`;
}

function cpCard(r, i) {
    const isLoan = cpUnit === "loan";
    const who = isLoan
        ? `${CI.esc(r.ld)} · ${CI.esc(r.product || "")}`
        : `${CI.esc(r.cif || t("creditreport.crk.noCif"))} · ${CI.esc(t("creditreport.crk.loansN", { n: r.loans }))}`;
    const where = isLoan
        ? `${CI.esc(r.officerName || r.officerId || "")} · ${CI.esc(r.branch || "")}`
        : `${CI.esc((r.officers || []).join(", "))} · ${CI.esc((r.branches || []).join(", "))}`;
    // Page-wide reasons (short history, not validated) are said once at the
    // top; a card only says what is particular to it.
    const why = r.p === null && r.reason === "last_bucket" ? `<div class="cp-hidden">${CI.esc(t("creditreport.cp.why.last_bucket"))}</div>` : "";
    const seg = isLoan && r.bucket ? `<span>${CI.esc(t("creditreport.cp.bucket"))} <b>${CI.esc(r.bucket)}</b></span>${r.trend ? `<span>${CI.esc(t(`creditreport.cp.trend.${r.trend}`))}</span>` : ""}` : "";
    return `<div class="ci-card crk-card">
        <div class="ci-card-top">
            <span class="crk-rank">${i + 1}</span>
            <span class="ci-card-name">${CI.esc(r.name || "—")}</span>
            ${r.level ? `<span class="ci-pill ci-pill-${r.level}" title="${CI.esc(t("creditreport.crk.scoreTip"))}">${CI.esc(t(`creditreport.ews.level.${r.level}`))} ${r.score}</span>` : ""}
        </div>
        <div class="ci-sub">${who}</div>
        ${cpProb(r.p)}${why}
        ${r.expected === null || r.expected === undefined ? "" : `<div class="ci-card-row"><span>${CI.esc(t("creditreport.cp.colExpected"))}</span><span class="ci-card-amt">${CI.money(r.expected)}</span></div>`}
        <div class="crk-facts">
            <span>${CI.esc(t("creditreport.crk.colPar"))} <b>${CI.money(r.par)}</b></span>
            <span>${CI.esc(t("creditreport.crk.colDpd"))} <b>${CI.num(r.day)}</b></span>
            ${seg}
            ${r.p !== null && r.covered === false ? `<span title="${CI.esc(t("creditreport.cp.thinTip"))}">◌ ${CI.esc(t("creditreport.cp.thin"))}</span>` : ""}
        </div>
        <div class="ci-sub">${where}</div>
    </div>`;
}

function cpRenderList(d) {
    document.querySelectorAll("#cpUnitTabs [data-unit]").forEach(b => {
        const on = b.dataset.unit === cpUnit;
        b.classList.toggle("is-active", on);
        b.setAttribute("aria-selected", on ? "true" : "false");
    });
    document.getElementById("cpCount").textContent = t(cpUnit === "loan" ? "creditreport.crk.countLoans" : "creditreport.crk.countCustomers",
        { shown: CI.num(d.rows.length), n: CI.num(d.listedCount) }) + (d.q ? ` · ${t("creditreport.crk.searchFor", { q: d.q })}` : "")
        + (cpUnit === "customer" && d.display ? ` · ${t("creditreport.cp.customerNote")}` : "");
    document.getElementById("cpUnitHint").textContent = t(cpUnit === "loan" ? "creditreport.cp.hintLoan" : "creditreport.cp.hintCustomer");
    const last = document.getElementById("cpLast");
    last.hidden = !d.lastBucketRows;
    last.innerHTML = d.lastBucketRows ? `${CI.esc(t(d.withLast ? "creditreport.cp.lastShown" : "creditreport.cp.lastHidden", { n: CI.num(d.lastBucketRows) }))} <button type="button" class="cp-link" id="cpLastToggle">${CI.esc(t(d.withLast ? "creditreport.cp.lastHide" : "creditreport.cp.lastShow"))}</button>` : "";
    document.getElementById("cpList").innerHTML = d.rows.length ? d.rows.map(cpCard).join("") : `<p class="pi-note">${CI.esc(t("creditreport.pi.nothing"))}</p>`;
}

function cpRenderValidation(d) {
    const v = d.validation;
    const g = d.gate;
    const gs = d.model.settings.gate;
    document.getElementById("cpGate").innerHTML = `<span class="cp-gate ${g.status === "validated" ? "is-ok" : "is-no"}">${CI.esc(t(`creditreport.cp.gate.${g.status}`))}</span>`;
    const first = v.origins.length ? v.origins[0].origin : null;
    const last = v.origins.length ? v.origins[v.origins.length - 1].origin : null;
    document.getElementById("cpValNote").textContent = t("creditreport.cp.valNote", { n: v.origins.length, first: CI.dmy(first), last: CI.dmy(last), days: d.model.horizon });
    const fail = r => (g.reasons || []).includes(r);
    const kpi = (label, value, sub, bad) => `<div class="pi-kpi${bad ? " cp-kpi-fail" : ""}"><div class="pi-kpi-label">${CI.esc(label)}</div><div class="pi-kpi-value">${value}</div><div class="pi-kpi-sub">${CI.esc(sub || "")}</div></div>`;
    document.getElementById("cpValKpis").innerHTML = [
        kpi(t("creditreport.cp.v.tests"), CI.num(v.tests), t("creditreport.cp.v.need", { v: CI.num(gs.minTests) }), fail("too_few_tests")),
        kpi("AUC", cpFix(v.auc), t("creditreport.cp.v.aucSub", { v: gs.minAuc }), fail("auc_below_gate")),
        kpi(t("creditreport.cp.v.ece"), cpPct(v.ece, 1), t("creditreport.cp.v.eceSub", { v: cpPct(gs.maxEce, 1) }), fail("calibration_above_gate")),
        kpi(t("creditreport.cp.v.skill"), cpPct(v.skill, 1), t("creditreport.cp.v.skillSub"), fail("no_skill")),
        kpi(t("creditreport.cp.v.rate"), cpPct(v.rollRate, 1), t("creditreport.cp.v.coverage", { v: cpPct(v.coverage) })),
        kpi(t("creditreport.cp.v.amount"), `${CI.money(v.amount.expected)}`, t("creditreport.cp.v.amountSub", { v: CI.money(v.amount.actual), bias: v.amount.bias === null || v.amount.bias === undefined ? "—" : `${v.amount.bias > 0 ? "+" : ""}${(v.amount.bias * 100).toFixed(1)}%`, max: cpPct(gs.maxAmountBias) }), fail("amount_bias_above_gate"))
    ].join("");

    const bands = v.calibration || [];
    document.getElementById("cpCal").innerHTML = bands.length ? `<thead><tr><th>${CI.esc(t("creditreport.cp.band"))}</th><th class="num">${CI.esc(t("creditreport.cp.loans"))}</th><th class="num">${CI.esc(t("creditreport.cp.predicted"))}</th><th class="num">${CI.esc(t("creditreport.cp.actual"))}</th></tr></thead><tbody>
        ${bands.map(b => `<tr><td>${cpPct(b.from)}–${cpPct(b.to)}</td><td class="num">${CI.num(b.n)}</td><td class="num">${cpPct(b.predicted, 1)}</td><td class="num">${cpPct(b.actual, 1)}</td></tr>`).join("")}</tbody>` : "";
    if (cpCal) cpCal.destroy();
    cpCal = null;
    if (typeof Chart !== "undefined" && bands.length) {
        const c = CI.chartColors();
        cpCal = new Chart(document.getElementById("cpCalChart"), {
            type: "bar",
            data: {
                labels: bands.map(b => `${Math.round(b.from * 100)}–${Math.round(b.to * 100)}%`),
                datasets: [
                    { label: t("creditreport.cp.predicted"), data: bands.map(b => +(b.predicted * 100).toFixed(1)), backgroundColor: c.b },
                    { label: t("creditreport.cp.actual"), data: bands.map(b => +(b.actual * 100).toFixed(1)), backgroundColor: c.a }
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { labels: { color: c.text, font: { family: "KRASAR" } } }, tooltip: { callbacks: { label: x => `${x.dataset.label}: ${x.raw}%` } } },
                scales: { x: { ticks: { color: c.text }, grid: { color: c.grid } }, y: { min: 0, max: 100, ticks: { color: c.text, callback: x => `${x}%` }, grid: { color: c.grid } } }
            }
        });
    }
    document.getElementById("cpOrigins").innerHTML = v.origins.length ? `<thead><tr><th>${CI.esc(t("creditreport.cp.origin"))}</th><th class="num">${CI.esc(t("creditreport.cp.trained"))}</th><th class="num">${CI.esc(t("creditreport.cp.loans"))}</th><th class="num">${CI.esc(t("creditreport.cp.predicted"))}</th><th class="num">${CI.esc(t("creditreport.cp.actual"))}</th><th class="num">AUC</th></tr></thead><tbody>
        ${v.origins.map(o => `<tr><td>${CI.esc(CI.dmy(o.origin))}</td><td class="num">${CI.num(o.trained)}</td><td class="num">${CI.num(o.n)}</td><td class="num">${cpPct(o.predicted, 1)}</td><td class="num">${cpPct(o.actual, 1)}</td><td class="num">${cpFix(o.auc)}</td></tr>`).join("")}</tbody>` : "";
}

function cpRenderTable(d) {
    const tb = d.model.table;
    document.getElementById("cpModelNote").textContent = t("creditreport.cp.modelNote", { n: CI.num(tb.examples), rate: cpPct(tb.overall, 1), first: CI.dmy(d.model.history.firstOrigin), last: CI.dmy(d.model.history.lastOrigin) });
    document.getElementById("cpTable").innerHTML = `<thead><tr><th>${CI.esc(t("creditreport.cp.bucket"))}</th><th>${CI.esc(t("creditreport.cp.trendH"))}</th><th class="num">${CI.esc(t("creditreport.cp.examples"))}</th><th class="num">${CI.esc(t("creditreport.cp.observed"))}</th><th class="num">${CI.esc(t("creditreport.cp.used"))}</th></tr></thead><tbody>
        ${tb.segments.map(s => `<tr><td>${CI.esc(s.bucket)}</td><td>${CI.esc(t(`creditreport.cp.trend.${s.trend}`))}</td><td class="num">${CI.num(s.n)}</td><td class="num">${cpPct(s.rate, 1)}</td><td class="num">${s.p === null ? "—" : `<span class="cp-seg-bar" style="width:${Math.round(s.p * 60)}px"></span>${cpPct(s.p, 1)}`}</td></tr>`).join("")}</tbody>`;
}

function cpRenderMethod(d) {
    const s = d.model.settings;
    const h = d.model.history;
    document.getElementById("cpMethod").innerHTML = `
        <p>${CI.esc(t("creditreport.cp.m.version", { v: d.model.version }))}</p>
        <p>${CI.esc(t("creditreport.cp.m.horizon", { n: s.horizon }))}</p>
        <p>${CI.esc(t("creditreport.cp.m.lookback", { n: s.lookback }))}</p>
        <p>${CI.esc(t("creditreport.cp.m.train", { n: s.trainDays, step: s.step }))}</p>
        <p>${CI.esc(t("creditreport.cp.m.tests", { n: s.testOrigins }))}</p>
        <p>${CI.esc(t("creditreport.cp.m.smoothing", { n: s.smoothing, min: s.minSegment }))}</p>
        <p>${CI.esc(t("creditreport.cp.m.history", { n: CI.num(h.savedDays), first: CI.dmy(h.firstSaved), last: CI.dmy(h.latestSaved) }))}</p>
        <p class="cp-wide">${CI.esc(t("creditreport.cp.m.method"))}</p>
        <p class="cp-wide">${CI.esc(t("creditreport.cp.m.limits"))}</p>`;
}

function cpExport() {
    if (typeof XLSX === "undefined") { CI.toast(t("creditreport.npl.exportNotReady"), "error"); return; }
    const d = cpData;
    if (!d || !d.rows) return;
    const loan = cpUnit === "loan";
    const head = loan
        ? ["Loan", "CIF", "Name", "Branch", "Officer", "Days", "Bucket", "Trend", "PAR", "Probability", "Expected rolling", "Segment examples"]
        : ["CIF", "Name", "Loans", "Branches", "Officers", "Days", "PAR", "Highest probability", "Expected rolling"];
    const aoa = [head].concat(d.rows.map(r => (loan
        ? [r.ld, r.cif, r.name, r.branch, r.officerName || r.officerId, r.day, r.bucket, r.trend, r.par, r.p, r.expected, r.segmentN]
        : [r.cif, r.name, r.loans, (r.branches || []).join(", "), (r.officers || []).join(", "), r.day, r.par, r.p, r.expected])));
    aoa.push([]);
    aoa.push([`Model ${d.model.version}`, `as of ${d.overdueAsOf}`, `gate ${d.gate.status}`, `AUC ${cpFix(d.validation.auc)}`]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "Prediction");
    XLSX.writeFile(wb, `CustomerPrediction_${d.overdueAsOf || ""}.xlsx`);
}

// ---------- admin ----------
function cpIsAdmin() {
    try {
        const u = JSON.parse(localStorage.getItem("loggedInUser") || sessionStorage.getItem("loggedInUser") || "{}");
        return String(u.role || "").toLowerCase() === "admin";
    } catch (e) {
        return false;
    }
}
const CP_FIELDS = [["horizon", 1], ["lookback", 1], ["step", 1], ["trainDays", 1], ["testOrigins", 1], ["smoothing", 1], ["minSegment", 1], ["tolerance", 1]];
const CP_GATE = [["minTests", 1], ["minAuc", 0.01], ["maxEce", 0.005], ["minSkill", 0.01], ["maxAmountBias", 0.05]];
async function cpAdminLoad() {
    const res = await fetch(`${API.BASE_URL}/api/admin/credit-intelligence/prediction-settings`, { headers: { Authorization: `Bearer ${cpToken()}` } });
    const data = await res.json();
    if (!data.ok) return;
    const s = data.settings;
    const f = (k, step, v, gate) => `<label class="pi-field"><span>${CI.esc(t(`creditreport.cp.f.${k}`))}</span><input type="number" step="${step}" data-k="${k}"${gate ? " data-gate" : ""} value="${v}" class="pi-top-pick"></label>`;
    document.getElementById("cpAdminFields").innerHTML =
        CP_FIELDS.map(([k, st]) => f(k, st, s[k])).join("") + CP_GATE.map(([k, st]) => f(k, st, s.gate[k], true)).join("");
}
async function cpAdminSave() {
    const settings = { gate: {} };
    document.querySelectorAll("#cpAdminFields [data-k]").forEach(i => {
        if (i.hasAttribute("data-gate")) settings.gate[i.dataset.k] = i.value; else settings[i.dataset.k] = i.value;
    });
    try {
        const res = await fetch(`${API.BASE_URL}/api/admin/credit-intelligence/prediction-settings`, {
            method: "PUT", headers: { Authorization: `Bearer ${cpToken()}`, "Content-Type": "application/json" }, body: JSON.stringify({ settings })
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.message || "");
        CI.toast(t("creditreport.growth.saved"), "success");
        cpLoad();
    } catch (e) {
        console.error(e);
        CI.toast(t("creditreport.pi.loadFailed"), "error");
    }
}

document.addEventListener("DOMContentLoaded", () => {
    CI.mountFilters({ dates: false, onChange: cpLoad });
    document.getElementById("cpUnitTabs").addEventListener("click", e => {
        const b = e.target.closest("[data-unit]");
        if (!b || b.dataset.unit === cpUnit) return;
        cpUnit = b.dataset.unit;
        cpLoad();
    });
    ["cpSort", "cpTop"].forEach(id => document.getElementById(id).addEventListener("change", cpLoad));
    let typing = null;
    document.getElementById("cpSearch").addEventListener("input", () => {
        clearTimeout(typing);
        typing = setTimeout(cpLoad, 400);
    });
    document.getElementById("cpExport").addEventListener("click", cpExport);
    document.getElementById("cpLast").addEventListener("click", e => {
        if (!e.target.closest("#cpLastToggle")) return;
        cpAll = !cpAll;
        cpLoad();
    });
    if (cpIsAdmin()) {
        const box = document.getElementById("cpAdmin");
        box.hidden = false;
        box.addEventListener("toggle", () => { if (box.open) cpAdminLoad(); });
        document.getElementById("cpAdminSave").addEventListener("click", cpAdminSave);
    }
    cpLoad();
});
