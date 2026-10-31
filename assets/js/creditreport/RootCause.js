// ========================================
// Credit Portfolio Intelligence — Root Cause Analysis (Phase 2)
// GET /api/credit-intelligence/causes: today's PAR by the cause an
// officer CONFIRMED, by branch / officer / product, the month-end trend
// and the accounts still to classify. Each account shows the officer's
// Reason Arrear text as written; a keyword match only SUGGESTS a cause.
// PUT /causes/:ld saves a confirmation (the server checks scope and
// keeps every change in the loan's history).
// ========================================

const t = CI.t;
const RC_PAGE = 50;
const RC_COLORS = {
    payroll: "#2563EB", income: "#D97706", business: "#7C3AED", employment: "#DC2626",
    multiBorrowing: "#DB2777", temporary: "#0D9488", nonCooperation: "#4B5563", other: "#A16207", unclassified: "#CBD5E1"
};

let rcData = null;
let rcDim = "branch";
let rcCause = "unclassified";
let rcLimit = RC_PAGE;

const rcCat = c => t(`creditreport.rc.c.${c}`);

async function rcLoad() {
    const data = await CI.get("causes", {
        dim: rcDim, cause: rcCause, limit: rcLimit,
        q: document.getElementById("rcSearch").value.trim()
    });
    if (!data) return;
    rcData = data;
    rcRender();
}

function rcRender() {
    const d = rcData;
    if (d.empty) {
        document.getElementById("rcList").innerHTML = `<p class="pi-note">${CI.esc(t("creditreport.pi.noAccess"))}</p>`;
        return;
    }
    CI.fillOptions(d.options, d.scope, d.period);
    CI.renderAsOf(document.getElementById("ciAsOf"), d);
    rcRenderSummary(d);
    rcRenderBars(d);
    rcRenderDims(d);
    rcRenderTrend(d);
    rcRenderList(d);
}

function rcTop(d) {
    return d.categories.map(c => [c, d.byCause[c]]).filter(([, v]) => v.par > 0).sort((a, b) => b[1].par - a[1].par)[0] || null;
}

function rcRenderSummary(d) {
    const box = document.getElementById("rcSummary");
    const top = rcTop(d);
    box.hidden = false;
    box.innerHTML = `
        <div class="ci-sum-head"><span aria-hidden="true">◎</span> ${CI.esc(t("creditreport.rc.sum.head", { pct: CI.pct(d.classified.pct, 0), par: CI.money(d.classified.par), total: CI.money(d.total) }))}</div>
        <div class="ci-sum-sub">${CI.esc(top ? t("creditreport.rc.sum.top", { cause: rcCat(top[0]), par: CI.money(top[1].par) }) : t("creditreport.rc.sum.none"))}</div>
        <div class="ci-sum-parts">
            <span class="ci-sum-part is-bad">${CI.esc(t("creditreport.rc.unclassified"))} <b>${CI.num(d.byCause.unclassified.loans)}</b></span>
            <span class="ci-sum-part">${CI.esc(t("creditreport.rc.classifiedN"))} <b>${CI.num(d.classified.loans)}</b></span>
        </div>`;
}

function rcBar(label, v, total, color, cause) {
    const share = total ? v.par / total : 0;
    return `<button type="button" class="pi-bar-row rc-bar-btn" data-cause="${cause}">
        <div class="pi-bar-head"><span class="pi-bar-name"><i class="rc-dot" style="background:${color}"></i>${CI.esc(label)}</span><span class="pi-bar-val">${CI.money(v.par)} · ${CI.pct(share, 1)}</span></div>
        <div class="pi-bar-track"><span class="pi-bar-fill" style="width:${Math.round(share * 100)}%;background:${color}"></span></div>
        <div class="pi-bar-meta">${CI.esc(t("creditreport.npl.accountsN", { n: CI.num(v.loans) }))}</div>
    </button>`;
}

function rcRenderBars(d) {
    const rows = d.categories.filter(c => d.byCause[c].loans).sort((a, b) => d.byCause[b].par - d.byCause[a].par);
    document.getElementById("rcBars").innerHTML = rows.map(c => rcBar(rcCat(c), d.byCause[c], d.total, RC_COLORS[c], c)).join("")
        + rcBar(t("creditreport.rc.unclassified"), d.byCause.unclassified, d.total, RC_COLORS.unclassified, "unclassified");
    const sug = d.categories.filter(c => d.suggested[c].loans);
    document.getElementById("rcSuggested").textContent = sug.length
        ? t("creditreport.rc.suggestedNote", { list: sug.map(c => `${rcCat(c)} ${CI.num(d.suggested[c].loans)} (${CI.money(d.suggested[c].par)})`).join(", ") })
        : "";
}

