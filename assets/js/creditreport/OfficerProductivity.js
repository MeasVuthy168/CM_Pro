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
//   -> { ok, labels: [...], values: [...] }
//   A daily disbursement value series for this officer, zero-filled
//   for every calendar day from fromDate to toDate (a continuous
//   timeline, not just days with activity) — only used by the Loan
//   Disburse card's Chart tab.
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
    if (!labels.length) {
        wrap.innerHTML = `<div class="op-state">No disbursement data for this period.</div>`;
        return;
    }

    wrap.innerHTML = `<canvas></canvas>`;
    if (typeof Chart === "undefined") {
        wrap.innerHTML = `<div class="op-state op-state-error">Chart library failed to load.</div>`;
        return;
    }
    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    const lineColor = isDark ? "#FFD700" : "#003B8B";
    // Timeline over the full date range (backend zero-fills every day from
    // fromDate to toDate), so a line reads better than one bar per day —
    // especially once the range spans most of a month.
    new Chart(wrap.querySelector("canvas").getContext("2d"), {
        type: "line",
        data: {
            labels,
            datasets: [{
                label: "Disbursement Value",
                data: values,
                borderColor: lineColor,
                backgroundColor: isDark ? "rgba(255,215,0,0.15)" : "rgba(0,59,139,0.12)",
                fill: true,
                tension: 0.25,
                pointRadius: labels.length > 20 ? 0 : 3,
                pointHoverRadius: 5,
                pointBackgroundColor: lineColor
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true },
                x: { ticks: { autoSkip: true, maxTicksLimit: 12 } }
            }
        }
    });
}

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
