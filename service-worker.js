const CM_PRO_CHANNEL = new BroadcastChannel("cm-pro-notifications");

console.log("🔥 SERVICE WORKER LOADED");

/* =========================================================
   CM_Pro – Production Service Worker
========================================================= */

const SW_VERSION = "v619";

const CACHE_NAME = `cm-pro-cache-${SW_VERSION}`;

// =========================================================
// APP SHELL — precached on install so the first open of Home and
// the three tabs after an update is already instant. Every other
// /CM_Pro/ file is cached the first time it's loaded (see FETCH).
// A missing file here never blocks the install (allSettled below).
// =========================================================

const STATIC_ASSETS = [

    "/CM_Pro/",
    "/CM_Pro/index.html",
    "/CM_Pro/login.html",
    "/CM_Pro/manifest.json",
    "/CM_Pro/pages/settings/index.html",
    "/CM_Pro/pages/notifications/index.html",

    "/CM_Pro/components/topbar.html",
    "/CM_Pro/components/bottomnav.html",

    "/CM_Pro/assets/css/main.css",
    "/CM_Pro/assets/css/base.css",
    "/CM_Pro/assets/css/variables.css",
    "/CM_Pro/assets/css/layout.css",
    "/CM_Pro/assets/css/mobile.css",
    "/CM_Pro/assets/css/animation.css",
    "/CM_Pro/assets/css/dashboard.css",
    "/CM_Pro/assets/css/cards.css",
    "/CM_Pro/assets/css/bottomnav.css",
    "/CM_Pro/assets/css/topbar.css",
    "/CM_Pro/assets/css/assistant.css",
    "/CM_Pro/assets/css/page.css",
    "/CM_Pro/assets/css/toast.css",
    "/CM_Pro/assets/css/offline-banner.css",
    "/CM_Pro/assets/css/loading.css",
    "/CM_Pro/assets/css/global-splash.css",
    "/CM_Pro/assets/css/settings.css",
    "/CM_Pro/assets/css/notification.css",
    "/CM_Pro/assets/fonts/Krasar-Regular.ttf",

    "/CM_Pro/config/api.js",
    "/CM_Pro/config/auth.js",
    "/CM_Pro/config/session.js",
    "/CM_Pro/config/push.js",
    "/CM_Pro/shared/page-transition.js",
    "/CM_Pro/shared/sw-register.js",
    "/CM_Pro/shared/touch-polish.js",
    "/CM_Pro/shared/theme.js",
    "/CM_Pro/shared/language.js",
    "/CM_Pro/shared/i18n.js",
    "/CM_Pro/shared/i18n/common.js",
    "/CM_Pro/shared/i18n/core.js",
    "/CM_Pro/shared/i18n/settings.js",
    "/CM_Pro/shared/i18n/assistant.js",
    "/CM_Pro/shared/loading.js",
    "/CM_Pro/shared/logout.js",
    "/CM_Pro/shared/topbar.js",
    "/CM_Pro/assets/js/dashboard.js",
    "/CM_Pro/assets/js/toast.js",
    "/CM_Pro/assets/js/global-splash.js",
    "/CM_Pro/assets/js/notification-badge.js",
    "/CM_Pro/assets/js/notification.js",
    "/CM_Pro/assets/js/notification-loader.js",
    "/CM_Pro/assets/js/settings.js",
    "/CM_Pro/assets/js/assistant-box.js",
    "/CM_Pro/assets/js/robot-embed.js",

    "/CM_Pro/assets/images/LogoAC.png",
    "/CM_Pro/assets/images/icon-192.png",
    "/CM_Pro/assets/images/icon-512.png",

    "/CM_Pro/assets/icons/menu/customer-search.png",
    "/CM_Pro/assets/icons/menu/daily-arrears.png",
    "/CM_Pro/assets/icons/menu/average-turnover.png",
    "/CM_Pro/assets/icons/menu/spot-check.png",
    "/CM_Pro/assets/icons/menu/master-data.png",
    "/CM_Pro/assets/icons/menu/land-classification.png",
    "/CM_Pro/assets/icons/menu/credit-report.png",
    "/CM_Pro/assets/icons/menu/loan-calculator.png",
    "/CM_Pro/assets/icons/menu/retirement-left.png",
    "/CM_Pro/assets/icons/menu/customer-search-dark.png",
    "/CM_Pro/assets/icons/menu/daily-arrears-dark.png",
    "/CM_Pro/assets/icons/menu/average-turnover-dark.png",
    "/CM_Pro/assets/icons/menu/spot-check-dark.png",
    "/CM_Pro/assets/icons/menu/master-data-dark.png",
    "/CM_Pro/assets/icons/menu/land-classification-dark.png",
    "/CM_Pro/assets/icons/menu/credit-report-dark.png",
    "/CM_Pro/assets/icons/menu/loan-calculator-dark.png",
    "/CM_Pro/assets/icons/menu/retirement-left-dark.png",

];

