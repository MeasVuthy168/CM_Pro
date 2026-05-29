/* =========================================================
   CM_Pro Notification Badge
========================================================= */

async function loadNotificationBadge(){

    try{

        const token =

            localStorage.getItem("token") ||

            sessionStorage.getItem("token");

        if(!token) return;

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
                        `Bearer ${token}`

                }

            }

        );

        const data =
            await response.json();

        const count =

            Number(
                data.unreadCount || 0
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

// =========================
// INITIAL
// =========================

window.addEventListener(

    "load",

    ()=>{

        loadNotificationBadge();

        setInterval(

            loadNotificationBadge,

            10000

        );

    }

);
