// =========================
// COMPONENT LOADER
// Same pattern as assets/js/settings.js — kept separate rather than
// shared since each settings sub-page sets its own topbar title/active
// bottomnav index.
// =========================

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
                titleKey: "settings.fingerprint.title",
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
// DEVICE LIST
// =========================

const fpAddBtn = document.getElementById("fpAddBtn");
const fpDeviceList = document.getElementById("fpDeviceList");
const fpDeviceCount = document.getElementById("fpDeviceCount");
const fpUnsupported = document.getElementById("fpUnsupported");
const fpSupportedArea = document.getElementById("fpSupportedArea");
const fpResetAllBtn = document.getElementById("fpResetAllBtn");
const fpCleanupNotice = document.getElementById("fpCleanupNotice");
const fpResetOverlay = document.getElementById("fpResetOverlay");
const fpResetCount = document.getElementById("fpResetCount");
const fpResetPassword = document.getElementById("fpResetPassword");
const fpResetPin = document.getElementById("fpResetPin");
const fpResetStatus = document.getElementById("fpResetStatus");
const fpResetCancelBtn = document.getElementById("fpResetCancelBtn");
const fpResetConfirmBtn = document.getElementById("fpResetConfirmBtn");

// Plain outline glyphs rather than emoji — an iPhone-shaped silhouette
// for iOS/Mac (not Apple's own logo, which isn't ours to reproduce)
// and a simplified Android "bugdroid" for Android (Google releases
// that mascot under CC-BY specifically for reuse like this). Both use
// currentColor so they inherit .fp-device-icon's color automatically.
const FP_ICON_IOS = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="2.5" width="10" height="19" rx="2.3"/><line x1="10.2" y1="19.3" x2="13.8" y2="19.3"/><circle cx="12" cy="5.3" r=".15" fill="currentColor"/></svg>`;

const FP_ICON_ANDROID = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M6.3 10v5.2c0 .5.4 1 1 1h.4v2.1a1.15 1.15 0 0 0 2.3 0v-2.1h4v2.1a1.15 1.15 0 0 0 2.3 0v-2.1h.4c.6 0 1-.5 1-1V10H6.3z"/><path d="M6.1 9.3a5.9 5.9 0 0 1 11.8 0H6.1z"/><circle cx="9.3" cy="6.6" r=".55"/><circle cx="14.7" cy="6.6" r=".55"/><path d="M7.5 3.9 6.3 2.6M16.5 3.9l1.2-1.3" stroke="currentColor" stroke-width=".9" stroke-linecap="round" fill="none"/><rect x="4.6" y="10" width="1.3" height="4.8" rx=".65"/><rect x="18.1" y="10" width="1.3" height="4.8" rx=".65"/></svg>`;

