/* =====================================================
   admin-loader.js
   Runs FIRST (before any dashboard code) to gate the page
   to logged-in ADMIN users only. Theme flash-prevention is
   handled by the inline snippet + shared/theme.js per your
   existing convention — this file only does auth.

   Matches your real login.js / api.js:
     - token lives in localStorage.token OR sessionStorage.token
       (localStorage if "Remember Me" was checked, else sessionStorage)
     - user role is embedded in the JWT payload (server signs it),
       with localStorage.loggedInUser as a fallback source
   ===================================================== */
const CM_ADMIN_CONFIG = {
  loginPage: "/CM_Pro/login.html"
};

function cmGetToken() {
  try {
    return localStorage.getItem("token") || sessionStorage.getItem("token");
  } catch (e) {
    return null;
  }
}

function cmGetStoredUser() {
  try {
    return JSON.parse(localStorage.getItem("loggedInUser") || "{}");
  } catch (e) {
    return {};
  }
}

/* ---- JWT decode (no external lib — just base64url -> JSON) ---- */
function cmDecodeJwt(token) {
  try {
    const payload = token.split(".")[1];
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(
      atob(base64)
        .split("")
        .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
        .join("")
    );
    return JSON.parse(json);
  } catch (e) {
    return null;
  }
}

function cmRedirectToLogin(reason) {
  console.warn("Admin dashboard access denied:", reason);
  const next = encodeURIComponent(location.pathname);
  location.replace(`${CM_ADMIN_CONFIG.loginPage}?next=${next}`);
}

/* ---- Run the guard immediately ---- */
const CMAdmin = (function guard() {
  const token = cmGetToken();

  if (!token) {
    cmRedirectToLogin("no token found");
    return null;
  }

  const payload = cmDecodeJwt(token);
  if (!payload) {
    cmRedirectToLogin("token could not be decoded");
    return null;
  }

  if (payload.exp && Date.now() >= payload.exp * 1000) {
    cmRedirectToLogin("token expired");
    return null;
  }

  const storedUser = cmGetStoredUser();
  // JWT role is authoritative (server-signed); loggedInUser is a fallback only.
  const role = String(payload.role || storedUser.role || "").toLowerCase();
  if (role !== "admin") {
    cmRedirectToLogin(`role '${role}' is not admin`);
    return null;
  }

  return {
    token,
    username: payload.username || storedUser.username || "",
    fullname: payload.fullname || storedUser.fullname || "",
    role
  };
})();

// Expose for admin.js to use — if CMAdmin is null, a redirect is already in flight.
window.CMAdmin = CMAdmin;
window.CM_ADMIN_CONFIG = CM_ADMIN_CONFIG;
