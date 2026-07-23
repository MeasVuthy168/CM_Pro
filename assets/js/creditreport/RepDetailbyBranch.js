// ========================================
// Credit Report — "RepDetail byBranch" Summary Report web port
// Reads from GET /api/creditreport/summary (computed live from
// nbcos/arreast24byco/nbcoverdue/wo/wocolgb — see
// lib/creditreport-report.js on the backend for the exact formulas).
//
// UI note: instead of one 36-column table requiring constant
// horizontal scroll, the person picks ONE metric group at a time
// (crSection dropdown) and only that group's columns render, with
// Branch pinned as the sticky first column. Data is fetched once and
// cached in crData — switching sections just re-renders, no refetch.
// ========================================

const crToken =
    localStorage.getItem("token") ||
    sessionStorage.getItem("token");

let crMode = "summary"; // "summary" | "detailed"
let crSummaryData = null;  // { items, total } from /api/creditreport/summary
let crDetailedData = null; // { groups, grand } from /api/creditreport/detailed — fetched lazily

// ========================================
// SECTION DEFINITIONS
// Each field's `key` is a dot-path into a branch item (or `total`).
// money:true -> thousands-formatted number. pct:true -> XX.XX%.
// ========================================
function crGroupPct(prefix, label, labelKh) {
    return {
        label, labelKh,
        fields: [
            { key: prefix + ".count", label: "# Loan" },
            { key: prefix + ".value", label: "Value", money: true },
            { key: prefix + ".parPct", label: "PAR %", pct: true }
        ]
    };
}

const CR_SECTIONS = {
    outstanding: {
        groups: [{
            label: "Loan Outstanding", labelKh: "សមតុល្យឥណទាន",
            fields: [
                { key: "loanOutstanding.loan", label: "# Loan" },
                { key: "loanOutstanding.client", label: "# Client" },
                { key: "loanOutstanding.value", label: "Value", money: true }
            ]
        }]
    },
    disburse: {
        groups: [{
            label: "Loan Disburse",
            fields: [
                { key: "loanDisburse.loan", label: "# Loan" },
                { key: "loanDisburse.value", label: "Value", money: true }
            ]
        }]
    },
    parT24: {
        groups: [{
            label: "Balance Loan at Risk (T24)",
            fields: [
                { key: "parT24.loan", label: "# Loan" },
                { key: "parT24.value", label: "Value", money: true },
                { key: "parT24.parPct", label: "PAR %", pct: true }
            ]
        }]
    },
    nbcOverdue: {
        groups: [
            crGroupPct("nbcOverdue.minor", "Minor Default"),
            crGroupPct("nbcOverdue.specialMention", "Special Mention"),
            crGroupPct("nbcOverdue.subStandard", "Sub-Standard"),
            crGroupPct("nbcOverdue.doubtful", "Doubtful"),
            crGroupPct("nbcOverdue.loss", "Loss"),
            crGroupPct("nbcOverdue.majorDefault", "Major Default"),
            crGroupPct("nbcOverdue.nonPerformingLoan", "Non Performing Loan"),
            crGroupPct("nbcOverdue.total", "Total NBC Overdue")
        ]
    },
    writeOff: {
        groups: [
            {
                label: "Balance WO",
                fields: [
                    { key: "writeOff.balanceWO.cif", label: "# (cif)" },
                    { key: "writeOff.balanceWO.int", label: "Int", money: true },
                    { key: "writeOff.balanceWO.prn", label: "Prn", money: true }
                ]
            },
            {
                label: "WO",
                fields: [
                    { key: "writeOff.wo.count", label: "#" },
                    { key: "writeOff.wo.prn", label: "Prn", money: true }
                ]
            },
            {
                label: "WO Collected",
                fields: [
                    { key: "writeOff.woCollected.int", label: "Int", money: true },
                    { key: "writeOff.woCollected.prn", label: "Prn", money: true }
                ]
            }
        ]
    }
};

