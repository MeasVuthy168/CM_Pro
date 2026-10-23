// ========================================
// Credit Portfolio Intelligence — Recovery Performance (Module 06)
// GET /api/credit-intelligence/recovery: what reduced NPL in the period,
// with cash, outstanding reduction, leaving NPL and write-off kept apart
// (a fall in NPL is not cash), by officer / branch / product / district /
// aging, against the admin's monthly targets. Unavailable figures are
// shown as such, never estimated.
// ========================================

const t = CI.t;
let recData = null;
let recDim = new URLSearchParams(location.search).get("dim") || "officer";
let recWoDim = new URLSearchParams(location.search).get("woDim") || "branch";

async function recLoad() {
    const p = new URLSearchParams(location.search);
    p.set("dim", recDim);
    p.set("woDim", recWoDim);
    history.replaceState(null, "", `${location.pathname}?${p.toString()}`);
    const data = await CI.get("recovery", { dim: recDim, woDim: recWoDim });
    if (!data) return;
    recData = data;
    recRender();
}

function recRender() {
    const d = recData;
    if (d.empty) {
        document.getElementById("recUnavailable").hidden = false;
        document.getElementById("recUnavailableText").textContent = t("creditreport.pi.noAccess");
        return;
    }
    CI.fillOptions(d.options, d.scope, d.period);
    CI.renderAsOf(document.getElementById("ciAsOf"), d);
    recRenderWo(d);
    const off = document.getElementById("recUnavailable");
    const content = document.getElementById("recContent");
    if (!d.movement.available) {
        off.hidden = false;
        content.hidden = true;
        const m = d.movement;
        document.getElementById("recUnavailableText").textContent = t(`creditreport.npl.reason.${m.reason}`, { first: CI.dmy(m.firstSaved) });
        document.getElementById("recSinceFirst").hidden = !(m.firstSaved && d.asOf && m.firstSaved < d.asOf.osDate);
        return;
    }
    off.hidden = true;
    content.hidden = false;
    document.getElementById("recRange").textContent = t("creditreport.npl.range", {
        opening: CI.dmy(d.movement.openingDate),
        closing: CI.dmy(d.movement.closingDate) + (d.movement.closingLive ? ` (${t("creditreport.npl.live")})` : "")
    });
    recRenderKpis(d);
    recRenderKinds(d);
    recRenderTable(d);
}

