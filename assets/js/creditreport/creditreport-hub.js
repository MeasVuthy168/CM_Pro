// ========================================
// Credit Report hub — "Snapshot All" admin control.
// Consolidates the 4 per-report "Snapshot Now" buttons (Branch/Officer/
// Product/Location, each on its own Daily Monitoring page) into one
// button here, per explicit request 2026-10-07 — and, per explicit
// request 2026-10-08, also absorbed Report Comparison's own standalone
// "Snapshot Now" button, so there is exactly one snapshot control in
// the whole Credit Report section. Runs all 5 reports' existing
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
    { label: () => t("creditreport.hub.targetLocation"), url: "/api/creditreport/bylocation/snapshot/run" },
    // The combined OS/Disburse/WO/Overdue/T24 snapshot Report Comparison
    // reads both sides of a compare from — formerly its own page-local
    // "Snapshot Now" button, absorbed here 2026-10-08.
    { label: () => t("creditreport.hub.targetCompare"), url: "/api/creditreport/snapshot/run" }
];

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
            if (typeof showToast === "function") {
                showToast(
                    allOk ? t("creditreport.hub.snapshotAllSaved") : t("creditreport.hub.snapshotSomeFailed"),
                    allOk ? "success" : "error"
                );
            }
        } finally {
            btn.disabled = false;
            label.setAttribute("data-i18n", "creditreport.hub.snapshotAll");
            label.textContent = t("creditreport.hub.snapshotAll");
        }
    });
}
