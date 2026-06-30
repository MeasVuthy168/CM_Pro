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
// ACTIVE NAV
// =========================

setTimeout(()=>{

    document.querySelectorAll(".bottom-nav-item")
        .forEach(item=>item.classList.remove("active"));

    document.querySelectorAll(".bottom-nav-item")[1]
        ?.classList.add("active");

},300);
