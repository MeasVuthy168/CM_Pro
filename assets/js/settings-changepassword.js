// =========================
// COMPONENT LOADER
// Same pattern as assets/js/settings-changepin.js — kept separate
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
                titleKey: "settings.account.changePassword",
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
// CHANGE PASSWORD FORM
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

const PASSWORD_RULES = [
    { id: "lowercase", test: pw => /[a-z]/.test(pw) },
    { id: "length", test: pw => pw.length >= 12 },
    { id: "uppercase", test: pw => /[A-Z]/.test(pw) },
    { id: "number", test: pw => /[0-9]/.test(pw) },
    { id: "special", test: pw => /[^A-Za-z0-9]/.test(pw) }
];

const oldInput = document.getElementById("cpOldPassword");
const newInput = document.getElementById("cpNewPassword");
const confirmInput = document.getElementById("cpConfirmPassword");
const errorEl = document.getElementById("cpError");
const submitBtn = document.getElementById("cpSubmitBtn");

function validate() {

    const newPw = newInput.value;
    const confirmPw = confirmInput.value;

    let allOk = true;

    PASSWORD_RULES.forEach(rule => {
        const ruleEl = document.querySelector(`.cp-rule[data-rule="${rule.id}"]`);
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

document.querySelectorAll(".cp-eye").forEach(btn => {
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

        setTimeout(() => {
            location.href = "index.html";
        }, 600);

    } catch (err) {

        console.error("[settings-changepassword] change password failed:", err);
        errorEl.textContent = err.message || t("settings.account.changePasswordFailed");

        submitBtn.setAttribute("data-i18n", "settings.account.changePassword");
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
