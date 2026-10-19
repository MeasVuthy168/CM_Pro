// ========================================
// List Officer — pages/masterdata/officer.html
// Reads/writes GET /api/creditofficer/list, POST
// /api/creditofficer/upsert, DELETE /api/creditofficer/:officerId.
// Add/Edit/Delete are admin-only — matches the backend's own
// isAdmin() gate, so this is UX convenience, not the real guard.
// ========================================

const t = (key, vars) => window.CMI18n ? CMI18n.t(key, vars) : key;

function notify(message, type = "info") {
    if (typeof showToast === "function") {
        showToast(message, type);
    } else {
        alert(message);
    }
}

const mdLoggedInUser = JSON.parse(
    localStorage.getItem("loggedInUser") || sessionStorage.getItem("loggedInUser") || "{}"
);
const mdIsAdmin = String(mdLoggedInUser.role || "").toLowerCase() === "admin";

let mdOfficers = [];      // full list from the server, unfiltered
let mdEditingId = null;   // officerId currently being edited, or null for "add"
let mdViewMode = localStorage.getItem("md_officer_view") === "list" ? "list" : "card";

function mdEscapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text == null ? "" : String(text);
    return div.innerHTML;
}

// ========================================
// LOAD
// ========================================
async function mdLoadOfficers() {
    try {
        const data = await API.get("/api/creditofficer/list");
        if (!data.ok) {
            notify(data.message || t("masterdata.officer.loadFailed"), "error");
            return;
        }
        mdOfficers = data.items || [];
        mdRenderSummary();
        mdRenderList();
    } catch (e) {
        console.error(e);
        notify(t("masterdata.officer.networkError"), "error");
    }
}

// ========================================
// LIST STATE — search, filters, sort and the quick-filter tile, kept
// for the session so coming back to the page shows the same list.
// ========================================
const MD_POSITIONS = [
    'Branch Manager "A"', 'Branch Manager "B"', 'Branch Manager "C"',
    'Branch Credit Manager "A"', 'Branch Credit Manager "B"', 'Assistant Branch Credit Manager "A"',
    'Financial Service Relation Manager "A"', 'Financial Service Relation Manager "B"', 'Financial Service Relation Manager "C"',
    "Credit Officer", "Financial Service Relation Officer", "Loan Recovery Officer"
];
const MD_STATE_KEY = "md_officer_state";
const MD_STATE_DEFAULT = { q: "", status: "", position: "", team: "", branch: "", sort: "name_asc", quick: "" };
let mdState = { ...MD_STATE_DEFAULT };
try { mdState = { ...MD_STATE_DEFAULT, ...JSON.parse(sessionStorage.getItem(MD_STATE_KEY) || "{}") }; } catch (e) {}

function mdSaveState() {
    try { sessionStorage.setItem(MD_STATE_KEY, JSON.stringify(mdState)); } catch (e) {}
}

const mdIsStopped = o => (o.branch || "").trim().toLowerCase() === "stop disburse";
const mdPositionRank = o => {
    const i = MD_POSITIONS.indexOf(o.position || "");
    return i < 0 ? MD_POSITIONS.length : i;
};
// Officer IDs are numbers in the sheet ("1461", "13099"): compare as
// numbers so 1461 sorts before 13099.
const mdIdCompare = (a, b) => {
    const x = Number(a.officerId), y = Number(b.officerId);
    if (Number.isFinite(x) && Number.isFinite(y) && x !== y) return x - y;
    return String(a.officerId || "").localeCompare(String(b.officerId || ""));
};
const mdNameCompare = (a, b) => (a.name || "").localeCompare(b.name || "");

const MD_SORTS = {
    name_asc: { key: "masterdata.officer.sortNameAsc", fn: mdNameCompare },
    name_desc: { key: "masterdata.officer.sortNameDesc", fn: (a, b) => mdNameCompare(b, a) },
    id_asc: { key: "masterdata.officer.sortIdAsc", fn: mdIdCompare },
    id_desc: { key: "masterdata.officer.sortIdDesc", fn: (a, b) => mdIdCompare(b, a) },
    position: { key: "masterdata.officer.sortPosition", fn: (a, b) => mdPositionRank(a) - mdPositionRank(b) || mdNameCompare(a, b) },
    branch: { key: "masterdata.officer.sortBranch", fn: (a, b) => (a.branch || "").localeCompare(b.branch || "") || mdNameCompare(a, b) },
    team: { key: "masterdata.officer.sortTeam", fn: (a, b) => (a.team || "").localeCompare(b.team || "") || mdNameCompare(a, b) }
};

