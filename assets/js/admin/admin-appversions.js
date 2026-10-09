/* =====================================================
   admin-appversions.js
   Publish new Excel builds (upload to GitHub Releases via the
   existing backend), show the current version prominently, and
   manage history. Note: cleanup only removes Mongo tracking
   metadata — it does not delete the underlying GitHub Release,
   flagged clearly in the cleanup dialog so that's not a surprise.
   ===================================================== */
(function () {
  if (!window.CMAdmin) return; // admin-loader.js already redirected away

  const API_BASE = (window.API && window.API.BASE_URL) || "";
  const APP_NAME = "SVG_CreditMonitoring";
  const t = (key, vars) => (window.CMI18n ? CMI18n.t(key, vars) : key);

  const state = { versions: [], latestVersion: "" };

  const el = {
    heroLoading: document.getElementById("avHeroLoading"),
    heroBody: document.getElementById("avHeroBody"),
    heroEmpty: document.getElementById("avHeroEmpty"),
    heroVersion: document.getElementById("avHeroVersion"),
    heroMandatory: document.getElementById("avHeroMandatory"),
    heroFilename: document.getElementById("avHeroFilename"),
    heroSize: document.getElementById("avHeroSize"),
    heroReleased: document.getElementById("avHeroReleased"),
    heroNotes: document.getElementById("avHeroNotes"),

    btnUpload: document.getElementById("avBtnUpload"),
    downloadsToggle: document.getElementById("avDownloadsToggle"),
    downloadsToggleLabel: document.getElementById("avDownloadsToggleLabel"),
    btnCleanup: document.getElementById("avBtnCleanup"),

    tableBody: document.getElementById("avTableBody"),
    tableEmpty: document.getElementById("avTableEmpty"),

    uploadTemplate: document.getElementById("avUploadTemplate"),
    editTemplate: document.getElementById("avEditTemplate")
  };

  function authHeaders() {
    return { Authorization: `Bearer ${window.CMAdmin.token}` };
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  function fmtBytes(bytes) {
    if (!bytes) return "0 B";
    const mb = bytes / 1024 / 1024;
    if (mb >= 1) return mb.toFixed(2) + " MB";
    return (bytes / 1024).toFixed(0) + " KB";
  }

  // A plain <a href> can't send an Authorization header, and this endpoint
  // requires one — so fetch the file with auth, then trigger a real download
  // from the resulting blob (same pattern as the user-photo endpoints).
  async function downloadWithAuth(url, filename) {
    try {
      const res = await fetch(url, { headers: authHeaders() });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        return AdminUI.toast(data.message || t("admin.appversions.downloadFailed"), "error");
      }

      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = filename || "download";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (e) {
      console.error("downloadWithAuth failed:", e);
      AdminUI.toast(t("admin.appversions.downloadFailedServer"), "error");
    }
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

  // ---------- current version hero ----------
  async function loadCurrentVersion() {
    try {
      const res = await fetch(`${API_BASE}/api/app/version?app=${encodeURIComponent(APP_NAME)}`, { headers: authHeaders() });
      const data = await res.json();
      if (!data.ok) throw new Error(data.message || "Failed to load version");

      el.heroLoading.hidden = true;

      if (!data.hasVersion) {
        el.heroEmpty.hidden = false;
        el.heroBody.hidden = true;
        return;
      }

      el.heroEmpty.hidden = true;
      el.heroBody.hidden = false;

      el.heroVersion.textContent = `v${data.latestVersion}`;
      state.latestVersion = data.latestVersion;
      el.heroMandatory.textContent = data.mandatory ? t("admin.appversions.mandatory") : t("admin.appversions.optional");
      el.heroMandatory.className = `adm-badge ${data.mandatory ? "adm-badge-status-failed" : "adm-badge-status-active"}`;
      el.heroFilename.textContent = data.filename || "—";
      el.heroSize.textContent = fmtBytes(data.size);
      el.heroReleased.textContent = timeAgo(data.releasedAt);
      el.heroNotes.textContent = data.notes || t("admin.appversions.noReleaseNotes");
    } catch (e) {
      console.error("loadCurrentVersion failed:", e);
      el.heroLoading.hidden = true;
      el.heroEmpty.hidden = false;
      el.heroEmpty.textContent = t("admin.appversions.couldNotLoadVersion");
    }
  }

  // ---------- version history ----------
  async function loadHistory() {
    try {
      const res = await fetch(`${API_BASE}/api/app/versions?app=${encodeURIComponent(APP_NAME)}`, { headers: authHeaders() });

      if (res.status === 401 || res.status === 403) {
        location.replace(window.CM_ADMIN_CONFIG.loginPage);
        return;
      }

      const data = await res.json();
      if (!data.ok) throw new Error(data.message || "Failed to load version history");

      state.versions = data.versions || [];
      renderTable();
    } catch (e) {
      console.error("loadHistory failed:", e);
      AdminUI.toast(t("admin.appversions.couldNotLoadHistory"), "error");
    }
  }

  function renderTable() {
    el.tableBody.innerHTML = "";

    if (!state.versions.length) {
      el.tableEmpty.hidden = false;
      return;
    }
    el.tableEmpty.hidden = true;

    state.versions.forEach((v) => {
      const tr = document.createElement("tr");
      tr.style.cursor = "pointer";
      const notesPreview = (v.notes || "").slice(0, 40) + ((v.notes || "").length > 40 ? "…" : "");
      tr.innerHTML = `
        <td><strong>v${escapeHtml(v.version)}</strong></td>
        <td>${fmtBytes(v.size)}</td>
        <td><span class="adm-badge ${v.mandatory ? "adm-badge-status-failed" : "adm-badge-status-inactive"}">${v.mandatory ? t("admin.appversions.mandatory") : t("admin.appversions.optional")}</span></td>
        <td>${escapeHtml(notesPreview || "—")}</td>
        <td title="${escapeHtml(v.releasedAt)}">${timeAgo(v.releasedAt)}</td>
        <td>
          <div class="adm-row-actions">
            <button type="button" class="adm-icon-btn" title="${t("admin.appversions.download")}" data-action="download">⬇️</button>
            <button type="button" class="adm-icon-btn" title="${t("admin.appversions.edit")}" data-action="edit">✏️</button>
            <button type="button" class="adm-icon-btn adm-icon-btn-danger" title="${t("admin.appversions.delete")}" data-action="delete">🗑️</button>
          </div>
        </td>
      `;
      tr.querySelector('[data-action="download"]').addEventListener("click", (e) => {
        e.stopPropagation();
        downloadWithAuth(`${API_BASE}/api/app/download/${encodeURIComponent(v.version)}?app=${encodeURIComponent(APP_NAME)}`, v.filename);
      });
      tr.querySelector('[data-action="edit"]').addEventListener("click", (e) => {
        e.stopPropagation();
        openEditModal(v);
      });
      tr.querySelector('[data-action="delete"]').addEventListener("click", (e) => {
        e.stopPropagation();
        deleteVersion(v);
      });
      tr.addEventListener("click", (e) => {
        if (e.target.closest("button")) return;
        viewDetail(v);
      });
      el.tableBody.appendChild(tr);
    });
  }

  function viewDetail(v) {
    const body = document.createElement("div");
    const rows = [
      [t("admin.appversions.fieldVersion"), `v${v.version}`],
      [t("admin.appversions.detailFilename"), v.filename || "—"],
      [t("admin.appversions.detailSize"), fmtBytes(v.size)],
      [t("admin.appversions.detailType"), v.mandatory ? t("admin.appversions.mandatory") : t("admin.appversions.optional")],
      [t("admin.appversions.detailReleased"), new Date(v.releasedAt).toLocaleString()],
      [t("admin.appversions.detailNotes"), v.notes || "—"],
      [t("admin.appversions.detailSha"), v.sha256 || "—"],
      [t("admin.appversions.detailReleaseUrl"), v.releaseUrl || "—"]
    ];
    body.innerHTML = rows.map(([label, value]) => `
      <div class="adm-logs-detail-row">
        <span>${escapeHtml(label)}</span>
        <span>${escapeHtml(value)}</span>
      </div>
    `).join("");
    AdminUI.openModal({ title: t("admin.appversions.versionDetailTitle", { version: escapeHtml(v.version) }), bodyNode: body, wide: true });
  }

  // ---------- edit version (notes/mandatory only) ----------
  function openEditModal(v) {
    const bodyNode = el.editTemplate.content.firstElementChild.cloneNode(true);

    const fMandatory = bodyNode.querySelector("#avEditMandatory");
    const fNotes = bodyNode.querySelector("#avEditNotes");
    const fFile = bodyNode.querySelector("#avEditFile");
    const submitBtn = bodyNode.querySelector("#avEditSubmit");

    fMandatory.value = v.mandatory ? "true" : "false";
    fNotes.value = v.notes || "";

    AdminUI.openModal({ title: t("admin.appversions.editTitle", { version: v.version }), bodyNode, wide: true });

    bodyNode.querySelector("#avEditCancel").addEventListener("click", () => AdminUI.closeModal());

    bodyNode.addEventListener("submit", async (e) => {
      e.preventDefault();

      const file = fFile.files?.[0];
      const url = `${API_BASE}/api/app/versions/${encodeURIComponent(v.version)}?app=${encodeURIComponent(APP_NAME)}`;

      submitBtn.disabled = true;
      submitBtn.textContent = file ? t("admin.appversions.uploading") : t("admin.appversions.saving");

      try {
        let res;
        if (file) {
          const fd = new FormData();
          fd.append("notes", fNotes.value.trim());
          fd.append("mandatory", fMandatory.value);
          fd.append("file", file);
          res = await fetch(url, {
            method: "PUT",
            headers: authHeaders(), // no Content-Type — browser sets multipart boundary
            body: fd
          });
        } else {
          res = await fetch(url, {
            method: "PUT",
            headers: { ...authHeaders(), "Content-Type": "application/json" },
            body: JSON.stringify({ notes: fNotes.value.trim(), mandatory: fMandatory.value === "true" })
          });
        }

        const data = await res.json();
        if (!res.ok || !data.ok) {
          AdminUI.toast(data.message || t("admin.appversions.updateFailed"), "error");
          submitBtn.disabled = false;
          submitBtn.textContent = t("admin.appversions.saveChanges");
          return;
        }

        AdminUI.closeModal();
        await Promise.all([loadCurrentVersion(), loadHistory()]);
        AdminUI.toast(data.fileReplaced ? t("admin.appversions.updatedFileReplaced") : t("admin.appversions.updated"), "success");
      } catch (err) {
        console.error("edit version failed:", err);
        AdminUI.toast(t("admin.appversions.couldNotReachServer"), "error");
        submitBtn.disabled = false;
        submitBtn.textContent = t("admin.appversions.saveChanges");
      }
    });
  }

  // ---------- delete a single version ----------
  async function deleteVersion(v) {
    const ok = await AdminUI.confirm({
      title: t("admin.appversions.deleteVersionTitle", { version: escapeHtml(v.version) }),
      message: t("admin.appversions.deleteVersionMessage", { version: escapeHtml(v.version) }),
      confirmLabel: t("admin.appversions.delete"),
      danger: true
    });
    if (!ok) return;

    try {
      const res = await fetch(`${API_BASE}/api/app/versions/${encodeURIComponent(v.version)}?app=${encodeURIComponent(APP_NAME)}`, {
        method: "DELETE",
        headers: authHeaders()
      });
      const data = await res.json();
      if (!res.ok || !data.ok) return AdminUI.toast(data.message || t("admin.appversions.deleteFailed"), "error");

      await Promise.all([loadCurrentVersion(), loadHistory()]);
      AdminUI.toast(t("admin.appversions.versionDeleted", { version: v.version }), "success");
    } catch (e) {
      console.error("delete version failed:", e);
      AdminUI.toast(t("admin.appversions.deleteFailedServer"), "error");
    }
  }

  // ---------- upload new version ----------
  function openUploadModal() {
    const bodyNode = el.uploadTemplate.content.firstElementChild.cloneNode(true);

    const fVersion = bodyNode.querySelector("#avFormVersion");
    const fMandatory = bodyNode.querySelector("#avFormMandatory");
    const fNotes = bodyNode.querySelector("#avFormNotes");
    const fFile = bodyNode.querySelector("#avFormFile");
    const statusEl = bodyNode.querySelector("#avUploadStatus");
    const submitBtn = bodyNode.querySelector("#avFormSubmit");

    AdminUI.openModal({ title: t("admin.appversions.uploadModalTitle"), bodyNode, wide: true });

    bodyNode.querySelector("#avFormCancel").addEventListener("click", () => AdminUI.closeModal());

    bodyNode.addEventListener("submit", async (e) => {
      e.preventDefault();

      const version = fVersion.value.trim();
      const file = fFile.files?.[0];

      if (!version) return AdminUI.toast(t("admin.appversions.enterVersionNumber"), "error");
      if (!file) return AdminUI.toast(t("admin.appversions.selectWorkbookFile"), "error");

      const fd = new FormData();
      fd.append("app", APP_NAME);
      fd.append("version", version);
      fd.append("notes", fNotes.value.trim());
      fd.append("mandatory", fMandatory.value);
      fd.append("file", file);

      submitBtn.disabled = true;
      submitBtn.textContent = t("admin.appversions.uploading");
      statusEl.hidden = false;
      statusEl.textContent = t("admin.appversions.uploadingNotice");

      try {
        const res = await fetch(`${API_BASE}/api/app/upload`, {
          method: "POST",
          headers: authHeaders(), // no Content-Type — browser sets multipart boundary
          body: fd
        });
        const data = await res.json();

        if (!res.ok || !data.ok) {
          statusEl.textContent = data.message || t("admin.appversions.uploadFailed");
          submitBtn.disabled = false;
          submitBtn.textContent = t("admin.appversions.upload");
          return;
        }

        AdminUI.closeModal();
        await Promise.all([loadCurrentVersion(), loadHistory()]);
        AdminUI.toast(t("admin.appversions.publishedNotified", { version }), "success");
      } catch (err) {
        console.error("upload failed:", err);
        statusEl.textContent = t("admin.appversions.uploadFailedServer");
        submitBtn.disabled = false;
        submitBtn.textContent = t("admin.appversions.upload");
      }
    });
  }

  el.btnUpload.addEventListener("click", openUploadModal);

  // ---------- cleanup ----------
  function openCleanupModal() {
    const body = document.createElement("div");
    body.innerHTML = `
      <p class="adm-modal-message">${t("admin.appversions.cleanupExplain")}</p>
      <label class="adm-cleanup-field">
        <span>${t("admin.appversions.keepRecentVersions")}</span>
        <input type="number" id="avKeepCount" value="3" min="1">
      </label>
      <div class="adm-modal-footer">
        <button type="button" class="adm-btn" id="avCleanupCancel">${t("admin.appversions.cancel")}</button>
        <button type="button" class="adm-btn adm-btn-danger" id="avCleanupConfirm">${t("admin.appversions.cleanupConfirm")}</button>
      </div>
    `;

    const { body: mountedBody } = AdminUI.openModal({ title: t("admin.appversions.cleanupModalTitle"), bodyNode: body });

    mountedBody.querySelector("#avCleanupCancel").addEventListener("click", () => AdminUI.closeModal());
    mountedBody.querySelector("#avCleanupConfirm").addEventListener("click", async () => {
      const keep = Number(mountedBody.querySelector("#avKeepCount").value || 3);

      try {
        const res = await fetch(`${API_BASE}/api/app/cleanup`, {
          method: "POST",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ app: APP_NAME, keep })
        });
        const data = await res.json();
        if (!res.ok || !data.ok) return AdminUI.toast(data.message || t("admin.appversions.cleanupFailed"), "error");

        AdminUI.closeModal();
        AdminUI.toast(t("admin.appversions.removedOldVersions", { count: data.deletedVersions }), "success");
        loadHistory();
      } catch (e) {
        console.error("cleanup failed:", e);
        AdminUI.toast(t("admin.appversions.cleanupFailedServer"), "error");
      }
    });
  }

  el.btnCleanup.addEventListener("click", openCleanupModal);

  // ---------- downloads kill switch ----------
  async function loadDownloadsToggle() {
    try {
      const res = await fetch(`${API_BASE}/api/app/downloads-enabled`, { headers: authHeaders() });
      const data = await res.json();
      if (!data.ok) throw new Error(data.message);
      setToggleUI(data.enabled);
    } catch (e) {
      console.error("loadDownloadsToggle failed:", e);
      // leave the toggle in its default "on" state, but don't block the rest of the page
    }
  }

  function setToggleUI(enabled) {
    el.downloadsToggle.setAttribute("aria-checked", String(enabled));
    el.downloadsToggle.classList.toggle("adm-toggle-on", enabled);
    el.downloadsToggleLabel.textContent = enabled ? t("admin.appversions.toggleOn") : t("admin.appversions.toggleOff");
  }

  el.downloadsToggle.addEventListener("click", async () => {
    const currentlyEnabled = el.downloadsToggle.getAttribute("aria-checked") === "true";
    const turningOff = currentlyEnabled;

    if (turningOff) {
      const ok = await AdminUI.confirm({
        title: t("admin.appversions.turnOffDownloadsTitle"),
        message: t("admin.appversions.turnOffDownloadsMessage"),
        confirmLabel: t("admin.appversions.turnOff"),
        danger: true
      });
      if (!ok) return;
    }

    const newValue = !currentlyEnabled;

    try {
      const res = await fetch(`${API_BASE}/api/admin/downloads-enabled`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: newValue })
      });
      const data = await res.json();
      if (!res.ok || !data.ok) return AdminUI.toast(data.message || t("admin.appversions.downloadsFailedUpdate"), "error");

      setToggleUI(data.enabled);
      AdminUI.toast(data.enabled ? t("admin.appversions.downloadsTurnedOn") : t("admin.appversions.downloadsTurnedOff"), "success");
    } catch (e) {
      console.error("toggle downloads failed:", e);
      AdminUI.toast(t("admin.appversions.couldNotReachServer"), "error");
    }
  });

  // ---------- init ----------
  async function init() {
    await loadCurrentVersion(); // must resolve first so renderTable() knows which row is "latest"
    loadHistory();
    loadDownloadsToggle();
  }

  document.readyState === "loading"
    ? document.addEventListener("DOMContentLoaded", init)
    : init();
})();
