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
// The photo gets a skeleton pulse while loading, and one
// automatic retry (short delay, cache-busted) before falling
// back to the default avatar — a single dropped request on a
// flaky mobile connection shouldn't be treated as permanent
// failure.

let photoLoadToken=0;

function loadProfilePhoto(username){

    const img=document.getElementById("settingPhoto");

    if(!img || !username) return;

    const fallback="/CM_Pro/assets/images/default-user.png";

    const photoUrl=`${API.BASE_URL}/assets/user-photo/${username}`;

    // Each call gets its own token so an in-flight retry from a
    // previous call (e.g. pageshow firing right after load) can't
    // clobber a newer, already-successful load.

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

                this.src=photoUrl+`?retry=${Date.now()}`;

            },800);

            return;

        }

        this.onerror=null;

        this.classList.remove("photo-loading");

        this.src=fallback;

    };

    img.src=photoUrl;

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
