// ========================================
// Credit Portfolio Intelligence — NPL Management, "NPL Movement" tab (Module 02)
// GET /api/credit-intelligence/npl: opening vs closing NPL loans from the
// account-level NPL history, the waterfall and its reconciliation, every
// account that moved, and the reasons officers documented. When the saved
// history doesn't cover the period the server says so and this page
// shows that instead of a figure.
// ========================================

const t = CI.t;
const NPL_PAGE = 50;

let nplData = null;
let nplTab = "new";
let nplSort = { key: "change", dir: -1 };
let nplShown = NPL_PAGE;
let nplChart = null;
// NPL Management tabs: "movement" (this file) and "recovery" (NplRecovery.js).
// Each tab fetches only when shown, and again after the filters change.
let nplView = new URLSearchParams(location.search).get("view") === "recovery" ? "recovery" : "movement";
const nplStale = { movement: true, recovery: true };

function nplShowView(view) {
    nplView = view === "recovery" ? "recovery" : "movement";
    document.querySelectorAll("#nplViews [data-view]").forEach(b => {
        const on = b.dataset.view === nplView;
        b.classList.toggle("is-active", on);
        b.setAttribute("aria-selected", on ? "true" : "false");
    });
    document.getElementById("nplViewMovement").hidden = nplView !== "movement";
    document.getElementById("nplViewRecovery").hidden = nplView !== "recovery";
    CI.setPeriodLabel(nplView === "recovery" ? "creditreport.ci.periodRecovery" : "creditreport.ci.periodNpl");
    const p = new URLSearchParams(location.search);
    if (nplView === "recovery") p.set("view", "recovery"); else p.delete("view");
    history.replaceState(null, "", `${location.pathname}?${p.toString()}`);
    if (!nplStale[nplView]) {
        if (nplView === "recovery") recRenderSummary(); else nplRenderSummary();
        return;
    }
    nplStale[nplView] = false;
    if (nplView === "recovery") recLoad(); else nplLoad();
}

// ---------- summary: the one-line answer above both tabs ----------
// parts: [label, value, kind] — kind "add" (+, bad), "sub" (−, good),
// "neutral" (−, not recovery), "signed" (±).
function nplSummaryHtml({ fromKey, toKey, opening, closing, parts, extra }) {
    const net = closing - opening;
    const pct = opening ? net / opening : null;
    const dir = net < 0 ? "down" : net > 0 ? "up" : "flat";
    const head = t(`creditreport.npl.sum.${dir}`, { amt: CI.money(Math.abs(net)), pct: pct === null ? "—" : `${(Math.abs(pct) * 100).toFixed(1)}%` });
    const sign = (v, kind) => kind === "add" ? `+${CI.money(v)}` : kind === "signed" ? `${v > 0 ? "+" : ""}${CI.money(v)}` : CI.money(-Math.abs(v));
    const tone = (v, kind) => kind === "add" ? "bad" : kind === "sub" ? "good" : kind === "signed" ? (v > 0 ? "bad" : v < 0 ? "good" : "") : "base";
    return `
        <div class="ci-sum-head is-${dir}"><span aria-hidden="true">${dir === "down" ? "▼" : dir === "up" ? "▲" : "■"}</span> ${CI.esc(head)}</div>
        <div class="ci-sum-sub">${CI.esc(t("creditreport.npl.sum.range", { from: CI.dmy(fromKey), to: CI.dmy(toKey), opening: CI.money(opening), closing: CI.money(closing) }))}</div>
        <div class="ci-sum-parts">${parts.filter(p => p).map(([label, v, kind]) =>
            `<span class="ci-sum-part is-${tone(v, kind)}">${CI.esc(label)} <b>${CI.esc(sign(v, kind))}</b></span>`).join("")}</div>
        ${extra ? `<div class="ci-sum-extra">${extra}</div>` : ""}`;
}

function nplShowSummary(html) {
    const box = document.getElementById("nplSummary");
    box.hidden = !html;
    box.innerHTML = html || "";
}

