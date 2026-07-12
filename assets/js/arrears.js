// ========================================
// Daily Arrears — ArreasT24ByCO web port
// Reads from GET /api/arreast24byco/rows (paginated, 41 cols/row,
// same collection the VBA Download/Upload buttons already sync).
// Reason Arrear panel reads/writes via /api/reasonarrear/* keyed
// on the row's Concate value (AG) — see COL.CONCATE below and the
// note in the HTML/plan message for why, not raw CIF.
// ========================================

// ========================================
// COLUMN MAP
// values[] index -> field, per the confirmed header row (B is
// the sheet's own row-number column and is NOT part of values[]
// — values[] starts at C = "Loan Number").
// ========================================
const COL = {
    LOAN_NUMBER: 0,
    CUSTOMER: 1,
    LOCATION: 2,
    DIS_DATE: 3,
    PRN_OS: 4,
    INT_OS: 5,
    PRN_DUE: 6,
    INT_DUE: 7,
    PENALTY: 8,
    ARREAS: 9,
    DAY: 10,
    BALANCE: 11,
    ACCOUNT_LOAN: 12,
    TELL: 13,
    CIF: 14,
    OCCU: 15,
    MINISTRY: 16,
    PROMISE_STATUS_1: 17,   // T — legacy/secondary, shown read-only if ever needed
    BRANCH: 18,
    CO_ID: 19,
    CO_RESPONSE: 20,
    CCY: 21,
    OS_USD: 22,
    OS_CLASSIFY: 23,
    TEAM_LEADER: 24,
    ACC_PAYROLL: 25,
    CIF_COBORROWER: 26,
    BLOCKING: 27,
    CLASS: 28,
    PD: 29,
    CONCATE: 30,            // AG — used as the Reason Arrear key (see note above)
    PRODUCT: 31,
    PROMISE_STATUS: 32,     // AI — the LIVE promise status (matches the M4 filter field)
    AJ_REASON: 33,          // មុខរបរ
    AK_SOLUTION: 34,        // មូលហេតុ/ដំណោះស្រាយ
    AL_FOLLOWUP: 35,        // ថ្ងៃសន្យាសង
    USER: 36,
    DATE_BACKUP: 37,
    REPORT_DATE: 38,
    COLLATERAL_TYPE: 39,
    TOTAL_BALANCE: 40
};

const DIGITAL_PRODUCTS = [
    "Advance Salary Loan",
    "By Now Pay Later",
    "Payroll Loan",
    "Loan against Term Deposit"
];

// ========================================
// TOKEN + ELEMENTS
// ========================================

const arrearsToken =
    localStorage.getItem("token") ||
    sessionStorage.getItem("token");

const tbodyArrears = document.getElementById("tbodyArrears");
const summaryLD = document.getElementById("sumLD");
const summaryOS = document.getElementById("sumOS");
const lastUploadAtEl = document.getElementById("lastUploadAt");
const lastUploadByEl = document.getElementById("lastUploadBy");

const filterEls = {
    branch: document.getElementById("fBranch"),
    officerResponse: document.getElementById("fOfficerResponse"),
    officerOwner: document.getElementById("fOfficerOwner"),
    teamLeader: document.getElementById("fTeamLeader"),
    currency: document.getElementById("fCurrency"),
    osClassify: document.getElementById("fOsClassify"),
    class: document.getElementById("fClass"),
    pd: document.getElementById("fPD"),
    occupation: document.getElementById("fOccupation"),
    productType: document.getElementById("fProductType"),
    keyword: document.getElementById("fKeyword"),
    promiseStatus: document.getElementById("fPromiseStatus")
};

const reasonBackdrop = document.getElementById("reasonBackdrop");
const reasonCard = document.getElementById("reasonCard");
const reasonSubtitle = document.getElementById("reasonSubtitle");
const reasonAJ = document.getElementById("reasonAJ");
const reasonAK = document.getElementById("reasonAK");
const reasonAL = document.getElementById("reasonAL");
const reasonMeta = document.getElementById("reasonMeta");

let allRows = [];        // every row, parsed to objects, unfiltered
let currentRows = [];    // whatever's currently displayed (post-filter)
let selectedRow = null;  // row object behind the open Reason Arrear panel

