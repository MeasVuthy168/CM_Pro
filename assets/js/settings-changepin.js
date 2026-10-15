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
                titleKey: "settings.account.changePin",
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
    const originalLabel = submitBtn.textContent;

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

        notify(t("settings.account.changePinSuccess"), "success");

        setTimeout(() => {
            location.href = "index.html";
        }, 600);

    } catch (err) {

        console.error("[settings-changepin] change pin failed:", err);
        notify(err.message || t("settings.account.changePinFailed"), "error");

        submitBtn.setAttribute("data-i18n", "settings.account.changePin");
        submitBtn.textContent = originalLabel;
        validate();

    }

});

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