function nplRenderSummary() {
    const m = nplData && nplData.movement;
    if (!m || !m.available) { nplShowSummary(""); return; }
    const tt = m.totals;
    const ex = m.exits || { recovered: tt.recovered, writeOff: { bal: 0, count: 0 }, moved: { bal: 0, count: 0 } };
    nplShowSummary(nplSummaryHtml({
        fromKey: m.openingDate, toKey: m.closingDate, opening: tt.opening.bal, closing: tt.closing.bal,
        parts: [
            [nplStepLabel("new"), tt.new.bal, "add"],
            [nplStepLabel("recovered"), ex.recovered.bal, "sub"],
            ex.writeOff.count ? [nplStepLabel("writeOff"), ex.writeOff.bal, "neutral"] : null,
            ex.moved.count ? [nplStepLabel("moved"), ex.moved.bal, "neutral"] : null,
            [nplStepLabel("balanceChange"), tt.balanceChange, "signed"]
        ]
    }));
    if (window.CIExplain) CI.explain(document.getElementById("nplSummary"), CIExplain.npl(nplData, t));
}
function nplExitText(e) {
    return e ? t(`creditreport.npl.exit.${e}`) : "";
}

async function nplLoad() {
    const data = await CI.get("npl");
    if (!data) return;
    nplData = data;
    nplRender();
}

function nplRender() {
    const d = nplData;
    if (d.empty) {
        document.getElementById("nplUnavailable").hidden = false;
        document.getElementById("nplUnavailableText").textContent = t("creditreport.pi.noAccess");
        return;
    }
    CI.fillOptions(d.options, d.scope, d.period);
    CI.renderAsOf(document.getElementById("ciAsOf"), d);
    const m = d.movement;
    const off = document.getElementById("nplUnavailable");
    const content = document.getElementById("nplContent");
    if (!m.available) {
        nplShowSummary("");
        off.hidden = false;
        content.hidden = true;
        document.getElementById("nplUnavailableText").textContent =
            t(`creditreport.npl.reason.${m.reason}`, { first: CI.dmy(m.firstSaved) });
        // Only useful once a later day than the first saved one exists.
        document.getElementById("nplSinceFirst").hidden = !(m.firstSaved && d.asOf && m.firstSaved < d.asOf.osDate);
        return;
    }
    off.hidden = true;
    content.hidden = false;
    document.getElementById("nplRange").textContent = t("creditreport.npl.range", {
        opening: CI.dmy(m.openingDate),
        closing: CI.dmy(m.closingDate) + (m.closingLive ? ` (${t("creditreport.npl.live")})` : "")
    });
    nplRenderSummary();
    nplRenderWaterfall(m);
    nplRenderSteps(m);
    nplRenderTable();
    nplRenderWhy();
}

// ⓘ next to a term (shared: ci-filters.js).
const nplInfoBtn = CI.infoBtn;
const nplTip = CI.tip;

function nplStepLabel(step) {
    return t(`creditreport.npl.step.${step}`);
}

// What moved NPL: only the changes, as horizontal bars, so a $3,000
// write-off is visible next to a $5.9M balance (opening / closing are
// in the summary and the step cards).
function nplRenderWaterfall(m) {
    if (nplChart) { nplChart.destroy(); nplChart = null; }
    if (typeof Chart === "undefined") return;
    const col = CI.chartColors();
    const bars = m.waterfall.filter(w => w.step !== "opening" && w.step !== "closing")
        .filter(w => w.value || w.step !== "moved");
    const colorOf = b => {
        // Leaving NPL by write-off or class move is not recovery: neutral.
        if (b.step === "writeOff" || b.step === "moved") return col.b;
        return b.value > 0 ? col.bad : col.good;
    };
    const box = document.getElementById("nplWaterfall").parentElement;
    box.style.height = `${Math.max(150, bars.length * 44 + 40)}px`;
    nplChart = new Chart(document.getElementById("nplWaterfall"), {
        type: "bar",
        data: {
            labels: bars.map(b => nplStepLabel(b.step)),
            datasets: [{ data: bars.map(b => b.value), backgroundColor: bars.map(colorOf), borderRadius: 4, maxBarThickness: 28 }]
        },
        options: {
            indexAxis: "y",
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: c => `${nplStepLabel(bars[c.dataIndex].step)}: ${bars[c.dataIndex].value > 0 ? "+" : ""}${CI.money(bars[c.dataIndex].value)}` } }
            },
            scales: {
                x: { grid: { color: col.grid }, border: { display: false }, ticks: { color: col.text, callback: v => CI.money(v), maxTicksLimit: 5 } },
                y: { grid: { display: false }, ticks: { color: col.text, font: { family: "KRASAR, sans-serif", size: 12 } } }
            }
        }
    });
}

