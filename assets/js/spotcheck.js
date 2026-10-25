/* =========================================================
   pages/spotcheck/  ->  js/spotcheck.js
   Add / Edit / Delete for Facilities Spot Check records.

   Sits alongside spotcheck-loader.js the same way arrears.js
   sits alongside arrears-loader.js: the loader only handles
   topbar/bottomnav/splash/offline-banner/notification-badge;
   this file owns all page behavior and does NOT touch the
   component loading.

   Mirrors the VBA (ReportSP_Mongo + frmSpotCheck) logic:
   - CIF is the unique key
   - Required fields match ValidateSpotCheckForm
   - Delete removes from server first, then updates local state

   ASSUMPTIONS TO VERIFY / ADJUST:
   - API base + endpoints: reuses /api/reportsp/*
   - OPTION_LISTS below are placeholders — the real values come
     from the "Setting Up" sheet / combobox RowSource in Excel,
     which I don't have. Fill these in with real values.
   - Occupation autosuggest source: Setting Up!AO18:AO350 in
     Excel — mapped here to GET /api/settings/occupation-list
     returning a plain string array. Adjust to match your backend.
   - Owner restriction (5 hardcoded user IDs in IsAllowedReportSPUser)
     is NOT enforced client-side here — enforce server-side.
   ========================================================= */

const SC_EP = {
  list: API.BASE_URL + "/api/reportsp/get",
  upsert: API.BASE_URL + "/api/reportsp/upsert",
  delete: API.BASE_URL + "/api/reportsp/delete",
  nbcosByCif: API.BASE_URL + "/api/nbcos/byCif/",
  export: API.BASE_URL + "/api/spotcheck/export/",
};

// 0-based indices into the nbcos "values" array (178 cols) — confirmed
// from the live collection, used to autofill Section I on Add New.
const SC_NBCOS_MAP = {
  branch: 166,
  loanId: 4,
  customerName: 5,
  disbursementDate: 18,
  maturityDate: 19,
  loanSize: 9,
  currency: 17,
  outstanding: 12,
  interestRate: 16,
  loanType: 168,
  term: 22,
  creditOfficer: 26,
};

// ========================================
// TOKEN — same pattern as arrears.js
// ========================================
const scToken =
  localStorage.getItem("token") ||
  sessionStorage.getItem("token");


// Column order B..AI (34 values) — must match the VBA v[] array order exactly
const SC_FIELD_ORDER = [
  "branch", "cif", "loanId", "customerName", "disbursementDate", "maturityDate",
  "loanSize", "currency", "outstanding", "creditOfficer", "interestRate", "loanType", "term",
  "cycle", "repaymentHistory", "lateDays", "loanCompletion", "loanCompletionNote",
  "occupationInFile", "currentOccupation", "businessSituation", "occupationDifferenceNote",
  "collateralType", "collateralChange", "collateralPrice", "collateralNote",
  "purpose", "purposeNote", "repaymentSource", "repaymentSourceNote", "conclusion",
  "spotCheckDate", "owner", "timestamp",
];

// Real values confirmed from the VBA UserForm (frmSpotCheck) dropdowns
const SC_OPTION_LISTS = {
  cboRepaymentHistory: ["ទៀងទាត់", "យឺតយ៉ាវក្នុងខែ", "យឺតយ៉ាវ"],
  cboLoanCompletion: ["ត្រឹមត្រូវ", "មិនត្រឹមត្រូវតាមនីតិវិធីនិងសេចក្តីណែនាំ_Violate"],
  cboBusinessSituation: ["ដដែល", "កើនឡើង", "ឱនភាព", "ក្ស័យធន"],
  cboCollateralType: ["Payroll", "Clean", "ដីភូមិ និងផ្ទះ", "ដីភូមិ ផ្ទះ និងដីស្រែ", "ដីភូមិ", "ដីស្រែ"],
  cboCollateralChange: ["រក្សាភាពដើម", "ប្រែប្រួល", "NA"],
  cboCollateralPrice: ["អាចធានាឥណទានបាន", "មិនអាចធានាឥណទានបាន", "NA"],
  cboPurpose: ["ត្រឹមត្រូវតាមការស្នើសុំ", "មិនត្រឹមត្រូវតាមការស្នើសុំ"],
  cboRepaymentSource: ["ផ្ទាល់ខ្លួន", "សាច់ញាតិ", "អ្នកធានា", "ធនាគារ", "ស្ថាប័នហិរញ្ញវត្ថុ", "មេខ្យល់", "ផ្សេងៗ"],
};

const SC_CONCLUSION_OPTIONS = [
  "ឥណទានមិនមានសញ្ញាណហានិភ័យណាមួយកើតឡើងទេ ៕",
  "យោងតាមការត្រួតពិនិត្យឯកសារឥណទាន និងចុះត្រួតពិនិត្យដល់លំនៅដ្ឋាន បង្ហាញថាឥណទានមិនមានសញ្ញាណហានិភ័យណាមួយកើតឡើងទេ ៕",
];
const SC_CONCLUSION_OTHER = "ផ្សេងៗ (សរសេរផ្ទាល់)";

const SC_REQUIRED_IDS = [
  "txtCIF", "cboCycle", "txtSpotCheckDate", "cboRepaymentHistory", "cboLoanCompletion",
  "txtOccupationInFile", "txtCurrentOccupation", "cboBusinessSituation",
  "cboCollateralType", "cboCollateralChange", "cboCollateralPrice",
  "cboPurpose", "cboRepaymentSource", "cboConclusion",
];

// Required fields that live on Tab I — once all of these are filled while
// still viewing Tab I, the Save button switches to "បន្ទាប់" (Next).
const SC_TAB1_REQUIRED_IDS = ["txtCIF", "cboCycle", "txtSpotCheckDate", "cboRepaymentHistory", "cboLoanCompletion"];

let scAllRecords = [];      // raw {k, v, uploadedAt} from server
let scEditingCIF = null;    // null = adding new
let scDeleteTargetCIF = null;
let scOccupationSuggestions = [];
let scCurrentRows = [];     // whatever's currently displayed (post-filter, post-sort) — feeds Export Excel
let scViewMode = localStorage.getItem("sc_view") === "list" ? "list" : "card";
let scOriginalCycle = null; // the cycle value a record was opened with, while editing — see the cboCycle change listener
let scLastSavedCif = null;  // most recently saved/updated CIF — pinned to the top of the list/card view
let scRiskOnly = false;     // "ត្រូវតាមដាន" tile: only records whose conclusion flags a risk

const scT = (key) => (window.CMI18n ? CMI18n.t(key) : key);

// Toast instead of a blocking alert() (falls back to alert if toast.js
// didn't load).
function scNotify(message, type = "error") {
  if (typeof CMToast !== "undefined" && typeof CMToast.show === "function") {
    CMToast.show({ type, title: message, message: "", duration: 3500 });
  } else {
    alert(message);
  }
}

// A conclusion other than the two "no risk" presets means the officer
// wrote something to follow up on.
function scIsRisk(rec) {
  const c = String(rec.conclusion || "").trim();
  return !!c && !SC_CONCLUSION_OPTIONS.includes(c);
}

// ទៀងទាត់ / យឺតយ៉ាវក្នុងខែ / យឺតយ៉ាវ -> good / warn / bad colour
function scRepaymentTone(value) {
  const i = SC_OPTION_LISTS.cboRepaymentHistory.indexOf(value);
  return i === 0 ? "good" : i === 1 ? "warn" : i === 2 ? "bad" : "";
}

// ---------------------------------------------------------
// Bootstrapping — independent of the component loader; only
// needs the DOM elements this page itself owns (form, list).
// ---------------------------------------------------------
document.addEventListener("DOMContentLoaded", scInit);

async function scInit() {
  scPopulateSelectOptions();
  scBindEvents();
  await scRefreshList();
}

function scPopulateSelectOptions() {
  Object.entries(SC_OPTION_LISTS).forEach(([id, options]) => {
    const el = document.getElementById(id);
    if (!el) return;
    options.forEach((opt) => {
      const o = document.createElement("option");
      o.value = opt;
      o.textContent = opt;
      el.appendChild(o);
    });
  });

  // Conclusion: 2 preset long-form sentences + a custom "other" entry
  // (form dropdown only — the toolbar's Conclusion filter was removed).
  const conclusionEl = document.getElementById("cboConclusion");
  SC_CONCLUSION_OPTIONS.forEach((text) => {
    const o1 = document.createElement("option");
    o1.value = text;
    o1.textContent = text;
    conclusionEl.appendChild(o1);
  });
  const otherOpt = document.createElement("option");
  otherOpt.value = SC_CONCLUSION_OTHER;
  otherOpt.textContent = SC_CONCLUSION_OTHER;
  conclusionEl.appendChild(otherOpt);
}

// ---------------------------------------------------------
// Data loading
// ---------------------------------------------------------
async function scRefreshList() {
  try {
    const res = await fetch(SC_EP.list, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...scAuthHeaders() },
      body: JSON.stringify({}),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Load failed");
    scAllRecords = data.data || [];
    scRebuildOccupationSuggestions();
    scPopulateMonthOptions();
    scPopulateBranchOptions();
    scPopulateOfficerOptions();
    scPopulateProductTypeOptions();
    scRenderSummary();
    scRenderList();
  } catch (err) {
    console.error(err);
    scNotify("មិនអាចទាញយកទិន្នន័យបានទេ");
  }
}

// Occupation suggestions come from existing Spot Check records
// themselves — both "មុខរបរពេលខ្ចី" and "មុខរបរបច្ចុប្បន្ន" values already
// saved by any officer — rather than a separate fetch. Rebuilt every
// time the list reloads (after refresh, save, or delete), so a newly
// entered occupation shows up as a suggestion right away next time.
function scRebuildOccupationSuggestions() {
  const set = new Set();
  scAllRecords.forEach((r) => {
    const rec = scRecordToObj(r);
    [rec.occupationInFile, rec.currentOccupation].forEach((v) => {
      const trimmed = (v || "").trim();
      if (trimmed) set.add(trimmed);
    });
  });
  scOccupationSuggestions = Array.from(set).sort((a, b) => a.localeCompare(b));
}