// ---------- WO collection (written-off loans) — needs no NPL history ----------
function recRenderWo(d) {
    const w = d.woCollection;
    const box = document.getElementById("recWo");
    box.hidden = !w;
    if (!w) return;
    recWoDim = w.dim;
    document.querySelectorAll("#recWoDims [data-dim]").forEach(b => {
        const on = b.dataset.dim === w.dim;
        b.hidden = !w.dims.includes(b.dataset.dim);
        b.classList.toggle("is-active", on);
        b.setAttribute("aria-selected", on ? "true" : "false");
    });
    // Same wording and period as the Daily Report's Write Off section.
    const dash = k => String(k || "").split("-").reverse().join("-");
    document.getElementById("recWoPeriod").textContent =
        `${t("creditreport.detail.writeOffFrom")} ${t("creditreport.detail.dateRange", { from: dash(w.period.fromDate), to: dash(w.period.toDate) })}` +
        (w.dim === "officer" ? ` · ${t("creditreport.rec.woOwn")}` : "");
    const tt = w.totals;
    const plan = w.plan || {};
    document.getElementById("recWoKpis").innerHTML =
        recCard(t("creditreport.detail.woCollected"), CI.money(tt.collected), t("creditreport.rec.woPrnInt", { prn: CI.money(tt.collectedPrn), int: CI.money(tt.collectedInt) }), "good") +
        recCard(t("creditreport.rec.woPlanPct"),
            plan.value == null ? t("creditreport.rec.notSet") : CI.pct(plan.achievement, 2),
            plan.value == null ? t("creditreport.rec.planNotSet", { year: plan.year || "" }) : t("creditreport.rec.ofPlan", { plan: CI.money(plan.value), year: plan.year })) +
        recCard(t("creditreport.detail.woBalanceWO"), CI.money(tt.balance), t("creditreport.rec.woBalanceSub2", { n: CI.num(tt.balanceCount), int: CI.money(tt.balanceInt) })) +
        recCard(t("creditreport.detail.woWO"), CI.money(tt.writtenOff), t("creditreport.rec.woLoansN", { n: CI.num(tt.writtenOffCount) }), "bad");

    // Laid out like the branches' WO report.
    const showPlan = w.dim === "branch";
    const name = r => (w.dim === "location" && !r.key ? t("creditreport.pi.otherAddress") : (r.name || r.key || "—"));
    const n0 = v => (Number(v) ? CI.num(v) : "-");
    const m0 = v => (Number(v) ? CI.num(v) : "-");
    const cells = r => `
        <td class="num">${n0(r.balanceCount)}</td><td class="num">${m0(r.balanceInt)}</td><td class="num">${m0(r.balance)}</td>
        <td class="num">${n0(r.writtenOffCount)}</td><td class="num">${m0(r.writtenOff)}</td>
        <td class="num">${m0(r.collectedInt)}</td><td class="num">${m0(r.collectedPrn)}</td><td class="num ci-good">${m0(r.collected)}</td>`;
    const pct = (c, p) => (p ? CI.pct(c / p, 2) : "—");
    const body = w.rows.map(r => `<tr>
        <td>${CI.esc(name(r))}${w.dim === "officer" && r.branch ? `<div class="ci-sub">${CI.esc(r.branch)}</div>` : ""}</td>${cells(r)}
        ${showPlan ? `<td class="num">${r.plan ? CI.num(r.plan) : CI.esc(t("creditreport.rec.notSet"))}</td><td class="num">${pct(r.collected, r.plan)}</td>` : ""}
    </tr>`).join("");
    const total = w.rows.length ? `<tr class="ci-total"><td>${CI.esc(t("creditreport.rec.total"))}</td>${cells(tt)}
        ${showPlan ? `<td class="num">${plan.value ? CI.num(plan.value) : "—"}</td><td class="num">${plan.value ? CI.pct(plan.achievement, 2) : "—"}</td>` : ""}</tr>` : "";
    const g = (k, span) => `<th colspan="${span}" class="ci-grp">${CI.esc(t(k))}</th>`;
    const cols = ["creditreport.detail.colCifHash", "creditreport.detail.colInt", "creditreport.detail.colPrn", "#", "creditreport.detail.colPrn",
        "creditreport.detail.colInt", "creditreport.detail.colPrn", "creditreport.rec.colTotalShort"];
    const span = 1 + cols.length + (showPlan ? 2 : 0);
    document.getElementById("recWoTable").innerHTML =
        `<thead><tr><th rowspan="2">${CI.esc(t("creditreport.risk.colName"))}</th>${g("creditreport.detail.woBalanceWO", 3)}${g("creditreport.detail.woWO", 2)}${g("creditreport.detail.woCollected", 3)}` +
        (showPlan ? `<th rowspan="2" class="num">${CI.esc(t("creditreport.rec.planCollection"))}</th><th rowspan="2" class="num">(%)</th>` : "") +
        `</tr><tr>${cols.map(c => `<th class="num">${CI.esc(c === "#" ? "#" : t(c))}</th>`).join("")}</tr></thead>` +
        `<tbody>${body || `<tr><td colspan="${span}" class="pi-note">${CI.esc(t("creditreport.pi.nothing"))}</td></tr>`}${total}</tbody>`;
}

function recCard(label, value, sub, tone) {
    return `<article class="pi-kpi${tone ? ` ci-kpi-${tone}` : ""}">
        <div class="pi-kpi-label">${CI.esc(label)}</div>
        <div class="pi-kpi-value">${CI.esc(value)}</div>
        ${sub ? `<div class="pi-kpi-sub">${CI.esc(sub)}</div>` : ""}
    </article>`;
}

function recRenderKpis(d) {
    const k = d.kpis;
    const tg = k.target;
    const targetText = tg.value === null ? t("creditreport.rec.notSet") : CI.pct(tg.achievement, 1);
    const targetSub = tg.value === null ? t("creditreport.rec.notSetSub") : t("creditreport.rec.ofTarget", { target: CI.money(tg.value) });
    document.getElementById("recKpis").innerHTML =
        recCard(t("creditreport.rec.recovered"), CI.money(k.recovered.value), t("creditreport.npl.accountsN", { n: CI.num(k.recovered.count) }), "good") +
        recCard(t("creditreport.rec.recoveredAccounts"), CI.num(k.recovered.count), "") +
        recCard(t("creditreport.rec.rate"), k.recoveryRate === null ? "—" : CI.pct(k.recoveryRate, 1), t("creditreport.rec.rateSub", { opening: CI.money(k.opening) })) +
        recCard(t("creditreport.npl.step.new"), `+${CI.money(k.newNpl.value)}`, t("creditreport.npl.accountsN", { n: CI.num(k.newNpl.count) }), "bad") +
        recCard(t("creditreport.rec.net"), `${k.net > 0 ? "+" : ""}${CI.money(k.net)}`, `${CI.money(k.opening)} → ${CI.money(k.closing)}`, k.net > 0 ? "bad" : k.net < 0 ? "good" : "") +
        recCard(t("creditreport.rec.target"), targetText, targetSub);
}

