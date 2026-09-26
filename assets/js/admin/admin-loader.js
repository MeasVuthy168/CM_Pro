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

/* ---- Run the guard through the server session ---- */
(async function guardAdmin() {
  try {
    const response = await fetch(
      "https://cm-backend-new.onrender.com/api/auth/me",
      {
        credentials: "include",
        headers: { "X-CM-Client": "CM_Pro-Web" }
      }
    );

    if (!response.ok) {
      cmRedirectToLogin("authentication failed");
      return;
    }

    const data = await response.json();
    const user = data.user || {};
    const role = String(user.role || "").toLowerCase();

    if (!data.ok || role !== "admin") {
      cmRedirectToLogin("admin role required");
      return;
    }

    window.CMAdmin = {
      username: user.username || "",
      fullname: user.fullname || "",
      role
    };
    window.CM_ADMIN_CONFIG = CM_ADMIN_CONFIG;
  } catch (e) {
    cmRedirectToLogin("session check failed");
  }
})();
