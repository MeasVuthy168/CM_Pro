// =========================
// AUTH CHECK
// =========================
// JWT is held in an HttpOnly cookie. JavaScript deliberately cannot
// inspect or decode it. The server is authoritative about authentication
// and role, so validate the session through /api/auth/me.

(async function checkAuth(){
    try {
        const response = await fetch(
            "https://cm-backend-new.onrender.com/api/auth/me",
            {
                credentials: "include",
                headers: { "X-CM-Client": "CM_Pro-Web" }
            }
        );

        if (!response.ok) {
            window.location.replace("/CM_Pro/login.html");
            return;
        }

        const data = await response.json();
        if (!data.ok || !data.user) {
            window.location.replace("/CM_Pro/login.html");
        }
    } catch (err) {
        console.error("Auth check failed:", err);
        window.location.replace("/CM_Pro/login.html");
    }
})();
