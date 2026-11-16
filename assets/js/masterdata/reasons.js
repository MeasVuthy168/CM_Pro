// ========================================
// Master Data > Work to complete > Reason Arrear records
// (pages/masterdata/reasons.html) — every saved Reason Arrear, not only
// today's arrears, with where its loan stands:
//   in arrears / stopped being late (still in OS) / loan closed (not in OS),
// plus stale (in arrears, not updated for 30 days) and poor quality.
//
// GET /api/reasonarrear/records does the scope (like Work to complete),
// filters, counts and paging; this page shows 50 at a time ("Show more"),
// exports every match to Excel, copies a per-officer summary for
// Telegram, and deletes closed-loan records (Excel backup first).
// ========================================

const t = (key) => (window.CMI18n ? CMI18n.t(key) : key);
const tf = (key, vars) => Object.entries(vars || {}).reduce((s, [k, v]) => s.split(`{${k}}`).join(v), t(key));
const $ = id => document.getElementById(id);

const rrUser = (() => {
    try { return JSON.parse(localStorage.getItem("loggedInUser") || sessionStorage.getItem("loggedInUser") || "{}"); }
    catch (e) { return {}; }
})();
const rrRole = String(rrUser.role || "").toLowerCase();
const rrIsAdmin = rrRole === "admin";
// Admin only (the API refuses everyone else too): anyone else goes back
// to Work to complete.
if (!rrIsAdmin) location.replace("/CM_Pro/pages/masterdata/work.html");
const rrIsStaff = rrRole === "viewer_staff";

const PARTS = [
    ["occupationLoan", "arrears.reasonOccLoanLabel"],
    ["occupationNow", "arrears.reasonOccNowLabel"],
    ["purpose", "arrears.reasonPurposeLabel"],
    ["reason", "arrears.reasonReasonLabel"],
    ["solution", "arrears.reasonSolutionOnlyLabel"]
];

let rrCard = "all";
let rrPage = 1;
let rrPages = 1;
let rrRows = [];
let rrTotal = 0;
let rrBusy = false;

function rrToken() { return API.getToken ? API.getToken() : (localStorage.getItem("token") || sessionStorage.getItem("token")); }

function escapeHtml(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function notify(message, type = "info") {
    if (typeof CMToast !== "undefined" && CMToast.show) CMToast.show({ type, title: message, message: "", duration: 3000 });
    else alert(message);
}

// Cambodia time (UTC+7), "yyyy-mm-dd hh:mm AM".
function fmtDateTime(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d)) return "";
    const k = new Date(d.getTime() + 7 * 3600 * 1000);
    const pad = n => String(n).padStart(2, "0");
    let h = k.getUTCHours();
    const ampm = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    return `${k.getUTCFullYear()}-${pad(k.getUTCMonth() + 1)}-${pad(k.getUTCDate())} ${pad(h)}:${pad(k.getUTCMinutes())} ${ampm}`;
}
const isoToDMY = v => { const m = String(v || "").match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : ""; };

function filters() {
    return {
        q: $("rrSearch").value.trim(),
        branch: $("rrBranch").value,
        officer: $("rrOfficer").value,
        uploadedBy: $("rrUploader").value,
        from: $("rrFrom").value,
        to: $("rrTo").value
    };
}

function query(extra) {
    const p = new URLSearchParams({ card: rrCard, ...extra });
    Object.entries(filters()).forEach(([k, v]) => { if (v) p.set(k, v); });
    return p.toString();
}

