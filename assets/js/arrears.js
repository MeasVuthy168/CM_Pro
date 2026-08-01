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
const reasonGPS = document.getElementById("reasonGPS");
const reasonInfo = document.getElementById("reasonInfo");
const reasonGpsHint = document.getElementById("reasonGpsHint");
const reasonNavPos = document.getElementById("reasonNavPos");
const reasonMeta = document.getElementById("reasonMeta");

let allRows = [];        // every row, parsed to objects, unfiltered
let currentRows = [];    // whatever's currently displayed (post-filter)
let selectedRow = null;  // row object behind the open Reason Arrear panel

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
    runWithLoading(() => {
        populateOfficerOptions();
        applyFilters();
    });
});

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
    const BATCH_SIZE = 5; // fetch this many pages concurrently before checking if more exist
    let startRow = 6; // matches the sheet's own data start row
    let all = [];
    let reachedEnd = false;

    // Previously this awaited one page at a time — for ~4000 rows
    // that's 4-5 full sequential round-trips. Since the server
    // already handles startRow going past the actual data gracefully
    // (returns a short/empty page — that's how "reached the end" was
    // always detected), it's safe to speculatively fire several pages
    // at once and only pay for extra latency once every BATCH_SIZE
    // pages, instead of on every single page.
    while (!reachedEnd) {
        const batchRequests = [];
        for (let i = 0; i < BATCH_SIZE; i++) {
            const thisStartRow = startRow + i * limit;
            const url = `${API.BASE_URL}/api/arreast24byco/rows?startRow=${thisStartRow}&limit=${limit}&cols=41`;
            batchRequests.push(
                fetch(url, { headers: { Authorization: `Bearer ${arrearsToken}` } })
                    .then(res => {
                        if (!res.ok) throw new Error(`HTTP ${res.status}`);
                        return res.json();
                    })
            );
        }

        const results = await Promise.all(batchRequests);

        for (const data of results) {
            if (!data.ok) throw new Error(data.message || "Failed to load arrears data.");
            const rows = data.rows || [];
            all = all.concat(rows);
            if (rows.length < limit) {
                reachedEnd = true;
                break; // any pages later in this same batch would just be empty — no need to keep counting
            }
        }

        startRow += BATCH_SIZE * limit;
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
    applyFilters();
}

// ========================================
// LOADING WRAPPER
// Filtering + re-rendering ~2871 rows is synchronous JS, which can
// block the main thread just long enough to feel like a freeze on
// slower phones. showAppLoading() alone wouldn't actually appear
// on screen before that work runs (same synchronous call stack —
// the browser never gets a chance to paint), so this shows the
// loading state, then defers the real work one tick via setTimeout
// so the browser paints first, then hides loading once done.
// ========================================

function runWithLoading(fn, message = "សូមរង់ចាំ...") {
    if (typeof showAppLoading === "function") {
        showAppLoading(message);
    }
    setTimeout(() => {
        try {
            fn();
        } finally {
            if (typeof hideAppLoading === "function") {
                hideAppLoading();
            }
        }
    }, 20);
}

// Debounced so rapid typing in the keyword box doesn't trigger a
// full filter/render/loading-flash on every keystroke.
function debounce(fn, delay) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), delay);
    };
}

const applyFiltersDebounced = debounce(() => runWithLoading(applyFilters), 350);

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
function formatDateTime24h(isoString) {
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

    return `${yyyy}-${mm}-${dd} ${hh}:${min} ${ampm}`;
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

// dd/mm/yyyy — for DisDate, ថ្ងៃសន្យាសង, and DateBackUpReasonArrear
function formatRowDateDMY(value) {
    const d = parseFlexibleDate(value);
    if (!d) return value || "";
    const pad = n => String(n).padStart(2, "0");
    return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

// yyyy-mm-dd hh:mm AM/PM — for DateBackUpReasonArrear
// Cambodia is UTC+7 with no DST. Shifting the timestamp by 7 hours
// and then reading it with UTC getters gives a consistent Cambodia
// wall-clock time regardless of what timezone the viewing device
// itself happens to be set to — more robust than relying on the
// browser's local timezone (toLocaleString()), which is what caused
// the table (previously plain UTC) and the modal (device-local time)
// to show different hours for the exact same timestamp.
function toCambodiaTime(d) {
    return new Date(d.getTime() + 7 * 60 * 60 * 1000);
}

function formatRowDateTime12h(value) {
    const raw = parseFlexibleDate(value);
    if (!raw) return value || "";
    const d = toCambodiaTime(raw);
    const pad = n => String(n).padStart(2, "0");

    let h = d.getUTCHours();
    const ampm = h >= 12 ? "PM" : "AM";
    h = h % 12;
    if (h === 0) h = 12;

    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(h)}:${pad(d.getUTCMinutes())} ${ampm}`;
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
let lastUploadAtRaw = null; // kept for the Export PDF filename — display text is already 12h-formatted, this preserves the exact source value

async function fetchArrearsInfo() {
    try {
        const res = await fetch(`${API.BASE_URL}/api/arreast24byco/info`, {
            headers: { Authorization: `Bearer ${arrearsToken}` }
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.message || "Failed to load upload info.");

        lastUploadAtRaw = data.lastUploadAt || null;
        lastUploadAtEl.textContent = formatDateTime24h(data.lastUploadAt);
        lastUploadByEl.textContent = data.lastUploadedBy || "-";
    } catch (err) {
        console.error(err);
        lastUploadAtRaw = null;
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

let __hasRenderedOnce = false; // used below to skip the paint-forcing fix after the first render

// ========================================
// BATCHED RENDERING
// With ~4000 rows × 26 columns, building the full table on every
// filter/search interaction means creating ~100,000 DOM nodes
// synchronously — long enough to block the main thread and feel like
// a genuine freeze, not just "slow". Instead: render an initial batch
// immediately, then append more as the user scrolls near the bottom
// of .table-scroll. Filtering/searching still only has to build the
// first batch's worth of rows, not the entire result set.
// ========================================

const RENDER_BATCH_SIZE = 300;
let renderedCount = 0;          // how many of the CURRENT currentRows are in the DOM
let customerCountsForRender = new Map(); // duplicate-detection map, computed once per renderTable() call

function buildRowElement(row, index) {
    const tr = document.createElement("tr");
    tr.dataset.index = index;

    const rowClassCss = classRowCssClass(row.class);
    if (rowClassCss) tr.classList.add(rowClassCss);

    const arreaClass = (parseFloat(row.arreas) || 0) > 0 ? "cell-negative" : "";
    const balClass = (parseFloat(row.balance) || 0) < 0 ? "cell-negative" : "";
    const balPdClass = row.pd === "Balanced_PD" ? "cell-balance-pd" : "";
    const dupClass = (customerCountsForRender.get(row.customer) || 0) > 1 ? "cell-duplicate-customer" : "";

    const promiseCss = promiseCellCssClass(row.promiseStatus);
    const followupCssBase = promiseCss || "cell-followup-default";
    const followupCss = row.__pendingSubmit ? `${followupCssBase} cell-pending-local` : followupCssBase;

    tr.innerHTML = `
        <td>${index + 1}</td>
        <td class="${dupClass}">${escapeHtml(row.customer)}</td>
        <td>${escapeHtml(row.loanNumber)}</td>
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
    return tr;
}

function appendMoreRows() {
    if (renderedCount >= currentRows.length) return;

    const start = renderedCount;
    const end = Math.min(start + RENDER_BATCH_SIZE, currentRows.length);

    const frag = document.createDocumentFragment();
    for (let i = start; i < end; i++) {
        frag.appendChild(buildRowElement(currentRows[i], i));
    }
    tbodyArrears.appendChild(frag);
    renderedCount = end;

    const note = document.getElementById("renderedCountNote");
    if (note) {
        note.textContent = renderedCount < currentRows.length
            ? `កំពុងបង្ហាញ ${renderedCount.toLocaleString()} នៃ ${currentRows.length.toLocaleString()} — រំកិលចុះក្រោមដើម្បីមើលបន្ថែម`
            : `បង្ហាញទាំងអស់ ${currentRows.length.toLocaleString()}`;
    }
}

// Infinite-scroll trigger — appends the next batch when the user
// scrolls near the bottom of the table.
document.querySelector(".table-scroll")?.addEventListener("scroll", () => {
    const el = document.querySelector(".table-scroll");
    if (!el || renderedCount >= currentRows.length) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 300) {
        appendMoreRows();
    }
});

