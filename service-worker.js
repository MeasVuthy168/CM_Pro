const CM_PRO_CHANNEL = new BroadcastChannel("cm-pro-notifications");

console.log("🔥 SERVICE WORKER LOADED");

/* =========================================================
   CM_Pro – Production Service Worker
========================================================= */

const SW_VERSION = "v6";

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

        // skip unsupported schemes (e.g. browser extension requests)
        if(
            !event.request.url.startsWith("http")
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
