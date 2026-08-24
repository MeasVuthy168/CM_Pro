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
// PAR % at or above this is rendered red in every PAR column.
const CR_PAR_ALERT = 0.04;

let crLoanReclass = null;  // { value, count } — rendered in the note under the T24 columns
let crBalancePD = null;    // { value, count } — the other half of that note

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
// DATE HELPERS
// ========================================
function crToDMY(dateStr) {
    if (!dateStr) return "";
    const [y, m, d] = dateStr.split("-");
    return `${d}-${m}-${y}`;
}

// Date inputs start EMPTY. On first load we send no date params at all;
// the server derives the defaults from the data itself (latest OS
// disbursement date -> 1st of that month, and Jan 1 - Dec 31 of that year
// for Write Off, mirroring the Excel formulas) and echoes back what it
// used, which we then fill in below. This avoids the client guessing
// "today" when the data's latest date may be older or newer.
let crDatesInitialised = false;

function crApplyServerDates(data) {
    if (crDatesInitialised) return;
    const set = (id, dmy) => {
        if (!dmy) return;
        // server returns yyyy-mm-dd (toDateKey), which is what <input type=date> wants
        document.getElementById(id).value = dmy;
    };
    set("crFromDate", data.fromDate);
    set("crToDate", data.toDate);
    set("crWoFromDate", data.woFromDate);
    set("crWoToDate", data.woToDate);
    crDatesInitialised = true;
}

// ========================================
// META — report "as of" dates + Loan Reclass summary.
// These come from the data, not from the filters, so they don't change
// when the person picks different dates.
// ========================================
function crRenderMeta(meta) {
    if (!meta) return;

    // These arrive pre-formatted from the server (dd/mm/yyyy, plus HH:MM
    // where the source cell carried a time) — no client-side reformatting.
    document.getElementById("crOsGridMerge").textContent = meta.osGridMergeText || "-";
    document.getElementById("crOverdueGridMerge").textContent = meta.overdueGridMergeText || "-";
    document.getElementById("crArrearsPenalty").textContent = meta.arrearsPenaltyText || "-";

    // Held for the table note — it renders under the T24 columns, not here.
    crLoanReclass = meta.loanReclass || { value: 0, count: 0 };
    crBalancePD = meta.balancePD || { value: 0, count: 0 };
}

// Shows how the T24 figure relates to Reclass and Balance PD. Rendered
// as a note under the table whenever the T24 columns are on screen,
// rather than as standalone stats in the info card.
function crRenderReclassNote(sectionKey) {
    const el = document.getElementById("crReclassNote");
    // Only on the dedicated T24 section. In "All Sections" the T24
    // columns are one group among many, so a note referring to them
    // sits too far from what it describes to be readable.
    const showsT24 = sectionKey === "parT24";

    if (!showsT24 || !crLoanReclass) {
        el.style.display = "none";
        return;
    }

    const rc = crLoanReclass;
    const pd = crBalancePD || { value: 0, count: 0 };

    // Uses the full "Balance Loan at Risk (T24)" name rather than the
    // "T24" shorthand so each line stands on its own when read aloud or
    // exported, without depending on the column header above it.
    el.innerHTML =
        `<div class="cr-note-item">` +
          `<span class="cr-note-lead">សំគាល់:</span> ` +
          `<span class="cr-note-label">Balance Loan at Risk (T24) រួមបញ្ចូល Reclass ` +
            `<span class="cr-note-value">$${crFmtNum(rc.value)} · ${crFmtNum(rc.count)} LD</span>` +
            ` និងដកចេញ Balance PD ` +
            `<span class="cr-note-value cr-note-out">$${crFmtNum(pd.value)} · ${crFmtNum(pd.count)} LD</span>` +
          `</span>` +
        `</div>` +
        `<div class="cr-note-item cr-note-warn">` +
          `<span class="cr-note-lead">ប្រុងប្រយ័ត្នៈ</span> ` +
          `<span class="cr-note-label">ឥណទាន\u200bដែលមាន Balance PD ត្រូវតែ\u200b PD ` +
            `អោយបានរួចរាល់ទាំងអស់ក្នុងថ្ងៃ\u200b ។</span>` +
        `</div>`;
    el.style.display = "";
}