function nplRenderSteps(m) {
    const tt = m.totals;
    // Recovered excludes write-off and NPL class moves (own steps below).
    const NOT_RECOVERY = ["written_off", "class_changed"];
    const exits = Object.entries(tt.recovered.byExit || {}).filter(([k]) => !NOT_RECOVERY.includes(k))
        .map(([k, v]) => `${nplExitText(k)} ${v.count} · ${CI.money(v.bal)}`).join(" · ");
    const ex = m.exits || { recovered: tt.recovered, writeOff: { count: 0, bal: 0 }, moved: { count: 0, bal: 0 } };
    const card = (step, value, count, sub, tone) => `
        <div class="ci-step ci-step-${tone || "base"}">
            <div class="pi-kpi-label">${CI.esc(nplStepLabel(step))}${nplInfoBtn(`creditreport.npl.tip.${step}`)}</div>
            <div class="ci-step-value">${CI.esc(["recovered", "writeOff", "moved"].includes(step) ? CI.money(-Math.abs(value)) : (step === "new" ? "+" : "") + CI.money(value))}</div>
            <div class="pi-kpi-sub">${CI.esc(t("creditreport.npl.accountsN", { n: CI.num(count) }))}${sub ? ` · ${CI.esc(sub)}` : ""}</div>
            ${nplTip(`creditreport.npl.tip.${step}`)}
        </div>`;
    const bc = tt.balanceChange;
    document.getElementById("nplSteps").innerHTML =
        card("opening", tt.opening.bal, tt.opening.count, "", "base") +
        card("new", tt.new.bal, tt.new.count, "", "bad") +
        card("recovered", ex.recovered.bal, ex.recovered.count, exits, "good") +
        card("writeOff", ex.writeOff.bal, ex.writeOff.count, "", "base") +
        (ex.moved.count ? card("moved", ex.moved.bal, ex.moved.count, "", "base") : "") +
        card("balanceChange", bc, tt.continuing.count, t("creditreport.npl.continuingN", { n: CI.num(tt.continuing.count) }), bc > 0 ? "bad" : bc < 0 ? "good" : "base") +
        card("closing", tt.closing.bal, tt.closing.count, "", "base");
    const r = tt.reconciliation;
    document.getElementById("nplRecon").innerHTML = r.ok
        ? `<span class="pi-badge pi-badge-good"><span aria-hidden="true">✓</span> ${CI.esc(t("creditreport.npl.reconOk"))}</span> ${CI.esc(t("creditreport.npl.reconFormula", { opening: CI.money(tt.opening.bal), add: CI.money(tt.new.bal), sub: CI.money(ex.recovered.bal), wo: CI.money(ex.writeOff.bal + ex.moved.bal), chg: CI.money(bc), closing: CI.money(tt.closing.bal) }))}`
        : `<span class="pi-badge pi-badge-bad"><span aria-hidden="true">⚠</span> ${CI.esc(t("creditreport.npl.reconBad", { diff: CI.money(r.diff) }))}</span>`;
}

// ---------- accounts ----------
const NPL_COLS = [
    { key: "ld", label: "creditreport.npl.colLoan" },
    { key: "name", label: "creditreport.npl.colCustomer" },
    { key: "branch", label: "creditreport.pi.branch" },
    { key: "areaOfficer", label: "creditreport.list.colAreaOfficer" },
    { key: "ownOfficer", label: "creditreport.list.colOwnOfficer" },
    { key: "product", label: "creditreport.pi.product" },
    { key: "location", label: "creditreport.npl.colLocation" },
    { key: "prevCls", label: "creditreport.npl.colPrev" },
    { key: "curCls", label: "creditreport.npl.colCur" },
    { key: "openBal", label: "creditreport.npl.colOpening", money: true },
    { key: "closeBal", label: "creditreport.npl.colClosing", money: true },
    { key: "change", label: "creditreport.npl.colChange", money: true },
    { key: "day", label: "creditreport.list.colDays", num: true },
    { key: "category", label: "creditreport.npl.colCategory" },
    { key: "reason", label: "creditreport.npl.colReason" }
];

