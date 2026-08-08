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

const existingToken=

    localStorage.getItem("token")

    ||

    sessionStorage.getItem("token");

if(existingToken){

    try{

        const user=JSON.parse(

            localStorage.getItem("loggedInUser") || "{}"

        );

        const role=(user.role || "user").toLowerCase();

        const next=getSafeNextParam();

        window.location.replace(

            next

                ? next

                : role==="admin"

                    ? "/CM_Pro/Admin/adminupload.html"

                    : "/CM_Pro/index.html"

        );

    }catch{

        window.location.replace("/CM_Pro/index.html");

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

    document.getElementById("password").value=rememberedLogin.password || "";

    rememberMe.checked=true;

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

        // ===== CLEAR TOKEN =====

        localStorage.removeItem("token");

        sessionStorage.removeItem("token");

        // ===== SAVE TOKEN =====

        if(rememberMe.checked){

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

        if(rememberMe.checked){

            localStorage.setItem(

                "remember_login",

                JSON.stringify({username,password})

            );

        }else{

            localStorage.removeItem("remember_login");

        }

        showMessage("Login successful","success");

        // ===== REDIRECT =====

        setTimeout(()=>{

            const role=(userData.role || "user").toLowerCase();

            const next=getSafeNextParam();

            window.location.href=

                next

                    ? next

                    : role==="admin"

                        ? "/CM_Pro/Admin/adminupload.html"

                        : "/CM_Pro/index.html";

        },700);

    }catch(error){

        console.error(error);

        showMessage("Cannot connect to server","error");

    }finally{

        setLoading(false);

    }

});

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
