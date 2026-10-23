// ========================================
// Credit Portfolio Intelligence — Early Warning Indicators (Module 07)
// GET /api/credit-intelligence/early-warning: today's overdue loans not
// yet NPL, each checked against transparent rules (the rule table shows
// exactly what fires and for how many points). Rows open the customer in
// Customers (?q=<loan>). Admins can edit the rules; nothing is predicted.
// ========================================

const t = CI.t;
const EWS_PAGE = 50;
const EWS_RULES = ["delay", "repeated", "payroll", "aging", "increase", "documented", "promise"];

let ewsData = null;
let ewsLevel = "all";
let ewsShown = EWS_PAGE;
let ewsSort = { key: "score", dir: -1 };

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
    const icon = { high: "⚠", medium: "▲", low: "●" };
    document.getElementById("ewsLevels").innerHTML = ["high", "medium", "low"].map(l => `
        <button type="button" class="ci-level ci-level-${l}" data-level="${l}">
            <span class="ci-level-name"><span aria-hidden="true">${icon[l]}</span> ${CI.esc(t(`creditreport.ews.level.${l}`))}</span>
            <strong>${CI.num(s[l])}</strong>
            <span class="pi-kpi-sub">${CI.money(s.balance[l])}</span>
        </button>`).join("");
    const h = d.history;
    document.getElementById("ewsHistory").textContent = h.savedDays
        ? t("creditreport.ews.historyNote", { days: h.savedDays, first: CI.dmy(h.first) })
        : t("creditreport.ews.historyNone");
    ewsRenderRules(d);
    ewsFillRuleFilter(d);
    ewsRenderTable();
}

function ewsRuleCondition(rule, r) {
    switch (rule) {
        case "delay": return t("creditreport.ews.cond.delay", { a: r.delay.points1, b: r.delay.points30, c: r.delay.points60 });
        case "repeated": return t("creditreport.ews.cond.repeated", { n: r.repeated.episodes, days: r.repeated.windowDays });
        case "payroll": return t("creditreport.ews.cond.payroll", { match: r.payroll.match });
        case "aging": return t("creditreport.ews.cond.aging", { days: r.aging.lookbackDays });
        case "increase": return t("creditreport.ews.cond.increase", { pct: r.increase.minPct, days: r.increase.lookbackDays });
        case "documented": return t("creditreport.ews.cond.documented", { n: r.documented.keywords.length });
        case "promise": return t("creditreport.ews.cond.promise");
        default: return "";
    }
}

function ewsRuleAvailable(rule, d) {
    if (rule === "repeated") return d.history.repeated;
    if (rule === "aging") return !!d.history.aging;
    if (rule === "increase") return !!d.history.increase;
    return true;
}

function ewsRenderRules(d) {
    const r = d.rules;
    const pts = rule => rule === "delay" ? `${r.delay.points1} / ${r.delay.points30} / ${r.delay.points60}` : r[rule].points;
    document.getElementById("ewsRules").innerHTML =
        `<thead><tr><th>${CI.esc(t("creditreport.ews.rule"))}</th><th>${CI.esc(t("creditreport.ews.condition"))}</th><th class="num">${CI.esc(t("creditreport.ews.points"))}</th><th class="num">${CI.esc(t("creditreport.npl.accounts"))}</th></tr></thead><tbody>` +
        EWS_RULES.map(rule => {
            const on = r[rule].on;
            const avail = ewsRuleAvailable(rule, d);
            const status = !on ? t("creditreport.ews.off") : !avail ? t("creditreport.ews.unavailable") : "";
            return `<tr${!on || !avail ? ' class="ci-muted"' : ""}><td><strong>${CI.esc(t(`creditreport.ews.r.${rule}`))}</strong>${status ? `<div class="ci-sub">${CI.esc(status)}</div>` : ""}</td><td class="ci-wrap">${CI.esc(ewsRuleCondition(rule, r))}</td><td class="num">${CI.esc(pts(rule))}</td><td class="num">${CI.num(d.summary.byRule[rule] || 0)}</td></tr>`;
        }).join("") +
        `</tbody><caption>${CI.esc(t("creditreport.ews.levelsNote", { high: r.levels.high, medium: r.levels.medium }))}</caption>`;
}

