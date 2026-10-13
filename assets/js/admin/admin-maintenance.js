/* =====================================================
   admin-maintenance.js
   Generic Storage Cleanup: the collection dropdown is populated from
   GET /api/maintenance/collections — a backend-defined allowlist of
   collections that are safe to bulk-prune by date. The admin never
   names a raw collection; only one of these allowlisted keys is ever
   sent to the server. Requires a matching Preview (dry run) before
   Delete Permanently is enabled, since this is an irreversible bulk
   delete.
   ===================================================== */
(function () {
  if (!window.CMAdmin) return; // admin-loader.js already redirected away

  const API_BASE = (window.API && window.API.BASE_URL) || "";
  const t = (key, vars) => (window.CMI18n ? CMI18n.t(key, vars) : key);

  const el = {
    collection: document.getElementById("mtCollection"),
    keepDays: document.getElementById("mtKeepDays"),
    previewResult: document.getElementById("mtPreviewResult"),
    btnPreview: document.getElementById("mtBtnPreview"),
    btnDelete: document.getElementById("mtBtnDelete")
  };

  let collections = []; // [{ key, label, defaultDays }]
  let lastPreview = null; // { key, days, count, cutoff } — must match current selection to allow delete

  function authHeaders() {
    return { Authorization: `Bearer ${window.CMAdmin.token}` };
  }

  function currentEntry() {
    return collections.find((c) => c.key === el.collection.value) || null;
  }

  function currentDays() {
    const entry = currentEntry();
    const n = parseInt(el.keepDays.value, 10);
    return Number.isFinite(n) && n > 0 ? n : (entry ? entry.defaultDays : 30);
  }

  function invalidatePreview() {
    lastPreview = null;
    el.btnDelete.disabled = true;
    el.previewResult.hidden = true;
  }

  el.keepDays.addEventListener("input", invalidatePreview);

  el.collection.addEventListener("change", () => {
    const entry = currentEntry();
    if (entry) el.keepDays.value = entry.defaultDays;
    invalidatePreview();
  });

  async function loadCollections() {
    try {
      const res = await fetch(`${API_BASE}/api/maintenance/collections`, { headers: authHeaders() });

      if (res.status === 401 || res.status === 403) {
        location.replace(window.CM_ADMIN_CONFIG.loginPage);
        return;
      }

      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.message || "Failed to load collections");

      collections = data.collections || [];
      el.collection.innerHTML = collections.map((c) => `<option value="${c.key}">${c.label}</option>`).join("");
      if (collections.length) el.keepDays.value = collections[0].defaultDays;
    } catch (e) {
      console.error("loadCollections failed:", e);
      AdminUI.toast(t("admin.maintenance.loadCollectionsFailed"), "error");
    }
  }

  async function runPreview() {
    const entry = currentEntry();
    if (!entry) return;
    const days = currentDays();

    el.btnPreview.disabled = true;
    try {
      const res = await fetch(`${API_BASE}/api/maintenance/cleanup`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ collection: entry.key, days, dryRun: true })
      });

      if (res.status === 401 || res.status === 403) {
        location.replace(window.CM_ADMIN_CONFIG.loginPage);
        return;
      }

      const data = await res.json();
      if (!res.ok || !data.ok) return AdminUI.toast(data.message || t("admin.maintenance.previewFailed"), "error");

      lastPreview = { key: entry.key, days, count: data.count, cutoff: data.cutoff };
      el.previewResult.hidden = false;
      el.previewResult.textContent = data.count > 0
        ? t("admin.maintenance.previewResult", { count: data.count, cutoff: data.cutoff, collection: entry.label })
        : t("admin.maintenance.previewResultEmpty", { cutoff: data.cutoff, collection: entry.label });
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
    const entry = currentEntry();
    if (!entry || !lastPreview || lastPreview.key !== entry.key || lastPreview.days !== currentDays()) {
      return AdminUI.toast(t("admin.maintenance.previewFirst"), "error");
    }

    const body = document.createElement("div");
    body.innerHTML = `
      <p class="adm-modal-message">${t("admin.maintenance.deleteConfirmMessage", { count: lastPreview.count, cutoff: lastPreview.cutoff, collection: entry.label })}</p>
      <div class="adm-modal-footer">
        <button type="button" class="adm-btn" id="mtDeleteCancel">${t("admin.maintenance.cancel")}</button>
        <button type="button" class="adm-btn adm-btn-danger" id="mtDeleteConfirm">${t("admin.maintenance.confirmDelete")}</button>
      </div>
    `;

    const { body: mountedBody } = AdminUI.openModal({ title: t("admin.maintenance.deleteConfirmTitle"), bodyNode: body });

    mountedBody.querySelector("#mtDeleteCancel").addEventListener("click", () => AdminUI.closeModal());
    mountedBody.querySelector("#mtDeleteConfirm").addEventListener("click", async () => {
      const { key, days } = lastPreview;
      try {
        const res = await fetch(`${API_BASE}/api/maintenance/cleanup`, {
          method: "POST",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ collection: key, days })
        });
        const data = await res.json();
        if (!res.ok || !data.ok) return AdminUI.toast(data.message || t("admin.maintenance.deleteFailed"), "error");

        AdminUI.closeModal();
        AdminUI.toast(t("admin.maintenance.deleted", { count: data.deletedCount, cutoff: data.cutoff, collection: entry.label }), "success");
        invalidatePreview();
      } catch (e) {
        console.error("delete failed:", e);
        AdminUI.toast(t("admin.maintenance.deleteFailedServer"), "error");
      }
    });
  }

  el.btnDelete.addEventListener("click", openDeleteConfirmModal);

  loadCollections();
})();
