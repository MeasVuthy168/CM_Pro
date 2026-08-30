// ========================================
// OFFICER PRODUCTIVITY — per-officer drill-down from
// RepDetailbyCO.html (click an officer's name there to land here).
//
// DATA HANDOFF
// RepDetailbyCO.js stashes the clicked officer's already-fetched
// aggregate row (from GET /api/creditreport/byco) plus the report's
// current filters into sessionStorage under "cr_officer_detail"
// right before navigating here, so the 5 summary cards below render
// instantly with no extra network round trip. If that's missing or
// stale (a bookmarked/refreshed visit, or the back button landing here
// after sessionStorage was cleared), this page falls back to
// re-fetching /api/creditreport/byco itself using the same filters
// carried in the URL query string and finds the matching officer by
// name — see opReadHandoff()/opFetchAndFindOfficer() below.
//
// BACKEND ENDPOINTS
// The 5 summary cards use figures the /byco endpoint already returns
// per officer. Each card's "List of Client" (and, for Loan Disburse,
// "Chart") sub-view calls two more endpoints (CM-backend's
// lib/creditreport-co.js):
//
//   GET /api/creditreport/byco/officer-clients
//     ?section=<outstanding|disburse|parT24|nbcOverdue|writeOff>
//     &name=<officer name>&officerId=<officer id, if known>
//     &branch=&team=&fromDate=&toDate=&woFromDate=&woToDate=
//   -> { ok, items: [{ name, cif, loanNumber, disburseDate, address,
//                       productType, loanSize, osUsd }, ...] }
//   One row per client/loan under that officer + category, filtered
//   by the same date/branch/team filters the report is currently
//   showing. loanSize/osUsd are OS-sheet-only figures (Loan Size USD /
//   OS USD) — only populated for outstanding/disburse, "" elsewhere.
//
//   GET /api/creditreport/byco/officer-disburse-chart
//     ?name=<officer name>&officerId=<officer id, if known>
//     &branch=&team=&fromDate=&toDate=
//   -> { ok, labels: [...], dates: [...], values: [...], counts: [...] }
//   Daily disbursement value + loan count series for this officer,
//   zero-filled for every day of the calendar month fromDate falls in
//   (day 1 to the last day of that month — a complete beginning-to-
//   end-of-month view, independent of the report's own fromDate/toDate
//   filter). The Chart tab's prev/next month buttons (opNavigateDisburse-
//   Month) just re-call this with a different fromDate — any date in the
//   target month — so browsing months doesn't need its own endpoint.
//   Only used by the Loan Disburse card's Chart tab, rendered
//   as a calendar heatmap (one cell per day, colored by value, loan
//   count printed inside — see opBuildDisburseHeatmapHtml()). dates[] is
//   full "yyyy-mm-dd" strings (labels[] is display-only "DD-MM"), used to
//   work out which weekday each day falls on for the 7-column grid, and
//   to ring-highlight Sat/Sun + any date returned by kh-holidays below.
//   The heatmap's subtitle ("Period Date: ...") is NOT derived from this
//   endpoint — it uses the report's own fromDate/toDate filter and the
//   officer's already-known loanDisburse.loan/.value summary figures
//   instead.
//
//   GET /api/creditreport/byco/kh-holidays
//   -> { ok, holidays: [{ date: "yyyy-mm-dd", name }, ...] }
//   Cambodian public holidays, every year currently in CM-backend's
//   KH_HOLIDAYS_BY_YEAR (lib/creditreport-co.js) — manually maintained
//   there, not here, since several holidays are lunar-calendar-based and
//   set by government gazette year to year (no reliable free API for
//   them). Fetched once per page load via opEnsureKhHolidays() and
//   cached in opKhHolidays; a fetch failure just leaves holiday
//   highlighting off, it never breaks the heatmap itself.
//
// Both fail gracefully with a plain, honest message (see opErrorHtml)
// on any real failure rather than fabricating placeholder client data
// — this is a financial app, so a fake name/loan row here would be
// actively misleading, not just an empty state.
// ========================================

const OP_CATEGORIES = [
    {
        key: "outstanding",
        icon: "📊",
        label: "Loan Outstanding",
        chart: false,
        stats: [
            { key: "loanOutstanding.loan", label: "Loan" },
            { key: "loanOutstanding.client", label: "Client" },
            { key: "loanOutstanding.value", label: "Value", money: true }
        ]
    },
    {
        key: "disburse",
        icon: "💵",
        label: "Loan Disburse",
        chart: true,
        stats: [
            { key: "loanDisburse.loan", label: "Loan" },
            { key: "loanDisburse.value", label: "Value", money: true }
        ]
    },
    {
        key: "parT24",
        icon: "📈",
        label: "Balance Loan at Risk (T24)",
        chart: false,
        stats: [
            { key: "parT24.loan", label: "Loan" },
            { key: "parT24.value", label: "Value", money: true },
            { key: "parT24.parPct", label: "PAR", pct: true }
        ]
    },
    {
        key: "nbcOverdue",
        icon: "⚠️",
        label: "Balance Loan at Risk (NBC Overdue)",
        chart: false,
        stats: [
            { key: "nbcOverdue.totalOwn.value", label: "Own", money: true },
            { key: "nbcOverdue.totalArea.value", label: "Area", money: true }
        ]
    },
    {
        key: "writeOff",
        icon: "✂️",
        label: "Write Off",
        chart: false,
        stats: [
            { key: "writeOffOwn.wo.prn", label: "Own Prn", money: true },
            { key: "writeOffArea.wo.prn", label: "Area Prn", money: true }
        ]
    }
];