function renderTable(rows) {
    tbodyArrears.innerHTML = "";
    renderedCount = 0;

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
    // Computed once here for the WHOLE result set (not per-batch),
    // since duplicate detection needs to see all matching rows
    // regardless of which batch each one ends up rendered in.
    customerCountsForRender = new Map();
    rows.forEach(row => {
        if (!row.customer) return;
        customerCountsForRender.set(row.customer, (customerCountsForRender.get(row.customer) || 0) + 1);
    });

    appendMoreRows(); // renders the first batch only

    // This paint-forcing fix is only needed ONCE, on the very first
    // render after data loads — that's when the "far-right columns
    // don't paint until touched" bug actually happens (a known quirk
    // with position:sticky + horizontal overflow scrolling on mobile
    // WebViews). Once that first paint has correctly established the
    // compositing layer, subsequent renders (every filter keystroke,
    // every search) don't need this anymore — running a synchronous
    // reflow + double requestAnimationFrame scroll-nudge on every
    // single re-render was pure unnecessary cost.
    if (!__hasRenderedOnce) {
        void tbodyArrears.offsetHeight;

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
        __hasRenderedOnce = true;
    }
}

// ========================================
// SURGICAL SINGLE-ROW UPDATE
// After saving a Reason Arrear, only 6 cells on ONE row can have
// actually changed (Promise Status, មុខរបរ, មូលហេតុ/ដំណោះស្រាយ,
// ថ្ងៃសន្យាសង, User, DateBackUpReasonArrear). Calling the full
// renderTable(currentRows) for that was rebuilding the entire visible
// table (up to ~2871 rows) just to reflect one row's change — this
// updates only the matching cells on the matching <tr> directly.
// Column indexes below (0-based) must match the <td> order in
// renderTable()'s template exactly — if that template's column order
// ever changes, these indexes need updating too.
// ========================================

