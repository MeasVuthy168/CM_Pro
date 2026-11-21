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
let currentFilter="all"; // status: "all" | "unread" | "read"
let currentCategory="all"; // "all" | one of NOTIF_CATEGORIES
let currentSearch=""; // raw text typed in the search box
let currentSort="newest"; // "newest" | "oldest" | "unread"
let hasLoadedOnce=false;
let lastRenderSignature=null;
// Cards whose long message the user opened — kept across re-renders.
const expandedIds=new Set();

const errorBox=document.getElementById("errorBox");
const emptyTitle=document.getElementById("emptyTitle");
const emptySubtitle=document.getElementById("emptySubtitle");
// NOTE: not captured at module top-level — the bottom-nav component
// that contains this element is loaded asynchronously by the page
// loader, so a const captured here would freeze on null forever.
// updateBadgeDisplay() below looks it up fresh on every call instead.

// =========================================================
// LOAD
// =========================================================

// Last list seen this app session, so opening the page (bottom-bar tab
// switch especially) paints the list straight away instead of a
// full-screen spinner fading in — the fetch below then refreshes it.
// sessionStorage, not localStorage: it goes away with the app session.
function notifCacheKey(){
    try{
        const u=JSON.parse(localStorage.getItem("loggedInUser") || "{}").username || "";
        return u ? `cm_notif_cache_${u}` : "";
    }catch{
        return "";
    }
}

function readNotifCache(){
    const key=notifCacheKey();
    if(!key) return null;
    try{
        const list=JSON.parse(sessionStorage.getItem(key) || "null");
        return Array.isArray(list) ? list : null;
    }catch{
        return null;
    }
}

function writeNotifCache(list){
    const key=notifCacheKey();
    if(!key) return;
    try{ sessionStorage.setItem(key, JSON.stringify(list.slice(0,100))); }catch{}
}

let loadingDelayTimer=null;

