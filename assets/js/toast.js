// ===========================================
// CM_Pro Toast
// Version 1.0
// ===========================================

const CMToast={

queue:[],

busy:false,

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

const opt=this.queue.shift();

this.render(opt);

},

render(opt){

const type=opt.type||"info";

const title=opt.title||"Notification";

const message=opt.message||"";

const autoClose=

opt.autoClose===false

?0

:(opt.duration||5000);

const showDetail=

typeof opt.onDetail==="function";

const checkbox=

opt.showCheckbox===true;

let icon="ℹ";

if(type==="success") icon="✔";
if(type==="warning") icon="⚠";
if(type==="error") icon="✖";

const overlay=document.createElement("div");

overlay.className="toast-overlay";

overlay.innerHTML=`

<div class="toast toast-${type}">

<div class="toast-header">

<div class="toast-title">

${title}

</div>

<div class="toast-close">

&times;

</div>

</div>

<div class="toast-body">

<div class="toast-icon">

${icon}

</div>

<div class="toast-message">

${message}

</div>

${
checkbox
?

`<label class="toast-checkbox">

<input type="checkbox">

Don't show again

</label>`

:""

}

</div>

<div class="toast-footer">

<button

class="toast-btn toast-btn-secondary toast-later">

Later

</button>

${
showDetail
?

`<button

class="toast-btn toast-btn-primary toast-detail">

View Detail

</button>`

:""

}

</div>

</div>

`;

document.body.appendChild(overlay);

requestAnimationFrame(()=>{

overlay.classList.add("show");

});

const close=()=>{

overlay.classList.remove("show");

setTimeout(()=>{

overlay.remove();

this.next();

},250);

};

overlay

.querySelector(".toast-close")

.onclick=close;

overlay

.querySelector(".toast-later")

.onclick=close;

if(showDetail){

overlay

.querySelector(".toast-detail")

.onclick=()=>{

opt.onDetail();

close();

};

}

if(autoClose>0){

setTimeout(close,autoClose);

}

}

};
