
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

const token=

localStorage.getItem("token")||

sessionStorage.getItem("token");

if(!token){

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
                    `Bearer ${token}`
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

if(url){

window.location.href=url;

}

});

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
Authorization:`Bearer ${token}`
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
Authorization:`Bearer ${token}`
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