async function loadNotifications(){

    if(!hasLoadedOnce){
        const cached=readNotifCache();
        if(cached){
            allNotifications=cached;
            hasLoadedOnce=true;
            renderList();
        }
    }

    try{

        // Nothing on screen yet: only bring up the spinner if the
        // request is actually slow, so a quick load never flashes it.
        if(!hasLoadedOnce){
            clearTimeout(loadingDelayTimer);
            loadingDelayTimer=setTimeout(()=>showLoading(true),400);
        }

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
        writeNotifCache(notifications);

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

        clearTimeout(loadingDelayTimer);
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

// =========================================================
// CATEGORIES
// One place decides which friendly group a notification belongs to,
// from its type / moduleCode / eventKey (falling back to title and
// extra for older rows). Never writes to the item. Anything it can't
// place goes to "other", so a new server-side notification kind can't
// break the page — it just shows under Other until mapped here.
// =========================================================

const NOTIF_CATEGORIES=["reasonArrear","system","reports","security","userActivity","other"];

const CATEGORY_ICON={
    reasonArrear:"clipboard", system:"system", reports:"upload",
    security:"error", userActivity:"update", other:"bell"
};

const RE_SECURITY=/(^|[^a-z])(login|logout|sign.?in|password|passcode|pin|security|biometric|webauthn|fingerprint|face.?id|permission|locked|lockout|2fa|otp)([^a-z]|$)/i;
const RE_REASON=/reason.?arrear|officer.?reminder/i;
const RE_REPORTS=/^upload|snapshot|report|smart.?alert|lgs|debit.?turn.?over|overdue|write.?off/i;
const RE_USER=/(^|[^a-z])(user|profile|photo|avatar|account|staff)([^a-z]|$)/i;
const RE_SYSTEM=/^(system|app|info)$|storage|cleanup|wipe|wallpaper|app.?version|manual|prune|backup|maintenance|update/i;

const categoryMemo=new WeakMap();

function getNotificationCategory(item){

    if(!item || typeof item!=="object") return "other";
    if(categoryMemo.has(item)) return categoryMemo.get(item);

    const type=String(item.type || "").trim();
    const moduleCode=String(item.moduleCode || "").trim();
    const eventKey=String(item.eventKey || "").trim();
    const extra=item.extra && typeof item.extra==="object" ? item.extra : null;
    const extraHint=extra ? String(extra.category || extra.module || extra.kind || "") : "";
    const codes=[type,moduleCode,eventKey,extraHint].filter(Boolean);
    const anyCode=re=>codes.some(c=>re.test(c));

    let cat="other";

    if(anyCode(RE_SECURITY)) cat="security";
    else if(anyCode(RE_REASON)) cat="reasonArrear";
    else if(type==="upload" || type==="snapshot" || anyCode(RE_REPORTS)) cat="reports";
    else if(anyCode(RE_USER)) cat="userActivity";
    else if(anyCode(RE_SYSTEM)) cat="system";
    else{
        // No usable code (e.g. an optimistic live push, or a very old
        // row) — look at the title as a last resort.
        const title=String(item.title || "");
        if(RE_SECURITY.test(title)) cat="security";
        else if(/reason|មូលហេតុ/i.test(title)) cat="reasonArrear";
        else if(/upload|report|snapshot|របាយការណ៍/i.test(title)) cat="reports";
    }

    categoryMemo.set(item,cat);
    return cat;

}

function categoryLabelKey(cat){
    return `notifications.${NOTIF_CATEGORIES.includes(cat) ? cat : "other"}`;
}

function tr(key){
    return window.CMI18n ? CMI18n.t(key) : key;
}

// Search words for each category in BOTH languages, so a Khmer search
// finds "System" cards while the app is in English and the other way
// round. The shown label always comes from the dictionary (features.js);
// this list is only extra words to match, plus the current label.
const CATEGORY_SEARCH_TERMS={
    reasonArrear:"reason arrear មូលហេតុយឺតយ៉ាវ មូលហេតុ",
    system:"system ប្រព័ន្ធ",
    reports:"reports report upload របាយការណ៍",
    security:"security សុវត្ថិភាព",
    userActivity:"user activity សកម្មភាពអ្នកប្រើ អ្នកប្រើប្រាស់",
    other:"other ផ្សេងៗ"
};

function categoryLabelsBoth(cat){
    return `${CATEGORY_SEARCH_TERMS[cat] || ""} ${tr(categoryLabelKey(cat))}`;
}

// =========================================================
// VIEW PIPELINE
// allNotifications → status → category → search → sort → group.
// Each step returns a new array; the state array is never re-ordered.
// =========================================================

function filterByStatus(list,status){
    if(status==="unread") return list.filter(x=>!x.isRead);
    if(status==="read") return list.filter(x=>!!x.isRead);
    return list.slice();
}

function filterByCategory(list,cat){
    if(!cat || cat==="all") return list;
    return list.filter(x=>getNotificationCategory(x)===cat);
}

// Case-insensitive; also drops the zero-width spaces Khmer text often
// carries, so a typed word still matches text copied from elsewhere.
function normalizeText(s){
    let str=String(s == null ? "" : s);
    if(str.normalize) str=str.normalize("NFC");
    return str.replace(/[​-‍﻿]/g,"").toLowerCase().replace(/\s+/g," ").trim();
}

const haystackMemo=new WeakMap();

function searchHaystack(item){
    let h=haystackMemo.get(item);
    if(h==null){
        h=normalizeText([
            item.title, item.message, item.createdBy, item.username,
            categoryLabelsBoth(getNotificationCategory(item))
        ].join(" \u0001 "));
        haystackMemo.set(item,h);
    }
    return h;
}

function filterBySearch(list,query){
    const q=normalizeText(query);
    if(!q) return list;
    // Every word must match somewhere, in any order.
    const words=q.split(" ").filter(Boolean);
    return list.filter(x=>{
        const h=searchHaystack(x);
        return words.every(w=>h.includes(w));
    });
}

function timeOf(item){
    const t=item && item.createdAt ? new Date(item.createdAt).getTime() : NaN;
    return Number.isFinite(t) ? t : null;
}

function sortNotifications(list,mode){
    // Items with no/invalid date always go last, whatever the order.
    const decorated=list.map((item,i)=>({ item, i, t:timeOf(item) }));
    decorated.sort((a,b)=>{
        if(mode==="unread"){
            const ua=a.item.isRead ? 1 : 0, ub=b.item.isRead ? 1 : 0;
            if(ua!==ub) return ua-ub;
        }
        if(a.t==null || b.t==null){
            if(a.t==null && b.t==null) return a.i-b.i;
            return a.t==null ? 1 : -1;
        }
        if(a.t!==b.t) return mode==="oldest" ? a.t-b.t : b.t-a.t;
        return a.i-b.i;
    });
    return decorated.map(d=>d.item);
}

function localDayKey(d){
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dateGroupOf(item,now){
    const t=timeOf(item);
    if(t==null) return "earlier";
    const d=new Date(t);
    const today=now || new Date();
    if(localDayKey(d)===localDayKey(today)) return "today";
    const y=new Date(today.getFullYear(),today.getMonth(),today.getDate()-1);
    if(localDayKey(d)===localDayKey(y)) return "yesterday";
    return "earlier";
}

// Groups follow the sort direction (Earlier first when oldest-first);
// items keep their sorted order inside a group. Empty groups are dropped.
function groupNotifications(list,mode,now){
    const order=mode==="oldest" ? ["earlier","yesterday","today"] : ["today","yesterday","earlier"];
    const buckets={ today:[], yesterday:[], earlier:[] };
    list.forEach(item=>buckets[dateGroupOf(item,now)].push(item));
    return order.filter(k=>buckets[k].length).map(k=>({ key:k, items:buckets[k] }));
}

function getVisibleList(){
    const byStatus=filterByStatus(allNotifications,currentFilter);
    const byCat=filterByCategory(byStatus,currentCategory);
    const bySearch=filterBySearch(byCat,currentSearch);
    return sortNotifications(bySearch,currentSort);
}

function viewConfigKey(){
    const lang=window.CMI18n && CMI18n.lang ? CMI18n.lang() : "";
    return [currentFilter,currentCategory,normalizeText(currentSearch),currentSort,lang,localDayKey(new Date())].join("|");
}

function computeSignature(list){

    return viewConfigKey()+"#"+list.map(x=>
        `${x._id}:${x.isRead?1:0}:${x.title||""}:${x.message||""}:${getNotificationCategory(x)}:${x.createdAt||""}`
    ).join("\u0002");

}

// Exposed for tests / debugging only; nothing in the app depends on it.
window.CMNotifCenter={
    getNotificationCategory, filterByStatus, filterByCategory, filterBySearch,
    sortNotifications, groupNotifications, dateGroupOf
};

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
    const now=new Date();
    notifyList.innerHTML=
    groupNotifications(visible,currentSort,now).map(g=>
        `<section class="notify-group" data-group="${g.key}">`+
        `<div class="notify-group-head" role="heading" aria-level="2">`+
        `<span data-i18n="notifications.${g.key}">${escapeHtml(tr(`notifications.${g.key}`))}</span>`+
        `<span class="notify-group-count">${g.items.length}</span></div>`+
        g.items.map(item=>createNotificationCard(item,now)).join("")+
        `</section>`
    ).join("");

    enableSwipeCards();

    hydrateAvatars(notifyList);

}

// =========================================================
// FILTER TABS
// =========================================================

// Each control only changes its piece of the view config and repaints;
// nothing here fetches — filtering is all over the list already loaded.
function setActive(selector,attr,value){
    document.querySelectorAll(selector).forEach(el=>{
        const on=el.dataset[attr]===value;
        el.classList.toggle("active",on);
        el.setAttribute("aria-selected",on ? "true" : "false");
    });
}

function applyViewChange(){
    // Force a rebuild — a view change always needs a repaint, and it
    // starts back at the top of the new list.
    lastRenderSignature=null;
    renderList();
}

document.getElementById("notifyFilterTabs")?.addEventListener("click",(e)=>{
    const tab=e.target.closest(".notify-filter-tab[data-filter]");
    if(!tab || tab.dataset.filter===currentFilter) return;
    currentFilter=tab.dataset.filter;
    setActive(".notify-filter-tab[data-filter]","filter",currentFilter);
    applyViewChange();
});

const chipRow=document.getElementById("notifyChips");

chipRow?.addEventListener("click",(e)=>{
    const chip=e.target.closest(".notify-chip[data-cat]");
    if(!chip || chip.dataset.cat===currentCategory) return;
    currentCategory=chip.dataset.cat;
    setActive(".notify-chip[data-cat]","cat",currentCategory);
    // Keep the picked chip in view on a narrow screen.
    try{ chip.scrollIntoView({ block:"nearest", inline:"nearest", behavior:"smooth" }); }catch(err){}
    applyViewChange();
});

const searchInput=document.getElementById("notifySearch");
const searchClear=document.getElementById("notifySearchClear");
let searchTimer=null;

function setSearch(value,immediate){
    if(searchInput && searchInput.value!==value) searchInput.value=value;
    if(searchClear) searchClear.hidden=!value;
    clearTimeout(searchTimer);
    const run=()=>{
        if(normalizeText(value)===normalizeText(currentSearch)){ currentSearch=value; return; }
        currentSearch=value;
        applyViewChange();
    };
    if(immediate) run(); else searchTimer=setTimeout(run,150);
}

searchInput?.addEventListener("input",()=>setSearch(searchInput.value,false));
searchInput?.addEventListener("keydown",(e)=>{
    if(e.key==="Escape" && searchInput.value){ e.preventDefault(); setSearch("",true); }
    if(e.key==="Enter"){ e.preventDefault(); setSearch(searchInput.value,true); searchInput.blur(); }
});
searchClear?.addEventListener("click",()=>{ setSearch("",true); searchInput?.focus(); });
document.getElementById("emptyClearBtn")?.addEventListener("click",()=>setSearch("",true));

document.getElementById("notifySort")?.addEventListener("change",(e)=>{
    const v=e.target.value;
    currentSort=["newest","oldest","unread"].includes(v) ? v : "newest";
    applyViewChange();
});

// Card text is rendered already translated (with data-i18n so the
// shared i18n pass keeps it right); a repaint after a language switch
// also refreshes anything built from the current language.
window.addEventListener("cm-language-changed",()=>{
    lastRenderSignature=null;
    renderList();
});

// =========================================================
// UPDATE SUMMARY
// Always reflects the FULL list, independent of which filter tab is
// active — "Unread" showing only 3 cards shouldn't make the summary
// row claim there are only 3 notifications in total.
// =========================================================

const todayCount=document.getElementById("todayCount");

function setCount(el,n){
    if(el && el.textContent!==String(n)) el.textContent=n;
}

function updateSummaryFromState(){

    const now=new Date();
    let unread=0, today=0;
    allNotifications.forEach(x=>{
        if(!x.isRead) unread++;
        if(dateGroupOf(x,now)==="today" && timeOf(x)!=null) today++;
    });

    setCount(totalCount,allNotifications.length);
    setCount(unreadCount,unread);
    setCount(todayCount,today);

    // Status tab counts: the whole list, like the cards above.
    setCount(document.querySelector('[data-count="all"]'),allNotifications.length);
    setCount(document.querySelector('[data-count="unread"]'),unread);
    setCount(document.querySelector('[data-count="read"]'),allNotifications.length-unread);

    // Chip counts: within the picked status, so "Unread" + a chip shows
    // where the unread ones are.
    const byStatus=filterByStatus(allNotifications,currentFilter);
    const perCat={ all:byStatus.length };
    NOTIF_CATEGORIES.forEach(c=>{ perCat[c]=0; });
    byStatus.forEach(x=>{ perCat[getNotificationCategory(x)]++; });
    document.querySelectorAll(".notify-chip[data-cat]").forEach(chip=>{
        const n=perCat[chip.dataset.cat] || 0;
        setCount(chip.querySelector(".notify-chip-count"),n);
        chip.classList.toggle("is-empty",n===0);
    });

}
// =========================================================
// CARD
// A tap opens the detail page for Smart Alerts and Officer Reminders
// (see DETAIL_TYPES below); other cards do nothing on tap. Swipe gestures (mark
// read / delete) are the only interactions on a card — an
// always-visible tick/bin button pair used to sit here too, but
// they cluttered the card next to the swipe gesture that already
// did the same two things, so they're gone; a read card is now
// signaled by its text dimming instead (see .notify-card:not(.unread)
// in notification.css).
// =========================================================

// Types with a detail page (pages/notifications/detail.html) built
// from the notification's own extra data.
const DETAIL_TYPES=["smart_alert","officer_reminder"];

// A Reason Arrear submit lists the clients it covered (newer ones carry
// them in extra.clients).
// An LGs Loans alert (sent after an OS upload) opens the LGs Loans page.
const LGS_ALERT_URL="/CM_Pro/pages/masterdata/lgs.html";

// "Reason Arrear Waiting for Approval" (to Admin) opens the records
// page straight on its waiting-for-approval list.
const PENDING_URL="/CM_Pro/pages/masterdata/reasons.html?view=pending";
const isPendingAlert=item=>item.eventKey==="reasonarrear_pending";

function hasDetail(item){
return DETAIL_TYPES.includes(item.type) || item.type==="lgs_alert" || isPendingAlert(item) ||
(item.moduleCode==="ReasonArrear_Submit" && Array.isArray(item.extra && item.extra.clients) && item.extra.clients.length>0);
}

// A plain tap on such a card opens it. A swipe never fires click on
// touch devices, and a card mid-swipe is skipped anyway.
// One delegated listener for everything inside the list (the card's own
// buttons first, then opening a card), so re-renders never stack more.
notifyList.addEventListener("click",(e)=>{
    const actBtn=e.target.closest("[data-act]");
    if(actBtn && notifyList.contains(actBtn)){
        e.preventDefault();
        const actCard=actBtn.closest(".notify-card");
        if(actCard) handleCardAction(actBtn.dataset.act,actCard,actBtn);
        return;
    }
    openCardDetail(e.target.closest(".notify-card.has-detail"));
});

notifyList.addEventListener("keydown",(e)=>{
    if(e.key!=="Enter" && e.key!==" ") return;
    const card=e.target.closest(".notify-card.has-detail");
    if(!card || e.target!==card) return;
    e.preventDefault();
    openCardDetail(card);
});

function openCardDetail(card){
    if(!card || card.classList.contains("swiping")) return;
    const id=card.dataset.id;
    const item=allNotifications.find(n=>String(n._id)===id);
    if(!item) return;
    if(item.type==="lgs_alert"){ location.href=LGS_ALERT_URL; return; }
    if(isPendingAlert(item)){
        // keepalive: the page is leaving, so a plain fetch could be cut off.
        if(!item.isRead){
            try{
                fetch(`${API.BASE_URL}/api/notifications/mark-read`,{
                    method:"POST", keepalive:true,
                    headers:{ "Content-Type":"application/json", Authorization:`Bearer ${notificationToken}` },
                    body:JSON.stringify({ notificationId:id })
                }).catch(()=>{});
            }catch(err){}
        }
        location.href=PENDING_URL;
        return;
    }
    try{ sessionStorage.setItem("cm_notif_detail",JSON.stringify(item)); }catch(err){}
    location.href=`/CM_Pro/pages/notifications/detail.html?id=${encodeURIComponent(id)}`;
}

// A message is "long" (gets a Show more toggle) past ~2 lines' worth
// of text — a cheap estimate instead of measuring 1,000 cards' layout.
function isLongMessage(msg){
    const s=String(msg || "");
    return s.length>110 || (s.match(/\n/g) || []).length>=2;
}

const AVATAR_PLACEHOLDER="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%22%239AA5B1%22 d=%22M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z%22/%3E%3C/svg%3E";

function createNotificationCard(item,now){

const cat=getNotificationCategory(item);
const id=String(item._id == null ? "" : item._id);
const detail=hasDetail(item);
const group=dateGroupOf(item,now || new Date());
const fullTime=formatTime(item.createdAt);
// Under a Today / Yesterday heading the time of day is enough.
const time=(group==="today" || group==="yesterday") && timeOf(item)!=null
    ? formatClock(item.createdAt) : fullTime;
const uploadedBy=item.createdBy || item.username || "Unknown";
const iconName=getTypeIconName(item.type, cat);
const long=isLongMessage(item.message);
const expanded=long && expandedIds.has(id);
const catKey=categoryLabelKey(cat);

return `<article class="notify-card${item.isRead ? "" : " unread"}${detail ? " has-detail" : ""}${expanded ? " expanded" : ""}" data-id="${escapeHtml(id)}" data-url="${escapeHtml(item.url || "")}" data-cat="${cat}"${detail ? ` tabindex="0" role="button"` : ""}>`+
`<div class="notify-icon notify-icon-${iconName}">${getTypeIcon(item.type, cat)}</div>`+
`<div class="notify-content">`+
`<div class="notify-top">`+
`<div class="notify-card-title">${escapeHtml(item.title || "Notification")}</div>`+
`<div class="notify-time" title="${escapeHtml(fullTime)}">${item.isRead ? "" : `<span class="notify-dot" aria-hidden="true"></span>`}${escapeHtml(time)}</div>`+
`</div>`+
(item.message ? `<div class="notify-message">${escapeHtml(item.message)}</div>` : "")+
(long ? `<button type="button" class="notify-more" data-act="toggle" aria-expanded="${expanded}" data-i18n="notifications.${expanded ? "collapse" : "expand"}">${escapeHtml(tr(`notifications.${expanded ? "collapse" : "expand"}`))}</button>` : "")+
`<div class="notify-meta-row">`+
`<div class="notify-user"><img class="notify-user-avatar" alt="" data-avatar-user="${escapeHtml(uploadedBy)}" src="${AVATAR_PLACEHOLDER}"><span class="notify-user-name">${escapeHtml(uploadedBy)}</span></div>`+
`<span class="notify-type notify-type-${cat}" data-i18n="${catKey}">${escapeHtml(tr(catKey))}</span>`+
`<span class="notify-status sr-only" data-i18n="notifications.${item.isRead ? "read" : "unread"}">${escapeHtml(tr(`notifications.${item.isRead ? "read" : "unread"}`))}</span>`+
`<div class="notify-acts">`+
(item.isRead ? "" : `<button type="button" class="notify-act notify-act-read" data-act="read" data-i18n-aria-label="notifications.markRead" data-i18n-title="notifications.markRead" aria-label="${escapeHtml(tr("notifications.markRead"))}" title="${escapeHtml(tr("notifications.markRead"))}"><span class="nt-ico nt-ico-read-one" aria-hidden="true"></span></button>`)+
`<button type="button" class="notify-act notify-act-del" data-act="delete" data-i18n-aria-label="notifications.deleteOne" data-i18n-title="notifications.deleteOne" aria-label="${escapeHtml(tr("notifications.deleteOne"))}" title="${escapeHtml(tr("notifications.deleteOne"))}"><span class="nt-ico nt-ico-delete" aria-hidden="true"></span></button>`+
`</div>`+
`</div>`+
`</div>`+
`</article>`;

}

// =========================================================
// CARD BUTTONS (accessible twins of the swipe gestures)
// =========================================================

function handleCardAction(act,card,btn){

    const id=card.dataset.id;

    if(act==="toggle"){
        const open=!card.classList.contains("expanded");
        card.classList.toggle("expanded",open);
        if(open) expandedIds.add(id); else expandedIds.delete(id);
        const key=`notifications.${open ? "collapse" : "expand"}`;
        btn.setAttribute("data-i18n",key);
        btn.setAttribute("aria-expanded",open ? "true" : "false");
        btn.textContent=tr(key);
        return;
    }

    if(act==="read"){
        markCardRead(card);
        markRead(id);
        return;
    }

    if(act==="delete"){
        confirmDeleteOne(card);
    }

}

// Shared by the swipe-right gesture and the ✓ button.
function markCardRead(card){
    const id=card.dataset.id;
    markReadInState(id);
    card.classList.remove("unread");
    card.querySelector(".notify-act-read")?.remove();
    card.querySelector(".notify-dot")?.remove();
    const st=card.querySelector(".notify-status");
    if(st){ st.setAttribute("data-i18n","notifications.read"); st.textContent=tr("notifications.read"); }
    updateSummaryFromState();
    updateBadgeDisplay(allNotifications.filter(x=>!x.isRead).length);
}

// Shared by the swipe-left gesture and the bin button: slide the card
// out, then tidy the group heading (count, or drop it when emptied).
function removeCardAnimated(card,direction){
    const id=card.dataset.id;
    removeFromState(id);
    expandedIds.delete(id);
    card.style.transform=`translateX(${direction<0 ? "-120%" : "120%"})`;
    card.style.opacity=0;
    setTimeout(()=>{
        const section=card.closest(".notify-group");
        card.remove();
        if(section){
            const left=section.querySelectorAll(".notify-card").length;
            if(!left) section.remove();
            else{ const c=section.querySelector(".notify-group-count"); if(c) c.textContent=left; }
        }
        updateSummaryFromState();
        updateBadgeDisplay(allNotifications.filter(x=>!x.isRead).length);
        if(!notifyList.querySelector(".notify-card")){
            lastRenderSignature=null;
            renderList();
        }
    },250);
}

const deleteOneDialog=document.getElementById("deleteOneDialog");
let pendingDeleteCard=null;

function confirmDeleteOne(card){
    if(!deleteOneDialog){ doDeleteOne(card); return; }
    pendingDeleteCard=card;
    deleteOneDialog.classList.add("show");
    document.getElementById("btnDeleteOneNo")?.focus();
}

function closeDeleteOne(){
    deleteOneDialog?.classList.remove("show");
    pendingDeleteCard=null;
}

async function doDeleteOne(card){
    if(!card || !card.isConnected) return;
    vibrate([50,50,50]);
    removeCardAnimated(card,-1);
    await deleteNotification(card.dataset.id);
}

document.getElementById("btnDeleteOneYes")?.addEventListener("click",()=>{
    const card=pendingDeleteCard;
    closeDeleteOne();
    doDeleteOne(card);
});
document.getElementById("btnDeleteOneNo")?.addEventListener("click",closeDeleteOne);
deleteOneDialog?.addEventListener("click",(e)=>{ if(e.target===deleteOneDialog) closeDeleteOne(); });
document.addEventListener("keydown",(e)=>{ if(e.key==="Escape" && deleteOneDialog?.classList.contains("show")) closeDeleteOne(); });

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

                    return "data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%22%239AA5B1%22 d=%22M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z%22/%3E%3C/svg%3E";

                })

            : Promise.resolve("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%22%239AA5B1%22 d=%22M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z%22/%3E%3C/svg%3E");

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
                    removeCardAnimated(card,-1);

                }else if(moved && diff>120){

                    vibrate(40);

                    await markRead(id);

                    card.style.transform="translateX(100%)";

                    setTimeout(()=>{

                        card.style.transform="translateX(0)";

                        markCardRead(card);

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

        // This page scrolls inside <body>, not the window (base.css gives
        // html/body height:100% + overflow-x:hidden), so window.scrollY
        // is always 0 here — without body.scrollTop every downward drag
        // anywhere in the list counted as a pull and was blocked, which
        // is what made the list impossible to scroll back up.
        return Math.max(
            window.scrollY || 0,
            document.documentElement.scrollTop || 0,
            document.body.scrollTop || 0
        ) <= 0;

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

            loadNotificationBadge(true);

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

    // Remembered and painted again whenever the bottom bar is
    // (re)rendered — this can run before the bar exists.
    if(window.cmBadge) cmBadge.set(count);

    const notifyBadgeEl=document.getElementById("notificationBadge");

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

function setEmptyText(el,key){

    el.setAttribute("data-i18n",key);
    el.textContent=window.CMI18n ? CMI18n.t(key) : key;

}

function showEmpty(){

    notifyList.innerHTML="";
    emptyBox.style.display="flex";

    // Swap the data-i18n keys too (not just the text) so a later
    // CMI18n.apply() pass or language switch keeps the right message.
    // Which empty message: the search found nothing / a filter has
    // nothing / genuinely nothing at all.
    const searching=!!normalizeText(currentSearch);
    const clearBtn=document.getElementById("emptyClearBtn");

    if(searching){
        setEmptyText(emptyTitle,"notifications.noSearchResults");
        emptySubtitle.removeAttribute("data-i18n");
        emptySubtitle.textContent=`“${currentSearch.trim()}”`;
    }else if(allNotifications.length && currentFilter==="unread" && currentCategory==="all"){
        setEmptyText(emptyTitle,"notifications.emptyUnreadTitle");
        setEmptyText(emptySubtitle,"notifications.emptyUnreadSubtitle");
    }else if(allNotifications.length){
        setEmptyText(emptyTitle,"notifications.noFilterResults");
        setEmptyText(emptySubtitle,"notifications.noFilterResultsSub");
    }else{
        setEmptyText(emptyTitle,"notifications.emptyTitle");
        setEmptyText(emptySubtitle,"notifications.emptySubtitle");
    }

    if(clearBtn) clearBtn.hidden=!searching;

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

// Same line icons as the toast (cm-type-ico set in toast.css). The
// returned name also picks the icon box's color (notify-icon-<name>
// in notification.css).
function getTypeIconName(type,cat){

const known=["backup","upload","warning","error","success","update","delete","system"];

// Smart Alerts / Officer Reminders carry no emoji in their text — the
// card's own icon says what they are.
const byType={ smart_alert:"warning", officer_reminder:"clipboard", lgs_alert:"success" };

if(byType[type]) return byType[type];

if(known.includes(type)) return type;

// Unknown type: the category's icon (Reason Arrear → clipboard, …).
return (cat && CATEGORY_ICON[cat]) || "bell";

}

function getTypeIcon(type,cat){

return `<span class="cm-type-ico cm-type-ico-${getTypeIconName(type,cat)}" aria-hidden="true"></span>`;

}

// =========================================================
// TIME FORMAT
// =========================================================

function formatTime(date){

if(!date) return "";

const d=new Date(date);

if(isNaN(d)) return "";

// D-MMM-YY HH:mm (e.g. 17-Oct-26 12:30) — same style as the Credit
// Report charts. toLocaleString() was long (seconds, AM/PM) and changed
// with the phone's region settings, squeezing the card title.
const months=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const pad=n=>String(n).padStart(2,"0");

return `${d.getDate()}-${months[d.getMonth()]}-${String(d.getFullYear()).slice(2)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

}

// HH:mm only — for cards under the Today / Yesterday headings.
function formatClock(date){
    const d=new Date(date);
    if(!date || isNaN(d)) return "";
    const pad=n=>String(n).padStart(2,"0");
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// =========================================================
// SAFE HTML
// =========================================================

// Escapes & < > and both quotes — several callers interpolate this into
// quoted HTML attributes (data-url, avatar src), not just text nodes.
// Plain string replace (not a throwaway DOM node per call): a 1,000-card
// render calls this ~8,000 times.
const HTML_ESC={ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" };

function escapeHtml(text){

return (text == null ? "" : String(text)).replace(/[&<>"']/g,ch=>HTML_ESC[ch]);

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

            moduleCode:notification.moduleCode,

            eventKey:notification.eventKey,

            extra:notification.extra,

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

    // cmChannel (shared/page-transition.js) closes it while the page
    // sits in the back/forward cache, so Back stays instant.
    cmChannel(

        "cm-pro-notifications",

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