function crFmtDateDMY(yyyymmdd) {
    if (!yyyymmdd) return "-";
    const [y, m, d] = yyyymmdd.split("-");
    return `${d}-${m}-${y}`;
}

// ========================================
// FORMAT HELPERS
// ========================================
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
function crFmtField(item, field) {
    const v = crGetByPath(item, field.key);
    const cls = crFieldClass(field);
    if (field.pct) {
        const n = Number(v) || 0;
        // Anything at or above 4% is flagged red across every PAR column.
        const parCls = n >= CR_PAR_ALERT ? " cr-par-high" : "";
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
        <td class="cr-branch-col">${isTotal ? "Total" : crEscapeHtml(item.branch)}</td>
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
        <td class="cr-detail-branch-col">${crEscapeHtml(branchLabel)}</td>
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

    crRenderReclassNote(sectionKey);
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
    crRenderReclassNote(sectionKey);
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
// Uses the app-wide loading overlay (shared/loading.js) rather than an
// in-button spinner — the button lives inside the collapsible date panel,
// which is usually closed, so a spinner there would often be invisible
// while the report was actually loading.
function crShowLoading(message = "Loading Report Data...") {
    document.getElementById("crSkeleton").style.display = "block";
    document.getElementById("crTableScroll").style.display = "none";
    document.getElementById("crEmptyMsg").style.display = "none";
    document.getElementById("crReclassNote").style.display = "none";
    document.getElementById("btnCrRun").disabled = true;
    if (typeof showAppLoading === "function") {
        showAppLoading(message);
    }
}
function crHideLoading() {
    document.getElementById("crSkeleton").style.display = "none";
    document.getElementById("btnCrRun").disabled = false;
    if (typeof hideAppLoading === "function") {
        hideAppLoading();
    }
}
function crShowEmpty(msg) {
    const empty = document.getElementById("crEmptyMsg");
    empty.textContent = msg;
    empty.style.display = "block";
    document.getElementById("crTableScroll").style.display = "none";
    document.getElementById("crReclassNote").style.display = "none";
}

// Builds the ?fromDate=...&toDate=... query string, OMITTING any date the
// person hasn't set. A missing param tells the server to use its own
// data-derived default rather than us guessing one client-side.
function crBuildDateQuery() {
    const parts = [];
    const add = (param, id) => {
        const v = document.getElementById(id).value;
        if (v) parts.push(`${param}=${crToDMY(v)}`);
    };
    add("fromDate", "crFromDate");
    add("toDate", "crToDate");
    add("woFromDate", "crWoFromDate");
    add("woToDate", "crWoToDate");
    return parts.length ? `?${parts.join("&")}` : "";
}

// ========================================
// LOAD REPORT
// ========================================
async function crRunReport() {
    crShowLoading();

    // Dates changed — any cached Detailed data is now stale.
    crDetailedData = null;

    try {
        const url = `${API.BASE_URL}/api/creditreport/summary${crBuildDateQuery()}`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${crToken}` } });
        const data = await res.json();

        crHideLoading();

        if (!data.ok) {
            crShowEmpty(data.message || "Failed to load report.");
            return;
        }

        // Server echoes back the dates it actually used — on first load
        // these are its data-derived defaults, so fill the empty inputs.
        crApplyServerDates(data);
        crRenderMeta(data.meta);

        document.getElementById("crDisbPeriod").textContent =
            `${crFmtDateDMY(data.fromDate)} to ${crFmtDateDMY(data.toDate)}`;
        document.getElementById("crWoPeriod").textContent =
            `${crFmtDateDMY(data.woFromDate)} to ${crFmtDateDMY(data.woToDate)}`;

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
// ========================================
// "Set Report Date" — collapses/expands the date pickers.
// Collapsed by default: the info block above already shows which
// periods are in effect, so most visits never need to open this.
// ========================================
const crDatePanel = document.getElementById("crDatePanel");
const btnCrToggleDates = document.getElementById("btnCrToggleDates");

function crSetDatePanelOpen(open) {
    crDatePanel.classList.toggle("open", open);
    btnCrToggleDates.setAttribute("aria-expanded", open ? "true" : "false");
    btnCrToggleDates.classList.toggle("open", open);
}

btnCrToggleDates.addEventListener("click", () => {
    crSetDatePanelOpen(!crDatePanel.classList.contains("open"));
});

document.getElementById("btnCrRun").addEventListener("click", () => {
    crRunReport();
    crSetDatePanelOpen(false); // collapse once applied — result is shown above
});

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

    try {
        const url = `${API.BASE_URL}/api/creditreport/detailed${crBuildDateQuery()}`;
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
// MESSAGE HELPER
// ========================================
function notify(message, type = "info") {
    if (typeof showToast === "function") {
        showToast(message, type);
    } else {
        alert(message);
    }
}

// ========================================
// EXPORT EXCEL (exports the currently visible section/view)
// ========================================
function crExportExcel() {
    if (typeof XLSX === "undefined") {
        notify("Excel export library failed to load — check your connection and try again.", "error");
        return;
    }
    const table = document.getElementById("crTable");
    if (!table || !document.getElementById("crTbody").children.length) {
        notify("Nothing to export.", "warning");
        return;
    }
    const ws = XLSX.utils.table_to_sheet(table);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "CreditReport");
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "");
    XLSX.writeFile(wb, `CreditReport_${stamp}.xlsx`);
    document.getElementById("crMenuDropdown")?.classList.remove("show");
}
document.getElementById("btnCrExport")?.addEventListener("click", crExportExcel);

// ========================================
// EXPORT PDF
// Ported from arrears.js's technique: html2canvas only captures
// whatever's on screen at current viewport width, so every level of
// container is temporarily forced to its full natural content width
// before capture (otherwise only the columns visible without
// horizontal scroll get exported). A naive fixed-height canvas slice
// per page can also cut a table row in half at a page break, so this
// measures each <tr>'s real position and only cuts between rows,
// repeating the header row on every page after the first.
// ========================================
function extractPrintCss() {
    let css = "";
    for (const sheet of document.styleSheets) {
        let rules;
        try {
            rules = sheet.cssRules;
        } catch (err) {
            continue; // cross-origin stylesheet (e.g. a CDN font) — can't read its rules, skip
        }
        for (const rule of rules) {
            if (rule.type === CSSRule.MEDIA_RULE && rule.media.mediaText.includes("print")) {
                for (const inner of rule.cssRules) {
                    css += inner.cssText + "\n";
                }
            }
        }
    }
    return css;
}

async function crExportPdf() {
    if (typeof html2canvas === "undefined" || typeof window.jspdf === "undefined") {
        notify("PDF export library failed to load — check your connection and try again.", "error");
        return;
    }
    if (!document.getElementById("crTbody").children.length) {
        notify("Nothing to export.", "warning");
        return;
    }

    if (typeof showAppLoading === "function") {
        showAppLoading("Generating PDF...");
    }

    const tempStyleEl = document.createElement("style");
    tempStyleEl.id = "pdf-export-temp-style";
    tempStyleEl.textContent = extractPrintCss() + `
        html, body { overflow-x: visible !important; width: max-content !important; }
        .page-container { width: max-content !important; min-width: 100%; overflow: visible !important; }
        .table-card { width: max-content !important; overflow: visible !important; }
        .table-scroll { width: max-content !important; max-width: none !important; overflow: visible !important; }
        .table-card table { width: max-content !important; }
    `;
    document.head.appendChild(tempStyleEl);

    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    try {
        const container = document.querySelector(".page-container");
        const thead = document.querySelector(".table-card thead");
        const rows = Array.from(document.querySelectorAll(".table-card tbody tr"));

        const SCALE = 2;
        const fullCanvas = await html2canvas(container, { scale: SCALE, backgroundColor: "#ffffff" });
        const theadCanvas = thead
            ? await html2canvas(thead, { scale: SCALE, backgroundColor: "#ffffff" })
            : null;

        const pageWidthMm = 297, pageHeightMm = 210, marginMm = 10;
        const usablePageWidthMm = pageWidthMm - marginMm * 2;
        const usablePageHeightMm = pageHeightMm - marginMm * 2;
        const capturePageHeightPx = fullCanvas.width * (usablePageHeightMm / usablePageWidthMm);

        const containerRect = container.getBoundingClientRect();
        const rowBoundaries = rows.map(tr => {
            const r = tr.getBoundingClientRect();
            return (r.bottom - containerRect.top) * SCALE;
        });

        const theadHeightPx = theadCanvas ? theadCanvas.height : 0;

        const slices = [];
        let sliceStart = 0;
        let firstSlice = true;
        while (sliceStart < fullCanvas.height - 2) {
            const availableHeight = firstSlice ? capturePageHeightPx : (capturePageHeightPx - theadHeightPx);
            let sliceEnd = sliceStart + availableHeight;

            let bestCut = sliceEnd;
            for (const b of rowBoundaries) {
                if (b > sliceStart && b <= sliceEnd) bestCut = b;
            }
            if (bestCut <= sliceStart) bestCut = Math.min(sliceEnd, fullCanvas.height);

            slices.push({ start: sliceStart, end: Math.min(bestCut, fullCanvas.height), repeatHeader: !firstSlice });
            sliceStart = bestCut;
            firstSlice = false;
        }

        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

        slices.forEach((slice, i) => {
            if (i > 0) pdf.addPage();

            const sliceHeightPx = slice.end - slice.start;
            const pageCanvas = document.createElement("canvas");
            pageCanvas.width = fullCanvas.width;
            pageCanvas.height = sliceHeightPx + (slice.repeatHeader ? theadHeightPx : 0);
            const ctx = pageCanvas.getContext("2d");
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);

            let yOffset = 0;
            if (slice.repeatHeader && theadCanvas) {
                ctx.drawImage(theadCanvas, 0, 0);
                yOffset = theadHeightPx;
            }
            ctx.drawImage(
                fullCanvas,
                0, slice.start, fullCanvas.width, sliceHeightPx,
                0, yOffset, fullCanvas.width, sliceHeightPx
            );

            const imgData = pageCanvas.toDataURL("image/jpeg", 0.92);
            const imgHeightMm = usablePageWidthMm * (pageCanvas.height / pageCanvas.width);
            pdf.addImage(imgData, "JPEG", marginMm, marginMm, usablePageWidthMm, imgHeightMm);
        });

        const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
        pdf.save(`CreditReport_${stamp}.pdf`);
    } catch (err) {
        console.error("[export pdf] failed:", err);
        notify("Could not generate the PDF.", "error");
    } finally {
        tempStyleEl.remove();
        void document.body.offsetHeight;
        if (typeof hideAppLoading === "function") {
            hideAppLoading();
        }
    }
}
document.getElementById("btnCrExportPdf")?.addEventListener("click", () => {
    crExportPdf();
    document.getElementById("crMenuDropdown")?.classList.remove("show");
});

// ========================================
// PRINT
// ========================================
document.getElementById("btnCrPrint")?.addEventListener("click", () => {
    window.print();
    document.getElementById("crMenuDropdown")?.classList.remove("show");
});

// ========================================
// "..." MENU — closes on: picking an action, clicking outside, Escape.
// ========================================
const crMenuToggle = document.getElementById("btnCrMenu");
const crMenuDropdown = document.getElementById("crMenuDropdown");

if (crMenuToggle && crMenuDropdown) {
    crMenuToggle.addEventListener("click", (e) => {
        e.stopPropagation();
        crMenuDropdown.classList.toggle("show");
    });

    crMenuDropdown.addEventListener("click", (e) => {
        if (e.target.closest("button")) {
            crMenuDropdown.classList.remove("show");
        }
    });

    document.addEventListener("click", (e) => {
        if (!crMenuDropdown.contains(e.target) && e.target !== crMenuToggle) {
            crMenuDropdown.classList.remove("show");
        }
    });

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") crMenuDropdown.classList.remove("show");
    });
}

// ========================================
// LANDSCAPE VIEW TOGGLE
// Only .table-card is rotated (via CSS), not the whole page — see
// creditreport.css for why. Bars auto-hide after 3s, tapping the
// table brings them back.
// ========================================
// ========================================
// REFRESH DATA
// Clears the server's raw-row cache (which otherwise holds Mongo data for
// up to 10 min) then re-runs the report, so a fresh VBA upload shows up
// immediately instead of waiting out the TTL.
//
// Note this makes the NEXT request pay the full slow fetch again — that's
// the whole point, but it means this button is deliberately not something
// to press casually.
// ========================================
async function crRefreshData() {
    document.getElementById("crMenuDropdown")?.classList.remove("show");
    crShowLoading("Refreshing from database...");

    try {
        const res = await fetch(`${API.BASE_URL}/api/creditreport/refresh`, {
            method: "POST",
            headers: { Authorization: `Bearer ${crToken}` }
        });
        const data = await res.json();

        if (!data.ok) {
            crHideLoading();
            crShowEmpty(data.message || "Could not refresh data.");
            return;
        }

        // Local caches are now stale too — drop them so the re-run refetches.
        crSummaryData = null;
        crDetailedData = null;

        await crRunReport();
    } catch (e) {
        console.error("[refresh data] failed:", e);
        crHideLoading();
        crShowEmpty("Network error refreshing data.");
    }
}
document.getElementById("btnCrRefreshData")?.addEventListener("click", crRefreshData);

const btnCrLandscape = document.getElementById("btnCrLandscape");
const btnCrExitLandscape = document.getElementById("btnCrExitLandscape");
const crLandscapeTopBar = document.getElementById("landscapeTopBar");
const crLandscapeBottomBar = document.getElementById("landscapeBottomBar");
const crLandscapeRowCount = document.getElementById("crLandscapeRowCount");

let crLandscapeHideTimer = null;

function crShowLandscapeBars() {
    if (crLandscapeTopBar) crLandscapeTopBar.classList.remove("hidden");
    if (crLandscapeBottomBar) crLandscapeBottomBar.classList.remove("hidden");
    clearTimeout(crLandscapeHideTimer);
    crLandscapeHideTimer = setTimeout(crHideLandscapeBars, 3000);
}
function crHideLandscapeBars() {
    if (crLandscapeTopBar) crLandscapeTopBar.classList.add("hidden");
    if (crLandscapeBottomBar) crLandscapeBottomBar.classList.add("hidden");
}

if (btnCrLandscape) {
    btnCrLandscape.addEventListener("click", () => {
        document.body.classList.add("cr-force-landscape");
        if (crLandscapeRowCount) {
            const rowCount = document.getElementById("crTbody").children.length;
            crLandscapeRowCount.textContent = `${rowCount.toLocaleString()} rows`;
        }
        crShowLandscapeBars();
        document.getElementById("crMenuDropdown")?.classList.remove("show");
    });
}
if (btnCrExitLandscape) {
    btnCrExitLandscape.addEventListener("click", () => {
        clearTimeout(crLandscapeHideTimer);
        document.body.classList.remove("cr-force-landscape");
    });
}
document.querySelector(".table-card")?.addEventListener("click", (e) => {
    if (!document.body.classList.contains("cr-force-landscape")) return;
    if (e.target.closest(".landscape-bar")) return;
    crShowLandscapeBars();
});
window.addEventListener("pageshow", () => {
    clearTimeout(crLandscapeHideTimer);
    document.body.classList.remove("cr-force-landscape");
});

// ========================================
// INIT
// ========================================
crRunReport();
