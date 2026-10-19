// ========================================
// List Location — pages/masterdata/location.html
// Reads/writes GET /api/address/list, POST /api/address/upsert,
// DELETE /api/address/:id. Unlike List Officer (keyed by officerId),
// a location row has no natural business key, so it's keyed on the
// Mongo _id (returned as "id") instead — see the backend comment on
// these endpoints for why. Add/Edit/Delete are admin-only — matches
// the backend's own isAdmin() gate, so this is UX convenience, not
// the real guard.
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

let mdLocations = [];     // full list from the server, unfiltered
let mdEditingId = null;   // location id currently being edited, or null for "add"
let mdViewMode = localStorage.getItem("md_location_view") === "list" ? "list" : "card";

function mdEscapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text == null ? "" : String(text);
    return div.innerHTML;
}

// ========================================
// LOAD
// ========================================
async function mdLoadLocations() {
    try {
        const data = await API.get("/api/address/list");
        if (!data.ok) {
            notify(data.message || t("masterdata.location.loadFailed"), "error");
            return;
        }
        mdLocations = data.items || [];
        mdRenderSummary();
        mdRenderList();
    } catch (e) {
        console.error(e);
        notify(t("masterdata.location.networkError"), "error");
    }
}

// ========================================
// LIST STATE — search, filters and sort, kept for the session so
// coming back to the page shows the same list.
// ========================================
const MD_STATE_KEY = "md_location_state";
const MD_STATE_DEFAULT = { q: "", district: "", commune: "", branch: "", officer: "", sort: "district_asc" };
let mdState = { ...MD_STATE_DEFAULT };
try { mdState = { ...MD_STATE_DEFAULT, ...JSON.parse(sessionStorage.getItem(MD_STATE_KEY) || "{}") }; } catch (e) {}

function mdSaveState() {
    try { sessionStorage.setItem(MD_STATE_KEY, JSON.stringify(mdState)); } catch (e) {}
}

// Cards render a page at a time — a whole province's villages at once
// is slow to lay out on a phone.
const MD_PAGE = 100;
let mdShown = MD_PAGE;

const mdFamily = l => parseInt(l.family, 10) || 0;
const mdCmp = (f) => (a, b) => (a[f] || "").localeCompare(b[f] || "");
const mdByPlace = (a, b) => mdCmp("district")(a, b) || mdCmp("commune")(a, b) || mdCmp("village")(a, b);

// group: the card view puts a header above each district (or commune).
const MD_SORTS = {
    district_asc: { key: "masterdata.location.sortDistrictAsc", fn: mdByPlace, group: "district" },
    district_desc: { key: "masterdata.location.sortDistrictDesc", fn: (a, b) => mdCmp("district")(b, a) || mdCmp("commune")(a, b) || mdCmp("village")(a, b), group: "district" },
    commune_asc: { key: "masterdata.location.sortCommuneAsc", fn: (a, b) => mdCmp("commune")(a, b) || mdCmp("village")(a, b), group: "commune" },
    village_asc: { key: "masterdata.location.sortVillageAsc", fn: (a, b) => mdCmp("village")(a, b) || mdByPlace(a, b) },
    village_desc: { key: "masterdata.location.sortVillageDesc", fn: (a, b) => mdCmp("village")(b, a) || mdByPlace(a, b) },
    family_desc: { key: "masterdata.location.sortFamilyDesc", fn: (a, b) => mdFamily(b) - mdFamily(a) || mdByPlace(a, b) },
    family_asc: { key: "masterdata.location.sortFamilyAsc", fn: (a, b) => mdFamily(a) - mdFamily(b) || mdByPlace(a, b) },
    branch: { key: "masterdata.location.sortBranch", fn: (a, b) => mdCmp("branch")(a, b) || mdByPlace(a, b) },
    officer: { key: "masterdata.location.sortOfficer", fn: (a, b) => mdCmp("officer")(a, b) || mdByPlace(a, b) }
};

function mdFmt(n) {
    return Number(n || 0).toLocaleString("en-US");
}

