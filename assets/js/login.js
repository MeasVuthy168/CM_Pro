// =========================
// SERVICE WORKER
// =========================

if("serviceWorker" in navigator){

    window.addEventListener("load",()=>{

        navigator.serviceWorker

            .register("/CM_Pro/service-worker.js")

            .then(reg=>{

                console.log("✅ SW:",reg.scope);

            })

            .catch(err=>{

                console.error("❌ SW Error:",err);

            });

    });

}

// =========================
// NEXT-PARAM HELPER
// (same-origin only, so a malicious ?next= can't redirect off-site)
// =========================

function getSafeNextParam(){

    const raw=new URLSearchParams(window.location.search).get("next");

    if(!raw) return null;

    if(!raw.startsWith("/CM_Pro/")) return null;

    return raw;

}

// =========================
// AUTO LOGIN
// =========================
// Trusting an existing token/next blindly here is what caused the
// admin<->login bounce loop: an admin page redirects here with
// ?next=<itself> whenever its own guard rejects the token (expired,
// or a non-admin role) — if this block redirected straight back to
// that same next without re-checking the token, the two pages would
// just keep replacing each other forever. Decoding the JWT here
// (same approach as assets/js/admin/admin-loader.js's cmDecodeJwt)
// lets this block tell "stale token" apart from "valid token, wrong
// destination" and stop the bounce instead of perpetuating it.

function cmDecodeJwtPayload(token){

    try{

        const payload=token.split(".")[1];

        const base64=payload.replace(/-/g,"+").replace(/_/g,"/");

        const json=decodeURIComponent(

            atob(base64)
                .split("")
                .map(c=>"%"+c.charCodeAt(0).toString(16).padStart(2,"0"))
                .join("")

        );

        return JSON.parse(json);

    }catch{

        return null;

    }

}

const existingToken=

    localStorage.getItem("token")

    ||

    sessionStorage.getItem("token");

if(existingToken){

    const jwtPayload=cmDecodeJwtPayload(existingToken);

    const tokenExpired=

        !jwtPayload

        ||

        (jwtPayload.exp && Date.now()>=jwtPayload.exp*1000);

    if(tokenExpired){

        // Stale/undecodable token — clear it and fall through to the
        // normal login form instead of bouncing straight back to
        // whatever page sent us here.
        localStorage.removeItem("token");
        localStorage.removeItem("loggedInUser");
        sessionStorage.clear();

    }else{

        try{

            const user=JSON.parse(

                localStorage.getItem("loggedInUser") || "{}"

            );

            const role=String(

                jwtPayload.role || user.role || "user"

            ).toLowerCase();

            const next=getSafeNextParam();

            // Only honor ?next= if this token's role can actually
            // reach it — otherwise fall back to the role's own default
            // page rather than re-triggering the page that rejected us.
            const nextNeedsAdmin=
                next && next.startsWith("/CM_Pro/pages/admin/");

            const destination=

                (next && (!nextNeedsAdmin || role==="admin"))

                    ? next

                    : role==="admin"

                        ? "/CM_Pro/pages/admin/index.html"

                        : "/CM_Pro/index.html";

            window.location.replace(destination);

        }catch{

            window.location.replace("/CM_Pro/index.html");

        }

    }

}

// =========================
// IOS DETECT
// =========================

function isIOS(){

    return /iphone|ipad|ipod/i.test(navigator.userAgent);

}

function isInStandaloneMode(){

    return window.navigator.standalone===true;

}

// =========================
// IOS INSTALL GUIDE
// =========================

window.addEventListener("load",()=>{

    if(isIOS() && !isInStandaloneMode()){

        if(!localStorage.getItem("iosInstallShown")){

            setTimeout(()=>{

                document.getElementById("iosInstallBanner").style.display="block";

            },2500);

        }

    }

});

// =========================
// CLOSE IOS GUIDE
// =========================

document.getElementById("closeIOSBanner")

    .addEventListener("click",()=>{

        document.getElementById("iosInstallBanner").style.display="none";

        localStorage.setItem("iosInstallShown","true");

    });

// =========================
// INSTALL PROMPT
// =========================

let deferredPrompt;

window.addEventListener("beforeinstallprompt",(e)=>{

    if(isIOS()) return;

    e.preventDefault();

    deferredPrompt=e;

    showInstallButton();

});

function showInstallButton(){

    if(document.getElementById("installBtn")) return;

    const btn=document.createElement("button");

    btn.id="installBtn";

    btn.innerText="📲 Install App";

    document.body.appendChild(btn);

    btn.addEventListener("click",async()=>{

        btn.remove();

        deferredPrompt.prompt();

        const choice=await deferredPrompt.userChoice;

        console.log(choice.outcome);

        deferredPrompt=null;

    });

}

