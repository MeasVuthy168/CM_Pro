// ========================================
// Master Data > LGs Loans — កម្ចីក្នុងដែនកំណត់ LGs
// Loans disbursed in the period (OS!S) that sit inside the LGs limit
// (Outstanding Value, OS!N, <= 20,000) and how many of them are already
// refinanced (OS!AX = "YES"), in total and per branch — the figures the
// Daily Credit Monitoring sheet works out with COUNTIFS. Backed by
// GET /api/creditreport/lgs; tapping a total or a branch lists those
// loans (?list=lgs|refinanced).
// ========================================

const t = (key, vars) => (window.CMI18n ? CMI18n.t(key, vars) : key);
const lgEsc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const lgNum = n => (Number(n) || 0).toLocaleString("en-US");
const lgPct = (part, whole) => whole ? `${Math.round(part / whole * 1000) / 10}%` : "0%";

// "2026-10-20" -> "20/10/2026"
function lgDate(key) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key || "");
    return m ? `${m[3]}/${m[2]}/${m[1]}` : (key || "-");
}

// "2026-10-20" -> "20 Oct 2026" / "20 តុលា 2026" for the date pills.
const LG_MONTHS = {
    en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
    km: ["មករា", "កុម្ភៈ", "មីនា", "មេសា", "ឧសភា", "មិថុនា", "កក្កដា", "សីហា", "កញ្ញា", "តុលា", "វិច្ឆិកា", "ធ្នូ"]
};
function lgDateLong(key) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key || "");
    if (!m) return "-";
    const lang = (window.CMLanguage && CMLanguage.get()) === "en" ? "en" : "km";
    return `${+m[3]} ${LG_MONTHS[lang][+m[2] - 1]} ${m[1]}`;
}

// yyyy-mm-dd -> local Date, and whole days between two keys.
const lgParse = k => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
const lgDays = (a, b) => Math.round((lgParse(b) - lgParse(a)) / 86400000) + 1;

let lgData = null;
let lgSheetCtx = null; // { branch, title }
// Latest disbursement date in the data (the server's default "to");
// the date pickers stop there.
let lgAnchor = "";
// Selected branch ("" = all branches in the user's scope); the chat's
// "Open LGs Loans" link can pass one as ?branch=.
let lgBranch = (() => {
    try { return new URLSearchParams(location.search).get("branch") || ""; } catch (e) { return ""; }
})();

// Pills, day count and the hero's period line for the current period.
function lgPaintPeriod(from, to) {
    document.getElementById("lgFrom").value = from || "";
    document.getElementById("lgTo").value = to || "";
    document.getElementById("lgFromText").textContent = lgDateLong(from);
    document.getElementById("lgToText").textContent = lgDateLong(to);
    document.getElementById("lgDays").textContent = from && to ? t("masterdata.lgs.daysN", { n: lgDays(from, to) }) : "-";
    if (lgAnchor) {
        document.getElementById("lgFrom").max = lgAnchor;
        document.getElementById("lgTo").max = lgAnchor;
    }
    document.getElementById("lgPeriodText").textContent = from && to
        ? t("masterdata.lgs.periodText", { from: lgDateLong(from), to: lgDateLong(to) })
        : "-";
}

