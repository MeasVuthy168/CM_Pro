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

const t = (key) => (window.CMI18n ? CMI18n.t(key) : key);

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

// ========================================
// SCOPE MODE (Viewer_Staff "All" vs "My Own")
// Mirrors the Excel VBA Download_ArreasT24ByCO /
// Download_ArreasT24ByCO_Own choice: "" (default) asks the backend
// for the original column-W/fullname-scoped view, "own" asks for the
// column-V/username-scoped view. Set once at page load (see the
// PAGE READY IIFE at the bottom of this file) and read by every
// arreast24byco fetch below.
// ========================================
let arrearsScopeMode = "";

const tbodyArrears = document.getElementById("tbodyArrears");
const summaryLD = document.getElementById("sumLD");
const summaryOS = document.getElementById("sumOS");
const summaryCIF = document.getElementById("sumCIF");
const summarySplit = document.getElementById("sumSplit");
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
let arrearsUnsortedRows = []; // post-filter order, never reordered by sort — what "default" restores
let currentRows = [];    // whatever's currently displayed (post-filter, post-sort)
let selectedRow = null;  // row object behind the open Reason Arrear panel

// ========================================
// COLUMN SORT
// Every column header cycles through 3 states: ascending -> descending
// -> default (the filtered-but-unsorted order, i.e. allRows' own order)
// -> ascending again. arrearsUnsortedRows is never reordered — sorting
// always derives a fresh copy from it — so "default" has an intact
// original order to go back to, and every other consumer (record
// navigation, surgical row updates, infinite-scroll batching) keeps
// working exactly as it does today: they all just walk currentRows,
// whatever order it currently holds, and none of them mutate it in
// place (currentRows is only ever reassigned wholesale, never pushed/
// spliced into).
// ========================================
// Remembered per device ("arr_sort_ld"), shared by the LD table header
// and the card-view Sort sheet.
function loadSortState(storageKey) {
    try {
        const v = JSON.parse(localStorage.getItem(storageKey) || "null");
        if (v && typeof v.key === "string" && (v.dir === 1 || v.dir === -1)) return { key: v.key, type: v.type || "text", dir: v.dir };
    } catch (e) {}
    return { key: null, type: null, dir: 1 };
}
let arrearsSortState = loadSortState("arr_sort_ld");

function arrearsCompareForSort(a, b, type) {
    const blank = v => v === "" || v == null;
    if (type === "number") {
        const na = blank(a) ? -Infinity : parseFloat(String(a).replace(/,/g, ""));
        const nb = blank(b) ? -Infinity : parseFloat(String(b).replace(/,/g, ""));
        return (isNaN(na) ? -Infinity : na) - (isNaN(nb) ? -Infinity : nb);
    }
    if (type === "date") {
        const da = blank(a) ? null : parseFlexibleDate(a);
        const db = blank(b) ? null : parseFlexibleDate(b);
        const ta = da ? da.getTime() : -Infinity;
        const tb = db ? db.getTime() : -Infinity;
        return ta - tb;
    }
    const sa = blank(a) ? "" : String(a).toLowerCase();
    const sb = blank(b) ? "" : String(b).toLowerCase();
    return sa < sb ? -1 : sa > sb ? 1 : 0;
}

function applyArrearsSort(rows) {
    if (!arrearsSortState.key) return rows.slice();
    const { key, dir, type } = arrearsSortState;
    return rows.slice().sort((a, b) => dir * arrearsCompareForSort(a[key], b[key], type));
}

document.getElementById("arrearsHeadRow")?.addEventListener("click", (e) => {
    const th = e.target.closest("th[data-sort-key]");
    if (!th) return;

    const key = th.dataset.sortKey;
    const type = th.dataset.sortType || "text";
    if (arrearsSortState.key !== key) setLdSort({ key, type, dir: 1 });
    else if (arrearsSortState.dir === 1) setLdSort({ key, type, dir: -1 });
    else setLdSort(null);
});

// ▲ / ▼ on whichever header matches the state (the card Sort sheet can
// set a key the table has no column for, e.g. OS (USD) — then none).
function syncSortHeader(headRowId, state) {
    document.querySelectorAll(`#${headRowId} th[data-sort-key]`).forEach(h => {
        h.classList.remove("arrears-sort-asc", "arrears-sort-desc");
        if (state.key && h.dataset.sortKey === state.key) {
            h.classList.add(state.dir === 1 ? "arrears-sort-asc" : "arrears-sort-desc");
        }
    });
}

function setLdSort(state) {
    arrearsSortState = state || { key: null, type: null, dir: 1 };
    try {
        if (arrearsSortState.key) localStorage.setItem("arr_sort_ld", JSON.stringify(arrearsSortState));
        else localStorage.removeItem("arr_sort_ld");
    } catch (e) {}
    syncSortHeader("arrearsHeadRow", arrearsSortState);
    currentRows = applyArrearsSort(arrearsUnsortedRows);
    renderTable(currentRows);
    updateSortUi();
}

attachSuggestions(reasonAJ, () => distinctSorted(allRows, "ajReason"));
attachSuggestions(reasonAK, () => distinctSorted(allRows, "akSolution"));

// Field templates ("(ពេលខ្ចី), (បច្ចុប្បន្ន)" scaffolding on focus) —
// in assets/js/reason-kit.js, shared with Master Data > Work to complete.
ReasonKit.attachTemplates(reasonAJ, reasonAK);

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

// Previously-used answers under the field (assets/js/reason-kit.js).
function attachSuggestions(fieldEl, getSourceValues) {
    return ReasonKit.attachSuggestions(fieldEl, getSourceValues);
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

// Same toast as the rest of the app (toast.js). There is no global
// showToast(), so the old check always fell through to alert().
function notify(message, type = "info") {
    if (typeof CMToast !== "undefined" && CMToast.show) {
        CMToast.show({ type, title: message, message: "", duration: 3000 });
    } else {
        alert(message);
    }
}

function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text == null ? "" : String(text);
    // textContent->innerHTML escapes & < > but not quotes — this also feeds
    // quoted HTML attributes (data-ldcif, option value) elsewhere in this
    // file, so those need escaping too.
    return div.innerHTML.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// ========================================
// RAW-ROW CACHE (sessionStorage, short TTL)
// This page previously re-downloaded the ENTIRE table (up to 15000
// rows x 41 columns) on every single page load/reload with zero
// caching — refreshArrears() runs unconditionally once at script
// load, so every visit paid for a full bulk fetch. Since this data
// only actually changes when someone runs the Excel
// Upload_ArreasT24ByCO sync (not continuously), a short TTL cache
// eliminates most of that redundant traffic without ever showing
// stale-by-more-than-a-few-minutes data. The per-row "Reason Arrear"
// fields (promise status, follow-up notes) are NOT part of this cache
// — refreshArrears() always re-fetches those live via the separate
// fetchReasonArrearData() overlay below, cache or no cache, so a
// cache hit here never shows stale promise/follow-up status.
//
// Caches the compact raw `values` arrays (pre-parseRow), not the
// fully-keyed parsed objects — much smaller when JSON-stringified.
// Size-checked before writing and wrapped in try/catch: sessionStorage
// has a small quota (~5-10MB), so on an unusually large table this
// silently skips caching rather than throwing QuotaExceededError and
// breaking the page — a cache miss is safe, a crash isn't.
// ========================================
const ARREARS_CACHE_KEY = "arrears_raw_rows_cache_v1";
const ARREARS_CACHE_TTL_MS = 3 * 60 * 1000;
const ARREARS_CACHE_MAX_BYTES = 4 * 1024 * 1024; // stay well under sessionStorage's quota

// Keyed per scope mode — "All" and "My Own" return different row sets
// for the same account, so a cache hit under one mode must never be
// served back for the other.
function arrearsCacheKey(mode) {
    return ARREARS_CACHE_KEY + (mode === "own" ? "_own" : "");
}

function readArrearsRowsCache(mode) {
    try {
        const raw = sessionStorage.getItem(arrearsCacheKey(mode));
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || !Array.isArray(parsed.rows)) return null;
        if (Date.now() - parsed.fetchedAt > ARREARS_CACHE_TTL_MS) return null;
        return parsed.rows;
    } catch (e) {
        return null;
    }
}

function writeArrearsRowsCache(mode, valuesArrays) {
    try {
        const payload = JSON.stringify({ fetchedAt: Date.now(), rows: valuesArrays });
        if (payload.length > ARREARS_CACHE_MAX_BYTES) {
            console.warn(`[arrears cache] ${(payload.length / 1024 / 1024).toFixed(1)}MB exceeds the cache cap — skipping cache, every load will hit the network`);
            return;
        }
        sessionStorage.setItem(arrearsCacheKey(mode), payload);
    } catch (e) {
        // Quota exceeded or storage unavailable (private browsing, etc.) —
        // caching is an optimization, not a requirement, so just skip it.
        console.warn("[arrears cache] could not write cache (non-fatal):", e.message);
    }
}

// ========================================
// FETCH ALL ROWS (paginated — server caps at 1000/request,
// sheet can hold up to 15000 rows, so we loop until a page
// comes back short of the limit)
// ========================================