// ---------------------------------------------------------
// Filter dropdowns — Month/Branch/Officer/Product Type. Branch, Officer
// and Product Type have no master-data source on this page (they're
// free-text fields on each record — see SC_FIELD_ORDER), so their
// options are derived from whatever's actually been entered, same
// low-tech approach assets/js/arrears.js uses for its own Branch/
// Officer/Product filters.
// ---------------------------------------------------------
function scDistinctSorted(records, field) {
  const set = new Set();
  records.forEach((r) => {
    const rec = scRecordToObj(r);
    const v = (rec[field] || "").trim();
    if (v) set.add(v);
  });
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

// Keeps the first option (the "All" placeholder) and replaces the rest,
// preserving the current selection if it's still among the new values.
function scSetSelectOptions(selectEl, values, labelFn) {
  const placeholder = selectEl.options[0];
  const currentValue = selectEl.value;
  selectEl.innerHTML = "";
  if (placeholder) selectEl.appendChild(placeholder);
  values.forEach((v) => {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = labelFn ? labelFn(v) : v;
    selectEl.appendChild(o);
  });
  const stillValid = Array.from(selectEl.options).some((o) => o.value === currentValue);
  selectEl.value = stillValid ? currentValue : "";
}

// "YYYY-MM" key derived from the stored "dd-mmm-yyyy" spotCheckDate, via
// the same scStoredToIso() the form already uses.
function scMonthKey(rec) {
  const iso = scStoredToIso(rec.spotCheckDate);
  return iso ? iso.slice(0, 7) : "";
}

function scPopulateMonthOptions() {
  const set = new Set();
  scAllRecords.forEach((r) => {
    const key = scMonthKey(scRecordToObj(r));
    if (key) set.add(key);
  });
  const months = Array.from(set).sort((a, b) => b.localeCompare(a)); // newest first
  scSetSelectOptions(document.getElementById("filterMonth"), months, (v) => {
    const [y, m] = v.split("-");
    return `${m}/${y}`;
  });
}

function scPopulateBranchOptions() {
  scSetSelectOptions(document.getElementById("filterBranch"), scDistinctSorted(scAllRecords, "branch"));
}

// Cascades on the selected Branch — only officers who have at least one
// spot check record under that branch show up.
function scPopulateOfficerOptions() {
  const branch = document.getElementById("filterBranch").value;
  const scoped = branch ? scAllRecords.filter((r) => scRecordToObj(r).branch === branch) : scAllRecords;
  scSetSelectOptions(document.getElementById("filterOfficer"), scDistinctSorted(scoped, "creditOfficer"));
}

function scPopulateProductTypeOptions() {
  scSetSelectOptions(document.getElementById("filterProductType"), scDistinctSorted(scAllRecords, "loanType"));
}

// ---------------------------------------------------------
// Rendering
// ---------------------------------------------------------
// "YYYY-MM" for the current local month, in the same shape scMonthKey()
// produces for a record's spotCheckDate — so the two compare directly.
function scCurrentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function scRenderSummary() {
  document.getElementById("statTotal").textContent = scAllRecords.length;

  // Was comparing new Date(rec.spotCheckDate) directly — but spotCheckDate
  // is stored "dd-mmm-yyyy" (or sometimes a raw Excel serial number),
  // neither of which native Date() parses, so this always silently read
  // as 0. scMonthKey() already does the real parsing (via scStoredToIso)
  // for the month filter dropdown — reuse it here too.
  const currentMonthKey = scCurrentMonthKey();
  const thisMonth = scAllRecords.filter((r) => scMonthKey(scRecordToObj(r)) === currentMonthKey).length;
  document.getElementById("statMonth").textContent = thisMonth;
  document.getElementById("statRisk").textContent =
    scAllRecords.filter((r) => scIsRisk(scRecordToObj(r))).length;
}

// Highlights the tile matching the current filter, counts active filters
// on the Filters button, and shows Clear only when something is set.
function scSyncFilterUi() {
  const month = document.getElementById("filterMonth").value;
  const active = ["filterMonth", "filterBranch", "filterOfficer", "filterProductType"]
    .filter((id) => document.getElementById(id).value).length;
  const badge = document.getElementById("scFilterBadge");
  badge.textContent = active;
  badge.hidden = !active;
  const anyFilter = active > 0 || scRiskOnly || !!document.getElementById("searchInput").value.trim();
  document.getElementById("btnClearFilter").hidden = !anyFilter;
  document.querySelectorAll("[data-sc-stat]").forEach((tile) => {
    const kind = tile.dataset.scStat;
    tile.classList.toggle("active",
      kind === "risk" ? scRiskOnly :
      kind === "month" ? (!scRiskOnly && month === scCurrentMonthKey() && active === 1) :
      !anyFilter);
  });
}

function scClearFilters() {
  document.getElementById("filterMonth").value = "";
  document.getElementById("filterBranch").value = "";
  document.getElementById("filterProductType").value = "";
  scPopulateOfficerOptions(); // branch reset -> officer list reverts to unscoped
  document.getElementById("filterOfficer").value = "";
  scRiskOnly = false;
}

// Empty/invalid dates always sort to the end, regardless of direction.
function scCompareDates(aIso, bIso) {
  if (!aIso && !bIso) return 0;
  if (!aIso) return 1;
  if (!bIso) return -1;
  return aIso.localeCompare(bIso);
}

const SC_SORTERS = {
  name_asc: (a, b) => (a.customerName || "").localeCompare(b.customerName || ""),
  name_desc: (a, b) => (b.customerName || "").localeCompare(a.customerName || ""),
  officer_asc: (a, b) => (a.creditOfficer || "").localeCompare(b.creditOfficer || ""),
  officer_desc: (a, b) => (b.creditOfficer || "").localeCompare(a.creditOfficer || ""),
  checkdate_desc: (a, b) => scCompareDates(scStoredToIso(b.spotCheckDate), scStoredToIso(a.spotCheckDate)),
  checkdate_asc: (a, b) => scCompareDates(scStoredToIso(a.spotCheckDate), scStoredToIso(b.spotCheckDate)),
  bookdate_desc: (a, b) => scCompareDates(scStoredToIso(b.disbursementDate), scStoredToIso(a.disbursementDate)),
  bookdate_asc: (a, b) => scCompareDates(scStoredToIso(a.disbursementDate), scStoredToIso(b.disbursementDate)),
};

function scRenderList() {
  const search = document.getElementById("searchInput").value.trim().toLowerCase();
  const monthFilter = document.getElementById("filterMonth").value;
  const branchFilter = document.getElementById("filterBranch").value;
  const officerFilter = document.getElementById("filterOfficer").value;
  const productFilter = document.getElementById("filterProductType").value;
  const sortBy = document.getElementById("sortSelect").value;

  const filtered = scAllRecords
    .map((r) => scRecordToObj(r))
    .filter((rec) => {
      const matchesSearch =
        !search ||
        rec.cif.toLowerCase().includes(search) ||
        (rec.customerName || "").toLowerCase().includes(search);
      const matchesMonth = !monthFilter || scMonthKey(rec) === monthFilter;
      const matchesBranch = !branchFilter || rec.branch === branchFilter;
      const matchesOfficer = !officerFilter || rec.creditOfficer === officerFilter;
      const matchesProduct = !productFilter || rec.loanType === productFilter;
      const matchesRisk = !scRiskOnly || scIsRisk(rec);
      return matchesSearch && matchesMonth && matchesBranch && matchesOfficer && matchesProduct && matchesRisk;
    })
    .sort(SC_SORTERS[sortBy] || SC_SORTERS.checkdate_desc);

  // Pin the just-saved/updated record to the top of whatever sort/filter
  // is currently applied, so the officer sees their own entry right away.
  if (scLastSavedCif) {
    const pinnedIndex = filtered.findIndex((rec) => rec.cif === scLastSavedCif);
    if (pinnedIndex > 0) {
      const [pinned] = filtered.splice(pinnedIndex, 1);
      filtered.unshift(pinned);
    }
  }

  scCurrentRows = filtered;
  document.getElementById("scResultCount").textContent = `${filtered.length} ករណី`;
  scSyncFilterUi();

  const container = document.getElementById("listContainer");
  const emptyState = document.getElementById("emptyState");
  const noResultsState = document.getElementById("noResultsState");

  container.classList.toggle("sc-list-table", scViewMode === "list");
  container.innerHTML = "";

  if (scAllRecords.length === 0) {
    emptyState.hidden = false;
    noResultsState.hidden = true;
    return;
  }
  emptyState.hidden = true;

  if (filtered.length === 0) {
    noResultsState.hidden = false;
    return;
  }
  noResultsState.hidden = true;

  if (scViewMode === "list") {
    container.appendChild(scBuildTable(filtered));
  } else {
    filtered.forEach((rec) => container.appendChild(scBuildCard(rec)));
  }
}

function scBuildTable(rows) {
  const wrap = document.createElement("div");
  wrap.className = "sc-table-wrap";

  const bodyRows = rows.map((rec) => `
    <tr data-cif="${scEscapeHtml(rec.cif)}">
      <td>${scEscapeHtml(rec.cif)}</td>
      <td>${scEscapeHtml(rec.customerName || "—")}</td>
      <td>${scEscapeHtml(rec.branch || "—")}</td>
      <td>${scEscapeHtml(rec.creditOfficer || "—")}</td>
      <td>${scEscapeHtml(rec.loanType || "—")}</td>
      <td>${scEscapeHtml(scDisplayDate(rec.spotCheckDate))}</td>
      <td>${scEscapeHtml(scDisplayDate(rec.disbursementDate))}</td>
      <td>
        <div class="sc-table-actions">
          <button class="sc-action-btn sc-export-btn" aria-label="ទាញយកទម្រង់"><img src="/CM_Pro/assets/icons/spotcheck/download.png" alt=""><span>ទាញយក</span></button>
          <button class="sc-action-btn sc-edit-btn" aria-label="កែសម្រួល"><img src="/CM_Pro/assets/icons/spotcheck/edit.png" alt=""><span>កែប្រែ</span></button>
          <button class="sc-action-btn sc-delete-btn" aria-label="លុប"><img src="/CM_Pro/assets/icons/spotcheck/delete.png" alt=""><span>លុប</span></button>
        </div>
      </td>
    </tr>
  `).join("");

  wrap.innerHTML = `
    <table class="sc-table">
      <thead>
        <tr>
          <th>CIF</th>
          <th>ឈ្មោះអតិថិជន</th>
          <th>សាខា</th>
          <th>មន្ត្រីឥណទាន</th>
          <th>ប្រភេទឥណទាន</th>
          <th>ថ្ងៃត្រួតពិនិត្យ</th>
          <th>ថ្ងៃបញ្ចេញកម្ចី</th>
          <th>សកម្មភាព</th>
        </tr>
      </thead>
      <tbody>${bodyRows}</tbody>
    </table>
  `;

  // Event delegation would need one listener per row anyway for the
  // row-click-to-open behavior, so bind per-row directly here — same
  // row count as the card grid it replaces, no extra cost.
  wrap.querySelectorAll("tbody tr").forEach((tr) => {
    const rec = rows.find((r) => r.cif === tr.dataset.cif);
    if (!rec) return;
    tr.querySelector(".sc-edit-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      scOpenForm(rec);
    });
    tr.querySelector(".sc-delete-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      scOpenDeleteConfirm(rec.cif);
    });
    tr.querySelector(".sc-export-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      scExportForm(rec.cif, e.currentTarget);
    });
    tr.addEventListener("click", () => scOpenForm(rec));
  });

  return wrap;
}

// ---------------------------------------------------------
// List / Card view toggle (persisted) — same pattern as List Officer
// ---------------------------------------------------------
function scApplyViewModeButtons() {
  document.getElementById("scViewCardBtn").classList.toggle("active", scViewMode === "card");
  document.getElementById("scViewListBtn").classList.toggle("active", scViewMode === "list");
}

function scSetViewMode(mode) {
  scViewMode = mode;
  localStorage.setItem("sc_view", mode);
  scApplyViewModeButtons();
  scRenderList();
}

// ---------------------------------------------------------
// Export Excel (⋮ menu) — the monthly Spot Check report, laid out like
// the bank's paper report: the ACLEDA logo top right, "Facilities Spot
// Check" and its period, a three-level header (I. Credit Information /
// II. Physical Inspection, their sections, then each column), one row per
// check (columns A–AF: No + Branch … សន្និដ្ឋាន, in the stored order),
// and the prepared / certified / approved signature block at the bottom.
// A second sheet counts the checks by branch. Exports scCurrentRows —
// whatever is visible after search / filter / sort. Built with ExcelJS
// (arrears-export.js loads it); free text goes in as text, never a formula.
// ---------------------------------------------------------

const SC_LOGO_URL = "/CM_Pro/assets/images/acleda-logo-whiteBG.png";
const SC_XL_FONT = "Krasar";
const SC_KH_DIGITS = "០១២៣៤៥៦៧៨៩";
const SC_KH_MONTHS = ["មករា", "កុម្ភៈ", "មីនា", "មេសា", "ឧសភា", "មិថុនា", "កក្កដា", "សីហា", "កញ្ញា", "តុលា", "វិច្ឆិកា", "ធ្នូ"];

