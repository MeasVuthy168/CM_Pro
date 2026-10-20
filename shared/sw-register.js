// =========================
// SERVICE WORKER REGISTRATION
// Every page registers the worker (it used to happen only when push
// notifications were turned on), so page files come from its cache
// and changing pages is instant. Registered after load so it never
// competes with the page's own requests. Same URL and scope as
// config/push.js, so both refer to the one registration.
// =========================

(function () {
    if (!("serviceWorker" in navigator)) return;
    window.addEventListener("load", function () {
        navigator.serviceWorker.register("/CM_Pro/service-worker.js").catch(function (e) {
            console.warn("service worker registration failed:", e);
        });
    });
})();
