// =========================================================
// APP LOCK
// Loaded on every protected page (same script tag that used to be the
// old 10-minute full-logout inactivity timer — kept the same file path
// deliberately so this rolls out everywhere without touching ~24 HTML
// files). Two separate jobs:
//
// 1) SESSION validity — the actual security boundary. A token with no
//    valid exp, or an exp in the past, means the real backend session
//    is gone: clear everything and send the user to the password login
//    screen. This is a UX-layer check only (same as assets/js/admin/
//    admin-loader.js already does for admin pages) — the real
//    enforcement is requireJwt rejecting the token server-side on the
//    next API call either way.
//
// 2) APP LOCK — a local, convenience-only overlay shown after
//    inactivity or backgrounding, unlocked with the PIN
//    (POST /api/auth/verify-pin) or biometrics
//    (POST /api/webauthn/unlock/*). CRITICAL: neither of those routes
//    issues a new token, and both require requireJwt — so (a) a
//    successful unlock can never silently extend the real session past
//    its own expiry, and (b) the moment that expiry passes, unlock
//    stops working on its own (the API call 401s) without this file
//    needing to track the expiry separately for that purpose. The lock
//    overlay is a deterrent/UX layer sitting on top of that boundary,
//    not a replacement for it — anyone with devtools access to this
//    origin could remove the overlay's DOM, exactly like they could
//    tamper with any other client-side UI; what actually still protects
//    the data underneath is that every API call independently requires
//    the (unmodified, server-issued, still-unexpired) JWT regardless of
//    whatever this file's local state says.
// =========================================================