// A stacked bar of a total's PAR by cause.
function rcStack(byCause, total, cats) {
    return `<div class="rc-stack" role="img">${cats.concat(["unclassified"]).filter(c => byCause[c].par > 0).map(c =>
        `<span style="width:${(byCause[c].par / total * 100).toFixed(2)}%;background:${RC_COLORS[c]}" title="${CI.esc(`${c === "unclassified" ? t("creditreport.rc.unclassified") : rcCat(c)}: ${CI.money(byCause[c].par)}`)}"></span>`).join("")}</div>`;
}

function rcRenderDims(d) {
    document.querySelectorAll("#rcDimTabs [data-dim]").forEach(b => {
        const on = b.dataset.dim === rcDim;
        b.classList.toggle("is-active", on);
        b.setAttribute("aria-selected", on ? "true" : "false");
    });
    document.getElementById("rcLegend").innerHTML = d.categories.concat(["unclassified"]).map(c =>
        `<span><i class="rc-dot" style="background:${RC_COLORS[c]}"></i>${CI.esc(c === "unclassified" ? t("creditreport.rc.unclassified") : rcCat(c))}</span>`).join("");
    document.getElementById("rcDims").innerHTML = d.breakdown.slice(0, 40).map(g => `
        <div class="rc-dim">
            <div class="pi-bar-head"><span class="pi-bar-name">${CI.esc(g.label)}</span><span class="pi-bar-val">${CI.money(g.par)}</span></div>
            ${rcStack(g.byCause, g.par || 1, d.categories)}
            <div class="pi-bar-meta">${CI.esc(t("creditreport.rc.classifiedPct", { pct: CI.pct(g.classifiedPct, 0), n: CI.num(g.loans) }))}</div>
        </div>`).join("") || `<p class="pi-note">${CI.esc(t("creditreport.pi.nothing"))}</p>`;
}

function rcRenderTrend(d) {
    const note = document.getElementById("rcTrendNote");
    const box = document.getElementById("rcTrend");
    if (!d.trend.available) {
        note.textContent = t(d.trend.reason === "trend_scope" ? "creditreport.rc.trendScope" : "creditreport.crk.noHistory");
        box.innerHTML = "";
        return;
    }
    note.textContent = t("creditreport.rc.trendNote");
    box.innerHTML = d.trend.points.map(p => `
        <div class="rc-dim">
            <div class="pi-bar-head"><span class="pi-bar-name">${CI.esc(CI.dmy(p.date))}</span><span class="pi-bar-val">${CI.money(p.total)}</span></div>
            ${rcStack(p.byCause, p.total || 1, d.categories)}
        </div>`).join("");
}

function rcAccount(a, cats) {
    const opts = `<option value="">${CI.esc(t("creditreport.rc.choose"))}</option>` + cats.map(c =>
        `<option value="${c}"${a.category === c ? " selected" : ""}>${CI.esc(rcCat(c))}</option>`).join("");
    return `<div class="ci-card rc-acc${a.category ? " is-done" : ""}" data-ld="${CI.esc(a.ld)}">
        <div class="ci-card-top"><span class="ci-card-id">${CI.esc(a.ld)}</span>
            ${a.category ? `<span class="rc-tag" style="background:${RC_COLORS[a.category]}">${CI.esc(rcCat(a.category))}</span>` : `<span class="rc-tag is-none">${CI.esc(t("creditreport.rc.unclassified"))}</span>`}</div>
        <div class="ci-card-name">${CI.esc(a.name || "—")} <span class="ci-sub">${CI.esc(a.cif)}</span></div>
        <div class="crk-facts"><span>PAR <b>${CI.money(a.par)}</b></span><span>${CI.esc(t("creditreport.crk.colDpd"))} <b>${CI.num(a.day)}</b></span><span>${CI.esc(CI.clsName(a.cls))}</span></div>
        <div class="ci-sub">${CI.esc(a.officerName || a.officerId)} · ${CI.esc(a.branch)} · ${CI.esc(a.product)}</div>
        <div class="crk-reason">${a.reason
            ? `<div><b>${CI.esc(t("creditreport.rc.officerText"))}:</b> ${CI.esc(a.reason)}</div>${a.reasonNote ? `<div class="ci-sub">${CI.esc(a.reasonNote)}</div>` : ""}`
            : `<span class="ci-sub">${CI.esc(t("creditreport.crk.noReason"))}</span>`}</div>
        ${a.suggestion && !a.category ? `<div class="rc-suggest">${CI.esc(t("creditreport.rc.suggestion", { cause: rcCat(a.suggestion.category), keyword: a.suggestion.keyword }))}</div>` : ""}
        ${a.category ? `<div class="ci-sub">${CI.esc(t("creditreport.rc.confirmedBy", { by: a.classifiedBy || "—", at: CI.dmy(a.classifiedAt) }))}${a.classNote ? ` · ${CI.esc(a.classNote)}` : ""}</div>` : ""}
        <div class="rc-form">
            <select class="pi-top-pick rc-pick" aria-label="${CI.esc(t("creditreport.rc.choose"))}">${opts}</select>
            <input type="text" class="ci-search rc-note" maxlength="500" placeholder="${CI.esc(t("creditreport.rc.notePh"))}" value="${CI.esc(a.classNote || "")}">
            <button type="button" class="pi-btn-ghost rc-save">${CI.esc(t(a.category ? "creditreport.rc.change" : "creditreport.rc.confirm"))}</button>
            ${a.suggestion && !a.category ? `<button type="button" class="pi-btn-ghost rc-use" data-cat="${a.suggestion.category}">${CI.esc(t("creditreport.rc.useSuggestion"))}</button>` : ""}
            ${a.category ? `<button type="button" class="pi-btn-ghost rc-hist">${CI.esc(t("creditreport.rc.history"))}</button>` : ""}
        </div>
        <div class="rc-histbox" hidden></div>
    </div>`;
}

