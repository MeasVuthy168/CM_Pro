// ========================================
// Average Debit Turnover
// Step 3.1
// ========================================

const REPORT_SOURCE = "DebitTurnOver";

// ========================================
// PAGE LOAD
// ========================================

window.addEventListener("load", () => {

    const d = new Date();

    document.getElementById("preparedDate").value =
        d.toISOString().split("T")[0];

});

// ========================================
// SEARCH BUTTON
// ========================================

document
.getElementById("btnSearch")
.onclick = searchTurnover;

// ========================================
// SEARCH
// ========================================
async function searchTurnover(){

    const cif =
        document
        .getElementById("inputCIF")
        .value
        .trim();

    if(!cif){

        alert("Please input CIF.");

        return;

    }

    const preparedDate =
        document
        .getElementById("preparedDate")
        .value;

    if(!preparedDate){

        alert("Please select Prepared Date.");

        return;

    }

    showLoading(true);

    try{

        const reportDates =
            getLast12MonthEnds(preparedDate);

        const result =
            await API.post(

                "/api/debitturnover/ave-turnover",

                {

                    source: REPORT_SOURCE,

                    cif: cif,

                    reportDates: reportDates

                }

            );

        if(!result.ok){

            throw new Error(

                result.message ||

                "Unable to load data."

            );

        }

        renderTable(result.items || []);

    }

    catch(err){

        console.error(err);

        alert(err.message);

    }

    finally{

        showLoading(false);

    }

}

// ========================================
// GENERATE LAST 12 MONTH ENDS
// Example:
// Prepared = 2026-07-03
//
// 30-06-26
// 31-05-26
// 30-04-26
// .....
// ========================================

function getLast12MonthEnds(prepared){

    const arr = [];

    let d = new Date(prepared);

    d.setDate(1);

    for(let i=0;i<12;i++){

        d.setMonth(d.getMonth()-1);

        const lastDay =

            new Date(

                d.getFullYear(),

                d.getMonth()+1,

                0

            );

        const dd =

            String(lastDay.getDate())

            .padStart(2,"0");

        const mm =

            String(lastDay.getMonth()+1)

            .padStart(2,"0");

        const yy =

            String(lastDay.getFullYear())

            .slice(-2);

        arr.push(

            `${dd}-${mm}-${yy}`

        );

    }

    return arr;

}

// ========================================
// FORMAT NUMBER
// ========================================

function formatNumber(v){

    return Number(v || 0)

    .toLocaleString(

        undefined,

        {

            minimumFractionDigits:2,

            maximumFractionDigits:2

        }

    );

}

// ========================================
// FORMAT EXCEL DATE
// Excel Serial -> dd-mm-yy
// ========================================

function formatExcelDate(serial){

    serial = Number(serial);

    if(!serial){

        return "";

    }

    const utc =

        Math.floor(serial - 25569);

    const d =

        new Date(

            utc * 86400000

        );

    const dd =

        String(d.getDate())

        .padStart(2,"0");

    const mm =

        String(d.getMonth()+1)

        .padStart(2,"0");

    const yy =

        String(d.getFullYear())

        .slice(-2);

    return `${dd}-${mm}-${yy}`;

}

// ========================================
// LOADING
// ========================================

function showLoading(show){

    let box =

        document.getElementById(

            "loadingBox"

        );

    if(!box){

        box = document.createElement("div");

        box.id = "loadingBox";

        box.className = "loading-box";

        box.innerHTML =

            '<div class="spinner"></div>';

        document.body.appendChild(box);

    }

    box.style.display =

        show

        ? "flex"

        : "none";

}

// ========================================
// RENDER TABLE
// ========================================

