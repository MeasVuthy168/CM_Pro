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

// Tells shared/assets/js/notification-badge.js "this page already
// polls the full list every 30s and keeps the badge in sync itself
// (see updateBadgeDisplay below) — its own periodic poll on THIS page
// would just be a second redundant fetch of the same information.
window.__CM_NOTIF_PAGE_ACTIVE = true;

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
// STATE
// The full last-known list lives here (not just scattered across the
// DOM) so filtering, summary counts, and the render-skip check below
// all have one source of truth to work from.
// =========================================================

let allNotifications=[];
let currentFilter="all"; // "all" | "unread"
let hasLoadedOnce=false;
let lastRenderSignature=null;

const errorBox=document.getElementById("errorBox");
const emptyTitle=document.getElementById("emptyTitle");
const emptySubtitle=document.getElementById("emptySubtitle");
const notifyBadgeEl=document.getElementById("notificationBadge");

// =========================================================
// LOAD
// =========================================================

async function loadNotifications(){

    try{

        showLoading(!hasLoadedOnce);

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

        allNotifications=notifications;
        hasLoadedOnce=true;

        hideError();
        renderList();

        // Same response the list itself came from already carries the
        // unread count — updating the shared topbar badge from it
        // directly means this page never needs its own separate poll
        // of /api/notifications/unread-count (see notification-badge.js).
        const unread =
            typeof data.unreadCount === "number"
            ? data.unreadCount
            : notifications.filter(x=>!x.isRead).length;

        updateBadgeDisplay(unread);

    }catch(error){

        console.error(
            "Notification Error:",
            error
        );

        // A background refresh (the 30s poll, or coming back from a
        // backgrounded tab) failing shouldn't blow away a perfectly
        // good list already on screen — only show the error state if
        // nothing has ever loaded successfully yet.
        if(!hasLoadedOnce){

            showError();

        }

    }finally{

        showLoading(false);

    }

}

// =========================================================
// RENDER
// A signature of the currently-visible slice is compared against the
// last render — the 30s poll (and the reconcile fetch after a live
// push) call this every time regardless of whether anything actually
// changed, and rebuilding notifyList.innerHTML from scratch when
// nothing did would reset scroll position and cancel any swipe the
// user has mid-gesture for no reason.
// =========================================================

function getVisibleList(){

    return currentFilter==="unread"
        ? allNotifications.filter(x=>!x.isRead)
        : allNotifications;

}

function computeSignature(list){

    return list.map(x=>`${x._id}:${x.isRead?1:0}`).join(",");

}

function renderList(){

    // A card mid-swipe has its own inline transform driving it —
    // rebuilding the list out from under a finger still on the screen
    // would yank it back to rest. Wait for the gesture to finish
    // (touchend always clears "swiping") instead of dropping the
    // update; ~400ms is well under the 30s poll interval so this
    // never meaningfully delays a real update.
    if(notifyList.querySelector(".notify-card.swiping")){

        setTimeout(renderList,400);
        return;

    }

    updateSummaryFromState();

    const visible=getVisibleList();
    const signature=computeSignature(visible);

    if(signature===lastRenderSignature){
        return;
    }

    lastRenderSignature=signature;

    if(!visible.length){

        showEmpty();
        return;

    }

    emptyBox.style.display="none";

    // innerHTML += inside a loop forces the browser to re-serialize and
    // re-parse the ENTIRE growing list on every single iteration (the whole
    // DOM built so far gets thrown away and rebuilt from a string each time)
    // — O(n²) work that's barely noticeable at 10 items but made the page
    // hang for a long time once a user had hundreds/thousands of
    // notifications. Building the full HTML string first and assigning it
    // once does the same rendering in a single parse pass.
    notifyList.innerHTML=
    visible.map(createNotificationCard).join("");

    enableSwipeCards();

    hydrateAvatars(notifyList);

}

// =========================================================
// FILTER TABS
// =========================================================

document.querySelectorAll(".notify-filter-tab").forEach(tab=>{

    tab.addEventListener("click",()=>{

        if(tab.dataset.filter===currentFilter) return;

        document.querySelectorAll(".notify-filter-tab").forEach(t=>t.classList.remove("active"));
        tab.classList.add("active");

        currentFilter=tab.dataset.filter;

        // Force a rebuild even if the signature matches the last render
        // of the OTHER filter — switching tabs always needs a repaint.
        lastRenderSignature=null;
        renderList();

    });

});

