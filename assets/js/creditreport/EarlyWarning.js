// ========================================
// Credit Portfolio Intelligence — Early Warning Indicators (Module 07)
// GET /api/credit-intelligence/early-warning: today's overdue loans not
// yet NPL, each checked against transparent rules (the rule cards show
// exactly what fires and for how many points). A loan card opens that loan
// in Work to Complete (?q=<loan>), where its reason and promise to pay are
// filled in. Admins can edit the rules; nothing is predicted.
// ========================================

const t = CI.t;
const EWS_PAGE = 50;
const EWS_RULES = ["delay", "repeated", "payroll", "aging", "increase", "documented", "nopromise", "noreason"];

let ewsData = null;
let ewsLevel = "all";
let ewsShown = EWS_PAGE;
let ewsSort = { key: "score", dir: -1 };
let ewsRule = "";           // rule chip the list is narrowed to
let ewsView = "cards";      // "cards" or "officer"
let ewsOfficer = null;      // { id, name } picked in the officer view

async function ewsLoad() {
    const data = await CI.get("early-warning");
    if (!data) return;
    ewsData = data;
    ewsRender();
}

function ewsRender() {
    const d = ewsData;
    if (d.empty) {
        document.getElementById("ewsHistory").textContent = t("creditreport.pi.noAccess");
        return;
    }
    CI.fillOptions(d.options, d.scope, d.period);
    CI.renderAsOf(document.getElementById("ciAsOf"), d);
    const s = d.summary;
    ewsRenderSummary(d);
    const icon = { high: "⚠", medium: "▲", low: "●" };
    document.getElementById("ewsLevels").innerHTML = ["high", "medium", "low"].map(l => `
        <button type="button" class="ci-level ci-level-${l}" data-level="${l}" aria-label="${CI.esc(t("creditreport.ews.showLevel", { level: t(`creditreport.ews.level.${l}`) }))}">
            <span class="ci-level-name"><span aria-hidden="true">${icon[l]}</span> ${CI.esc(t(`creditreport.ews.level.${l}`))}</span>
            <strong>${CI.num(s[l])}</strong>
            <span class="pi-kpi-sub">${CI.money(s.balance[l])}</span>
        </button>`).join("");
    const h = d.history;
    document.getElementById("ewsHistory").textContent = h.savedDays
        ? t("creditreport.ews.historyNote", { days: h.savedDays, first: CI.dmy(h.first) })
        : t("creditreport.ews.historyNone");
    const counts = { all: s.high + s.medium + s.low, high: s.high, medium: s.medium, low: s.low };
    document.querySelectorAll("#ewsLevelTabs .ci-tab-n").forEach(n => { n.textContent = `(${CI.num(counts[n.dataset.n])})`; });
    ewsRenderRules(d);
    ewsRenderList();
}

// One line on what matters most: the high-risk loans, and how many have
// no promise to pay or no reason yet (the officer's next step).
function ewsRenderSummary(d) {
    const s = d.summary;
    const box = document.getElementById("ewsSummary");
    const total = s.high + s.medium + s.low;
    const head = s.high
        ? t("creditreport.ews.sum.high", { n: CI.num(s.high), bal: CI.money(s.balance.high) })
        : t(total ? "creditreport.ews.sum.noHigh" : "creditreport.ews.sum.none");
    const parts = [
        s.byRule.nopromise ? [t("creditreport.ews.sum.nopromise"), CI.num(s.byRule.nopromise), "bad"] : null,
        s.byRule.noreason ? [t("creditreport.ews.sum.noreason"), CI.num(s.byRule.noreason), "bad"] : null,
        [t("creditreport.ews.level.medium"), CI.num(s.medium), ""],
        [t("creditreport.ews.level.low"), CI.num(s.low), ""]
    ].filter(Boolean);
    box.hidden = false;
    box.innerHTML = `
        <div class="ci-sum-head is-${s.high ? "up" : "down"}"><span aria-hidden="true">${s.high ? "⚠" : "✓"}</span> ${CI.esc(head)}</div>
        <div class="ci-sum-sub">${CI.esc(t("creditreport.ews.sum.sub", { n: CI.num(total) }))}</div>
        <div class="ci-sum-parts">${parts.map(([label, v, tn]) => `<span class="ci-sum-part is-${tn}">${CI.esc(label)} <b>${CI.esc(v)}</b></span>`).join("")}</div>`;
    if (window.CIExplain) CI.explain(box, CIExplain.warning(d, t));
}

