// ========================================
// Average Debit Turnover
// ========================================

const REPORT_SOURCE="DebitTurnOver";

// ========================================
// PAGE LOAD
// ========================================

window.addEventListener("load",()=>{

loadReportDates();

});

// ========================================
// LOAD REPORT DATES
// ========================================

async function loadReportDates(){

const ddl=document.getElementById("preparedDate");

ddl.innerHTML="<option>Loading...</option>";

try{

const result=await API.get(
`/api/debitturnover/report-dates?source=${REPORT_SOURCE}`
);

if(!result.ok){

throw new Error(
result.message||"Cannot load report dates."
);

}

ddl.innerHTML="";

if(!result.dates.length){

ddl.innerHTML=
"<option>No Report</option>";

return;

}

result.dates.forEach(date=>{

const opt=document.createElement("option");

opt.value=date;

opt.text=date;

ddl.appendChild(opt);

});

// newest report
ddl.selectedIndex=0;

}
catch(err){

console.error(err);

ddl.innerHTML=
"<option>Error Loading</option>";

}

}

// ========================================
// SEARCH
// ========================================

document
.getElementById("btnSearch")
.onclick=function(){

alert("Phase 2.2");

};

// ========================================
// EXPORT
// ========================================

document
.getElementById("btnExcel")
.onclick=function(){

alert("Phase 3");

};

document
.getElementById("btnPDF")
.onclick=function(){

alert("Phase 3");

};
