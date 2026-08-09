/* =====================================================
   admin-wallpaper.js
   Shows the current wallpaper (public endpoint, so a plain <img>
   works — no auth needed there, unlike user photos), its last
   updated status, and lets an admin upload a replacement.
   ===================================================== */
(function () {
  if (!window.CMAdmin) return; // admin-loader.js already redirected away

  const API_BASE = (window.API && window.API.BASE_URL) || "";

  let selectedFile = null;

  const el = {
    currentImg: document.getElementById("wpCurrentImg"),
    statusLoading: document.getElementById("wpStatusLoading"),
    statusMeta: document.getElementById("wpStatusMeta"),
    statusError: document.getElementById("wpStatusError"),

    newPreviewBox: document.getElementById("wpNewPreviewBox"),
    newPlaceholder: document.getElementById("wpNewPlaceholder"),
    newImg: document.getElementById("wpNewImg"),
    btnSelect: document.getElementById("wpBtnSelect"),
    fileInput: document.getElementById("wpFileInput"),
    uploadStatus: document.getElementById("wpUploadStatus"),
    btnUpload: document.getElementById("wpBtnUpload")
  };

  function authHeaders() {
    return { Authorization: `Bearer ${window.CMAdmin.token}` };
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

  // ---------- current wallpaper + status ----------
  function loadCurrentImage() {
    // /assets/wallpaper is a PUBLIC endpoint (no auth needed), so a plain
    // <img src> works fine here — unlike the user-photo endpoints, which
    // require fetch()+blob because they're behind requireJwt.
    el.currentImg.src = `${API_BASE}/assets/wallpaper?t=${Date.now()}`;
  }

  async function loadStatus() {
    try {
      const res = await fetch(`${API_BASE}/api/wallpaper/status`, { headers: authHeaders() });
      const data = await res.json();

      el.statusLoading.hidden = true;

      if (!data.ok) {
        el.statusError.hidden = false;
        el.statusError.textContent = data.message || "Could not load wallpaper status.";
        return;
      }

      el.statusMeta.hidden = false;
      el.statusMeta.textContent = `Last updated ${timeAgo(data.updatedAt)}${data.updatedBy ? ` by ${data.updatedBy}` : ""} · ${data.path}`;
    } catch (e) {
      console.error("loadStatus failed:", e);
      el.statusLoading.hidden = true;
      el.statusError.hidden = false;
      el.statusError.textContent = "Could not reach the server.";
    }
  }

  // ---------- select new file ----------
  el.btnSelect.addEventListener("click", () => el.fileInput.click());

  el.fileInput.addEventListener("change", () => {
    const file = el.fileInput.files?.[0];
    if (!file) return;

    selectedFile = file;
    const objectUrl = URL.createObjectURL(file);
    el.newImg.src = objectUrl;
    el.newImg.hidden = false;
    el.newPlaceholder.hidden = true;
    el.btnUpload.disabled = false;
  });

  // ---------- upload ----------
  el.btnUpload.addEventListener("click", async () => {
    if (!selectedFile) return;

    el.btnUpload.disabled = true;
    el.btnUpload.textContent = "Uploading…";
    el.uploadStatus.hidden = false;
    el.uploadStatus.textContent = "Uploading to GitHub — please wait.";

    const fd = new FormData();
    fd.append("file", selectedFile);

    try {
      const res = await fetch(`${API_BASE}/api/wallpaper/upload`, {
        method: "POST",
        headers: authHeaders(), // no Content-Type — browser sets multipart boundary
        body: fd
      });
      const data = await res.json();

      if (!res.ok || !data.ok) {
        el.uploadStatus.textContent = data.message || "Upload failed.";
        el.btnUpload.disabled = false;
        el.btnUpload.textContent = "Upload & Replace";
        return;
      }

      AdminUI.toast("Wallpaper updated.", "success");
      el.uploadStatus.hidden = true;
      el.btnUpload.textContent = "Upload & Replace";
      el.btnUpload.disabled = true;

      // reset the "new file" preview and refresh the current image + status
      selectedFile = null;
      el.fileInput.value = "";
      el.newImg.hidden = true;
      el.newPlaceholder.hidden = false;

      loadCurrentImage();
      loadStatus();
    } catch (e) {
      console.error("wallpaper upload failed:", e);
      el.uploadStatus.textContent = "Upload failed — could not reach the server.";
      el.btnUpload.disabled = false;
      el.btnUpload.textContent = "Upload & Replace";
    }
  });

  // ---------- init ----------
  function init() {
    loadCurrentImage();
    loadStatus();
  }

  document.readyState === "loading"
    ? document.addEventListener("DOMContentLoaded", init)
    : init();
})();