// ========================================
// SUMMARY — counted from each officer's Position, active officers only
// (anyone moved to "Stop Disburse" is left out): Total = active
// officers with a position, CO = "Credit Officer", FSRO = "Financial
// Service Relation Officer". Each tile is also a quick filter.
// ========================================
const MD_QUICK = {
    all: o => (o.position || "").trim() && !mdIsStopped(o),
    co: o => o.position === "Credit Officer" && !mdIsStopped(o),
    fsro: o => o.position === "Financial Service Relation Officer" && !mdIsStopped(o)
};

function mdRenderSummary() {
    document.getElementById("mdSummaryTotal").textContent = mdOfficers.filter(MD_QUICK.all).length;
    document.getElementById("mdSummaryCO").textContent = mdOfficers.filter(MD_QUICK.co).length;
    document.getElementById("mdSummaryFSRO").textContent = mdOfficers.filter(MD_QUICK.fsro).length;
    document.querySelectorAll(".md-summary-tile").forEach(tile => {
        tile.classList.toggle("active", tile.dataset.quick === mdState.quick);
        tile.setAttribute("aria-pressed", tile.dataset.quick === mdState.quick ? "true" : "false");
    });
}

// ========================================
// SEARCH + FILTER + SORT
// ========================================
function mdNormalize(text) {
    return String(text == null ? "" : text).toLowerCase().replace(/\s+/g, " ").trim();
}

function mdFilteredOfficers() {
    const words = mdNormalize(mdState.q).split(" ").filter(Boolean);
    const quick = MD_QUICK[mdState.quick];
    const list = mdOfficers.filter(o => {
        if (quick && !quick(o)) return false;
        if (mdState.status === "active" && mdIsStopped(o)) return false;
        if (mdState.status === "stop" && !mdIsStopped(o)) return false;
        if (mdState.position === "__none__" ? (o.position || "") : (mdState.position && o.position !== mdState.position)) return false;
        if (mdState.team === "__blank__" ? (o.team || "") : (mdState.team && o.team !== mdState.team)) return false;
        if (mdState.branch && o.branch !== mdState.branch) return false;
        if (words.length) {
            // Every word must appear somewhere: "sok 9027" finds Sok Dara (9027).
            const hay = mdNormalize(`${o.officerId} ${o.name} ${o.nameKh || ""} ${o.position || ""} ${o.phone || ""} ${o.team || ""} ${o.branch || ""}`);
            const digits = hay.replace(/[\s-]/g, "");
            if (!words.every(w => hay.includes(w) || digits.includes(w.replace(/[\s-]/g, "")))) return false;
        }
        return true;
    });
    return list.sort((MD_SORTS[mdState.sort] || MD_SORTS.name_asc).fn);
}

function mdActiveFilters() {
    const out = [];
    if (mdState.quick) out.push({ field: "quick", label: t(`masterdata.officer.summary${{ all: "Total", co: "CO", fsro: "FSRO" }[mdState.quick]}`) });
    if (mdState.status) out.push({ field: "status", label: t(mdState.status === "active" ? "masterdata.officer.statusActive" : "masterdata.officer.statusStop") });
    if (mdState.position) out.push({ field: "position", label: mdState.position === "__none__" ? t("masterdata.officer.noPosition") : mdState.position });
    if (mdState.team) out.push({ field: "team", label: `${t("masterdata.officer.colTeam")}: ${mdState.team === "__blank__" ? t("masterdata.officer.blank") : mdState.team}` });
    if (mdState.branch) out.push({ field: "branch", label: mdState.branch });
    return out;
}

function mdRenderToolbar(shown) {
    const filters = mdActiveFilters();
    const sheetCount = filters.filter(f => f.field !== "quick").length;
    const countEl = document.getElementById("mdFilterCount");
    countEl.hidden = !sheetCount;
    countEl.textContent = sheetCount;
    document.getElementById("mdFilterBtn").classList.toggle("on", sheetCount > 0);
    document.getElementById("mdSortLabel").textContent = t((MD_SORTS[mdState.sort] || MD_SORTS.name_asc).key);

    document.getElementById("mdChips").innerHTML = filters.map(f => `
        <button type="button" class="md-chip" data-field="${f.field}">
            <span>${mdEscapeHtml(f.label)}</span><span class="md-chip-x" aria-hidden="true">&times;</span>
        </button>`).join("");

    document.getElementById("mdResultCount").textContent =
        t("masterdata.officer.resultCount", { shown, total: mdOfficers.length });
    document.getElementById("mdClearFilterBtn").hidden = !(filters.length || mdState.q);
}

