// =========================================================
// SHARED LOADING DIALOG
// Reusable "Please wait..." overlay, matching the VBA app's
// loading popup. Auto-injects its own markup on first use —
// no HTML needed in the page, just call showAppLoading() /
// hideAppLoading() from anywhere after this script loads.
// =========================================================

(function(){

    function ensureLoadingUI(){

        if(document.getElementById("appLoadingOverlay")) return;

        const overlay=document.createElement("div");

        overlay.id="appLoadingOverlay";

        overlay.className="app-loading-overlay";

        overlay.innerHTML=`

            <div class="app-loading-box">

                <div class="app-loading-spinner"></div>

                <div class="app-loading-text" id="appLoadingText">Please wait...</div>

            </div>

        `;

        document.body.appendChild(overlay);

    }

    window.showAppLoading=function(text){

        ensureLoadingUI();

        const overlay=document.getElementById("appLoadingOverlay");

        const textEl=document.getElementById("appLoadingText");

        if(textEl){

            textEl.textContent=text || "Please wait...";

        }

        overlay.classList.add("show");

    };

    window.hideAppLoading=function(){

        const overlay=document.getElementById("appLoadingOverlay");

        if(overlay){

            overlay.classList.remove("show");

        }

    };

})();

