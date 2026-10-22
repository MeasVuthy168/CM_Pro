// ========================================
// Master Data > LGs Loans — កម្ចីក្នុងដែនកំណត់ LGs
// Loans disbursed in the period (OS!S) that sit inside the LGs limit
// (Outstanding Value, OS!N, <= 20,000) and how many of them are already
// refinanced (OS!AX = "YES"), in total, per branch and per day — the
// figures the Daily Credit Monitoring sheet works out with COUNTIFS.
// Backed by GET /api/creditreport/lgs; tapping a total, a branch or a
// day lists those loans (?list=lgs|refinanced).
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

let lgData = null;
let lgSheetCtx = null; // { branch, date, title }

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

function lgPaint(data) {
    lgData = data;
    const { total } = data;
    document.getElementById("lgAsOf").textContent = data.asOf || "-";
    document.getElementById("lgTotalLgs").textContent = lgNum(total.lgs);
    document.getElementById("lgTotalRefin").textContent = lgNum(total.refinanced);
    document.getElementById("lgTotalOf").textContent = t("masterdata.lgs.ofDisbursed", { n: lgNum(total.disbursed) });
    document.getElementById("lgTotalPct").textContent = t("masterdata.lgs.pctOfLgs", { pct: lgPct(total.refinanced, total.lgs) });
    document.getElementById("lgMeter").style.width = total.lgs ? `${Math.min(100, total.refinanced / total.lgs * 100)}%` : "0";
    document.getElementById("lgFrom").value = data.fromDate || "";
    document.getElementById("lgTo").value = data.toDate || "";
    document.getElementById("lgNote").textContent = t("masterdata.lgs.note", { limit: lgNum(data.limit) });

    const branches = document.getElementById("lgBranches");
    branches.innerHTML = (data.branches || []).length
        ? data.branches.map(b => lgRow({
            label: b.branch,
            sub: t("masterdata.lgs.disbursedN", { n: lgNum(b.disbursed) }),
            lgs: b.lgs, refinanced: b.refinanced,
            attrs: `data-branch="${lgEsc(b.branch)}"`
        })).join("")
        : `<div class="lg-empty">${lgEsc(t("masterdata.lgs.empty"))}</div>`;

    const daily = document.getElementById("lgDaily");
    daily.innerHTML = (data.daily || []).length
        ? data.daily.map(d => lgRow({
            label: lgDate(d.date),
            sub: t("masterdata.lgs.disbursedN", { n: lgNum(d.disbursed) }),
            lgs: d.lgs, refinanced: d.refinanced,
            attrs: `data-date="${lgEsc(d.date)}"`
        })).join("")
        : `<div class="lg-empty">${lgEsc(t("masterdata.lgs.empty"))}</div>`;
}

function lgShowError() {
    const html = `<div class="lg-empty">${lgEsc(t("masterdata.outArea.loadFailed"))}<br><button type="button" class="lg-retry">${lgEsc(t("masterdata.outArea.retry"))}</button></div>`;
    document.getElementById("lgBranches").innerHTML = html;
    document.getElementById("lgDaily").innerHTML = "";
    document.querySelector("#lgBranches .lg-retry")?.addEventListener("click", () => lgLoad());
}

async function lgLoad(params = {}) {
    if (typeof showAppLoading === "function") {
        showAppLoading(t("masterdata.lgs.loading"), { progress: true, key: "masterdata:lgs" });
    }
    try {
        lgPaint(await lgGet(params));
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
            ...(ctx.branch ? { branch: ctx.branch } : {}),
            ...(ctx.date ? { date: ctx.date } : {})
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
    b.addEventListener("click", () => lgOpenSheet({ title: t("masterdata.lgs.allBranches") }, b.dataset.list));
});
document.getElementById("lgBranches").addEventListener("click", e => {
    const row = e.target.closest(".lg-row[data-branch]");
    if (row) lgOpenSheet({ branch: row.dataset.branch, title: row.dataset.branch }, "lgs");
});
document.getElementById("lgDaily").addEventListener("click", e => {
    const row = e.target.closest(".lg-row[data-date]");
    if (row) lgOpenSheet({ date: row.dataset.date, title: lgDate(row.dataset.date) }, "lgs");
});
document.querySelectorAll(".lg-tab").forEach(b => b.addEventListener("click", () => lgSheetTab(b.dataset.tab)));
document.getElementById("btnLgSheetClose").addEventListener("click", lgCloseSheet);
document.getElementById("lgSheet").addEventListener("click", e => { if (e.target.id === "lgSheet") lgCloseSheet(); });
document.addEventListener("keydown", e => { if (e.key === "Escape" && !document.getElementById("lgSheet").hidden) lgCloseSheet(); });

["lgFrom", "lgTo"].forEach(id => document.getElementById(id).addEventListener("change", () => {
    const { fromDate, toDate } = lgPeriodParams();
    if (fromDate && toDate && fromDate > toDate) {
        if (typeof showToast === "function") showToast(t("masterdata.lgs.badRange"), "warning");
        return;
    }
    lgLoad(lgPeriodParams());
}));
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
