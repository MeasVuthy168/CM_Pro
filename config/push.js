// =====================================================
// PUSH NOTIFICATION
// =====================================================

window.PushNotification = {

    async init(){

        try{

            console.log(
                "Push init started"
            );

            // =========================================
            // SUPPORT CHECK
            // =========================================

            if(

                !("serviceWorker" in navigator)

            ){

                console.log(
                    "No serviceWorker support"
                );

                return;

            }

            if(

                !("PushManager" in window)

            ){

                console.log(
                    "No PushManager support"
                );

                return;

            }

            // =========================================
            // REGISTER SW
            // =========================================

            const registration =

                await navigator
                    .serviceWorker
                    .register(
                        "/CM_Pro/service-worker.js"
                    );

            console.log(
                "SW REGISTERED:",
                registration
            );

            // =========================================
            // PERMISSION
            // =========================================

            const permission =

                await Notification
                    .requestPermission();

            console.log(
                "NOTIFICATION PERMISSION:",
                permission
            );

            if(permission !== "granted"){

                console.log(
                    "Permission denied"
                );

                return;

            }

            // =========================================
            // EXISTING SUB
            // =========================================

            let subscription =

                await registration
                    .pushManager
                    .getSubscription();

            console.log(
                "EXISTING SUB:",
                subscription
            );

            // =========================================
            // CREATE NEW SUB
            // =========================================

            if(!subscription){

                const publicKey =

"BJKtfYLpS5SGXyuAcM3kR7wt_1dHcg1apVIrT8lQ5fXJDDxNml6acZD4PAheC5j36xc3qlDg0L8C7p3kiuydrQo";

                console.log(
                    "PUBLIC KEY:",
                    publicKey
                );

                subscription =

                    await registration
                        .pushManager
                        .subscribe({

                            userVisibleOnly: true,

                            applicationServerKey:

                                this.urlBase64ToUint8Array(
                                    publicKey
                                )

                        });

                console.log(
                    "NEW SUB CREATED:",
                    subscription
                );

            }

            // =========================================
            // TOKEN
            // =========================================

            const token =

                localStorage.getItem("token") ||

                sessionStorage.getItem("token");

            console.log(
                "TOKEN EXISTS:",
                !!token
            );

            // =========================================
            // SEND TO BACKEND
            // =========================================

            const response = await fetch(

                `${API.BASE_URL}/api/push/subscribe`,

                {

                    method: "POST",

                    headers: {

                        "Content-Type":
                            "application/json",

                        Authorization:
                            `Bearer ${token}`

                    },

                    body: JSON.stringify(
                        subscription
                    )

                }

            );

            const result =
                await response.json();

            console.log(
                "SUBSCRIBE RESPONSE:",
                result
            );

        }catch(error){

            console.error(
                "PUSH ERROR:",
                error
            );

        }

    },

    // =================================================
    // VAPID HELPER
    // =================================================

    urlBase64ToUint8Array(base64String){

        const padding =

            "=".repeat(
                (4 - base64String.length % 4) % 4
            );

        const base64 =

            (base64String + padding)

            .replace(/\-/g, "+")

            .replace(/_/g, "/");

        const rawData =
            window.atob(base64);

        const outputArray =
            new Uint8Array(
                rawData.length
            );

        for(
            let i = 0;
            i < rawData.length;
            ++i
        ){

            outputArray[i] =
                rawData.charCodeAt(i);

        }

        return outputArray;

    }

};
