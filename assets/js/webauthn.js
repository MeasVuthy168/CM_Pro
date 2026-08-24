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

function webauthnErrorMessage(err, fallback) {
    if (err && err.name === "NotAllowedError") return "Cancelled or timed out.";
    return (err && err.message) || fallback;
}

// ---- Registration (Settings page — already logged in) ----
async function webauthnRegister(deviceLabel) {
    const token = localStorage.getItem("token") || sessionStorage.getItem("token");

    const optRes = await fetch(`${API.BASE_URL}/api/webauthn/register/options`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` }
    });
    const optData = await optRes.json();
    if (!optData.ok) throw new Error(optData.message || "Could not start registration.");

    const publicKey = webauthnOptionsFromJSON(optData.options, true);

    let credential;
    try {
        credential = await navigator.credentials.create({ publicKey });
    } catch (err) {
        throw new Error(webauthnErrorMessage(err, "Registration failed."));
    }
    if (!credential) throw new Error("Registration failed.");

    const verifyRes = await fetch(`${API.BASE_URL}/api/webauthn/register/verify`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
            deviceLabel: deviceLabel || "",
            response: webauthnCredentialToJSON(credential, true)
        })
    });
    const verifyData = await verifyRes.json();
    if (!verifyData.ok) throw new Error(verifyData.message || "Could not verify registration.");

    return true;
}

async function webauthnListCredentials() {
    const token = localStorage.getItem("token") || sessionStorage.getItem("token");

    const res = await fetch(`${API.BASE_URL}/api/webauthn/credentials`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.message || "Could not load registered devices.");
    return data.credentials;
}

async function webauthnRemoveCredential(credentialId) {
    const token = localStorage.getItem("token") || sessionStorage.getItem("token");

    const res = await fetch(`${API.BASE_URL}/api/webauthn/credentials/${encodeURIComponent(credentialId)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.message || "Could not remove device.");
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
    if (!optData.ok) throw new Error(optData.message || "No fingerprint registered for this account.");

    const publicKey = webauthnOptionsFromJSON(optData.options, false);

    let credential;
    try {
        credential = await navigator.credentials.get({ publicKey });
    } catch (err) {
        throw new Error(webauthnErrorMessage(err, "Login failed."));
    }
    if (!credential) throw new Error("Login failed.");

    const verifyRes = await fetch(`${API.BASE_URL}/api/webauthn/login/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            username,
            response: webauthnCredentialToJSON(credential, false)
        })
    });
    const verifyData = await verifyRes.json();
    if (!verifyData.ok) throw new Error(verifyData.message || "Fingerprint login failed.");

    return verifyData;
}