// ========================================
// RENDER LIST
// ========================================
function mdRenderList() {
    const list = document.getElementById("mdList");
    const rows = mdFilteredOfficers();
    mdRenderToolbar(rows.length);
    mdRenderSummary();

    if (!rows.length) {
        list.innerHTML = `
            <div class="md-empty">
                <div class="md-empty-ico" aria-hidden="true">🔍</div>
                <div>${t("masterdata.officer.noData")}</div>
                ${mdActiveFilters().length || mdState.q ? `<button type="button" class="md-link-btn" data-clear-all>${t("masterdata.officer.clearAll")}</button>` : ""}
            </div>`;
        return;
    }

    if (mdViewMode === "list") {
        mdRenderTable(list, rows);
    } else {
        mdRenderCards(list, rows);
    }
}

// Marks the search words inside already-escaped text.
function mdHighlight(text) {
    const safe = mdEscapeHtml(text);
    const words = mdNormalize(mdState.q).split(" ").filter(w => w.length >= 2);
    if (!words.length || !safe) return safe;
    const rx = new RegExp(`(${words.map(w => mdEscapeHtml(w).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
    return safe.replace(rx, "<mark>$1</mark>");
}

function mdInitials(name) {
    const parts = String(name || "?").trim().split(/\s+/);
    return ((parts[0] || "?")[0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

// Position group drives the avatar / badge colour.
function mdPositionGroup(position) {
    if (!position) return "none";
    if (/Manager/.test(position)) return "mgr";
    if (position === "Credit Officer") return "co";
    if (position === "Financial Service Relation Officer") return "fsro";
    return "other";
}

function mdPhoneLinks(phone) {
    const raw = String(phone || "").trim();
    if (!raw || raw === "/" || raw === "-") return `<span class="md-muted">-</span>`;
    return raw.split(/[\/,;]+/).map(p => p.trim()).filter(Boolean).map(p => {
        const tel = p.replace(/[^\d+]/g, "");
        return tel.length >= 6
            ? `<a class="md-phone" href="tel:${tel}">${mdHighlight(p)}</a>`
            : `<span>${mdHighlight(p)}</span>`;
    }).join(" ");
}

function mdActionButtons() {
    if (!mdIsAdmin) return "";
    return `
        <div class="md-row-actions">
            <button type="button" class="md-icon-btn md-edit-btn" aria-label="${t("masterdata.officer.editBtn")}"><span class="ui-ico ui-ico-edit" aria-hidden="true"></span></button>
            <button type="button" class="md-icon-btn md-danger md-delete-btn" aria-label="${t("masterdata.officer.deleteBtn")}"><span class="ui-ico ui-ico-trash" aria-hidden="true"></span></button>
        </div>`;
}

function mdRenderCards(list, rows) {
    list.innerHTML = rows.map(o => {
        const stopped = mdIsStopped(o);
        const group = mdPositionGroup(o.position);
        return `
        <div class="md-row-card${stopped ? " md-stopped" : ""}" data-id="${mdEscapeHtml(o.officerId)}">
            <div class="md-row-top">
                <div class="md-avatar md-pos-${group}" aria-hidden="true">${mdEscapeHtml(mdInitials(o.name))}</div>
                <div class="md-row-main">
                    <div class="md-row-name">${mdHighlight(o.name) || "-"}</div>
                    ${o.nameKh ? `<div class="md-row-kh">${mdHighlight(o.nameKh)}</div>` : ""}
                    <div class="md-row-badges">
                        <span class="md-id-badge">ID ${mdHighlight(o.officerId) || "-"}</span>
                        ${o.position
                            ? `<span class="md-pos-badge md-pos-${group}">${mdHighlight(o.position)}</span>`
                            : `<span class="md-pos-badge md-pos-none">${t("masterdata.officer.noPosition")}</span>`}
                    </div>
                </div>
                ${mdActionButtons()}
            </div>
            <div class="md-row-meta">
                <span class="md-meta"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 21V8l8-5 8 5v13M9 21v-6h6v6"/></svg><span class="md-meta-k">${t("masterdata.officer.colBranch")}</span><span class="md-meta-v">${stopped
                    ? `<span class="md-stop-badge">Stop Disburse</span>`
                    : (mdHighlight(o.branch) || "-")}</span></span>
                <span class="md-meta"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6.5 6.5 0 0 1 3.5 5.5"/></svg><span class="md-meta-k">${t("masterdata.officer.colTeam")}</span><span class="md-meta-v">${mdHighlight(o.team) || "-"}</span></span>
                <span class="md-meta"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2"/></svg><span class="md-meta-v">${mdPhoneLinks(o.phone)}</span></span>
            </div>
        </div>`;
    }).join("");
}

const MD_TABLE_COLS = [
    { key: "officerId", label: "masterdata.officer.colId", sort: "id" },
    { key: "name", label: "masterdata.officer.colName", sort: "name" },
    { key: "nameKh", label: "masterdata.officer.colNameKh" },
    { key: "position", label: "masterdata.officer.colPosition", sort: "position" },
    { key: "phone", label: "masterdata.officer.colPhone" },
    { key: "team", label: "masterdata.officer.colTeam", sort: "team" },
    { key: "branch", label: "masterdata.officer.colBranch", sort: "branch" }
];

function mdRenderTable(list, rows) {
    const arrow = col => {
        if (!col.sort) return "";
        if (mdState.sort === `${col.sort}_asc` || mdState.sort === col.sort) return " ▲";
        if (mdState.sort === `${col.sort}_desc`) return " ▼";
        return "";
    };
    const bodyRows = rows.map(o => `
        <tr data-id="${mdEscapeHtml(o.officerId)}"${mdIsStopped(o) ? ' class="md-stopped"' : ""}>
            <td>${mdHighlight(o.officerId) || "-"}</td>
            <td class="md-td-strong">${mdHighlight(o.name) || "-"}</td>
            <td>${mdHighlight(o.nameKh) || "-"}</td>
            <td>${o.position ? `<span class="md-pos-badge md-pos-${mdPositionGroup(o.position)}">${mdHighlight(o.position)}</span>` : "-"}</td>
            <td>${mdPhoneLinks(o.phone)}</td>
            <td>${mdHighlight(o.team) || "-"}</td>
            <td>${mdIsStopped(o) ? `<span class="md-stop-badge">Stop Disburse</span>` : (mdHighlight(o.branch) || "-")}</td>
            ${mdIsAdmin ? `<td>${mdActionButtons().replace("md-row-actions", "md-table-actions")}</td>` : ""}
        </tr>
    `).join("");

    list.innerHTML = `
        <div class="md-table-wrap">
        <table class="md-table">
        <thead>
        <tr>
            ${MD_TABLE_COLS.map(c => c.sort
                ? `<th><button type="button" class="md-th-sort" data-sort="${c.sort}">${t(c.label)}${arrow(c)}</button></th>`
                : `<th>${t(c.label)}</th>`).join("")}
            ${mdIsAdmin ? `<th>${t("masterdata.officer.colActions")}</th>` : ""}
        </tr>
        </thead>
        <tbody>${bodyRows}</tbody>
        </table>
        </div>
    `;
}

// Tapping a table header: name / ID toggle A-Z ↔ Z-A; position, team
// and branch sort one way (their natural order).
function mdSortByColumn(col) {
    if (col === "name" || col === "id") {
        mdState.sort = mdState.sort === `${col}_asc` ? `${col}_desc` : `${col}_asc`;
    } else {
        mdState.sort = col;
    }
    mdSaveState();
    mdRenderList();
}

// ========================================
// FILTER / SORT SHEETS
// ========================================
function mdOpenSheet(id) {
    const el = document.getElementById(id);
    el.hidden = false;
    requestAnimationFrame(() => el.classList.add("show"));
}

function mdCloseSheet(id) {
    const el = document.getElementById(id);
    el.classList.remove("show");
    setTimeout(() => { el.hidden = true; }, 180);
}

function mdUniqueValues(field) {
    return [...new Set(mdOfficers.map(o => (o[field] || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function mdFillSelect(id, allKey, values, current, extra = []) {
    const sel = document.getElementById(id);
    sel.innerHTML = `<option value="">${t(allKey)}</option>` +
        values.map(v => `<option value="${mdEscapeHtml(v)}">${mdEscapeHtml(v)}</option>`).join("") +
        extra.map(([v, label]) => `<option value="${v}">${mdEscapeHtml(label)}</option>`).join("");
    sel.value = current || "";
}

let mdSheetStatus = "";

function mdSetSegStatus(value) {
    mdSheetStatus = value;
    document.querySelectorAll("#mdFilterStatus button").forEach(b => b.classList.toggle("on", b.dataset.value === value));
}

function mdOpenFilterSheet() {
    mdSetSegStatus(mdState.status);
    mdFillSelect("mdFilterPosition", "masterdata.officer.allPositions", MD_POSITIONS, mdState.position, [["__none__", t("masterdata.officer.noPosition")]]);
    mdFillSelect("mdFilterTeam", "masterdata.officer.allTeams", mdUniqueValues("team"), mdState.team, [["__blank__", t("masterdata.officer.blank")]]);
    mdFillSelect("mdFilterBranch", "masterdata.officer.allBranches", mdUniqueValues("branch"), mdState.branch);
    mdOpenSheet("mdFilterSheet");
}

function mdApplyFilterSheet() {
    mdState.status = mdSheetStatus;
    mdState.position = document.getElementById("mdFilterPosition").value;
    mdState.team = document.getElementById("mdFilterTeam").value;
    mdState.branch = document.getElementById("mdFilterBranch").value;
    mdSaveState();
    mdCloseSheet("mdFilterSheet");
    mdRenderList();
}

function mdOpenSortSheet() {
    document.getElementById("mdSortList").innerHTML = Object.entries(MD_SORTS).map(([value, s]) => `
        <button type="button" class="md-sort-opt${value === mdState.sort ? " on" : ""}" data-sort-value="${value}">
            <span>${t(s.key)}</span><span class="md-sort-check" aria-hidden="true">${value === mdState.sort ? "✓" : ""}</span>
        </button>`).join("");
    mdOpenSheet("mdSortSheet");
}

function mdClearAll() {
    const sort = mdState.sort;
    mdState = { ...MD_STATE_DEFAULT, sort };
    document.getElementById("mdSearchInput").value = "";
    mdUpdateSearchClearVisibility();
    mdSaveState();
    mdRenderList();
}

// ========================================
// EXPORT — the list exactly as filtered and sorted on screen.
// SheetJS / html2canvas / jsPDF are loaded only when first used.
// ========================================
const MD_LIBS = {
    xlsx: "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js",
    html2canvas: "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js",
    jspdf: "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"
};
const mdLibPromises = {};

function mdLoadLib(name) {
    if (!mdLibPromises[name]) {
        mdLibPromises[name] = new Promise((resolve, reject) => {
            const s = document.createElement("script");
            s.src = MD_LIBS[name];
            s.onload = resolve;
            s.onerror = () => { delete mdLibPromises[name]; reject(new Error(`${name} failed to load`)); };
            document.head.appendChild(s);
        });
    }
    return mdLibPromises[name];
}

function mdExportStamp() {
    const d = new Date();
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

function mdExportRows() {
    return mdFilteredOfficers().map((o, i) => ({
        no: i + 1,
        officerId: o.officerId || "",
        name: o.name || "",
        nameKh: o.nameKh || "",
        position: o.position || "",
        phone: o.phone || "",
        team: o.team || "",
        branch: o.branch || ""
    }));
}

function mdExportHeaders() {
    return ["No.", t("masterdata.officer.colId"), t("masterdata.officer.colName"), t("masterdata.officer.colNameKh"),
        t("masterdata.officer.colPosition"), t("masterdata.officer.colPhone"), t("masterdata.officer.colTeam"), t("masterdata.officer.colBranch")];
}

async function mdExportExcel() {
    mdCloseMenu();
    const rows = mdExportRows();
    if (!rows.length) return notify(t("masterdata.officer.nothingToExport"), "warning");
    try {
        if (typeof showAppLoading === "function") showAppLoading(t("masterdata.officer.exporting"));
        await mdLoadLib("xlsx");
        const aoa = [mdExportHeaders(), ...rows.map(r => [r.no, r.officerId, r.name, r.nameKh, r.position, r.phone, r.team, r.branch])];
        const ws = XLSX.utils.aoa_to_sheet(aoa);
        ws["!cols"] = [{ wch: 5 }, { wch: 11 }, { wch: 24 }, { wch: 22 }, { wch: 34 }, { wch: 22 }, { wch: 18 }, { wch: 14 }];
        ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: 7 } }) };
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Officers");
        XLSX.writeFile(wb, `ListOfficer_${mdExportStamp()}.xlsx`);
    } catch (e) {
        console.error("[officer export excel]", e);
        notify(t("masterdata.officer.exportFailed"), "error");
    } finally {
        if (typeof hideAppLoading === "function") hideAppLoading();
    }
}

// Builds an off-screen, always-light A4 table (so Khmer names render
// with the app font — jsPDF's own text can't shape Khmer), snapshots it
// with html2canvas and slices it into pages at row boundaries.
async function mdExportPdf() {
    mdCloseMenu();
    const rows = mdExportRows();
    if (!rows.length) return notify(t("masterdata.officer.nothingToExport"), "warning");

    const filters = mdActiveFilters().map(f => f.label);
    if (mdState.q) filters.unshift(`"${mdState.q}"`);
    const holder = document.createElement("div");
    holder.className = "md-print";
    holder.innerHTML = `
        <div class="md-print-head">
            <div class="md-print-title">${mdEscapeHtml(t("masterdata.officer.title"))}</div>
            <div class="md-print-sub">${mdEscapeHtml(new Date().toLocaleString())} · ${mdEscapeHtml(t("masterdata.officer.resultCount", { shown: rows.length, total: mdOfficers.length }))}${filters.length ? ` · ${mdEscapeHtml(filters.join(", "))}` : ""}</div>
        </div>
        <table class="md-print-table">
            <thead><tr>${mdExportHeaders().map(h => `<th>${mdEscapeHtml(h)}</th>`).join("")}</tr></thead>
            <tbody>${rows.map(r => `<tr>${[r.no, r.officerId, r.name, r.nameKh, r.position, r.phone, r.team, r.branch].map(v => `<td>${mdEscapeHtml(v)}</td>`).join("")}</tr>`).join("")}</tbody>
        </table>`;
    document.body.appendChild(holder);

    try {
        if (typeof showAppLoading === "function") showAppLoading(t("masterdata.officer.generatingPdf"));
        await Promise.all([mdLoadLib("html2canvas"), mdLoadLib("jspdf")]);
        if (document.fonts && document.fonts.ready) await document.fonts.ready;

        const SCALE = 2;
        const full = await html2canvas(holder, { scale: SCALE, backgroundColor: "#ffffff" });
        const thead = holder.querySelector("thead");
        const headCanvas = await html2canvas(thead, { scale: SCALE, backgroundColor: "#ffffff" });
        const hRect = holder.getBoundingClientRect();
        const bounds = [...holder.querySelectorAll("tbody tr")].map(tr => (tr.getBoundingClientRect().bottom - hRect.top) * SCALE);

        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
        const pageW = 297, pageH = 210, margin = 8;
        const usableW = pageW - margin * 2, usableH = pageH - margin * 2;
        const sliceH = full.width * (usableH / usableW);
        const headH = headCanvas.height;

        let start = 0, first = true, page = 0;
        while (start < full.height - 2) {
            const avail = first ? sliceH : sliceH - headH;
            const end = start + avail;
            let cut = end;
            for (const b of bounds) if (b > start && b <= end) cut = b;
            if (cut <= start) cut = Math.min(end, full.height);
            cut = Math.min(cut, full.height);

            const canvas = document.createElement("canvas");
            canvas.width = full.width;
            canvas.height = (cut - start) + (first ? 0 : headH);
            const ctx = canvas.getContext("2d");
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            let y = 0;
            if (!first) { ctx.drawImage(headCanvas, 0, 0); y = headH; }
            ctx.drawImage(full, 0, start, full.width, cut - start, 0, y, full.width, cut - start);

            if (page > 0) pdf.addPage();
            pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", margin, margin, usableW, usableW * (canvas.height / canvas.width));
            pdf.setFontSize(8);
            pdf.setTextColor(140);
            pdf.text(String(page + 1), pageW - margin, pageH - 3, { align: "right" });

            start = cut;
            first = false;
            page++;
        }
        pdf.save(`ListOfficer_${mdExportStamp()}.pdf`);
    } catch (e) {
        console.error("[officer export pdf]", e);
        notify(t("masterdata.officer.exportFailed"), "error");
    } finally {
        holder.remove();
        if (typeof hideAppLoading === "function") hideAppLoading();
    }
}

// ⋮ menu
function mdCloseMenu() {
    document.getElementById("mdMenu").classList.remove("show");
    document.getElementById("mdMenuBtn").setAttribute("aria-expanded", "false");
}

// ========================================
// ADD / EDIT DIALOG
// ========================================
function mdOpenDialog(officer) {
    mdEditingId = officer ? officer.officerId : null;
    document.getElementById("mdDialogTitle").textContent =
        officer ? t("masterdata.officer.modalEditTitle") : t("masterdata.officer.modalAddTitle");

    document.getElementById("mdFieldId").value = officer ? officer.officerId : "";
    document.getElementById("mdFieldId").disabled = !!officer;
    document.getElementById("mdFieldName").value = officer ? officer.name : "";
    document.getElementById("mdFieldNameKh").value = officer ? (officer.nameKh || "") : "";
    document.getElementById("mdFieldPosition").value = officer ? (officer.position || "") : "";
    document.getElementById("mdFieldPhone").value = officer ? (officer.phone || "") : "";
    document.getElementById("mdFieldTeam").value = officer ? (officer.team || "") : "";
    document.getElementById("mdFieldBranch").value = officer ? (officer.branch || "") : "";

    document.getElementById("mdOfficerDialog").classList.add("show");
}

function mdCloseDialog() {
    document.getElementById("mdOfficerDialog").classList.remove("show");
    mdEditingId = null;
}

async function mdSaveOfficer() {
    const officerId = document.getElementById("mdFieldId").value.trim();
    const name = document.getElementById("mdFieldName").value.trim();
    const nameKh = document.getElementById("mdFieldNameKh").value.trim();
    const position = document.getElementById("mdFieldPosition").value;
    const phone = document.getElementById("mdFieldPhone").value.trim();
    const team = document.getElementById("mdFieldTeam").value;
    const branch = document.getElementById("mdFieldBranch").value;

    if (!officerId) return notify(t("masterdata.officer.idRequired"), "warning");
    if (!name) return notify(t("masterdata.officer.nameRequired"), "warning");

    try {
        const data = await API.post("/api/creditofficer/upsert", { officerId, name, nameKh, position, phone, team, branch });
        if (!data.ok) {
            notify(data.message || t("masterdata.officer.saveFailed"), "error");
            return;
        }
        notify(t("masterdata.officer.saveSuccess"), "success");
        mdCloseDialog();
        mdLoadOfficers();
    } catch (e) {
        console.error(e);
        notify(t("masterdata.officer.networkError"), "error");
    }
}

// ========================================
// DELETE DIALOG
// ========================================
let mdDeletingId = null;

function mdOpenDeleteDialog(officer) {
    mdDeletingId = officer.officerId;
    document.getElementById("mdDeleteBody").textContent =
        t("masterdata.officer.deleteConfirmBody", { name: officer.name || officer.officerId });
    document.getElementById("mdDeleteDialog").classList.add("show");
}

function mdCloseDeleteDialog() {
    document.getElementById("mdDeleteDialog").classList.remove("show");
    mdDeletingId = null;
}

async function mdConfirmDelete() {
    if (!mdDeletingId) return;
    try {
        const res = await fetch(`${API.BASE_URL}/api/creditofficer/${encodeURIComponent(mdDeletingId)}`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${API.getToken()}` }
        });
        const data = await res.json();
        if (!data.ok) {
            notify(data.message || t("masterdata.officer.deleteFailed"), "error");
            return;
        }
        notify(t("masterdata.officer.deleteSuccess"), "success");
        mdCloseDeleteDialog();
        mdLoadOfficers();
    } catch (e) {
        console.error(e);
        notify(t("masterdata.officer.networkError"), "error");
    }
}

