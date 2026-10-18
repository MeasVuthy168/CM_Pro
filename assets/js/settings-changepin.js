// =========================
// COMPONENT LOADER
// Same pattern as assets/js/settings-fingerprint.js — kept separate
// rather than shared since each settings sub-page sets its own topbar
// title/active bottomnav index.
// =========================

let loaded = 0;

async function loadComponent(id, file) {

    try {

        const useCache = id !== "topbar-container";

        const cached = useCache ? sessionStorage.getItem("comp_" + id) : null;

        if (cached) {

            document.getElementById(id).innerHTML = cached;

        } else {

            const response = await fetch(file);

            const html = await response.text();

            document.getElementById(id).innerHTML = html;

            if (useCache) {

                sessionStorage.setItem("comp_" + id, html);

            }

        }

        if (id === "topbar-container") {

            initTopbar({
                titleKey: "settings.account.managePin",
                showBack: true,
                showLogo: false,
                showProfile: false
            });

        }

        if (id === "bottomnav-container") {

            const items = document.querySelectorAll(".bottom-nav-item");

            items.forEach(item => item.classList.remove("active"));

            items[1]?.classList.add("active");

        }

    } catch (err) {

        console.error(err);

    } finally {

        loaded++;

        if (loaded >= 2 && typeof hideGlobalSplash === "function") {

            setTimeout(hideGlobalSplash, 300);

        }

    }

}

loadComponent("topbar-container", "/CM_Pro/components/topbar.html");
loadComponent("bottomnav-container", "/CM_Pro/components/bottomnav.html");

// =========================
// OFFLINE DETECT
// =========================

function updateOnlineStatus() {

    const banner = document.getElementById("offlineBanner");

    if (banner) {

        banner.style.display = navigator.onLine ? "none" : "block";

    }

}

window.addEventListener("online", updateOnlineStatus);
window.addEventListener("offline", updateOnlineStatus);
updateOnlineStatus();

// =========================
// CHANGE PIN FORM
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

// =========================
// PIN STATUS (set / not set)
// The PIN is account-wide (server-side pinHash), so the local copies
// (loggedInUser / remember_login) are only a first guess — /api/auth/me
// confirms it. Without a PIN this page becomes "Create PIN" and the
// Delete PIN card is hidden.
// =========================

let hasPin = false;

function readJson(key) {
    try { return JSON.parse(localStorage.getItem(key) || "{}") || {}; } catch { return {}; }
}

function currentUsername() {
    return readJson("loggedInUser").username || "";
}

// Keeps every local copy of hasPin in step with the server, so the
// login page (PIN button) and App Lock (keypad vs fingerprint only)
// pick up the change without another login.
function saveLocalHasPin(value) {
    const user = readJson("loggedInUser");
    if (user.username) {
        user.hasPin = value;
        localStorage.setItem("loggedInUser", JSON.stringify(user));
    }
    const remembered = readJson("remember_login");
    if (remembered.username && remembered.username === user.username) {
        remembered.hasPin = value;
        localStorage.setItem("remember_login", JSON.stringify(remembered));
    }
}

// Set when the user deletes their PIN on purpose: the login page then
// stops offering "Create a PIN" on every login. Cleared again as soon
// as a PIN is created.
function pinPromptOffKey() {
    return `cm_pin_prompt_off_${currentUsername()}`;
}

function renderPinStatus() {
    const key = hasPin ? "settings.account.changePin" : "settings.account.createPin";
    const title = document.getElementById("pinIntroTitle");
    title.setAttribute("data-i18n", key);
    title.textContent = t(key);
    if (!submitBtn.dataset.busy) {
        submitBtn.setAttribute("data-i18n", key);
        submitBtn.textContent = t(key);
    }
    const status = document.getElementById("pinStatus");
    const statusKey = hasPin ? "settings.account.pinStatusSet" : "settings.account.pinStatusNone";
    status.setAttribute("data-i18n", statusKey);
    status.textContent = t(statusKey);
    status.className = "pin-status " + (hasPin ? "set" : "none");
    document.getElementById("pinDeleteCard").hidden = !hasPin;
    document.getElementById("pinReasonNote").hidden = !(fromFingerprint && !hasPin);
}