function updateRowInTable(row) {
    const idx = currentRows.indexOf(row);
    if (idx === -1) return false; // row isn't in the currently-filtered view — nothing on screen to update

    const tr = tbodyArrears.querySelector(`tr[data-index="${idx}"]`);
    if (!tr) return false;

    const cells = tr.children;
    if (cells.length < 26) return false; // sanity check — fall back to full render if structure looks unexpected

    const promiseCss = promiseCellCssClass(row.promiseStatus);
    const followupCss = promiseCss || "cell-followup-default";
    const pendingCss = row.__pendingSubmit ? " cell-pending-local" : "";

    cells[18].textContent = row.promiseStatus; // Promise Status
    cells[18].className = promiseCss;

    cells[21].textContent = row.ajReason;      // មុខរបរ
    cells[21].className = followupCss + pendingCss;

    cells[22].textContent = row.akSolution;    // មូលហេតុ/ដំណោះស្រាយ
    cells[22].className = followupCss + pendingCss;

    cells[23].textContent = formatRowDateDMY(row.alFollowup); // ថ្ងៃសន្យាសង
    cells[23].className = followupCss + pendingCss;

    cells[24].textContent = row.user;          // User

    cells[25].textContent = formatRowDateTime12h(row.dateBackup); // DateBackUpReasonArrear

    return true;
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

// ========================================
// REASON ARREAR — VIEW (fetch fresh data from MongoDB)
// Mirrors the VBA sheet's ViewReasonArreas_Mongo: pulls the canonical
// aj/ak/al/uploadedBy/uploadedAt for a batch of Concate keys and
// overlays it onto the in-memory rows. Used both after saving a
// single row, and to refresh the whole table's Reason Arrear columns
// on load (since arreast24byco only reflects reasonarrear as of the
// last Excel Upload_ArreasT24ByCO sync — this keeps the web app's
// display current even when it's ahead of that sync).
// ========================================

async function fetchReasonArrearData(concateValues) {
    const CHUNK = 800; // matches the VBA module's own GET_CHUNK

    const chunks = [];
    for (let i = 0; i < concateValues.length; i += CHUNK) {
        const chunk = concateValues.slice(i, i + CHUNK);
        if (chunk.length) chunks.push(chunk);
    }

    // Fire all chunks concurrently rather than awaiting them one at a
    // time — for ~2871 rows that's ~4 requests running in parallel
    // instead of sequentially, roughly a 4x cut in wait time. Each
    // chunk is independent, so there's no ordering requirement here.
    const results = await Promise.all(chunks.map(async (chunk) => {
        try {
            const res = await fetch(`${API.BASE_URL}/api/reasonarrear/get`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${arrearsToken}`
                },
                body: JSON.stringify({ cifs: chunk })
            });
            const data = await res.json();
            return data.ok ? (data.data || []) : [];
        } catch (err) {
            console.error("[reasonarrear] chunk fetch failed:", err);
            return []; // this chunk's rows just won't get overlaid, rest continue
        }
    }));

    const map = new Map();
    results.flat().forEach(item => {
        if (item.cif) map.set(item.cif, item);
    });

    return map;
}

// Mirrors VBA's StatusFromDate exactly: compares the follow-up date
// (AL) against today, in whole days.
//   diff == 0  -> "Today_Payment"
//   diff  > 0  -> "Upcoming_left: N Days"
//   diff  < 0  -> "Expired: N Days"
//   no date    -> "" (matches VBA's blank case, not "Not Yet Followup"
//                  — that VBA line is commented out in the source)
function computeStatusFromDate(alFollowupDMY) {
    if (!alFollowupDMY) return "";

    const parts = alFollowupDMY.split("/");
    if (parts.length !== 3) return "";
    const [dd, mm, yyyy] = parts.map(Number);
    if (!dd || !mm || !yyyy) return "";

    const followup = Date.UTC(yyyy, mm - 1, dd);
    const now = new Date();
    const todayUTC = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());

    const diffDays = Math.round((followup - todayUTC) / 86400000);

    if (diffDays === 0) return "Today_Payment";
    if (diffDays > 0) return `Upcoming_left: ${diffDays} Days`;
    return `Expired: ${Math.abs(diffDays)} Days`;
}

function applyReasonArrearOverlay(rows, map) {
    rows.forEach(row => {
        if (row.concate) {
            const found = map.get(row.concate);
            if (found) {
                row.ajReason = found.aj || "";
                row.akSolution = found.ak || "";
                row.alFollowup = found.al ? formatRowDateDMY(found.al) : "";
                row.user = found.uploadedBy || row.user;
                row.dateBackup = found.uploadedAt || row.dateBackup;
            }
        }

        // Mirrors VBA's RefreshReasonArrearStatus — recomputed for
        // EVERY row (not just ones with a fresh overlay match), using
        // whatever alFollowup currently holds, exactly matching how
        // the VBA sub does a blanket refresh over the whole sheet.
        // This is what was missing: after a save, the reason/date
        // fields updated but Promise Status stayed stale until the
        // next full page reload.
        row.promiseStatus = computeStatusFromDate(row.alFollowup);
    });
}

// ========================================
// LOCAL PENDING REASON CHANGES
// Save (in the modal) no longer hits the server at all — it writes
// to localStorage instantly. Submit Reason (or the global Submit All
// button) is what actually pushes everything to the server, in one
// batch, whenever the user is ready. This is the whole point: saving
// used to mean a ~10s network round-trip per row; now it's instant,
// and the network cost only happens once, however many rows were
// edited in between.
// ========================================

const PENDING_STORAGE_KEY = "cmpro_pending_reasons";

function getPendingReasonsMap() {
    try {
        return JSON.parse(localStorage.getItem(PENDING_STORAGE_KEY) || "{}");
    } catch (err) {
        console.error("[pending reasons] corrupt localStorage data, resetting:", err);
        return {};
    }
}

function setPendingReason(concate, aj, ak, alISO, gps) {
    const map = getPendingReasonsMap();
    map[concate] = {
        aj,
        ak,
        al: alISO,
        gps: gps || "",
        savedAt: new Date().toISOString()
    };
    localStorage.setItem(PENDING_STORAGE_KEY, JSON.stringify(map));
    updatePendingBadge();
}

function removePendingReasons(concates) {
    const map = getPendingReasonsMap();
    concates.forEach(c => delete map[c]);
    localStorage.setItem(PENDING_STORAGE_KEY, JSON.stringify(map));
    updatePendingBadge();
}

function getPendingCount() {
    return Object.keys(getPendingReasonsMap()).length;
}

function updatePendingBadge() {
    const count = getPendingCount();
    const pendingRow = document.getElementById("pendingRow");
    const pendingCountEl = document.getElementById("pendingCount");
    if (pendingCountEl) pendingCountEl.textContent = count.toLocaleString();
    if (pendingRow) pendingRow.style.display = count > 0 ? "flex" : "none";
}

// Applies any locally-saved-but-not-yet-submitted changes on top of
// the given rows — local edits represent the user's most recent
// intent and take priority over whatever the server currently has.
// Called once after every load, so pending work survives a refresh
// or even closing the browser before submitting.
function applyPendingReasonsToRows(rows) {
    const map = getPendingReasonsMap();
    if (!Object.keys(map).length) return;

    rows.forEach(row => {
        if (!row.concate || !map[row.concate]) return;
        const pending = map[row.concate];
        row.ajReason = pending.aj || "";
        row.akSolution = pending.ak || "";
        row.alFollowup = pending.al ? formatRowDateDMY(pending.al) : "";
        row.promiseStatus = computeStatusFromDate(row.alFollowup);
        row.__pendingSubmit = true;
    });
}

// Batch-submits ALL pending local changes in one request (chunked at
// 1000, matching the VBA module's own UP_CHUNK), then re-fetches the
// confirmed data and clears the local pending store for whatever
// succeeded.
async function submitAllPendingReasons() {
    const map = getPendingReasonsMap();
    const concates = Object.keys(map);

    if (!concates.length) {
        notify("មិនមានទិន្នន័យត្រូវដាក់ស្នើទេ", "warning");
        return;
    }

    const uploadedBy =
        JSON.parse(localStorage.getItem("loggedInUser") || sessionStorage.getItem("loggedInUser") || "{}").fullname
        || "unknown";

    if (typeof showAppLoading === "function") {
        showAppLoading(`កំពុងដាក់ស្នើ ${concates.length} កំណត់ត្រា...`);
    }

    try {
        const UP_CHUNK = 1000;
        for (let i = 0; i < concates.length; i += UP_CHUNK) {
            const chunkConcates = concates.slice(i, i + UP_CHUNK);
            // The 5th element tells the server this client manages GPS. Always
            // sent, even when empty, so clearing a coordinate actually clears
            // it server-side. (The VBA still sends 4 — see the backend note.)
            const chunkRows = chunkConcates.map(c =>
                [c, map[c].aj, map[c].ak, map[c].al, map[c].gps || ""]
            );

            const res = await fetch(`${API.BASE_URL}/api/reasonarrear/upsert`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${arrearsToken}`
                },
                body: JSON.stringify({ uploadedBy, rows: chunkRows })
            });
            const data = await res.json();
            if (!data.ok) throw new Error(data.message || "Submit failed.");
        }

        // Mirror VBA: after the upsert, pull the confirmed data back
        // (View step) rather than trusting the upsert response alone.
        const reasonMap = await fetchReasonArrearData(concates);
        concates.forEach(concate => {
            const row = allRows.find(r => r.concate === concate);
            if (row) {
                applyReasonArrearOverlay([row], reasonMap);
                row.__pendingSubmit = false;
            }
        });

        removePendingReasons(concates);
        renderTable(currentRows); // multiple rows changed — full re-render is correct here

        notify(`បានដាក់ស្នើដោយជោគជ័យ (${concates.length})`, "success");
    } catch (err) {
        console.error(err);
        notify(err.message || "ការដាក់ស្នើបរាជ័យ — ទិន្នន័យនៅតែរក្សាទុកក្នុងម៉ាស៊ីន", "error");
        // deliberately NOT clearing pending storage on failure — the
        // user's edits stay safe locally and they can retry submit
    } finally {
        if (typeof hideAppLoading === "function") {
            hideAppLoading();
        }
    }
}

// Discards local pending edits for the given concate values, restoring
// each affected row to whatever the server currently has (or blank,
// if the server has no record at all for that row). Used by both the
// global "បោះបង់" button and the per-row cancel link inside the modal.
async function cancelPendingReasons(concates) {
    if (!concates.length) return;

    if (typeof showAppLoading === "function") {
        showAppLoading("កំពុងបោះបង់...");
    }

    try {
        const reasonMap = await fetchReasonArrearData(concates);
        concates.forEach(concate => {
            const row = allRows.find(r => r.concate === concate);
            if (!row) return;

            const found = reasonMap.get(concate);
            if (found) {
                row.ajReason = found.aj || "";
                row.akSolution = found.ak || "";
                row.alFollowup = found.al ? formatRowDateDMY(found.al) : "";
                row.user = found.uploadedBy || "";
                row.dateBackup = found.uploadedAt || "";
            } else {
                row.ajReason = "";
                row.akSolution = "";
                row.alFollowup = "";
            }
            row.promiseStatus = computeStatusFromDate(row.alFollowup);
            row.__pendingSubmit = false;
        });
    } catch (err) {
        console.error("[cancel pending] failed to restore server state:", err);
        notify("មិនអាចទាញយកទិន្នន័យដើម — ការកែប្រែក្នុងម៉ាស៊ីនត្រូវបានលុបទោះជាយ៉ាងណា", "warning");
    } finally {
        if (typeof hideAppLoading === "function") {
            hideAppLoading();
        }
    }

    removePendingReasons(concates);
    renderTable(currentRows);
}

document.getElementById("btnCancelAllPending")?.addEventListener("click", async () => {
    const concates = Object.keys(getPendingReasonsMap());
    if (!concates.length) return;

    if (!confirm(`តើអ្នកពិតជាចង់បោះបង់ការកែប្រែក្នុងម៉ាស៊ីនចំនួន ${concates.length} ដែរឬទេ?`)) return;

    await cancelPendingReasons(concates);
    notify("បានបោះបង់ការកែប្រែក្នុងម៉ាស៊ីនទាំងអស់", "success");
});


// ========================================
// REASON ARREAR — info block, GPS, record navigation
// ========================================

// Loan context shown under the title. Read-only — these come from the
// arrears row itself, not the reason record, so they're never saved back.
function renderReasonInfo(row) {
    if (!reasonInfo) return;

    // ផលិតផល carries the digital/non-digital split, since the product
    // name alone doesn't say which side it falls on.
    const product = String(row.product ?? "").trim();
    const productLabel = product
        ? `${product} - ${DIGITAL_PRODUCTS.includes(product) ? "Digital Loan" : "Non Digital Loan"}`
        : "";

    // មុខរបរ combines occupation and ministry — either can be blank.
    const occu = [row.occu, row.ministry]
        .map(v => String(v ?? "").trim())
        .filter(v => v && v !== "-")
        .join(", ");

    const items = [
        ["អាស័យដ្ឋាន", row.location],
        ["ថ្ងៃយឺត", row.day],
        ["មុខរបរ", occu],
        ["ចំណាត់ថ្នាក់", row.class],
        ["ផលិតផល", productLabel]
    ];

    reasonInfo.innerHTML = items
        // Blank fields are dropped rather than shown as empty rows —
        // the modal is already tall on a phone.
        .filter(([, v]) => String(v ?? "").trim() !== "")
        .map(([label, value]) =>
            `<div class="reason-info-row">` +
              `<span class="reason-info-label">${label}</span>` +
              `<span class="reason-info-value">${escapeHtml(String(value))}</span>` +
            `</div>`
        ).join("");
}

// These values come from uploaded spreadsheet data, which shouldn't
// contain markup — but they're injected via innerHTML, so escape anyway.
function escapeHtml(s) {
    return s.replace(/[&<>"']/g, c => (
        { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
}

// Accepts "11.5564, 104.9282" or "11.5564,104.9282".
// Returns null when it isn't a usable coordinate pair.
function parseGps(text) {
    const m = String(text || "").trim().match(
        /^(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$/
    );
    if (!m) return null;

    const lat = parseFloat(m[1]);
    const lng = parseFloat(m[2]);
    if (!isFinite(lat) || !isFinite(lng)) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

    return { lat, lng };
}

// "មើលលើផែនទី" is hidden until there's a valid coordinate — offering
// it with nothing to show would just produce an error toast.
function updateGpsButtons() {
    const btnOpen = document.getElementById("btnGpsOpen");
    if (!btnOpen || !reasonGPS) return;
    btnOpen.style.display = parseGps(reasonGPS.value) ? "" : "none";
}

function setGpsHint(message, kind) {
    if (!reasonGpsHint) return;
    reasonGpsHint.textContent = message || "";
    reasonGpsHint.className = "reason-gps-hint" + (kind ? " " + kind : "");
}

// Validate as the person types, so a bad value is caught before saving
// rather than stored and silently failing to open later.
reasonGPS?.addEventListener("input", () => {
    updateGpsButtons();
    const raw = reasonGPS.value.trim();
    if (!raw) { setGpsHint("", ""); return; }
    const ok = !!parseGps(raw);
    setGpsHint(
        ok ? "ទីតាំងត្រឹមត្រូវ" : "ទម្រង់មិនត្រឹមត្រូវ — ឧ. 11.5564, 104.9282",
        ok ? "ok" : "bad"
    );
});

// Fill from the device's current position.
document.getElementById("btnGpsHere")?.addEventListener("click", () => {
    if (!navigator.geolocation) {
        notify("ឧបករណ៍នេះមិនអាចកំណត់ទីតាំងបានទេ", "warning");
        return;
    }

    setGpsHint("កំពុងកំណត់ទីតាំង...", "");

    navigator.geolocation.getCurrentPosition(
        pos => {
            // 6dp is ~0.1m — far past what an address needs, and short
            // enough to stay readable in the input.
            const lat = pos.coords.latitude.toFixed(6);
            const lng = pos.coords.longitude.toFixed(6);
            reasonGPS.value = `${lat}, ${lng}`;
            updateGpsButtons();
            setGpsHint(`ភាពត្រឹមត្រូវ ±${Math.round(pos.coords.accuracy)}m`, "ok");
        },
        err => {
            // Permission denial is the common case and worth naming: the
            // browser prompt may have been dismissed earlier and won't
            // reappear on its own.
            setGpsHint(
                err.code === err.PERMISSION_DENIED
                    ? "សូមអនុញ្ញាតការចូលប្រើទីតាំង"
                    : "មិនអាចកំណត់ទីតាំងបានទេ",
                "bad"
            );
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
});

// Open in the platform's map app.
document.getElementById("btnGpsOpen")?.addEventListener("click", () => {
    const coords = parseGps(reasonGPS.value);
    if (!coords) {
        notify("សូមបញ្ចូលទីតាំងជាមុនសិន", "warning");
        return;
    }

    const { lat, lng } = coords;

    // maps.apple.com rather than the maps:// scheme, so it still resolves
    // in contexts that block custom schemes.
    const isApple = /iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent);
    const url = isApple
        ? `https://maps.apple.com/?q=${lat},${lng}`
        : `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;

    window.open(url, "_blank", "noopener");
});

// ---- record navigation ----
// Walks currentRows, so it follows the active filter and sort rather
// than the unfiltered set.
function reasonNavIndex() {
    if (!selectedRow) return -1;
    return currentRows.findIndex(r => r.concate === selectedRow.concate);
}

function updateReasonNav() {
    const i = reasonNavIndex();
    const total = currentRows.length;

    if (reasonNavPos) {
        reasonNavPos.textContent = i >= 0 ? `${i + 1} / ${total}` : "-";
    }

    const prev = document.getElementById("btnReasonPrev");
    const next = document.getElementById("btnReasonNext");
    if (prev) prev.disabled = i <= 0;
    if (next) next.disabled = i < 0 || i >= total - 1;
}

// Unsaved edits are kept rather than silently dropped: moving away
// writes the current state to the same local pending store Save uses.
// Snapshot of the values the modal was opened with. Comparing against
// THIS (rather than against the local pending store) is what stops
// merely opening and navigating past a record from marking it as an
// unsaved edit — previously a record already carrying a reason from the
// server counted as "dirty" the moment it loaded, so paging through 10
// rows queued 10 phantom submissions.
let reasonBaseline = null;

function currentReasonValues() {
    return {
        aj: reasonAJ.value,
        ak: reasonAK.value,
        al: reasonAL.value ? `${reasonAL.value}T00:00:00.000Z` : "",
        gps: reasonGPS ? reasonGPS.value.trim() : ""
    };
}

function snapshotReasonBaseline() {
    reasonBaseline = currentReasonValues();
}

function reasonIsDirty() {
    if (!reasonBaseline) return false;
    const now = currentReasonValues();
    return now.aj !== reasonBaseline.aj ||
           now.ak !== reasonBaseline.ak ||
           now.al !== reasonBaseline.al ||
           now.gps !== reasonBaseline.gps;
}

// Writes the current values to the local pending store. Only called
// once the person has confirmed they want to keep the edit.
function commitReasonEdits() {
    if (!selectedRow || !selectedRow.concate) return;

    const { aj, ak, al, gps } = currentReasonValues();

    selectedRow.ajReason = aj;
    selectedRow.akSolution = ak;
    selectedRow.alFollowup = al ? formatRowDateDMY(al) : "";
    selectedRow.promiseStatus = computeStatusFromDate(selectedRow.alFollowup);
    selectedRow.__pendingSubmit = true;

    setPendingReason(selectedRow.concate, aj, ak, al, gps);
    updateRowInTable(selectedRow);
}

async function reasonNavStep(delta) {
    const i = reasonNavIndex();
    if (i < 0) return;

    const target = currentRows[i + delta];
    if (!target) return;

    // Unsaved edits would otherwise vanish without a word. Ask rather
    // than auto-saving: silently queueing a submission the person
    // didn't ask for is how the phantom-pending problem started.
    if (reasonIsDirty()) {
        const keep = confirm(
            "អ្នកមិនទាន់រក្សាទុកការកែប្រែទេ។\n\n" +
            "ចុច OK ដើម្បីរក្សាទុក ឬ Cancel ដើម្បីបោះបង់។"
        );
        if (keep) {
            const gps = reasonGPS ? reasonGPS.value.trim() : "";
            if (gps && !parseGps(gps)) {
                notify("ទម្រង់ GPS មិនត្រឹមត្រូវ — ឧ. 11.5564, 104.9282", "warning");
                reasonGPS.focus();
                return; // stay put so it can be corrected
            }
            commitReasonEdits();
        }
    }

    await openReasonPanel(target);
}

document.getElementById("btnReasonPrev")?.addEventListener("click", () => reasonNavStep(-1));
document.getElementById("btnReasonNext")?.addEventListener("click", () => reasonNavStep(1));

// Arrow keys move records too, but not while typing — otherwise arrowing
// through text in the reason box would jump rows.
document.addEventListener("keydown", (e) => {
    if (!reasonBackdrop.classList.contains("show")) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "")) return;

    if (e.key === "ArrowLeft") { e.preventDefault(); reasonNavStep(-1); }
    if (e.key === "ArrowRight") { e.preventDefault(); reasonNavStep(1); }
});

// Fetches a record purely to show who last submitted it. Deliberately
// does not touch the input fields — the local draft owns those.
async function loadReasonMetaOnly(concate) {
    try {
        const res = await fetch(`${API.BASE_URL}/api/reasonarrear/get`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${arrearsToken}`
            },
            body: JSON.stringify({ cifs: [concate] })
        });
        const data = await res.json();
        if (!data.ok) return;

        const found = (data.data || [])[0];
        if (found && found.uploadedBy) {
            const when = found.uploadedAt ? formatRowDateTime12h(found.uploadedAt) : "";
            reasonMeta.textContent =
                `Last updated by ${found.uploadedBy}${when ? " on " + when : ""}`;
        }
    } catch (err) {
        // Non-fatal: the draft is still fully usable without this line.
        console.warn("[reason meta]", err);
    }
}

async function openReasonPanel(row) {
    selectedRow = row;

    reasonSubtitle.textContent = `${row.loanNumber} - ${row.cif} — ${row.customer}`;
    renderReasonInfo(row);
    reasonAJ.value = "";
    reasonAK.value = "";
    reasonAL.value = "";
    if (reasonGPS) reasonGPS.value = "";
    setGpsHint("", "");
    updateGpsButtons();
    reasonMeta.textContent = "";
    updateReasonNav();
    openReasonModal();

    if (!row.concate) {
        notify("This row has no Concate key — cannot load/save its reason.", "warning");
        snapshotReasonBaseline();
        return;
    }

    // If there's already a local pending (unsubmitted) edit for this
    // row, show THAT instead of fetching from the server — it's the
    // user's own more-recent draft, not yet sent anywhere.
    const pendingMap = getPendingReasonsMap();
    const localPending = pendingMap[row.concate];
    const pendingNote = document.getElementById("reasonPendingNote");

    if (localPending) {
        reasonAJ.value = localPending.aj || "";
        reasonAK.value = localPending.ak || "";
        reasonAL.value = localPending.al ? localPending.al.slice(0, 10) : "";
        if (reasonGPS) reasonGPS.value = localPending.gps || "";
        updateGpsButtons();
        if (pendingNote) {
            pendingNote.innerHTML = "";
            pendingNote.append(
                `រក្សាទុកក្នុងម៉ាស៊ីននៅ ${new Date(localPending.savedAt).toLocaleString()} (មិនទាន់ដាក់ស្នើ) `
            );
            const cancelLink = document.createElement("button");
            cancelLink.type = "button";
            cancelLink.className = "reason-pending-cancel-link";
            cancelLink.textContent = "បោះបង់";
            cancelLink.addEventListener("click", async (e) => {
                e.stopPropagation();
                await cancelPendingReasons([row.concate]);
                notify("បានបោះបង់ការកែប្រែក្នុងម៉ាស៊ីន", "success");
                closeReasonModal();
            });
            pendingNote.appendChild(cancelLink);
            pendingNote.classList.add("show");
        }

        snapshotReasonBaseline();

        // The draft above is what's shown in the fields, but the server
        // still holds who last submitted this record — fetch it purely
        // for the meta line. (Previously this returned early, which is
        // why "Last updated by" disappeared once a local draft existed.)
        loadReasonMetaOnly(row.concate);
        return;
    }

    if (pendingNote) pendingNote.classList.remove("show");

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
            if (reasonGPS) reasonGPS.value = found.gps || "";
            if (found.uploadedBy) {
                const when = found.uploadedAt ? formatRowDateTime12h(found.uploadedAt) : "";
                reasonMeta.textContent = `Last updated by ${found.uploadedBy}${when ? " on " + when : ""}`;
            }
        }
    } catch (err) {
        console.error(err);
        notify(err.message || "Could not load reason arrear.", "error");
    }

    // Baseline AFTER loading, so server-supplied values count as the
    // starting point rather than as unsaved edits.
    snapshotReasonBaseline();
    updateGpsButtons();
}

document.getElementById("btnReasonCancel").addEventListener("click", closeReasonModal);

// SAVE — now local-only. Instant, no network call at all.
document.getElementById("btnReasonSave").addEventListener("click", () => {
    if (!selectedRow || !selectedRow.concate) {
        notify("No row selected.", "warning");
        return;
    }

    // Refuse a malformed coordinate rather than storing something that
    // won't open in a map later.
    const gpsRaw = reasonGPS ? reasonGPS.value.trim() : "";
    if (gpsRaw && !parseGps(gpsRaw)) {
        notify("ទម្រង់ GPS មិនត្រឹមត្រូវ — ឧ. 11.5564, 104.9282", "warning");
        reasonGPS.focus();
        return;
    }

    const alValue = reasonAL.value ? `${reasonAL.value}T00:00:00.000Z` : "";

    // Update in-memory row immediately so the table reflects the edit
    // right away, same as before — just without the server round-trip.
    selectedRow.ajReason = reasonAJ.value;
    selectedRow.akSolution = reasonAK.value;
    selectedRow.alFollowup = alValue ? formatRowDateDMY(alValue) : "";
    selectedRow.promiseStatus = computeStatusFromDate(selectedRow.alFollowup);
    selectedRow.__pendingSubmit = true;

    setPendingReason(selectedRow.concate, reasonAJ.value, reasonAK.value, alValue, gpsRaw);

    if (!updateRowInTable(selectedRow)) {
        renderTable(currentRows);
    }

    notify("បានរក្សាទុកក្នុងម៉ាស៊ីន — ចុច \"ដាក់ស្នើមូលហេតុ\" នៅពេលរួចរាល់", "success");
    closeReasonModal();
});

// SUBMIT REASON — pushes ALL pending local changes (not just this
// row) in one batch. This is deliberate: the whole point is letting
// users save many rows locally first, then submit once.
document.getElementById("btnReasonSubmit").addEventListener("click", async () => {
    await submitAllPendingReasons();
    closeReasonModal();
});

// Global "Submit All" button, reachable without opening any row's
// modal — same action as the in-modal Submit Reason button.
document.getElementById("btnSubmitAllPending")?.addEventListener("click", submitAllPendingReasons);

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
    } catch (err) {
        console.error(err);
        notify(err.message || "Failed to load arrears data.", "error");
        tbodyArrears.innerHTML = `<tr class="row-empty"><td colspan="26">Failed to load data</td></tr>`;
        if (typeof hideAppLoading === "function") hideAppLoading();
        return;
    }

    // Local pending (unsubmitted) edits take priority over whatever
    // the server has — they represent the user's most recent intent,
    // not yet sent anywhere. Applied here too (before the overlay
    // fetch below completes) so pending work is visible immediately,
    // not just after the background overlay finishes.
    applyPendingReasonsToRows(allRows);
    updatePendingBadge();

    // Show the table right away with bulk data — don't make the user
    // wait for the (separate, slower) Reason Arrear overlay too. This
    // is the biggest perceived-speed win: the table is usable in one
    // fetch's time instead of two sequential fetches' time.
    populateFilterOptions();
    applyFilters();
    if (typeof hideAppLoading === "function") hideAppLoading();

    // Mirrors VBA's ViewReasonArreas_Mongo: the bulk row data above
    // only reflects Reason Arrear as of the last Excel
    // Upload_ArreasT24ByCO sync — overlay the canonical, current data
    // from the reasonarrear collection on top so saves made through
    // this web app show up immediately, not just after the next
    // Excel sync. Runs in the background now — failures here are
    // non-fatal (the table already works fine with bulk data alone),
    // so this just logs rather than showing an error to the user.
    try {
        const concates = allRows.map(r => r.concate).filter(Boolean);
        const reasonMap = await fetchReasonArrearData(concates);
        applyReasonArrearOverlay(allRows, reasonMap);
        applyPendingReasonsToRows(allRows); // re-apply — local pending still wins over the fresh server overlay
        applyFilters(); // quiet re-render with the fresher data
    } catch (err) {
        console.error("[reasonarrear overlay] failed, table still shows bulk data:", err);
    }
}

