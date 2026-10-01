// ========================================
// REPORT COMPARISON — pick any two backed-up dates and see what changed,
// per explicit request 2026-10-01: daily backup of every Credit Report
// source, compared against today (or any other day).
//
// BACKEND ENDPOINTS (CM-backend's lib/creditreport-compare.js)
//   GET  /api/creditreport/snapshot/dates -> { ok, dates:[...], today }
//   POST /api/creditreport/snapshot/run   (admin only) -> { ok, date, counts }
//   GET  /api/creditreport/compare?dateA=&dateB=
//     -> { ok, dateA, dateB, diff:{ os, wo, overdue, t24 } }
//     os:      { countA,countB,countDiff, loanSizeSumA/B/Diff, osUsdSumA/B/Diff }
//     wo:      { summary:{countA,countB,countDiff,intA/B/Diff,prnA/B/Diff},
//                entered:[{cif,khName,branch,officerId,int,prn}], exited:[...] }
//     overdue: { summary:{byClassA,byClassB,byClassDiff},
//                changed:[{cif,loanNumber,name,branch,officerId,fromClass,
//                          toClass,direction}], entered:[...], exited:[...] }
//     t24:     { summary:{countA,countB,countDiff,valA/B/Diff},
//                entered:[{cif,loanNumber,name,branch,officerId,val}], exited:[...] }
// ========================================

const rcToken =
    localStorage.getItem("token") ||
    sessionStorage.getItem("token");

const rcUser = JSON.parse(
    localStorage.getItem("loggedInUser") || sessionStorage.getItem("loggedInUser") || "{}"
);
const rcIsAdmin = String(rcUser.role || "").toLowerCase() === "admin";

let rcDates = [];
let rcDiff = null;
let rcActiveTab = "wo";
let rcSubTab = { wo: "entered", overdue: "changed", t24: "entered" };

function rcEscapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function rcFmtNum(n) {
    n = Number(n) || 0;
    return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}
function rcFmtDiff(n) {
    n = Number(n) || 0;
    const cls = n > 0 ? "positive" : n < 0 ? "negative" : "zero";
    const sign = n > 0 ? "+" : "";
    return `<div class="rc-tile-diff ${cls}">${sign}${rcFmtNum(n)}</div>`;
}
function rcNotify(message, type) {
    if (typeof CMToast !== "undefined" && CMToast.show) {
        CMToast.show({ type: type === "error" ? "error" : "backup", title: type === "error" ? "Error" : "Success", message });
    } else {
        alert(message);
    }
}
function rcShowEmpty(msg) {
    const el = document.getElementById("rcEmpty");
    el.textContent = msg;
    el.style.display = "block";
    document.getElementById("rcSummaryGrid").style.display = "none";
    document.getElementById("rcTransitionsCard").style.display = "none";
}
function rcHideEmpty() {
    document.getElementById("rcEmpty").style.display = "none";
}

