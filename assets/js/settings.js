
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
// LOGOUT DIALOG
// =========================

const logoutBtn=document.getElementById("logoutBtn");
const logoutDialog=document.getElementById("logoutDialog");
const btnLogoutYes=document.getElementById("btnLogoutYes");
const btnLogoutNo=document.getElementById("btnLogoutNo");

logoutBtn.onclick=function(){

logoutDialog.classList.add("show");

};

btnLogoutNo.onclick=function(){

logoutDialog.classList.remove("show");

};

btnLogoutYes.onclick=function(){

localStorage.removeItem("token");
localStorage.removeItem("loggedInUser");
sessionStorage.clear();

window.location.replace("/CM_Pro/login.html");

};
