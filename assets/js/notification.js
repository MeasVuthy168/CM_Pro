// =========================================================
// ELEMENTS
// =========================================================

const notifyList=
document.getElementById("notifyList");

const unreadCount=
document.getElementById("unreadCount");

const totalCount=
document.getElementById("totalCount");

const loadingBox=
document.getElementById("loadingBox");

const emptyBox=
document.getElementById("emptyBox");

const refreshBtn=
document.getElementById("refreshBtn");

const readAllBtn=
document.getElementById("readAllBtn");

// =========================================================
// TOKEN
// =========================================================

const notificationToken =

localStorage.getItem("token") ||

sessionStorage.getItem("token");

if(!notificationToken){

window.location.replace(
"/CM_Pro/login.html"
);

}

// =========================================================
// CURRENT USER (from token, for optimistic-render filtering
// only — the server remains the source of truth on every
// real fetch/mark-read/delete call)
// =========================================================

function decodeJwtPayload(token){

    try{

        const base64 =
            token.split(".")[1];

        return JSON.parse(
            atob(
                base64
                .replace(/-/g,"+")
                .replace(/_/g,"/")
            )
        );

    }catch(err){

        return {};

    }

}

const currentUser =
    decodeJwtPayload(notificationToken);

// Mirrors the server's canUserSeeNotification() — used only to
// decide whether to optimistically render a live push locally;
// the reconcile fetch afterwards always reflects the real,
// server-enforced visibility.
function canSeeNotificationLocally(notify){

    const targetType =
        String(notify?.targetType || "all").toLowerCase();

    const targetValue =
        String(notify?.targetValue || "").trim().toLowerCase();

    const username =
        String(currentUser?.username || "").trim().toLowerCase();

    const role =
        String(currentUser?.role || "user").trim().toLowerCase();

    if(targetType === "all") return true;
    if(targetType === "username") return username && username === targetValue;
    if(targetType === "role") return role && role === targetValue;

    return false;

}

// =========================================================
// LOAD
// =========================================================