function ewsRuleCondition(rule, r) {
    switch (rule) {
        case "delay": return t("creditreport.ews.cond.delay", { a: r.delay.points1, b: r.delay.points30, c: r.delay.points60 });
        case "repeated": return t("creditreport.ews.cond.repeated", { n: r.repeated.episodes, days: r.repeated.windowDays });
        case "payroll": return t("creditreport.ews.cond.payroll", { match: r.payroll.match });
        case "aging": return t("creditreport.ews.cond.aging", { days: r.aging.lookbackDays });
        case "increase": return t("creditreport.ews.cond.increase", { pct: r.increase.minPct, days: r.increase.lookbackDays });
        case "documented": return t("creditreport.ews.cond.documented", { n: r.documented.keywords.length });
        case "nopromise": return t("creditreport.ews.cond.nopromise", { min: r.nopromise.minDays, max: r.nopromise.maxDays });
        case "noreason": return t("creditreport.ews.cond.noreason", { min: r.noreason.minDays });
        default: return "";
    }
}

function ewsRuleAvailable(rule, d) {
    if (rule === "repeated") return d.history.repeated;
    if (rule === "aging") return !!d.history.aging;
    if (rule === "increase") return !!d.history.increase;
    return true;
}

// What a history rule still needs before it can fire.
function ewsHistoryNeed(rule, d) {
    const r = d.rules;
    if (rule === "repeated") return t("creditreport.ews.needSaved", { n: 2, have: d.history.savedDays || 0 });
    const days = rule === "aging" ? r.aging.lookbackDays : r.increase.lookbackDays;
    return t("creditreport.ews.needDays", { n: days });
}

function ewsPointsText(rule, r) {
    if (rule === "delay") return t("creditreport.ews.ptsDelay", { a: r.delay.points1, b: r.delay.points30, c: r.delay.points60 });
    return `+${r[rule].points}`;
}

// The rules as small cards: name, points, condition, how many loans hit it.
function ewsRenderRules(d) {
    const r = d.rules;
    document.getElementById("ewsRules").innerHTML = EWS_RULES.map(rule => {
        const on = r[rule].on;
        const avail = ewsRuleAvailable(rule, d);
        const badge = !on ? `<span class="ci-rule-badge">${CI.esc(t("creditreport.ews.off"))}</span>`
            : !avail ? `<span class="ci-rule-badge is-wait">⏳ ${CI.esc(ewsHistoryNeed(rule, d))}</span>`
            : `<span class="ci-rule-badge is-n">${CI.esc(t("creditreport.npl.accountsN", { n: CI.num(d.summary.byRule[rule] || 0) }))}</span>`;
        return `<div class="ci-rule-card${!on || !avail ? " is-muted" : ""}">
            <div class="ci-rule-head"><strong>${CI.esc(t(`creditreport.ews.r.${rule}`))}</strong><span class="ci-rule-pts">${CI.esc(ewsPointsText(rule, r))}</span></div>
            <div class="ci-rule-cond">${CI.esc(ewsRuleCondition(rule, r))}</div>
            ${badge}
        </div>`;
    }).join("");
    document.getElementById("ewsLevelsNote").textContent = t("creditreport.ews.levelsNote", { high: r.levels.high, medium: r.levels.medium });
}