// [field, column label, width, kind]; kind: date | money | center | bold | wrap
const SC_XL_COLUMNS = [
  ["no", "No", 5, "center"],
  ["branch", "Branch", 11],
  ["cif", "CIF", 10, "center"],
  ["loanId", "Contract LD", 17],
  ["customerName", "Name", 18, "wrap"],
  ["disbursementDate", "Disburse", 12, "date"],
  ["maturityDate", "Maturity", 12, "date"],
  ["loanSize", "Loan Size", 13, "money"],
  ["currency", "CCY", 7, "center"],
  ["outstanding", "O.S", 11, "money"],
  ["creditOfficer", "CO", 8, "bold"],
  ["interestRate", "អត្រាការប្រាក់", 15, "wrap"],
  ["loanType", "ប្រភេទឥណទាន", 15, "wrap"],
  ["term", "រយៈពេល", 8, "center"],
  ["cycle", "វដ្តត្រួតពិនិត្យ", 9, "center"],
  ["repaymentHistory", "ស្ថានភាព", 12, "wrap"],
  ["lateDays", "មូលហេតុ", 7, "wrap"],
  ["loanCompletion", "ស្ថានភាព", 12, "wrap"],
  ["loanCompletionNote", "មូលហេតុ", 11, "wrap"],
  ["occupationInFile", "មុខរបរពេលខ្ចី", 18, "wrap"],
  ["currentOccupation", "មុខរបរបច្ចុប្បន្ន", 18, "wrap"],
  ["businessSituation", "ស្ថានភាពជំនួញ", 10, "wrap"],
  ["occupationDifferenceNote", "បញ្ជាក់បន្ថែម", 16, "wrap"],
  ["collateralType", "ប្រភេទទ្រព្យ", 15, "wrap"],
  ["collateralChange", "ស្ថានភាពទ្រព្យ", 12, "wrap"],
  ["collateralPrice", "តម្លៃ", 13, "wrap"],
  ["collateralNote", "បញ្ជាក់បន្ថែម", 16, "wrap"],
  ["purpose", "គោលបំណងប្រើប្រាស់", 18, "wrap"],
  ["purposeNote", "បញ្ជាក់បន្ថែម", 16, "wrap"],
  ["repaymentSource", "ប្រភពប្រាក់សម្រាប់សង", 13, "wrap"],
  ["repaymentSourceNote", "បញ្ជាក់បន្ថែម", 16, "wrap"],
  ["conclusion", "សន្និដ្ឋាន", 56, "wrap"],
];

// Header levels 1 and 2, by column (1-based, inclusive), as on the paper report.
const SC_XL_PARTS = [
  [1, 19, "I. ព័ត៌មានឥណទាន (Credit Information)"],
  [20, 32, "II. ព័ត៌មានចុះត្រួតពិនិត្យជាក់ស្តែង (Physical Inspection on site visit)"],
];
const SC_XL_SECTIONS = [
  [1, 15, "ក. ព័ត៌មានអតិថិជន"],
  [16, 17, "ខ. ប្រវត្តិសង"],
  [18, 19, "គ. ស្ថានភាព"],
  [20, 23, "ក. ព័ត៌មានមុខរបរ"],
  [24, 27, "ខ. ព័ត៌មានទ្រព្យដាក់ធានាឥណទាន"],
  [28, 31, "គ. សញ្ញាណហានិភ័យ"],
  // សន្និដ្ឋាន (32) runs down through levels 2 and 3.
];

const scKhDigits = (s) => String(s).replace(/\d/g, (d) => SC_KH_DIGITS[d]);