async function fetchRecords(extra) {
    const res = await fetch(`${API.BASE_URL}/api/reasonarrear/records?${query(extra)}`, {
        headers: { Authorization: `Bearer ${rrToken()}` }
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.message || `HTTP ${res.status}`);
    return data;
}

// page 1 replaces the list; later pages append ("Show more").
async function load(page = 1) {
    if (rrBusy) return;
    rrBusy = true;
    const first = page === 1;
    if (first && typeof showAppLoading === "function") showAppLoading(t("common.loading"));
    try {
        const data = await fetchRecords({ page, limit: 50 });
        rrPage = data.page;
        rrPages = data.pages;
        rrTotal = data.total;
        rrRows = first ? data.rows : rrRows.concat(data.rows);
        renderCounts(data);
        renderFacets(data.facets);
        renderList();
    } catch (err) {
        console.error("[reasons] load failed:", err);
        notify(t("rr.loadFailed"), "error");
        if (first) $("rrList").innerHTML = `<div class="oa-empty">${escapeHtml(t("rr.loadFailed"))}</div>`;
    } finally {
        rrBusy = false;
        if (first && typeof hideAppLoading === "function") hideAppLoading();
    }
}

function renderCounts(data) {
    const c = data.counts || {};
    ["all", "arrears", "current", "closed", "stale", "poor"].forEach(k => {
        $(`rrCount-${k}`).textContent = (c[k] || 0).toLocaleString();
    });
    $("rrStaleLabel").textContent = tf("rr.cardStaleN", { n: data.staleDays || 30 });
    document.querySelectorAll("[data-rr-card]").forEach(b => b.classList.toggle("active", b.dataset.rrCard === rrCard));
    $("rrSub").textContent = data.osLoaded === false ? t("rr.noOs") : tf("rr.subTotal", { n: (c.all || 0).toLocaleString() });
    const del = $("btnRrDelete");
    del.hidden = !(rrIsAdmin && rrCard === "closed" && (c.closed || 0) > 0);
    $("rrDeleteText").textContent = tf("rr.delBtn", { n: (c.closed || 0).toLocaleString() });
}

// Pickers keep the chosen value even if it falls out of the list.
function fillSelect(el, values, allKey) {
    const cur = el.value;
    const opts = [`<option value="">${escapeHtml(t(allKey))}</option>`]
        .concat(values.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`));
    if (cur && !values.includes(cur)) opts.push(`<option value="${escapeHtml(cur)}">${escapeHtml(cur)}</option>`);
    el.innerHTML = opts.join("");
    el.value = cur;
}

function renderFacets(f) {
    if (!f) return;
    fillSelect($("rrBranch"), f.branches || [], "rr.allBranches");
    fillSelect($("rrOfficer"), f.officers || [], "rr.allOfficers");
    fillSelect($("rrUploader"), f.uploaders || [], "rr.allUploaders");
    // One branch / one officer only: no point offering the picker.
    $("rrBranch").hidden = rrIsStaff || (f.branches || []).length < 2;
    $("rrOfficer").hidden = rrIsStaff;
    const any = Object.values(filters()).some(Boolean);
    $("btnRrClear").hidden = !any;
}

const STATUS_CSS = { arrears: "rr-st-arrears", current: "rr-st-current", closed: "rr-st-closed", unknown: "rr-st-closed" };

function renderList() {
    const cardLabel = t({ all: "rr.cardAll", arrears: "rr.cardArrears", current: "rr.cardCurrent", closed: "rr.cardClosed", stale: "rr.cardStale", poor: "rr.cardPoor" }[rrCard]);
    $("rrSubtitle").textContent = tf("rr.subtitle", { tab: cardLabel, n: rrTotal.toLocaleString() });
    const list = $("rrList");
    if (!rrRows.length) {
        list.innerHTML = `<div class="oa-empty oa-empty-art">
            <span class="oa-empty-ico"><span class="ui-ico ui-ico-clipboard" aria-hidden="true"></span></span>
            <strong>${escapeHtml(t("arrears.oaEmpty"))}</strong></div>`;
    } else {
        list.innerHTML = rrRows.map(r => {
            const parts = PARTS.map(([k, key]) => {
                const v = r[k];
                return `<div class="rr-part${v ? "" : " rr-part-empty"}"><span>${escapeHtml(t(key))}</span><b>${escapeHtml(v || "—")}</b></div>`;
            }).join("");
            const flags = [
                `<span class="rr-chip ${STATUS_CSS[r.status] || ""}">${escapeHtml(t(`rr.st.${r.status}`))}</span>`,
                r.stale ? `<span class="rr-chip rr-st-stale">${escapeHtml(t("rr.flagStale"))}</span>` : "",
                r.poor ? `<span class="rr-chip rr-st-poor">${escapeHtml(t("rr.flagPoor"))}</span>` : ""
            ].join("");
            const edit = r.status === "arrears"
                ? `<a class="rr-edit" href="/CM_Pro/pages/masterdata/work.html?q=${encodeURIComponent(r.loanNumber)}"><span class="ui-ico ui-ico-edit" aria-hidden="true"></span> ${escapeHtml(t("rr.edit"))}</a>` : "";
            return `<div class="oa-item rr-item">
                <div class="oa-item-main">
                    <div class="oa-item-name">${escapeHtml(r.customer || "-")}</div>
                    <div class="oa-item-sub">${escapeHtml(r.loanNumber)}${r.customerCif ? ` · CIF ${escapeHtml(r.customerCif)}` : ""}${r.day ? ` · ${escapeHtml(r.day)} ${escapeHtml(t("arrears.cardDays"))}` : ""}</div>
                    <div class="rr-flags">${flags}</div>
                    <div class="rr-parts">${parts}</div>
                    <div class="oa-item-meta">
                        ${r.coResponse ? `<span><span class="ui-ico ui-ico-officer" aria-hidden="true"></span> ${escapeHtml(r.coResponse)}</span>` : ""}
                        ${r.al ? `<span class="wk-chip">${escapeHtml(tf("work.promiseOn", { d: isoToDMY(r.al) }))}</span>` : ""}
                    </div>
                    <div class="rr-by">${escapeHtml(tf("rr.by", { by: r.uploadedBy || "-", at: fmtDateTime(r.uploadedAt) || "-" }))}</div>
                </div>
                ${edit}
            </div>`;
        }).join("");
    }
    const more = $("btnRrMore");
    more.hidden = rrPage >= rrPages;
    more.textContent = tf("rr.more", { n: (rrTotal - rrRows.length).toLocaleString() });
}

// ---------- export (every match, Excel) ----------
// pre: rows already fetched (the delete's backup), else every match now.
// Returns true once the file is saved.
async function exportExcel(pre) {
    if (typeof ArrExport === "undefined") return false;
    if (!pre && typeof showAppLoading === "function") showAppLoading(t("rr.exporting"));
    try {
        const data = pre || await fetchRecords({ export: "1" });
        const text = key => ({ type: "text", value: r => r[key] || null });
        const cols = [
            { label: "No", type: "int", value: (r, i) => i + 1 },
            { label: t("rr.colCustomer"), ...text("customer"), maxChars: 30 },
            { label: "LD", ...text("loanNumber") },
            { label: "CIF", ...text("customerCif") },
            { label: t("rr.colBranch"), ...text("branch") },
            { label: t("rr.colOfficer"), ...text("coResponse") },
            { label: t("rr.colStatus"), type: "text", value: r => t(`rr.st.${r.status}`) },
            ...PARTS.map(([k, key]) => ({ label: t(key), ...text(k), maxChars: 40 })),
            { label: t("arrears.reasonPromiseDateLabel"), type: "text", value: r => isoToDMY(r.al) || null },
            { label: t("rr.colStale"), type: "text", value: r => (r.stale ? "✓" : null) },
            { label: t("rr.colPoor"), type: "text", value: r => (r.poor ? "✓" : null) },
            { label: "User", ...text("uploadedBy") },
            { label: "DateBackUpReasonArrear", type: "text", value: r => fmtDateTime(r.uploadedAt) || null }
        ];
        const f = filters();
        const info = [`${t("rr.heroTitle")} · ${t({ all: "rr.cardAll", arrears: "rr.cardArrears", current: "rr.cardCurrent", closed: "rr.cardClosed", stale: "rr.cardStale", poor: "rr.cardPoor" }[rrCard])} · ${data.rows.length.toLocaleString()}`]
            .concat(Object.entries(f).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`));
        const stamp = new Date().toISOString().slice(0, 10);
        await ArrExport.excel({
            filename: `ReasonArrear_${pre ? "deleted_" : ""}${rrCard}_${stamp}.xlsx`,
            sheets: [{ name: "Reason Arrear", title: t("rr.heroTitle"), info, cols, rows: data.rows }]
        });
        return true;
    } catch (err) {
        console.error("[reasons] export failed:", err);
        notify(t("rr.exportFailed"), "error");
        return false;
    } finally {
        if (!pre && typeof hideAppLoading === "function") hideAppLoading();
    }
}

