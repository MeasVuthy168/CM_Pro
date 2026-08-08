/* =====================================================
   admin.js
   Realtime bandwidth dashboard for CM_Pro admin section.
   Reads GET /api/admin/bandwidth-stats and renders:
     - KPI cards (today's usage vs Render free tier, live rate, week total, top route)
     - Daily bandwidth bar chart (with a reference line at the free-tier limit)
     - Top routes horizontal bar chart
     - Sortable route table

   Uses your real config/api.js: window.API.BASE_URL
   ===================================================== */
(function () {
  if (!window.CMAdmin) return; // admin-loader.js already redirected away

  const API_BASE = (window.API && window.API.BASE_URL) || "";

  const RENDER_FREE_GB = 5; // 🔧 adjust if you change Render plans
  const POLL_MS = 10000; // live refresh every 10s
  const MAX_SPARKLINE_POINTS = 60; // ~10 min of history at 10s intervals

  const state = {
    range: 1, // days
    lastPayload: null,
    sparkline: [], // [{t, mbPerMin}]
    timer: null,
    fetching: false
  };

  // ---------- DOM refs ----------
  const el = {
    userLabel: document.getElementById("admUserLabel"),
    lastUpdated: document.getElementById("admLastUpdated"),
    refreshBtn: document.getElementById("admRefreshBtn"),
    rangeButtons: document.querySelectorAll(".adm-range-btn"),
    errorBanner: document.getElementById("admErrorBanner"),

    kpiTodayGb: document.getElementById("admKpiTodayGb"),
    kpiTodayBar: document.getElementById("admKpiTodayBar"),
    kpiTodayPct: document.getElementById("admKpiTodayPct"),
    kpiLiveRate: document.getElementById("admKpiLiveRate"),
    kpiLivePulse: document.getElementById("admKpiLivePulse"),
    kpiRangeTotal: document.getElementById("admKpiRangeTotal"),
    kpiTopRoute: document.getElementById("admKpiTopRoute"),
    kpiTopRouteMb: document.getElementById("admKpiTopRouteMb"),

    tableBody: document.getElementById("admTableBody"),
    tableEmpty: document.getElementById("admTableEmpty")
  };

  // ---------- helpers ----------
  function fmtMb(mb) {
    if (mb >= 1024) return (mb / 1024).toFixed(2) + " GB";
    return mb.toFixed(2) + " MB";
  }

  function fmtTime(d) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  function authHeaders() {
    return { Authorization: `Bearer ${window.CMAdmin.token}` };
  }

  function showError(msg) {
    if (!el.errorBanner) return;
    el.errorBanner.textContent = msg;
    el.errorBanner.hidden = !msg;
  }

  // ---------- fetch ----------
  async function fetchStats() {
    if (state.fetching) return;
    state.fetching = true;
    try {
      const res = await fetch(
        `${API_BASE}/api/admin/bandwidth-stats?range=${state.range}`,
        { headers: authHeaders() }
      );

      if (res.status === 401 || res.status === 403) {
        location.replace(window.CM_ADMIN_CONFIG.loginPage);
        return;
      }

      if (!res.ok) throw new Error(`Server responded ${res.status}`);

      const data = await res.json();
      if (!data.ok) throw new Error(data.message || "Unknown server error");

      state.lastPayload = data;
      pushSparklinePoint(data);
      renderAll(data);
      showError("");
    } catch (e) {
      console.error("bandwidth-stats fetch failed:", e);
      showError("Could not reach the server — showing last known data.");
    } finally {
      state.fetching = false;
    }
  }

  function pushSparklinePoint(data) {
    const liveBytes = (data.live || []).reduce((s, r) => s + r.bytes, 0);
    const mbPerPoll = liveBytes / 1024 / 1024;
    const mbPerMin = (mbPerPoll / (POLL_MS / 1000)) * 60;
    state.sparkline.push({ t: new Date(), mbPerMin });
    if (state.sparkline.length > MAX_SPARKLINE_POINTS) state.sparkline.shift();
  }

  // ---------- render ----------
  function renderAll(data) {
    el.lastUpdated.textContent = `Updated ${fmtTime(new Date())}`;

    renderKpis(data);
    renderDailyChart(data.dailyTotals || []);
    renderTopRoutesChart(data.topRoutes || []);
    renderTable(data.topRoutes || []);

    el.kpiLivePulse.classList.remove("adm-pulse");
    void el.kpiLivePulse.offsetWidth; // restart animation
    el.kpiLivePulse.classList.add("adm-pulse");
  }

  function renderKpis(data) {
    const today = new Date().toISOString().slice(0, 10);
    const todayRow = (data.dailyTotals || []).find((d) => d.date === today);
    const liveBytesToday =
      (data.live || []).reduce((s, r) => s + r.bytes, 0) / 1024 / 1024;
    const todayMb = (todayRow ? todayRow.mb : 0) + liveBytesToday;
    const todayGb = todayMb / 1024;
    const pct = Math.min(100, (todayGb / RENDER_FREE_GB) * 100);

    el.kpiTodayGb.textContent = fmtMb(todayMb);
    el.kpiTodayPct.textContent = `${pct < 0.1 && pct > 0 ? "<0.1" : pct.toFixed(0)}% of ${RENDER_FREE_GB} GB free tier`;
    el.kpiTodayBar.style.width = `${Math.max(pct, todayMb > 0 ? 0.5 : 0)}%`;
    el.kpiTodayBar.classList.toggle("adm-bar-warn", pct >= 70 && pct < 100);
    el.kpiTodayBar.classList.toggle("adm-bar-danger", pct >= 100);

    const lastPoint = state.sparkline[state.sparkline.length - 1];
    el.kpiLiveRate.textContent = lastPoint ? `${fmtMb(lastPoint.mbPerMin)}/min` : "—";

    el.kpiRangeTotal.textContent = fmtMb(data.totalMb);

    const top = (data.topRoutes || [])[0];
    if (top) {
      el.kpiTopRoute.textContent = top.route;
      el.kpiTopRouteMb.textContent = fmtMb(top.mb);
    } else {
      el.kpiTopRoute.textContent = "—";
      el.kpiTopRouteMb.textContent = "";
    }
  }

  // ---------- charts (Chart.js) ----------
  let dailyChart, routesChart;

  function admThemeColors() {
    const cs = getComputedStyle(document.documentElement);
    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    return {
      text: cs.getPropertyValue("--adm-text").trim() || (isDark ? "#EAF0FF" : "#14213D"),
      textMuted: cs.getPropertyValue("--adm-text-muted").trim() || "#8FA0C7",
      grid: isDark ? "rgba(255,255,255,0.10)" : "rgba(0,45,107,0.10)",
      bar1: cs.getPropertyValue("--adm-navy-700").trim() || "#003B8B",
      bar2: cs.getPropertyValue("--adm-gold-500").trim() || "#D4AF37"
    };
  }

  function toggleChartEmptyState(canvasId, isEmpty, message) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const wrap = canvas.closest(".adm-chart-wrap");
    if (!wrap) return;

    let emptyEl = wrap.querySelector(".adm-chart-empty");
    if (!emptyEl) {
      emptyEl = document.createElement("div");
      emptyEl.className = "adm-chart-empty";
      wrap.appendChild(emptyEl);
    }
    emptyEl.textContent = message || "Collecting data — check back in a couple of minutes.";
    emptyEl.hidden = !isEmpty;
    canvas.style.visibility = isEmpty ? "hidden" : "visible";
  }

  const thresholdLinePlugin = {
    id: "admThresholdLine",
    afterDraw(chart) {
      const gbLimit = chart.options.plugins?.admThreshold?.gb;
      if (!gbLimit) return;
      const { ctx, chartArea, scales } = chart;
      const y = scales.y.getPixelForValue(gbLimit * 1024); // dailyTotals are in MB
      if (y < chartArea.top || y > chartArea.bottom) return;

      const colors = admThemeColors();
      ctx.save();
      ctx.strokeStyle = colors.bar2;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(chartArea.left, y);
      ctx.lineTo(chartArea.right, y);
      ctx.stroke();

      ctx.setLineDash([]);
      ctx.fillStyle = colors.bar2;
      ctx.font = "11px 'Krasar', sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(`${gbLimit} GB free-tier limit`, chartArea.right, y - 4);
      ctx.restore();
    }
  };

  function renderDailyChart(dailyTotals) {
    const canvas = document.getElementById("admDailyChart");
    if (!canvas) return;

    if (typeof Chart === "undefined") {
      toggleChartEmptyState("admDailyChart", true, "Chart library failed to load — check your connection and refresh.");
      return;
    }

    toggleChartEmptyState("admDailyChart", dailyTotals.length === 0);
    if (!dailyTotals.length) return;

    const colors = admThemeColors();
    const labels = dailyTotals.map((d) => d.date.slice(5)); // MM-DD
    const values = dailyTotals.map((d) => +d.mb.toFixed(2));

    if (!dailyChart) {
      dailyChart = new Chart(canvas.getContext("2d"), {
        type: "bar",
        plugins: [thresholdLinePlugin],
        data: {
          labels,
          datasets: [
            {
              label: "MB used / day",
              data: values,
              backgroundColor: colors.bar1,
              borderRadius: 4,
              maxBarThickness: 36
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            admThreshold: { gb: RENDER_FREE_GB }
          },
          scales: {
            y: {
              beginAtZero: true,
              title: { display: true, text: "MB", color: colors.textMuted },
              ticks: { color: colors.textMuted },
              grid: { color: colors.grid }
            },
            x: {
              ticks: { color: colors.textMuted },
              grid: { display: false }
            }
          }
        }
      });
    } else {
      dailyChart.data.labels = labels;
      dailyChart.data.datasets[0].data = values;
      dailyChart.update("none");
    }
  }

  function renderTopRoutesChart(topRoutes) {
    const canvas = document.getElementById("admRoutesChart");
    if (!canvas) return;

    if (typeof Chart === "undefined") {
      toggleChartEmptyState("admRoutesChart", true, "Chart library failed to load — check your connection and refresh.");
      return;
    }

    toggleChartEmptyState("admRoutesChart", topRoutes.length === 0);
    if (!topRoutes.length) return;

    const colors = admThemeColors();
    const top10 = topRoutes.slice(0, 10);
    const labels = top10.map((r) => r.route);
    const values = top10.map((r) => +r.mb.toFixed(2));

    if (!routesChart) {
      routesChart = new Chart(canvas.getContext("2d"), {
        type: "bar",
        data: {
          labels,
          datasets: [
            {
              label: "MB (range total)",
              data: values,
              backgroundColor: colors.bar2,
              borderRadius: 4,
              maxBarThickness: 22
            }
          ]
        },
        options: {
          indexAxis: "y",
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: {
              beginAtZero: true,
              title: { display: true, text: "MB", color: colors.textMuted },
              ticks: { color: colors.textMuted }
            },
            y: {
              ticks: { color: colors.textMuted },
              grid: { display: false }
            }
          }
        }
      });
    } else {
      routesChart.data.labels = labels;
      routesChart.data.datasets[0].data = values;
      routesChart.update("none");
    }
  }

  function renderTable(topRoutes) {
    if (!el.tableBody) return;
    el.tableBody.innerHTML = "";

    if (!topRoutes.length) {
      el.tableEmpty.hidden = false;
      return;
    }
    el.tableEmpty.hidden = true;

    const grandTotal = topRoutes.reduce((s, r) => s + r.bytes, 0) || 1;

    topRoutes.forEach((r, i) => {
      const avg = r.count ? r.bytes / r.count : 0;
      const pct = ((r.bytes / grandTotal) * 100).toFixed(1);

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="adm-td-rank">${i + 1}</td>
        <td class="adm-td-route">${escapeHtml(r.route)}</td>
        <td>${fmtMb(r.mb)}</td>
        <td>${r.count.toLocaleString()}</td>
        <td>${fmtMb(avg / 1024 / 1024)}</td>
        <td>
          <div class="adm-pct-track"><div class="adm-pct-fill" style="width:${pct}%"></div></div>
          <span class="adm-pct-label">${pct}%</span>
        </td>
      `;
      el.tableBody.appendChild(tr);
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  // ---------- controls ----------
  el.rangeButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      el.rangeButtons.forEach((b) => b.classList.remove("adm-active"));
      btn.classList.add("adm-active");
      state.range = Number(btn.dataset.range);
      fetchStats();
    });
  });

  el.refreshBtn?.addEventListener("click", fetchStats);

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      clearInterval(state.timer);
    } else {
      fetchStats();
      state.timer = setInterval(fetchStats, POLL_MS);
    }
  });

  // ---------- init ----------
  function init() {
    if (el.userLabel) {
      el.userLabel.textContent = window.CMAdmin.fullname || window.CMAdmin.username || "Admin";
    }
    fetchStats();
    state.timer = setInterval(fetchStats, POLL_MS);
  }

  document.readyState === "loading"
    ? document.addEventListener("DOMContentLoaded", init)
    : init();
})();