function nplRowsOfTab() {
    const all = nplData.accounts || [];
    if (nplTab === "balance") return all.filter(a => a.category === "continuing" && a.change !== 0);
    if (nplTab === "writeoff") return all.filter(a => a.category === "recovered" && a.exit === "written_off");
    if (nplTab === "moved") return all.filter(a => a.category === "recovered" && a.exit === "class_changed");
    if (nplTab === "recovered") return all.filter(a => a.category === "recovered" && a.exit !== "written_off" && a.exit !== "class_changed");
    return all.filter(a => a.category === nplTab);
}

function nplVisibleRows() {
    const q = document.getElementById("nplSearch").value.trim().toLowerCase();
    let rows = nplRowsOfTab();
    if (q) {
        rows = rows.filter(a => [a.ld, a.cif, a.name, a.branch, a.areaOfficer, a.ownOfficer, a.officerId, a.product, a.location, a.district, a.reason]
            .some(v => String(v || "").toLowerCase().includes(q)));
    }
    const { key, dir } = nplSort;
    const col = NPL_COLS.find(c => c.key === key);
    return rows.slice().sort((a, b) => {
        if (col && (col.money || col.num)) return dir * ((Number(a[key]) || 0) - (Number(b[key]) || 0));
        return dir * String(a[key] || "").localeCompare(String(b[key] || ""));
    });
}

function nplCategoryText(a) {
    if (a.exit === "written_off") return t("creditreport.npl.step.writeOff");
    if (a.exit === "class_changed") return t("creditreport.npl.step.moved");
    const base = t(`creditreport.npl.cat.${a.category}`);
    return a.exit ? `${base} · ${nplExitText(a.exit)}` : base;
}

function nplRenderTable() {
    // "Moved NPL class" exists only with an NPL class filter.
    const hasMoved = !!(nplData.movement && nplData.movement.exits && nplData.movement.exits.moved.count);
    document.querySelector('#nplTabs [data-tab="moved"]').hidden = !hasMoved;
    if (nplTab === "moved" && !hasMoved) nplTab = "new";
    document.querySelectorAll("#nplTabs [data-tab]").forEach(b => {
        const on = b.dataset.tab === nplTab;
        b.classList.toggle("is-active", on);
        b.setAttribute("aria-selected", on ? "true" : "false");
    });
    const rows = nplVisibleRows();
    document.getElementById("nplCount").textContent = t("creditreport.npl.accountsN", { n: CI.num(rows.length) });
    document.getElementById("nplMore").hidden = rows.length <= nplShown;
    const head = `<thead><tr>${NPL_COLS.map(c => {
        const on = nplSort.key === c.key;
        return `<th${c.money || c.num ? ' class="num"' : ""} aria-sort="${on ? (nplSort.dir > 0 ? "ascending" : "descending") : "none"}"><button type="button" class="ci-sort" data-key="${c.key}">${CI.esc(t(c.label))}${on ? (nplSort.dir > 0 ? " ▲" : " ▼") : ""}</button></th>`;
    }).join("")}</tr></thead>`;
    const body = rows.slice(0, nplShown).map(a => `<tr>${NPL_COLS.map(c => {
        if (c.num) return `<td class="num">${a[c.key] ? CI.num(a[c.key]) : "—"}</td>`;
        if (c.money) {
            const v = Number(a[c.key]) || 0;
            const tone = c.key === "change" && v ? (v > 0 ? " ci-bad" : " ci-good") : "";
            return `<td class="num${tone}">${CI.esc(CI.money(v))}</td>`;
        }
        if (c.key === "category") return `<td>${CI.esc(nplCategoryText(a))}</td>`;
        if (c.key === "location") return `<td>${CI.esc(a.district || a.location || "")}</td>`;
        if (c.key === "reason") return `<td class="ci-reason">${CI.esc(a.reason || "—")}</td>`;
        if (c.key === "name") return `<td>${CI.esc(a.name)}<div class="ci-sub">${CI.esc(a.cif)}</div></td>`;
        return `<td>${CI.esc(a[c.key] || "")}</td>`;
    }).join("")}</tr>`).join("");
    document.getElementById("nplTable").innerHTML = head + `<tbody>${body || `<tr><td colspan="${NPL_COLS.length}" class="pi-note">${CI.esc(t("creditreport.pi.nothing"))}</td></tr>`}</tbody>`;
}

