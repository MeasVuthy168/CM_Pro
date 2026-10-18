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
// Export PDF
// =========================

function requireCalc(){

    if(!lastCalc){

        lcNotify(lt("loanCalculate.calcFirst",null,"Please calculate before exporting."));

        return false;

    }

    return true;

}

async function exportToPDF(){

    if(!requireCalc()) return;

    const c=lastCalc;

    const {jsPDF}=window.jspdf;

    const doc=new jsPDF('p','pt','a4');

    doc.setFontSize(15);

    doc.setFont(undefined,'bold');

    doc.text("Repayment Schedule",40,40);

    doc.setFont(undefined,'normal');

    doc.setFontSize(11);

    doc.setTextColor(40,40,40);

    doc.text(`Customer Name : ${c.customerName||"-"}`,40,62);

    doc.autoTable({

        startY:80,

        head:[["Item","Value"]],

        body:[

            ["Loan Amount",format(c.loanVal)],

            ["Periodic Repayment",format(c.payVal)],

            ["Loan Term (months)",String(c.months)],

            ["Annual Interest Rate",`${c.interestRate}%`],

            ["Repayment Method",c.method==="Annuity"?"Annuity":"Linear"]

        ],

        showHead:false,

        styles:{fontSize:10,halign:'left'},

        columnStyles:{0:{fontStyle:'bold',fillColor:[13,45,92],textColor:255}}

    });

    doc.autoTable({

        startY:doc.lastAutoTable.finalY+20,

        head:[["No","Principal","Interest","Total Payment","Balance"]],

        body:c.rows.map(r=>[r.no,format(r.principal),format(r.interest),format(r.payment),format(r.balance)]),

        foot:[["Total",format(c.totalPrincipal),format(c.totalInterest),format(c.totalPayment),"-"]],

        styles:{fontSize:10,halign:'center'},

        headStyles:{fillColor:[13,45,92],textColor:255},

        footStyles:{fillColor:[248,240,214],textColor:[14,27,60]}

    });

    doc.save("Repayment_Schedule.pdf");

}

// =========================
// Export Excel
// =========================

function exportToExcel(){

    if(!requireCalc()) return;

    const c=lastCalc;

    const rows=[];

    rows.push(["Repayment Schedule"]);

    rows.push([`Customer Name : ${c.customerName||"-"}`]);

    rows.push([]);

    rows.push(["Loan Amount",c.loanVal]);

    rows.push(["Periodic Repayment",c.payVal]);

    rows.push(["Loan Term (months)",c.months]);

    rows.push(["Annual Interest Rate",`${c.interestRate}%`]);

    rows.push(["Repayment Method",c.method==="Annuity"?"Annuity":"Linear"]);

    rows.push([]);

    rows.push(["No","Principal","Interest","Total Payment","Balance"]);

    c.rows.forEach(r=>rows.push([r.no,r.principal,r.interest,r.payment,r.balance]));

    rows.push(["Total",c.totalPrincipal,c.totalInterest,c.totalPayment,""]);

    const ws=XLSX.utils.aoa_to_sheet(rows);

    ws["!merges"]=[

        {s:{r:0,c:0},e:{r:0,c:4}},

        {s:{r:1,c:0},e:{r:1,c:4}}

    ];

    ws["!cols"]=[{wch:20},{wch:16},{wch:16},{wch:16},{wch:16}];

    // Thousand separator + 2 decimals on every amount cell.

    const numberFormat="#,##0.00";

    for(let r=10;r<rows.length;r++){

        for(let col=1;col<=4;col++){

            const ref=XLSX.utils.encode_cell({r,c:col});

            if(ws[ref] && typeof ws[ref].v==="number") ws[ref].z=numberFormat;

        }

    }

    [3,4].forEach(r=>{

        const ref=XLSX.utils.encode_cell({r,c:1});

        if(ws[ref] && typeof ws[ref].v==="number") ws[ref].z=numberFormat;

    });

    const wb=XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(wb,ws,"Repayment Schedule");

    XLSX.writeFile(wb,"Repayment_Schedule.xlsx");

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