function renderTable(items){

    const tbody =
        document.getElementById(
            "tbodyTurnover"
        );

    tbody.innerHTML = "";

    let customerName = "";

    let totalDebit = 0;
    let totalOD = 0;
    let totalTurnover = 0;
    let totalCount = 0;

    items.forEach((item,index)=>{

        const values = item.values || [];

        // --------------------------
        // No data for this month
        // --------------------------

        if(values.length===0){

            const tr =
                document.createElement("tr");

            tr.className="row-nodata";

            tr.innerHTML=`

                <td>${item.requestText}</td>

                <td colspan="4">
                    No Data
                </td>

            `;

            tbody.appendChild(tr);

            return;

        }

        // --------------------------
        // Customer Name
        // values[5] = English Name
        // values[4] = Khmer Name
        // --------------------------

        if(!customerName){

            customerName =
                values[5] ||
                values[4] ||
                "";

        }

        // --------------------------
        // Mongo Columns
        // --------------------------

        const debit =
            parseFloat(values[16]) || 0;

        const currentOD =
            parseFloat(values[10]) || 0;

        const turnover =
            parseFloat(values[14]) || 0;

        const effectiveDate =
            formatExcelDate(values[17]);

        const month =
            formatExcelDate(values[36]);

        // --------------------------
        // Average
        // --------------------------

        totalDebit += debit;
        totalOD += currentOD;
        totalTurnover += turnover;
        totalCount++;

        // --------------------------
        // Create Row
        // --------------------------

        const tr =
            document.createElement("tr");

        // newest report

        if(index===0){

            tr.classList.add("row-newest");

        }

        // oldest report

        if(index===items.length-1){

            tr.classList.add("row-oldest");

        }

        tr.innerHTML=`

            <td>${month}</td>

            <td>

                ${formatNumber(debit)}

            </td>

            <td>

                ${formatNumber(currentOD)}

            </td>

            <td>

                ${(turnover*100).toFixed(2)}%

            </td>

            <td>

                ${effectiveDate}

            </td>

        `;

        tbody.appendChild(tr);

    });

    // --------------------------
    // Customer Name
    // --------------------------

    document
    .getElementById(
        "customerName"
    )
    .value =
    customerName;

    // --------------------------
    // Average
    // --------------------------

    document
    .getElementById(
        "avgDebit"
    )
    .innerHTML =

        totalCount

        ?

        formatNumber(
            totalDebit/totalCount
        )

        :

        "-";

    document
    .getElementById(
        "avgOD"
    )
    .innerHTML =

        totalCount

        ?

        formatNumber(
            totalOD/totalCount
        )

        :

        "-";

    document
    .getElementById(
        "avgTurnover"
    )
    .innerHTML =

        totalCount

        ?

        ((totalTurnover/totalCount)*100)
        .toFixed(2)+"%"

        :

        "-";

}

// ========================================
// EXPORT TO EXCEL
// ========================================

document
.getElementById("btnExcel")
.onclick=exportExcel;

// ========================================
// EXPORT TO PDF
// ========================================

document
.getElementById("btnPDF")
.onclick=exportPDF;

// ========================================
// OFFLINE DETECT
// ========================================

function updateOnlineStatus(){

const banner=document.getElementById(
"offlineBanner"
);

if(!banner)return;

banner.style.display=

navigator.onLine

?

"none"

:

"block";

}

window.addEventListener(

"online",

updateOnlineStatus

);

window.addEventListener(

"offline",

updateOnlineStatus

);

updateOnlineStatus();

// ========================================
// ENTER KEY = SEARCH
// ========================================

document
.getElementById("inputCIF")
.addEventListener(

"keydown",

function(e){

if(e.key==="Enter"){

searchTurnover();

}

}

);

// ========================================
// DEFAULT DATE
// Today
// ========================================

(function(){

const txt=document.getElementById(
"preparedDate"
);

if(txt && !txt.value){

txt.value=

new Date()

.toISOString()

.substring(0,10);

}

})();

// ========================================
// CLEAR TABLE
// ========================================

function clearTable(){

document
.getElementById("tbodyTurnover")
.innerHTML=

`

<tr>

<td colspan="5">

No Data

</td>

</tr>

`;

document
.getElementById("customerName")
.value="";

document
.getElementById("avgDebit")
.innerHTML="-";

document
.getElementById("avgOD")
.innerHTML="-";

document
.getElementById("avgTurnover")
.innerHTML="-";

}

// ========================================
// AUTO CLEAR WHEN CIF EMPTY
// ========================================

document
.getElementById("inputCIF")
.addEventListener(

"input",

function(){

if(this.value.trim()===""){

clearTable();

}

}

);
// ========================================
// EXPORT PDF
// ========================================

