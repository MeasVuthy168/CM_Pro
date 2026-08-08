/* =====================================================
   admin-ui.js
   Shared UI primitives for the admin section: toasts, a
   confirm dialog, a prompt dialog, and a generic modal shell.

   Your org-wide shared/modal.js and shared/toast.js are still
   empty placeholders, so these are scoped to /pages/admin/*
   for now — happy to promote this into shared/ later once
   the rest of the app wants the same components.

   Usage:
     AdminUI.toast("Saved.", "success");
     const ok = await AdminUI.confirm({ title: "Delete user?", message: "...", danger: true });
     const val = await AdminUI.prompt({ title: "New password", defaultValue: "123456" });
     const modal = AdminUI.openModal({ title: "Add User", bodyNode, wide: true });
     AdminUI.closeModal();
   ===================================================== */
(function () {
  // ---------- toast ----------
  // Delegates to your real CMToast (assets/js/toast.js) when it's loaded,
  // since that's the actual app-wide toast system — title + message +
  // avatar + progress bar + push-notification integration. Falls back to
  // a minimal built-in toast only if CMToast isn't present on a page.
  const TOAST_TITLES = {
    success: "Success",
    error: "Error",
    info: "Notice",
    warning: "Warning"
  };

  function ensureFallbackStack() {
    let stack = document.getElementById("admToastStack");
    if (!stack) {
      stack = document.createElement("div");
      stack.id = "admToastStack";
      stack.className = "adm-toast-stack";
      document.body.appendChild(stack);
    }
    return stack;
  }

  function fallbackToast(message, type, duration) {
    const stack = ensureFallbackStack();
    const el = document.createElement("div");
    el.className = `adm-toast adm-toast-${type}`;
    el.textContent = message;
    el.addEventListener("click", () => dismiss());

    let timer;
    function dismiss() {
      clearTimeout(timer);
      el.classList.add("adm-toast-out");
      setTimeout(() => el.remove(), 200);
    }

    stack.appendChild(el);
    timer = setTimeout(dismiss, duration);
  }

  function toast(message, type = "success", duration = 3500) {
    if (window.CMToast && typeof window.CMToast.show === "function") {
      window.CMToast.show({
        type,
        title: TOAST_TITLES[type] || "Notice",
        message,
        duration
      });
      return;
    }
    fallbackToast(message, type, duration);
  }

  // ---------- generic modal shell ----------
  let activeOverlay = null;
  let activeOnClose = null;

  function closeModal(result) {
    if (!activeOverlay) return;
    const overlay = activeOverlay;
    activeOverlay = null;
    overlay.classList.add("adm-modal-overlay-out");
    setTimeout(() => overlay.remove(), 150);
    document.removeEventListener("keydown", handleEsc);
    if (activeOnClose) activeOnClose(result);
    activeOnClose = null;
  }

  function handleEsc(e) {
    if (e.key === "Escape") closeModal(null);
  }

  function openModal({ title, bodyNode, wide = false, onClose = null }) {
    closeModal(null); // only one modal at a time

    const overlay = document.createElement("div");
    overlay.className = "adm-modal-overlay";
    overlay.addEventListener("mousedown", (e) => {
      if (e.target === overlay) closeModal(null);
    });

    const modal = document.createElement("div");
    modal.className = `adm-modal${wide ? " adm-modal-wide" : ""}`;

    const header = document.createElement("div");
    header.className = "adm-modal-header";
    header.innerHTML = `<span>${title}</span>`;
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "adm-modal-close";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.textContent = "✕";
    closeBtn.addEventListener("click", () => closeModal(null));
    header.appendChild(closeBtn);

    const body = document.createElement("div");
    body.className = "adm-modal-body";
    body.appendChild(bodyNode);

    modal.appendChild(header);
    modal.appendChild(body);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    activeOverlay = overlay;
    activeOnClose = onClose;
    document.addEventListener("keydown", handleEsc);

    return { overlay, modal, body };
  }

  // ---------- confirm dialog ----------
  function confirmDialog({ title = "Are you sure?", message = "", confirmLabel = "Confirm", cancelLabel = "Cancel", danger = false }) {
    return new Promise((resolve) => {
      const body = document.createElement("div");
      body.innerHTML = `
        <p class="adm-modal-message">${message}</p>
        <div class="adm-modal-footer">
          <button type="button" class="adm-btn" id="admConfirmCancel">${cancelLabel}</button>
          <button type="button" class="adm-btn ${danger ? "adm-btn-danger" : "adm-btn-primary"}" id="admConfirmOk">${confirmLabel}</button>
        </div>
      `;

      const { body: mountedBody } = openModal({
        title,
        bodyNode: body,
        onClose: (result) => resolve(result === true)
      });

      mountedBody.querySelector("#admConfirmCancel").addEventListener("click", () => closeModal(false));
      mountedBody.querySelector("#admConfirmOk").addEventListener("click", () => closeModal(true));
    });
  }

  // ---------- prompt dialog ----------
  function promptDialog({ title = "Enter value", message = "", label = "", placeholder = "", defaultValue = "", inputType = "text", confirmLabel = "OK", cancelLabel = "Cancel" }) {
    return new Promise((resolve) => {
      const body = document.createElement("div");
      body.innerHTML = `
        ${message ? `<p class="adm-modal-message">${message}</p>` : ""}
        <label class="adm-field">
          ${label ? `<span>${label}</span>` : ""}
          <input type="${inputType}" id="admPromptInput" placeholder="${placeholder}" value="${defaultValue}">
        </label>
        <div class="adm-modal-footer">
          <button type="button" class="adm-btn" id="admPromptCancel">${cancelLabel}</button>
          <button type="button" class="adm-btn adm-btn-primary" id="admPromptOk">${confirmLabel}</button>
        </div>
      `;

      const { body: mountedBody } = openModal({
        title,
        bodyNode: body,
        onClose: (result) => resolve(result ?? null)
      });

      const input = mountedBody.querySelector("#admPromptInput");
      input.focus();
      input.select();

      const submit = () => closeModal(input.value.trim() || null);

      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") submit();
      });
      mountedBody.querySelector("#admPromptCancel").addEventListener("click", () => closeModal(null));
      mountedBody.querySelector("#admPromptOk").addEventListener("click", submit);
    });
  }

  window.AdminUI = {
    toast,
    confirm: confirmDialog,
    prompt: promptDialog,
    openModal,
    closeModal
  };
})();
