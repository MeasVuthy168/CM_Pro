// ========================================
// Daily History chart helpers — shared by the 4 Daily Monitoring pages
// (RepDetailbyBranch/CO/Product/Location.js) for the chart's X axis.
// The chart popup itself (header, hero card, small cards, insights) is
// drawn by cr-chart-view.js.
//
//   fmtShortDate("2026-09-30")             -> "30-Sep-26"
//   fmtShortDateTime("16/10/2026 08:20")   -> "16-Oct-26 08:20"
//   fmtCompact(132000000)                  -> "132.00M"
// ========================================
(function () {
    const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

    // "2026-09-30" -> "30-Sep-26" (D-MMM-YY); anything else is returned as is.
    function fmtShortDate(dateKey) {
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateKey || ""));
        if (!m) return dateKey || "";
        return `${Number(m[3])}-${MONTHS[Number(m[2]) - 1]}-${m[1].slice(2)}`;
    }

    // T24 "as of" text "16/10/2026 08:20" -> "16-Oct-26 08:20".
    function fmtShortDateTime(text) {
        const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(.*)$/.exec(String(text || "").trim());
        if (!m) return text || "";
        return `${Number(m[1])}-${MONTHS[Number(m[2]) - 1]}-${m[3].slice(2)}${m[4]}`;
    }

    // 132000000 -> "132.00M", 132000 -> "132.00K", 1200000000 -> "1.20B".
    function fmtCompact(n) {
        n = Number(n) || 0;
        const abs = Math.abs(n);
        if (abs >= 1e9) return (n / 1e9).toFixed(2) + "B";
        if (abs >= 1e6) return (n / 1e6).toFixed(2) + "M";
        if (abs >= 1e3) return (n / 1e3).toFixed(2) + "K";
        return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
    }

    window.CRGrowthDashboard = { fmtShortDate, fmtShortDateTime, fmtCompact };
})();