function scExcelDate(stored) {
  const iso = scStoredToIso(stored || "");
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function scExcelNumber(value) {
  const s = String(value ?? "").replace(/[,\s]/g, "");
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : null;
}

// The report period: the Check Month filter's month, else the first and
// last spot-check date of the exported rows.
function scExportPeriod(rows) {
  const pad = (n) => String(n).padStart(2, "0");
  const fmt = (y, m, d) => `${pad(d)}-${pad(m)}-${String(y).slice(-2)}`;
  const month = document.getElementById("filterMonth")?.value;
  if (/^\d{4}-\d{2}$/.test(month || "")) {
    const [y, m] = month.split("-").map(Number);
    return `${fmt(y, m, 1)} To ${fmt(y, m, new Date(Date.UTC(y, m, 0)).getUTCDate())}`;
  }
  const isos = rows.map((r) => scStoredToIso(r.spotCheckDate || "")).filter(Boolean).sort();
  if (!isos.length) return "";
  const f = (iso) => { const [y, m, d] = iso.split("-").map(Number); return fmt(y, m, d); };
  return `${f(isos[0])} To ${f(isos[isos.length - 1])}`;
}

function scXlCellValue(rec, key, i) {
  if (key === "no") return i + 1;
  const raw = rec[key];
  if (raw === undefined || raw === null || String(raw).trim() === "") return null;
  if (key === "disbursementDate" || key === "maturityDate") return scExcelDate(raw) || String(raw);
  if (key === "loanSize" || key === "outstanding") { const n = scExcelNumber(raw); return n === null ? String(raw) : n; }
  if (key === "cycle") { const n = scExcelNumber(raw); return n === null ? String(raw) : n; }
  if (key === "interestRate") return scFormatRate(String(raw));
  if (key === "term") return scFormatTerm(String(raw));
  return String(raw);
}

// ---------------------------------------------------------
// Signatures — asked each time Excel / PDF is exported: the prepared
// date, and who prepares, certifies and approves, picked from List
// Officer by position. Who signs depends on the branch's class (its
// Branch Manager's "A" / "B" / "C"):
//   A  prepared: Assistant Branch Credit Manager "A"
//      certified: Branch Credit Manager "A"
//      approved: Branch Manager "A"
//   B  prepared: Branch Credit Manager "B" or Financial Service Relation Manager "B"
//      certified: — (left blank)
//      approved: Branch Manager "B"
//   C  prepared: Financial Service Relation Manager "C"
//      certified: — (left blank)
//      approved: Branch Manager "C"
// The title under each role is filled in from the position and can be
// edited; the last picks per branch and edited titles are remembered on
// this device.
// ---------------------------------------------------------
const SC_SIGN_RULES = {
  A: {
    prepared: ['Assistant Branch Credit Manager "A"'],
    certified: ['Branch Credit Manager "A"'],
    approved: ['Branch Manager "A"'],
  },
  B: {
    prepared: ['Branch Credit Manager "B"', 'Financial Service Relation Manager "B"'],
    certified: null,
    approved: ['Branch Manager "B"'],
  },
  C: {
    prepared: ['Financial Service Relation Manager "C"'],
    certified: null,
    approved: ['Branch Manager "C"'],
  },
};
const SC_SIGN_ROLES = [
  ["prepared", "រៀបចំដោយ"],
  ["certified", "បញ្ជាក់ដោយ"],
  ["approved", "អនុម័តដោយ"],
];
// Khmer titles under each role; class A's are the paper report's own,
// the others are a starting point the user can correct (kept per device).
const SC_POSITION_TITLES = {
  'Assistant Branch Credit Manager "A"': "អនុប្រធានឥណទាន",
  'Branch Credit Manager "A"': "ប្រធានឥណទានជាន់ខ្ពស់",
  'Branch Manager "A"': "នាយកជាន់ខ្ពស់",
  'Branch Credit Manager "B"': "ប្រធានឥណទាន",
  'Financial Service Relation Manager "B"': "ប្រធានផ្នែកទំនាក់ទំនងសេវាហិរញ្ញវត្ថុ",
  'Branch Manager "B"': "នាយកសាខា",
  'Financial Service Relation Manager "C"': "ប្រធានផ្នែកទំនាក់ទំនងសេវាហិរញ្ញវត្ថុ",
  'Branch Manager "C"': "នាយកសាខា",
};
const SC_SIGN_STORE = "sc_sign_memory";
const SC_SIGN_PLACE = "ស្វាយរៀង";
const scNormBranch = (b) => String(b || "").trim().toLowerCase();
const scClassOf = (position) => (/"([ABC])"/.exec(position || "") || [])[1] || "";

let scOfficerList = null;
async function scLoadOfficerList() {
  if (scOfficerList) return scOfficerList;
  try {
    const data = await API.get("/api/creditofficer/list");
    scOfficerList = data && data.ok ? (data.items || []) : [];
  } catch (e) {
    scOfficerList = [];
  }
  return scOfficerList;
}

function scSignMemory() {
  try { return JSON.parse(localStorage.getItem(SC_SIGN_STORE) || "{}"); } catch (e) { return {}; }
}
function scSaveSignMemory(mem) {
  try { localStorage.setItem(SC_SIGN_STORE, JSON.stringify(mem)); } catch (e) {}
}

// A branch's class from its Branch Manager's position (else any
// lettered position there); "A" when List Officer has nothing for it.
function scBranchClass(officers, branch) {
  const here = officers.filter((o) => scNormBranch(o.branch) === scNormBranch(branch));
  const bm = here.find((o) => /^Branch Manager "[ABC]"$/.test(o.position || ""));
  return scClassOf(bm?.position) || scClassOf(here.find((o) => scClassOf(o.position))?.position) || "A";
}

const scOfficerName = (o) => (o ? (o.nameKh || o.name || "").trim() : "");

// Resolves to { date, dateLine, roles: { prepared|certified|approved: { title, name } | null } },
// or null when cancelled.
async function scAskSignatures(rows) {
  const officers = await scLoadOfficerList();
  const mem = scSignMemory();
  const rowBranches = [...new Set(rows.map((r) => r.branch).filter(Boolean))];
  const branches = [...new Set([...rowBranches, ...officers.map((o) => o.branch).filter((b) => b && scNormBranch(b) !== "stop disburse")])]
    .sort((a, b) => a.localeCompare(b));
  const esc = scEscapeHtml;

  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "sc-overlay sc-overlay-center";
    overlay.innerHTML = `
      <div class="sc-confirm sc-sign" role="dialog" aria-modal="true" aria-labelledby="scSignTitle">
        <h3 id="scSignTitle">ហត្ថលេខាលើរបាយការណ៍</h3>
        <div class="sc-sign-role sc-sign-setup">
        <b>ការរៀបចំ</b>
        <div class="sc-sign-grid">
          <label>ថ្ងៃរៀបចំ<input type="date" id="scSignDate" required></label>
          <label>សាខា<select id="scSignBranch">${branches.map((b) => `<option value="${esc(b)}">${esc(b)}</option>`).join("")}</select></label>
          <label>ប្រភេទសាខា<select id="scSignClass"><option value="A">A</option><option value="B">B</option><option value="C">C</option></select></label>
          <label class="sc-sign-wide">ធ្វើនៅ<input type="text" id="scSignPlace" placeholder="ឧ. ស្វាយរៀង"></label>
        </div>
        </div>
        <div id="scSignRoles"></div>
        <p class="sc-confirm-warn" id="scSignError" hidden></p>
        <div class="sc-confirm-actions">
          <button type="button" class="sc-btn sc-btn-outline" data-sign="cancel">បោះបង់</button>
          <button type="button" class="sc-btn sc-btn-navy" data-sign="ok">នាំចេញ</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const $ = (sel) => overlay.querySelector(sel);
    const branchSel = $("#scSignBranch");
    const classSel = $("#scSignClass");
    branchSel.value = rowBranches.length === 1 ? rowBranches[0] : (mem.lastBranch && branches.includes(mem.lastBranch) ? mem.lastBranch : branches[0] || "");

    // One row per role: officer (eligible positions in this branch first,
    // then the same positions elsewhere) and the title.
    function renderRoles() {
      const cls = classSel.value;
      const rule = SC_SIGN_RULES[cls];
      const branch = branchSel.value;
      const picks = (mem.branches || {})[scNormBranch(branch)] || {};
      $("#scSignRoles").innerHTML = SC_SIGN_ROLES.map(([role, label]) => {
        const positions = rule[role];
        if (!positions) {
          return `<div class="sc-sign-role sc-sign-off"><b>${label}</b><span>— មិនមាន (ទុកទទេ) —</span></div>`;
        }
        const pool = officers.filter((o) => positions.includes(o.position));
        const here = pool.filter((o) => scNormBranch(o.branch) === scNormBranch(branch));
        const others = pool.filter((o) => scNormBranch(o.branch) !== scNormBranch(branch));
        const opt = (o) => `<option value="${esc(o.officerId)}" data-position="${esc(o.position)}">${esc(scOfficerName(o))} · ${esc(o.position)}${o.branch ? ` · ${esc(o.branch)}` : ""}</option>`;
        const chosen = picks[role] && pool.some((o) => o.officerId === picks[role]) ? picks[role] : (here[0]?.officerId || "");
        return `<div class="sc-sign-role" data-role="${role}">
          <b>${label}</b>
          <select data-officer>
            <option value="">— ទុកឈ្មោះទទេ —</option>
            ${here.length ? `<optgroup label="${esc(branch)}">${here.map(opt).join("")}</optgroup>` : ""}
            ${others.length ? `<optgroup label="សាខាផ្សេង">${others.map(opt).join("")}</optgroup>` : ""}
          </select>
          <input type="text" data-title placeholder="តួនាទី">
          ${pool.length ? "" : `<small>មិនទាន់មាន ${esc(positions.join(" / "))} ក្នុង List Officer</small>`}
        </div>`;
      }).join("");
      overlay.querySelectorAll(".sc-sign-role[data-role]").forEach((row) => {
        const sel = row.querySelector("[data-officer]");
        const title = row.querySelector("[data-title]");
        const role = row.dataset.role;
        sel.value = picks[role] && [...sel.options].some((o) => o.value === picks[role]) ? picks[role] : (sel.options[1]?.value || "");
        const fillTitle = () => {
          const position = sel.selectedOptions[0]?.dataset.position || rule[role][0];
          title.value = (mem.titles || {})[position] || SC_POSITION_TITLES[position] || position;
          title.dataset.position = position;
        };
        fillTitle();
        sel.addEventListener("change", fillTitle);
      });
    }

    // "ធ្វើនៅ" — the place written before the date ("ស្វាយរៀង, ថ្ងៃទី…");
    // always starts as ស្វាយរៀង (editable for this export).
    const placeInput = $("#scSignPlace");
    const fillPlace = () => { placeInput.value = SC_SIGN_PLACE; };
    const syncClass = () => { classSel.value = scBranchClass(officers, branchSel.value); fillPlace(); renderRoles(); };
    branchSel.addEventListener("change", syncClass);
    classSel.addEventListener("change", renderRoles);
    syncClass();
    setTimeout(() => $("#scSignDate").focus(), 50);

    const close = (result) => { overlay.remove(); resolve(result); };
    overlay.addEventListener("click", (e) => {
      const act = e.target.closest("[data-sign]")?.dataset.sign;
      if (e.target === overlay || act === "cancel") return close(null);
      if (act !== "ok") return;
      const date = $("#scSignDate").value;
      if (!date) {
        const err = $("#scSignError");
        err.textContent = "សូមបញ្ចូលថ្ងៃរៀបចំ";
        err.hidden = false;
        $("#scSignDate").focus();
        return;
      }
      const roles = {};
      const branchKey = scNormBranch(branchSel.value);
      mem.branches = mem.branches || {};
      mem.titles = mem.titles || {};
      mem.branches[branchKey] = mem.branches[branchKey] || {};
      SC_SIGN_ROLES.forEach(([role]) => { roles[role] = null; });
      overlay.querySelectorAll(".sc-sign-role[data-role]").forEach((row) => {
        const role = row.dataset.role;
        const id = row.querySelector("[data-officer]").value;
        const titleEl = row.querySelector("[data-title]");
        const officer = officers.find((o) => o.officerId === id);
        roles[role] = { title: titleEl.value.trim(), name: scOfficerName(officer) };
        mem.branches[branchKey][role] = id;
        const position = titleEl.dataset.position;
        if (position && titleEl.value.trim() && titleEl.value.trim() !== SC_POSITION_TITLES[position]) mem.titles[position] = titleEl.value.trim();
      });
      mem.lastBranch = branchSel.value;
      scSaveSignMemory(mem);
      const [y, m, d] = date.split("-").map(Number);
      const place = placeInput.value.trim() || "..................";
      close({
        date,
        dateLine: `${place}, ថ្ងៃទី${scKhDigits(d)} ខែ${SC_KH_MONTHS[m - 1]} ឆ្នាំ${scKhDigits(y)}`,
        roles,
      });
    });
  });
}

async function scLogoBase64() {
  try {
    const blob = await (await fetch(SC_LOGO_URL)).blob();
    return await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  } catch (e) {
    return null;   // the report still exports, without the logo
  }
}

// Checks per branch: total, each repayment history, and follow-ups.
function scExportSummary(rows) {
  const hist = SC_OPTION_LISTS.cboRepaymentHistory;
  const by = new Map();
  rows.forEach((rec) => {
    const k = rec.branch || "—";
    if (!by.has(k)) by.set(k, { branch: k, total: 0, risk: 0, h: hist.map(() => 0) });
    const g = by.get(k);
    g.total++;
    if (scIsRisk(rec)) g.risk++;
    const i = hist.indexOf(rec.repaymentHistory);
    if (i >= 0) g.h[i]++;
  });
  const list = [...by.values()].sort((a, b) => a.branch.localeCompare(b.branch));
  const total = { branch: "សរុប", total: 0, risk: 0, h: hist.map(() => 0), isTotal: true };
  list.forEach((g) => { total.total += g.total; total.risk += g.risk; g.h.forEach((n, i) => { total.h[i] += n; }); });
  return { head: ["Branch", "ចំនួនត្រួតពិនិត្យ", ...hist, "ត្រូវតាមដាន"], rows: [...list, total].map((g) => [g.branch, g.total, ...g.h, g.risk, !!g.isTotal]) };
}

async function scExportExcel() {
  const rows = scCurrentRows.slice();
  if (!rows.length) {
    scNotify("មិនមានទិន្នន័យសម្រាប់នាំចេញទេ", "warning");
    return;
  }
  if (!window.ArrExport?.workbook) {
    scNotify("មិនអាចបង្កើតឯកសារបានទេ — សូមពិនិត្យអ៊ីនធឺណិត ហើយសាកម្ដងទៀត", "error");
    return;
  }
  const sign = await scAskSignatures(rows);
  if (!sign) return;
  if (typeof showAppLoading === "function") showAppLoading("កំពុងបង្កើតឯកសារ Excel...");
  try {
    const wb = await ArrExport.workbook();
    const logo = await scLogoBase64();
    const logoId = logo ? wb.addImage({ base64: logo, extension: "png" }) : null;
    const title = "Facilities Spot Check";
    const period = scExportPeriod(rows);
    const n = SC_XL_COLUMNS.length;
    const HEAD = 4;                 // header rows 4–6, data from row 7
    const thin = { style: "thin", color: { argb: "FF000000" } };
    const box = { top: thin, left: thin, bottom: thin, right: thin };
    const font = (extra) => ({ name: SC_XL_FONT, size: 10, ...extra });
    const headStyle = (c) => {
      c.font = font({ bold: true });
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F2F2" } };
      c.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      c.border = box;
    };

    // ---------- sheet 1: the report ----------
    const ws = wb.addWorksheet("SpotCheck", {
      views: [{ state: "frozen", xSplit: 5, ySplit: HEAD + 2 }],
      pageSetup: {
        paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0,
        margins: { left: 0.25, right: 0.25, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
        printTitlesRow: `${HEAD}:${HEAD + 2}`,
      },
      headerFooter: { oddFooter: `&R&"${SC_XL_FONT}"&8&P / &N` },
    });
    SC_XL_COLUMNS.forEach(([, , width], j) => { ws.getColumn(j + 1).width = width; });

    ws.mergeCells(1, 1, 1, 12);
    Object.assign(ws.getCell(1, 1), { value: title });
    ws.getCell(1, 1).font = font({ size: 16, bold: true });
    ws.mergeCells(2, 1, 2, 12);
    ws.getCell(2, 1).value = period ? `Period: ${period}` : "";
    ws.getCell(2, 1).font = font({ size: 11, bold: true });
    ws.getRow(1).height = 26;
    ws.getRow(2).height = 20;
    ws.getRow(3).height = 14;
    if (logoId !== null) {
      // Top right, over the last columns (about 2.9 : 1, as the logo file).
      ws.addImage(logoId, { tl: { col: n - 3.2, row: 0.1 }, ext: { width: 200, height: 70 }, editAs: "oneCell" });
    }

    // Header: parts, sections, columns.
    SC_XL_PARTS.forEach(([c1, c2, label]) => {
      ws.mergeCells(HEAD, c1, HEAD, c2);
      ws.getCell(HEAD, c1).value = label;
    });
    SC_XL_SECTIONS.forEach(([c1, c2, label]) => {
      if (c2 > c1) ws.mergeCells(HEAD + 1, c1, HEAD + 1, c2);
      ws.getCell(HEAD + 1, c1).value = label;
    });
    SC_XL_COLUMNS.forEach(([, label], j) => { ws.getCell(HEAD + 2, j + 1).value = label; });
    ws.mergeCells(HEAD + 1, n, HEAD + 2, n);   // សន្និដ្ឋាន
    ws.getCell(HEAD + 1, n).value = SC_XL_COLUMNS[n - 1][1];
    for (let r = HEAD; r <= HEAD + 2; r++) {
      for (let j = 1; j <= n; j++) headStyle(ws.getCell(r, j));
    }
    ws.getRow(HEAD).height = 22;
    ws.getRow(HEAD + 1).height = 22;
    ws.getRow(HEAD + 2).height = 34;

    // One row per check. Row height from the longest wrapped text.
    rows.forEach((rec, i) => {
      const r = ws.getRow(HEAD + 3 + i);
      let lines = 1;
      SC_XL_COLUMNS.forEach(([key, , width, kind], j) => {
        const c = r.getCell(j + 1);
        const v = scXlCellValue(rec, key, i);
        c.value = v;
        c.border = box;
        c.font = font({ bold: kind === "bold" });
        if (v instanceof Date) c.numFmt = "dd/mm/yyyy";
        else if (typeof v === "number") c.numFmt = kind === "money" ? "#,##0" : "0";
        else c.numFmt = "@";
        const align = kind === "money" ? "right" : (kind === "center" || kind === "bold" || kind === "date") ? "center" : "left";
        c.alignment = { vertical: "middle", horizontal: align, wrapText: kind === "wrap" };
        if (kind === "wrap" && typeof v === "string") lines = Math.max(lines, Math.ceil(v.length / Math.max(4, width - 2)));
      });
      r.height = Math.max(30, 15 * lines);
    });

    // Signatures: approved (left), certified (middle), prepared (right);
    // a role with no signer (certified, for B / C branches) stays blank.
    const today = new Date();
    const sig = HEAD + 3 + rows.length + 2;
    const blocks = [[1, 8], [13, 20], [26, n]];
    const put = (row, [c1, c2], text, bold, size = 11) => {
      ws.mergeCells(row, c1, row, c2);
      const c = ws.getCell(row, c1);
      c.value = text;
      c.font = font({ size, bold });
      c.alignment = { horizontal: "center", vertical: "middle" };
    };
    // Date line, roles and titles 1.75× the old 11 pt; names 2×.
    put(sig, blocks[2], sign.dateLine, false, 19);
    [["approved", blocks[0]], ["certified", blocks[1]], ["prepared", blocks[2]]].forEach(([role, block]) => {
      const who = sign.roles[role];
      if (!who) return;
      put(sig + 1, block, SC_SIGN_ROLES.find((r) => r[0] === role)[1], true, 19);
      put(sig + 2, block, who.title, true, 19);
      // Signer's name twice the size, bold.
      put(sig + 7, block, who.name || "..................................", true, who.name ? 22 : 11);
    });
    // Room to sign (rows 3–6 under the title) is twice the old height.
    for (let r = sig; r <= sig + 7; r++) ws.getRow(r).height = r >= sig + 3 && r <= sig + 6 ? 40 : 20;
    ws.getRow(sig + 7).height = 34;
    for (let r = sig; r <= sig + 2; r++) ws.getRow(r).height = 30;

    // ---------- sheet 2: by branch ----------
    const sum = scExportSummary(rows);
    const ws2 = wb.addWorksheet("តាមសាខា", {
      views: [{ state: "frozen", xSplit: 1, ySplit: HEAD }],
      pageSetup: { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    });
    ws2.getCell(1, 1).value = title;
    ws2.getCell(1, 1).font = font({ size: 14, bold: true });
    ws2.getCell(2, 1).value = period ? `Period: ${period}` : "";
    ws2.getCell(2, 1).font = font({ size: 11, bold: true });
    sum.head.forEach((h, j) => {
      const c = ws2.getCell(HEAD, j + 1);
      c.value = h;
      headStyle(c);
      ws2.getColumn(j + 1).width = j === 0 ? 18 : 14;
    });
    ws2.getRow(HEAD).height = 30;
    sum.rows.forEach((vals, i) => {
      const isTotal = vals[vals.length - 1];
      vals.slice(0, -1).forEach((v, j) => {
        const c = ws2.getCell(HEAD + 1 + i, j + 1);
        c.value = v;
        c.border = box;
        c.font = font({ bold: isTotal });
        c.alignment = { horizontal: j === 0 ? "left" : "center", vertical: "middle" };
        if (isTotal) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F2F2" } };
      });
    });

    const pad = (x) => String(x).padStart(2, "0");
    const month = document.getElementById("filterMonth")?.value;
    const stamp = /^\d{4}-\d{2}$/.test(month || "") ? month.replace("-", "") : `${today.getFullYear()}${pad(today.getMonth() + 1)}${pad(today.getDate())}`;
    await ArrExport.save(wb, `SpotCheck_${stamp}.xlsx`);
  } catch (err) {
    console.error("[spotcheck export] failed:", err);
    scNotify("មិនអាចបង្កើតឯកសារបានទេ — សូមពិនិត្យអ៊ីនធឺណិត ហើយសាកម្ដងទៀត", "error");
  } finally {
    if (typeof hideAppLoading === "function") hideAppLoading();
  }
}

// ---------------------------------------------------------
// Export PDF (⋮ menu) — the same monthly report as the Excel (title and
// period, logo, the three-level header, columns A–AF, the signatures), on
// A4 landscape. The report is laid out as a page of HTML off screen — so
// the browser shapes the Khmer — then each A4 page is cut from it between
// rows (never through one), with the header rows repeated on every page
// and the signature block kept whole. html2canvas and jsPDF load on first
// use.
// ---------------------------------------------------------
const SC_PDF_LIBS = [
  "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js",
];
const SC_PDF_WIDTH_PX = 2600;   // report width before it is fitted to the page
// Short values (dates, amounts, codes) stay on one line on paper.
const SC_PDF_NOWRAP = new Set(["date", "money", "center", "bold"]);

const scScriptLoads = {};
function scLoadScript(url) {
  if (!scScriptLoads[url]) {
    scScriptLoads[url] = new Promise((resolve, reject) => {
      const el = document.createElement("script");
      el.src = url;
      el.onload = resolve;
      el.onerror = () => { delete scScriptLoads[url]; reject(new Error(`Could not load ${url}`)); };
      document.head.appendChild(el);
    });
  }
  return scScriptLoads[url];
}

// A cell as it reads on paper (dates dd/mm/yyyy, amounts #,##0).
function scPdfCellText(rec, key, i) {
  const v = scXlCellValue(rec, key, i);
  if (v === null || v === undefined) return "";
  if (v instanceof Date) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(v.getUTCDate())}/${pad(v.getUTCMonth() + 1)}/${v.getUTCFullYear()}`;
  }
  if (typeof v === "number") return (key === "loanSize" || key === "outstanding") ? Math.round(v).toLocaleString("en-US") : String(v);
  return v;
}

