/* =========================================================
   CM_Pro – Service Worker
   File: /service-worker.js
========================================================= */

const SW_VERSION = "v1";

// =========================================================
// INSTALL
// =========================================================

self.addEventListener("install", (event) => {

    console.log(
        "SW Installed:",
        SW_VERSION
    );

    self.skipWaiting();

});

// =========================================================
// ACTIVATE
// =========================================================

self.addEventListener("activate", (event) => {

    console.log(
        "SW Activated:",
        SW_VERSION
    );

    event.waitUntil(
        self.clients.claim()
    );

});

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
// BUILD NOTIFICATION OPTIONS
// =========================================================

function buildOptions(data){

    const defaultIcon =
        "/CM_Pro/assets/images/LogoAC.png";

    const defaultBadge =
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
            defaultBadge,

        image:
            data.image || "",

        vibrate: [200, 100, 200],

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
// PUSH RECEIVED
// =========================================================

self.addEventListener("push", (event) => {

    console.log(
        "Push received"
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

    console.log(
        "Push payload:",
        data
    );

    const title =
        data.title ||
        "CM_Pro";

    const options =
        buildOptions(data);

    event.waitUntil(

        self.registration.showNotification(
            title,
            options
        )

    );

});

// =========================================================
// NOTIFICATION CLICK
// =========================================================

self.addEventListener(
    "notificationclick",
    (event) => {

        event.notification.close();

        const url =

            event.notification?.data?.url ||

            "/CM_Pro/index.html";

        event.waitUntil(

            (async () => {

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

                        new URL(client.url).pathname ===

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

// =========================================================
// OPTIONAL FETCH
// =========================================================

// Future:
// offline cache
// API cache
// static assets cache
