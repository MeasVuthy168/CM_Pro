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
//     ?section=<outstanding|disburse|parT24|parT24Area|nbcOverdue|
//               nbcOverdueArea|writeOff|writeOffArea>
//     &name=<officer name>&officerId=<officer id, if known>
//     &branch=&team=&fromDate=&toDate=&woFromDate=&woToDate=
//   -> { ok, items: [{ name, cif, loanNumber, disburseDate, address,
//                       productType, class, loanSize, osUsd,
//                       prnOS, intOS, prnDue, intDue, penalty, arreas,
//                       day, balance, accountLoan }, ...] }
//   One row per client/loan under that officer + category, filtered
//   by the same date/branch/team filters the report is currently
//   showing. loanSize/osUsd are OS-sheet-only figures (Loan Size USD /
//   OS USD) — only populated for outstanding/disburse, "" elsewhere.
//   class is populated for parT24/parT24Area/nbcOverdue/nbcOverdueArea
//   (each source sheet's own classification column). prnOS..accountLoan
//   are ArreasT24ByCO-only (arrears.js's own COL map) — only populated
//   for parT24/parT24Area, undefined elsewhere; see opArrearsTableHtml()
//   below, which renders them for nbcOverdue/nbcOverdueArea too (simply
//   blank there, since the Overdue sheet backing those doesn't carry
//   them).
//   parT24Area/nbcOverdueArea/writeOffArea are the "Area" (in-area,
//   ក្នុងតំបន់) counterparts to parT24/nbcOverdue/writeOff ("Own") —
//   same officer-clients endpoint, a different section value, backing
//   those three cards' Own/Area tab split (see OP_CATEGORIES'
//   clientLists below). name= is what the backend joins Area rows on,
//   unlike Own's officerId join.
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

const t = (key, vars) => window.CMI18n ? CMI18n.t(key, vars) : key;