// The officer named on a card follows the filter's Area / Own choice.
function nplOfficerOf(a) {
    return (CI.query().get("side") === "area" ? a.areaOfficer || a.ownOfficer : a.ownOfficer || a.areaOfficer) || "";
}

// What the officer recorded in Reason Arrear, shown as written.
function nplReasonHtml(a, withCause = true) {
    const rows = [];
    const line = (label, value) => value ? `<div class="ci-why-line"><span>${CI.esc(t(label))}</span><b>${CI.esc(value)}</b></div>` : "";
    if (withCause) rows.push(line("creditreport.npl.why.cause", a.cause || a.reason));
    rows.push(line("creditreport.npl.why.solution", a.solution));
    rows.push(line("creditreport.npl.why.occupation", a.reasonNote));
    if (a.promiseDate) {
        const late = a.promiseDate < new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
        rows.push(`<div class="ci-why-line"><span>${CI.esc(t("creditreport.npl.why.promise"))}</span><b class="${late ? "ci-bad" : ""}">${CI.esc(CI.dmy(a.promiseDate))}${late ? ` · ${CI.esc(t("creditreport.npl.why.promisePast"))}` : ""}</b></div>`);
    }
    const by = [a.reasonBy, a.reasonAt ? CI.dmy(a.reasonAt) : ""].filter(Boolean).join(" · ");
    rows.push(line("creditreport.npl.why.recorded", by));
    const html = rows.join("");
    return html ? `<div class="ci-why-box">${html}</div>` : "";
}

function nplCardHtml(a, withCause = true) {
    const tone = a.category === "new" ? "is-bad" : a.category === "recovered" ? "is-good" : a.change > 0 ? "is-bad" : a.change < 0 ? "is-good" : "";
    const chg = Number(a.change) || 0;
    return `<li class="ci-card ${tone}">
        <div class="ci-card-top"><span class="ci-card-id">${CI.esc(a.ld)}</span><span class="ci-pill ci-pill-low">${CI.esc(nplCategoryText(a))}</span></div>
        <div><span class="ci-card-name">${CI.esc(a.name)}</span> <span class="ci-sub">${CI.esc(a.cif)}</span></div>
        <div class="ci-sub">${CI.esc([a.branch, nplOfficerOf(a), a.product, a.district || a.location].filter(Boolean).join(" · "))}</div>
        <div class="ci-card-row"><span class="ci-cls">${CI.esc(a.prevCls || "—")} → <b>${CI.esc(a.curCls || "—")}</b>${a.day ? ` · ${CI.esc(t("creditreport.list.daysN", { n: CI.num(a.day) }))}` : ""}</span>
            <span class="ci-card-amt${chg > 0 ? " ci-bad" : chg < 0 ? " ci-good" : ""}">${chg > 0 ? "+" : ""}${CI.esc(CI.money(chg))}</span></div>
        <div class="ci-sub">${CI.esc(CI.money(a.openBal))} → ${CI.esc(CI.money(a.closeBal))}</div>
        ${nplReasonHtml(a, withCause)}
    </li>`;
}

// Root cause: NPL accounts (not recovered) grouped by the reason (មូលហេតុ)
// part officers wrote; the words are not interpreted. Each group opens to
// its accounts with everything recorded for them. Accounts with nothing
// recorded are their own group, so the gap is visible.
let nplWhyOpen = new Set();
const nplWhyShown = new Map();
const NPL_WHY_PAGE = 6;
const NPL_WHY_NONE = "\u0000none";

