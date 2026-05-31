
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
console.log(
    "Notifications API:",
    data
);

        const notifications =

            data.items ||

            data.notifications ||

            data.data ||

            [];

        console.log(
            "Notifications:",
            notifications
        );

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

attachCardEvents();

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

<button class="notify-open">

Open

</button>

</div>

</div>

</div>

`;

}

// =========================================================
// EVENTS
// =========================================================

function attachCardEvents(){

document
.querySelectorAll(".notify-open")

.forEach(btn=>{

btn.addEventListener("click",async(e)=>{

const card=

e.target.closest(".notify-card");

const id=
card.dataset.id;

const url=
card.dataset.url;

await markRead(id);

card.classList.remove(
    "unread"
);

updateSummary();

if(url){

    window.location.href=url;

}

});

});

}

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

                if(diff < -80){

                    card.classList.add(
                        "delete-action"
                    );

                }else{

                    card.classList.remove(
                        "delete-action"
                    );

                }

                if(diff > 80){

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

                    await deleteNotification(
                        id
                    );

                    card.style.opacity=0;

                    setTimeout(()=>{

                    card.remove();

                    updateSummary();

                    },200);

                }

                // Swipe Right
                else if(diff > 120){

                    await markRead(id);

                    card.classList.remove(
                        "unread"
                    );
                   updateSummary();
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
