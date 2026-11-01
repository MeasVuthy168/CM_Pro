// ========================================
// Credit Report daily reports — Export Excel / PDF, Print, Fullscreen
// (Daily Monitoring by Officer / Branch / Product / Location)
//
//   Excel  the same section/lane/field, colour-coded report "Export
//          All" (cr-export-all.js) gives this page — Plan + Last Month
//          + Achieved + (+/-), merged, every row — straight from a
//          fresh fetch (window.crExportDailyMonitoring), not whatever
//          the page's own Comparison dropdown happens to be showing.
//          Real numbers (#,##0 and 0.00%), a frozen header + first
//          column, filters on the header, A4 landscape print setup.
//   PDF    the table as it stands on screen right now (same source as
//          Print, below) — whichever Comparison mode, Showing section
//          and other filters are active, with every section block (or
//          the one currently showing) its own page — vector text, the
//          header repeated on every page, page numbers. Owner request
//          01/11/2026: PDF used to always fetch the same full data as
//          Excel, ignoring the page's own filters; Excel still does.
//   Print  the table as it stands on screen right now (both header
//          rows, every column, the Total row, the high-PAR colour) —
//          whichever mode, Showing and filters are active — as a page
//          of its own (title, data dates, filters in use, shrunk to
//          the paper's width). Same engine as Daily Arrears
//          (arrears-export.js).
//
// Fullscreen (replaces the old Landscape view, as on Daily Arrears):
// only the table — the topbar, the filters and the bottom bar are
// hidden, and the browser's own bars too where it allows it; the
// screen turns with the phone while in it. ✕, Esc or the browser's own
// exit comes back.
//
//   CRExport.wire({ name, beforeExport })
//     name          file name start, e.g. "MonitoringByOfficer" — also
//                   which Daily Monitoring sheet Excel/PDF fetch
//                   (DAILY_MONITORING_SHEET below)
//     beforeExport  runs before Print (e.g. clear the officer search
//                   box, so the printed page has every row) — Excel/PDF
//                   fetch their own data fresh, so they don't need it
// ========================================