// ========================================
// SUMMARY — whole dataset
// ========================================
function mdRenderSummary() {
    document.getElementById("mdSummaryTotal").textContent = mdFmt(mdLocations.length);
    document.getElementById("mdSummaryFamily").textContent = mdFmt(mdLocations.reduce((sum, l) => sum + mdFamily(l), 0));
    document.getElementById("mdSummaryDistricts").textContent = new Set(mdLocations.map(l => l.district).filter(Boolean)).size;
    document.getElementById("mdSummaryCommunes").textContent = new Set(mdLocations.map(l => `${l.district}|${l.commune}`).filter(k => k !== "|")).size;
}

// ========================================
// SEARCH + FILTER + SORT
// ========================================
function mdNormalize(text) {
    return String(text == null ? "" : text).toLowerCase().replace(/\s+/g, " ").trim();
}

function mdFilteredLocations() {
    const words = mdNormalize(mdState.q).split(" ").filter(Boolean);
    return mdLocations.filter(l => {
        if (mdState.district && l.district !== mdState.district) return false;
        if (mdState.commune && l.commune !== mdState.commune) return false;
        if (mdState.branch && l.branch !== mdState.branch) return false;
        if (mdState.officer && l.officer !== mdState.officer) return false;
        if (words.length) {
            // Every word must appear somewhere: "rumduol kampong" etc.
            const hay = mdNormalize(`${l.village} ${l.commune} ${l.district} ${l.branch || ""} ${l.officer || ""}`);
            if (!words.every(w => hay.includes(w))) return false;
        }
        return true;
    }).sort((MD_SORTS[mdState.sort] || MD_SORTS.district_asc).fn);
}

function mdActiveFilters() {
    const out = [];
    if (mdState.district) out.push({ field: "district", label: `${t("masterdata.location.colDistrict")}: ${mdState.district}` });
    if (mdState.commune) out.push({ field: "commune", label: `${t("masterdata.location.colCommune")}: ${mdState.commune}` });
    if (mdState.branch) out.push({ field: "branch", label: mdState.branch });
    if (mdState.officer) out.push({ field: "officer", label: mdState.officer });
    return out;
}

function mdRenderToolbar(rows) {
    const filters = mdActiveFilters();
    const countEl = document.getElementById("mdFilterCount");
    countEl.hidden = !filters.length;
    countEl.textContent = filters.length;
    document.getElementById("mdFilterBtn").classList.toggle("on", filters.length > 0);
    document.getElementById("mdSortLabel").textContent = t((MD_SORTS[mdState.sort] || MD_SORTS.district_asc).key);

    document.getElementById("mdChips").innerHTML = filters.map(f => `
        <button type="button" class="md-chip" data-field="${f.field}">
            <span>${mdEscapeHtml(f.label)}</span><span class="md-chip-x" aria-hidden="true">&times;</span>
        </button>`).join("");

    const families = rows.reduce((sum, l) => sum + mdFamily(l), 0);
    document.getElementById("mdResultCount").innerHTML =
        `${mdEscapeHtml(t("masterdata.location.resultCount", { shown: mdFmt(rows.length), total: mdFmt(mdLocations.length) }))} · ` +
        `<span class="md-result-family">${mdEscapeHtml(t("masterdata.location.familyCount", { n: mdFmt(families) }))}</span>`;
    document.getElementById("mdClearFilterBtn").hidden = !(filters.length || mdState.q);
}

// ========================================
// RENDER LIST
// ========================================
function mdRenderList(keepPage) {
    if (!keepPage) mdShown = MD_PAGE;
    const list = document.getElementById("mdList");
    const rows = mdFilteredLocations();
    mdRenderToolbar(rows);

    if (!rows.length) {
        list.innerHTML = `
            <div class="md-empty">
                <div class="md-empty-ico" aria-hidden="true">📍</div>
                <div>${t("masterdata.location.noData")}</div>
                ${mdActiveFilters().length || mdState.q ? `<button type="button" class="md-link-btn" data-clear-all>${t("masterdata.location.clearAll")}</button>` : ""}
            </div>`;
        return;
    }

    if (mdViewMode === "list") {
        mdRenderTable(list, rows);
    } else {
        mdRenderCards(list, rows);
    }
}

