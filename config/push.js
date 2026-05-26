// =====================================================
// PUSH NOTIFICATION
// =====================================================

window.PushNotification = {

    // =================================================
    // INIT
    // =================================================

    async init(){

        try{

            if(

                !("serviceWorker" in navigator) ||

                !("PushManager" in window)

            ){

                console.log(
                    "Push not supported"
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
                "SW registered"
            );

            // =========================================
            // ASK PERMISSION
            // =========================================

            const permission =

                await Notification
                    .requestPermission();

            console.log(
                "Notification permission:",
                permission
            );

            if(permission !== "granted"){

                return;

            }

            // =========================================
            // EXISTING SUB
            // =========================================

            let subscription =

                await registration
                    .pushManager
                    .getSubscription();

            // =========================================
            // CREATE SUB
            // =========================================

            if(!subscription){

                const publicKey =

                    "BJKtfYLpS5SGXyuAcM3kR7wt_1dHcg1apVIrT8lQ5fXJDDxNml6acZD4PAheC5j36xc3qlDg0L8C7p3kiuydrQo";

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
                    "Push subscribed"
                );

            }else{

                console.log(
                    "Existing push subscription"
                );

            }

            // =========================================
            // SAVE TO BACKEND
            // =========================================

            const token =

                localStorage.getItem("token") ||

                sessionStorage.getItem("token");

            await fetch(

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

            console.log(
                "Push subscription saved"
            );

        }catch(error){

            console.error(
                "Push init error:",
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