function exportArrears() {
    if (!currentRows.length) {
        notify("Nothing to export.", "warning");
        return;
    }
    const sheetData = currentRows.map((row, i) => ({
        No: i + 1,
        Customer: row.customer,
        "Loan Number": row.loanNumber,
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
        DateBackUpReasonArrear: formatRowDateTime12h(row.dateBackup)
    }));

    const ws = XLSX.utils.json_to_sheet(sheetData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Arrears");
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "");
    XLSX.writeFile(wb, `Arrears_${stamp}.xlsx`);
}

document.getElementById("btnClear").addEventListener("click", () => runWithLoading(clearFilters, "កំពុងសម្អាត..."));
document.getElementById("btnRefresh").addEventListener("click", refreshArrears);
document.getElementById("btnExport").addEventListener("click", exportArrears);
// ========================================
// EXPORT PDF
// A real .pdf file, downloaded directly — not the print dialog.
// Browsers have no native "generate PDF" API, so this uses the
// standard approach: html2canvas rasterizes the styled page content,
// jsPDF assembles the resulting images into pages and triggers the
// download. Two things this specifically has to work around:
//   1. html2canvas captures whatever's on SCREEN — it does not know
//      about @media print rules at all. So the print-specific styling
//      (white backgrounds instead of navy, columns 1-19 only, etc.)
//      gets extracted from the stylesheet and re-injected as plain
//      (non-media-query) rules temporarily, right before capture.
//   2. A naive canvas slice cut at a fixed pixel height per page can
//      slice a table row in half across a page break. This measures
//      each <tr>'s actual position and only cuts BETWEEN rows.
// Known trade-off (mentioned before this was built): the output is a
// rasterized image embedded in the PDF, not real selectable/
// searchable text — that's inherent to this approach in a browser
// with no server-side rendering.
// ========================================

