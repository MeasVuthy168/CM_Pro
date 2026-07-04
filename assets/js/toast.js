// ===========================================
// CM_Pro Toast
// Version 2.0 
// ===========================================

const CMToast={

queue:[],

busy:false,

active:null,

timer:null,

remaining:0,

startTime:0,

show(options={}){

this.queue.push(options);

if(!this.busy){

this.next();

}

},

next(){

if(this.queue.length===0){

this.busy=false;

return;

}

this.busy=true;

this.render(this.queue.shift());

},

// =====================================
// ICON
// =====================================

getIcon(type){

switch(type){

case "upload":
return "📤";

case "backup":
return "💾";

case "warning":
return "⚠️";

case "update":
return "⬆️";

case "delete":
return "🗑️";

case "system":
return "🖥️";

case "success":
return "✅";

case "error":
return "❌";

default:
return "🔔";

}

},

// =====================================
// TIME
// =====================================

timeAgo(date){

if(!date) return "Just now";

const d=new Date(date);

const diff=Math.floor((Date.now()-d.getTime())/1000);

if(diff<60) return "Just now";

if(diff<3600)

return Math.floor(diff/60)+" min ago";

if(diff<86400)

return Math.floor(diff/3600)+" hr ago";

return d.toLocaleString();

},

// =====================================
// RENDER
// =====================================

render(opt){

const type=
opt.type||"info";

const icon=
this.getIcon(type);

const title=
opt.title||"Notification";

const message=
opt.message||"";

const uploadedBy=
opt.uploadedBy||
"System";

const time=
this.timeAgo(
opt.createdAt
);

const duration=
opt.duration||5000;

const showDetail=
typeof opt.onDetail==="function";

const toast=
document.createElement("div");

toast.className=
`cm-toast toast-${type}`;

toast.innerHTML=`

<div class="cm-toast-left">

<div class="cm-toast-icon">

${icon}

</div>

</div>

<div class="cm-toast-center">

<div class="cm-toast-title">

${title}

</div>

<div class="cm-toast-message">

${message}

</div>

<div class="cm-toast-meta">

<span>

👤 ${uploadedBy}

</span>

<span>

${time}

</span>

</div>

<div class="cm-toast-progress">

<div class="cm-toast-bar"></div>

</div>

</div>

<div class="cm-toast-right">

<button class="cm-toast-close">

✕

</button>

</div>

`;

document.body.appendChild(toast);

requestAnimationFrame(()=>{

toast.classList.add("show");

});

this.active=toast;

this.remaining=duration;

this.startTime=Date.now();


// =====================================
// PROGRESS BAR
// =====================================

const bar=
toast.querySelector(
".cm-toast-bar"
);

bar.style.animationDuration=
duration+"ms";

bar.classList.add(
"run"
);

// =====================================
// CLOSE
// =====================================

const close=()=>{

if(!this.active) return;

clearTimeout(this.timer);

toast.classList.remove(
"show"
);

setTimeout(()=>{

toast.remove();

this.active=null;

this.busy=false;

this.next();

},300);

};

// =====================================
// AUTO CLOSE
// =====================================

this.timer=setTimeout(

close,

duration

);

// =====================================
// PAUSE TIMER
// Desktop
// =====================================

toast.addEventListener(

"mouseenter",

()=>{

clearTimeout(
this.timer
);

this.remaining-=

Date.now()-

this.startTime;

bar.style.animationPlayState=
"paused";

}

);

toast.addEventListener(

"mouseleave",

()=>{

this.startTime=
Date.now();

bar.style.animationPlayState=
"running";

this.timer=

setTimeout(

close,

this.remaining

);

}

);

// =====================================
// CLICK ANYWHERE
// =====================================

toast.addEventListener(

"click",

(e)=>{

if(

e.target.classList.contains(
"cm-toast-close"
)

){

return;

}

if(showDetail){

opt.onDetail();

}

close();

}

);

// =====================================
// CLOSE BUTTON
// =====================================

toast

.querySelector(

".cm-toast-close"

)

.onclick=(e)=>{

e.stopPropagation();

close();

};

// =====================================
// MOBILE SWIPE UP
// =====================================

let startY=0;

toast.addEventListener(

"touchstart",

(e)=>{

startY=

e.touches[0].clientY;

},

{

passive:true

}

);

toast.addEventListener(

"touchend",

(e)=>{

const diff=

startY-

e.changedTouches[0].clientY;

if(diff>70){

close();

}

},

{

passive:true

}

);

}

};




// ===========================================
// Listen Service Worker Message
// ===========================================

if ("serviceWorker" in navigator) {

    navigator.serviceWorker.ready.then(reg => {

        const receive = event => {

            console.log("📩 Toast received:", event.data);

            const msg = event.data;

            if (!msg) return;

            // Refresh Badge
            if (msg.type === "REFRESH_BADGE") {

                if (typeof loadNotificationBadge === "function") {
                    loadNotificationBadge();
                }

                return;
            }

            // Show Toast
                if(msg.type==="NEW_NOTIFICATION"){
                
                    console.log("NEW_NOTIFICATION RECEIVED");
                
                    const n = msg.notification || {};
                
                    console.log(n);
                
                    console.log(CMToast);
                
                    CMToast.show({
                
                        type:n.type || "info",
                
                        title:n.title || "Notification",
                
                        message:n.message || "",
                
                        duration:5000,
                
                        onDetail(){
                
                            location.href=n.url || "/CM_Pro/pages/notifications/";
                
                        }
                
                    });
                
                    console.log("CMToast.show called");
                
                }

        };

        navigator.serviceWorker.addEventListener(
            "message",
            receive
        );

        if (navigator.serviceWorker.controller) {

            navigator.serviceWorker.controller.addEventListener(
                "message",
                receive
            );

        }

    });

}
