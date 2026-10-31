// ========================================
// Credit Portfolio Intelligence — Customer Risk
// GET /api/credit-intelligence/customers: today's NBC Overdue loans (PAR,
// all classes) added up per customer (CIF) — or listed per loan — ranked
// by PAR amount, outstanding, days past due or risk score (Early
// Warning's rules), with PAR concentration and each customer's change
// since the comparison day. A row opens the customer
// (/customers/detail): its loans, documented reason and saved history.
// The server applies scope and filters; nothing is computed here but
// display.
// ========================================

const t = CI.t;
const CRK_STATUSES = ["new", "deteriorating", "improved", "same"];

let crkData = null;
let crkUnit = "customer";
let crkStatus = "";

function crkParams() {
    return {
        unit: crkUnit,
        sort: document.getElementById("crkSort").value,
        top: document.getElementById("crkTop").value,
        status: crkStatus,
        // Searched on the server: any customer in scope, not only the top N.
        q: document.getElementById("crkSearch").value.trim()
    };
}

async function crkLoad() {
    const data = await CI.get("customers", crkParams());
    if (!data) return;
    crkData = data;
    crkRender();
}

function crkRender() {
    const d = crkData;
    if (d.empty) {
        document.getElementById("crkList").innerHTML = `<p class="pi-note">${CI.esc(t("creditreport.pi.noAccess"))}</p>`;
        return;
    }
    CI.fillOptions(d.options, d.scope, d.period);
    CI.renderAsOf(document.getElementById("ciAsOf"), d);
    crkRenderSummary(d);
    crkRenderKpis(d);
    crkRenderConc(d);
    crkRenderMoves(d);
    crkRenderList();
}

// What matters first: how much of the PAR the largest customers hold.
function crkRenderSummary(d) {
    const box = document.getElementById("crkSummary");
    const top = d.concentration.tops.find(x => x.top === 20) || d.concentration.tops[0];
    const mv = d.movement && d.movement.customers;
    box.hidden = false;
    box.innerHTML = `
        <div class="ci-sum-head"><span aria-hidden="true">◎</span> ${CI.esc(t("creditreport.crk.sum.head", { n: CI.num(top.customers), share: CI.pct(top.share, 1), par: CI.money(top.par) }))}</div>
        <div class="ci-sum-sub">${CI.esc(t("creditreport.crk.sum.sub", { half: CI.num(d.concentration.halfOfPar), customers: CI.num(d.counts.customers) }))}</div>
        ${mv ? `<div class="ci-sum-parts">
            <span class="ci-sum-part is-bad">${CI.esc(t("creditreport.crk.st.new"))} <b>${CI.num(mv.new.count)}</b></span>
            <span class="ci-sum-part is-bad">${CI.esc(t("creditreport.crk.st.deteriorating"))} <b>${CI.num(mv.deteriorating.count)}</b></span>
            <span class="ci-sum-part is-good">${CI.esc(t("creditreport.crk.st.improved"))} <b>${CI.num(mv.improved.count)}</b></span>
        </div>` : ""}`;
}

// Customers, CIFs and loan accounts side by side, so they are never confused.
function crkRenderKpis(d) {
    const c = d.counts;
    const tot = d.totals;
    const kpi = (label, value, sub) => `<div class="pi-kpi"><div class="pi-kpi-label">${CI.esc(label)}</div><div class="pi-kpi-value">${value}</div><div class="pi-kpi-sub">${sub || ""}</div></div>`;
    document.getElementById("crkKpis").innerHTML = [
        kpi(t("creditreport.crk.k.par"), CI.money(tot.par), CI.esc(t("creditreport.crk.k.parPct", { pct: CI.pct(tot.parPct) }))),
        kpi(t("creditreport.crk.k.customers"), CI.num(c.customers), CI.esc(t("creditreport.crk.k.multi", { n: CI.num(c.multiLoanCustomers) }))),
        kpi(t("creditreport.crk.k.cifs"), CI.num(c.cifs), c.loansWithoutCif ? CI.esc(t("creditreport.crk.k.noCif", { n: CI.num(c.loansWithoutCif) })) : ""),
        kpi(t("creditreport.crk.k.loans"), CI.num(c.loanAccounts), CI.esc(t("creditreport.crk.k.os", { os: CI.money(tot.os) })))
    ].join("");
}