function nplRenderWhy() {
    const all = (nplData.accounts || []).filter(a => a.category !== "recovered");
    const q = (document.getElementById("nplWhySearch").value || "").trim().toLowerCase();
    const rows = all.filter(a => !q || [a.cause, a.reason, a.solution, a.reasonNote, a.ld, a.cif, a.name, a.branch, a.ownOfficer, a.areaOfficer]
        .some(v => String(v || "").toLowerCase().includes(q)));
    const documented = all.filter(a => a.cause || a.reason);
    const totalBal = all.reduce((s, a) => s + (Number(a.closeBal) || 0), 0);
    const docBal = documented.reduce((s, a) => s + (Number(a.closeBal) || 0), 0);
    document.getElementById("nplWhyNote").textContent = t("creditreport.npl.whyNote", {
        documented: CI.num(documented.length), total: CI.num(all.length)
    });
    const pct = totalBal ? Math.round(docBal / totalBal * 100) : 0;
    document.getElementById("nplWhyCover").innerHTML = all.length ? `
        <div class="ci-why-cover-bar" role="img" aria-label="${CI.esc(pct)}%"><span style="width:${pct}%"></span></div>
        <div class="ci-why-cover-text">${CI.esc(t("creditreport.npl.why.cover", { pct: CI.num(pct), bal: CI.money(docBal), total: CI.money(totalBal) }))}</div>` : "";

    const groups = new Map();
    for (const a of rows) {
        const k = (a.cause || a.reason || "").trim() || NPL_WHY_NONE;
        const g = groups.get(k) || { accounts: [], value: 0, fresh: 0, cont: 0, promise: 0, branches: new Map() };
        g.accounts.push(a);
        g.value += Number(a.closeBal) || 0;
        if (a.category === "new") g.fresh++; else g.cont++;
        if (a.promiseDate) g.promise++;
        if (a.branch) g.branches.set(a.branch, (g.branches.get(a.branch) || 0) + 1);
        groups.set(k, g);
    }
    const list = [...groups.entries()].sort((x, y) => (x[0] === NPL_WHY_NONE) - (y[0] === NPL_WHY_NONE) || y[1].value - x[1].value);
    document.getElementById("nplWhy").innerHTML = list.length ? list.map(([text, g]) => {
        const none = text === NPL_WHY_NONE;
        const share = totalBal ? Math.round(g.value / totalBal * 100) : 0;
        const brs = [...g.branches.entries()].sort((x, y) => y[1] - x[1]).slice(0, 3).map(([b, n]) => `${b} ${n}`).join(" · ");
        const chips = [
            g.fresh ? t("creditreport.npl.why.newN", { n: CI.num(g.fresh) }) : "",
            g.cont ? t("creditreport.npl.why.contN", { n: CI.num(g.cont) }) : "",
            !none ? t("creditreport.npl.why.promiseN", { n: CI.num(g.promise), total: CI.num(g.accounts.length) }) : ""
        ].filter(Boolean).map(c => `<span class="ci-chip">${CI.esc(c)}</span>`).join("");
        const sorted = g.accounts.slice().sort((x, y) => (Number(y.closeBal) || 0) - (Number(x.closeBal) || 0));
        return `<li><details class="ci-why-group${none ? " is-none" : ""}" data-key="${CI.esc(text)}"${nplWhyOpen.has(text) ? " open" : ""}>
            <summary>
                <span class="ci-why-head"><span class="ci-why-title">${CI.esc(none ? t("creditreport.npl.why.none") : text)}</span>
                    <span class="ci-why-amt">${CI.esc(CI.money(g.value))}</span></span>
                <span class="ci-why-bar"><span style="width:${share}%"></span></span>
                <span class="ci-why-meta">${CI.esc(t("creditreport.npl.accountsN", { n: g.accounts.length }))} · ${CI.esc(share)}%${brs ? ` · ${CI.esc(brs)}` : ""}</span>
                <span class="ci-why-chips">${chips}</span>
            </summary>
            <ul class="ci-cards ci-why-cards">${sorted.slice(0, nplWhyShown.get(text) || NPL_WHY_PAGE).map(a => nplCardHtml(a, false)).join("")}</ul>
            ${sorted.length > (nplWhyShown.get(text) || NPL_WHY_PAGE) ? `<button type="button" class="pi-btn-ghost ci-more" data-more="${CI.esc(text)}">${CI.esc(t("creditreport.npl.why.more", { n: CI.num(sorted.length - (nplWhyShown.get(text) || NPL_WHY_PAGE)) }))}</button>` : ""}
        </details></li>`;
    }).join("") : `<li class="pi-note">${CI.esc(t(q ? "creditreport.pi.nothing" : "creditreport.npl.noReasons"))}</li>`;
}

