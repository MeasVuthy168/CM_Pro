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

    // data-i18n keeps the label in step with a later language switch;
    // CMI18n.t() fills it now (the button is created after the page's
    // own translation pass has already run).
    const label=window.CMI18n ? CMI18n.t("login.installBtn") : "Install App";

    btn.innerHTML=`<span class="ui-ico ui-ico-install" aria-hidden="true"></span> <span data-i18n="login.installBtn">${label}</span>`;

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

    cmSetAvatar(document.getElementById("userAvatar"),username);

    updateAltLogin(username);

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

            JSON.stringify({username:rememberedLogin.username || "",hasPin:!!rememberedLogin.hasPin})

        );

    }

    // A known username on this device skips straight to the password
    // step — PIN-enabled users get intercepted before this even runs
    // (see the PIN LOGIN section's auto-open check further down, which
    // opens its own full-screen overlay instead).
    showLoginStep2();

}

// =========================
// OTHER WAYS IN (fingerprint/face, PIN)
// Shown under the password button for a known username. Fingerprint /
// face needs this device's own registration for that user (same key
// the PIN screen and Settings use); PIN needs the account to have one
// (remembered from the last login, so it still works after a logout).
// =========================

function cmDeviceHasBiometric(username){

    if(typeof isWebAuthnAvailable!=="function" || !isWebAuthnAvailable()) return false;

    return !!localStorage.getItem(`cm_webauthn_device_cred_${username}`) &&
        localStorage.getItem(`cm_fp_login_disabled_${username}`)!=="1";

}

function cmUserHasPin(username){

    let remembered={};
    let cached={};
    try{ remembered=JSON.parse(localStorage.getItem("remember_login") || "{}") || {}; }catch{}
    try{ cached=JSON.parse(localStorage.getItem("loggedInUser") || "{}") || {}; }catch{}

    return (remembered.username===username && !!remembered.hasPin) ||
        (cached.username===username && !!cached.hasPin);

}

// Real profile photo when this device has a cached copy (saved by
// config/session.js while logged in), else the first letter.
function cmSetAvatar(el,username,label){

    if(!el) return;

    let photo="";
    try{ photo=localStorage.getItem(`cm_user_photo_${username}`) || ""; }catch{}

    el.innerText="";
    el.classList.toggle("has-photo",!!photo);
    el.style.backgroundImage=photo ? `url("${photo}")` : "";
    if(!photo) el.innerText=(label || username || "?").charAt(0).toUpperCase();

}

function updateAltLogin(username){

    const box=document.getElementById("altLogin");
    if(!box) return;

    const bio=cmDeviceHasBiometric(username);
    const pin=cmUserHasPin(username) && typeof window.cmOpenPinOverlay==="function";

    document.getElementById("btnBioLogin").hidden=!bio;
    document.getElementById("btnPinLogin").hidden=!pin;
    box.hidden=!(bio || pin);

}

document.getElementById("btnBioLogin")?.addEventListener("click",async()=>{

    const username=usernameInput.value.trim();
    if(!username) return;

    showMessage("","");
    setLoading(true);

    try{

        const data=await webauthnLogin(username);
        completeLogin(data);

    }catch(err){

        console.error("[login] biometric login failed:",err);
        setLoading(false);
        // Backing out of the system prompt isn't an error worth shouting about.
        if(!(err && err.name==="NotAllowedError")){
            showMessage(err.message || t("login.msg.fingerprintFailed"),"error");
        }

    }

});

document.getElementById("btnPinLogin")?.addEventListener("click",()=>{

    if(typeof window.cmOpenPinOverlay==="function") window.cmOpenPinOverlay();

});

// =========================
// LANGUAGE SWITCH (top-right)
// =========================

(function(){

    const box=document.getElementById("loginLangSwitch");
    if(!box || !window.CMLanguage) return;

    function sync(){
        const cur=CMLanguage.get();
        box.querySelectorAll("button").forEach(b=>b.classList.toggle("on",b.dataset.lang===cur));
        document.documentElement.lang=cur==="km" ? "km" : "en";
    }

    box.querySelectorAll("button").forEach(b=>{
        b.addEventListener("click",()=>{
            CMLanguage.set(b.dataset.lang);
            sync();
        });
    });

    window.addEventListener("cm-language-changed",sync);
    sync();

})();

// =========================
// SHOW PASSWORD
// =========================