// ========================================
// DATE HELPERS
// ========================================
function crToDMY(dateStr) {
    if (!dateStr) return "";
    const [y, m, d] = dateStr.split("-");
    return `${d}-${m}-${y}`;
}

function crSetDefaultDates() {
    const now = new Date();
    const y = now.getFullYear();
    const firstOfMonth = `${y}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    const today = now.toISOString().slice(0, 10);
    const yearStart = `${y}-01-01`;
    const yearEnd = `${y}-12-31`;
    document.getElementById("crFromDate").value = firstOfMonth;
    document.getElementById("crToDate").value = today;
    document.getElementById("crWoFromDate").value = yearStart;
    document.getElementById("crWoToDate").value = yearEnd;
}
crSetDefaultDates();

// ========================================
// FORMAT HELPERS
// ========================================
function crFmtNum(n) {
    n = Number(n) || 0;
    return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}
function crFmtPct(n) {
    n = Number(n) || 0;
    return (n * 100).toFixed(2) + "%";
}
function crGetByPath(obj, path) {
    return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function crFmtField(item, field) {
    const v = crGetByPath(item, field.key);
    const cls = crFieldClass(field);
    if (field.pct) {
        const n = Number(v) || 0;
        const parCls = n >= 0.05 ? " cr-par-high" : "";
        return `<td class="${cls}${parCls}">${crFmtPct(n)}</td>`;
    }
    return `<td class="${cls}">${crFmtNum(v)}</td>`;
}

// ========================================
// RENDER: build thead + tbody for the selected section
// ========================================
function crFieldClass(field) {
    if (field.pct) return "cr-col-pct";
    if (field.money) return "cr-col-money";
    return "cr-col-num";
}

function crBuildThead(section, withTeamCol) {
    const groupCells = section.groups.map(g =>
        `<th colspan="${g.fields.length}">${g.label}</th>`
    ).join("");

    const subCells = section.groups.map(g =>
        g.fields.map(f => `<th class="${crFieldClass(f)}">${f.label}</th>`).join("")
    ).join("");

    const leadCol = withTeamCol
        ? `<th rowspan="2" class="cr-detail-team-col">Team</th><th rowspan="2" class="cr-detail-branch-col">Branch</th>`
        : `<th rowspan="2" class="cr-branch-col">Branch</th>`;

    return `
      <tr class="cr-group-row">
        ${leadCol}
        ${groupCells}
      </tr>
      <tr class="cr-sub-row">
        ${subCells}
      </tr>`;
}

function crBuildRow(item, section, isTotal) {
    const cells = section.groups.map(g =>
        g.fields.map(f => crFmtField(item, f)).join("")
    ).join("");
    return `
      <tr${isTotal ? ' class="cr-total-row"' : ""}>
        <td class="cr-branch-col">${isTotal ? "*** Total" : item.branch}</td>
        ${cells}
      </tr>`;
}

// team: "CO" | "FSRO" | "Total". branchLabel is repeated on every row
// (no rowspan merge) to keep the render logic simple.
function crBuildDetailedRow(item, section, branchLabel, team, isBranchTotal, isGrandRow) {
    const cells = section.groups.map(g =>
        g.fields.map(f => crFmtField(item, f)).join("")
    ).join("");
    let rowClass = "";
    if (isGrandRow) rowClass = ' class="cr-total-row"';
    else if (isBranchTotal) rowClass = ' class="cr-branch-total-row"';
    return `
      <tr${rowClass}>
        <td class="cr-detail-team-col">${team}</td>
        <td class="cr-detail-branch-col">${branchLabel}</td>
        ${cells}
      </tr>`;
}

function crRenderSummary() {
    if (!crSummaryData) return;
    const sectionKey = document.getElementById("crSection").value;
    const section = CR_SECTIONS[sectionKey];

    document.getElementById("crThead").innerHTML = crBuildThead(section, false);
    document.getElementById("crTbody").innerHTML =
        crSummaryData.items.map(it => crBuildRow(it, section, false)).join("") +
        crBuildRow(crSummaryData.total, section, true);

    document.getElementById("crRenderedCountNote").textContent = `${crSummaryData.items.length} branches`;
    requestAnimationFrame(crSetHeaderOffsets);
}

function crRenderDetailed() {
    if (!crDetailedData) return;
    const sectionKey = document.getElementById("crSection").value;
    const section = CR_SECTIONS[sectionKey];

    document.getElementById("crThead").innerHTML = crBuildThead(section, true);

    const rowsHtml = crDetailedData.groups.map(g => {
        const [co, fsro, total] = g.rows;
        return (
            crBuildDetailedRow(co, section, g.branch, "CO", false, false) +
            crBuildDetailedRow(fsro, section, g.branch, "FSRO", false, false) +
            crBuildDetailedRow(total, section, g.branch, "Total", true, false)
        );
    }).join("");

    const grand = crDetailedData.grand;
    const grandHtml =
        crBuildDetailedRow(grand.co, section, "All", "CO", false, false) +
        crBuildDetailedRow(grand.fsro, section, "All", "FSRO", false, false) +
        crBuildDetailedRow(grand.total, section, "All", "Total", false, true);

    document.getElementById("crTbody").innerHTML = rowsHtml + grandHtml;
    document.getElementById("crRenderedCountNote").textContent = `${crDetailedData.groups.length} branches × CO/FSRO/Total`;
    requestAnimationFrame(crSetHeaderOffsets);
}

function crRenderSection() {
    if (crMode === "detailed") crRenderDetailed();
    else crRenderSummary();
}
document.getElementById("crSection").addEventListener("change", crRenderSection);

// ========================================
// STICKY HEADER OFFSET
// The sub-header row must stick right under the group-header row,
// but the group row's height changes with text wrapping — measure
// the real rendered height instead of guessing a fixed px value.
// ========================================
function crSetHeaderOffsets() {
    const groupRow = document.querySelector("#crTable thead tr.cr-group-row");
    const subRow = document.querySelector("#crTable thead tr.cr-sub-row");
    if (!groupRow || !subRow) return;
    const h = groupRow.getBoundingClientRect().height;
    subRow.querySelectorAll("th").forEach(th => { th.style.top = h + "px"; });
}
window.addEventListener("resize", crSetHeaderOffsets);
window.addEventListener("orientationchange", () => setTimeout(crSetHeaderOffsets, 200));

// ========================================
// LOADING STATE
// ========================================
function crShowLoading() {
    document.getElementById("crSkeleton").style.display = "block";
    document.getElementById("crTableScroll").style.display = "none";
    document.getElementById("crEmptyMsg").style.display = "none";
    const btn = document.getElementById("btnCrRun");
    btn.classList.add("loading");
    btn.disabled = true;
}
function crHideLoading() {
    document.getElementById("crSkeleton").style.display = "none";
    const btn = document.getElementById("btnCrRun");
    btn.classList.remove("loading");
    btn.disabled = false;
}
function crShowEmpty(msg) {
    const empty = document.getElementById("crEmptyMsg");
    empty.textContent = msg;
    empty.style.display = "block";
    document.getElementById("crTableScroll").style.display = "none";
}

// ========================================
// LOAD REPORT
// ========================================
async function crRunReport() {
    crShowLoading();

    const fromDate = crToDMY(document.getElementById("crFromDate").value);
    const toDate = crToDMY(document.getElementById("crToDate").value);
    const woFromDate = crToDMY(document.getElementById("crWoFromDate").value);
    const woToDate = crToDMY(document.getElementById("crWoToDate").value);

    document.getElementById("crPeriodLabel").textContent =
        `Loan Disbursement ${fromDate} to ${toDate}  ·  Write Off ${woFromDate} to ${woToDate}`;

    // Dates changed — any cached Detailed data is now stale.
    crDetailedData = null;

    try {
        const url = `${API.BASE_URL}/api/creditreport/summary?fromDate=${fromDate}&toDate=${toDate}&woFromDate=${woFromDate}&woToDate=${woToDate}`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${crToken}` } });
        const data = await res.json();

        crHideLoading();

        if (!data.ok) {
            crShowEmpty(data.message || "Failed to load report.");
            return;
        }
        if (!data.items || !data.items.length) {
            crShowEmpty("No data.");
            return;
        }

        crSummaryData = data;
        document.getElementById("crTableScroll").style.display = "block";

        if (crMode === "detailed") {
            await crEnsureDetailedLoaded();
        } else {
            crRenderSection();
        }
    } catch (e) {
        console.error(e);
        crHideLoading();
        crShowEmpty("Network error loading report.");
    }
}
document.getElementById("btnCrRun").addEventListener("click", crRunReport);