const opToken =
    localStorage.getItem("token") ||
    sessionStorage.getItem("token");

let opState = { officer: null, meta: null };

// Last-fetched Loan Disburse heatmap data, kept around so the fullscreen
// view (opOpenChartFullscreen) can re-render it without re-fetching.
let opDisburseChartData = null;

// ========================================
// HELPERS
// ========================================
function opGet(obj, path) {
    return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function opFmtNum(n) {
    n = Number(n) || 0;
    return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}
function opFmtPct(n) {
    n = Number(n) || 0;
    return (n * 100).toFixed(2) + "%";
}
function opFmtDateDMY(s) {
    if (!s) return "-";
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (!m) return s;
    return `${m[3]}-${m[2]}-${m[1]}`;
}
// "DD/MM/YY" (slash-separated, 2-digit year) — used only by the heatmap's
// "Period Date: ..." subtitle, whose format was specified separately from
// the rest of the page's "DD-MM-YYYY" convention (opFmtDateDMY above).
function opFmtDateDDMMYY(s) {
    if (!s) return "-";
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (!m) return s;
    return `${m[3]}/${m[2]}/${m[1].slice(2)}`;
}
function opToDMY(yyyymmdd) {
    const [y, m, d] = yyyymmdd.split("-");
    return `${d}-${m}-${y}`;
}
function opEscapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text == null ? "" : String(text);
    return div.innerHTML;
}
function opSkeletonHtml() {
    return `<div class="op-skel-line" style="width:90%"></div>
             <div class="op-skel-line" style="width:75%"></div>
             <div class="op-skel-line" style="width:82%"></div>`;
}
function opErrorHtml(err) {
    return `<div class="op-state op-state-error">${opEscapeHtml((err && err.message) || "Something went wrong.")}</div>`;
}

// ========================================
// READ HANDOFF FROM RepDetailbyCO.js
// ========================================
function opReadHandoff() {
    const params = new URLSearchParams(location.search);
    const name = params.get("name") || "";
    const urlMeta = {
        branch: params.get("branch") || "All Branch",
        team: params.get("team") || "All Team",
        fromDate: params.get("fromDate") || "",
        toDate: params.get("toDate") || "",
        woFromDate: params.get("woFromDate") || "",
        woToDate: params.get("woToDate") || ""
    };

    let handoff = null;
    try {
        const raw = sessionStorage.getItem("cr_officer_detail");
        if (raw) handoff = JSON.parse(raw);
    } catch (e) { /* ignore malformed cache */ }

    if (handoff && handoff.officer && handoff.officer.name === name) {
        return { officer: handoff.officer, meta: handoff.meta || urlMeta, name };
    }
    return { officer: null, meta: urlMeta, name };
}

function opBuildQuery(meta) {
    const parts = [];
    if (meta.fromDate) parts.push(`fromDate=${opToDMY(meta.fromDate)}`);
    if (meta.toDate) parts.push(`toDate=${opToDMY(meta.toDate)}`);
    if (meta.woFromDate) parts.push(`woFromDate=${opToDMY(meta.woFromDate)}`);
    if (meta.woToDate) parts.push(`woToDate=${opToDMY(meta.woToDate)}`);
    parts.push(`branch=${encodeURIComponent(meta.branch || "All Branch")}`);
    parts.push(`team=${encodeURIComponent(meta.team || "All Team")}`);
    return `?${parts.join("&")}`;
}

