window.API = {

    BASE_URL:
        "https://cm-backend-new.onrender.com",

    // =========================
    // GET TOKEN
    // =========================

    isIOS(){
        return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
            (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    },

    clientHeader(){
        return this.isIOS() ? "CM_Pro-iOS" : "CM_Pro-Web";
    },

    getToken(){
        return this.isIOS() ? localStorage.getItem("cm_ios_token") || null : null;
    },

    authHeaders(extra={}){
        const headers = { "X-CM-Client": this.clientHeader(), ...extra };
        const token = this.getToken();
        if (token) headers.Authorization = "Bearer " + token;
        return headers;
    },

    // =========================
    // POST
    // =========================

    async post(endpoint, data){

        const token =
            this.getToken();

        const response = await fetch(

            this.BASE_URL + endpoint,

            {
                method:"POST",

                credentials: "include",

                headers:{

                    "Content-Type":
                        "application/json",

                    ...this.authHeaders({ "Content-Type": "application/json" })

                },

                body:
                    JSON.stringify(data)

            }
        );

        return response.json();

    },

    // =========================
    // GET
    // =========================

    async get(endpoint){

        const token =
            this.getToken();

        const response = await fetch(

            this.BASE_URL + endpoint,

            {
                credentials: "include",
                headers: this.authHeaders()
            }
        );

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data?.message || `HTTP ${response.status}`);
        }
        return data;

    }

};

// =========================================================
// SERVICE WORKER REGISTER + UPDATE CHECK
// login.js already registers the SW, but only login.html loads
// login.js — an already-authenticated session opens straight into
// app pages and never visits login.html again, so the browser was
// never asked to check for a newer service-worker.js. This file is
// loaded on nearly every page, so registering (idempotent — the
// browser no-ops if the same script/scope is already registered)
// and explicitly calling update() here means every page load has a
// chance to pick up a newer deploy, not just a login.
// =========================================================

if("serviceWorker" in navigator){

    window.addEventListener("load", ()=>{

        navigator.serviceWorker
            .register("/CM_Pro/service-worker.js")
            .then(reg=>{

                reg.update();

            })
            .catch(()=>{});

    });

}
