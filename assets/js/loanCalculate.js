// =========================
// Helpers
// =========================

function format(num){

    return num.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});

}

// =========================
// Calculate
// =========================

function calculateLoan(){

    const customerName=document.getElementById("customerName").value.trim();

    const loan=parseFloat(document.getElementById("loanAmount").value);

    const repayment=parseFloat(document.getElementById("periodicRepayment").value);

    const term=parseFloat(document.getElementById("term").value);

    const interestRate=parseFloat(document.getElementById("interestRate").value);

    const method=document.getElementById("paymentMethod").value;

    const rate=(interestRate/100)/12;

    let loanVal=loan, payVal=repayment, months=term;

    const missing=[isNaN(loan),isNaN(repayment),isNaN(term)].filter(Boolean).length;

    if(missing!==1){

        if(typeof showToast==="function"){

            showToast("សូមទុកប្រអប់មួយ ដើម្បីគណនា។","warning");

        }else{

            alert("សូមទុកប្រអប់មួយ ដើម្បីគណនា។");

        }

        return;

    }

    if(isNaN(loanVal)){

        loanVal=method==="Annuity"

            ? payVal*(1-Math.pow(1+rate,-months))/rate

            : payVal/((1/months)+rate);

    }else if(isNaN(payVal)){

        payVal=method==="Annuity"

            ? (loanVal*rate)/(1-Math.pow(1+rate,-months))

            : (loanVal/months)+(loanVal*rate);

    }else if(isNaN(months)){

        months=Math.ceil(Math.log(payVal/(payVal-loanVal*rate))/Math.log(1+rate));

    }

    let balance=loanVal;

    let totalPrincipal=0, totalInterest=0, totalPayment=0;

    let html=`<div class="pdf-wrapper"><div class="pdf-title">តារាងកាលវិភាគសងប្រាក់</div><div class="pdf-customer">ឈ្មោះអតិថិជន : <span>${customerName||"-"}</span></div>`;

    html+=`<table class="info-table">
        <tr><th>ទំហំឥណទាន</th><td>${format(loanVal)}</td></tr>
        <tr><th>ប្រាក់សំណងខួប</th><td>${format(payVal)}</td></tr>
        <tr><th>រយៈពេលខ្ចី (ខែ)</th><td>${months}</td></tr>
        <tr><th>អត្រា​ការ​ប្រាក់​ប្រចាំឆ្នាំ</th><td>${interestRate}%</td></tr>
        <tr><th>របៀបសងប្រាក់</th><td>${method==="Annuity"?"បង់ថេរ":"បង់ថយ"}</td></tr>
    </table>`;

    html+=`<div class="table-scroll"><table class="schedule-table"><thead><tr>
        <th>ល.រ</th><th>ប្រាក់ដើម</th><th>ការប្រាក់</th><th>សរុបបង់</th><th>សមតុល្យ</th>
        </tr></thead><tbody>`;

    for(let i=1;i<=months;i++){

        const interest=balance*rate;

        const principal=method==="Annuity" ? payVal-interest : loanVal/months;

        const payment=method==="Annuity" ? payVal : principal+interest;

        balance-=principal;

        if(balance<0) balance=0;

        totalPrincipal+=principal;

        totalInterest+=interest;

        totalPayment+=payment;

        html+=`<tr>
            <td>${i}</td>
            <td>${format(principal)}</td>
            <td>${format(interest)}</td>
            <td>${format(payment)}</td>
            <td>${format(balance)}</td>
        </tr>`;

    }

    html+=`<tr class="total-row">
        <td>សរុប</td>
        <td>${format(totalPrincipal)}</td>
        <td>${format(totalInterest)}</td>
        <td>${format(totalPayment)}</td>
        <td>-</td>
    </tr></tbody></table></div></div>`;

    document.getElementById("exportSection").innerHTML=html;

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

            showToast("សូមគណនាមុននឹងនាំចេញ។","warning");

        }else{

            alert("សូមគណនាមុននឹងនាំចេញ។");

        }

        return;

    }

    const customerName=document.getElementById("customerName").value.trim()||"-";

    const translatedSection=exportSection.cloneNode(true);

    translatedSection.querySelectorAll("th, td").forEach(cell=>{

        cell.textContent=cell.textContent

            .replace("ល.រ","No")

            .replace("ប្រាក់ដើម","Principal")

            .replace("ការប្រាក់","Interest")

            .replace("សរុបបង់","Total Payment")

            .replace("សមតុល្យ","Balance")

            .replace("ទំហំឥណទាន","Loan Amount")

            .replace("ប្រាក់សំណងខួប","Periodic Repayment")

            .replace("រយៈពេលខ្ចី (ខែ)","Loan Term (months)")

            .replace("អត្រា​ការ​ប្រាក់​ប្រចាំឆ្នាំ","Annual Interest Rate")

            .replace("របៀបសងប្រាក់","Repayment Method")

            .replace("បង់ថេរ","Annuity")

            .replace("បង់ថយ","Linear")

            .replace("សរុប","Total");

    });

    // Print customer name + title as real PDF text at the very top —
    // the old version built these as <div>s but autoTable only ever
    // reads <table> elements, so they never actually appeared in the PDF.

    doc.setFontSize(15);

    doc.setFont(undefined,'bold');

    doc.text("Repayment Schedule",40,40);

    doc.setFont(undefined,'normal');

    doc.setFontSize(11);

    doc.setTextColor(40,40,40);

    doc.text(`Customer Name : ${customerName}`,40,62);

    const tables=translatedSection.querySelectorAll("table");

    let finalY=80;

    tables.forEach(table=>{

        doc.autoTable({

            html:table,

            startY:finalY,

            styles:{fontSize:10,halign:'center'},

            headStyles:{fillColor:[13,45,92],textColor:255}

        });

        finalY=doc.lastAutoTable.finalY+20;

    });

    doc.save("Repayment_Schedule.pdf");

}

