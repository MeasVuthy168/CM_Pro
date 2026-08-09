/* =====================================================
   admin-users.js
   Table-first User Management: click a row's action icons to
   edit/reset/delete, "+ Add User" opens a modal. Mirrors the
   VBA UserForm's validation and staged-photo behavior, just
   presented as a modal instead of an always-open side panel.
   ===================================================== */
(function () {
  if (!window.CMAdmin) return; // admin-loader.js already redirected away

  const API_BASE = (window.API && window.API.BASE_URL) || "";
  const BRANCH_ROLES = new Set(["viewer_manager_a", "viewer_manager_b", "viewer_manager_c"]);

  const state = {
    users: [],
    photoFile: null,     // staged File object for the currently open modal
    removePhoto: false,
    photoObjectUrl: null
  };

  const el = {
    search: document.getElementById("ufSearch"),
    searchRole: document.getElementById("ufSearchRole"),
    searchStatus: document.getElementById("ufSearchStatus"),
    btnShowAll: document.getElementById("ufBtnShowAll"),
    btnAddUser: document.getElementById("ufBtnAddUser"),

    tableBody: document.getElementById("admUsersTableBody"),
    tableEmpty: document.getElementById("admUsersTableEmpty"),

    formTemplate: document.getElementById("ufFormTemplate")
  };

  function authHeaders() {
    return { Authorization: `Bearer ${window.CMAdmin.token}` };
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  const ROLE_LABELS = {
    admin: "Admin", user: "User", viewer: "Viewer",
    viewer_staff: "Viewer_Staff",
    viewer_manager_a: "Viewer_Manager_A",
    viewer_manager_b: "Viewer_Manager_B",
    viewer_manager_c: "Viewer_Manager_C"
  };

  function roleBadgeClass(role) {
    if (role === "admin") return "adm-badge-role-admin";
    if (role === "viewer_staff") return "adm-badge-role-viewer_staff";
    if (BRANCH_ROLES.has(role)) return "adm-badge-role-manager";
    return "adm-badge-role-user";
  }

  function initials(fullname, username) {
    const src = (fullname || username || "?").trim();
    const parts = src.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return src.slice(0, 2).toUpperCase();
  }

  // ---------- table rendering ----------
  function renderTable(users) {
    el.tableBody.innerHTML = "";

    if (!users.length) {
      el.tableEmpty.hidden = false;
      return;
    }
    el.tableEmpty.hidden = true;

    users.forEach((u) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>
          <div class="adm-user-identity">
            <div class="adm-avatar">${escapeHtml(initials(u.fullname, u.username))}</div>
            <div class="adm-user-identity-text">
              <span class="adm-user-identity-name">${escapeHtml(u.fullname || u.username)}</span>
              <span class="adm-user-identity-username">@${escapeHtml(u.username)}</span>
            </div>
          </div>
        </td>
        <td><span class="adm-badge ${roleBadgeClass(u.role)}">${escapeHtml(ROLE_LABELS[u.role] || u.role)}</span></td>
        <td><span class="adm-badge ${u.isActive ? "adm-badge-status-active" : "adm-badge-status-inactive"}">${u.isActive ? "Active" : "Inactive"}</span></td>
        <td>${escapeHtml(u.phone || "—")}</td>
        <td>${escapeHtml(u.branch || "—")}</td>
        <td>
          <div class="adm-row-actions">
            <button type="button" class="adm-icon-btn" title="Edit" data-action="edit">✏️</button>
            <button type="button" class="adm-icon-btn" title="Reset Password" data-action="reset">🔑</button>
            <button type="button" class="adm-icon-btn adm-icon-btn-danger" title="Delete" data-action="delete">🗑️</button>
          </div>
        </td>
      `;

      tr.querySelector('[data-action="edit"]').addEventListener("click", () => openUserModal(u));
      tr.querySelector('[data-action="reset"]').addEventListener("click", () => resetPassword(u.username));
      tr.querySelector('[data-action="delete"]').addEventListener("click", () => deleteUser(u.username));

      el.tableBody.appendChild(tr);
    });
  }

  // ---------- load users ----------
  async function loadUsers(filters = {}) {
    try {
      const params = new URLSearchParams();
      if (filters.search) params.set("search", filters.search);
      if (filters.role) params.set("role", filters.role);
      if (filters.status) params.set("status", filters.status);

      const res = await fetch(`${API_BASE}/api/admin/users?${params.toString()}`, { headers: authHeaders() });

      if (res.status === 401 || res.status === 403) {
        location.replace(window.CM_ADMIN_CONFIG.loginPage);
        return;
      }

      const data = await res.json();
      if (!data.ok) throw new Error(data.message || "Failed to load users");

      state.users = data.users || [];
      renderTable(state.users);
    } catch (e) {
      console.error("loadUsers failed:", e);
      AdminUI.toast("Could not load user list.", "error");
    }
  }

  el.btnShowAll.addEventListener("click", () => {
    el.search.value = "";
    el.searchRole.value = "all";
    el.searchStatus.value = "all";
    loadUsers();
  });

  function runSearch() {
    loadUsers({
      search: el.search.value.trim(),
      role: el.searchRole.value,
      status: el.searchStatus.value
    });
  }
  el.search.addEventListener("keydown", (e) => { if (e.key === "Enter") runSearch(); });
  el.searchRole.addEventListener("change", runSearch);
  el.searchStatus.addEventListener("change", runSearch);

  let searchDebounce;
  el.search.addEventListener("input", () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(runSearch, 350);
  });

  // ---------- photo staging (inside whichever modal is open) ----------
  function resetPhotoPreview(scope) {
    if (state.photoObjectUrl) {
      URL.revokeObjectURL(state.photoObjectUrl);
      state.photoObjectUrl = null;
    }
    const img = scope.querySelector("#ufPhotoImg");
    const placeholder = scope.querySelector("#ufPhotoPlaceholder");
    const input = scope.querySelector("#ufPhotoInput");
    img.hidden = true;
    img.src = "";
    placeholder.hidden = false;
    input.value = "";

    state.photoFile = null;
    state.removePhoto = false;
  }

  function showPhotoBlob(scope, blob) {
    if (state.photoObjectUrl) URL.revokeObjectURL(state.photoObjectUrl);
    state.photoObjectUrl = URL.createObjectURL(blob);
    const img = scope.querySelector("#ufPhotoImg");
    const placeholder = scope.querySelector("#ufPhotoPlaceholder");
    img.src = state.photoObjectUrl;
    img.hidden = false;
    placeholder.hidden = true;
  }

  async function loadUserPhoto(scope, username) {
    try {
      const res = await fetch(`${API_BASE}/assets/user-photo/${encodeURIComponent(username)}`, { headers: authHeaders() });
      if (!res.ok) { resetPhotoPreview(scope); return; }
      showPhotoBlob(scope, await res.blob());
    } catch (e) {
      resetPhotoPreview(scope);
    }
  }

  async function commitPhotoChanges(username) {
    if (state.removePhoto) {
      await fetch(`${API_BASE}/api/users/photo/${encodeURIComponent(username)}`, {
        method: "DELETE",
        headers: authHeaders()
      }).catch(() => {});
      return;
    }
    if (state.photoFile) {
      const fd = new FormData();
      fd.append("username", username);
      fd.append("file", state.photoFile);
      const res = await fetch(`${API_BASE}/api/users/photo/upload`, {
        method: "POST",
        headers: authHeaders(),
        body: fd
      });
      if (!res.ok) AdminUI.toast("User saved, but photo upload failed.", "error");
    }
  }

  // ---------- Add / Edit modal ----------
  function openUserModal(existingUser) {
    const isEdit = !!existingUser;
    const bodyNode = el.formTemplate.content.firstElementChild.cloneNode(true);

    const fUsername = bodyNode.querySelector("#ufUsername");
    const fFullname = bodyNode.querySelector("#ufFullName");
    const fRole = bodyNode.querySelector("#ufRole");
    const fBranchField = bodyNode.querySelector("#ufBranchField");
    const fBranch = bodyNode.querySelector("#ufBranch");
    const fStatus = bodyNode.querySelector("#ufStatus");
    const fPhone = bodyNode.querySelector("#ufPhone");
    const fFooter = bodyNode.querySelector("#ufFormFooter");
    const btnSelectPhoto = bodyNode.querySelector("#ufBtnSelectPhoto");
    const btnRemovePhoto = bodyNode.querySelector("#ufBtnRemovePhoto");
    const photoInput = bodyNode.querySelector("#ufPhotoInput");

    function updateBranchVisibility() {
      const needsBranch = BRANCH_ROLES.has(fRole.value);
      fBranchField.hidden = !needsBranch;
      if (!needsBranch) fBranch.value = "";
    }
    fRole.addEventListener("change", updateBranchVisibility);

    btnSelectPhoto.addEventListener("click", () => photoInput.click());
    photoInput.addEventListener("change", () => {
      const file = photoInput.files?.[0];
      if (!file) return;
      state.photoFile = file;
      state.removePhoto = false;
      showPhotoBlob(bodyNode, file);
    });
    btnRemovePhoto.addEventListener("click", () => {
      resetPhotoPreview(bodyNode);
      state.removePhoto = true;
    });

    if (isEdit) {
      fUsername.value = existingUser.username;
      fUsername.disabled = true;
      fFullname.value = existingUser.fullname;
      fRole.value = existingUser.role;
      fStatus.value = existingUser.isActive ? "active" : "inactive";
      fPhone.value = existingUser.phone;
      updateBranchVisibility();
      fBranch.value = existingUser.branch || "";
      loadUserPhoto(bodyNode, existingUser.username);
    } else {
      fRole.value = "user";
      updateBranchVisibility();
    }

    fFooter.innerHTML = `
      <button type="button" class="adm-btn" id="ufBtnCancel">Cancel</button>
      <button type="submit" class="adm-btn adm-btn-primary" id="ufBtnSave">${isEdit ? "Save Changes" : "Add User"}</button>
    `;

    AdminUI.openModal({
      title: isEdit ? "Edit User" : "Add User",
      bodyNode,
      wide: true,
      onClose: () => {
        if (state.photoObjectUrl) { URL.revokeObjectURL(state.photoObjectUrl); state.photoObjectUrl = null; }
        state.photoFile = null;
        state.removePhoto = false;
      }
    });

    bodyNode.querySelector("#ufBtnCancel").addEventListener("click", () => AdminUI.closeModal());

    bodyNode.addEventListener("submit", async (e) => {
      e.preventDefault();

      const username = fUsername.value.trim();
      const fullname = fFullname.value.trim();
      const role = fRole.value;
      const branch = BRANCH_ROLES.has(role) ? fBranch.value.trim() : "";

      if (!username) return AdminUI.toast("Enter username.", "error");
      if (!fullname) return AdminUI.toast("Enter full name.", "error");
      if (BRANCH_ROLES.has(role) && !branch) return AdminUI.toast("Please select a Branch for this role.", "error");

      const body = { fullname, role, phone: fPhone.value.trim(), branch };

      try {
        if (isEdit) {
          body.isActive = fStatus.value === "active";
          const res = await fetch(`${API_BASE}/api/admin/users/${encodeURIComponent(username)}`, {
            method: "PUT",
            headers: { ...authHeaders(), "Content-Type": "application/json" },
            body: JSON.stringify(body)
          });
          const data = await res.json();
          if (!res.ok || !data.ok) return AdminUI.toast(data.message || "Edit user failed.", "error");

          await commitPhotoChanges(username);
          AdminUI.closeModal();
          await loadUsers();
          AdminUI.toast("User updated.", "success");
        } else {
          const newPass = await AdminUI.prompt({
            title: "Set Password",
            label: "Password for new user",
            defaultValue: "123456"
          });
          if (!newPass) return;

          const res = await fetch(`${API_BASE}/api/admin/users`, {
            method: "POST",
            headers: { ...authHeaders(), "Content-Type": "application/json" },
            body: JSON.stringify({ username, password: newPass, ...body })
          });
          const data = await res.json();
          if (!res.ok || !data.ok) return AdminUI.toast(data.message || "Add user failed.", "error");

          await commitPhotoChanges(username);
          AdminUI.closeModal();
          await loadUsers();
          AdminUI.toast("User added successfully.", "success");
        }
      } catch (err) {
        console.error("Save user error:", err);
        AdminUI.toast("Could not reach the server.", "error");
      }
    });
  }

  el.btnAddUser.addEventListener("click", () => openUserModal(null));

  // ---------- delete ----------
  async function deleteUser(username) {
    const ok = await AdminUI.confirm({
      title: "Delete user?",
      message: `This permanently deletes <strong>${escapeHtml(username)}</strong>. This can't be undone.`,
      confirmLabel: "Delete",
      danger: true
    });
    if (!ok) return;

    try {
      const res = await fetch(`${API_BASE}/api/admin/users/${encodeURIComponent(username)}`, {
        method: "DELETE",
        headers: authHeaders()
      });
      const data = await res.json();
      if (!res.ok || !data.ok) return AdminUI.toast(data.message || "Delete failed.", "error");

      await loadUsers();
      AdminUI.toast("User deleted.", "success");
    } catch (e) {
      console.error("Delete user error:", e);
      AdminUI.toast("Delete failed — could not reach the server.", "error");
    }
  }

  // ---------- reset password ----------
  async function resetPassword(username) {
    const newPass = await AdminUI.prompt({
      title: "Reset Password",
      message: `New password for <strong>${escapeHtml(username)}</strong>`,
      placeholder: "New password"
    });
    if (!newPass) return;

    try {
      const res = await fetch(`${API_BASE}/api/admin/users/${encodeURIComponent(username)}/reset-password`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword: newPass })
      });
      const data = await res.json();
      if (!res.ok || !data.ok) return AdminUI.toast(data.message || "Reset password failed.", "error");

      AdminUI.toast("Password reset successful.", "success");
    } catch (e) {
      console.error("Reset password error:", e);
      AdminUI.toast("Reset password failed — could not reach the server.", "error");
    }
  }

  // ---------- init ----------
  function init() {
    loadUsers();
  }

  document.readyState === "loading"
    ? document.addEventListener("DOMContentLoaded", init)
    : init();
})();