// =========================
// ELEMENTS
// =========================

const form=document.getElementById("loginForm");

const btn=document.getElementById("loginBtn");

const loading=document.getElementById("loading");

const statusBox=document.getElementById("statusBox");

const usernameInput=document.getElementById("username");

const passwordInput=document.getElementById("password");

const togglePassword=document.getElementById("togglePassword");

const t=(key)=>window.CMI18n ? CMI18n.t(key) : key;

// =========================
// TWO-STEP FORM (username, then password)
// =========================

const loginStep1=document.getElementById("loginStep1");
const loginStep2=document.getElementById("loginStep2");
const usernameNextBtn=document.getElementById("usernameNextBtn");
const usernameSummaryText=document.getElementById("usernameSummaryText");
const usernameChangeBtn=document.getElementById("usernameChangeBtn");
const forgotPasswordBtn=document.getElementById("forgotPasswordBtn");

function showLoginStep1(){

    loginStep1.hidden=false;
    loginStep2.hidden=true;
    showMessage("","");
    usernameInput.focus();

}

function showLoginStep2(){

    const username=usernameInput.value.trim();

    if(!username){

        showMessage(t("login.msg.missingFields"),"error");
        return;

    }

    usernameSummaryText.innerText=username;

    loginStep1.hidden=true;
    loginStep2.hidden=false;
    showMessage("","");
    passwordInput.value="";
    passwordInput.focus();

}

usernameNextBtn.addEventListener("click",showLoginStep2);

// Enter on the username field should advance to step 2, not submit the
// form outright — there's no password typed yet at that point.
usernameInput.addEventListener("keydown",(e)=>{

    if(e.key!=="Enter") return;

    e.preventDefault();
    showLoginStep2();

});

usernameChangeBtn.addEventListener("click",showLoginStep1);

forgotPasswordBtn.addEventListener("click",()=>{

    // No self-service reset flow exists on the backend (admin-only
    // reset-password requires an admin's own JWT) — pointing users at
    // their admin is the honest option rather than a dead-end form.
    showMessage(t("login.msg.forgotPassword"),"info");

});

// =========================
// REMEMBER LOGIN
// Every successful login is "remembered" now (no checkbox) — this is
// what makes the App Lock / PIN-unlock flow (config/session.js,
// pages/settings) actually useful: closing and reopening the app is
// supposed to land on a PIN/biometric unlock, not a blank login form,
// the same way a real banking app behaves.
// =========================

let rememberedLogin=null;

try{

    rememberedLogin=JSON.parse(

        localStorage.getItem("remember_login")

    );

}catch{

    rememberedLogin=null;

}

if(rememberedLogin && rememberedLogin.username){

    usernameInput.value=rememberedLogin.username;

    // Older builds stored the plaintext password alongside the username —
    // scrub it from this browser's localStorage the first time this runs,
    // rather than leaving it sitting there until the next login.
    if("password" in rememberedLogin){

        localStorage.setItem(

            "remember_login",

            JSON.stringify({username:rememberedLogin.username || ""})

        );

    }

    // A known username on this device skips straight to the password
    // step — PIN-enabled users get intercepted before this even runs
    // (see the PIN LOGIN section's auto-open check further down, which
    // opens its own full-screen overlay instead).
    showLoginStep2();

}

// =========================
// SHOW PASSWORD
// =========================

togglePassword.addEventListener("click",()=>{

    if(passwordInput.type==="password"){

        passwordInput.type="text";

        togglePassword.innerText=t("login.hide");

    }else{

        passwordInput.type="password";

        togglePassword.innerText=t("login.show");

    }

});

// =========================
// MESSAGE
// =========================

function showMessage(message,type){

    statusBox.innerText=message;

    statusBox.className="status-box "+type;

}

// =========================
// LOADING
// =========================

function setLoading(isLoading){

    btn.disabled=isLoading;

    loading.style.display=isLoading ? "block" : "none";

}

// =========================
// LOGIN
// =========================

