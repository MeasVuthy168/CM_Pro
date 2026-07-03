// ========================================
// Average Debit Turnover
// ========================================

const REPORT_SOURCE="DebitTurnOver";


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

alert("Please select report date.");

return;

}

try{

// =====================================
// Generate last 12 report dates
// =====================================
const reportDates=

getLast12MonthEnds(prepared);

// =====================================
// Call API
// =====================================

const result=await API.post(

"/api/debitturnover/ave-turnover",

{

source:REPORT_SOURCE,

cif:cif,

reportDates:reportDates

}

);

if(!result.ok){

throw new Error(result.message);

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

if(!v.length)return;

if(!customerName){

customerName=v[4];

}

const debit=parseFloat(v[9])||0;

const od=parseFloat(v[10])||0;

const turnover=parseFloat(v[11])||0;

const month=formatExcelDate(v[36]);

const effective=formatExcelDate(v[17]);

totalDebit+=debit;

totalOD+=od;

totalTurn+=turnover;

count++;

const tr=document.createElement("tr");

if(index==0){

tr.style.background="#e6ffe6";

tr.style.fontWeight="bold";

}

if(index==items.length-1){

tr.style.background="#f4f4f4";

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

"";

document
.getElementById("avgOD")
.innerHTML=

count

?

formatNumber(totalOD/count)

:

"";

document
.getElementById("avgTurnover")
.innerHTML=

count

?

(totalTurn/count).toFixed(2)+"%"

:

"";

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

const yyyy=d.getFullYear();

return `${dd}/${mm}/${yyyy}`;

}

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