async function opFetchAndFindOfficer(meta, name) {
    const res = await fetch(`${API.BASE_URL}/api/creditreport/byco${opBuildQuery(meta)}`, {
        headers: { Authorization: `Bearer ${opToken}` }
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.message || "Failed to load report.");
    const item = (data.items || []).find(it => it.name === name);
    // This is the exact same roster opEnsureOfficerRoster() would fetch
    // for the search box — cache it now so a search shortly after this
    // fallback load doesn't re-fetch it.
    opOfficerRoster = data.items || [];
    opOfficerRosterPromise = Promise.resolve();
    return { item, data };
}

// ========================================
// RENDER — HEADER + CARDS
// ========================================
function opRenderHeader() {
    const officer = opState.officer;
    const meta = opState.meta;

    document.getElementById("opAvatar").textContent =
        (officer.name || "?").trim().charAt(0).toUpperCase() || "?";
    document.getElementById("opOfficerName").textContent = officer.name || "-";

    const chips = [];
    if (meta.branch && meta.branch !== "All Branch") chips.push(meta.branch);
    if (meta.team && meta.team !== "All Team") chips.push(meta.team);
    if (meta.fromDate && meta.toDate) {
        chips.push(`${opFmtDateDMY(meta.fromDate)} – ${opFmtDateDMY(meta.toDate)}`);
    }
    document.getElementById("opOfficerMeta").innerHTML =
        chips.map(c => `<span class="op-meta-chip">${opEscapeHtml(c)}</span>`).join("");

    document.getElementById("opHeaderCard").style.display = "flex";
}

function opCardMarkup(cat, officer) {
    const statsHtml = cat.stats.map(s => {
        const v = opGet(officer, s.key);
        const text = s.pct ? opFmtPct(v) : opFmtNum(v);
        return `<span>${opEscapeHtml(s.label)}: <b>${text}</b></span>`;
    }).join("");

    const chartTabHtml = cat.chart
        ? `<button type="button" class="op-mode-tab" data-mode="chart">📈 Chart</button>`
        : "";

    return `
      <div class="op-card" data-key="${cat.key}">
        <button type="button" class="op-card-head" aria-expanded="false">
          <div class="op-card-icon">${cat.icon}</div>
          <div class="op-card-title">
            <div class="op-card-label">${opEscapeHtml(cat.label)}</div>
            <div class="op-card-stats">${statsHtml}</div>
          </div>
          <div class="op-card-caret">▾</div>
        </button>
        <div class="op-card-panel">
          <div class="op-mode-tabs">
            <button type="button" class="op-mode-tab active" data-mode="list">👥 List of Client</button>
            ${chartTabHtml}
          </div>
          <div class="op-mode-body" data-mode-body></div>
        </div>
      </div>`;
}

function opRenderCards() {
    const wrap = document.getElementById("opCards");
    wrap.innerHTML = OP_CATEGORIES.map(cat => opCardMarkup(cat, opState.officer)).join("");
    wrap.style.display = "flex";
}

// ========================================
// ACCORDION + MODE SWITCHING
// ========================================
document.getElementById("opCards").addEventListener("click", (e) => {
    const head = e.target.closest(".op-card-head");
    if (head) {
        const card = head.closest(".op-card");
        const willOpen = !card.classList.contains("open");
        document.querySelectorAll("#opCards .op-card.open").forEach(c => {
            if (c !== card) { c.classList.remove("open"); c.querySelector(".op-card-head").setAttribute("aria-expanded", "false"); }
        });
        card.classList.toggle("open", willOpen);
        head.setAttribute("aria-expanded", willOpen ? "true" : "false");
        if (willOpen) opEnsureModeLoaded(card, "list");
        return;
    }

    const tab = e.target.closest(".op-mode-tab");
    if (tab) {
        const card = tab.closest(".op-card");
        card.querySelectorAll(".op-mode-tab").forEach(t => t.classList.remove("active"));
        tab.classList.add("active");
        opEnsureModeLoaded(card, tab.dataset.mode);
    }
});

async function opEnsureModeLoaded(card, mode) {
    const key = card.dataset.key;
    const body = card.querySelector("[data-mode-body]");

    if (mode === "list") {
        if (card._opListHtml) { body.innerHTML = card._opListHtml; return; }
        body.innerHTML = opSkeletonHtml();
        try {
            card._opListHtml = await opBuildClientListHtml(key);
            body.innerHTML = card._opListHtml;
        } catch (err) {
            body.innerHTML = opErrorHtml(err);
        }
        return;
    }

    // Chart (calendar heatmap) — always re-fetches/re-renders on reselect
    // rather than caching like "list" above. The heatmap's own markup
    // could be cached as a plain HTML string now that it isn't a live
    // Chart.js canvas instance, but its tooltip/fullscreen-trigger event
    // listeners wouldn't survive an innerHTML round-trip, so a cache hit
    // would still need to re-wire them — no simpler than just re-fetching.
    body.innerHTML = `<div class="op-chart-wrap">${opSkeletonHtml()}</div>`;
    const chartWrap = body.querySelector(".op-chart-wrap");
    try {
        await opRenderDisburseChart(key, chartWrap);
    } catch (err) {
        chartWrap.innerHTML = opErrorHtml(err);
    }
}

async function opBuildClientListHtml(sectionKey) {
    const q = opBuildQuery(opState.meta);
    const officer = opState.officer;
    const url = `${API.BASE_URL}/api/creditreport/byco/officer-clients${q}` +
        `&section=${encodeURIComponent(sectionKey)}` +
        `&name=${encodeURIComponent(officer.name || "")}` +
        `&officerId=${encodeURIComponent(officer.id || "")}`;

    const res = await fetch(url, { headers: { Authorization: `Bearer ${opToken}` } });
    if (!res.ok) throw new Error("Could not load the client list. Please try again.");
    const data = await res.json();
    if (!data.ok) throw new Error(data.message || "Could not load the client list.");

    return opClientTableHtml(data.items || []);
}

// Shared by the category "List of Client" tab above and the heatmap's
// per-day client list below (see opWireDayClientPanel) — showDate is off
// for the latter since every row on a single day shares the same
// disburse date, already shown in that panel's own header.
function opClientTableHtml(rows, { showDate = true } = {}) {
    if (!rows.length) return `<div class="op-state">No clients found for this category.</div>`;

    return `
      <div class="op-client-table-wrap">
        <table class="op-client-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>CIF</th>
              <th>Loan Number</th>
              ${showDate ? "<th>Disburse Date</th>" : ""}
              <th>Address</th>
              <th>Product Type</th>
              <th>Loan Size</th>
              <th>OS USD</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(r => `<tr>
              <td>${opEscapeHtml(r.name)}</td>
              <td>${opEscapeHtml(r.cif)}</td>
              <td>${opEscapeHtml(r.loanNumber)}</td>
              ${showDate ? `<td>${opEscapeHtml(opFmtDateDMY(r.disburseDate))}</td>` : ""}
              <td>${opEscapeHtml(r.address)}</td>
              <td>${opEscapeHtml(r.productType)}</td>
              <td>${r.loanSize === "" || r.loanSize == null ? "" : opEscapeHtml(opFmtNum(r.loanSize))}</td>
              <td>${r.osUsd === "" || r.osUsd == null ? "" : opEscapeHtml(opFmtNum(r.osUsd))}</td>
            </tr>`).join("")}
          </tbody>
        </table>
      </div>`;
}

// Buckets a day's disbursed value into a 0-4 sequential intensity step
// for the heatmap, relative to the busiest day in the visible month. 0
// means literally no disbursement that day (rendered as a distinct empty
// cell, not just "the lightest color in the ramp") — a day with a small
// amount still gets step 1, not folded into "no activity."
function opHeatBucket(value, maxValue) {
    if (!value || value <= 0 || !maxValue) return 0;
    const pct = value / maxValue;
    if (pct > 0.7) return 4;
    if (pct > 0.45) return 3;
    if (pct > 0.2) return 2;
    return 1;
}

const OP_HEAT_DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Cambodian public holidays ("yyyy-mm-dd" keys) that get the same
// highlight ring as Sat/Sun on the heatmap (see op-heat-holiday below).
// Populated from GET /api/creditreport/byco/kh-holidays — CM-backend's
// manually maintained KH_HOLIDAYS_BY_YEAR list, not duplicated here,
// since several Cambodian holidays are lunar-calendar-based and set by
// government gazette year to year. opEnsureKhHolidays() fills this once
// per page load; a fetch failure just leaves it empty (Sat/Sun highlight
// and everything else still works — see that function).
let opKhHolidays = new Set();
let opKhHolidaysPromise = null;
function opEnsureKhHolidays() {
    if (!opKhHolidaysPromise) {
        opKhHolidaysPromise = fetch(`${API.BASE_URL}/api/creditreport/byco/kh-holidays`, {
            headers: { Authorization: `Bearer ${opToken}` }
        })
            .then(res => res.json())
            .then(data => {
                if (data && data.ok && Array.isArray(data.holidays)) {
                    opKhHolidays = new Set(data.holidays.map(h => h.date));
                }
            })
            .catch(err => console.error("kh-holidays fetch failed:", err));
    }
    return opKhHolidaysPromise;
}

// Builds the calendar-heatmap markup (title + subtitle lines + 7-column
// day grid + legend + prev/next month nav) — one cell per day of the
// month, colored by disbursed value, with the loan count printed inside;
// Sat/Sun and any date in opKhHolidays get an extra ring highlight.
// Shared by the inline chart and the fullscreen view so the two can't
// drift out of sync. The nav row's month/year label always reflects
// dates[0], not the report's own period — see opNavigateDisburseMonth.
// "T00:00:00" (no Z) forces LOCAL-time parsing for the weekday lookup —
// a bare "yyyy-mm-dd" string parses as UTC midnight per spec, which can
// land on the wrong calendar day in negative-UTC-offset timezones.
function opBuildDisburseHeatmapHtml(dates, values, counts, officer, meta) {
    const maxValue = Math.max(0, ...values);
    const firstDow = new Date(dates[0] + "T00:00:00").getDay();

    let cells = OP_HEAT_DOW.map(d => `<div class="op-heat-dow">${d}</div>`).join("");
    for (let i = 0; i < firstDow; i++) cells += `<div class="op-heat-cell op-heat-pad"></div>`;

    dates.forEach((dateStr, i) => {
        const day = Number(dateStr.slice(8, 10));
        const value = values[i] || 0;
        const count = counts[i] || 0;
        const bucket = opHeatBucket(value, maxValue);
        const dow = new Date(dateStr + "T00:00:00").getDay();

        const classes = ["op-heat-cell"];
        if (bucket) classes.push(`op-heat-h${bucket}`);
        if (dow === 0 || dow === 6) classes.push("op-heat-weekend");
        if (opKhHolidays.has(dateStr)) classes.push("op-heat-holiday");

        cells += `
          <div class="${classes.join(" ")}"
               data-date="${dateStr}" data-value="${value}" data-count="${count}">
            <span class="op-heat-day">${day}</span>
            ${count > 0 ? `<span class="op-heat-badge">${count}</span>` : ""}
          </div>`;
    });

    const officerName = officer?.name || "";

    // The "Period Date"/"Total Disburse" lines describe whatever month is
    // actually on screen, which after opNavigateDisburseMonth() may not
    // be the report's own period month anymore. On the original month,
    // keep showing the report's real (possibly partial-month) filter
    // period and the officer's own loanDisburse summary — the exact
    // figures the report itself stands behind. On any other month, there
    // is no such report-level figure for that month, so both lines
    // switch to the full displayed month and a sum of its own
    // values/counts (i.e. exactly what the grid below is showing).
    const displayedMonthKey = dates[0].slice(0, 7);
    const isOriginalMonth = meta && meta.fromDate && displayedMonthKey === meta.fromDate.slice(0, 7);

    let period, totalLoan, totalValue;
    if (isOriginalMonth && meta.toDate) {
        period = `${opFmtDateDDMMYY(meta.fromDate)}-${opFmtDateDDMMYY(meta.toDate)}`;
        totalLoan = opGet(officer, "loanDisburse.loan");
        totalValue = opGet(officer, "loanDisburse.value");
    } else {
        period = `${opFmtDateDDMMYY(dates[0])}-${opFmtDateDDMMYY(dates[dates.length - 1])}`;
        totalLoan = counts.reduce((sum, c) => sum + (c || 0), 0);
        totalValue = values.reduce((sum, v) => sum + (v || 0), 0);
    }

    // Month/year label for the prev/next nav row below.
    const monthLabel = new Date(dates[0] + "T00:00:00")
        .toLocaleString("en-US", { month: "long", year: "numeric" });

    return `
      <div class="op-heat-title">Daily Loan Disbursement — ${opEscapeHtml(officerName)}</div>
      <div class="op-heat-subtitle-group">
        <div class="op-heat-subtitle-line">Period Date: ${period}</div>
        <div class="op-heat-subtitle-line">Total  Disburse: ${opFmtNum(totalLoan)}LD, USD${opFmtNum(totalValue)}</div>
      </div>
      <div class="op-heat-grid">${cells}</div>
      <div class="op-heat-legend">
        <span>Less</span>
        <span class="op-heat-sw op-heat-h0"></span>
        <span class="op-heat-sw op-heat-h1"></span>
        <span class="op-heat-sw op-heat-h2"></span>
        <span class="op-heat-sw op-heat-h3"></span>
        <span class="op-heat-sw op-heat-h4"></span>
        <span>More</span>
      </div>
      <div class="op-heat-legend op-heat-legend-2">
        <span class="op-heat-sw op-heat-ring-weekend"></span><span>Weekend</span>
        <span class="op-heat-sw op-heat-ring-holiday"></span><span>Holiday</span>
      </div>
      <div class="op-heat-nav">
        <button type="button" class="op-heat-nav-btn" data-dir="prev" aria-label="Previous month">‹</button>
        <span class="op-heat-nav-label">${opEscapeHtml(monthLabel)}</span>
        <button type="button" class="op-heat-nav-btn" data-dir="next" aria-label="Next month">›</button>
      </div>
      <div class="op-heat-day-panel"></div>`;
}

// Wires the prev/next month buttons appended by opBuildDisburseHeatmapHtml.
// stopPropagation keeps a nav click from also bubbling up to the inline
// view's fullscreen-open listener (see opWireChartFullscreenTriggers).
function opWireDisburseNav(container, onNavigate) {
    container.querySelectorAll(".op-heat-nav-btn").forEach(btn => {
        btn.addEventListener("click", e => {
            e.stopPropagation();
            onNavigate(btn.dataset.dir === "next" ? 1 : -1);
        });
    });
}

// "yyyy-mm-01" -> "yyyy-mm-01" shifted by `delta` whole months (can be
// negative). Used to turn a prev/next click into the fromDate override
// opFetchDisburseChartData sends the backend, which always renders
// whichever full calendar month that date falls in.
function opShiftMonthKey(anchorKey, delta) {
    const [y, m] = anchorKey.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

// One shared floating tooltip element (created once, reused by both the
// inline and fullscreen heatmap) rather than the browser's default
// title-attribute tooltip, to match the rest of the app's styling.
let opHeatTooltipEl = null;
function opEnsureHeatTooltip() {
    if (!opHeatTooltipEl) {
        opHeatTooltipEl = document.createElement("div");
        opHeatTooltipEl.className = "op-heat-tooltip";
        document.body.appendChild(opHeatTooltipEl);
    }
    return opHeatTooltipEl;
}

function opShowHeatTooltip(cell, tooltip) {
    const date = cell.dataset.date;
    const value = Number(cell.dataset.value);
    const count = Number(cell.dataset.count);
    const [, mm, dd] = date.split("-");
    tooltip.innerHTML = `<span class="op-heat-tt-date">${dd}-${mm}:</span> ` + (
        value > 0 ? `${opFmtNum(value)} · ${count} loan${count > 1 ? "s" : ""}` : "No disbursement"
    );
    tooltip.classList.add("show");
}

// Hover-only (desktop mouse) — a cell click is handled separately by
// opWireDayClientPanel below, which shows the day's actual client list
// rather than repeating this tooltip's value/count preview.
function opWireHeatmapTooltips(container) {
    const tooltip = opEnsureHeatTooltip();
    container.querySelectorAll(".op-heat-cell:not(.op-heat-pad)").forEach(cell => {
        cell.addEventListener("mouseenter", () => opShowHeatTooltip(cell, tooltip));
        cell.addEventListener("mousemove", e => {
            tooltip.style.transform = "";
            tooltip.style.left = `${e.clientX + 14}px`;
            tooltip.style.top = `${e.clientY + 14}px`;
        });
        cell.addEventListener("mouseleave", () => tooltip.classList.remove("show"));
    });
}

// Fetches the clients this officer disbursed on one specific day, by
// calling the exact same officer-clients endpoint the "List of Client"
// tab uses (section=disburse) with fromDate=toDate=that single day —
// its date filter already checks each row's disburse date against
// [fromDate, toDate], so a same-day range needs no backend change.
async function opFetchDayClients(dateKey) {
    const officer = opState.officer;
    const q = opBuildQuery({ ...opState.meta, fromDate: dateKey, toDate: dateKey });
    const url = `${API.BASE_URL}/api/creditreport/byco/officer-clients${q}` +
        `&section=disburse` +
        `&name=${encodeURIComponent(officer.name || "")}` +
        `&officerId=${encodeURIComponent(officer.id || "")}`;

    const res = await fetch(url, { headers: { Authorization: `Bearer ${opToken}` } });
    if (!res.ok) throw new Error("Could not load clients for this day. Please try again.");
    const data = await res.json();
    if (!data.ok) throw new Error(data.message || "Could not load clients for this day.");
    return data.items || [];
}

// Clicking a day cell loads and shows its client list in the
// .op-heat-day-panel appended by opBuildDisburseHeatmapHtml, right below
// the grid/legend/nav. Clicking the same cell again closes it; clicking
// a different cell replaces it. stopPropagation keeps the click from
// also bubbling up to the inline view's fullscreen-open listener (see
// opWireChartFullscreenTriggers) — a cell's primary action is now this
// panel, not opening fullscreen (tapping the title/legend/nav-label
// area, or the ⛶ button, still opens fullscreen as before).
function opWireDayClientPanel(container) {
    const panel = container.querySelector(".op-heat-day-panel");
    if (!panel) return;
    let activeDate = null;

    container.querySelectorAll(".op-heat-cell:not(.op-heat-pad)").forEach(cell => {
        cell.addEventListener("click", async e => {
            e.stopPropagation();
            const date = cell.dataset.date;

            container.querySelectorAll(".op-heat-cell.op-heat-cell-selected")
                .forEach(c => c.classList.remove("op-heat-cell-selected"));

            if (activeDate === date) {
                activeDate = null;
                panel.innerHTML = "";
                return;
            }
            activeDate = date;
            cell.classList.add("op-heat-cell-selected");

            const [, mm, dd] = date.split("-");
            const count = Number(cell.dataset.count) || 0;
            const heading = `<div class="op-heat-day-panel-head">${dd}-${mm}: ${count} loan${count === 1 ? "" : "s"}</div>`;

            if (count === 0) {
                panel.innerHTML = `<div class="op-heat-day-panel-head">${dd}-${mm}: No disbursement</div>`;
                return;
            }

            panel.innerHTML = heading + opSkeletonHtml();
            try {
                const rows = await opFetchDayClients(date);
                if (activeDate !== date) return; // superseded by a later click while this was loading
                panel.innerHTML = heading + opClientTableHtml(rows, { showDate: false });
            } catch (err) {
                if (activeDate !== date) return;
                panel.innerHTML = heading + opErrorHtml(err);
            }
        });
    });
}

// Last-fetched month's calendar key ("yyyy-mm-01") — the anchor
// opNavigateDisburseMonth shifts by ±1 to build the next fetch's
// fromDate override. Kept alongside opDisburseChartData since both
// describe "whatever month is currently on screen."
let opDisburseChartAnchor = null;

// Fetches one month of disbursement data and updates opDisburseChartData/
// opDisburseChartAnchor. monthOverride ("yyyy-mm-dd", any day in the
// target month) lets opNavigateDisburseMonth ask for a month other than
// the report's own fromDate — the backend always renders the full
// calendar month whichever date it's given falls in, so this is the only
// input that needs to change. Returns the fetched {dates,values,counts},
// or null when there's truly nothing to show (no officerId at all).
async function opFetchDisburseChartData(monthOverride) {
    const officer = opState.officer;
    const metaForQuery = monthOverride ? { ...opState.meta, fromDate: monthOverride } : opState.meta;
    const q = opBuildQuery(metaForQuery);
    const url = `${API.BASE_URL}/api/creditreport/byco/officer-disburse-chart${q}` +
        `&name=${encodeURIComponent(officer.name || "")}` +
        `&officerId=${encodeURIComponent(officer.id || "")}`;

    // Fired alongside the chart data fetch (not awaited on its own) —
    // holiday highlighting is a nice-to-have, so it shouldn't add latency
    // to the chart itself or block on a slow/failing upstream fetch.
    const holidaysReady = opEnsureKhHolidays();

    const res = await fetch(url, { headers: { Authorization: `Bearer ${opToken}` } });
    if (!res.ok) throw new Error("Could not load the disbursement chart. Please try again.");
    const data = await res.json();
    if (!data.ok) throw new Error(data.message || "Could not load the disbursement chart.");
    await holidaysReady;

    const dates = data.dates || [];
    if (!dates.length) {
        opDisburseChartData = null;
        return null;
    }
    opDisburseChartData = { dates, values: data.values || [], counts: data.counts || [] };
    opDisburseChartAnchor = `${dates[0].slice(0, 7)}-01`;
    return opDisburseChartData;
}

// Renders opDisburseChartData (already fetched) into either the inline
// card view or the fullscreen body — the only difference is the inline
// view also gets the ⛶ button and the tap-anywhere-to-open-fullscreen
// listener, neither of which make sense once already fullscreen.
function opRenderDisburseHeatmapInto(container, fullscreen) {
    const { dates, values, counts } = opDisburseChartData;
    const btnHtml = fullscreen
        ? ""
        : `<button type="button" class="op-chart-fullscreen-btn" aria-label="Fullscreen chart">⛶</button>`;
    container.innerHTML = btnHtml + opBuildDisburseHeatmapHtml(dates, values, counts, opState.officer, opState.meta);

    opWireHeatmapTooltips(container);
    opWireDayClientPanel(container);
    if (!fullscreen) opWireChartFullscreenTriggers(container);
    opWireDisburseNav(container, delta => opNavigateDisburseMonth(delta, container, fullscreen));
}

async function opNavigateDisburseMonth(delta, container, fullscreen) {
    const newAnchor = opShiftMonthKey(opDisburseChartAnchor, delta);
    container.innerHTML = opSkeletonHtml();
    try {
        const chartData = await opFetchDisburseChartData(newAnchor);
        if (!chartData) {
            container.innerHTML = `<div class="op-state">No disbursement data for this period.</div>`;
            return;
        }
        opRenderDisburseHeatmapInto(container, fullscreen);
    } catch (err) {
        container.innerHTML = opErrorHtml(err);
    }
}

async function opRenderDisburseChart(sectionKey, wrap) {
    const chartData = await opFetchDisburseChartData();
    if (!chartData) {
        wrap.innerHTML = `<div class="op-state">No disbursement data for this period.</div>`;
        return;
    }
    // A fullscreen button (plus tap/long-press anywhere on the heatmap —
    // see opWireChartFullscreenTriggers) opens the same heatmap bigger,
    // for anyone who wants larger day cells than this inline view allows.
    opRenderDisburseHeatmapInto(wrap, false);
}

// Tap, click, or press-and-hold anywhere on the heatmap OUTSIDE a day
// cell (title, subtitle, legend, nav label, grid padding) — or its
// dedicated button — opens the fullscreen view. Day cells stopPropagate
// their own click for opWireDayClientPanel instead (a cell's primary
// action is showing that day's clients, not opening fullscreen). A
// tap/click already fires on release for a long-press too in every
// mobile browser tested (nothing here depends on drag/scroll gestures,
// since the inline heatmap doesn't scroll), so one click listener
// naturally covers all three — the touch-callout suppression in CSS
// (op-chart-wrap) stops the OS's own long-press menu from intercepting
// the gesture first.
function opWireChartFullscreenTriggers(wrap) {
    wrap.addEventListener("click", opOpenChartFullscreen);
}

async function opOpenChartFullscreen() {
    if (!opDisburseChartData) return;
    const overlay = document.getElementById("opChartFsOverlay");
    const body = document.getElementById("opChartFsBody");
    if (!overlay || !body) return;

    overlay.hidden = false;
    document.body.style.overflow = "hidden";

    opRenderDisburseHeatmapInto(body, true);

    // Progressive enhancement, not a requirement — the fixed-position CSS
    // overlay above already gives a full-viewport view on every
    // platform, including iOS Safari, which has no Fullscreen API for
    // arbitrary elements. Where it's not available this just silently
    // no-ops and the CSS overlay alone still works. No orientation lock
    // here (unlike the previous bar-chart version) — a calendar grid's
    // natural aspect ratio (7 wide, several rows tall) generally reads
    // better in portrait, not worse, so there's nothing to force.
    try {
        if (overlay.requestFullscreen) await overlay.requestFullscreen();
        else if (overlay.webkitRequestFullscreen) overlay.webkitRequestFullscreen();
    } catch (e) { /* not supported / denied — the CSS overlay alone still works */ }
}

function opCloseChartFullscreen() {
    const overlay = document.getElementById("opChartFsOverlay");
    if (!overlay || overlay.hidden) return;

    overlay.hidden = true;
    document.body.style.overflow = "";

    if (document.fullscreenElement === overlay) {
        try { document.exitFullscreen(); } catch (e) { /* no-op */ }
    }
}

document.getElementById("opChartFsClose")?.addEventListener("click", opCloseChartFullscreen);

// Covers exiting fullscreen via ESC, the Android back gesture, or any
// other OS-level affordance that bypasses opChartFsClose entirely — keeps
// the overlay's own hidden state in sync either way.
document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement) opCloseChartFullscreen();
});