// ---------- copy for Telegram ----------
// The filtered records: the cards, then one block per officer (most
// stale + poor first) with only what's above 0. "▪️" so Telegram keeps
// the layout.
async function copyReport() {
    try {
        const data = await fetchRecords({ summary: "1" });
        const c = data.counts || {};
        const f = filters();
        const where = [f.branch, f.officer, f.uploadedBy && `${t("rr.colUser")}: ${f.uploadedBy}`,
            (f.from || f.to) && `${f.from || "…"} → ${f.to || "…"}`, f.q && `"${f.q}"`].filter(Boolean).join(" · ");
        const n = v => (v || 0).toLocaleString();
        const lines = [
            `📋 ${t("rr.heroTitle")}`,
            `📅 ${isoToDMY(new Date(Date.now() + 7 * 3600e3).toISOString())}${where ? " · " + where : ""}`,
            `📊 ${tf("rr.subTotal", { n: n(c.all) })}`,
            "",
            `🔴 ${t("rr.cardArrears")}: ${n(c.arrears)}`,
            `🟢 ${t("rr.cardCurrent")}: ${n(c.current)}`,
            `⚫ ${t("rr.cardClosed")}: ${n(c.closed)}`,
            `🕒 ${tf("rr.cardStaleN", { n: data.staleDays || 30 })}: ${n(c.stale)}`,
            `✏️ ${t("rr.cardPoor")}: ${n(c.poor)}`,
            "",
            `👤 ${t("rr.rpByOfficer")}`
        ];
        const MAX = 40;
        const offs = data.byOfficer || [];
        offs.slice(0, MAX).forEach(o => {
            const items = [
                o.arrears && `${t("rr.cardArrears")} ${n(o.arrears)}`,
                o.stale && `${t("rr.rpStale")} ${n(o.stale)}`,
                o.poor && `${t("rr.rpPoor")} ${n(o.poor)}`,
                o.closed && `${t("rr.cardClosed")} ${n(o.closed)}`
            ].filter(Boolean);
            lines.push(`▪️ ${o.officer === "-" ? t("rr.noOfficer") : o.officer} — ${n(o.total)}`);
            if (items.length) lines.push(`   ${items.join(" · ")}`);
        });
        if (offs.length > MAX) lines.push(tf("rr.rpMore", { n: n(offs.length - MAX) }));
        await copyText(lines.join("\n"));
        notify(t("rr.copied"), "success");
    } catch (err) {
        console.error("[reasons] copy failed:", err);
        notify(t("rr.copyFailed"), "error");
    }
}

