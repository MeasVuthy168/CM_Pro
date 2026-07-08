// =========================
// COMPONENT LOADER
// =========================

let loaded=0;

async function loadComponent(id,file){

    try{

        const useCache=id!=="topbar-container";

        const cached=useCache ? sessionStorage.getItem("comp_"+id) : null;

        if(cached){

            document.getElementById(id).innerHTML=cached;

        }else{

            const response=await fetch(file);

            const html=await response.text();

            document.getElementById(id).innerHTML=html;

            if(useCache){

                sessionStorage.setItem("comp_"+id,html);

            }

        }

        if(id==="topbar-container"){

            initTopbar({

                title:"Setting",

                showBack:true,

                showLogo:false,

                showProfile:false

            });

        }

        // Set the active nav item right when bottomnav actually
        // finishes loading — avoids racing a blind setTimeout
        // against a possibly-slow network fetch.

        if(id==="bottomnav-container"){

            const items=document.querySelectorAll(".bottom-nav-item");

            items.forEach(item=>item.classList.remove("active"));

            items[1]?.classList.add("active");

        }

    }catch(err){

        console.error(err);

    }finally{

        loaded++;

        if(loaded>=2){

            setTimeout(()=>{

                if(typeof hideGlobalSplash==="function"){

                    hideGlobalSplash();

                }

            },300);

        }

    }

}

// =========================
// OFFLINE DETECT
// =========================

function updateOnlineStatus(){

    const banner=document.getElementById("offlineBanner");

    if(banner){

        banner.style.display=navigator.onLine ? "none" : "block";

    }

}

window.addEventListener("online",updateOnlineStatus);

window.addEventListener("offline",updateOnlineStatus);

updateOnlineStatus();

// =========================
// LOAD COMPONENTS
// =========================

loadComponent("topbar-container","/CM_Pro/components/topbar.html");

loadComponent("bottomnav-container","/CM_Pro/components/bottomnav.html");

// =========================
// PUSH
// =========================

if(window.PushNotification){

    PushNotification.init();

}

// =========================
// FAILSAFE SPLASH
// =========================

window.addEventListener("load",()=>{

    setTimeout(()=>{

        if(typeof hideGlobalSplash==="function"){

            hideGlobalSplash();

        }

    },2500);

});

// =========================
// LOAD USER INFO
// =========================
// Stability strategy for the profile photo, front to back:
//   1. Skeleton pulse while loading — never a blank/broken flash.
//   2. On failure, one automatic retry after a short delay, with
//      a cache-busting query param — this is the actual fix for
//      "sometimes disappears": a single dropped request used to
//      go straight to the fallback with no second chance, and a
//      same-URL retry can hit the exact same stale/failed cache
//      entry (browser HTTP cache or the service worker's
//      cache-first strategy) instead of actually reaching network.
//   3. Only after the retry also fails does it fall back to the
//      default avatar.
// =========================

let photoLoadToken=0;

function loadUserPhoto(){

    const user=JSON.parse(localStorage.getItem("loggedInUser") || "{}");

    if(!user.username) return;

    const img=document.getElementById("settingPhoto");

    if(!img) return;

    const fallback="/CM_Pro/assets/images/default-user.png";

    const baseUrl=`${API.BASE_URL}/assets/user-photo/${user.username}`;

    // Each call gets its own token so an in-flight retry from a
    // previous call can't clobber a newer one (e.g. rapid back/
    // forward navigation triggering this multiple times).

    const myToken=++photoLoadToken;

    let retried=false;

    img.classList.add("photo-loading");

    img.onload=function(){

        if(myToken!==photoLoadToken) return;

        this.classList.remove("photo-loading");

    };

    img.onerror=function(){

        if(myToken!==photoLoadToken) return;

        if(this.src.indexOf(fallback)!==-1){

            this.classList.remove("photo-loading");

            return;

        }

        if(!retried){

            retried=true;

            setTimeout(()=>{

                if(myToken!==photoLoadToken) return;

                this.src=`${baseUrl}?retry=${Date.now()}`;

            },800);

            return;

        }

        this.onerror=null;

        this.classList.remove("photo-loading");

        this.src=fallback;

    };

    // Cache-bust every explicit (re)load, not just the retry —
    // this is what actually stops a stale cached failure (browser
    // HTTP cache or service worker) from being replayed on every
    // back-navigation instead of a fresh network attempt.

    img.src=`${baseUrl}?v=${Date.now()}`;

}

async function loadUserProfile(){

    try{

        const user=JSON.parse(localStorage.getItem("loggedInUser") || "{}");

        document.getElementById("settingFullname").innerText=

            user.fullname || user.username || "Unknown";

        loadUserPhoto();

    }catch(err){

        console.error(err);

    }

}

// =========================
// FIX: RELOAD PHOTO ON BACK / BFCACHE RESTORE
// =========================
// pageshow with event.persisted covers most bfcache restores.
// visibilitychange is a second safety net for navigation paths
// some Android WebViews don't fire pageshow reliably for (e.g.
// certain in-app back gestures) — it only re-triggers when the
// photo is actually in a broken state, so it's a no-op the rest
// of the time.

function isPhotoBroken(img){

    return !img || !img.complete || img.naturalWidth===0;

}

window.addEventListener("pageshow",function(event){

    const img=document.getElementById("settingPhoto");

    if(!img) return;

    if(event.persisted || isPhotoBroken(img)){

        loadUserPhoto();

    }

});

document.addEventListener("visibilitychange",function(){

    if(document.visibilityState!=="visible") return;

    const img=document.getElementById("settingPhoto");

    if(isPhotoBroken(img)){

        loadUserPhoto();

    }

});

// =========================
// NOTIFICATION SWITCH
// =========================

async function initNotificationSwitch(){

    const toggle=document.getElementById("notifyToggle");

    if(!toggle) return;

    toggle.checked=await PushNotification.isEnabled();

    toggle.onchange=async function(){

        if(this.checked){

            localStorage.setItem("notificationEnabled","true");

            await PushNotification.enable();

        }else{

            await PushNotification.disable();

        }

    };

}

// =========================
// LOGOUT DIALOG
// =========================

function initLogoutDialog(){

    const logoutBtn=document.getElementById("logoutBtn");

    const logoutDialog=document.getElementById("logoutDialog");

    const btnLogoutYes=document.getElementById("btnLogoutYes");

    const btnLogoutNo=document.getElementById("btnLogoutNo");

    if(!logoutBtn || !logoutDialog || !btnLogoutYes || !btnLogoutNo){

        console.error("Logout dialog elements not found.");

        return;

    }

    logoutBtn.addEventListener("click",()=>{

        logoutDialog.classList.add("show");

    });

    btnLogoutNo.addEventListener("click",()=>{

        logoutDialog.classList.remove("show");

    });

    btnLogoutYes.addEventListener("click",()=>{

        localStorage.removeItem("token");

        localStorage.removeItem("loggedInUser");

        sessionStorage.clear();

        window.location.replace("/CM_Pro/login.html");

    });

}

// =========================
// PAGE INIT
// =========================

window.addEventListener("load",()=>{

    loadUserProfile();

    initNotificationSwitch();

    initLogoutDialog();

});