const customerDatalist = document.getElementById("customerSuggestions");

attachSuggestions(reasonAJ, () => distinctSorted(allRows, "ajReason"));
attachSuggestions(reasonAK, () => distinctSorted(allRows, "akSolution"));

// ========================================
// DISTINCT VALUE HELPERS
// ========================================

function distinctSorted(rows, field) {
    const set = new Set();
    rows.forEach(r => {
        const v = (r[field] || "").trim();
        if (v) set.add(v);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
}

// ========================================
// PREDICTIVE SUGGESTIONS (Reason Arrear's AJ/AK fields)
// Custom dropdown rather than a native <datalist>, since AK is a
// <textarea> and datalist only works with <input>. Suggestions come
// from other rows' existing values in that same column, so users can
// pick a previously-used answer instead of retyping it.
// ========================================

function attachSuggestions(fieldEl, getSourceValues) {
    const list = document.createElement("ul");
    list.className = "suggestion-list";
    fieldEl.parentElement.appendChild(list);

    function hide() {
        list.classList.remove("show");
        list.innerHTML = "";
    }

    function showSuggestionsFor(query) {
        const q = query.trim().toLowerCase();
        if (!q) { hide(); return; }

        const matches = getSourceValues()
            .filter(v => v.toLowerCase().includes(q) && v.toLowerCase() !== q)
            .slice(0, 8);

        if (!matches.length) { hide(); return; }

        list.innerHTML = "";
        matches.forEach(value => {
            const li = document.createElement("li");
            li.textContent = value;
            li.addEventListener("mousedown", (e) => {
                // mousedown (not click) so this fires before the field's
                // own blur event closes the dropdown first
                e.preventDefault();
                fieldEl.value = value;
                hide();
                fieldEl.focus();
            });
            list.appendChild(li);
        });
        list.classList.add("show");
    }

    fieldEl.addEventListener("input", () => showSuggestionsFor(fieldEl.value));
    fieldEl.addEventListener("focus", () => showSuggestionsFor(fieldEl.value));
    fieldEl.addEventListener("blur", hide);
}

function setSelectOptions(selectEl, values, { keepFirstN = 1 } = {}) {
    // keeps the first N existing <option> elements (e.g. "All", or
    // "All"+"Digital Products"+"Non-Digital Products") and replaces
    // everything after that with fresh options built from `values`
    const kept = Array.from(selectEl.options).slice(0, keepFirstN);
    const currentValue = selectEl.value;

    selectEl.innerHTML = "";
    kept.forEach(opt => selectEl.appendChild(opt));

    values.forEach(v => {
        const opt = document.createElement("option");
        opt.value = v;
        opt.textContent = v;
        selectEl.appendChild(opt);
    });

    // restore selection if it's still a valid option, else fall back to "All"
    const stillValid = Array.from(selectEl.options).some(o => o.value === currentValue);
    selectEl.value = stillValid ? currentValue : "";
}

// ========================================
// POPULATE ALL FILTER DROPDOWNS FROM REAL DATA
// Called once after every fetch, since the underlying data can
// change between refreshes.
// ========================================

function populateFilterOptions() {
    setSelectOptions(filterEls.branch, distinctSorted(allRows, "branch"), { keepFirstN: 1 });
    setSelectOptions(filterEls.teamLeader, distinctSorted(allRows, "teamLeader"), { keepFirstN: 1 });
    setSelectOptions(filterEls.osClassify, distinctSorted(allRows, "osClassify"), { keepFirstN: 1 });
    setSelectOptions(filterEls.occupation, distinctSorted(allRows, "occu"), { keepFirstN: 1 });

    // Product Type keeps "All" + "Digital Products" + "Non-Digital Products",
    // then appends every individual product name found in the data.
    setSelectOptions(filterEls.productType, distinctSorted(allRows, "product"), { keepFirstN: 3 });

    populateOfficerOptions();
}

// Officer Response / Officer Owner — scoped to whichever Branch is
// currently selected (or all rows if Branch = "All"), per the
// cascading behavior requested: pick a Branch, the two Officer
// dropdowns narrow to only officers who actually appear under it.
function populateOfficerOptions() {
    const branch = filterEls.branch.value.trim();
    const scoped = branch
        ? allRows.filter(r => r.branch === branch)
        : allRows;

    setSelectOptions(filterEls.officerResponse, distinctSorted(scoped, "coResponse"), { keepFirstN: 1 });
    setSelectOptions(filterEls.officerOwner, distinctSorted(scoped, "coId"), { keepFirstN: 1 });
}

filterEls.branch.addEventListener("change", () => {
    populateOfficerOptions();
    applyFilters();
});

// ========================================
// CUSTOMER AUTOCOMPLETE (Google-style predictive suggestions)
// Rebuilds the <datalist> options as the user types, capped to a
// small number of matches so it stays fast even with thousands
// of rows loaded.
// ========================================

function updateCustomerSuggestions() {
    const query = filterEls.keyword.value.trim().toLowerCase();
    customerDatalist.innerHTML = "";

    if (!query) return;

    const seen = new Set();
    const matches = [];

    for (const row of allRows) {
        const name = row.customer;
        if (!name) continue;
        if (!name.toLowerCase().includes(query)) continue;
        if (seen.has(name)) continue;

        seen.add(name);
        matches.push(name);
        if (matches.length >= 15) break;
    }

    matches.forEach(name => {
        const opt = document.createElement("option");
        opt.value = name;
        customerDatalist.appendChild(opt);
    });
}

filterEls.keyword.addEventListener("input", updateCustomerSuggestions);

// ========================================
// MESSAGE HELPER
// ========================================

function notify(message, type = "info") {
    if (typeof showToast === "function") {
        showToast(message, type);
    } else {
        alert(message);
    }
}

function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text == null ? "" : String(text);
    return div.innerHTML;
}

// ========================================
// FETCH ALL ROWS (paginated — server caps at 1000/request,
// sheet can hold up to 15000 rows, so we loop until a page
// comes back short of the limit)
// ========================================

async function fetchAllArrearsRows() {
    const limit = 1000;
    let startRow = 6; // matches the sheet's own data start row
    let all = [];

    while (true) {
        const url = `${API.BASE_URL}/api/arreast24byco/rows?startRow=${startRow}&limit=${limit}&cols=41`;
        const res = await fetch(url, {
            headers: { Authorization: `Bearer ${arrearsToken}` }
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!data.ok) throw new Error(data.message || "Failed to load arrears data.");

        const rows = data.rows || [];
        all = all.concat(rows);

        if (rows.length < limit) break; // last page
        startRow += limit;
    }

    return all.map(r => parseRow(r.values || []));
}

function parseRow(values) {
    const get = i => (values[i] ?? "").toString().trim();
    return {
        loanNumber: get(COL.LOAN_NUMBER),
        customer: get(COL.CUSTOMER),
        location: get(COL.LOCATION),
        disDate: get(COL.DIS_DATE),
        prnOS: get(COL.PRN_OS),
        intOS: get(COL.INT_OS),
        prnDue: get(COL.PRN_DUE),
        intDue: get(COL.INT_DUE),
        penalty: get(COL.PENALTY),
        arreas: get(COL.ARREAS),
        day: get(COL.DAY),
        balance: get(COL.BALANCE),
        accountLoan: get(COL.ACCOUNT_LOAN),
        tell: get(COL.TELL),
        cif: get(COL.CIF),
        occu: get(COL.OCCU),
        ministry: get(COL.MINISTRY),
        promiseStatus: get(COL.PROMISE_STATUS),
        branch: get(COL.BRANCH),
        coId: get(COL.CO_ID),
        coResponse: get(COL.CO_RESPONSE),
        ccy: get(COL.CCY),
        osUsd: get(COL.OS_USD),
        osClassify: get(COL.OS_CLASSIFY),
        teamLeader: get(COL.TEAM_LEADER),
        cifCoborrower: get(COL.CIF_COBORROWER),
        class: get(COL.CLASS),
        pd: get(COL.PD),
        concate: get(COL.CONCATE),
        product: get(COL.PRODUCT),
        ajReason: get(COL.AJ_REASON),
        akSolution: get(COL.AK_SOLUTION),
        alFollowup: get(COL.AL_FOLLOWUP),
        user: get(COL.USER),
        dateBackup: get(COL.DATE_BACKUP)
    };
}

// ========================================
// FILTERING — mirrors Worksheet_Change's AutoFilter logic
// ========================================

function containsMatch(value, query) {
    if (!query) return true;
    return value.toLowerCase().includes(query.toLowerCase());
}

function exactMatch(value, query) {
    if (!query) return true;
    return value.trim().toLowerCase() === query.trim().toLowerCase();
}

function classMatch(value, filterValue) {
    if (!filterValue) return true;
    if (filterValue === "Normal_to_SpecialMention") {
        return value === "Normal" || value === "Special Mention";
    }
    if (filterValue === "SubStandard_to_Loss") {
        return ["Sub Standard", "Sub-Standard", "Doubtful", "Loss"].includes(value);
    }
    return value === filterValue;
}

function productMatch(value, filterValue) {
    if (!filterValue) return true;
    if (filterValue === "Digital Products") {
        return DIGITAL_PRODUCTS.includes(value);
    }
    if (filterValue === "Non-Digital Products") {
        return !DIGITAL_PRODUCTS.includes(value);
    }
    return value === filterValue;
}

// "មិនទាន់សន្យា" (not yet promised) isn't a value that appears in the
// Promise Status column itself — it means the AK (មូលហេតុ/ដំណោះស្រាយ)
// solution field is still blank, i.e. no follow-up has been logged yet.
function promiseStatusMatch(row, filterValue) {
    if (!filterValue) return true;
    if (filterValue === "មិនទាន់សន្យា") {
        return !row.akSolution;
    }
    return containsMatch(row.promiseStatus, filterValue);
}

function applyFilters() {
    const f = {
        branch: filterEls.branch.value.trim(),
        officerResponse: filterEls.officerResponse.value.trim(),
        officerOwner: filterEls.officerOwner.value.trim(),
        teamLeader: filterEls.teamLeader.value.trim(),
        currency: filterEls.currency.value.trim(),
        osClassify: filterEls.osClassify.value.trim(),
        classVal: filterEls.class.value.trim(),
        pd: filterEls.pd.value.trim(),
        occupation: filterEls.occupation.value.trim(),
        productType: filterEls.productType.value.trim(),
        keyword: filterEls.keyword.value.trim(),
        promiseStatus: filterEls.promiseStatus.value.trim()
    };

    currentRows = allRows.filter(row => {
        return containsMatch(row.branch, f.branch)
            && containsMatch(row.coResponse, f.officerResponse)
            && exactMatch(row.coId, f.officerOwner)
            && exactMatch(row.teamLeader, f.teamLeader)
            && exactMatch(row.ccy, f.currency)
            && exactMatch(row.osClassify, f.osClassify)
            && classMatch(row.class, f.classVal)
            && exactMatch(row.pd, f.pd)
            && exactMatch(row.occu, f.occupation)
            && productMatch(row.product, f.productType)
            && containsMatch(row.customer, f.keyword)
            && promiseStatusMatch(row, f.promiseStatus);
    });

    renderTable(currentRows);
    renderSummary(currentRows);
}

function clearFilters() {
    Object.values(filterEls).forEach(el => { el.value = ""; });
    populateOfficerOptions();
    customerDatalist.innerHTML = "";
    applyFilters();
}

// ========================================
// SUMMARY — mirrors RefreshSummary (Gov/Worker/Other by Occu,
// summed on OS_USD)
// ========================================

function formatShortAmount(v) {
    const abs = Math.abs(v);
    if (abs >= 1000000) return (v / 1000000).toFixed(1) + "M";
    if (abs >= 1000) return (v / 1000).toFixed(1) + "K";
    return v.toLocaleString();
}

// "yyyy-mm-dd hh:mm:ss AM/PM"
function formatDateTime12h(isoString) {
    if (!isoString) return "-";
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return "-";

    const pad = n => String(n).padStart(2, "0");
    const yyyy = d.getFullYear();
    const mm = pad(d.getMonth() + 1);
    const dd = pad(d.getDate());

    let h = d.getHours();
    const ampm = h >= 12 ? "PM" : "AM";
    h = h % 12;
    if (h === 0) h = 12;

    const hh = pad(h);
    const min = pad(d.getMinutes());
    const ss = pad(d.getSeconds());

    return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss} ${ampm}`;
}

// ========================================
// ROW DATE/PHONE FORMATTING
// The sheet's raw values can arrive as Excel serial numbers (e.g.
// "45531") rather than proper date strings — that's what was showing
// up unformatted in DisDate/ថ្ងៃសន្យាសង/DateBackUpReasonArrear. These
// use UTC getters deliberately: Excel serials convert to UTC-midnight
// JS dates, and using local getters here would risk shifting the
// displayed day depending on the browser's timezone.
// ========================================

function excelSerialToDate(serial) {
    const utcDays = Math.floor(serial - 25569); // days between 1899-12-30 and 1970-01-01
    return new Date(utcDays * 86400 * 1000);
}

function parseFlexibleDate(value) {
    if (value === null || value === undefined) return null;
    const str = String(value).trim();
    if (!str) return null;

    if (/^\d+(\.\d+)?$/.test(str)) {
        const serial = parseFloat(str);
        if (serial > 20000 && serial < 60000) { // sane range, roughly 1954-2064
            return excelSerialToDate(serial);
        }
    }

    const parsed = new Date(str);
    return isNaN(parsed.getTime()) ? null : parsed;
}

// dd/mm/yyyy — for DisDate and ថ្ងៃសន្យាសង
function formatRowDateDMY(value) {
    const d = parseFlexibleDate(value);
    if (!d) return value || "";
    const pad = n => String(n).padStart(2, "0");
    return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

// yyyy-mm-dd hh:mm:ss AM/PM — for DateBackUpReasonArrear
function formatRowDateTime12h(value) {
    const d = parseFlexibleDate(value);
    if (!d) return value || "";
    const pad = n => String(n).padStart(2, "0");

    let h = d.getUTCHours();
    const ampm = h >= 12 ? "PM" : "AM";
    h = h % 12;
    if (h === 0) h = 12;

    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(h)}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} ${ampm}`;
}

// Cambodian phone numbers start with 0 — Excel/JS often strips a
// leading zero when a phone number gets treated as a number rather
// than text, e.g. "16848527" instead of "016848527". Only touches
// values that are purely digits, so already-fine cells (multiple
// numbers separated by "/", etc.) are left untouched.
function formatPhone(value) {
    if (!value) return "";
    const v = String(value).trim();
    if (/^\d+$/.test(v) && !v.startsWith("0")) {
        return "0" + v;
    }
    return v;
}

// Uses /api/arreast24byco/info (buildInfo on the server) which already
// returns lastUploadAt/lastUploadedBy — cheaper than scanning all rows
// for this ourselves.
async function fetchArrearsInfo() {
    try {
        const res = await fetch(`${API.BASE_URL}/api/arreast24byco/info`, {
            headers: { Authorization: `Bearer ${arrearsToken}` }
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.message || "Failed to load upload info.");

        lastUploadAtEl.textContent = formatDateTime12h(data.lastUploadAt);
        lastUploadByEl.textContent = data.lastUploadedBy || "-";
    } catch (err) {
        console.error(err);
        lastUploadAtEl.textContent = "-";
        lastUploadByEl.textContent = "-";
    }
}

function renderSummary(rows) {
    let govCnt = 0, workerCnt = 0, otherCnt = 0;
    let govOS = 0, workerOS = 0, otherOS = 0, totalOS = 0;
    const uniqueCifs = new Set();

    rows.forEach(row => {
        const amt = parseFloat(row.osUsd) || 0;
        totalOS += amt;
        if (row.cif) uniqueCifs.add(row.cif);
        if (row.occu === "Gov") { govCnt++; govOS += amt; }
        else if (row.occu === "Worker") { workerCnt++; workerOS += amt; }
        else { otherCnt++; otherOS += amt; }
    });

    summaryLD.textContent =
        `${rows.length.toLocaleString()} CIF:${uniqueCifs.size.toLocaleString()} (Gov:${govCnt.toLocaleString()}, Worker:${workerCnt.toLocaleString()}, Other:${otherCnt.toLocaleString()})`;

    summaryOS.textContent =
        `${formatShortAmount(totalOS)} (Gov:${formatShortAmount(govOS)}, Worker:${formatShortAmount(workerOS)}, Other:${formatShortAmount(otherOS)})`;
}

// ========================================
// RENDER TABLE
// ========================================

// Matches the Excel row-Class rules ($AE6="Loss" etc.)
function classRowCssClass(classValue) {
    switch (classValue) {
        case "Loss": return "row-class-loss";
        case "Doubtful": return "row-class-doubtful";
        case "Sub Standard":
        case "Sub-Standard": return "row-class-substandard"; // both spellings seen in real data
        case "Special Mention": return "row-class-specialmention";
        default: return "";
    }
}

// Matches the Excel SEARCH(...)>0 rules on Promise Status —
// substring match, same as promiseStatusMatch's filter logic.
function promiseCellCssClass(promiseStatus) {
    const v = (promiseStatus || "").toLowerCase();
    if (v.includes("today_payment")) return "cell-promise-today";
    if (v.includes("upcoming_left")) return "cell-promise-upcoming";
    if (v.includes("expired")) return "cell-promise-expired";
    return "";
}

function renderTable(rows) {
    tbodyArrears.innerHTML = "";

    if (!rows.length) {
        tbodyArrears.innerHTML = `
            <tr class="row-empty">
                <td colspan="26">No data found</td>
            </tr>
        `;
        return;
    }

    // Duplicate-customer detection (column D) — scoped to the rows
    // actually being shown, same as Excel's "Duplicate Values" rule
    // would effectively read against the visible/filtered range.
    const customerCounts = new Map();
    rows.forEach(row => {
        if (!row.customer) return;
        customerCounts.set(row.customer, (customerCounts.get(row.customer) || 0) + 1);
    });

    const frag = document.createDocumentFragment();

    rows.forEach((row, index) => {
        const tr = document.createElement("tr");
        tr.dataset.index = index;

        const rowClassCss = classRowCssClass(row.class);
        if (rowClassCss) tr.classList.add(rowClassCss);

        const arreaClass = (parseFloat(row.arreas) || 0) > 0 ? "cell-negative" : "";
        const balClass = (parseFloat(row.balance) || 0) < 0 ? "cell-negative" : "";
        const balPdClass = row.pd === "Balanced_PD" ? "cell-balance-pd" : "";
        const dupClass = (customerCounts.get(row.customer) || 0) > 1 ? "cell-duplicate-customer" : "";

        // Promise Status coloring applies to Promise Status + all three
        // follow-up cells; if none of the three keywords matched, those
        // follow-up cells fall back to the default light-blue fill.
        const promiseCss = promiseCellCssClass(row.promiseStatus);
        const followupCss = promiseCss || "cell-followup-default";

        tr.innerHTML = `
            <td>${index + 1}</td>
            <td>${escapeHtml(row.loanNumber)}</td>
            <td class="${dupClass}">${escapeHtml(row.customer)}</td>
            <td>${escapeHtml(row.location)}</td>
            <td>${escapeHtml(formatRowDateDMY(row.disDate))}</td>
            <td>${escapeHtml(row.prnOS)}</td>
            <td>${escapeHtml(row.intOS)}</td>
            <td>${escapeHtml(row.prnDue)}</td>
            <td>${escapeHtml(row.intDue)}</td>
            <td>${escapeHtml(row.penalty)}</td>
            <td class="${arreaClass}">${escapeHtml(row.arreas)}</td>
            <td>${escapeHtml(row.day)}</td>
            <td class="${balClass} ${balPdClass}">${escapeHtml(row.balance)}</td>
            <td>${escapeHtml(row.accountLoan)}</td>
            <td>${escapeHtml(formatPhone(row.tell))}</td>
            <td>${escapeHtml(row.cif)}</td>
            <td>${escapeHtml(row.occu)}</td>
            <td>${escapeHtml(row.ministry)}</td>
            <td class="${promiseCss}">${escapeHtml(row.promiseStatus)}</td>
            <td>${escapeHtml(row.coId)}</td>
            <td>${escapeHtml(row.cifCoborrower)}</td>
            <td class="${followupCss}">${escapeHtml(row.ajReason)}</td>
            <td class="${followupCss}">${escapeHtml(row.akSolution)}</td>
            <td class="${followupCss}">${escapeHtml(formatRowDateDMY(row.alFollowup))}</td>
            <td>${escapeHtml(row.user)}</td>
            <td>${escapeHtml(formatRowDateTime12h(row.dateBackup))}</td>
        `;
        frag.appendChild(tr);
    });

    tbodyArrears.appendChild(frag);

    // Force a synchronous reflow. Without this, the columns furthest to
    // the right (past the horizontal-scroll edge) sometimes don't paint
    // on the very first render — only after some interaction (like
    // touching a filter) forces the browser to repaint. This is a known
    // quirk with position:sticky + horizontal overflow scrolling on
    // mobile Chrome/WebView; reading offsetHeight forces layout to run
    // immediately instead of lazily.
    void tbodyArrears.offsetHeight;

    // Extra safety net: nudge the scroll container by 1px and back.
    // This forces the browser to actually recompute/repaint the
    // horizontally-scrolled region rather than leaving it in whatever
    // stale compositing state it was in before the render.
    const scrollEl = document.querySelector(".table-scroll");
    if (scrollEl) {
        requestAnimationFrame(() => {
            const original = scrollEl.scrollLeft;
            scrollEl.scrollLeft = original + 1;
            requestAnimationFrame(() => {
                scrollEl.scrollLeft = original;
            });
        });
    }
}

// ========================================
// ROW CLICK -> REASON ARREAR PANEL
// ========================================

tbodyArrears.addEventListener("click", (e) => {
    const tr = e.target.closest("tr[data-index]");
    if (!tr) return;

    const idx = Number(tr.dataset.index);
    const row = currentRows[idx];
    if (!row) return;

    document.querySelectorAll("#tbodyArrears tr").forEach(r => r.classList.remove("row-selected"));
    tr.classList.add("row-selected");

    openReasonPanel(row);
});

function openReasonModal() {
    reasonBackdrop.classList.add("show");
}

function closeReasonModal() {
    reasonBackdrop.classList.remove("show");
    selectedRow = null;
}

// click on the dark backdrop itself (not the card) closes the modal
reasonBackdrop.addEventListener("click", (e) => {
    if (e.target === reasonBackdrop) closeReasonModal();
});

document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && reasonBackdrop.classList.contains("show")) {
        closeReasonModal();
    }
});

