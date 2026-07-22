// ========================================
// Credit Report — "RepDetail byBranch" Summary Report web port
// Reads from GET /api/creditreport/summary (computed live from
// nbcos/arreast24byco/nbcoverdue/wo/wocolgb — see
// lib/creditreport-report.js on the backend for the exact formulas).
// ========================================

const crToken =
    localStorage.getItem("token") ||
    sessionStorage.getItem("token");

const crTbody = document.getElementById("crTbody");
const crRenderedCountNote = document.getElementById("crRenderedCountNote");

// ========================================
// DATE HELPERS
// ========================================
function crToDMY(dateStr) {
    // <input type="date"> gives yyyy-mm-dd
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
function crParClass(pct) {
    return pct >= 0.05 ? "cr-par-high" : "";
}
function crCvCells(cv) {
    return `<td>${crFmtNum(cv.count)}</td><td>${crFmtNum(cv.value)}</td>`;
}
function crCvpCells(cvp) {
    return `<td>${crFmtNum(cvp.count)}</td><td>${crFmtNum(cvp.value)}</td><td class="${crParClass(cvp.parPct)}">${crFmtPct(cvp.parPct)}</td>`;
}

function crRowHtml(it, isTotal) {
    const n = it.nbcOverdue;
    const w = it.writeOff;
    return `
      <tr${isTotal ? ' class="cr-total-row"' : ""}>
        <td class="cr-branch-cell">${isTotal ? "*** Total" : it.branch}</td>
        <td>${crFmtNum(it.loanOutstanding.loan)}</td><td>${crFmtNum(it.loanOutstanding.client)}</td><td>${crFmtNum(it.loanOutstanding.value)}</td>
        <td>${crFmtNum(it.loanDisburse.loan)}</td><td>${crFmtNum(it.loanDisburse.value)}</td>
        ${crCvpCells(it.parT24)}
        ${crCvpCells(n.minor)}
        ${crCvpCells(n.specialMention)}
        ${crCvpCells(n.subStandard)}
        ${crCvpCells(n.doubtful)}
        ${crCvpCells(n.loss)}
        ${crCvpCells(n.majorDefault)}
        ${crCvpCells(n.nonPerformingLoan)}
        ${crCvpCells(n.total)}
        <td>${crFmtNum(w.balanceWO.cif)}</td><td>${crFmtNum(w.balanceWO.int)}</td><td>${crFmtNum(w.balanceWO.prn)}</td>
        <td>${crFmtNum(w.wo.count)}</td><td>${crFmtNum(w.wo.prn)}</td>
        <td>${crFmtNum(w.woCollected.int)}</td><td>${crFmtNum(w.woCollected.prn)}</td>
      </tr>`;
}

// ========================================
// LOAD REPORT
// ========================================
async function crRunReport() {
    crTbody.innerHTML = `<tr class="row-loading"><td colspan="36">Loading...</td></tr>`;
    crRenderedCountNote.textContent = "";

    const fromDate = crToDMY(document.getElementById("crFromDate").value);
    const toDate = crToDMY(document.getElementById("crToDate").value);
    const woFromDate = crToDMY(document.getElementById("crWoFromDate").value);
    const woToDate = crToDMY(document.getElementById("crWoToDate").value);

    document.getElementById("crDisbHeader").innerHTML = `Loan Disburse<br><span class="th-kh">${fromDate} to ${toDate}</span>`;
    document.getElementById("crWoHeader").innerHTML = `WO<br><span class="th-kh">${woFromDate} to ${woToDate}</span>`;
    document.getElementById("crDisbPeriodLabel").textContent = `${fromDate} to ${toDate}`;
    document.getElementById("crWoPeriodLabel").textContent = `${woFromDate} to ${woToDate}`;

    try {
        const url = `${API.BASE_URL}/api/creditreport/summary?fromDate=${fromDate}&toDate=${toDate}&woFromDate=${woFromDate}&woToDate=${woToDate}`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${crToken}` } });
        const data = await res.json();

        if (!data.ok) {
            crTbody.innerHTML = `<tr class="row-empty"><td colspan="36">${data.message || "Failed to load report."}</td></tr>`;
            return;
        }

        if (!data.items || !data.items.length) {
            crTbody.innerHTML = `<tr class="row-empty"><td colspan="36">No data.</td></tr>`;
            return;
        }

        crTbody.innerHTML = data.items.map(it => crRowHtml(it, false)).join("")
            + crRowHtml(data.total, true);

        crRenderedCountNote.textContent = `${data.items.length} branches`;
    } catch (e) {
        console.error(e);
        crTbody.innerHTML = `<tr class="row-empty"><td colspan="36">Network error loading report.</td></tr>`;
    }
}

document.getElementById("btnCrRun").addEventListener("click", crRunReport);

// ========================================
// VIEW TOGGLE (Summary / Detailed)
// mirrors the VBA Worksheet_Change row show/hide logic as a tab switch
// ========================================
document.querySelectorAll(".cr-tab").forEach(tab => {
    tab.addEventListener("click", () => {
        document.querySelectorAll(".cr-tab").forEach(t => t.classList.remove("active"));
        tab.classList.add("active");
        const view = tab.dataset.view;
        const note = document.getElementById("crDetailedNote");
        const tableCard = document.querySelector(".table-card");
        if (view === "detailed") {
            note.style.display = "block";
            tableCard.style.display = "none";
        } else {
            note.style.display = "none";
            tableCard.style.display = "";
        }
    });
});

// ========================================
// EXPORT EXCEL
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
