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
// iOS Safari doesn't support the Vibration API — except some iOS
// versions expose a `navigator.vibrate` function that silently
// no-ops OR (reported on-device) actually buzzes, so feature-
// detecting `navigator.vibrate` alone isn't reliable there. Skip it
// outright on iOS rather than trusting the feature check.

function isIOSDevice(){
    return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

document.addEventListener("click",(e)=>{

    if(e.target.closest(".dashboard-card") && navigator.vibrate && !isIOSDevice()){

        navigator.vibrate(20);

    }

});

// =========================
// ASSISTANT BOX SPACER
// The box is position:fixed above the bottom nav (see assistant.css)
// so it doesn't scroll with the grid — the grid's own bottom padding
// needs to reserve exactly that much space, or its last row ends up
// hidden underneath the box. The box's height isn't constant (update
// mode adds a CTA line, "Coming soon" text wraps differently per
// device), so this keeps watching it rather than measuring once.
// =========================

function syncAssistantBoxSpacer(){

    const box=document.querySelector(".assistant-box");

    const container=document.querySelector(".dashboard-container");

    if(!box || !container) return;

    const sync=()=>{

        container.style.paddingBottom=
            (box.offsetHeight + 78 + 20) + "px";

    };

    sync();

    if(window.ResizeObserver && !box._spacerObserverAttached){

        box._spacerObserverAttached=true;

        new ResizeObserver(sync).observe(box);

    }

}

syncAssistantBoxSpacer();

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