function crkRenderConc(d) {
    const k = d.concentration;
    document.getElementById("crkConc").innerHTML = k.tops.map(x => `
        <div class="pi-bar-row">
            <div class="pi-bar-head"><span class="pi-bar-name">${CI.esc(t("creditreport.crk.topN", { n: x.top }))}</span><span class="pi-bar-val">${CI.pct(x.share, 1)}</span></div>
            <div class="pi-bar-track"><span class="pi-bar-fill" style="width:${Math.round((x.share || 0) * 100)}%"></span></div>
            <div class="pi-bar-meta">${CI.esc(t("creditreport.crk.topMeta", { n: CI.num(x.customers), par: CI.money(x.par) }))}</div>
        </div>`).join("");
    document.getElementById("crkHalf").textContent = k.total
        ? t("creditreport.crk.half", { n: CI.num(k.halfOfPar), total: CI.num(d.counts.customers) })
        : t("creditreport.pi.nothing");
}

function crkRenderMoves(d) {
    const c = d.compare;
    const note = document.getElementById("crkCompareNote");
    const box = document.getElementById("crkMoves");
    if (!c.available) {
        note.textContent = c.reason === "history_empty" ? t("creditreport.crk.noHistory") : t("creditreport.crk.noSavedDay", { first: CI.dmy(c.firstSaved) });
        box.innerHTML = "";
        return;
    }
    note.textContent = t("creditreport.crk.comparedWith", { date: CI.dmy(c.date) });
    const m = d.movement;
    box.innerHTML = CRK_STATUSES.map(s => `
        <button type="button" class="crk-move crk-move-${s}${crkStatus === s ? " is-active" : ""}" data-status="${s}">
            <span class="crk-move-name">${CI.esc(t(`creditreport.crk.st.${s}`))}</span>
            <strong>${CI.num(m.customers[s].count)}</strong>
            <span class="pi-kpi-sub">${CI.esc(t("creditreport.crk.moveSub", { loans: CI.num(m.loans[s].count), par: CI.money(m.customers[s].par) }))}</span>
        </button>`).join("");
}

function crkStatusChip(s) {
    return s ? `<span class="crk-st crk-st-${s}">${CI.esc(t(`creditreport.crk.st.${s}`))}</span>` : "";
}

function crkVisible() {
    return crkData.rows || [];
}

function crkCard(r, i) {
    const lvl = r.level ? `<span class="ci-pill ci-pill-${r.level}" title="${CI.esc(t("creditreport.crk.scoreTip"))}">${CI.esc(t(`creditreport.ews.level.${r.level}`))} ${r.score}</span>` : "";
    const change = r.change === null || r.change === undefined ? "" :
        `<span class="crk-change ${r.change > 0 ? "is-up" : r.change < 0 ? "is-down" : ""}">${r.change > 0 ? "▲" : r.change < 0 ? "▼" : ""} ${CI.money(Math.abs(r.change))}</span>`;
    const isLoan = crkUnit === "loan";
    const who = isLoan
        ? `${CI.esc(r.ld)} · ${CI.esc(r.product)}`
        : `${CI.esc(r.cif || t("creditreport.crk.noCif"))} · ${CI.esc(t("creditreport.crk.loansN", { n: r.loans }))}`;
    const where = isLoan
        ? `${CI.esc(r.officerName || r.officerId)} · ${CI.esc(r.branch)}`
        : `${CI.esc((r.officers || []).map(o => o.name).join(", "))} · ${CI.esc((r.branches || []).join(", "))}`;
    const open = r.cif ? `data-cif="${CI.esc(r.cif)}"` : `data-ld="${CI.esc(isLoan ? r.ld : String(r.key).replace(/^ld:/, ""))}"`;
    return `<button type="button" class="ci-card crk-card" ${open}>
        <div class="ci-card-top">
            <span class="crk-rank">${i + 1}</span>
            <span class="ci-card-name">${CI.esc(r.name || "—")}</span>
            ${r.conflict ? `<span class="crk-st crk-st-conflict" title="${CI.esc(t("creditreport.crk.conflictTip"))}">⚠ ${CI.esc(t("creditreport.crk.conflict"))}</span>` : ""}
            ${crkStatusChip(r.status)}
        </div>
        <div class="ci-sub">${who}</div>
        <div class="ci-card-row"><span>${CI.esc(t("creditreport.crk.colPar"))}</span><span class="ci-card-amt">${CI.money(r.par)} ${change}</span></div>
        ${isLoan ? "" : `<div class="crk-share"><span style="width:${Math.round((r.share || 0) * 100)}%"></span></div><div class="ci-sub">${CI.esc(t("creditreport.crk.shareOf", { pct: CI.pct(r.share, 1) }))}</div>`}
        <div class="crk-facts">
            <span>${CI.esc(t("creditreport.crk.colOs"))} <b>${r.os === null ? "—" : CI.money(r.os)}</b></span>
            <span>${CI.esc(t("creditreport.crk.colDpd"))} <b>${CI.num(r.day)}</b></span>
            <span>${CI.esc(CI.clsName(r.cls))}</span>
            ${lvl}
        </div>
        <div class="ci-sub">${where}</div>
    </button>`;
}

