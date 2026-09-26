window.API = {

    BASE_URL:
        "https://cm-backend-new.onrender.com",

    // =========================
    // GET TOKEN
    // =========================

    getToken(){

        // JWT is now stored in an HttpOnly cookie by the backend.
        // JavaScript must never read or persist the session token.
        return null;

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

                    "X-CM-Client": "CM_Pro-Web"

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
                headers:{
                    "X-CM-Client": "CM_Pro-Web"
                }
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