async function fetchAllArrearsRows() {
    const cached = readArrearsRowsCache(arrearsScopeMode);
    if (cached) {
        console.log(`[arrears cache] using cached rows (${cached.length} rows, age < ${ARREARS_CACHE_TTL_MS / 1000}s) — skipped the network fetch`);
        return cached.map(parseRow);
    }

    const limit = 1000;
    const BATCH_SIZE = 5; // fetch this many pages concurrently before checking if more exist
    let startRow = 6; // matches the sheet's own data start row
    let all = [];
    let reachedEnd = false;

    const scopeQuery = arrearsScopeMode === "own" ? "&scope=own" : "";

    // Loading-overlay progress: rows received vs. how many this scope
    // had last time (this device), so the % tracks real pages.
    const countKey = `cm_arrears_rows:${arrearsScopeMode}`;
    let expected = 0;
    try { expected = Number(localStorage.getItem(countKey)) || 0; } catch (e) {}
    let received = 0;
    const reportProgress = n => {
        received += n;
        if (typeof setAppLoadingProgress !== "function") return;
        const total = Math.max(expected, received + limit);
        const rowsWord = (localStorage.getItem("cm_language") === "en") ? "rows" : "ជួរ";
        setAppLoadingProgress(received / total * 95, `${received.toLocaleString()} / ~${total.toLocaleString()} ${rowsWord}`);
    };

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
            const url = `${API.BASE_URL}/api/arreast24byco/rows?startRow=${thisStartRow}&limit=${limit}&cols=41${scopeQuery}`;
            batchRequests.push(
                fetch(url, { headers: { Authorization: `Bearer ${arrearsToken}` } })
                    .then(res => {
                        if (!res.ok) throw new Error(`HTTP ${res.status}`);
                        return res.json();
                    })
                    .then(data => {
                        reportProgress((data && data.rows && data.rows.length) || 0);
                        return data;
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

    try { localStorage.setItem(countKey, String(all.length)); } catch (e) {}
    const valuesArrays = all.map(r => r.values || []);
    writeArrearsRowsCache(arrearsScopeMode, valuesArrays);
    return valuesArrays.map(parseRow);
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

// ========================================
// REMINDER FOCUS
// Opened from an Officer Reminder's detail page (pages/notifications/
// detail.html) with ?focus=unfilled|expired|outarea&co=<name>&coId=<id>:
// show only that officer's clients the reminder counted — the same
// rules as CM-backend lib/officer-reminders.js:
//   unfilled  CO (col W, by name) · has a CIF · no Solution (AK)
//   expired   CO (col W, by name) · promise date before today
//   outarea   still NoCoRespone · current CO (col V, by ID)
// On top of the normal filters; the banner's x clears it.
// ========================================
const reminderFocus = (() => {
    const p = new URLSearchParams(location.search);
    const kind = p.get("focus");
    if (!["unfilled", "expired", "outarea"].includes(kind)) return null;
    return { kind, co: p.get("co") || "", coId: p.get("coId") || "" };
})();
let reminderFocusOn = !!reminderFocus;

function focusNameKey(v) {
    return String(v || "").trim().toUpperCase().replace(/\s+/g, " ");
}

function focusIdKey(v) {
    return String(v || "").trim().toLowerCase().replace(/^0+/, "");
}

function reminderFocusMatch(row) {
    if (!reminderFocusOn) return true;
    const f = reminderFocus;
    const noCo = String(row.coResponse || "").toLowerCase().includes("nocorespone");
    if (f.kind === "outarea") {
        return noCo && !!row.concate && focusIdKey(row.coId) === focusIdKey(f.coId);
    }
    if (noCo || focusNameKey(row.coResponse) !== focusNameKey(f.co)) return false;
    if (f.kind === "unfilled") return !!String(row.cif || "").trim() && !String(row.akSolution || "").trim();
    return String(row.promiseStatus || "").startsWith("Expired");
}

function renderReminderFocusBanner(count) {
    let bar = document.getElementById("arrFocusBar");
    if (!reminderFocusOn) {
        bar?.remove();
        return;
    }
    if (!bar) {
        bar = document.createElement("div");
        bar.id = "arrFocusBar";
        bar.className = "arr-focus-bar";
        document.querySelector(".page-container")?.prepend(bar);
    }
    const t = (key, vars) => (window.CMI18n ? CMI18n.t(key, vars) : key);
    const ico = `<span class="ui-ico ui-ico-${{ unfilled: "edit", expired: "clock", outarea: "pin" }[reminderFocus.kind]}" aria-hidden="true"></span>`;
    const who = reminderFocus.kind === "outarea"
        ? `${reminderFocus.co || reminderFocus.coId} (${reminderFocus.coId})`
        : reminderFocus.co;
    bar.innerHTML = `
        <span class="arr-focus-ico">${ico}</span>
        <span class="arr-focus-text">
            <b>${escapeFocus(t(`arrears.focus.${reminderFocus.kind}`))}</b>
            <small>${escapeFocus(who)} · ${escapeFocus(t("arrears.focus.count", { n: count }))}</small>
        </span>
        <button type="button" class="arr-focus-clear" aria-label="${escapeFocus(t("arrears.focus.clear"))}">✕</button>`;
    bar.querySelector(".arr-focus-clear").onclick = () => {
        reminderFocusOn = false;
        try { history.replaceState(null, "", location.pathname); } catch (e) {}
        applyFilters();
    };
}

function escapeFocus(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
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

    arrearsUnsortedRows = allRows.filter(row => {
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
            && promiseStatusMatch(row, f.promiseStatus)
            && reminderFocusMatch(row);
    });

    currentRows = applyArrearsSort(arrearsUnsortedRows);
    renderTable(currentRows);
    renderSummary(currentRows);
    renderReminderFocusBanner(currentRows.length);
    updateAdvancedFilterBadge();
}

// Show the search box's x button only while it has text.
const btnClearKeyword = document.getElementById("btnClearKeyword");
function syncKeywordClearButton() {
    if (btnClearKeyword) btnClearKeyword.hidden = !filterEls.keyword.value;
}
filterEls.keyword.addEventListener("input", syncKeywordClearButton);
btnClearKeyword?.addEventListener("click", () => {
    filterEls.keyword.value = "";
    filterEls.keyword.dispatchEvent(new Event("input"));
    filterEls.keyword.focus();
});

function clearFilters() {
    Object.values(filterEls).forEach(el => { el.value = ""; });
    syncKeywordClearButton();
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

    // Excel/VBA writes dd/mm/yyyy, but new Date("10/07/2026") reads it as
    // mm/dd — October 7 instead of 10 July — and redisplays it as
    // 07/10/2026. Dates with a day above 12 came out Invalid and passed
    // through untouched, so only SOME rows looked wrong, which is what
    // made this hard to spot. Parse the slash/dash form explicitly.
    const dmy = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
    if (dmy) {
        const dd = Number(dmy[1]);
        const mm = Number(dmy[2]);
        const yyyy = Number(dmy[3]);
        if (dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12) {
            const d = new Date(Date.UTC(yyyy, mm - 1, dd));
            // Rejects impossible dates like 31/02 rather than letting
            // them roll silently into the next month.
            if (d.getUTCDate() === dd && d.getUTCMonth() === mm - 1) return d;
        }
        return null;
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
        const scopeQuery = arrearsScopeMode === "own" ? "?scope=own" : "";
        const res = await fetch(`${API.BASE_URL}/api/arreast24byco/info${scopeQuery}`, {
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

    summaryLD.textContent = rows.length.toLocaleString();
    summaryCIF.textContent = uniqueCifs.size.toLocaleString();
    summaryOS.textContent = formatShortAmount(totalOS);

    // Gov / Worker / Other split: count + OS per occupation group.
    summarySplit.innerHTML = [
        ["Gov", govCnt, govOS],
        ["Worker", workerCnt, workerOS],
        ["Other", otherCnt, otherOS]
    ].map(([label, cnt, os]) => `
        <div class="arr-split-item">
            <span class="arr-split-label">${label}</span>
            <span class="arr-split-value">${cnt.toLocaleString()}</span>
            <span class="arr-split-os">${formatShortAmount(os)}</span>
        </div>`).join("");
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

function renderTableView(rows) {
    arrTableStale = false;
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
// CARD VIEW
// Phone-friendly alternative to the 26-column table: one card per
// loan with the fields an officer acts on (who, how late, how much,
// phone, promise status, reason). Same data (currentRows), same
// batching (RENDER_BATCH_SIZE, more on scroll) and same tap ->
// Reason Arrear panel as the table rows. Toggle state is remembered
// in localStorage ("arr_view"); Print / Export PDF / Landscape work on
// the table, so they switch back to it first (ensureTableView()).
// ========================================

const arrCardList = document.getElementById("arrCardList");
let arrViewMode = localStorage.getItem("arr_view") === "table" ? "table" : "card";
let arrTableStale = true;   // table DOM is out of date with currentRows (rebuilt when shown)
let renderedCardCount = 0;

function renderTable(rows) {
    if (arrViewMode === "card") {
        arrTableStale = true;
        renderCards(rows);
    } else if (arrGroupMode === "cif") {
        arrTableStale = true;
        renderCifTable(rows);
    } else {
        renderTableView(rows);
    }
}

function arrFormatAmount(value) {
    const n = parseFloat(String(value ?? "").replace(/,/g, ""));
    if (!Number.isFinite(n)) return value || "-";
    return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function buildCardElement(row, index) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "arr-card";
    card.dataset.index = index;

    const classCss = classRowCssClass(row.class);
    if (classCss) card.classList.add(classCss);
    if (row.__pendingSubmit) card.classList.add("arr-card-pending");
    if (selectedRow === row) card.classList.add("is-selected");

    const dup = (customerCountsForRender.get(row.customer) || 0) > 1;
    const arrears = parseFloat(row.arreas) || 0;
    const day = parseInt(row.day, 10);
    const promiseCss = promiseCellCssClass(row.promiseStatus);
    const phone = formatPhone(row.tell);
    const phoneDigits = String(row.tell || "").replace(/[^\d+]/g, "");
    const hasReason = row.ajReason || row.akSolution || row.alFollowup;

    card.innerHTML = `
        <div class="arr-card-top">
            <div class="arr-card-name ${dup ? "arr-card-dup" : ""}">${escapeHtml(row.customer || "-")}</div>
            ${Number.isFinite(day) ? `<span class="arr-day-badge">${day.toLocaleString()} <small>${escapeHtml(t("arrears.cardDays"))}</small></span>` : ""}
        </div>
        <div class="arr-card-ids">
            <span>${escapeHtml(row.loanNumber || "-")}</span>
            <span>CIF ${escapeHtml(row.cif || "-")}</span>
            ${row.class ? `<span class="arr-class-chip">${escapeHtml(row.class)}</span>` : ""}
        </div>
        <div class="arr-card-amounts">
            <div class="arr-amount ${arrears > 0 ? "arr-amount-bad" : ""}">
                <span>Arrears</span><strong>${escapeHtml(arrFormatAmount(row.arreas))}</strong>
            </div>
            <div class="arr-amount">
                <span>Prn.OS${row.ccy ? ` · ${escapeHtml(row.ccy)}` : ""}</span><strong>${escapeHtml(arrFormatAmount(row.prnOS))}</strong>
            </div>
        </div>
        <div class="arr-card-metas">
            ${phone ? `<a class="arr-card-meta arr-card-phone" href="tel:${escapeHtml(phoneDigits)}" data-stop><span class="ui-ico ui-ico-phone" aria-hidden="true"></span>${escapeHtml(phone)}</a>` : ""}
            ${row.occu ? `<span class="arr-card-meta">${escapeHtml(row.occu)}</span>` : ""}
            ${row.coId ? `<span class="arr-card-meta">CO ${escapeHtml(row.coId)}</span>` : ""}
            ${row.promiseStatus ? `<span class="arr-promise ${promiseCss}">${escapeHtml(row.promiseStatus)}</span>` : ""}
        </div>
        ${row.location ? `<div class="arr-card-location"><span class="ui-ico ui-ico-pin" aria-hidden="true"></span><span>${escapeHtml(row.location)}</span></div>` : ""}
        <div class="arr-card-reason ${hasReason ? (promiseCss || "cell-followup-default") : "arr-card-reason-empty"}">
            ${hasReason
                ? `<div class="arr-reason-text">${escapeHtml([row.ajReason, row.akSolution].filter(Boolean).join(" · ") || "-")}</div>
                   ${row.alFollowup ? `<div class="arr-reason-date"><span class="ui-ico ui-ico-calendar" aria-hidden="true"></span>${escapeHtml(formatRowDateDMY(row.alFollowup))}</div>` : ""}`
                : `<span class="ui-ico ui-ico-edit" aria-hidden="true"></span> ${escapeHtml(t("arrears.cardNoReason"))}`}
        </div>
    `;
    return card;
}

function appendMoreCards() {
    if (renderedCardCount >= currentRows.length) return;

    const start = renderedCardCount;
    const end = Math.min(start + RENDER_BATCH_SIZE, currentRows.length);

    const frag = document.createDocumentFragment();
    for (let i = start; i < end; i++) {
        frag.appendChild(buildCardElement(currentRows[i], i));
    }
    arrCardList.appendChild(frag);
    renderedCardCount = end;

    const note = document.getElementById("renderedCountNote");
    if (note) {
        note.textContent = renderedCardCount < currentRows.length
            ? `កំពុងបង្ហាញ ${renderedCardCount.toLocaleString()} នៃ ${currentRows.length.toLocaleString()} — រំកិលចុះក្រោមដើម្បីមើលបន្ថែម`
            : `បង្ហាញទាំងអស់ ${currentRows.length.toLocaleString()}`;
    }
}

function renderCards(rows) {
    if (arrGroupMode === "cif") {
        renderCifCards(rows);
        return;
    }

    arrCardList.innerHTML = "";
    renderedCardCount = 0;

    if (!rows.length) {
        arrCardList.innerHTML = `<div class="arr-card-empty">${escapeHtml(t("arrears.cardNoData"))}</div>`;
        const note = document.getElementById("renderedCountNote");
        if (note) note.textContent = "";
        return;
    }

    customerCountsForRender = new Map();
    rows.forEach(row => {
        if (!row.customer) return;
        customerCountsForRender.set(row.customer, (customerCountsForRender.get(row.customer) || 0) + 1);
    });

    appendMoreCards();
}

// More cards as the page (body) scrolls near the bottom.
function arrCardScrollCheck() {
    if (arrViewMode !== "card" && arrGroupMode !== "cif") return;
    const more = arrGroupMode === "cif"
        ? renderedGroupCount < arrGroups.length
        : renderedCardCount < currentRows.length;
    if (!more) return;
    const scroller = document.body.scrollHeight > window.innerHeight + 2 ? document.body : document.scrollingElement;
    if (scroller.scrollTop + window.innerHeight >= scroller.scrollHeight - 600) {
        if (arrGroupMode === "cif") appendMoreGroups();
        else appendMoreCards();
    }
}
document.body.addEventListener("scroll", arrCardScrollCheck, { passive: true });
window.addEventListener("scroll", arrCardScrollCheck, { passive: true });

arrCardList.addEventListener("click", (e) => {
    if (e.target.closest("[data-stop]")) return; // phone link dials instead

    // CIF mode: an LD row inside an expanded group opens the Reason
    // panel with ‹ › limited to that customer's LDs.
    const ldRow = e.target.closest(".arr-group-ld[data-index]");
    if (ldRow) {
        const row = currentRows[Number(ldRow.dataset.index)];
        const group = arrGroupByKey.get(ldRow.closest(".arr-group").dataset.key);
        if (!row) return;
        arrCardList.querySelectorAll(".is-selected").forEach(c => c.classList.remove("is-selected"));
        ldRow.classList.add("is-selected");
        openReasonPanel(row).then(() => { reasonNavRows = group ? group.rows : null; updateReasonNav(); });
        return;
    }

    // CIF mode: the group's header expands / collapses its LDs.
// (Card view only — the CIF table has its own listener below.)
    const groupHead = e.target.closest(".arr-group-head");
    if (groupHead) {
        const groupEl = groupHead.closest(".arr-group");
        toggleGroup(groupEl);
        return;
    }

    reasonNavRows = null;
    const card = e.target.closest(".arr-card[data-index]");
    if (!card) return;
    const row = currentRows[Number(card.dataset.index)];
    if (!row) return;
    arrCardList.querySelectorAll(".arr-card.is-selected").forEach(c => c.classList.remove("is-selected"));
    card.classList.add("is-selected");
    openReasonPanel(row);
});

// ========================================
// CIF GROUPING (card view)
// "LD" shows one card per loan (above); "CIF" shows one card per
// customer, grouping all of their LDs that match the current filters:
// LD count (x of the customer's total), total OS in USD (OS_USD, so
// USD and KHR loans add up correctly), the latest days late, the worst
// class, the most urgent promise status and how many LDs already have
// a Reason Arrear. Tapping the card lists its LDs; tapping an LD opens
// the Reason Arrear panel with ‹ › limited to that customer's LDs.
// Remembered in localStorage ("arr_group"). Table view stays per LD.
// ========================================

let arrGroupMode = localStorage.getItem("arr_group") === "cif" ? "cif" : "ld";
let arrGroups = [];
let arrGroupByKey = new Map();
let renderedGroupCount = 0;
const arrExpandedGroups = new Set(); // keys of open groups, kept across re-renders

const CLASS_RANK = { "Loss": 5, "Doubtful": 4, "Sub Standard": 3, "Sub-Standard": 3, "Special Mention": 2 };
function promiseRank(status) {
    const css = promiseCellCssClass(status);
    return css === "cell-promise-today" ? 3 : css === "cell-promise-expired" ? 2 : css === "cell-promise-upcoming" ? 1 : 0;
}

function groupKeyOf(row) {
    return row.cif ? `cif:${row.cif}` : `name:${row.customer || row.concate}`;
}

function buildGroups(rows) {
    // total LDs per customer in ALL loaded rows, for "x of y LD"
    const totals = new Map();
    allRows.forEach(r => {
        const k = groupKeyOf(r);
        totals.set(k, (totals.get(k) || 0) + 1);
    });

    const map = new Map();
    rows.forEach((row, index) => {
        const key = groupKeyOf(row);
        let g = map.get(key);
        if (!g) {
            g = { key, cif: row.cif, customer: row.customer, rows: [], indexes: [],
                  osUsd: 0, maxDay: null, worstClass: "", worstRank: 0,
                  promise: "", promiseRank: 0, withReason: 0, phone: "", coId: "", pending: false };
            map.set(key, g);
        }
        g.rows.push(row);
        g.indexes.push(index);
        g.osUsd += parseFloat(row.osUsd) || 0;
        const day = parseInt(row.day, 10);
        if (Number.isFinite(day) && (g.maxDay === null || day > g.maxDay)) g.maxDay = day;
        const rank = CLASS_RANK[row.class] || 0;
        if (rank > g.worstRank) { g.worstRank = rank; g.worstClass = row.class; }
        const pr = promiseRank(row.promiseStatus);
        if (pr > g.promiseRank) { g.promiseRank = pr; g.promise = row.promiseStatus; }
        if (row.ajReason || row.akSolution || row.alFollowup) g.withReason++;
        if (!g.phone && row.tell) g.phone = row.tell;
        if (!g.coId && row.coId) g.coId = row.coId;
        if (row.__pendingSubmit) g.pending = true;
    });

    const groups = [...map.values()];
    groups.forEach(g => { g.totalLd = totals.get(g.key) || g.rows.length; });
    // Highest risk first: latest days late, then largest OS.
    groups.sort((a, b) => ((b.maxDay ?? -1) - (a.maxDay ?? -1)) || (b.osUsd - a.osUsd));
    return groups;
}

function buildGroupLdRow(row, index) {
    const promiseCss = promiseCellCssClass(row.promiseStatus);
    const hasReason = row.ajReason || row.akSolution || row.alFollowup;
    const day = parseInt(row.day, 10);
    return `
        <button type="button" class="arr-group-ld ${classRowCssClass(row.class)} ${row.__pendingSubmit ? "arr-card-pending" : ""}" data-index="${index}">
            <div class="arr-group-ld-top">
                <span class="arr-group-ld-no">${escapeHtml(row.loanNumber || "-")}</span>
                ${Number.isFinite(day) ? `<span class="arr-day-badge">${day.toLocaleString()} <small>${escapeHtml(t("arrears.cardDays"))}</small></span>` : ""}
            </div>
            <div class="arr-group-ld-meta">
                <span>Arrears <strong class="${(parseFloat(row.arreas) || 0) > 0 ? "arr-amount-bad" : ""}">${escapeHtml(arrFormatAmount(row.arreas))}${row.ccy ? ` ${escapeHtml(row.ccy)}` : ""}</strong></span>
                <span>OS <strong>${escapeHtml(formatShortAmount(parseFloat(row.osUsd) || 0))} USD</strong></span>
                ${row.disDate ? `<span>DisDate <strong>${escapeHtml(formatRowDateDMY(row.disDate))}</strong></span>` : ""}
                ${row.promiseStatus ? `<span class="arr-promise ${promiseCss}">${escapeHtml(row.promiseStatus)}</span>` : ""}
            </div>
            <div class="arr-group-ld-reason ${hasReason ? "" : "arr-group-ld-reason-empty"}">
                ${hasReason
                    ? escapeHtml([row.ajReason, row.akSolution].filter(Boolean).join(" · ") || "-") + (row.alFollowup ? ` · ${escapeHtml(formatRowDateDMY(row.alFollowup))}` : "")
                    : escapeHtml(t("arrears.cardNoReason"))}
            </div>
        </button>`;
}

function buildGroupElement(g) {
    const el = document.createElement("div");
    el.className = "arr-group";
    el.dataset.key = g.key;
    const classCss = classRowCssClass(g.worstClass);
    if (classCss) el.classList.add(classCss);
    const open = arrExpandedGroups.has(g.key);
    if (open) el.classList.add("is-open");
    const phone = formatPhone(g.phone);
    const phoneDigits = String(g.phone || "").replace(/[^\d+]/g, "");
    const promiseCss = promiseCellCssClass(g.promise);
    const pct = g.rows.length ? Math.round(g.withReason / g.rows.length * 100) : 0;
    const ldText = g.totalLd > g.rows.length
        ? `${g.rows.length.toLocaleString()} ${t("arrears.groupOf")} ${g.totalLd.toLocaleString()} LD`
        : `${g.rows.length.toLocaleString()} LD`;

    el.innerHTML = `
        <button type="button" class="arr-card arr-group-head ${g.pending ? "arr-card-pending" : ""}" aria-expanded="${open}">
            <div class="arr-card-top">
                <div class="arr-card-name">${escapeHtml(g.customer || "-")}</div>
                ${g.maxDay !== null ? `<span class="arr-day-badge">${g.maxDay.toLocaleString()} <small>${escapeHtml(t("arrears.cardDays"))}</small></span>` : ""}
            </div>
            <div class="arr-card-ids">
                <span>CIF ${escapeHtml(g.cif || "-")}</span>
                <span class="arr-ld-count">${escapeHtml(ldText)}</span>
                ${g.worstClass ? `<span class="arr-class-chip">${escapeHtml(g.worstClass)}</span>` : ""}
            </div>
            <div class="arr-card-amounts arr-group-amounts">
                <div class="arr-amount">
                    <span>OS (USD)</span><strong>${escapeHtml(arrFormatAmount(g.osUsd))}</strong>
                </div>
                <div class="arr-amount">
                    <span>Reason Arrear</span>
                    <strong>${g.withReason.toLocaleString()} / ${g.rows.length.toLocaleString()}</strong>
                    <span class="arr-progress"><span style="width:${pct}%"></span></span>
                </div>
            </div>
            <div class="arr-card-metas">
                ${phone ? `<a class="arr-card-meta arr-card-phone" href="tel:${escapeHtml(phoneDigits)}" data-stop><span class="ui-ico ui-ico-phone" aria-hidden="true"></span>${escapeHtml(phone)}</a>` : ""}
                ${g.coId ? `<span class="arr-card-meta">CO ${escapeHtml(g.coId)}</span>` : ""}
                ${g.promise ? `<span class="arr-promise ${promiseCss}">${escapeHtml(g.promise)}</span>` : ""}
                <span class="arr-group-toggle">${escapeHtml(t(open ? "arrears.groupHide" : "arrears.groupShow"))} <span class="arr-group-chevron" aria-hidden="true">›</span></span>
            </div>
        </button>
        <div class="arr-group-lds" ${open ? "" : "hidden"}>
            ${open ? g.rows.map((r, i) => buildGroupLdRow(r, g.indexes[i])).join("") : ""}
        </div>`;
    return el;
}

function toggleGroup(groupEl) {
    const g = arrGroupByKey.get(groupEl.dataset.key);
    if (!g) return;
    if (arrExpandedGroups.has(g.key)) arrExpandedGroups.delete(g.key);
    else arrExpandedGroups.add(g.key);
    groupEl.replaceWith(groupEl.tagName === "TBODY"
        ? buildGroupTbody(g, Number(groupEl.dataset.no))
        : buildGroupElement(g));
}

// After a Reason Arrear save in CIF mode: recompute and redraw just the
// customer's card (keeping it open), instead of re-rendering the list.
function refreshGroupOf(row) {
    const key = groupKeyOf(row);
    const old = arrGroupByKey.get(key);
    const el = (arrViewMode === "card" ? arrCardList : arrCifTable)
        .querySelector(`.arr-group[data-key="${CSS.escape(key)}"]`);
    if (!old || !el) return false;
    const fresh = buildGroups(old.rows.map(r => r)).find(x => x.key === key);
    if (!fresh) return false;
    fresh.indexes = old.indexes;          // indexes into currentRows stay the same
    fresh.totalLd = old.totalLd;
    arrGroupByKey.set(key, fresh);
    arrGroups[arrGroups.indexOf(old)] = fresh;
    el.replaceWith(el.tagName === "TBODY"
        ? buildGroupTbody(fresh, Number(el.dataset.no))
        : buildGroupElement(fresh));
    return true;
}

function appendMoreGroups() {
    if (renderedGroupCount >= arrGroups.length) return;
    const start = renderedGroupCount;
    const end = Math.min(start + RENDER_BATCH_SIZE, arrGroups.length);
    const inTable = arrViewMode !== "card";
    const frag = document.createDocumentFragment();
    for (let i = start; i < end; i++) {
        frag.appendChild(inTable ? buildGroupTbody(arrGroups[i], i) : buildGroupElement(arrGroups[i]));
    }
    (inTable ? arrCifTable : arrCardList).appendChild(frag);
    renderedGroupCount = end;

    const note = document.getElementById("renderedCountNote");
    if (note) {
        note.textContent = renderedGroupCount < arrGroups.length
            ? `កំពុងបង្ហាញ ${renderedGroupCount.toLocaleString()} នៃ ${arrGroups.length.toLocaleString()} CIF — រំកិលចុះក្រោមដើម្បីមើលបន្ថែម`
            : `បង្ហាញទាំងអស់ ${arrGroups.length.toLocaleString()} CIF (${currentRows.length.toLocaleString()} LD)`;
    }
}

function renderCifCards(rows) {
    arrCardList.innerHTML = "";
    renderedGroupCount = 0;
    arrGroups = applyCifSort(buildGroups(rows));
    arrGroupByKey = new Map(arrGroups.map(g => [g.key, g]));

    if (!arrGroups.length) {
        arrCardList.innerHTML = `<div class="arr-card-empty">${escapeHtml(t("arrears.cardNoData"))}</div>`;
        const note = document.getElementById("renderedCountNote");
        if (note) note.textContent = "";
        return;
    }
    appendMoreGroups();
}

// ---- CIF table (table view + CIF) ----
// Same columns as the LD table, plus OS (USD) after Loan Number. The
// customer row shows what the LDs add up to (amounts summed per
// currency, the latest Day, the most urgent promise) or what they share
// (Location, Occu, …, the Reason Arrear when every LD has the same one);
// its LD rows show each loan in full.
const arrCifTable = document.getElementById("arrCifTable");
const CIF_AMOUNT_KEYS = ["prnOS", "intOS", "prnDue", "intDue", "penalty", "arreas", "balance"];
const CIF_COLS = 27;

// Column header sort for the CIF table — same ▲ / ▼ / default cycle as
// the LD table. Sorts the customers, and the LDs inside each customer.
let cifSortState = loadSortState("arr_sort_cif");

function cifNumber(v) {
    const n = parseFloat(String(v ?? "").replace(/,/g, ""));
    return Number.isFinite(n) ? n : 0;
}

// The one value every LD shares, or "" when they differ.
function cifSharedValue(rows, key) {
    const first = rows[0] ? rows[0][key] ?? "" : "";
    return rows.every(r => (r[key] ?? "") === first) ? first : "";
}

// Amount totals per currency, e.g. { USD: 1200, KHR: 4000000 }.
function cifAmountTotals(rows, key) {
    const totals = {};
    rows.forEach(r => {
        const ccy = r.ccy || "";
        totals[ccy] = (totals[ccy] || 0) + cifNumber(r[key]);
    });
    return totals;
}

function cifAmountHtml(totals) {
    const entries = Object.entries(totals);
    if (entries.length === 1) return escapeHtml(arrFormatAmount(entries[0][1]));
    return entries.map(([ccy, v]) =>
        `<div>${escapeHtml(arrFormatAmount(v))}${ccy ? ` <small>${escapeHtml(ccy)}</small>` : ""}</div>`).join("");
}

function cifLatestRow(rows) {
    let best = null, bestTime = -Infinity;
    rows.forEach(r => {
        const d = r.dateBackup ? parseFlexibleDate(r.dateBackup) : null;
        const tm = d ? d.getTime() : -Infinity;
        if (!best || tm > bestTime) { best = r; bestTime = tm; }
    });
    return best || {};
}

// One value per customer to sort by.
function cifGroupSortValue(g, key, type) {
    if (key === "customer") return g.customer;
    if (key === "loanNumber") return g.rows.length;
    if (key === "osUsd") return g.osUsd;
    if (key === "day") return g.maxDay;
    if (key === "promiseStatus") return g.promise;
    if (key === "promiseRank") return g.promiseRank;
    if (key === "reasonPct") return g.rows.length ? g.withReason / g.rows.length : 0;
    if (key === "user" || key === "dateBackup") return cifLatestRow(g.rows)[key];
    if (CIF_AMOUNT_KEYS.includes(key)) {
        // Ordering only: one figure per customer even when its LDs mix
        // currencies (KHR counted at an approximate 4,100 per USD).
        const totals = cifAmountTotals(g.rows, key);
        return Object.entries(totals).reduce((n, [ccy, v]) => n + (ccy === "KHR" ? v / 4100 : v), 0);
    }
    if (type === "date") {
        const times = g.rows.map(r => (r[key] ? parseFlexibleDate(r[key]) : null)).filter(Boolean).map(d => d.getTime());
        return times.length ? new Date(Math.max(...times)) : "";
    }
    return cifSharedValue(g.rows, key) || (g.rows.find(r => r[key]) || {})[key] || "";
}

function applyCifSort(groups) {
    const { key, type, dir } = cifSortState;
    if (!key) return groups;
    groups.forEach(g => {
        const pairs = g.rows.map((r, i) => [r, g.indexes[i]]);
        pairs.sort((a, b) => dir * arrearsCompareForSort(a[0][key], b[0][key], type));
        g.rows = pairs.map(p => p[0]);
        g.indexes = pairs.map(p => p[1]);
    });
    const groupType = key === "loanNumber" ? "number" : type;
    return groups.slice().sort((a, b) =>
        dir * arrearsCompareForSort(cifGroupSortValue(a, key, type), cifGroupSortValue(b, key, type), groupType));
}

document.getElementById("arrCifHeadRow")?.addEventListener("click", (e) => {
    const th = e.target.closest("th[data-sort-key]");
    if (!th) return;
    const key = th.dataset.sortKey;
    const type = th.dataset.sortType || "text";
    if (cifSortState.key !== key) setCifSort({ key, type, dir: 1 });
    else if (cifSortState.dir === 1) setCifSort({ key, type, dir: -1 });
    else setCifSort(null);
});

function setCifSort(state) {
    cifSortState = state || { key: null, type: null, dir: 1 };
    try {
        if (cifSortState.key) localStorage.setItem("arr_sort_cif", JSON.stringify(cifSortState));
        else localStorage.removeItem("arr_sort_cif");
    } catch (e) {}
    syncSortHeader("arrCifHeadRow", cifSortState);
    renderTable(currentRows);
    updateSortUi();
}

function buildGroupTbody(g, no) {
    const tbody = document.createElement("tbody");
    tbody.className = "arr-group";
    tbody.dataset.key = g.key;
    tbody.dataset.no = no;
    const open = arrExpandedGroups.has(g.key);
    if (open) tbody.classList.add("is-open");
    const classCss = classRowCssClass(g.worstClass);
    const promiseCss = promiseCellCssClass(g.promise);
    const ldText = g.totalLd > g.rows.length
        ? `${g.rows.length.toLocaleString()} / ${g.totalLd.toLocaleString()} LD`
        : `${g.rows.length.toLocaleString()} LD`;
    const shared = key => escapeHtml(cifSharedValue(g.rows, key));
    const amount = key => cifAmountHtml(cifAmountTotals(g.rows, key));
    const arrearsBad = Object.values(cifAmountTotals(g.rows, "arreas")).some(v => v > 0) ? "cell-negative" : "";
    const latest = cifLatestRow(g.rows);
    const pct = g.rows.length ? Math.round(g.withReason / g.rows.length * 100) : 0;
    const sameReason = cifSharedValue(g.rows, "ajReason") || cifSharedValue(g.rows, "akSolution") || cifSharedValue(g.rows, "alFollowup");
    const followCss = (promiseCss || "cell-followup-default") + (g.pending ? " cell-pending-local" : "");
    const reasonCells = sameReason
        ? `<td class="${followCss}">${shared("ajReason")}</td>
           <td class="${followCss}">${shared("akSolution")}</td>
           <td class="${followCss}">${escapeHtml(formatRowDateDMY(cifSharedValue(g.rows, "alFollowup")))}</td>`
        : `<td class="arr-cif-reason">${g.withReason.toLocaleString()} / ${g.rows.length.toLocaleString()} LD
               <span class="arr-progress"><span style="width:${pct}%"></span></span></td><td></td><td></td>`;

    let html = `
        <tr class="arr-cif-row ${g.pending ? "arr-card-pending" : ""}" aria-expanded="${open}">
            <td class="arr-cif-no ${classCss}">${no + 1}</td>
            <td class="arr-cif-name"><span class="arr-group-chevron" aria-hidden="true">›</span> ${escapeHtml(g.customer || "-")}</td>
            <td><span class="arr-ld-count">${escapeHtml(ldText)}</span></td>
            <td class="arr-num"><strong>${escapeHtml(arrFormatAmount(g.osUsd))}</strong></td>
            <td>${shared("location")}</td>
            <td>${escapeHtml(formatRowDateDMY(cifSharedValue(g.rows, "disDate")))}</td>
            <td class="arr-num">${amount("prnOS")}</td>
            <td class="arr-num">${amount("intOS")}</td>
            <td class="arr-num">${amount("prnDue")}</td>
            <td class="arr-num">${amount("intDue")}</td>
            <td class="arr-num">${amount("penalty")}</td>
            <td class="arr-num ${arrearsBad}">${amount("arreas")}</td>
            <td class="arr-num ${classCss}">${g.maxDay !== null ? g.maxDay.toLocaleString() : "-"}</td>
            <td class="arr-num">${amount("balance")}</td>
            <td>${shared("accountLoan")}</td>
            <td>${escapeHtml(formatPhone(g.phone))}</td>
            <td>${escapeHtml(g.cif || "")}</td>
            <td>${shared("occu")}</td>
            <td>${shared("ministry")}</td>
            <td class="${promiseCss}">${escapeHtml(g.promise || "")}</td>
            <td>${escapeHtml(g.coId || "")}</td>
            <td>${shared("cifCoborrower")}</td>
            ${reasonCells}
            <td>${escapeHtml(latest.user || "")}</td>
            <td>${escapeHtml(formatRowDateTime12h(latest.dateBackup || ""))}</td>
        </tr>`;

    if (open) {
        html += g.rows.map((row, i) => {
            const idx = g.indexes[i];
            const rowClass = classRowCssClass(row.class);
            const pCss = promiseCellCssClass(row.promiseStatus);
            const followupCss = (pCss || "cell-followup-default") + (row.__pendingSubmit ? " cell-pending-local" : "");
            const arreaClass = (parseFloat(row.arreas) || 0) > 0 ? "cell-negative" : "";
            const balClass = (parseFloat(row.balance) || 0) < 0 ? "cell-negative" : "";
            const balPdClass = row.pd === "Balanced_PD" ? "cell-balance-pd" : "";
            return `
            <tr class="arr-cif-ld" data-index="${idx}">
                <td class="arr-cif-no ${rowClass}"></td>
                <td class="arr-cif-ld-mark" aria-hidden="true">↳</td>
                <td class="arr-cif-ld-no">${escapeHtml(row.loanNumber || "-")}${row.ccy ? ` <small>${escapeHtml(row.ccy)}</small>` : ""}</td>
                <td class="arr-num">${escapeHtml(arrFormatAmount(row.osUsd))}</td>
                <td>${escapeHtml(row.location)}</td>
                <td>${escapeHtml(formatRowDateDMY(row.disDate))}</td>
                <td class="arr-num">${escapeHtml(row.prnOS)}</td>
                <td class="arr-num">${escapeHtml(row.intOS)}</td>
                <td class="arr-num">${escapeHtml(row.prnDue)}</td>
                <td class="arr-num">${escapeHtml(row.intDue)}</td>
                <td class="arr-num">${escapeHtml(row.penalty)}</td>
                <td class="arr-num ${arreaClass}">${escapeHtml(row.arreas)}</td>
                <td class="arr-num ${rowClass}">${escapeHtml(row.day)}</td>
                <td class="arr-num ${balClass} ${balPdClass}">${escapeHtml(row.balance)}</td>
                <td>${escapeHtml(row.accountLoan)}</td>
                <td>${escapeHtml(formatPhone(row.tell))}</td>
                <td>${escapeHtml(row.cif)}</td>
                <td>${escapeHtml(row.occu)}</td>
                <td>${escapeHtml(row.ministry)}</td>
                <td class="${pCss}">${escapeHtml(row.promiseStatus)}</td>
                <td>${escapeHtml(row.coId)}</td>
                <td>${escapeHtml(row.cifCoborrower)}</td>
                <td class="${followupCss}">${escapeHtml(row.ajReason)}</td>
                <td class="${followupCss}">${escapeHtml(row.akSolution)}</td>
                <td class="${followupCss}">${escapeHtml(formatRowDateDMY(row.alFollowup))}</td>
                <td>${escapeHtml(row.user)}</td>
                <td>${escapeHtml(formatRowDateTime12h(row.dateBackup))}</td>
            </tr>`;
        }).join("");
    }

    tbody.innerHTML = html;
    return tbody;
}

function renderCifTable(rows) {
    arrCifTable.querySelectorAll("tbody").forEach(tb => tb.remove());
    renderedGroupCount = 0;
    arrGroups = applyCifSort(buildGroups(rows));
    arrGroupByKey = new Map(arrGroups.map(g => [g.key, g]));

    if (!arrGroups.length) {
        const tb = document.createElement("tbody");
        tb.innerHTML = `<tr class="row-empty"><td colspan="${CIF_COLS}">${escapeHtml(t("arrears.cardNoData"))}</td></tr>`;
        arrCifTable.appendChild(tb);
        const note = document.getElementById("renderedCountNote");
        if (note) note.textContent = "";
        return;
    }
    appendMoreGroups();
}

arrCifTable?.addEventListener("click", (e) => {
    const ldRow = e.target.closest("tr.arr-cif-ld[data-index]");
    if (ldRow) {
        const row = currentRows[Number(ldRow.dataset.index)];
        const group = arrGroupByKey.get(ldRow.closest(".arr-group").dataset.key);
        if (!row) return;
        arrCifTable.querySelectorAll(".row-selected").forEach(r => r.classList.remove("row-selected"));
        ldRow.classList.add("row-selected");
        openReasonPanel(row).then(() => { reasonNavRows = group ? group.rows : null; updateReasonNav(); });
        return;
    }
    const head = e.target.closest("tr.arr-cif-row");
    if (head) toggleGroup(head.closest(".arr-group"));
});

function setArrearsGroupMode(mode) {
    if (mode === arrGroupMode) return;
    arrGroupMode = mode;
    try { localStorage.setItem("arr_group", mode); } catch (e) {}
    applyArrearsViewMode();
    if (arrViewMode === "card") renderCards(currentRows);
    else if (mode === "cif") renderCifTable(currentRows);
    else if (arrTableStale) renderTableView(currentRows);
    else {
        const note = document.getElementById("renderedCountNote");
        if (note) note.textContent = renderedCount < currentRows.length
            ? `កំពុងបង្ហាញ ${renderedCount.toLocaleString()} នៃ ${currentRows.length.toLocaleString()} — រំកិលចុះក្រោមដើម្បីមើលបន្ថែម`
            : `បង្ហាញទាំងអស់ ${currentRows.length.toLocaleString()}`;
    }
}

document.getElementById("arrGroupLdBtn")?.addEventListener("click", () => setArrearsGroupMode("ld"));
document.getElementById("arrGroupCifBtn")?.addEventListener("click", () => setArrearsGroupMode("cif"));

function applyArrearsViewMode() {
    document.body.classList.toggle("arr-view-card", arrViewMode === "card");
    document.body.classList.toggle("arr-group-cif", arrGroupMode === "cif");
    document.getElementById("arrGroupLdBtn")?.classList.toggle("active", arrGroupMode === "ld");
    document.getElementById("arrGroupCifBtn")?.classList.toggle("active", arrGroupMode === "cif");
    document.getElementById("arrViewCardBtn")?.classList.toggle("active", arrViewMode === "card");
    document.getElementById("arrViewTableBtn")?.classList.toggle("active", arrViewMode === "table");
    updateSortUi();
}

// ========================================
// CARD SORT
// The tables sort from their headers; the card views get a ⇅ button
// that opens a sheet with the fields a card shows. Same state as the
// table of the same mode (LD -> arrearsSortState, CIF -> cifSortState),
// so switching views keeps the order, and ‹ › in the Reason panel
// follows it. A chip under the toolbar shows the active sort.
// ========================================

function cardSortOptions() {
    // [key, type, default direction, label]
    return arrGroupMode === "cif"
        ? [
            ["day", "number", -1, t("arrears.sortDay")],
            ["osUsd", "number", -1, "OS (USD)"],
            ["loanNumber", "number", -1, t("arrears.sortLdCount")],
            ["reasonPct", "number", 1, "Reason Arrear", t("arrears.sortReasonHint")],
            ["promiseRank", "number", -1, "Promise Status"],
            ["customer", "text", 1, t("arrears.sortCustomer")]
        ]
        : [
            ["day", "number", -1, t("arrears.sortDay")],
            ["arreas", "number", -1, "Arrears"],
            ["osUsd", "number", -1, "OS (USD)"],
            ["akSolution", "text", 1, "Reason Arrear", t("arrears.sortReasonHint")],
            ["alFollowup", "date", 1, t("arrears.sortPromiseDate")],
            ["customer", "text", 1, t("arrears.sortCustomer")]
        ];
}

function currentCardSort() {
    return arrGroupMode === "cif" ? cifSortState : arrearsSortState;
}

function setCardSort(state) {
    if (arrGroupMode === "cif") setCifSort(state);
    else setLdSort(state);
}

function sortLabelFor(key) {
    const opt = cardSortOptions().find(o => o[0] === key);
    if (opt) return opt[3];
    // set from a table header the sheet doesn't list
    const th = document.querySelector(`#${arrGroupMode === "cif" ? "arrCifHeadRow" : "arrearsHeadRow"} th[data-sort-key="${CSS.escape(key)}"]`);
    return th ? th.textContent.trim() : key;
}

function updateSortUi() {
    const state = currentCardSort();
    document.getElementById("arrSortBtn")?.classList.toggle("is-sorted", !!state.key);
    const row = document.getElementById("arrSortChipRow");
    const chip = document.getElementById("arrSortChip");
    if (row && chip) {
        row.hidden = !state.key;
        if (state.key) chip.textContent = `${t("arrears.sortChip")} ${sortLabelFor(state.key)} ${state.dir === 1 ? "▲" : "▼"}`;
    }
    if (document.getElementById("arrSortBackdrop")?.classList.contains("show")) renderSortSheet();
}

function renderSortSheet() {
    const state = currentCardSort();
    const list = document.getElementById("arrSortOptions");
    list.innerHTML = cardSortOptions().map(([key, , , label, hint]) => `
        <button type="button" role="radio" aria-checked="${state.key === key}"
            class="arr-sort-option ${state.key === key ? "active" : ""}" data-sort-key="${key}">
            <span class="arr-sort-radio" aria-hidden="true"></span>
            <span class="arr-sort-label">${escapeHtml(label)}${hint ? `<small>${escapeHtml(hint)}</small>` : ""}</span>
            ${state.key === key ? `<span class="arr-sort-arrow">${state.dir === 1 ? "▲" : "▼"}</span>` : ""}
        </button>`).join("");
    document.querySelectorAll("[data-sort-dir]").forEach(b => {
        b.classList.toggle("active", !!state.key && Number(b.dataset.sortDir) === state.dir);
        b.disabled = !state.key;
    });
}

function openSortSheet() {
    renderSortSheet();
    document.getElementById("arrSortBackdrop").classList.add("show");
}

function closeSortSheet() {
    document.getElementById("arrSortBackdrop").classList.remove("show");
}

document.getElementById("arrSortBtn")?.addEventListener("click", openSortSheet);
document.getElementById("arrSortChip")?.addEventListener("click", openSortSheet);
document.getElementById("arrSortChipX")?.addEventListener("click", () => setCardSort(null));
document.getElementById("btnArrSortDefault")?.addEventListener("click", () => setCardSort(null));
document.getElementById("btnArrSortDone")?.addEventListener("click", closeSortSheet);
document.getElementById("btnArrSortCloseX")?.addEventListener("click", closeSortSheet);
document.getElementById("arrSortBackdrop")?.addEventListener("click", (e) => {
    if (e.target.id === "arrSortBackdrop") closeSortSheet();
});

document.getElementById("arrSortOptions")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-sort-key]");
    if (!btn) return;
    const opt = cardSortOptions().find(o => o[0] === btn.dataset.sortKey);
    if (!opt) return;
    const state = currentCardSort();
    // picking the active field again flips the direction
    const dir = state.key === opt[0] ? -state.dir : opt[2];
    setCardSort({ key: opt[0], type: opt[1], dir });
});

document.querySelectorAll("[data-sort-dir]").forEach(btn => btn.addEventListener("click", () => {
    const state = currentCardSort();
    if (!state.key) return;
    setCardSort({ ...state, dir: Number(btn.dataset.sortDir) });
}));

function setArrearsViewMode(mode) {
    if (mode === arrViewMode) return;
    arrViewMode = mode;
    try { localStorage.setItem("arr_view", mode); } catch (e) {}
    applyArrearsViewMode();
    if (mode === "card") renderCards(currentRows);
    else if (arrGroupMode === "cif") renderCifTable(currentRows);
    else if (arrTableStale) renderTableView(currentRows);
    else {
        // table DOM already current — just restore its count note
        const note = document.getElementById("renderedCountNote");
        if (note) note.textContent = renderedCount < currentRows.length
            ? `កំពុងបង្ហាញ ${renderedCount.toLocaleString()} នៃ ${currentRows.length.toLocaleString()} — រំកិលចុះក្រោមដើម្បីមើលបន្ថែម`
            : `បង្ហាញទាំងអស់ ${currentRows.length.toLocaleString()}`;
    }
}

// Print / Export PDF / Landscape capture the table, so make sure it's
// the one on screen (and up to date) first.
function ensureTableView() {
    setArrearsViewMode("table");
    setArrearsGroupMode("ld");
}

syncSortHeader("arrearsHeadRow", arrearsSortState);
syncSortHeader("arrCifHeadRow", cifSortState);

document.getElementById("arrViewCardBtn")?.addEventListener("click", () => setArrearsViewMode("card"));
document.getElementById("arrViewTableBtn")?.addEventListener("click", () => setArrearsViewMode("table"));
applyArrearsViewMode();

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

    if (arrViewMode !== "card" && arrGroupMode === "cif") {
        arrTableStale = true;
        return refreshGroupOf(row);
    }

    if (arrViewMode === "card") {
        // The table isn't on screen; redraw just this one card, and
        // rebuild the table from currentRows when it's next shown.
        arrTableStale = true;
        if (arrGroupMode === "cif") return refreshGroupOf(row);
        const card = arrCardList.querySelector(`.arr-card[data-index="${idx}"]`);
        if (!card) return false;
        card.replaceWith(buildCardElement(row, idx));
        return true;
    }

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
    reasonNavRows = null;
    returnToNoReasonSummary();
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

// Shared with Master Data > Work to complete — see assets/js/reason-kit.js.
function fetchReasonArrearData(concateValues) {
    return ReasonKit.fetchReasons(concateValues, arrearsToken);
}

// VBA StatusFromDate ("Today_Payment" / "Upcoming_left: N Days" /
// "Expired: N Days") — in assets/js/reason-kit.js.
function computeStatusFromDate(alFollowupDMY) {
    return ReasonKit.computeStatus(alFollowupDMY);
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

// The store itself (localStorage "cmpro_pending_reasons") lives in
// assets/js/reason-kit.js, shared with Master Data > Work to complete,
// so a draft saved on either page shows on both.
function getPendingReasonsMap() { return ReasonKit.getPending(); }
function setPendingReason(concate, aj, ak, alISO, gps) { ReasonKit.setPending(concate, aj, ak, alISO, gps); }
function removePendingReasons(concates) { ReasonKit.removePending(concates); }
function getPendingCount() { return ReasonKit.pendingCount(); }
ReasonKit.onPendingChange(() => updatePendingBadge());

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
        await ReasonKit.upsertPending(concates, map, arrearsToken, uploadedBy);

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

    // Fixed 4-line layout, two fields per line. Ministry is deliberately
    // left out of មុខរបរ — it made the line wrap without adding much.
    const lines = [
        [["អតិថិជន", row.customer],      ["អាស័យដ្ឋាន", row.location]],
        [["កិច្ចសន្យាលេខ", row.loanNumber], ["លេខអតិថិជន", row.cif]],
        [["មុខរបរ", row.occu],            ["ផលិតផល", productLabel]],
        [["ចំណាត់ថ្នាក់", row.class],       ["ថ្ងៃយឺត", row.day ? `${row.day}ថ្ងៃ` : ""]]
    ];

    reasonInfo.innerHTML = lines
        .map(pairs => pairs
            // Blank fields drop out, but the line itself stays as long
            // as one of its two fields has a value — so a missing
            // address doesn't collapse the customer name onto the row
            // below it.
            .map(([label, value]) => ({ label, value: String(value ?? "").trim() }))
            .filter(x => x.value !== "" && x.value !== "-")
        )
        .filter(pairs => pairs.length > 0)
        .map(pairs =>
            `<div class="reason-info-line">` +
              pairs.map(x =>
                  `<span class="reason-info-cell">` +
                    `<span class="reason-info-label">${x.label}</span>` +
                    `<span class="reason-info-value">${escapeHtml(x.value)}</span>` +
                  `</span>`
              ).join("") +
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

// "11.5564, 104.9282" -> { lat, lng } or null (assets/js/reason-kit.js).
function parseGps(text) {
    return ReasonKit.parseGps(text);
}

// "មើលលើផែនទី" is hidden until there's a valid coordinate — offering
// it with nothing to show would just produce an error toast.
function updateGpsButtons() {
    const btnOpen = document.getElementById("btnGpsOpen");
    if (!btnOpen || !reasonGPS) return;
    btnOpen.style.display = parseGps(reasonGPS.value) ? "" : "none";
}

// ========================================
// MAP PICKER — Leaflet, in assets/js/reason-kit.js (shared with
// Master Data > Work to complete).
// ========================================
document.getElementById("btnGpsPick")?.addEventListener("click", () => {
    ReasonKit.openMapPicker({
        initial: reasonGPS?.value,
        notify,
        confirm: (lat, lng) => {
            reasonGPS.value = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
            updateGpsButtons();
            setGpsHint("បានជ្រើសទីតាំងពីផែនទី", "ok");
        }
    });
});

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
// The rows ‹ › walks through: one customer's LDs when the panel was
// opened from a CIF card, otherwise every row on screen. Reset when the
// panel closes.
let reasonNavRows = null;
function reasonNavList() {
    return reasonNavRows || currentRows;
}

function reasonNavIndex() {
    if (!selectedRow) return -1;
    return reasonNavList().findIndex(r => r.concate === selectedRow.concate);
}

function updateReasonNav() {
    const i = reasonNavIndex();
    const total = reasonNavList().length;

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
    writeReasonToRows(reasonTargetRows(), currentReasonValues());
}

// ---- one reason for every LD of a CIF ----
// A customer with several LDs usually has one reason for all of them,
// so the panel offers to write it to every LD of the CIF (all loaded
// LDs, not only the ones the current filter shows). On by default when
// the panel is opened from the CIF view.
const reasonApplyAllWrap = document.getElementById("reasonApplyAllWrap");
const reasonApplyAll = document.getElementById("reasonApplyAll");
let reasonApplyAllKey = null;

function reasonSiblingRows(row) {
    const key = groupKeyOf(row);
    return allRows.filter(r => r.concate && groupKeyOf(r) === key);
}

function setupReasonApplyAll(row) {
    if (!reasonApplyAllWrap || !reasonApplyAll) return;
    const n = reasonSiblingRows(row).length;
    const key = groupKeyOf(row);
    reasonApplyAllWrap.hidden = n < 2;
    // Moving between LDs of the same customer keeps the person's choice.
    if (key !== reasonApplyAllKey) reasonApplyAll.checked = arrGroupMode === "cif";
    reasonApplyAllKey = key;
    document.getElementById("reasonApplyAllText").textContent = t("arrears.applyAllLd").replace("{n}", n.toLocaleString());
}

function reasonTargetRows() {
    if (reasonApplyAll?.checked && !reasonApplyAllWrap?.hidden) return reasonSiblingRows(selectedRow);
    return [selectedRow];
}

// Writes the values to each row and to the local pending store, then
// redraws what changed.
function writeReasonToRows(rows, { aj, ak, al, gps }) {
    rows.forEach(row => {
        row.ajReason = aj;
        row.akSolution = ak;
        row.alFollowup = al ? formatRowDateDMY(al) : "";
        row.promiseStatus = computeStatusFromDate(row.alFollowup);
        row.__pendingSubmit = true;
        setPendingReason(row.concate, aj, ak, al, gps);
    });

    if (arrGroupMode === "cif") {
        // the customer's card / table row covers all of its LDs
        if (!updateRowInTable(selectedRow)) renderTable(currentRows);
        return;
    }
    const allUpdated = rows.every(row => currentRows.indexOf(row) === -1 || updateRowInTable(row));
    if (!allUpdated) renderTable(currentRows);
}

async function reasonNavStep(delta) {
    const i = reasonNavIndex();
    if (i < 0) return;

    const target = reasonNavList()[i + delta];
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
    setupReasonApplyAll(row);

    reasonSubtitle.textContent = "";
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

    // Update the in-memory rows immediately so the table reflects the
    // edit right away — just without the server round-trip. With
    // "apply to all LDs" on, every LD of the CIF gets the same values.
    const targets = reasonTargetRows();
    writeReasonToRows(targets, currentReasonValues());

    notify(targets.length > 1
        ? t("arrears.savedAllLd").replace("{n}", targets.length.toLocaleString())
        : "បានរក្សាទុកក្នុងម៉ាស៊ីន — ចុច \"ដាក់ស្នើមូលហេតុ\" នៅពេលរួចរាល់", "success");
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
    arrearsReasonsAt = 0;
    if (typeof showAppLoading === "function") {
        // Progress mode: % bar driven by the row pages as they arrive,
        // and the topbar / bottom nav stay usable meanwhile.
        showAppLoading("Loading arrears data...", { progress: true, key: `arrears:${arrearsScopeMode}` });
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
        arrCardList.innerHTML = `<div class="arr-card-empty">Failed to load data</div>`;
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
        arrearsReasonsAt = Date.now();
    } catch (err) {
        console.error("[reasonarrear overlay] failed, table still shows bulk data:", err);
    }
    openPendingWorkLink();
}

// ?work=unfilled|expired|outarea[&branch=…] (from a Smart Alert /
// Officer Reminder detail page) opens "ការងារត្រូវបំពេញ" on that tab
// once the data — Reason Arrear overlay included — is in. Once only.
let pendingWorkLink = (() => {
    const p = new URLSearchParams(location.search);
    const kind = p.get("work");
    return ["unfilled", "expired", "outarea"].includes(kind) ? { kind, branch: p.get("branch") || "" } : null;
})();

// Editing out-of-area loans needs upload permission (Admin / User, as
// the backend's canUpload); everyone else gets the editor read-only.
const outAreaCanEdit = (() => {
    try {
        const r = String(JSON.parse(localStorage.getItem("loggedInUser") || sessionStorage.getItem("loggedInUser") || "{}").role || "").toLowerCase();
        return r === "admin" || r === "user";
    } catch (e) {
        return false;
    }
})();

// Old ?outarea=1 links (the editor used to open here from Master Data)
// go to its own page now.
if (new URLSearchParams(location.search).get("outarea") === "1") {
    location.replace("/CM_Pro/pages/masterdata/outarea.html");
}

function openPendingWorkLink() {
    if (!pendingWorkLink) return;
    const { kind, branch } = pendingWorkLink;
    pendingWorkLink = null;
    try { history.replaceState(null, "", location.pathname); } catch (e) {}
    noReasonKind = kind;
    populateNoReasonBranchFilter();
    const sel = document.getElementById("noReasonBranchFilter");
    if (sel && branch && [...sel.options].some(o => o.value === branch)) sel.value = branch;
    showNoReasonSummary();
}

// Excel (and other spreadsheet apps) treat a cell string starting with
// =, +, -, @, or a tab/CR as a formula when the file is opened — several
// of the fields below are free text loan officers type into the Reason
// Arrear panel (akSolution etc.), so without this a note that happens to
// start with one of those characters would silently become a live
// formula for whoever opens the exported report. Prefixing with a
// leading apostrophe forces Excel to treat it as plain text instead;
// non-string values (numbers) pass through untouched.
function sanitizeForSpreadsheet(value) {
    if (typeof value !== "string") return value;
    return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function exportArrears() {
    if (!currentRows.length) {
        notify("Nothing to export.", "warning");
        return;
    }
    const sheetData = currentRows.map((row, i) => ({
        No: i + 1,
        Customer: sanitizeForSpreadsheet(row.customer),
        "Loan Number": sanitizeForSpreadsheet(row.loanNumber),
        Location: sanitizeForSpreadsheet(row.location),
        DisDate: row.disDate,
        "Prn.OS": row.prnOS,
        "Int.OS": row.intOS,
        "Prn.Due": row.prnDue,
        "Int.Due": row.intDue,
        Penalty: row.penalty,
        Arreas: row.arreas,
        Day: row.day,
        Balnce: row.balance,
        "Account Loan": sanitizeForSpreadsheet(row.accountLoan),
        Tell: sanitizeForSpreadsheet(row.tell),
        CIF: sanitizeForSpreadsheet(row.cif),
        Occu: sanitizeForSpreadsheet(row.occu),
        Ministry: sanitizeForSpreadsheet(row.ministry),
        "Promise Status": sanitizeForSpreadsheet(row.promiseStatus),
        CO_ID: sanitizeForSpreadsheet(row.coId),
        "CIF_អ្នករួមខ្ចី": sanitizeForSpreadsheet(row.cifCoborrower),
        "មុខរបរ": sanitizeForSpreadsheet(row.ajReason),
        "មូលហេតុ/ដំណោះស្រាយ": sanitizeForSpreadsheet(row.akSolution),
        "ថ្ងៃសន្យាសង": row.alFollowup,
        User: sanitizeForSpreadsheet(row.user),
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

// Shared by the LD and CIF exports: captures `container` with
// html2canvas, slices it into A4-landscape pages at row boundaries
// (`rows`), repeats `thead` at the top of every page after the first,
// and saves it as `filename`.
async function captureToPdf(container, thead, rows, filename) {
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

        pdf.save(filename);
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
        await captureToPdf(container, thead, rows, `${buildExportPdfFilename()}.pdf`);

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


// ========================================
// EXPORT PDF — CIF (step 3 of the CIF grouping)
// When the LD | CIF switch is on CIF, Export PDF exports one row per
// customer (same grouping, order and OS_USD totals as the CIF card and
// table views) for ALL customers in the current filter — not just the
// rows rendered on screen. Built in an off-screen, always-light
// element so the PDF looks the same whatever theme is on screen.
// ========================================

function buildCifPdfElement(groups) {
    const el = document.createElement("div");
    el.id = "arrCifPdf";
    el.className = "arr-cif-pdf";

    const ldCount = groups.reduce((n, g) => n + g.rows.length, 0);
    const osTotal = groups.reduce((n, g) => n + g.osUsd, 0);
    const filters = [
        ["Branch", filterEls.branch.value],
        ["Officer", filterEls.officerResponse.value],
        ["Team", filterEls.teamLeader.value],
        ["Keyword", filterEls.keyword.value.trim()]
    ].filter(([, v]) => v).map(([k, v]) => `${k}: ${escapeHtml(v)}`).join(" · ");

    const rowsHtml = groups.map((g, i) => {
        const classCss = classRowCssClass(g.worstClass);
        const promiseCss = promiseCellCssClass(g.promise);
        const ld = g.totalLd > g.rows.length ? `${g.rows.length} / ${g.totalLd}` : `${g.rows.length}`;
        return `
            <tr>
                <td class="${classCss}">${i + 1}</td>
                <td>${escapeHtml(g.customer || "-")}</td>
                <td>${escapeHtml(g.cif || "-")}</td>
                <td class="num">${escapeHtml(ld)}</td>
                <td class="num">${escapeHtml(arrFormatAmount(g.osUsd))}</td>
                <td class="num">${g.maxDay !== null ? g.maxDay : "-"}</td>
                <td class="${classCss}">${escapeHtml(g.worstClass || "")}</td>
                <td class="${promiseCss}">${escapeHtml(g.promise || "")}</td>
                <td class="num">${g.withReason} / ${g.rows.length}</td>
                <td>${escapeHtml(formatPhone(g.phone))}</td>
                <td>${escapeHtml(g.coId || "")}</td>
            </tr>`;
    }).join("");

    el.innerHTML = `
        <div class="arr-cif-pdf-head">
            <div class="arr-cif-pdf-title">Daily Arrears — CIF</div>
            <div class="arr-cif-pdf-sub">
                ${escapeHtml(lastUploadAtEl.textContent || "")}
                · CIF: ${groups.length.toLocaleString()} · LD: ${ldCount.toLocaleString()}
                · OS (USD): ${escapeHtml(arrFormatAmount(osTotal))}
            </div>
            ${filters ? `<div class="arr-cif-pdf-sub">${filters}</div>` : ""}
        </div>
        <table>
            <thead>
                <tr>
                    <th>No</th><th>Customer</th><th>CIF</th><th>LD</th><th>OS (USD)</th><th>Day</th>
                    <th>Class</th><th>Promise Status</th><th>Reason Arrear</th><th>Tell</th><th>CO_ID</th>
                </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
        </table>`;
    return el;
}

async function exportCifPdf() {
    if (typeof html2canvas === "undefined" || typeof window.jspdf === "undefined") {
        notify("PDF export library failed to load — check your connection and try again.", "error");
        return;
    }

    const groups = buildGroups(currentRows);
    if (!groups.length) {
        notify(t("arrears.cardNoData"), "warning");
        return;
    }

    if (typeof showAppLoading === "function") showAppLoading("កំពុងបង្កើតឯកសារ PDF...");

    const el = buildCifPdfElement(groups);
    document.body.appendChild(el);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    try {
        const thead = el.querySelector("thead");
        const rows = Array.from(el.querySelectorAll("tbody tr"));
        await captureToPdf(el, thead, rows, `${buildExportPdfFilename().replace(/^Arrear_/, "Arrear_CIF_")}.pdf`);
    } catch (err) {
        console.error("[export cif pdf] failed:", err);
        notify("មិនអាចបង្កើតឯកសារ PDF បានទេ", "error");
    } finally {
        el.remove();
        if (typeof hideAppLoading === "function") hideAppLoading();
    }
}

document.getElementById("btnExportPdf")?.addEventListener("click", () => {
    // CIF switch on -> one row per customer; otherwise the per-LD table.
    if (arrGroupMode === "cif") {
        exportCifPdf();
        document.getElementById("arrearsMenuDropdown")?.classList.remove("show");
        return;
    }
    ensureTableView();
    exportToPdf();
    document.getElementById("arrearsMenuDropdown")?.classList.remove("show");
});

document.getElementById("btnPrint").addEventListener("click", () => {
    ensureTableView();
    window.print();
});

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

// "ការងារត្រូវបំពេញ" (work to complete) — three kinds, the same rules
// as the 9:00 / 15:00 officer reminders (CM-backend lib/officer-reminders.js):
//   unfilled  real row (has a CIF), no Solution (AK) yet — by officer name (W)
//   expired   promise date (AL) before today — by officer name (W)
//   outarea   still NoCoRespone on the Out of Area page — by the loan's
//             current CO ID (V), since W holds the NoCoRespone marker
// NoCoRespone rows belong to the third kind only.
function isNoCoResponseRow(row) {
    return String(row.coResponse || "").toLowerCase().includes("nocorespone");
}

function buildNoReasonRows(sourceRows, branchFilter, teamFilter, kind = "unfilled", officerNames = null) {
    const map = new Map();
    const stats = { total: 0, missing: 0 };
    sourceRows.forEach(row => {
        // Q is the CIF column, so the guard is simply "this is a real
        // row" — NOT "arrears amount > 0" (see the VBA COUNTIFS note above).
        const hasCif = String(row.cif ?? "").trim() !== "";
        if (!hasCif) return;

        const branch = row.branch || "";
        if (branchFilter && branch !== branchFilter) return;

        const team = getTeamCategory(row);
        if (teamFilter && team !== teamFilter) return;

        const noCo = isNoCoResponseRow(row);
        if ((kind === "outarea") !== noCo) return;
        if (kind === "outarea" && !row.concate) return;

        let name, key;
        if (kind === "outarea") {
            const id = normalizeOfficerId(row.coId);
            name = (officerNames && officerNames.get(id)) || `CO ${row.coId || "?"}`;
            key = "id:" + id + "||" + branch + "||" + team;
        } else {
            name = row.coResponse || "(Unknown)";
            key = name + "||" + branch + "||" + team;
        }

        // rows[] keeps references to the real arrears row objects, so a
        // client tapped in the drill-down opens the same object the
        // main table would. total counts every LD of the officer in
        // scope (the "filled x/y" bar on the unfilled tab).
        if (!map.has(key)) map.set(key, { key, name, branch, team, coId: row.coId || "", count: 0, total: 0, rows: [] });
        const entry = map.get(key);
        entry.total++;
        stats.total++;

        const pending = kind === "unfilled" ? String(row.akSolution ?? "").trim() === ""
            : kind === "expired" ? String(row.promiseStatus || "").startsWith("Expired")
            : true;
        if (!pending) return;
        entry.count++;
        entry.rows.push(row);
        stats.missing++;
    });
    const groups = Array.from(map.values()).filter(g => g.count > 0);
    groups.stats = stats;
    return groups;
}

function populateNoReasonBranchFilter() {
    const branchEl = document.getElementById("noReasonBranchFilter");
    if (!branchEl) return;
    setSelectOptions(branchEl, distinctSorted(allRows, "branch"), { keepFirstN: 1 });
}

// Holds the officer groups from the most recent showNoReasonSummary()
// call, so the click handler on #noReasonTbody can look one up by the
// index stashed on its item without re-filtering currentRows.
let noReasonGroups = [];
let noReasonTeam = "";          // "" | "Credit Officer" | "FSRO"
let noReasonSort = "count";     // "count" (most unfilled first) | "name"
let noReasonKind = "unfilled";  // "unfilled" | "expired" | "outarea" (see buildNoReasonRows)

// Whichever officer's client list is currently open in the drill-down
// screen, so its own click handler can resolve a tapped item back to
// the real arrears row object.
let noReasonClientRows = [];
let noReasonOpenKey = null;

// Set while the Reason Arrear panel was opened from this summary, so
// closing the panel comes back to the officer's (refreshed) list.
let noReasonReturnKey = null;

function noReasonInitials(name) {
    const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    return ((parts[0] || "?")[0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

function noReasonFill(template, values) {
    return Object.entries(values).reduce((str, [k, v]) => str.replace(`{${k}}`, v), template);
}

function showNoReasonSummary() {
    populateNoReasonBranchFilter();

    const branchFilter = document.getElementById("noReasonBranchFilter")?.value || "";
    const names = OutAreaEditor.officerNames();
    noReasonGroups = buildNoReasonRows(currentRows, branchFilter, noReasonTeam, noReasonKind, names);

    // Every tab shows its own count for the same Branch / Team choice.
    ["unfilled", "expired", "outarea"].forEach(kind => {
        const n = kind === noReasonKind ? noReasonGroups.stats.missing
            : buildNoReasonRows(currentRows, branchFilter, noReasonTeam, kind, names).stats.missing;
        const el = document.getElementById(`nrKindCount-${kind}`);
        if (el) el.textContent = n.toLocaleString();
    });
    document.querySelectorAll("[data-nr-kind]").forEach(b =>
        b.classList.toggle("active", b.dataset.nrKind === noReasonKind));
    document.getElementById("nrStatMissingLabel").textContent =
        noReasonKind === "outarea" ? "NoCoRespone" : t(noReasonKind === "expired" ? "arrears.workExpired" : "arrears.workUnfilled");
    document.getElementById("nrStatGood").hidden = noReasonKind !== "unfilled";
    // NoCoRespone officers are named from the Master Data list — load it
    // once, then redraw with names instead of bare IDs.
    if (noReasonKind === "outarea" && !names) loadOutAreaOfficerNames().then(() => {
        if (noReasonKind === "outarea" && document.getElementById("noReasonBackdrop").classList.contains("show")) showNoReasonSummary();
    });

    const { total, missing } = noReasonGroups.stats;
    const pct = total ? Math.round((total - missing) / total * 100) : 100;
    document.getElementById("nrStatMissing").textContent = missing.toLocaleString();
    document.getElementById("nrStatOfficers").textContent = noReasonGroups.length.toLocaleString();
    document.getElementById("nrStatPct").textContent = `${pct}%`;
    document.getElementById("nrStatBar").style.width = `${pct}%`;

    document.getElementById("noReasonLastUpload").textContent =
        document.getElementById("lastUploadAt")?.textContent || "-";

    document.querySelectorAll("[data-nr-team]").forEach(b =>
        b.classList.toggle("active", b.dataset.nrTeam === noReasonTeam));
    document.querySelectorAll("[data-nr-sort]").forEach(b =>
        b.classList.toggle("active", b.dataset.nrSort === noReasonSort));

    renderNoReasonOfficers();
    showNoReasonListScreen();
    document.getElementById("noReasonBackdrop").classList.add("show");
}

function renderNoReasonOfficers() {
    const q = (document.getElementById("noReasonSearch")?.value || "").trim().toLowerCase();
    const list = noReasonGroups
        .map((g, i) => ({ g, i }))
        .filter(({ g }) => !q || g.name.toLowerCase().includes(q) || g.branch.toLowerCase().includes(q))
        .sort((a, b) => noReasonSort === "name"
            ? a.g.name.localeCompare(b.g.name)
            : (b.g.count - a.g.count) || a.g.name.localeCompare(b.g.name));

    const el = document.getElementById("noReasonTbody");
    if (!list.length) {
        el.innerHTML = `<div class="oa-empty">${escapeHtml(t(noReasonGroups.length ? "arrears.nrNoMatch" : `arrears.workDone.${noReasonKind}`))}</div>`;
    } else {
        el.innerHTML = list.map(({ g, i }) => {
            const filled = g.total - g.count;
            const pct = g.total ? Math.round(filled / g.total * 100) : 0;
            return `
            <button type="button" class="oa-item nr-item" data-group-index="${i}">
                <span class="nr-avatar" aria-hidden="true">${escapeHtml(noReasonInitials(g.name))}</span>
                <span class="oa-item-main">
                    <span class="oa-item-name">${escapeHtml(g.name)}</span>
                    <span class="oa-item-sub">
                        ${g.branch ? `<span class="oa-branch-chip">${escapeHtml(g.branch)}</span>` : ""}
                        <span>${escapeHtml(g.team === "FSRO" ? "FSRO" : "CO")}</span>
                        ${noReasonKind === "outarea" ? `<span>· ${escapeHtml(g.coId)}</span>` : ""}
                        ${noReasonKind === "unfilled" ? `<span>· ${escapeHtml(noReasonFill(t("arrears.nrFilledOf"), { f: filled.toLocaleString(), t: g.total.toLocaleString() }))}</span>` : ""}
                    </span>
                    ${noReasonKind === "unfilled" ? `<span class="arr-progress nr-item-bar"><span style="width:${pct}%"></span></span>` : ""}
                </span>
                <span class="nr-count"><strong>${g.count.toLocaleString()}</strong><small>LD</small></span>
                <span class="oa-item-chevron" aria-hidden="true">›</span>
            </button>`;
        }).join("");
    }

    const { missing } = noReasonGroups.stats;
    document.getElementById("noReasonSubtitle").textContent = noReasonFill(t(`arrears.workCount.${noReasonKind}`), {
        n: missing.toLocaleString(), o: noReasonGroups.length.toLocaleString()
    });
}

function showNoReasonListScreen() {
    document.getElementById("noReasonClientsScreen").style.display = "none";
    document.getElementById("noReasonListScreen").style.display = "block";
    noReasonOpenKey = null;
}

function closeNoReasonSummary() {
    document.getElementById("noReasonBackdrop").classList.remove("show");
    showNoReasonListScreen();
}

// Drill-down: the officer's own unfilled-reason loans (latest days late
// first), so staff can jump straight to a specific client instead of
// hunting for them in the full table.
function showNoReasonClients(group) {
    noReasonClientRows = group.rows.slice().sort((a, b) =>
        (parseInt(b.day, 10) || 0) - (parseInt(a.day, 10) || 0));
    noReasonOpenKey = group.key;

    const search = document.getElementById("noReasonClientSearch");
    if (search) search.value = "";
    renderNoReasonClients();

    document.getElementById("noReasonClientsTitle").textContent = group.name;
    document.getElementById("noReasonClientsSubtitle").textContent =
        `${group.branch || "-"} · ${group.team} · ${group.count.toLocaleString()} LD · ${t(`arrears.work.${noReasonKind}`)}`;
    document.getElementById("noReasonClientsHint").textContent = t(`arrears.workHint.${noReasonKind}`);

    document.getElementById("noReasonListScreen").style.display = "none";
    document.getElementById("noReasonClientsScreen").style.display = "block";
    document.getElementById("noReasonCard").scrollTop = 0;
}

function renderNoReasonClients() {
    const q = (document.getElementById("noReasonClientSearch")?.value || "").trim().toLowerCase();
    const el = document.getElementById("noReasonClientsTbody");
    const items = noReasonClientRows
        .map((row, i) => ({ row, i }))
        .filter(({ row }) => !q || [row.customer, row.loanNumber, row.cif, row.tell]
            .some(v => String(v || "").toLowerCase().includes(q)));

    if (!items.length) {
        el.innerHTML = `<div class="oa-empty">${escapeHtml(t(noReasonClientRows.length ? "arrears.nrNoMatch" : `arrears.workDone.${noReasonKind}`))}</div>`;
        return;
    }
    el.innerHTML = items.map(({ row, i }) => {
        const day = parseInt(row.day, 10);
        const arrears = parseFloat(row.arreas) || 0;
        const draft = row.ajReason || row.alFollowup;
        return `
        <button type="button" class="oa-item nr-client ${classRowCssClass(row.class)}" data-row-index="${i}">
            <span class="oa-item-main">
                <span class="oa-item-name">${escapeHtml(row.customer || "-")}</span>
                <span class="oa-item-sub">${escapeHtml(row.loanNumber || "-")} · CIF ${escapeHtml(row.cif || "-")}</span>
                <span class="oa-item-sub nr-client-meta">
                    ${arrears > 0 ? `<span class="arr-amount-bad">Arrears ${escapeHtml(arrFormatAmount(row.arreas))}${row.ccy ? ` ${escapeHtml(row.ccy)}` : ""}</span>` : ""}
                    ${row.tell ? `<span><span class="ui-ico ui-ico-phone" aria-hidden="true"></span> ${escapeHtml(formatPhone(row.tell))}</span>` : ""}
                    ${noReasonKind === "expired" && row.promiseStatus ? `<span class="nr-client-expired"><span class="ui-ico ui-ico-clock" aria-hidden="true"></span> ${escapeHtml(formatRowDateDMY(row.alFollowup))} · ${escapeHtml(row.promiseStatus.replace(/^Expired:\s*/, ""))}</span>` : ""}
                    ${noReasonKind !== "expired" && draft ? `<span class="nr-client-draft">${escapeHtml(row.ajReason || formatRowDateDMY(row.alFollowup))}</span>` : ""}
                </span>
            </span>
            ${Number.isFinite(day) ? `<span class="arr-day-badge">${day.toLocaleString()} <small>${escapeHtml(t("arrears.cardDays"))}</small></span>` : ""}
            <span class="oa-item-chevron" aria-hidden="true">›</span>
        </button>`;
    }).join("");
}

// Called by closeReasonModal(): back to the officer's list when the
// panel was opened from here, with the list rebuilt so a client whose
// reason was just saved drops off it.
function returnToNoReasonSummary() {
    const key = noReasonReturnKey;
    noReasonReturnKey = null;
    if (!key) return;
    showNoReasonSummary();
    const group = noReasonGroups.find(g => g.key === key);
    if (group) showNoReasonClients(group);
}

document.getElementById("noReasonTbody")?.addEventListener("click", (e) => {
    const item = e.target.closest("[data-group-index]");
    if (!item) return;
    const group = noReasonGroups[Number(item.dataset.groupIndex)];
    if (group) showNoReasonClients(group);
});

document.getElementById("noReasonClientsTbody")?.addEventListener("click", (e) => {
    const item = e.target.closest("[data-row-index]");
    if (!item) return;
    const row = noReasonClientRows[Number(item.dataset.rowIndex)];
    if (!row) return;

    const navRows = noReasonClientRows.slice();
    const returnKey = noReasonOpenKey;
    closeNoReasonSummary();
    if (noReasonKind === "outarea") {
        // NoCoRespone is fixed by moving the loan to its officer on the
        // Out of Area page — open that editor on this loan.
        openOutAreaModal();
        selectOutAreaCustomer(row);
        return;
    }
    openReasonPanel(row).then(() => { reasonNavRows = navRows; updateReasonNav(); });
    noReasonReturnKey = returnKey;
});

document.getElementById("noReasonSearch")?.addEventListener("input", renderNoReasonOfficers);
document.getElementById("noReasonClientSearch")?.addEventListener("input", renderNoReasonClients);

document.querySelectorAll("[data-nr-team]").forEach(btn => btn.addEventListener("click", () => {
    noReasonTeam = btn.dataset.nrTeam;
    showNoReasonSummary();
}));
document.querySelectorAll("[data-nr-kind]").forEach(btn => btn.addEventListener("click", () => {
    noReasonKind = btn.dataset.nrKind;
    const search = document.getElementById("noReasonSearch");
    if (search) search.value = "";
    showNoReasonSummary();
}));
document.querySelectorAll("[data-nr-sort]").forEach(btn => btn.addEventListener("click", () => {
    noReasonSort = btn.dataset.nrSort;
    document.querySelectorAll("[data-nr-sort]").forEach(b => b.classList.toggle("active", b === btn));
    renderNoReasonOfficers();
}));

// Plain-text summary for pasting into Telegram / chat.
document.getElementById("btnNoReasonCopy")?.addEventListener("click", async () => {
    const branch = document.getElementById("noReasonBranchFilter")?.value || t("arrears.nrAllBranches");
    const team = noReasonTeam || t("arrears.optionAll");
    const sorted = noReasonGroups.slice().sort((a, b) => (b.count - a.count) || a.name.localeCompare(b.name));
    const lines = [
        `${t("arrears.menuNoReasonSummary")} · ${t(`arrears.work.${noReasonKind}`)} — ${branch} · ${team}`,
        `${t("arrears.lastUploadAtLabel")} ${document.getElementById("noReasonLastUpload").textContent}`,
        "",
        ...sorted.map((g, i) => `${i + 1}. ${g.name}${g.branch ? ` (${g.branch})` : ""} — ${g.count} LD`),
        "",
        document.getElementById("noReasonSubtitle").textContent
    ];
    const text = lines.join("\n");
    try {
        await navigator.clipboard.writeText(text);
    } catch (err) {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
    }
    notify(t("arrears.nrCopied"), "success");
});

document.getElementById("btnNoReasonClientsBack")?.addEventListener("click", showNoReasonListScreen);
document.getElementById("btnNoReasonClientsCloseX")?.addEventListener("click", closeNoReasonSummary);
document.getElementById("btnNoReasonCloseX")?.addEventListener("click", closeNoReasonSummary);
document.getElementById("btnNoReasonClose")?.addEventListener("click", closeNoReasonSummary);

// "ការងារត្រូវបំពេញ" now opens its own page (Master Data > Work to
// complete). The summary modal below still serves ?work= links.
document.getElementById("btnNoReasonSummary")?.addEventListener("click", () => {
    handOffWorkRows();
    location.href = "/CM_Pro/pages/masterdata/work.html";
});

// When the Reason Arrear overlay last finished for the rows in memory
// (0 = not yet, or the data has been reloaded since).
let arrearsReasonsAt = 0;

// The rows are already here — hand them to the Work to complete page so
// it opens instantly instead of loading them all again. Same fields as
// its own GET /api/arreast24byco/work. Only when they match what that
// page would load: reasons overlaid, and not Viewer_Staff's "own (ID)"
// scope (the page uses the by-name scope).
function handOffWorkRows() {
    try {
        sessionStorage.removeItem("cm_work_snapshot_v1");
        if (!arrearsReasonsAt || arrearsScopeMode === "own") return;
        const isoFromDMY = dmy => {
            const m = String(dmy || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
            return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
        };
        const rows = allRows
            .filter(r => String(r.cif || "").trim() && r.concate && !isNoCoResponseRow(r))
            .map(r => ({
                loanNumber: r.loanNumber, customer: r.customer, location: r.location, arreas: r.arreas,
                day: r.day, accountLoan: r.accountLoan, tell: r.tell, cif: r.cif, occu: r.occu,
                branch: r.branch, coId: r.coId, coResponse: r.coResponse, ccy: r.ccy,
                teamLeader: r.teamLeader, class: r.class, concate: r.concate, product: r.product,
                aj: r.ajReason || "", ak: r.akSolution || "", al: isoFromDMY(r.alFollowup),
                user: r.user || "", dateBackup: r.dateBackup || ""
            }));
        const user = JSON.parse(localStorage.getItem("loggedInUser") || sessionStorage.getItem("loggedInUser") || "{}");
        const payload = JSON.stringify({ at: arrearsReasonsAt, username: user.username || "", lastUploadAt: lastUploadAtRaw || "", rows });
        if (payload.length < 4 * 1024 * 1024) sessionStorage.setItem("cm_work_snapshot_v1", payload);
    } catch (e) {
        // Not fatal: the page just loads its own rows.
    }
}

document.getElementById("noReasonBranchFilter")?.addEventListener("change", showNoReasonSummary);

document.getElementById("noReasonBackdrop")?.addEventListener("click", (e) => {
    if (e.target.id === "noReasonBackdrop") closeNoReasonSummary();
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
        ensureTableView();
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
// ADVANCED FILTERS TOGGLE
// The 8 less-frequently-used filter boxes (Officer Owner(ID), Promise
// Status, Currency, OS Classify, Class, PD, Occupation, Product Type)
// are collapsed by default so a phone screen isn't showing all 12
// filter boxes before the table itself. Collapsed state persists per
// device; the badge shows how many of the HIDDEN filters are
// currently active, so a collapsed panel never silently hides an
// active filter from view.
// ========================================

const ADVANCED_FILTER_KEYS = [
    "officerOwner", "promiseStatus", "currency", "osClassify",
    "class", "pd", "occupation", "productType"
];
const ADVANCED_FILTERS_OPEN_KEY = "arrears_advanced_filters_open";

const btnToggleAdvancedFilters = document.getElementById("btnToggleAdvancedFilters");
const advancedFilterGrid = document.getElementById("advancedFilterGrid");
const advancedFilterBadge = document.getElementById("advancedFilterBadge");

function setAdvancedFiltersOpen(open) {
    if (!btnToggleAdvancedFilters || !advancedFilterGrid) return;
    advancedFilterGrid.classList.toggle("show", open);
    btnToggleAdvancedFilters.setAttribute("aria-expanded", open ? "true" : "false");
    localStorage.setItem(ADVANCED_FILTERS_OPEN_KEY, open ? "1" : "0");
}

function updateAdvancedFilterBadge() {
    if (!advancedFilterBadge) return;
    const activeCount = ADVANCED_FILTER_KEYS.filter(key => filterEls[key].value.trim() !== "").length;
    advancedFilterBadge.textContent = String(activeCount);
    advancedFilterBadge.hidden = activeCount === 0;
}

if (btnToggleAdvancedFilters && advancedFilterGrid) {
    btnToggleAdvancedFilters.addEventListener("click", () => {
        setAdvancedFiltersOpen(!advancedFilterGrid.classList.contains("show"));
    });
    setAdvancedFiltersOpen(localStorage.getItem(ADVANCED_FILTERS_OPEN_KEY) === "1");
    updateAdvancedFilterBadge();
}

// ========================================
// COLUMN VISIBILITY
// Lets each device hide table columns it doesn't care about, since
// 26 columns is far more than fits on a phone. Column labels are
// read straight off the live <thead> rather than hardcoded here, so
// this can never drift out of sync if columns are ever added/
// reordered. No (1) and Customer (2) are excluded — they're the
// frozen/sticky columns the rest of the layout (and updateRowInTable's
// fixed cell indexes) depends on always being present.
// ========================================

const HIDDEN_COLUMNS_KEY = "arrears_hidden_columns";
const LOCKED_COLUMN_INDEXES = [1, 2]; // 1-based: No, Customer

function loadHiddenColumns() {
    try {
        const raw = JSON.parse(localStorage.getItem(HIDDEN_COLUMNS_KEY) || "[]");
        return new Set(Array.isArray(raw) ? raw.filter(n => Number.isInteger(n)) : []);
    } catch {
        return new Set();
    }
}

function saveHiddenColumns(set) {
    localStorage.setItem(HIDDEN_COLUMNS_KEY, JSON.stringify(Array.from(set)));
}

let hiddenColumns = loadHiddenColumns();

function applyHiddenColumns() {
    let styleEl = document.getElementById("arrearsHiddenColsStyle");
    if (!styleEl) {
        styleEl = document.createElement("style");
        styleEl.id = "arrearsHiddenColsStyle";
        document.head.appendChild(styleEl);
    }
    const rules = Array.from(hiddenColumns)
        .filter(n => !LOCKED_COLUMN_INDEXES.includes(n))
        .map(n => {
            const c = n >= 4 ? n + 1 : n; // CIF table: OS (USD) is column 4
            return `.table-card th:nth-child(${n}),.table-card td:nth-child(${n}),` +
                `.arr-cif-table th:nth-child(${c}),.arr-cif-table td:nth-child(${c}){display:none}`;
        })
        .join("");
    styleEl.textContent = rules;
}

function getColumnLabels() {
    return Array.from(document.querySelectorAll("#arrearsTable thead th"))
        .map(th => th.textContent.trim());
}

function renderColumnsPicker() {
    const list = document.getElementById("columnsList");
    if (!list) return;

    const labels = getColumnLabels();
    list.innerHTML = labels.map((label, i) => {
        const colIndex = i + 1;
        const locked = LOCKED_COLUMN_INDEXES.includes(colIndex);
        const checked = locked || !hiddenColumns.has(colIndex);
        return `
            <div class="columns-list-item${locked ? " columns-list-locked" : ""}">
                <input type="checkbox" id="colVis${colIndex}" data-col="${colIndex}" ${checked ? "checked" : ""} ${locked ? "disabled" : ""}>
                <label for="colVis${colIndex}">${escapeHtml(label)}</label>
            </div>
        `;
    }).join("");

    list.querySelectorAll("input[type=checkbox]").forEach(cb => {
        cb.addEventListener("change", () => {
            const colIndex = Number(cb.dataset.col);
            if (cb.checked) hiddenColumns.delete(colIndex);
            else hiddenColumns.add(colIndex);
            saveHiddenColumns(hiddenColumns);
            applyHiddenColumns();
        });
    });
}

applyHiddenColumns(); // restore saved column visibility on page load

const columnsBackdrop = document.getElementById("columnsBackdrop");

document.getElementById("btnColumns")?.addEventListener("click", () => {
    renderColumnsPicker();
    columnsBackdrop.classList.add("show");
    document.getElementById("arrearsMenuDropdown")?.classList.remove("show");
});

function closeColumnsModal() {
    columnsBackdrop.classList.remove("show");
}

document.getElementById("btnColumnsClose")?.addEventListener("click", closeColumnsModal);
document.getElementById("btnColumnsCloseX")?.addEventListener("click", closeColumnsModal);
columnsBackdrop?.addEventListener("click", (e) => {
    if (e.target.id === "columnsBackdrop") closeColumnsModal();
});

document.getElementById("btnColumnsShowAll")?.addEventListener("click", () => {
    hiddenColumns = new Set();
    saveHiddenColumns(hiddenColumns);
    applyHiddenColumns();
    renderColumnsPicker();
});


// ========================================
// OUT-OF-AREA ADDRESS — កែសម្រួលArrearក្រៅតំបន់
// The editor itself lives in assets/js/outarea-editor.js (shared with
// Master Data > Edit Out-of-Area Arrears). Here it's the modal opened
// from Work to complete > NoCoRespone, working on this page's rows.
// ========================================

OutAreaEditor.init({
    token: () => arrearsToken,
    getCandidateRows: () => currentRows,
    getAllRows: () => allRows,
    getOfficerNames: branch => distinctSorted(allRows.filter(r => r.branch === branch), "coResponse"),
    canEdit: outAreaCanEdit,
    onSaved: () => renderTable(currentRows),
    formatDateTime: formatRowDateTime12h
});

function openOutAreaModal() { OutAreaEditor.open(); }
function selectOutAreaCustomer(row) { return OutAreaEditor.select(row); }
function loadOutAreaOfficerNames() { return OutAreaEditor.loadOfficerNames(); }
const normalizeOfficerId = OutAreaEditor.normalizeOfficerId;

// ========================================
// ALL / MY OWN — Viewer_Staff scope choice
// Mirrors the Excel VBA Toolbar_Action_Download prompt. Only shown to
// Viewer_Staff accounts — for every other role the backend is either
// unrestricted or branch-scoped regardless of this choice, so asking
// would be a meaningless extra tap on every page visit.
// ========================================
function showArrearsScopeDialog() {
    return new Promise(resolve => {
        const dlg = document.getElementById("arrScopeDialog");
        const btnAll = document.getElementById("btnArrScopeAll");
        const btnOwn = document.getElementById("btnArrScopeOwn");
        if (!dlg || !btnAll || !btnOwn) {
            resolve(""); // markup missing — fail open to the original unrestricted view
            return;
        }

        function choose(mode) {
            dlg.classList.remove("show");
            btnAll.removeEventListener("click", onAll);
            btnOwn.removeEventListener("click", onOwn);
            resolve(mode);
        }
        function onAll() { choose(""); }
        function onOwn() { choose("own"); }

        btnAll.addEventListener("click", onAll);
        btnOwn.addEventListener("click", onOwn);
        dlg.classList.add("show");
    });
}

// ========================================
// PAGE READY
// ========================================

(async function initArrearsPage() {
    let loggedInUser = {};
    try {
        loggedInUser = JSON.parse(
            localStorage.getItem("loggedInUser") ||
            sessionStorage.getItem("loggedInUser") ||
            "{}"
        );
    } catch (e) {
        loggedInUser = {};
    }

    if (String(loggedInUser.role || "").toLowerCase() === "viewer_staff") {
        // Work to complete: Viewer_Staff only ever sees their own work,
        // so the summary tiles, branch / All·CO·FSRO filters and officer
        // search are hidden (filters left at "all", so nothing is
        // filtered out).
        document.querySelector("#noReasonCard .nr-stats")?.style.setProperty("display", "none");
        document.querySelector("#noReasonCard .nr-filters")?.style.setProperty("display", "none");
        document.getElementById("noReasonSearch")?.closest(".oa-search")?.style.setProperty("display", "none");

        // From a reminder the scope is already known: their own
        // NoCoRespone loans are under their ID (column V), everything
        // else under their name (column W).
        arrearsScopeMode = reminderFocus
            ? (reminderFocus.kind === "outarea" ? "own" : "")
            : pendingWorkLink
                ? (pendingWorkLink.kind === "outarea" ? "own" : "")
                : await showArrearsScopeDialog();
    }

    refreshArrears();
})();
console.log("Daily Arrears Ready.");