function crkRenderList() {
    const d = crkData;
    document.querySelectorAll("#crkUnitTabs [data-unit]").forEach(b => {
        const on = b.dataset.unit === crkUnit;
        b.classList.toggle("is-active", on);
        b.setAttribute("aria-selected", on ? "true" : "false");
    });
    const st = document.getElementById("crkStatus");
    st.hidden = !d.compare.available;
    st.innerHTML = `<button type="button" class="pi-chip${!crkStatus ? " is-active" : ""}" data-status="">${CI.esc(t("creditreport.ews.all"))}</button>` +
        CRK_STATUSES.map(s => `<button type="button" class="pi-chip${crkStatus === s ? " is-active" : ""}" data-status="${s}">${CI.esc(t(`creditreport.crk.st.${s}`))}</button>`).join("");
    const rows = crkVisible();
    document.getElementById("crkCount").textContent = t(crkUnit === "loan" ? "creditreport.crk.countLoans" : "creditreport.crk.countCustomers",
        { shown: CI.num(rows.length), n: CI.num(d.listedCount) }) + (d.q ? ` · ${t("creditreport.crk.searchFor", { q: d.q })}` : "");
    // Loans listed with different CIF / branch / officer on NBC Overdue.
    const dq = d.dataQuality || {};
    const warn = document.getElementById("crkQuality");
    warn.hidden = !dq.conflictLoans;
    warn.textContent = dq.conflictLoans ? t("creditreport.crk.qualityNote", { n: CI.num(dq.conflictLoans), par: CI.money(dq.conflictPar) }) : "";
    document.getElementById("crkList").innerHTML = rows.length ? rows.map(crkCard).join("") : `<p class="pi-note">${CI.esc(t("creditreport.pi.nothing"))}</p>`;
    const rec = d.totals.reconciliation;
    document.getElementById("crkDefs").textContent = [
        t("creditreport.crk.defs"),
        rec ? t(rec.diff ? "creditreport.crk.reconDiff" : "creditreport.crk.reconOk", { report: CI.money(rec.reportPar), diff: CI.money(rec.diff) }) : t("creditreport.crk.reconOff"),
        d.totals.osMissing ? t("creditreport.crk.osMissing", { n: CI.num(d.totals.osMissing) }) : "",
        d.dataQuality && d.dataQuality.osDuplicateLoans ? t("creditreport.crk.osDuplicates", { n: CI.num(d.dataQuality.osDuplicateLoans), dropped: CI.money(d.dataQuality.osDuplicateDropped) }) : ""
    ].filter(Boolean).join(" ");
}

