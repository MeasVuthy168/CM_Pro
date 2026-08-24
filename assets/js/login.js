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

const passwordInput=document.getElementById("password");

const togglePassword=document.getElementById("togglePassword");

const rememberMe=document.getElementById("rememberMe");

// =========================
// REMEMBER LOGIN
// =========================

let rememberedLogin=null;

try{

    rememberedLogin=JSON.parse(

        localStorage.getItem("remember_login")

    );

}catch{

    rememberedLogin=null;

}

if(rememberedLogin){

    document.getElementById("username").value=rememberedLogin.username || "";

    rememberMe.checked=true;

    // Older builds stored the plaintext password alongside the username —
    // scrub it from this browser's localStorage the first time this runs,
    // rather than leaving it sitting there until the next login.
    if("password" in rememberedLogin){

        localStorage.setItem(

            "remember_login",

            JSON.stringify({username:rememberedLogin.username || ""})

        );

    }

}

// =========================
// SHOW PASSWORD
// =========================

togglePassword.addEventListener("click",()=>{

    if(passwordInput.type==="password"){

        passwordInput.type="text";

        togglePassword.innerText="Hide";

    }else{

        passwordInput.type="password";

        togglePassword.innerText="Show";

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
function completeLogin(data,remember){

    // ===== CLEAR TOKEN =====

    localStorage.removeItem("token");

    sessionStorage.removeItem("token");

    // ===== SAVE TOKEN =====

    if(remember){

        localStorage.setItem("token",data.token);

    }else{

        sessionStorage.setItem("token",data.token);

    }

    // ===== USER DATA =====

    const userData=data.user || data.data || data;

    localStorage.setItem(

        "loggedInUser",

        JSON.stringify({

            username:userData.username || "",

            fullname:userData.fullname || "",

            role:userData.role || "user"

        })

    );

    // ===== REMEMBER LOGIN =====
    // Only the username is persisted — the token set above (already
    // in localStorage when Remember Me is checked) is what actually
    // keeps the session alive across visits. Storing the plaintext
    // password here too gained nothing but risk: anyone who can read
    // this origin's localStorage (an XSS elsewhere, a malicious
    // extension, a shared machine) would get the real account
    // password, not just a scoped/expiring token.

    if(remember){

        localStorage.setItem(

            "remember_login",

            JSON.stringify({username:userData.username || ""})

        );

    }else{

        localStorage.removeItem("remember_login");

    }

    // ===== REDIRECT =====

    const role=(userData.role || "user").toLowerCase();

    const next=getSafeNextParam();

    window.location.href=

        next

            ? next

            : role==="admin"

                ? "/CM_Pro/pages/admin/index.html"

                : "/CM_Pro/index.html";

}

form.addEventListener("submit",async(e)=>{

    e.preventDefault();

    const username=document.getElementById("username").value.trim();

    const password=passwordInput.value;

    if(!username || !password){

        showMessage("Please enter username/password","error");

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

            showMessage(data.message || "Login failed","error");

            return;

        }

        showMessage("Login successful","success");

        // ===== REDIRECT =====

        setTimeout(()=>{

            completeLogin(data,rememberMe.checked);

        },700);

    }catch(error){

        console.error(error);

        showMessage("Cannot connect to server","error");

    }finally{

        setLoading(false);

    }

});

// =========================
// FINGERPRINT LOGIN
// =========================

const fingerprintBtn=document.getElementById("fingerprintLoginBtn");

if(fingerprintBtn){

    if(typeof isWebAuthnAvailable==="function" && isWebAuthnAvailable()){

        fingerprintBtn.hidden=false;

    }

    fingerprintBtn.addEventListener("click",async()=>{

        const username=document.getElementById("username").value.trim();

        if(!username){

            showMessage("សូមវាយបញ្ចូល Username មុនសិន","error");
            return;

        }

        try{

            setLoading(true);
            showMessage("","");

            const data=await webauthnLogin(username);

            showMessage("Login successful","success");

            setTimeout(()=>{

                completeLogin(data,rememberMe.checked);

            },500);

        }catch(err){

            console.error(err);
            showMessage(err.message || "ការចូលដោយស្នាមម្រាមដៃបានបរាជ័យ","error");

        }finally{

            setLoading(false);

        }

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
