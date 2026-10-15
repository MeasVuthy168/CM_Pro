// =========================
// SETTINGS -> ACCOUNT
// Fingerprint/Face ID quick toggle (register/remove THIS device only)
// + the Change Password bottom sheet. Change Pin lives on its own page
// (change-pin.html, assets/js/settings-changepin.js) since the
// reference design has it as a full page, not a sheet.
// =========================

function t(key, vars) {
    return window.CMI18n ? CMI18n.t(key, vars) : key;
}

function notify(message, type) {
    if (typeof CMToast !== "undefined" && CMToast.show) {
        CMToast.show({
            type: type === "error" ? "error" : "success",
            title: type === "error" ? t("common.error") : t("common.success"),
            message
        });
    } else {
        alert(message);
    }
}

function currentUsername() {
    try {
        const user = JSON.parse(localStorage.getItem("loggedInUser") || "{}");
        return user.username || "";
    } catch {
        return "";
    }
}

// =========================
// FINGERPRINT / FACE ID QUICK TOGGLE
// webauthnRegister()/webauthnRemoveCredential() (webauthn.js) already
// do the actual WebAuthn work — this just tracks which credential ID
// belongs to THIS device/browser (keyed by username, so switching
// accounts on a shared device doesn't show the wrong state) and wires
// the switch to them.
// =========================

function fpDeviceCredKey(username) {
    return `cm_webauthn_device_cred_${username}`;
}

function fpStoredCredId() {
    const username = currentUsername();
    if (!username) return "";
    return localStorage.getItem(fpDeviceCredKey(username)) || "";
}

function fpSetStoredCredId(id) {
    const username = currentUsername();
    if (!username) return;
    if (id) {
        localStorage.setItem(fpDeviceCredKey(username), id);
    } else {
        localStorage.removeItem(fpDeviceCredKey(username));
    }
}

async function initFingerprintQuickToggle() {

    const row = document.getElementById("fpToggleRow");
    const label = document.getElementById("fpToggleLabel");
    const toggle = document.getElementById("fpQuickToggle");

    if (!row || !toggle) return;

    // The label/icon area opens the full device-management page
    // (fingerprint.html) — the switch itself (stopPropagation below)
    // is the quick on/off for this one device only.
    if (label) {
        label.style.cursor = "pointer";
        label.addEventListener("click", () => {
            location.href = "fingerprint.html";
        });
    }

    if (!isWebAuthnAvailable()) {
        toggle.disabled = true;
        return;
    }

    // Reconcile local state with the server: the stored credential ID
    // could be stale if the device was removed from fingerprint.html's
    // own management list (or on another device) since it was stored
    // here.
    let storedId = fpStoredCredId();

    if (storedId) {
        try {
            const devices = await webauthnListCredentials();
            const stillExists = devices.some(d => d.id === storedId);
            if (!stillExists) {
                fpSetStoredCredId("");
                storedId = "";
            }
        } catch {
            // Listing failed (offline, etc.) — trust the stored value
            // rather than flipping the switch off under the user.
        }
    }

    toggle.checked = !!storedId;

    toggle.addEventListener("click", (e) => e.stopPropagation());

    toggle.addEventListener("change", async function () {

        const turningOn = this.checked;

        this.disabled = true;

        try {

            if (turningOn) {

                const label = (prompt(t("settings.fingerprint.namePrompt"), "") || "").trim().slice(0, 60);

                // Self-heals the "already registered" dead end: if this
                // authenticator already has a credential for this
                // account that this browser has no local record of
                // (e.g. a prior attempt that errored out after the
                // server had actually finished registering it), a
                // plain webauthnRegister() would fail forever since
                // there'd be no locally-tracked id to remove by
                // toggling off and back on.
                const credId = await webauthnRegisterWithRecovery(label);

                fpSetStoredCredId(credId || "");

                notify(t("settings.fingerprint.registerSuccess"), "success");

            } else {

                const id = fpStoredCredId();

                if (id) {
                    await webauthnRemoveCredential(id);
                } else {
                    // No locally-tracked credential to target — fall
                    // back to clearing everything the server has for
                    // this account, since the user explicitly asked
                    // for fingerprint login off.
                    await webauthnRemoveAllCredentials();
                }

                fpSetStoredCredId("");

                notify(t("settings.fingerprint.removeSuccess"), "success");

            }

        } catch (err) {

            console.error("[settings-account] fingerprint toggle failed:", err);

            // Revert the switch to whatever actually ended up true,
            // not just the opposite of what was attempted.
            this.checked = !turningOn;

            notify(
                err.message || t(turningOn ? "settings.fingerprint.registerFailed" : "settings.fingerprint.removeFailed"),
                "error"
            );

        } finally {

            this.disabled = false;

        }

    });

}

// =========================
// CHANGE PASSWORD SHEET
// =========================

const PASSWORD_RULES = [
    { id: "lowercase", test: pw => /[a-z]/.test(pw) },
    { id: "length", test: pw => pw.length >= 12 },
    { id: "uppercase", test: pw => /[A-Z]/.test(pw) },
    { id: "number", test: pw => /[0-9]/.test(pw) },
    { id: "special", test: pw => /[^A-Za-z0-9]/.test(pw) }
];

