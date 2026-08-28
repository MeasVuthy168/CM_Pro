// ========================================
// Daily Monitoring by Officer — "RepDetail byCO" web port
// Reads GET /api/creditreport/byco (see lib/creditreport-co.js for the
// column mapping behind each figure).
//
// One row per credit officer. Team / ID / Branch are used for filtering
// and sorting but deliberately NOT rendered — only the officer's name
// leads each row, matching the Excel sheet's hidden columns.
// ========================================

const crToken =
    localStorage.getItem("token") ||
    sessionStorage.getItem("token");

const CR_PAR_ALERT = 0.04; // PAR % at or above this renders red

let crData = null; // last successful /byco response

// ========================================
// SECTIONS
// ========================================
function crGroupPct(prefix, label) {
    return {
        label,
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
            crGroupPct("nbcOverdue.totalOwn", "Total NBC Overdue_ផ្ទាល់ខ្លួន"),
            crGroupPct("nbcOverdue.totalArea", "Total NBC Overdue_ក្នុងតំបន់")
        ]
    },
    writeOff: {
        groups: [
            {
                label: "Balance WO_ផ្ទាល់ខ្លួន",
                fields: [
                    { key: "writeOffOwn.balanceWO.count", label: "#" },
                    { key: "writeOffOwn.balanceWO.int", label: "Int", money: true },
                    { key: "writeOffOwn.balanceWO.prn", label: "Prn", money: true }
                ]
            },
            {
                label: "WO_ផ្ទាល់ខ្លួន",
                fields: [
                    { key: "writeOffOwn.wo.count", label: "#" },
                    { key: "writeOffOwn.wo.prn", label: "Prn", money: true }
                ]
            },
            {
                label: "WO Collected_ផ្ទាល់ខ្លួន",
                fields: [
                    { key: "writeOffOwn.woCollected.int", label: "Int", money: true },
                    { key: "writeOffOwn.woCollected.prn", label: "Prn", money: true }
                ]
            },
            {
                label: "Balance WO_ក្នុងតំបន់",
                fields: [
                    { key: "writeOffArea.balanceWO.count", label: "#" },
                    { key: "writeOffArea.balanceWO.int", label: "Int", money: true },
                    { key: "writeOffArea.balanceWO.prn", label: "Prn", money: true }
                ]
            },
            {
                label: "WO_ក្នុងតំបន់",
                fields: [
                    { key: "writeOffArea.wo.count", label: "#" },
                    { key: "writeOffArea.wo.prn", label: "Prn", money: true }
                ]
            },
            {
                label: "WO Collected_ក្នុងតំបន់",
                fields: [
                    { key: "writeOffArea.woCollected.int", label: "Int", money: true },
                    { key: "writeOffArea.woCollected.prn", label: "Prn", money: true }
                ]
            }
        ]
    }
};
CR_SECTIONS.all = {
    groups: [
        ...CR_SECTIONS.outstanding.groups,
        ...CR_SECTIONS.disburse.groups,
        ...CR_SECTIONS.parT24.groups,
        ...CR_SECTIONS.nbcOverdue.groups,
        ...CR_SECTIONS.writeOff.groups
    ]
};

// ========================================
// HELPERS
// ========================================
function crToDMY(dateStr) {
    if (!dateStr) return "";
    const [y, m, d] = dateStr.split("-");
    return `${d}-${m}-${y}`;
}
function crFmtDateDMY(yyyymmdd) {
    if (!yyyymmdd) return "-";
    const [y, m, d] = yyyymmdd.split("-");
    return `${d}-${m}-${y}`;
}
// table_to_sheet() reads raw DOM text (officer names among it) straight
// into cells — Excel treats a cell string starting with =, +, -, @, or a
// tab/CR as a formula when the file is opened, so this neutralizes any
// such string cell (a leading apostrophe forces plain text) before the
// workbook is written. Only touches string cells (t:"s"); numeric report
// figures are untouched.
function crSanitizeSheetFormulas(ws) {
    if (!ws["!ref"]) return;
    const range = XLSX.utils.decode_range(ws["!ref"]);
    for (let r = range.s.r; r <= range.e.r; r++) {
        for (let c = range.s.c; c <= range.e.c; c++) {
            const cell = ws[XLSX.utils.encode_cell({ r, c })];
            if (cell && cell.t === "s" && /^[=+\-@\t\r]/.test(cell.v)) {
                cell.v = `'${cell.v}`;
                if (cell.w) cell.w = cell.v;
            }
        }
    }
}

function crEscapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text == null ? "" : String(text);
    return div.innerHTML.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
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
function crFieldClass(f) {
    if (f.pct) return "cr-col-pct";
    if (f.money) return "cr-col-money";
    return "cr-col-num";
}
function crFmtField(item, field) {
    const v = crGetByPath(item, field.key);
    const cls = crFieldClass(field);
    if (field.pct) {
        const n = Number(v) || 0;
        const alert = n >= CR_PAR_ALERT ? " cr-par-high" : "";
        return `<td class="${cls}${alert}">${crFmtPct(n)}</td>`;
    }
    return `<td class="${cls}">${crFmtNum(v)}</td>`;
}

// ========================================
// RENDER
// ========================================
function crBuildThead(section) {
    const groupCells = section.groups.map(g =>
        `<th colspan="${g.fields.length}">${g.label}</th>`
    ).join("");
    const subCells = section.groups.map(g =>
        g.fields.map(f => `<th class="${crFieldClass(f)}">${f.label}</th>`).join("")
    ).join("");

    return `
      <tr class="cr-group-row">
        <th rowspan="2" class="cr-name-col">Name</th>
        ${groupCells}
      </tr>
      <tr class="cr-sub-row">${subCells}</tr>`;
}

function crBuildRow(item, section, isTotal, idx) {
    const cells = section.groups.map(g =>
        g.fields.map(f => crFmtField(item, f)).join("")
    ).join("");
    const nameCell = isTotal
        ? "Total"
        : `<button type="button" class="cr-officer-link" data-idx="${idx}">${crEscapeHtml(item.name)}</button>`;
    return `
      <tr${isTotal ? ' class="cr-total-row"' : ""}>
        <td class="cr-name-col">${nameCell}</td>
        ${cells}
      </tr>`;
}

function crRenderSection() {
    if (!crData) return;
    const section = CR_SECTIONS[document.getElementById("crSection").value];

    document.getElementById("crThead").innerHTML = crBuildThead(section);
    document.getElementById("crTbody").innerHTML =
        crData.items.map((it, idx) => crBuildRow(it, section, false, idx)).join("") +
        crBuildRow(crData.total, section, true);

    requestAnimationFrame(crSetHeaderOffsets);
}

// ========================================
// OFFICER DRILL-DOWN
// Clicking an officer's name hands the row's already-fetched data
// (crData.items[idx]) plus the report's current filters to
// OfficerProductivity.html via sessionStorage — see that page's own
// header comment for why (instant first paint, no refetch) and its
// fallback path if this cache is missing/stale.
// ========================================
document.getElementById("crTbody").addEventListener("click", (e) => {
    const link = e.target.closest(".cr-officer-link");
    if (!link || !crData) return;
    const item = crData.items[Number(link.dataset.idx)];
    if (!item) return;

    const meta = {
        branch: document.getElementById("crBranch").value,
        team: document.getElementById("crTeam").value,
        fromDate: document.getElementById("crFromDate").value,
        toDate: document.getElementById("crToDate").value,
        woFromDate: document.getElementById("crWoFromDate").value,
        woToDate: document.getElementById("crWoToDate").value
    };
    sessionStorage.setItem("cr_officer_detail", JSON.stringify({ officer: item, meta }));

    const q = new URLSearchParams({
        name: item.name,
        branch: meta.branch,
        team: meta.team,
        fromDate: meta.fromDate,
        toDate: meta.toDate,
        woFromDate: meta.woFromDate,
        woToDate: meta.woToDate
    });
    location.href = `OfficerProductivity.html?${q.toString()}`;
});

// Sub-header row sticks under the group row; the group row's height
// varies with text wrapping, so it's measured rather than hardcoded.
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
// LOADING STATES
// ========================================
function crShowLoading(message = "Loading Report Data...") {
    document.getElementById("crSkeleton").style.display = "block";
    document.getElementById("crTableScroll").style.display = "none";
    document.getElementById("crEmptyMsg").style.display = "none";
    document.getElementById("btnCrRun").disabled = true;
    if (typeof showAppLoading === "function") showAppLoading(message);
}
function crHideLoading() {
    document.getElementById("crSkeleton").style.display = "none";
    document.getElementById("btnCrRun").disabled = false;
    if (typeof hideAppLoading === "function") hideAppLoading();
}
function crShowEmpty(msg) {
    const el = document.getElementById("crEmptyMsg");
    el.textContent = msg;
    el.style.display = "block";
    document.getElementById("crTableScroll").style.display = "none";
}

