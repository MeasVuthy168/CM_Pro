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

            // Back goes to whichever page linked here — the dashboard, or
            // the Credit Report hub (which appends ?from=creditreport).
            const crFrom = new URLSearchParams(location.search).get("from");
            const backTarget = crFrom === "creditreport"
                ? "/CM_Pro/pages/creditreport/index.html"
                : "/CM_Pro/index.html";

            // initTopbar sets `backBtn.onclick = () => history.back()`.
            // Reassigning .onclick cleanly replaces that (it's a property,
            // not addEventListener, so there's no listener to remove).
            //
            // An explicit href beats history.back() here: this page can be
            // reached by reload, bookmark, or PWA restore, where there's no
            // previous history entry to return to.
            const backBtn = document.getElementById("topbarBackBtn");
            if (backBtn) {
                backBtn.onclick = () => { location.href = backTarget; };
            }

            // Relocate the page's own "..." menu (Export/Print/Landscape,
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
// =========================
// BACK DESTINATION PERSISTENCE
// The ?from= param is how this page knows whether Back should return to
// the dashboard or the Credit Report hub. Stash it in sessionStorage so
// the destination survives a reload/PWA restore that drops the query
// string, and restore it into the URL when it's missing.
// =========================
(function persistArrearsOrigin() {
    const KEY = "arrearsBackFrom";
    const params = new URLSearchParams(location.search);
    const from = params.get("from");

    if (from) {
        sessionStorage.setItem(KEY, from);
        return;
    }

    const saved = sessionStorage.getItem(KEY);
    if (saved) {
        params.set("from", saved);
        history.replaceState(null, "", `${location.pathname}?${params}`);
    }
})();

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