async function loadNotifications(){

    try{

        showLoading(true);

        const response = await fetch(

            `${API.BASE_URL}/api/notifications/my`,

            {
                headers:{
                    Authorization:
                    `Bearer ${notificationToken}`
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

        const notifications =

            data.items ||

            data.notifications ||

            data.data ||

            [];

        renderNotifications(
            notifications
        );

    }catch(error){

        console.error(
            "Notification Error:",
            error
        );

        showEmpty();

    }finally{

        showLoading(false);

    }

}

// =========================================================
// RENDER
// =========================================================

function renderNotifications(list){

notifyList.innerHTML="";

unreadCount.innerText=

list.filter(x=>!x.isRead).length;

totalCount.innerText=
list.length;

if(!list.length){

showEmpty();

return;

}

emptyBox.style.display="none";

list.forEach(item=>{

notifyList.innerHTML+=
createNotificationCard(item);

});

enableSwipeCards();

}

// =========================================================
// UPDATE SUMMARY
// =========================================================

function updateSummary(){

    const cards =

        document.querySelectorAll(
            ".notify-card"
        );

    const unread =

        document.querySelectorAll(
            ".notify-card.unread"
        );

    totalCount.innerText =
        cards.length;

    unreadCount.innerText =
        unread.length;

}
// =========================================================
// CARD
// Open button removed — a tap/click on the card does nothing
// for now. Redirecting to a specific page on click is a
// planned feature, not wired up yet. Swipe gestures (mark
// read / delete) are the only interactions on a card today.
// =========================================================

function createNotificationCard(item){

const icon=
getTypeIcon(item.type);

const time=
formatTime(item.createdAt);

return `

<div
class="
notify-card
${item.isRead ? "" : "unread"}
"
data-id="${item._id}"
data-url="${item.url || ''}"
>

<div class="notify-icon">

${icon}

</div>

<div class="notify-content">

<div class="notify-top">

<div class="notify-card-title">

${escapeHtml(item.title || "Notification")}

</div>

<div class="notify-time">

${time}

</div>

</div>

<div class="notify-message">

${escapeHtml(item.message || "")}

</div>

<div class="notify-user">

👤 ${
    escapeHtml(
        item.createdBy ||
        item.username ||
        "Unknown"
    )
}

</div>

<div class="notify-footer">

<div class="notify-type">

${escapeHtml(item.type || "system")}

</div>

</div>

</div>

</div>

`;

}

// =========================================================
// SWIPE
// The only way to mark-read or delete a card. Swipe right to
// mark read, swipe left to delete — a plain tap/click never
// triggers either action.
// =========================================================

function enableSwipeCards(){

    document
    .querySelectorAll(".notify-card")

    .forEach(card=>{

        let startX = 0;
        let currentX = 0;

        card.addEventListener(

            "touchstart",

            (e)=>{

                startX =
                    e.touches[0].clientX;

                card.classList.add(
                    "swiping"
                );

            },

            {passive:true}

        );

        card.addEventListener(

            "touchmove",

            (e)=>{

                currentX =
                    e.touches[0].clientX;

                const diff =
                    currentX - startX;

                card.style.transform =
                    `translateX(${diff}px)`;

                if(diff < -40){

                    card.classList.add(
                        "delete-action"
                    );

                }else{

                    card.classList.remove(
                        "delete-action"
                    );

                }

                if(diff > 40){

                    card.classList.add(
                        "read-action"
                    );

                }else{

                    card.classList.remove(
                        "read-action"
                    );

                }

            },

            {passive:true}

        );

        card.addEventListener(

            "touchend",

            async ()=>{

                const diff =
                    currentX - startX;

                const id =
                    card.dataset.id;

                card.classList.remove(
                    "swiping"
                );

                card.classList.remove(
                    "delete-action"
                );

                card.classList.remove(
                    "read-action"
                );

                // Swipe Left
                if(diff < -120){
                 vibrate([50,50,50]);
                    await deleteNotification(
                        id
                    );

                    card.style.transform =
    "translateX(-120%)";

card.style.opacity = 0;

setTimeout(()=>{

    card.remove();

    updateSummary();

},250);

                }

                // Swipe Right
                else if(diff > 120){
                    vibrate(40)
                    await markRead(id);

                    card.style.transform =
    "translateX(100%)";

setTimeout(()=>{

    card.style.transform =
        "translateX(0)";

    card.classList.remove(
        "unread"
    );

    updateSummary();

},150);
                }

                card.style.transform =
                    "translateX(0)";

                startX = 0;
                currentX = 0;

            }

        );

    });

}


// =========================================================
// MARK READ
// =========================================================

async function markRead(id){

try{

await fetch(

`${API.BASE_URL}/api/notifications/mark-read`,

{
method:"POST",

headers:{
"Content-Type":"application/json",
Authorization:`Bearer ${notificationToken}`
},

body:JSON.stringify({
notificationId:id
})

}

);

if(typeof loadNotificationBadge === "function"){

    loadNotificationBadge();

}

}catch(error){

console.error(error);

}

}

// =========================================================
// MARK ALL
// =========================================================

readAllBtn.addEventListener("click",async()=>{

try{

await fetch(

`${API.BASE_URL}/api/notifications/mark-all-read`,

{
method:"POST",

headers:{
Authorization:`Bearer ${notificationToken}`
}
}

);

loadNotifications();

if(typeof loadNotificationBadge === "function"){

    loadNotificationBadge();

}

}catch(error){

console.error(error);

}

});

// =========================================================
// REFRESH
// =========================================================

refreshBtn.addEventListener("click",()=>{

loadNotifications();

});




// =========================================================
// Detelete one by one
// =========================================================

async function deleteNotification(id){

    try{

        await fetch(

            `${API.BASE_URL}/api/notifications/delete`,

            {

                method:"POST",

                headers:{
                    "Content-Type":
                    "application/json",

                    Authorization:
                    `Bearer ${notificationToken}`
                },

                body:JSON.stringify({

                    notificationId:id

                })

            }

        );

        if(
            typeof loadNotificationBadge
            === "function"
        ){

            loadNotificationBadge();

        }

    }catch(error){

        console.error(error);

    }

}





// =========================================================
// EMPTY
// =========================================================

function showEmpty(){

notifyList.innerHTML="";

emptyBox.style.display="flex";

}

// =========================================================
// LOADING
// =========================================================

function showLoading(show){

loadingBox.style.display=
show ? "flex" : "none";

}

// =========================================================
// TYPE ICON
// =========================================================

function getTypeIcon(type){

switch(type){

case "upload":
return "📤";

case "warning":
return "⚠️";

case "update":
return "⬆️";

case "delete":
return "🗑";

case "system":
return "🖥️";

default:
return "🔔";

}

}

// =========================================================
// TIME FORMAT
// =========================================================

function formatTime(date){

if(!date) return "";

const d=new Date(date);

return d.toLocaleString();

}

// =========================================================
// SAFE HTML
// =========================================================

function escapeHtml(text){

const div=
document.createElement("div");

div.textContent=text;

return div.innerHTML;

}

// =========================================================
// AUTO REFRESH
// =========================================================

setInterval(()=>{

loadNotifications();

},30000);

// =========================================================
// BROADCAST CHANNEL (primary realtime path)
//
// NEW_NOTIFICATION now carries the real Mongo _id (see server
// + service-worker changes), so we can render it instantly —
// toast speed — instead of waiting for a fetch. A short
// reconcile fetch follows a couple seconds later to silently
// correct anything the optimistic render couldn't know about
// (e.g. already read on another device, deleted since, etc).
// REFRESH_BADGE alone (no notification payload, e.g. triggered
// by mark-all-read on another device) has nothing to render
// optimistically, so it just triggers the reconcile directly.
// =========================================================

if("BroadcastChannel" in window){

    const cmProChannel =
        new BroadcastChannel("cm-pro-notifications");

    let reconcileTimer = null;

    function scheduleReconcile(){

        clearTimeout(reconcileTimer);

        reconcileTimer = setTimeout(()=>{

            loadNotifications();

        },2000);

    }

    function renderOptimisticCard(notification){

        if(!notification || !notification.id) return;

        // Never trust a push targeted at someone else, even
        // just for the optimistic render.
        if(!canSeeNotificationLocally(notification)) return;

        // Already on screen (e.g. reconcile beat the broadcast) —
        // don't duplicate it.
        if(

            notifyList.querySelector(
                `[data-id="${notification.id}"]`
            )

        ) return;

        emptyBox.style.display = "none";

        const item = {

            _id:notification.id,

            title:notification.title,

            message:notification.message,

            type:notification.type,

            createdBy:notification.uploadedBy,

            createdAt:notification.createdAt,

            url:notification.url,

            isRead:false

        };

        notifyList.insertAdjacentHTML(

            "afterbegin",

            createNotificationCard(item)

        );

        enableSwipeCards();

        updateSummary();

    }

    cmProChannel.addEventListener(

        "message",

        event=>{

            if(event.data?.type === "NEW_NOTIFICATION"){

                renderOptimisticCard(
                    event.data.notification
                );

                scheduleReconcile();

            }else if(event.data?.type === "REFRESH_BADGE"){

                scheduleReconcile();

            }

        }

    );

}

// =========================================================
// INIT
// =========================================================

loadNotifications();

function toggleNotificationMenu(){

    const menu =

        document.getElementById(
            "notificationMenu"
        );

    if(!menu) return;

    menu.style.display =

        menu.style.display === "block"

        ? "none"

        : "block";

}

// click outside

document.addEventListener(

    "click",

    (e)=>{

        const menu =

            document.getElementById(
                "notificationMenu"
            );

        if(!menu) return;

        if(

            !menu.contains(e.target)

            &&

            e.target.id !==
            "topbarActionBtn"

        ){

            menu.style.display =
                "none";

        }

    }

);

// =========================================================
// HAPTIC FEEDBACK
// =========================================================

function vibrate(ms = 30){

    if(
        navigator.vibrate
    ){

        navigator.vibrate(ms);

    }

}