// ========================================
// EVENTS
// ========================================
const mdSearchInput = document.getElementById("mdSearchInput");
const mdSearchClearBtn = document.getElementById("mdSearchClear");

function mdUpdateSearchClearVisibility() {
    mdSearchClearBtn.hidden = !mdSearchInput.value;
}

let mdSearchTimer = null;
mdSearchInput.value = mdState.q;
mdUpdateSearchClearVisibility();
mdSearchInput.addEventListener("input", () => {
    mdUpdateSearchClearVisibility();
    clearTimeout(mdSearchTimer);
    mdSearchTimer = setTimeout(() => {
        mdState.q = mdSearchInput.value;
        mdSaveState();
        mdRenderList();
    }, 120);
});
mdSearchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") mdSearchInput.blur();
});
mdSearchClearBtn.addEventListener("click", () => {
    mdSearchInput.value = "";
    mdState.q = "";
    mdSaveState();
    mdUpdateSearchClearVisibility();
    mdRenderList();
    mdSearchInput.focus();
});

document.getElementById("mdSummaryRow").addEventListener("click", (e) => {
    const tile = e.target.closest(".md-summary-tile");
    if (!tile) return;
    mdState.quick = mdState.quick === tile.dataset.quick ? "" : tile.dataset.quick;
    mdSaveState();
    mdRenderList();
});