// =========================================================
// UPDATE SUMMARY
// Always reflects the FULL list, independent of which filter tab is
// active — "Unread" showing only 3 cards shouldn't make the summary
// row claim there are only 3 notifications in total.
// =========================================================

function updateSummaryFromState(){

    totalCount.innerText=
        allNotifications.length;

    unreadCount.innerText=
        allNotifications.filter(x=>!x.isRead).length;

}
// =========================================================
// CARD
// Open button removed — a tap/click on the card does nothing
// for now. Redirecting to a specific page on click is a
// planned feature, not wired up yet. Swipe gestures (mark
// read / delete) are the only interactions on a card — an
// always-visible tick/bin button pair used to sit here too, but
// they cluttered the card next to the swipe gesture that already
// did the same two things, so they're gone; a read card is now
// signaled by its text dimming instead (see .notify-card:not(.unread)
// in notification.css).
// =========================================================

function createNotificationCard(item){

const icon=
getTypeIcon(item.type);

const time=
formatTime(item.createdAt);

const uploadedBy=

    item.createdBy ||
    item.username ||
    "Unknown";

return `

<div
class="
notify-card
${item.isRead ? "" : "unread"}
"
data-id="${escapeHtml(item._id)}"
data-url="${escapeHtml(item.url || '')}"
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

<div class="notify-meta-row">

<div class="notify-user">

<img

class="notify-user-avatar"

data-avatar-user="${escapeHtml(uploadedBy)}"

src="/CM_Pro/assets/images/default-user.png"

>

${escapeHtml(uploadedBy)}

</div>

<div class="notify-type">

${escapeHtml(item.type || "system")}

</div>

</div>

</div>

</div>

`;

}

// =========================================================
// AVATAR HYDRATION
// Real photos require an authenticated request (the endpoint
// needs a Bearer token, which a plain <img src> can never send)
// — this is exactly what CMToast.getUserPhotoSafe() already does
// for toast avatars, so cards are rendered instantly with a
// placeholder, then swapped to the real photo once it resolves.
// Reusing CMToast's method also means it inherits the same
// timeout guard, "System" handling, and fallback image.
// Results are cached per uploader so the same person's photo
// isn't re-fetched for every card in the list.
// =========================================================

const avatarCache=new Map();

function getCachedUserPhoto(username){

    const key=username || "System";

    if(!avatarCache.has(key)){

        const methodExists=(typeof CMToast!=="undefined") && typeof CMToast.getUserPhotoSafe==="function";

        const promise=

            methodExists

            ? CMToast.getUserPhotoSafe(username)

                .catch(()=>{

                    return "/CM_Pro/assets/images/default-user.png";

                })

            : Promise.resolve("/CM_Pro/assets/images/default-user.png");

        avatarCache.set(key,promise);

    }

    return avatarCache.get(key);

}

