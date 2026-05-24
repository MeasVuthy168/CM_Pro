window.API = {

    BASE_URL:
        "https://cm-backend-new.onrender.com",

    // =========================
    // GET TOKEN
    // =========================

    getToken(){

        return (

            localStorage.getItem("token") ||

            sessionStorage.getItem("token")

        );

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

                headers:{

                    "Content-Type":
                        "application/json",

                    Authorization:
                        `Bearer ${token}`

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
                headers:{

                    Authorization:
                        `Bearer ${token}`

                }
            }
        );

        return response.json();

    }

};
