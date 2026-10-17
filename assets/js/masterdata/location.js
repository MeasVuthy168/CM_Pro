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
        mdPopulateDistrictFilter();
        mdPopulateCommuneFilter();
        mdPopulateOfficerFilter();
        mdRenderSummary();
        mdRenderList();
    } catch (e) {
        console.error(e);
        notify(t("masterdata.location.networkError"), "error");
    }
}

// ========================================
// DISTRICT FILTER — built from whatever's actually in the data (no
// fixed canonical district list exists anywhere in the codebase,
// unlike List Officer's Team/Branch values).
// ========================================
function mdPopulateDistrictFilter() {
    const sel = document.getElementById("mdFilterDistrict");
    const prev = sel.value;
    const districts = [...new Set(mdLocations.map(l => l.district).filter(Boolean))].sort();

    sel.innerHTML =
        `<option value="">${t("masterdata.location.allDistricts")}</option>` +
        districts.map(d => `<option value="${mdEscapeHtml(d)}">${mdEscapeHtml(d)}</option>`).join("");

    if (districts.includes(prev)) sel.value = prev;
}

// Commune options narrow to the currently selected District (all
// communes if no District is selected). Re-run whenever District
// changes, same as Officer below does for Branch.
function mdPopulateCommuneFilter() {
    const districtFilter = document.getElementById("mdFilterDistrict").value;
    const sel = document.getElementById("mdFilterCommune");
    const prev = sel.value;
    const scoped = districtFilter ? mdLocations.filter(l => l.district === districtFilter) : mdLocations;
    const communes = [...new Set(scoped.map(l => l.commune).filter(Boolean))].sort();

    sel.innerHTML =
        `<option value="">${t("masterdata.location.allCommunes")}</option>` +
        communes.map(c => `<option value="${mdEscapeHtml(c)}">${mdEscapeHtml(c)}</option>`).join("");

    if (communes.includes(prev)) sel.value = prev;
}

// Officer options narrow to the currently selected Branch (all
// officers if no Branch is selected).
function mdPopulateOfficerFilter() {
    const branchFilter = document.getElementById("mdFilterBranch").value;
    const sel = document.getElementById("mdFilterOfficer");
    const prev = sel.value;
    const scoped = branchFilter ? mdLocations.filter(l => l.branch === branchFilter) : mdLocations;
    const officers = [...new Set(scoped.map(l => l.officer).filter(Boolean))].sort();

    sel.innerHTML =
        `<option value="">${t("masterdata.location.allOfficers")}</option>` +
        officers.map(o => `<option value="${mdEscapeHtml(o)}">${mdEscapeHtml(o)}</option>`).join("");

    if (officers.includes(prev)) sel.value = prev;
}

// ========================================
// SUMMARY
// ========================================
function mdRenderSummary() {
    const total = mdLocations.length;
    const totalFamily = mdLocations.reduce((sum, l) => sum + (parseInt(l.family, 10) || 0), 0);
    const districtCount = new Set(mdLocations.map(l => l.district).filter(Boolean)).size;
    const communeCount = new Set(mdLocations.map(l => l.commune).filter(Boolean)).size;

    document.getElementById("mdSummaryTotal").textContent = total;
    document.getElementById("mdSummaryFamily").textContent = totalFamily;
    document.getElementById("mdSummaryDistricts").textContent = districtCount;
    document.getElementById("mdSummaryCommunes").textContent = communeCount;
}

// ========================================
// SEARCH + FILTER + RENDER LIST
// ========================================
const MD_SORTERS = {
    district_asc: (a, b) => (a.district || "").localeCompare(b.district || "") || (a.village || "").localeCompare(b.village || ""),
    district_desc: (a, b) => (b.district || "").localeCompare(a.district || "") || (a.village || "").localeCompare(b.village || ""),
    village_asc: (a, b) => (a.village || "").localeCompare(b.village || ""),
    village_desc: (a, b) => (b.village || "").localeCompare(a.village || "")
};

function mdFilteredLocations() {
    const keyword = document.getElementById("mdSearchInput").value.trim().toLowerCase();
    const districtFilter = document.getElementById("mdFilterDistrict").value;
    const communeFilter = document.getElementById("mdFilterCommune").value;
    const branchFilter = document.getElementById("mdFilterBranch").value;
    const officerFilter = document.getElementById("mdFilterOfficer").value;
    const sortBy = document.getElementById("mdSortSelect").value;

    return mdLocations.filter(l => {
        if (districtFilter && l.district !== districtFilter) return false;
        if (communeFilter && l.commune !== communeFilter) return false;
        if (branchFilter && l.branch !== branchFilter) return false;
        if (officerFilter && l.officer !== officerFilter) return false;
        if (keyword) {
            const hay = `${l.district} ${l.commune} ${l.village} ${l.branch || ""} ${l.officer || ""}`.toLowerCase();
            if (!hay.includes(keyword)) return false;
        }
        return true;
    }).sort(MD_SORTERS[sortBy] || MD_SORTERS.district_asc);
}

