/* =====================================================
   admin-users.js
   Mirrors modAdminUserPhoto + the VBA UserForm button handlers:
   click a row to load it into the form, staged photo changes only
   commit on Save (Add/Edit), branch field only shows for
   Viewer_Manager_A/B/C, same validation order as the VBA.
   ===================================================== */
(function () {
  if (!window.CMAdmin) return; // admin-loader.js already redirected away

  const API_BASE = (window.API && window.API.BASE_URL) || "";
  const BRANCH_ROLES = new Set(["viewer_manager_a", "viewer_manager_b", "viewer_manager_c"]);

  const state = {
    users: [],
    selectedUsername: null, // null = "new user" context, like VBA's cleared form
    photoFile: null,        // staged File object (mPhotoChanged equivalent)
    removePhoto: false,     // mRemovePhoto equivalent
    photoObjectUrl: null    // for cleanup between previews
  };

  const el = {
    username: document.getElementById("ufUsername"),
    fullname: document.getElementById("ufFullName"),
    role: document.getElementById("ufRole"),
    branchField: document.getElementById("ufBranchField"),
    branch: document.getElementById("ufBranch"),
    status: document.getElementById("ufStatus"),
    phone: document.getElementById("ufPhone"),

    photoPreview: document.getElementById("ufPhotoPreview"),
    photoPlaceholder: document.getElementById("ufPhotoPlaceholder"),
    photoImg: document.getElementById("ufPhotoImg"),
    photoInput: document.getElementById("ufPhotoInput"),
    btnSelectPhoto: document.getElementById("ufBtnSelectPhoto"),
    btnRemovePhoto: document.getElementById("ufBtnRemovePhoto"),

    btnAdd: document.getElementById("ufBtnAdd"),
    btnEdit: document.getElementById("ufBtnEdit"),
    btnClear: document.getElementById("ufBtnClear"),
    btnDelete: document.getElementById("ufBtnDelete"),
    btnResetPassword: document.getElementById("ufBtnResetPassword"),

    search: document.getElementById("ufSearch"),
    searchRole: document.getElementById("ufSearchRole"),
    searchStatus: document.getElementById("ufSearchStatus"),
    btnSearch: document.getElementById("ufBtnSearch"),
    btnShowAll: document.getElementById("ufBtnShowAll"),

    tableBody: document.getElementById("admUsersTableBody"),
    tableEmpty: document.getElementById("admUsersTableEmpty"),
    userCount: document.getElementById("admUserCount"),

    errorBanner: document.getElementById("admUsersError"),
    successBanner: document.getElementById("admUsersSuccess")
  };

  function authHeaders() {
    return { Authorization: `Bearer ${window.CMAdmin.token}` };
  }

  function showError(msg) {
    el.errorBanner.textContent = msg;
    el.errorBanner.hidden = !msg;
    if (msg) el.successBanner.hidden = true;
  }

  function showSuccess(msg) {
    el.successBanner.textContent = msg;
    el.successBanner.hidden = !msg;
    if (msg) el.errorBanner.hidden = true;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  function roleLabel(role) {
    const map = {
      admin: "Admin", user: "User", viewer: "Viewer",
      viewer_staff: "Viewer_Staff",
      viewer_manager_a: "Viewer_Manager_A",
      viewer_manager_b: "Viewer_Manager_B",
      viewer_manager_c: "Viewer_Manager_C"
    };
    return map[role] || role;
  }

  // ---------- branch field visibility ----------
  function updateBranchVisibility() {
    const needsBranch = BRANCH_ROLES.has(el.role.value);
    el.branchField.hidden = !needsBranch;
    if (!needsBranch) el.branch.value = "";
  }
  el.role.addEventListener("change", updateBranchVisibility);

  // ---------- photo preview helpers ----------
  function resetPhotoPreview() {
    if (state.photoObjectUrl) {
      URL.revokeObjectURL(state.photoObjectUrl);
      state.photoObjectUrl = null;
    }
    el.photoImg.hidden = true;
    el.photoImg.src = "";
    el.photoPlaceholder.hidden = false;
    el.photoInput.value = "";

    state.photoFile = null;
    state.removePhoto = false;
  }

  function showPhotoBlob(blob) {
    if (state.photoObjectUrl) URL.revokeObjectURL(state.photoObjectUrl);
    state.photoObjectUrl = URL.createObjectURL(blob);
    el.photoImg.src = state.photoObjectUrl;
    el.photoImg.hidden = false;
    el.photoPlaceholder.hidden = true;
  }

  async function loadUserPhoto(username) {
    try {
      const res = await fetch(`${API_BASE}/assets/user-photo/${encodeURIComponent(username)}`, {
        headers: authHeaders()
      });
      if (!res.ok) { resetPhotoPreview(); return; }
      const blob = await res.blob();
      showPhotoBlob(blob);
    } catch (e) {
      resetPhotoPreview();
    }
  }

  el.btnSelectPhoto.addEventListener("click", () => el.photoInput.click());

  el.photoInput.addEventListener("change", () => {
    const file = el.photoInput.files?.[0];
    if (!file) return;
    state.photoFile = file;
    state.removePhoto = false;
    showPhotoBlob(file);
  });

  el.btnRemovePhoto.addEventListener("click", () => {
    resetPhotoPreview();
    state.removePhoto = true; // set back after reset clears it, same as VBA's btnRemoveUserPhoto_Click
  });

  // ---------- form clear ----------
  function clearForm() {
    el.username.value = "";
    el.username.disabled = false;
    el.fullname.value = "";
    el.role.value = "user";
    el.status.value = "active";
    el.phone.value = "";
    el.branch.value = "";
    updateBranchVisibility();
    resetPhotoPreview();
    state.selectedUsername = null;
    showError("");
    showSuccess("");
  }

  el.btnClear.addEventListener("click", () => {
    clearForm();
  });

  // ---------- row click -> populate form ----------
  function selectUserRow(u) {
    el.username.value = u.username;
    el.username.disabled = true; // username isn't editable once created
    el.fullname.value = u.fullname;
    el.role.value = u.role;
    el.status.value = u.isActive ? "active" : "inactive";
    el.phone.value = u.phone;
    updateBranchVisibility();
    el.branch.value = u.branch || "";

    state.selectedUsername = u.username;
    state.photoFile = null;
    state.removePhoto = false;
    el.photoInput.value = "";

    loadUserPhoto(u.username);
    showError("");
    showSuccess("");
  }

  // ---------- render table ----------
  function renderTable(users) {
    el.userCount.textContent = users.length;
    el.tableBody.innerHTML = "";

    if (!users.length) {
      el.tableEmpty.hidden = false;
      return;
    }
    el.tableEmpty.hidden = true;

    users.forEach((u) => {
      const tr = document.createElement("tr");
      tr.className = "adm-users-row";
      tr.innerHTML = `
        <td>${escapeHtml(u.username)}</td>
        <td>${escapeHtml(u.fullname)}</td>
        <td>${escapeHtml(roleLabel(u.role))}</td>
        <td>${u.isActive ? "Active" : "Inactive"}</td>
        <td>${escapeHtml(u.phone)}</td>
        <td>${escapeHtml(u.branch || "")}</td>
      `;
      tr.addEventListener("click", () => selectUserRow(u));
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

      const res = await fetch(`${API_BASE}/api/admin/users?${params.toString()}`, {
        headers: authHeaders()
      });

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
      showError("Could not load user list.");
    }
  }

  el.btnShowAll.addEventListener("click", () => {
    el.search.value = "";
    el.searchRole.value = "all";
    el.searchStatus.value = "all";
    loadUsers();
  });

  el.btnSearch.addEventListener("click", () => {
    loadUsers({
      search: el.search.value.trim(),
      role: el.searchRole.value,
      status: el.searchStatus.value
    });
  });

  // ---------- validation ----------
  function validateBranch() {
    if (BRANCH_ROLES.has(el.role.value) && !el.branch.value.trim()) {
      showError("Please select a Branch for this role.");
      return false;
    }
    return true;
  }

  function currentBody() {
    return {
      fullname: el.fullname.value.trim(),
      role: el.role.value,
      phone: el.phone.value.trim(),
      branch: BRANCH_ROLES.has(el.role.value) ? el.branch.value.trim() : ""
    };
  }

  // ---------- staged photo commit (after add/edit succeeds) ----------
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
        headers: authHeaders(), // no Content-Type — browser sets multipart boundary
        body: fd
      });
      if (!res.ok) {
        showError("User saved, but photo upload failed.");
      }
    }
  }

  // ---------- Add User ----------
  el.btnAdd.addEventListener("click", async () => {
    const username = el.username.value.trim();
    const fullname = el.fullname.value.trim();
    const role = el.role.value;

    if (!username) return showError("Enter username.");
    if (!fullname) return showError("Enter full name.");
    if (!role) return showError("Select role.");
    if (!validateBranch()) return;

    const newPass = window.prompt("Enter password for new user:", "123456");
    if (!newPass || !newPass.trim()) return;

    try {
      const res = await fetch(`${API_BASE}/api/admin/users`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ username, password: newPass.trim(), ...currentBody() })
      });
      const data = await res.json();

      if (!res.ok || !data.ok) {
        return showError(data.message || "Add user failed.");
      }

      await commitPhotoChanges(username);
      await loadUsers();
      clearForm();
      showSuccess("User added successfully.");
    } catch (e) {
      console.error("Add user error:", e);
      showError("Add user failed — could not reach the server.");
    }
  });

  // ---------- Edit User ----------
  el.btnEdit.addEventListener("click", async () => {
    const username = state.selectedUsername;
    if (!username) return showError("Select user first.");
    if (!validateBranch()) return;

    try {
      const res = await fetch(`${API_BASE}/api/admin/users/${encodeURIComponent(username)}`, {
        method: "PUT",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          ...currentBody(),
          isActive: el.status.value === "active"
        })
      });
      const data = await res.json();

      if (!res.ok || !data.ok) {
        return showError(data.message || "Edit user failed.");
      }

      await commitPhotoChanges(username);
      await loadUsers();
      resetPhotoPreview(); // matches VBA: edit doesn't clear the whole form, just the photo state
      showSuccess("User updated.");
    } catch (e) {
      console.error("Edit user error:", e);
      showError("Edit user failed — could not reach the server.");
    }
  });

  // ---------- Delete User ----------
  el.btnDelete.addEventListener("click", async () => {
    const username = state.selectedUsername;
    if (!username) return showError("Select user first.");
    if (!confirm(`Delete user ${username} ?`)) return;

    try {
      const res = await fetch(`${API_BASE}/api/admin/users/${encodeURIComponent(username)}`, {
        method: "DELETE",
        headers: authHeaders()
      });
      const data = await res.json();

      if (!res.ok || !data.ok) {
        return showError(data.message || "Delete failed.");
      }

      await loadUsers();
      clearForm();
      showSuccess("User deleted.");
    } catch (e) {
      console.error("Delete user error:", e);
      showError("Delete failed — could not reach the server.");
    }
  });

  // ---------- Reset Password ----------
  el.btnResetPassword.addEventListener("click", async () => {
    const username = state.selectedUsername;
    if (!username) return showError("Select user first.");

    const newPass = window.prompt("Enter new password");
    if (!newPass) return;

    try {
      const res = await fetch(`${API_BASE}/api/admin/users/${encodeURIComponent(username)}/reset-password`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword: newPass })
      });
      const data = await res.json();

      if (!res.ok || !data.ok) {
        return showError(data.message || "Reset password failed.");
      }

      showSuccess("Password reset successful.");
    } catch (e) {
      console.error("Reset password error:", e);
      showError("Reset password failed — could not reach the server.");
    }
  });

  // ---------- init ----------
  function init() {
    updateBranchVisibility();
    loadUsers();
  }

  document.readyState === "loading"
    ? document.addEventListener("DOMContentLoaded", init)
    : init();
})();
