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

                <div class="app-loading-row">

                    <div class="app-loading-spinner"></div>

                    <div class="app-loading-text" id="appLoadingText">Please wait...</div>

                    <b class="app-loading-pct" id="appLoadingPct">0%</b>

                </div>

                <div class="app-loading-track"><span id="appLoadingBar"></span></div>

                <div class="app-loading-sub" id="appLoadingSub"></div>

            </div>

        `;

        document.body.appendChild(overlay);

    }

    // ----- progress mode (data loads) -----
    // showAppLoading(text, { progress: true, key: "..." }) adds a gold
    // % bar under the text. Without real progress the % is estimated
    // from how long the same load (key) took last time on this device,
    // easing toward 95% and never claiming 100% before it's done;
    // setAppLoadingProgress(pct, sub) drives it from real progress
    // instead (e.g. Daily Arrears' row pages).
    //
    // Progress-mode loads only read data, so the overlay leaves the
    // topbar and bottom nav uncovered — the user can go back or switch
    // page without waiting for it. Plain mode (save / delete / submit)
    // still blocks the whole screen.
    var DEFAULT_EXPECT_MS=6000;
    var prog=null;

    function lang(){
        try{ return localStorage.getItem("cm_language")==="en" ? "en" : "km"; }catch(e){ return "km"; }
    }
    function expectMs(key){
        try{
            var v=Number(localStorage.getItem("cm_load_ms:"+key));
            if(v>0) return Math.min(Math.max(v,1500),60000);
        }catch(e){}
        return DEFAULT_EXPECT_MS;
    }
    function remainingText(ms){
        var sec=Math.ceil(ms/1000);
        if(sec<=1) return lang()==="en" ? "Almost done..." : "ជិតរួចហើយ...";
        return lang()==="en" ? ("About "+sec+" s left") : ("ប្រហែល "+sec+" វិនាទីទៀត");
    }
    function paint(pct,sub){
        var bar=document.getElementById("appLoadingBar");
        var label=document.getElementById("appLoadingPct");
        var subEl=document.getElementById("appLoadingSub");
        if(bar) bar.style.width=pct+"%";
        if(label) label.textContent=pct+"%";
        if(subEl && sub!=null) subEl.textContent=sub;
    }
    function tick(){
        if(!prog || prog.manual) return;
        var elapsed=Date.now()-prog.started;
        var pct=Math.min(95,Math.round(95*(1-Math.exp(-elapsed/prog.expect))));
        if(pct<prog.pct) pct=prog.pct;
        prog.pct=pct;
        paint(pct,remainingText(prog.expect-elapsed));
    }
    function stopProgress(record){
        if(!prog) return;
        clearInterval(prog.timer);
        if(record && prog.key){
            try{ localStorage.setItem("cm_load_ms:"+prog.key,String(Date.now()-prog.started)); }catch(e){}
        }
        prog=null;
    }
    window.showAppLoading=function(text,opts){
        ensureLoadingUI();
        var overlay=document.getElementById("appLoadingOverlay");
        var box=overlay.querySelector(".app-loading-box");
        var textEl=document.getElementById("appLoadingText");
        if(textEl){
            textEl.textContent=text || "Please wait...";
        }
        var wantProgress=!!(opts && opts.progress);
        stopProgress(false);
        // loading.css lifts the fixed topbar / bottom nav above the
        // overlay while this class is on <html> (CSS, so it also holds
        // for bars that render after the load started).
        document.documentElement.classList.toggle("app-loading-free-nav",wantProgress);
        box.classList.toggle("app-loading-progress",wantProgress);
        if(wantProgress){
            prog={ key:opts.key||"", started:Date.now(), expect:expectMs(opts.key||""), pct:0, manual:false };
            paint(0,remainingText(prog.expect));
            prog.timer=setInterval(tick,120);
        }
        overlay.classList.add("show");
    };

    // Real progress for a progress-mode load: pct 0-100, sub = the
    // small line under the bar (e.g. "2,000 / ~5,000 rows").
    window.setAppLoadingProgress=function(pct,sub){
        if(!prog) return;
        prog.manual=true;
        pct=Math.max(prog.pct,Math.min(99,Math.round(pct)));
        prog.pct=pct;
        paint(pct,sub);
    };

    window.hideAppLoading=function(){
        stopProgress(true);
        document.documentElement.classList.remove("app-loading-free-nav");
        const overlay=document.getElementById("appLoadingOverlay");
        if(overlay){
            overlay.classList.remove("show");
        }
    };

})();