togglePassword.addEventListener("click",()=>{

    if(passwordInput.type==="password"){

        passwordInput.type="text";

        togglePassword.classList.add("on");
        togglePassword.setAttribute("aria-label",t("login.hide"));

    }else{

        passwordInput.type="password";

        togglePassword.classList.remove("on");
        togglePassword.setAttribute("aria-label",t("login.show"));

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

    // hasPin rides along with the username: every logout path removes
    // loggedInUser, and without this the PIN screen (and the
    // fingerprint/face prompt it opens) never came back after logging
    // out — the device registration was still there, it just looked
    // deleted.
    localStorage.setItem(

        "remember_login",

        JSON.stringify({username:userData.username || "",hasPin:!!userData.hasPin})

    );

    // ===== REDIRECT (after an optional PIN-setup detour) =====

    function goToDestination(){

        // Tells config/session.js on the destination page that this
        // load is a real login/unlock, not an app relaunch, so it
        // doesn't immediately bounce back to its own PIN lock screen.
        // sessionStorage (not localStorage) because it only needs to
        // survive this one same-tab navigation.
        try { sessionStorage.setItem("cm_just_authenticated","1"); } catch {}

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
    // A user who deleted their PIN on purpose (Settings -> Change PIN ->
    // Delete PIN) isn't asked again on every login; creating a PIN from
    // Settings clears this flag.
    let pinPromptOff=false;
    try{ pinPromptOff=localStorage.getItem(`cm_pin_prompt_off_${userData.username}`)==="1"; }catch{}

    if(!userData.hasPin && !pinPromptOff && typeof maybePromptPinSetup==="function"){

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

    // Mirrors config/session.js's App Lock overlay: if this device has
    // Face ID/fingerprint registered for this user, try it the instant
    // the PIN screen opens — no separate "Login with Fingerprint"
    // button needed (that was removed earlier), just the same silent
    // auto-prompt the reference app does. The PIN keypad stays visible
    // underneath the whole time, so a cancelled/failed biometric
    // attempt just leaves the user exactly where they'd expect: typing
    // their PIN, with no extra error noise for backing out of a prompt
    // they didn't explicitly ask for.
    async function maybeTryBiometricLogin(username){

        if(typeof isWebAuthnAvailable!=="function" || !isWebAuthnAvailable()) return;

        // cm_fp_login_disabled_<username>: Settings' own quick toggle
        // sets this when the user turns "Login with Fingerprint or
        // Face" off — a local "don't use it" preference that leaves
        // the actual registration in place, so respect it here too or
        // the toggle would do nothing from the user's perspective.
        const hasDeviceCred=!!localStorage.getItem(`cm_webauthn_device_cred_${username}`);
        const quickLoginDisabled=localStorage.getItem(`cm_fp_login_disabled_${username}`)==="1";
        if(!hasDeviceCred || quickLoginDisabled) return;

        try{

            const data=await webauthnLogin(username);
            completeLogin(data);

        }catch(err){

            console.error("[login] auto biometric login failed:",err);

        }

    }

    function openPinOverlay(){

        const username=document.getElementById("username").value.trim();

        if(!username){

            showMessage(t("login.msg.enterUsernameFirst"),"error");
            return;

        }

        resetPinEntry();
        pinOverlay.hidden=false;
        if(document.activeElement && document.activeElement.blur) document.activeElement.blur();

        let cached={};
        try{ cached=JSON.parse(localStorage.getItem("loggedInUser") || "{}") || {}; }catch{}
        const name=(cached.username===username && cached.fullname) || username;
        cmSetAvatar(document.getElementById("pinAvatar"),username,name);
        document.getElementById("pinGreeting").innerText=`${t("login.welcomeBack")}, ${name}`;
        document.getElementById("pinBioKey").hidden=!cmDeviceHasBiometric(username);

        maybeTryBiometricLogin(username);

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

    window.cmOpenPinOverlay=openPinOverlay;

    // Step 2 may already be showing (remembered username) from before
    // this block ran — refresh its "or log in with" options now that
    // the PIN screen can be opened.
    if(!loginStep2.hidden) updateAltLogin(usernameInput.value.trim());

    document.getElementById("pinBioKey").addEventListener("click",()=>{

        const username=document.getElementById("username").value.trim();
        if(username) maybeTryBiometricLogin(username);

    });

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

    // Handled at document level (not on an input) so it works whatever
    // has focus — e.g. the username box behind the overlay keeps focus
    // when the PIN screen auto-opens.
    document.addEventListener("keydown",(e)=>{

        if(pinOverlay.hidden) return;

        const setup=document.getElementById("pinSetupOverlay");
        if(setup && !setup.hidden) return;

        if(e.key==="Escape"){
            e.preventDefault();
            closePinOverlay();
            return;
        }

        const k=cmPinKeyFromEvent(e);
        if(!k) return;

        e.preventDefault();
        if(e.repeat && k!=="back") return;

        cmPressPinKey(k==="back"
            ? document.getElementById("pinBackspace")
            : pinOverlay.querySelector(`.pin-key[data-digit="${k}"]`));

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

            (cachedUser.username===rememberedLogin.username && cachedUser.hasPin) ||
            rememberedLogin.hasPin

        ){

            document.getElementById("username").value=rememberedLogin.username;

            openPinOverlay();

        }

    }

}

// =========================
// PHYSICAL KEYBOARD ON THE PIN KEYPADS (desktop)
// Maps a keydown to "0"-"9" or "back". Besides the plain digit keys it
// accepts Khmer digits (a Windows keyboard set to Khmer types ០-៩, not
// 0-9) and the numeric keypad with Num Lock off (e.key is then
// "Home"/"End"/arrows, so read e.code instead).
// =========================

function cmPinKeyFromEvent(e){

    if(e.ctrlKey || e.metaKey || e.altKey) return null;

    const k=e.key || "";

    if(k==="Backspace" || k==="Delete") return "back";
    if(/^[0-9]$/.test(k)) return k;

    const c=k.length===1 ? k.charCodeAt(0) : 0;
    if(c>=0x17E0 && c<=0x17E9) return String(c-0x17E0);

    const m=/^(?:Numpad|Digit)([0-9])$/.exec(e.code || "");
    if(m && !e.shiftKey) return m[1];

    return null;

}

// Clicks the on-screen key so typing and tapping share one code path,
// with a short pressed look so the user sees which key registered.
function cmPressPinKey(btn){

    if(!btn) return;
    btn.classList.add("kbd-press");
    setTimeout(()=>btn.classList.remove("kbd-press"),130);
    btn.click();

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
        const headingEl=document.getElementById("pinSetupHeading");
        const stepsEl=document.getElementById("pinSetupSteps");
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
            document.removeEventListener("keydown",onSetupKey);
            overlay.hidden=true;
            resolve();
        }

        function onSetupKey(e){

            if(overlay.hidden || entryStep.hidden) return;

            const k=cmPinKeyFromEvent(e);
            if(!k) return;

            e.preventDefault();
            if(e.repeat && k!=="back") return;

            cmPressPinKey(k==="back"
                ? backspaceBtn
                : overlay.querySelector(`.pin-key[data-setup-digit="${k}"]`));

        }

        function showStep(name){

            passwordStep.hidden = name!=="password";
            entryStep.hidden = name!=="create" && name!=="confirm";
            biometricStep.hidden = name!=="biometric";

            const heading={
                password:"login.pinSetup.passwordHeading",
                create:"login.pinSetup.heading",
                confirm:"login.pinSetup.confirmHeading",
                biometric:"login.pinSetup.biometricHeading"
            }[name];
            const sub={
                password:"login.pinSetup.enterPassword",
                create:"login.pinSetup.createSub",
                confirm:"login.pinSetup.confirmSub"
            }[name];

            headingEl.innerText=heading ? t(heading) : "";
            titleEl.innerText=sub ? t(sub) : "";

            stepsEl.hidden = name!=="create" && name!=="confirm";
            stepsEl.querySelectorAll(".pin-setup-step").forEach(step=>{
                step.classList.toggle("active",step.dataset.step===name);
                step.classList.toggle("done",name==="confirm" && step.dataset.step==="create");
            });

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

                if(!digits) statusEl.innerText="";
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

                const credId=await webauthnRegisterWithRecovery("");

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

        passwordInput2.addEventListener("keydown",(e)=>{
            if(e.key==="Enter"){ e.preventDefault(); passwordNextBtn.click(); }
        });

        document.addEventListener("keydown",onSetupKey);

        // ----- open -----

        overlay.hidden=false;
        if(document.activeElement && document.activeElement.blur) document.activeElement.blur();
        showStep(phase);
        if(phase==="password") passwordInput2.focus();
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