async function openReasonPanel(row) {
    selectedRow = row;

    reasonSubtitle.textContent = `${row.loanNumber} — ${row.customer}`;
    reasonAJ.value = "";
    reasonAK.value = "";
    reasonAL.value = "";
    reasonMeta.textContent = "";
    openReasonModal();

    if (!row.concate) {
        notify("This row has no Concate key — cannot load/save its reason.", "warning");
        return;
    }

    try {
        const res = await fetch(`${API.BASE_URL}/api/reasonarrear/get`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${arrearsToken}`
            },
            body: JSON.stringify({ cifs: [row.concate] })
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.message || "Failed to load reason.");

        const found = (data.data || [])[0];
        if (found) {
            reasonAJ.value = found.aj || "";
            reasonAK.value = found.ak || "";
            reasonAL.value = found.al ? found.al.slice(0, 10) : "";
            if (found.uploadedBy) {
                const when = found.uploadedAt ? new Date(found.uploadedAt).toLocaleString() : "";
                reasonMeta.textContent = `Last updated by ${found.uploadedBy}${when ? " on " + when : ""}`;
            }
        }
    } catch (err) {
        console.error(err);
        notify(err.message || "Could not load reason arrear.", "error");
    }
}

document.getElementById("btnReasonCancel").addEventListener("click", closeReasonModal);

document.getElementById("btnReasonSave").addEventListener("click", async () => {
    if (!selectedRow || !selectedRow.concate) {
        notify("No row selected.", "warning");
        return;
    }

    const alValue = reasonAL.value ? `${reasonAL.value}T00:00:00.000Z` : "";
    const uploadedBy =
        JSON.parse(localStorage.getItem("loggedInUser") || sessionStorage.getItem("loggedInUser") || "{}").fullname
        || "unknown";

    if (typeof showAppLoading === "function") {
        showAppLoading("Saving reason arrear...");
    }

    try {
        const res = await fetch(`${API.BASE_URL}/api/reasonarrear/upsert`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${arrearsToken}`
            },
            body: JSON.stringify({
                uploadedBy,
                rows: [[selectedRow.concate, reasonAJ.value, reasonAK.value, alValue]]
            })
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.message || "Save failed.");

        // Update the row in place rather than re-fetching from the server:
        // the bulk table data lives in a separate collection (arreast24byco)
        // that only picks up Reason Arrear changes on the next Excel
        // Upload_ArreasT24ByCO sync, so a full refetch here would show no
        // visible change yet. selectedRow is the same object referenced by
        // both allRows and currentRows, so mutating it and re-rendering
        // updates the table immediately and correctly.
        selectedRow.ajReason = reasonAJ.value;
        selectedRow.akSolution = reasonAK.value;
        selectedRow.alFollowup = reasonAL.value ? formatRowDateDMY(alValue) : "";

        const updatedInfo = (data.updated || [])[0];
        if (updatedInfo) {
            selectedRow.user = updatedInfo.uploadedBy || selectedRow.user;
            selectedRow.dateBackup = updatedInfo.uploadedAt
                ? formatRowDateTime12h(updatedInfo.uploadedAt)
                : selectedRow.dateBackup;
        }

        renderTable(currentRows);

        notify("Reason arrear saved.", "success");
        closeReasonModal();
    } catch (err) {
        console.error(err);
        notify(err.message || "Could not save reason arrear.", "error");
    } finally {
        if (typeof hideAppLoading === "function") {
            hideAppLoading();
        }
    }
});

