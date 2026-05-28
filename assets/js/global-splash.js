(async function(){

    try{

        // =========================
        // LOAD SPLASH HTML
        // =========================
        const response = await fetch(
            "/CM_Pro/components/global-splash.html"
        );

        const html = await response.text();

        document.body.insertAdjacentHTML(
            "afterbegin",
            html
        );

        // =========================
        // HIDE SPLASH
        // =========================
        window.hideGlobalSplash = function(){

            const splash =
                document.getElementById("globalSplash");

            if(!splash) return;

            splash.classList.add(
                "global-splash-hide"
            );

            setTimeout(()=>{
                splash.remove();
            },400);

        };

        // FAILSAFE
        setTimeout(()=>{
            hideGlobalSplash();
        },2500);

    }catch(error){

        console.error(
            "Global splash load error:",
            error
        );

    }

})();