(function () {
    const t = (key, vars) => (window.CMI18n ? CMI18n.t(key, vars) : key);
    const closeMenu = () => document.getElementById("crMenuDropdown")?.classList.remove("show");
    const TOTAL = { fill: "#FFF4C2", bold: true };
    const ALERT = { color: "#C0392B", bold: true };

    function notify(message, type) {
        if (window.CMToast?.show) CMToast.show({ type, title: message, message: "", duration: 3000 });
        else if (typeof window.showToast === "function") window.showToast(message, type);
        else alert(message);
    }

    // ---------- the report on screen ----------

    // Icons and icon-only buttons (▾ expand, History's refresh / delete)
    // out of a copy of a cell; name links keep their text.
    function bareCopy(cell) {
        const c = cell.cloneNode(true);
        c.querySelectorAll(".cr-ico, svg, .cr-row-expand-btn, .cr-rank, .cr-bar").forEach(n => n.remove());
        c.querySelectorAll("button").forEach(btn => { if (!btn.textContent.trim()) btn.remove(); });
        return c;
    }

    // A cell's text, line by line (the History date cell carries a
    // "T24: …" line under the date).
    function cellText(td) {
        // A shortened figure (3.44M, ▲0.56M) carries the exact one.
        if (td.dataset && td.dataset.x !== undefined) return td.dataset.x;
        const c = bareCopy(td);
        const parts = c.children.length && [...c.children].every(n => /^(DIV|P)$/.test(n.tagName))
            ? [...c.children].map(n => n.textContent)
            : [c.textContent];
        return parts.map(s => s.replace(/\s+/g, " ").replace(/^[▾▸▴▼►]\s*/, "").trim()).filter(Boolean).join("\n");
    }

    const NUM = /^-?[\d,]+(\.\d+)?$/;
    const PCT = /^-?[\d,]*\.?\d+%$/;

    // Columns, header groups and rows of #crTable, as arrears-export.js
    // takes them. Header cells are laid on a grid first (rowspan /
    // colspan), so a column's label is its lowest header cell and its
    // group the cell above it, when that one spans other columns too.
    function readTable() {
        const table = document.getElementById("crTable");
        const tbody = document.getElementById("crTbody");
        if (!table || !tbody) return null;
        const grid = [];
        [...table.tHead.rows].forEach((tr, r) => {
            grid[r] = grid[r] || [];
            let c = 0;
            for (const th of tr.cells) {
                while (grid[r][c]) c++;
                for (let i = 0; i < (th.rowSpan || 1); i++) {
                    for (let j = 0; j < (th.colSpan || 1); j++) (grid[r + i] = grid[r + i] || [])[c + j] = th;
                }
                c += th.colSpan || 1;
            }
        });
        if (!grid.length) return null;
        const leafRow = grid.length - 1;
        const last = grid[leafRow];
        const label = th => (th ? bareCopy(th).textContent.replace(/\s+/g, " ").trim() : "");

        // One group per column: every header cell above the leaf row
        // (there can be two now — a section name over a Plan/Actual or
        // Last Month lane, e.g. "Outstanding" over "Plan" — see
        // crBuildThead), collapsed into one row here as "Section · Lane",
        // same shape Excel/PDF/Print have always taken from this file.
        const groups = [];
        let prevChain = null;
        last.forEach((leaf, c) => {
            const chain = [];
            for (let r = 0; r < leafRow; r++) {
                const cell = grid[r][c];
                if (cell && cell !== leaf && chain[chain.length - 1] !== cell) chain.push(cell);
            }
            const same = prevChain && prevChain.length === chain.length && prevChain.every((x, i) => x === chain[i]);
            if (same && groups.length) groups[groups.length - 1].span++;
            else groups.push({ th: chain[0] || null, label: chain.map(label).join(" · "), span: 1 });
            prevChain = chain;
        });

        const trs = [...tbody.rows].filter(tr => tr.style.display !== "none" && !tr.hidden && tr.cells.length === last.length);
        const rows = trs.map(tr => ({
            texts: [...tr.cells].map(cellText),
            total: tr.classList.contains("cr-total-row"),
            alert: [...tr.cells].map(td => td.classList.contains("cr-par-high"))
        }));

        const cols = last.map((th, j) => {
            const texts = rows.map(r => r.texts[j]).filter(Boolean);
            const kind = j > 0 && texts.length && texts.every(s => PCT.test(s)) ? "pct"
                : j > 0 && texts.length && texts.every(s => NUM.test(s)) ? "num" : "text";
            return {
                label: label(th),
                type: kind === "text" ? "text" : "num",
                numFmt: kind === "pct" ? "0.00%" : kind === "num" ? (texts.some(s => s.includes(".")) ? "#,##0.00" : "#,##0") : undefined,
                align: kind === "text" ? "left" : "right",
                maxPx: kind === "text" ? 360 : undefined,
                value: row => {
                    const s = row.texts[j];
                    if (!s) return null;
                    if (kind === "pct") return Number(s.replace(/[,%]/g, "")) / 100;
                    if (kind === "num") return Number(s.replace(/,/g, ""));
                    return s;
                },
                text: row => row.texts[j],
                style: row => (row.total ? TOTAL : row.alert[j] ? ALERT : null)
            };
        });

        return { cols, rows, groups: groups.map(({ label, span }) => ({ label, span })) };
    }

    // PDF and Print pages hold this many columns (besides the repeated
    // lead ones); a wider table (All Sections: ~90 columns) is split
    // into page bands, groups kept whole, the lead columns (Name, Date…)
    // repeated on each band. Excel keeps the whole table on one sheet.
    const BAND_COLS = 16;

    // A group's own section name: its whole label (cr-export-all.js's
    // fresh-fetch groups, one per section, never have a "·"), or the
    // part before " · " in readTable()'s own flattened "Section · Lane"
    // chain label — so consecutive Plan / Last Month / Actual / … lanes
    // of the same on-screen section still count as that one section.
    const sectionNameOf = label => {
        const i = label.indexOf(" · ");
        return i === -1 ? label : label.slice(0, i);
    };

    // perSection: one band per section — every group that shares a
    // section name packed together, however many columns that holds —
    // instead of packing bands up to BAND_COLS. The Daily Monitoring
    // PDF's own "Export PDF" (each section block its own page, owner
    // request) rather than Print's default packing.
    function bandsOf(m, { perSection } = {}) {
        let lead = 0, gi = 0;
        while (gi < m.groups.length && !m.groups[gi].label) lead += m.groups[gi++].span;
        const leadCols = m.cols.slice(0, lead), leadGroups = m.groups.slice(0, gi);
        const bands = [];
        let cur = null, c = lead, curSection = null;
        for (; gi < m.groups.length; gi++) {
            const g = m.groups[gi];
            const section = perSection ? sectionNameOf(g.label) : null;
            if (!cur || (perSection ? section !== curSection : cur.n + g.span > BAND_COLS)) {
                cur = { cols: leadCols.slice(), groups: leadGroups.slice(), n: 0, label: section };
                bands.push(cur);
                curSection = section;
            }
            cur.cols.push(...m.cols.slice(c, c + g.span));
            cur.groups.push(g);
            cur.n += g.span;
            c += g.span;
        }
        if (bands.length < 2) return [{ cols: m.cols, groups: m.groups, part: "" }];
        return bands.map((b, k) => ({ cols: b.cols, groups: b.groups, part: b.label ? ` — ${b.label}` : ` (${k + 1}/${bands.length})` }));
    }

    const visible = el => !!el && el.getClientRects().length > 0;
    const labelOf = el => {
        const lab = el._msLabel || document.querySelector(`label[for="${CSS.escape(el.id)}"], label[for="${CSS.escape(el.id)}Btn"]`);
        return (lab ? lab.textContent : el.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim();
    };
    const dmy = v => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v.split("-").reverse().join("-") : v);

    function title() {
        const base = (document.querySelector(".print-only-title")?.textContent || document.title).trim();
        const hist = document.getElementById("crModeHistoryBtn");
        return hist?.classList.contains("active") ? `${base} — ${hist.textContent.trim()}` : base;
    }

    // The report card's dates, then each filter that narrows the report
    // (anything left at All is left out).
    function infoLines() {
        const lines = [];
        const dates = [...document.querySelectorAll(".cr-info-row")].filter(visible).map(row => {
            const k = row.querySelector(".cr-info-label")?.textContent.replace(/\s+/g, " ").trim();
            const v = row.querySelector(".cr-info-value")?.textContent.replace(/\s+/g, " ").trim();
            return k && v && v !== "-" ? `${k}: ${v}` : "";
        }).filter(Boolean);
        for (let i = 0; i < dates.length; i += 3) lines.push(dates.slice(i, i + 3).join(" · "));

        const filters = [];
        document.querySelectorAll(".filter-card input[type=date]").forEach(el => {
            if (visible(el) && el.value) filters.push(`${labelOf(el)}: ${dmy(el.value)}`);
        });
        document.querySelectorAll(".filter-card select").forEach(el => {
            if (!visible(el._msBtn || el)) return;
            const vals = window.MultiSelect && el._msBtn
                ? MultiSelect.values(el)
                : [el.value].filter(v => v && !el.selectedOptions[0]?.hasAttribute("data-ms-all"));
            if (!vals.length) return;
            const texts = vals.map(v => [...el.options].find(o => o.value === v)?.textContent.trim() || v);
            filters.push(`${labelOf(el)}: ${texts.join(", ")}`);
        });
        document.querySelectorAll(".cr-chips").forEach(box => {
            if (box.hidden || !visible(box)) return;
            const chips = [...box.querySelectorAll(".cr-chip-text")].map(c => c.textContent.trim());
            const lab = box.previousElementSibling?.querySelector("label")?.textContent.trim();
            if (chips.length) filters.push(`${lab || ""}${lab ? ": " : ""}${chips.join(", ")}`);
        });
        if (filters.length) lines.push(`${t("creditreport.export.filters")} — ${filters.join(" · ")}`);
        return lines;
    }

    function footer() {
        const d = new Date();
        const pad = n => String(n).padStart(2, "0");
        let user = "";
        try {
            user = JSON.parse(sessionStorage.getItem("loggedInUser") || localStorage.getItem("loggedInUser") || "{}").username || "";
        } catch (e) {}
        const when = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
        return `CM_Pro · ${t("creditreport.export.exported")} ${when}${user ? " · " + user : ""}`;
    }

    function fileBase(name) {
        const d = new Date();
        const pad = n => String(n).padStart(2, "0");
        return `${name}_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
    }

    // "Export Excel" on these 4 pages gives the SAME section/lane/field,
    // colour-coded report "Export All" gives this page — Plan + Last
    // Month + Achieved + (+/-), merged — straight from cr-export-all.js's
    // own per-report sheet builder (window.crExportDailyMonitoring), not
    // whatever the page's own Comparison dropdown happens to be showing
    // right now. "Export PDF", Print and Fullscreen all read the live
    // on-screen table instead (readTable()).
    const DAILY_MONITORING_SHEET = {
        MonitoringByBranch: "branch",
        MonitoringByOfficer: "officer",
        MonitoringByProduct: "product",
        MonitoringByLocation: "location"
    };

    // Same loading-overlay / error-toast shape as run() above, but the
    // "model" is a freshly-fetched sheet (cr-export-all.js), not the
    // live DOM table — there's nothing on screen to clear or to find
    // Print's own filter/date info in.
    async function runDailyMonitoring(message, dmKey, build) {
        closeMenu();
        if (typeof window.crExportDailyMonitoring === "undefined" || typeof window.crExportDailyMonitoring[dmKey] !== "function") {
            notify(t("creditreport.export.failed"), "error");
            return;
        }
        if (typeof showAppLoading === "function") showAppLoading(message, { progress: true, key: "cr:export" });
        try {
            // sheetDailyMonitoring() (cr-export-all.js) returns an array
            // (it may be empty on a failed fetch) — the same shape its
            // own SHEET_JOBS entries all have, for runPool() to flatten.
            const [sheet] = await window.crExportDailyMonitoring[dmKey]();
            if (!sheet || !sheet.rows || !sheet.rows.length) {
                notify(t("creditreport.detail.nothingToExport"), "warning");
                return;
            }
            await build(sheet, f => window.setAppLoadingProgress?.(f * 100, t("creditreport.export.wait")));
        } catch (err) {
            console.error("[export] failed:", err);
            notify(t("creditreport.export.failed"), "error");
        } finally {
            if (typeof hideAppLoading === "function") hideAppLoading();
        }
    }

    // Same loading-overlay / error-toast shape as runDailyMonitoring()
    // above, but the "model" is the live on-screen table (readTable()),
    // like Print — whatever Comparison mode, Showing section and other
    // filters are active right now, not a fresh unfiltered fetch.
    // beforeExport (crClearSearchForExport) runs first, same as Print,
    // so a leftover search-box filter never silently narrows the file.
    async function runFromTable(message, opts, build) {
        closeMenu();
        opts.beforeExport && opts.beforeExport();
        const m = readTable();
        if (!m || !m.rows.length) {
            notify(t("creditreport.detail.nothingToExport"), "warning");
            return;
        }
        if (typeof showAppLoading === "function") showAppLoading(message, { progress: true, key: "cr:export" });
        try {
            await build(m, f => window.setAppLoadingProgress?.(f * 100, t("creditreport.export.wait")));
        } catch (err) {
            console.error("[export] failed:", err);
            notify(t("creditreport.export.failed"), "error");
        } finally {
            if (typeof hideAppLoading === "function") hideAppLoading();
        }
    }

    function exportExcel(opts) {
        const dmKey = DAILY_MONITORING_SHEET[opts.name];
        return runDailyMonitoring(t("creditreport.export.creatingExcel"), dmKey, (sheet, onProgress) => window.ArrExport.excel({
            filename: `${fileBase(opts.name)}.xlsx`,
            onProgress,
            freezeCols: 1,
            sheets: [sheet]
        }));
    }

    function exportPdf(opts) {
        return runFromTable(t("creditreport.export.creatingPdf"), opts, (m, onProgress) => {
            // bandsOf(m, { perSection: true }) packs every lane of the
            // same on-screen section into one band — one page per
            // section block (or the single one Showing has narrowed to),
            // owner request — instead of Print's own BAND_COLS packing.
            const name = title();
            return window.ArrExport.pdf({
                filename: `${fileBase(opts.name)}.pdf`,
                title: name,
                info: infoLines(),
                footer: footer(),
                parts: bandsOf(m, { perSection: true }).map(b => ({ cols: b.cols, groups: b.groups, title: name + b.part })),
                rows: m.rows,
                onProgress
            });
        });
    }

    // ---------- print ----------
    // The report as a page of its own (#crPrintSheet): only it is printed,
    // in A4 landscape, shrunk to the paper's width when the table is
    // wider; the header row repeats on every page.
    const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const PRINT_WIDTH_PX = 1040;   // 277mm at 96 dpi: A4 landscape minus 10mm margins

    function printReport(opts) {
        closeMenu();
        opts.beforeExport && opts.beforeExport();
        const m = readTable();
        if (!m || !m.rows.length) {
            notify(t("creditreport.detail.nothingToExport"), "warning");
            return;
        }
        document.getElementById("crPrintSheet")?.remove();
        const name = title();
        const info = infoLines().map(l => `<p class="crp-info">${esc(l)}</p>`).join("");
        const sections = bandsOf(m).map((band, k) => {
            const twoRows = band.groups.some(g => g.label);
            let c = 0;
            const head1 = band.groups.map(g => {
                const cell = g.label
                    ? `<th colspan="${g.span}">${esc(g.label)}</th>`
                    : `<th rowspan="${twoRows ? 2 : 1}">${esc(band.cols[c].label)}</th>`;
                c += g.span;
                return cell;
            }).join("");
            c = 0;
            const head2 = band.groups.map(g => {
                const cells = g.label ? band.cols.slice(c, c + g.span).map(col => `<th>${esc(col.label)}</th>`).join("") : "";
                c += g.span;
                return cells;
            }).join("");
            const body = m.rows.map(row => `<tr${row.total ? ' class="crp-total"' : ""}>${band.cols.map(col => {
                const j = m.cols.indexOf(col);
                return `<td class="${col.align === "right" ? "crp-num" : ""}${row.alert[j] ? " crp-alert" : ""}">${esc(row.texts[j]).replace(/\n/g, "<br>")}</td>`;
            }).join("")}</tr>`).join("");
            return `<section class="crp-band">
                <h1>${esc(name + band.part)}</h1>
                ${k === 0 ? info : ""}
                <table><thead><tr>${head1}</tr>${twoRows ? `<tr>${head2}</tr>` : ""}</thead><tbody>${body}</tbody></table>
                <p class="crp-foot">${esc(footer())}</p>
            </section>`;
        }).join("");

        const sheet = document.createElement("div");
        sheet.id = "crPrintSheet";
        sheet.innerHTML = sections;
        document.body.appendChild(sheet);

        // Measured at full size off screen, then shrunk to the paper.
        sheet.classList.add("crp-measure");
        const w = Math.max(...[...sheet.querySelectorAll("table")].map(tb => tb.scrollWidth));
        sheet.classList.remove("crp-measure");
        sheet.style.zoom = w > PRINT_WIDTH_PX ? String(Math.max(0.3, PRINT_WIDTH_PX / w)) : "";

        document.body.classList.add("cr-printing");
        const done = () => {
            document.body.classList.remove("cr-printing");
            sheet.remove();
            window.removeEventListener("afterprint", done);
        };
        window.addEventListener("afterprint", done);
        // Let the sheet lay out before the print dialog snapshots the page.
        requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
    }

    // ---------- fullscreen ----------
    function rotate(free) {
        const o = screen.orientation;
        try {
            if (free) o?.lock?.("any")?.catch(() => {});
            else o?.unlock?.();
        } catch (e) {}
    }

    function setFullscreen(on) {
        closeMenu();
        if (document.body.classList.contains("cr-fullscreen") === on) return;
        document.body.classList.toggle("cr-fullscreen", on);
        if (on) {
            const n = [...(document.getElementById("crTbody")?.rows || [])].filter(tr => tr.style.display !== "none").length;
            const count = document.getElementById("crFsCount");
            if (count) count.textContent = t("creditreport.detail.rowsCount", { count: n.toLocaleString() });
            const head = document.getElementById("crFsTitle");
            if (head) head.textContent = title();
        }
        try {
            const el = document.documentElement;
            if (on && !document.fullscreenElement && el.requestFullscreen) {
                el.requestFullscreen({ navigationUI: "hide" }).then(() => rotate(true)).catch(() => {});
            } else if (on) {
                rotate(true);
            }
            if (!on) {
                rotate(false);
                if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
            }
        } catch (e) {}
        window.scrollTo(0, 0);
        // The sticky second header row is placed from the first one's height.
        if (typeof window.crSetHeaderOffsets === "function") requestAnimationFrame(window.crSetHeaderOffsets);
    }

    function addFullscreenBar() {
        const card = document.querySelector(".table-card");
        if (!card || document.getElementById("crFsBar")) return;
        const bar = document.createElement("div");
        bar.id = "crFsBar";
        bar.className = "cr-fs-bar";
        bar.innerHTML = `
            <span class="cr-fs-text"><b id="crFsTitle"></b><span id="crFsCount"></span></span>
            <button type="button" id="btnCrExitFullscreen" class="cr-fs-exit"
                aria-label="${esc(t("creditreport.menu.exitFullscreenAria"))}" data-i18n-aria-label="creditreport.menu.exitFullscreenAria">✕ <span data-i18n="creditreport.menu.exitFullscreen">${esc(t("creditreport.menu.exitFullscreen"))}</span></button>`;
        card.prepend(bar);
        document.getElementById("btnCrExitFullscreen").addEventListener("click", () => setFullscreen(false));
    }

    function wire(opts) {
        document.getElementById("btnCrExport")?.addEventListener("click", () => exportExcel(opts));
        document.getElementById("btnCrExportPdf")?.addEventListener("click", () => exportPdf(opts));
        document.getElementById("btnCrPrint")?.addEventListener("click", () => printReport(opts));
        document.getElementById("btnCrFullscreen")?.addEventListener("click", () => setFullscreen(true));
        addFullscreenBar();
        // Left the browser's fullscreen (Esc, back gesture): leave ours too.
        document.addEventListener("fullscreenchange", () => {
            if (!document.fullscreenElement) setFullscreen(false);
        });
        document.addEventListener("keydown", e => {
            if (e.key === "Escape" && !document.querySelector(".ms-dim:not([hidden])")) setFullscreen(false);
        });
        // Never kept: a fresh load, or a page back from the back/forward cache, starts normal.
        window.addEventListener("pageshow", () => setFullscreen(false));
    }

    window.CRExport = { wire, readTable };
})();
