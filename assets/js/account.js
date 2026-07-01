// =========================
// COMPONENT LOADER
// =========================

let loaded = 0;

async function loadComponent(id,file){

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

            document.getElementById(id).innerHTML =
                cached;

        }else{

            const response =
                await fetch(file);

            const html =
                await response.text();

            document.getElementById(id).innerHTML =
                html;

            if(useCache){

                sessionStorage.setItem(
                    "comp_" + id,
                    html
                );

            }

        }

        if(id==="topbar-container"){

            initTopbar({

                title:"Account",

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

loadComponent(
    "topbar-container",
    "/CM_Pro/components/topbar.html"
);

loadComponent(
    "bottomnav-container",
    "/CM_Pro/components/bottomnav.html"
);

// =========================
// LOAD USER
// =========================

window.addEventListener(

    "load",

    ()=>{

        try{

            const user = JSON.parse(

                localStorage.getItem(
                    "loggedInUser"
                ) || "{}"

            );

            document.getElementById(
                "accountFullname"
            ).innerText =
                user.fullname || "-";

            document.getElementById(
                "accountUsername"
            ).innerText =
                user.username || "-";

            document.getElementById(
                "accountFullname2"
            ).innerText =
                user.fullname || "-";

            document.getElementById(
                "accountUsername2"
            ).innerText =
                user.username || "-";

            document.getElementById(
                "accountRole"
            ).innerText =
                user.role || "-";

            document.getElementById(
                "accountPhone"
            ).innerText =
                user.phone || "-";

            if(user.username){

                const img =
                    document.getElementById(
                        "accountPhoto"
                    );

                img.src =
                    `${API.BASE_URL}/assets/user-photo/${user.username}`;

                img.onerror=function(){

                    this.src =
                    "/CM_Pro/assets/images/default-user.png";

                };

            }

        }catch(err){

            console.error(err);

        }

    }

);

// =========================
// PUSH
// =========================

if(window.PushNotification){

    PushNotification.init();

}

// =========================
// ACTIVE NAV
// =========================

setTimeout(()=>{

    document.querySelectorAll(".bottom-nav-item")
        .forEach(item=>item.classList.remove("active"));

},300);

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