function scBuildReportElement(rows, sign) {
  const esc = scEscapeHtml;
  const n = SC_XL_COLUMNS.length;
  // Short values size their own column; text columns share the rest
  // (at least about their Excel width each).
  const cols = SC_XL_COLUMNS.map(([, , width, kind]) => (SC_PDF_NOWRAP.has(kind) ? "<col>" : `<col style="min-width:${width * 6}px">`)).join("");
  const parts = SC_XL_PARTS.map(([c1, c2, label]) => `<th colspan="${c2 - c1 + 1}">${esc(label)}</th>`).join("");
  const sections = SC_XL_SECTIONS.map(([c1, c2, label]) => `<th colspan="${c2 - c1 + 1}">${esc(label)}</th>`).join("")
    + `<th rowspan="2">${esc(SC_XL_COLUMNS[n - 1][1])}</th>`;
  const labels = SC_XL_COLUMNS.slice(0, n - 1).map((c) => `<th>${esc(c[1])}</th>`).join("");
  const body = rows.map((rec, i) => `<tr>${SC_XL_COLUMNS.map(([key, , , kind]) => {
    const cls = kind === "money" ? "r" : (kind === "center" || kind === "date" || kind === "bold") ? "c" : "";
    return `<td class="${cls}${kind === "bold" ? " b" : ""}${SC_PDF_NOWRAP.has(kind) ? " n" : ""}">${esc(scPdfCellText(rec, key, i))}</td>`;
  }).join("")}</tr>`).join("");
  const period = scExportPeriod(rows);

  const el = document.createElement("div");
  el.className = "sc-pdf-report";
  el.style.cssText = `position:fixed;left:-${SC_PDF_WIDTH_PX + 200}px;top:0;width:${SC_PDF_WIDTH_PX}px;background:#fff;color:#000;padding:0;`;
  el.innerHTML = `
    <style>
      .sc-pdf-report{font-family:'KRASAR',sans-serif;font-size:14px;line-height:1.35}
      .sc-pdf-report .top{display:flex;justify-content:space-between;align-items:flex-start;padding:4px 2px 10px}
      .sc-pdf-report h1{font-size:30px;margin:0 0 4px;font-weight:700}
      .sc-pdf-report .period{font-size:19px;font-weight:700}
      .sc-pdf-report .top img{height:96px}
      .sc-pdf-report table{width:100%;border-collapse:collapse}
      .sc-pdf-report th,.sc-pdf-report td{border:1px solid #000;padding:3px 4px;vertical-align:middle;overflow-wrap:break-word}
      .sc-pdf-report td.n{white-space:nowrap}
      .sc-pdf-report th{background:#F2F2F2;font-weight:700;text-align:center}
      .sc-pdf-report td.r{text-align:right}.sc-pdf-report td.c{text-align:center}.sc-pdf-report td.b{font-weight:700}
      .sc-pdf-report .sig{display:grid;grid-template-columns:1fr 1fr 1fr;padding-top:30px;font-size:33px;line-height:1.45;text-align:center}
      .sc-pdf-report .sig b{display:block}
      .sc-pdf-report .sig .line{margin-top:240px}
      .sc-pdf-report .sig .line.name{font-weight:700;font-size:38px}
    </style>
    <div class="top">
      <div><h1>Facilities Spot Check</h1><div class="period">${period ? `Period: ${esc(period)}` : ""}</div></div>
      <img src="${SC_LOGO_URL}" alt="">
    </div>
    <table>
      <colgroup>${cols}</colgroup>
      <thead><tr>${parts}</tr><tr>${sections}</tr><tr>${labels}</tr></thead>
      <tbody>${body}</tbody>
    </table>
    <div class="sig">${["approved", "certified", "prepared"].map((role) => {
      const who = sign.roles[role];
      const top = role === "prepared" ? esc(sign.dateLine) : "&nbsp;";
      if (!who) return `<div><div>${top}</div></div>`;
      const label = SC_SIGN_ROLES.find((r) => r[0] === role)[1];
      return `<div><div>${top}</div><b>${esc(label)}</b><b>${esc(who.title)}</b><div class="line${who.name ? " name" : ""}">${who.name ? esc(who.name) : ".................................."}</div></div>`;
    }).join("")}</div>`;
  return el;
}

async function scExportPdf() {
  const rows = scCurrentRows.slice();
  if (!rows.length) {
    scNotify("មិនមានទិន្នន័យសម្រាប់នាំចេញទេ", "warning");
    return;
  }
  const sign = await scAskSignatures(rows);
  if (!sign) return;
  if (typeof showAppLoading === "function") showAppLoading("កំពុងបង្កើតឯកសារ PDF...");
  let el = null;
  try {
    await Promise.all(SC_PDF_LIBS.map(scLoadScript));
    try { await document.fonts.load("12px KRASAR"); } catch (e) { /* drawn with the fallback font */ }
    el = scBuildReportElement(rows, sign);
    document.body.appendChild(el);
    // The columns' minimum widths can add up to more than the layout
    // width: widen it to the table, so nothing is cut off on the right.
    const tableW = el.querySelector("table").scrollWidth;
    if (tableW > el.clientWidth) el.style.width = `${tableW}px`;
    const img = el.querySelector(".top img");
    if (img && !img.complete) await new Promise((r) => { img.onload = img.onerror = r; });

    const SCALE = 2;
    const canvas = await window.html2canvas(el, { scale: SCALE, backgroundColor: "#ffffff", useCORS: true });
    const top = el.getBoundingClientRect().top;
    const y = (node, edge) => (node.getBoundingClientRect()[edge] - top) * SCALE;
    const thead = el.querySelector("thead");
    const headTop = y(thead, "top"), headBottom = y(thead, "bottom");
    // Where a page may end: after any body row, and before / after the signatures.
    const cuts = [...el.querySelectorAll("tbody tr")].map((tr) => y(tr, "bottom"));
    const sigTop = y(el.querySelector(".sig"), "top");
    const end = canvas.height;

    const pageW = 297, pageH = 210, margin = 8, footH = 6;
    const usableW = pageW - margin * 2, usableH = pageH - margin * 2 - footH;
    const pxPerMm = canvas.width / usableW;
    const pageHPx = usableH * pxPerMm;
    const headH = headBottom - headTop;

    // Pages as [from, to) slices of the canvas; pages after the first
    // start with the header rows again.
    const pages = [];
    let from = 0;
    while (from < end - 2) {
      const room = pages.length ? pageHPx - headH : pageHPx;
      let to = from + room;
      if (to >= end) { pages.push([from, end]); break; }
      const fit = cuts.filter((c) => c > from + 1 && c <= to);
      // The signature block moves whole to the next page when it doesn't fit.
      to = fit.length ? Math.max(...fit) : (sigTop > from + 1 && sigTop <= to ? sigTop : to);
      pages.push([from, to]);
      from = to;
    }

    const pdf = new window.jspdf.jsPDF({ orientation: "landscape", unit: "mm", format: "a4", compress: true });
    pages.forEach(([a, b], k) => {
      if (k > 0) pdf.addPage();
      const repeat = k > 0;
      const page = document.createElement("canvas");
      page.width = canvas.width;
      page.height = Math.ceil((b - a) + (repeat ? headH : 0));
      const ctx = page.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, page.width, page.height);
      let at = 0;
      if (repeat) { ctx.drawImage(canvas, 0, headTop, canvas.width, headH, 0, 0, canvas.width, headH); at = headH; }
      ctx.drawImage(canvas, 0, a, canvas.width, b - a, 0, at, canvas.width, b - a);
      pdf.addImage(page.toDataURL("image/jpeg", 0.9), "JPEG", margin, margin, usableW, page.height / pxPerMm);
      pdf.setFontSize(8);
      pdf.setTextColor(90);
      pdf.text(`${k + 1} / ${pages.length}`, pageW - margin, pageH - margin + 1, { align: "right" });
    });

    const pad = (x) => String(x).padStart(2, "0");
    const today = new Date();
    const month = document.getElementById("filterMonth")?.value;
    const stamp = /^\d{4}-\d{2}$/.test(month || "") ? month.replace("-", "") : `${today.getFullYear()}${pad(today.getMonth() + 1)}${pad(today.getDate())}`;
    pdf.save(`SpotCheck_${stamp}.pdf`);
  } catch (err) {
    console.error("[spotcheck pdf] failed:", err);
    scNotify("មិនអាចបង្កើតឯកសារបានទេ — សូមពិនិត្យអ៊ីនធឺណិត ហើយសាកម្ដងទៀត", "error");
  } finally {
    el?.remove();
    if (typeof hideAppLoading === "function") hideAppLoading();
  }
}

