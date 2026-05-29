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

    // REMOVE TOKEN ONLY

    localStorage.removeItem(
        "token"
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
