
window.API = {

    BASE_URL:
        "https://cm-backend.onrender.com",

    async post(endpoint, data){

        const token =
            sessionStorage.getItem("token");

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

    async get(endpoint){

        const token =
            sessionStorage.getItem("token");

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
