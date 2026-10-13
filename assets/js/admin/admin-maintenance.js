/* =====================================================
   admin-maintenance.js
   Debit Turn Over retention cleanup: preview the count of rows
   older than a cutoff before allowing the (destructive,
   irreversible) delete — mirrors the activitylogs cleanup pattern
   but requires a preview first since this is a manual, admin-
   triggered bulk delete rather than a bounded "keep N days" job.
   ===================================================== */
(function () {
  if (!window.CMAdmin) return; // admin-loader.js already redirected away

  const API_BASE = (window.API && window.API.BASE_URL) || "";
  const t = (key, vars) => (window.CMI18n ? CMI18n.t(key, vars) : key);

  const el = {
    keepDays: document.getElementById("dtoKeepDays"),
    previewResult: document.getElementById("dtoPreviewResult"),
    btnPreview: document.getElementById("dtoBtnPreview"),
    btnDelete: document.getElementById("dtoBtnDelete"),
    btnActivityLogsCleanup: document.getElementById("alBtnCleanup"),
    btnNotificationsCleanup: document.getElementById("nfBtnCleanup")
  };

  let lastPreview = null; // { days, count, cutoff } — must match current input to allow delete

  function authHeaders() {
    return { Authorization: `Bearer ${window.CMAdmin.token}` };
  }

  function currentDays() {
    const n = parseInt(el.keepDays.value, 10);
    return Number.isFinite(n) && n > 0 ? n : 365;
  }

  function invalidatePreview() {
    lastPreview = null;
    el.btnDelete.disabled = true;
    el.previewResult.hidden = true;
  }

  el.keepDays.addEventListener("input", invalidatePreview);

  async function runPreview() {
    const days = currentDays();
    el.btnPreview.disabled = true;
    try {
      const params = new URLSearchParams({ source: "DebitTurnOver", days: String(days), dryRun: "true" });
      const res = await fetch(`${API_BASE}/api/debitturnover/delete-older-than?${params.toString()}`, {
        method: "POST",
        headers: authHeaders()
      });

      if (res.status === 401 || res.status === 403) {
        location.replace(window.CM_ADMIN_CONFIG.loginPage);
        return;
      }

      const data = await res.json();
      if (!res.ok || !data.ok) return AdminUI.toast(data.message || t("admin.maintenance.previewFailed"), "error");

      lastPreview = { days, count: data.count, cutoff: data.cutoff };
      el.previewResult.hidden = false;
      el.previewResult.textContent = data.count > 0
        ? t("admin.maintenance.previewResult", { count: data.count, cutoff: data.cutoff })
        : t("admin.maintenance.previewResultEmpty", { cutoff: data.cutoff });
      el.btnDelete.disabled = data.count === 0;
    } catch (e) {
      console.error("preview failed:", e);
      AdminUI.toast(t("admin.maintenance.previewFailedServer"), "error");
    } finally {
      el.btnPreview.disabled = false;
    }
  }

  el.btnPreview.addEventListener("click", runPreview);

  function openDeleteConfirmModal() {
    if (!lastPreview || lastPreview.days !== currentDays()) {
      return AdminUI.toast(t("admin.maintenance.previewFirst"), "error");
    }

    const body = document.createElement("div");
    body.innerHTML = `
      <p class="adm-modal-message">${t("admin.maintenance.deleteConfirmMessage", { count: lastPreview.count, cutoff: lastPreview.cutoff })}</p>
      <div class="adm-modal-footer">
        <button type="button" class="adm-btn" id="dtoDeleteCancel">${t("admin.maintenance.cancel")}</button>
        <button type="button" class="adm-btn adm-btn-danger" id="dtoDeleteConfirm">${t("admin.maintenance.confirmDelete")}</button>
      </div>
    `;

    const { body: mountedBody } = AdminUI.openModal({ title: t("admin.maintenance.deleteConfirmTitle"), bodyNode: body });

    mountedBody.querySelector("#dtoDeleteCancel").addEventListener("click", () => AdminUI.closeModal());
    mountedBody.querySelector("#dtoDeleteConfirm").addEventListener("click", async () => {
      const days = lastPreview.days;
      try {
        const res = await fetch(`${API_BASE}/api/debitturnover/delete-older-than`, {
          method: "POST",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ source: "DebitTurnOver", days })
        });
        const data = await res.json();
        if (!res.ok || !data.ok) return AdminUI.toast(data.message || t("admin.maintenance.deleteFailed"), "error");

        AdminUI.closeModal();
        AdminUI.toast(t("admin.maintenance.deleted", { count: data.deletedCount, cutoff: data.cutoff }), "success");
        invalidatePreview();
      } catch (e) {
        console.error("delete failed:", e);
        AdminUI.toast(t("admin.maintenance.deleteFailedServer"), "error");
      }
    });
  }

  el.btnDelete.addEventListener("click", openDeleteConfirmModal);

  // ---------- Activity Logs cleanup (moved from admin-activitylogs.js) ----------
  function openActivityLogsCleanupModal() {
    const body = document.createElement("div");
    body.innerHTML = `
      <p class="adm-modal-message">${t("admin.activitylogs.cleanupExplain")}</p>
      <label class="adm-cleanup-field">
        <span>${t("admin.activitylogs.keepDays")}</span>
        <input type="number" id="alKeepDays" value="180" min="1">
      </label>
      <div class="adm-modal-footer">
        <button type="button" class="adm-btn" id="alCleanupCancel">${t("admin.activitylogs.cancel")}</button>
        <button type="button" class="adm-btn adm-btn-danger" id="alCleanupConfirm">${t("admin.activitylogs.deleteOldLogs")}</button>
      </div>
    `;

    const { body: mountedBody } = AdminUI.openModal({ title: t("admin.activitylogs.cleanupModalTitle"), bodyNode: body });

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
        if (!res.ok || !data.ok) return AdminUI.toast(data.message || t("admin.activitylogs.cleanupFailed"), "error");

        AdminUI.closeModal();
        AdminUI.toast(t("admin.activitylogs.cleanupDeleted", { count: data.deletedCount, cutoff: data.cutoffCambodiaText }), "success");
      } catch (e) {
        console.error("activity logs cleanup failed:", e);
        AdminUI.toast(t("admin.activitylogs.cleanupFailedServer"), "error");
      }
    });
  }

  el.btnActivityLogsCleanup?.addEventListener("click", openActivityLogsCleanupModal);

  // ---------- Notifications cleanup (moved from admin-notifications.js) ----------
  function openNotificationsCleanupModal() {
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
      } catch (e) {
        console.error("notifications cleanup failed:", e);
        AdminUI.toast(t("admin.notifications.cleanupFailedServer"), "error");
      }
    });
  }

  el.btnNotificationsCleanup?.addEventListener("click", openNotificationsCleanupModal);
})();