function recRenderKinds(d) {
    const kd = d.kinds;
    const exits = Object.entries(kd.left.byExit || {})
        .map(([e, v]) => `${t(`creditreport.npl.exit.${e}`)} ${v.count} · ${CI.money(v.value)}`).join(" · ");
    const tile = (label, value, sub, tone) => `
        <div class="ci-step ci-step-${tone}">
            <div class="pi-kpi-label">${CI.esc(label)}</div>
            <div class="ci-step-value">${CI.esc(value)}</div>
            <div class="pi-kpi-sub">${CI.esc(sub)}</div>
        </div>`;
    document.getElementById("recKinds").innerHTML =
        tile(t("creditreport.rec.kCash"), CI.money(kd.cash.writtenOff.value), `${t("creditreport.rec.kCashWo")} · ${t("creditreport.rec.kCashNpl")}`, "base") +
        tile(t("creditreport.rec.kReduction"), CI.money(kd.reduction.value), t("creditreport.rec.kReductionSub", { n: CI.num(kd.reduction.count) }), "good") +
        tile(t("creditreport.rec.kLeft"), CI.money(kd.left.value), exits || t("creditreport.npl.accountsN", { n: 0 }), "good") +
        tile(t("creditreport.rec.kWriteOff"), CI.money(kd.writeOff.value), t("creditreport.npl.accountsN", { n: CI.num(kd.writeOff.count) }), "bad");
}

function recName(r) {
    if (recDim === "aging") return t(`creditreport.rec.aging.${r.key}`);
    if (recDim === "location" && !r.key) return t("creditreport.pi.otherAddress");
    return r.name || r.key || "—";
}

function recRenderTable(d) {
    document.querySelectorAll("#recDims [data-dim]").forEach(b => {
        const on = b.dataset.dim === recDim;
        b.classList.toggle("is-active", on);
        b.setAttribute("aria-selected", on ? "true" : "false");
    });
    const showTarget = recDim === "branch";
    const head = ["creditreport.risk.colName", "creditreport.npl.step.opening", "creditreport.rec.recovered", "creditreport.rec.rate",
        "creditreport.rec.kWriteOff", "creditreport.rec.kReduction", "creditreport.npl.step.new", "creditreport.rec.net"]
        .concat(showTarget ? ["creditreport.rec.target"] : []);
    const rows = (d.byDim || []).map(r => `<tr>
        <td>${CI.esc(recName(r))}${recDim === "officer" && r.branch ? `<div class="ci-sub">${CI.esc(r.branch)}</div>` : ""}</td>
        <td class="num">${CI.money(r.opening)}</td>
        <td class="num ci-good">${CI.money(r.left.value)}<div class="ci-sub">${CI.esc(t("creditreport.npl.accountsN", { n: r.left.count }))}</div></td>
        <td class="num">${r.recoveryRate === null ? "—" : CI.pct(r.recoveryRate, 1)}</td>
        <td class="num">${CI.money(r.writeOff.value)}</td>
        <td class="num">${CI.money(r.reduction.value)}</td>
        <td class="num ci-bad">${CI.money(r.newNpl.value)}</td>
        <td class="num${r.net > 0 ? " ci-bad" : r.net < 0 ? " ci-good" : ""}">${r.net > 0 ? "+" : ""}${CI.money(r.net)}</td>
        ${showTarget ? `<td class="num">${r.target ? `${CI.pct(r.left.value / r.target, 0)}<div class="ci-sub">${CI.money(r.target)}</div>` : CI.esc(t("creditreport.rec.notSet"))}</td>` : ""}
    </tr>`).join("");
    document.getElementById("recTable").innerHTML =
        `<thead><tr>${head.map((h, i) => `<th${i ? ' class="num"' : ""}>${CI.esc(t(h))}</th>`).join("")}</tr></thead>` +
        `<tbody>${rows || `<tr><td colspan="${head.length}" class="pi-note">${CI.esc(t("creditreport.pi.nothing"))}</td></tr>`}</tbody>`;
}

// ---------- admin: monthly targets per branch ----------
function recIsAdmin() {
    try {
        const u = JSON.parse(localStorage.getItem("loggedInUser") || sessionStorage.getItem("loggedInUser") || "{}");
        return String(u.role || "").toLowerCase() === "admin";
    } catch (e) {
        return false;
    }
}