// ========================================
// OFFICER SEARCH
// Predictive search box (below the header card) that switches the whole
// page to a different officer under the SAME report filters (meta),
// without navigating back to RepDetailbyCO — matches by substring
// against the same roster GET /api/creditreport/byco already returns
// (data.items), fetched once and cached here.
// ========================================
let opOfficerRoster = null;
let opOfficerRosterPromise = null;
function opEnsureOfficerRoster() {
    if (!opOfficerRosterPromise) {
        opOfficerRosterPromise = fetch(`${API.BASE_URL}/api/creditreport/byco${opBuildQuery(opState.meta)}`, {
            headers: { Authorization: `Bearer ${opToken}` }
        })
            .then(res => res.json())
            .then(data => {
                opOfficerRoster = (data && data.ok && Array.isArray(data.items)) ? data.items : [];
            })
            .catch(err => {
                console.error("officer roster fetch failed:", err);
                opOfficerRoster = [];
            });
    }
    return opOfficerRosterPromise;
}

const OP_SEARCH_MAX_RESULTS = 8;
let opSearchMatches = [];
let opSearchActiveIndex = -1;

function opRenderSearchDropdown(matches) {
    const dropdown = document.getElementById("opSearchDropdown");
    opSearchMatches = matches;
    opSearchActiveIndex = matches.length ? 0 : -1;

    if (!matches.length) {
        dropdown.hidden = true;
        dropdown.innerHTML = "";
        return;
    }

    dropdown.innerHTML = matches.map((m, i) => {
        const metaBits = [m.branch, m.team].filter(v => v && v !== "All Branch" && v !== "All Team");
        return `
          <div class="op-search-item${i === 0 ? " active" : ""}" data-idx="${i}">
            <div class="op-search-item-name">${opEscapeHtml(m.name)}</div>
            ${metaBits.length ? `<div class="op-search-item-meta">${opEscapeHtml(metaBits.join(" · "))}</div>` : ""}
          </div>`;
    }).join("");
    dropdown.hidden = false;
}

