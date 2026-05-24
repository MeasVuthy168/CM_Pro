// =========================
// AUTH CHECK
// =========================

const token =

    localStorage.getItem("token") ||

    sessionStorage.getItem("token");

if(!token){

    window.location.replace(
        "/CM_Pro/login.html"
    );

}
