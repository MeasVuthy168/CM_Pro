/* =====================================================
   admin-notifications.js
   Send announcements (All/Role/Username), browse full history
   (admin sees everything, not just what's targeted at them),
   delete a mistaken send, and clean up old ones.
   ===================================================== */
(function () {
  if (!window.CMAdmin) return; // admin-loader.js already redirected away

  const API_BASE = (window.API && window.API.BASE_URL) || "";
  const t = (key, vars) => (window.CMI18n ? CMI18n.t(key, vars) : key);

  const state = { items: [] };

  const el = {
    keyword: document.getElementById("nfKeyword"),
    type: document.getElementById("nfType"),
    dateFrom: document.getElementById("nfDateFrom"),
    dateTo: document.getElementById("nfDateTo"),
    btnSearch: document.getElementById("nfBtnSearch"),
    btnReset: document.getElementById("nfBtnReset"),
    btnSend: document.getElementById("nfBtnSend"),
    btnCleanup: document.getElementById("nfBtnCleanup"),
    btnPrune: document.getElementById("nfBtnPrune"),

    kpiTotal: document.getElementById("nfKpiTotal"),
    kpiToday: document.getElementById("nfKpiToday"),
    kpiDevices: document.getElementById("nfKpiDevices"),
    kpiUsers: document.getElementById("nfKpiUsers"),

    tableBody: document.getElementById("nfTableBody"),
    tableEmpty: document.getElementById("nfTableEmpty"),

    sendTemplate: document.getElementById("nfSendTemplate")
  };

  function authHeaders() {
    return { Authorization: `Bearer ${window.CMAdmin.token}` };
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  function timeAgo(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    const diff = Math.floor((Date.now() - d.getTime()) / 1000);
    if (diff < 60) return t("admin.common.timeJustNow");
    if (diff < 3600) return t("admin.common.timeMinAgo", { n: Math.floor(diff / 60) });
    if (diff < 86400) return t("admin.common.timeHrAgo", { n: Math.floor(diff / 3600) });
    if (diff < 604800) return t("admin.common.timeDaysAgo", { n: Math.floor(diff / 86400) });
    return d.toLocaleDateString();
  }

  function targetLabel(n) {
    if (n.targetType === "all") return t("admin.notifications.targetAllLabel");
    if (n.targetType === "role") return t("admin.notifications.targetRoleLabel", { role: n.targetValue });
    if (n.targetType === "username") return `@${n.targetValue}`;
    return n.targetType;
  }

  function targetBadgeClass(n) {
    if (n.targetType === "all") return "adm-badge-role-admin";
    if (n.targetType === "role") return "adm-badge-role-manager";
    return "adm-badge-role-viewer_staff";
  }

  // ---------- push reach stats ----------
  async function loadPushStats() {
    try {
      const res = await fetch(`${API_BASE}/api/admin/notifications/push-stats`, { headers: authHeaders() });
      const data = await res.json();
      if (!data.ok) throw new Error(data.message);
      el.kpiDevices.textContent = data.activeDevices;
      el.kpiUsers.textContent = data.uniqueUsers;
    } catch (e) {
      console.error("push-stats failed:", e);
      el.kpiDevices.textContent = "—";
      el.kpiUsers.textContent = "—";
    }
  }

  // ---------- load notifications ----------
  function currentFilters() {
    return {
      keyword: el.keyword.value.trim(),
      type: el.type.value,
      dateFrom: el.dateFrom.value,
      dateTo: el.dateTo.value
    };
  }

  async function loadNotifications() {
    try {
      const f = currentFilters();
      const params = new URLSearchParams();
      if (f.keyword) params.set("keyword", f.keyword);
      if (f.type && f.type !== "all") params.set("type", f.type);
      if (f.dateFrom) params.set("dateFrom", f.dateFrom);
      if (f.dateTo) params.set("dateTo", f.dateTo);
      params.set("limit", "300");

      const res = await fetch(`${API_BASE}/api/admin/notifications?${params.toString()}`, { headers: authHeaders() });

      if (res.status === 401 || res.status === 403) {
        location.replace(window.CM_ADMIN_CONFIG.loginPage);
        return;
      }

      const data = await res.json();
      if (!data.ok) throw new Error(data.message || "Failed to load notifications");

      state.items = data.items || [];
      renderTable();
      renderSummary();
    } catch (e) {
      console.error("loadNotifications failed:", e);
      AdminUI.toast(t("admin.notifications.couldNotLoad"), "error");
    }
  }

  el.btnSearch.addEventListener("click", loadNotifications);
  el.keyword.addEventListener("keydown", (e) => { if (e.key === "Enter") loadNotifications(); });
  el.btnReset.addEventListener("click", () => {
    el.keyword.value = "";
    el.type.value = "all";
    el.dateFrom.value = "";
    el.dateTo.value = "";
    loadNotifications();
  });

  function renderSummary() {
    el.kpiTotal.textContent = state.items.length;
    const today = new Date().toISOString().slice(0, 10);
    el.kpiToday.textContent = state.items.filter((n) => String(n.createdAt || "").slice(0, 10) === today).length;
  }

  function renderTable() {
    el.tableBody.innerHTML = "";

    if (!state.items.length) {
      el.tableEmpty.hidden = false;
      return;
    }
    el.tableEmpty.hidden = true;

    state.items.forEach((n) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td title="${escapeHtml(n.createdAt)}">${timeAgo(n.createdAt)}</td>
        <td>
          <div class="adm-user-identity-text">
            <span class="adm-user-identity-name">${escapeHtml(n.title)}</span>
            <span class="adm-user-identity-username">${escapeHtml((n.message || "").slice(0, 60))}${(n.message || "").length > 60 ? "…" : ""}</span>
          </div>
        </td>
        <td><span class="adm-badge ${targetBadgeClass(n)}">${escapeHtml(targetLabel(n))}</span></td>
        <td>${escapeHtml(n.createdBy || t("admin.notifications.systemFallback"))}</td>
        <td>
          <div class="adm-row-actions">
            <button type="button" class="adm-icon-btn" title="${t("admin.notifications.view")}" data-action="view">👁️</button>
            <button type="button" class="adm-icon-btn adm-icon-btn-danger" title="${t("admin.notifications.delete")}" data-action="delete">🗑️</button>
          </div>
        </td>
      `;
      tr.querySelector('[data-action="view"]').addEventListener("click", () => viewDetail(n));
      tr.querySelector('[data-action="delete"]').addEventListener("click", () => deleteNotification(n));
      el.tableBody.appendChild(tr);
    });
  }

  function viewDetail(n) {
    const body = document.createElement("div");
    const rows = [
      [t("admin.notifications.detailTime"), new Date(n.createdAt).toLocaleString()],
      [t("admin.notifications.detailTitleLabel"), n.title],
      [t("admin.notifications.detailMessage"), n.message || "—"],
      [t("admin.notifications.detailType"), n.type],
      [t("admin.notifications.detailModule"), n.moduleCode || "—"],
      [t("admin.notifications.detailTarget"), targetLabel(n)],
      [t("admin.notifications.detailSentBy"), n.createdBy || t("admin.notifications.systemFallback")]
    ];
    body.innerHTML = rows.map(([label, value]) => `
      <div class="adm-logs-detail-row">
        <span>${escapeHtml(label)}</span>
        <span>${escapeHtml(value)}</span>
      </div>
    `).join("");
    AdminUI.openModal({ title: t("admin.notifications.detailTitle"), bodyNode: body, wide: true });
  }

  async function deleteNotification(n) {
    const ok = await AdminUI.confirm({
      title: t("admin.notifications.deleteTitle"),
      message: t("admin.notifications.deleteMessage", { title: escapeHtml(n.title) }),
      confirmLabel: t("admin.notifications.delete"),
      danger: true
    });
    if (!ok) return;

    try {
      const res = await fetch(`${API_BASE}/api/admin/notifications/${n._id}`, {
        method: "DELETE",
        headers: authHeaders()
      });
      const data = await res.json();
      if (!res.ok || !data.ok) return AdminUI.toast(data.message || t("admin.notifications.deleteFailed"), "error");

      await loadNotifications();
      AdminUI.toast(t("admin.notifications.deleted"), "success");
    } catch (e) {
      console.error("delete notification failed:", e);
      AdminUI.toast(t("admin.notifications.deleteFailedServer"), "error");
    }
  }

  // ---------- send notification modal ----------
  let usernameOptionsLoaded = false;

  async function populateUsernameOptions(datalist) {
    if (usernameOptionsLoaded) return;
    try {
      const res = await fetch(`${API_BASE}/api/admin/users`, { headers: authHeaders() });
      const data = await res.json();
      if (!data.ok) return;
      datalist.innerHTML = (data.users || [])
        .map((u) => `<option value="${escapeHtml(u.username)}">${escapeHtml(u.fullname)}</option>`)
        .join("");
      usernameOptionsLoaded = true;
    } catch (e) {
      // non-fatal — the field still works as free text
    }
  }

  function openSendModal() {
    const bodyNode = el.sendTemplate.content.firstElementChild.cloneNode(true);

    const fTitle = bodyNode.querySelector("#nfFormTitle");
    const fMessage = bodyNode.querySelector("#nfFormMessage");
    const fTargetType = bodyNode.querySelector("#nfFormTargetType");
    const fRoleField = bodyNode.querySelector("#nfFormRoleField");
    const fRole = bodyNode.querySelector("#nfFormRole");
    const fUsernameField = bodyNode.querySelector("#nfFormUsernameField");
    const fUsername = bodyNode.querySelector("#nfFormUsername");
    const usernameDatalist = bodyNode.querySelector("#nfUsernameOptions");

    function updateTargetFields() {
      fRoleField.hidden = fTargetType.value !== "role";
      fUsernameField.hidden = fTargetType.value !== "username";
      if (fTargetType.value === "username") populateUsernameOptions(usernameDatalist);
    }
    fTargetType.addEventListener("change", updateTargetFields);
    updateTargetFields();

    AdminUI.openModal({ title: t("admin.notifications.sendModalTitle"), bodyNode, wide: true });

    bodyNode.querySelector("#nfFormCancel").addEventListener("click", () => AdminUI.closeModal());

    bodyNode.addEventListener("submit", async (e) => {
      e.preventDefault();

      const title = fTitle.value.trim();
      const message = fMessage.value.trim();
      const targetType = fTargetType.value;
      const targetValue = targetType === "role" ? fRole.value
        : targetType === "username" ? fUsername.value.trim()
        : "";

      if (!title) return AdminUI.toast(t("admin.notifications.enterTitle"), "error");
      if (targetType !== "all" && !targetValue) return AdminUI.toast(t("admin.notifications.enterTargetValue"), "error");

      try {
        const res = await fetch(`${API_BASE}/api/admin/notifications/send`, {
          method: "POST",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ title, message, targetType, targetValue })
        });
        const data = await res.json();
        if (!res.ok || !data.ok) return AdminUI.toast(data.message || t("admin.notifications.sendFailed"), "error");

        AdminUI.closeModal();
        await loadNotifications();
        AdminUI.toast(t("admin.notifications.sent"), "success");
      } catch (err) {
        console.error("send notification failed:", err);
        AdminUI.toast(t("admin.notifications.couldNotReachServer"), "error");
      }
    });
  }

  el.btnSend.addEventListener("click", openSendModal);

  // ---------- cleanup ----------
  function openCleanupModal() {
    const body = document.createElement("div");
    body.innerHTML = `
      <p class="adm-modal-message">${t("admin.notifications.cleanupExplain")}</p>
      <label class="adm-cleanup-field">
        <span>${t("admin.notifications.keepDays")}</span>
        <input type="number" id="nfKeepDays" value="30" min="1">
      </label>
      <div class="adm-modal-footer">
        <button type="button" class="adm-btn" id="nfCleanupCancel">${t("admin.notifications.cancel")}</button>
        <button type="button" class="adm-btn adm-btn-danger" id="nfCleanupConfirm">${t("admin.notifications.deleteOldConfirm")}</button>
      </div>
    `;

    const { body: mountedBody } = AdminUI.openModal({ title: t("admin.notifications.cleanupModalTitle"), bodyNode: body });

    mountedBody.querySelector("#nfCleanupCancel").addEventListener("click", () => AdminUI.closeModal());
    mountedBody.querySelector("#nfCleanupConfirm").addEventListener("click", async () => {
      const keepDays = Number(mountedBody.querySelector("#nfKeepDays").value || 30);

      try {
        const res = await fetch(`${API_BASE}/api/notifications/cleanup`, {
          method: "POST",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ keepDays })
        });
        const data = await res.json();
        if (!res.ok || !data.ok) return AdminUI.toast(data.message || t("admin.notifications.cleanupFailed"), "error");

        AdminUI.closeModal();
        AdminUI.toast(t("admin.notifications.cleanupDeleted", { count: data.deletedNotifications }), "success");
        loadNotifications();
      } catch (e) {
        console.error("cleanup failed:", e);
        AdminUI.toast(t("admin.notifications.cleanupFailedServer"), "error");
      }
    });
  }

  el.btnCleanup.addEventListener("click", openCleanupModal);

  // ---------- prune dead subscriptions ----------
  async function pruneSubscriptions() {
    const ok = await AdminUI.confirm({
      title: t("admin.notifications.pruneConfirmTitle"),
      message: t("admin.notifications.pruneConfirmMessage"),
      confirmLabel: t("admin.notifications.runPrune"),
      danger: false
    });
    if (!ok) return;

    el.btnPrune.disabled = true;
    el.btnPrune.textContent = t("admin.notifications.pruning");

    try {
      const res = await fetch(`${API_BASE}/api/admin/notifications/prune-subscriptions`, {
        method: "POST",
        headers: authHeaders()
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        AdminUI.toast(data.message || t("admin.notifications.pruneFailed"), "error");
      } else {
        AdminUI.toast(
          t("admin.notifications.pruneResult", { checked: data.totalChecked, alive: data.alive, pruned: data.pruned, errors: data.errors }),
          "success"
        );
        loadPushStats();
      }
    } catch (e) {
      console.error("prune failed:", e);
      AdminUI.toast(t("admin.notifications.pruneFailedServer"), "error");
    } finally {
      el.btnPrune.disabled = false;
      el.btnPrune.textContent = t("admin.notifications.pruneDeadSubs");
    }
  }

  el.btnPrune.addEventListener("click", pruneSubscriptions);

  // ---------- init ----------
  function init() {
    loadNotifications();
    loadPushStats();
  }

  document.readyState === "loading"
    ? document.addEventListener("DOMContentLoaded", init)
    : init();
})();
