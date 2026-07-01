
// =========================
// COMPONENT LOADER
// =========================

let loaded = 0;

async function loadComponent(id, file){

    try{

        const useCache =
            id !== "topbar-container";

        const cached =
            useCache
            ? sessionStorage.getItem(
                "comp_" + id
              )
            : null;

        if(cached){

            document
                .getElementById(id)
                .innerHTML = cached;

        }else{

            const response =
                await fetch(file);

            const html =
                await response.text();

            document
                .getElementById(id)
                .innerHTML = html;

            if(useCache){

                sessionStorage.setItem(
                    "comp_" + id,
                    html
                );

            }

        }

        // =====================
        // TOPBAR
        // =====================

        if(id==="topbar-container"){

            initTopbar({

                title:"Setting",

                showBack:true,

                showLogo:false,

                showProfile:false

            });

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
// LOAD COMPONENTS
// =========================

loadComponent(
    "topbar-container",
    "/CM_Pro/components/topbar.html"
);

loadComponent(
    "bottomnav-container",
    "/CM_Pro/components/bottomnav.html"
);

// =========================
// PUSH
// =========================

if(window.PushNotification){

    PushNotification.init();

}

// =========================
// FAILSAFE SPLASH
// =========================

window.addEventListener(

    "load",

    ()=>{

        setTimeout(()=>{

            if(typeof hideGlobalSplash==="function"){

                hideGlobalSplash();

            }

        },2500);

    }

);
// =========================
// LOAD USER INFO
// =========================

async function loadUserProfile(){

    try{

        const user = JSON.parse(
            localStorage.getItem("loggedInUser") || "{}"
        );

        document.getElementById("settingFullname").innerText =
            user.fullname ||
            user.username ||
            "Unknown";

        document.getElementById("settingUsername").innerText =
            user.username || "";

        // role
        if(!document.getElementById("settingRole")){

            const role = document.createElement("div");

            role.id = "settingRole";

            role.className = "profile-role";

            document
                .querySelector(".profile-info")
                .appendChild(role);

        }

        document.getElementById("settingRole").innerText =
            user.role || "";

        // photo
        if(user.username){

            const img =
                document.getElementById("settingPhoto");

            img.src =
                `${API.BASE_URL}/assets/user-photo/${user.username}`;

            img.onerror = function(){

                this.src =
                "/CM_Pro/assets/images/default-user.png";

            };

        }

    }catch(err){

        console.error(err);

    }

}

window.addEventListener(

    "load",

    loadUserProfile

);

// =========================
// ACTIVE NAV
// =========================

setTimeout(()=>{

    document.querySelectorAll(".bottom-nav-item")
        .forEach(item=>item.classList.remove("active"));

    document.querySelectorAll(".bottom-nav-item")[1]
        ?.classList.add("active");

},300);

// =========================
// NOTIFICATION TOGGLE
// =========================

window.addEventListener("load", initNotificationToggle);

async function initNotificationToggle(){

const toggle=document.getElementById("notifyToggle");

if(!toggle)return;

// Current status
toggle.checked=(Notification.permission==="granted");

// User changed switch
toggle.addEventListener("change",async function(){

// Turn ON
if(this.checked){

const permission=await Notification.requestPermission();

if(permission==="granted"){

localStorage.setItem("notificationEnabled","true");

}else{

this.checked=false;

localStorage.setItem("notificationEnabled","false");

}

return;

}

// Turn OFF
this.checked=true;

alert("Please disable notification from your browser settings.");

});

}
// =========================
// LOGOUT DIALOG
// =========================

window.addEventListener("load",()=>{

const logoutBtn=document.getElementById("logoutBtn");
const logoutDialog=document.getElementById("logoutDialog");
const btnLogoutYes=document.getElementById("btnLogoutYes");
const btnLogoutNo=document.getElementById("btnLogoutNo");

if(!logoutBtn||!logoutDialog||!btnLogoutYes||!btnLogoutNo){
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

});
