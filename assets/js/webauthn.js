// ===========================================
// WebAuthn (fingerprint / Face ID) helpers
// Hand-rolled base64url<->ArrayBuffer conversion rather than pulling in
// @simplewebauthn/browser as a new CDN dependency (this app already has
// several unpinned CDN scripts flagged as a supply-chain risk — no point
// adding another one for boilerplate this small). The conversion below
// matches the WebAuthn spec's own JSON serialization shapes exactly
// (PublicKeyCredentialCreationOptionsJSON / RegistrationResponseJSON /
// etc. — the same shapes @simplewebauthn/server's generate*/verify*
// functions on the backend produce and expect), verified against the
// actual installed library version rather than assumed from memory.
// ===========================================

function isWebAuthnAvailable() {
    return !!(window.PublicKeyCredential && navigator.credentials);
}

function webauthnBase64urlToBuffer(base64url) {
    const padding = "=".repeat((4 - (base64url.length % 4)) % 4);
    const base64 = (base64url + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(base64);
    const buffer = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) buffer[i] = raw.charCodeAt(i);
    return buffer.buffer;
}

function webauthnBufferToBase64url(buffer) {
    const bytes = new Uint8Array(buffer);
    let str = "";
    for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
    return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Converts the JSON options the server sends into the ArrayBuffer-based
// shape navigator.credentials.create()/get() actually require.
function webauthnOptionsFromJSON(options, isRegistration) {
    const out = { ...options };
    out.challenge = webauthnBase64urlToBuffer(options.challenge);

    if (isRegistration) {
        out.user = { ...options.user, id: webauthnBase64urlToBuffer(options.user.id) };
    }

    const listKey = isRegistration ? "excludeCredentials" : "allowCredentials";
    if (Array.isArray(options[listKey])) {
        out[listKey] = options[listKey].map((c) => ({ ...c, id: webauthnBase64urlToBuffer(c.id) }));
    }

    return out;
}

// Converts the PublicKeyCredential the browser returns back into the
// base64url JSON shape the server's verify*Response() functions expect.
function webauthnCredentialToJSON(credential, isRegistration) {
    const response = credential.response;

    const out = {
        id: credential.id,
        rawId: webauthnBufferToBase64url(credential.rawId),
        type: credential.type,
        clientExtensionResults: credential.getClientExtensionResults
            ? credential.getClientExtensionResults()
            : {},
        response: {
            clientDataJSON: webauthnBufferToBase64url(response.clientDataJSON)
        }
    };

    if (isRegistration) {
        out.response.attestationObject = webauthnBufferToBase64url(response.attestationObject);
        if (response.getTransports) out.response.transports = response.getTransports();
    } else {
        out.response.authenticatorData = webauthnBufferToBase64url(response.authenticatorData);
        out.response.signature = webauthnBufferToBase64url(response.signature);
        if (response.userHandle && response.userHandle.byteLength) {
            out.response.userHandle = webauthnBufferToBase64url(response.userHandle);
        }
    }

    return out;
}

function webauthnT(key) {
    return window.CMI18n ? CMI18n.t(key) : key;
}

function webauthnErrorMessage(err, fallbackKey) {
    if (err && err.name === "NotAllowedError") return webauthnT("webauthn.cancelled");
    // Thrown by the browser itself (before any server round-trip) when
    // excludeCredentials matches an authenticator already registered on
    // this device — i.e. the toggle's local "is this device registered"
    // tracking fell out of sync with what the server/authenticator
    // actually has. settings-account.js catches this by name and
    // re-syncs instead of just surfacing the raw browser message.
    if (err && err.name === "InvalidStateError") return webauthnT("webauthn.alreadyRegistered");
    return (err && err.message) || webauthnT(fallbackKey);
}

// ---- Registration (Settings page — already logged in) ----
// deviceLabel may be a plain string, OR a function (sync or async)
// called AFTER navigator.credentials.create() succeeds, to resolve the
// label. That ordering matters: iOS Safari only allows
// navigator.credentials.create() within a short window of the user's
// tap, and a blocking prompt() dialog beforehand — which can run for
// many seconds while the person actually types a name — reliably
// burns through that window before create() is even called, even
// though the exact same flow (prompt, then create()) works fine on
// Android/Chrome, which is far more lenient here. Asking for the
// label after create() has already succeeded keeps the tap-to-create()
// gap down to just the one options fetch below.
async function webauthnRegister(deviceLabel) {
    const token = localStorage.getItem("token") || sessionStorage.getItem("token");

    const optRes = await fetch(`${API.BASE_URL}/api/webauthn/register/options`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` }
    });
    const optData = await optRes.json();
    if (!optData.ok) throw new Error(optData.message || webauthnT("webauthn.registerStartFailed"));

    const publicKey = webauthnOptionsFromJSON(optData.options, true);

    let credential;
    try {
        credential = await navigator.credentials.create({ publicKey });
    } catch (err) {
        // Preserve the original DOMException name (e.g.
        // "InvalidStateError") as .code — callers that need to tell
        // "already registered" apart from other failures (settings-
        // account.js's self-heal retry) would otherwise only see a
        // generic Error with a translated, language-dependent message.
        const wrapped = new Error(webauthnErrorMessage(err, "webauthn.registerFailed"));
        wrapped.code = err && err.name;
        throw wrapped;
    }
    if (!credential) throw new Error(webauthnT("webauthn.registerFailed"));

    const resolvedLabel = typeof deviceLabel === "function"
        ? await deviceLabel()
        : (deviceLabel || "");

    const verifyRes = await fetch(`${API.BASE_URL}/api/webauthn/register/verify`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
            deviceLabel: resolvedLabel,
            response: webauthnCredentialToJSON(credential, true)
        })
    });
    const verifyData = await verifyRes.json();
    if (!verifyData.ok) throw new Error(verifyData.message || webauthnT("webauthn.verifyFailed"));

    // credential.id is the same base64url value the server stored as
    // credentialID — callers that need to recognize "this device" later
    // (e.g. a quick on/off toggle, settings-account.js) can hang onto it.
    return credential.id;
}

// Best-effort: remove every credential the server has for this
// account. Used when there's no reliable way to target just one
// device's credential (see webauthnRegisterWithRecovery below, and
// settings-account.js's quick toggle when it has no locally-tracked
// id to remove) -- the authenticator itself can end up with a
// credential the server knows about that a particular browser's own
// storage doesn't (a prior registration attempt that errored out
// client-side after the server had already finished it, a leftover
// from testing, cleared site data, a different build), and WebAuthn
// gives no way to ask the authenticator which credential id it
// already has. Callers only use this where clearing everything is
// the reasonable, user-intended outcome: an explicit "turn it off",
// or a registration attempt that just proved this exact authenticator
// already has *something* registered.
async function webauthnRemoveAllCredentials() {
    try {
        const devices = await webauthnListCredentials();
        for (const d of devices) {
            await webauthnRemoveCredential(d.id);
        }
    } catch {
        // offline, etc. -- caller proceeds regardless
    }
}

// Wraps webauthnRegister with one self-heal retry: if this
// authenticator says it already has a credential for this account
// (InvalidStateError), that's the "already registered" dead end a
// plain retry can't recover from on its own -- clear every credential
// the server has for this account and register again, instead of
// leaving the caller stuck on an error with no way to act on it.
async function webauthnRegisterWithRecovery(deviceLabel) {
    try {
        return await webauthnRegister(deviceLabel);
    } catch (err) {
        if (err && err.code === "InvalidStateError") {
            await webauthnRemoveAllCredentials();
            return webauthnRegister(deviceLabel);
        }
        throw err;
    }
}

async function webauthnListCredentials() {
    const token = localStorage.getItem("token") || sessionStorage.getItem("token");

    const res = await fetch(`${API.BASE_URL}/api/webauthn/credentials`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.message || webauthnT("webauthn.loadDevicesFailed"));
    return data.credentials;
}

async function webauthnRemoveCredential(credentialId) {
    const token = localStorage.getItem("token") || sessionStorage.getItem("token");

    const res = await fetch(`${API.BASE_URL}/api/webauthn/credentials/${encodeURIComponent(credentialId)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.message || webauthnT("webauthn.removeDeviceFailed"));
    return true;
}

// ---- Login (login page — no token yet) ----
async function webauthnLogin(username) {
    const optRes = await fetch(`${API.BASE_URL}/api/webauthn/login/options`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username })
    });
    const optData = await optRes.json();
    if (!optData.ok) throw new Error(optData.message || webauthnT("webauthn.noFingerprint"));

    const publicKey = webauthnOptionsFromJSON(optData.options, false);

    let credential;
    try {
        credential = await navigator.credentials.get({ publicKey });
    } catch (err) {
        throw new Error(webauthnErrorMessage(err, "webauthn.loginFailed"));
    }
    if (!credential) throw new Error(webauthnT("webauthn.loginFailed"));

    const verifyRes = await fetch(`${API.BASE_URL}/api/webauthn/login/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            username,
            response: webauthnCredentialToJSON(credential, false)
        })
    });
    const verifyData = await verifyRes.json();
    if (!verifyData.ok) throw new Error(verifyData.message || webauthnT("login.msg.fingerprintFailed"));

    return verifyData;
}

// ---- Unlock (App Lock overlay — already has a valid token) ----
// Deliberately separate from webauthnLogin above: the /unlock/options
// and /unlock/verify endpoints require the existing token (requireJwt)
// and issue no new one, so a successful unlock can never silently
// extend/reset the session's real expiry the way a fresh login would.
async function webauthnUnlock() {
    const token = localStorage.getItem("token") || sessionStorage.getItem("token");

    const optRes = await fetch(`${API.BASE_URL}/api/webauthn/unlock/options`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` }
    });
    const optData = await optRes.json();
    if (!optData.ok) throw new Error(optData.message || webauthnT("webauthn.noFingerprint"));

    const publicKey = webauthnOptionsFromJSON(optData.options, false);

    let credential;
    try {
        credential = await navigator.credentials.get({ publicKey });
    } catch (err) {
        throw new Error(webauthnErrorMessage(err, "webauthn.loginFailed"));
    }
    if (!credential) throw new Error(webauthnT("webauthn.loginFailed"));

    const verifyRes = await fetch(`${API.BASE_URL}/api/webauthn/unlock/verify`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
            response: webauthnCredentialToJSON(credential, false)
        })
    });
    const verifyData = await verifyRes.json();
    if (!verifyData.ok) throw new Error(verifyData.message || webauthnT("login.msg.fingerprintFailed"));

    return true;
}