document.getElementById("mdChips").addEventListener("click", (e) => {
    const chip = e.target.closest(".md-chip");
    if (!chip) return;
    mdState[chip.dataset.field] = "";
    mdSaveState();
    mdRenderList();
});
document.getElementById("mdClearFilterBtn").addEventListener("click", mdClearAll);

document.getElementById("mdFilterBtn").addEventListener("click", mdOpenFilterSheet);
document.getElementById("mdSortBtn").addEventListener("click", mdOpenSortSheet);
document.getElementById("mdFilterStatus").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-value]");
    if (b) mdSetSegStatus(b.dataset.value);
});
document.getElementById("mdFilterApply").addEventListener("click", mdApplyFilterSheet);
document.getElementById("mdFilterReset").addEventListener("click", () => {
    mdSetSegStatus("");
    ["mdFilterPosition", "mdFilterTeam", "mdFilterBranch"].forEach(id => { document.getElementById(id).value = ""; });
});
document.getElementById("mdSortList").addEventListener("click", (e) => {
    const opt = e.target.closest("[data-sort-value]");
    if (!opt) return;
    mdState.sort = opt.dataset.sortValue;
    mdSaveState();
    mdCloseSheet("mdSortSheet");
    mdRenderList();
});
["mdFilterSheet", "mdSortSheet"].forEach(id => {
    document.getElementById(id).addEventListener("click", (e) => {
        if (e.target.id === id || e.target.closest("[data-close]")) mdCloseSheet(id);
    });
});
document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    mdCloseMenu();
    ["mdFilterSheet", "mdSortSheet"].forEach(id => { if (!document.getElementById(id).hidden) mdCloseSheet(id); });
});

