```js
window.initTopbar = function(config={}){

    const {

        title = "CM_Pro",

        subtitle = "",

        showBack = false,

        actionText = "",

        actionHandler = null,

        showProfile = true,

        showLogo = true

    } = config;

    // TITLE

    const titleEl =
        document.getElementById(
            "topbarTitle"
        );

    if(titleEl){

        titleEl.innerText = title;

    }

    // SUBTITLE

    const subtitleEl =
        document.getElementById(
            "topbarName"
        );

    if(subtitleEl){

        if(subtitle){

            subtitleEl.innerText =
                subtitle;

            subtitleEl.style.display =
                "block";

        }else{

            subtitleEl.style.display =
                "none";

        }

    }

    // BACK

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

    // ACTION

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

            actionBtn.onclick =
                actionHandler || null;

        }else{

            actionBtn.style.display =
                "none";

        }

    }

    // PROFILE

    const userBox =
        document.getElementById(
            "topbarUserBox"
        );

    if(userBox){

        userBox.style.display =
            showProfile
            ? "flex"
            : "none";

    }

    // LOGO

    const logo =
        document.getElementById(
            "topbarLogo"
        );

    if(logo){

        logo.style.display =
            showLogo
            ? "block"
            : "none";

    }

};
```