function mdHighlight(text) {
    const safe = mdEscapeHtml(text);
    const words = mdNormalize(mdState.q).split(" ").filter(w => w.length >= 2);
    if (!words.length || !safe) return safe;
    const rx = new RegExp(`(${words.map(w => mdEscapeHtml(w).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
    return safe.replace(rx, "<mark>$1</mark>");
}

function mdActionButtons(cls) {
    if (!mdIsAdmin) return "";
    return `
        <div class="${cls}">
            <button type="button" class="md-icon-btn md-edit-btn" aria-label="${t("masterdata.location.editBtn")}"><span class="ui-ico ui-ico-edit" aria-hidden="true"></span></button>
            <button type="button" class="md-icon-btn md-danger md-delete-btn" aria-label="${t("masterdata.location.deleteBtn")}"><span class="ui-ico ui-ico-trash" aria-hidden="true"></span></button>
        </div>`;
}

const MD_PIN = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>`;
const MD_ICO_BRANCH = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 21V8l8-5 8 5v13M9 21v-6h6v6"/></svg>`;
const MD_ICO_OFFICER = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>`;

function mdCard(l) {
    return `
        <div class="md-row-card" data-id="${mdEscapeHtml(l.id)}">
            <div class="md-row-top">
                <div class="md-loc-ico">${MD_PIN}</div>
                <div class="md-row-main">
                    <div class="md-row-name">${mdHighlight(l.village) || "-"}</div>
                    <div class="md-crumb">${t("masterdata.location.colCommune")} <b>${mdHighlight(l.commune) || "-"}</b> · ${t("masterdata.location.colDistrict")} <b>${mdHighlight(l.district) || "-"}</b></div>
                </div>
                <div class="md-family-badge"><b>${mdFmt(mdFamily(l))}</b><span>${t("masterdata.location.colFamily")}</span></div>
            </div>
            <div class="md-row-meta md-row-meta-actions">
                <div class="md-meta-list">
                    <span class="md-meta">${MD_ICO_BRANCH}<span class="md-meta-k">${t("masterdata.location.colBranch")}</span><span class="md-meta-v">${mdHighlight(l.branch) || "-"}</span></span>
                    <span class="md-meta">${MD_ICO_OFFICER}<span class="md-meta-k">CO</span><span class="md-meta-v">${mdHighlight(l.officer) || "-"}</span></span>
                </div>
                ${mdActionButtons("md-row-actions")}
            </div>
        </div>`;
}

// Card view: a header above each district / commune with its village
// and family count (counted over the whole result, not just this page).
function mdRenderCards(list, rows) {
    const group = (MD_SORTS[mdState.sort] || {}).group;
    const totals = {};
    if (group) {
        for (const l of rows) {
            const k = l[group] || "-";
            totals[k] = totals[k] || { n: 0, fam: 0 };
            totals[k].n++;
            totals[k].fam += mdFamily(l);
        }
    }
    let html = "";
    let last = null;
    for (const l of rows.slice(0, mdShown)) {
        if (group && (l[group] || "-") !== last) {
            last = l[group] || "-";
            html += `
                <div class="md-group">
                    <span class="md-group-name">${t(group === "district" ? "masterdata.location.colDistrict" : "masterdata.location.colCommune")} ${mdHighlight(last)}</span>
                    <span class="md-group-meta">${t("masterdata.location.groupMeta", { n: mdFmt(totals[last].n), fam: mdFmt(totals[last].fam) })}</span>
                </div>`;
        }
        html += mdCard(l);
    }
    if (rows.length > mdShown) {
        html += `<button type="button" class="md-more" data-more>${t("masterdata.location.showMore", { n: mdFmt(Math.min(MD_PAGE, rows.length - mdShown)), left: mdFmt(rows.length - mdShown) })}</button>`;
    }
    list.innerHTML = html;
}

const MD_TABLE_COLS = [
    { key: "village", label: "masterdata.location.colVillage", sort: "village" },
    { key: "commune", label: "masterdata.location.colCommune", sort: "commune" },
    { key: "district", label: "masterdata.location.colDistrict", sort: "district" },
    { key: "family", label: "masterdata.location.colFamily", sort: "family", num: true },
    { key: "branch", label: "masterdata.location.colBranch", sort: "branch" },
    { key: "officer", label: "masterdata.location.colOfficer", sort: "officer" }
];

function mdRenderTable(list, rows) {
    const arrow = col => {
        if (mdState.sort === `${col.sort}_asc` || mdState.sort === col.sort) return " ▲";
        if (mdState.sort === `${col.sort}_desc`) return " ▼";
        return "";
    };
    const shown = rows.slice(0, Math.max(mdShown, 300));
    list.innerHTML = `
        <div class="md-table-wrap">
        <table class="md-table">
        <thead>
        <tr>
            ${MD_TABLE_COLS.map(c => `<th${c.num ? ' style="text-align:right"' : ""}><button type="button" class="md-th-sort" data-sort="${c.sort}">${t(c.label)}${arrow(c)}</button></th>`).join("")}
            ${mdIsAdmin ? `<th>${t("masterdata.location.colActions")}</th>` : ""}
        </tr>
        </thead>
        <tbody>${shown.map(l => `
            <tr data-id="${mdEscapeHtml(l.id)}">
                <td class="md-td-strong">${mdHighlight(l.village) || "-"}</td>
                <td>${mdHighlight(l.commune) || "-"}</td>
                <td>${mdHighlight(l.district) || "-"}</td>
                <td class="md-table-family">${mdFmt(mdFamily(l))}</td>
                <td>${mdHighlight(l.branch) || "-"}</td>
                <td>${mdHighlight(l.officer) || "-"}</td>
                ${mdIsAdmin ? `<td>${mdActionButtons("md-table-actions")}</td>` : ""}
            </tr>`).join("")}
        </tbody>
        </table>
        </div>
        ${rows.length > shown.length ? `<button type="button" class="md-more" data-more>${t("masterdata.location.showMore", { n: mdFmt(Math.min(300, rows.length - shown.length)), left: mdFmt(rows.length - shown.length) })}</button>` : ""}
    `;
}

// Table header tap: village / district toggle A-Z ↔ Z-A, family
// high ↔ low; the rest sort one way.
function mdSortByColumn(col) {
    if (col === "village" || col === "district") {
        mdState.sort = mdState.sort === `${col}_asc` ? `${col}_desc` : `${col}_asc`;
    } else if (col === "family") {
        mdState.sort = mdState.sort === "family_desc" ? "family_asc" : "family_desc";
    } else if (col === "commune") {
        mdState.sort = "commune_asc";
    } else {
        mdState.sort = col;
    }
    mdSaveState();
    mdRenderList();
}

// ========================================
// FILTER / SORT SHEETS — district narrows communes, branch narrows
// officers (inside the sheet, before Apply).
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

function mdUnique(rows, field) {
    return [...new Set(rows.map(l => (l[field] || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function mdFillSelect(id, allKey, values, current) {
    const sel = document.getElementById(id);
    sel.innerHTML = `<option value="">${t(allKey)}</option>` +
        values.map(v => `<option value="${mdEscapeHtml(v)}">${mdEscapeHtml(v)}</option>`).join("");
    sel.value = values.includes(current) ? current : "";
}

function mdFillCommunes(current) {
    const district = document.getElementById("mdFilterDistrict").value;
    const scoped = district ? mdLocations.filter(l => l.district === district) : mdLocations;
    mdFillSelect("mdFilterCommune", "masterdata.location.allCommunes", mdUnique(scoped, "commune"), current);
}

function mdFillOfficers(current) {
    const branch = document.getElementById("mdFilterBranch").value;
    const scoped = branch ? mdLocations.filter(l => l.branch === branch) : mdLocations;
    mdFillSelect("mdFilterOfficer", "masterdata.location.allOfficers", mdUnique(scoped, "officer"), current);
}

function mdOpenFilterSheet() {
    mdFillSelect("mdFilterDistrict", "masterdata.location.allDistricts", mdUnique(mdLocations, "district"), mdState.district);
    mdFillCommunes(mdState.commune);
    mdFillSelect("mdFilterBranch", "masterdata.location.allBranches", mdUnique(mdLocations, "branch"), mdState.branch);
    mdFillOfficers(mdState.officer);
    mdOpenSheet("mdFilterSheet");
}

function mdApplyFilterSheet() {
    ["district", "commune", "branch", "officer"].forEach(f => {
        mdState[f] = document.getElementById(`mdFilter${f[0].toUpperCase()}${f.slice(1)}`).value;
    });
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
    mdState = { ...MD_STATE_DEFAULT, sort: mdState.sort };
    document.getElementById("mdSearchInput").value = "";
    mdUpdateSearchClearVisibility();
    mdSaveState();
    mdRenderList();
}

// ========================================
// EXPORT — the list exactly as filtered and sorted on screen.
// SheetJS / html2canvas / jsPDF load only when first used.
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

function mdExportHeaders() {
    return ["No.", t("masterdata.location.colVillage"), t("masterdata.location.colCommune"), t("masterdata.location.colDistrict"),
        t("masterdata.location.colFamily"), t("masterdata.location.colBranch"), t("masterdata.location.colOfficer")];
}

function mdExportRows() {
    return mdFilteredLocations().map((l, i) => [i + 1, l.village || "", l.commune || "", l.district || "", mdFamily(l), l.branch || "", l.officer || ""]);
}

async function mdExportExcel() {
    mdCloseMenu();
    const rows = mdExportRows();
    if (!rows.length) return notify(t("masterdata.location.nothingToExport"), "warning");
    try {
        if (typeof showAppLoading === "function") showAppLoading(t("masterdata.location.exporting"));
        await mdLoadLib("xlsx");
        const total = rows.reduce((s, r) => s + r[4], 0);
        const ws = XLSX.utils.aoa_to_sheet([mdExportHeaders(), ...rows, ["", t("masterdata.location.total"), "", "", total, "", ""]]);
        ws["!cols"] = [{ wch: 6 }, { wch: 24 }, { wch: 20 }, { wch: 18 }, { wch: 10 }, { wch: 14 }, { wch: 22 }];
        ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: 6 } }) };
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Locations");
        XLSX.writeFile(wb, `ListLocation_${mdExportStamp()}.xlsx`);
    } catch (e) {
        console.error("[location export excel]", e);
        notify(t("masterdata.location.exportFailed"), "error");
    } finally {
        if (typeof hideAppLoading === "function") hideAppLoading();
    }
}

// Off-screen, always-light A4 table snapshotted with html2canvas (so
// Khmer place names keep the app font), sliced at row boundaries with
// the header repeated on every page.
async function mdExportPdf() {
    mdCloseMenu();
    const rows = mdExportRows();
    if (!rows.length) return notify(t("masterdata.location.nothingToExport"), "warning");

    const filters = mdActiveFilters().map(f => f.label);
    if (mdState.q) filters.unshift(`"${mdState.q}"`);
    const total = rows.reduce((s, r) => s + r[4], 0);
    const holder = document.createElement("div");
    holder.className = "md-print";
    holder.innerHTML = `
        <div class="md-print-head">
            <div class="md-print-title">${mdEscapeHtml(t("masterdata.location.title"))}</div>
            <div class="md-print-sub">${mdEscapeHtml(new Date().toLocaleString())} · ${mdEscapeHtml(t("masterdata.location.resultCount", { shown: mdFmt(rows.length), total: mdFmt(mdLocations.length) }))} · ${mdEscapeHtml(t("masterdata.location.familyCount", { n: mdFmt(total) }))}${filters.length ? ` · ${mdEscapeHtml(filters.join(", "))}` : ""}</div>
        </div>
        <table class="md-print-table">
            <thead><tr>${mdExportHeaders().map((h, i) => `<th${i === 4 ? ' style="text-align:right"' : ""}>${mdEscapeHtml(h)}</th>`).join("")}</tr></thead>
            <tbody>${rows.map(r => `<tr>${r.map((v, i) => `<td${i === 4 ? ' style="text-align:right"' : ""}>${mdEscapeHtml(i === 4 ? mdFmt(v) : v)}</td>`).join("")}</tr>`).join("")}
            <tr class="md-print-total"><td></td><td>${mdEscapeHtml(t("masterdata.location.total"))}</td><td></td><td></td><td style="text-align:right">${mdFmt(total)}</td><td></td><td></td></tr></tbody>
        </table>`;
    document.body.appendChild(holder);

    try {
        if (typeof showAppLoading === "function") showAppLoading(t("masterdata.location.generatingPdf"));
        await Promise.all([mdLoadLib("html2canvas"), mdLoadLib("jspdf")]);
        if (document.fonts && document.fonts.ready) await document.fonts.ready;

        const SCALE = 2;
        const full = await html2canvas(holder, { scale: SCALE, backgroundColor: "#ffffff" });
        const headCanvas = await html2canvas(holder.querySelector("thead"), { scale: SCALE, backgroundColor: "#ffffff" });
        const hRect = holder.getBoundingClientRect();
        const bounds = [...holder.querySelectorAll("tbody tr")].map(tr => (tr.getBoundingClientRect().bottom - hRect.top) * SCALE);

        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
        const pageW = 210, pageH = 297, margin = 8;
        const usableW = pageW - margin * 2, usableH = pageH - margin * 2;
        const sliceH = full.width * (usableH / usableW);
        const headH = headCanvas.height;

        let start = 0, first = true, page = 0;
        while (start < full.height - 2) {
            const end = start + (first ? sliceH : sliceH - headH);
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
            pdf.addImage(canvas.toDataURL("image/jpeg", 0.9), "JPEG", margin, margin, usableW, usableW * (canvas.height / canvas.width));
            pdf.setFontSize(8);
            pdf.setTextColor(140);
            pdf.text(String(page + 1), pageW - margin, pageH - 3, { align: "right" });

            start = cut;
            first = false;
            page++;
        }
        pdf.save(`ListLocation_${mdExportStamp()}.pdf`);
    } catch (e) {
        console.error("[location export pdf]", e);
        notify(t("masterdata.location.exportFailed"), "error");
    } finally {
        holder.remove();
        if (typeof hideAppLoading === "function") hideAppLoading();
    }
}

function mdCloseMenu() {
    document.getElementById("mdMenu").classList.remove("show");
    document.getElementById("mdMenuBtn").setAttribute("aria-expanded", "false");
}

// ========================================
// ADD / EDIT DIALOG
// ========================================
function mdOpenDialog(location) {
    mdEditingId = location ? location.id : null;
    document.getElementById("mdDialogTitle").textContent =
        location ? t("masterdata.location.modalEditTitle") : t("masterdata.location.modalAddTitle");

    document.getElementById("mdFieldDistrict").value = location ? location.district : "";
    document.getElementById("mdFieldCommune").value = location ? location.commune : "";
    document.getElementById("mdFieldVillage").value = location ? location.village : "";
    document.getElementById("mdFieldFamily").value = location ? (location.family || "") : "";
    document.getElementById("mdFieldBranch").value = location ? (location.branch || "") : "";
    document.getElementById("mdFieldOfficer").value = location ? (location.officer || "") : "";

    document.getElementById("mdLocationDialog").classList.add("show");
}

function mdCloseDialog() {
    document.getElementById("mdLocationDialog").classList.remove("show");
    mdEditingId = null;
}

async function mdSaveLocation() {
    const district = document.getElementById("mdFieldDistrict").value.trim();
    const commune = document.getElementById("mdFieldCommune").value.trim();
    const village = document.getElementById("mdFieldVillage").value.trim();
    const family = document.getElementById("mdFieldFamily").value.trim();
    const branch = document.getElementById("mdFieldBranch").value;
    const officer = document.getElementById("mdFieldOfficer").value.trim();

    if (!district) return notify(t("masterdata.location.districtRequired"), "warning");
    if (!commune) return notify(t("masterdata.location.communeRequired"), "warning");
    if (!village) return notify(t("masterdata.location.villageRequired"), "warning");

    try {
        const data = await API.post("/api/address/upsert", {
            id: mdEditingId || undefined,
            district, commune, village, family, branch, officer
        });
        if (!data.ok) {
            notify(data.message || t("masterdata.location.saveFailed"), "error");
            return;
        }
        notify(t("masterdata.location.saveSuccess"), "success");
        mdCloseDialog();
        mdLoadLocations();
    } catch (e) {
        console.error(e);
        notify(t("masterdata.location.networkError"), "error");
    }
}

// ========================================
// DELETE DIALOG
// ========================================
let mdDeletingId = null;

function mdOpenDeleteDialog(location) {
    mdDeletingId = location.id;
    document.getElementById("mdDeleteBody").textContent =
        t("masterdata.location.deleteConfirmBody", { name: location.village || location.district });
    document.getElementById("mdDeleteDialog").classList.add("show");
}

function mdCloseDeleteDialog() {
    document.getElementById("mdDeleteDialog").classList.remove("show");
    mdDeletingId = null;
}

async function mdConfirmDelete() {
    if (!mdDeletingId) return;
    try {
        const res = await fetch(`${API.BASE_URL}/api/address/${encodeURIComponent(mdDeletingId)}`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${API.getToken()}` }
        });
        const data = await res.json();
        if (!data.ok) {
            notify(data.message || t("masterdata.location.deleteFailed"), "error");
            return;
        }
        notify(t("masterdata.location.deleteSuccess"), "success");
        mdCloseDeleteDialog();
        mdLoadLocations();
    } catch (e) {
        console.error(e);
        notify(t("masterdata.location.networkError"), "error");
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
    }, 150);
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