function scBuildCard(rec) {
  const card = document.createElement("div");
  card.className = "sc-card" + (scIsRisk(rec) ? " sc-card-risk" : "");
  card.setAttribute("role", "button");
  card.tabIndex = 0;
  const tone = scRepaymentTone(rec.repaymentHistory);
  const chips = [
    rec.branch && `<span class="sc-chip"><span class="ui-ico ui-ico-map" aria-hidden="true"></span>${scEscapeHtml(rec.branch)}</span>`,
    rec.creditOfficer && `<span class="sc-chip"><span class="ui-ico ui-ico-officer" aria-hidden="true"></span>${scEscapeHtml(rec.creditOfficer)}</span>`,
    rec.cycle && `<span class="sc-chip">${scEscapeHtml(scT("spotcheck.cycleChip"))} ${scEscapeHtml(rec.cycle)}</span>`,
    rec.repaymentHistory && `<span class="sc-chip sc-chip-${tone}">${scEscapeHtml(rec.repaymentHistory)}</span>`,
  ].filter(Boolean).join("");
  // Tapping the card edits; download / delete sit in the footer.
  card.innerHTML = `
    <div class="sc-card-top">
      <div class="sc-card-id">
        <div class="sc-card-name">${scEscapeHtml(rec.customerName || "—")}</div>
        <div class="sc-card-cif">CIF ${scEscapeHtml(rec.cif)}${rec.loanId ? ` · ${scEscapeHtml(rec.loanId)}` : ""}</div>
      </div>
      <span class="sc-card-date"><span class="ui-ico ui-ico-calendar" aria-hidden="true"></span>${scEscapeHtml(scDisplayDate(rec.spotCheckDate))}</span>
    </div>
    ${chips ? `<div class="sc-card-meta">${chips}</div>` : ""}
    ${rec.conclusion ? `<div class="sc-badge ${scIsRisk(rec) ? "sc-badge-risk" : ""}">${scIsRisk(rec) ? `<span class="ui-ico ui-ico-alert" aria-hidden="true"></span>` : ""}<span class="sc-badge-text">${scEscapeHtml(rec.conclusion)}</span></div>` : ""}
    <div class="sc-card-actions">
      <button type="button" class="sc-action-btn sc-export-btn" aria-label="ទាញយកទម្រង់">
        <span class="ui-ico ui-ico-install" aria-hidden="true"></span><span>${scEscapeHtml(scT("spotcheck.downloadBtn"))}</span>
      </button>
      <button type="button" class="sc-action-btn sc-delete-btn" aria-label="លុប">
        <span class="ui-ico ui-ico-trash" aria-hidden="true"></span><span>${scEscapeHtml(scT("spotcheck.deleteBtn"))}</span>
      </button>
      <span class="sc-card-open" aria-hidden="true"><span class="ui-ico ui-ico-edit"></span>›</span>
    </div>
  `;
  card.querySelector(".sc-delete-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    scOpenDeleteConfirm(rec.cif);
  });
  card.querySelector(".sc-export-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    scExportForm(rec.cif, e.currentTarget);
  });
  card.addEventListener("click", () => scOpenForm(rec));
  card.addEventListener("keydown", (e) => { if (e.key === "Enter") scOpenForm(rec); });
  return card;
}

async function scExportForm(cif, btn) {
  const label = btn.querySelector("span");
  const original = label.textContent;
  label.textContent = "កំពុងទាញយក...";
  btn.disabled = true;

  try {
    const res = await fetch(SC_EP.export + encodeURIComponent(cif), {
      headers: scAuthHeaders(),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.message || `HTTP ${res.status}`);
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Spotcheck_${cif}.docx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error("Export failed:", err);
    scNotify(`មិនអាចទាញយកទម្រង់បានទេ — ${err.message || ""}`);
  } finally {
    label.textContent = original;
    btn.disabled = false;
  }
}

// ---------------------------------------------------------
// Record <-> array mapping (mirrors v[] order from VBA)
// ---------------------------------------------------------
function scRecordToObj(r) {
  const obj = { cif: r.k, uploadedAt: r.uploadedAt };
  (r.v || []).forEach((val, i) => {
    obj[SC_FIELD_ORDER[i]] = val;
  });
  return obj;
}

function scFormToArray() {
  const get = (id) => document.getElementById(id).value.trim();
  const conclusionSel = get("cboConclusion");
  const conclusionFinal =
    conclusionSel === SC_CONCLUSION_OTHER ? get("txtConclusionOther") : conclusionSel;

  const map = {
    branch: get("txtBranch"),
    cif: get("txtCIF"),
    loanId: get("txtLoanID"),
    customerName: get("txtCustomerName"),
    disbursementDate: scIsoToStored(get("txtDisbursementDate")),
    maturityDate: scIsoToStored(get("txtMaturityDate")),
    loanSize: scUnformatAmount(get("txtLoanSize")),
    currency: get("txtCurrency"),
    outstanding: scUnformatAmount(get("txtOutstanding")),
    creditOfficer: get("txtCreditOfficer"),
    interestRate: scFormatRate(get("txtInterestRate")),
    loanType: get("txtLoanType"),
    term: scFormatTerm(get("txtTerm")),
    cycle: get("cboCycle"),
    repaymentHistory: get("cboRepaymentHistory"),
    lateDays: get("txtLateDays"),
    loanCompletion: get("cboLoanCompletion"),
    loanCompletionNote: get("txtLoanCompletionNote"),
    occupationInFile: get("txtOccupationInFile"),
    currentOccupation: get("txtCurrentOccupation"),
    businessSituation: get("cboBusinessSituation"),
    occupationDifferenceNote: get("txtOccupationDifferenceNote"),
    collateralType: get("cboCollateralType"),
    collateralChange: get("cboCollateralChange"),
    collateralPrice: get("cboCollateralPrice"),
    collateralNote: get("txtCollateralNote"),
    purpose: get("cboPurpose"),
    purposeNote: get("txtPurposeNote"),
    repaymentSource: get("cboRepaymentSource"),
    repaymentSourceNote: get("txtRepaymentSourceNote"),
    conclusion: conclusionFinal,
    spotCheckDate: scIsoToStored(get("txtSpotCheckDate")),
    owner: scGetCurrentUser(),
    timestamp: new Date().toISOString(),
  };
  return SC_FIELD_ORDER.map((key) => map[key] || "");
}

// ---------------------------------------------------------
// Form open / close
// ---------------------------------------------------------

// Sets a <select>'s value. If the stored value doesn't match any
// existing <option> (legacy wording, data from before this option
// list existed, etc.), a new option is added on the fly so the real
// saved value is preserved and visible instead of silently going
// blank — this was making Section II dropdowns look "not loaded".
// Khmer text can reach this page via different input paths (manual
// typing, copy/paste, the original VBA/Excel export) that don't always
// produce byte-identical Unicode for visually-identical text — the same
// glyphs can be encoded with combining characters in a different order.
// Comparing raw strings then treats a stored value as "not matching any
// option" even when it's really the same option, which was spawning a
// visually-duplicate extra <option> (see scSetSelectValue below).
// Normalizing to NFC before comparing fixes that.
function scNormalizeKhmer(s) {
  return (s || "").normalize("NFC").trim();
}

function scSetSelectValue(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  const normalized = scNormalizeKhmer(value);
  const match = [...el.options].find((o) => scNormalizeKhmer(o.value) === normalized);

  if (match) {
    el.value = match.value;
    return;
  }

  const v = value || "";
  if (v) {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = v;
    el.appendChild(o);
  }
  el.value = v;
}

// Collateral Type "Payroll"/"Clean" means there's no physical collateral
// to describe — Collateral (changed?) and Collateral Value (can it
// secure the loan?) don't apply, so they're forced to "NA" and locked.
// Any other Collateral Type is a real property type, so those two
// unlock again (and reset to blank, since there's no sensible value to
// carry over from the "NA" state).
const SC_NO_COLLATERAL_TYPES = new Set(["Payroll", "Clean"]);

function scApplyCollateralLock() {
  const typeEl = document.getElementById("cboCollateralType");
  const changeEl = document.getElementById("cboCollateralChange");
  const priceEl = document.getElementById("cboCollateralPrice");
  const noCollateral = SC_NO_COLLATERAL_TYPES.has(typeEl.value);

  changeEl.disabled = noCollateral;
  priceEl.disabled = noCollateral;

  if (noCollateral) {
    changeEl.value = "NA";
    priceEl.value = "NA";
  } else if (changeEl.value === "NA" || priceEl.value === "NA") {
    changeEl.value = "";
    priceEl.value = "";
  }
}

function scOpenForm(rec) {
  const overlay = document.getElementById("formOverlay");
  const title = document.getElementById("formPanelTitle");
  const form = document.getElementById("spotCheckForm");
  form.reset();
  scClearFieldErrors();
  scSwitchTab("tab1");
  scNbcosLookupToken++; // invalidate any in-flight lookup from a previous open
  scSetCifStatus(null, "");

  if (rec) {
    scEditingCIF = rec.cif;
    title.textContent = `កែសម្រួល — ${rec.cif}`;
    document.getElementById("txtCIF").value = rec.cif || "";
    document.getElementById("txtCIF").readOnly = true;
    document.getElementById("txtBranch").value = rec.branch || "";
    document.getElementById("txtLoanID").value = rec.loanId || "";
    document.getElementById("txtCustomerName").value = rec.customerName || "";
    document.getElementById("txtDisbursementDate").value = scStoredToIso(rec.disbursementDate);
    document.getElementById("txtMaturityDate").value = scStoredToIso(rec.maturityDate);
    document.getElementById("txtLoanSize").value = scFormatAmount(rec.loanSize);
    document.getElementById("txtCurrency").value = rec.currency || "";
    document.getElementById("txtOutstanding").value = scFormatAmount(rec.outstanding);
    document.getElementById("txtCreditOfficer").value = rec.creditOfficer || "";
    document.getElementById("txtInterestRate").value = rec.interestRate || "";
    document.getElementById("txtLoanType").value = rec.loanType || "";
    document.getElementById("txtTerm").value = rec.term || "";
    document.getElementById("cboCycle").value = rec.cycle || "";
    scOriginalCycle = rec.cycle || "";
    scSetSelectValue("cboRepaymentHistory", rec.repaymentHistory);
    document.getElementById("txtLateDays").value = rec.lateDays || "";
    scSetSelectValue("cboLoanCompletion", rec.loanCompletion);
    document.getElementById("txtLoanCompletionNote").value = rec.loanCompletionNote || "";
    document.getElementById("txtOccupationInFile").value = rec.occupationInFile || "";
    document.getElementById("txtCurrentOccupation").value = rec.currentOccupation || "";
    scSetSelectValue("cboBusinessSituation", rec.businessSituation);
    document.getElementById("txtOccupationDifferenceNote").value = rec.occupationDifferenceNote || "";
    scSetSelectValue("cboCollateralType", rec.collateralType);
    scSetSelectValue("cboCollateralChange", rec.collateralChange);
    scSetSelectValue("cboCollateralPrice", rec.collateralPrice);
    scApplyCollateralLock();
    document.getElementById("txtCollateralNote").value = rec.collateralNote || "";
    scSetSelectValue("cboPurpose", rec.purpose);
    document.getElementById("txtPurposeNote").value = rec.purposeNote || "";
    scSetSelectValue("cboRepaymentSource", rec.repaymentSource);
    document.getElementById("txtRepaymentSourceNote").value = rec.repaymentSourceNote || "";
    document.getElementById("txtSpotCheckDate").value = scStoredToIso(rec.spotCheckDate);

    const conclusionEl = document.getElementById("cboConclusion");
    const otherWrap = document.getElementById("conclusionOtherWrap");
    const otherInput = document.getElementById("txtConclusionOther");
    if (rec.conclusion && !SC_CONCLUSION_OPTIONS.includes(rec.conclusion)) {
      conclusionEl.value = SC_CONCLUSION_OTHER;
      otherInput.value = rec.conclusion;
      otherWrap.hidden = false;
    } else {
      conclusionEl.value = rec.conclusion || "";
      otherInput.value = "";
      otherWrap.hidden = true;
    }

    document.getElementById("metaUser").textContent = rec.owner ? `អ្នកបញ្ចូល: ${rec.owner}` : "";
    document.getElementById("metaTimestamp").textContent = rec.uploadedAt
      ? `ធ្វើបច្ចុប្បន្នភាព: ${scFormatTimestamp(rec.uploadedAt)}`
      : "";
  } else {
    scEditingCIF = null;
    scOriginalCycle = null;
    title.textContent = "បញ្ចូលថ្មី";
    document.getElementById("txtCIF").readOnly = false;
    document.getElementById("cboCycle").value = "1";
    document.getElementById("conclusionOtherWrap").hidden = true;
    document.getElementById("metaUser").textContent = "";
    document.getElementById("metaTimestamp").textContent = "";
    scApplyCollateralLock();
  }

  scUpdateSaveButtonMode();
  scUpdateTabBadges();
  overlay.hidden = false;
  document.body.style.overflow = "hidden";
}

function scCloseForm() {
  document.getElementById("formOverlay").hidden = true;
  document.body.style.overflow = "";
  scEditingCIF = null;
}

// ---------------------------------------------------------
// Validation — mirrors ValidateSpotCheckForm in the VBA
// ---------------------------------------------------------
function scClearFieldErrors() {
  SC_REQUIRED_IDS.forEach((id) => document.getElementById(id).classList.remove("sc-field-error"));
}

function scValidateForm() {
  scClearFieldErrors();
  let ok = true;
  SC_REQUIRED_IDS.forEach((id) => {
    const el = document.getElementById(id);
    if (!el.value.trim()) {
      el.classList.add("sc-field-error");
      ok = false;
    }
  });

  const conclusionEl = document.getElementById("cboConclusion");
  const otherInput = document.getElementById("txtConclusionOther");
  if (conclusionEl.value === SC_CONCLUSION_OTHER && !otherInput.value.trim()) {
    otherInput.classList.add("sc-field-error");
    ok = false;
  } else {
    otherInput.classList.remove("sc-field-error");
  }

  if (!ok) {
        const firstError = document.querySelector(".sc-field-error");
    if (firstError) {
      const panel = firstError.closest(".sc-tab-panel");
      if (panel) scSwitchTab(panel.id);
      firstError.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }
  return ok;
}

// ---------------------------------------------------------
// Save (Add or Edit — both are just an upsert by CIF)
// ---------------------------------------------------------
async function scSaveRecord(e) {
  e.preventDefault();

  // The form only submits (type="submit") when btnSaveForm is in "save"
  // mode — the Next step is type="button", handled separately on click.
  if (!scValidateForm()) return;

  const cif = document.getElementById("txtCIF").value.trim();
  const isNew = !scEditingCIF;

  if (isNew && scAllRecords.some((r) => r.k === cif)) {
    scNotify("CIF នេះមានរួចហើយ", "warning");
    return;
  }

  const v = scFormToArray();
  const btn = document.getElementById("btnSaveForm");
  btn.disabled = true;

  try {
    const res = await fetch(SC_EP.upsert, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...scAuthHeaders() },
      body: JSON.stringify({ rows: [{ k: cif, v }] }),
    });
    const data = await res.json();
    if (!res.ok || data.ok === false) throw new Error(data.error || "Save failed");

    scLastSavedCif = cif;
    scCloseForm();
    await scRefreshList();
  } catch (err) {
    console.error(err);
    scNotify("មិនអាចរក្សាទុកបានទេ");
  } finally {
    btn.disabled = false;
  }
}

