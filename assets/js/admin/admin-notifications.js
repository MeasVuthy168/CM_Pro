/* =====================================================
   admin-notifications.js
   Send announcements (All/Role/Username), browse full history
   (admin sees everything, not just what's targeted at them),
   delete a mistaken send, and clean up old ones.
   ===================================================== */
(function () {
  if (!window.CMAdmin) return; // admin-loader.js already redirected away

  const API_BASE = (window.API && window.API.BASE_URL) || "";

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
    if (diff < 60) return "Just now";
    if (diff < 3600) return Math.floor(diff / 60) + " min ago";
    if (diff < 86400) return Math.floor(diff / 3600) + " hr ago";
    if (diff < 604800) return Math.floor(diff / 86400) + " day(s) ago";
    return d.toLocaleDateString();
  }

  function targetLabel(n) {
    if (n.targetType === "all") return "All Users";
    if (n.targetType === "role") return `Role: ${n.targetValue}`;
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
      AdminUI.toast("Could not load notifications.", "error");
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
        <td>${escapeHtml(n.createdBy || "system")}</td>
        <td>
          <div class="adm-row-actions">
            <button type="button" class="adm-icon-btn" title="View" data-action="view">👁️</button>
            <button type="button" class="adm-icon-btn adm-icon-btn-danger" title="Delete" data-action="delete">🗑️</button>
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
      ["Time", new Date(n.createdAt).toLocaleString()],
      ["Title", n.title],
      ["Message", n.message || "—"],
      ["Type", n.type],
      ["Module", n.moduleCode || "—"],
      ["Target", targetLabel(n)],
      ["Sent By", n.createdBy || "system"]
    ];
    body.innerHTML = rows.map(([label, value]) => `
      <div class="adm-logs-detail-row">
        <span>${escapeHtml(label)}</span>
        <span>${escapeHtml(value)}</span>
      </div>
    `).join("");
    AdminUI.openModal({ title: "Notification Detail", bodyNode: body, wide: true });
  }

  async function deleteNotification(n) {
    const ok = await AdminUI.confirm({
      title: "Delete notification?",
      message: `This permanently deletes "<strong>${escapeHtml(n.title)}</strong>" for everyone. This can't be undone.`,
      confirmLabel: "Delete",
      danger: true
    });
    if (!ok) return;

    try {
      const res = await fetch(`${API_BASE}/api/admin/notifications/${n._id}`, {
        method: "DELETE",
        headers: authHeaders()
      });
      const data = await res.json();
      if (!res.ok || !data.ok) return AdminUI.toast(data.message || "Delete failed.", "error");

      await loadNotifications();
      AdminUI.toast("Notification deleted.", "success");
    } catch (e) {
      console.error("delete notification failed:", e);
      AdminUI.toast("Delete failed — could not reach the server.", "error");
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

    AdminUI.openModal({ title: "Send Notification", bodyNode, wide: true });

    bodyNode.querySelector("#nfFormCancel").addEventListener("click", () => AdminUI.closeModal());

    bodyNode.addEventListener("submit", async (e) => {
      e.preventDefault();

      const title = fTitle.value.trim();
      const message = fMessage.value.trim();
      const targetType = fTargetType.value;
      const targetValue = targetType === "role" ? fRole.value
        : targetType === "username" ? fUsername.value.trim()
        : "";

      if (!title) return AdminUI.toast("Enter a title.", "error");
      if (targetType !== "all" && !targetValue) return AdminUI.toast("Enter a target value.", "error");

      try {
        const res = await fetch(`${API_BASE}/api/admin/notifications/send`, {
          method: "POST",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ title, message, targetType, targetValue })
        });
        const data = await res.json();
        if (!res.ok || !data.ok) return AdminUI.toast(data.message || "Send failed.", "error");

        AdminUI.closeModal();
        await loadNotifications();
        AdminUI.toast("Notification sent.", "success");
      } catch (err) {
        console.error("send notification failed:", err);
        AdminUI.toast("Could not reach the server.", "error");
      }
    });
  }

  el.btnSend.addEventListener("click", openSendModal);

  // ---------- cleanup ----------
  function openCleanupModal() {
    const body = document.createElement("div");
    body.innerHTML = `
      <p class="adm-modal-message">
        Permanently deletes notifications older than the number of days below.
        This can't be undone.
      </p>
      <label class="adm-cleanup-field">
        <span>Keep notifications from the last (days)</span>
        <input type="number" id="nfKeepDays" value="30" min="1">
      </label>
      <div class="adm-modal-footer">
        <button type="button" class="adm-btn" id="nfCleanupCancel">Cancel</button>
        <button type="button" class="adm-btn adm-btn-danger" id="nfCleanupConfirm">Delete Old Notifications</button>
      </div>
    `;

    const { body: mountedBody } = AdminUI.openModal({ title: "Clean Up Old Notifications", bodyNode: body });

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
        if (!res.ok || !data.ok) return AdminUI.toast(data.message || "Cleanup failed.", "error");

        AdminUI.closeModal();
        AdminUI.toast(`Deleted ${data.deletedNotifications} notification(s).`, "success");
        loadNotifications();
      } catch (e) {
        console.error("cleanup failed:", e);
        AdminUI.toast("Cleanup failed — could not reach the server.", "error");
      }
    });
  }

  el.btnCleanup.addEventListener("click", openCleanupModal);

  // ---------- prune dead subscriptions ----------
  async function pruneSubscriptions() {
    const ok = await AdminUI.confirm({
      title: "Prune dead subscriptions?",
      message: "This sends a small test push to every stored subscription right now to check which are still alive. Dead ones (404/410) are deleted immediately. Devices that are genuinely still active may briefly show a low-priority \"System Check\" notification. This can take a little while for a large list.",
      confirmLabel: "Run Prune",
      danger: false
    });
    if (!ok) return;

    el.btnPrune.disabled = true;
    el.btnPrune.textContent = "Pruning…";

    try {
      const res = await fetch(`${API_BASE}/api/admin/notifications/prune-subscriptions`, {
        method: "POST",
        headers: authHeaders()
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        AdminUI.toast(data.message || "Prune failed.", "error");
      } else {
        AdminUI.toast(
          `Checked ${data.totalChecked} — ${data.alive} alive, ${data.pruned} removed, ${data.errors} transient errors.`,
          "success"
        );
        loadPushStats();
      }
    } catch (e) {
      console.error("prune failed:", e);
      AdminUI.toast("Prune failed — could not reach the server.", "error");
    } finally {
      el.btnPrune.disabled = false;
      el.btnPrune.textContent = "📡 Prune Dead Subscriptions";
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
