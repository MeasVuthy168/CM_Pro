// =========================
// SERVICE WORKER REGISTRATION
// Every page registers the worker (it used to happen only when push
// notifications were turned on), so page files come from its cache
// and changing pages is instant. Registered after load so it never
// competes with the page's own requests. Same URL and scope as
// config/push.js, so both refer to the one registration.
//
// A new SW version activates itself (skipWaiting + clients.claim in
// service-worker.js), but a page already open keeps running the
// files it already loaded under the old controller — without this
// listener a user needed a second reload before anything new
// actually showed up. Reloading once, automatically, the moment the
// controller changes makes a single reload (or reopening the app)
// enough. registration.update() also asks the browser to re-check
// the script right away instead of waiting for its own interval.
// =========================

(function () {
    if (!("serviceWorker" in navigator)) return;

    let reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", function () {
        if (reloaded) return;
        reloaded = true;
        location.reload();
    });

    window.addEventListener("load", function () {
        navigator.serviceWorker.register("/CM_Pro/service-worker.js").then(function (registration) {
            registration.update().catch(function () {});
        }).catch(function (e) {
            console.warn("service worker registration failed:", e);
        });
    });
})();