// Shared by both the password submit handler below and the fingerprint
// login button — same token storage / loggedInUser cache / remember-me /
// redirect logic regardless of which credential the server accepted.
function completeLogin(data,knownPassword){

    // ===== CLEAR TOKEN =====

    localStorage.removeItem("token");

    sessionStorage.removeItem("token");

    // ===== SAVE TOKEN =====
    // Always localStorage now (no Remember Me checkbox) — the whole
    // point of the App Lock / PIN-unlock system is that closing and
    // reopening the app lands on an unlock screen, not a blank login
    // form, which requires the session to actually persist.

    localStorage.setItem("token",data.token);

    // ===== USER DATA =====

    const userData=data.user || data.data || data;

    localStorage.setItem(

        "loggedInUser",

        JSON.stringify({

            username:userData.username || "",

            fullname:userData.fullname || "",

            role:userData.role || "user",

            // Drives the "skip straight to the PIN screen next time"
            // check further down this file, alongside remember_login.
            hasPin:!!userData.hasPin

        })

    );

    // ===== REMEMBER LOGIN =====
    // Only the username is persisted — the token set above is what
    // actually keeps the session alive across visits. Storing the
    // plaintext password here too gained nothing but risk: anyone who
    // can read this origin's localStorage (an XSS elsewhere, a
    // malicious extension, a shared machine) would get the real
    // account password, not just a scoped/expiring token.

    localStorage.setItem(

        "remember_login",

        JSON.stringify({username:userData.username || ""})

    );

    // ===== REDIRECT (after an optional PIN-setup detour) =====

    function goToDestination(){

        const role=(userData.role || "user").toLowerCase();

        const next=getSafeNextParam();

        window.location.href=

            next

                ? next

                : role==="admin"

                    ? "/CM_Pro/pages/admin/index.html"

                    : "/CM_Pro/index.html";

    }

    // "Mandatory but skippable" PIN onboarding: a user who's never set
    // a PIN sees this once per login (not a hard block — Skip just
    // proceeds), on whichever method they just logged in with. Password
    // login has the plaintext password in memory already (knownPassword,
    // never stored) so setup can call change-pin without asking again;
    // fingerprint/PIN-login don't have it, so that flow asks for it as
    // its first step instead.
    if(!userData.hasPin && typeof maybePromptPinSetup==="function"){

        maybePromptPinSetup(knownPassword).finally(goToDestination);

    }else{

        goToDestination();

    }

}

form.addEventListener("submit",async(e)=>{

    e.preventDefault();

    const username=document.getElementById("username").value.trim();

    const password=passwordInput.value;

    if(!username || !password){

        showMessage(t("login.msg.missingFields"),"error");

        return;

    }

    try{

        setLoading(true);

        showMessage("","");

        const response=await fetch(

            `${API.BASE_URL}/api/auth/login`,

            {

                method:"POST",

                headers:{

                    "Content-Type":"application/json"

                },

                body:JSON.stringify({username,password})

            }

        );

        const data=await response.json();

        if(!response.ok || !data.ok){

            showMessage(data.message || t("login.msg.loginFailed"),"error");

            return;

        }

        showMessage(t("login.msg.success"),"success");

        // ===== REDIRECT =====

        setTimeout(()=>{

            completeLogin(data,password);

        },700);

    }catch(error){

        console.error(error);

        showMessage(t("login.msg.cannotConnect"),"error");

    }finally{

        setLoading(false);

    }

});

// =========================
// PIN LOGIN
// No manual button for this anymore (removed from the login form along
// with fingerprint login) — this overlay now only ever opens
// automatically, for a returning device that's already remembered and
// has a PIN set (see the auto-open check at the bottom of this block).
// =========================

const pinOverlay=document.getElementById("pinOverlay");

const pinDotsEl=document.getElementById("pinDots");

const pinOverlayStatus=document.getElementById("pinOverlayStatus");

const pinBackBtn=document.getElementById("pinBackBtn");

const pinForgotBtn=document.getElementById("pinForgotBtn");

