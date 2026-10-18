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

// sessionStorage (not localStorage) is the point — it's scoped to the
// browser/PWA process and is gone the instant that process is actually
// closed, even though it survives an in-app page navigation (same
// process) or a brief background/foreground cycle (process usually
// still alive). That's exactly the signal needed to tell "the app was
// closed and relaunched" apart from "the user tapped to another page"
// without touching every one of the ~24 HTML files.
const SESSION_ALIVE_KEY = "cm_session_alive";
const JUST_AUTHENTICATED_KEY = "cm_just_authenticated";

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

// This device's registered fingerprint/face, unless switched off in
// Settings.
function cmDeviceHasFingerprint(username) {
    try {
        return !!(
            username &&
            localStorage.getItem(`cm_webauthn_device_cred_${username}`) &&
            localStorage.getItem(`cm_fp_login_disabled_${username}`) !== "1"
        );
    } catch {
        return false;
    }
}

// The lock screen needs a PIN to unlock with (fingerprint/face is only
// allowed alongside a PIN — Delete PIN removes it too). Without one —
// never set, or deleted — locking would leave only "Log Out", so the
// app simply doesn't lock.
function cmCanUnlock() {
    return !!cmGetStoredUser().hasPin;
}

function cmShouldBeLocked() {

    if (!cmCanUnlock()) {
        try { localStorage.removeItem(LOCK_ACTIVE_KEY); } catch {}
        return false;
    }

    if (cmIsMarkedLocked()) return true;

    // "Immediately" (0 minutes) means "lock the instant the app is
    // backgrounded" — that's the visibilitychange listener further
    // down, which sets cmIsMarkedLocked() the moment the tab/app is
    // hidden. It does NOT mean "lock while still looking at the
    // screen just because a few seconds passed without a tap" — but
    // that's what the elapsed-activity check below would do, since
    // with a 0ms timeout it's satisfied on literally the very next
    // 15s interval tick even while the user is actively reading the
    // current page. Skip it entirely for timeout=0 so only an actual
    // backgrounding event can lock.
    if (cmLockTimeoutMinutes() === 0) return false;

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

// The lock screen follows the app theme: dark for the dark themes,
// light otherwise (the theme script in <head> has already set
// data-theme by the time this runs).
function cmLockIsDark() {
    const theme = document.documentElement.getAttribute("data-theme");
    return theme === "dark" || theme === "darkgray";
}

function cmShowImmediateBlock() {

    const el = document.createElement("div");
    el.id = "cmLockImmediateBlock";
    el.setAttribute(
        "style",
        `position:fixed;inset:0;z-index:2147483647;background:${cmLockIsDark() ? "#0E1B3C" : "#F5F7FA"};`
    );
    (document.body || document.documentElement).appendChild(el);

}

// Fresh process start = sessionStorage has no record of this process
// having run before. Marks it (so later page loads in the same
// process — in-app navigation, or a background/foreground cycle that
// didn't actually kill the process — aren't treated as a relaunch)
// and reports whether this call is the one that found it unmarked.
function cmMarkAndCheckFreshProcessStart() {
    try {
        if (sessionStorage.getItem(SESSION_ALIVE_KEY)) return false;
        sessionStorage.setItem(SESSION_ALIVE_KEY, "1");
        return true;
    } catch {
        // sessionStorage unavailable — fail open to the pre-existing
        // (timeout-only) lock behavior rather than risk locking every
        // single page load.
        return false;
    }
}

function cmConsumeJustAuthenticated() {
    try {
        if (sessionStorage.getItem(JUST_AUTHENTICATED_KEY) === "1") {
            sessionStorage.removeItem(JUST_AUTHENTICATED_KEY);
            return true;
        }
    } catch {
        // ignore
    }
    return false;
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

let cmNeedsImmediateLock = cmShouldBeLocked();

// Closing the app fully and reopening it must always land on the PIN
// screen, regardless of how little time has passed — the inactivity
// timeout above is a separate policy for backgrounding without a real
// close. Skip this exactly once right after an actual login/unlock
// (goToDestination() in login.js sets the flag before navigating
// here), so a successful login doesn't immediately bounce back to a
// lock screen.
if (cmMarkAndCheckFreshProcessStart()) {
    const justAuthenticated = cmConsumeJustAuthenticated();
    if (!justAuthenticated && cmGetStoredUser().hasPin) {
        cmNeedsImmediateLock = true;
    }
}

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
.cm-lock-photo{width:88px;height:88px;box-shadow:0 0 0 4px rgba(212,175,55,.22);border-radius:50%;object-fit:cover;border:2px solid #D4AF37;background:#16223F;margin-bottom:14px;}
.cm-lock-greeting{color:#fff;font-size:17px;font-weight:600;text-align:center;margin-bottom:4px;}
.cm-lock-title{color:#b9c6e0;font-size:14px;text-align:center;margin-bottom:22px;}
.cm-lock-dots{display:flex;gap:18px;margin-bottom:10px;}
.cm-lock-dot{width:15px;height:15px;border-radius:50%;border:2px solid #FFD700;box-sizing:border-box;transition:background .15s,transform .15s;}
.cm-lock-dot.filled{background:#FFD700;transform:scale(1.15);}
.cm-lock-dot.error{border-color:#ff6b6b;background:#ff6b6b;}
.cm-lock-status{min-height:20px;color:#ff6b6b;font-size:13.5px;font-weight:600;text-align:center;margin-bottom:8px;}
.cm-lock-keypad{width:100%;max-width:320px;display:grid;grid-template-columns:repeat(3,1fr);justify-items:center;gap:18px;margin-top:6px;}
.cm-lock-key{width:72px;height:72px;border:none;border-radius:50%;background:rgba(255,255,255,.06);color:#fff;font-size:30px;font-weight:500;font-family:Arial,sans-serif;cursor:pointer;transition:background .15s,transform .1s;}
.cm-lock-key:active,.cm-lock-key.kbd-press{background:rgba(255,215,0,.18);transform:scale(.94);}
.cm-lock-key-back{background:transparent;display:flex;align-items:center;justify-content:center;}
.cm-lock-slot{display:flex;align-items:center;justify-content:center;}
.cm-lock-fp-btn{width:72px;height:72px;border-radius:50%;border:1.5px solid #FFD700;background:transparent;color:#FFD700;font-size:24px;cursor:pointer;}
.cm-lock-fp-btn svg{width:30px;height:30px;}
.cm-lock-fp-btn:active{background:rgba(255,215,0,.12);}
.cm-lock-links{display:flex;gap:22px;margin-top:26px;}
.cm-lock-link{color:#b9c6e0;font-size:13.5px;font-weight:600;cursor:pointer;}
.cm-lock-link:active{opacity:.7;}
@keyframes cmLockShake{0%,100%{transform:translateX(0);}20%{transform:translateX(-8px);}40%{transform:translateX(8px);}60%{transform:translateX(-6px);}80%{transform:translateX(6px);}}
.cm-lock-dots.shake{animation:cmLockShake .4s ease;}
:root:not([data-theme="dark"]):not([data-theme="darkgray"]) #cmLockOverlay{background:#F5F7FA;}
:root:not([data-theme="dark"]):not([data-theme="darkgray"]) .cm-lock-photo{background:#E8ECF3;}
:root:not([data-theme="dark"]):not([data-theme="darkgray"]) .cm-lock-greeting{color:#0E1B3C;}
:root:not([data-theme="dark"]):not([data-theme="darkgray"]) .cm-lock-title{color:#5A6478;}
:root:not([data-theme="dark"]):not([data-theme="darkgray"]) .cm-lock-dot{border-color:#D4AF37;}
:root:not([data-theme="dark"]):not([data-theme="darkgray"]) .cm-lock-dot.filled{background:#D4AF37;}
:root:not([data-theme="dark"]):not([data-theme="darkgray"]) .cm-lock-dot.error{border-color:#C0392B;background:#C0392B;}
:root:not([data-theme="dark"]):not([data-theme="darkgray"]) .cm-lock-status{color:#C0392B;}
:root:not([data-theme="dark"]):not([data-theme="darkgray"]) .cm-lock-key{background:#fff;color:#0E1B3C;box-shadow:0 1px 3px rgba(14,27,60,.10);border:1px solid #E2E6ED;}
:root:not([data-theme="dark"]):not([data-theme="darkgray"]) .cm-lock-key:active,:root:not([data-theme="dark"]):not([data-theme="darkgray"]) .cm-lock-key.kbd-press{background:rgba(212,175,55,.18);}
:root:not([data-theme="dark"]):not([data-theme="darkgray"]) .cm-lock-key-back{background:transparent;box-shadow:none;border:none;color:#0E1B3C;}
:root:not([data-theme="dark"]):not([data-theme="darkgray"]) .cm-lock-fp-btn{border-color:#D4AF37;color:#B8860B;}
:root:not([data-theme="dark"]):not([data-theme="darkgray"]) .cm-lock-link{color:#1A2E57;}
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
        // Backing out of (or timing out) the system prompt just leaves the
        // keypad ready — no red "Cancelled or timed out." under the dots.
        statusEl.innerText = (err && err.name === "NotAllowedError")
            ? ""
            : (err.message || t("login.msg.fingerprintFailed"));

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
                <span class="cm-lock-slot">
                    <button type="button" class="cm-lock-fp-btn" id="cmLockFpBtn" style="display:none;" aria-label="Fingerprint">
                        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M4 7V5a1 1 0 0 1 1-1h2"/>
                            <path d="M17 4h2a1 1 0 0 1 1 1v2"/>
                            <path d="M20 17v2a1 1 0 0 1-1 1h-2"/>
                            <path d="M7 20H5a1 1 0 0 1-1-1v-2"/>
                            <path d="M12 11c.8 0 1.5.7 1.5 1.5v2c0 1-.3 2-.8 2.8"/>
                            <path d="M9.5 16.5c.3-1 .5-2.1.5-3.2a3 3 0 0 1 6 0c0 .4 0 .8-.1 1.2"/>
                            <path d="M7.5 17.5c.5-1.5.8-3 .8-4.7a4.7 4.7 0 0 1 9.2-1.3"/>
                            <path d="M5.5 18.3c.8-2 1.3-4.1 1.3-6.3a6.2 6.2 0 0 1 11-3.9"/>
                        </svg>
                    </button>
                </span>
                <button type="button" class="cm-lock-key" data-digit="0">0</button>
                <button type="button" class="cm-lock-key cm-lock-key-back" id="cmLockBackspace" aria-label="Backspace"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 5H9l-6 7 6 7h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1z"/><path d="M17 9.5l-5 5M12 9.5l5 5"/></svg></button>
            </div>
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
    const cachedPhoto = user.username ? cmCachedPhoto(user.username) : "";
    if (cachedPhoto) {
        const img = el.querySelector("#cmLockPhoto");
        img.src = cachedPhoto;
        img.style.display = "block";
    }
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

    // Physical keyboard (desktop). Capture phase + stopPropagation so the
    // digits never reach a page input sitting behind the lock. Accepts
    // Khmer digits (Windows Khmer layout types ០-៩) and the numeric
    // keypad with Num Lock off (read from e.code).
    document.addEventListener("keydown", (e) => {
        if (!el.classList.contains("show")) return;
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        const k = e.key || "";
        let d = null;
        if (k === "Backspace" || k === "Delete") d = "back";
        else if (/^[0-9]$/.test(k)) d = k;
        else if (k.length === 1 && k.charCodeAt(0) >= 0x17E0 && k.charCodeAt(0) <= 0x17E9) d = String(k.charCodeAt(0) - 0x17E0);
        else {
            const m = /^(?:Numpad|Digit)([0-9])$/.exec(e.code || "");
            if (m && !e.shiftKey) d = m[1];
        }
        if (!d) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.repeat && d !== "back") return;
        const btn = d === "back"
            ? el.querySelector("#cmLockBackspace")
            : el.querySelector(`.cm-lock-key[data-digit="${d}"]`);
        if (!btn) return;
        btn.classList.add("kbd-press");
        setTimeout(() => btn.classList.remove("kbd-press"), 130);
        btn.click();
    }, true);

    // ----- fingerprint -----
    const username = user.username || "";
    // cm_fp_login_disabled_<username> is set by Settings' own quick
    // toggle when the user turns "Login with Fingerprint or Face" off
    // there — a local "don't use it" preference, deliberately separate
    // from actually removing the registered credential, so the switch
    // can be turned back on without a fresh enrollment. Still showing
    // the fingerprint button (or auto-triggering it) here while that
    // flag is set would make the toggle a no-op from the user's
    // perspective.
    fingerprintAvailable = cmDeviceHasFingerprint(username);

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

// Browsers also fire visibilitychange("hidden") right before a normal
// in-app page navigation unloads the current page — not just on an
// actual backgrounding (switching apps, hitting Home) — because the
// outgoing document briefly becomes "hidden" as the next one takes
// over. Reacting to "hidden" immediately made "Immediately" lock on
// every single page tap, not just on leaving the app. Deferred commit
// fixes it: only set the lock flag if the page is STILL hidden a
// moment later. A real navigation has already torn the page down
// (and this pending timer with it) by then; an actual backgrounding
// leaves the page alive and still hidden, so the timer still fires.
let cmHiddenLockTimer = null;

document.addEventListener("visibilitychange", () => {

    if (document.hidden) {
        // "Immediately" (0 minutes) is specifically about backgrounding,
        // not just elapsed time since the last tap — lock as soon as
        // the tab/app is confirmed hidden rather than waiting for the
        // next periodic check.
        if (cmLockTimeoutMinutes() === 0) {
            cmHiddenLockTimer = setTimeout(() => {
                cmHiddenLockTimer = null;
                if (document.hidden) {
                    try { localStorage.setItem(LOCK_ACTIVE_KEY, "1"); } catch {}
                }
            }, 300);
        }
        return;
    }

    if (cmHiddenLockTimer) {
        clearTimeout(cmHiddenLockTimer);
        cmHiddenLockTimer = null;
    }

    // Became visible again — re-check immediately rather than waiting
    // for the next interval tick, so returning from background locks
    // (or stays locked) right away instead of up to 15s late.
    cmCheckAndMaybeLock();

});

// =========================
// PROFILE PHOTO CACHE
// The photo endpoint needs a login token, so the login page and its PIN
// screen (logged out / token expired) can't fetch it. While logged in,
// keep a small (160px JPEG, ~10KB) copy on this device, refreshed at
// most once a day, for those screens to show.
// =========================

const CM_PHOTO_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function cmCachedPhoto(username) {
    try { return localStorage.getItem(`cm_user_photo_${username}`) || ""; } catch { return ""; }
}

async function cmRefreshPhotoCache() {
    const token = cmGetToken();
    const username = cmGetStoredUser().username;
    if (!token || !username || !window.API) return;

    let at = 0;
    try { at = Number(localStorage.getItem(`cm_user_photo_at_${username}`)) || 0; } catch {}
    if (Date.now() - at < CM_PHOTO_MAX_AGE_MS) return;

    try {
        const res = await fetch(`${API.BASE_URL}/assets/user-photo/${username}`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        if (!res.ok) {
            // No photo on file: remember that we checked, and drop any old copy.
            if (res.status === 404) {
                localStorage.removeItem(`cm_user_photo_${username}`);
                localStorage.setItem(`cm_user_photo_at_${username}`, String(Date.now()));
            }
            return;
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const img = await new Promise((resolve, reject) => {
            const i = new Image();
            i.onload = () => resolve(i);
            i.onerror = reject;
            i.src = url;
        });
        const size = 160;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        // centre-crop to a square
        const side = Math.min(img.naturalWidth, img.naturalHeight);
        const sx = (img.naturalWidth - side) / 2;
        const sy = (img.naturalHeight - side) / 2;
        canvas.getContext("2d").drawImage(img, sx, sy, side, side, 0, 0, size, size);
        URL.revokeObjectURL(url);
        localStorage.setItem(`cm_user_photo_${username}`, canvas.toDataURL("image/jpeg", 0.82));
        localStorage.setItem(`cm_user_photo_at_${username}`, String(Date.now()));
    } catch {
        // best-effort only
    }
}

window.addEventListener("load", () => {

    setTimeout(cmRefreshPhotoCache, 4000);

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
