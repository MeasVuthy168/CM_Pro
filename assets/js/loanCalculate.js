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

function calculateMonthsLeft(){

    const dob=new Date(document.getElementById("dob").value);

    const age=parseInt(document.getElementById("ageInput").value||"0",10);

    const current=new Date(document.getElementById("currentDate").value);

    if(!dob||isNaN(dob.getTime())) return;

    if(!current||isNaN(current.getTime())) return;

    const retirementDate=new Date(dob);

    retirementDate.setFullYear(retirementDate.getFullYear()+age);

    const desc=document.getElementById("description");

    const monthsBox=document.getElementById("monthsLeft");

    if(current>=retirementDate){

        const d=monthDiffDetailed(retirementDate,current);

        monthsBox.textContent="មិនមានចំនួនខែដែលនៅសល់";

        desc.classList.add("retired");

        desc.innerHTML=`បានចូលនិវត្តន៍ចំនួន <span class="num">${String(d.years).padStart(2,'0')}</span> ឆ្នាំ
            <span class="num">${String(d.months).padStart(2,'0')}</span> ខែ
            និង <span class="num">${String(d.days).padStart(2,'0')}</span> ថ្ងៃ ហើយ`;

    }else{

        const d=monthDiffDetailed(current,retirementDate);

        monthsBox.textContent=`${d.totalMonths} ខែ`;

        desc.classList.remove("retired");

        desc.innerHTML=`នៅសល់ <span class="num">${String(d.years).padStart(2,'0')}</span> ឆ្នាំ
            <span class="num">${String(d.months).padStart(2,'0')}</span> ខែ
            និង <span class="num">${String(d.days).padStart(2,'0')}</span> ថ្ងៃទៀត`;

    }

}

// =========================
// Age controls sync
// =========================

function initAgeControls(){

    const slider=document.getElementById("retirementAge");

    const input=document.getElementById("ageInput");

    function setVal(v){

        const n=clamp(parseInt(v||"0",10),0,60);

        slider.value=n;

        input.value=n;

        calculateMonthsLeft();

    }

    slider.addEventListener("input",()=>setVal(slider.value));

    input.addEventListener("input",()=>setVal(input.value));

    setVal(slider.value);

}

// =========================
// Init
// =========================

window.addEventListener("DOMContentLoaded",()=>{

    initDates();

    initAgeControls();

    calculateMonthsLeft();

    ["dob","currentDate"].forEach(id=>{

        document.getElementById(id).addEventListener("change",calculateMonthsLeft);

    });

});
