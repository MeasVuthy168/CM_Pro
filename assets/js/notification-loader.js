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

                title:"Notifications",

                showBack:true,

                showProfile:false,

                showLogo:false,

                actionText:"⋮",

                actionHandler:toggleNotificationMenu

            });

        }

        // Set the active nav item right when bottomnav actually
        // finishes loading — avoids racing a blind setTimeout
        // against a possibly-slow network fetch.

        if(id==="bottomnav-container"){

            const items=document.querySelectorAll(".bottom-nav-item");

            items.forEach(item=>item.classList.remove("active"));

            items[2]?.classList.add("active");

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
// MENU EVENTS
// The menu buttons are static markup already present when this
// script runs — no need to wait on an arbitrary timer for them
// to "appear" like the old inline version did.
// =========================

function initNotificationMenuActions(){

    const readBtn=document.getElementById("menuReadAll");

    if(readBtn){

        readBtn.onclick=()=>{

            document.getElementById("readAllBtn").click();

        };

    }

    const deleteBtn=document.getElementById("menuDeleteAll");
    const deleteAllDialog=document.getElementById("deleteAllDialog");

    if(deleteBtn && deleteAllDialog){

        // Native confirm() looked out of place next to the rest of the
        // app's own styled dialogs (e.g. the logout confirm in
        // Settings) — this is the same dialog/dialog-box/dialog-buttons
        // pattern, just local to this page's own CSS.
        deleteBtn.onclick=()=>{

            deleteAllDialog.classList.add("show");

        };

        document.getElementById("btnDeleteAllNo")?.addEventListener("click",()=>{

            deleteAllDialog.classList.remove("show");

        });

        document.getElementById("btnDeleteAllYes")?.addEventListener("click",async()=>{

            deleteAllDialog.classList.remove("show");

            try{

                await fetch(

                    `${API.BASE_URL}/api/notifications/delete-all`,

                    {

                        method:"POST",

                        headers:{

                            Authorization:`Bearer ${notificationToken}`

                        }

                    }

                );

                loadNotifications();

                if(typeof loadNotificationBadge==="function"){

                    loadNotificationBadge();

                }

            }catch(error){

                console.error(error);

            }

        });

    }

}

initNotificationMenuActions();

// =========================
// OFFLINE
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