// ⋮ menu
document.getElementById("mdMenuBtn").addEventListener("click", (e) => {
    e.stopPropagation();
    const menu = document.getElementById("mdMenu");
    const open = !menu.classList.contains("show");
    menu.classList.toggle("show", open);
    e.currentTarget.setAttribute("aria-expanded", open ? "true" : "false");
});
document.addEventListener("click", (e) => {
    if (!e.target.closest("#mdMenuWrap")) mdCloseMenu();
});
document.getElementById("mdExportExcel").addEventListener("click", mdExportExcel);
document.getElementById("mdExportPdf").addEventListener("click", mdExportPdf);

function mdApplyViewModeButtons() {
    document.getElementById("mdViewCardBtn").classList.toggle("active", mdViewMode === "card");
    document.getElementById("mdViewListBtn").classList.toggle("active", mdViewMode === "list");
}
function mdSetViewMode(mode) {
    mdViewMode = mode;
    localStorage.setItem("md_officer_view", mode);
    mdApplyViewModeButtons();
    mdRenderList();
}
document.getElementById("mdViewCardBtn").addEventListener("click", () => mdSetViewMode("card"));
document.getElementById("mdViewListBtn").addEventListener("click", () => mdSetViewMode("list"));
mdApplyViewModeButtons();

document.getElementById("btnMdAdd").addEventListener("click", () => mdOpenDialog(null));
document.getElementById("btnMdSave").addEventListener("click", mdSaveOfficer);
document.getElementById("btnMdCancel").addEventListener("click", mdCloseDialog);
document.getElementById("mdOfficerDialog").addEventListener("click", (e) => {
    if (e.target.id === "mdOfficerDialog") mdCloseDialog();
});