// =========================
// Export Excel
// =========================

function exportToExcel(){

    const exportSection=document.getElementById("exportSection");

    if(!exportSection||exportSection.innerHTML.trim()===""){

        if(typeof showToast==="function"){

            showToast("សូមគណនាមុននឹងនាំចេញ។","warning");

        }else{

            alert("សូមគណនាមុននឹងនាំចេញ។");

        }

        return;

    }

    const customerName=document.getElementById("customerName").value.trim()||"-";

    const interestRate=document.getElementById("interestRate").value;

    const methodLabel=document.getElementById("paymentMethod").value==="Annuity" ? "Annuity" : "Linear";

    // ===== Header block: title, customer name, loan info =====

    const rows=[];

    rows.push(["Repayment Schedule"]);

    rows.push([`Customer Name : ${customerName}`]);

    rows.push([]);

    rows.push(["Loan Amount",Number(document.getElementById("loanAmount").value)||0]);

    rows.push(["Periodic Repayment",Number(document.getElementById("periodicRepayment").value)||0]);

    rows.push(["Loan Term (months)",Number(document.getElementById("term").value)||""]);

    rows.push(["Annual Interest Rate",`${interestRate}%`]);

    rows.push(["Repayment Method",methodLabel]);

    rows.push([]);

    // ===== Schedule table header =====

    rows.push(["No","Principal","Interest","Total Payment","Balance"]);

    const dataTable=exportSection.querySelector(".schedule-table");

    if(!dataTable){

        if(typeof showToast==="function"){

            showToast("មិនអាចរកតារាងទិន្នន័យបានទេ។","error");

        }else{

            alert("មិនអាចរកតារាងទិន្នន័យបានទេ។");

        }

        return;

    }

    const bodyRows=dataTable.querySelectorAll("tbody tr");

    bodyRows.forEach(tr=>{

        const cells=Array.from(tr.querySelectorAll("td")).map(td=>td.textContent.trim());

        const isTotal=tr.classList.contains("total-row");

        if(isTotal){

            rows.push(["Total",

                parseFloat(cells[1].replace(/,/g,""))||0,

                parseFloat(cells[2].replace(/,/g,""))||0,

                parseFloat(cells[3].replace(/,/g,""))||0,

                ""]);

        }else{

            rows.push([

                parseInt(cells[0],10),

                parseFloat(cells[1].replace(/,/g,""))||0,

                parseFloat(cells[2].replace(/,/g,""))||0,

                parseFloat(cells[3].replace(/,/g,""))||0,

                parseFloat(cells[4].replace(/,/g,""))||0

            ]);

        }

    });

    const ws=XLSX.utils.aoa_to_sheet(rows);

    // Merge the title and customer-name rows across all 5 columns

    ws["!merges"]=[

        {s:{r:0,c:0},e:{r:0,c:4}},

        {s:{r:1,c:0},e:{r:1,c:4}}

    ];

    // Reasonable column widths so it reads like the PDF table

    ws["!cols"]=[

        {wch:10},

        {wch:16},

        {wch:16},

        {wch:16},

        {wch:16}

    ];

    // Apply number formatting (thousand separator, 2 decimals) to numeric

    // amount cells, same style as the PDF/on-screen figures.

    const numberFormat="#,##0.00";

    const dataStartRow=9;

    for(let r=dataStartRow;r<rows.length;r++){

        for(let c=1;c<=3;c++){

            const cellRef=XLSX.utils.encode_cell({r,c});

            if(ws[cellRef] && typeof ws[cellRef].v==="number"){

                ws[cellRef].z=numberFormat;

            }

        }

        const balCellRef=XLSX.utils.encode_cell({r,c:4});

        if(ws[balCellRef] && typeof ws[balCellRef].v==="number"){

            ws[balCellRef].z=numberFormat;

        }

    }

    [3,4].forEach(r=>{

        const cellRef=XLSX.utils.encode_cell({r,c:1});

        if(ws[cellRef] && typeof ws[cellRef].v==="number"){

            ws[cellRef].z=numberFormat;

        }

    });

    const wb=XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(wb,ws,"Repayment Schedule");

    XLSX.writeFile(wb,"Repayment_Schedule.xlsx");

}

// =========================
// Init
// =========================

window.addEventListener("DOMContentLoaded",()=>{

    document.getElementById("btnCalculate").addEventListener("click",calculateLoan);

    document.getElementById("btnPDF").addEventListener("click",exportToPDF);

    document.getElementById("btnExcel").addEventListener("click",exportToExcel);

});
