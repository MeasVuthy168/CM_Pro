// ========================================
// Customer Combined Search
// Mirrors the VBA UserForm's RunCombinedSearch — searches
// OS + AccPayroll + WO via /api/customers/search.
//
// Results show as cards (default) or a full table, toggled like the
// Spot Check page and remembered in localStorage ("cst_view").
// Tapping a card/row opens a bottom sheet with the full Customer
// Information (same as the VBA listbox click).
// ========================================

// ========================================
// HELPERS
// ========================================

const t=(key)=>window.CMI18n ? CMI18n.t(key) : key;

// Same toast as the rest of the app (toast.js). There is no global
// showToast(), so the old check always fell through to alert().
function notify(message,type="info"){

    if(typeof CMToast!=="undefined" && CMToast.show){

        CMToast.show({type,title:message,message:"",duration:2500});

    }else{

        alert(message);

    }

}

function escapeHtml(text){

    const div=document.createElement("div");

    div.textContent=text == null ? "" : String(text);

    // textContent->innerHTML escapes & < > but not quotes — needed here
    // since some values go into attributes (href, data-*).
    return div.innerHTML.replace(/"/g, "&quot;").replace(/'/g, "&#39;");

}

function ico(name){

    return `<span class="ui-ico ui-ico-${name}" aria-hidden="true"></span>`;

}

// "12500.5" -> "12,500.50"; anything that isn't a number is shown as is.
function formatBalance(value){

    const raw=String(value ?? "").trim();

    if(raw==="") return "-";

    const n=Number(raw.replace(/,/g,""));

    if(!Number.isFinite(n)) return raw;

    return n.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});

}

// Badge class per data source (OS / Payroll / WO).
function sourceClass(source){

    const s=String(source || "").toLowerCase();

    if(s==="wo") return "cst-source-wo";

    if(s==="payroll") return "cst-source-payroll";

    return "cst-source-os";

}

