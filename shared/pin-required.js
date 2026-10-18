// =========================
// FINGERPRINT / FACE NEEDS A PIN
// Turning on "Login with Fingerprint or Face" (Settings quick toggle,
// fingerprint.html's "Add this device") requires the account to have a
// PIN first, so there's always a PIN to fall back on when the biometric
// prompt fails or is cancelled. Without one, CMPinRequired.check() shows
// a sheet that sends the user to Manage PIN, which brings them back here
// once the PIN is created.
//
// check() is synchronous on purpose: the callers go straight on to
// navigator.credentials.create(), and iOS Safari drops the tap's user
// activation if anything is awaited first. The local hasPin copy is
// kept fresh by refresh() (run on page load) instead.
// =========================

(function () {

    function t(key, vars) {
        return window.CMI18n ? CMI18n.t(key, vars) : key;
    }

    function readJson(key) {
        try { return JSON.parse(localStorage.getItem(key) || "{}") || {}; } catch { return {}; }
    }

    function hasPin() {
        return !!readJson("loggedInUser").hasPin;
    }

    function saveHasPin(value) {
        const user = readJson("loggedInUser");
        if (!user.username) return;
        user.hasPin = value;
        localStorage.setItem("loggedInUser", JSON.stringify(user));
        const remembered = readJson("remember_login");
        if (remembered.username === user.username) {
            remembered.hasPin = value;
            localStorage.setItem("remember_login", JSON.stringify(remembered));
        }
    }

    async function refresh() {
        try {
            const token = localStorage.getItem("token") || sessionStorage.getItem("token");
            if (!token || typeof API === "undefined") return;
            const res = await fetch(`${API.BASE_URL}/api/auth/me`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            const data = await res.json();
            if (data && data.ok && data.user && typeof data.user.hasPin === "boolean") {
                saveHasPin(data.user.hasPin);
            }
        } catch {
            // offline — keep the local copy
        }
    }

    function injectStyles() {
        if (document.getElementById("cmPinReqStyles")) return;
        const style = document.createElement("style");
        style.id = "cmPinReqStyles";
        style.textContent = `
#cmPinReq{position:fixed;inset:0;z-index:3000;background:rgba(10,16,35,.55);display:flex;align-items:flex-end;justify-content:center;animation:cmPinReqDim .2s ease;}
#cmPinReq .cpr-sheet{width:100%;max-width:520px;background:#fff;color:#1C2333;border-radius:22px 22px 0 0;padding:10px 20px calc(22px + env(safe-area-inset-bottom));box-sizing:border-box;text-align:center;animation:cmPinReqUp .25s ease;}
#cmPinReq .cpr-grab{width:42px;height:5px;border-radius:3px;background:#D5DAE3;margin:0 auto 16px;}
#cmPinReq .cpr-ic{width:64px;height:64px;border-radius:50%;margin:0 auto 12px;display:flex;align-items:center;justify-content:center;background:#FFF6D6;color:#B8860B;}
#cmPinReq .cpr-title{font-size:19px;font-weight:700;margin:0 0 6px;}
#cmPinReq .cpr-text{font-size:13.5px;line-height:1.6;color:#6B7280;margin:0 4px 18px;}
#cmPinReq .cpr-ok{width:100%;height:50px;border:none;border-radius:14px;background:linear-gradient(180deg,#FFD700,#D4AF37);color:#0E1B3C;font-size:16px;font-weight:700;font-family:inherit;cursor:pointer;}
#cmPinReq .cpr-cancel{width:100%;height:46px;margin-top:6px;border:none;background:transparent;color:#0E1B3C;font-size:15px;font-weight:600;font-family:inherit;cursor:pointer;}
[data-theme="dark"] #cmPinReq .cpr-sheet{background:#16223F;color:#fff;}
[data-theme="darkgray"] #cmPinReq .cpr-sheet{background:#363A41;color:#F0F1F3;}
[data-theme="dark"] #cmPinReq .cpr-text,[data-theme="darkgray"] #cmPinReq .cpr-text{color:#9AA8C7;}
[data-theme="dark"] #cmPinReq .cpr-ic,[data-theme="darkgray"] #cmPinReq .cpr-ic{background:rgba(255,215,0,.12);color:#FFD700;}
[data-theme="dark"] #cmPinReq .cpr-cancel,[data-theme="darkgray"] #cmPinReq .cpr-cancel{color:#fff;}
[data-theme="dark"] #cmPinReq .cpr-grab,[data-theme="darkgray"] #cmPinReq .cpr-grab{background:#33456F;}
@keyframes cmPinReqDim{from{opacity:0}to{opacity:1}}
@keyframes cmPinReqUp{from{transform:translateY(40px);opacity:.6}to{transform:none;opacity:1}}`;
        document.head.appendChild(style);
    }

    function close() {
        const el = document.getElementById("cmPinReq");
        if (el) el.remove();
    }

    function showSheet() {

        injectStyles();
        close();

        const el = document.createElement("div");
        el.id = "cmPinReq";
        el.innerHTML = `
            <div class="cpr-sheet" role="dialog" aria-modal="true" aria-labelledby="cprTitle">
                <div class="cpr-grab"></div>
                <div class="cpr-ic" aria-hidden="true"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v5c0 4.6-3 8.4-7 10-4-1.6-7-5.4-7-10V6l7-3z"/><rect x="9" y="10.5" width="6" height="5" rx="1"/><path d="M10.3 10.5V9a1.7 1.7 0 0 1 3.4 0v1.5"/></svg></div>
                <h3 class="cpr-title" id="cprTitle"></h3>
                <p class="cpr-text"></p>
                <button type="button" class="cpr-ok"></button>
                <button type="button" class="cpr-cancel"></button>
            </div>`;

        el.querySelector(".cpr-title").textContent = t("settings.pinRequired.title");
        el.querySelector(".cpr-text").textContent = t("settings.pinRequired.text");
        el.querySelector(".cpr-ok").textContent = t("settings.pinRequired.create");
        el.querySelector(".cpr-cancel").textContent = t("common.cancel");

        el.querySelector(".cpr-ok").addEventListener("click", () => {
            const back = location.pathname.split("/").pop() || "index.html";
            location.href = `change-pin.html?reason=fingerprint&next=${encodeURIComponent(back)}`;
        });
        el.querySelector(".cpr-cancel").addEventListener("click", close);
        el.addEventListener("click", (e) => { if (e.target === el) close(); });

        document.body.appendChild(el);

    }

    // true → go ahead; false → the "create a PIN first" sheet is showing.
    function check() {
        if (hasPin()) return true;
        showSheet();
        return false;
    }

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") close();
    });

    window.CMPinRequired = { check, refresh, hasPin };

    refresh();

})();