function mdRenderList() {
    const list = document.getElementById("mdList");
    const rows = mdFilteredLocations();

    if (!rows.length) {
        list.innerHTML = `<div class="md-empty">${t("masterdata.location.noData")}</div>`;
        return;
    }

    if (mdViewMode === "list") {
        mdRenderTable(list, rows);
    } else {
        mdRenderCards(list, rows);
    }
}

function mdRenderTable(list, rows) {
    const bodyRows = rows.map(l => `
        <tr data-id="${mdEscapeHtml(l.id)}">
            <td>${mdEscapeHtml(l.village) || "-"}</td>
            <td>${mdEscapeHtml(l.district) || "-"}</td>
            <td>${mdEscapeHtml(l.commune) || "-"}</td>
            <td class="md-table-family">${mdEscapeHtml(l.family) || "-"}</td>
            <td>${mdEscapeHtml(l.branch) || "-"}</td>
            <td>${mdEscapeHtml(l.officer) || "-"}</td>
            ${mdIsAdmin ? `
            <td>
                <div class="md-table-actions">
                    <button type="button" class="md-icon-btn md-edit-btn" aria-label="${t("masterdata.location.editBtn")}"><span class="ui-ico ui-ico-edit" aria-hidden="true"></span></button>
                    <button type="button" class="md-icon-btn md-danger md-delete-btn" aria-label="${t("masterdata.location.deleteBtn")}"><span class="ui-ico ui-ico-trash" aria-hidden="true"></span></button>
                </div>
            </td>` : ""}
        </tr>
    `).join("");

    list.innerHTML = `
        <div class="md-table-wrap">
        <table class="md-table">
        <thead>
        <tr>
            <th>${t("masterdata.location.colVillage")}</th>
            <th>${t("masterdata.location.colDistrict")}</th>
            <th>${t("masterdata.location.colCommune")}</th>
            <th>${t("masterdata.location.colFamily")}</th>
            <th>${t("masterdata.location.colBranch")}</th>
            <th>${t("masterdata.location.colOfficer")}</th>
            ${mdIsAdmin ? `<th>${t("masterdata.location.colActions")}</th>` : ""}
        </tr>
        </thead>
        <tbody>${bodyRows}</tbody>
        </table>
        </div>
    `;
}

function mdRenderCards(list, rows) {
    list.innerHTML = rows.map(l => `
        <div class="md-row-card" data-id="${mdEscapeHtml(l.id)}">
            <div class="md-row-top">
                <div>
                    <div class="md-row-name">${mdEscapeHtml(l.village) || "-"}</div>
                    <div class="md-row-id">${t("masterdata.location.colDistrict")}: ${mdEscapeHtml(l.district) || "-"}</div>
                    <div class="md-row-id">${t("masterdata.location.colCommune")}: ${mdEscapeHtml(l.commune) || "-"}</div>
                    <div class="md-row-id">${t("masterdata.location.colFamily")}: ${mdEscapeHtml(l.family) || "-"}</div>
                </div>
                ${mdIsAdmin ? `
                <div class="md-row-actions">
                    <button type="button" class="md-icon-btn md-edit-btn" aria-label="${t("masterdata.location.editBtn")}"><span class="ui-ico ui-ico-edit" aria-hidden="true"></span></button>
                    <button type="button" class="md-icon-btn md-danger md-delete-btn" aria-label="${t("masterdata.location.deleteBtn")}"><span class="ui-ico ui-ico-trash" aria-hidden="true"></span></button>
                </div>` : ""}
            </div>
            <div class="md-row-tags">
                ${l.branch ? `<span class="md-tag">${mdEscapeHtml(l.branch)}</span>` : ""}
                ${l.officer ? `<span class="md-tag">${mdEscapeHtml(l.officer)}</span>` : ""}
            </div>
        </div>
    `).join("");
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
    mdSearchClearBtn.style.display = mdSearchInput.value ? "flex" : "none";
}

mdSearchInput.addEventListener("input", () => {
    mdUpdateSearchClearVisibility();
    mdRenderList();
});
mdSearchClearBtn.addEventListener("click", () => {
    mdSearchInput.value = "";
    mdUpdateSearchClearVisibility();
    mdRenderList();
    mdSearchInput.focus();
});

document.getElementById("mdFilterDistrict").addEventListener("change", () => {
    document.getElementById("mdFilterCommune").value = "";
    mdPopulateCommuneFilter();
    mdRenderList();
});
document.getElementById("mdFilterCommune").addEventListener("change", mdRenderList);
document.getElementById("mdFilterBranch").addEventListener("change", () => {
    document.getElementById("mdFilterOfficer").value = "";
    mdPopulateOfficerFilter();
    mdRenderList();
});
document.getElementById("mdFilterOfficer").addEventListener("change", mdRenderList);
document.getElementById("mdSortSelect").addEventListener("change", mdRenderList);

document.getElementById("mdClearFilterBtn").addEventListener("click", () => {
    document.getElementById("mdFilterDistrict").value = "";
    document.getElementById("mdFilterCommune").value = "";
    document.getElementById("mdFilterBranch").value = "";
    document.getElementById("mdFilterOfficer").value = "";
    mdPopulateCommuneFilter();
    mdPopulateOfficerFilter();
    mdRenderList();
});

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