function exportPDF(){

const user=
JSON.parse(
localStorage.getItem("loggedInUser")||"{}"
);

const preparedBy=
user.fullname||
user.username||
"Unknown";

const generatedAt=
new Date().toLocaleString();

const prepared=
document.getElementById("preparedDate").value;

const cif=
document.getElementById("inputCIF").value;

const customer=
document.getElementById("customerName").value;

const avgDebit=
document.getElementById("avgDebit").innerText;

const avgOD=
document.getElementById("avgOD").innerText;

const avgTurnover=
document.getElementById("avgTurnover").innerText;

let tableRows="";

document
.querySelectorAll("#tbodyTurnover tr")
.forEach(r=>{

tableRows+="<tr>";

r.querySelectorAll("td").forEach(td=>{

tableRows+=`
<td style="
padding:6px;
border:1px solid #999;
text-align:center;
">
${td.innerText}
</td>
`;

});

tableRows+="</tr>";

});

let html=`

<div style="
font-family:Arial,sans-serif;
padding:20px;
color:#222;
">

<table style="
width:100%;
border-collapse:collapse;
margin-bottom:15px;
">

<tr>

<td>

<h2 style="
margin:0;
font-size:24px;
color:#032d73;
">

YEARLY AVERAGE OF DEBIT TURNOVER

</h2>

</td>

<td style="
text-align:right;
width:90px;
">

<img
src="${ACLEDA_LOGO}"
style="
width:70px;
height:70px;
">

</td>

</tr>

</table>

<table style="
width:100%;
margin-bottom:15px;
">

<tr>

<td width="150">

Prepared Date

</td>

<td>

: ${prepared}

</td>

</tr>

<tr>

<td>

CIF

</td>

<td>

: ${cif}

</td>

</tr>

<tr>

<td>

Customer Name

</td>

<td>

: ${customer}

</td>

</tr>

</table>

<hr>

<table
style="
width:100%;
border-collapse:collapse;
font-size:12px;
">

<thead>

<tr style="
background:#032d73;
color:white;
">

<th>Month</th>

<th>AMT_IN</th>

<th>CURRENT_OD</th>

<th>TURNOVER</th>

<th>EFFECTIVE DATE</th>

</tr>

</thead>

<tbody>

${tableRows}

</tbody>

<tfoot>

<tr style="
background:#eeeeee;
font-weight:bold;
">

<td>Average</td>

<td>${avgDebit}</td>

<td>${avgOD}</td>

<td>${avgTurnover}</td>

<td></td>

</tr>

</tfoot>

</table>

<hr style="margin-top:20px;">

<table style="
width:100%;
font-size:12px;
">

<tr>

<td>

Prepared By :
<b>${preparedBy}</b>

</td>

<td style="
text-align:right;
">

Generated At :
${generatedAt}

</td>

</tr>

<tr>

<td colspan="2"
style="
padding-top:20px;
font-size:11px;
color:#666;
">

CM_Pro Credit Monitoring System

</td>

</tr>

</table>

</div>

`;

const container=
document.createElement("div");

container.innerHTML=html;

html2pdf()
.from(container)
.set({
margin:0.4,
filename:`Average_Debit_Turnover_${cif}.pdf`,
html2canvas:{scale:2},
jsPDF:{
unit:"in",
format:"a4",
orientation:"portrait"
}
})
.save();

}
// ========================================
// EXPORT EXCEL
// ========================================

function exportExcel(){

const wb=XLSX.utils.book_new();

const ws={};

const prepared=

document.getElementById(
"preparedDate"
).value;

const cif=

document.getElementById(
"inputCIF"
).value;

const customer=

document.getElementById(
"customerName"
).value;

const data=[];

// Title

data.push([
"Average Debit Turnover"
]);

// Information

data.push([
"Prepared Date",
prepared
]);

data.push([
"CIF",
cif
]);

data.push([
"Customer Name",
customer
]);

data.push([]);

data.push([

"Month",

"AMT_IN",

"CURRENT_OD",

"TURNOVER",

"EFFECTIVE_DATE"

]);

// Table

const rows=

document.querySelectorAll(
"#tbodyTurnover tr"
);

rows.forEach(r=>{

const row=[];

r.querySelectorAll("td")
.forEach(td=>{

row.push(td.innerText);

});

data.push(row);

});

// Average

data.push([]);

data.push([

"Average",

document.getElementById("avgDebit").innerText,

document.getElementById("avgOD").innerText,

document.getElementById("avgTurnover").innerText,

""

]);

const sheet=

XLSX.utils.aoa_to_sheet(data);

// Column Width

sheet["!cols"]=[

{wch:14},

{wch:16},

{wch:16},

{wch:14},

{wch:18}

];

// Merge title

sheet["!merges"]=[

{

s:{r:0,c:0},

e:{r:0,c:4}

}

];

// Style Title

applyTitleStyle(sheet);

// Style Header

applyHeaderStyle(sheet);

// Style Average

applyAverageStyle(sheet,data.length);

XLSX.utils.book_append_sheet(

wb,

sheet,

"Turnover"

);

XLSX.writeFile(

wb,

`Average_Debit_Turnover_${cif}.xlsx`

);

}
// ========================================
// TITLE STYLE
// ========================================

function applyTitleStyle(ws){

if(ws.A1){

ws.A1.s={

font:{

bold:true,

sz:16,

color:{rgb:"FFFFFF"}

},

fill:{

fgColor:{rgb:"032D73"}

},

alignment:{

horizontal:"center"

}

};

}

}

// ========================================
// HEADER STYLE
// ========================================

function applyHeaderStyle(ws){

const row=6;

["A","B","C","D","E"]

.forEach(col=>{

const cell=ws[col+row];

if(cell){

cell.s={

font:{

bold:true,

color:{rgb:"FFFFFF"}

},

fill:{

fgColor:{rgb:"032D73"}

},

alignment:{

horizontal:"center"

}

};

}

});

}

// ========================================
// AVERAGE STYLE
// ========================================

function applyAverageStyle(ws,lastRow){

const r=lastRow;

["A","B","C","D","E"]

.forEach(col=>{

const cell=ws[col+r];

if(cell){

cell.s={

font:{

bold:true

},

fill:{

fgColor:{rgb:"FFF2CC"}

}

};

}

});

}

// ========================================
// FORMAT CIF
// ========================================

document
.getElementById("inputCIF")
.addEventListener(

"blur",

function(){

this.value=this.value.trim();

}

);

// ========================================
// PAGE READY
// ========================================

console.log(

"Average Debit Turnover Ready."

);