// Built by a function (not a frozen module-level const) so every label
// picks up the current language whenever a card is (re)rendered, rather
// than being baked in once at page-load time.
function opCategories() {
    return [
    {
        key: "outstanding",
        icon: "📊",
        label: t("creditreport.detail.sectionOutstanding"),
        chart: false,
        statGroups: [
            {
                label: t("creditreport.detail.own"),
                fields: [
                    { key: "loanOutstanding.loan", label: t("creditreport.productivity.colLoan") },
                    { key: "loanOutstanding.client", label: t("creditreport.productivity.colClient") },
                    { key: "loanOutstanding.value", label: t("creditreport.detail.colValue"), money: true }
                ]
            },
            {
                isArea: true,
                label: t("creditreport.detail.area"),
                fields: [
                    { key: "loanOutstandingArea.loan", label: t("creditreport.productivity.colLoan") },
                    { key: "loanOutstandingArea.client", label: t("creditreport.productivity.colClient") },
                    { key: "loanOutstandingArea.value", label: t("creditreport.detail.colValue"), money: true }
                ]
            }
        ],
        // Area, broken down by each matched row's own team/channel — merged
        // into the "Area:" line itself as a tree, always visible (not
        // gated by expand/collapse) — see opAreaTreeHtml() below.
        areaTeamGroups: [
            { label: t("creditreport.compare.dimOfficer"), fields: [
                { key: "loanOutstandingAreaByTeam.co.loan", label: t("creditreport.productivity.colLoan") },
                { key: "loanOutstandingAreaByTeam.co.client", label: t("creditreport.productivity.colClient") },
                { key: "loanOutstandingAreaByTeam.co.value", label: t("creditreport.detail.colValue"), money: true }
            ] },
            { label: t("creditreport.byBranch.teamDigital"), fields: [
                { key: "loanOutstandingAreaByTeam.digital.loan", label: t("creditreport.productivity.colLoan") },
                { key: "loanOutstandingAreaByTeam.digital.client", label: t("creditreport.productivity.colClient") },
                { key: "loanOutstandingAreaByTeam.digital.value", label: t("creditreport.detail.colValue"), money: true }
            ] }
        ],
        clientLists: [
            { section: "outstanding", label: t("creditreport.detail.own") },
            { section: "outstandingArea", label: t("creditreport.detail.area") }
        ]
    },
    {
        key: "disburse",
        icon: "💵",
        label: t("creditreport.detail.sectionDisburse"),
        chart: true,
        statGroups: [
            {
                label: t("creditreport.detail.own"),
                fields: [
                    { key: "loanDisburse.loan", label: t("creditreport.productivity.colLoan") },
                    { key: "loanDisburse.value", label: t("creditreport.detail.colValue"), money: true }
                ]
            },
            {
                isArea: true,
                label: t("creditreport.detail.area"),
                fields: [
                    { key: "loanDisburseArea.loan", label: t("creditreport.productivity.colLoan") },
                    { key: "loanDisburseArea.value", label: t("creditreport.detail.colValue"), money: true }
                ]
            }
        ],
        areaTeamGroups: [
            { label: t("creditreport.compare.dimOfficer"), fields: [
                { key: "loanDisburseAreaByTeam.co.loan", label: t("creditreport.productivity.colLoan") },
                { key: "loanDisburseAreaByTeam.co.value", label: t("creditreport.detail.colValue"), money: true }
            ] },
            { label: t("creditreport.byBranch.teamDigital"), fields: [
                { key: "loanDisburseAreaByTeam.digital.loan", label: t("creditreport.productivity.colLoan") },
                { key: "loanDisburseAreaByTeam.digital.value", label: t("creditreport.detail.colValue"), money: true }
            ] }
        ]
    },
    {
        key: "parT24",
        icon: "📈",
        label: t("creditreport.detail.sectionT24"),
        chart: false,
        statGroups: [
            {
                label: t("creditreport.detail.own"),
                fields: [
                    { key: "parT24.loan", label: t("creditreport.productivity.colLoan") },
                    { key: "parT24.value", label: t("creditreport.detail.colValue"), money: true },
                    { key: "parT24.parPct", label: t("creditreport.productivity.colPar"), pct: true }
                ]
            },
            {
                isArea: true,
                label: t("creditreport.detail.area"),
                fields: [
                    { key: "parT24Area.loan", label: t("creditreport.productivity.colLoan") },
                    { key: "parT24Area.value", label: t("creditreport.detail.colValue"), money: true },
                    { key: "parT24Area.parPct", label: t("creditreport.productivity.colPar"), pct: true }
                ]
            }
        ],
        areaTeamGroups: [
            { label: t("creditreport.compare.dimOfficer"), fields: [
                { key: "parT24AreaByTeam.co.loan", label: t("creditreport.productivity.colLoan") },
                { key: "parT24AreaByTeam.co.value", label: t("creditreport.detail.colValue"), money: true },
                { key: "parT24AreaByTeam.co.parPct", label: t("creditreport.productivity.colPar"), pct: true }
            ] },
            { label: t("creditreport.byBranch.teamDigital"), fields: [
                { key: "parT24AreaByTeam.digital.loan", label: t("creditreport.productivity.colLoan") },
                { key: "parT24AreaByTeam.digital.value", label: t("creditreport.detail.colValue"), money: true },
                { key: "parT24AreaByTeam.digital.parPct", label: t("creditreport.productivity.colPar"), pct: true }
            ] }
        ],
        clientLists: [
            { section: "parT24", label: t("creditreport.detail.own") },
            { section: "parT24Area", label: t("creditreport.detail.area") }
        ]
    },
    {
        key: "nbcOverdue",
        icon: "⚠️",
        label: t("creditreport.detail.sectionNbcOverdue"),
        chart: false,
        // Own/Area render as two stacked lines (see opCardMarkup) rather
        // than one flat stats: [...] row — each side has its own
        // Loan/Value/PAR, not just a single combined figure.
        statGroups: [
            {
                label: t("creditreport.detail.own"),
                fields: [
                    { key: "nbcOverdue.totalOwn.count", label: t("creditreport.productivity.colLoan") },
                    { key: "nbcOverdue.totalOwn.value", label: t("creditreport.detail.colValue"), money: true },
                    { key: "nbcOverdue.totalOwn.parPct", label: t("creditreport.productivity.colPar"), pct: true }
                ]
            },
            {
                isArea: true,
                label: t("creditreport.detail.area"),
                fields: [
                    { key: "nbcOverdue.totalArea.count", label: t("creditreport.productivity.colLoan") },
                    { key: "nbcOverdue.totalArea.value", label: t("creditreport.detail.colValue"), money: true },
                    { key: "nbcOverdue.totalArea.parPct", label: t("creditreport.productivity.colPar"), pct: true }
                ]
            }
        ],
        areaTeamGroups: [
            { label: t("creditreport.compare.dimOfficer"), fields: [
                { key: "nbcOverdueAreaByTeam.co.count", label: t("creditreport.productivity.colLoan") },
                { key: "nbcOverdueAreaByTeam.co.value", label: t("creditreport.detail.colValue"), money: true },
                { key: "nbcOverdueAreaByTeam.co.parPct", label: t("creditreport.productivity.colPar"), pct: true }
            ] },
            { label: t("creditreport.byBranch.teamDigital"), fields: [
                { key: "nbcOverdueAreaByTeam.digital.count", label: t("creditreport.productivity.colLoan") },
                { key: "nbcOverdueAreaByTeam.digital.value", label: t("creditreport.detail.colValue"), money: true },
                { key: "nbcOverdueAreaByTeam.digital.parPct", label: t("creditreport.productivity.colPar"), pct: true }
            ] }
        ],
        // Two separate "List of Client" sub-tabs (Own/Area) instead of
        // one — each hits a different officer-clients `section` (see
        // opClientListTabs()/opBuildClientListHtml() below).
        clientLists: [
            { section: "nbcOverdue", label: t("creditreport.detail.own") },
            { section: "nbcOverdueArea", label: t("creditreport.detail.area") }
        ]
    },
    // Shows Balance WO (the outstanding written-off balance, # cif/Int/Prn —
    // "count" here, unlike balanceWO.cif elsewhere, since that's this
    // file's own field name for the same figure) rather than the WO period
    // figures, per explicit request 2026-10-01 — same change made to
    // Location/Product Performance/Branch Productivity.
    {
        key: "writeOff",
        icon: "✂️",
        label: t("creditreport.detail.sectionWriteOff"),
        chart: false,
        statGroups: [
            {
                label: t("creditreport.detail.own"),
                fields: [
                    { key: "writeOffOwn.balanceWO.count", label: t("creditreport.detail.colCifHash") },
                    { key: "writeOffOwn.balanceWO.int", label: t("creditreport.detail.colInt"), money: true },
                    { key: "writeOffOwn.balanceWO.prn", label: t("creditreport.detail.colPrn"), money: true }
                ]
            },
            {
                isArea: true,
                label: t("creditreport.detail.area"),
                fields: [
                    { key: "writeOffArea.balanceWO.count", label: t("creditreport.detail.colCifHash") },
                    { key: "writeOffArea.balanceWO.int", label: t("creditreport.detail.colInt"), money: true },
                    { key: "writeOffArea.balanceWO.prn", label: t("creditreport.detail.colPrn"), money: true }
                ]
            }
        ],
        areaTeamGroups: [
            { label: t("creditreport.compare.dimOfficer"), fields: [
                { key: "writeOffAreaByTeam.co.balanceWO.count", label: t("creditreport.detail.colCifHash") },
                { key: "writeOffAreaByTeam.co.balanceWO.int", label: t("creditreport.detail.colInt"), money: true },
                { key: "writeOffAreaByTeam.co.balanceWO.prn", label: t("creditreport.detail.colPrn"), money: true }
            ] },
            { label: t("creditreport.byBranch.teamDigital"), fields: [
                { key: "writeOffAreaByTeam.digital.balanceWO.count", label: t("creditreport.detail.colCifHash") },
                { key: "writeOffAreaByTeam.digital.balanceWO.int", label: t("creditreport.detail.colInt"), money: true },
                { key: "writeOffAreaByTeam.digital.balanceWO.prn", label: t("creditreport.detail.colPrn"), money: true }
            ] }
        ],
        clientLists: [
            { section: "writeOff", label: t("creditreport.detail.own") },
            { section: "writeOffArea", label: t("creditreport.detail.area") }
        ]
    }
    ];
}

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
    return `<div class="op-state op-state-error">${opEscapeHtml((err && err.message) || t("voice.genericError"))}</div>`;
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
    if (!data.ok) throw new Error(data.message || t("creditreport.detail.failedLoadReport"));
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

