// ========================================
// Credit Portfolio Intelligence — Recovery Actions (Phase 3)
// GET /api/credit-intelligence/actions: today's overdue loans with their
// latest action — follow-ups due, promises to pay due or broken, cases
// with no action yet, escalations. A case opens a form that ADDS an
// entry (POST /actions/:ld) and the loan's full history; entries are
// never edited. Payments recorded here are officer-reported, not cash
// recovered — the recovery figures stay in NPL Management → NPL Recovery.
// ========================================

const t = CI.t;
const RA_PAGE = 50;
const RA_VIEWS = ["follow_up", "ptp_due", "ptp_broken", "no_action", "escalated", "all"];
const RA_ENUMS = {
    contact: ["not_tried", "reached", "no_answer", "wrong_number", "refused"],
    visit: ["not_planned", "planned", "visited_met", "visited_not_met", "address_not_found"],
    outcome: ["pending", "paid_full", "paid_partial", "not_paid"],
    escalation: ["none", "branch_manager", "recovery_team", "legal"]
};

let raData = null;
let raView = new URLSearchParams(location.search).get("view") || "follow_up";
let raLimit = RA_PAGE;
let raOpen = null;   // the loan row open in the dialog

const raE = (kind, v) => t(`creditreport.ra.${kind}.${v}`);
const raToken = () => localStorage.getItem("token") || sessionStorage.getItem("token");

async function raLoad() {
    const data = await CI.get("actions", { view: raView, limit: raLimit, q: document.getElementById("raSearch").value.trim() });
    if (!data) return;
    raData = data;
    raRender();
}

function raRender() {
    const d = raData;
    if (d.empty) {
        document.getElementById("raList").innerHTML = `<p class="pi-note">${CI.esc(t("creditreport.pi.noAccess"))}</p>`;
        return;
    }
    CI.fillOptions(d.options, d.scope, d.period);
    CI.renderAsOf(document.getElementById("ciAsOf"), d);
    const s = d.summary;
    const box = document.getElementById("raSummary");
    box.hidden = false;
    box.innerHTML = `
        <div class="ci-sum-head is-${s.followUpDue.loans || s.ptpBroken.loans ? "up" : "down"}"><span aria-hidden="true">${s.followUpDue.loans ? "⚑" : "✓"}</span> ${CI.esc(t("creditreport.ra.sum.head", { n: CI.num(s.followUpDue.loans), broken: CI.num(s.ptpBroken.loans) }))}</div>
        <div class="ci-sum-sub">${CI.esc(t("creditreport.ra.sum.sub", { n: CI.num(s.noAction.loans), par: CI.money(s.noAction.par), total: CI.num(s.overdue.loans) }))}</div>
        <div class="ci-sum-parts">
            <span class="ci-sum-part is-bad">${CI.esc(t("creditreport.ra.v.ptp_due"))} <b>${CI.num(s.ptpDue.loans)}</b></span>
            <span class="ci-sum-part is-bad">${CI.esc(t("creditreport.ra.v.escalated"))} <b>${CI.num(s.escalated.loans)}</b></span>
            <span class="ci-sum-part">${CI.esc(t("creditreport.ra.reportedPaid", { n: CI.num(s.reportedPaid.loans), amount: CI.money(s.reportedPaid.amount) }))}</span>
        </div>`;
    const counts = { follow_up: s.followUpDue.loans, ptp_due: s.ptpDue.loans, ptp_broken: s.ptpBroken.loans, no_action: s.noAction.loans, escalated: s.escalated.loans, all: s.overdue.loans };
    document.getElementById("raViews").innerHTML = RA_VIEWS.map(v =>
        `<button type="button" class="pi-chip${raView === v ? " is-active" : ""}" data-view="${v}">${CI.esc(t(`creditreport.ra.v.${v}`))} (${CI.num(counts[v])})</button>`).join("");
    document.getElementById("raCount").textContent = t("creditreport.rc.countN", { shown: CI.num(d.rows.length), n: CI.num(d.listedCount) });
    document.getElementById("raList").innerHTML = d.rows.length ? d.rows.map(raCard).join("") : `<p class="pi-note">${CI.esc(t("creditreport.pi.nothing"))}</p>`;
    document.getElementById("raMore").hidden = d.rows.length >= d.listedCount;
    const link = document.getElementById("raMetricsLink");
    link.href = `NplIntelligence.html?${new URLSearchParams([...CI.query().entries(), ["view", "recovery"]])}`;
}

function raFlags(r) {
    const s = r.state;
    const f = [];
    if (!r.latest) f.push(["is-warn", t("creditreport.ra.v.no_action")]);
    if (s.followUpOverdue) f.push(["is-bad", t("creditreport.ra.flag.followLate", { date: CI.dmy(r.latest.followUp) })]);
    else if (s.followUpDue) f.push(["is-warn", t("creditreport.ra.flag.followToday")]);
    if (s.ptpBroken) f.push(["is-bad", t("creditreport.ra.flag.broken", { date: CI.dmy(r.latest.ptp.date) })]);
    if (s.ptpDue) f.push(["is-warn", t("creditreport.ra.flag.ptpToday")]);
    if (s.stage === "escalated") f.push(["is-bad", raE("esc", r.latest.escalation)]);
    return f.map(([c, l]) => `<span class="ra-flag ${c}">${CI.esc(l)}</span>`).join("");
}