function opCloseSearchDropdown() {
    const dropdown = document.getElementById("opSearchDropdown");
    dropdown.hidden = true;
    dropdown.innerHTML = "";
    opSearchMatches = [];
    opSearchActiveIndex = -1;
}

function opHighlightSearchItem(idx) {
    const dropdown = document.getElementById("opSearchDropdown");
    dropdown.querySelectorAll(".op-search-item").forEach(el => el.classList.remove("active"));
    const el = dropdown.querySelector(`.op-search-item[data-idx="${idx}"]`);
    if (el) { el.classList.add("active"); el.scrollIntoView({ block: "nearest" }); }
    opSearchActiveIndex = idx;
}

async function opHandleSearchInput(e) {
    const q = e.target.value.trim().toLowerCase();
    if (!q) { opCloseSearchDropdown(); return; }

    await opEnsureOfficerRoster();
    const matches = (opOfficerRoster || [])
        .filter(o => (o.name || "").toLowerCase().includes(q))
        .slice(0, OP_SEARCH_MAX_RESULTS);
    opRenderSearchDropdown(matches);
}

// Swaps opState.officer for the picked roster row and re-renders the
// header/cards in place — same report filters (opState.meta) throughout,
// only the officer changes. Keeps sessionStorage's handoff cache and the
// URL's name= param in sync so a refresh or the back button lands on
// whichever officer is actually being viewed, not the one originally
// clicked from RepDetailbyCO.
function opSwitchOfficer(item) {
    if (!item) return;
    opCloseSearchDropdown();
    const input = document.getElementById("opSearchInput");
    if (input) input.value = "";
    if (item.name === opState.officer?.name) return;

    opState.officer = item;
    opDisburseChartData = null;
    opDisburseChartAnchor = null;
    opCloseChartFullscreen();

    try {
        sessionStorage.setItem("cr_officer_detail", JSON.stringify({ officer: item, meta: opState.meta }));
    } catch (e) { /* storage unavailable/full — non-fatal, a refresh just re-fetches instead */ }
    const url = new URL(location.href);
    url.searchParams.set("name", item.name || "");
    history.replaceState(null, "", url);

    opRenderHeader();
    opRenderCards();
}

