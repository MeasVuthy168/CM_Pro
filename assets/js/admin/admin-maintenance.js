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

  // =====================================================
  // MongoDB Storage Usage — live plan-vs-usage from GET /api/admin/mongo-usage
  // (the cluster's own dbStats/collStats, no extra API key needed, mirrors
  // the Render Account Usage card on the Bandwidth page). Fixed independent
  // of the cleanup tools below — just context for why they matter.
  // =====================================================
  async function fetchMongoUsage() {
    const loadingEl = document.getElementById("mtMongoLoading");
    const bodyEl = document.getElementById("mtMongoBody");
    const setupEl = document.getElementById("mtMongoSetup");
    if (!loadingEl) return; // card not on this page

    try {
      const res = await fetch(`${API_BASE}/api/admin/mongo-usage`, { headers: authHeaders() });
      const data = await res.json();

      if (!data.ok) {
        loadingEl.hidden = true;
        bodyEl.hidden = true;
        setupEl.hidden = false;
        if (data.message) {
          setupEl.removeAttribute("data-i18n");
          setupEl.textContent = data.message;
        }
        return;
      }

      loadingEl.hidden = true;
      setupEl.hidden = true;
      bodyEl.hidden = false;

      document.getElementById("mtMongoTotal").textContent = `${data.totalMb.toFixed(1)} MB / ${data.planMb} MB`;
      document.getElementById("mtMongoTotalSub").textContent = t("admin.maintenance.pctOfStorageQuota", { pct: data.pctUsed });

      const bar = document.getElementById("mtMongoBar");
      bar.style.width = `${Math.min(100, data.pctUsed)}%`;
      bar.classList.toggle("adm-bar-warn", data.pctUsed >= 70 && data.pctUsed < 100);
      bar.classList.toggle("adm-bar-danger", data.pctUsed >= 100);

      const indexNoteEl = document.getElementById("mtMongoIndexNote");
      if (indexNoteEl) {
        indexNoteEl.textContent = (data.dataMb != null && data.indexMb != null)
          ? t("admin.maintenance.dataIndexBreakdown", { dataMb: data.dataMb.toFixed(1), indexMb: data.indexMb.toFixed(1) })
          : "";
      }

      const sourcesEl = document.getElementById("mtMongoSources");
      const entries = Object.entries(data.byCollectionMb || {});
      sourcesEl.innerHTML = entries.length
        ? entries
            .sort((a, b) => b[1] - a[1])
            .map(([name, mb]) => `
              <div class="adm-render-source-row">
                <span>${name}</span>
                <span>${mb.toFixed(1)} MB</span>
              </div>
            `)
            .join("")
        : "";
    } catch (e) {
      console.error("mongo-usage fetch failed:", e);
      loadingEl.hidden = true;
      bodyEl.hidden = true;
      setupEl.hidden = false;
      setupEl.textContent = t("admin.maintenance.couldNotLoadMongoUsage");
    }
  }

  if (document.getElementById("admMongoUsageCard")) {
    fetchMongoUsage();
    setInterval(fetchMongoUsage, 5 * 60 * 1000);
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

  // =====================================================
  // Wipe Collection by Source — for wipe-and-replace collections
  // (ListBlocked, ScheduleRepayments, PrevOS, NewRegister, …) where
  // there's no "old" data to prune by date. Admin picks a collection,
  // then one of its existing `source` values, then deletes every row
  // for that source. Same preview-before-delete guard as above.
  // =====================================================
  const wp = {
    collection: document.getElementById("wpCollection"),
    source: document.getElementById("wpSource"),
    previewResult: document.getElementById("wpPreviewResult"),
    btnPreview: document.getElementById("wpBtnPreview"),
    btnDelete: document.getElementById("wpBtnDelete")
  };

  let wipeCollections = []; // [{ key, label }]
  let lastWipePreview = null; // { collection, source, count }

  function currentWipeEntry() {
    return wipeCollections.find((c) => c.key === wp.collection.value) || null;
  }

  function invalidateWipePreview() {
    lastWipePreview = null;
    wp.btnDelete.disabled = true;
    wp.previewResult.hidden = true;
  }

  wp.source.addEventListener("change", invalidateWipePreview);

  async function loadWipeSources() {
    const entry = currentWipeEntry();
    invalidateWipePreview();
    wp.source.innerHTML = "";
    if (!entry) return;

    try {
      const res = await fetch(`${API_BASE}/api/maintenance/wipe-sources?collection=${encodeURIComponent(entry.key)}`, {
        headers: authHeaders()
      });

      if (res.status === 401 || res.status === 403) {
        location.replace(window.CM_ADMIN_CONFIG.loginPage);
        return;
      }

      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.message || "Failed to load sources");

      const sources = data.sources || [];
      wp.source.innerHTML = sources.length
        ? sources.map((s) => `<option value="${s.source}">${t("admin.maintenance.sourceRowCount", { source: s.source, count: s.count })}</option>`).join("")
        : `<option value="">${t("admin.maintenance.noSources")}</option>`;
    } catch (e) {
      console.error("loadWipeSources failed:", e);
      AdminUI.toast(t("admin.maintenance.loadSourcesFailed"), "error");
    }
  }

  wp.collection.addEventListener("change", loadWipeSources);

  async function loadWipeCollections() {
    try {
      const res = await fetch(`${API_BASE}/api/maintenance/wipe-collections`, { headers: authHeaders() });

      if (res.status === 401 || res.status === 403) {
        location.replace(window.CM_ADMIN_CONFIG.loginPage);
        return;
      }

      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.message || "Failed to load collections");

      wipeCollections = data.collections || [];
      wp.collection.innerHTML = wipeCollections.map((c) => `<option value="${c.key}">${c.label}</option>`).join("");
      await loadWipeSources();
    } catch (e) {
      console.error("loadWipeCollections failed:", e);
      AdminUI.toast(t("admin.maintenance.loadCollectionsFailed"), "error");
    }
  }

  async function runWipePreview() {
    const entry = currentWipeEntry();
    const source = wp.source.value;
    if (!entry || !source) return;

    wp.btnPreview.disabled = true;
    try {
      const res = await fetch(`${API_BASE}/api/maintenance/wipe`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ collection: entry.key, source, dryRun: true })
      });

      if (res.status === 401 || res.status === 403) {
        location.replace(window.CM_ADMIN_CONFIG.loginPage);
        return;
      }

      const data = await res.json();
      if (!res.ok || !data.ok) return AdminUI.toast(data.message || t("admin.maintenance.previewFailed"), "error");

      lastWipePreview = { collection: entry.key, source, count: data.count };
      wp.previewResult.hidden = false;
      wp.previewResult.textContent = t("admin.maintenance.wipePreviewResult", { count: data.count, source, collection: entry.label });
      wp.btnDelete.disabled = data.count === 0;
    } catch (e) {
      console.error("wipe preview failed:", e);
      AdminUI.toast(t("admin.maintenance.previewFailedServer"), "error");
    } finally {
      wp.btnPreview.disabled = false;
    }
  }

  wp.btnPreview.addEventListener("click", runWipePreview);

  function openWipeConfirmModal() {
    const entry = currentWipeEntry();
    const source = wp.source.value;
    if (!entry || !lastWipePreview || lastWipePreview.collection !== entry.key || lastWipePreview.source !== source) {
      return AdminUI.toast(t("admin.maintenance.previewFirst"), "error");
    }

    const body = document.createElement("div");
    body.innerHTML = `
      <p class="adm-modal-message">${t("admin.maintenance.wipeConfirmMessage", { count: lastWipePreview.count, source, collection: entry.label })}</p>
      <div class="adm-modal-footer">
        <button type="button" class="adm-btn" id="wpDeleteCancel">${t("admin.maintenance.cancel")}</button>
        <button type="button" class="adm-btn adm-btn-danger" id="wpDeleteConfirm">${t("admin.maintenance.confirmDelete")}</button>
      </div>
    `;

    const { body: mountedBody } = AdminUI.openModal({ title: t("admin.maintenance.deleteConfirmTitle"), bodyNode: body });

    mountedBody.querySelector("#wpDeleteCancel").addEventListener("click", () => AdminUI.closeModal());
    mountedBody.querySelector("#wpDeleteConfirm").addEventListener("click", async () => {
      try {
        const res = await fetch(`${API_BASE}/api/maintenance/wipe`, {
          method: "POST",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ collection: entry.key, source })
        });
        const data = await res.json();
        if (!res.ok || !data.ok) return AdminUI.toast(data.message || t("admin.maintenance.wipeFailed"), "error");

        AdminUI.closeModal();
        AdminUI.toast(t("admin.maintenance.wiped", { count: data.deletedCount, source, collection: entry.label }), "success");
        invalidateWipePreview();
        loadWipeSources();
      } catch (e) {
        console.error("wipe delete failed:", e);
        AdminUI.toast(t("admin.maintenance.wipeFailedServer"), "error");
      }
    });
  }

  wp.btnDelete.addEventListener("click", openWipeConfirmModal);

  loadWipeCollections();

  // =====================================================
  // Compact Report Snapshot History — collapses each already-closed
  // month of daily Branch/Officer/Location/Product report-history
  // snapshots down to that month's last business day (per the backend's
  // Cambodian weekend/holiday calendar). No collection/source picker
  // needed — it always runs across all four report types in one pass,
  // same preview-before-run guard as the other tools.
  // =====================================================
  const cp = {
    previewResult: document.getElementById("cpPreviewResult"),
    btnPreview: document.getElementById("cpBtnPreview"),
    btnRun: document.getElementById("cpBtnRun")
  };

  let lastCompactPreview = null; // { months, count }

  function invalidateCompactPreview() {
    lastCompactPreview = null;
    cp.btnRun.disabled = true;
    cp.previewResult.hidden = true;
  }

  async function runCompactPreview() {
    cp.btnPreview.disabled = true;
    try {
      const res = await fetch(`${API_BASE}/api/maintenance/compact-snapshots`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: true })
      });

      if (res.status === 401 || res.status === 403) {
        location.replace(window.CM_ADMIN_CONFIG.loginPage);
        return;
      }

      const data = await res.json();
      if (!res.ok || !data.ok) return AdminUI.toast(data.message || t("admin.maintenance.compactPreviewFailed"), "error");

      lastCompactPreview = { months: data.monthsAffected, count: data.count };
      cp.previewResult.hidden = false;
      cp.previewResult.textContent = data.count > 0
        ? t("admin.maintenance.compactPreviewResult", { months: data.monthsAffected, count: data.count })
        : t("admin.maintenance.compactPreviewEmpty");
      cp.btnRun.disabled = data.count === 0;
    } catch (e) {
      console.error("compact preview failed:", e);
      AdminUI.toast(t("admin.maintenance.compactPreviewFailedServer"), "error");
    } finally {
      cp.btnPreview.disabled = false;
    }
  }

  cp.btnPreview.addEventListener("click", runCompactPreview);

  function openCompactConfirmModal() {
    if (!lastCompactPreview) {
      return AdminUI.toast(t("admin.maintenance.previewFirst"), "error");
    }

    const body = document.createElement("div");
    body.innerHTML = `
      <p class="adm-modal-message">${t("admin.maintenance.compactConfirmMessage", { count: lastCompactPreview.count, months: lastCompactPreview.months })}</p>
      <div class="adm-modal-footer">
        <button type="button" class="adm-btn" id="cpRunCancel">${t("admin.maintenance.cancel")}</button>
        <button type="button" class="adm-btn adm-btn-danger" id="cpRunConfirm">${t("admin.maintenance.confirmDelete")}</button>
      </div>
    `;

    const { body: mountedBody } = AdminUI.openModal({ title: t("admin.maintenance.compactConfirmTitle"), bodyNode: body });

    mountedBody.querySelector("#cpRunCancel").addEventListener("click", () => AdminUI.closeModal());
    mountedBody.querySelector("#cpRunConfirm").addEventListener("click", async () => {
      try {
        const res = await fetch(`${API_BASE}/api/maintenance/compact-snapshots`, {
          method: "POST",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({})
        });
        const data = await res.json();
        if (!res.ok || !data.ok) return AdminUI.toast(data.message || t("admin.maintenance.compactFailed"), "error");

        AdminUI.closeModal();
        AdminUI.toast(t("admin.maintenance.compactDone", { count: data.deletedCount, months: data.monthsAffected }), "success");
        invalidateCompactPreview();
      } catch (e) {
        console.error("compact run failed:", e);
        AdminUI.toast(t("admin.maintenance.compactFailedServer"), "error");
      }
    });
  }

  cp.btnRun.addEventListener("click", openCompactConfirmModal);
})();
