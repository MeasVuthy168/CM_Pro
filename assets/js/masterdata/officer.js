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
// SUMMARY
// ========================================
function mdRenderSummary() {
    const total = mdOfficers.length;
    const fsroCount = mdOfficers.filter(o => o.team && o.team.trim().toLowerCase() === "fsro").length;
    const coCount = mdOfficers.filter(o =>
        (o.team || "").trim().toLowerCase() !== "fsro" &&
        (o.branch || "").trim().toLowerCase() !== "stop disburse"
    ).length;

    document.getElementById("mdSummaryTotal").textContent = total;
    document.getElementById("mdSummaryCO").textContent = coCount;
    document.getElementById("mdSummaryFSRO").textContent = fsroCount;
}

// ========================================
// SEARCH + FILTER + RENDER LIST
// ========================================
const MD_SORTERS = {
    name_asc: (a, b) => (a.name || "").localeCompare(b.name || ""),
    name_desc: (a, b) => (b.name || "").localeCompare(a.name || ""),
    id_asc: (a, b) => (a.officerId || "").localeCompare(b.officerId || ""),
    id_desc: (a, b) => (b.officerId || "").localeCompare(a.officerId || "")
};

function mdFilteredOfficers() {
    const keyword = document.getElementById("mdSearchInput").value.trim().toLowerCase();
    const teamFilter = document.getElementById("mdFilterTeam").value;
    const branchFilter = document.getElementById("mdFilterBranch").value;
    const sortBy = document.getElementById("mdSortSelect").value;

    return mdOfficers.filter(o => {
        if (teamFilter) {
            if (teamFilter === "__blank__") {
                if (o.team) return false;
            } else if (o.team !== teamFilter) return false;
        }
        if (branchFilter && o.branch !== branchFilter) return false;
        if (keyword) {
            const hay = `${o.officerId} ${o.name} ${o.nameKh || ""} ${o.phone || ""}`.toLowerCase();
            if (!hay.includes(keyword)) return false;
        }
        return true;
    }).sort(MD_SORTERS[sortBy] || MD_SORTERS.name_asc);
}

function mdRenderList() {
    const list = document.getElementById("mdList");
    const rows = mdFilteredOfficers();

    if (!rows.length) {
        list.innerHTML = `<div class="md-empty">${t("masterdata.officer.noData")}</div>`;
        return;
    }

    if (mdViewMode === "list") {
        mdRenderTable(list, rows);
    } else {
        mdRenderCards(list, rows);
    }
}

function mdRenderTable(list, rows) {
    const bodyRows = rows.map(o => `
        <tr data-id="${mdEscapeHtml(o.officerId)}">
            <td>${mdEscapeHtml(o.officerId) || "-"}</td>
            <td>${mdEscapeHtml(o.name) || "-"}</td>
            <td>${mdEscapeHtml(o.nameKh) || "-"}</td>
            <td>${mdEscapeHtml(o.phone) || "-"}</td>
            <td>${mdEscapeHtml(o.team) || "-"}</td>
            <td>${mdEscapeHtml(o.branch) || "-"}</td>
            ${mdIsAdmin ? `
            <td>
                <div class="md-table-actions">
                    <button type="button" class="md-icon-btn md-edit-btn" aria-label="${t("masterdata.officer.editBtn")}"><span class="ui-ico ui-ico-edit" aria-hidden="true"></span></button>
                    <button type="button" class="md-icon-btn md-danger md-delete-btn" aria-label="${t("masterdata.officer.deleteBtn")}"><span class="ui-ico ui-ico-trash" aria-hidden="true"></span></button>
                </div>
            </td>` : ""}
        </tr>
    `).join("");

    list.innerHTML = `
        <div class="md-table-wrap">
        <table class="md-table">
        <thead>
        <tr>
            <th>${t("masterdata.officer.colId")}</th>
            <th>${t("masterdata.officer.colName")}</th>
            <th>${t("masterdata.officer.colNameKh")}</th>
            <th>${t("masterdata.officer.colPhone")}</th>
            <th>${t("masterdata.officer.colTeam")}</th>
            <th>${t("masterdata.officer.colBranch")}</th>
            ${mdIsAdmin ? `<th>${t("masterdata.officer.colActions")}</th>` : ""}
        </tr>
        </thead>
        <tbody>${bodyRows}</tbody>
        </table>
        </div>
    `;
}

function mdRenderCards(list, rows) {
    list.innerHTML = rows.map(o => `
        <div class="md-row-card" data-id="${mdEscapeHtml(o.officerId)}">
            <div class="md-row-top">
                <div>
                    <div class="md-row-name">${mdEscapeHtml(o.name) || "-"}</div>
                    <div class="md-row-id">${t("masterdata.officer.colId")}: ${mdEscapeHtml(o.officerId) || "-"}</div>
                    <div class="md-row-id">${t("masterdata.officer.colNameKh")}: ${mdEscapeHtml(o.nameKh) || "-"}</div>
                    <div class="md-row-id">${t("masterdata.officer.colPhone")}: ${mdEscapeHtml(o.phone) || "-"}</div>
                </div>
                ${mdIsAdmin ? `
                <div class="md-row-actions">
                    <button type="button" class="md-icon-btn md-edit-btn" aria-label="${t("masterdata.officer.editBtn")}"><span class="ui-ico ui-ico-edit" aria-hidden="true"></span></button>
                    <button type="button" class="md-icon-btn md-danger md-delete-btn" aria-label="${t("masterdata.officer.deleteBtn")}"><span class="ui-ico ui-ico-trash" aria-hidden="true"></span></button>
                </div>` : ""}
            </div>
            <div class="md-row-tags">
                ${o.team ? `<span class="md-tag">${mdEscapeHtml(o.team)}</span>` : ""}
                ${o.branch ? `<span class="md-tag">${mdEscapeHtml(o.branch)}</span>` : ""}
            </div>
        </div>
    `).join("");
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
    const phone = document.getElementById("mdFieldPhone").value.trim();
    const team = document.getElementById("mdFieldTeam").value;
    const branch = document.getElementById("mdFieldBranch").value;

    if (!officerId) return notify(t("masterdata.officer.idRequired"), "warning");
    if (!name) return notify(t("masterdata.officer.nameRequired"), "warning");

    try {
        const data = await API.post("/api/creditofficer/upsert", { officerId, name, nameKh, phone, team, branch });
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

document.getElementById("mdFilterTeam").addEventListener("change", mdRenderList);
document.getElementById("mdFilterBranch").addEventListener("change", mdRenderList);
document.getElementById("mdSortSelect").addEventListener("change", mdRenderList);

document.getElementById("mdClearFilterBtn").addEventListener("click", () => {
    document.getElementById("mdFilterTeam").value = "";
    document.getElementById("mdFilterBranch").value = "";
    mdRenderList();
});

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