document.getElementById("mdChips").addEventListener("click", (e) => {
    const chip = e.target.closest(".md-chip");
    if (!chip) return;
    mdState[chip.dataset.field] = "";
    // A commune / officer only makes sense inside its district / branch.
    if (chip.dataset.field === "district") mdState.commune = "";
    if (chip.dataset.field === "branch") mdState.officer = "";
    mdSaveState();
    mdRenderList();
});
document.getElementById("mdClearFilterBtn").addEventListener("click", mdClearAll);

document.getElementById("mdFilterBtn").addEventListener("click", mdOpenFilterSheet);
document.getElementById("mdSortBtn").addEventListener("click", mdOpenSortSheet);
document.getElementById("mdFilterDistrict").addEventListener("change", () => mdFillCommunes(document.getElementById("mdFilterCommune").value));
document.getElementById("mdFilterBranch").addEventListener("change", () => mdFillOfficers(document.getElementById("mdFilterOfficer").value));
document.getElementById("mdFilterApply").addEventListener("click", mdApplyFilterSheet);
document.getElementById("mdFilterReset").addEventListener("click", () => {
    document.getElementById("mdFilterDistrict").value = "";
    document.getElementById("mdFilterBranch").value = "";
    mdFillCommunes("");
    mdFillOfficers("");
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
    localStorage.setItem("md_location_view", mode);
    mdApplyViewModeButtons();
    mdRenderList();
}
document.getElementById("mdViewCardBtn").addEventListener("click", () => mdSetViewMode("card"));
document.getElementById("mdViewListBtn").addEventListener("click", () => mdSetViewMode("list"));
mdApplyViewModeButtons();

document.getElementById("btnMdAdd").addEventListener("click", () => mdOpenDialog(null));
document.getElementById("btnMdSave").addEventListener("click", mdSaveLocation);
document.getElementById("btnMdCancel").addEventListener("click", mdCloseDialog);
document.getElementById("mdLocationDialog").addEventListener("click", (e) => {
    if (e.target.id === "mdLocationDialog") mdCloseDialog();
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
    if (e.target.closest("[data-more]")) {
        mdShown += mdViewMode === "list" ? 300 : MD_PAGE;
        return mdRenderList(true);
    }
    const th = e.target.closest(".md-th-sort");
    if (th) return mdSortByColumn(th.dataset.sort);
    const card = e.target.closest("[data-id]");
    if (!card) return;
    const id = card.dataset.id;
    const location = mdLocations.find(l => l.id === id);
    if (!location) return;

    if (e.target.closest(".md-edit-btn")) {
        mdOpenDialog(location);
    } else if (e.target.closest(".md-delete-btn")) {
        mdOpenDeleteDialog(location);
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
                titleKey: "masterdata.location.title",
                showBack: true,
                showLogo: false,
                showProfile: false
            });
            // ⋮ menu lives in the topbar's right side; moved (not
            // rebuilt) so its handlers stay wired.
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
mdLoadLocations();
