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

// Standalone microservice (cm-pro-nbcos-service) — separate deployment
// from the main API, connects to the same DB/JWT but its own host.
// Set this to your deployed Render URL after deploying that service.
const SC_NBCOS_SERVICE_URL = "https://cm-pro-nbcos-service.onrender.com"; // TODO: confirm/replace with your actual deployed URL

const SC_EP = {
  list: API.BASE_URL + "/api/reportsp/get",
  upsert: API.BASE_URL + "/api/reportsp/upsert",
  delete: API.BASE_URL + "/api/reportsp/delete",
  occupationList: API.BASE_URL + "/api/settings/occupation-list",
  nbcosByCif: SC_NBCOS_SERVICE_URL + "/api/nbcos/byCif/",
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
  cboCollateralChange: ["រក្សាភាពដើម", "ប្រែប្រួល"],
  cboCollateralPrice: ["អាចធានាឥណទានបាន", "មិនអាចធានាឥណទានបាន"],
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

let scAllRecords = [];      // raw {k, v, uploadedAt} from server
let scEditingCIF = null;    // null = adding new
let scDeleteTargetCIF = null;
let scOccupationSuggestions = [];

// ---------------------------------------------------------
// Bootstrapping — independent of the component loader; only
// needs the DOM elements this page itself owns (form, list).
// ---------------------------------------------------------
document.addEventListener("DOMContentLoaded", scInit);

async function scInit() {
  scPopulateSelectOptions();
  scBindEvents();
  await scLoadOccupationSuggestions();
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

  // Cycle: typeable input backed by a 1-10 datalist (select + type both work)
  const cycleList = document.getElementById("cycleOptions");
  for (let i = 1; i <= 10; i++) {
    const o = document.createElement("option");
    o.value = String(i);
    cycleList.appendChild(o);
  }

  // Conclusion: 2 preset long-form sentences + a custom "other" entry
  const conclusionEl = document.getElementById("cboConclusion");
  const filterEl = document.getElementById("filterConclusion");
  SC_CONCLUSION_OPTIONS.forEach((text) => {
    const o1 = document.createElement("option");
    o1.value = text;
    o1.textContent = text;
    conclusionEl.appendChild(o1);

    const o2 = document.createElement("option");
    o2.value = text;
    o2.textContent = text;
    filterEl.appendChild(o2);
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
    scRenderSummary();
    scRenderList();
  } catch (err) {
    console.error(err);
    if (typeof CMToast !== "undefined") CMToast.show("មិនអាចទាញយកទិន្នន័យបានទេ", "error");
  }
}

async function scLoadOccupationSuggestions() {
  try {
    const res = await fetch(SC_EP.occupationList);
    const data = await res.json();
    scOccupationSuggestions = Array.isArray(data) ? data : (data.data || []);
  } catch (err) {
    console.warn("Occupation suggestion list unavailable", err);
    scOccupationSuggestions = [];
  }
}

// ---------------------------------------------------------
// Rendering
// ---------------------------------------------------------
function scRenderSummary() {
  document.getElementById("statTotal").textContent = scAllRecords.length;

  const now = new Date();
  const thisMonth = scAllRecords.filter((r) => {
    const rec = scRecordToObj(r);
    const d = scParseDateFlexible(rec.spotCheckDate);
    return d && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;
  document.getElementById("statMonth").textContent = thisMonth;
}

function scRenderList() {
  const search = document.getElementById("searchInput").value.trim().toLowerCase();
  const conclusionFilter = document.getElementById("filterConclusion").value;

  const filtered = scAllRecords.filter((r) => {
    const rec = scRecordToObj(r);
    const matchesSearch =
      !search ||
      rec.cif.toLowerCase().includes(search) ||
      (rec.customerName || "").toLowerCase().includes(search);
    const matchesConclusion = !conclusionFilter || rec.conclusion === conclusionFilter;
    return matchesSearch && matchesConclusion;
  });

  const container = document.getElementById("listContainer");
  const emptyState = document.getElementById("emptyState");
  const noResultsState = document.getElementById("noResultsState");

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

  filtered
    .sort((a, b) => (b.uploadedAt || "").localeCompare(a.uploadedAt || ""))
    .forEach((r) => container.appendChild(scBuildCard(scRecordToObj(r))));
}

function scBuildCard(rec) {
  const card = document.createElement("div");
  card.className = "sc-card";
  card.innerHTML = `
    <div class="sc-card-top">
      <div>
        <div class="sc-card-cif">${scEscapeHtml(rec.cif)}</div>
        <div class="sc-card-name">${scEscapeHtml(rec.customerName || "—")}</div>
      </div>
      <div class="sc-card-actions">
        <button class="sc-edit-btn" aria-label="កែសម្រួល">✎</button>
        <button class="sc-delete-btn" aria-label="លុប">🗑</button>
      </div>
    </div>
    <div class="sc-card-meta">
      <span>${scEscapeHtml(rec.branch || "—")}</span>
      <span>${scEscapeHtml(rec.spotCheckDate || "—")}</span>
      ${rec.conclusion ? `<span class="sc-badge">${scEscapeHtml(rec.conclusion)}</span>` : ""}
    </div>
  `;
  card.querySelector(".sc-edit-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    scOpenForm(rec);
  });
  card.querySelector(".sc-delete-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    scOpenDeleteConfirm(rec.cif);
  });
  card.addEventListener("click", () => scOpenForm(rec));
  return card;
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
    loanSize: get("txtLoanSize"),
    currency: get("txtCurrency"),
    outstanding: get("txtOutstanding"),
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
function scSetSelectValue(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  const v = value || "";
  if (v && ![...el.options].some((o) => o.value === v)) {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = v;
    el.appendChild(o);
  }
  el.value = v;
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
    document.getElementById("txtLoanSize").value = rec.loanSize || "";
    document.getElementById("txtCurrency").value = rec.currency || "";
    document.getElementById("txtOutstanding").value = rec.outstanding || "";
    document.getElementById("txtCreditOfficer").value = rec.creditOfficer || "";
    document.getElementById("txtInterestRate").value = rec.interestRate || "";
    document.getElementById("txtLoanType").value = rec.loanType || "";
    document.getElementById("txtTerm").value = rec.term || "";
    document.getElementById("cboCycle").value = rec.cycle || "";
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
    document.getElementById("btnSaveForm").textContent = "កែប្រែ";
  } else {
    scEditingCIF = null;
    title.textContent = "បញ្ចូលថ្មី";
    document.getElementById("txtCIF").readOnly = false;
    document.getElementById("conclusionOtherWrap").hidden = true;
    document.getElementById("metaUser").textContent = "";
    document.getElementById("metaTimestamp").textContent = "";
    document.getElementById("btnSaveForm").textContent = "រក្សាទុក";
  }

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
    if (typeof CMToast !== "undefined") CMToast.show("សូមបំពេញគ្រប់ចន្លោះដែលចាំបាច់", "error");
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
  if (!scValidateForm()) return;

  const cif = document.getElementById("txtCIF").value.trim();
  const isNew = !scEditingCIF;

  if (isNew && scAllRecords.some((r) => r.k === cif)) {
    if (typeof CMToast !== "undefined") CMToast.show("CIF នេះមានរួចហើយ", "error");
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

    scCloseForm();
    await scRefreshList();
  } catch (err) {
    console.error(err);
    if (typeof CMToast !== "undefined") CMToast.show("មិនអាចរក្សាទុកបានទេ", "error");
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
    if (typeof CMToast !== "undefined") CMToast.show("មិនអាចលុបបានទេ", "error");
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
    document.getElementById("txtLoanSize").value = at(SC_NBCOS_MAP.loanSize);
    document.getElementById("txtOutstanding").value = at(SC_NBCOS_MAP.outstanding);
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
    console.error("nbcos autofill failed:", err);
    scSetCifStatus("error", "មានបញ្ហាក្នុងការទាញយកទិន្នន័យ — សូមព្យាយាមម្តងទៀត");
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

  document.getElementById("btnCancelDelete").addEventListener("click", scCloseDeleteConfirm);
  document.getElementById("btnConfirmDelete").addEventListener("click", scConfirmDelete);

  document.getElementById("searchInput").addEventListener("input", scDebounce(scRenderList, 200));
  document.getElementById("filterConclusion").addEventListener("change", scRenderList);

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

  document.getElementById("txtTerm").addEventListener("blur", (e) => {
    e.target.value = scFormatTerm(e.target.value);
  });
  document.getElementById("txtInterestRate").addEventListener("blur", (e) => {
    e.target.value = scFormatRate(e.target.value);
  });

  document.getElementById("txtCIF").addEventListener("blur", (e) => {
    scAutofillFromNbcos(e.target.value.trim());
  });
}

function scSwitchTab(tabId) {
  document.querySelectorAll(".sc-tab-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tabId);
  });
  document.querySelectorAll(".sc-tab-panel").forEach((panel) => {
    panel.hidden = panel.id !== tabId;
  });
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

function scFormatTimestamp(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}
