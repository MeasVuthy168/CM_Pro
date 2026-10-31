// ========================================
// Credit Report hub — "Snapshot All" admin control.
// Consolidates the 4 per-report "Snapshot Now" buttons (Branch/Officer/
// Product/Location, each on its own Daily Monitoring page) into one
// button here, per explicit request 2026-10-07, so there is exactly one
// snapshot control in the whole Credit Report section. Runs all 4 reports' existing
// /snapshot/run endpoints in parallel (each report already knows its
// own current date internally — see crGridMergeDateKey() in each
// lib/creditreport-*.js) and shows one combined result.
// ========================================
const crHubToken =
    localStorage.getItem("token") ||
    sessionStorage.getItem("token");

const crHubLoggedInUser = JSON.parse(
    localStorage.getItem("loggedInUser") || sessionStorage.getItem("loggedInUser") || "{}"
);
const crHubIsAdmin = String(crHubLoggedInUser.role || "").toLowerCase() === "admin";

const t = (key, vars) => window.CMI18n ? CMI18n.t(key, vars) : key;

const CR_HUB_SNAPSHOT_TARGETS = [
    { label: () => t("creditreport.hub.targetBranch"), url: "/api/creditreport/summary/snapshot/run" },
    { label: () => t("creditreport.hub.targetOfficer"), url: "/api/creditreport/byco/snapshot/run" },
    { label: () => t("creditreport.hub.targetProduct"), url: "/api/creditreport/byproduct/snapshot/run" },
    { label: () => t("creditreport.hub.targetLocation"), url: "/api/creditreport/bylocation/snapshot/run" }
];

// "Refresh All T24" targets — just the 4 Daily History reports, each
// with a per-date T24 freeze (see lib/creditreport-*.js).
const CR_HUB_T24_REFRESH_TARGETS = [
    { label: () => t("creditreport.hub.targetBranch"), url: "/api/creditreport/summary/snapshot/refresh-t24-all" },
    { label: () => t("creditreport.hub.targetOfficer"), url: "/api/creditreport/byco/snapshot/refresh-t24-all" },
    { label: () => t("creditreport.hub.targetProduct"), url: "/api/creditreport/byproduct/snapshot/refresh-t24-all" },
    { label: () => t("creditreport.hub.targetLocation"), url: "/api/creditreport/bylocation/snapshot/refresh-t24-all" }
];

// toast.js declares CMToast with a top-level const (so not on window);
// the old showToast() call never existed, so
// the success / failure toast after Snapshot All / Refresh All T24
// silently never appeared.
function crHubToast(message, type) {
    if (typeof CMToast !== "undefined" && typeof CMToast.show === "function") {
        CMToast.show({ type, title: message, message: "", duration: 3500 });
    }
}

function crHubEscapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text == null ? "" : String(text);
    return div.innerHTML;
}

function crHubFmtDateDMY(yyyymmdd) {
    if (!yyyymmdd) return "-";
    const [y, m, d] = yyyymmdd.split("-");
    return `${d}-${m}-${y}`;
}

async function crHubRunOneSnapshot(target) {
    try {
        const res = await fetch(`${API.BASE_URL}${target.url}`, {
            method: "POST",
            headers: { Authorization: `Bearer ${crHubToken}`, "Content-Type": "application/json" },
            body: "{}"
        });
        const data = await res.json();
        if (data.ok) {
            return { label: target.label(), ok: true, date: data.date };
        }
        return { label: target.label(), ok: false, message: data.message || t("creditreport.hub.snapshotFailed") };
    } catch (e) {
        console.error(e);
        return { label: target.label(), ok: false, message: t("creditreport.hub.networkError") };
    }
}

function crHubRenderResults(results) {
    const okCount = results.filter(r => r.ok).length;
    document.getElementById("crHubSnapshotSummary").textContent =
        t("creditreport.hub.snapshotSavedCount", { ok: okCount, total: results.length });
    document.getElementById("crHubSnapshotRows").innerHTML = results.map(r =>
        `<div class="cr-hub-snapshot-row${r.ok ? " ok" : " fail"}">` +
            `<span class="cr-hub-snapshot-dot"></span>` +
            `<span class="cr-hub-snapshot-label">${crHubEscapeHtml(r.label)}</span>` +
            `<span class="cr-hub-snapshot-detail">${r.ok ? crHubFmtDateDMY(r.date) : crHubEscapeHtml(r.message)}</span>` +
        `</div>`
    ).join("");
    document.getElementById("crHubSnapshotResults").style.display = "block";
}

