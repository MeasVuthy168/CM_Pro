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

function formatDate(dateStr){

    if(!dateStr) return "-";

    const d=new Date(dateStr);

    if(isNaN(d.getTime())) return "-";

    const day=String(d.getDate()).padStart(2,'0');

    const month=String(d.getMonth()+1).padStart(2,'0');

    return `${day}/${month}/${d.getFullYear()}`;

}

// =========================
// Render result + export section
// =========================

function calculateMonthsLeft(){

    const customerName=document.getElementById("customerName").value.trim();

    const dobVal=document.getElementById("dob").value;

    const currentVal=document.getElementById("currentDate").value;

    const age=parseInt(document.getElementById("ageInput").value||"0",10);

    const dob=new Date(dobVal);

    const current=new Date(currentVal);

    if(!dob||isNaN(dob.getTime())) return;

    if(!current||isNaN(current.getTime())) return;

    const retirementDate=new Date(dob);

    retirementDate.setFullYear(retirementDate.getFullYear()+age);

    let monthsBoxText="";

    let descHtml="";

    let isRetired=false;

    if(current>=retirementDate){

        const d=monthDiffDetailed(retirementDate,current);

        monthsBoxText="មិនមានចំនួនខែដែលនៅសល់";

        isRetired=true;

        descHtml=`បានចូលនិវត្តន៍ចំនួន <span class="num">${String(d.years).padStart(2,'0')}</span> ឆ្នាំ
            <span class="num">${String(d.months).padStart(2,'0')}</span> ខែ
            និង <span class="num">${String(d.days).padStart(2,'0')}</span> ថ្ងៃ ហើយ`;

    }else{

        const d=monthDiffDetailed(current,retirementDate);

        monthsBoxText=`${d.totalMonths} ខែ`;

        descHtml=`នៅសល់ <span class="num">${String(d.years).padStart(2,'0')}</span> ឆ្នាំ
            <span class="num">${String(d.months).padStart(2,'0')}</span> ខែ
            និង <span class="num">${String(d.days).padStart(2,'0')}</span> ថ្ងៃទៀត`;

    }

    let html=`<div class="pdf-wrapper"><div class="pdf-title">ការគណនាចំនួនខែចូលនិវត្តន៍</div><div class="pdf-customer">ឈ្មោះអតិថិជន : <span>${customerName||"-"}</span></div>`;

    html+=`<table class="info-table">
        <tr><th>ថ្ងៃខែឆ្នាំកំណើត</th><td>${formatDate(dobVal)}</td></tr>
        <tr><th>អាយុចូលនិវត្តន៍</th><td>${age} ឆ្នាំ</td></tr>
        <tr><th>ថ្ងៃខែឆ្នាំបច្ចុប្បន្ន</th><td>${formatDate(currentVal)}</td></tr>
        <tr><th>ថ្ងៃចូលនិវត្តន៍</th><td>${formatDate(retirementDate.toISOString().split("T")[0])}</td></tr>
    </table>`;

    html+=`<div class="result-box">
        <div class="result-title">ចំនួនខែដែលនៅសល់</div>
        <div class="months-big">${monthsBoxText}</div>
        <div class="desc${isRetired ? " retired" : ""}">${descHtml}</div>
    </div>`;

    html+=`</div>`;

    document.getElementById("exportSection").innerHTML=html;

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
// Export PDF
// =========================

async function exportToPDF(){

    const {jsPDF}=window.jspdf;

    const doc=new jsPDF('p','pt','a4');

    const exportSection=document.getElementById("exportSection");

    if(!exportSection||exportSection.innerHTML.trim()===""){

        if(typeof showToast==="function"){

            showToast("សូមបំពេញទិន្នន័យមុននឹងនាំចេញ។","warning");

        }else{

            alert("សូមបំពេញទិន្នន័យមុននឹងនាំចេញ។");

        }

        return;

    }

    const customerName=document.getElementById("customerName").value.trim()||"-";

    const translatedSection=exportSection.cloneNode(true);

    translatedSection.querySelectorAll("th, td, .result-title, .desc").forEach(cell=>{

        cell.innerHTML=cell.innerHTML

            .replace("ថ្ងៃខែឆ្នាំកំណើត","Date of Birth")

            .replace("អាយុចូលនិវត្តន៍","Retirement Age")

            .replace("ថ្ងៃខែឆ្នាំបច្ចុប្បន្ន","Current Date")

            .replace("ថ្ងៃចូលនិវត្តន៍","Retirement Date")

            .replace("ឆ្នាំ","yrs");

    });

    const infoTable=translatedSection.querySelector(".info-table");

    doc.setFontSize(15);

    doc.setFont(undefined,'bold');

    doc.text("Retirement Months Calculation",40,40);

    doc.setFont(undefined,'normal');

    doc.setFontSize(11);

    doc.setTextColor(40,40,40);

    doc.text(`Customer Name : ${customerName}`,40,62);

    doc.autoTable({

        html:infoTable,

        startY:80,

        styles:{fontSize:10,halign:'left'},

        headStyles:{fillColor:[13,45,92],textColor:255},

        columnStyles:{0:{halign:'left'},1:{halign:'left'}}

    });

    const monthsText=exportSection.querySelector(".months-big").textContent;

    const descText=exportSection.querySelector(".desc").textContent.trim();

    let finalY=doc.lastAutoTable.finalY+30;

    doc.setFontSize(13);

    doc.setFont(undefined,'bold');

    doc.text(`Months Remaining : ${monthsText}`,40,finalY);

    doc.setFont(undefined,'normal');

    doc.setFontSize(11);

    doc.text(descText,40,finalY+20,{maxWidth:500});

    doc.save("Retirement_Calculation.pdf");

}

// =========================
// Export Excel
// =========================

function exportToExcel(){

    const exportSection=document.getElementById("exportSection");

    if(!exportSection||exportSection.innerHTML.trim()===""){

        if(typeof showToast==="function"){

            showToast("សូមបំពេញទិន្នន័យមុននឹងនាំចេញ។","warning");

        }else{

            alert("សូមបំពេញទិន្នន័យមុននឹងនាំចេញ។");

        }

        return;

    }

    const customerName=document.getElementById("customerName").value.trim()||"-";

    const dobVal=document.getElementById("dob").value;

    const currentVal=document.getElementById("currentDate").value;

    const age=document.getElementById("ageInput").value;

    const monthsText=exportSection.querySelector(".months-big").textContent;

    const descText=exportSection.querySelector(".desc").textContent.trim();

    const rows=[

        ["Retirement Months Calculation"],

        [`Customer Name : ${customerName}`],

        [],

        ["Date of Birth",formatDate(dobVal)],

        ["Retirement Age",`${age} yrs`],

        ["Current Date",formatDate(currentVal)],

        [],

        ["Months Remaining",monthsText],

        ["Details",descText]

    ];

    const ws=XLSX.utils.aoa_to_sheet(rows);

    ws["!merges"]=[

        {s:{r:0,c:0},e:{r:0,c:1}},

        {s:{r:1,c:0},e:{r:1,c:1}}

    ];

    ws["!cols"]=[

        {wch:20},

        {wch:30}

    ];

    const wb=XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(wb,ws,"Retirement");

    XLSX.writeFile(wb,"Retirement_Calculation.xlsx");

}

// =========================
// Init
// =========================

window.addEventListener("DOMContentLoaded",()=>{

    initDates();

    initAgeControls();

    calculateMonthsLeft();

    ["dob","currentDate","customerName"].forEach(id=>{

        document.getElementById(id).addEventListener("input",calculateMonthsLeft);

        document.getElementById(id).addEventListener("change",calculateMonthsLeft);

    });

    document.getElementById("btnPDF").addEventListener("click",exportToPDF);

    document.getElementById("btnExcel").addEventListener("click",exportToExcel);

});