if(pinOverlay){

    let pinDigits="";

    let pinSubmitting=false;

    function renderPinDots(){

        pinDotsEl.querySelectorAll(".pin-dot").forEach((dot,i)=>{

            dot.classList.toggle("filled",i<pinDigits.length);
            dot.classList.remove("error");

        });

    }

    function resetPinEntry(){

        pinDigits="";
        pinSubmitting=false;
        pinOverlayStatus.innerText="";
        renderPinDots();

    }

    function openPinOverlay(){

        const username=document.getElementById("username").value.trim();

        if(!username){

            showMessage(t("login.msg.enterUsernameFirst"),"error");
            return;

        }

        resetPinEntry();
        pinOverlay.hidden=false;

    }

    function closePinOverlay(){

        pinOverlay.hidden=true;
        resetPinEntry();

        // The auto-open path (bottom of this block) never shows the
        // password step — it opens this overlay straight from page
        // load. Reveal it now (username already known) rather than
        // falling back to the bare username step.
        showLoginStep2();

    }

    async function submitPin(){

        if(pinSubmitting) return;

        pinSubmitting=true;

        const username=document.getElementById("username").value.trim();

        try{

            const response=await fetch(

                `${API.BASE_URL}/api/auth/login-pin`,

                {
                    method:"POST",
                    headers:{ "Content-Type":"application/json" },
                    body:JSON.stringify({username,pin:pinDigits})
                }

            );

            const data=await response.json();

            if(!response.ok || !data.ok){

                pinOverlayStatus.innerText=data.message || t("login.msg.pinFailed");

                pinDotsEl.querySelectorAll(".pin-dot").forEach(dot=>dot.classList.add("error"));

                pinDotsEl.classList.add("shake");

                setTimeout(()=>{

                    pinDotsEl.classList.remove("shake");
                    pinDigits="";
                    pinSubmitting=false;
                    renderPinDots();

                },400);

                return;

            }

            pinOverlayStatus.innerText="";

            setTimeout(()=>{

                completeLogin(data);

            },300);

        }catch(error){

            console.error(error);

            pinOverlayStatus.innerText=t("login.msg.cannotConnect");
            pinDigits="";
            pinSubmitting=false;
            renderPinDots();

        }

    }

    pinBackBtn.addEventListener("click",closePinOverlay);

    pinForgotBtn.addEventListener("click",closePinOverlay);

    pinOverlay.querySelectorAll(".pin-key[data-digit]").forEach(key=>{

        key.addEventListener("click",()=>{

            if(pinSubmitting || pinDigits.length>=6) return;

            pinDigits+=key.dataset.digit;

            renderPinDots();

            if(pinDigits.length===6){

                submitPin();

            }

        });

    });

    document.getElementById("pinBackspace").addEventListener("click",()=>{

        if(pinSubmitting) return;

        pinDigits=pinDigits.slice(0,-1);

        renderPinDots();

    });

    // ===== SKIP STRAIGHT TO PIN FOR A RETURNING, PIN-ENABLED USER =====
    // Matches the "log in with your password once, then unlock with a
    // PIN after that" pattern from other banking apps. The AUTO LOGIN
    // block up top already redirects straight past this whole page
    // (no form shown at all) whenever a still-valid token exists — this
    // covers the other case, where that token has expired (or this is a
    // fresh visit) but the device still remembers a username that HAS a
    // PIN set (cached on the last successful login, any method). Rather
    // than making them type the full password again, open the PIN
    // keypad immediately in place of the password form — the keypad's
    // own back arrow / "Forgot PIN?" link reveals the already-prefilled
    // password form underneath for anyone who wants (or needs) it.

    if(rememberedLogin && rememberedLogin.username){

        let cachedUser={};

        try{

            cachedUser=JSON.parse(localStorage.getItem("loggedInUser") || "{}");

        }catch{

            cachedUser={};

        }

        if(

            cachedUser.username===rememberedLogin.username &&
            cachedUser.hasPin

        ){

            document.getElementById("username").value=rememberedLogin.username;

            openPinOverlay();

        }

    }

}

// =========================
// FIRST-LOGIN PIN SETUP (skippable)
// Shown from completeLogin() whenever hasPin is false, on whatever
// method the user just logged in with. Never blocks reaching the
// Dashboard — "Skip for now" is always visible and just resolves the
// returned promise immediately. Re-appears on the next login until a
// PIN actually gets set (no separate "don't ask again" — the whole
// point is this is meant to actually get used, not silently forgotten).
// =========================