function ewsWarningText(w) {
    const x = w.detail || {};
    switch (w.rule) {
        case "delay": return t("creditreport.ews.w.delay", { days: x.days });
        case "repeated": return t("creditreport.ews.w.repeated", { n: x.episodes, days: x.windowDays });
        case "payroll": return t("creditreport.ews.w.payroll", { product: x.product });
        case "aging": return t("creditreport.ews.w.aging", { from: `${x.classThen} ${x.daysThen}`, to: `${x.classNow} ${x.daysNow}`, since: CI.dmy(x.since) });
        case "increase": return t("creditreport.ews.w.increase", { from: CI.money(x.balanceThen), to: CI.money(x.balanceNow), since: CI.dmy(x.since) });
        case "documented": return t("creditreport.ews.w.documented", { keyword: x.keyword });
        case "nopromise": return t("creditreport.ews.w.nopromise", { days: x.days });
        case "noreason": return t("creditreport.ews.w.noreason", { days: x.days });
        default: return w.rule;
    }
}

// Rows after the level tab, search and officer — before the rule chip, so
// the chips can count what each rule would leave.
function ewsBaseRows() {
    const q = document.getElementById("ewsSearch").value.trim().toLowerCase();
    let rows = ewsData.rows || [];
    if (ewsLevel !== "all") rows = rows.filter(r => r.level === ewsLevel);
    if (ewsOfficer) rows = rows.filter(r => (r.officerId || r.officerName) === ewsOfficer.id);
    if (q) rows = rows.filter(r => [r.ld, r.cif, r.name, r.officerName, r.officerId, r.branch, r.address, r.product].some(v => String(v || "").toLowerCase().includes(q)));
    return rows;
}

function ewsVisible() {
    let rows = ewsBaseRows();
    if (ewsRule) rows = rows.filter(r => r.warnings.some(w => w.rule === ewsRule));
    const { key, dir } = ewsSort;
    return rows.slice().sort((a, b) => dir * ((a[key] || 0) - (b[key] || 0)) || (b.score - a.score));
}

const EWS_COLS = [
    ["ld", "creditreport.npl.colLoan"], ["name", "creditreport.npl.colCustomer"], ["officerName", "creditreport.pi.officer"],
    ["branch", "creditreport.pi.branch"], ["address", "creditreport.npl.colLocation"], ["bal", "creditreport.ews.outstanding"],
    ["day", "creditreport.ews.dpd"], ["warnings", "creditreport.ews.reason"], ["score", "creditreport.ews.score"],
    ["level", "creditreport.ews.levelCol"], ["followUp", "creditreport.ews.followUp"]
];

// Work to Complete opens on the tab that holds this loan and searches it.
function ewsWorkUrl(r) {
    return `../masterdata/work.html?${new URLSearchParams({ q: r.ld })}`;
}

function ewsCard(r) {
    const lv = ewsData.rules.levels;
    return `<a class="ci-ews-card ci-ews-${r.level}" href="${CI.esc(ewsWorkUrl(r))}">
        <div class="ci-ews-top">
            <span class="ci-ews-ld">${CI.esc(r.ld)}</span>
            <span class="ci-pill ci-pill-${r.level}">${CI.esc(t(`creditreport.ews.level.${r.level}`))}</span>
            <span class="ci-ews-score">${r.score}</span>
        </div>
        <div class="ci-ews-bar" role="img" aria-label="${CI.esc(t("creditreport.ews.scoreOf", { n: r.score }))}">
            <span class="ci-ews-fill" style="width:${Math.min(100, r.score)}%"></span>
            <i style="left:${lv.medium}%"></i><i style="left:${lv.high}%"></i>
        </div>
        <div class="ci-ews-name">${CI.esc(r.name)} <span class="ci-sub">${CI.esc(r.cif)}</span></div>
        <div class="ci-ews-meta"><b>${CI.esc(t("creditreport.ews.lateDays", { n: CI.num(r.day) }))}</b> · ${CI.money(r.bal)} · ${CI.esc(r.officerName || r.officerId)} · ${CI.esc(r.branch)}</div>
        <div class="ci-ews-chips">${r.warnings.map(w => `<span class="ci-ews-chip">${CI.esc(ewsWarningText(w))} <b>+${w.points}</b></span>`).join("")}</div>
        <div class="ci-ews-foot">${CI.esc(r.followUp ? t("creditreport.ews.promiseOn", { date: CI.dmy(r.followUp) }) : t("creditreport.ews.noPromiseYet"))}<span class="ci-ews-go">${CI.esc(t("creditreport.ews.openInWork"))} ›</span></div>
    </a>`;
}

