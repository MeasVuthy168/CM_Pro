/* =====================================================
   admin-activitylogs.js
   Filters + table + Load More (cursor-based, since the API only
   supports limit+sort, not offset), row-click detail modal,
   CSV export of what's currently loaded, and the destructive
   cleanup action behind a styled confirm dialog.
   ===================================================== */
(function () {
  if (!window.CMAdmin) return; // admin-loader.js already redirected away

  const API_BASE = (window.API && window.API.BASE_URL) || "";
  const PAGE_SIZE = 300;

  const state = {
    logs: [],
    hasMore: true,
    loading: false
  };

  const el = {
    keyword: document.getElementById("alKeyword"),
    dateFrom: document.getElementById("alDateFrom"),
    dateTo: document.getElementById("alDateTo"),
    result: document.getElementById("alResult"),
    action: document.getElementById("alAction"),
    btnSearch: document.getElementById("alBtnSearch"),
    btnReset: document.getElementById("alBtnReset"),
    rangeButtons: document.querySelectorAll(".adm-range-btn"),

    kpiTotal: document.getElementById("alKpiTotal"),
    kpiSuccess: document.getElementById("alKpiSuccess"),
    kpiFailed: document.getElementById("alKpiFailed"),
    kpiUsers: document.getElementById("alKpiUsers"),

    suspiciousCard: document.getElementById("alSuspiciousCard"),
    suspiciousList: document.getElementById("alSuspiciousList"),

    btnExport: document.getElementById("alBtnExport"),
    btnCleanup: document.getElementById("alBtnCleanup"),

    tableBody: document.getElementById("alTableBody"),
    tableEmpty: document.getElementById("alTableEmpty"),
    btnLoadMore: document.getElementById("alBtnLoadMore")
  };

  function authHeaders() {
    return { Authorization: `Bearer ${window.CMAdmin.token}` };
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  function initials(fullname, username) {
    const src = (fullname || username || "?").trim();
    const parts = src.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return src.slice(0, 2).toUpperCase();
  }

  function timeAgo(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    const diff = Math.floor((Date.now() - d.getTime()) / 1000);
    if (diff < 60) return "Just now";
    if (diff < 3600) return Math.floor(diff / 60) + " min ago";
    if (diff < 86400) return Math.floor(diff / 3600) + " hr ago";
    if (diff < 604800) return Math.floor(diff / 86400) + " day(s) ago";
    return d.toLocaleDateString();
  }

  // ---------- filters ----------
  function currentFilters() {
    return {
      keyword: el.keyword.value.trim(),
      dateFrom: el.dateFrom.value,
      dateTo: el.dateTo.value,
      result: el.result.value,
      action: el.action.value
    };
  }

  // The backend's GET /api/activitylogs already accepts an exact-match
  // `action` filter — the dropdown just wasn't wired up to it before.
  // Populated from whatever's actually been seen in the loaded logs
  // rather than a hardcoded list, so it never drifts out of sync with
  // real action names (Login, Save, Delete User, etc.).
  function refreshActionOptions() {
    const current = el.action.value;
    const actions = [...new Set(state.logs.map((l) => l.action).filter(Boolean))].sort();

    el.action.innerHTML = `<option value="all">All Actions</option>` +
      actions.map((a) => `<option value="${escapeHtml(a)}">${escapeHtml(a)}</option>`).join("");

    if (actions.includes(current)) el.action.value = current;
  }

  el.action.addEventListener("change", () => fetchLogs(true));

  function applyDatePreset(days) {
    el.rangeButtons.forEach((b) => b.classList.remove("adm-active"));
    const btn = [...el.rangeButtons].find((b) => Number(b.dataset.days) === days);
    if (btn) btn.classList.add("adm-active");

    if (days === 0) {
      el.dateFrom.value = "";
      el.dateTo.value = "";
    } else {
      const to = new Date();
      const from = new Date();
      from.setDate(from.getDate() - (days - 1));
      el.dateFrom.value = from.toISOString().slice(0, 10);
      el.dateTo.value = to.toISOString().slice(0, 10);
    }
    fetchLogs(true);
  }

  el.rangeButtons.forEach((btn) => {
    btn.addEventListener("click", () => applyDatePreset(Number(btn.dataset.days)));
  });

  el.btnSearch.addEventListener("click", () => fetchLogs(true));
  el.keyword.addEventListener("keydown", (e) => { if (e.key === "Enter") fetchLogs(true); });

  el.btnReset.addEventListener("click", () => {
    el.keyword.value = "";
    el.result.value = "all";
    el.action.value = "all";
    applyDatePreset(0);
  });

  // ---------- fetch (cursor-based Load More via dateTo) ----------
  async function fetchLogs(reset) {
    if (state.loading) return;
    state.loading = true;

    if (reset) {
      state.logs = [];
      state.hasMore = true;
    }

    try {
      const filters = currentFilters();
      const params = new URLSearchParams();
      if (filters.keyword) params.set("keyword", filters.keyword);
      if (filters.result && filters.result !== "all") params.set("result", filters.result);
      if (filters.action && filters.action !== "all") params.set("action", filters.action);
      params.set("limit", String(PAGE_SIZE));

      if (!reset && state.logs.length) {
        // cursor: fetch strictly older than the oldest loaded row
        const oldest = new Date(state.logs[state.logs.length - 1].logAt);
        oldest.setMilliseconds(oldest.getMilliseconds() - 1);
        params.set("dateTo", oldest.toISOString());
        if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
      } else {
        if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
        if (filters.dateTo) params.set("dateTo", filters.dateTo);
      }

      const res = await fetch(`${API_BASE}/api/activitylogs?${params.toString()}`, { headers: authHeaders() });

      if (res.status === 401 || res.status === 403) {
        location.replace(window.CM_ADMIN_CONFIG.loginPage);
        return;
      }

      const data = await res.json();
      if (!data.ok) throw new Error(data.message || "Failed to load logs");

      state.logs = reset ? data.logs : [...state.logs, ...data.logs];
      state.hasMore = data.logs.length === PAGE_SIZE;

      renderTable();
      renderSummary();
      renderCharts(state.logs);
      renderSuspiciousActivity();
      refreshActionOptions();
      el.btnLoadMore.hidden = !state.hasMore;
    } catch (e) {
      console.error("fetchLogs failed:", e);
      AdminUI.toast("Could not load activity logs.", "error");
    } finally {
      state.loading = false;
    }
  }

  el.btnLoadMore.addEventListener("click", () => fetchLogs(false));

  // ---------- charts ----------
  let dailyChart, resultChart, actionsChart, usersChart;

  function admThemeColors() {
    const cs = getComputedStyle(document.documentElement);
    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    return {
      textMuted: cs.getPropertyValue("--adm-text-muted").trim() || "#8FA0C7",
      grid: isDark ? "rgba(255,255,255,0.10)" : "rgba(0,45,107,0.10)",
      navy: cs.getPropertyValue("--adm-navy-700").trim() || "#003B8B",
      gold: cs.getPropertyValue("--adm-gold-500").trim() || "#D4AF37",
      ok: cs.getPropertyValue("--adm-ok").trim() || "#1F9D55",
      danger: cs.getPropertyValue("--adm-danger").trim() || "#C0392B"
    };
  }

  function toggleChartEmpty(canvasId, isEmpty) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const wrap = canvas.closest(".adm-chart-wrap");
    if (!wrap) return;

    let emptyEl = wrap.querySelector(".adm-chart-empty");
    if (!emptyEl) {
      emptyEl = document.createElement("div");
      emptyEl.className = "adm-chart-empty";
      emptyEl.textContent = "No data for the current filter.";
      wrap.appendChild(emptyEl);
    }
    emptyEl.style.display = isEmpty ? "block" : "none";
    canvas.style.visibility = isEmpty ? "hidden" : "visible";
  }

  function topN(counts, n = 10) {
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, n);
  }

  function renderCharts(logs) {
    if (typeof Chart === "undefined") return;
    const colors = admThemeColors();

    // ---- Activity Over Time (by day) ----
    const dailyCounts = {};
    for (const l of logs) {
      const day = String(l.logAt || "").slice(0, 10);
      if (!day) continue;
      dailyCounts[day] = (dailyCounts[day] || 0) + 1;
    }
    const dailyEntries = Object.entries(dailyCounts).sort((a, b) => a[0].localeCompare(b[0]));

    toggleChartEmpty("alDailyChart", dailyEntries.length === 0);
    if (dailyEntries.length) {
      const labels = dailyEntries.map(([d]) => d.slice(5));
      const values = dailyEntries.map(([, c]) => c);
      const canvas = document.getElementById("alDailyChart");
      if (!dailyChart) {
        dailyChart = new Chart(canvas.getContext("2d"), {
          type: "bar",
          data: { labels, datasets: [{ label: "Logs / day", data: values, backgroundColor: colors.navy, borderRadius: 4, maxBarThickness: 32 }] },
          options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
              y: { beginAtZero: true, ticks: { color: colors.textMuted, precision: 0 }, grid: { color: colors.grid } },
              x: { ticks: { color: colors.textMuted }, grid: { display: false } }
            }
          }
        });
      } else {
        dailyChart.data.labels = labels;
        dailyChart.data.datasets[0].data = values;
        dailyChart.update("none");
      }
    }

    // ---- Result Breakdown ----
    const resultCounts = { Success: 0, Failed: 0, Other: 0 };
    for (const l of logs) {
      if (l.result === "Success") resultCounts.Success++;
      else if (l.result === "Failed") resultCounts.Failed++;
      else resultCounts.Other++;
    }
    const resultTotal = resultCounts.Success + resultCounts.Failed + resultCounts.Other;

    toggleChartEmpty("alResultChart", resultTotal === 0);
    if (resultTotal > 0) {
      const canvas = document.getElementById("alResultChart");
      const labels = ["Success", "Failed", "Other"];
      const values = [resultCounts.Success, resultCounts.Failed, resultCounts.Other];
      const bg = [colors.ok, colors.danger, colors.textMuted];

      if (!resultChart) {
        resultChart = new Chart(canvas.getContext("2d"), {
          type: "doughnut",
          data: { labels, datasets: [{ data: values, backgroundColor: bg, borderWidth: 0 }] },
          options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: "bottom", labels: { color: colors.textMuted, boxWidth: 12 } } }
          }
        });
      } else {
        resultChart.data.datasets[0].data = values;
        resultChart.update("none");
      }
    }

    // ---- Top Actions ----
    const actionCounts = {};
    for (const l of logs) {
      const a = l.action || "Unknown";
      actionCounts[a] = (actionCounts[a] || 0) + 1;
    }
    const topActions = topN(actionCounts);

    toggleChartEmpty("alActionsChart", topActions.length === 0);
    if (topActions.length) {
      const canvas = document.getElementById("alActionsChart");
      const labels = topActions.map(([a]) => a);
      const values = topActions.map(([, c]) => c);

      if (!actionsChart) {
        actionsChart = new Chart(canvas.getContext("2d"), {
          type: "bar",
          data: { labels, datasets: [{ data: values, backgroundColor: colors.gold, borderRadius: 4, maxBarThickness: 20 }] },
          options: {
            indexAxis: "y", responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
              x: { beginAtZero: true, ticks: { color: colors.textMuted, precision: 0 } },
              y: { ticks: { color: colors.textMuted }, grid: { display: false } }
            }
          }
        });
      } else {
        actionsChart.data.labels = labels;
        actionsChart.data.datasets[0].data = values;
        actionsChart.update("none");
      }
    }

    // ---- Top Users ----
    const userCounts = {};
    const userLabels = {};
    for (const l of logs) {
      const key = l.username || "unknown";
      userCounts[key] = (userCounts[key] || 0) + 1;
      userLabels[key] = l.fullname ? `${l.fullname} (@${key})` : `@${key}`;
    }
    const topUsers = topN(userCounts);

    toggleChartEmpty("alUsersChart", topUsers.length === 0);
    if (topUsers.length) {
      const canvas = document.getElementById("alUsersChart");
      const labels = topUsers.map(([u]) => userLabels[u]);
      const values = topUsers.map(([, c]) => c);

      if (!usersChart) {
        usersChart = new Chart(canvas.getContext("2d"), {
          type: "bar",
          data: { labels, datasets: [{ data: values, backgroundColor: colors.navy, borderRadius: 4, maxBarThickness: 20 }] },
          options: {
            indexAxis: "y", responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
              x: { beginAtZero: true, ticks: { color: colors.textMuted, precision: 0 } },
              y: { ticks: { color: colors.textMuted }, grid: { display: false } }
            }
          }
        });
      } else {
        usersChart.data.labels = labels;
        usersChart.data.datasets[0].data = values;
        usersChart.update("none");
      }
    }
  }

  // ---------- render ----------
  function renderSummary() {
    el.kpiTotal.textContent = state.logs.length;
    el.kpiSuccess.textContent = state.logs.filter((l) => l.result === "Success").length;
    el.kpiFailed.textContent = state.logs.filter((l) => l.result === "Failed").length;
    el.kpiUsers.textContent = new Set(state.logs.map((l) => l.username).filter(Boolean)).size;
  }

  // ---------- suspicious activity ----------
  // Client-side heuristic over whatever's currently loaded (no new
  // backend aggregation needed) — flags the two classic brute-force
  // shapes: many failed logins piling up on one account (targeted
  // guessing), and many failed logins from one IP spread across
  // several different accounts (credential stuffing / scanning).
  const SUSPICIOUS_FAILED_LOGIN_THRESHOLD = 5;

  function renderSuspiciousActivity() {
    const failedLogins = state.logs.filter((l) => l.action === "Login" && l.result === "Failed");

    const byUsername = new Map(); // username -> { count, lastIp, lastAt }
    const byIp = new Map(); // ip -> { count, usernames:Set, lastAt }

    for (const l of failedLogins) {
      const username = l.username || "(unknown username)";
      const ip = l.ipAddress || "(unknown IP)";

      const u = byUsername.get(username) || { count: 0, lastIp: "", lastAt: "" };
      u.count++;
      if (!u.lastAt || l.logAt > u.lastAt) { u.lastAt = l.logAt; u.lastIp = ip; }
      byUsername.set(username, u);

      const i = byIp.get(ip) || { count: 0, usernames: new Set(), lastAt: "" };
      i.count++;
      i.usernames.add(username);
      if (!i.lastAt || l.logAt > i.lastAt) i.lastAt = l.logAt;
      byIp.set(ip, i);
    }

    const items = [];

    for (const [username, u] of byUsername) {
      if (u.count < SUSPICIOUS_FAILED_LOGIN_THRESHOLD) continue;
      items.push(`🔒 <strong>${escapeHtml(username)}</strong> — ${u.count} failed logins (most recent from ${escapeHtml(u.lastIp)}, ${timeAgo(u.lastAt)})`);
    }

    // Only surfaced when it spans multiple accounts — a single user
    // failing repeatedly from one IP is already covered by the
    // byUsername entry above, so this stays specific to the
    // multi-account pattern the per-username view can't show.
    for (const [ip, i] of byIp) {
      if (i.count < SUSPICIOUS_FAILED_LOGIN_THRESHOLD || i.usernames.size < 2) continue;
      items.push(`🌐 IP <strong>${escapeHtml(ip)}</strong> — ${i.count} failed logins across ${i.usernames.size} accounts (most recent ${timeAgo(i.lastAt)})`);
    }

    el.suspiciousCard.hidden = items.length === 0;
    el.suspiciousList.innerHTML = items.map((html) => `<li>${html}</li>`).join("");
  }

  function resultBadgeClass(result) {
    if (result === "Success") return "adm-badge-status-active";
    if (result === "Failed") return "adm-badge-status-failed";
    return "adm-badge-status-inactive";
  }

  function renderTable() {
    el.tableBody.innerHTML = "";

    if (!state.logs.length) {
      el.tableEmpty.hidden = false;
      return;
    }
    el.tableEmpty.hidden = true;

    state.logs.forEach((log) => {
      const tr = document.createElement("tr");
      tr.className = "adm-users-row";
      tr.style.cursor = "pointer";
      tr.innerHTML = `
        <td title="${escapeHtml(log.logAt)}">${timeAgo(log.logAt)}</td>
        <td>
          <div class="adm-user-identity">
            <div class="adm-avatar">${escapeHtml(initials(log.fullname, log.username))}</div>
            <div class="adm-user-identity-text">
              <span class="adm-user-identity-name">${escapeHtml(log.fullname || log.username || "—")}</span>
              <span class="adm-user-identity-username">@${escapeHtml(log.username || "unknown")}</span>
            </div>
          </div>
        </td>
        <td>${escapeHtml(log.action)}</td>
        <td>${escapeHtml(log.module || "—")}</td>
        <td><span class="adm-badge ${resultBadgeClass(log.result)}">${escapeHtml(log.result || "—")}</span></td>
        <td>${escapeHtml(log.ipAddress || "—")}</td>
      `;
      tr.addEventListener("click", () => openDetailModal(log));
      el.tableBody.appendChild(tr);
    });
  }

  // ---------- detail modal ----------
  function openDetailModal(log) {
    const body = document.createElement("div");
    const rows = [
      ["Time", new Date(log.logAt).toLocaleString()],
      ["User", `${log.fullname || "—"} (@${log.username || "unknown"})`],
      ["Role", log.role || "—"],
      ["Action", log.action],
      ["Module", log.module || "—"],
      ["Result", log.result || "—"],
      ["Message", log.message || "—"],
      ["Device", log.deviceName || "—"],
      ["Machine User", log.machineUser || "—"],
      ["Workbook", log.workbookName || "—"],
      ["App Version", log.appVersion || "—"],
      ["IP Address", log.ipAddress || "—"]
    ];

    body.innerHTML = rows.map(([label, value]) => `
      <div class="adm-logs-detail-row">
        <span>${escapeHtml(label)}</span>
        <span>${escapeHtml(value)}</span>
      </div>
    `).join("");

    AdminUI.openModal({ title: "Log Detail", bodyNode: body, wide: true });
  }

  // ---------- export CSV ----------
  function exportCsv() {
    if (!state.logs.length) return AdminUI.toast("Nothing loaded to export.", "error");

    const headers = ["Time", "Username", "FullName", "Role", "Action", "Module", "Result", "Message", "Device", "MachineUser", "Workbook", "AppVersion", "IP"];
    const csvEscape = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;

    const rows = state.logs.map((l) => [
      l.logAt, l.username, l.fullname, l.role, l.action, l.module, l.result,
      l.message, l.deviceName, l.machineUser, l.workbookName, l.appVersion, l.ipAddress
    ].map(csvEscape).join(","));

    const csv = [headers.map(csvEscape).join(","), ...rows].join("\r\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `CM_Pro_ActivityLogs_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    AdminUI.toast(`Exported ${state.logs.length} loaded log(s).`, "success");
  }

  el.btnExport.addEventListener("click", exportCsv);

  // ---------- cleanup ----------
  function openCleanupModal() {
    const body = document.createElement("div");
    body.innerHTML = `
      <p class="adm-modal-message">
        Permanently deletes activity logs older than the number of days below.
        This can't be undone.
      </p>
      <label class="adm-cleanup-field">
        <span>Keep logs from the last (days)</span>
        <input type="number" id="alKeepDays" value="180" min="1">
      </label>
      <div class="adm-modal-footer">
        <button type="button" class="adm-btn" id="alCleanupCancel">Cancel</button>
        <button type="button" class="adm-btn adm-btn-danger" id="alCleanupConfirm">Delete Old Logs</button>
      </div>
    `;

    const { body: mountedBody } = AdminUI.openModal({ title: "Clean Up Old Logs", bodyNode: body });

    mountedBody.querySelector("#alCleanupCancel").addEventListener("click", () => AdminUI.closeModal());
    mountedBody.querySelector("#alCleanupConfirm").addEventListener("click", async () => {
      const keepDays = Number(mountedBody.querySelector("#alKeepDays").value || 180);

      try {
        const res = await fetch(`${API_BASE}/api/activitylogs/cleanup`, {
          method: "POST",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ keepDays })
        });
        const data = await res.json();
        if (!res.ok || !data.ok) return AdminUI.toast(data.message || "Cleanup failed.", "error");

        AdminUI.closeModal();
        AdminUI.toast(`Deleted ${data.deletedCount} log(s) older than ${data.cutoffCambodiaText}.`, "success");
        fetchLogs(true);
      } catch (e) {
        console.error("cleanup failed:", e);
        AdminUI.toast("Cleanup failed — could not reach the server.", "error");
      }
    });
  }

  el.btnCleanup.addEventListener("click", openCleanupModal);

  // ---------- init ----------
  function init() {
    fetchLogs(true);
  }

  document.readyState === "loading"
    ? document.addEventListener("DOMContentLoaded", init)
    : init();
})();
