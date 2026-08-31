(function(){

    // =========================
    // COLD START ONLY
    // The splash is an app-boot screen, not a per-page loading
    // gate — showing it again on every in-app navigation added a
    // network fetch plus up to ~2.9s of forced delay to every
    // page click, even though the target page already has its own
    // spinner/skeleton for the real data fetch. sessionStorage
    // marks the app as "launched" once the splash has shown once;
    // later navigations within the same tab session skip it.
    // =========================
    let alreadyLaunched = false;

    try{
        alreadyLaunched = sessionStorage.getItem("cmAppLaunched") === "1";
    }catch(error){
        alreadyLaunched = false;
    }

    if(alreadyLaunched) return;

    try{
        sessionStorage.setItem("cmAppLaunched", "1");
    }catch(error){
        // sessionStorage unavailable (e.g. private mode) — fall
        // through and still show the splash this once.
    }

    try{

        // =========================
        // INSERT SPLASH
        // Inlined (previously fetched over the network on every
        // page load) so the cold-start splash no longer waits on
        // a round trip either.
        // =========================
        document.body.insertAdjacentHTML(
            "afterbegin",
            `<div id="globalSplash">

                <img src="/CM_Pro/assets/images/icon-192-maskable.png" class="global-splash-logo">

                <div class="global-splash-title">
                    CM_Pro
                </div>

                <div class="global-splash-subtitle">
                    SVG Credit Monitoring
                </div>

            </div>`
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
