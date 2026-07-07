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

async function loadUserProfile(){

    try{

        const user=JSON.parse(localStorage.getItem("loggedInUser") || "{}");

        document.getElementById("settingFullname").innerText=

            user.fullname || user.username || "Unknown";

        // photo

        if(user.username){

            const img=document.getElementById("settingPhoto");

            const fallback="/CM_Pro/assets/images/default-user.png";

            // set onerror BEFORE src so a fast/cached failure
            // can never slip through the gap.
            // guarded so it can't loop forever if the fallback
            // image itself is missing/broken.

            img.onerror=function(){

                if(this.src.indexOf(fallback)!==-1) return;

                this.onerror=null;

                this.src=fallback;

            };

            img.src=`${API.BASE_URL}/assets/user-photo/${user.username}`;

        }

    }catch(err){

        console.error(err);

    }

}

// =========================
// FIX: RELOAD PHOTO ON BACK / BFCACHE RESTORE
// =========================
// When navigating back from another page, the browser may restore
// this page from bfcache without firing "load" again. If the photo
// request was aborted or never completed before navigating away,
// it stays broken. This re-checks and re-fetches it when needed.

window.addEventListener("pageshow",function(event){

    const img=document.getElementById("settingPhoto");

    if(!img) return;

    const broken=!img.complete || img.naturalWidth===0;

    if(event.persisted || broken){

        loadUserProfile();

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