(function () {

// =========================================================
// CONSTANTS / KEYS
// =========================================================

const LOCK_ACTIVE_KEY = "cm_lock_active";
const LAST_ACTIVITY_KEY = "cm_lock_last_activity";
const TIMEOUT_MINUTES_KEY = "cm_lock_timeout_minutes";
const DEFAULT_TIMEOUT_MINUTES = 5;

const ACTIVITY_EVENTS = ["click", "touchstart", "keydown", "pointerdown"];

const CHECK_INTERVAL_MS = 15 * 1000;

// Throttle localStorage writes from high-frequency activity events —
// every click/keypress doesn't need its own write.
const ACTIVITY_WRITE_THROTTLE_MS = 2 * 1000;

// =========================================================
// TOKEN / SESSION HELPERS
// =========================================================

function cmGetToken() {
    try {
        return localStorage.getItem("token") || sessionStorage.getItem("token");
    } catch {
        return null;
    }
}

function cmDecodeJwtPayload(token) {
    try {
        const payload = token.split(".")[1];
        const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
        const json = decodeURIComponent(
            atob(base64)
                .split("")
                .map(c => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
                .join("")
        );
        return JSON.parse(json);
    } catch {
        return null;
    }
}

function cmGetStoredUser() {
    try {
        return JSON.parse(localStorage.getItem("loggedInUser") || "{}");
    } catch {
        return {};
    }
}

// Clears everything a real logout clears, plus the lock-state keys —
// used both for an actual expired/invalid session AND for the lock
// screen's own Logout / Forgot PIN actions (both of those are full
// logouts by design: PIN reset requires re-authenticating with the
// password, so "I forgot my PIN" has to route back through the
// password login, not offer a silent local reset).
function cmClearAuthAndRedirect(nextParam) {

    try {
        localStorage.removeItem("token");
        localStorage.removeItem("loggedInUser");
        sessionStorage.clear();
        localStorage.removeItem(LOCK_ACTIVE_KEY);
        localStorage.removeItem(LAST_ACTIVITY_KEY);
        // remember_login is intentionally left alone — same as every
        // other logout path in this app, so the username stays
        // prefilled on the next login.
    } catch {
        // storage can throw in some locked-down/private-mode contexts;
        // the redirect below is what actually matters.
    }

    const suffix = nextParam ? `?next=${encodeURIComponent(nextParam)}` : "";
    window.location.replace(`/CM_Pro/login.html${suffix}`);

}

// Runs synchronously, before anything else — if the token is missing/
// undecodable/expired, there is no valid session to lock in the first
// place, so send the user straight to password login rather than ever
// showing a lock screen for a session that's already gone.
function cmEnsureSessionValid() {

    const token = cmGetToken();

    if (!token) {
        // config/auth.js (loaded just before this file on every page)
        // already redirects on a missing token — this is a defensive
        // fallback in case this file is ever loaded without it.
        cmClearAuthAndRedirect(location.pathname);
        return false;
    }

    const payload = cmDecodeJwtPayload(token);
    const expired = !payload || (payload.exp && Date.now() >= payload.exp * 1000);

    if (expired) {
        cmClearAuthAndRedirect(location.pathname);
        return false;
    }

    return true;

}

// =========================================================
// LOCK TIMEOUT / ACTIVITY STATE
// =========================================================

function cmLockTimeoutMinutes() {
    const raw = localStorage.getItem(TIMEOUT_MINUTES_KEY);
    const n = raw === null ? DEFAULT_TIMEOUT_MINUTES : parseFloat(raw);
    return Number.isFinite(n) && n >= 0 ? n : DEFAULT_TIMEOUT_MINUTES;
}

function cmLockTimeoutMs() {
    return cmLockTimeoutMinutes() * 60 * 1000;
}

function cmGetLastActivity() {
    const raw = localStorage.getItem(LAST_ACTIVITY_KEY);
    const n = raw ? parseInt(raw, 10) : 0;
    return Number.isFinite(n) ? n : 0;
}

let lastActivityWriteAt = 0;

function cmMarkActivity() {
    const now = Date.now();
    if (now - lastActivityWriteAt < ACTIVITY_WRITE_THROTTLE_MS) return;
    lastActivityWriteAt = now;
    try {
        localStorage.setItem(LAST_ACTIVITY_KEY, String(now));
    } catch {
        // ignore — worst case the timeout check runs off a slightly
        // stale timestamp until the next successful write
    }
}

function cmIsMarkedLocked() {
    return localStorage.getItem(LOCK_ACTIVE_KEY) === "1";
}

function cmShouldBeLocked() {

    if (cmIsMarkedLocked()) return true;

    const last = cmGetLastActivity();
    if (!last) return false; // no activity recorded yet this session — treat as fresh, not locked

    return (Date.now() - last) >= cmLockTimeoutMs();

}

// =========================================================
// MINIMAL IMMEDIATE BLOCK (runs before the DOM/CSS below exists)
// Closes the "flash of dashboard content" gap: if this page load
// should already be locked (closed-and-reopened past the timeout, or
// was mid-lock when last closed), cover the viewport THE INSTANT this
// script runs — typically while <head> is still being parsed, well
// before the page's own content has painted — rather than waiting for
// the fully-built overlay (which needs i18n, loaded later) to be
// ready. cmBuildLockOverlay() below replaces this with the real
// overlay once the page finishes loading.
// =========================================================

function cmShowImmediateBlock() {

    const el = document.createElement("div");
    el.id = "cmLockImmediateBlock";
    el.setAttribute(
        "style",
        "position:fixed;inset:0;z-index:2147483647;background:#0E1B3C;"
    );
    (document.body || document.documentElement).appendChild(el);

}

// =========================================================
// BOOT — runs immediately (synchronous, top of file)
// =========================================================

// The whole file is wrapped in the outer IIFE, so a bare `return` here
// cleanly stops everything below (which assumes a valid session) from
// ever running — cmEnsureSessionValid() has already redirected.
if (!cmEnsureSessionValid()) {
    return;
}

const cmNeedsImmediateLock = cmShouldBeLocked();
if (cmNeedsImmediateLock) {
    cmShowImmediateBlock();
}

ACTIVITY_EVENTS.forEach(type => {
    document.addEventListener(type, () => {
        // Marking activity while already locked is fine/desired — it's
        // what lets a successful unlock not immediately re-trigger the
        // lock on the very next check.
        cmMarkActivity();
    }, true);
});

if (!cmIsMarkedLocked() && !cmNeedsImmediateLock) {
    cmMarkActivity();
}

// =========================================================
// FULL OVERLAY (built once window "load" fires, so i18n.js/core.js —
// loaded later in every page's script list than this file — are
// guaranteed to have already run by the time any text is rendered)
// =========================================================

let overlayEl = null;
let pinDigits = "";
let pinSubmitting = false;
let fingerprintAvailable = false;

function t(key, vars) {
    if (!window.CMI18n) return key;
    return CMI18n.t(key, vars);
}

function cmInjectStyles() {

    if (document.getElementById("cmLockStyles")) return;

    const style = document.createElement("style");
    style.id = "cmLockStyles";
    style.textContent = `
#cmLockOverlay{position:fixed;inset:0;z-index:2147483647;background:#0E1B3C;display:none;flex-direction:column;align-items:center;justify-content:center;padding:24px;box-sizing:border-box;overflow-y:auto;}
#cmLockOverlay.show{display:flex;}
.cm-lock-inner{width:100%;max-width:380px;display:flex;flex-direction:column;align-items:center;}
.cm-lock-logo{width:72px;height:72px;border-radius:50%;margin-bottom:14px;object-fit:cover;}
.cm-lock-photo{width:64px;height:64px;border-radius:50%;object-fit:cover;border:2px solid #D4AF37;background:#16223F;margin-bottom:10px;}
.cm-lock-greeting{color:#fff;font-size:17px;font-weight:600;text-align:center;margin-bottom:4px;}
.cm-lock-title{color:#b9c6e0;font-size:14px;text-align:center;margin-bottom:22px;}
.cm-lock-dots{display:flex;gap:16px;margin-bottom:10px;}
.cm-lock-dot{width:16px;height:16px;border-radius:50%;border:2px solid #FFD700;box-sizing:border-box;transition:background .15s;}
.cm-lock-dot.filled{background:#FFD700;}
.cm-lock-dot.error{border-color:#ff6b6b;background:#ff6b6b;}
.cm-lock-status{min-height:20px;color:#ff6b6b;font-size:13.5px;font-weight:600;text-align:center;margin-bottom:8px;}
.cm-lock-keypad{width:100%;max-width:280px;display:grid;grid-template-columns:repeat(3,1fr);gap:14px 24px;margin-top:6px;}
.cm-lock-key{height:58px;border:none;border-radius:50%;background:rgba(255,255,255,.06);color:#fff;font-size:24px;font-weight:500;cursor:pointer;}
.cm-lock-key:active{background:rgba(255,215,0,.18);transform:scale(.94);}
.cm-lock-key-back{font-size:18px;background:transparent;}
.cm-lock-fp-btn{margin-top:18px;width:56px;height:56px;border-radius:50%;border:1.5px solid #FFD700;background:transparent;color:#FFD700;font-size:24px;cursor:pointer;}
.cm-lock-fp-btn:active{background:rgba(255,215,0,.12);}
.cm-lock-links{display:flex;gap:22px;margin-top:26px;}
.cm-lock-link{color:#b9c6e0;font-size:13.5px;font-weight:600;cursor:pointer;}
.cm-lock-link:active{opacity:.7;}
@keyframes cmLockShake{0%,100%{transform:translateX(0);}20%{transform:translateX(-8px);}40%{transform:translateX(8px);}60%{transform:translateX(-6px);}80%{transform:translateX(6px);}}
.cm-lock-dots.shake{animation:cmLockShake .4s ease;}
`;
    document.head.appendChild(style);

}

function cmLoadScriptOnce(src) {
    return new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${src}"]`)) {
            resolve();
            return;
        }
        const s = document.createElement("script");
        s.src = src;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error("Failed to load " + src));
        document.head.appendChild(s);
    });
}

