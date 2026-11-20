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

            const user=JSON.parse(localStorage.getItem("loggedInUser") || "{}");

            initTopbar({

                dashboardMode:true,

                userName:user.fullname || user.username || "User",

                showLogo:true,

                showProfile:true,

                showBack:false

            });

            loadTopbarUser();

            loadTopbarPhoto();

            // ===== PROFILE PHOTO CLICK =====

            setTimeout(()=>{

                const profile=document.getElementById("topbarProfile");

                if(profile && !profile.closest(".topbar-profile-ring")){

                    const ring=document.createElement("div");

                    ring.className="topbar-profile-ring";

                    profile.parentNode.insertBefore(ring,profile);

                    ring.appendChild(profile);

                }

                if(profile){

                    profile.style.cursor="pointer";

                    profile.onclick=function(){

                        window.location.href="/CM_Pro/pages/settings/account.html";

                    };

                }

            },100);

        }

        // Set the active nav item right when bottomnav actually
        // finishes loading — avoids racing a blind setTimeout
        // against a possibly-slow network fetch.

        if(id==="bottomnav-container"){

            const items=document.querySelectorAll(".bottom-nav-item");

            items.forEach(item=>item.classList.remove("active"));

            items[0]?.classList.add("active");

        }

    }catch(error){

        console.error("Component load error:",error);

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
// LOAD USER
// =========================

function loadTopbarUser(){

    try{

        const user=JSON.parse(localStorage.getItem("loggedInUser") || "{}");

        const fullname=user.fullname || user.username || "User";

        const userName=document.getElementById("topbarUserName");

        if(userName){

            userName.innerText=fullname;

        }

    }catch(error){

        console.error(error);

    }

}

// =========================
// OFFLINE DETECT
// =========================

function updateOnlineStatus(){

    const banner=document.getElementById("offlineBanner");

    banner.style.display=navigator.onLine ? "none" : "block";

}

window.addEventListener("online",updateOnlineStatus);

window.addEventListener("offline",updateOnlineStatus);

updateOnlineStatus();

// =========================
// CARD VIBRATION
// =========================
// Android: the Vibration API (20 ms).
// iOS has no Vibration API (some versions expose a `navigator.vibrate`
// that does nothing or misbehaves, so it is never used there). Since
// iOS 18, Safari plays the system haptic when a switch-style checkbox
// (<input type="checkbox" switch>) is toggled through its <label> — so
// a hidden one is toggled on each tap (20/11/2026). Older iOS, or
// "System Haptics" turned off in Settings, simply stays silent.

function isIOSDevice(){
    return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
        (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

let iosHapticLabel = null;

function iosHaptic(){
    if(!iosHapticLabel){
        const input = document.createElement("input");
        input.type = "checkbox";
        input.setAttribute("switch", "");
        input.id = "cmHapticSwitch";
        input.tabIndex = -1;
        input.setAttribute("aria-hidden", "true");
        const label = document.createElement("label");
        label.htmlFor = input.id;
        label.setAttribute("aria-hidden", "true");
        label.style.cssText = input.style.cssText =
            "position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:-9999px;top:0";
        document.body.append(input, label);
        iosHapticLabel = label;
    }
    iosHapticLabel.click();
}

function haptic(){
    try{
        if(isIOSDevice()) iosHaptic();
        else if(navigator.vibrate) navigator.vibrate(20);
    }catch(e){ /* no haptics here */ }
}

document.addEventListener("click",(e)=>{

    if(e.target.closest(".dashboard-card")) haptic();

});

// =========================
// LOAD COMPONENTS
// =========================

loadComponent("topbar-container","./components/topbar.html");

loadComponent("bottomnav-container","./components/bottomnav.html");

// =========================
// PUSH INIT
// =========================

const pushEnabled=localStorage.getItem("notificationEnabled");

if(pushEnabled==="true"){

    PushNotification.enable();

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