// ---------- one customer ----------
async function crkOpen(params) {
    const dlg = document.getElementById("crkDialog");
    const body = document.getElementById("crkDlgBody");
    document.getElementById("crkDlgTitle").textContent = t("common.loading");
    body.innerHTML = "";
    if (typeof dlg.showModal === "function") dlg.showModal(); else dlg.setAttribute("open", "");
    const d = await CI.get("customers/detail", params);
    if (!d) { dlg.close && dlg.close(); return; }
    const c = d.customer;
    document.getElementById("crkDlgTitle").textContent = c.name || c.cif;
    body.innerHTML = `
        <div class="crk-dlg-sum">
            <span>${CI.esc(c.cif || t("creditreport.crk.noCif"))}</span>
            <span>${CI.esc(t("creditreport.crk.loansN", { n: c.loans }))}</span>
            <span>${CI.esc(t("creditreport.crk.colPar"))} <b>${CI.money(c.par)}</b></span>
            <span>${CI.esc(t("creditreport.crk.colOs"))} <b>${CI.money(c.os)}</b></span>
            ${crkStatusChip(c.status)}
        </div>
        <p class="pi-note">${CI.esc(d.historyDays ? t("creditreport.crk.historyNote", { n: d.historyDays, first: CI.dmy(d.firstSaved) }) : t("creditreport.crk.noHistory"))}</p>
        ${d.loans.map(crkLoanBlock).join("")}`;
}

function crkLoanBlock(l) {
    const r = l.reason;
    const hist = l.history || [];
    const ws = (l.warnings || []).map(w => `<span class="ci-ews-chip">${CI.esc(t(`creditreport.ews.r.${w.rule}`))} <b>+${w.points}</b></span>`).join("");
    return `<div class="crk-loan">
        <div class="ci-card-top"><b>${CI.esc(l.ld)}</b>${crkStatusChip(l.status)}${l.level ? `<span class="ci-pill ci-pill-${l.level}">${CI.esc(t(`creditreport.ews.level.${l.level}`))} ${l.score}</span>` : ""}</div>
        <div class="ci-sub">${CI.esc(l.product)} · ${CI.esc(l.officerName || l.officerId)} · ${CI.esc(l.branch)} · ${CI.esc(l.district || l.address)}</div>
        <div class="crk-facts">
            <span>${CI.esc(t("creditreport.crk.colPar"))} <b>${CI.money(l.par)}</b></span>
            <span>${CI.esc(t("creditreport.crk.colOs"))} <b>${l.os === null ? "—" : CI.money(l.os)}</b></span>
            <span>${CI.esc(t("creditreport.crk.colDpd"))} <b>${CI.num(l.day)}</b></span>
            <span>${CI.esc(CI.clsName(l.cls))}</span>
        </div>
        ${l.prev ? `<div class="ci-sub">${CI.esc(t("creditreport.crk.then", { cls: CI.clsName(l.prev.cls), day: CI.num(l.prev.day), par: CI.money(l.prev.par) }))}</div>` : ""}
        ${ws ? `<div class="ci-ews-chips">${ws}</div>` : ""}
        <div class="crk-reason">${r && (r.cause || r.text) ? `
            <div><b>${CI.esc(t("creditreport.crk.cause"))}:</b> ${CI.esc(r.cause || r.text)}</div>
            ${r.solution ? `<div><b>${CI.esc(t("creditreport.crk.solution"))}:</b> ${CI.esc(r.solution)}</div>` : ""}
            <div class="ci-sub">${CI.esc(t("creditreport.crk.reasonBy", { by: r.by || "—", at: CI.dmy(r.at) }))}${r.promiseDate ? ` · ${CI.esc(t("creditreport.ews.promiseOn", { date: CI.dmy(r.promiseDate) }))}` : ""}</div>`
            : `<span class="ci-sub">${CI.esc(t("creditreport.crk.noReason"))}</span>`}</div>
        ${hist.length > 1 ? `<div class="pi-table-wrap"><table class="pi-table crk-hist"><thead><tr>
            <th>${CI.esc(t("creditreport.crk.hDate"))}</th><th>${CI.esc(t("creditreport.crk.hClass"))}</th><th class="num">${CI.esc(t("creditreport.crk.colDpd"))}</th><th class="num">${CI.esc(t("creditreport.crk.colPar"))}</th></tr></thead><tbody>
            ${hist.slice().reverse().map(h => `<tr><td>${CI.esc(CI.dmy(h.date))}${h.live ? " •" : ""}</td><td>${CI.esc(CI.clsName(h.cls))}</td><td class="num">${CI.num(h.day)}</td><td class="num">${CI.money(h.par)}</td></tr>`).join("")}
            </tbody></table></div>` : ""}
        <a class="ci-link" href="../masterdata/work.html?${new URLSearchParams({ q: l.ld })}">${CI.esc(t("creditreport.ews.openInWork"))} ›</a>
    </div>`;
}