// Pinned-version CDN libraries (xlsx, jsPDF, Leaflet, Chart.js…):
// their URLs never change content, so they're served cache-first.
const CDN_HOSTS = [
    "cdnjs.cloudflare.com",
    "cdn.jsdelivr.net",
    "unpkg.com"
];

// =========================================================
// INSTALL
// =========================================================

self.addEventListener(

    "install",

    (event)=>{

        console.log(
            "✅ SW Installed:",
            SW_VERSION
        );

        // cache:"reload" skips the browser's HTTP cache, so a new
        // version never precaches the previous deploy's files.
        event.waitUntil(

            caches.open(CACHE_NAME)

                .then(cache=>Promise.allSettled(

                    STATIC_ASSETS.map(url=>
                        cache.add(new Request(url,{ cache:"reload" }))
                    )

                ))

        );

        self.skipWaiting();

    }

);

// =========================================================
// ACTIVATE
// =========================================================

self.addEventListener(

    "activate",

    (event)=>{

        console.log(
            "✅ SW Activated:",
            SW_VERSION
        );

        event.waitUntil(

            (async ()=>{

                // =========================
                // DELETE OLD CACHE
                // =========================

                const keys =
                    await caches.keys();

                await Promise.all(

                    keys.map(key=>{

                        if(
                            key !== CACHE_NAME
                        ){

                            console.log(
                                "🗑 Delete old cache:",
                                key
                            );

                            return caches.delete(
                                key
                            );

                        }

                    })

                );

                // =========================
                // TAKE CONTROL
                // =========================

                await self.clients.claim();

            })()

        );

    }

);

// =========================================================
// FETCH
// Same-origin /CM_Pro/ files: stale-while-revalidate inside the
// versioned cache — answered from the cache straight away (instant
// page changes), then re-checked with the server in the background
// so the next load has whatever is live. Each deploy bumps
// SW_VERSION, which starts a fresh cache, so a new version never
// mixes with the previous deploy's files; the background re-check
// covers a file changed without a bump (one load behind at most).
// (A plain cache-first used to serve old files forever — this is
// why every hit is still re-checked.)
// CDN libraries: cache-first (pinned versions).
// Everything else (the API, map tiles, Google Fonts): not touched.
// =========================================================

// A file re-checked this recently isn't re-checked again — one
// page load asks for the same files a few times.
const REVALIDATE_GAP_MS = 30 * 1000;
const lastRevalidated = new Map();

function cacheKeyFor(request){

    // Pages are cached without their query string (?from=…, ?tab=…)
    // so every variant of a page shares one entry.
    if(request.mode === "navigate"){

        const url = new URL(request.url);

        return url.origin + url.pathname;

    }

    return request;

}

function cacheable(response){

    return response &&
        response.status === 200 &&
        response.type === "basic" &&
        !response.redirected;

}

async function revalidate(request, cache, force){

    const key = cacheKeyFor(request);
    const id = typeof key === "string" ? key : key.url;

    const last = lastRevalidated.get(id) || 0;
    if(!force && Date.now() - last < REVALIDATE_GAP_MS) return null;
    lastRevalidated.set(id, Date.now());

    try{

        // cache:"no-cache" → conditional request, a cheap 304 when
        // unchanged (and it skips GitHub Pages' max-age=600).
        const response = await fetch(request,{ cache:"no-cache" });

        if(cacheable(response)){

            await cache.put(key, response.clone());

        }

        return response;

    }catch(err){

        lastRevalidated.delete(id);

        throw err;

    }

}

async function staleWhileRevalidate(event){

    const request = event.request;
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(cacheKeyFor(request));

    if(cached){

        event.waitUntil(revalidate(request, cache).catch(()=>{}));

        return cached;

    }

    try{

        return await revalidate(request, cache, true);

    }catch(err){

        if(request.mode === "navigate"){

            return (await cache.match("/CM_Pro/login.html")) || Response.error();

        }

        return Response.error();

    }

}

async function cacheFirst(request){

    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);

    if(cached) return cached;

    const response = await fetch(request);

    // CDN scripts without crossorigin come back opaque — still
    // safe to keep for a pinned URL.
    if(response && (response.ok || response.type === "opaque")){

        cache.put(request, response.clone());

    }

    return response;

}

self.addEventListener(

    "fetch",

    (event)=>{

        const request = event.request;

        if(request.method !== "GET") return;

        if(!request.url.startsWith("http")) return;

        const url = new URL(request.url);

        if(url.origin === self.location.origin){

            if(!url.pathname.startsWith("/CM_Pro/")) return;

            if(url.pathname.endsWith("/service-worker.js")) return;

            event.respondWith(staleWhileRevalidate(event));

            return;

        }

        if(CDN_HOSTS.includes(url.hostname)){

            event.respondWith(cacheFirst(request));

        }

    }

);