// ========================================
// LOAD
// ========================================
// Dates start empty; omitting them lets the server derive its defaults
// from the data (latest OS disbursement date) and echo back what it used.
function crBuildQuery() {
    const parts = [];
    const addDate = (param, id) => {
        const v = document.getElementById(id).value;
        if (v) parts.push(`${param}=${crToDMY(v)}`);
    };
    addDate("fromDate", "crFromDate");
    addDate("toDate", "crToDate");
    addDate("woFromDate", "crWoFromDate");
    addDate("woToDate", "crWoToDate");

    parts.push(`branch=${encodeURIComponent(document.getElementById("crBranch").value)}`);
    parts.push(`team=${encodeURIComponent(document.getElementById("crTeam").value)}`);
    return `?${parts.join("&")}`;
}

let crDatesInitialised = false;
function crApplyServerDates(data) {
    if (crDatesInitialised) return;
    const set = (id, v) => { if (v) document.getElementById(id).value = v; };
    set("crFromDate", data.fromDate);
    set("crToDate", data.toDate);
    set("crWoFromDate", data.woFromDate);
    set("crWoToDate", data.woToDate);
    crDatesInitialised = true;
}

let crBranchesInitialised = false;
function crPopulateBranches(list) {
    if (crBranchesInitialised || !Array.isArray(list)) return;
    const sel = document.getElementById("crBranch");
    for (const b of list) {
        const opt = document.createElement("option");
        opt.value = b;
        opt.textContent = b;
        sel.appendChild(opt);
    }
    crBranchesInitialised = true;
}

async function crRunReport() {
    crShowLoading();
    try {
        const res = await fetch(`${API.BASE_URL}/api/creditreport/byco${crBuildQuery()}`, {
            headers: { Authorization: `Bearer ${crToken}` }
        });
        const data = await res.json();
        crHideLoading();

        if (!data.ok) {
            crShowEmpty(data.message || "Failed to load report.");
            return;
        }

        crApplyServerDates(data);
        crPopulateBranches(data.branches);

        // Pre-formatted server-side (dd/mm/yyyy, plus HH:MM where the
        // source cell carried a time) — no client-side reformatting.
        const meta = data.meta || {};
        document.getElementById("crOsGridMerge").textContent = meta.osGridMergeText || "-";
        document.getElementById("crOverdueGridMerge").textContent = meta.overdueGridMergeText || "-";
        document.getElementById("crArrearsPenalty").textContent = meta.arrearsPenaltyText || "-";

        document.getElementById("crDisbPeriod").textContent =
            `${crFmtDateDMY(data.fromDate)} to ${crFmtDateDMY(data.toDate)}`;
        document.getElementById("crWoPeriod").textContent =
            `${crFmtDateDMY(data.woFromDate)} to ${crFmtDateDMY(data.woToDate)}`;
        document.getElementById("crOfficerCount").textContent =
            `${(data.items || []).length}`;

        if (!data.items || !data.items.length) {
            crShowEmpty("No officers match these filters.");
            return;
        }

        crData = data;
        document.getElementById("crTableScroll").style.display = "block";
        crRenderSection();
    } catch (e) {
        console.error(e);
        crHideLoading();
        crShowEmpty("Network error loading report.");
    }
}

// Section switching is local (no refetch); branch/team are applied
// server-side, so those do need a round trip.
document.getElementById("crSection").addEventListener("change", crRenderSection);
document.getElementById("crBranch").addEventListener("change", crRunReport);
document.getElementById("crTeam").addEventListener("change", crRunReport);

// ========================================
// DATE PANEL
// ========================================
const crDatePanel = document.getElementById("crDatePanel");
const btnCrToggleDates = document.getElementById("btnCrToggleDates");