async function refreshPinStatus() {
    try {
        const token = localStorage.getItem("token") || sessionStorage.getItem("token");
        const res = await fetch(`${API.BASE_URL}/api/auth/me`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        const data = await res.json();
        if (data && data.ok && data.user && typeof data.user.hasPin === "boolean") {
            hasPin = data.user.hasPin;
            saveLocalHasPin(hasPin);
            renderPinStatus();
        }
    } catch {
        // offline — keep the local guess
    }
}

// Arriving from the fingerprint switch (shared/pin-required.js):
// ?reason=fingerprint&next=<settings page>. Shows why a PIN is needed
// and returns there once it's created. next is limited to a plain
// page name in this folder so it can't redirect anywhere else.
const pageParams = new URLSearchParams(location.search);
const fromFingerprint = pageParams.get("reason") === "fingerprint";
const nextPage = /^[a-z0-9-]+\.html$/.test(pageParams.get("next") || "") ? pageParams.get("next") : "index.html";

const currentPasswordInput = document.getElementById("pinCurrentPassword");
const newInput = document.getElementById("pinNew");
const confirmInput = document.getElementById("pinConfirm");
const submitBtn = document.getElementById("pinSubmitBtn");

function digitsOnly(value) {
    return value.replace(/\D/g, "").slice(0, 6);
}

function validate() {

    const newPin = newInput.value;
    const confirmPin = confirmInput.value;

    const digitsOk = /^\d{6}$/.test(newPin);
    const matchOk = newPin.length > 0 && newPin === confirmPin;
    const passwordOk = currentPasswordInput.value.length > 0;

    const digitsRule = document.querySelector('.pin-rule[data-rule="digits"]');
    const matchRule = document.querySelector('.pin-rule[data-rule="match"]');

    if (digitsRule) {
        digitsRule.classList.toggle("ok", digitsOk);
        digitsRule.querySelector(".pin-rule-icon").textContent = digitsOk ? "✓" : "✕";
    }

    if (matchRule) {
        matchRule.classList.toggle("ok", matchOk);
        matchRule.querySelector(".pin-rule-icon").textContent = matchOk ? "✓" : "✕";
    }

    const canSubmit = digitsOk && matchOk && passwordOk;
    submitBtn.disabled = !canSubmit;

    return canSubmit;

}

currentPasswordInput.addEventListener("input", validate);

[newInput, confirmInput].forEach(input => {

    input.addEventListener("input", () => {
        input.value = digitsOnly(input.value);
        validate();
    });

});

document.querySelectorAll(".pin-eye").forEach(btn => {
    btn.addEventListener("click", () => {
        const target = document.getElementById(btn.dataset.target);
        if (!target) return;
        target.type = target.type === "password" ? "text" : "password";
    });
});

submitBtn.addEventListener("click", async () => {

    if (!validate()) return;

    submitBtn.disabled = true;
    submitBtn.dataset.busy = "1";

    // Same reasoning as settings-account.js's Change Password submit —
    // drop data-i18n while showing a transient label so a later
    // CMI18n.apply() pass can't stomp it mid-request.
    submitBtn.removeAttribute("data-i18n");
    submitBtn.textContent = t("settings.account.changing");

    try {

        const token = localStorage.getItem("token") || sessionStorage.getItem("token");

        const res = await fetch(`${API.BASE_URL}/api/auth/change-pin`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`
            },
            body: JSON.stringify({
                password: currentPasswordInput.value,
                newPin: newInput.value,
                confirmPin: confirmInput.value
            })
        });

        const data = await res.json();

        if (!data.ok) {
            throw new Error(data.message || t("settings.account.changePinFailed"));
        }

        notify(
            fromFingerprint && !hasPin
                ? t("settings.account.createPinSuccess") + " — " + t("settings.pinRequired.done")
                : t(hasPin ? "settings.account.changePinSuccess" : "settings.account.createPinSuccess"),
            "success"
        );
        saveLocalHasPin(true);
        try { localStorage.removeItem(pinPromptOffKey()); } catch {}

        setTimeout(() => {
            location.href = nextPage;
        }, fromFingerprint ? 1400 : 600);

    } catch (err) {

        console.error("[settings-changepin] change pin failed:", err);
        notify(err.message || t("settings.account.changePinFailed"), "error");

        delete submitBtn.dataset.busy;
        renderPinStatus();
        validate();

    }

});

// =========================
// DELETE PIN
// =========================

const deleteSheet = document.getElementById("pinDeleteSheet");
const deletePassword = document.getElementById("pinDeletePassword");
const deleteConfirmBtn = document.getElementById("pinDeleteConfirm");

function openDeleteSheet() {
    deletePassword.value = "";
    deletePassword.type = "password";
    deleteConfirmBtn.disabled = true;
    deleteSheet.hidden = false;
    setTimeout(() => deletePassword.focus(), 250);
}

function closeDeleteSheet() {
    if (deleteConfirmBtn.dataset.busy) return;
    deleteSheet.hidden = true;
}

document.getElementById("pinDeleteOpen").addEventListener("click", openDeleteSheet);
document.getElementById("pinDeleteCancel").addEventListener("click", closeDeleteSheet);

// Tapping the dimmed area outside the sheet closes it.
deleteSheet.addEventListener("click", (e) => {
    if (e.target === deleteSheet) closeDeleteSheet();
});

document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !deleteSheet.hidden) closeDeleteSheet();
});

deletePassword.addEventListener("input", () => {
    deleteConfirmBtn.disabled = !deletePassword.value;
});

deletePassword.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !deleteConfirmBtn.disabled) deleteConfirmBtn.click();
});

deleteConfirmBtn.addEventListener("click", async () => {

    if (!deletePassword.value || deleteConfirmBtn.dataset.busy) return;

    deleteConfirmBtn.dataset.busy = "1";
    deleteConfirmBtn.disabled = true;
    deleteConfirmBtn.removeAttribute("data-i18n");
    deleteConfirmBtn.textContent = t("settings.account.deletePin.deleting");

    try {

        const token = localStorage.getItem("token") || sessionStorage.getItem("token");

        const res = await fetch(`${API.BASE_URL}/api/auth/delete-pin`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`
            },
            body: JSON.stringify({ password: deletePassword.value })
        });

        const data = await res.json();

        if (!data.ok) {
            throw new Error(data.message || t("settings.account.deletePin.failed"));
        }

        hasPin = false;
        saveLocalHasPin(false);
        try { localStorage.setItem(pinPromptOffKey(), "1"); } catch {}

        // The server removed every fingerprint/face device with the PIN
        // (fingerprint needs a PIN to fall back on) — forget this
        // device's marker too, so login and Settings stop offering it.
        try {
            const u = currentUsername();
            localStorage.removeItem(`cm_webauthn_device_cred_${u}`);
            localStorage.removeItem(`cm_fp_login_disabled_${u}`);
        } catch {}

        notify(t("settings.account.deletePin.success"), "success");

        setTimeout(() => {
            location.href = "index.html";
        }, 600);

    } catch (err) {

        console.error("[settings-changepin] delete pin failed:", err);
        notify(err.message || t("settings.account.deletePin.failed"), "error");

        delete deleteConfirmBtn.dataset.busy;
        deleteConfirmBtn.setAttribute("data-i18n", "settings.account.deletePin.btn");
        deleteConfirmBtn.textContent = t("settings.account.deletePin.btn");
        deleteConfirmBtn.disabled = !deletePassword.value;

    }

});

hasPin = !!readJson("loggedInUser").hasPin;
renderPinStatus();
refreshPinStatus();

// =========================
// FAILSAFE SPLASH
// =========================

window.addEventListener("load", () => {

    setTimeout(() => {

        if (typeof hideGlobalSplash === "function") {

            hideGlobalSplash();

        }

    }, 2500);

});