// One flat stats: [...] row (parT24), or — for a category with statGroups
// (Loan Outstanding, Loan Disburse, NBC Overdue, Write Off) — a stacked
// line per group (Own/Area), each led by its own bold group label.
function opStatFieldHtml(f, officer) {
    const v = opGet(officer, f.key);
    const text = f.pct ? opFmtPct(v) : opFmtNum(v);
    return `<span>${opEscapeHtml(f.label)}: <b>${text}</b></span>`;
}
function opCardStatsHtml(cat, officer) {
    if (cat.statGroups) {
        return cat.statGroups.map(g => {
            // Area gets its own values folded straight into the "Area:"
            // line, with the FSRO/CO/Digital breakdown nested right below
            // it as a tree — always visible, same as Own, not gated by
            // expand/collapse. See opAreaTreeHtml().
            if (g.isArea && cat.areaTeamGroups) {
                return opAreaTreeHtml(g, cat, officer);
            }
            return `
              <div class="op-card-stats">
                <span class="op-card-stats-group-label">${opEscapeHtml(g.label)}:</span>
                ${g.fields.map(f => opStatFieldHtml(f, officer)).join("")}
              </div>`;
        }).join("");
    }
    return `<div class="op-card-stats">${cat.stats.map(s => opStatFieldHtml(s, officer)).join("")}</div>`;
}