function telLink(phone){

    const digits=String(phone || "").replace(/[^\d+]/g,"");

    return digits ? `tel:${digits}` : "";

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

const btnClearKeyword=document.getElementById("btnClearKeyword");

const resultsBox=document.getElementById("cstResults");

const toolbar=document.getElementById("cstToolbar");

const resultCount=document.getElementById("resultCount");

const stateStart=document.getElementById("cstStateStart");

const stateEmpty=document.getElementById("cstStateEmpty");

const stateError=document.getElementById("cstStateError");

const sheet=document.getElementById("cstSheet");

// ========================================
// STATE
// ========================================

let lastResults=[];

let cstViewMode=localStorage.getItem("cst_view")==="list" ? "list" : "card";

function showState(which){

    stateStart.hidden=which!=="start";

    stateEmpty.hidden=which!=="empty";

    stateError.hidden=which!=="error";

    toolbar.hidden=which!=="results";

    if(which!=="results") resultsBox.innerHTML="";

}

// ========================================
// SEARCH
// ========================================

async function runCustomerSearch(){

    const keyword=inputKeyword.value.trim();

    if(!keyword){

        notify(t("customers.enterKeyword"),"warning");

        inputKeyword.focus();

        return;

    }

    if(!customerSearchToken){

        notify(t("customers.sessionExpired"),"error");

        return;

    }

    // Close the on-screen keyboard so the results are visible.
    inputKeyword.blur();

    if(typeof showAppLoading==="function"){

        showAppLoading(t("customers.searching"));

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

        renderResults();

    }catch(err){

        console.error(err);

        lastResults=[];

        showState("error");

    }finally{

        if(typeof hideAppLoading==="function"){

            hideAppLoading();

        }

    }

}

// ========================================
// RENDER RESULTS
// ========================================

function renderResults(){

    resultCount.textContent=lastResults.length;

    if(!lastResults.length){

        showState("empty");

        return;

    }

    showState("results");

    applyViewModeButtons();

    resultsBox.classList.toggle("cst-results-list",cstViewMode==="list");

    resultsBox.innerHTML=cstViewMode==="list"

        ? buildTable(lastResults)

        : lastResults.map(buildCard).join("");

}

function buildCard(item,index){

    const name=item.khName || item.engName || "-";

    const eng=item.khName && item.engName ? item.engName : "";

    const phone=item.telephone ? `

        <a class="cst-card-meta cst-card-phone" href="${escapeHtml(telLink(item.telephone))}" data-stop>

            ${ico("phone")}<span>${escapeHtml(item.telephone)}</span>

        </a>` : "";

    const legal=item.legalId ? `

        <span class="cst-card-meta">${ico("idcard")}<span>${escapeHtml(item.legalId)}</span></span>` : "";

    const dob=item.dob ? `

        <span class="cst-card-meta">${ico("calendar")}<span>${escapeHtml(item.dob)}</span></span>` : "";

    const address=item.address ? `

        <div class="cst-card-address">${ico("pin")}<span>${escapeHtml(item.address)}</span></div>` : "";

    return `

        <button type="button" class="cst-card" data-index="${index}">

            <div class="cst-card-top">

                <span class="cst-source ${sourceClass(item.source)}">${escapeHtml(item.source)}</span>

                <span class="cst-card-cif">CIF ${escapeHtml(item.cif || "-")}</span>

            </div>

            <div class="cst-card-name">${escapeHtml(name)}</div>

            ${eng ? `<div class="cst-card-eng">${escapeHtml(eng)}</div>` : ""}

            <div class="cst-card-balance">

                <span>${escapeHtml(t("customers.colBalance"))}</span>

                <strong>${escapeHtml(formatBalance(item.balance))}</strong>

            </div>

            <div class="cst-card-metas">${phone}${legal}${dob}</div>

            ${address}

        </button>

    `;

}

function buildTable(items){

    const rows=items.map((item,index)=>`

        <tr data-index="${index}">

            <td><span class="cst-source ${sourceClass(item.source)}">${escapeHtml(item.source)}</span></td>

            <td>${escapeHtml(item.cif)}</td>

            <td>${escapeHtml(item.khName)}</td>

            <td>${escapeHtml(item.engName)}</td>

            <td class="cst-num">${escapeHtml(formatBalance(item.balance))}</td>

            <td>${escapeHtml(item.telephone)}</td>

            <td>${escapeHtml(item.dob)}</td>

            <td>${escapeHtml(item.legalId)}</td>

            <td class="cst-td-wrap">${escapeHtml(item.address)}</td>

            <td>${escapeHtml(item.coBorrower)}</td>

        </tr>

    `).join("");

    return `

        <div class="cst-table-wrap">

            <table class="cst-table">

                <thead>

                    <tr>

                        <th>${escapeHtml(t("customers.colSource"))}</th>
                        <th>CIF</th>
                        <th>${escapeHtml(t("customers.khNameLabel"))}</th>
                        <th>${escapeHtml(t("customers.colEnglishName"))}</th>
                        <th class="cst-num">${escapeHtml(t("customers.colBalance"))}</th>
                        <th>${escapeHtml(t("customers.telephoneLabel"))}</th>
                        <th>${escapeHtml(t("customers.dobLabel"))}</th>
                        <th>${escapeHtml(t("customers.legalIdLabel"))}</th>
                        <th>${escapeHtml(t("customers.addressLabel"))}</th>
                        <th>${escapeHtml(t("customers.coBorrowerLabel"))}</th>

                    </tr>

                </thead>

                <tbody>${rows}</tbody>

            </table>

        </div>

    `;

}

// ========================================
// VIEW TOGGLE (card / list) — same pattern as Spot Check
// ========================================

function applyViewModeButtons(){

    document.getElementById("cstViewCardBtn").classList.toggle("active",cstViewMode==="card");

    document.getElementById("cstViewListBtn").classList.toggle("active",cstViewMode==="list");

}

function setViewMode(mode){

    if(mode===cstViewMode) return;

    cstViewMode=mode;

    try{ localStorage.setItem("cst_view",mode); }catch(e){}

    renderResults();

}

document.getElementById("cstViewCardBtn").addEventListener("click",()=>setViewMode("card"));

document.getElementById("cstViewListBtn").addEventListener("click",()=>setViewMode("list"));

// ========================================
// CARD / ROW TAP -> CUSTOMER INFORMATION SHEET
// ========================================

resultsBox.addEventListener("click",(e)=>{

    // The phone link dials directly instead of opening the sheet.
    if(e.target.closest("[data-stop]")) return;

    const el=e.target.closest("[data-index]");

    if(!el) return;

    const item=lastResults[Number(el.dataset.index)];

    if(!item) return;

    resultsBox.querySelectorAll(".is-selected").forEach(n=>n.classList.remove("is-selected"));

    el.classList.add("is-selected");

    openSheet(item);

});

function sheetRow(icon,labelKey,value,extra=""){

    return `

        <div class="cst-sheet-row">

            <span class="cst-sheet-row-ico">${ico(icon)}</span>

            <div class="cst-sheet-row-text">

                <div class="cst-sheet-label">${labelKey ? escapeHtml(t(labelKey)) : "CIF"}</div>

                <div class="cst-sheet-value">${value ? escapeHtml(value) : "-"}</div>

            </div>

            ${extra}

        </div>

    `;

}

function openSheet(item){

    const source=document.getElementById("cstSheetSource");

    source.textContent=item.source || "";

    source.className=`cst-source ${sourceClass(item.source)}`;

    document.getElementById("cstSheetName").textContent=item.khName || item.engName || "-";

    document.getElementById("cstSheetEngName").textContent=item.khName ? (item.engName || "") : "";

    document.getElementById("cstSheetBalance").textContent=formatBalance(item.balance);

    const copyBtn=item.cif ? `

        <button type="button" class="cst-sheet-action" data-copy="${escapeHtml(item.cif)}" aria-label="${escapeHtml(t("customers.copyCifAria"))}">${ico("copy")}</button>` : "";

    const callBtn=item.telephone ? `

        <a class="cst-sheet-action" href="${escapeHtml(telLink(item.telephone))}" aria-label="${escapeHtml(t("customers.telephoneLabel"))}">${ico("phone")}</a>` : "";

    document.getElementById("cstSheetRows").innerHTML=

        sheetRow("idcard","",item.cif,copyBtn)+

        sheetRow("idcard","customers.legalIdLabel",item.legalId)+

        sheetRow("calendar","customers.dobLabel",item.dob)+

        sheetRow("phone","customers.telephoneLabel",item.telephone,callBtn)+

        sheetRow("pin","customers.addressLabel",item.address)+

        sheetRow("users","customers.coBorrowerLabel",item.coBorrower);

    sheet.classList.add("show");

    sheet.setAttribute("aria-hidden","false");

}

function closeSheet(){

    sheet.classList.remove("show");

    sheet.setAttribute("aria-hidden","true");

}

sheet.addEventListener("click",async(e)=>{

    if(e.target.closest("[data-close]")){

        closeSheet();

        return;

    }

    const copy=e.target.closest("[data-copy]");

    if(copy){

        try{

            await navigator.clipboard.writeText(copy.dataset.copy);

            notify(t("customers.copied"),"success");

        }catch(err){

            console.error("Copy failed:",err);

        }

    }

});

document.addEventListener("keydown",(e)=>{

    if(e.key==="Escape" && sheet.classList.contains("show")) closeSheet();

});

// ========================================
// EVENTS
// ========================================

btnSearch.addEventListener("click",runCustomerSearch);

document.getElementById("btnRetrySearch").addEventListener("click",runCustomerSearch);

inputKeyword.addEventListener("keydown",function(e){

    if(e.key==="Enter"){

        runCustomerSearch();

    }

});

inputKeyword.addEventListener("input",function(){

    const empty=this.value.trim()==="";

    btnClearKeyword.hidden=this.value==="";

    if(empty){

        lastResults=[];

        resultCount.textContent="0";

        showState("start");

    }

});

btnClearKeyword.addEventListener("click",()=>{

    inputKeyword.value="";

    inputKeyword.dispatchEvent(new Event("input"));

    inputKeyword.focus();

});

// ========================================
// PAGE READY
// ========================================

applyViewModeButtons();

console.log("Customer Search Ready.");