function ewsFillRuleFilter(d) {
    const sel = document.getElementById("ewsRuleFilter");
    const keep = sel.value;
    sel.innerHTML = `<option value="">${CI.esc(t("creditreport.ews.allRules"))}</option>` +
        EWS_RULES.map(r => `<option value="${r}">${CI.esc(t(`creditreport.ews.r.${r}`))} (${CI.num(d.summary.byRule[r] || 0)})</option>`).join("");
    sel.value = keep;
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
        case "promise": return t("creditreport.ews.w.promise", { date: CI.dmy(x.promised) });
        default: return w.rule;
    }
}

function ewsVisible() {
    const q = document.getElementById("ewsSearch").value.trim().toLowerCase();
    const rule = document.getElementById("ewsRuleFilter").value;
    let rows = ewsData.rows || [];
    if (ewsLevel !== "all") rows = rows.filter(r => r.level === ewsLevel);
    if (rule) rows = rows.filter(r => r.warnings.some(w => w.rule === rule));
    if (q) rows = rows.filter(r => [r.ld, r.cif, r.name, r.officerName, r.officerId, r.branch, r.address, r.product].some(v => String(v || "").toLowerCase().includes(q)));
    const { key, dir } = ewsSort;
    const numeric = ["score", "bal", "day"].includes(key);
    return rows.slice().sort((a, b) => numeric ? dir * ((a[key] || 0) - (b[key] || 0)) : dir * String(a[key] || "").localeCompare(String(b[key] || "")));
}

const EWS_COLS = [
    ["ld", "creditreport.npl.colLoan"], ["name", "creditreport.npl.colCustomer"], ["officerName", "creditreport.pi.officer"],
    ["branch", "creditreport.pi.branch"], ["address", "creditreport.npl.colLocation"], ["bal", "creditreport.ews.outstanding"],
    ["day", "creditreport.ews.dpd"], ["warnings", "creditreport.ews.reason"], ["score", "creditreport.ews.score"],
    ["level", "creditreport.ews.levelCol"], ["followUp", "creditreport.ews.followUp"]
].concat(CI.canCreateAction() ? [["action", "creditreport.act.col"]] : []);