function opWireOfficerSearch() {
    const wrap = document.getElementById("opSearchWrap");
    const input = document.getElementById("opSearchInput");
    const dropdown = document.getElementById("opSearchDropdown");
    if (!wrap || !input || !dropdown) return;

    input.addEventListener("focus", () => opEnsureOfficerRoster());
    input.addEventListener("input", opHandleSearchInput);

    input.addEventListener("keydown", e => {
        if (dropdown.hidden || !opSearchMatches.length) return;
        if (e.key === "ArrowDown") {
            e.preventDefault();
            opHighlightSearchItem((opSearchActiveIndex + 1) % opSearchMatches.length);
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            opHighlightSearchItem((opSearchActiveIndex - 1 + opSearchMatches.length) % opSearchMatches.length);
        } else if (e.key === "Enter") {
            e.preventDefault();
            if (opSearchActiveIndex >= 0) opSwitchOfficer(opSearchMatches[opSearchActiveIndex]);
        } else if (e.key === "Escape") {
            opCloseSearchDropdown();
        }
    });

    dropdown.addEventListener("click", e => {
        const item = e.target.closest(".op-search-item");
        if (!item) return;
        const idx = Number(item.dataset.idx);
        if (opSearchMatches[idx]) opSwitchOfficer(opSearchMatches[idx]);
    });

    document.addEventListener("click", e => {
        if (!e.target.closest("#opSearchWrap")) opCloseSearchDropdown();
    });
}
opWireOfficerSearch();

// ========================================
// INIT
// ========================================
function opFinishLoad() {
    document.getElementById("opPageSkel").style.display = "none";
    document.getElementById("opSearchWrap").style.display = "block";
    opRenderHeader();
    opRenderCards();
}

function opShowEmpty(msg) {
    document.getElementById("opPageSkel").style.display = "none";
    const el = document.getElementById("opEmpty");
    el.textContent = msg;
    el.style.display = "block";
}

async function opInit() {
    const handoff = opReadHandoff();
    opState.meta = handoff.meta;

    if (handoff.officer) {
        opState.officer = handoff.officer;
        opFinishLoad();
        return;
    }

    if (!handoff.name) {
        opShowEmpty("No officer was specified. Go back and select an officer from the report.");
        return;
    }

    try {
        const { item } = await opFetchAndFindOfficer(handoff.meta, handoff.name);
        if (!item) {
            opShowEmpty(`Could not find "${handoff.name}" under the current report filters.`);
            return;
        }
        opState.officer = item;
        opFinishLoad();
    } catch (err) {
        console.error(err);
        opShowEmpty("Network error loading officer data.");
    }
}

opInit();