// Same shape as crHubRunOneSnapshot, but the endpoint returns a
// `refreshed` day count instead of a single `date`.
async function crHubRunOneT24Refresh(target) {
    try {
        const res = await fetch(`${API.BASE_URL}${target.url}`, {
            method: "POST",
            headers: { Authorization: `Bearer ${crHubToken}`, "Content-Type": "application/json" },
            body: "{}"
        });
        const data = await res.json();
        if (data.ok) {
            return { label: target.label(), ok: true, refreshed: data.refreshed };
        }
        return { label: target.label(), ok: false, message: data.message || t("creditreport.hub.snapshotFailed") };
    } catch (e) {
        console.error(e);
        return { label: target.label(), ok: false, message: t("creditreport.hub.networkError") };
    }
}

// Reuses the same results panel as crHubRenderResults — whichever
// admin action ran most recently is what it shows. Each target
// refreshes just its single latest saved date now, so the detail
// shown is that date (or "no saved day yet" the first time, before
// any Daily History has ever been saved for that report).
function crHubRenderT24Results(results) {
    const okCount = results.filter(r => r.ok).length;
    document.getElementById("crHubSnapshotSummary").textContent =
        t("creditreport.hub.snapshotSavedCount", { ok: okCount, total: results.length });
    document.getElementById("crHubSnapshotRows").innerHTML = results.map(r =>
        `<div class="cr-hub-snapshot-row${r.ok ? " ok" : " fail"}">` +
            `<span class="cr-hub-snapshot-dot"></span>` +
            `<span class="cr-hub-snapshot-label">${crHubEscapeHtml(r.label)}</span>` +
            `<span class="cr-hub-snapshot-detail">${r.ok ? (r.refreshed ? crHubFmtDateDMY(r.date) : t("creditreport.hub.t24RefreshedNone")) : crHubEscapeHtml(r.message)}</span>` +
        `</div>`
    ).join("");
    document.getElementById("crHubSnapshotResults").style.display = "block";
}

// Credit Portfolio Intelligence is for admin and user only (owner,
// 31/10/2026); the server refuses every other role too.
if (["admin", "user"].includes(String(crHubLoggedInUser.role || "").trim().toLowerCase())) {
    document.getElementById("crHubPortfolioTitle").style.display = "";
    document.getElementById("crHubPortfolio").style.display = "";
}

if (crHubIsAdmin) {
    document.getElementById("crHubAdminToolbar").style.display = "";

    document.getElementById("btnCrSnapshotResultsClose").addEventListener("click", () => {
        document.getElementById("crHubSnapshotResults").style.display = "none";
    });

    document.getElementById("btnCrSnapshotAll").addEventListener("click", async () => {
        const btn = document.getElementById("btnCrSnapshotAll");
        const label = document.getElementById("crHubSnapshotBtnLabel");
        btn.disabled = true;
        label.removeAttribute("data-i18n");
        label.textContent = t("creditreport.hub.running");
        document.getElementById("crHubSnapshotResults").style.display = "none";
        try {
            const results = await Promise.all(CR_HUB_SNAPSHOT_TARGETS.map(crHubRunOneSnapshot));
            crHubRenderResults(results);
            const allOk = results.every(r => r.ok);
            crHubToast(allOk ? t("creditreport.hub.snapshotAllSaved") : t("creditreport.hub.snapshotSomeFailed"),
                    allOk ? "success" : "error");
        } finally {
            btn.disabled = false;
            label.setAttribute("data-i18n", "creditreport.hub.snapshotAll");
            label.textContent = t("creditreport.hub.snapshotAll");
        }
    });

    // Admin escape hatch for the per-date T24 freeze (see each
    // lib/creditreport-*.js's own comment): refreshes T24 for just the
    // latest already-saved Daily History date, across all 4 reports in
    // one click, instead of one admin click per row on each report's
    // own history table. T24 and NBC OS are two separate uploads (see
    // runBranchDailySnapshotNow's own comment) — the confirm below
    // exists because refreshing T24 against a stale OS-driven latest
    // day is a likely admin mistake, not because this action touches OS
    // data itself.
    document.getElementById("btnCrRefreshAllT24").addEventListener("click", async () => {
        if (!confirm(t("creditreport.hub.confirmRefreshAllT24"))) return;

        const btn = document.getElementById("btnCrRefreshAllT24");
        const label = document.getElementById("crHubRefreshBtnLabel");
        btn.disabled = true;
        label.removeAttribute("data-i18n");
        label.textContent = t("creditreport.hub.refreshingT24");
        document.getElementById("crHubSnapshotResults").style.display = "none";
        try {
            const results = await Promise.all(CR_HUB_T24_REFRESH_TARGETS.map(crHubRunOneT24Refresh));
            crHubRenderT24Results(results);
            const allOk = results.every(r => r.ok);
            crHubToast(allOk ? t("creditreport.hub.t24RefreshAllDone") : t("creditreport.hub.t24RefreshSomeFailed"),
                    allOk ? "success" : "error");
        } finally {
            btn.disabled = false;
            label.setAttribute("data-i18n", "creditreport.hub.refreshAllT24");
            label.textContent = t("creditreport.hub.refreshAllT24");
        }
    });
}
