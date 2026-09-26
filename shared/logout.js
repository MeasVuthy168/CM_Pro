// =========================
// LOGOUT
// Shared across the app — call from any page (topbar, settings,
// account, etc.) instead of redefining this inline each time.
// =========================

async function logout(){

    if(confirm("Logout CM_Pro ?")){

        try{
            await fetch("https://cm-backend-new.onrender.com/api/auth/logout", {
                method: "POST",
                credentials: "include",
                headers: (typeof API !== "undefined") ? API.authHeaders() : { "X-CM-Client": "CM_Pro-Web" }
            });
        }catch(e){
            console.warn("Logout request failed:", e);
        }

        localStorage.removeItem("token");
        localStorage.removeItem("cm_ios_token");
        localStorage.removeItem("loggedInUser");
        sessionStorage.clear();

        window.location.replace("/CM_Pro/login.html");

    }

}