// ========================================
// TOOLBAR ACTIONS
// ========================================

async function refreshArrears() {
    if (typeof showAppLoading === "function") {
        showAppLoading("Loading arrears data...");
    }
    try {
        const [rows] = await Promise.all([
            fetchAllArrearsRows(),
            fetchArrearsInfo()
        ]);
        allRows = rows;
        populateFilterOptions();
        applyFilters();
    } catch (err) {
        console.error(err);
        notify(err.message || "Failed to load arrears data.", "error");
        tbodyArrears.innerHTML = `<tr class="row-empty"><td colspan="26">Failed to load data</td></tr>`;
    } finally {
        if (typeof hideAppLoading === "function") {
            hideAppLoading();
        }
    }
}

function exportArrears() {
    if (!currentRows.length) {
        notify("Nothing to export.", "warning");
        return;
    }
    const sheetData = currentRows.map((row, i) => ({
        No: i + 1,
        "Loan Number": row.loanNumber,
        Customer: row.customer,
        Location: row.location,
        DisDate: row.disDate,
        "Prn.OS": row.prnOS,
        "Int.OS": row.intOS,
        "Prn.Due": row.prnDue,
        "Int.Due": row.intDue,
        Penalty: row.penalty,
        Arreas: row.arreas,
        Day: row.day,
        Balnce: row.balance,
        "Account Loan": row.accountLoan,
        Tell: row.tell,
        CIF: row.cif,
        Occu: row.occu,
        Ministry: row.ministry,
        "Promise Status": row.promiseStatus,
        CO_ID: row.coId,
        "CIF_អ្នករួមខ្ចី": row.cifCoborrower,
        "មុខរបរ": row.ajReason,
        "មូលហេតុ/ដំណោះស្រាយ": row.akSolution,
        "ថ្ងៃសន្យាសង": row.alFollowup,
        User: row.user,
        DateBackUpReasonArrear: row.dateBackup
    }));

    const ws = XLSX.utils.json_to_sheet(sheetData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Arrears");
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "");
    XLSX.writeFile(wb, `Arrears_${stamp}.xlsx`);
}

document.getElementById("btnClear").addEventListener("click", clearFilters);
document.getElementById("btnRefresh").addEventListener("click", refreshArrears);
document.getElementById("btnExport").addEventListener("click", exportArrears);
document.getElementById("btnPrint").addEventListener("click", () => window.print());

Object.entries(filterEls).forEach(([key, el]) => {
    if (key === "branch") return; // has its own dedicated listener above
    el.addEventListener(el.tagName === "SELECT" ? "change" : "input", applyFilters);
});


// ========================================
// PAGE READY
// ========================================

refreshArrears();
console.log("Daily Arrears Ready.");