async function copyText(text) {
    try {
        await navigator.clipboard.writeText(text);
    } catch (e) {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        ta.parentNode.removeChild(ta);
        if (!ok) throw e;
    }
}

// ---------- delete closed-loan records (admin) ----------
// The "loan closed" records matching the filters: confirm, save them to
// Excel first, then delete. The server re-checks each against a fresh
// read of OS and only deletes those still closed.
async function deleteClosed() {
    if (!rrIsAdmin || rrCard !== "closed") return;
    if (typeof showAppLoading === "function") showAppLoading(t("common.loading"));
    let data;
    try {
        data = await fetchRecords({ export: "1" });
    } catch (err) {
        if (typeof hideAppLoading === "function") hideAppLoading();
        notify(t("rr.loadFailed"), "error");
        return;
    }
    if (typeof hideAppLoading === "function") hideAppLoading();
    const rows = (data.rows || []).filter(r => r.status === "closed");
    if (!rows.length) return notify(t("arrears.oaEmpty"), "info");
    if (!confirm(tf("rr.delConfirm", { n: rows.length.toLocaleString() }))) return;
    if (typeof showAppLoading === "function") showAppLoading(t("rr.delBackup"));
    try {
        // Backup first: no file, no delete.
        if (!(await exportExcel({ ...data, rows }))) return;
        if (typeof showAppLoading === "function") showAppLoading(tf("rr.deleting", { n: rows.length.toLocaleString() }));
        const res = await fetch(`${API.BASE_URL}/api/reasonarrear/records/delete-closed`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${rrToken()}` },
            body: JSON.stringify({ cifs: rows.map(r => r.cif) })
        });
        const out = await res.json();
        if (!res.ok || !out.ok) throw new Error(out.message || `HTTP ${res.status}`);
        notify(tf("rr.deleted", { n: (out.deletedCount || 0).toLocaleString() }) +
            (out.skipped ? " " + tf("rr.delSkipped", { n: out.skipped.toLocaleString() }) : ""), "success");
    } catch (err) {
        console.error("[reasons] delete failed:", err);
        notify(err.message || t("rr.delFailed"), "error");
    } finally {
        if (typeof hideAppLoading === "function") hideAppLoading();
        load(1);
    }
}

// ---------- events ----------
document.querySelectorAll("[data-rr-card]").forEach(btn => btn.addEventListener("click", () => {
    rrCard = btn.dataset.rrCard;
    load(1);
}));
let searchTimer = null;
$("rrSearch").addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => load(1), 350); });
["rrBranch", "rrOfficer", "rrUploader", "rrFrom", "rrTo"].forEach(id => $(id).addEventListener("change", () => load(1)));
$("btnRrClear").addEventListener("click", () => {
    $("rrSearch").value = "";
    ["rrBranch", "rrOfficer", "rrUploader", "rrFrom", "rrTo"].forEach(id => { $(id).value = ""; });
    load(1);
});
$("btnRrMore").addEventListener("click", () => load(rrPage + 1));
$("btnRrRefresh").addEventListener("click", () => load(1));
$("btnRrExport").addEventListener("click", () => exportExcel());
$("btnRrCopy").addEventListener("click", copyReport);
$("btnRrDelete").addEventListener("click", deleteClosed);
window.addEventListener("cm-language-changed", () => load(1));

// ========================================
// COMPONENT LOADER (topbar + bottomnav)
// ========================================
let rrLoaded = 0;
async function loadComponent(id, file) {
    try {
        const useCache = id !== "topbar-container";
        const cached = useCache ? sessionStorage.getItem("comp_" + id) : null;
        if (cached) {
            document.getElementById(id).innerHTML = cached;
        } else {
            const html = await (await fetch(file)).text();
            document.getElementById(id).innerHTML = html;
            if (useCache) sessionStorage.setItem("comp_" + id, html);
        }
        if (id === "topbar-container") {
            initTopbar({ titleKey: "rr.pageTitle", showBack: true, showLogo: false, showProfile: false });
            const backBtn = document.getElementById("topbarBackBtn");
            if (backBtn) backBtn.onclick = () => cmNav.back("/CM_Pro/pages/masterdata/work.html");
        }
    } catch (error) {
        console.error(error);
    } finally {
        rrLoaded++;
        if (rrLoaded >= 2) setTimeout(() => { if (typeof hideGlobalSplash === "function") hideGlobalSplash(); }, 300);
    }
}
loadComponent("topbar-container", "/CM_Pro/components/topbar.html");
loadComponent("bottomnav-container", "/CM_Pro/components/bottomnav.html");

function updateOnlineStatus() {
    const banner = document.getElementById("offlineBanner");
    if (banner) banner.style.display = navigator.onLine ? "none" : "block";
}
window.addEventListener("online", updateOnlineStatus);
window.addEventListener("offline", updateOnlineStatus);
updateOnlineStatus();

load(1);