async function recAdminFetch(method, body) {
    const month = document.getElementById("recTargetMonth").value;
    const url = `${API.BASE_URL}/api/admin/credit-intelligence/recovery-targets${method === "GET" ? `?month=${encodeURIComponent(month)}` : ""}`;
    const res = await fetch(url, {
        method,
        headers: { Authorization: `Bearer ${localStorage.getItem("token") || sessionStorage.getItem("token")}`, "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined
    });
    return res.json();
}

async function recLoadTargets() {
    const branches = (recData && recData.options && recData.options.branches) || [];
    let current = {};
    try {
        const r = await recAdminFetch("GET");
        if (r.ok) current = r.targets || {};
    } catch (e) {
        console.error(e);
    }
    document.getElementById("recTargetGrid").innerHTML = branches.map(b =>
        `<label class="pi-field"><span>${CI.esc(b)}</span><input type="number" min="0" step="1" inputmode="numeric" data-branch="${CI.esc(b)}" value="${current[b] ?? ""}"></label>`).join("");
}

async function recSaveTargets() {
    const targets = {};
    document.querySelectorAll("#recTargetGrid input[data-branch]").forEach(i => {
        if (i.value !== "") targets[i.dataset.branch] = i.value;
    });
    try {
        const r = await recAdminFetch("PUT", { month: document.getElementById("recTargetMonth").value, targets });
        if (!r.ok) throw new Error(r.message || "");
        CI.toast(t("creditreport.growth.saved"), "success");
        recLoad();
    } catch (e) {
        console.error(e);
        CI.toast(t("creditreport.pi.loadFailed"), "error");
    }
}

// ---------- admin: annual WO collection plan per branch ----------
async function recPlanFetch(method, body) {
    const year = document.getElementById("recPlanYear").value;
    const url = `${API.BASE_URL}/api/admin/credit-intelligence/wo-plans${method === "GET" ? `?year=${encodeURIComponent(year)}` : ""}`;
    const res = await fetch(url, {
        method,
        headers: { Authorization: `Bearer ${localStorage.getItem("token") || sessionStorage.getItem("token")}`, "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined
    });
    return res.json();
}

async function recLoadPlans() {
    const branches = (recData && recData.options && recData.options.branches) || [];
    let current = {};
    try {
        const r = await recPlanFetch("GET");
        if (r.ok) current = r.plans || {};
    } catch (e) {
        console.error(e);
    }
    document.getElementById("recPlanGrid").innerHTML = branches.map(b =>
        `<label class="pi-field"><span>${CI.esc(b)}</span><input type="number" min="0" step="1" inputmode="numeric" data-branch="${CI.esc(b)}" value="${current[b] ?? ""}"></label>`).join("");
}

async function recSavePlans() {
    const plans = {};
    document.querySelectorAll("#recPlanGrid input[data-branch]").forEach(i => {
        if (i.value !== "") plans[i.dataset.branch] = i.value;
    });
    try {
        const r = await recPlanFetch("PUT", { year: document.getElementById("recPlanYear").value, plans });
        if (!r.ok) throw new Error(r.message || "");
        CI.toast(t("creditreport.growth.saved"), "success");
        recLoad();
    } catch (e) {
        console.error(e);
        CI.toast(t("creditreport.pi.loadFailed"), "error");
    }
}

document.addEventListener("DOMContentLoaded", () => {
    CI.mountFilters({ dates: true, compare: false, onChange: recLoad });
    document.getElementById("recDims").addEventListener("click", e => {
        const b = e.target.closest("[data-dim]");
        if (!b) return;
        recDim = b.dataset.dim;
        recLoad();
    });
    document.getElementById("recWoDims").addEventListener("click", e => {
        const b = e.target.closest("[data-dim]");
        if (!b) return;
        recWoDim = b.dataset.dim;
        recLoad();
    });
    document.getElementById("recSinceFirst").addEventListener("click", () => {
        const first = recData && recData.movement && recData.movement.firstSaved;
        if (!first) return;
        const d = new Date(`${first}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() + 1);
        const from = document.getElementById("ciFrom");
        from.value = d.toISOString().slice(0, 10);
        from.dispatchEvent(new Event("change"));
    });
    if (recIsAdmin()) {
        const box = document.getElementById("recAdmin");
        box.hidden = false;
        const month = document.getElementById("recTargetMonth");
        month.value = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 7);
        box.addEventListener("toggle", () => { if (box.open) recLoadTargets(); });
        month.addEventListener("change", recLoadTargets);
        document.getElementById("recTargetSave").addEventListener("click", recSaveTargets);
        const planBox = document.getElementById("recPlanAdmin");
        planBox.hidden = false;
        const year = document.getElementById("recPlanYear");
        year.value = String(new Date(Date.now() + 7 * 3600 * 1000).getUTCFullYear());
        planBox.addEventListener("toggle", () => { if (planBox.open) recLoadPlans(); });
        year.addEventListener("change", recLoadPlans);
        document.getElementById("recPlanSave").addEventListener("click", recSavePlans);
    }
    recLoad();
});
