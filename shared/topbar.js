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

            titleEl.style.display =
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

};
