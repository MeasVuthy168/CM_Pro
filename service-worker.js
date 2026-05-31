/* =========================================================
   CM_Pro – Production Service Worker
========================================================= */

const SW_VERSION = "v4";

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

    const defaultIcon =

        "/CM_Pro/assets/images/LogoAC.png";

    return {

        body:

            data.body ||

            "មានទិន្នន័យថ្មី",

        icon:

            data.icon ||

            defaultIcon,

        badge:

            data.badge ||

            defaultIcon,

        image:

            data.image || "",

        vibrate: [200,100,200],

        tag:

            data.tag ||

            "cm-pro",

        renotify: false,

        requireInteraction: false,

        data: {

            url:

                data.url ||

                "/CM_Pro/index.html",

            moduleCode:

                data.moduleCode || "",

            createdAt:

                data.createdAt || ""

        }

    };

}

// =========================================================
// PUSH
// =========================================================

self.addEventListener(

    "push",

    (event)=>{

        console.log(
            "📩 Push received"
        );

        let data = {};

        try{

            data = event.data
                ? event.data.json()
                : {};

        }catch{

            data = toJSONSafe(
                event.data?.text() || "{}"
            );

        }

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

                client.postMessage({

                    type:"REFRESH_BADGE"

                });

            });

        })

    ])

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