function initChangePasswordSheet() {

    const row = document.getElementById("changePasswordRow");
    const sheet = document.getElementById("changePasswordSheet");
    const backdrop = document.getElementById("cpSheetBackdrop");

    const oldInput = document.getElementById("cpOldPassword");
    const newInput = document.getElementById("cpNewPassword");
    const confirmInput = document.getElementById("cpConfirmPassword");

    const errorEl = document.getElementById("cpError");
    const submitBtn = document.getElementById("cpSubmitBtn");

    if (!row || !sheet || !oldInput || !newInput || !confirmInput || !submitBtn) return;

    function openSheet() {
        oldInput.value = "";
        newInput.value = "";
        confirmInput.value = "";
        errorEl.textContent = "";
        [oldInput, newInput, confirmInput].forEach(i => i.type = "password");
        validate();
        sheet.classList.add("show");
    }

    function closeSheet() {
        sheet.classList.remove("show");
    }

    row.addEventListener("click", openSheet);
    backdrop.addEventListener("click", closeSheet);

    sheet.querySelectorAll(".cp-eye").forEach(btn => {
        btn.addEventListener("click", () => {
            const target = document.getElementById(btn.dataset.target);
            if (!target) return;
            target.type = target.type === "password" ? "text" : "password";
        });
    });

    function validate() {

        const newPw = newInput.value;
        const confirmPw = confirmInput.value;

        let allOk = true;

        PASSWORD_RULES.forEach(rule => {
            const ruleEl = sheet.querySelector(`.cp-rule[data-rule="${rule.id}"]`);
            if (!ruleEl) return;
            const ok = rule.test(newPw);
            ruleEl.classList.toggle("ok", ok);
            ruleEl.querySelector(".cp-rule-icon").textContent = ok ? "✓" : "✕";
            if (!ok) allOk = false;
        });

        errorEl.textContent = "";

        const matches = confirmPw.length > 0 && newPw === confirmPw;
        if (confirmPw.length > 0 && !matches) {
            errorEl.textContent = t("settings.account.passwordMismatch");
        }

        const canSubmit = allOk && matches && oldInput.value.length > 0;
        submitBtn.disabled = !canSubmit;

        return canSubmit;

    }

    [oldInput, newInput, confirmInput].forEach(i => i.addEventListener("input", validate));

    submitBtn.addEventListener("click", async () => {

        if (!validate()) return;

        submitBtn.disabled = true;
        const originalLabel = submitBtn.textContent;

        // Drop data-i18n while this button shows a transient "Changing..."
        // label — otherwise a later CMI18n.apply() pass triggered by any
        // unrelated DOM change (e.g. a MutationObserver reacting to the
        // toast being inserted) can stomp it back to "Change Password"
        // mid-request, same class of bug as topbar.js's action button.
        submitBtn.removeAttribute("data-i18n");
        submitBtn.textContent = t("settings.account.changing");

        try {

            const token = localStorage.getItem("token") || sessionStorage.getItem("token");

            const res = await fetch(`${API.BASE_URL}/api/auth/change-password`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({
                    oldPassword: oldInput.value,
                    newPassword: newInput.value
                })
            });

            const data = await res.json();

            if (!data.ok) {
                throw new Error(data.message || t("settings.account.changePasswordFailed"));
            }

            notify(t("settings.account.changePasswordSuccess"), "success");
            closeSheet();

        } catch (err) {

            console.error("[settings-account] change password failed:", err);
            errorEl.textContent = err.message || t("settings.account.changePasswordFailed");

        } finally {

            submitBtn.setAttribute("data-i18n", "settings.account.changePassword");
            submitBtn.textContent = originalLabel;
            validate();

        }

    });

}

// =========================
// AUTO-LOCK TIMEOUT
// Same accordion-picker pattern as Theme/Language above (initAccordionPicker,
// defined in settings.js, loaded just before this file). Read/written
// directly from config/session.js's own localStorage key so the two
// files don't need to share any other code — config/session.js treats
// a missing key as the 5-minute default, same default this list starts
// selected on.
// =========================

const AUTO_LOCK_TIMEOUT_KEY = "cm_lock_timeout_minutes";
const AUTO_LOCK_DEFAULT_MINUTES = "5";

const AUTO_LOCK_LIST = [
    { id: "0", labelKey: "settings.account.autoLock.immediate" },
    { id: "1", labelKey: "settings.account.autoLock.1min" },
    { id: "5", labelKey: "settings.account.autoLock.5min" },
    { id: "10", labelKey: "settings.account.autoLock.10min" },
    { id: "15", labelKey: "settings.account.autoLock.15min" }
];

function getAutoLockMinutes() {
    return localStorage.getItem(AUTO_LOCK_TIMEOUT_KEY) || AUTO_LOCK_DEFAULT_MINUTES;
}

function setAutoLockMinutes(id) {
    localStorage.setItem(AUTO_LOCK_TIMEOUT_KEY, id);
}

function initAutoLockPicker() {

    if (typeof initAccordionPicker !== "function") return;

    initAccordionPicker(
        "autoLockToggle", "autoLockChevron", "autoLockOptions",
        AUTO_LOCK_LIST, getAutoLockMinutes, setAutoLockMinutes, false
    );

}

// =========================
// INIT
// =========================

window.addEventListener("load", () => {
    initFingerprintQuickToggle();
    initChangePasswordSheet();
    initAutoLockPicker();
});
