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
// toast.js declares CMToast as a top-level const, so it is NOT a
// window property — check it with typeof.
// ========================================

function notify(message,type="info"){

    if(typeof CMToast!=="undefined" && typeof CMToast.show==="function"){

        CMToast.show({ type, title:message, message:"", duration:3500 });

    }else{

        alert(message);

    }

}

function tr_(key,fallback){

    try{

        if(window.CMI18n && typeof CMI18n.t==="function"){

            const v=CMI18n.t(key);

            if(v && v!==key) return v;

        }

    }catch(e){}

    return fallback;

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

        notify(tr_("turnover.needCif","Please input CIF."),"warning");

        document.getElementById("inputCIF").focus();

        return;

    }

    const preparedDate =
        document
        .getElementById("preparedDate")
        .value;

    if(!preparedDate){

        notify(tr_("turnover.needDate","Please select Prepared Date."),"warning");

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

                tr_("turnover.loadFailed","Unable to load data.")

            );

        }

        renderTable(result.items || []);

    }

    catch(err){

        console.error(err);

        notify(err.message || tr_("turnover.loadFailed","Unable to load data."),"error");

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
// SAFE HTML
// ========================================

function escapeHtml(text){
    const div=document.createElement("div");
    div.textContent=text == null ? "" : String(text);
    return div.innerHTML.replace(/"/g,"&quot;").replace(/'/g,"&#39;");
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

                <td>${escapeHtml(item.requestText)}</td>

                <td colspan="4">
                    ${escapeHtml(tr_("turnover.noData","No Data"))}
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

            <td class="tvr-td-turnover">

                <span class="tvr-bar"><i style="width:${Math.max(0,Math.min(100,turnover*100)).toFixed(1)}%"></i></span>

                <b>${(turnover*100).toFixed(2)}%</b>

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

            // raw values for the Excel export (real numbers, not text)

            debitN:debit,

            currentODN:currentOD,

            turnoverN:turnover,

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

    // TURNOVER average = the latest 3 months that have data (rows are
    // newest-first; "No Data" months are skipped).

    const recent3 = capturedRows.filter(r=>!r.noData).slice(0,3);

    const avgTurnover3N = recent3.length

        ? recent3.reduce((a,r)=>a+r.turnoverN,0)/recent3.length

        : null;

    const avgTurnoverText =

        avgTurnover3N===null ? "-" : (avgTurnover3N*100).toFixed(2)+"%";

    // Largest CURRENT_OD across the table, with its month.

    const maxODRow = capturedRows

        .filter(r=>!r.noData)

        .reduce((best,r)=>(!best || r.currentODN>best.currentODN) ? r : best,null);

    document.getElementById("avgDebit").innerHTML = avgDebitText;

    document.getElementById("avgOD").innerHTML = avgODText;

    document.getElementById("avgTurnover").innerHTML =

        avgTurnover3N===null ? "-" : `${avgTurnoverText} <small class="tvr-3m">3M</small>`;

    // --------------------------
    // Save for export (PDF/Excel read from here instead of
    // re-scraping the DOM table)
    // --------------------------

    lastTurnoverData = {

        rows:capturedRows,

        avgDebit:avgDebitText,

        avgOD:avgODText,

        avgTurnover:avgTurnoverText,

        avgDebitN:totalCount ? totalDebit/totalCount : null,

        avgODN:totalCount ? totalOD/totalCount : null,

        avgTurnoverN:avgTurnover3N,

        avgTurnoverMonths:recent3.map(r=>r.month),

        maxOD:maxODRow ? maxODRow.currentOD : "-",

        maxODN:maxODRow ? maxODRow.currentODN : null,

        maxODMonth:maxODRow ? maxODRow.month : "",

        customerName

    };

    renderSummary(totalCount,items.length);

    if(!totalCount){

        notify(tr_("turnover.noResult","No data found for this CIF."),"warning");

    }

}

// ========================================
// RESULT SUMMARY
// Name / CIF / date + average KPIs above the table. Exports stay
// disabled until there's at least one month with data.
// ========================================

function renderSummary(withData,total){

    const d=lastTurnoverData;

    const prepared=document.getElementById("preparedDate").value;

    let preparedText=prepared;

    if(prepared){

        const dt=new Date(prepared+"T00:00:00");

        if(!isNaN(dt)) preparedText=dt.toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"});

    }

    document.getElementById("tvrSumName").textContent=d.customerName || "-";

    document.getElementById("tvrSumCif").textContent=document.getElementById("inputCIF").value.trim() || "-";

    document.getElementById("tvrSumDate").textContent=preparedText || "-";

    document.getElementById("tvrCoverageNum").textContent=withData+"/"+total;

    document.getElementById("tvrCoverage").classList.toggle("is-partial",withData<total);

    document.getElementById("tvrCoverage").classList.toggle("is-none",!withData);

    document.getElementById("kpiTurnover").textContent=d.avgTurnover;

    document.getElementById("kpiTurnoverNote").textContent=d.avgTurnoverMonths.join(" · ");

    document.getElementById("kpiMaxOD").textContent=d.maxOD;

    document.getElementById("kpiMaxODNote").textContent=d.maxODMonth;

    document.getElementById("btnExcel").disabled=!withData;

    document.getElementById("btnPDF").disabled=!withData;

    document.getElementById("tvrSummary").hidden=false;

    document.getElementById("tvrTableCard").hidden=false;

    document.getElementById("tvrEmpty").hidden=true;

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

document.getElementById("tvrSummary").hidden=true;

document.getElementById("tvrTableCard").hidden=true;

document.getElementById("tvrEmpty").hidden=false;

document.getElementById("btnExcel").disabled=true;

document.getElementById("btnPDF").disabled=true;

}

// ========================================
// AUTO CLEAR WHEN CIF EMPTY
// ========================================

document
.getElementById("inputCIF")
.addEventListener(

"input",

function(){

document.getElementById("btnClearCIF").hidden=this.value==="";

if(this.value.trim()===""){

clearTable();

}

}

);

// ========================================
// CLEAR CIF (x button inside the input)
// ========================================

document
.getElementById("btnClearCIF")
.addEventListener(

"click",

function(){

const input=document.getElementById("inputCIF");

input.value="";

this.hidden=true;

clearTable();

input.focus();

}

);
// ========================================
// EXPORT META (shared by PDF + Excel)
// ========================================

function turnoverExportMeta(){

    const d=lastTurnoverData;

    const prepared=document.getElementById("preparedDate").value;

    const preparedDt=new Date(prepared+"T00:00:00");

    const preparedText=isNaN(preparedDt) ? prepared : CMExport.printedDate(preparedDt);

    const cif=document.getElementById("inputCIF").value.trim();

    const withData=d.rows.filter(r=>!r.noData).length;

    return {

        cif,

        customer:(d.customerName||document.getElementById("customerName").value||"-"),

        preparedText,

        preparedBy:CMExport.preparedBy(),

        printed:CMExport.printedDate(),

        withData,

        total:d.rows.length,

        fileBase:`Average_Debit_Turnover_${CMExport.safeFilePart(cif,"CIF")}_${prepared||new Date().toISOString().slice(0,10)}`

    };

}

function requireTurnoverData(){

    if(!lastTurnoverData.rows.length || !lastTurnoverData.rows.some(r=>!r.noData)){

        notify(tr_("turnover.noResult","No data found for this CIF."),"warning");

        return false;

    }

    return true;

}

// ========================================
// EXPORT PDF
// A4 portrait (jsPDF + autoTable): title + logo, customer/CIF block,
// summary box of the three averages, monthly table with "No Data"
// rows spanned, Average footer row, prepared-by + page x/y footer.
// ========================================

async function exportPDF(){

    if(!requireTurnoverData()) return;

    const d=lastTurnoverData;

    const m=turnoverExportMeta();

    const {jsPDF}=window.jspdf;

    const doc=new jsPDF("p","pt","a4");

    const pageW=doc.internal.pageSize.getWidth();

    const M=40;

    const NAVY=[14,27,60];

    const GOLD=[212,175,55];

    const MUTED=[107,114,128];

    // ---- header ----

    const logo=await CMExport.logo();

    if(logo){

        const lw=120;

        doc.addImage(logo.data,logo.type,pageW-M-lw,28,lw,lw*logo.ratio);

    }

    doc.setFont("helvetica","bold");

    doc.setFontSize(16);

    doc.setTextColor(...NAVY);

    doc.text("YEARLY AVERAGE OF DEBIT TURNOVER",M,52);

    doc.setFont("helvetica","normal");

    doc.setFontSize(10);

    doc.setTextColor(...MUTED);

    doc.text("Last 12 month-ends",M,68);

    doc.setDrawColor(...GOLD);

    doc.setLineWidth(1.5);

    doc.line(M,82,pageW-M,82);

    // ---- customer ----

    let y=100;

    doc.setFontSize(9);

    doc.setTextColor(...MUTED);

    doc.text("CUSTOMER NAME",M,y);

    doc.text("CIF",pageW-M-140,y);

    const name=CMExport.textToImage(m.customer,{size:14});

    doc.addImage(name.data,"PNG",M,y+4,Math.min(name.w,pageW-2*M-160),name.h*Math.min(1,(pageW-2*M-160)/name.w));

    doc.setFont("helvetica","bold");

    doc.setFontSize(13);

    doc.setTextColor(...NAVY);

    doc.text(m.cif||"-",pageW-M-140,y+18);

    y+=4+name.h+10;

    // ---- summary box ----

    const boxH=52;

    doc.setFillColor(246,248,252);

    doc.setDrawColor(226,230,237);

    doc.setLineWidth(.8);

    doc.roundedRect(M,y,pageW-2*M,boxH,6,6,"FD");

    const cells=[

        ["Average TURNOVER (latest 3 months)",d.avgTurnover,d.avgTurnoverMonths.join(", "),true],

        ["Largest CURRENT_OD",d.maxOD,d.maxODMonth,false],

        ["Months with data",`${m.withData} / ${m.total}`,"",false]

    ];

    // First tile gets more room for its longer label.
    const colX=[0,.42,.75].map(f=>M+14+f*(pageW-2*M));

    cells.forEach(([label,value,note,main],i)=>{

        const cx=colX[i];

        doc.setFont("helvetica","normal");

        doc.setFontSize(8.5);

        doc.setTextColor(...MUTED);

        doc.text(label.toUpperCase(),cx,y+18);

        doc.setFont("helvetica","bold");

        doc.setFontSize(main?15:13);

        doc.setTextColor(...(main?[184,144,30]:NAVY));

        doc.text(String(value),cx,y+36);

        if(note){

            doc.setFont("helvetica","normal");

            doc.setFontSize(8);

            doc.setTextColor(...MUTED);

            doc.text(note,cx,y+47);

        }

    });

    y+=boxH+18;

    // ---- table ----

    const body=d.rows.map(r=>r.noData

        ? [r.month,{content:"No Data",colSpan:4,styles:{halign:"center",fontStyle:"italic",textColor:[154,116,0],fillColor:[255,248,225]}}]

        : [r.month,r.debit,r.currentOD,r.turnover,r.effectiveDate]);

    const numW=(pageW-2*M-80-90)/3;

    doc.autoTable({

        startY:y,

        margin:{left:M,right:M,bottom:50},

        head:[["Month","AMT_IN","CURRENT_OD","TURNOVER","Effective Date"]],

        body,

        foot:[["Average",d.avgDebit,d.avgOD,`${d.avgTurnover} *`,""]],

        theme:"grid",

        styles:{fontSize:10,cellPadding:{top:5,bottom:5,left:6,right:6},halign:"right",lineColor:[226,230,237],lineWidth:.5,textColor:[28,35,51]},

        headStyles:{fillColor:NAVY,textColor:[255,215,0],fontStyle:"bold",halign:"right"},

        footStyles:{fillColor:[248,240,214],textColor:NAVY,fontStyle:"bold",halign:"right"},

        alternateRowStyles:{fillColor:[246,248,252]},

        columnStyles:{0:{halign:"left",cellWidth:80,fontStyle:"bold"},1:{cellWidth:numW},2:{cellWidth:numW},3:{cellWidth:numW},4:{halign:"center",cellWidth:90}},

        didParseCell:data=>{

            if(data.section!=="body"){

                if(data.column.index===0) data.cell.styles.halign="left";

                if(data.column.index===4) data.cell.styles.halign="center";

            }

        }

    });

    doc.setFont("helvetica","normal");

    doc.setFontSize(8.5);

    doc.setTextColor(...MUTED);

    let ny=doc.lastAutoTable.finalY+16;

    doc.text("Averages use months with data only.",M,ny);

    doc.text(`* TURNOVER average = latest 3 months with data (${d.avgTurnoverMonths.join(", ")}).`,M,ny+12);

    // ---- signature block (bottom-right of the table) ----
    // Blank space for a handwritten signature, then Prepared By/Date.

    const sigW=190, sigX=pageW-M-sigW;

    let sy=ny+30;

    const pageH=doc.internal.pageSize.getHeight();

    if(sy+95>pageH-50){ doc.addPage(); sy=60; }

    doc.setFontSize(9);

    doc.setTextColor(...MUTED);

    doc.text("Signature",sigX+sigW/2,sy,{align:"center"});

    doc.setDrawColor(150,150,150);

    doc.setLineWidth(.6);

    doc.line(sigX,sy+50,sigX+sigW,sy+50);

    doc.setFont("helvetica","bold");

    doc.setFontSize(10);

    doc.setTextColor(...NAVY);

    doc.text(`Prepared By : ${m.preparedBy}`,sigX,sy+68);

    doc.setFont("helvetica","normal");

    doc.text(`Prepared Date : ${m.preparedText}`,sigX,sy+84);

    CMExport.pdfFooter(doc,{margin:M,showPreparedBy:false,printed:m.printed});

    doc.save(`${m.fileBase}.pdf`);

}

// ========================================
// EXPORT EXCEL
// xlsx-js-style (SheetJS fork that writes cell styles): title bar,
// info block, styled header, numeric cells with number/percent
// formats, "No Data" rows merged, AVERAGE() formulas in the footer.
// ========================================

function exportExcel(){

    if(!requireTurnoverData()) return;

    const d=lastTurnoverData;

    const m=turnoverExportMeta();

    const NAVY="0E1B3C", GOLD="D4AF37", LIGHT="F6F8FC", BORDER="D9DEE7";

    const thin={style:"thin",color:{rgb:BORDER}};

    const box={top:thin,bottom:thin,left:thin,right:thin};

    const money="#,##0.00", pct="0.00%";

    const ws={};

    const merges=[];

    const put=(r,col,v,s,extra={})=>{

        const cell={v,t:typeof v==="number"?"n":"s",s,...extra};

        if(cell.f) cell.t="n";

        ws[XLSX.utils.encode_cell({r,c:col})]=cell;

    };

    // Title + subtitle

    put(0,0,"YEARLY AVERAGE OF DEBIT TURNOVER",{font:{bold:true,sz:15,color:{rgb:"FFFFFF"}},fill:{fgColor:{rgb:NAVY}},alignment:{horizontal:"center",vertical:"center"}});

    for(let col=1;col<5;col++) put(0,col,"",{fill:{fgColor:{rgb:NAVY}}});

    merges.push({s:{r:0,c:0},e:{r:0,c:4}});

    put(1,0,"Last 12 month-ends",{font:{italic:true,sz:10,color:{rgb:"6B7280"}},alignment:{horizontal:"center"}});

    merges.push({s:{r:1,c:0},e:{r:1,c:4}});

    // Info block

    const labelS={font:{bold:true,sz:10,color:{rgb:"374151"}},fill:{fgColor:{rgb:LIGHT}},border:box};

    const valS={font:{sz:10,color:{rgb:NAVY}},border:box,alignment:{horizontal:"left"}};

    const info=[

        ["Customer Name",m.customer,"Avg TURNOVER (latest 3M)",d.avgTurnoverN],

        ["CIF",m.cif||"-","Largest CURRENT_OD",d.maxODN],

        ["Months with data",`${m.withData} / ${m.total}`,"Printed",m.printed]

    ];

    info.forEach((row,i)=>{

        const r=3+i;

        put(r,0,row[0],labelS);

        put(r,1,row[1],{...valS,font:{bold:i<2,sz:10,color:{rgb:NAVY}}});

        put(r,2,row[2],labelS);

        const v3=row[3]??"-";

        const isPct=i===0, isNum=typeof v3==="number";

        put(r,3,v3,isNum?{...valS,numFmt:isPct?pct:money,font:{bold:true,sz:10,color:{rgb:isPct?"B8901E":NAVY}},alignment:{horizontal:"left"}}:valS);

        put(r,4,"",valS);

        merges.push({s:{r,c:3},e:{r,c:4}});

    });

    // Header

    const hr=3+info.length+1;

    const headS={font:{bold:true,sz:10,color:{rgb:"FFD700"}},fill:{fgColor:{rgb:NAVY}},border:box,alignment:{horizontal:"center",vertical:"center"}};

    ["Month","AMT_IN","CURRENT_OD","TURNOVER","Effective Date"].forEach((h,col)=>put(hr,col,h,headS));

    // Rows

    d.rows.forEach((row,i)=>{

        const r=hr+1+i;

        const fill=i%2 ? {fill:{fgColor:{rgb:LIGHT}}} : {};

        put(r,0,row.month,{border:box,font:{bold:true,sz:10,color:{rgb:NAVY}},...fill});

        if(row.noData){

            const nd={border:box,font:{italic:true,sz:10,color:{rgb:"9A7400"}},fill:{fgColor:{rgb:"FFF8E1"}},alignment:{horizontal:"center"}};

            put(r,1,"No Data",nd);

            for(let col=2;col<5;col++) put(r,col,"",nd);

            merges.push({s:{r,c:1},e:{r,c:4}});

            return;

        }

        put(r,1,row.debitN,{border:box,numFmt:money,font:{sz:10},...fill});

        put(r,2,row.currentODN,{border:box,numFmt:money,font:{sz:10},...fill});

        put(r,3,row.turnoverN,{border:box,numFmt:pct,font:{sz:10},...fill});

        put(r,4,row.effectiveDate,{border:box,alignment:{horizontal:"center"},font:{sz:10},...fill});

    });

    // Average row: AVERAGE() skips the merged "No Data" text cells, same
    // as the on-screen average (months with data only).

    const first=hr+2, last=hr+1+d.rows.length;

    const ar=hr+1+d.rows.length;

    const avS={font:{bold:true,sz:10,color:{rgb:NAVY}},fill:{fgColor:{rgb:"F8F0D6"}},alignment:{horizontal:"right"},border:{...box,top:{style:"medium",color:{rgb:GOLD}}}};

    put(ar,0,"Average",{...avS,alignment:{horizontal:"left"}});

    put(ar,1,d.avgDebitN??0,{...avS,numFmt:money},{f:`AVERAGE(B${first}:B${last})`});

    put(ar,2,d.avgODN??0,{...avS,numFmt:money},{f:`AVERAGE(C${first}:C${last})`});

    // TURNOVER average = latest 3 months with data → average exactly those cells.

    const recentRefs=d.rows.map((row,i)=>row.noData?null:`D${hr+2+i}`).filter(Boolean).slice(0,3);

    put(ar,3,d.avgTurnoverN??0,{...avS,numFmt:pct},recentRefs.length?{f:`AVERAGE(${recentRefs.join(",")})`}:{});

    put(ar,4,"",avS);

    const noteS={font:{italic:true,sz:9,color:{rgb:"6B7280"}}};

    put(ar+1,0,"Averages use months with data only.",noteS);

    merges.push({s:{r:ar+1,c:0},e:{r:ar+1,c:4}});

    put(ar+2,0,`TURNOVER average = latest 3 months with data (${d.avgTurnoverMonths.join(", ")}).`,noteS);

    merges.push({s:{r:ar+2,c:0},e:{r:ar+2,c:4}});

    // Signature block, bottom-right (D:E): blank rows for a handwritten
    // signature, a line, then Prepared By / Prepared Date.

    const sr=ar+4;

    put(sr,3,"Signature",{font:{sz:9,color:{rgb:"6B7280"}},alignment:{horizontal:"center"}});

    merges.push({s:{r:sr,c:3},e:{r:sr,c:4}});

    const lineRow=sr+4;

    put(lineRow,3,"",{border:{bottom:{style:"thin",color:{rgb:"888888"}}}});

    put(lineRow,4,"",{border:{bottom:{style:"thin",color:{rgb:"888888"}}}});

    put(lineRow+1,3,`Prepared By : ${m.preparedBy}`,{font:{bold:true,sz:10,color:{rgb:NAVY}}});

    merges.push({s:{r:lineRow+1,c:3},e:{r:lineRow+1,c:4}});

    put(lineRow+2,3,`Prepared Date : ${m.preparedText}`,{font:{sz:10,color:{rgb:NAVY}}});

    merges.push({s:{r:lineRow+2,c:3},e:{r:lineRow+2,c:4}});

    ws["!ref"]=XLSX.utils.encode_range({s:{r:0,c:0},e:{r:lineRow+2,c:4}});

    ws["!merges"]=merges;

    ws["!cols"]=[{wch:18},{wch:24},{wch:18},{wch:18},{wch:18}];

    ws["!rows"]=[{hpt:28},{hpt:18}];

    for(let r=sr+1;r<lineRow;r++) ws["!rows"][r]={hpt:20};

    ws["!margins"]={left:0.4,right:0.4,top:0.5,bottom:0.5,header:0.2,footer:0.2};

    const wb=XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(wb,ws,"Turnover");

    XLSX.writeFile(wb,`${m.fileBase}.xlsx`);

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
