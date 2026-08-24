// ========================================
// Customer Combined Search
// Mirrors the VBA UserForm's RunCombinedSearch — searches
// OS + AccPayroll + WO via /api/customers/search and shows
// results in a table, with a Customer Information card that
// populates on row tap (same as the VBA listbox click).
// ========================================

// ========================================
// MESSAGE HELPER
// ========================================

function notify(message,type="info"){

    if(typeof showToast==="function"){

        showToast(message,type);

    }else{

        alert(message);

    }

}

// ========================================
// TOKEN
// ========================================

const customerSearchToken=

    localStorage.getItem("token") ||

    sessionStorage.getItem("token");

// ========================================
// ELEMENTS
// ========================================

const inputKeyword=document.getElementById("inputKeyword");

const btnSearch=document.getElementById("btnSearch");

const tbodyCustomers=document.getElementById("tbodyCustomers");

const resultCount=document.getElementById("resultCount");

const infoCard=document.getElementById("infoCard");

// ========================================
// SAFE HTML
// ========================================

function escapeHtml(text){

    const div=document.createElement("div");

    div.textContent=text == null ? "" : String(text);

    // textContent->innerHTML escapes & < > but not quotes — harmless for
    // today's text-node-only callers, but keeps this consistent with the
    // other escapeHtml() copies in this codebase in case an attribute
    // usage gets added here later.
    return div.innerHTML.replace(/"/g, "&quot;").replace(/'/g, "&#39;");

}

// ========================================
// SEARCH
// ========================================

let lastResults=[];

async function runCustomerSearch(){

    const keyword=inputKeyword.value.trim();

    if(!keyword){

        notify("Please input value to find!","warning");

        return;

    }

    if(!customerSearchToken){

        notify("Session expired. Please log in again.","error");

        return;

    }

    if(typeof showAppLoading==="function"){

        showAppLoading("Searching customer data...");

    }

    try{

        const response=await fetch(

            `${API.BASE_URL}/api/customers/search?keyword=${encodeURIComponent(keyword)}`,

            {

                headers:{

                    Authorization:`Bearer ${customerSearchToken}`

                }

            }

        );

        if(!response.ok){

            throw new Error(`HTTP ${response.status}`);

        }

        const data=await response.json();

        if(!data.ok){

            throw new Error(data.message || "Unable to load data.");

        }

        lastResults=data.items || [];

        renderResults(lastResults);

    }catch(err){

        console.error(err);

        notify(err.message || "Search failed.","error");

        lastResults=[];

        renderResults([]);

    }finally{

        if(typeof hideAppLoading==="function"){

            hideAppLoading();

        }

    }

}

// ========================================
// RENDER RESULTS
// ========================================

function renderResults(items){

    tbodyCustomers.innerHTML="";

    resultCount.textContent=items.length;

    infoCard.classList.remove("show");

    if(!items.length){

        tbodyCustomers.innerHTML=`

            <tr class="row-empty">

                <td colspan="10">

                    No data found

                </td>

            </tr>

        `;

        return;

    }

    items.forEach((item,index)=>{

        const tr=document.createElement("tr");

        tr.dataset.index=index;

        tr.innerHTML=`

            <td>${escapeHtml(item.source)}</td>

            <td>${escapeHtml(item.cif)}</td>

            <td>${escapeHtml(item.engName)}</td>

            <td>${escapeHtml(item.khName)}</td>

            <td>${escapeHtml(item.dob)}</td>

            <td>${escapeHtml(item.legalId)}</td>

            <td>${escapeHtml(item.balance)}</td>

            <td>${escapeHtml(item.telephone)}</td>

            <td>${escapeHtml(item.address)}</td>

            <td>${escapeHtml(item.coBorrower)}</td>

        `;

        tbodyCustomers.appendChild(tr);

    });

}

// ========================================
// ROW CLICK -> CUSTOMER INFORMATION
// ========================================

tbodyCustomers.addEventListener("click",(e)=>{

    const tr=e.target.closest("tr[data-index]");

    if(!tr) return;

    const idx=Number(tr.dataset.index);

    const item=lastResults[idx];

    if(!item) return;

    document

        .querySelectorAll("#tbodyCustomers tr")

        .forEach(row=>row.classList.remove("row-selected"));

    tr.classList.add("row-selected");

    document.getElementById("infoCIF").textContent=item.cif || "-";

    document.getElementById("infoKhName").textContent=item.khName || "-";

    document.getElementById("infoDOB").textContent=item.dob || "-";

    document.getElementById("infoLegalID").textContent=item.legalId || "-";

    document.getElementById("infoTelephone").textContent=item.telephone || "-";

    document.getElementById("infoAddress").textContent=item.address || "-";

    document.getElementById("infoCoBorrower").textContent=item.coBorrower || "-";

    infoCard.classList.add("show");

    infoCard.scrollIntoView({behavior:"smooth",block:"nearest"});

});

// ========================================
// EVENTS
// ========================================

btnSearch.addEventListener("click",runCustomerSearch);

inputKeyword.addEventListener("keydown",function(e){

    if(e.key==="Enter"){

        runCustomerSearch();

    }

});

inputKeyword.addEventListener("input",function(){

    if(this.value.trim()===""){

        lastResults=[];

        renderResults([]);

        resultCount.textContent="0";

    }

});

// ========================================
// PAGE READY
// ========================================

console.log("Customer Search Ready.");
