window.initTopbar = function(config={}){

    const {

        title = "",

        userName = "",

        dashboardMode = false,

        showBack = false,

        showProfile = true,

        showLogo = true,

        actionText = "",

        actionHandler = null

    } = config;

    // =========================
    // ELEMENTS
    // =========================

    const titleEl =
        document.getElementById(
            "topbarTitle"
        );

    const centerEl =
        document.querySelector(
            ".topbar-center"
        );

    const logoEl =
        document.getElementById(
            "topbarLogo"
        );

    const profileBox =
        document.getElementById(
            "topbarUserBox"
        );

    const profileName =
        document.getElementById(
            "topbarUserName"
        );

    const backBtn =
        document.getElementById(
            "topbarBackBtn"
        );

    const actionBtn =
        document.getElementById(
            "topbarActionBtn"
        );

    // =========================
    // DASHBOARD MODE
    // =========================

    if(dashboardMode){

        if(titleEl){

            titleEl.innerHTML = "";

            titleEl.style.display =
                "none";

        }

        if(centerEl){

            centerEl.style.display =
                "none";

        }

        if(profileName){

            profileName.style.display =
                "block";

            profileName.innerText =
                userName || "User";

        }

    }

    // =========================
    // NORMAL PAGE MODE
    // =========================

    else{

        if(centerEl){

            centerEl.style.display =
                "block";

        }

        if(titleEl){

            titleEl.style.display =
                "block";

            titleEl.innerText =
                title || "CM_Pro";

        }

        if(profileName){

            profileName.style.display =
                "none";

        }

    }

    // =========================
    // LOGO
    // =========================

    if(logoEl){

        logoEl.style.display =

            showLogo

            ? "block"

            : "none";

    }

    // =========================
    // PROFILE
    // =========================

    if(profileBox){

        profileBox.style.display =

            showProfile

            ? "flex"

            : "none";

    }

    // =========================
    // BACK BUTTON
    // =========================

    if(backBtn){

        backBtn.style.display =

            showBack

            ? "block"

            : "none";

        backBtn.onclick =
            ()=>history.back();

    }

    // =========================
    // ACTION BUTTON
    // =========================

    if(actionBtn){

        if(actionText){

            actionBtn.style.display =
                "block";

            actionBtn.innerText =
                actionText;

            actionBtn.onclick =
                actionHandler;

        }else{

            actionBtn.style.display =
                "none";

        }

    }

   // =========================
// COMPACT PAGE MODE
// =========================

const leftBox =
    document.querySelector(
        ".topbar-left"
    );

const rightBox =
    document.querySelector(
        ".topbar-right"
    );

if(
    showBack &&
    !showLogo &&
    !showProfile
){

    if(leftBox){

        leftBox.style.minWidth =
            "60px";

    }

    if(rightBox){

        rightBox.style.minWidth =
            "60px";

    }

}

    // =========================
    // SPACER SYNC
    // The topbar is position:fixed (see topbar.css), so
    // #topbar-container no longer grows with it — it needs its
    // height set explicitly to whatever the topbar actually renders
    // at, or content underneath gets covered. Dashboard mode (logo +
    // profile photo + name) is taller than the plain title bar, and
    // the height can shift again once the profile ring wrapper gets
    // inserted after the photo loads — so this keeps watching, not
    // just measuring once.
    // =========================

    const spacerEl =
        document.getElementById(
            "topbar-container"
        );

    const topbarEl =
        document.querySelector(
            ".topbar"
        );

    if(spacerEl && topbarEl){

        const syncSpacerHeight = ()=>{
            spacerEl.style.minHeight =
                topbarEl.offsetHeight + "px";
        };

        syncSpacerHeight();

        if(
            window.ResizeObserver &&
            !topbarEl._spacerObserverAttached
        ){

            topbarEl._spacerObserverAttached = true;

            new ResizeObserver(syncSpacerHeight)
                .observe(topbarEl);

        }

    }

};


// =========================
// LOAD USER PHOTO
// =========================
window.loadTopbarPhoto = async function(){

    try{

        const user = JSON.parse(
            localStorage.getItem("loggedInUser") || "{}"
        );

        if(!user.username) return;

        const img = document.getElementById("topbarProfile");

        if(!img) return;

        const token = API.getToken();

        const response = await fetch(

            `${API.BASE_URL}/assets/user-photo/${encodeURIComponent(user.username)}`,

            {
                headers:{
                    Authorization:`Bearer ${token}`
                }
            }

        );

        if(!response.ok){

            img.src = "/CM_Pro/assets/images/profile.jpg";
            return;

        }

        const blob = await response.blob();

        img.src = URL.createObjectURL(blob);

    }
    catch(err){

        console.error("Load photo:",err);

        const img = document.getElementById("topbarProfile");

        if(img){
            img.src="/CM_Pro/assets/images/profile.jpg";
        }

    }

};

// =========================================================
// SMART HOME TAB (bottom nav)
// The bottom nav's Home icon always used to open the dashboard, so a
// Setting/Notification detour from deep inside a report cost a full
// re-drill-down to get back — same problem the back-arrow fix above
// solves for the back button, from the other tab.
// A work page (anything that isn't Home/Setting/Notification, e.g. a
// report) is remembered in sessionStorage as it loads. From Setting
// or Notification, the FIRST tap of Home returns to that remembered
// page instead of the dashboard; tapping Home again from there (no
// longer on Setting/Notification) falls through to its normal href
// and opens the actual dashboard.
// Listens on document rather than the link itself because
// bottomnav.html is injected asynchronously by each page's own
// loader — sometimes after this script has already run.
// =========================================================
(function(){

    const CM_HOME_PATH =
        "/CM_Pro/index.html";

    const CM_SETTINGS_PREFIX =
        "/CM_Pro/pages/settings/";

    const CM_NOTIFICATIONS_PREFIX =
        "/CM_Pro/pages/notifications/";

    // Prefix match, not just the two index.html pages — Setting has
    // its own sub-pages (fingerprint.html, account.html, about.html,
    // voicecommand.html, ...) that are reached FROM Setting and are
    // part of it, not a "work page" someone drilled into from Home.
    // Treating them as a work page (an exact-path check would) meant
    // opening one, detouring to Notification, coming back to Setting,
    // then tapping Home landed back on that sub-page instead of the
    // dashboard.
    const onSettingOrNotification =

        location.pathname.startsWith(CM_SETTINGS_PREFIX) ||
        location.pathname.startsWith(CM_NOTIFICATIONS_PREFIX);

    if(!onSettingOrNotification){

        sessionStorage.setItem(
            "cmLastWorkPage",
            location.pathname + location.search
        );

    }

    if(!onSettingOrNotification) return;

    document.addEventListener("click", function(e){

        const homeLink =
            e.target.closest(
                `a.bottom-nav-item[href="${CM_HOME_PATH}"]`
            );

        if(!homeLink) return;

        const lastWorkPage =
            sessionStorage.getItem("cmLastWorkPage");

        if(!lastWorkPage) return;

        e.preventDefault();
        location.href = lastWorkPage;

    });

})();


