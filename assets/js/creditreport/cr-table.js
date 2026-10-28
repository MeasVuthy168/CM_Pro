// ========================================
// Credit Report — Daily Monitoring table helpers (design ក / គ):
// PAR % as a coloured pill, a small bar under a Value showing its size
// against the other rows, compact K / M amounts, and a soft right edge
// while more columns are off-screen. A cell whose text is shortened
// carries the exact figure in data-x, which the Excel / PDF export
// (cr-export.js) uses instead.
// ========================================

window.CRTable = (() => {
    // PAR %: green under 5%, amber under 10%, red from 10%.
    function parPill(v) {
        const n = Number(v) || 0;
        const cls = n < 0.05 ? "ok" : n < 0.10 ? "warn" : "bad";
        return `<span class="cr-pill cr-pill-${cls}">${(n * 100).toFixed(2)}%</span>`;
    }

    // A bar under a Value: its share of the largest row's.
    function bar(v, max) {
        const w = max > 0 ? Math.max(0, Math.min(100, (Number(v) || 0) / max * 100)) : 0;
        return `<div class="cr-bar"><i style="width:${w.toFixed(0)}%"></i></div>`;
    }

    // 3440104 -> "3.44M", 820716 -> "820.7K"
    function compact(v) {
        const n = Math.abs(v);
        const s = n >= 1e6 ? (n / 1e6).toFixed(2) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "K" : String(Math.round(n));
        return (v < 0 ? "-" : "") + s;
    }
    // The exact figure as the export reads it ("-560,047").
    const exact = v => Math.round(v).toLocaleString("en-US");

    // A soft right edge on a scroll box while more columns are off-screen.
    function edgeHint(box) {
        if (!box) return;
        const update = () => box.classList.toggle("cr-more-right", box.scrollLeft + box.clientWidth < box.scrollWidth - 4);
        if (!box._crEdgeHint) {
            box._crEdgeHint = true;
            box.addEventListener("scroll", update, { passive: true });
            window.addEventListener("resize", update);
        }
        requestAnimationFrame(update);
    }

    return { parPill, bar, compact, exact, edgeHint };
})();
