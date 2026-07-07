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

document.addEventListener("click",(e)=>{

    if(e.target.closest(".dashboard-card") && navigator.vibrate){

        navigator.vibrate(20);

    }

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
