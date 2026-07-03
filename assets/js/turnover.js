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
// ...
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
            parseFloat(values[9]) || 0;

        const currentOD =
            parseFloat(values[10]) || 0;

        const turnover =
            parseFloat(values[11]) || 0;

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
.onclick=function(){

alert("Export Excel will be added in Phase 4.");

};

// ========================================
// EXPORT TO PDF
// ========================================

document
.getElementById("btnPDF")
.onclick=function(){

alert("Export PDF will be added in Phase 4.");

};

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
