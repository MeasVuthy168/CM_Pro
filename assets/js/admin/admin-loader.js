const CM_ADMIN_CONFIG = {
  loginPage: "/CM_Pro/login.html"
};


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
