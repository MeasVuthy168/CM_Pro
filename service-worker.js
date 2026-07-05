console.log("🔥 SERVICE WORKER LOADED");

/* =========================================================
   CM_Pro – Production Service Worker
========================================================= */

const SW_VERSION = "v11";

const CACHE_NAME = `cm-pro-cache-${SW_VERSION}`;

// =========================================================
// STATIC CACHE FILES
// =========================================================

const STATIC_ASSETS = [

    "/CM_Pro/",

    "/CM_Pro/login.html",

    "/CM_Pro/index.html",

    "/CM_Pro/manifest.json",

    "/CM_Pro/assets/images/LogoAC.png",

    "/CM_Pro/assets/images/icon-192.png",

    "/CM_Pro/assets/images/icon-512.png"

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

        event.waitUntil(

            caches.open(CACHE_NAME)

                .then(cache=>{

                    return cache.addAll(
                        STATIC_ASSETS
                    );

                })

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
// FETCH CACHE-FIRST
// =========================================================

self.addEventListener(

    "fetch",

    (event)=>{

        // only GET requests
        if(
            event.request.method !== "GET"
        ) return;

        event.respondWith(

            caches.match(event.request)

                .then(cached=>{

                    // =========================
                    // RETURN CACHE
                    // =========================

                    if(cached){

                        return cached;

                    }

                    // =========================
                    // FETCH NETWORK
                    // =========================

                    return fetch(event.request)

                        .then(response=>{

                            // invalid response
                            if(
                                !response ||

                                response.status !== 200 ||

                                response.type !== "basic"
                            ){

                                return response;

                            }

                            // clone response
                            const responseClone =
                                response.clone();

                            // save to cache
                            caches.open(CACHE_NAME)

                                .then(cache=>{

                                    cache.put(

                                        event.request,

                                        responseClone

                                    );

                                });

                            return response;

                        })

                        .catch(()=>{

                            // =========================
                            // OPTIONAL OFFLINE PAGE
                            // =========================

                            if(
                                event.request.mode ===
                                "navigate"
                            ){

                                return caches.match(
                                    "/CM_Pro/login.html"
                                );

                            }

                        });

                })

        );

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

                    clients.forEach(client=>{

                        // Refresh badge
                        client.postMessage({

                            type:"REFRESH_BADGE"

                        });

                        // Show Toast immediately
                        client.postMessage({

                            type:"NEW_NOTIFICATION",

                            notification:{

                                title:data.title || "Notification",

                                message:data.body || data.message || "",

                                type:data.type || "info",

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

                            }

                        });

                    });

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

        const url =

            event.notification?.data?.url ||

            "/CM_Pro/index.html";

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
