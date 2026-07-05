/* =========================================================
   CM_Pro Notification Badge
========================================================= */

async function loadNotificationBadge(){

    try{

        const badgeToken =

            localStorage.getItem("token") ||

            sessionStorage.getItem("token");

        if(!badgeToken) return;

        const badge =

            document.getElementById(
                "notificationBadge"
            );

        if(!badge) return;

        const response = await fetch(

            `${API.BASE_URL}/api/notifications/unread-count`,

            {

                headers:{

                    Authorization:
                    `Bearer ${badgeToken}`

                }

            }

        );

        if(!response.ok){

            throw new Error(
                `HTTP ${response.status}`
            );

        }

        const data =
            await response.json();

        const count = Number(

            data.unreadCount ||

            data.count ||

            0

        );

        if(count > 0){

            badge.style.display =
                "flex";

            badge.innerText =

                count > 99
                ? "99+"
                : count;

        }else{

            badge.style.display =
                "none";

        }

    }catch(error){

        console.error(

            "Notification Badge Error:",

            error

        );

    }

}

// =========================================================
// INITIAL
// =========================================================

window.addEventListener(

    "load",

    ()=>{

        loadNotificationBadge();

    }

);

// =========================================================
// AUTO REFRESH
// =========================================================

setInterval(

    ()=>{

        loadNotificationBadge();

    },

    60000

);

// =========================================================
// PAGE BECOME ACTIVE
// =========================================================

document.addEventListener(

    "visibilitychange",

    ()=>{

        if(

            document.visibilityState ===

            "visible"

        ){

            loadNotificationBadge();

        }

    }

);

// =========================================================
// SERVICE WORKER REALTIME (legacy path — kept for safety,
// but the SW no longer sends REFRESH_BADGE this way; see
// BROADCAST CHANNEL section below for the real live path)
// =========================================================

if(

    "serviceWorker" in navigator

){

    navigator.serviceWorker

    .addEventListener(

        "message",

        event=>{

            if(

                event.data?.type ===

                "REFRESH_BADGE"

            ){

                console.log(

                    "Realtime Badge Refresh (SW message)"

                );

                loadNotificationBadge();

            }

        }

    );

}

// =========================================================
// BROADCAST CHANNEL (primary realtime path)
//
// The service worker posts REFRESH_BADGE / NEW_NOTIFICATION
// on this channel for every push it receives — this is what
// actually needs to be listened to for the badge to update
// live. It also lets any other page (e.g. an upload page)
// ping this tab the instant an upload finishes, without
// waiting for the web-push round trip at all.
// =========================================================

if("BroadcastChannel" in window){

    const cmProChannel =
        new BroadcastChannel("cm-pro-notifications");

    cmProChannel.addEventListener(

        "message",

        event=>{

            if(

                event.data?.type === "REFRESH_BADGE" ||

                event.data?.type === "NEW_NOTIFICATION"

            ){

                console.log(

                    "Realtime Badge Refresh (BroadcastChannel)"

                );

                loadNotificationBadge();

            }

        }

    );

    // Call window.CMProNotify.ping() right after any successful
    // upload (or other action that creates a notification) to
    // refresh the badge instantly in this tab and every other
    // open tab — no need to wait for the push round trip.
    window.CMProNotify = {

        ping(){

            try{

                cmProChannel.postMessage({
                    type:"REFRESH_BADGE"
                });

            }catch(err){

                console.error(
                    "CMProNotify ping failed:",
                    err
                );

            }

        }

    };

}
