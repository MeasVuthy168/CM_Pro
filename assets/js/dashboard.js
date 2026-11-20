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

// iPhone (20/11/2026): a switch clicked from code no longer plays a
// haptic on newer iOS (owner's iOS 27). A REAL tap on a switch still
// does — so every card carries an invisible native switch over its
// whole face: the finger lands on it, iOS plays its haptic, and the
// card's link is then followed by code (a tap on a form control inside
// a link doesn't follow the link by itself).
function addIOSHapticTargets(){
    document.querySelectorAll(".dashboard-card").forEach(card => {
        if(card.querySelector(".cm-haptic-hit")) return;
        const label = document.createElement("label");
        label.className = "cm-haptic-hit";
        label.setAttribute("aria-hidden", "true");
        const input = document.createElement("input");
        input.type = "checkbox";
        input.setAttribute("switch", "");
        input.tabIndex = -1;
        label.appendChild(input);
        card.appendChild(label);
        // The switch toggled (and buzzed): now open the card's page.
        // Straight to it: the page-transition script already took the
        // tap as this link's (its loading bar is running) and would
        // block a second, synthetic click on the card as a double tap.
        input.addEventListener("change", () => {
            location.href = card.href;
        });
    });
}

function haptic(){
    try{
        if(!isIOSDevice() && navigator.vibrate) navigator.vibrate(20);
    }catch(e){ /* no haptics here */ }
}

document.addEventListener("click",(e)=>{

    // The switch's own clicks (iOS) are not a card tap.
    if(e.target.closest(".cm-haptic-hit")) return;
    if(e.target.closest(".dashboard-card")) haptic();

});

if(isIOSDevice()) addIOSHapticTargets();

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