function crSetDatePanelOpen(open) {
    crDatePanel.classList.toggle("open", open);
    btnCrToggleDates.classList.toggle("open", open);
    btnCrToggleDates.setAttribute("aria-expanded", open ? "true" : "false");
}
btnCrToggleDates.addEventListener("click", () => {
    crSetDatePanelOpen(!crDatePanel.classList.contains("open"));
});
document.getElementById("btnCrRun").addEventListener("click", () => {
    crRunReport();
    crSetDatePanelOpen(false);
});

// ========================================
// MESSAGE HELPER
// ========================================
function notify(message, type = "info") {
    if (typeof showToast === "function") showToast(message, type);
    else alert(message);
}

// ========================================
// EXPORT EXCEL
// ========================================
document.getElementById("btnCrExport")?.addEventListener("click", () => {
    if (typeof XLSX === "undefined") {
        notify("Excel export library failed to load.", "error");
        return;
    }
    if (!document.getElementById("crTbody").children.length) {
        notify("Nothing to export.", "warning");
        return;
    }
    const ws = XLSX.utils.table_to_sheet(document.getElementById("crTable"));
    crSanitizeSheetFormulas(ws);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "ByOfficer");
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "");
    XLSX.writeFile(wb, `MonitoringByOfficer_${stamp}.xlsx`);
    document.getElementById("crMenuDropdown")?.classList.remove("show");
});

// ========================================
// EXPORT PDF
// html2canvas only captures what's laid out at the current viewport
// width, so every container is temporarily forced to its full natural
// width — otherwise columns past the horizontal scroll are cropped out.
// Page slicing cuts only at row boundaries so no row is split in half.
// ========================================
function extractPrintCss() {
    let css = "";
    for (const sheet of document.styleSheets) {
        let rules;
        try { rules = sheet.cssRules; } catch (e) { continue; } // cross-origin
        for (const rule of rules) {
            if (rule.type === CSSRule.MEDIA_RULE && rule.media.mediaText.includes("print")) {
                for (const inner of rule.cssRules) css += inner.cssText + "\n";
            }
        }
    }
    return css;
}

document.getElementById("btnCrExportPdf")?.addEventListener("click", async () => {
    document.getElementById("crMenuDropdown")?.classList.remove("show");
    if (typeof html2canvas === "undefined" || typeof window.jspdf === "undefined") {
        notify("PDF export library failed to load.", "error");
        return;
    }
    if (!document.getElementById("crTbody").children.length) {
        notify("Nothing to export.", "warning");
        return;
    }
    if (typeof showAppLoading === "function") showAppLoading("Generating PDF...");

    const tempStyle = document.createElement("style");
    tempStyle.textContent = extractPrintCss() + `
        html, body { overflow-x: visible !important; width: max-content !important; }
        .page-container { width: max-content !important; min-width: 100%; overflow: visible !important; }
        .table-card { width: max-content !important; overflow: visible !important; }
        .table-scroll { width: max-content !important; max-width: none !important; overflow: visible !important; }
        .table-card table { width: max-content !important; }
    `;
    document.head.appendChild(tempStyle);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    try {
        const container = document.querySelector(".page-container");
        const thead = document.querySelector(".table-card thead");
        const rows = Array.from(document.querySelectorAll(".table-card tbody tr"));

        const SCALE = 2;
        const full = await html2canvas(container, { scale: SCALE, backgroundColor: "#ffffff" });
        const headCanvas = thead ? await html2canvas(thead, { scale: SCALE, backgroundColor: "#ffffff" }) : null;

        const pageW = 297, pageH = 210, margin = 10;
        const usableW = pageW - margin * 2;
        const usableH = pageH - margin * 2;
        const sliceH = full.width * (usableH / usableW);

        const cRect = container.getBoundingClientRect();
        const bounds = rows.map(tr => (tr.getBoundingClientRect().bottom - cRect.top) * SCALE);
        const headH = headCanvas ? headCanvas.height : 0;

        const slices = [];
        let start = 0, first = true;
        while (start < full.height - 2) {
            const avail = first ? sliceH : sliceH - headH;
            let end = start + avail;
            let cut = end;
            for (const b of bounds) if (b > start && b <= end) cut = b;
            if (cut <= start) cut = Math.min(end, full.height);
            slices.push({ start, end: Math.min(cut, full.height), repeatHeader: !first });
            start = cut;
            first = false;
        }

        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

        slices.forEach((s, i) => {
            if (i > 0) pdf.addPage();
            const h = s.end - s.start;
            const canvas = document.createElement("canvas");
            canvas.width = full.width;
            canvas.height = h + (s.repeatHeader ? headH : 0);
            const ctx = canvas.getContext("2d");
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            let y = 0;
            if (s.repeatHeader && headCanvas) { ctx.drawImage(headCanvas, 0, 0); y = headH; }
            ctx.drawImage(full, 0, s.start, full.width, h, 0, y, full.width, h);

            const imgH = usableW * (canvas.height / canvas.width);
            pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", margin, margin, usableW, imgH);
        });

        pdf.save(`MonitoringByOfficer_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}.pdf`);
    } catch (err) {
        console.error("[export pdf] failed:", err);
        notify("Could not generate the PDF.", "error");
    } finally {
        tempStyle.remove();
        void document.body.offsetHeight;
        if (typeof hideAppLoading === "function") hideAppLoading();
    }
});