function buildExportPdfFilename() {
    const pad = n => String(n).padStart(2, "0");
    let datePart = "unknown-date";

    if (lastUploadAtRaw) {
        const raw = new Date(lastUploadAtRaw);
        if (!isNaN(raw.getTime())) {
            const d = toCambodiaTime(raw);
            datePart = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}_${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`;
        }
    }

    const officerName = (filterEls.officerResponse.value || "").trim();
    return `Arrear_${datePart}${officerName ? "_" + officerName : ""}`;
}

// Pulls every rule out of any @media print block in the loaded
// stylesheets and returns it as plain CSS text (no media-query
// wrapper), so it can be applied as regular styles temporarily.
function extractPrintCss() {
    let css = "";
    for (const sheet of document.styleSheets) {
        let rules;
        try {
            rules = sheet.cssRules;
        } catch (err) {
            continue; // cross-origin stylesheet (e.g. a CDN font) — can't read its rules, skip
        }
        for (const rule of rules) {
            if (rule.type === CSSRule.MEDIA_RULE && rule.media.mediaText.includes("print")) {
                for (const inner of rule.cssRules) {
                    css += inner.cssText + "\n";
                }
            }
        }
    }
    return css;
}

async function exportToPdf() {
    if (typeof html2canvas === "undefined" || typeof window.jspdf === "undefined") {
        notify("PDF export library failed to load — check your connection and try again.", "error");
        return;
    }

    if (typeof showAppLoading === "function") {
        showAppLoading("កំពុងបង្កើតឯកសារ PDF...");
    }

    const tempStyleEl = document.createElement("style");
    tempStyleEl.id = "pdf-export-temp-style";
    // Real print engines auto-reflow wide content to fit the physical
    // page — html2canvas does NOT do this, it just captures whatever
    // width the container is laid out at on screen right now (the
    // narrow mobile viewport). Without forcing every level of
    // container to its full natural content width here, only the
    // columns visible without horizontal scrolling get captured —
    // exactly the "lost columns 5-19" bug reported.
    tempStyleEl.textContent = extractPrintCss() + `
        html, body { overflow-x: visible !important; width: max-content !important; }
        .page-container { width: max-content !important; min-width: 100%; overflow: visible !important; }
        .table-card { width: max-content !important; overflow: visible !important; }
        .table-scroll { width: max-content !important; max-width: none !important; overflow: visible !important; }
        .table-card table { width: max-content !important; }
    `;
    document.head.appendChild(tempStyleEl);

    // Let the browser actually apply the injected styles and reflow
    // (sticky→static, columns 20+ hidden, colors changed, full-width
    // table) before html2canvas reads the resulting layout.
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    try {
        const container = document.querySelector(".page-container");
        const thead = document.querySelector(".table-card thead");
        const rows = Array.from(document.querySelectorAll(".table-card tbody tr"));

        const SCALE = 2; // retina-quality capture
        const fullCanvas = await html2canvas(container, { scale: SCALE, backgroundColor: "#ffffff" });

        const theadCanvas = thead
            ? await html2canvas(thead, { scale: SCALE, backgroundColor: "#ffffff" })
            : null;

        // A4 landscape at 96 DPI-equivalent proportions, scaled to match SCALE
        const pageWidthMm = 297, pageHeightMm = 210, marginMm = 10;

        // Page height in CAPTURE-canvas pixels, derived from the
        // aspect ratio of A4 landscape (minus margins) relative to
        // the full canvas's actual captured width.
        const usablePageWidthMm = pageWidthMm - marginMm * 2;
        const usablePageHeightMm = pageHeightMm - marginMm * 2;
        const capturePageHeightPx = fullCanvas.width * (usablePageHeightMm / usablePageWidthMm);

        // Row boundaries in CAPTURE-canvas pixel space (relative to container top)
        const containerRect = container.getBoundingClientRect();
        const rowBoundaries = rows.map(tr => {
            const r = tr.getBoundingClientRect();
            return (r.bottom - containerRect.top) * SCALE;
        });

        const theadHeightPx = theadCanvas ? theadCanvas.height : 0;

        const slices = [];
        let sliceStart = 0;
        let firstSlice = true;
        while (sliceStart < fullCanvas.height - 2) {
            const availableHeight = firstSlice ? capturePageHeightPx : (capturePageHeightPx - theadHeightPx);
            let sliceEnd = sliceStart + availableHeight;

            let bestCut = sliceEnd;
            for (const b of rowBoundaries) {
                if (b > sliceStart && b <= sliceEnd) bestCut = b;
            }
            if (bestCut <= sliceStart) bestCut = Math.min(sliceEnd, fullCanvas.height);

            slices.push({ start: sliceStart, end: Math.min(bestCut, fullCanvas.height), repeatHeader: !firstSlice });
            sliceStart = bestCut;
            firstSlice = false;
        }

        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

        slices.forEach((slice, i) => {
            if (i > 0) pdf.addPage();

            const sliceHeightPx = slice.end - slice.start;
            const pageCanvas = document.createElement("canvas");
            pageCanvas.width = fullCanvas.width;
            pageCanvas.height = sliceHeightPx + (slice.repeatHeader ? theadHeightPx : 0);
            const ctx = pageCanvas.getContext("2d");
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);

            let yOffset = 0;
            if (slice.repeatHeader && theadCanvas) {
                ctx.drawImage(theadCanvas, 0, 0);
                yOffset = theadHeightPx;
            }
            ctx.drawImage(
                fullCanvas,
                0, slice.start, fullCanvas.width, sliceHeightPx,
                0, yOffset, fullCanvas.width, sliceHeightPx
            );

            const imgData = pageCanvas.toDataURL("image/jpeg", 0.92);
            const imgHeightMm = usablePageWidthMm * (pageCanvas.height / pageCanvas.width);
            pdf.addImage(imgData, "JPEG", marginMm, marginMm, usablePageWidthMm, imgHeightMm);
        });

        pdf.save(`${buildExportPdfFilename()}.pdf`);
    } catch (err) {
        console.error("[export pdf] failed:", err);
        notify("មិនអាចបង្កើតឯកសារ PDF បានទេ", "error");
    } finally {
        tempStyleEl.remove();
        void document.body.offsetHeight; // force a reflow so the removed styles take effect immediately, not lazily
        if (typeof hideAppLoading === "function") {
            hideAppLoading();
        }
    }
}

document.getElementById("btnExportPdf")?.addEventListener("click", () => {
    exportToPdf();
    document.getElementById("arrearsMenuDropdown")?.classList.remove("show");
});

document.getElementById("btnPrint").addEventListener("click", () => window.print());

// ========================================
// NO REASON ARREAR SUMMARY
// Groups the currently-filtered rows (respects whatever Branch /
// Officer / etc. filters are active) by officer, counting rows
// where Arreas > 0 and no solution (AK) has been filled in yet —
// same logic as the VBA COUNTIFS(W=officer, AK="", Q>0, U=branch).
// Team is derived from teamLeader: literal "FSRO" = FSRO team,
// anything else (a team leader's name) = Credit Officer — same
// rule as the VBA UCase(teamMarker)="FSRO" check.
// ========================================

function getTeamCategory(row) {
    return (row.teamLeader || "").trim().toUpperCase() === "FSRO" ? "FSRO" : "Credit Officer";
}

function buildNoReasonRows(sourceRows, branchFilter, teamFilter) {
    const map = new Map();
    sourceRows.forEach(row => {
        const hasNoReason = (parseFloat(row.arreas) || 0) > 0 && !row.akSolution;
        if (!hasNoReason) return;

        const branch = row.branch || "";
        if (branchFilter && branch !== branchFilter) return;

        const team = getTeamCategory(row);
        if (teamFilter && team !== teamFilter) return;

        const name = row.coResponse || "(Unknown)";
        const key = name + "||" + branch + "||" + team;

        if (!map.has(key)) map.set(key, { name, branch, team, count: 0 });
        map.get(key).count++;
    });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function populateNoReasonBranchFilter() {
    const branchEl = document.getElementById("noReasonBranchFilter");
    if (!branchEl) return;
    setSelectOptions(branchEl, distinctSorted(allRows, "branch"), { keepFirstN: 1 });
}

function showNoReasonSummary() {
    populateNoReasonBranchFilter();

    const branchFilterEl = document.getElementById("noReasonBranchFilter");
    const teamFilterEl = document.getElementById("noReasonTeamFilter");
    const branchFilter = branchFilterEl ? branchFilterEl.value : "";
    const teamFilter = teamFilterEl ? teamFilterEl.value : "";

    const rows = buildNoReasonRows(currentRows, branchFilter, teamFilter);
    const tbody = document.getElementById("noReasonTbody");
    tbody.innerHTML = "";

    let total = 0;
    rows.forEach(r => {
        total += r.count;
        const tr = document.createElement("tr");
        tr.innerHTML = `<td>${escapeHtml(r.name)}</td><td>${r.count}</td>`;
        tbody.appendChild(tr);
    });

    if (!rows.length) {
        tbody.innerHTML = `<tr><td colspan="2" style="text-align:center;">គ្មានទិន្នន័យ</td></tr>`;
    }

    document.getElementById("noReasonSubtitle").textContent =
        `សរុប ${total} LD  •  ${rows.length} ភ្នាក់ងារ`;

    const lastUploadText = document.getElementById("lastUploadAt")?.textContent || "-";
    document.getElementById("noReasonLastUpload").textContent = lastUploadText;

    document.getElementById("noReasonBackdrop").classList.add("show");
}

document.getElementById("btnNoReasonSummary")?.addEventListener("click", () => {
    showNoReasonSummary();
    document.getElementById("arrearsMenuDropdown")?.classList.remove("show");
});

document.getElementById("noReasonBranchFilter")?.addEventListener("change", showNoReasonSummary);
document.getElementById("noReasonTeamFilter")?.addEventListener("change", showNoReasonSummary);

document.getElementById("btnNoReasonClose")?.addEventListener("click", () => {
    document.getElementById("noReasonBackdrop").classList.remove("show");
});

document.getElementById("noReasonBackdrop")?.addEventListener("click", (e) => {
    if (e.target.id === "noReasonBackdrop") {
        e.currentTarget.classList.remove("show");
    }
});

// ========================================
// TOPBAR MENU (Refresh / Export / Print)
// The buttons themselves get physically relocated into the topbar
// by arrears-loader.js — this just wires the "..." toggle. Closes
// automatically after picking an action, clicking outside, or Escape.
// ========================================

const arrearsMenuToggle = document.getElementById("btnArrearsMenu");
const arrearsMenuDropdown = document.getElementById("arrearsMenuDropdown");

if (arrearsMenuToggle && arrearsMenuDropdown) {
    arrearsMenuToggle.addEventListener("click", (e) => {
        e.stopPropagation();
        arrearsMenuDropdown.classList.toggle("show");
    });

    arrearsMenuDropdown.addEventListener("click", (e) => {
        if (e.target.tagName === "BUTTON") {
            arrearsMenuDropdown.classList.remove("show");
        }
    });

    document.addEventListener("click", (e) => {
        if (!arrearsMenuDropdown.contains(e.target) && e.target !== arrearsMenuToggle) {
            arrearsMenuDropdown.classList.remove("show");
        }
    });

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") arrearsMenuDropdown.classList.remove("show");
    });
}

// ========================================
// LANDSCAPE VIEW TOGGLE
// iOS Safari does not support the Screen Orientation API's lock() at
// all in a regular browser tab (only inside fullscreen/installed-PWA
// contexts on some Android browsers) — there is no way to force real
// device rotation here. Uses a CSS-transform workaround instead, but
// scoped to ONLY the table (not the whole page) — rotating the whole
// body fought the fixed bottomnav/sticky headers/nested scroll and
// produced a broken overlapping layout in testing. See arrears.css
// for the full explanation of what changed.
// ========================================

const btnLandscape = document.getElementById("btnLandscape");
const btnExitLandscape = document.getElementById("btnExitLandscape");
const landscapeTopBar = document.getElementById("landscapeTopBar");
const landscapeBottomBar = document.getElementById("landscapeBottomBar");
const landscapeRowCount = document.getElementById("landscapeRowCount");

let landscapeHideTimer = null;

function showLandscapeBars() {
    if (landscapeTopBar) landscapeTopBar.classList.remove("hidden");
    if (landscapeBottomBar) landscapeBottomBar.classList.remove("hidden");

    clearTimeout(landscapeHideTimer);
    landscapeHideTimer = setTimeout(hideLandscapeBars, 3000);
}

function hideLandscapeBars() {
    if (landscapeTopBar) landscapeTopBar.classList.add("hidden");
    if (landscapeBottomBar) landscapeBottomBar.classList.add("hidden");
}

if (btnLandscape) {
    btnLandscape.addEventListener("click", () => {
        document.body.classList.add("arrears-force-landscape");
        if (landscapeRowCount) {
            landscapeRowCount.textContent = `${currentRows.length.toLocaleString()} rows`;
        }
        showLandscapeBars(); // visible on entry, auto-hides after 3s
    });
}

// The topbar (and the "..." menu the toggle button lives in) is
// hidden while in landscape mode, so this separate always-visible
// button is the only way back to portrait.
if (btnExitLandscape) {
    btnExitLandscape.addEventListener("click", () => {
        clearTimeout(landscapeHideTimer);
        document.body.classList.remove("arrears-force-landscape");
    });
}

// Tapping the rotated table (anywhere that isn't already a bar
// button) reveals the bars again and restarts the 3s hide timer.
document.querySelector(".table-card")?.addEventListener("click", (e) => {
    if (!document.body.classList.contains("arrears-force-landscape")) return;
    if (e.target.closest(".landscape-bar")) return; // don't re-trigger from tapping the bar itself
    showLandscapeBars();
});

// Defensive reset: never persisted to storage, so a genuine fresh
// page load always starts in portrait. This additionally covers the
// bfcache case (Safari can restore a page's exact DOM/class state on
// back-navigation without a full reload) — matches the same
// bfcache-awareness already used elsewhere in this project.
window.addEventListener("pageshow", () => {
    clearTimeout(landscapeHideTimer);
    document.body.classList.remove("arrears-force-landscape");
});

Object.entries(filterEls).forEach(([key, el]) => {
    if (key === "branch") return; // has its own dedicated listener above

    if (el.tagName === "SELECT") {
        el.addEventListener("change", () => runWithLoading(applyFilters));
    } else {
        el.addEventListener("input", applyFiltersDebounced);
    }
});


// ========================================
// PAGE READY
// ========================================

refreshArrears();
console.log("Daily Arrears Ready.");