// Officer view: who holds the most high-risk loans.
function ewsOfficerRows(rows) {
    const by = new Map();
    for (const r of rows) {
        const id = r.officerId || r.officerName;
        if (!by.has(id)) by.set(id, { id, name: r.officerName || r.officerId, branch: r.branch, high: 0, medium: 0, low: 0, bal: 0, n: 0 });
        const o = by.get(id);
        o[r.level]++; o.n++; o.bal += r.bal;
    }
    return [...by.values()].sort((a, b) => b.high - a.high || b.medium - a.medium || b.bal - a.bal);
}

function ewsRenderList() {
    document.querySelectorAll("#ewsLevelTabs [data-level]").forEach(b => {
        const on = b.dataset.level === ewsLevel;
        b.classList.toggle("is-active", on);
        b.setAttribute("aria-selected", on ? "true" : "false");
    });
    document.querySelectorAll("#ewsViewTabs [data-view]").forEach(b => {
        const on = b.dataset.view === ewsView;
        b.classList.toggle("is-active", on);
        b.setAttribute("aria-selected", on ? "true" : "false");
    });
    const base = ewsBaseRows();
    const r = ewsData.rules;
    const ruleN = rule => base.filter(x => x.warnings.some(w => w.rule === rule)).length;
    if (ewsRule && !r[ewsRule].on) ewsRule = "";
    document.getElementById("ewsRuleFilter").innerHTML =
        `<button type="button" class="pi-chip${!ewsRule ? " is-active" : ""}" data-rule="">${CI.esc(t("creditreport.ews.allRules"))}</button>` +
        EWS_RULES.filter(rule => r[rule].on && ewsRuleAvailable(rule, ewsData)).map(rule =>
            `<button type="button" class="pi-chip${ewsRule === rule ? " is-active" : ""}" data-rule="${rule}">${CI.esc(t(`creditreport.ews.r.${rule}`))} (${CI.num(ruleN(rule))})</button>`).join("");
    const chip = document.getElementById("ewsOfficerChip");
    chip.hidden = !ewsOfficer;
    chip.innerHTML = ewsOfficer ? `<button type="button" class="ci-chip-x" id="ewsOfficerClear">${CI.esc(t("creditreport.pi.officer"))}: ${CI.esc(ewsOfficer.name)} ✕</button>` : "";

    const rows = ewsVisible();
    const list = document.getElementById("ewsList");
    if (ewsView === "officer" && !ewsOfficer) {
        const offs = ewsOfficerRows(rows);
        document.getElementById("ewsCount").textContent = t("creditreport.ews.officersN", { n: CI.num(offs.length) });
        list.innerHTML = offs.length ? offs.slice(0, ewsShown).map(o => `
            <button type="button" class="ci-ews-off" data-off="${CI.esc(o.id)}" data-name="${CI.esc(o.name)}">
                <span class="ci-ews-off-main"><b>${CI.esc(o.name)}</b><span class="ci-sub">${CI.esc(o.branch)} · ${CI.money(o.bal)}</span></span>
                <span class="ci-ews-off-n"><span class="ci-pill ci-pill-high">${CI.num(o.high)}</span><span class="ci-pill ci-pill-medium">${CI.num(o.medium)}</span><span class="ci-pill ci-pill-low">${CI.num(o.low)}</span></span>
                <span class="ci-ews-go" aria-hidden="true">›</span>
            </button>`).join("") : `<p class="pi-note">${CI.esc(t("creditreport.pi.nothing"))}</p>`;
        document.getElementById("ewsMore").hidden = offs.length <= ewsShown;
        return;
    }
    document.getElementById("ewsCount").textContent = t("creditreport.npl.accountsN", { n: CI.num(rows.length) });
    list.innerHTML = rows.length ? rows.slice(0, ewsShown).map(ewsCard).join("") : `<p class="pi-note">${CI.esc(t("creditreport.pi.nothing"))}</p>`;
    document.getElementById("ewsMore").hidden = rows.length <= ewsShown;
}

