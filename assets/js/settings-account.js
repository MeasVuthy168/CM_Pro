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

// Separate from the credential id above on purpose: turning this
// switch off is a local "don't use it for quick login right now"
// preference, not a request to delete anything. The credential stays
// registered (fpStoredCredId keeps tracking it) so switching back on
// doesn't need a fresh Face ID/fingerprint enrollment — only an
// explicit delete, here or on fingerprint.html's device list, removes
// the actual registration.
function fpQuickLoginDisabledKey(username) {
    return `cm_fp_login_disabled_${username}`;
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

function fpIsQuickLoginDisabled() {
    const username = currentUsername();
    if (!username) return false;
    return localStorage.getItem(fpQuickLoginDisabledKey(username)) === "1";
}

function fpSetQuickLoginDisabled(disabled) {
    const username = currentUsername();
    if (!username) return;
    if (disabled) {
        localStorage.setItem(fpQuickLoginDisabledKey(username), "1");
    } else {
        localStorage.removeItem(fpQuickLoginDisabledKey(username));
    }
}

// Reconciles the switch's checked state with the server: the stored
// credential ID could be stale if the device was removed (or ALL
// devices were reset) from fingerprint.html's management page since it
// was stored here. Pulled out of initFingerprintQuickToggle() so it can
// also run on its own from the pageshow listener below, without
// re-attaching that function's event listeners a second time.
async function fpSyncQuickToggleState() {

    const toggle = document.getElementById("fpQuickToggle");
    if (!toggle || toggle.disabled) return;

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
            return;
        }
    }

    toggle.checked = !!storedId && !fpIsQuickLoginDisabled();

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

    await fpSyncQuickToggleState();

    toggle.addEventListener("click", (e) => e.stopPropagation());

    toggle.addEventListener("change", async function () {

        const turningOn = this.checked;

        this.disabled = true;

        try {

            if (turningOn) {

                // Re-enabling with a credential this device already
                // has (just confirmed moments ago by the server
                // reconciliation in fpSyncQuickToggleState) needs no
                // new Face ID/fingerprint prompt at all — only clear
                // the local "disabled" flag from the last time this
                // was switched off.
                const existingId = fpStoredCredId();

                if (existingId) {

                    fpSetQuickLoginDisabled(false);

                    notify(t("settings.fingerprint.quickEnableSuccess"), "success");

                } else {

                    // No credential registered yet — go through actual
                    // enrollment. The device-name prompt() runs AFTER
                    // the biometric check succeeds (webauthn.js calls
                    // this once navigator.credentials.create()
                    // resolves) rather than before — see the comment on
                    // webauthnRegister() for why: a blocking prompt()
                    // ahead of create() reliably burns through iOS
                    // Safari's short user-activation window while the
                    // person types, even though it's harmless on
                    // Android/Chrome.
                    const getLabel = () => (prompt(t("settings.fingerprint.namePrompt"), "") || "").trim().slice(0, 60);

                    // Self-heals the "already registered" dead end: if
                    // this authenticator already has a credential for
                    // this account that this browser has no local
                    // record of (e.g. a prior attempt that errored out
                    // after the server had actually finished
                    // registering it), a plain webauthnRegister() would
                    // fail forever since there'd be no locally-tracked
                    // id to remove by toggling off and back on.
                    const credId = await webauthnRegisterWithRecovery(getLabel);

                    fpSetStoredCredId(credId || "");
                    fpSetQuickLoginDisabled(false);

                    notify(t("settings.fingerprint.registerSuccess"), "success");

                }

            } else {

                // Turning this off is a local "stop using it for quick
                // login" preference, not a delete — the registration
                // itself (here, and on every other device it's set up
                // on) is left alone. Only fingerprint.html's device
                // list (remove one, or "Reset All Fingerprints") or
                // another device's own toggle-off actually removes a
                // credential.
                fpSetQuickLoginDisabled(true);

                notify(t("settings.fingerprint.quickDisableSuccess"), "success");

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

// Change Password now lives on its own page (change-password.html,
// mirroring change-pin.html) instead of a bottom sheet here — see
// assets/js/settings-changepassword.js.

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
    initAutoLockPicker();
});

// Returning to this page via the browser's back-forward cache (e.g.
// tapping back after using "Reset All Fingerprints" on
// fingerprint.html) restores the DOM/JS state frozen from before the
// navigation rather than re-running this file — without this, the
// switch would keep showing whatever it was checked to before the
// user left, even though every credential was just removed.
window.addEventListener("pageshow", (e) => {
    if (e.persisted) fpSyncQuickToggleState();
});