function cmRenderDots() {
    const dotsEl = overlayEl.querySelector("#cmLockDots");
    dotsEl.querySelectorAll(".cm-lock-dot").forEach((dot, i) => {
        dot.classList.toggle("filled", i < pinDigits.length);
        dot.classList.remove("error");
    });
}

function cmResetPinEntry() {
    pinDigits = "";
    pinSubmitting = false;
    overlayEl.querySelector("#cmLockStatus").innerText = "";
    cmRenderDots();
}

async function cmSubmitPin() {

    if (pinSubmitting) return;
    pinSubmitting = true;

    const statusEl = overlayEl.querySelector("#cmLockStatus");
    const dotsEl = overlayEl.querySelector("#cmLockDots");
    const token = cmGetToken();

    try {

        const res = await fetch(`${API.BASE_URL}/api/auth/verify-pin`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`
            },
            body: JSON.stringify({ pin: pinDigits })
        });

        const data = await res.json();

        if (!res.ok || !data.ok) {

            if (data.requirePassword) {
                statusEl.innerText = data.message || t("applock.lockedMessage");
                setTimeout(() => cmClearAuthAndRedirect(location.pathname), 1200);
                return;
            }

            statusEl.innerText =
                data.attemptsRemaining !== undefined
                    ? t("applock.attemptsRemaining", { n: data.attemptsRemaining })
                    : (data.message || t("login.msg.pinFailed"));

            dotsEl.querySelectorAll(".cm-lock-dot").forEach(d => d.classList.add("error"));
            dotsEl.classList.add("shake");

            setTimeout(() => {
                dotsEl.classList.remove("shake");
                pinDigits = "";
                pinSubmitting = false;
                cmRenderDots();
            }, 400);

            return;

        }

        cmHideLock();

    } catch (err) {

        console.error("[app-lock] verify-pin failed:", err);
        statusEl.innerText = navigator.onLine === false ? t("applock.offline") : t("login.msg.cannotConnect");
        pinDigits = "";
        pinSubmitting = false;
        cmRenderDots();

    }

}

async function cmTryBiometricUnlock() {

    const statusEl = overlayEl.querySelector("#cmLockStatus");

    try {

        await cmLoadScriptOnce("/CM_Pro/assets/js/webauthn.js");

        if (!isWebAuthnAvailable()) {
            statusEl.innerText = t("webauthn.unsupported");
            return;
        }

        statusEl.innerText = "";
        await webauthnUnlock();
        cmHideLock();

    } catch (err) {

        console.error("[app-lock] biometric unlock failed:", err);
        statusEl.innerText = err.message || t("login.msg.fingerprintFailed");

    }

}

function cmBuildLockOverlay() {

    if (overlayEl) return overlayEl;

    cmInjectStyles();

    // The minimal immediate block (if it was shown) is replaced by
    // this real overlay — remove it once the real one is in the DOM.
    const immediateBlock = document.getElementById("cmLockImmediateBlock");

    const user = cmGetStoredUser();

    const el = document.createElement("div");
    el.id = "cmLockOverlay";
    el.innerHTML = `
        <div class="cm-lock-inner">
            <img class="cm-lock-logo" src="/CM_Pro/assets/images/icon-192-maskable.png" alt="CM_Pro">
            <img class="cm-lock-photo" id="cmLockPhoto" style="display:none;" alt="">
            <div class="cm-lock-greeting" id="cmLockGreeting"></div>
            <div class="cm-lock-title"></div>
            <div class="cm-lock-dots" id="cmLockDots">
                <span class="cm-lock-dot"></span><span class="cm-lock-dot"></span><span class="cm-lock-dot"></span>
                <span class="cm-lock-dot"></span><span class="cm-lock-dot"></span><span class="cm-lock-dot"></span>
            </div>
            <div class="cm-lock-status" id="cmLockStatus"></div>
            <div class="cm-lock-keypad">
                <button type="button" class="cm-lock-key" data-digit="1">1</button>
                <button type="button" class="cm-lock-key" data-digit="2">2</button>
                <button type="button" class="cm-lock-key" data-digit="3">3</button>
                <button type="button" class="cm-lock-key" data-digit="4">4</button>
                <button type="button" class="cm-lock-key" data-digit="5">5</button>
                <button type="button" class="cm-lock-key" data-digit="6">6</button>
                <button type="button" class="cm-lock-key" data-digit="7">7</button>
                <button type="button" class="cm-lock-key" data-digit="8">8</button>
                <button type="button" class="cm-lock-key" data-digit="9">9</button>
                <span></span>
                <button type="button" class="cm-lock-key" data-digit="0">0</button>
                <button type="button" class="cm-lock-key cm-lock-key-back" id="cmLockBackspace">⌫</button>
            </div>
            <button type="button" class="cm-lock-fp-btn" id="cmLockFpBtn" style="display:none;" aria-label="Fingerprint">👆</button>
            <div class="cm-lock-links">
                <span class="cm-lock-link" id="cmLockForgot"></span>
                <span class="cm-lock-link" id="cmLockLogout"></span>
            </div>
        </div>
    `;

    document.body.appendChild(el);
    overlayEl = el;

    // ----- text -----
    el.querySelector(".cm-lock-title").innerText = t("login.pin.enterTitle");
    el.querySelector("#cmLockForgot").innerText = t("login.pin.forgot");
    el.querySelector("#cmLockLogout").innerText = t("applock.logout");

    const greetingEl = el.querySelector("#cmLockGreeting");
    if (user.fullname) {
        greetingEl.innerText = t("applock.greeting", { name: user.fullname });
    } else {
        greetingEl.style.display = "none";
    }

    // ----- profile photo (best-effort, same pattern as settings.js) -----
    if (user.username) {
        (async () => {
            try {
                const token = cmGetToken();
                const res = await fetch(`${API.BASE_URL}/assets/user-photo/${user.username}`, {
                    headers: token ? { Authorization: `Bearer ${token}` } : {}
                });
                if (!res.ok) return;
                const blob = await res.blob();
                const img = el.querySelector("#cmLockPhoto");
                img.src = URL.createObjectURL(blob);
                img.style.display = "block";
            } catch {
                // no photo — the greeting text alone is enough
            }
        })();
    }

    // ----- keypad -----
    el.querySelectorAll(".cm-lock-key[data-digit]").forEach(key => {
        key.addEventListener("click", () => {
            if (pinSubmitting || pinDigits.length >= 6) return;
            pinDigits += key.dataset.digit;
            cmRenderDots();
            if (pinDigits.length === 6) cmSubmitPin();
        });
    });

    el.querySelector("#cmLockBackspace").addEventListener("click", () => {
        if (pinSubmitting) return;
        pinDigits = pinDigits.slice(0, -1);
        cmRenderDots();
    });

    // ----- fingerprint -----
    const username = user.username || "";
    fingerprintAvailable = !!(username && localStorage.getItem(`cm_webauthn_device_cred_${username}`));
    if (fingerprintAvailable) {
        const fpBtn = el.querySelector("#cmLockFpBtn");
        fpBtn.style.display = "flex";
        fpBtn.style.alignItems = "center";
        fpBtn.style.justifyContent = "center";
        fpBtn.addEventListener("click", cmTryBiometricUnlock);
    }

    // ----- forgot / logout -----
    // Both are full logouts by design — PIN reset requires
    // re-authenticating with the password (Settings -> Change Pin, once
    // logged back in), never a silent local reset from the lock screen.
    el.querySelector("#cmLockForgot").addEventListener("click", () => {
        cmClearAuthAndRedirect(location.pathname);
    });
    el.querySelector("#cmLockLogout").addEventListener("click", () => {
        cmClearAuthAndRedirect(null);
    });

    if (immediateBlock) immediateBlock.remove();

    return el;

}

function cmShowLock() {

    cmBuildLockOverlay();
    cmResetPinEntry();
    overlayEl.classList.add("show");

    try {
        localStorage.setItem(LOCK_ACTIVE_KEY, "1");
    } catch {
        // worst case the lock just doesn't persist across a reload —
        // the overlay is still showing right now regardless.
    }

    // Auto-trigger biometric unlock once, if available — saves a tap
    // on the common "just backgrounded and came right back" case. Only
    // once per lock (not on every re-check) and never while the user
    // is already mid-PIN-entry.
    if (fingerprintAvailable && !overlayEl.dataset.fpAttempted) {
        overlayEl.dataset.fpAttempted = "1";
        cmTryBiometricUnlock();
    }

}

function cmHideLock() {

    if (overlayEl) {
        overlayEl.classList.remove("show");
        delete overlayEl.dataset.fpAttempted;
    }

    try {
        localStorage.removeItem(LOCK_ACTIVE_KEY);
    } catch {
        // non-fatal
    }

    cmMarkActivity();

}

// =========================================================
// BACKGROUND / INACTIVITY POLICY
// =========================================================

function cmCheckAndMaybeLock() {

    if (!cmEnsureSessionValid()) return; // already redirected

    if (overlayEl && overlayEl.classList.contains("show")) return; // already locked

    if (cmShouldBeLocked()) {
        cmShowLock();
    }

}

document.addEventListener("visibilitychange", () => {

    if (document.hidden) {
        // "Immediately" (0 minutes) is specifically about backgrounding,
        // not just elapsed time since the last tap — lock the instant
        // the tab/app is hidden rather than waiting for the next check.
        if (cmLockTimeoutMinutes() === 0) {
            try { localStorage.setItem(LOCK_ACTIVE_KEY, "1"); } catch {}
        }
        return;
    }

    // Became visible again — re-check immediately rather than waiting
    // for the next interval tick, so returning from background locks
    // (or stays locked) right away instead of up to 15s late.
    cmCheckAndMaybeLock();

});

window.addEventListener("load", () => {

    if (cmNeedsImmediateLock) {
        cmShowLock();
    } else {
        // Build the (hidden) overlay now so showing it later is instant
        // rather than waiting on i18n/DOM work at the moment of locking.
        cmBuildLockOverlay();
    }

    setInterval(cmCheckAndMaybeLock, CHECK_INTERVAL_MS);

});

})();