document.getElementById("btnMdConfirmDelete").addEventListener("click", mdConfirmDelete);
document.getElementById("btnMdCancelDelete").addEventListener("click", mdCloseDeleteDialog);
document.getElementById("mdDeleteDialog").addEventListener("click", (e) => {
    if (e.target.id === "mdDeleteDialog") mdCloseDeleteDialog();
});

// Event delegation for row edit/delete buttons (rows are re-rendered
// wholesale on every search/filter, so binding once here instead of
// per-row avoids rebinding listeners after every render). Matches
// both the card view's .md-row-card divs and the table view's <tr>s.
document.getElementById("mdList").addEventListener("click", (e) => {
    if (e.target.closest("[data-clear-all]")) return mdClearAll();
    const th = e.target.closest(".md-th-sort");
    if (th) return mdSortByColumn(th.dataset.sort);
    const card = e.target.closest("[data-id]");
    if (!card) return;
    const officerId = card.dataset.id;
    const officer = mdOfficers.find(o => o.officerId === officerId);
    if (!officer) return;

    if (e.target.closest(".md-edit-btn")) {
        mdOpenDialog(officer);
    } else if (e.target.closest(".md-delete-btn")) {
        mdOpenDeleteDialog(officer);
    }
});

// ========================================
// COMPONENT LOADER (topbar + bottomnav)
// ========================================
let mdLoaded = 0;
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
                titleKey: "masterdata.officer.title",
                showBack: true,
                showLogo: false,
                showProfile: false
            });
            // ⋮ menu lives in the topbar's right side, like the Credit
            // Report pages; moved (not rebuilt) so its handlers stay wired.
            const menuWrap = document.getElementById("mdMenuWrap");
            const topbarRight = document.querySelector("#topbar-container .topbar-right");
            if (menuWrap && topbarRight) topbarRight.insertBefore(menuWrap, topbarRight.firstChild);
        }
    } catch (error) {
        console.error(error);
    } finally {
        mdLoaded++;
        if (mdLoaded >= 2) {
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

// ========================================
// START
// ========================================
if (mdIsAdmin) {
    document.getElementById("mdAddRow").style.display = "block";
}
mdLoadOfficers();