function crkExport() {
    if (typeof XLSX === "undefined") { CI.toast(t("creditreport.npl.exportNotReady"), "error"); return; }
    const rows = crkVisible();
    const loan = crkUnit === "loan";
    const head = [t("creditreport.crk.colRank"), loan ? t("creditreport.npl.colLoan") : "CIF", t("creditreport.npl.colCustomer"),
        loan ? t("creditreport.pi.product") : t("creditreport.crk.colLoans"), t("creditreport.crk.colPar"), t("creditreport.crk.colShare"),
        t("creditreport.crk.colOs"), t("creditreport.crk.colDpd"), t("creditreport.crk.hClass"), t("creditreport.ews.score"),
        t("creditreport.crk.colStatus"), t("creditreport.crk.colChange"), t("creditreport.pi.officer"), t("creditreport.pi.branch")];
    const aoa = [head].concat(rows.map((r, i) => [
        i + 1, loan ? r.ld : r.cif, r.name, loan ? r.product : r.loans, r.par, loan ? "" : r.share, r.os, r.day, r.cls, r.score,
        r.status ? t(`creditreport.crk.st.${r.status}`) : "", r.change ?? "",
        loan ? (r.officerName || r.officerId) : (r.officers || []).map(o => o.name).join(", "),
        loan ? r.branch : (r.branches || []).join(", ")
    ]));
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "CustomerRisk");
    XLSX.writeFile(wb, `CustomerRisk_${crkData.overdueAsOf || ""}.xlsx`);
}

document.addEventListener("DOMContentLoaded", () => {
    // Rankings are of today's loans; the comparison picks the saved day.
    CI.mountFilters({ dates: false, onChange: crkLoad });
    document.getElementById("crkUnitTabs").addEventListener("click", e => {
        const b = e.target.closest("[data-unit]");
        if (!b || b.dataset.unit === crkUnit) return;
        crkUnit = b.dataset.unit;
        crkLoad();
    });
    ["crkSort", "crkTop"].forEach(id => document.getElementById(id).addEventListener("change", crkLoad));
    const pickStatus = e => {
        const b = e.target.closest("[data-status]");
        if (!b) return;
        crkStatus = b.dataset.status === crkStatus ? "" : b.dataset.status;
        crkLoad();
    };
    document.getElementById("crkStatus").addEventListener("click", pickStatus);
    document.getElementById("crkMoves").addEventListener("click", pickStatus);
    let typing = null;
    document.getElementById("crkSearch").addEventListener("input", () => {
        clearTimeout(typing);
        typing = setTimeout(crkLoad, 400);
    });
    document.getElementById("crkList").addEventListener("click", e => {
        const b = e.target.closest(".crk-card");
        if (!b) return;
        crkOpen(b.dataset.cif ? { cif: b.dataset.cif } : { ld: b.dataset.ld });
    });
    const dlg = document.getElementById("crkDialog");
    document.getElementById("crkDlgClose").addEventListener("click", () => (dlg.close ? dlg.close() : dlg.removeAttribute("open")));
    dlg.addEventListener("click", e => { if (e.target === dlg && dlg.close) dlg.close(); });
    document.getElementById("crkExport").addEventListener("click", crkExport);
    crkLoad();
});