async function lgGet(params) {
    const q = new URLSearchParams(params).toString();
    const res = await fetch(`${API.BASE_URL}/api/creditreport/lgs${q ? "?" + q : ""}`, {
        headers: { Authorization: `Bearer ${API.getToken()}` }
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.message || "Failed to load.");
    return data;
}

function lgPeriodParams() {
    const from = document.getElementById("lgFrom").value;
    const to = document.getElementById("lgTo").value;
    return { ...(from ? { fromDate: from } : {}), ...(to ? { toDate: to } : {}) };
}

// One row: label, LGs count, refinanced count, and a bar of refinanced / LGs.
function lgRow({ label, sub, lgs, refinanced, attrs }) {
    const pct = lgs ? Math.round(refinanced / lgs * 100) : 0;
    return `<button type="button" class="lg-row" ${attrs}>
        <div class="lg-row-main">
            <div class="lg-row-label">${lgEsc(label)}${sub ? `<small>${lgEsc(sub)}</small>` : ""}</div>
            <div class="lg-row-nums">
                <span class="lg-chip"><b>${lgNum(lgs)}</b> ${lgEsc(t("masterdata.lgs.chipLgs"))}</span>
                <span class="lg-chip lg-chip-refin"><b>${lgNum(refinanced)}</b> ${lgEsc(t("masterdata.lgs.chipRefin"))}</span>
            </div>
        </div>
        <div class="lg-bar" aria-hidden="true"><i style="width:${pct}%"></i></div>
        <span class="lg-row-arrow" aria-hidden="true">›</span>
    </button>`;
}

// Branch chips: All + each branch in scope (hidden when there's only one).
function lgPaintBranchFilter(list) {
    const wrap = document.getElementById("lgBranchFilter");
    if (lgBranch && !list.some(b => b.branch === lgBranch)) lgBranch = "";
    wrap.hidden = list.length < 2;
    const chips = [{ value: "", label: t("masterdata.lgs.allBranches") }, ...list.map(b => ({ value: b.branch, label: b.branch }))];
    wrap.innerHTML = chips.map(c => {
        const on = c.value === lgBranch;
        return `<button type="button" class="lg-preset${on ? " on" : ""}" aria-pressed="${on}" data-branch="${lgEsc(c.value)}">${lgEsc(c.label)}</button>`;
    }).join("");
}

function lgPaint(data) {
    lgData = data;
    const list = data.branches || [];
    lgPaintBranchFilter(list);
    if (list.length === 1) lgBranch = list[0].branch;
    const total = (lgBranch && list.find(b => b.branch === lgBranch)) || data.total;
    document.getElementById("lgBranchName").textContent = lgBranch || t("masterdata.lgs.allBranches");
    document.getElementById("lgTotalLgs").textContent = lgNum(total.lgs);
    document.getElementById("lgTotalRefin").textContent = lgNum(total.refinanced);
    document.getElementById("lgTotalOf").textContent = t("masterdata.lgs.ofDisbursed", { n: lgNum(total.disbursed) });
    document.getElementById("lgTotalPct").textContent = t("masterdata.lgs.pctOfLgs", { pct: lgPct(total.refinanced, total.lgs) });
    document.getElementById("lgMeter").style.width = total.lgs ? `${Math.min(100, total.refinanced / total.lgs * 100)}%` : "0";
    lgPaintPeriod(data.fromDate, data.toDate);

    const branches = document.getElementById("lgBranches");
    const shown = lgBranch ? list.filter(b => b.branch === lgBranch) : list;
    branches.innerHTML = shown.length
        ? shown.map(b => lgRow({
            label: b.branch,
            sub: t("masterdata.lgs.disbursedN", { n: lgNum(b.disbursed) }),
            lgs: b.lgs, refinanced: b.refinanced,
            attrs: `data-branch="${lgEsc(b.branch)}"`
        })).join("")
        : `<div class="lg-empty">${lgEsc(t("masterdata.lgs.empty"))}</div>`;
}

function lgShowError() {
    const html = `<div class="lg-empty">${lgEsc(t("masterdata.outArea.loadFailed"))}<br><button type="button" class="lg-retry">${lgEsc(t("masterdata.outArea.retry"))}</button></div>`;
    document.getElementById("lgBranches").innerHTML = html;
    document.querySelector("#lgBranches .lg-retry")?.addEventListener("click", () => lgLoad());
}

async function lgLoad(params = {}) {
    if (typeof showAppLoading === "function") {
        showAppLoading(t("masterdata.lgs.loading"), { progress: true, key: "masterdata:lgs" });
    }
    try {
        const data = await lgGet(params);
        if (!params.fromDate && !params.toDate) lgAnchor = data.toDate || lgAnchor;
        lgPaint(data);
    } catch (err) {
        console.error("[lgs] load failed:", err);
        lgShowError();
    } finally {
        if (typeof hideAppLoading === "function") hideAppLoading();
    }
}

// ---------- loan list sheet ----------
async function lgOpenSheet(ctx, tab) {
    lgSheetCtx = ctx;
    const sheet = document.getElementById("lgSheet");
    sheet.hidden = false;
    document.body.classList.add("lg-sheet-open");
    document.getElementById("lgSheetTitle").textContent = ctx.title;
    await lgSheetTab(tab);
}

async function lgSheetTab(tab) {
    const ctx = lgSheetCtx;
    if (!ctx) return;
    document.querySelectorAll(".lg-tab").forEach(b => {
        b.classList.toggle("on", b.dataset.tab === tab);
        b.setAttribute("aria-selected", b.dataset.tab === tab ? "true" : "false");
    });
    const list = document.getElementById("lgSheetList");
    const sub = document.getElementById("lgSheetSub");
    list.innerHTML = `<div class="lg-empty">${lgEsc(t("masterdata.lgs.loading"))}</div>`;
    sub.textContent = "";
    try {
        const data = await lgGet({
            ...lgPeriodParams(), list: tab,
            ...(ctx.branch ? { branch: ctx.branch } : {})
        });
        if (lgSheetCtx !== ctx) return;
        const items = data.items || [];
        sub.textContent = t("masterdata.lgs.loansN", { n: lgNum(items.length) });
        list.innerHTML = items.length ? items.map(i => `
            <div class="lg-loan">
                <div class="lg-loan-top">
                    <b>${lgEsc(i.name || "-")}</b>
                    ${i.refinanced ? `<span class="lg-badge">${lgEsc(t("masterdata.lgs.badgeRefin"))}</span>` : ""}
                </div>
                <div class="lg-loan-meta">${lgEsc([i.cif, i.loanNumber, i.branch].filter(Boolean).join(" · "))}</div>
                <div class="lg-loan-meta">${lgEsc(lgDate(i.disburseDate))}${i.productType ? " · " + lgEsc(i.productType) : ""}</div>
                <div class="lg-loan-amt">
                    <span>${lgEsc(t("masterdata.lgs.outstanding"))} <b>${lgNum(i.outstanding)}</b></span>
                    <span>${lgEsc(t("masterdata.lgs.loanSize"))} <b>$${lgNum(i.loanSize)}</b></span>
                </div>
            </div>`).join("") : `<div class="lg-empty">${lgEsc(t("masterdata.lgs.empty"))}</div>`;
    } catch (err) {
        console.error("[lgs] list failed:", err);
        if (lgSheetCtx === ctx) list.innerHTML = `<div class="lg-empty">${lgEsc(t("masterdata.outArea.loadFailed"))}</div>`;
    }
}

function lgCloseSheet() {
    lgSheetCtx = null;
    document.getElementById("lgSheet").hidden = true;
    document.body.classList.remove("lg-sheet-open");
}

document.querySelectorAll(".lg-stat").forEach(b => {
    b.addEventListener("click", () => lgOpenSheet({ branch: lgBranch, title: lgBranch || t("masterdata.lgs.allBranches") }, b.dataset.list));
});
document.getElementById("lgBranches").addEventListener("click", e => {
    const row = e.target.closest(".lg-row[data-branch]");
    if (row) lgOpenSheet({ branch: row.dataset.branch, title: row.dataset.branch }, "lgs");
});
document.querySelectorAll(".lg-tab").forEach(b => b.addEventListener("click", () => lgSheetTab(b.dataset.tab)));
document.getElementById("btnLgSheetClose").addEventListener("click", lgCloseSheet);
document.getElementById("lgSheet").addEventListener("click", e => { if (e.target.id === "lgSheet") lgCloseSheet(); });
document.addEventListener("keydown", e => { if (e.key === "Escape" && !document.getElementById("lgSheet").hidden) lgCloseSheet(); });

// A From after To (or To before From) pulls the other end along, so the
// period is never empty.
["lgFrom", "lgTo"].forEach(id => document.getElementById(id).addEventListener("change", () => {
    const fromEl = document.getElementById("lgFrom");
    const toEl = document.getElementById("lgTo");
    if (!fromEl.value || !toEl.value) return lgPaintPeriod(lgData?.fromDate, lgData?.toDate);
    if (fromEl.value > toEl.value) {
        if (id === "lgFrom") toEl.value = fromEl.value; else fromEl.value = toEl.value;
    }
    lgPaintPeriod(fromEl.value, toEl.value);
    lgLoad(lgPeriodParams());
}));
// Switching branch only re-reads the figures already loaded.
document.getElementById("lgBranchFilter").addEventListener("click", e => {
    const chip = e.target.closest(".lg-preset[data-branch]");
    if (!chip || !lgData) return;
    lgBranch = chip.dataset.branch;
    lgPaint(lgData);
});
document.getElementById("btnLgRefresh").addEventListener("click", () => lgLoad(lgPeriodParams()));

lgLoad();

// ========================================
// COMPONENT LOADER (topbar + bottomnav)
// ========================================
let lgLoaded = 0;
async function loadComponent(id, file) {
    try {
        const useCache = id !== "topbar-container";
        const cached = useCache ? sessionStorage.getItem("comp_" + id) : null;
        if (cached) {
            document.getElementById(id).innerHTML = cached;
        } else {
            const response = await fetch(file);
            const html = await response.text();
            document.getElementById(id).innerHTML = html;
            if (useCache) {
                sessionStorage.setItem("comp_" + id, html);
            }
        }
        if (id === "topbar-container") {
            initTopbar({
                titleKey: "masterdata.hub.lgs",
                showBack: true,
                showLogo: false,
                showProfile: false
            });
            // Belongs under Master Data — Back goes there, not history.back().
            const backBtn = document.getElementById("topbarBackBtn");
            if (backBtn) {
                backBtn.onclick = () => cmNav.back("/CM_Pro/pages/masterdata/index.html");
            }
        }
    } catch (error) {
        console.error(error);
    } finally {
        lgLoaded++;
        if (lgLoaded >= 2) {
            setTimeout(() => {
                if (typeof hideGlobalSplash === "function") {
                    hideGlobalSplash();
                }
            }, 300);
        }
    }
}
loadComponent("topbar-container", "/CM_Pro/components/topbar.html");
loadComponent("bottomnav-container", "/CM_Pro/components/bottomnav.html");

// ========================================
// OFFLINE DETECT
// ========================================
function updateOnlineStatus() {
    const banner = document.getElementById("offlineBanner");
    if (banner) {
        banner.style.display = navigator.onLine ? "none" : "block";
    }
}
window.addEventListener("online", updateOnlineStatus);
window.addEventListener("offline", updateOnlineStatus);
updateOnlineStatus();

setTimeout(() => {
    if (typeof loadNotificationBadge === "function") {
        loadNotificationBadge();
    }
}, 500);