// ========================================
// DETAILED REPORT — fetched lazily (only when the Detailed tab is
// actually opened) since it's a heavier query than Summary and most
// visits probably never need the CO/FSRO breakdown.
// ========================================
async function crEnsureDetailedLoaded() {
    if (crDetailedData) {
        crRenderSection();
        return;
    }
    crShowLoading();

    const fromDate = crToDMY(document.getElementById("crFromDate").value);
    const toDate = crToDMY(document.getElementById("crToDate").value);
    const woFromDate = crToDMY(document.getElementById("crWoFromDate").value);
    const woToDate = crToDMY(document.getElementById("crWoToDate").value);

    try {
        const url = `${API.BASE_URL}/api/creditreport/detailed?fromDate=${fromDate}&toDate=${toDate}&woFromDate=${woFromDate}&woToDate=${woToDate}`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${crToken}` } });
        const data = await res.json();

        crHideLoading();

        if (!data.ok) {
            crShowEmpty(data.message || "Failed to load detailed report.");
            return;
        }
        if (!data.groups || !data.groups.length) {
            crShowEmpty("No data.");
            return;
        }

        crDetailedData = data;
        document.getElementById("crTableScroll").style.display = "block";
        crRenderSection();
    } catch (e) {
        console.error(e);
        crHideLoading();
        crShowEmpty("Network error loading detailed report.");
    }
}

// ========================================
// VIEW TOGGLE (Summary / Detailed)
// mirrors the VBA Worksheet_Change row show/hide logic as a tab switch
// ========================================
document.querySelectorAll(".cr-tab").forEach(tab => {
    tab.addEventListener("click", () => {
        document.querySelectorAll(".cr-tab").forEach(t => t.classList.remove("active"));
        tab.classList.add("active");
        crMode = tab.dataset.view;

        if (crMode === "detailed") {
            crEnsureDetailedLoaded();
        } else {
            crRenderSection();
        }
    });
});

// ========================================
// EXPORT EXCEL (exports the currently visible section)
// ========================================
function crExportExcel() {
    if (typeof XLSX === "undefined") return;
    const ws = XLSX.utils.table_to_sheet(document.getElementById("crTable"));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "CreditReport");
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    XLSX.writeFile(wb, `CreditReport_${stamp}.xlsx`);
}
document.getElementById("btnCrExport")?.addEventListener("click", crExportExcel);

// ========================================
// EXPORT PDF
// ========================================
async function crExportPdf() {
    if (typeof html2canvas === "undefined" || typeof window.jspdf === "undefined") return;
    const el = document.querySelector(".table-card");
    if (!el) return;
    const canvas = await html2canvas(el, { scale: 2, backgroundColor: "#ffffff" });
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const imgHeight = (canvas.height * pageWidth) / canvas.width;
    pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, pageWidth, imgHeight);
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    pdf.save(`CreditReport_${stamp}.pdf`);
}
document.getElementById("btnCrExportPdf")?.addEventListener("click", crExportPdf);

// ========================================
// PRINT
// ========================================
document.getElementById("btnCrPrint")?.addEventListener("click", () => window.print());

// ========================================
// "..." MENU TOGGLE
// ========================================
document.getElementById("btnCrMenu")?.addEventListener("click", () => {
    document.getElementById("crMenuDropdown")?.classList.toggle("show");
});

// ========================================
// INIT
// ========================================
crRunReport();