// "Area:" — its own combined figures right on that line (same as before),
// plus a FSRO/CO/Digital breakdown nested under it as a tree: each row
// gets its own short connector tick, reading as children of "Area:" the
// same way "Own:" and "Area:" read as siblings of each other.
function opAreaTreeHtml(areaGroup, cat, officer) {
    return `
      <div class="op-card-team-breakdown">
        <div class="op-card-stats op-card-team-breakdown-area">
          <span class="op-card-stats-group-label">${opEscapeHtml(areaGroup.label)}:</span>
          ${areaGroup.fields.map(f => opStatFieldHtml(f, officer)).join("")}
        </div>
        ${cat.areaTeamGroups.map(g => `
          <div class="op-card-team-row-wrap">
            <div class="op-card-stats op-card-team-row">
              <span class="op-card-team-row-label">${opEscapeHtml(g.label)}:</span>
              ${g.fields.map(f => opStatFieldHtml(f, officer)).join("")}
            </div>
          </div>`).join("")}
      </div>`;
}

// A category with clientLists (NBC Overdue, Write Off) gets one "List of
// Client" tab per entry (Own/Area) instead of one — each tab's data-mode
// is "list:<section>" so opEnsureModeLoaded knows which officer-clients
// section to fetch. Everything else keeps the single plain "list" mode,
// which resolves to the category's own key (unchanged behavior).
function opCardMarkup(cat, officer) {
    const listTabsHtml = cat.clientLists
        ? cat.clientLists.map((cl, i) =>
            `<button type="button" class="op-mode-tab${i === 0 ? " active" : ""}" data-mode="list:${cl.section}">👥 ${t("creditreport.productivity.listOfClient")} ${opEscapeHtml(cl.label)}</button>`
          ).join("")
        : `<button type="button" class="op-mode-tab active" data-mode="list">👥 ${t("creditreport.productivity.listOfClient")}</button>`;

    const chartTabHtml = cat.chart
        ? `<button type="button" class="op-mode-tab" data-mode="chart">📈 ${t("creditreport.detail.chart")}</button>`
        : "";

    return `
      <div class="op-card" data-key="${cat.key}">
        <button type="button" class="op-card-head" aria-expanded="false">
          <div class="op-card-icon">${cat.icon}</div>
          <div class="op-card-title">
            <div class="op-card-label">${opEscapeHtml(cat.label)}</div>
            ${opCardStatsHtml(cat, officer)}
          </div>
          <div class="op-card-caret">▾</div>
        </button>
        <div class="op-card-panel">
          <div class="op-mode-tabs">
            ${listTabsHtml}
            ${chartTabHtml}
          </div>
          <div class="op-mode-body" data-mode-body></div>
        </div>
      </div>`;
}

function opRenderCards() {
    const wrap = document.getElementById("opCards");
    wrap.innerHTML = opCategories().map(cat => opCardMarkup(cat, opState.officer)).join("");
    wrap.style.display = "flex";
    opFitStatsToWidth();
}

// ========================================
// FIT STATS ROWS TO SCREEN WIDTH
// Same fix as BranchProductivity.js's bpFitStatsToWidth() — these two
// pages share the .op-card-stats markup/CSS, so they need the same
// per-row font-size shrink to guarantee no wrap and no horizontal
// scroll regardless of content length.
// ========================================
function opFitStatsToWidth() {
    const rows = document.querySelectorAll("#opCards .op-card-stats");
    rows.forEach(row => {
        row.style.fontSize = "";
        let size = parseFloat(getComputedStyle(row).fontSize);
        const minSize = 7;
        while (row.scrollWidth > row.clientWidth + 0.5 && size > minSize) {
            size -= 0.5;
            row.style.fontSize = `${size}px`;
        }
    });
}

