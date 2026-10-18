// =========================
// Helpers
// =========================

function format(num){

    return num.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});

}

function lt(key,vars,fallback){

    if(window.CMI18n && typeof CMI18n.t==="function"){

        const v=CMI18n.t(key,vars);

        if(v && v!==key) return v;

    }

    return fallback;

}

function escapeHtml(text){

    return String(text==null?"":text)
        .replace(/&/g,"&amp;")
        .replace(/</g,"&lt;")
        .replace(/>/g,"&gt;")
        .replace(/"/g,"&quot;");

}

// toast.js declares CMToast as a top-level const (not on window), so
// check it with typeof; fall back to alert() only if it's missing.
function lcNotify(message,type="warning"){

    if(typeof CMToast!=="undefined" && typeof CMToast.show==="function"){

        CMToast.show({ type, title:message, message:"", duration:3500 });

    }else{

        alert(message);

    }

}

// =========================
// State
// =========================

// Which of the three linked fields is computed from the other two.
let solveFor="periodicRepayment";

// Last successful calculation — the on-screen schedule and both
// exports are built from this, never by re-reading the DOM table.
let lastCalc=null;

const SOLVE_FIELDS=["periodicRepayment","loanAmount","term"];

const SCHEDULE_PREVIEW_ROWS=12;

let scheduleExpanded=false;

// =========================
// Solve-for / method controls
// =========================

function setSolveFor(field){

    solveFor=field;

    document.querySelectorAll("#solveFor .seg-btn").forEach(b=>{

        const on=b.dataset.field===field;

        b.classList.toggle("active",on);

        b.setAttribute("aria-pressed",on?"true":"false");

    });

    SOLVE_FIELDS.forEach(id=>{

        const input=document.getElementById(id);

        const group=input.closest(".form-group");

        const solved=id===field;

        input.readOnly=solved;

        input.tabIndex=solved?-1:0;

        group.classList.toggle("is-solved",solved);

        if(solved){

            input.value="";

            input.placeholder=lt("loanCalculate.autoPlaceholder",null,"Calculated automatically");

        }else{

            input.placeholder="";

        }

    });

    if(lastCalc) calculateLoan({silent:true});

}

function setMethod(method){

    document.getElementById("paymentMethod").value=method;

    document.querySelectorAll("#methodSeg .seg-btn").forEach(b=>{

        const on=b.dataset.method===method;

        b.classList.toggle("active",on);

        b.setAttribute("aria-pressed",on?"true":"false");

    });

    if(lastCalc) calculateLoan({silent:true});

}

function methodLabel(method){

    return method==="Annuity"

        ? lt("loanCalculate.methodAnnuity",null,"Fixed (Annuity)")

        : lt("loanCalculate.methodLinear",null,"Declining (Linear)");

}

// =========================
// Calculate
// =========================

function readNum(id){

    const v=document.getElementById(id).value;

    return v==="" ? NaN : parseFloat(v);

}

// Live recalcs (opts.silent) don't toast; if the inputs stop forming a
// valid loan, the previous result is dimmed and exports are disabled
// so a stale schedule can't be mistaken for the current one.
function calculateLoan(opts={}){

    const ok=computeLoan(opts);

    const card=document.getElementById("resultCard");

    if(lastCalc){

        card.classList.toggle("is-stale",!ok);

        document.getElementById("scheduleCard").classList.toggle("is-stale",!ok);

        document.getElementById("btnPDF").disabled=!ok;

        document.getElementById("btnExcel").disabled=!ok;

    }

    return ok;

}

function computeLoan(opts={}){

    const silent=!!opts.silent;

    const customerName=document.getElementById("customerName").value.trim();

    const method=document.getElementById("paymentMethod").value;

    const interestRate=readNum("interestRate");

    let loanVal=solveFor==="loanAmount" ? NaN : readNum("loanAmount");

    let payVal=solveFor==="periodicRepayment" ? NaN : readNum("periodicRepayment");

    let months=solveFor==="term" ? NaN : readNum("term");

    // ---- validation ----

    const need=[];

    if(solveFor!=="loanAmount" && !(loanVal>0)) need.push(lt("loanCalculate.loanAmountLabel",null,"Loan Amount"));

    if(solveFor!=="periodicRepayment" && !(payVal>0)) need.push(lt("loanCalculate.periodicRepaymentLabel",null,"Periodic Repayment"));

    if(solveFor!=="term" && !(months>0)) need.push(lt("loanCalculate.termLabel",null,"Loan Term (months)"));

    if(isNaN(interestRate) || interestRate<0) need.push(lt("loanCalculate.interestRateLabel",null,"Annual Interest Rate (%)"));

    if(need.length){

        if(!silent){

            lcNotify(lt("loanCalculate.needFields",{fields:need.join(", ")},`Please fill in: ${need.join(", ")}`));

        }

        return false;

    }

    if(solveFor!=="term") months=Math.round(months);

    const rate=(interestRate/100)/12;

    // ---- solve the missing value ----

    if(solveFor==="loanAmount"){

        if(rate===0){

            loanVal=payVal*months;

        }else{

            loanVal=method==="Annuity"

                ? payVal*(1-Math.pow(1+rate,-months))/rate

                : payVal/((1/months)+rate);

        }

    }else if(solveFor==="periodicRepayment"){

        if(rate===0){

            payVal=loanVal/months;

        }else{

            payVal=method==="Annuity"

                ? (loanVal*rate)/(1-Math.pow(1+rate,-months))

                : (loanVal/months)+(loanVal*rate);

        }

    }else{

        if(rate===0){

            months=Math.ceil(loanVal/payVal);

        }else if(method==="Annuity"){

            if(payVal<=loanVal*rate){

                if(!silent) lcNotify(lt("loanCalculate.payTooSmall",{min:format(loanVal*rate)},`Repayment must be more than ${format(loanVal*rate)} (the first month's interest).`),"error");

                return false;

            }

            months=Math.ceil(Math.log(payVal/(payVal-loanVal*rate))/Math.log(1+rate));

        }else{

            // Linear: first payment = P/n + P*r  →  n = P / (pay - P*r)

            if(payVal<=loanVal*rate){

                if(!silent) lcNotify(lt("loanCalculate.payTooSmall",{min:format(loanVal*rate)},`Repayment must be more than ${format(loanVal*rate)} (the first month's interest).`),"error");

                return false;

            }

            months=Math.ceil(loanVal/(payVal-loanVal*rate));

        }

    }

    if(!isFinite(loanVal) || !isFinite(payVal) || !(months>0) || months>600){

        if(!silent) lcNotify(lt("loanCalculate.invalidResult",null,"These values can't produce a valid schedule."),"error");

        return false;

    }

    // ---- build schedule ----

    let balance=loanVal;

    let totalPrincipal=0, totalInterest=0, totalPayment=0;

    const rows=[];

    for(let i=1;i<=months;i++){

        const interest=balance*rate;

        let principal=method==="Annuity" ? payVal-interest : loanVal/months;

        // Last instalment clears whatever is left (a solved term is
        // rounded up, so the final payment is usually smaller).
        if(i===months || principal>balance) principal=balance;

        const payment=principal+interest;

        balance-=principal;

        if(balance<0.005) balance=0;

        totalPrincipal+=principal;

        totalInterest+=interest;

        totalPayment+=payment;

        rows.push({no:i,principal,interest,payment,balance});

    }

    lastCalc={

        customerName,

        method,

        interestRate,

        loanVal,

        payVal,

        months,

        rows,

        totalPrincipal,

        totalInterest,

        totalPayment

    };

    // Show the solved value in its (read-only) field.

    const solvedEl=document.getElementById(solveFor);

    solvedEl.value=solveFor==="term" ? String(months) : (Math.round((solveFor==="loanAmount"?loanVal:payVal)*100)/100).toString();

    renderResult();

    if(!silent){

        document.getElementById("resultCard").scrollIntoView({behavior:"smooth",block:"start"});

    }

    return true;

}

// =========================
// Render result + schedule
// =========================

function renderResult(){

    const c=lastCalc;

    if(!c) return;

    const card=document.getElementById("resultCard");

    card.hidden=false;

    document.getElementById("scheduleCard").hidden=false;

    document.getElementById("resName").textContent=c.customerName||"-";

    document.getElementById("resMethod").textContent=methodLabel(c.method)+" • "+c.interestRate+"%";

    // Hero = whatever was solved.

    let heroLabel, heroValue, heroNote="";

    if(solveFor==="loanAmount"){

        heroLabel=lt("loanCalculate.loanAmountLabel",null,"Loan Amount");

        heroValue=format(c.loanVal);

    }else if(solveFor==="term"){

        heroLabel=lt("loanCalculate.termLabel",null,"Loan Term (months)");

        heroValue=lt("loanCalculate.monthsValue",{n:c.months},`${c.months} months`);

    }else{

        heroLabel=lt("loanCalculate.periodicRepaymentLabel",null,"Periodic Repayment");

        heroValue=format(c.payVal);

    }

    if(c.method==="Linear" && c.rows.length){

        heroNote=lt("loanCalculate.linearNote",{first:format(c.rows[0].payment),last:format(c.rows[c.rows.length-1].payment)},`1st ${format(c.rows[0].payment)} → last ${format(c.rows[c.rows.length-1].payment)}`);

    }

    document.getElementById("resHeroLabel").textContent=heroLabel;

    document.getElementById("resHeroValue").textContent=heroValue;

    document.getElementById("resHeroNote").textContent=heroNote;

    document.getElementById("kpiLoan").textContent=format(c.loanVal);

    document.getElementById("kpiTerm").textContent=lt("loanCalculate.monthsValue",{n:c.months},`${c.months} months`);

    document.getElementById("kpiInterest").textContent=format(c.totalInterest);

    document.getElementById("kpiTotal").textContent=format(c.totalPayment);

    const pPct=c.totalPayment>0 ? (c.totalPrincipal/c.totalPayment)*100 : 100;

    document.getElementById("splitPrincipal").style.width=pPct.toFixed(1)+"%";

    document.getElementById("splitPrincipalPct").textContent=pPct.toFixed(1)+"%";

    document.getElementById("splitInterestPct").textContent=(100-pPct).toFixed(1)+"%";

    document.getElementById("btnPDF").disabled=false;

    document.getElementById("btnExcel").disabled=false;

    renderSchedule();

}

function renderSchedule(){

    const c=lastCalc;

    const showAll=scheduleExpanded || c.rows.length<=SCHEDULE_PREVIEW_ROWS+3;

    const visible=showAll ? c.rows : c.rows.slice(0,SCHEDULE_PREVIEW_ROWS);

    let html=`<div class="table-scroll"><table class="schedule-table"><thead><tr>
        <th>${escapeHtml(lt("loanCalculate.colNo",null,"No"))}</th>
        <th>${escapeHtml(lt("loanCalculate.colPrincipal",null,"Principal"))}</th>
        <th>${escapeHtml(lt("loanCalculate.colInterest",null,"Interest"))}</th>
        <th>${escapeHtml(lt("loanCalculate.colPayment",null,"Total Payment"))}</th>
        <th>${escapeHtml(lt("loanCalculate.colBalance",null,"Balance"))}</th>
        </tr></thead><tbody>`;

    visible.forEach(r=>{

        html+=`<tr>
            <td>${r.no}</td>
            <td>${format(r.principal)}</td>
            <td>${format(r.interest)}</td>
            <td>${format(r.payment)}</td>
            <td>${format(r.balance)}</td>
        </tr>`;

    });

    html+=`</tbody><tfoot><tr class="total-row">
        <td>${escapeHtml(lt("loanCalculate.total",null,"Total"))}</td>
        <td>${format(c.totalPrincipal)}</td>
        <td>${format(c.totalInterest)}</td>
        <td>${format(c.totalPayment)}</td>
        <td>-</td>
    </tr></tfoot></table></div>`;

    if(!showAll){

        html+=`<button type="button" class="show-all-btn" id="btnShowAll">${escapeHtml(lt("loanCalculate.showAll",{n:c.rows.length},`Show all ${c.rows.length} months`))}</button>`;

    }

    document.getElementById("exportSection").innerHTML=html;

    document.getElementById("scheduleCount").textContent=lt("loanCalculate.monthsValue",{n:c.rows.length},`${c.rows.length} months`);

    const btn=document.getElementById("btnShowAll");

    if(btn){

        btn.addEventListener("click",()=>{

            scheduleExpanded=true;

            renderSchedule();

        });

    }

}

// =========================
// Export helpers (shared by PDF + Excel)
// =========================

function requireCalc(){

    if(!lastCalc){

        lcNotify(lt("loanCalculate.calcFirst",null,"Please calculate before exporting."));

        return false;

    }

    return true;

}

function exportMeta(){

    const c=lastCalc;

    const preparedBy=CMExport.preparedBy();

    const now=new Date();

    const printed=CMExport.printedDate(now);

    const stamp=now.toISOString().slice(0,10);

    const safeName=CMExport.safeFilePart(c.customerName,"Customer");

    const firstPay=c.rows.length ? c.rows[0].payment : c.payVal;

    const lastPay=c.rows.length ? c.rows[c.rows.length-1].payment : c.payVal;

    return {

        preparedBy,

        printed,

        fileBase:`Repayment_Schedule_${safeName}_${stamp}`,

        methodText:c.method==="Annuity" ? "Fixed (Annuity)" : "Declining (Linear)",

        firstPay,

        lastPay

    };

}

// =========================
// Export PDF
// A4 portrait: header (title + logo), summary box, schedule table with
// repeating header and a total row, footer with prepared-by + page x/y.
// =========================

async function exportToPDF(){

    if(!requireCalc()) return;

    const c=lastCalc;

    const m=exportMeta();

    const {jsPDF}=window.jspdf;

    const doc=new jsPDF("p","pt","a4");

    const pageW=doc.internal.pageSize.getWidth();

    const pageH=doc.internal.pageSize.getHeight();

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

    doc.setFontSize(17);

    doc.setTextColor(...NAVY);

    doc.text("LOAN REPAYMENT SCHEDULE",M,52);

    doc.setFont("helvetica","normal");

    doc.setFontSize(10);

    doc.setTextColor(...MUTED);

    doc.text(`${m.methodText}  •  ${c.interestRate}% per year  •  ${c.months} months`,M,68);

    doc.setDrawColor(...GOLD);

    doc.setLineWidth(1.5);

    doc.line(M,82,pageW-M,82);

    // ---- customer + summary box ----

    let y=100;

    doc.setFontSize(9);

    doc.setTextColor(...MUTED);

    doc.text("CUSTOMER NAME",M,y);

    const name=CMExport.textToImage(c.customerName||"-",{size:14});

    doc.addImage(name.data,"PNG",M,y+4,name.w,name.h);

    y+=4+name.h+10;

    const boxH=78;

    doc.setFillColor(246,248,252);

    doc.setDrawColor(226,230,237);

    doc.setLineWidth(.8);

    doc.roundedRect(M,y,pageW-2*M,boxH,6,6,"FD");

    const repaymentLabel=c.method==="Annuity" ? "Monthly Repayment" : "1st / Last Repayment";

    const repaymentValue=c.method==="Annuity" ? format(c.payVal) : `${format(m.firstPay)} / ${format(m.lastPay)}`;

    const cells=[

        ["Loan Amount",format(c.loanVal)],

        ["Loan Term",`${c.months} months`],

        ["Annual Interest Rate",`${c.interestRate}%`],

        [repaymentLabel,repaymentValue],

        ["Total Interest",format(c.totalInterest)],

        ["Total Payment",format(c.totalPayment)]

    ];

    const colW=(pageW-2*M)/3;

    cells.forEach(([label,value],i)=>{

        const cx=M+14+(i%3)*colW;

        const cy=y+22+Math.floor(i/3)*34;

        doc.setFont("helvetica","normal");

        doc.setFontSize(8.5);

        doc.setTextColor(...MUTED);

        doc.text(label.toUpperCase(),cx,cy);

        doc.setFont("helvetica","bold");

        doc.setFontSize(12);

        doc.setTextColor(...NAVY);

        doc.text(value,cx,cy+15);

    });

    y+=boxH+18;

    // ---- schedule ----

    doc.autoTable({

        startY:y,

        margin:{left:M,right:M,bottom:50},

        head:[["No","Principal","Interest","Total Payment","Balance"]],

        body:c.rows.map(r=>[r.no,format(r.principal),format(r.interest),format(r.payment),format(r.balance)]),

        foot:[["Total",format(c.totalPrincipal),format(c.totalInterest),format(c.totalPayment),""]],

        showHead:"everyPage",

        showFoot:"lastPage",

        theme:"grid",

        styles:{fontSize:9.5,cellPadding:{top:3.5,bottom:3.5,left:6,right:6},halign:"right",lineColor:[226,230,237],lineWidth:.5,textColor:[28,35,51]},

        headStyles:{fillColor:NAVY,textColor:[255,215,0],fontStyle:"bold",halign:"right"},

        footStyles:{fillColor:[248,240,214],textColor:NAVY,fontStyle:"bold",halign:"right"},

        alternateRowStyles:{fillColor:[246,248,252]},

        columnStyles:(()=>{

            const numW=(pageW-2*M-40)/4;

            return {0:{halign:"center",cellWidth:40},1:{cellWidth:numW},2:{cellWidth:numW},3:{cellWidth:numW},4:{cellWidth:numW}};

        })(),

        didParseCell:data=>{

            if(data.column.index===0 && data.section!=="body") data.cell.styles.halign="center";

        }

    });

    CMExport.pdfFooter(doc,{margin:M,preparedBy:m.preparedBy,printed:m.printed});

    doc.save(`${m.fileBase}.pdf`);

}

// =========================
// Export Excel
// Uses xlsx-js-style (SheetJS fork that writes cell styles): colored
// title/header, bordered table, number formats, SUM totals, print setup.
// =========================

function exportToExcel(){

    if(!requireCalc()) return;

    const c=lastCalc;

    const m=exportMeta();

    const NAVY="0E1B3C", GOLD="D4AF37", LIGHT="F6F8FC", BORDER="D9DEE7";

    const thin={style:"thin",color:{rgb:BORDER}};

    const box={top:thin,bottom:thin,left:thin,right:thin};

    const money="#,##0.00";

    const ws={};

    const merges=[];

    const put=(r,col,v,s,extra={})=>{

        const cell={v,t:typeof v==="number"?"n":"s",s,...extra};

        if(cell.f) cell.t="n";

        ws[XLSX.utils.encode_cell({r,c:col})]=cell;

    };

    // Title + subtitle

    put(0,0,"LOAN REPAYMENT SCHEDULE",{font:{bold:true,sz:15,color:{rgb:"FFFFFF"}},fill:{fgColor:{rgb:NAVY}},alignment:{horizontal:"center",vertical:"center"}});

    for(let col=1;col<5;col++) put(0,col,"",{fill:{fgColor:{rgb:NAVY}}});

    merges.push({s:{r:0,c:0},e:{r:0,c:4}});

    put(1,0,`${m.methodText}  •  ${c.interestRate}% per year  •  ${c.months} months`,{font:{italic:true,sz:10,color:{rgb:"6B7280"}},alignment:{horizontal:"center"}});

    merges.push({s:{r:1,c:0},e:{r:1,c:4}});

    // Info block (label | value) x 2 columns

    const labelS={font:{bold:true,sz:10,color:{rgb:"374151"}},fill:{fgColor:{rgb:LIGHT}},border:box,alignment:{vertical:"center"}};

    const valS={font:{sz:10,color:{rgb:NAVY}},border:box,alignment:{horizontal:"right",vertical:"center"}};

    const valMoney={...valS,numFmt:money,font:{bold:true,sz:10,color:{rgb:NAVY}}};

    const info=[

        ["Customer Name",c.customerName||"-","Prepared By",m.preparedBy],

        ["Loan Amount",c.loanVal,"Printed",m.printed],

        ["Loan Term (months)",c.months,"Repayment Method",m.methodText],

        ["Annual Interest Rate",`${c.interestRate}%`,c.method==="Annuity"?"Monthly Repayment":"1st Repayment",c.method==="Annuity"?c.payVal:m.firstPay],

        ["Total Interest",c.totalInterest,"Total Payment",c.totalPayment]

    ];

    // Layout: A=label, B=value, C=spacer-less label, D:E merged value

    info.forEach((row,i)=>{

        const r=3+i;

        put(r,0,row[0],labelS);

        // Customer name reads left; every other value is a number/rate → right.
        put(r,1,row[1],typeof row[1]==="number"&&row[0]!=="Loan Term (months)"?valMoney:{...valS,alignment:{horizontal:i===0?"left":"right"}});

        put(r,2,row[2],labelS);

        put(r,3,row[3],typeof row[3]==="number"?valMoney:{...valS,alignment:{horizontal:"left"}});

        put(r,4,"",valS);

        merges.push({s:{r,c:3},e:{r,c:4}});

    });

    // Schedule header

    const hr=3+info.length+1;

    const headS={font:{bold:true,sz:10,color:{rgb:"FFD700"}},fill:{fgColor:{rgb:NAVY}},border:box,alignment:{horizontal:"center",vertical:"center"}};

    ["No","Principal","Interest","Total Payment","Balance"].forEach((h,col)=>put(hr,col,h,headS));

    // Rows

    c.rows.forEach((row,i)=>{

        const r=hr+1+i;

        const fill=i%2 ? {fill:{fgColor:{rgb:LIGHT}}} : {};

        const numS={border:box,numFmt:money,font:{sz:10},...fill};

        put(r,0,row.no,{border:box,alignment:{horizontal:"center"},font:{sz:10,color:{rgb:"6B7280"}},...fill});

        put(r,1,row.principal,numS);

        put(r,2,row.interest,numS);

        put(r,3,row.payment,numS);

        put(r,4,row.balance,numS);

    });

    // Total row with live SUM formulas

    const first=hr+2, last=hr+1+c.rows.length;   // 1-based Excel rows

    const tr=hr+1+c.rows.length;

    const totS={font:{bold:true,sz:10,color:{rgb:NAVY}},fill:{fgColor:{rgb:"F8F0D6"}},numFmt:money,alignment:{horizontal:"right"},border:{...box,top:{style:"medium",color:{rgb:GOLD}}}};

    put(tr,0,"Total",{...totS,alignment:{horizontal:"center"}});

    put(tr,1,c.totalPrincipal,totS,{f:`SUM(B${first}:B${last})`});

    put(tr,2,c.totalInterest,totS,{f:`SUM(C${first}:C${last})`});

    put(tr,3,c.totalPayment,totS,{f:`SUM(D${first}:D${last})`});

    put(tr,4,"",totS);

    ws["!ref"]=XLSX.utils.encode_range({s:{r:0,c:0},e:{r:tr,c:4}});

    ws["!merges"]=merges;

    ws["!cols"]=[{wch:22},{wch:18},{wch:20},{wch:18},{wch:18}];

    ws["!rows"]=[{hpt:28},{hpt:18}];

    // Print: fit to one page wide, repeat header row on every printed page.

    ws["!margins"]={left:0.4,right:0.4,top:0.5,bottom:0.5,header:0.2,footer:0.2};

    const wb=XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(wb,ws,"Repayment Schedule");

    wb.Workbook={ Names:[{ Name:"_xlnm.Print_Titles", Sheet:0, Ref:`'Repayment Schedule'!$${hr+1}:$${hr+1}` }] };

    XLSX.writeFile(wb,`${m.fileBase}.xlsx`);

}

// =========================
// Init
// =========================

window.addEventListener("DOMContentLoaded",()=>{

    document.getElementById("btnCalculate").addEventListener("click",()=>calculateLoan());

    document.getElementById("btnPDF").addEventListener("click",exportToPDF);

    document.getElementById("btnExcel").addEventListener("click",exportToExcel);

    document.querySelectorAll("#solveFor .seg-btn").forEach(b=>{

        b.addEventListener("click",()=>setSolveFor(b.dataset.field));

    });

    document.querySelectorAll("#methodSeg .seg-btn").forEach(b=>{

        b.addEventListener("click",()=>setMethod(b.dataset.method));

    });

    document.querySelectorAll(".term-chip").forEach(chip=>{

        chip.addEventListener("click",()=>{

            if(solveFor==="term") return;

            document.getElementById("term").value=chip.dataset.term;

            if(lastCalc) calculateLoan({silent:true});

        });

    });

    // Once there's a result, keep it in sync as the inputs change.

    ["customerName","loanAmount","periodicRepayment","term","interestRate"].forEach(id=>{

        const el=document.getElementById(id);

        el.addEventListener("input",()=>{

            if(el.readOnly) return;

            if(lastCalc){

                scheduleExpanded=false;

                calculateLoan({silent:true});

            }

        });

        el.addEventListener("keydown",e=>{

            if(e.key==="Enter"){

                e.preventDefault();

                calculateLoan();

            }

        });

    });

    setSolveFor(solveFor);

    setMethod(document.getElementById("paymentMethod").value||"Linear");

});
