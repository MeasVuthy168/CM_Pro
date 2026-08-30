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
//   -> { ok, labels: [...], values: [...], counts: [...] }
//   Daily disbursement value + loan count series for this officer,
//   zero-filled for every day of the calendar month fromDate falls in
//   (day 1 to the last day of that month — a complete beginning-to-
//   end-of-month timeline, independent of the report's own fromDate/
//   toDate filter) — only used by the Loan Disburse card's Chart tab,
//   rendered as grouped bars on two Y axes (value and count have very
//   different scales).
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

// Last-fetched Loan Disburse chart data, kept around so the fullscreen
// view (opOpenChartFullscreen) can reuse it without re-fetching, plus the
// two live Chart.js instances (small inline + fullscreen) so re-opening
// destroys the previous instance instead of erroring on canvas reuse.
let opDisburseChartData = null;
let opDisburseChartSmall = null;
let opDisburseChartFs = null;

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

    // Chart — a Chart.js instance can't be cached as an HTML string, so
    // this always re-fetches/re-renders on reselect rather than caching.
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

    const rows = data.items || [];
    if (!rows.length) return `<div class="op-state">No clients found for this category.</div>`;

    return `
      <div class="op-client-table-wrap">
        <table class="op-client-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>CIF</th>
              <th>Loan Number</th>
              <th>Disburse Date</th>
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
              <td>${opEscapeHtml(opFmtDateDMY(r.disburseDate))}</td>
              <td>${opEscapeHtml(r.address)}</td>
              <td>${opEscapeHtml(r.productType)}</td>
              <td>${r.loanSize === "" || r.loanSize == null ? "" : opEscapeHtml(opFmtNum(r.loanSize))}</td>
              <td>${r.osUsd === "" || r.osUsd == null ? "" : opEscapeHtml(opFmtNum(r.osUsd))}</td>
            </tr>`).join("")}
          </tbody>
        </table>
      </div>`;
}

// Shared Chart.js config for the Loan Disburse chart — used for both the
// small inline chart and the fullscreen one, so the two never drift out
// of sync with each other. autoSkip adapts to whatever width the canvas
// actually gets (thins out X-axis text on the narrow inline chart, shows
// far more of it on the wide fullscreen/landscape canvas) — no separate
// variant needed.
function opBuildDisburseChartConfig(labels, values, counts, isDark, officerName) {
    const valueColor = isDark ? "#FFD700" : "#003B8B";
    const countColor = isDark ? "#4FD1C5" : "#D4380D";
    const titleColor = isDark ? "#fff" : "#1C2333";
    return {
        type: "bar",
        data: {
            labels,
            datasets: [
                {
                    label: "Value",
                    data: values,
                    yAxisID: "yValue",
                    backgroundColor: valueColor,
                    borderRadius: 3,
                    categoryPercentage: 0.7,
                    barPercentage: 0.85
                },
                {
                    label: "Loan",
                    data: counts,
                    yAxisID: "yCount",
                    backgroundColor: countColor,
                    borderRadius: 3,
                    categoryPercentage: 0.7,
                    barPercentage: 0.85
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                title: {
                    display: true,
                    text: `Daily Loan Disbursement - ${officerName || ""}`,
                    color: titleColor,
                    font: { size: 14, weight: "bold" },
                    padding: { top: 2, bottom: 10 }
                },
                legend: { display: true, position: "top" }
            },
            scales: {
                yValue: {
                    type: "linear",
                    position: "left",
                    beginAtZero: true,
                    title: { display: true, text: "Value" }
                },
                yCount: {
                    type: "linear",
                    position: "right",
                    beginAtZero: true,
                    ticks: { precision: 0 },
                    grid: { drawOnChartArea: false },
                    title: { display: true, text: "Loan" }
                },
                // All 31 bars still render even where the label is skipped
                // — this just thins out the X-axis text so it doesn't
                // overlap; tapping/hovering a bar still shows its exact
                // day via the tooltip.
                x: { ticks: { autoSkip: true, maxTicksLimit: 12 } }
            }
        }
    };
}

async function opRenderDisburseChart(sectionKey, wrap) {
    const q = opBuildQuery(opState.meta);
    const officer = opState.officer;
    const url = `${API.BASE_URL}/api/creditreport/byco/officer-disburse-chart${q}` +
        `&name=${encodeURIComponent(officer.name || "")}` +
        `&officerId=${encodeURIComponent(officer.id || "")}`;

    const res = await fetch(url, { headers: { Authorization: `Bearer ${opToken}` } });
    if (!res.ok) throw new Error("Could not load the disbursement chart. Please try again.");
    const data = await res.json();
    if (!data.ok) throw new Error(data.message || "Could not load the disbursement chart.");

    const labels = data.labels || [];
    const values = data.values || [];
    const counts = data.counts || [];
    if (!labels.length) {
        opDisburseChartData = null;
        wrap.innerHTML = `<div class="op-state">No disbursement data for this period.</div>`;
        return;
    }
    opDisburseChartData = { labels, values, counts };

    // NOT horizontally scrolled, deliberately: with two Y axes (Value on
    // the left, Loan on the right) a wide scrollable canvas means only
    // ONE of the two axes is ever in view at a given scroll position —
    // tried it, confirmed broken. Fits the wrap's own width instead so
    // both axes stay visible together at all times; bars get thin at 31
    // days but stay legible, and the tooltip still shows exact values.
    // A fullscreen button (plus tap/long-press anywhere on the chart —
    // see the listeners set up below) opens the same chart full-size,
    // landscape-locked where the platform supports it, for anyone who
    // wants the bars wider than this inline view allows.
    wrap.innerHTML = `<button type="button" class="op-chart-fullscreen-btn" aria-label="Fullscreen chart">⛶</button><canvas></canvas>`;
    if (typeof Chart === "undefined") {
        wrap.innerHTML = `<div class="op-state op-state-error">Chart library failed to load.</div>`;
        return;
    }
    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    if (opDisburseChartSmall) opDisburseChartSmall.destroy();
    opDisburseChartSmall = new Chart(
        wrap.querySelector("canvas").getContext("2d"),
        opBuildDisburseChartConfig(labels, values, counts, isDark, officer.name)
    );

    opWireChartFullscreenTriggers(wrap);
}

// Tap, click, or press-and-hold anywhere on the chart (or its dedicated
// button) opens the fullscreen view. A tap/click already fires on
// release for a long-press too in every mobile browser tested (nothing
// here depends on drag/scroll gestures, since the inline chart doesn't
// scroll), so one click listener naturally covers all three — the
// touch-callout suppression in CSS (op-chart-wrap) stops the OS's own
// long-press menu from intercepting the gesture first.
function opWireChartFullscreenTriggers(wrap) {
    wrap.addEventListener("click", opOpenChartFullscreen);
}

async function opOpenChartFullscreen() {
    if (!opDisburseChartData) return;
    const overlay = document.getElementById("opChartFsOverlay");
    if (!overlay) return;

    overlay.hidden = false;
    document.body.style.overflow = "hidden";

    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    const { labels, values, counts } = opDisburseChartData;
    if (opDisburseChartFs) opDisburseChartFs.destroy();
    opDisburseChartFs = new Chart(
        document.getElementById("opChartFsCanvas").getContext("2d"),
        opBuildDisburseChartConfig(labels, values, counts, isDark, opState.officer?.name)
    );

    // Both of these are progressive enhancement, not requirements — the
    // fixed-position CSS overlay above already gives a full-viewport view
    // on every platform, including iOS Safari, which has no Fullscreen
    // API for arbitrary elements and no Screen Orientation lock at all.
    // Where neither is available, the CSS-only rotate hint (shown while
    // the device is still physically in portrait) is the fallback.
    try {
        if (overlay.requestFullscreen) await overlay.requestFullscreen();
        else if (overlay.webkitRequestFullscreen) overlay.webkitRequestFullscreen();
    } catch (e) { /* not supported / denied — the CSS overlay alone still works */ }

    try {
        if (screen.orientation && screen.orientation.lock) {
            await screen.orientation.lock("landscape");
        }
    } catch (e) { /* unsupported/denied — user can still rotate manually */ }
}

function opCloseChartFullscreen() {
    const overlay = document.getElementById("opChartFsOverlay");
    if (!overlay || overlay.hidden) return;

    overlay.hidden = true;
    document.body.style.overflow = "";

    try { if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock(); } catch (e) { /* no-op */ }
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
// INIT
// ========================================
function opFinishLoad() {
    document.getElementById("opPageSkel").style.display = "none";
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