function ewsRenderTable() {
    document.querySelectorAll("#ewsLevelTabs [data-level]").forEach(b => {
        const on = b.dataset.level === ewsLevel;
        b.classList.toggle("is-active", on);
        b.setAttribute("aria-selected", on ? "true" : "false");
    });
    const rows = ewsVisible();
    document.getElementById("ewsCount").textContent = t("creditreport.npl.accountsN", { n: CI.num(rows.length) });
    const sortable = ["ld", "name", "officerName", "branch", "bal", "day", "score", "followUp"];
    const head = `<thead><tr>${EWS_COLS.map(([k, l]) => {
        const num = ["bal", "day", "score"].includes(k);
        const label = CI.esc(t(l));
        if (!sortable.includes(k)) return `<th>${label}</th>`;
        const on = ewsSort.key === k;
        return `<th${num ? ' class="num"' : ""} aria-sort="${on ? (ewsSort.dir > 0 ? "ascending" : "descending") : "none"}"><button type="button" class="ci-sort" data-key="${k}">${label}${on ? (ewsSort.dir > 0 ? " ▲" : " ▼") : ""}</button></th>`;
    }).join("")}</tr></thead>`;
    const body = rows.slice(0, ewsShown).map(r => `<tr>
        <td><a class="ci-link" href="/CM_Pro/pages/customers/index.html?q=${encodeURIComponent(r.ld)}">${CI.esc(r.ld)}</a></td>
        <td>${CI.esc(r.name)}<div class="ci-sub">${CI.esc(r.cif)}</div></td>
        <td>${CI.esc(r.officerName || r.officerId)}</td>
        <td>${CI.esc(r.branch)}</td>
        <td>${CI.esc(r.district || r.address)}</td>
        <td class="num">${CI.money(r.bal)}</td>
        <td class="num">${CI.num(r.day)}</td>
        <td class="ci-reason">${r.warnings.map(w => `<div>• ${CI.esc(ewsWarningText(w))} <span class="ci-sub">+${w.points}</span></div>`).join("")}</td>
        <td class="num"><strong>${r.score}</strong></td>
        <td><span class="ci-pill ci-pill-${r.level}">${CI.esc(t(`creditreport.ews.level.${r.level}`))}</span></td>
        <td>${r.followUp ? CI.dmy(r.followUp) : "—"}</td>
        ${CI.canCreateAction() ? `<td><a class="ci-link" href="${CI.esc(CI.actionLink({
            loan: r.ld, branch: r.branch, officer: r.officerId, customer: r.name, source: "ews",
            desc: t("creditreport.act.descEws", { reasons: r.warnings.map(ewsWarningText).join("; ") })
        }))}">${CI.esc(t("creditreport.act.add"))}</a></td>` : ""}
    </tr>`).join("");
    document.getElementById("ewsTable").innerHTML = head + `<tbody>${body || `<tr><td colspan="${EWS_COLS.length}" class="pi-note">${CI.esc(t("creditreport.pi.nothing"))}</td></tr>`}</tbody>`;
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
            ? field(rule, "points1", "1+", x.points1) + field(rule, "points30", "30+", x.points30) + field(rule, "points60", "60+", x.points60)
            : field(rule, "points", t("creditreport.ews.points"), x.points) +
              (rule === "repeated" ? field(rule, "episodes", t("creditreport.ews.episodes"), x.episodes) + field(rule, "windowDays", t("creditreport.ews.windowDays"), x.windowDays) : "") +
              (rule === "aging" || rule === "increase" ? field(rule, "lookbackDays", t("creditreport.ews.lookback"), x.lookbackDays) : "") +
              (rule === "increase" ? field(rule, "minPct", t("creditreport.ews.minPct"), x.minPct) : "");
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
    document.getElementById("ewsLevelTabs").addEventListener("click", e => {
        const b = e.target.closest("[data-level]");
        if (!b || !ewsData) return;
        ewsLevel = b.dataset.level;
        ewsShown = EWS_PAGE;
        ewsRenderTable();
    });
    document.getElementById("ewsLevels").addEventListener("click", e => {
        const b = e.target.closest("[data-level]");
        if (!b || !ewsData) return;
        ewsLevel = b.dataset.level;
        ewsShown = EWS_PAGE;
        ewsRenderTable();
        document.getElementById("ewsAccTitle").scrollIntoView({ behavior: "smooth", block: "start" });
    });
    document.getElementById("ewsTable").addEventListener("click", e => {
        const b = e.target.closest(".ci-sort");
        if (!b) return;
        ewsSort = ewsSort.key === b.dataset.key ? { key: b.dataset.key, dir: -ewsSort.dir } : { key: b.dataset.key, dir: -1 };
        ewsRenderTable();
    });
    let typing = null;
    document.getElementById("ewsSearch").addEventListener("input", () => {
        clearTimeout(typing);
        typing = setTimeout(() => { ewsShown = EWS_PAGE; if (ewsData) ewsRenderTable(); }, 200);
    });
    document.getElementById("ewsRuleFilter").addEventListener("change", () => { ewsShown = EWS_PAGE; if (ewsData) ewsRenderTable(); });
    document.getElementById("ewsMore").addEventListener("click", () => { ewsShown += EWS_PAGE; ewsRenderTable(); });
    document.getElementById("ewsExport").addEventListener("click", ewsExport);
    if (ewsIsAdmin()) {
        const box = document.getElementById("ewsAdmin");
        box.hidden = false;
        box.addEventListener("toggle", () => { if (box.open && ewsData && ewsData.rules) ewsFillEditor(); });
        document.getElementById("ewsSave").addEventListener("click", ewsSaveRules);
    }
    ewsLoad();
});
