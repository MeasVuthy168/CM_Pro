// ========================================
// Daily History growth / decline dashboard — shared by the 4 Daily
// Monitoring pages (RepDetailbyBranch/CO/Product/Location.js), shown
// under the Daily History chart.
//
// One card per section group (e.g. "Loan Outstanding"), one column per
// field (# Loan / # Client / Value). Each column compares the FIRST day
// of the person's own selected Daily History range against the LAST day
// — not just the last two days — so the change shown matches the range
// picked in the report.
//
// Uses only the already-fetched history days; makes no API calls.
//
// The section header (icon, section name, branch/team scope, date range)
// is drawn into the chart popup's own title (headerRoot), so the chart and
// the cards under it share one title instead of repeating it.
//
// Usage (from a page's crRenderChart):
//   CRGrowthDashboard.render(document.getElementById("crGrowthDashboard"), {
//     headerRoot: document.getElementById("crChartTitle"),
//     section, days, scope, getItemForDay, getByPath, fmtNum, fmtPct
//   });
//
// Also exposes the chart's short formats: fmtShortDate("2026-09-30") ->
// "30-Sep-26", fmtShortDateTime("16/10/2026 08:20") -> "16-Oct-26 08:20",
// fmtCompact(132000000) -> "132.00M".
// ========================================
(function () {
    const tr = (key, vars, fallback) => {
        const s = window.CMI18n ? CMI18n.t(key, vars) : key;
        return s === key ? fallback : s;
    };

    function esc(text) {
        const div = document.createElement("div");
        div.textContent = text == null ? "" : String(text);
        return div.innerHTML.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }

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

    // A rise is bad news for these (overdue, PAR, write-off balance/new
    // write-offs), so their colors flip: up = red, down = green. WO
    // Collected stays "higher is better" like Outstanding/Disburse.
    function crGrowthHigherIsWorse(key) {
        return /^(parT24|nbcOverdue)/.test(key) || /^writeOff\w*\.(balanceWO|wo)\./.test(key);
    }

    function crGrowthIcon(key) {
        if (/^loanOutstanding/.test(key)) return "💰";
        if (/^loanDisburse/.test(key)) return "💵";
        if (/^parT24/.test(key)) return "⚠️";
        if (/^nbcOverdue/.test(key)) return "⏰";
        if (/^writeOff/.test(key)) return "🧾";
        return "📊";
    }

    function crGrowthPoints(days, getItemForDay, getByPath, key) {
        const points = [];
        for (const day of days) {
            const item = getItemForDay(day);
            if (!item) continue;
            const raw = getByPath(item, key);
            if (raw == null || raw === "") continue;
            const value = Number(raw);
            if (Number.isFinite(value)) points.push({ date: day.date, value });
        }
        return points;
    }

    function crGrowthColumn(field, points, fmtNum, fmtPct) {
        const fmt = v => field.pct ? fmtPct(v) : fmtNum(v);
        const current = points[points.length - 1];
        const start = points.length > 1 ? points[0] : null;
        const delta = start ? current.value - start.value : null;
        const direction = delta == null || Math.abs(delta) < 1e-9 ? "flat" : delta > 0 ? "up" : "down";
        const tone = direction === "flat" ? "flat"
            : (direction === "up") !== crGrowthHigherIsWorse(field.key) ? "good" : "bad";
        const arrow = direction === "up" ? "▲" : direction === "down" ? "▼" : "—";
        const sign = direction === "up" ? "+" : direction === "down" ? "−" : "";
        const deltaText = delta == null ? tr("creditreport.growth.noChange", null, "No change") : sign + fmt(Math.abs(delta));

        return `
            <div class="cr-growth-col">
                <div class="cr-growth-label">${esc(field.label)}</div>
                <div class="cr-growth-current">${esc(fmt(current.value))}</div>
                <div class="cr-growth-previous">${esc(start ? tr("creditreport.growth.previous", { value: fmt(start.value) }, "Was " + fmt(start.value)) : "—")}</div>
                <div class="cr-growth-change ${tone}"><span aria-hidden="true">${arrow}</span> ${esc(deltaText)}</div>
            </div>`;
    }

    function render(root, opts) {
        if (!root) return;
        const { headerRoot, section, days = [], scope = "", getItemForDay, getByPath, fmtNum, fmtPct } = opts;

        let rangeStart = null;
        let rangeEnd = null;
        const cards = (section?.groups || []).map(group => {
            const cols = [];
            for (const field of group.fields) {
                const points = crGrowthPoints(days, getItemForDay, getByPath, field.key);
                if (!points.length) continue;
                if (!rangeStart || points[0].date < rangeStart) rangeStart = points[0].date;
                if (!rangeEnd || points[points.length - 1].date > rangeEnd) rangeEnd = points[points.length - 1].date;
                cols.push(crGrowthColumn(field, points, fmtNum, fmtPct));
            }
            if (!cols.length) return "";
            const firstKey = group.fields[0]?.key || "";
            // Single-group sections already name the group in the header.
            const cardTitle = section.groups.length > 1
                ? `<div class="cr-growth-card-title">${esc(crGrowthIcon(firstKey))} ${esc(group.label)}</div>`
                : "";
            return `
                <article class="cr-growth-card">
                    ${cardTitle}
                    <div class="cr-growth-cols" style="--cr-growth-cols:${cols.length}">${cols.join("")}</div>
                </article>`;
        }).filter(Boolean);

        // Header in the chart title: falls back to the loaded days' own range
        // when no field has data, so the title is never left blank.
        if (!rangeStart && days.length) {
            rangeStart = days[0].date;
            rangeEnd = days[days.length - 1].date;
        }
        if (headerRoot) {
            const groupLabel = section.groups.length === 1 ? section.groups[0].label : tr("creditreport.growth.title", null, "Growth / Decline");
            const icon = crGrowthIcon(section.groups[0]?.fields[0]?.key || "");
            const range = rangeStart && rangeEnd && rangeStart !== rangeEnd
                ? `${fmtShortDate(rangeStart)} → ${fmtShortDate(rangeEnd)}`
                : fmtShortDate(rangeEnd || "");
            headerRoot.innerHTML = `
                <div class="cr-growth-head">
                    <div class="cr-growth-icon" aria-hidden="true">${esc(icon)}</div>
                    <div class="cr-growth-head-text">
                        <div class="cr-growth-title">${esc(groupLabel)}</div>
                        <div class="cr-growth-scope">${esc(scope)}</div>
                        ${range ? `<div class="cr-growth-range" title="${esc(tr("creditreport.growth.rangeHint", null, "Start of selected range → latest day"))}">${esc(range)}</div>` : ""}
                    </div>
                </div>`;
        }

        root.innerHTML = cards.join("");
        root.hidden = !cards.length;
    }

    window.CRGrowthDashboard = { render, fmtShortDate, fmtShortDateTime, fmtCompact };
})();
