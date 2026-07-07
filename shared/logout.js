// =========================
// LOGOUT
// Shared across the app — call from any page (topbar, settings,
// account, etc.) instead of redefining this inline each time.
// =========================

function logout(){

    if(confirm("Logout CM_Pro ?")){

        localStorage.removeItem("token");

        localStorage.removeItem("loggedInUser");

        sessionStorage.clear();

        window.location.replace("/CM_Pro/login.html");

    }

}
