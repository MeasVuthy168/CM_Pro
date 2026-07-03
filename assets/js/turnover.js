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

ddl.selectedIndex=0;

}
catch(err){

console.error(err);

ddl.innerHTML=
"<option>Error Loading</option>";

}

}

// ========================================
// Generate Previous 12 Month Ends
// ========================================

function getLast12MonthEnds(preparedDate){

const months=[];

let d=new Date(preparedDate);

d.setDate(1);

for(let i=0;i<12;i++){

d.setMonth(d.getMonth()-1);

const lastDay=new Date(

d.getFullYear(),

d.getMonth()+1,

0

);

const dd=String(lastDay.getDate())
.padStart(2,"0");

const mm=String(lastDay.getMonth()+1)
.padStart(2,"0");

const yy=String(lastDay.getFullYear())
.slice(-2);

months.push(`${dd}-${mm}-${yy}`);

}

return months;

}

// ========================================
// SEARCH
// ========================================

document
.getElementById("btnSearch")
.onclick=searchTurnover;

async function searchTurnover(){

const cif=document
.getElementById("inputCIF")
.value
.trim();

if(!cif){

alert("Please input CIF.");

return;

}

const prepared=document
.getElementById("preparedDate")
.value;

if(!prepared){

alert("Please select Prepared Date.");

return;

}

try{

const reportDates=
getLast12MonthEnds(prepared);

const result=await API.post(

"/api/debitturnover/ave-turnover",

{

source:REPORT_SOURCE,

cif:cif,

reportDates:reportDates

}

);

console.log("Request reportDates:",reportDates);
console.log("API Result:",result);

"/api/debitturnover/ave-turnover",

{

source:REPORT_SOURCE,

cif:cif,

reportDates:reportDates

}

);

if(!result.ok){

throw new Error(

result.message||

"Search failed."

);

}

renderTable(result.items);

}
catch(err){

console.error(err);

alert(err.message);

}

}

// ========================================
// Render Table
// ========================================

function renderTable(items){

const tbody=document
.getElementById("tbodyTurnover");

tbody.innerHTML="";

let totalDebit=0;

let totalOD=0;

let totalTurn=0;

let count=0;

let customerName="";

items.forEach((row,index)=>{

const v=row.values||[];

if(!v.length){

const tr=document.createElement("tr");

tr.innerHTML=`

<td>${row.requestText}</td>

<td colspan="4">

No Data

</td>

`;

tbody.appendChild(tr);

return;

}

if(!customerName){

customerName=v[4];

}

const debit=parseFloat(v[9])||0;

const od=parseFloat(v[10])||0;

const turnover=parseFloat(v[11])||0;

const month=row.requestText;

const effective=formatExcelDate(v[17]);

totalDebit+=debit;

totalOD+=od;

totalTurn+=turnover;

count++;

const tr=document.createElement("tr");

if(index===0){

tr.style.background="#dff7df";

tr.style.fontWeight="bold";

}

if(index===items.length-1){

tr.style.background="#f2f2f2";

}

tr.innerHTML=`

<td>${month}</td>

<td>${formatNumber(debit)}</td>

<td>${formatNumber(od)}</td>

<td>${turnover.toFixed(2)}%</td>

<td>${effective}</td>

`;

tbody.appendChild(tr);

});

document
.getElementById("customerName")
.value=customerName;

document
.getElementById("avgDebit")
.innerHTML=

count

?

formatNumber(totalDebit/count)

:

"-";

document
.getElementById("avgOD")
.innerHTML=

count

?

formatNumber(totalOD/count)

:

"-";

document
.getElementById("avgTurnover")
.innerHTML=

count

?

(totalTurn/count).toFixed(2)+"%"

:

"-";

}

// ========================================
// Helpers
// ========================================

function formatNumber(v){

return Number(v)
.toLocaleString(

undefined,

{

minimumFractionDigits:2,

maximumFractionDigits:2

}

);

}

function formatExcelDate(serial){

serial=Number(serial);

if(!serial)return "";

const utc=Math.floor(serial-25569);

const d=new Date(utc*86400000);

const dd=String(d.getDate())
.padStart(2,"0");

const mm=String(d.getMonth()+1)
.padStart(2,"0");

const yy=String(d.getFullYear())
.slice(-2);

return `${dd}-${mm}-${yy}`;

}

// ========================================
// EXPORT
// ========================================

document
.getElementById("btnExcel")
.onclick=function(){

alert("Phase 3 : Export Excel");

};

document
.getElementById("btnPDF")
.onclick=function(){

alert("Phase 3 : Export PDF");

};
