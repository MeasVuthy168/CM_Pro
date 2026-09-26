// =========================
// AUTO LOGOUT TIMER
// =========================

const SESSION_TIMEOUT =
    10 * 60 * 1000;

// 1 minute test

let inactivityTimer;

// =========================
// RESET TIMER
// =========================

function resetSessionTimer(){

    clearTimeout(
        inactivityTimer
    );

    inactivityTimer = setTimeout(

        autoLogout,

        SESSION_TIMEOUT

    );

}

// =========================
// AUTO LOGOUT
// =========================

function autoLogout(){

    alert(
        "Session expired due to inactivity"
    );

    // Invalidate the server-side session cookie too — otherwise it
    // stays valid (up to its 12h Max-Age) even after this device
    // gives up on it locally. No confirm() here (unlike shared/
    // logout.js's logout()) since this fires automatically, not from
    // a user click.
    fetch("https://cm-backend-new.onrender.com/api/auth/logout", {
        method: "POST",
        credentials: "include",
        headers: (typeof API !== "undefined") ? API.authHeaders() : { "X-CM-Client": "CM_Pro-Web" }
    }).catch(()=>{});

    localStorage.removeItem(
        "cm_ios_token"
    );

    localStorage.removeItem(
        "loggedInUser"
    );

    sessionStorage.clear();

    // KEEP remember_login

    window.location.replace(
        "/CM_Pro/login.html"
    );

}

// =========================
// TRACK USER ACTIVITY
// =========================

[
    "click",
    "touchstart",
    "mousemove",
    "keydown",
    "scroll"
].forEach(eventType => {

    document.addEventListener(

        eventType,

        resetSessionTimer,

        true

    );

});

// =========================
// START TIMER
// =========================

console.log(
    "Session timeout started"
);

resetSessionTimer();
