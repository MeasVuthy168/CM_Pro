// =====================================================
// PUSH NOTIFICATION
// =====================================================

window.PushNotification={

publicKey:"BJKtfYLpS5SGXyuAcM3kR7wt_1dHcg1apVIrT8lQ5fXJDDxNml6acZD4PAheC5j36xc3qlDg0L8C7p3kiuydrQo",

// =====================================================
// ENABLE
// =====================================================

async enable(){

try{

if(!("serviceWorker" in navigator)) return false;
if(!("PushManager" in window)) return false;

const registration=
await navigator.serviceWorker.register(
"/CM_Pro/service-worker.js"
);

await navigator.serviceWorker.ready;

// -------------------------
// Permission
// -------------------------

let permission=Notification.permission;

if(permission!=="granted"){

permission=
await Notification.requestPermission();

}

if(permission!=="granted"){

localStorage.setItem(
"notificationEnabled",
"false"
);

return false;

}

// -------------------------
// Existing Subscription
// -------------------------

let subscription=
await registration.pushManager.getSubscription();

// -------------------------
// Create only if needed
// -------------------------

if(!subscription){

subscription=
await registration.pushManager.subscribe({

userVisibleOnly:true,

applicationServerKey:
this.urlBase64ToUint8Array(
this.publicKey
)

});

console.log(
"✅ New Push Subscription Created"
);

}else{

console.log(
"✅ Existing Push Subscription Found"
);

}

// -------------------------
// Token
// -------------------------

const token=
localStorage.getItem("token")||
sessionStorage.getItem("token");

if(!token){

console.error("No token");

return false;

}

// -------------------------
// Save to Server
// -------------------------

const response=
await fetch(

`${API.BASE_URL}/api/push/subscribe`,

{

method:"POST",

headers:{

"Content-Type":"application/json",

Authorization:`Bearer ${token}`

},

body:JSON.stringify(subscription)

}

);

const result=
await response.json();

console.log(result);

localStorage.setItem(
"notificationEnabled",
"true"
);

return true;

}
catch(err){

console.error(
"Push Enable Error",
err
);

return false;

}

},

// =====================================================
// DISABLE
// =====================================================

async disable(){

try{

const registration=
await navigator.serviceWorker.ready;

const subscription=
await registration.pushManager.getSubscription();

if(subscription){

await subscription.unsubscribe();

console.log(
"🔕 Push Unsubscribed"
);

// Optional backend remove
/*
const token=
localStorage.getItem("token")||
sessionStorage.getItem("token");

await fetch(
`${API.BASE_URL}/api/push/unsubscribe`,
{
method:"POST",
headers:{
"Content-Type":"application/json",
Authorization:`Bearer ${token}`
},
body:JSON.stringify({
endpoint:subscription.endpoint
})
});
*/

}

localStorage.setItem(
"notificationEnabled",
"false"
);

return true;

}
catch(err){

console.error(
"Push Disable Error",
err
);

return false;

}

},

// =====================================================
// STATUS
// =====================================================

async isEnabled(){

try{

const registration=
await navigator.serviceWorker.ready;

const subscription=
await registration.pushManager.getSubscription();

return !!subscription;

}
catch{

return false;

}

},

// =====================================================
// INIT
// =====================================================

async init(){

if(
localStorage.getItem("notificationEnabled")==="true"
){

await this.enable();

}

},

// =====================================================
// BASE64
// =====================================================

urlBase64ToUint8Array(base64String){

const padding=
"=".repeat(
(4-base64String.length%4)%4
);

const base64=
(base64String+padding)
.replace(/\-/g,"+")
.replace(/_/g,"/");

const rawData=
window.atob(base64);

const outputArray=
new Uint8Array(rawData.length);

for(let i=0;i<rawData.length;i++){

outputArray[i]=
rawData.charCodeAt(i);

}

return outputArray;

}

};
