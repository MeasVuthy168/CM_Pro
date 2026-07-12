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
                title:"Daily Arrears",
                showBack:true,
                showLogo:false,
                showProfile:false
            });

            // Relocate the page's own "..." menu (Refresh/Export/Print,
            // built in index.html) into the topbar's right side. This
            // moves the EXISTING elements rather than rebuilding them,
            // so the click handlers already wired in arrears.js keep
            // working — topbar.html/topbar.css themselves are never
            // touched, so this only affects this page, not the shared
            // component used elsewhere in the app.
            const menuWrap = document.getElementById("arrearsMenuWrap");
            const topbarRight = document.querySelector("#topbar-container .topbar-right");
            if (menuWrap && topbarRight) {
                topbarRight.insertBefore(menuWrap, topbarRight.firstChild);
            }
        }
    }catch(error){
        console.error(error);
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
// OFFLINE DETECT
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
// NOTIFICATION BADGE
// =========================
setTimeout(()=>{
    if(typeof loadNotificationBadge==="function"){
        loadNotificationBadge();
    }
},500);