function maybePromptPinSetup(knownPassword){

    return new Promise((resolve)=>{

        const overlay=document.getElementById("pinSetupOverlay");

        if(!overlay){ resolve(); return; }

        const titleEl=document.getElementById("pinSetupTitle");
        const passwordStep=document.getElementById("pinSetupPasswordStep");
        const passwordInput2=document.getElementById("pinSetupPassword");
        const passwordNextBtn=document.getElementById("pinSetupPasswordNext");
        const entryStep=document.getElementById("pinSetupEntryStep");
        const dotsEl=document.getElementById("pinSetupDots");
        const statusEl=document.getElementById("pinSetupStatus");
        const backspaceBtn=document.getElementById("pinSetupBackspace");
        const biometricStep=document.getElementById("pinSetupBiometricStep");
        const biometricStatus=document.getElementById("pinSetupBiometricStatus");
        const enableBiometricBtn=document.getElementById("pinSetupEnableBiometric");
        const skipBiometricBtn=document.getElementById("pinSetupSkipBiometric");
        const skipBtn=document.getElementById("pinSetupSkipBtn");

        let password=knownPassword || "";
        let firstPin="";
        let digits="";
        let phase=password ? "create" : "password";

        function finish(){
            overlay.hidden=true;
            resolve();
        }

        function showStep(name){

            passwordStep.hidden = name!=="password";
            entryStep.hidden = name!=="create" && name!=="confirm";
            biometricStep.hidden = name!=="biometric";

            if(name==="create"){
                titleEl.innerText=t("login.pinSetup.createTitle");
            }else if(name==="confirm"){
                titleEl.innerText=t("login.pinSetup.confirmTitle");
            }else{
                titleEl.innerText="";
            }

        }

        function renderDots(){
            dotsEl.querySelectorAll(".pin-dot").forEach((dot,i)=>{
                dot.classList.toggle("filled",i<digits.length);
                dot.classList.remove("error");
            });
        }

        async function submitSetup(){

            try{

                const token=localStorage.getItem("token") || sessionStorage.getItem("token");

                const res=await fetch(`${API.BASE_URL}/api/auth/change-pin`,{
                    method:"POST",
                    headers:{
                        "Content-Type":"application/json",
                        Authorization:`Bearer ${token}`
                    },
                    body:JSON.stringify({password,newPin:firstPin,confirmPin:digits})
                });

                const data=await res.json();

                if(!data.ok){
                    statusEl.innerText=data.message || t("settings.account.changePinFailed");
                    digits="";
                    firstPin="";
                    phase="create";
                    showStep("create");
                    renderDots();
                    return;
                }

                notify_maybe(t("login.pinSetup.success"));

                if(typeof isWebAuthnAvailable==="function" && isWebAuthnAvailable()){
                    phase="biometric";
                    biometricStatus.innerText=t("login.pinSetup.biometricPrompt");
                    showStep("biometric");
                }else{
                    finish();
                }

            }catch(err){

                console.error(err);
                statusEl.innerText=t("login.msg.cannotConnect");
                digits="";
                phase="create";
                showStep("create");
                renderDots();

            }

        }

        function notify_maybe(message){
            if(typeof CMToast!=="undefined" && CMToast.show){
                CMToast.show({type:"success",title:t("common.success"),message});
            }
        }

        overlay.querySelectorAll(".pin-key[data-setup-digit]").forEach(key=>{

            key.addEventListener("click",()=>{

                if(digits.length>=6) return;

                digits+=key.dataset.setupDigit;
                renderDots();

                if(digits.length===6){

                    if(phase==="create"){
                        firstPin=digits;
                        digits="";
                        phase="confirm";
                        showStep("confirm");
                        renderDots();
                    }else if(phase==="confirm"){
                        if(digits!==firstPin){
                            statusEl.innerText=t("login.pinSetup.mismatch");
                            digits="";
                            firstPin="";
                            phase="create";
                            showStep("create");
                            renderDots();
                        }else{
                            submitSetup();
                        }
                    }

                }

            });

        });

        backspaceBtn.addEventListener("click",()=>{
            digits=digits.slice(0,-1);
            renderDots();
        });

        passwordNextBtn.addEventListener("click",()=>{

            const val=passwordInput2.value;
            if(!val){
                return;
            }
            password=val;
            phase="create";
            showStep("create");

        });

        enableBiometricBtn.addEventListener("click",async()=>{

            try{

                const credId=await webauthnRegister("");

                // Same localStorage convention as settings-account.js's
                // fingerprint toggle and config/session.js's App Lock
                // overlay — both read this exact key to know THIS device
                // has biometrics registered, keyed by username so a
                // shared device doesn't mix up accounts.
                const user=JSON.parse(localStorage.getItem("loggedInUser") || "{}");
                if(user.username && credId){
                    localStorage.setItem(`cm_webauthn_device_cred_${user.username}`,credId);
                }

                notify_maybe(t("login.pinSetup.biometricSuccess"));

            }catch(err){
                console.error(err);
            }finally{
                finish();
            }

        });

        skipBiometricBtn.addEventListener("click",finish);

        skipBtn.addEventListener("click",finish);

        // ----- open -----

        overlay.hidden=false;
        showStep(phase);
        renderDots();

    });

}

// =========================
// HIDE SPLASH
// =========================

window.addEventListener("load",()=>{

    setTimeout(()=>{

        if(typeof hideGlobalSplash==="function"){

            hideGlobalSplash();

        }

    },700);

});