async function rcApiGet(path) {
    const res = await fetch(`${API.BASE_URL}${path}`, { headers: { Authorization: `Bearer ${rcToken}` } });
    return res.json();
}
async function rcApiPost(path, body) {
    const res = await fetch(`${API.BASE_URL}${path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${rcToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(body || {})
    });
    return res.json();
}

// ========================================
// DATE PICKERS
// ========================================
async function rcLoadDates() {
    const data = await rcApiGet("/api/creditreport/snapshot/dates");
    if (!data.ok) { rcShowEmpty(data.message || "Failed to load snapshot dates."); return; }
    rcDates = data.dates || [];

    const selA = document.getElementById("rcDateA");
    const selB = document.getElementById("rcDateB");
    if (!rcDates.length) {
        rcShowEmpty("មិនទាន់មានទិន្នន័យបម្រុងទុកទេ — សូមចុច Snapshot Now ដើម្បីចាប់ផ្ដើម។ / No backup yet — click Snapshot Now to start.");
        selA.innerHTML = "";
        selB.innerHTML = "";
        if (rcIsAdmin) document.getElementById("rcSnapshotBtn").style.display = "inline-flex";
        return;
    }

    const optsHtml = rcDates.map(d => `<option value="${d}">${d}</option>`).join("");
    selA.innerHTML = optsHtml;
    selB.innerHTML = optsHtml;
    // Default: compare the most recent backup against the one right
    // before it (e.g. "today" vs "yesterday"), but either side stays
    // freely changeable to any backed-up date.
    selB.value = rcDates[0];
    selA.value = rcDates[1] || rcDates[0];

    if (rcIsAdmin) document.getElementById("rcSnapshotBtn").style.display = "inline-flex";
}

// ========================================
// SUMMARY TILES
// ========================================
const NBC_CLASS_ORDER = ["Normal", "Special Mention", "Sub-Standard", "Doubtful", "Loss"];

function rcTileHtml(label, a, b, diff) {
    return `
      <div class="rc-tile">
        <div class="rc-tile-label">${rcEscapeHtml(label)}</div>
        <div class="rc-tile-values">${rcFmtNum(a)}<span class="rc-arrow-sep">→</span>${rcFmtNum(b)}</div>
        ${rcFmtDiff(diff)}
      </div>`;
}

function rcRenderSummary(diff) {
    const tiles = [];
    tiles.push(rcTileHtml("Total Loan (#)", diff.os.countA, diff.os.countB, diff.os.countDiff));
    tiles.push(rcTileHtml("Total OS (USD)", diff.os.osUsdSumA, diff.os.osUsdSumB, diff.os.osUsdSumDiff));
    tiles.push(rcTileHtml("Write Off (# cif)", diff.wo.summary.countA, diff.wo.summary.countB, diff.wo.summary.countDiff));
    tiles.push(rcTileHtml("Write Off (Prn)", diff.wo.summary.prnA, diff.wo.summary.prnB, diff.wo.summary.prnDiff));
    tiles.push(rcTileHtml("PAR T24 (# loan)", diff.t24.summary.countA, diff.t24.summary.countB, diff.t24.summary.countDiff));
    tiles.push(rcTileHtml("PAR T24 (Value)", diff.t24.summary.valA, diff.t24.summary.valB, diff.t24.summary.valDiff));
    for (const cls of NBC_CLASS_ORDER) {
        tiles.push(rcTileHtml(`NBC: ${cls}`, diff.overdue.summary.byClassA[cls], diff.overdue.summary.byClassB[cls], diff.overdue.summary.byClassDiff[cls]));
    }
    document.getElementById("rcSummaryGrid").innerHTML = tiles.join("");
    document.getElementById("rcSummaryGrid").style.display = "grid";
}

// ========================================
// TRANSITION TABLES
// ========================================
function rcClientTableHtml(rows, cols) {
    if (!rows.length) {
        return `<div class="op-empty">គ្មានទិន្នន័យ / No rows in this category.</div>`;
    }
    return `
      <div class="op-client-table-wrap">
        <table class="op-client-table">
          <thead><tr>${cols.map(c => `<th>${rcEscapeHtml(c.label)}</th>`).join("")}</tr></thead>
          <tbody>
            ${rows.map(r => `<tr>${cols.map(c => `<td>${c.render ? c.render(r) : rcEscapeHtml(r[c.key])}</td>`).join("")}</tr>`).join("")}
          </tbody>
        </table>
      </div>`;
}

function rcWoCols() {
    return [
        { key: "cif", label: "CIF" },
        { key: "khName", label: "ឈ្មោះ / Name" },
        { key: "branch", label: "សាខា / Branch" },
        { key: "officerId", label: "មន្ត្រី / Officer" },
        { key: "int", label: "Int", render: r => rcFmtNum(r.int) },
        { key: "prn", label: "Prn", render: r => rcFmtNum(r.prn) }
    ];
}
function rcOverdueChangedCols() {
    return [
        { key: "cif", label: "CIF" },
        { key: "loanNumber", label: "Loan #" },
        { key: "name", label: "ឈ្មោះ / Name" },
        { key: "branch", label: "សាខា / Branch" },
        { key: "officerId", label: "មន្ត្រី / Officer" },
        { key: "change", label: "ចំណាត់ថ្នាក់ / Class", render: r => `${rcEscapeHtml(r.fromClass)} → ${rcEscapeHtml(r.toClass)}` },
        { key: "direction", label: "", render: r => `<span class="rc-badge ${r.direction}">${r.direction === "downgrade" ? "⬇ Downgrade" : "⬆ Upgrade"}</span>` }
    ];
}
function rcOverdueEnterExitCols() {
    return [
        { key: "cif", label: "CIF" },
        { key: "loanNumber", label: "Loan #" },
        { key: "name", label: "ឈ្មោះ / Name" },
        { key: "branch", label: "សាខា / Branch" },
        { key: "officerId", label: "មន្ត្រី / Officer" },
        { key: "cls", label: "ចំណាត់ថ្នាក់ / Class" }
    ];
}
function rcT24Cols() {
    return [
        { key: "cif", label: "CIF" },
        { key: "loanNumber", label: "Loan #" },
        { key: "name", label: "ឈ្មោះ / Name" },
        { key: "branch", label: "សាខា / Branch" },
        { key: "officerId", label: "មន្ត្រី / Officer" },
        { key: "val", label: "Value", render: r => rcFmtNum(r.val) }
    ];
}

function rcRenderTabBody() {
    const diff = rcDiff;
    let html = "";

    if (rcActiveTab === "wo") {
        html += `
          <div class="rc-sub-tabs">
            <button type="button" class="rc-sub-tab${rcSubTab.wo === "entered" ? " active" : ""}" data-sub="entered">✅ ចូលថ្មី / Entered (${diff.wo.entered.length})</button>
            <button type="button" class="rc-sub-tab${rcSubTab.wo === "exited" ? " active" : ""}" data-sub="exited">↩️ ចេញ / Exited (${diff.wo.exited.length})</button>
          </div>`;
        html += rcClientTableHtml(diff.wo[rcSubTab.wo], rcWoCols());
    } else if (rcActiveTab === "overdue") {
        html += `
          <div class="rc-sub-tabs">
            <button type="button" class="rc-sub-tab${rcSubTab.overdue === "changed" ? " active" : ""}" data-sub="changed">🔀 ប្ដូរថ្នាក់ / Changed (${diff.overdue.changed.length})</button>
            <button type="button" class="rc-sub-tab${rcSubTab.overdue === "entered" ? " active" : ""}" data-sub="entered">✅ ចូលថ្មី / New Overdue (${diff.overdue.entered.length})</button>
            <button type="button" class="rc-sub-tab${rcSubTab.overdue === "exited" ? " active" : ""}" data-sub="exited">↩️ ដោះស្រាយ / Resolved (${diff.overdue.exited.length})</button>
          </div>`;
        if (rcSubTab.overdue === "changed") html += rcClientTableHtml(diff.overdue.changed, rcOverdueChangedCols());
        else html += rcClientTableHtml(diff.overdue[rcSubTab.overdue], rcOverdueEnterExitCols());
    } else if (rcActiveTab === "t24") {
        html += `
          <div class="rc-sub-tabs">
            <button type="button" class="rc-sub-tab${rcSubTab.t24 === "entered" ? " active" : ""}" data-sub="entered">✅ ចូលថ្មី / Entered (${diff.t24.entered.length})</button>
            <button type="button" class="rc-sub-tab${rcSubTab.t24 === "exited" ? " active" : ""}" data-sub="exited">↩️ ចេញ / Exited (${diff.t24.exited.length})</button>
          </div>`;
        html += rcClientTableHtml(diff.t24[rcSubTab.t24], rcT24Cols());
    }

    document.getElementById("rcTabBody").innerHTML = html;
}

// ========================================
// COMPARE
// ========================================
async function rcRunCompare() {
    const dateA = document.getElementById("rcDateA").value;
    const dateB = document.getElementById("rcDateB").value;
    if (!dateA || !dateB) return;

    rcHideEmpty();
    document.getElementById("rcSummaryGrid").style.display = "none";
    document.getElementById("rcTransitionsCard").style.display = "none";
    document.getElementById("rcPageSkel").style.display = "flex";

    try {
        const data = await rcApiGet(`/api/creditreport/compare?dateA=${encodeURIComponent(dateA)}&dateB=${encodeURIComponent(dateB)}`);
        document.getElementById("rcPageSkel").style.display = "none";
        if (!data.ok) { rcShowEmpty(data.message || "Failed to compare."); return; }

        rcDiff = data.diff;
        rcRenderSummary(rcDiff);
        document.getElementById("rcTransitionsCard").style.display = "block";
        rcRenderTabBody();
    } catch (e) {
        console.error(e);
        document.getElementById("rcPageSkel").style.display = "none";
        rcShowEmpty("Server error while comparing.");
    }
}

// ========================================
// EVENTS
// ========================================
document.addEventListener("click", (e) => {
    const tab = e.target.closest("#rcTabs .op-mode-tab");
    if (tab) {
        document.querySelectorAll("#rcTabs .op-mode-tab").forEach(t => t.classList.remove("active"));
        tab.classList.add("active");
        rcActiveTab = tab.dataset.tab;
        rcRenderTabBody();
        return;
    }
    const subTab = e.target.closest(".rc-sub-tab");
    if (subTab) {
        rcSubTab[rcActiveTab] = subTab.dataset.sub;
        rcRenderTabBody();
        return;
    }
});

function rcInit() {
    document.getElementById("rcCompareBtn").addEventListener("click", rcRunCompare);
    document.getElementById("rcSnapshotBtn").addEventListener("click", async () => {
        const btn = document.getElementById("rcSnapshotBtn");
        btn.disabled = true;
        try {
            const data = await rcApiPost("/api/creditreport/snapshot/run", {});
            if (data.ok) {
                rcNotify(`Snapshot saved for ${data.date}`, "success");
                // A failure here (date list refresh) shouldn't be reported
                // as the snapshot itself having failed — it already saved.
                try { await rcLoadDates(); } catch (e) { console.error(e); }
            } else {
                rcNotify(data.message || "Snapshot failed", "error");
            }
        } catch (e) {
            console.error(e);
            rcNotify("Snapshot failed", "error");
        } finally {
            btn.disabled = false;
        }
    });

    rcLoadDates().then(() => {
        if (rcDates.length) rcRunCompare();
    });
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", rcInit);
} else {
    rcInit();
}