function nplExport() {
    if (typeof XLSX === "undefined") {
        CI.toast(t("creditreport.npl.exportNotReady"), "error");
        return;
    }
    const rows = nplVisibleRows();
    const aoa = [NPL_COLS.map(c => t(c.label))].concat(rows.map(a => NPL_COLS.map(c => {
        if (c.money || c.num) return Number(a[c.key]) || 0;
        if (c.key === "category") return nplCategoryText(a);
        if (c.key === "location") return a.district || a.location || "";
        return a[c.key] || "";
    })));
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = NPL_COLS.map(c => ({ wch: c.key === "reason" ? 40 : c.money ? 14 : 18 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "NPL");
    const m = nplData.movement;
    XLSX.writeFile(wb, `NPL_${nplTab}_${m.openingDate}_${m.closingDate}.xlsx`);
}

document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("nplWhySearch").addEventListener("input", nplRenderWhy);
    document.getElementById("nplWhy").addEventListener("click", e => {
        const b = e.target.closest("[data-more]");
        if (!b) return;
        nplWhyShown.set(b.dataset.more, (nplWhyShown.get(b.dataset.more) || NPL_WHY_PAGE) + 24);
        nplRenderWhy();
    });
    document.getElementById("nplWhy").addEventListener("toggle", e => {
        const d = e.target.closest("details[data-key]");
        if (!d) return;
        if (d.open) nplWhyOpen.add(d.dataset.key); else nplWhyOpen.delete(d.dataset.key);
    }, true);
    CI.mountFilters({
        dates: true, compare: false, classes: true, side: true,
        periodLabel: nplView === "recovery" ? "creditreport.ci.periodRecovery" : "creditreport.ci.periodNpl",
        onChange: () => {
            nplShown = NPL_PAGE;
            nplStale.movement = nplStale.recovery = true;
            nplShowView(nplView);
        }
    });
    document.getElementById("nplViews").addEventListener("click", e => {
        const b = e.target.closest("[data-view]");
        if (b) nplShowView(b.dataset.view);
    });
    recInit();
    document.getElementById("nplTabs").addEventListener("click", e => {
        const b = e.target.closest("[data-tab]");
        if (!b || !nplData) return;
        nplTab = b.dataset.tab;
        nplShown = NPL_PAGE;
        nplRenderTable();
    });
    document.getElementById("nplTable").addEventListener("click", e => {
        const b = e.target.closest(".ci-sort");
        if (!b) return;
        nplSort = nplSort.key === b.dataset.key ? { key: b.dataset.key, dir: -nplSort.dir } : { key: b.dataset.key, dir: -1 };
        nplRenderTable();
    });
    let typing = null;
    document.getElementById("nplSearch").addEventListener("input", () => {
        clearTimeout(typing);
        typing = setTimeout(() => { nplShown = NPL_PAGE; if (nplData) nplRenderTable(); }, 200);
    });
    document.getElementById("nplMore").addEventListener("click", () => { nplShown += NPL_PAGE; nplRenderTable(); });
    document.getElementById("nplExport").addEventListener("click", nplExport);
    // Movement needs a saved day before From: start the day after the first one.
    document.getElementById("nplSinceFirst").addEventListener("click", () => {
        const first = nplData && nplData.movement && nplData.movement.firstSaved;
        if (!first) return;
        const d = new Date(`${first}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() + 1);
        const from = document.getElementById("ciFrom");
        from.value = d.toISOString().slice(0, 10);
        from.dispatchEvent(new Event("change"));
    });
    new MutationObserver(() => { if (nplData && nplData.movement && nplData.movement.available) nplRenderWaterfall(nplData.movement); })
        .observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    nplShowView(nplView);
});