// ---------------------------------------------------------
// Delete
// ---------------------------------------------------------
function scOpenDeleteConfirm(cif) {
  scDeleteTargetCIF = cif;
  document.getElementById("deleteCifLabel").textContent = cif;
  document.getElementById("deleteOverlay").hidden = false;
}

function scCloseDeleteConfirm() {
  document.getElementById("deleteOverlay").hidden = true;
  scDeleteTargetCIF = null;
}

async function scConfirmDelete() {
  if (!scDeleteTargetCIF) return;
  const btn = document.getElementById("btnConfirmDelete");
  btn.disabled = true;

  try {
    // Delete on server FIRST — only update local state if that succeeds,
    // same order as DeleteReportSP_RowMongo / DeleteSpotCheck in the VBA.
    const res = await fetch(SC_EP.delete, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...scAuthHeaders() },
      body: JSON.stringify({ k: scDeleteTargetCIF }),
    });
    const data = await res.json();
    if (!res.ok || data.ok === false) throw new Error(data.error || "Delete failed");

    scAllRecords = scAllRecords.filter((r) => r.k !== scDeleteTargetCIF);
    scRenderSummary();
    scRenderList();
    scCloseDeleteConfirm();
    if (scEditingCIF === scDeleteTargetCIF) scCloseForm();
  } catch (err) {
    console.error(err);
    scNotify("មិនអាចលុបបានទេ");
  } finally {
    btn.disabled = false;
  }
}

// ---------------------------------------------------------
// Autosuggest (Occupation In File / Current Occupation)
// ---------------------------------------------------------
function scBindAutosuggest(inputId, listId) {
  const input = document.getElementById(inputId);
  const list = document.getElementById(listId);

  input.addEventListener("input", () => {
    const kw = input.value.trim().toLowerCase();
    if (!kw) {
      list.hidden = true;
      return;
    }
    const matches = scOccupationSuggestions.filter((s) => s.toLowerCase().includes(kw)).slice(0, 20);
    list.innerHTML = "";
    matches.forEach((m) => {
      const li = document.createElement("li");
      li.textContent = m;
      li.addEventListener("click", () => {
        input.value = m;
        list.hidden = true;
      });
      list.appendChild(li);
    });
    list.hidden = matches.length === 0;
  });

  input.addEventListener("blur", () => {
    setTimeout(() => (list.hidden = true), 150);
  });
}

// ---------------------------------------------------------
// Autofill Section I from nbcos on CIF entry (Add New only —
// never overwrites an already-loaded record while editing)
// ---------------------------------------------------------
let scNbcosLookupToken = 0;

function scSetCifStatus(state, text) {
  const el = document.getElementById("cifLookupStatus");
  el.className = "sc-cif-status" + (state ? ` ${state}` : "");
  el.innerHTML = state === "loading" ? `<span class="sc-cif-spinner"></span>${text}` : text;
  el.hidden = !text;
}

// ---------------------------------------------------------
// Autofill Section I from nbcos on CIF entry (Add New only —
// never overwrites an already-loaded record while editing)
// ---------------------------------------------------------
async function scAutofillFromNbcos(cif) {
  if (!cif || scEditingCIF) {
    scSetCifStatus(null, "");
    return;
  }

  const myToken = ++scNbcosLookupToken;
  scSetCifStatus("loading", "សូមរង់ចាំ កំពុងទាញយកទិន្នន័យ...");

  try {
    const res = await fetch(SC_EP.nbcosByCif + encodeURIComponent(cif), {
      headers: scAuthHeaders(),
    });

    if (res.status === 404) {
      console.error("nbcos autofill: 404 — /api/nbcos/byCif route is not deployed on the server yet.");
      scSetCifStatus("error", "Route មិនទាន់មាននៅលើ server (404) — server.js ត្រូវ deploy ជាមុន");
      return;
    }
    if (res.status === 401 || res.status === 403) {
      console.error(`nbcos autofill: ${res.status} — auth token rejected by /api/nbcos/byCif.`);
      scSetCifStatus("error", "សិទ្ធិចូលប្រើមិនត្រឹមត្រូវ — សូម login ម្តងទៀត");
      return;
    }
    if (!res.ok) {
      const bodyText = await res.text().catch(() => "");
      console.error(`nbcos autofill: HTTP ${res.status}`, bodyText.slice(0, 300));
      scSetCifStatus("error", `មានបញ្ហាពី server (HTTP ${res.status})`);
      return;
    }

    const data = await res.json();

    // A newer lookup started while this one was in flight — drop this result
    if (myToken !== scNbcosLookupToken) return;

    if (!data.ok || !Array.isArray(data.values)) {
      scSetCifStatus("notfound", "រកមិនឃើញទិន្នន័យសម្រាប់ CIF នេះ — សូមបំពេញដោយផ្ទាល់");
      return;
    }

    const v = data.values;
    const at = (idx) => (v[idx] != null ? String(v[idx]).trim() : "");

    document.getElementById("txtBranch").value = at(SC_NBCOS_MAP.branch);
    document.getElementById("txtLoanID").value = at(SC_NBCOS_MAP.loanId);
    document.getElementById("txtCustomerName").value = at(SC_NBCOS_MAP.customerName);
    document.getElementById("txtDisbursementDate").value = scStoredToIso(at(SC_NBCOS_MAP.disbursementDate));
    document.getElementById("txtMaturityDate").value = scStoredToIso(at(SC_NBCOS_MAP.maturityDate));
    document.getElementById("txtLoanSize").value = scFormatAmount(at(SC_NBCOS_MAP.loanSize));
    document.getElementById("txtOutstanding").value = scFormatAmount(at(SC_NBCOS_MAP.outstanding));
    document.getElementById("txtLoanType").value = at(SC_NBCOS_MAP.loanType);
    document.getElementById("txtCreditOfficer").value = at(SC_NBCOS_MAP.creditOfficer);

    const currency = at(SC_NBCOS_MAP.currency);
    const currencyEl = document.getElementById("txtCurrency");
    if ([...currencyEl.options].some((o) => o.value === currency)) {
      currencyEl.value = currency;
    }

    document.getElementById("txtInterestRate").value = scFormatRate(at(SC_NBCOS_MAP.interestRate));
    document.getElementById("txtTerm").value = scFormatTerm(at(SC_NBCOS_MAP.term));

    scSetCifStatus("found", "✓ បានទាញយកទិន្នន័យដោយជោគជ័យ");
    setTimeout(() => {
      if (myToken === scNbcosLookupToken) scSetCifStatus(null, "");
    }, 2500);
  } catch (err) {
    if (myToken !== scNbcosLookupToken) return;
    console.error("nbcos autofill failed (likely CORS or network):", err.message || err);
    scSetCifStatus("error", `មានបញ្ហាបណ្តាញ — ${err.message || "សូមព្យាយាមម្តងទៀត"}`);
  }
}