const FP_ICON_GENERIC = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="5" width="19" height="12" rx="1.5"/><line x1="8" y1="20.5" x2="16" y2="20.5"/><line x1="12" y1="17" x2="12" y2="20.5"/></svg>`;

function fpDeviceIconFor(label) {
    const l = (label || "").toLowerCase();
    if (l.includes("iphone") || l.includes("ipad") || l.includes("mac")) return FP_ICON_IOS;
    if (l.includes("android") || l.includes("pixel") || l.includes("samsung")) return FP_ICON_ANDROID;
    return FP_ICON_GENERIC;
}

function fpFormatDate(iso) {
    if (!iso) return "";
    try {
        return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
    } catch {
        return "";
    }
}

function t(key, vars) {
    return window.CMI18n ? CMI18n.t(key, vars) : key;
}

let fpLastDeviceCount = 0;

function fpRenderDevices(devices) {

    fpLastDeviceCount = devices.length;
    fpDeviceCount.innerText = t("settings.fingerprint.deviceCount", { n: devices.length });
    fpResetAllBtn.hidden = devices.length === 0;

    if (!devices.length) {
        fpDeviceList.innerHTML = `<div class="fp-empty">${t("settings.fingerprint.noDevices")}</div>`;
        return;
    }

    fpDeviceList.innerHTML = devices.map(d => `
        <div class="fp-device-row" data-id="${escapeHtml(d.id)}">
            <div class="fp-device-icon">${fpDeviceIconFor(d.deviceLabel)}</div>
            <div class="fp-device-info">
                <div class="fp-device-name">${escapeHtml(d.deviceLabel)}</div>
                <div class="fp-device-date">${escapeHtml(t("settings.fingerprint.addedOn", { date: fpFormatDate(d.createdAt) }))}</div>
            </div>
            <button type="button" class="fp-device-remove" data-id="${escapeHtml(d.id)}" title="${t("common.delete")}">🗑️</button>
        </div>
    `).join("");

    fpDeviceList.querySelectorAll(".fp-device-remove").forEach(btn => {
        btn.addEventListener("click", () => fpRemoveDevice(btn.dataset.id));
    });
}

function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text == null ? "" : String(text);
    return div.innerHTML.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

async function fpRefreshDevices() {
    try {
        const devices = await webauthnListCredentials();
        fpRenderDevices(devices);
    } catch (err) {
        console.error("[fingerprint] list failed:", err);
        fpDeviceList.innerHTML = `<div class="fp-empty">${t("settings.fingerprint.loadFailed")}</div>`;
    }
}

// The Settings page's own quick on/off toggle (settings-account.js)
// tracks "this device's" credential id separately in localStorage,
// keyed by username — it has no way to know a device got removed from
// THIS page, so without this the toggle would stay stuck on even after
// its underlying credential is gone, until something else happened to
// clear it.
function fpDeviceCredKey() {
    try {
        const user = JSON.parse(localStorage.getItem("loggedInUser") || "{}");
        return user.username ? `cm_webauthn_device_cred_${user.username}` : "";
    } catch {
        return "";
    }
}

async function fpRemoveDevice(id) {
    if (!confirm(t("settings.fingerprint.confirmRemove"))) return;

    try {
        await webauthnRemoveCredential(id);

        const key = fpDeviceCredKey();
        if (key && localStorage.getItem(key) === id) {
            localStorage.removeItem(key);
        }

        notify(t("settings.fingerprint.removeSuccess"), "success");
        fpRefreshDevices();
    } catch (err) {
        console.error("[fingerprint] remove failed:", err);
        notify(err.message || t("settings.fingerprint.removeFailed"), "error");
    }
}

function notify(message, type) {
    if (typeof CMToast !== "undefined" && CMToast.show) {
        CMToast.show({ type: type === "error" ? "error" : "backup", title: type === "error" ? t("common.error") : t("common.success"), message });
    } else {
        alert(message);
    }
}

fpAddBtn?.addEventListener("click", async () => {

    fpAddBtn.disabled = true;
    fpAddBtn.textContent = t("settings.fingerprint.registering");

    try {

        // navigator.credentials.create() prompts the platform's own
        // fingerprint/Face ID UI — device label is just this app's
        // record of which device it was, not something the OS reports,
        // so ask for a short one rather than guessing from the user
        // agent. Passed as a function so webauthn.js asks for it AFTER
        // the biometric check succeeds, not before: a blocking prompt()
        // ahead of navigator.credentials.create() reliably burns
        // through iOS Safari's short user-activation window while the
        // person types, even though it's harmless on Android/Chrome.
        const getLabel = () => (prompt(t("settings.fingerprint.namePrompt"), "") || "").trim().slice(0, 60);

        await webauthnRegisterWithRecovery(getLabel);

        notify(t("settings.fingerprint.registerSuccess"), "success");

        fpRefreshDevices();

    } catch (err) {

        console.error("[fingerprint] register failed:", err);
        notify(err.message || t("settings.fingerprint.registerFailed"), "error");

    } finally {

        fpAddBtn.disabled = false;
        fpAddBtn.innerHTML = `<span>➕</span> ${t("settings.fingerprint.addBtn")}`;

    }

});

// =========================
// RESET ALL FINGERPRINTS
// Destructive, account-wide action -- the confirmation step (this
// overlay) plus the server's own password/PIN re-auth (requireJwt
// alone isn't enough) are both deliberate friction, not oversights.
// =========================

function fpOpenResetOverlay() {
    fpResetCount.innerText = t("settings.fingerprint.deviceCount", { n: fpLastDeviceCount });
    fpResetPassword.value = "";
    fpResetPin.value = "";
    fpResetStatus.innerText = "";
    fpResetConfirmBtn.disabled = false;
    fpResetOverlay.classList.add("show");
    fpResetPassword.focus();
}

function fpCloseResetOverlay() {
    fpResetOverlay.classList.remove("show");
}

fpResetAllBtn?.addEventListener("click", fpOpenResetOverlay);
fpResetCancelBtn?.addEventListener("click", fpCloseResetOverlay);

// Password and PIN are "enter one or the other", but both fields stay
// editable at once -- without this, someone could fill in a correct
// password AND a mistyped/forgotten PIN, submit, and have no way to
// tell from the form itself that the server only checked the password
// (it takes priority whenever present) and ignored the PIN entirely.
// Clearing the other field on input keeps exactly one credential
// "active" at submit time, so there's never that ambiguity.
fpResetPassword?.addEventListener("input", () => {
    if (fpResetPassword.value) fpResetPin.value = "";
});
fpResetPin?.addEventListener("input", () => {
    if (fpResetPin.value) fpResetPassword.value = "";
});

fpResetConfirmBtn?.addEventListener("click", async () => {

    const password = fpResetPassword.value;
    const pin = fpResetPin.value.trim();

    if (!password && !pin) {
        fpResetStatus.innerText = t("settings.fingerprint.resetAllMissingCreds");
        return;
    }

    fpResetConfirmBtn.disabled = true;
    fpResetStatus.innerText = "";

    try {

        await webauthnResetAllCredentials({ password, pin });

        // Every credential is gone, so the quick toggle's locally-
        // tracked "this device" id is now stale regardless of what it
        // was (see fpDeviceCredKey() above).
        const key = fpDeviceCredKey();
        if (key) localStorage.removeItem(key);

        fpCloseResetOverlay();
        notify(t("settings.fingerprint.resetAllSuccess"), "success");
        fpCleanupNotice.hidden = false;
        fpRefreshDevices();

    } catch (err) {

        console.error("[fingerprint] reset all failed:", err);
        fpResetStatus.innerText = err.message || t("settings.fingerprint.resetAllFailed");

        // A PIN lockout (err.locked) still leaves the password field
        // in this same form usable -- no need to redirect anywhere,
        // the server message already tells them to use it instead.
        fpResetPin.value = "";

    } finally {

        fpResetConfirmBtn.disabled = false;

    }

});

// =========================
// INIT
// =========================

window.addEventListener("load", () => {

    if (!isWebAuthnAvailable()) {
        fpUnsupported.hidden = false;
        fpSupportedArea.hidden = true;
        return;
    }

    fpRefreshDevices();

});
