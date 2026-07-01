// =====================================================
// PUSH NOTIFICATION
// =====================================================

window.PushNotification = {

    async enable(){

        try{

            console.log("🚀 Push init started");

            // =========================================
            // SUPPORT CHECK
            // =========================================

            if(!("serviceWorker" in navigator)){

                console.log("❌ ServiceWorker not supported");
                return;

            }

            if(!("PushManager" in window)){

                console.log("❌ PushManager not supported");
                return;

            }

            // =========================================
            // REGISTER SERVICE WORKER
            // =========================================

            const registration =
                await navigator.serviceWorker.register(
                    "/CM_Pro/service-worker.js"
                );

            console.log(
                "✅ SW REGISTERED",
                registration
            );

            // =========================================
            // WAIT UNTIL SW READY
            // =========================================

            await navigator.serviceWorker.ready;

            console.log(
                "✅ SW READY"
            );

            // =========================================
            // NOTIFICATION PERMISSION
            // =========================================

            let permission =
                Notification.permission;

            if(permission !== "granted"){

                permission =
                    await Notification.requestPermission();

            }

            console.log(
                "🔔 Permission:",
                permission
            );

            if(permission !== "granted"){

                console.log(
                    "❌ Notification denied"
                );

                return;

            }

            // =========================================
            // REMOVE OLD SUB (TEST MODE)
            // =========================================

            const oldSubscription =
                await registration.pushManager.getSubscription();

            if(oldSubscription){

                console.log(
                    "🗑 Removing old subscription"
                );

                try{

                    await oldSubscription.unsubscribe();

                }catch(err){

                    console.warn(
                        "Old unsubscribe failed",
                        err
                    );

                }

            }

            // =========================================
            // CREATE NEW SUBSCRIPTION
            // =========================================

            const publicKey =
"BJKtfYLpS5SGXyuAcM3kR7wt_1dHcg1apVIrT8lQ5fXJDDxNml6acZD4PAheC5j36xc3qlDg0L8C7p3kiuydrQo";

            const subscription =
                await registration.pushManager.subscribe({

                    userVisibleOnly:true,

                    applicationServerKey:
                        this.urlBase64ToUint8Array(
                            publicKey
                        )

                });

            console.log(
                "✅ NEW SUB CREATED"
            );

            console.log(
                subscription
            );

            // =========================================
            // TOKEN
            // =========================================

            const token =

                localStorage.getItem("token") ||

                sessionStorage.getItem("token");

            console.log(
                "🔑 Token exists:",
                !!token
            );

            if(!token){

                console.error(
                    "❌ No token found"
                );

                return;

            }

            // =========================================
            // SEND SUB TO SERVER
            // =========================================

            const response = await fetch(

                `${API.BASE_URL}/api/push/subscribe`,

                {

                    method:"POST",

                    headers:{

                        "Content-Type":"application/json",

                        Authorization:`Bearer ${token}`

                    },

                    body:JSON.stringify(
                        subscription
                    )

                }

            );

            const result =
                await response.json();

            console.log(
                "✅ SUBSCRIBE RESPONSE",
                result
            );

            // =========================================
            // DEBUG CURRENT SUB
            // =========================================

            const verifySub =
                await registration.pushManager.getSubscription();

            console.log(
                "📌 ACTIVE SUB:",
                verifySub?.endpoint
            );

        }
        catch(error){

            console.error(
                "❌ PUSH INIT ERROR",
                error
            );

        }

    },

    // =========================================
// DISABLE PUSH
// =========================================

async disable(){

try{

const registration=
await navigator.serviceWorker.ready;

const subscription=
await registration.pushManager.getSubscription();

if(subscription){

await subscription.unsubscribe();

console.log("🔕 Push unsubscribed");

}

localStorage.setItem(
"notificationEnabled",
"false"
);

}catch(err){

console.error(err);

}

},

// =========================================
// STATUS
// =========================================

async isEnabled(){

try{

const registration=
await navigator.serviceWorker.ready;

const subscription=
await registration.pushManager.getSubscription();

return !!subscription;

}catch{

return false;

}

},

    // =================================================
    // BASE64 TO UINT8
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