let opFitResizeTimer;
window.addEventListener("resize", () => {
    clearTimeout(opFitResizeTimer);
    opFitResizeTimer = setTimeout(opFitStatsToWidth, 150);
});

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
        if (willOpen) {
            const activeTab = card.querySelector(".op-mode-tab.active");
            opEnsureModeLoaded(card, activeTab ? activeTab.dataset.mode : "list");
        }
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

    if (mode === "list" || mode.startsWith("list:")) {
        // "list" (single-tab categories) resolves to the category's own
        // key, same section officer-clients has always used for it.
        // "list:<section>" (NBC Overdue/Write Off/T24's Own vs Area tabs)
        // names the section explicitly instead. Cached per-mode (as raw
        // rows, not rendered HTML — opRenderClientListInto needs the
        // live array to wire sort/export against) so switching between
        // Own/Area doesn't refetch one you already loaded, without
        // either tab clobbering the other's cache. A cache hit still
        // re-renders from scratch, so sort state doesn't carry over
        // between visits — same as reopening a spreadsheet.
        const section = mode.startsWith("list:") ? mode.slice(5) : card.dataset.key;
        card._opListCache = card._opListCache || {};
        const renderOpts = {
            arrears: OP_ARREARS_SECTIONS.has(section),
            filenamePrefix: `${opState.officer?.name || "officer"}_${section}`
        };
        if (card._opListCache[mode]) {
            opRenderClientListInto(body, card._opListCache[mode], renderOpts);
            return;
        }
        body.innerHTML = opSkeletonHtml();
        try {
            const rows = await opFetchClientListRows(section);
            card._opListCache[mode] = rows;
            opRenderClientListInto(body, rows, renderOpts);
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

// T24 and NBC Overdue's client lists (both Own and Area) use the richer
// arrears-style table (opArrearsTableHtml) instead of the generic one —
// see that function for why.
const OP_ARREARS_SECTIONS = new Set(["parT24", "parT24Area", "nbcOverdue", "nbcOverdueArea"]);

async function opFetchClientListRows(sectionKey) {
    const q = opBuildQuery(opState.meta);
    const officer = opState.officer;
    const url = `${API.BASE_URL}/api/creditreport/byco/officer-clients${q}` +
        `&section=${encodeURIComponent(sectionKey)}` +
        `&name=${encodeURIComponent(officer.name || "")}` +
        `&officerId=${encodeURIComponent(officer.id || "")}`;

    const res = await fetch(url, { headers: { Authorization: `Bearer ${opToken}` } });
    if (!res.ok) throw new Error(t("creditreport.productivity.clientListLoadFailedRetry"));
    const data = await res.json();
    if (!data.ok) throw new Error(data.message || t("creditreport.productivity.clientListLoadFailed"));
    return data.items || [];
}

// ---- Column specs ----
// Single source of truth per table shape — drives the <th>/<td> markup,
// the sort type each column click-sorts by (opWireSortableTable), and
// the Excel export column set (opExportRowsToExcel), so all three can
// never drift out of sync with each other.
// Functions (not frozen consts) so labels pick up the current language.
function opClientTableCols() {
    return [
        { key: "name", label: t("creditreport.compare.colName"), type: "text" },
        { key: "cif", label: t("creditreport.compare.colCif"), type: "text" },
        { key: "loanNumber", label: t("creditreport.productivity.colLoanNumber"), type: "text" },
        { key: "disburseDate", label: t("creditreport.productivity.colDisburseDate"), type: "date" },
        { key: "address", label: t("creditreport.productivity.colAddress"), type: "text" },
        { key: "productType", label: t("creditreport.detail.productType"), type: "text" },
        { key: "loanSize", label: t("creditreport.productivity.colLoanSize"), type: "number" },
        { key: "osUsd", label: t("creditreport.productivity.colOsUsd"), type: "number" }
    ];
}

function opArrearsTableCols() {
    return [
        { key: "name", label: t("creditreport.productivity.colCustomer"), type: "text" },
        { key: "loanNumber", label: t("creditreport.productivity.colLoanNumber"), type: "text" },
        { key: "class", label: t("creditreport.compare.colClass"), type: "text" },
        { key: "productType", label: t("creditreport.detail.productType"), type: "text" },
        { key: "address", label: t("creditreport.compare.dimLocation"), type: "text" },
        { key: "disburseDate", label: t("creditreport.productivity.colDisDate"), type: "date" },
        { key: "prnOS", label: t("creditreport.productivity.colPrnOs"), type: "number" },
        { key: "intOS", label: t("creditreport.productivity.colIntOs"), type: "number" },
        { key: "prnDue", label: t("creditreport.productivity.colPrnDue"), type: "number" },
        { key: "intDue", label: t("creditreport.productivity.colIntDue"), type: "number" },
        { key: "penalty", label: t("creditreport.productivity.colPenalty"), type: "number" },
        { key: "arreas", label: t("creditreport.productivity.colArreas"), type: "number" },
        { key: "day", label: t("creditreport.productivity.colDay"), type: "number" },
        { key: "balance", label: t("creditreport.productivity.colBalnce"), type: "number" },
        { key: "accountLoan", label: t("creditreport.productivity.colAccountLoan"), type: "text" },
        { key: "cif", label: t("creditreport.compare.colCif"), type: "text" }
    ];
}

function opTableThHtml(col) {
    return `<th data-sort-key="${col.key}" data-sort-type="${col.type}">${opEscapeHtml(col.label)}</th>`;
}
function opTableTdHtml(col, row) {
    const v = row[col.key];
    if (v === "" || v == null) return "<td></td>";
    if (col.type === "number") return `<td>${opEscapeHtml(opFmtNum(v))}</td>`;
    if (col.type === "date") return `<td>${opEscapeHtml(opFmtDateDMY(v))}</td>`;
    return `<td>${opEscapeHtml(v)}</td>`;
}

// Shared by the category "List of Client" tab above and the heatmap's
// per-day client list below (see opWireDayClientPanel) — showDate is off
// for the latter since every row on a single day shares the same
// disburse date, already shown in that panel's own header.
function opClientTableHtml(rows, { showDate = true } = {}) {
    if (!rows.length) return `<div class="op-state">${t("creditreport.productivity.noClientsFound")}</div>`;
    const allCols = opClientTableCols();
    const cols = showDate ? allCols : allCols.filter(c => c.key !== "disburseDate");

    return `
      <div class="op-client-table-wrap">
        <table class="op-client-table">
          <thead><tr>${cols.map(opTableThHtml).join("")}</tr></thead>
          <tbody>${rows.map(r => `<tr>${cols.map(c => opTableTdHtml(c, r)).join("")}</tr>`).join("")}</tbody>
        </table>
      </div>`;
}

// The T24 (Balance Loan at Risk) client list, both Own and Area, backs
// this from CM-backend's officer-clients section=parT24/parT24Area — the
// same arrears.js-style row shape that page's own table already uses
// (Prn.OS/Int.OS/Prn.Due/Int.Due/Penalty/Arreas/Day/Balnce/Account Loan,
// plus Class/Product Type), rather than the generic outstanding/
// disburse/writeOff column set opClientTableHtml() renders. NBC
// Overdue's list (Own/Area) shares this same table on request, even
// though its rows don't carry the arrears-only fields — those just
// render blank there, since the Overdue sheet backing it doesn't carry
// them (same "blank rather than guess" convention opClientTableHtml()
// already follows for e.g. Write Off's Loan Size/OS USD). The leading
// "No" column is a plain row count, not a sortable field.
function opArrearsTableHtml(rows) {
    if (!rows.length) return `<div class="op-state">${t("creditreport.productivity.noClientsFound")}</div>`;
    const cols = opArrearsTableCols();

    return `
      <div class="op-client-table-wrap">
        <table class="op-client-table">
          <thead><tr><th>${t("creditreport.productivity.colNo")}</th>${cols.map(opTableThHtml).join("")}</tr></thead>
          <tbody>${rows.map((r, i) => `<tr><td>${i + 1}</td>${cols.map(c => opTableTdHtml(c, r)).join("")}</tr>`).join("")}</tbody>
        </table>
      </div>`;
}

// Ascending-comparator for one field, by column type. Missing/blank
// values always sort last regardless of direction (opWireSortableTable
// flips the overall result for descending, which would otherwise also
// flip blanks to the front — a "9999-99-99"/Infinity sentinel keeps them
// pinned to the end either way).
function opCompareForSort(a, b, type) {
    const blank = v => v === "" || v == null;
    if (type === "number") {
        const na = blank(a) ? Infinity : Number(a);
        const nb = blank(b) ? Infinity : Number(b);
        return na - nb;
    }
    if (type === "date") {
        const da = blank(a) ? "9999-99-99" : a; // "yyyy-mm-dd" sorts lexicographically = chronologically
        const db = blank(b) ? "9999-99-99" : b;
        return da < db ? -1 : da > db ? 1 : 0;
    }
    const sa = blank(a) ? "￿" : String(a).toLowerCase();
    const sb = blank(b) ? "￿" : String(b).toLowerCase();
    return sa < sb ? -1 : sa > sb ? 1 : 0;
}

// Makes every <th data-sort-key> in container's table click-to-sort,
// cycling through 3 states: ascending on the first click, descending on
// a second click of the same column, back to default (the order `rows`
// arrived in) on a third — a fourth click starts the cycle over at
// ascending. `rows` itself is never mutated — originalRows is a pristine
// snapshot taken once up front, and every click re-renders just the
// <tbody> (via buildTableHtml, the exact same opClientTableHtml/
// opArrearsTableHtml call the initial render used — re-running the whole
// builder and lifting its <tbody> out is simpler than maintaining a
// second row-only template per table shape) from a freshly computed
// sorted VIEW of originalRows, so "default" always has an intact
// original order to return to. Returns a getDisplayRows() function so
// the caller (Export Excel) can export whatever is currently shown.
function opWireSortableTable(container, rows, buildTableHtml) {
    const table = container.querySelector("table");
    const thead = table && table.querySelector("thead");
    if (!table || !thead) return () => rows;

    const originalRows = rows.slice();
    let sortKey = null;
    let sortDir = 1;
    let sortType = "text";

    function getDisplayRows() {
        if (!sortKey) return originalRows;
        return originalRows.slice().sort((a, b) => sortDir * opCompareForSort(a[sortKey], b[sortKey], sortType));
    }

    thead.querySelectorAll("th[data-sort-key]").forEach(th => {
        th.addEventListener("click", () => {
            const key = th.dataset.sortKey;
            const type = th.dataset.sortType || "text";
            if (sortKey !== key) {
                sortKey = key; sortType = type; sortDir = 1;
            } else if (sortDir === 1) {
                sortDir = -1;
            } else {
                sortKey = null; sortType = "text"; sortDir = 1;
            }

            thead.querySelectorAll("th[data-sort-key]").forEach(t => t.classList.remove("op-sort-asc", "op-sort-desc"));
            if (sortKey) th.classList.add(sortDir === 1 ? "op-sort-asc" : "op-sort-desc");

            const tmp = document.createElement("div");
            tmp.innerHTML = buildTableHtml(getDisplayRows());
            const newBody = tmp.querySelector("tbody");
            const oldBody = table.querySelector("tbody");
            if (newBody && oldBody) oldBody.innerHTML = newBody.innerHTML;
        });
    });

    return getDisplayRows;
}

// Exports the CURRENT (possibly sorted) rows to an .xlsx download, using
// the same column set/order/labels the on-screen table shows — never a
// silent superset or subset of what's visible.
function opExportRowsToExcel(rows, cols, filenamePrefix) {
    if (typeof XLSX === "undefined") {
        if (typeof showToast === "function") showToast(t("creditreport.detail.excelLibFailed"), "error");
        return;
    }
    if (!rows.length) {
        if (typeof showToast === "function") showToast(t("creditreport.detail.nothingToExport"), "warning");
        return;
    }
    const sheetData = rows.map((r, i) => {
        const out = { [t("creditreport.productivity.colNo")]: i + 1 };
        cols.forEach(c => {
            const v = r[c.key];
            out[c.label] = c.type === "date" ? opFmtDateDMY(v) : (v === "" || v == null ? "" : v);
        });
        return out;
    });
    const ws = XLSX.utils.json_to_sheet(sheetData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Clients");
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "");
    XLSX.writeFile(wb, `${filenamePrefix}_${stamp}.xlsx`);
}

// One-stop render for any client list in this page (category tabs below
// and the heatmap's per-day panel) — inserts the table (or the "No
// clients" empty state), then wires sort-by-column and the Export Excel
// button against the exact rows/columns actually on screen.
function opRenderClientListInto(container, rows, { arrears = false, showDate = true, filenamePrefix = "clients" } = {}) {
    const allCols = opClientTableCols();
    const cols = arrears ? opArrearsTableCols() : (showDate ? allCols : allCols.filter(c => c.key !== "disburseDate"));
    const buildTableHtml = arrears ? opArrearsTableHtml : (rs => opClientTableHtml(rs, { showDate }));

    const exportBtnHtml = rows.length
        ? `<div class="op-list-actions"><button type="button" class="op-list-export-btn">⬇ ${t("creditreport.menu.exportExcel")}</button></div>`
        : "";
    container.innerHTML = exportBtnHtml + buildTableHtml(rows);

    if (!rows.length) return;
    const getDisplayRows = opWireSortableTable(container, rows, buildTableHtml);
    container.querySelector(".op-list-export-btn")?.addEventListener("click", () => {
        opExportRowsToExcel(getDisplayRows(), cols, filenamePrefix);
    });
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

function opHeatDow() {
    return [
        t("creditreport.compare.dowSun"), t("creditreport.compare.dowMon"), t("creditreport.compare.dowTue"),
        t("creditreport.compare.dowWed"), t("creditreport.compare.dowThu"), t("creditreport.compare.dowFri"),
        t("creditreport.compare.dowSat")
    ];
}

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

    let cells = opHeatDow().map(d => `<div class="op-heat-dow">${d}</div>`).join("");
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
      <div class="op-heat-title">${t("creditreport.productivity.dailyLoanDisbursement")} — ${opEscapeHtml(officerName)}</div>
      <div class="op-heat-subtitle-group">
        <div class="op-heat-subtitle-line">${t("creditreport.productivity.periodDate")}: ${period}</div>
        <div class="op-heat-subtitle-line">${t("creditreport.productivity.totalDisburse")}: ${opFmtNum(totalLoan)}LD, USD${opFmtNum(totalValue)}</div>
      </div>
      <div class="op-heat-grid">${cells}</div>
      <div class="op-heat-legend">
        <span>${t("creditreport.productivity.less")}</span>
        <span class="op-heat-sw op-heat-h0"></span>
        <span class="op-heat-sw op-heat-h1"></span>
        <span class="op-heat-sw op-heat-h2"></span>
        <span class="op-heat-sw op-heat-h3"></span>
        <span class="op-heat-sw op-heat-h4"></span>
        <span>${t("creditreport.productivity.more")}</span>
      </div>
      <div class="op-heat-legend op-heat-legend-2">
        <span class="op-heat-sw op-heat-ring-weekend"></span><span>${t("creditreport.productivity.weekend")}</span>
        <span class="op-heat-sw op-heat-ring-holiday"></span><span>${t("creditreport.productivity.holiday")}</span>
      </div>
      <div class="op-heat-nav">
        <button type="button" class="op-heat-nav-btn" data-dir="prev" aria-label="${t("creditreport.compare.prevMonth")}">‹</button>
        <span class="op-heat-nav-label">${opEscapeHtml(monthLabel)}</span>
        <button type="button" class="op-heat-nav-btn" data-dir="next" aria-label="${t("creditreport.compare.nextMonth")}">›</button>
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
        value > 0 ? `${opFmtNum(value)} · ${t("creditreport.productivity.loanCount", { count })}` : t("creditreport.productivity.noDisbursement")
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
    if (!res.ok) throw new Error(t("creditreport.productivity.dayClientsLoadFailedRetry"));
    const data = await res.json();
    if (!data.ok) throw new Error(data.message || t("creditreport.productivity.dayClientsLoadFailed"));
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
                panel.innerHTML = heading + `<div class="op-heat-day-panel-body"></div>`;
                opRenderClientListInto(panel.querySelector(".op-heat-day-panel-body"), rows, {
                    showDate: false,
                    filenamePrefix: `${opState.officer?.name || "officer"}_disburse_${date}`
                });
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
    if (!res.ok) throw new Error(t("creditreport.productivity.chartLoadFailedRetry"));
    const data = await res.json();
    if (!data.ok) throw new Error(data.message || t("creditreport.productivity.chartLoadFailed"));
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
        : `<button type="button" class="op-chart-fullscreen-btn" aria-label="${t("creditreport.productivity.fullscreenChartAria")}">⛶</button>`;
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
        opShowEmpty(t("creditreport.productivity.noOfficerSpecified"));
        return;
    }

    try {
        const { item } = await opFetchAndFindOfficer(handoff.meta, handoff.name);
        if (!item) {
            opShowEmpty(t("creditreport.productivity.couldNotFindOfficer", { name: handoff.name }));
            return;
        }
        opState.officer = item;
        opFinishLoad();
    } catch (err) {
        console.error(err);
        opShowEmpty(t("creditreport.productivity.networkErrorOfficerData"));
    }
}

opInit();