function rcRenderList(d) {
    document.getElementById("rcCauseChips").innerHTML =
        [["unclassified", t("creditreport.rc.unclassified"), d.byCause.unclassified.loans], ["", t("creditreport.ews.all"), d.loans]]
            .concat(d.categories.filter(c => d.byCause[c].loans).map(c => [c, rcCat(c), d.byCause[c].loans]))
            .map(([c, label, n]) => `<button type="button" class="pi-chip${(rcCause || "") === c ? " is-active" : ""}" data-cause="${c}">${CI.esc(label)} (${CI.num(n)})</button>`).join("");
    document.getElementById("rcCount").textContent = t("creditreport.rc.countN", { shown: CI.num(d.accounts.length), n: CI.num(d.listedCount) });
    document.getElementById("rcList").innerHTML = d.accounts.length ? d.accounts.map(a => rcAccount(a, d.categories)).join("") : `<p class="pi-note">${CI.esc(t("creditreport.pi.nothing"))}</p>`;
    document.getElementById("rcMore").hidden = d.accounts.length >= d.listedCount;
}

async function rcSave(card, category) {
    const ld = card.dataset.ld;
    const note = card.querySelector(".rc-note").value.trim();
    if (!category) { CI.toast(t("creditreport.rc.choose"), "error"); return; }
    try {
        const res = await fetch(`${API.BASE_URL}/api/credit-intelligence/causes/${encodeURIComponent(ld)}`, {
            method: "PUT",
            headers: { Authorization: `Bearer ${localStorage.getItem("token") || sessionStorage.getItem("token")}`, "Content-Type": "application/json" },
            body: JSON.stringify({ category, note })
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.message || "");
        CI.toast(t("creditreport.rc.saved"), "success");
        rcLoad();
    } catch (e) {
        console.error(e);
        CI.toast(t("creditreport.rc.saveFailed"), "error");
    }
}

async function rcHistory(card) {
    const box = card.querySelector(".rc-histbox");
    if (!box.hidden) { box.hidden = true; return; }
    try {
        const res = await fetch(`${API.BASE_URL}/api/credit-intelligence/causes/${encodeURIComponent(card.dataset.ld)}/history`, {
            headers: { Authorization: `Bearer ${localStorage.getItem("token") || sessionStorage.getItem("token")}` }
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.message || "");
        box.innerHTML = data.history.slice().reverse().map(h => `<div class="ci-sub">${CI.esc(CI.dmy(String(h.at || "").slice(0, 10)))} · ${CI.esc(h.by)}: ${h.prev ? `${CI.esc(rcCat(h.prev))} → ` : ""}<b>${CI.esc(rcCat(h.category))}</b>${h.note ? ` — ${CI.esc(h.note)}` : ""}</div>`).join("");
        box.hidden = false;
    } catch (e) {
        console.error(e);
        CI.toast(t("creditreport.pi.loadFailed"), "error");
    }
}

function rcExport() {
    if (typeof XLSX === "undefined") { CI.toast(t("creditreport.npl.exportNotReady"), "error"); return; }
    const d = rcData;
    const aoa = [[t("creditreport.npl.colLoan"), "CIF", t("creditreport.npl.colCustomer"), "PAR", t("creditreport.crk.colDpd"), t("creditreport.crk.hClass"),
        t("creditreport.pi.officer"), t("creditreport.pi.branch"), t("creditreport.pi.product"), t("creditreport.rc.officerText"),
        t("creditreport.rc.causeCol"), t("creditreport.rc.suggestedCol"), t("creditreport.rc.byCol"), t("creditreport.rc.atCol")]]
        .concat(d.accounts.map(a => [a.ld, a.cif, a.name, a.par, a.day, a.cls, a.officerName || a.officerId, a.branch, a.product, a.reason,
            a.category ? rcCat(a.category) : t("creditreport.rc.unclassified"), a.suggestion ? rcCat(a.suggestion.category) : "", a.classifiedBy, a.classifiedAt || ""]));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "RootCause");
    XLSX.writeFile(wb, `RootCause_${d.overdueAsOf || ""}.xlsx`);
}

// ---------- admin: suggestion keywords ----------
function rcIsAdmin() {
    try {
        const u = JSON.parse(localStorage.getItem("loggedInUser") || sessionStorage.getItem("loggedInUser") || "{}");
        return String(u.role || "").toLowerCase() === "admin";
    } catch (e) {
        return false;
    }
}

async function rcAdminLoad() {
    const res = await fetch(`${API.BASE_URL}/api/admin/credit-intelligence/cause-keywords`, { headers: { Authorization: `Bearer ${localStorage.getItem("token") || sessionStorage.getItem("token")}` } });
    const data = await res.json();
    if (!data.ok) return;
    document.getElementById("rcKeywords").innerHTML = Object.keys(data.keywords).filter(c => c !== "other").map(c =>
        `<label class="pi-field"><span>${CI.esc(rcCat(c))}</span><textarea class="ci-textarea" rows="4" data-cat="${c}">${CI.esc(data.keywords[c].join("\n"))}</textarea></label>`).join("");
}

async function rcAdminSave() {
    const keywords = {};
    document.querySelectorAll("#rcKeywords [data-cat]").forEach(el => { keywords[el.dataset.cat] = el.value.split("\n").map(s => s.trim()).filter(Boolean); });
    try {
        const res = await fetch(`${API.BASE_URL}/api/admin/credit-intelligence/cause-keywords`, {
            method: "PUT",
            headers: { Authorization: `Bearer ${localStorage.getItem("token") || sessionStorage.getItem("token")}`, "Content-Type": "application/json" },
            body: JSON.stringify({ keywords })
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.message || "");
        CI.toast(t("creditreport.growth.saved"), "success");
        rcLoad();
    } catch (e) {
        console.error(e);
        CI.toast(t("creditreport.pi.loadFailed"), "error");
    }
}

document.addEventListener("DOMContentLoaded", () => {
    CI.mountFilters({ dates: false, compare: false, onChange: () => { rcLimit = RC_PAGE; rcLoad(); } });
    document.getElementById("rcDimTabs").addEventListener("click", e => {
        const b = e.target.closest("[data-dim]");
        if (!b || b.dataset.dim === rcDim) return;
        rcDim = b.dataset.dim;
        rcLoad();
    });
    const pickCause = e => {
        const b = e.target.closest("[data-cause]");
        if (!b) return;
        rcCause = b.dataset.cause;
        rcLimit = RC_PAGE;
        rcLoad();
        document.getElementById("rcAccTitle").scrollIntoView({ behavior: "smooth", block: "start" });
    };
    document.getElementById("rcCauseChips").addEventListener("click", pickCause);
    document.getElementById("rcBars").addEventListener("click", pickCause);
    let typing = null;
    document.getElementById("rcSearch").addEventListener("input", () => {
        clearTimeout(typing);
        typing = setTimeout(() => { rcLimit = RC_PAGE; rcLoad(); }, 400);
    });
    document.getElementById("rcMore").addEventListener("click", () => { rcLimit += RC_PAGE; rcLoad(); });
    document.getElementById("rcList").addEventListener("click", e => {
        const card = e.target.closest(".rc-acc");
        if (!card) return;
        if (e.target.closest(".rc-save")) rcSave(card, card.querySelector(".rc-pick").value);
        else if (e.target.closest(".rc-use")) {
            card.querySelector(".rc-pick").value = e.target.closest(".rc-use").dataset.cat;
            rcSave(card, card.querySelector(".rc-pick").value);
        } else if (e.target.closest(".rc-hist")) rcHistory(card);
    });
    document.getElementById("rcExport").addEventListener("click", rcExport);
    if (rcIsAdmin()) {
        const box = document.getElementById("rcAdmin");
        box.hidden = false;
        box.addEventListener("toggle", () => { if (box.open) rcAdminLoad(); });
        document.getElementById("rcKwSave").addEventListener("click", rcAdminSave);
    }
    rcLoad();
});
