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
// FIX: /assets/user-photo/:username requires a JWT (requireJwt on
// the server), but a plain <img src="..."> has no way to send an
// Authorization header — so a fresh (uncached) request always 401s.
// It only ever "worked" when the service worker already had a
// cached 200 response for that exact URL from some earlier
// successful load. Fetching with fetch() + the Authorization header
// + converting the response to a blob URL is the actual fix: this
// still goes through the same service worker (which forwards
// event.request, headers included), so a successful fetch here also
// warms the SW cache for next time, same as before — it just
// actually succeeds now instead of depending on a cache that may
// not exist yet.
//
// The photo still gets a skeleton pulse while loading, and one
// automatic retry (short delay, cache-busted) before falling back
// to the default avatar — a single dropped request on a flaky
// mobile connection shouldn't be treated as permanent failure.

let photoLoadToken=0;
let photoObjectUrl=null;

async function loadProfilePhoto(username){

    const img=document.getElementById("settingPhoto");

    if(!img || !username) return;

    const fallback="/CM_Pro/assets/images/default-user.png";

    const photoUrl=`${API.BASE_URL}/assets/user-photo/${username}`;

    // Each call gets its own token so an in-flight retry from a
    // previous call (e.g. pageshow firing right after load) can't
    // clobber a newer, already-successful load.

    const myToken=++photoLoadToken;

    img.classList.add("photo-loading");

    async function attempt(isRetry){

        try{

            const token=

                localStorage.getItem("token") ||
                sessionStorage.getItem("token");

            const url=

                isRetry ?
                    `${photoUrl}?retry=${Date.now()}` :
                    photoUrl;

            const res=await fetch(url,{

                headers: token ?
                    { Authorization:`Bearer ${token}` } :
                    {}

            });

            if(myToken!==photoLoadToken) return;

            if(!res.ok){

                throw new Error(`HTTP ${res.status}`);

            }

            const blob=await res.blob();

            if(myToken!==photoLoadToken) return;

            // revoke the previous object URL (if any) before
            // creating a new one, so these don't leak memory across
            // repeated loads (bfcache restores, retries, etc.)
            if(photoObjectUrl){

                URL.revokeObjectURL(photoObjectUrl);

            }

            photoObjectUrl=URL.createObjectURL(blob);

            img.src=photoObjectUrl;

            img.classList.remove("photo-loading");

        }catch(err){

            if(myToken!==photoLoadToken) return;

            if(!isRetry){

                setTimeout(()=>attempt(true),800);

                return;

            }

            console.error("Profile photo load failed:",err);

            img.classList.remove("photo-loading");

            img.src=fallback;

        }

    }

    attempt(false);

}

async function loadUserProfile(){

    try{

        const user=JSON.parse(localStorage.getItem("loggedInUser") || "{}");

        document.getElementById("settingFullname").innerText=

            user.fullname || user.username || "Unknown";

        if(user.username){

            loadProfilePhoto(user.username);

        }

    }catch(err){

        console.error(err);

    }

}

// =========================
// FIX: RELOAD PHOTO ON BACK / BFCACHE RESTORE
// =========================
// Only reacts to a genuine bfcache restore (event.persisted) —
// checking img.complete/naturalWidth here too (as before) caused
// a false positive on *every* normal page load, since pageshow
// fires right after load while the photo request kicked off by
// loadUserProfile() is often still in flight, restarting it
// needlessly.

window.addEventListener("pageshow",function(event){

    if(!event.persisted) return;

    const user=JSON.parse(localStorage.getItem("loggedInUser") || "{}");

    if(user.username){

        loadProfilePhoto(user.username);

    }

});

// =========================
// FIX: RECOVER ON RESUME (hybrid WebView safety net)
// =========================
// Capacitor/Cordova-style WebViews don't always fire pageshow /
// event.persisted reliably on back-navigation the way a normal
// browser tab does. visibilitychange is the more dependable
// signal across environments for "the user is looking at this
// page again" — used here purely as a recovery check, so it only
// reloads the photo if it's actually missing/broken right now.

document.addEventListener("visibilitychange",function(){

    if(document.visibilityState!=="visible") return;

    const img=document.getElementById("settingPhoto");

    if(!img) return;

    const broken=!img.complete || img.naturalWidth===0;

    if(!broken) return;

    const user=JSON.parse(localStorage.getItem("loggedInUser") || "{}");

    if(user.username){

        loadProfilePhoto(user.username);

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
// THEME SWITCH
// =========================
// Reuses the same .switch UI as the notification toggle above.
// window.CMTheme comes from shared/theme.js — checked = dark,
// unchecked = light. The actual color values live in each page's
// own CSS via [data-theme="dark"] blocks; this switch just flips
// the shared data-theme attribute + localStorage flag that every
// page reads on load.

function initThemeSwitch(){

    const toggle=document.getElementById("themeToggle");

    if(!toggle || !window.CMTheme) return;

    toggle.checked = CMTheme.get()==="dark";

    toggle.onchange=function(){

        CMTheme.set(this.checked ? "dark" : "light");

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

    initThemeSwitch();

    initLogoutDialog();

});