// =========================================================
// SAFE JSON
// =========================================================

function toJSONSafe(text){

    try{

        return JSON.parse(text);

    }catch{

        return {
            body: text || ""
        };

    }

}

// =========================================================
// BUILD NOTIFICATION
// =========================================================

function buildOptions(data){

    console.log(
        "PUSH DATA:",
        data
    );

    const uploadedBy =

        data.createdBy ||

        data.uploadedBy ||

        data.username ||

        data.fullname ||

        "System";

    return {

    body:

`By ${uploadedBy} • ${data.body || ""}`,

    icon:
        "/CM_Pro/assets/images/LogoAC.png",

    badge:
        "/CM_Pro/assets/images/icon-192.png",

    image:"",

    vibrate:[200,100,200],

    tag:
        `cm-pro-${Date.now()}`,

    renotify:false,

    timestamp:Date.now(),

    requireInteraction:false,

    data:{

        url:
            data.url ||
            "/CM_Pro/index.html",

        moduleCode:
            data.moduleCode || "",

        createdBy:
            uploadedBy,

        createdAt:
            data.createdAt || ""

    }

};

}

// =========================================================
// INDEXEDDB CATCH-UP QUEUE
// =========================================================
// iOS freezes ALL JavaScript for a backgrounded/closed PWA —
// no postMessage, no BroadcastChannel, nothing runs. So a
// notification that arrives while the app is backgrounded can
// never trigger a live in-page toast; the system banner is the
// only thing that can appear in that moment. IndexedDB is the
// one thing both the Service Worker and the page can read/write
// even when the page isn't currently open, so every notification
// gets stashed here. When the page next loads, it flushes this
// queue and shows a toast for anything that never got delivered
// live — the closest honest approximation to "the toast appears"
// for the backgrounded/closed case.

const IDB_NAME = "cmProNotifications";

const IDB_STORE = "pending";

function idbOpen(){

    return new Promise((resolve, reject)=>{

        const req = indexedDB.open(IDB_NAME, 1);

        req.onupgradeneeded = () => {

            const db = req.result;

            if(!db.objectStoreNames.contains(IDB_STORE)){

                db.createObjectStore(IDB_STORE, { keyPath:"id" });

            }

        };

        req.onsuccess = () => resolve(req.result);

        req.onerror = () => reject(req.error);

    });

}

async function idbAddPending(entry){

    try{

        const db = await idbOpen();

        await new Promise((resolve, reject)=>{

            const tx = db.transaction(IDB_STORE, "readwrite");

            tx.objectStore(IDB_STORE).put(entry);

            tx.oncomplete = () => resolve();

            tx.onerror = () => reject(tx.error);

        });

    }catch(err){

        console.error("⚠️ idbAddPending failed:", err);

    }

}

// =========================================================
// PUSH
// =========================================================
// IMPORTANT: event.data (PushMessageData) must be read EXACTLY
// ONCE. Chrome/Android tolerates calling .text()/.json() on it
// multiple times, but WebKit's push implementation (Safari 16.4+)
// can throw or return empty on a second/third read of the same
// payload — similar to how a fetch Response body can only be
// consumed once. Reading it twice on iOS can throw *before*
// event.waitUntil() is ever reached, silently skipping both the
// system notification and the postMessage to the page (which is
// what drives the in-app toast). Fix: read the raw text once,
// then parse that string in plain JS from then on.

