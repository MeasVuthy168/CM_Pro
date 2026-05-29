window.initTopbar = function(config={}){

    const {

        title = "CM_Pro",

        showBack = false,

        actionText = "",

        actionHandler = null,

        showProfile = true

    } = config;

    const titleEl =
        document.getElementById(
            "topbarTitle"
        );

    if(titleEl){

        titleEl.innerText = title;

    }

    const backBtn =
        document.getElementById(
            "topbarBackBtn"
        );

    if(backBtn){

        backBtn.style.display =
            showBack ? "block" : "none";

        backBtn.onclick =
            ()=>history.back();

    }

    const actionBtn =
        document.getElementById(
            "topbarActionBtn"
        );

    if(actionBtn){

        if(actionText){

            actionBtn.style.display =
                "block";

            actionBtn.innerText =
                actionText;

            if(actionHandler){

                actionBtn.onclick =
                    actionHandler;

            }

        }else{

            actionBtn.style.display =
                "none";

        }

    }

    const profile =
        document.getElementById(
            "topbarProfile"
        );

    if(profile){

        profile.style.display =
            showProfile
            ? "block"
            : "none";

    }

};
