// ========================
// COMPONENTS
// ========================

async function loadComponent(id,file){

    const response = await fetch(file);

    const html = await response.text();

    document.getElementById(id).innerHTML = html;

    if(id==="topbar-container"){

        initTopbar({

            title:"Setting",

            showBack:true,

            showLogo:false,

            showProfile:false

        });

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