self.addEventListener(

    "push",

    (event)=>{

        console.log("📩 PUSH RECEIVED");

        // ==================================================
        // DIAGNOSTIC PING #1 (BroadcastChannel) — this does
        // NOT depend on clients.matchAll() finding the page,
        // so it should reach the page even if that lookup is
        // failing on iOS. If THIS shows up but the old
        // matchAll-based ping never did, that confirms
        // matchAll() is the broken link on this device.
        // ==================================================

        try{

            CM_PRO_CHANNEL.postMessage({

                type:"PUSH_DEBUG",

                stage:"push-event-fired (broadcast)",

                time:new Date().toISOString()

            });

        }catch(err){

            console.error("BroadcastChannel post failed:", err);

        }

        // ==================================================
        // DIAGNOSTIC PING #1b (old method, kept for comparison)
        // ==================================================

        event.waitUntil(

            self.clients.matchAll({

                type:"window",

                includeUncontrolled:true

            }).then(clients=>{

                clients.forEach(client=>{

                    client.postMessage({

                        type:"PUSH_DEBUG",

                        stage:"push-event-fired",

                        time:new Date().toISOString()

                    });

                });

            }).catch(()=>{})

        );

        let rawText = "";

        try{

            rawText = event.data
                ? event.data.text()
                : "";

        }catch(err){

            console.error(
                "⚠️ Failed to read push payload:",
                err
            );

            rawText = "";

        }

        console.log(
            "📦 PUSH DATA (raw):",
            rawText
        );

        const data = toJSONSafe(rawText);

        const title =

            data.title ||

            "CM_Pro";

        const options =
            buildOptions(data);

        // Prefer the real MongoDB _id sent by the server, so the
        // page can trust this id for mark-read/delete. Fall back to
        // a synthetic id only for the IndexedDB catch-up bookkeeping
        // in the rare case an older payload doesn't carry one.

        const notificationId =

            data._id ||

            `n_${Date.now()}_${Math.random().toString(36).slice(2)}`;

        const notificationPayload = {

            id:notificationId,

            title:data.title || "Notification",

            message:data.body || data.message || "",

            type:data.type || "info",

            targetType:data.targetType || "all",

            targetValue:data.targetValue || "",

            uploadedBy:

                data.createdBy ||

                data.uploadedBy ||

                data.username ||

                data.fullname ||

                "System",

            createdAt:

                data.createdAt ||

                new Date().toISOString(),

            url:

                data.url ||

                "/CM_Pro/pages/notifications/"

        };

        // ==================================================
        // Always stash a catch-up copy in IndexedDB FIRST.
        // If the page is open and receives this live (via
        // BroadcastChannel or the message listener), it will
        // delete this entry itself once shown. If the app was
        // backgrounded/closed, this entry survives until the
        // app is next opened, at which point it gets flushed.
        // ==================================================

        event.waitUntil(

            idbAddPending(notificationPayload)

        );

        // ==================================================
        // Send the real messages via BroadcastChannel FIRST.
        // This is the primary delivery path now — it doesn't
        // depend on clients.matchAll() finding the page, which
        // appears to be unreliable on iOS.
        // ==================================================

        try{

            CM_PRO_CHANNEL.postMessage({

                type:"REFRESH_BADGE"

            });

            CM_PRO_CHANNEL.postMessage({

                type:"NEW_NOTIFICATION",

                notification:notificationPayload

            });

        }catch(err){

            console.error("BroadcastChannel notify failed:", err);

        }

        event.waitUntil(

            Promise.all([

                self.registration
                    .showNotification(
                        title,
                        options
                    ),

                self.clients.matchAll({

                    type:"window",

                    includeUncontrolled:true

                })

                .then(clients=>{

                    // ==================================================
                    // DIAGNOSTIC PING #2 — confirms how many window
                    // clients the SW can actually see on this device.
                    // If this reports 0 clients on iOS while the app
                    // is clearly open, that's the real bug: iOS is not
                    // handing this SW any controlled/uncontrolled
                    // window clients to message.
                    // ==================================================

                    clients.forEach(client=>{

                        client.postMessage({

                            type:"PUSH_DEBUG",

                            stage:"clients-found",

                            count:clients.length,

                            time:new Date().toISOString()

                        });

                    });

                    // NOTE: the actual REFRESH_BADGE / NEW_NOTIFICATION
                    // messages are sent once above via BroadcastChannel.
                    // Sending them again here (as a "fallback") caused
                    // the toast to appear twice on devices where
                    // matchAll() DOES find clients — so it's intentionally
                    // not repeated here anymore.

                })

            ]).catch(err=>{

                // Never let a single failure (e.g. showNotification
                // permission, or a client that vanished) silently
                // eat the entire push event with no trace.

                console.error(
                    "⚠️ Push handling failed:",
                    err
                );

            })

        );

    }

);

// =========================================================
// NOTIFICATION CLICK
// =========================================================

self.addEventListener(

    "notificationclick",

    (event)=>{

        event.notification.close();

        // data.url comes straight from the push payload — whatever
        // created the notification set it, not necessarily this app.
        // Restricting it to an in-app path before handing it to
        // openWindow() below stops a notification from ever being able
        // to pop an external (phishing) site when the user taps it,
        // same reasoning as login.js's getSafeNextParam().
        const rawUrl =
            event.notification?.data?.url || "";

        const url =
            rawUrl.startsWith("/CM_Pro/")
                ? rawUrl
                : "/CM_Pro/index.html";

        event.waitUntil(

            (async ()=>{

                const allClients =

                    await clients.matchAll({

                        type: "window",

                        includeUncontrolled: true

                    });

                // =========================
                // FOCUS EXISTING TAB
                // =========================

                for(const client of allClients){

                    const samePath =

                        new URL(client.url)
                            .pathname ===

                        new URL(
                            url,
                            self.location.origin
                        ).pathname;

                    if(
                        samePath &&
                        "focus" in client
                    ){

                        return client.focus();

                    }

                }

                // =========================
                // OPEN NEW TAB
                // =========================

                return clients.openWindow(
                    url
                );

            })()

        );

    }

);
