/* =====================================================
   admin-users.js
   User Management: summary tiles, search + role / status filters
   and sort (all client-side — the list is loaded once), one card per
   account (tap to edit; reset password / delete icons), "+ Add User"
   opens a modal. The form explains what the chosen role can do. Mirrors the
   VBA UserForm's validation and staged-photo behavior, just
   presented as a modal instead of an always-open side panel.
   ===================================================== */
(function () {
  if (!window.CMAdmin) return; // admin-loader.js already redirected away

  const API_BASE = (window.API && window.API.BASE_URL) || "";
  const BRANCH_ROLES = new Set(["viewer_manager_a", "viewer_manager_b", "viewer_manager_c"]);
  const t = (key, vars) => (window.CMI18n ? CMI18n.t(key, vars) : key);

  // Roles in display order. A User account may also carry a branch:
  // it only decides which branch's Smart Alerts / officer reminders
  // they receive (their data access stays unrestricted).
  const ROLES = ["admin", "user", "viewer_manager_a", "viewer_manager_b", "viewer_manager_c", "viewer_staff"];
  const OPTIONAL_BRANCH_ROLES = new Set(["user"]);

  const state = {
    users: [],
    role: "all",       // role chip / stat tile
    status: "all",     // all | active | inactive
    sort: "name",
    photoFile: null,     // staged File object for the currently open modal
    removePhoto: false,
    photoObjectUrl: null
  };

  const el = {
    search: document.getElementById("ufSearch"),
    searchClear: document.getElementById("umSearchClear"),
    roleChips: document.getElementById("umRoleChips"),
    statusSeg: document.getElementById("umStatusSeg"),
    sort: document.getElementById("umSort"),
    count: document.getElementById("umCount"),
    stats: document.getElementById("umStats"),
    btnRoles: document.getElementById("umBtnRoles"),
    btnShowAll: document.getElementById("ufBtnShowAll"),
    btnAddUser: document.getElementById("ufBtnAddUser"),

    list: document.getElementById("umList"),
    tableEmpty: document.getElementById("admUsersTableEmpty"),

    formTemplate: document.getElementById("ufFormTemplate")
  };

  function authHeaders() {
    return { Authorization: `Bearer ${window.CMAdmin.token}` };
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  function roleLabel(role) {
    const KEYS = {
      admin: "admin.users.roleAdmin",
      user: "admin.users.roleUser",
      viewer_staff: "admin.users.roleViewerStaff",
      viewer_manager_a: "admin.users.roleViewerManagerA",
      viewer_manager_b: "admin.users.roleViewerManagerB",
      viewer_manager_c: "admin.users.roleViewerManagerC"
    };
    return KEYS[role] ? t(KEYS[role]) : role;
  }

  function roleDesc(role) {
    return t(`admin.users.roleDesc.${role}`);
  }

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

  function lastLoginLabel(v) {
    if (!v) return t("admin.users.neverLoggedIn");
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return "—";
    const days = Math.floor((Date.now() - d.getTime()) / 86400000);
    if (days <= 0) return t("admin.users.loginToday");
    if (days === 1) return t("admin.users.loginYesterday");
    if (days < 30) return t("admin.users.loginDaysAgo", { n: days });
    return d.toISOString().slice(0, 10);
  }

  // ---------- filtering (client-side: the whole list is loaded once) ----------
  function matchesSearch(u, q) {
    if (!q) return true;
    return [u.username, u.fullname, u.phone, u.branch].some((v) => String(v || "").toLowerCase().includes(q));
  }

  function visibleUsers() {
    const q = el.search.value.trim().toLowerCase();
    const rank = (r) => { const i = ROLES.indexOf(r); return i < 0 ? 99 : i; };
    const byName = (a, b) => String(a.fullname || a.username).localeCompare(String(b.fullname || b.username));
    const sorters = {
      name: byName,
      role: (a, b) => rank(a.role) - rank(b.role) || byName(a, b),
      branch: (a, b) => String(a.branch || "~").localeCompare(String(b.branch || "~")) || byName(a, b),
      login: (a, b) => (b.lastLoginAt ? Date.parse(b.lastLoginAt) : 0) - (a.lastLoginAt ? Date.parse(a.lastLoginAt) : 0)
    };
    return state.users
      .filter((u) => state.role === "all" || u.role === state.role)
      .filter((u) => state.status === "all" || (state.status === "active") === !!u.isActive)
      .filter((u) => matchesSearch(u, q))
      .sort(sorters[state.sort] || byName);
  }

  // ---------- rendering ----------
  function renderStats() {
    const all = state.users;
    const active = all.filter((u) => u.isActive).length;
    const tiles = [
      { key: "all", label: t("admin.users.statTotal"), n: all.length, ico: "users" },
      { key: "status:active", label: t("admin.users.statusActive"), n: active, ico: "check-circle", cls: "ok" },
      { key: "status:inactive", label: t("admin.users.statusInactive"), n: all.length - active, ico: "x-circle", cls: "off" },
      { key: "noBranch", label: t("admin.users.statNoAlerts"), n: all.filter((u) => u.role === "user" && !u.branch).length, ico: "bell", cls: "warn", hint: t("admin.users.statNoAlertsHint") }
    ];
    const activeKey = state.status !== "all" ? `status:${state.status}` : (state.role === "all" ? "all" : "");
    el.stats.innerHTML = tiles.map((x) => `
      <button type="button" class="um-stat ${x.cls ? "um-stat-" + x.cls : ""}${x.key === activeKey ? " on" : ""}" data-key="${x.key}"${x.hint ? ` title="${escapeHtml(x.hint)}"` : ""}>
        <span class="um-stat-ico" aria-hidden="true"><span class="adm-ico adm-ico-${x.ico}"></span></span>
        <b>${x.n}</b>
        <span>${escapeHtml(x.label)}</span>
      </button>`).join("");
  }

  function renderRoleChips() {
    const counts = {};
    state.users.forEach((u) => { counts[u.role] = (counts[u.role] || 0) + 1; });
    const chip = (value, label, n) =>
      `<button type="button" class="um-chip${state.role === value ? " on" : ""}" data-role="${value}">${escapeHtml(label)}<span>${n}</span></button>`;
    el.roleChips.innerHTML = chip("all", t("admin.users.allRoles"), state.users.length) +
      ROLES.filter((r) => counts[r]).map((r) => chip(r, roleLabel(r), counts[r])).join("");
  }

  function userCard(u) {
    const branchNote = u.role === "user" && !u.branch
      ? `<span class="um-meta um-meta-warn" title="${escapeHtml(t("admin.users.statNoAlertsHint"))}"><span class="adm-ico adm-ico-bell" aria-hidden="true"></span>${escapeHtml(t("admin.users.noBranchAlerts"))}</span>`
      : (u.branch ? `<span class="um-meta"><span class="ui-ico ui-ico-pin" aria-hidden="true"></span>${escapeHtml(u.branch)}</span>` : "");
    return `
      <article class="um-card${u.isActive ? "" : " is-inactive"}" data-username="${escapeHtml(u.username)}">
        <button type="button" class="um-card-main" data-action="edit" aria-label="${escapeHtml(t("admin.users.edit"))}">
          <span class="adm-avatar um-avatar um-avatar-${roleBadgeClass(u.role).replace("adm-badge-role-", "")}">${escapeHtml(initials(u.fullname, u.username))}<i class="um-dot${u.isActive ? " on" : ""}"></i></span>
          <span class="um-card-text">
            <span class="um-name">${escapeHtml(u.fullname || u.username)}</span>
            <span class="um-username">@${escapeHtml(u.username)}</span>
          </span>
          <span class="adm-badge ${roleBadgeClass(u.role)}">${escapeHtml(roleLabel(u.role))}</span>
        </button>
        <div class="um-card-meta">
          ${branchNote}
          ${u.phone ? `<span class="um-meta"><span class="ui-ico ui-ico-phone" aria-hidden="true"></span>${escapeHtml(u.phone)}</span>` : ""}
          <span class="um-meta"><span class="adm-ico adm-ico-refresh" aria-hidden="true"></span>${escapeHtml(lastLoginLabel(u.lastLoginAt))}</span>
          ${u.isActive ? "" : `<span class="adm-badge adm-badge-status-inactive">${escapeHtml(t("admin.users.statusInactive"))}</span>`}
        </div>
        <div class="um-card-actions">
          <button type="button" class="adm-icon-btn" title="${escapeHtml(t("admin.users.edit"))}" data-action="edit"><span class="adm-ico adm-ico-edit" aria-hidden="true"></span></button>
          <button type="button" class="adm-icon-btn" title="${escapeHtml(t("admin.users.resetPassword"))}" data-action="reset"><span class="adm-ico adm-ico-key" aria-hidden="true"></span></button>
          <button type="button" class="adm-icon-btn adm-icon-btn-danger" title="${escapeHtml(t("admin.users.delete"))}" data-action="delete"><span class="adm-ico adm-ico-trash" aria-hidden="true"></span></button>
        </div>
      </article>`;
  }

  function render() {
    renderStats();
    renderRoleChips();
    el.statusSeg.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.status === state.status));
    el.searchClear.hidden = !el.search.value;
    const list = visibleUsers();
    el.count.textContent = t("admin.users.countOf", { n: list.length, total: state.users.length });
    el.list.innerHTML = list.map(userCard).join("");
    el.tableEmpty.hidden = list.length > 0 || !state.users.length;
  }

  el.list.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    const card = e.target.closest(".um-card");
    if (!btn || !card) return;
    const u = state.users.find((x) => x.username === card.dataset.username);
    if (!u) return;
    if (btn.dataset.action === "edit") openUserModal(u);
    else if (btn.dataset.action === "reset") resetPassword(u.username);
    else if (btn.dataset.action === "delete") deleteUser(u.username);
  });

  // ---------- load users ----------
  async function loadUsers() {
    try {
      const res = await fetch(`${API_BASE}/api/admin/users`, { headers: authHeaders() });

      if (res.status === 401 || res.status === 403) {
        location.replace(window.CM_ADMIN_CONFIG.loginPage);
        return;
      }

      const data = await res.json();
      if (!data.ok) throw new Error(data.message || "Failed to load users");

      state.users = data.users || [];
      render();
    } catch (e) {
      console.error("loadUsers failed:", e);
      AdminUI.toast(t("admin.users.couldNotLoadList"), "error");
    }
  }

  function resetFilters() {
    el.search.value = "";
    state.role = "all";
    state.status = "all";
    render();
  }

  el.btnShowAll.addEventListener("click", resetFilters);
  el.search.addEventListener("input", render);
  el.searchClear.addEventListener("click", () => { el.search.value = ""; render(); el.search.focus(); });
  el.sort.addEventListener("change", () => { state.sort = el.sort.value; render(); });
  el.roleChips.addEventListener("click", (e) => {
    const b = e.target.closest("[data-role]");
    if (!b) return;
    state.role = b.dataset.role;
    render();
  });
  el.statusSeg.addEventListener("click", (e) => {
    const b = e.target.closest("[data-status]");
    if (!b) return;
    state.status = b.dataset.status;
    render();
  });
  el.stats.addEventListener("click", (e) => {
    const b = e.target.closest("[data-key]");
    if (!b) return;
    const k = b.dataset.key;
    if (k === "all") { state.role = "all"; state.status = "all"; }
    else if (k.startsWith("status:")) state.status = k.slice(7);
    else if (k === "noBranch") { state.role = "user"; state.status = "all"; }
    render();
  });

  // ---------- roles guide ----------
  function openRolesGuide() {
    const body = document.createElement("div");
    body.className = "um-roles-guide";
    body.innerHTML = `
      <p class="adm-modal-message">${escapeHtml(t("admin.users.rolesGuideLead"))}</p>
      ${ROLES.map((r) => `
        <div class="um-role-row">
          <span class="adm-badge ${roleBadgeClass(r)}">${escapeHtml(roleLabel(r))}</span>
          <p>${escapeHtml(roleDesc(r))}</p>
        </div>`).join("")}`;
    AdminUI.openModal({ title: t("admin.users.rolesGuide"), bodyNode: body, wide: true });
  }
  el.btnRoles.addEventListener("click", openRolesGuide);

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
      if (!res.ok) AdminUI.toast(t("admin.users.photoUploadFailed"), "error");
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

    const fRoleDesc = bodyNode.querySelector("#ufRoleDesc");
    const fBranchOptional = bodyNode.querySelector("#ufBranchOptional");
    const fBranchHint = bodyNode.querySelector("#ufBranchHint");

    // Branch: required for the manager roles, optional for User (it
    // only picks which branch's alerts they receive); hidden otherwise.
    function updateBranchVisibility() {
      const role = fRole.value;
      const required = BRANCH_ROLES.has(role);
      const optional = OPTIONAL_BRANCH_ROLES.has(role);
      fBranchField.hidden = !required && !optional;
      fBranchOptional.hidden = !optional;
      fBranchHint.textContent = optional ? t("admin.users.branchHintUser") : required ? t("admin.users.branchHintManager") : "";
      if (fBranchField.hidden) fBranch.value = "";
      fRoleDesc.innerHTML = `<span class="adm-ico adm-ico-key" aria-hidden="true"></span><span>${escapeHtml(roleDesc(role))}</span>`;
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
      <button type="button" class="adm-btn" id="ufBtnCancel">${t("admin.users.cancel")}</button>
      <button type="submit" class="adm-btn adm-btn-primary" id="ufBtnSave">${isEdit ? t("admin.users.saveChanges") : t("admin.users.addUserButton")}</button>
    `;

    AdminUI.openModal({
      title: isEdit ? t("admin.users.editUser") : t("admin.users.addUserModalTitle"),
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
      const branch = BRANCH_ROLES.has(role) || OPTIONAL_BRANCH_ROLES.has(role) ? fBranch.value.trim() : "";

      if (!username) return AdminUI.toast(t("admin.users.enterUsername"), "error");
      if (!fullname) return AdminUI.toast(t("admin.users.enterFullName"), "error");
      if (BRANCH_ROLES.has(role) && !branch) return AdminUI.toast(t("admin.users.selectBranchForRole"), "error");

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
          if (!res.ok || !data.ok) return AdminUI.toast(data.message || t("admin.users.editFailed"), "error");

          await commitPhotoChanges(username);
          AdminUI.closeModal();
          await loadUsers();
          AdminUI.toast(t("admin.users.userUpdated"), "success");
        } else {
          const newPass = await AdminUI.prompt({
            title: t("admin.users.setPasswordTitle"),
            label: t("admin.users.setPasswordLabel"),
            defaultValue: "123456"
          });
          if (!newPass) return;

          const res = await fetch(`${API_BASE}/api/admin/users`, {
            method: "POST",
            headers: { ...authHeaders(), "Content-Type": "application/json" },
            body: JSON.stringify({ username, password: newPass, ...body })
          });
          const data = await res.json();
          if (!res.ok || !data.ok) return AdminUI.toast(data.message || t("admin.users.addFailed"), "error");

          await commitPhotoChanges(username);
          AdminUI.closeModal();
          await loadUsers();
          AdminUI.toast(t("admin.users.userAdded"), "success");
        }
      } catch (err) {
        console.error("Save user error:", err);
        AdminUI.toast(t("admin.users.couldNotReachServer"), "error");
      }
    });
  }

  el.btnAddUser.addEventListener("click", () => openUserModal(null));

  // ---------- delete ----------
  async function deleteUser(username) {
    const ok = await AdminUI.confirm({
      title: t("admin.users.deleteUserTitle"),
      message: t("admin.users.deleteUserMessage", { username: escapeHtml(username) }),
      confirmLabel: t("admin.users.delete"),
      danger: true
    });
    if (!ok) return;

    try {
      const res = await fetch(`${API_BASE}/api/admin/users/${encodeURIComponent(username)}`, {
        method: "DELETE",
        headers: authHeaders()
      });
      const data = await res.json();
      if (!res.ok || !data.ok) return AdminUI.toast(data.message || t("admin.users.deleteFailed"), "error");

      await loadUsers();
      AdminUI.toast(t("admin.users.userDeleted"), "success");
    } catch (e) {
      console.error("Delete user error:", e);
      AdminUI.toast(t("admin.users.deleteFailedServer"), "error");
    }
  }

  // ---------- reset password ----------
  async function resetPassword(username) {
    const newPass = await AdminUI.prompt({
      title: t("admin.users.resetPasswordTitle"),
      message: t("admin.users.resetPasswordMessage", { username: escapeHtml(username) }),
      placeholder: t("admin.users.newPasswordPlaceholder")
    });
    if (!newPass) return;

    try {
      const res = await fetch(`${API_BASE}/api/admin/users/${encodeURIComponent(username)}/reset-password`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword: newPass })
      });
      const data = await res.json();
      if (!res.ok || !data.ok) return AdminUI.toast(data.message || t("admin.users.resetPasswordFailed"), "error");

      AdminUI.toast(t("admin.users.resetPasswordSuccess"), "success");
    } catch (e) {
      console.error("Reset password error:", e);
      AdminUI.toast(t("admin.users.resetPasswordFailedServer"), "error");
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
