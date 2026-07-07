// ========================================
// Average Debit Turnover
// Step 3.1
// ========================================

const REPORT_SOURCE = "DebitTurnOver";

// ========================================
// LAST RENDERED DATA
// Exports read from here instead of re-scraping the DOM table.
// DOM-scraping (innerText/textContent on live table cells) turned
// out to be fragile across mobile browsers/WebViews — keeping the
// exact same data that was used to render the screen, in memory,
// sidesteps that class of bug entirely.
// ========================================

let lastTurnoverData={

    rows:[],

    avgDebit:"-",

    avgOD:"-",

    avgTurnover:"-",

    customerName:""

};

// ========================================
// MESSAGE HELPER
// Prefer the app's toast system (already loaded via toast.js
// on this page); fall back to alert() only if it's missing.
// ========================================

function notify(message,type="info"){

    if(typeof showToast==="function"){

        showToast(message,type);

    }else{

        alert(message);

    }

}

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

        notify("Please input CIF.","warning");

        return;

    }

    const preparedDate =
        document
        .getElementById("preparedDate")
        .value;

    if(!preparedDate){

        notify("Please select Prepared Date.","warning");

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

        notify(err.message,"error");

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
// The #loadingBox element always exists in this page's HTML —
// no need for the fallback branch that used to create a second
// one from scratch if it was "missing".
// ========================================

function showLoading(show){

    const box = document.getElementById("loadingBox");

    if(!box) return;

    box.style.display = show ? "flex" : "none";

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

    const capturedRows = [];

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

            capturedRows.push({

                month:item.requestText || "",

                debit:"",

                currentOD:"",

                turnover:"",

                effectiveDate:"",

                noData:true

            });

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

        capturedRows.push({

            month,

            debit:formatNumber(debit),

            currentOD:formatNumber(currentOD),

            turnover:(turnover*100).toFixed(2)+"%",

            effectiveDate,

            noData:false

        });

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

    const avgDebitText =

        totalCount

        ?

        formatNumber(
            totalDebit/totalCount
        )

        :

        "-";

    const avgODText =

        totalCount

        ?

        formatNumber(
            totalOD/totalCount
        )

        :

        "-";

    const avgTurnoverText =

        totalCount

        ?

        ((totalTurnover/totalCount)*100)
        .toFixed(2)+"%"

        :

        "-";

    document.getElementById("avgDebit").innerHTML = avgDebitText;

    document.getElementById("avgOD").innerHTML = avgODText;

    document.getElementById("avgTurnover").innerHTML = avgTurnoverText;

    // --------------------------
    // Save for export (PDF/Excel read from here instead of
    // re-scraping the DOM table)
    // --------------------------

    lastTurnoverData = {

        rows:capturedRows,

        avgDebit:avgDebitText,

        avgOD:avgODText,

        avgTurnover:avgTurnoverText,

        customerName

    };

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

lastTurnoverData = {

    rows:[],

    avgDebit:"-",

    avgOD:"-",

    avgTurnover:"-",

    customerName:""

};

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
async function exportPDF(){

    // ==========================
    // Load logo and convert to Base64
    // ==========================

    async function loadLogo(){

        try{

            const response = await fetch("../../assets/images/acleda-logo-whiteBG.png");

            const blob = await response.blob();

            return await new Promise(resolve=>{

                const reader = new FileReader();

                reader.onloadend = ()=>resolve(reader.result);

                reader.readAsDataURL(blob);

            });

        }catch{

            return "";

        }

    }

    const logo = await loadLogo();

    // ==========================

    const user =
    JSON.parse(
        localStorage.getItem("loggedInUser") || "{}"
    );

    const preparedBy =
    (
        user.fullname ||
        user.username ||
        "Unknown"
    ).toUpperCase();

    const prepared =
    document.getElementById("preparedDate").value;

    const preparedText =
    new Date(prepared)
    .toLocaleDateString(
        "en-GB",
        {
            day:"2-digit",
            month:"short",
            year:"numeric"
        }
    );

    const cif =
    document.getElementById("inputCIF").value;

    const customer =
    document
    .getElementById("customerName")
    .value
    .toUpperCase();

    const avgDebit = lastTurnoverData.avgDebit;

    const avgOD = lastTurnoverData.avgOD;

    const avgTurnover = lastTurnoverData.avgTurnover;

    // ==========================
    // Table
    // Built from lastTurnoverData (captured when the table was
    // rendered) rather than re-reading the live DOM — scraping
    // proved unreliable across browsers/WebViews.
    // ==========================

    let rows="";

    if(!lastTurnoverData.rows.length){

        rows=`

        <tr>

        <td colspan="5" style="border:1px solid #999;padding:6px;text-align:center;">

        No Data

        </td>

        </tr>

        `;

    }else{

        lastTurnoverData.rows.forEach(r=>{

            if(r.noData){

                rows+=`

                <tr>

                <td style="border:1px solid #999;padding:6px;text-align:center;">${r.month}</td>

                <td colspan="4" style="border:1px solid #999;padding:6px;text-align:center;">No Data</td>

                </tr>

                `;

                return;

            }

            rows+=`

            <tr>

            <td style="border:1px solid #999;padding:6px;text-align:center;">${r.month}</td>

            <td style="border:1px solid #999;padding:6px;text-align:center;">${r.debit}</td>

            <td style="border:1px solid #999;padding:6px;text-align:center;">${r.currentOD}</td>

            <td style="border:1px solid #999;padding:6px;text-align:center;">${r.turnover}</td>

            <td style="border:1px solid #999;padding:6px;text-align:center;">${r.effectiveDate}</td>

            </tr>

            `;

        });

    }

    // ==========================
    // HTML
    // ==========================

    const html = `

<div
style="
width:100%;
height:1030px;
padding:25px;
box-sizing:border-box;
font-family:Arial,sans-serif;
display:flex;
flex-direction:column;
">

<!-- HEADER -->

<div
style="
display:flex;
justify-content:space-between;
align-items:center;
margin-bottom:18px;
">

<div
style="
flex:1;
text-align:left;
font-size:18px;
font-weight:bold;
color:#032d73;
padding-top:18px;
letter-spacing:.3px;
">
YEARLY AVERAGE OF DEBIT TURNOVER
</div>

<div
style="
width:180px;
text-align:right;
">

<img
src="${logo}"
style="
width:150px;
height:auto;
display:block;
margin-left:auto;
">

</div>

</div>

<!-- INFORMATION -->

<div
style="
font-size:14px;
margin-bottom:20px;
line-height:30px;
">

<div>

<span
style="
display:inline-block;
width:150px;
font-weight:bold;
">

Prepared Date

</span>

<span
style="
display:inline-block;
width:20px;
">

:

</span>

<span
style="
text-align:left;
">

${preparedText}

</span>

</div>

<div>

<span
style="
display:inline-block;
width:150px;
font-weight:bold;
">

CIF

</span>

<span
style="
display:inline-block;
width:20px;
">

:

</span>

<span>

${cif}

</span>

</div>

<div>

<span
style="
display:inline-block;
width:150px;
font-weight:bold;
">

Customer Name

</span>

<span
style="
display:inline-block;
width:20px;
">

:

</span>

<span>

${customer}

</span>

</div>

</div>

<!-- TABLE -->

<table
style="
width:100%;
border-collapse:collapse;
font-size:12px;
">

<thead>

<tr
style="
background:#032d73;
color:white;
">

<th style="padding:7px;border:1px solid #999;">Month</th>

<th style="padding:7px;border:1px solid #999;">AMT_IN</th>

<th style="padding:7px;border:1px solid #999;">CURRENT_OD</th>

<th style="padding:7px;border:1px solid #999;">TURNOVER</th>

<th style="padding:7px;border:1px solid #999;">EFFECTIVE DATE</th>

</tr>

</thead>

<tbody>

${rows}

</tbody>

<tfoot>

<tr
style="
background:#eeeeee;
font-weight:bold;
">

<td style="border:1px solid #999;padding:7px;">Average</td>

<td style="border:1px solid #999;padding:7px;">${avgDebit}</td>

<td style="border:1px solid #999;padding:7px;">${avgOD}</td>

<td style="border:1px solid #999;padding:7px;">${avgTurnover}</td>

<td style="border:1px solid #999;"></td>

</tr>

</tfoot>

</table>

<!-- Prepared By -->

<div
style="
margin-top:12px;
font-size:13px;
text-align:right;
">

<b>Prepared By :</b>

${preparedBy.toUpperCase()}

</div>

<!-- Footer -->

<div
style="
margin-top:auto;
padding-top:8px;
border-top:2px solid #999;
font-size:11px;
color:#666;
">

CM_Pro Credit Monitoring System

</div>

</div>

`;

    const div=document.createElement("div");

    div.innerHTML=html;

    html2pdf()
    .from(div)
    .set({

        margin:0.3,

        filename:`Average_Debit_Turnover_${cif}.pdf`,

        image:{
            type:"jpeg",
            quality:1
        },

        html2canvas:{
            scale:2,
            useCORS:true,
            allowTaint:true
        },

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
// Built from lastTurnoverData (captured when the table was
// rendered) rather than re-reading the live DOM.

if(!lastTurnoverData.rows.length){

data.push(["No Data"]);

}else{

lastTurnoverData.rows.forEach(r=>{

if(r.noData){

data.push([r.month,"No Data","","",""]);

}else{

data.push([

r.month,

r.debit,

r.currentOD,

r.turnover,

r.effectiveDate

]);

}

});

}

// Average

data.push([]);

data.push([

"Average",

lastTurnoverData.avgDebit,

lastTurnoverData.avgOD,

lastTurnoverData.avgTurnover,

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