function raCard(r) {
    const a = r.latest;
    return `<div class="ci-card ra-card${r.state.followUpOverdue || r.state.ptpBroken ? " is-late" : ""}">
        <div class="ci-card-top"><span class="ci-card-id">${CI.esc(r.ld)}</span><span class="ra-flags">${raFlags(r)}</span></div>
        <div class="ci-card-name">${CI.esc(r.name || "—")} <span class="ci-sub">${CI.esc(r.cif)}</span></div>
        <div class="crk-facts"><span>PAR <b>${CI.money(r.par)}</b></span><span>${CI.esc(t("creditreport.crk.colDpd"))} <b>${CI.num(r.day)}</b></span><span>${CI.esc(CI.clsName(r.cls))}</span></div>
        <div class="ci-sub">${CI.esc(r.officerName || r.officerId)} · ${CI.esc(r.branch)} · ${CI.esc(r.product)}</div>
        ${a ? `<div class="ra-latest">
            <div>${CI.esc(t("creditreport.ra.assignee", { name: (a.assignee && (a.assignee.name || a.assignee.id)) || "—" }))} · ${CI.esc(raE("contact", a.contact))} · ${CI.esc(raE("visit", a.visit))}</div>
            ${a.followUp ? `<div>${CI.esc(t("creditreport.ra.followUpOn", { date: CI.dmy(a.followUp) }))}</div>` : ""}
            ${a.ptp ? `<div>${CI.esc(t("creditreport.ra.ptpOn", { amount: CI.money(a.ptp.amount), date: CI.dmy(a.ptp.date) }))}</div>` : ""}
            ${a.outcome ? `<div>${CI.esc(t("creditreport.ra.outcomeLine", { status: raE("out", a.outcome.status), amount: a.outcome.amount === null ? "" : CI.money(a.outcome.amount) }))}</div>` : ""}
            ${a.next ? `<div><b>${CI.esc(t("creditreport.ra.f.next"))}:</b> ${CI.esc(a.next)}</div>` : ""}
            <div class="ci-sub">${CI.esc(t("creditreport.ra.lastBy", { by: a.by, at: CI.dmy(String(a.at || "").slice(0, 10)), n: a.entries }))}</div>
        </div>` : ""}
        <div class="ra-actions"><button type="button" class="pi-btn-ghost ra-open" data-ld="${CI.esc(r.ld)}">${CI.esc(t(a ? "creditreport.ra.update" : "creditreport.ra.add"))}</button></div>
    </div>`;
}

function raFill(id, kind, values, current) {
    document.getElementById(id).innerHTML = values.map(v => `<option value="${v}"${v === current ? " selected" : ""}>${CI.esc(raE(kind, v))}</option>`).join("");
}

async function raOpenCase(ld) {
    raOpen = raData.rows.find(r => r.ld === ld);
    if (!raOpen) return;
    const a = raOpen.latest || {};
    const dlg = document.getElementById("raDialog");
    document.getElementById("raDlgTitle").textContent = `${raOpen.ld} · ${raOpen.name || ""}`;
    document.getElementById("raDlgLoan").textContent = `PAR ${CI.money(raOpen.par)} · ${t("creditreport.crk.colDpd")} ${CI.num(raOpen.day)} · ${raOpen.officerName || raOpen.officerId} · ${raOpen.branch}`;
    // The form starts from the latest entry; saving adds a new one.
    const officers = raData.assignees || [];
    const cur = (a.assignee && a.assignee.id) || raOpen.officerId;
    // No silent default: when the loan's officer isn't in the list, nobody is picked.
    const same = o => String(o.id).replace(/^0+/, "") === String(cur).replace(/^0+/, "");
    document.getElementById("raAssignee").innerHTML = `<option value="">— ${CI.esc(t("creditreport.ra.noAssignee"))} —</option>` + officers.map(o =>
        `<option value="${CI.esc(o.id)}"${same(o) ? " selected" : ""}>${CI.esc(o.name || o.id)} · ${CI.esc(o.branch)}</option>`).join("");
    raFill("raContact", "contact", RA_ENUMS.contact, a.contact);
    raFill("raVisit", "visit", RA_ENUMS.visit, a.visit);
    raFill("raOutStatus", "out", RA_ENUMS.outcome, a.outcome ? a.outcome.status : "pending");
    raFill("raEscalation", "esc", RA_ENUMS.escalation, a.escalation || "none");
    document.getElementById("raFollowUp").value = a.followUp || "";
    document.getElementById("raPtpAmount").value = a.ptp ? a.ptp.amount : "";
    document.getElementById("raPtpDate").value = a.ptp ? a.ptp.date : "";
    document.getElementById("raOutAmount").value = a.outcome && a.outcome.amount !== null ? a.outcome.amount : "";
    document.getElementById("raOutDate").value = a.outcome ? a.outcome.date || "" : "";
    document.getElementById("raResult").value = "";
    document.getElementById("raNext").value = a.next || "";
    if (typeof dlg.showModal === "function") dlg.showModal(); else dlg.setAttribute("open", "");
    raLoadHistory(ld);
}