function hydrateAvatars(container){

    if(!container){

        return;

    }

    const imgs=container.querySelectorAll("img.notify-user-avatar[data-avatar-user]");

    imgs.forEach(img=>{

        const username=img.dataset.avatarUser;

        getCachedUserPhoto(username).then(url=>{

            img.src=url;

        }).catch(()=>{

            // fallback image already set via onerror/default src

        });

    });

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

        // Guard against binding the same card twice. Previously this
        // ran on ALL cards every time a live push arrived (via
        // renderOptimisticCard -> enableSwipeCards), which silently
        // stacked a second, third, fourth... set of listeners onto
        // cards that were already bound. Multiple listeners firing
        // together off a single tap could misfire delete/mark-read.

        if(card.dataset.swipeBound==="true") return;

        card.dataset.swipeBound="true";

        let startX=0;

        let currentX=0;

        let moved=false;

        card.addEventListener(

            "touchstart",

            (e)=>{

                if(!e.touches || !e.touches[0]) return;

                startX=e.touches[0].clientX;

                // Initialize currentX to the same point, not 0 —
                // otherwise a plain tap (no touchmove ever fires)
                // computes diff as `0 - startX` on touchend, which
                // is almost always a large negative number and
                // falsely triggers the swipe-left delete action.

                currentX=startX;

                moved=false;

                card.classList.add("swiping");

            },

            {passive:true}

        );

        card.addEventListener(

            "touchmove",

            (e)=>{

                if(!e.touches || !e.touches[0]) return;

                currentX=e.touches[0].clientX;

                const diff=currentX-startX;

                // Only treat this as an actual drag once the finger
                // has moved a meaningful distance — filters out tiny
                // jitter from a stationary tap being read as a swipe.

                if(Math.abs(diff)>10){

                    moved=true;

                }

                card.style.transform=`translateX(${diff}px)`;

                if(diff<-40){

                    card.classList.add("delete-action");

                }else{

                    card.classList.remove("delete-action");

                }

                if(diff>40){

                    card.classList.add("read-action");

                }else{

                    card.classList.remove("read-action");

                }

            },

            {passive:true}

        );

        card.addEventListener(

            "touchend",

            async()=>{

                const diff=currentX-startX;

                const id=card.dataset.id;

                card.classList.remove("swiping");

                card.classList.remove("delete-action");

                card.classList.remove("read-action");

                // Require real movement (moved===true) on top of the
                // distance threshold — a tap with no drag never
                // reaches either branch below, no matter what diff
                // happens to compute to.

                if(moved && diff<-120){

                    vibrate([50,50,50]);

                    await deleteNotification(id);
                    removeFromState(id);

                    card.style.transform="translateX(-120%)";

                    card.style.opacity=0;

                    setTimeout(()=>{

                        card.remove();

                        updateSummaryFromState();

                    },250);

                }else if(moved && diff>120){

                    vibrate(40);

                    await markRead(id);
                    markReadInState(id);

                    card.style.transform="translateX(100%)";

                    setTimeout(()=>{

                        card.style.transform="translateX(0)";

                        card.classList.remove("unread");

                        updateSummaryFromState();

                    },150);

                }else{

                    card.style.transform="translateX(0)";

                }

                startX=0;

                currentX=0;

                moved=false;

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
// PULL TO REFRESH
// Replaces the old static "⟳ Refresh" button — dragging down from
// the very top of the page now triggers the same loadNotifications()
// call. Only takes over the gesture once the page is already
// scrolled to the top AND the drag is downward; any other scroll
// (including scrolling back up from further down the list) is left
// completely alone.
// =========================================================

(function initPullToRefresh(){

    const indicator=document.getElementById("pullRefreshIndicator");
    if(!indicator) return;

    const THRESHOLD=64;
    const MAX_PULL=90;

    let startY=0;
    let pulling=false;
    let refreshing=false;

    function atTop(){

        return (window.scrollY || document.documentElement.scrollTop || 0) <= 0;

    }

    window.addEventListener("touchstart",(e)=>{

        if(!e.touches || !e.touches[0]) return;

        if(refreshing || !atTop()){
            pulling=false;
            return;
        }

        startY=e.touches[0].clientY;
        pulling=true;

        // No transition while actively tracking the finger — only on
        // the snap-back/settle after release (added back in touchend).
        indicator.classList.remove("snapping");

    },{passive:true});

    window.addEventListener("touchmove",(e)=>{

        if(!pulling || !e.touches || !e.touches[0]) return;

        const diff=e.touches[0].clientY-startY;

        if(diff<=0 || !atTop()){

            pulling=false;
            indicator.classList.add("snapping");
            indicator.style.height="0px";
            indicator.classList.remove("ready");
            return;

        }

        // Only preventDefault once this is clearly a deliberate
        // downward pull at the top of the page — this is what stops
        // the browser's own overscroll/bounce from fighting the
        // indicator, without touching scrolling anywhere else.
        e.preventDefault();

        const pull=Math.min(diff*0.5,MAX_PULL);

        indicator.style.height=pull+"px";
        indicator.classList.toggle("ready",pull>=THRESHOLD);

    },{passive:false});

    window.addEventListener("touchend",()=>{

        if(!pulling) return;

        pulling=false;
        indicator.classList.add("snapping");

        const pulledEnough=indicator.classList.contains("ready");
        indicator.classList.remove("ready");

        if(pulledEnough && !refreshing){

            refreshing=true;
            indicator.classList.add("spinning");
            indicator.style.height="48px";

            loadNotifications().finally(()=>{

                refreshing=false;
                indicator.classList.remove("spinning");
                indicator.style.height="0px";

            });

        }else{

            indicator.style.height="0px";

        }

    });

})();


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
// LOCAL STATE HELPERS
// Keep `allNotifications` (and the summary/badge derived from it) in
// sync with actions the user just took, instead of waiting on the
// next 30s poll to notice the server-side change.
// =========================================================

function removeFromState(id){

    allNotifications=allNotifications.filter(x=>String(x._id)!==String(id));
    lastRenderSignature=computeSignature(getVisibleList());

}

function markReadInState(id){

    const item=allNotifications.find(x=>String(x._id)===String(id));
    if(item) item.isRead=true;

    lastRenderSignature=computeSignature(getVisibleList());

}

// =========================================================
// BADGE
// Same rendering the shared topbar badge (notification-badge.js)
// does — duplicated here rather than shared so this page can drive it
// straight from data it already has, without an extra fetch.
// =========================================================

function updateBadgeDisplay(count){

    if(!notifyBadgeEl) return;

    if(count>0){

        notifyBadgeEl.style.display="flex";
        notifyBadgeEl.innerText=count>99 ? "99+" : count;

    }else{

        notifyBadgeEl.style.display="none";

    }

}

// =========================================================
// EMPTY
// =========================================================

function showEmpty(){

    notifyList.innerHTML="";
    emptyBox.style.display="flex";

    if(currentFilter==="unread"){

        emptyTitle.innerText="No Unread Notifications";
        emptySubtitle.innerText="You're all caught up 🎉";

    }else{

        emptyTitle.innerText="No Notifications";
        emptySubtitle.innerText="Everything is up to date 🎉";

    }

}

// =========================================================
// ERROR
// Distinct from EMPTY — a failed load and "genuinely zero
// notifications" are different situations and shouldn't look
// identical to the user.
// =========================================================

function showError(){

    notifyList.innerHTML="";
    emptyBox.style.display="none";
    if(errorBox) errorBox.style.display="flex";

}

function hideError(){

    if(errorBox) errorBox.style.display="none";

}

document.getElementById("errorRetryBtn")?.addEventListener("click",loadNotifications);

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

div.textContent=text == null ? "" : String(text);

// textContent->innerHTML escapes & < > but not quotes, which this needs
// too — several callers interpolate this into quoted HTML attributes
// (data-url, avatar src), not just text nodes.
return div.innerHTML.replace(/"/g,"&quot;").replace(/'/g,"&#39;");

}

// =========================================================
// AUTO REFRESH
// =========================================================

// Skips the fetch while the tab/app is backgrounded — there's no one
// looking at it, so there's nothing to gain from keeping the list
// current every 30s. Coming back to the tab (visibilitychange below)
// refreshes it immediately instead, so it's never stale on return.
setInterval(()=>{

    if(document.hidden) return;

    loadNotifications();

},30000);

document.addEventListener("visibilitychange",()=>{

    if(document.visibilityState==="visible"){

        loadNotifications();

    }

});

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

        // Already known (e.g. reconcile beat the broadcast) — don't
        // duplicate it. Checked against state, not the DOM, since the
        // DOM only holds whatever the CURRENT filter tab shows.
        if(

            allNotifications.some(
                x=>String(x._id)===String(notification.id)
            )

        ) return;

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

        allNotifications=[item, ...allNotifications];

        // A brand-new push is always unread, so it belongs in the
        // visible list under either filter tab — going through the
        // normal renderList() path (instead of a one-off DOM insert)
        // keeps this consistent with everything else that changes
        // allNotifications.
        lastRenderSignature=null;
        renderList();

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
// Registered on the CAPTURE phase, not bubble — a bubble-phase
// listener here would never fire for a tap on anything that calls
// e.stopPropagation() on its own click handler (confirmed: this is
// exactly why the menu used to stay open when tapping certain
// buttons elsewhere on the page). Capture fires on the way DOWN to
// the target, before any handler on the target itself gets a chance
// to stop propagation, so this closes the menu on a tap anywhere
// outside it, no matter what that element's own click handler does.

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

    },

    true

);

// =========================================================
// HAPTIC FEEDBACK
// =========================================================

// iOS Safari doesn't support the Vibration API — except some iOS
// versions expose a `navigator.vibrate` function that silently
// no-ops OR (reported on-device) actually buzzes, so feature-
// detecting `navigator.vibrate` alone isn't reliable there. Skip it
// outright on iOS rather than trusting the feature check.
function isIOSDevice(){
    return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function vibrate(ms = 30){

    if(
        navigator.vibrate &&
        !isIOSDevice()
    ){

        navigator.vibrate(ms);

    }

}
