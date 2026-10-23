// ========================================
// Daily Arrears — Excel and PDF export engine
// Both take the same column list, so the two files match each other
// and the table on screen:
//
//   cols: [{ label, type, align, value(row, i), text(row, i), style(row, i), maxPx }]
//     type   "text" | "num" (#,##0.00) | "int" (0) | "date" (dd/mm/yyyy)
//     value  the cell's value for Excel (number / Date / string)
//     text   what's written in the PDF (and how long the Excel column is);
//            "\n" splits it over lines
//     style  { fill, color, bold } — the table's colours (Class, Promise…)
//
//   ArrExport.excel({ filename, sheets: [{ name, title, info, cols, rows }], onProgress })
//   ArrExport.pdf({ filename, title, info, cols, rows, footer, onProgress })
//
// Excel: ExcelJS (loaded the first time it's needed) — real numbers and
// dates, the Krasar font, the table's colours, a frozen header and
// first two columns, filters on the header, A4 landscape print setup.
// PDF: jsPDF with the Krasar font embedded; Khmer text goes in as small
// images the browser draws (PDF libraries can't shape Khmer). All the
// rows are drawn, not only the ones on screen.
// ========================================

(function () {
    const FONT = "Krasar";
    const NAVY = "#1A2E57";
    const GOLD = "#FFD700";
    const INK = "#1C2333";
    const GRID = "#C9D1DD";
    const ZEBRA = "#F3F6FA";
    const EXCELJS_URL = "https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js";

    const scripts = {};
    function loadScript(url) {
        if (!scripts[url]) {
            scripts[url] = new Promise((resolve, reject) => {
                const s = document.createElement("script");
                s.src = url;
                s.onload = resolve;
                s.onerror = () => { delete scripts[url]; reject(new Error(`Could not load ${url}`)); };
                document.head.appendChild(s);
            });
        }
        return scripts[url];
    }

    const nextFrame = () => new Promise(r => setTimeout(r, 0));
    const cellText = (col, row, i) => {
        const t = col.text ? col.text(row, i) : col.value(row, i);
        return t === null || t === undefined ? "" : String(t);
    };

    function download(blob, filename) {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 30000);
    }

    // ---------- Excel ----------
    const argb = hex => "FF" + hex.replace("#", "").toUpperCase();
    const NUM_FMT = { num: "#,##0.00", int: "0", date: "dd/mm/yyyy", text: "@" };

    async function excel({ filename, sheets, onProgress }) {
        await loadScript(EXCELJS_URL);
        const wb = new window.ExcelJS.Workbook();
        wb.created = new Date();
        const total = sheets.reduce((n, s) => n + s.rows.length, 0) || 1;
        let done = 0;

        for (const sheet of sheets) {
            const { cols, rows } = sheet;
            const n = cols.length;
            const headRow = 2 + (sheet.info || []).length + 1;   // title, info…, blank
            const ws = wb.addWorksheet(sheet.name, {
                views: [{ state: "frozen", xSplit: 2, ySplit: headRow }],
                pageSetup: {
                    paperSize: 9, orientation: "landscape",
                    fitToPage: true, fitToWidth: 1, fitToHeight: 0,
                    margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
                    printTitlesRow: `${headRow}:${headRow}`
                },
                headerFooter: { oddFooter: "&L&\"Krasar\"&8" + sheet.name + "&R&\"Krasar\"&8&P / &N" }
            });

            const border = { style: "thin", color: { argb: argb(GRID) } };
            const borders = { top: border, left: border, bottom: border, right: border };

            ws.mergeCells(1, 1, 1, n);
            Object.assign(ws.getCell(1, 1), { value: sheet.title });
            ws.getCell(1, 1).font = { name: FONT, size: 14, bold: true, color: { argb: argb(NAVY) } };
            ws.getRow(1).height = 26;
            (sheet.info || []).forEach((line, k) => {
                ws.mergeCells(2 + k, 1, 2 + k, n);
                const c = ws.getCell(2 + k, 1);
                c.value = line;
                c.font = { name: FONT, size: 10, color: { argb: "FF5B6475" } };
            });

            const head = ws.getRow(headRow);
            cols.forEach((col, j) => {
                const c = head.getCell(j + 1);
                c.value = col.label;
                c.font = { name: FONT, size: 10, bold: true, color: { argb: argb(GOLD) } };
                c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(NAVY) } };
                c.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
                c.border = borders;
            });
            head.height = 24;

            // Column widths from the longest text (Excel units ≈ characters).
            const widths = cols.map(col => Math.max(6, String(col.label).length + 2));

            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];
                const r = ws.getRow(headRow + 1 + i);
                const zebra = i % 2 === 1;
                cols.forEach((col, j) => {
                    const c = r.getCell(j + 1);
                    let v = col.value(row, i);
                    if (v === undefined || v === "") v = null;
                    c.value = v;
                    const st = (col.style && col.style(row, i)) || {};
                    c.font = { name: FONT, size: 10, bold: !!st.bold, color: { argb: argb(st.color || INK) } };
                    const fill = st.fill || (zebra ? ZEBRA : null);
                    if (fill) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(fill) } };
                    if (typeof v === "number" || v instanceof Date) c.numFmt = NUM_FMT[col.type] || "General";
                    else c.numFmt = "@";
                    const multi = typeof v === "string" && v.includes("\n");
                    c.alignment = { vertical: "middle", horizontal: col.align || (col.type === "text" ? "left" : "right"), wrapText: multi };
                    c.border = borders;
                    const len = Math.max(...cellText(col, row, i).split("\n").map(l => l.length));
                    if (len + 2 > widths[j]) widths[j] = len + 2;
                });
                if (++done % 400 === 0) {
                    onProgress && onProgress(done / total * 0.85);
                    await nextFrame();
                }
            }
            cols.forEach((col, j) => { ws.getColumn(j + 1).width = Math.min(widths[j], col.maxChars || 45); });
            ws.autoFilter = { from: { row: headRow, column: 1 }, to: { row: headRow + Math.max(rows.length, 1), column: n } };
        }

        onProgress && onProgress(0.9);
        await nextFrame();
        const buf = await wb.xlsx.writeBuffer();
        download(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), filename);
    }

    // ---------- PDF ----------
    // Layout is worked out in px at DPI (text measured on a canvas with
    // the Krasar font), then drawn in mm. Grid, colours and text without
    // Khmer (numbers, dates, IDs, headers) are real PDF text and lines in
    // the embedded Krasar font: small file, sharp at any zoom, can be
    // searched. Khmer text is drawn as a small image instead (PDF
    // libraries can't put Khmer letters together correctly; the browser
    // can), and each distinct text is stored once.
    const DPI = 160;
    const PX_PER_MM = DPI / 25.4;
    const PAGE_W = Math.round(297 * PX_PER_MM);   // A4 landscape, px
    const PAGE_H = Math.round(210 * PX_PER_MM);
    const MARGIN = Math.round(8 * PX_PER_MM);
    const BASE_PX = 20;                            // measuring size
    const MAX_PX = 21, MIN_PX = 11;
    const PAD = 8;                                 // cell padding (at BASE_PX)
    const IMG_SCALE = 2;                           // Khmer text images: 2× the layout DPI
    const FONT_URL = "/CM_Pro/assets/fonts/Krasar-Regular.ttf";
    // Anything beyond plain ASCII (Khmer, and letters the embedded font
    // may not have) is drawn by the browser.
    const NEEDS_IMAGE = /[^\x20-\x7E\u2022\u00B7\u2026\u2013\u2014\u203A]/;

    const fontStr = (px, bold) => `${bold ? "bold " : ""}${px}px "${FONT}", Arial, sans-serif`;
    const mm = px => px / PX_PER_MM;
    const pt = px => px * 72 / DPI;
    const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));

    // Shortens `s` to fit `w` px, with an ellipsis.
    function fit(ctx, s, w) {
        if (ctx.measureText(s).width <= w) return s;
        let lo = 0, hi = s.length;
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (ctx.measureText(s.slice(0, mid) + "…").width <= w) lo = mid; else hi = mid - 1;
        }
        return lo ? s.slice(0, lo) + "…" : "";
    }

    let fontB64 = null;
    async function krasarBase64() {
        if (!fontB64) {
            const buf = new Uint8Array(await (await fetch(FONT_URL)).arrayBuffer());
            let bin = "";
            for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
            fontB64 = btoa(bin);
        }
        return fontB64;
    }

    async function pdf({ filename, title, info, cols, rows, footer, onProgress }) {
        if (!window.jspdf) throw new Error("jsPDF not loaded");
        try {
            await Promise.all([document.fonts.load(fontStr(BASE_PX)), document.fonts.load(fontStr(BASE_PX, true))]);
        } catch (e) { /* measured with the fallback font */ }

        const doc = new window.jspdf.jsPDF({ orientation: "landscape", unit: "mm", format: "a4", compress: true });
        doc.addFileToVFS("Krasar-Regular.ttf", await krasarBase64());
        doc.addFont("Krasar-Regular.ttf", FONT, "normal");
        doc.setFont(FONT, "normal");

        const ctx = document.createElement("canvas").getContext("2d");   // measuring
        const img = document.createElement("canvas");                     // Khmer text images
        const ictx = img.getContext("2d");
        const images = new Map();                                         // text+style -> alias
        let imageNo = 0;

        // Text at (x, y-centre) inside `w` px, as PDF text — or as an
        // image when it has Khmer letters.
        function text(s, x, yMid, w, h, { px, bold, color, bg, align }) {
            if (!s) return;
            ctx.font = fontStr(px, bold);
            s = fit(ctx, s, w);
            if (!s) return;
            if (!NEEDS_IMAGE.test(s)) {
                const [r, g, b] = rgb(color);
                doc.setTextColor(r, g, b);
                doc.setFontSize(pt(px));
                const tx = align === "right" ? x + w : align === "center" ? x + w / 2 : x;
                const opts = { baseline: "middle", align: align || "left", renderingMode: "fill" };
                if (bold) {
                    doc.setDrawColor(r, g, b);
                    doc.setLineWidth(mm(px * 0.035));
                    opts.renderingMode = "fillThenStroke";
                }
                doc.text(s, mm(tx), mm(yMid), opts);
                return;
            }
            const tw = Math.min(w, Math.ceil(ctx.measureText(s).width) + 2);
            const key = `${s}|${px}|${bold ? 1 : 0}|${color}|${bg}|${tw}|${h}`;
            const ix = align === "right" ? x + w - tw : align === "center" ? x + (w - tw) / 2 : x;
            const at = [mm(ix), mm(yMid - h / 2), mm(tw), mm(h)];
            const alias = images.get(key);
            if (alias) {
                doc.addImage(alias, "JPEG", ...at, alias, "FAST");
            } else {
                img.width = Math.ceil(tw * IMG_SCALE);
                img.height = Math.ceil(h * IMG_SCALE);
                ictx.fillStyle = bg;
                ictx.fillRect(0, 0, img.width, img.height);
                ictx.font = fontStr(px * IMG_SCALE, bold);
                ictx.fillStyle = color;
                ictx.textBaseline = "middle";
                ictx.textAlign = "left";
                // Khmer sits high on a "middle" baseline next to the numbers.
                ictx.fillText(s, IMG_SCALE, img.height / 2 + px * 0.12 * IMG_SCALE);
                const name = `t${++imageNo}`;
                images.set(key, name);
                doc.addImage(img.toDataURL("image/jpeg", 0.82), "JPEG", ...at, name, "FAST");
            }
        }

        // Cell texts once (a cell may hold several lines: amounts in two
        // currencies); natural column widths at BASE_PX.
        const texts = rows.map((row, i) => cols.map(col => cellText(col, row, i).split("\n")));
        const usable = PAGE_W - MARGIN * 2;
        ctx.font = fontStr(BASE_PX, true);
        const natural = cols.map(col => ctx.measureText(col.label).width + PAD * 2);
        ctx.font = fontStr(BASE_PX);
        for (let i = 0; i < texts.length; i++) {
            for (let j = 0; j < cols.length; j++) {
                for (const line of texts[i][j]) {
                    const w = ctx.measureText(line).width + PAD * 2;
                    if (w > natural[j]) natural[j] = w;
                }
            }
            if (i % 2000 === 1999) await nextFrame();
        }
        // Long free-text columns (Location, Ministry…) don't get to squeeze the rest.
        const capped = natural.map((w, j) => Math.min(w, cols[j].maxPx || 420));
        const sum = capped.reduce((a, b) => a + b, 0);
        const px = Math.max(MIN_PX, Math.min(MAX_PX, BASE_PX * usable / sum));
        const k = px / BASE_PX;
        let widths = capped.map(w => w * k);
        // Still too wide at the smallest size: the free-text columns (those
        // with a maxPx) give up room first, down to 40% — numbers and IDs
        // keep theirs. Then everything is scaled to the page width exactly.
        const over = widths.reduce((a, b) => a + b, 0) - usable;
        if (over > 0) {
            const flex = cols.map((col, j) => (col.maxPx ? widths[j] * 0.6 : 0));
            const room = flex.reduce((a, b) => a + b, 0);
            if (room > 0) widths = widths.map((w, j) => w - flex[j] * Math.min(1, over / room));
        }
        const total = widths.reduce((a, b) => a + b, 0);
        widths = widths.map(w => w * usable / total);
        const pad = PAD * k;

        const rowH = Math.round(px * 2.05);
        const lineH = Math.round(px * 1.45);
        const heights = texts.map(cells => rowH + (Math.max(...cells.map(c => c.length)) - 1) * lineH);
        const headH = Math.round(px * 2.4);
        const titlePx = Math.round(px * 1.45);
        const infoPx = Math.round(px * 0.95);
        const infoLines = info || [];
        const topFirst = MARGIN + titlePx * 1.6 + infoLines.length * infoPx * 1.7 + px * 0.5;
        const topNext = MARGIN + titlePx * 1.6 + px * 0.3;
        const footH = Math.round(px * 1.8);

        // Rows per page, by their heights: [start, end) for each page.
        const pageRanges = [];
        for (let i = 0; i < rows.length || !pageRanges.length;) {
            const room = PAGE_H - MARGIN - footH - (pageRanges.length ? topNext : topFirst) - headH;
            let used = 0, end = i;
            while (end < rows.length && (end === i || used + heights[end] <= room)) used += heights[end++];
            pageRanges.push([i, end]);
            i = end;
            if (!rows.length) break;
        }
        const pages = pageRanges.length;
        const fillRect = (x, y, w, h, hex) => {
            doc.setFillColor(...rgb(hex));
            doc.rect(mm(x), mm(y), mm(w), mm(h), "F");
        };

        for (let p = 0; p < pages; p++) {
            const [start, end] = pageRanges[p];
            if (p > 0) doc.addPage();

            // Title (every page) and the info lines (first page).
            let y = MARGIN;
            text(title, MARGIN, y + titlePx * 0.8, usable, titlePx * 1.6, { px: titlePx, bold: true, color: NAVY, bg: "#FFFFFF" });
            y += titlePx * 1.6;
            if (p === 0) {
                infoLines.forEach(line => {
                    text(line, MARGIN, y + infoPx * 0.85, usable, infoPx * 1.7, { px: infoPx, color: "#4A5568", bg: "#FFFFFF" });
                    y += infoPx * 1.7;
                });
            }
            let top = Math.round(p === 0 ? topFirst : topNext);

            // Header row.
            fillRect(MARGIN, top, usable, headH, NAVY);
            let x = MARGIN;
            cols.forEach((col, j) => {
                text(col.label, x + pad, top + headH / 2, widths[j] - pad * 2, headH - 2, { px, bold: true, color: GOLD, bg: NAVY, align: "center" });
                x += widths[j];
            });
            top += headH;

            // Rows: backgrounds, then text (lines centred in the row).
            const rowTops = [top];
            for (let i = start; i < end; i++) {
                const yRow = rowTops[rowTops.length - 1];
                const h = heights[i];
                x = MARGIN;
                for (let j = 0; j < cols.length; j++) {
                    const col = cols[j];
                    const st = (col.style && col.style(rows[i], i)) || {};
                    const bg = st.fill || ((i - start) % 2 === 1 ? ZEBRA : "#FFFFFF");
                    if (bg !== "#FFFFFF") fillRect(x, yRow, widths[j], h, bg);
                    const lines = texts[i][j];
                    lines.forEach((line, n) => {
                        text(line, x + pad, yRow + h / 2 + (n - (lines.length - 1) / 2) * lineH, widths[j] - pad * 2, (lines.length > 1 ? lineH : rowH) - 2, {
                            px, bold: st.bold, color: st.color || INK, bg,
                            align: col.align || (col.type === "text" ? "left" : "right")
                        });
                    });
                    x += widths[j];
                }
                rowTops.push(yRow + h);
            }

            // Grid.
            const bottom = rowTops[rowTops.length - 1];
            doc.setDrawColor(...rgb(GRID));
            doc.setLineWidth(0.15);
            rowTops.forEach(t => doc.line(mm(MARGIN), mm(t), mm(MARGIN + usable), mm(t)));
            x = MARGIN;
            for (let j = 0; j <= cols.length; j++) {
                doc.line(mm(x), mm(top - headH), mm(x), mm(bottom));
                x += widths[j] || 0;
            }

            // Footer.
            const fy = PAGE_H - MARGIN - footH / 2;
            const fpx = Math.round(px * 0.85);
            text(footer || "", MARGIN, fy, usable * 0.7, footH, { px: fpx, color: "#6B7280", bg: "#FFFFFF" });
            text(`${p + 1} / ${pages}`, MARGIN + usable * 0.7, fy, usable * 0.3, footH, { px: fpx, color: "#6B7280", bg: "#FFFFFF", align: "right" });

            onProgress && onProgress((p + 1) / pages * 0.95);
            if (p % 3 === 2) await nextFrame();
        }
        await nextFrame();
        doc.save(filename);
    }

    window.ArrExport = { excel, pdf };
})();