async function raLoadHistory(ld) {
    const box = document.getElementById("raHistory");
    box.innerHTML = `<p class="pi-note">${CI.esc(t("common.loading"))}</p>`;
    try {
        const res = await fetch(`${API.BASE_URL}/api/credit-intelligence/actions/${encodeURIComponent(ld)}`, { headers: { Authorization: `Bearer ${raToken()}` } });
        const data = await res.json();
        if (!data.ok) throw new Error(data.message || "");
        box.innerHTML = data.entries.length ? data.entries.map(e => `<div class="ra-entry">
            <b>${CI.esc(CI.dmy(String(e.at || "").slice(0, 10)))} ${CI.esc(String(e.at || "").slice(11, 16))} · ${CI.esc(e.by)}</b>
            <span>${CI.esc(t("creditreport.ra.assignee", { name: (e.assignee && (e.assignee.name || e.assignee.id)) || "—" }))} · ${CI.esc(raE("contact", e.contact))} · ${CI.esc(raE("visit", e.visit))}${e.escalation && e.escalation !== "none" ? ` · ${CI.esc(raE("esc", e.escalation))}` : ""}</span>
            ${e.followUp ? `<span>${CI.esc(t("creditreport.ra.followUpOn", { date: CI.dmy(e.followUp) }))}</span>` : ""}
            ${e.ptp ? `<span>${CI.esc(t("creditreport.ra.ptpOn", { amount: CI.money(e.ptp.amount), date: CI.dmy(e.ptp.date) }))}</span>` : ""}
            ${e.outcome ? `<span>${CI.esc(t("creditreport.ra.outcomeLine", { status: raE("out", e.outcome.status), amount: e.outcome.amount === null ? "" : CI.money(e.outcome.amount) }))}</span>` : ""}
            ${e.result ? `<span>${CI.esc(t("creditreport.ra.f.result"))}: ${CI.esc(e.result)}</span>` : ""}
            ${e.next ? `<span>${CI.esc(t("creditreport.ra.f.next"))}: ${CI.esc(e.next)}</span>` : ""}
        </div>`).join("") : `<p class="pi-note">${CI.esc(t("creditreport.ra.noHistory"))}</p>`;
    } catch (e) {
        console.error(e);
        box.innerHTML = `<p class="pi-note">${CI.esc(t("creditreport.pi.loadFailed"))}</p>`;
    }
}

async function raSave(ev) {
    ev.preventDefault();
    if (!raOpen) return;
    const v = id => document.getElementById(id).value;
    const outStatus = v("raOutStatus");
    const body = {
        assignee: v("raAssignee"),
        contact: v("raContact"), visit: v("raVisit"), escalation: v("raEscalation"),
        followUp: v("raFollowUp"),
        ptp: v("raPtpAmount") || v("raPtpDate") ? { amount: v("raPtpAmount"), date: v("raPtpDate") } : null,
        outcome: outStatus && outStatus !== "pending" || v("raOutAmount") ? { status: outStatus, amount: v("raOutAmount"), date: v("raOutDate") } : null,
        result: v("raResult"), next: v("raNext")
    };
    try {
        const res = await fetch(`${API.BASE_URL}/api/credit-intelligence/actions/${encodeURIComponent(raOpen.ld)}`, {
            method: "POST",
            headers: { Authorization: `Bearer ${raToken()}`, "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });
        const data = await res.json();
        if (!data.ok) {
            CI.toast(t(`creditreport.ra.err.${data.code || "x"}`) || t("creditreport.ra.saveFailed"), "error");
            return;
        }
        CI.toast(t("creditreport.ra.saved"), "success");
        raLoadHistory(raOpen.ld);
        raLoad();
    } catch (e) {
        console.error(e);
        CI.toast(t("creditreport.ra.saveFailed"), "error");
    }
}

document.addEventListener("DOMContentLoaded", () => {
    CI.mountFilters({ dates: false, compare: false, onChange: () => { raLimit = RA_PAGE; raLoad(); } });
    document.getElementById("raViews").addEventListener("click", e => {
        const b = e.target.closest("[data-view]");
        if (!b) return;
        raView = b.dataset.view;
        raLimit = RA_PAGE;
        raLoad();
    });
    let typing = null;
    document.getElementById("raSearch").addEventListener("input", () => {
        clearTimeout(typing);
        typing = setTimeout(() => { raLimit = RA_PAGE; raLoad(); }, 400);
    });
    document.getElementById("raMore").addEventListener("click", () => { raLimit += RA_PAGE; raLoad(); });
    document.getElementById("raList").addEventListener("click", e => {
        const b = e.target.closest(".ra-open");
        if (b) raOpenCase(b.dataset.ld);
    });
    const dlg = document.getElementById("raDialog");
    document.getElementById("raDlgClose").addEventListener("click", () => (dlg.close ? dlg.close() : dlg.removeAttribute("open")));
    document.getElementById("raForm").addEventListener("submit", raSave);
    raLoad();
});
