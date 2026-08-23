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
    fetching: false,
    disabledRoutes: new Set(), // "METHOD /path" — loaded once, updated instantly on toggle
    routeAllowedRoles: new Map() // "METHOD /path" -> array of role strings, only present when restricted
  };

  const ALL_ROLES = ["admin", "user", "viewer_staff", "viewer_manager_a", "viewer_manager_b", "viewer_manager_c"];
  const ROLE_LABELS = {
    admin: "Admin",
    user: "User",
    viewer_staff: "Viewer Staff",
    viewer_manager_a: "Viewer Manager A",
    viewer_manager_b: "Viewer Manager B",
    viewer_manager_c: "Viewer Manager C"
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
    emptyEl.style.display = isEmpty ? "block" : "none";
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

      // "OUT <hostname>" rows are outbound calls THIS server made (to
      // GitHub, Render's own metrics API, etc.); "IN <method> <path>" rows
      // are request-BODY bytes received on one of this server's own
      // routes (e.g. the VBA sync tool's bulk uploads to /api/grid/rows);
      // "DB <method> <path>" rows are an approximate size of what that
      // route's MongoDB query pulled from Atlas (the leg between this
      // server and the database, which the response-bytes tracker can't
      // see at all — often the largest of the three for a wide bulk
      // row-fetching endpoint). None of the three prefixes is a
      // toggleable/role-restrictable target in its own right — the
      // underlying route already has its own separate (non-prefixed) row
      // for its response bytes, and that's where the real kill switch /
      // role controls for that route live — so all three prefixes get
      // the same badge-only, N/A treatment.
      const isOutbound = r.route.startsWith("OUT ");
      const isInbound = r.route.startsWith("IN ");
      const isDbRead = r.route.startsWith("DB ");
      const isSynthetic = isOutbound || isInbound || isDbRead;

      // Strip the "IN "/"DB " prefix before parsing method/path so that
      // row's underlying route still displays correctly if ever needed —
      // "OUT <hostname>" has no method/path structure at all, so it's
      // left as-is (its parsed "method"/"path" below are never used).
      const parseable = (isInbound || isDbRead) ? r.route.slice(3) : r.route;
      const spaceIdx = parseable.indexOf(" ");
      const method = parseable.slice(0, spaceIdx);
      const path = parseable.slice(spaceIdx + 1);
      const key = `${method} ${path}`;
      const isDisabled = state.disabledRoutes.has(key);
      const isProtected = PROTECTED_ROUTE_KEYS.has(key);

      const syntheticBadge = isOutbound
        ? ' <span class="adm-badge adm-badge-flow-out" title="Outbound call this server made — not one of its own routes">↗ Outbound</span>'
        : isInbound
        ? ' <span class="adm-badge adm-badge-flow-in" title="Request-body bytes received on this route — see its own row above/below for response bytes">↘ Request Body</span>'
        : isDbRead
        ? ' <span class="adm-badge adm-badge-flow-db" title="Approximate MongoDB read size for this route\'s query — see its own row above/below for response bytes">⛁ DB Read (approx)</span>'
        : "";

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="adm-td-rank">${i + 1}</td>
        <td class="adm-td-route"><span class="adm-route-chip">${escapeHtml(r.route)}</span>${syntheticBadge}</td>
        <td>${fmtMb(r.mb)}</td>
        <td>${r.count.toLocaleString()}</td>
        <td>${fmtMb(avg / 1024 / 1024)}</td>
        <td>
          <div class="adm-pct-track"><div class="adm-pct-fill" style="width:${pct}%"></div></div>
          <span class="adm-pct-label">${pct}%</span>
        </td>
        <td>
          ${isSynthetic
            ? `<span class="adm-badge adm-badge-status-inactive" title="Kill switch only applies to this server's own routes">N/A</span>`
            : isProtected
            ? `<span class="adm-badge adm-badge-status-inactive" title="Login/kill-switch routes can't be disabled">Protected</span>`
            : `<button type="button" class="adm-toggle-switch${isDisabled ? "" : " adm-toggle-on"}" data-method="${escapeHtml(method)}" data-path="${escapeHtml(path)}" role="switch" aria-checked="${!isDisabled}"><span class="adm-toggle-knob"></span></button>`
          }
        </td>
        <td>
          ${isSynthetic
            ? `<span class="adm-badge adm-badge-status-inactive" title="Role restriction only applies to this server's own routes">N/A</span>`
            : isProtected
            ? `<span class="adm-badge adm-badge-status-inactive">Protected</span>`
            : `<button type="button" class="adm-roles-btn">${roleSummaryLabel(key)}</button>`
          }
        </td>
      `;

      const toggleBtn = tr.querySelector(".adm-toggle-switch");
      if (toggleBtn) {
        toggleBtn.addEventListener("click", () => toggleRoute(toggleBtn, method, path));
      }

      const rolesBtn = tr.querySelector(".adm-roles-btn");
      if (rolesBtn) {
        rolesBtn.addEventListener("click", () => openRoleEditor(method, path));
      }

      el.tableBody.appendChild(tr);
    });
  }

  function roleSummaryLabel(key) {
    const roles = state.routeAllowedRoles.get(key);
    if (!roles || roles.length === 0) return "All roles";
    if (roles.length === 1) return ROLE_LABELS[roles[0]] || roles[0];
    return `${roles.length} roles`;
  }

  const PROTECTED_ROUTE_KEYS = new Set([
    "POST /api/auth/login",
    "GET /api/auth/me",
    "POST /api/auth/bootstrap-admin",
    "GET /api/admin/disabled-routes",
    "POST /api/admin/disabled-routes/toggle"
  ]);

  async function loadDisabledRoutes() {
    try {
      const res = await fetch(`${API_BASE}/api/admin/disabled-routes`, { headers: authHeaders() });
      const data = await res.json();
      if (!data.ok) throw new Error(data.message);
      state.disabledRoutes = new Set((data.routes || []).map(r => `${r.method} ${r.path}`));
    } catch (e) {
      console.error("loadDisabledRoutes failed:", e);
    }
  }

  async function loadRouteAllowedRoles() {
    try {
      const res = await fetch(`${API_BASE}/api/admin/route-roles`, { headers: authHeaders() });
      const data = await res.json();
      if (!data.ok) throw new Error(data.message);
      state.routeAllowedRoles = new Map(
        (data.routes || []).map(r => [`${r.method} ${r.path}`, r.allowedRoles])
      );
    } catch (e) {
      console.error("loadRouteAllowedRoles failed:", e);
    }
  }

  function openRoleEditor(method, path) {
    const key = `${method} ${path}`;
    const currentRoles = new Set(state.routeAllowedRoles.get(key) || []); // empty = all roles allowed

    const bodyNode = document.createElement("div");
    bodyNode.className = "adm-role-editor";
    bodyNode.innerHTML = `
      <p class="adm-role-editor-hint">
        <code>${escapeHtml(method)} ${escapeHtml(path)}</code><br>
        Leave everything unchecked (or check all) to allow every role. Check specific roles to restrict this endpoint to only them.
      </p>
      <div class="adm-role-checklist">
        ${ALL_ROLES.map(role => `
          <label class="adm-role-check-row">
            <input type="checkbox" value="${role}" ${currentRoles.has(role) ? "checked" : ""}>
            <span>${ROLE_LABELS[role]}</span>
          </label>
        `).join("")}
      </div>
      <div class="adm-role-editor-actions">
        <button type="button" id="admRoleEditorCancel">Cancel</button>
        <button type="button" id="admRoleEditorSave" class="adm-role-editor-save">Save</button>
      </div>
    `;

    const { body: mountedBody } = AdminUI.openModal({ title: "Allowed Roles", bodyNode });

    mountedBody.querySelector("#admRoleEditorCancel").addEventListener("click", () => AdminUI.closeModal());
    mountedBody.querySelector("#admRoleEditorSave").addEventListener("click", async () => {
      const selected = [...mountedBody.querySelectorAll(".adm-role-checklist input:checked")].map(cb => cb.value);

      try {
        const res = await fetch(`${API_BASE}/api/admin/route-roles/set`, {
          method: "POST",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ method, path, allowedRoles: selected })
        });
        const data = await res.json();
        if (!res.ok || !data.ok) return AdminUI.toast(data.message || "Failed to update.", "error");

        if (data.allowedRoles && data.allowedRoles.length > 0) {
          state.routeAllowedRoles.set(key, data.allowedRoles);
        } else {
          state.routeAllowedRoles.delete(key);
        }

        AdminUI.closeModal();
        AdminUI.toast(`${key} access updated.`, "success");
        renderTable(state.lastPayload?.topRoutes || []);
      } catch (e) {
        console.error("route-roles/set failed:", e);
        AdminUI.toast("Could not reach the server.", "error");
      }
    });
  }

  async function toggleRoute(btn, method, path) {
    const key = `${method} ${path}`;
    const currentlyEnabled = btn.getAttribute("aria-checked") === "true";

    if (currentlyEnabled) {
      const ok = await AdminUI.confirm({
        title: "Disable this route?",
        message: `<code>${method} ${path}</code> will immediately return an error to anyone who calls it, until you turn it back on. Use this to stop a specific endpoint from consuming more bandwidth.`,
        confirmLabel: "Disable",
        danger: true
      });
      if (!ok) return;
    }

    const newDisabled = currentlyEnabled;

    try {
      const res = await fetch(`${API_BASE}/api/admin/disabled-routes/toggle`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ method, path, disabled: newDisabled })
      });
      const data = await res.json();
      if (!res.ok || !data.ok) return AdminUI.toast(data.message || "Failed to update.", "error");

      if (newDisabled) state.disabledRoutes.add(key);
      else state.disabledRoutes.delete(key);

      btn.setAttribute("aria-checked", String(!newDisabled));
      btn.classList.toggle("adm-toggle-on", !newDisabled);
      AdminUI.toast(newDisabled ? `${key} disabled.` : `${key} enabled.`, "success");
    } catch (e) {
      console.error("toggleRoute failed:", e);
      AdminUI.toast("Could not reach the server.", "error");
    }
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
  async function init() {
    if (el.userLabel) {
      el.userLabel.textContent = window.CMAdmin.fullname || window.CMAdmin.username || "Admin";
    }
    await loadDisabledRoutes(); // must resolve first so renderTable() shows correct toggle state
    await loadRouteAllowedRoles(); // same — must resolve before first renderTable() call
    fetchStats();
    state.timer = setInterval(fetchStats, POLL_MS);

    if (document.getElementById("admRenderUsageCard")) {
      fetchRenderUsage();
      setInterval(fetchRenderUsage, 5 * 60 * 1000); // Render's data is hourly-resolution — no need to poll fast

      const debugBtn = document.getElementById("admRenderDebugBtn");
      debugBtn?.addEventListener("click", fetchRenderDebug);
    }
  }

  async function fetchRenderDebug() {
    const btn = document.getElementById("admRenderDebugBtn");
    const out = document.getElementById("admRenderDebugOutput");
    btn.textContent = "Loading raw response…";
    btn.disabled = true;

    try {
      const res = await fetch(`${API_BASE}/api/admin/render-usage?debug=1`, { headers: authHeaders() });
      const data = await res.json();
      out.value = JSON.stringify(data, null, 2);
      out.hidden = false;
      btn.textContent = "Raw response loaded ↓ (tap box to select all, then copy)";
    } catch (e) {
      out.value = `Fetch failed: ${e.message}`;
      out.hidden = false;
      btn.textContent = "Show raw response (debug)";
    } finally {
      btn.disabled = false;
    }
  }

  // ---------- Render account usage (real number, matches Render's dashboard) ----------
  async function fetchRenderUsage() {
    const loadingEl = document.getElementById("admRenderLoading");
    const bodyEl = document.getElementById("admRenderUsageBody");
    const setupEl = document.getElementById("admRenderSetup");

    try {
      const res = await fetch(`${API_BASE}/api/admin/render-usage`, { headers: authHeaders() });
      const data = await res.json();

      if (!data.ok) {
        loadingEl.hidden = true;
        bodyEl.hidden = true;
        setupEl.hidden = false;
        setupEl.textContent = data.message || setupEl.textContent;
        return;
      }

      loadingEl.hidden = true;
      setupEl.hidden = true;
      bodyEl.hidden = false;

      document.getElementById("admRenderTotal").textContent = `${data.totalGb.toFixed(2)} GB / ${data.planGb} GB`;
      document.getElementById("admRenderTotalSub").textContent = `${data.pctUsed}% of monthly free tier used`;

      const bar = document.getElementById("admRenderBar");
      bar.style.width = `${Math.min(100, data.pctUsed)}%`;
      bar.classList.toggle("adm-bar-warn", data.pctUsed >= 70 && data.pctUsed < 100);
      bar.classList.toggle("adm-bar-danger", data.pctUsed >= 100);

      // "Unbilled Charges" — server-computed estimate (see fetchRenderUsage()
      // in CM-backend): GB used beyond the free tier this billing month,
      // priced at Render's real Outgoing Bandwidth overage rate ($0.15/GB,
      // confirmed off the account's own Billing page — Render's API has no
      // billing/invoice endpoint to read this from directly). Still an
      // estimate, not the actual invoice line, since it's derived from the
      // Metrics API rather than Render's billing engine.
      const overageEl = document.getElementById("admRenderOverage");
      const overageTextEl = document.getElementById("admRenderOverageText");
      if (overageEl && overageTextEl) {
        const overageGb = data.overageGb || 0;
        const unbilledUsd = data.estimatedUnbilledUsd || 0;
        overageTextEl.textContent = overageGb > 0
          ? `Unbilled Charges (est.): $${unbilledUsd.toFixed(2)} (${overageGb.toFixed(2)} GB over free tier @ $${(data.overageUsdPerGb || 0.15).toFixed(2)}/GB)`
          : `Unbilled Charges: $0.00 — within free tier`;
        overageEl.classList.toggle("adm-render-overage-active", overageGb > 0);
      }

      const sourcesEl = document.getElementById("admRenderSources");
      const entries = Object.entries(data.bySourceGb || {});
      sourcesEl.innerHTML = entries.length
        ? entries
            .sort((a, b) => b[1] - a[1])
            .map(([label, gb]) => `
              <div class="adm-render-source-row">
                <span>${label}</span>
                <span>${fmtMb(gb * 1024)}</span>
              </div>
            `)
            .join("")
        : "";
    } catch (e) {
      console.error("render-usage fetch failed:", e);
      loadingEl.hidden = true;
      bodyEl.hidden = true;
      setupEl.hidden = false;
      setupEl.textContent = "Could not reach the server to load Render usage.";
    }
  }

  document.readyState === "loading"
    ? document.addEventListener("DOMContentLoaded", init)
    : init();
})();
