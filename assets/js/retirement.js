// =========================
// Date defaults
// =========================

function initDates(){

    const todayStr=new Date().toISOString().split("T")[0];

    const dobEl=document.getElementById("dob");

    const curEl=document.getElementById("currentDate");

    dobEl.max=todayStr;

    if(!dobEl.value) dobEl.value="1989-09-14";

    if(!curEl.value) curEl.value=todayStr;

}

// =========================
// Calculation helpers
// =========================

function clamp(n,min,max){

    return Math.min(Math.max(n,min),max);

}

function monthDiffDetailed(from,to){

    let negative=false;

    let a=new Date(from), b=new Date(to);

    if(b<a){ negative=true; [a,b]=[b,a]; }

    let years=b.getFullYear()-a.getFullYear();

    let months=b.getMonth()-a.getMonth();

    let days=b.getDate()-a.getDate();

    if(days<0){

        months-=1;

        const prevB=new Date(b.getFullYear(),b.getMonth(),0);

        days+=prevB.getDate();

    }

    if(months<0){

        years-=1;

        months+=12;

    }

    const totalMonths=years*12+months;

    return {years,months,days,totalMonths,negative};

}

// =========================
// i18n / toast helpers
// =========================

function rt(key,vars,fallback){

    if(window.CMI18n && typeof CMI18n.t==="function"){

        const v=CMI18n.t(key,vars);

        if(v && v!==key) return v;

    }

    return fallback;

}

// toast.js declares CMToast as a top-level const (not on window).
function retNotify(message,type="success"){

    if(typeof CMToast!=="undefined" && typeof CMToast.show==="function"){

        CMToast.show({ type, title:message, message:"", duration:2500 });

    }

}

function fmtDate(d){

    return d.toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"});

}

function pad2(n){ return String(n).padStart(2,"0"); }

// =========================
// Calculate + render
// =========================

let lastMonthsLeft=null;

function calculateMonthsLeft(){

    const dobVal=document.getElementById("dob").value;

    const curVal=document.getElementById("currentDate").value;

    const age=parseInt(document.getElementById("ageInput").value||"0",10);

    const card=document.getElementById("resultCard");

    const monthsBox=document.getElementById("monthsLeft");

    const desc=document.getElementById("description");

    const badge=document.getElementById("resultBadge");

    const dob=new Date(dobVal+"T00:00:00");

    const current=new Date(curVal+"T00:00:00");

    if(!dobVal||isNaN(dob.getTime())||!curVal||isNaN(current.getTime())){

        card.dataset.state="empty";

        monthsBox.textContent="—";

        desc.textContent=rt("retirement.needDob",null,"Enter date of birth");

        badge.textContent="";

        ["ymdY","ymdM","ymdD"].forEach(id=>document.getElementById(id).textContent="0");

        document.getElementById("ageNow").textContent="—";

        document.getElementById("retireDate").textContent="—";

        document.getElementById("progressFill").style.width="0%";

        lastMonthsLeft=null;

        return;

    }

    const retirementDate=new Date(dob);

    retirementDate.setFullYear(retirementDate.getFullYear()+age);

    const retired=current>=retirementDate;

    const d=retired

        ? monthDiffDetailed(retirementDate,current)

        : monthDiffDetailed(current,retirementDate);

    const vars={

        y:`<span class="num">${pad2(d.years)}</span>`,

        m:`<span class="num">${pad2(d.months)}</span>`,

        d:`<span class="num">${pad2(d.days)}</span>`

    };

    if(retired){

        card.dataset.state="retired";

        monthsBox.textContent=rt("retirement.noMonthsLeft",null,"No months left");

        desc.innerHTML=rt("retirement.descRetired",vars,`Retired ${vars.y} years, ${vars.m} months and ${vars.d} days ago`);

        badge.textContent=rt("retirement.badgeRetired",null,"Retired");

        lastMonthsLeft=0;

    }else{

        card.dataset.state=d.totalMonths<12?"soon":"ok";

        monthsBox.textContent=rt("retirement.monthsValue",{n:d.totalMonths},`${d.totalMonths} months`);

        desc.innerHTML=rt("retirement.descLeft",vars,`${vars.y} years, ${vars.m} months and ${vars.d} days remaining`);

        badge.textContent=d.totalMonths<12

            ? rt("retirement.badgeSoon",null,"Under 12 months")

            : rt("retirement.badgeOk",null,"Eligible");

        lastMonthsLeft=d.totalMonths;

    }

    document.getElementById("ymdY").textContent=d.years;

    document.getElementById("ymdM").textContent=d.months;

    document.getElementById("ymdD").textContent=d.days;

    // Current age + how far through the working life (birth → retirement)

    const ageNow=current>dob ? monthDiffDetailed(dob,current) : {years:0,months:0,totalMonths:0};

    document.getElementById("ageNow").textContent=

        rt("retirement.ageValue",{y:ageNow.years,m:ageNow.months},`${ageNow.years}y ${ageNow.months}m`);

    document.getElementById("retireDate").textContent=fmtDate(retirementDate);

    const pct=age>0 ? clamp(ageNow.totalMonths/(age*12)*100,0,100) : 100;

    document.getElementById("progressFill").style.width=pct.toFixed(1)+"%";

}

// =========================
// Age controls sync + slider fill visual
// =========================

function initAgeControls(){

    const slider=document.getElementById("retirementAge");

    const input=document.getElementById("ageInput");

    function updateFill(){

        const pct=((slider.value-slider.min)/(slider.max-slider.min))*100;

        slider.style.setProperty("--fill",`${pct}%`);

    }

    function setVal(v){

        const n=clamp(parseInt(v||"0",10),0,60);

        slider.value=n;

        input.value=n;

        updateFill();

        calculateMonthsLeft();

    }

    function syncChips(){

        document.querySelectorAll(".age-chip").forEach(c=>{

            c.classList.toggle("active",c.dataset.age===String(slider.value));

        });

    }

    slider.addEventListener("input",()=>{ setVal(slider.value); syncChips(); });

    // Typing: allow an empty box mid-edit; clamp once the user leaves it.
    input.addEventListener("input",()=>{ if(input.value!==""){ setVal(input.value); syncChips(); } });

    input.addEventListener("blur",()=>{ setVal(input.value); syncChips(); });

    document.querySelectorAll(".age-step").forEach(btn=>{

        btn.addEventListener("click",()=>{

            setVal(parseInt(input.value||"0",10)+parseInt(btn.dataset.step,10));

            syncChips();

        });

    });

    document.querySelectorAll(".age-chip").forEach(chip=>{

        chip.addEventListener("click",()=>{ setVal(chip.dataset.age); syncChips(); });

    });

    setVal(slider.value);

    syncChips();

}

// =========================
// Init
// =========================

window.addEventListener("DOMContentLoaded",()=>{

    initDates();

    initAgeControls();

    calculateMonthsLeft();

    ["dob","currentDate"].forEach(id=>{

        const el=document.getElementById(id);

        el.addEventListener("change",calculateMonthsLeft);

        el.addEventListener("input",calculateMonthsLeft);

    });

    document.getElementById("btnToday").addEventListener("click",()=>{

        document.getElementById("currentDate").value=new Date().toISOString().split("T")[0];

        calculateMonthsLeft();

    });

    document.getElementById("btnCopyMonths").addEventListener("click",async()=>{

        if(lastMonthsLeft===null) return;

        try{

            await navigator.clipboard.writeText(String(lastMonthsLeft));

            retNotify(rt("retirement.copied",{n:lastMonthsLeft},`Copied ${lastMonthsLeft} months`));

        }catch(e){}

    });

});