// ========================================
// PRINT
// ========================================
document.getElementById("btnCrPrint")?.addEventListener("click", () => {
    window.print();
    document.getElementById("crMenuDropdown")?.classList.remove("show");
});

// ========================================
// REFRESH DATA — clears the server's row cache, then reloads.
// ========================================
document.getElementById("btnCrRefreshData")?.addEventListener("click", async () => {
    document.getElementById("crMenuDropdown")?.classList.remove("show");
    crShowLoading("Refreshing from database...");
    try {
        const res = await fetch(`${API.BASE_URL}/api/creditreport/byco/refresh`, {
            method: "POST",
            headers: { Authorization: `Bearer ${crToken}` }
        });
        const data = await res.json();
        if (!data.ok) {
            crHideLoading();
            crShowEmpty(data.message || "Could not refresh data.");
            return;
        }
        crData = null;
        await crRunReport();
    } catch (e) {
        console.error("[refresh data] failed:", e);
        crHideLoading();
        crShowEmpty("Network error refreshing data.");
    }
});

// ========================================
// "..." MENU
// ========================================
const crMenuToggle = document.getElementById("btnCrMenu");
const crMenuDropdown = document.getElementById("crMenuDropdown");
if (crMenuToggle && crMenuDropdown) {
    crMenuToggle.addEventListener("click", e => {
        e.stopPropagation();
        crMenuDropdown.classList.toggle("show");
    });
    document.addEventListener("click", e => {
        if (!crMenuDropdown.contains(e.target) && e.target !== crMenuToggle) {
            crMenuDropdown.classList.remove("show");
        }
    });
    document.addEventListener("keydown", e => {
        if (e.key === "Escape") crMenuDropdown.classList.remove("show");
    });
}

// ========================================
// LANDSCAPE
// ========================================
const crLandscapeTopBar = document.getElementById("landscapeTopBar");
const crLandscapeBottomBar = document.getElementById("landscapeBottomBar");
let crLandscapeTimer = null;

function crShowLandscapeBars() {
    crLandscapeTopBar?.classList.remove("hidden");
    crLandscapeBottomBar?.classList.remove("hidden");
    clearTimeout(crLandscapeTimer);
    crLandscapeTimer = setTimeout(() => {
        crLandscapeTopBar?.classList.add("hidden");
        crLandscapeBottomBar?.classList.add("hidden");
    }, 3000);
}

document.getElementById("btnCrLandscape")?.addEventListener("click", () => {
    document.body.classList.add("cr-force-landscape");
    const count = document.getElementById("crTbody").children.length;
    const el = document.getElementById("crLandscapeRowCount");
    if (el) el.textContent = `${count.toLocaleString()} rows`;
    crShowLandscapeBars();
    document.getElementById("crMenuDropdown")?.classList.remove("show");
});
document.getElementById("btnCrExitLandscape")?.addEventListener("click", () => {
    clearTimeout(crLandscapeTimer);
    document.body.classList.remove("cr-force-landscape");
});
document.querySelector(".table-card")?.addEventListener("click", e => {
    if (!document.body.classList.contains("cr-force-landscape")) return;
    if (e.target.closest(".landscape-bar")) return;
    crShowLandscapeBars();
});
window.addEventListener("pageshow", () => {
    clearTimeout(crLandscapeTimer);
    document.body.classList.remove("cr-force-landscape");
});

// ========================================
// INIT
// ========================================
crRunReport();