function ewsExport() {
    if (typeof XLSX === "undefined") { CI.toast(t("creditreport.npl.exportNotReady"), "error"); return; }
    const rows = ewsVisible();
    const aoa = [EWS_COLS.filter(([k]) => k !== "action").map(([, l]) => t(l))].concat(rows.map(r => [
        r.ld, r.name, r.officerName || r.officerId, r.branch, r.district || r.address, r.bal, r.day,
        r.warnings.map(w => `${ewsWarningText(w)} (+${w.points})`).join("; "), r.score, t(`creditreport.ews.level.${r.level}`), r.followUp || ""
    ]));
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = EWS_COLS.filter(([k]) => k !== "action").map(([k]) => ({ wch: k === "warnings" ? 60 : 16 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "EarlyWarning");
    XLSX.writeFile(wb, `EarlyWarning_${ewsData.overdueAsOf || ""}.xlsx`);
}

// ---------- admin: edit rules ----------
function ewsIsAdmin() {
    try {
        const u = JSON.parse(localStorage.getItem("loggedInUser") || sessionStorage.getItem("loggedInUser") || "{}");
        return String(u.role || "").toLowerCase() === "admin";
    } catch (e) {
        return false;
    }
}

function ewsFillEditor() {
    const r = ewsData.rules;
    const field = (rule, k, label, val) => `<label class="pi-field"><span>${CI.esc(label)}</span><input type="number" data-rule="${rule}" data-k="${k}" value="${val}"></label>`;
    document.getElementById("ewsRuleEdit").innerHTML = EWS_RULES.map(rule => {
        const x = r[rule];
        const extra = rule === "delay"
            ? field(rule, "points1", t("creditreport.ews.ptsAt", { n: 1 }), x.points1) + field(rule, "points30", t("creditreport.ews.ptsAt", { n: 30 }), x.points30) + field(rule, "points60", t("creditreport.ews.ptsAt", { n: 60 }), x.points60)
            : field(rule, "points", t("creditreport.ews.points"), x.points) +
              (rule === "repeated" ? field(rule, "episodes", t("creditreport.ews.episodes"), x.episodes) + field(rule, "windowDays", t("creditreport.ews.windowDays"), x.windowDays) : "") +
              (rule === "aging" || rule === "increase" ? field(rule, "lookbackDays", t("creditreport.ews.lookback"), x.lookbackDays) : "") +
              (rule === "increase" ? field(rule, "minPct", t("creditreport.ews.minPct"), x.minPct) : "") +
              (rule === "nopromise" ? field(rule, "minDays", t("creditreport.ews.minDays"), x.minDays) + field(rule, "maxDays", t("creditreport.ews.maxDays"), x.maxDays) : "") +
              (rule === "noreason" ? field(rule, "minDays", t("creditreport.ews.minDays"), x.minDays) : "");
        return `<fieldset class="ci-rule-box"><legend><label><input type="checkbox" data-rule="${rule}" data-k="on"${x.on ? " checked" : ""}> ${CI.esc(t(`creditreport.ews.r.${rule}`))}</label></legend><div class="ci-inline-fields">${extra}</div>${rule === "payroll" ? `<label class="pi-field"><span>${CI.esc(t("creditreport.ews.productMatch"))}</span><input type="text" data-rule="payroll" data-k="match" value="${CI.esc(x.match)}"></label>` : ""}</fieldset>`;
    }).join("");
    document.getElementById("ewsHigh").value = r.levels.high;
    document.getElementById("ewsMedium").value = r.levels.medium;
    document.getElementById("ewsKeywords").value = r.documented.keywords.join("\n");
}

async function ewsSaveRules() {
    const rules = { levels: { high: Number(document.getElementById("ewsHigh").value), medium: Number(document.getElementById("ewsMedium").value) } };
    document.querySelectorAll("#ewsRuleEdit [data-rule]").forEach(i => {
        const r = (rules[i.dataset.rule] = rules[i.dataset.rule] || {});
        r[i.dataset.k] = i.type === "checkbox" ? i.checked : i.type === "number" ? Number(i.value) : i.value;
    });
    rules.documented = { ...(rules.documented || {}), keywords: document.getElementById("ewsKeywords").value.split("\n").map(s => s.trim()).filter(Boolean) };
    try {
        const res = await fetch(`${API.BASE_URL}/api/admin/credit-intelligence/warning-rules`, {
            method: "PUT",
            headers: { Authorization: `Bearer ${localStorage.getItem("token") || sessionStorage.getItem("token")}`, "Content-Type": "application/json" },
            body: JSON.stringify({ rules })
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.message || "");
        CI.toast(t("creditreport.growth.saved"), "success");
        ewsLoad();
    } catch (e) {
        console.error(e);
        CI.toast(t("creditreport.pi.loadFailed"), "error");
    }
}

document.addEventListener("DOMContentLoaded", () => {
    CI.mountFilters({ dates: false, compare: false, onChange: () => { ewsShown = EWS_PAGE; ewsLoad(); } });
    const relist = () => { ewsShown = EWS_PAGE; if (ewsData) ewsRenderList(); };
    document.getElementById("ewsLevelTabs").addEventListener("click", e => {
        const b = e.target.closest("[data-level]");
        if (!b) return;
        ewsLevel = b.dataset.level;
        relist();
    });
    // The level cards up top filter the list to that level.
    document.getElementById("ewsLevels").addEventListener("click", e => {
        const b = e.target.closest("[data-level]");
        if (!b) return;
        ewsLevel = b.dataset.level;
        ewsView = "cards";
        relist();
        document.getElementById("ewsAccTitle").scrollIntoView({ behavior: "smooth", block: "start" });
    });
    document.getElementById("ewsRuleFilter").addEventListener("click", e => {
        const b = e.target.closest("[data-rule]");
        if (!b) return;
        ewsRule = b.dataset.rule;
        relist();
    });
    document.getElementById("ewsViewTabs").addEventListener("click", e => {
        const b = e.target.closest("[data-view]");
        if (!b) return;
        ewsView = b.dataset.view;
        ewsOfficer = null;
        relist();
    });
    document.getElementById("ewsList").addEventListener("click", e => {
        const o = e.target.closest("[data-off]");
        if (!o) return;
        ewsOfficer = { id: o.dataset.off, name: o.dataset.name };
        relist();
    });
    document.getElementById("ewsOfficerChip").addEventListener("click", e => {
        if (!e.target.closest("#ewsOfficerClear")) return;
        ewsOfficer = null;
        relist();
    });
    document.getElementById("ewsSortPick").addEventListener("change", e => {
        ewsSort = { key: e.target.value, dir: -1 };
        relist();
    });
    let typing = null;
    document.getElementById("ewsSearch").addEventListener("input", () => {
        clearTimeout(typing);
        typing = setTimeout(relist, 200);
    });
    document.getElementById("ewsMore").addEventListener("click", () => { ewsShown += EWS_PAGE; ewsRenderList(); });
    document.getElementById("ewsExport").addEventListener("click", ewsExport);
    if (ewsIsAdmin()) {
        const box = document.getElementById("ewsAdmin");
        box.hidden = false;
        box.addEventListener("toggle", () => { if (box.open && ewsData && ewsData.rules) ewsFillEditor(); });
        document.getElementById("ewsSave").addEventListener("click", ewsSaveRules);
        // "Edit rules ›" in the rules card opens the editor and scrolls to it.
        const edit = document.getElementById("ewsEditRules");
        edit.hidden = false;
        edit.addEventListener("click", () => {
            box.open = true;
            box.scrollIntoView({ behavior: "smooth", block: "start" });
        });
    }
    ewsLoad();
});