// ---------------------------------------------------------
// Event binding
// ---------------------------------------------------------
function scBindEvents() {
  document.getElementById("btnAddNew").addEventListener("click", () => scOpenForm(null));
  document.getElementById("btnEmptyAdd").addEventListener("click", () => scOpenForm(null));
  document.getElementById("btnCloseForm").addEventListener("click", scCloseForm);
  document.getElementById("btnCancelForm").addEventListener("click", scCloseForm);
  document.getElementById("spotCheckForm").addEventListener("submit", scSaveRecord);
  // Next (Tab I -> Tab II) never submits the form — see scUpdateSaveButtonMode()
  // for why — so it's handled on click, independent of the submit event.
  document.getElementById("btnSaveForm").addEventListener("click", (e) => {
    if (e.currentTarget.dataset.mode === "next") {
      e.preventDefault();
      scSwitchTab("tab2");
    }
  });

  SC_TAB1_REQUIRED_IDS.forEach((id) => {
    document.getElementById(id).addEventListener("input", scUpdateSaveButtonMode);
    document.getElementById(id).addEventListener("change", scUpdateSaveButtonMode);
  });

  document.getElementById("btnCancelDelete").addEventListener("click", scCloseDeleteConfirm);
  document.getElementById("btnConfirmDelete").addEventListener("click", scConfirmDelete);

  const searchInput = document.getElementById("searchInput");
  const searchClearBtn = document.getElementById("searchClear");
  const scUpdateSearchClearVisibility = () => {
    searchClearBtn.style.display = searchInput.value ? "flex" : "none";
  };
  searchInput.addEventListener("input", scDebounce(() => {
    scUpdateSearchClearVisibility();
    scRenderList();
  }, 200));
  searchClearBtn.addEventListener("click", () => {
    searchInput.value = "";
    scUpdateSearchClearVisibility();
    scRenderList();
    searchInput.focus();
  });

  document.getElementById("filterMonth").addEventListener("change", scRenderList);
  document.getElementById("filterBranch").addEventListener("change", () => {
    scPopulateOfficerOptions(); // re-scope the Officer list to the newly picked Branch
    scRenderList();
  });
  document.getElementById("filterOfficer").addEventListener("change", scRenderList);
  document.getElementById("filterProductType").addEventListener("change", scRenderList);
  document.getElementById("sortSelect").addEventListener("change", scRenderList);

  document.getElementById("btnClearFilter").addEventListener("click", () => {
    scClearFilters();
    searchInput.value = "";
    scUpdateSearchClearVisibility();
    scRenderList();
  });

  const filterToggle = document.getElementById("btnScFilterToggle");
  filterToggle.addEventListener("click", () => {
    const panel = document.getElementById("scFilterPanel");
    panel.hidden = !panel.hidden;
    filterToggle.setAttribute("aria-expanded", String(!panel.hidden));
    filterToggle.classList.toggle("open", !panel.hidden);
  });

  // Summary tiles double as quick filters.
  document.querySelectorAll("[data-sc-stat]").forEach((tile) => tile.addEventListener("click", () => {
    const kind = tile.dataset.scStat;
    if (kind === "risk") {
      scRiskOnly = !scRiskOnly;
    } else {
      scClearFilters();
      if (kind === "month") document.getElementById("filterMonth").value = scCurrentMonthKey();
    }
    scRenderList();
  }));

  // Missing-required count on each form tab.
  const scForm = document.getElementById("spotCheckForm");
  scForm.addEventListener("input", scUpdateTabBadges);
  scForm.addEventListener("change", scUpdateTabBadges);

  document.getElementById("scViewCardBtn").addEventListener("click", () => scSetViewMode("card"));
  document.getElementById("scViewListBtn").addEventListener("click", () => scSetViewMode("list"));
  scApplyViewModeButtons();

  const scMenuToggle = document.getElementById("btnScMenu");
  const scMenuDropdown = document.getElementById("scMenuDropdown");
  if (scMenuToggle && scMenuDropdown) {
    scMenuToggle.addEventListener("click", (e) => {
      e.stopPropagation();
      scMenuDropdown.classList.toggle("show");
    });
    scMenuDropdown.addEventListener("click", (e) => {
      if (e.target.closest("button")) scMenuDropdown.classList.remove("show");
    });
    document.addEventListener("click", (e) => {
      if (!scMenuDropdown.contains(e.target) && e.target !== scMenuToggle) {
        scMenuDropdown.classList.remove("show");
      }
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") scMenuDropdown.classList.remove("show");
    });
  }
  document.getElementById("btnScExportExcel").addEventListener("click", scExportExcel);
  document.getElementById("btnScExportPdf")?.addEventListener("click", scExportPdf);

  scBindAutosuggest("txtOccupationInFile", "lstOccupationInFileSuggest");
  scBindAutosuggest("txtCurrentOccupation", "lstCurrentOccupationSuggest");

  document.querySelectorAll(".sc-tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => scSwitchTab(btn.dataset.tab));
  });

  document.getElementById("cboConclusion").addEventListener("change", (e) => {
    const wrap = document.getElementById("conclusionOtherWrap");
    wrap.hidden = e.target.value !== SC_CONCLUSION_OTHER;
    if (!wrap.hidden) document.getElementById("txtConclusionOther").focus();
  });

  document.getElementById("cboCollateralType").addEventListener("change", scApplyCollateralLock);

  // Editing an existing record and changing the cycle number means this
  // is a different visit — the previously-saved check date no longer
  // applies, so clear it and make the officer pick the date of this visit.
  document.getElementById("cboCycle").addEventListener("change", (e) => {
    if (scEditingCIF && e.target.value !== scOriginalCycle) {
      document.getElementById("txtSpotCheckDate").value = "";
    }
  });

  document.getElementById("txtTerm").addEventListener("blur", (e) => {
    e.target.value = scFormatTerm(e.target.value);
  });
  document.getElementById("txtInterestRate").addEventListener("blur", (e) => {
    e.target.value = scFormatRate(e.target.value);
  });
  document.getElementById("txtLoanSize").addEventListener("blur", (e) => {
    e.target.value = scFormatAmount(e.target.value);
  });
  document.getElementById("txtOutstanding").addEventListener("blur", (e) => {
    e.target.value = scFormatAmount(e.target.value);
  });

  document.getElementById("txtCIF").addEventListener("blur", (e) => {
    const cif = e.target.value.trim();
    if (!cif || scEditingCIF) return;

    const existing = scAllRecords.find((r) => r.k === cif);
    if (existing) {
      scOpenForm(scRecordToObj(existing));
      return;
    }
    scAutofillFromNbcos(cif);
  });

  document.getElementById("txtSpotCheckDate").addEventListener("change", (e) => {
    if (!e.target.value) return;
    const card = document.getElementById("cardRepaymentHistory");
    card.scrollIntoView({ behavior: "smooth", block: "center" });
    card.classList.remove("sc-highlight");
    void card.offsetWidth; // restart the animation if it's already run once
    card.classList.add("sc-highlight");
    setTimeout(() => card.classList.remove("sc-highlight"), 2400);
  });
}

function scUpdateTabBadges() {
  ["tab1", "tab2"].forEach((tabId) => {
    const panel = document.getElementById(tabId);
    const missing = SC_REQUIRED_IDS.filter((id) => {
      const el = document.getElementById(id);
      return el && panel.contains(el) && !String(el.value || "").trim();
    }).length;
    const badge = document.querySelector(`[data-tab-badge="${tabId}"]`);
    if (!badge) return;
    badge.hidden = false;
    badge.classList.toggle("done", missing === 0);
    badge.textContent = missing === 0 ? "✓" : String(missing);
    badge.title = missing === 0 ? "" : scT("spotcheck.tabMissing").replace("{n}", missing);
  });
}

function scSwitchTab(tabId) {
  document.querySelectorAll(".sc-tab-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tabId);
  });
  document.querySelectorAll(".sc-tab-panel").forEach((panel) => {
    panel.hidden = panel.id !== tabId;
  });
  scUpdateSaveButtonMode();
  scUpdateTabBadges();
}

// Tab I complete + still viewing Tab I -> button becomes "បន្ទាប់" (Next),
// which just advances to Tab II instead of submitting. Anywhere else,
// it's the real Save/Edit button.
//
// The Next step also switches the button's own type to "button" (not
// "submit") — some browsers/webviews don't reliably exclude required
// fields inside a hidden="" tab panel from native constraint validation
// before the submit event fires, which silently blocks the click with
// no visible error. type="button" sidesteps native form submission
// (and its validation) entirely for this step; only the real Save/Edit
// step (type="submit") goes through scSaveRecord()'s own scValidateForm().
function scUpdateSaveButtonMode() {
  const btn = document.getElementById("btnSaveForm");
  const onTab1 = !document.getElementById("tab1").hidden;
  const tab1Complete = SC_TAB1_REQUIRED_IDS.every((id) => document.getElementById(id).value.trim());

  if (onTab1 && tab1Complete) {
    btn.textContent = "បន្ទាប់";
    btn.dataset.mode = "next";
    btn.type = "button";
  } else {
    btn.textContent = scEditingCIF ? "កែប្រែ" : "រក្សាទុក";
    btn.dataset.mode = "save";
    btn.type = "submit";
  }
}

// ---------------------------------------------------------
// Helpers
// ---------------------------------------------------------
function scAuthHeaders() {
  return scToken ? { Authorization: `Bearer ${scToken}` } : {};
}

function scGetCurrentUser() {
  try {
    const user = JSON.parse(
      localStorage.getItem("loggedInUser") || sessionStorage.getItem("loggedInUser") || "{}"
    );
    return user.fullname || user.username || "";
  } catch {
    return "";
  }
}

function scEscapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function scDebounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function scParseDateFlexible(str) {
  if (!str) return null;
  const d = new Date(str);
  return isNaN(d) ? null : d;
}

const SC_MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// Native <input type="date"> value ("yyyy-mm-dd") -> stored "dd-mmm-yyyy".
// Stores the FULL year (not 2-digit) — a 2-digit year is inherently
// ambiguous for any date more than ~40-50 years from today, which is
// exactly what caused 2032 to round-trip back as 1932.
function scIsoToStored(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return "";
  const dd = String(d).padStart(2, "0");
  return `${dd}-${SC_MONTHS[m - 1]}-${y}`;
}

// Stored "dd-mmm-yy", a bare Excel serial date number (e.g. "46177" —
// real data synced from the Excel sheet where date cells came through
// as raw numbers), or already-ISO -> "yyyy-mm-dd" for the date input.
function scStoredToIso(stored) {
  if (!stored) return "";
  const trimmed = stored.trim();

  const dmy = /^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/.exec(trimmed);
  if (dmy) {
    const dd = String(parseInt(dmy[1], 10)).padStart(2, "0");
    const monthIdx = SC_MONTHS.findIndex((mo) => mo.toLowerCase() === dmy[2].toLowerCase());
    if (monthIdx === -1) return "";
    const mm = String(monthIdx + 1).padStart(2, "0");
    let yy = dmy[3];
    if (yy.length === 2) yy = (Number(yy) < 70 ? "20" : "19") + yy;
    return `${yy}-${mm}-${dd}`;
  }

  // Bare Excel serial number (no letters/dashes) — e.g. "46177".
  // Excel epoch is Dec 30 1899; serials in a sane date range (roughly
  // 1970-2100) are 5-6 digits, well outside a plausible 4-digit year,
  // so this check won't collide with real ISO years.
  if (/^\d{5,6}$/.test(trimmed)) {
    const serial = Number(trimmed);
    const d = new Date((serial - 25569) * 86400 * 1000);
    const year = d.getUTCFullYear();
    // Guard against genuinely bad stored data (e.g. a stray small serial
    // like "11962" -> 1932) that would otherwise render as a convincing
    // but wrong date. Leave it blank instead so it's obviously missing.
    if (!isNaN(d) && year >= 1990 && year <= 2060) {
      return `${year}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    }
    console.warn(`Ignoring implausible stored date serial "${trimmed}" (would resolve to ${year})`);
    return "";
  }

  // Already ISO (yyyy-mm-dd) or something Date() can parse
  const d = scParseDateFlexible(trimmed);
  if (!d) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Normalizes ANY stored date representation (proper "dd-mmm-yyyy", a bare
// Excel serial number from data synced from the Excel sheet — e.g.
// "46326" — or already-ISO) into the canonical "dd-mmm-yyyy" display
// format, by round-tripping through scStoredToIso()/scIsoToStored(), the
// same conversion the edit form already uses for its date inputs. Without
// this, a record whose date came through as a raw serial shows that
// serial number as-is in the list/card/export instead of a real date.
// Falls back to the raw stored string (or "—") only if it truly can't be
// parsed as a date.
function scDisplayDate(stored) {
  if (!stored) return "—";
  const iso = scStoredToIso(stored);
  return iso ? scIsoToStored(iso) : stored;
}

// "36" -> "36ខែ" — only appends the suffix if the value is a bare number
function scFormatTerm(val) {
  const trimmed = (val || "").trim();
  if (/^\d+$/.test(trimmed)) return `${trimmed}ខែ`;
  return trimmed;
}

// "18" -> "18%ក្នុងមួយឆ្នាំ" — only appends the suffix if the value is a bare number
function scFormatRate(val) {
  const trimmed = (val || "").trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) return `${trimmed}%ក្នុងមួយឆ្នាំ`;
  return trimmed;
}

// "108000000" or an already-formatted "108,000,000.00" -> "108,000,000.00"
// (#,##0.00) — Loan Size / Outstanding display format. Strips existing
// commas first so re-formatting an already-formatted value on a second
// blur is a no-op rather than compounding. Non-numeric input (empty,
// partially typed) is left as-is rather than forced to "0.00".
function scFormatAmount(val) {
  const cleaned = String(val || "").replace(/,/g, "").trim();
  if (!cleaned || isNaN(Number(cleaned))) return val || "";
  return Number(cleaned).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Reverses scFormatAmount() for storage — the DB keeps these as plain
// numeric strings (no thousand separators), same shape as the existing
// data, so only the on-screen display is formatted.
function scUnformatAmount(val) {
  return String(val || "").replace(/,/g, "").trim();
}

function scFormatTimestamp(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}
