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


