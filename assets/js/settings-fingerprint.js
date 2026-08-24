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
                title: "Fingerprint Login",
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
const fpUnsupported = document.getElementById("fpUnsupported");
const fpSupportedArea = document.getElementById("fpSupportedArea");

function fpDeviceIconFor(label) {
    const l = (label || "").toLowerCase();
    if (l.includes("iphone") || l.includes("ipad") || l.includes("mac")) return "🍎";
    if (l.includes("android") || l.includes("pixel") || l.includes("samsung")) return "🤖";
    return "💻";
}

function fpFormatDate(iso) {
    if (!iso) return "";
    try {
        return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
    } catch {
        return "";
    }
}

function fpRenderDevices(devices) {

    if (!devices.length) {
        fpDeviceList.innerHTML = `<div class="fp-empty">មិនទាន់មានឧបករណ៍ត្រូវបានចុះឈ្មោះទេ</div>`;
        return;
    }

    fpDeviceList.innerHTML = devices.map(d => `
        <div class="fp-device-row" data-id="${escapeHtml(d.id)}">
            <div class="fp-device-icon">${fpDeviceIconFor(d.deviceLabel)}</div>
            <div class="fp-device-info">
                <div class="fp-device-name">${escapeHtml(d.deviceLabel)}</div>
                <div class="fp-device-date">បន្ថែមនៅ ${escapeHtml(fpFormatDate(d.createdAt))}</div>
            </div>
            <button type="button" class="fp-device-remove" data-id="${escapeHtml(d.id)}" title="លុប">🗑️</button>
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
        fpDeviceList.innerHTML = `<div class="fp-empty">មិនអាចផ្ទុកបញ្ជីឧបករណ៍បានទេ</div>`;
    }
}

async function fpRemoveDevice(id) {
    if (!confirm("តើអ្នកពិតជាចង់លុបឧបករណ៍នេះមែនទេ?")) return;

    try {
        await webauthnRemoveCredential(id);
        notify("បានលុបដោយជោគជ័យ", "success");
        fpRefreshDevices();
    } catch (err) {
        console.error("[fingerprint] remove failed:", err);
        notify(err.message || "លុបបរាជ័យ", "error");
    }
}

function notify(message, type) {
    if (typeof CMToast !== "undefined" && CMToast.show) {
        CMToast.show({ type: type === "error" ? "error" : "backup", title: type === "error" ? "Error" : "Success", message });
    } else {
        alert(message);
    }
}

fpAddBtn?.addEventListener("click", async () => {

    fpAddBtn.disabled = true;
    fpAddBtn.textContent = "កំពុងចុះឈ្មោះ...";

    try {

        // navigator.credentials.create() prompts the platform's own
        // fingerprint/Face ID UI — device label is just this app's
        // record of which device it was, not something the OS reports,
        // so ask for a short one rather than guessing from the user agent.
        const label = (prompt("ដាក់ឈ្មោះឧបករណ៍នេះ (ឧ. iPhone របស់ខ្ញុំ)", "") || "").trim().slice(0, 60);

        await webauthnRegister(label);

        notify("បានចុះឈ្មោះស្នាមម្រាមដៃដោយជោគជ័យ", "success");

        fpRefreshDevices();

    } catch (err) {

        console.error("[fingerprint] register failed:", err);
        notify(err.message || "ចុះឈ្មោះបរាជ័យ", "error");

    } finally {

        fpAddBtn.disabled = false;
        fpAddBtn.innerHTML = `<span>➕</span> បន្ថែមឧបករណ៍នេះ`;

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
