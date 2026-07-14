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

const API_BASE = window.CM_BASE_URL || "";
const SC_EP = {
  list: API_BASE + "/api/reportsp/get",
  upsert: API_BASE + "/api/reportsp/upsert",
  delete: API_BASE + "/api/reportsp/delete",
  occupationList: API_BASE + "/api/settings/occupation-list",
};

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

// TODO: replace with the real option lists from "Setting Up" sheet
const SC_OPTION_LISTS = {
  cboCycle: ["1st Cycle", "2nd Cycle", "3rd Cycle", "4th Cycle+"],
  cboRepaymentHistory: ["On Time", "Late", "Restructured"],
  cboLoanCompletion: ["Complete", "Incomplete", "Incomplete_Violate"],
  cboBusinessSituation: ["Increasing", "Stable", "Decreasing", "Closed"],
  cboCollateralType: ["Land Title", "Hard Title", "Soft Title", "Payroll", "Clean"],
  cboCollateralChange: ["No Change", "Changed"],
  cboCollateralPrice: ["Sufficient", "Insufficient"],
  cboPurpose: ["As Declared", "Different From Declared"],
  cboRepaymentSource: ["Business Income", "Salary", "Family Support", "Other"],
  cboConclusion: ["Normal", "Watch", "Special Mention", "Sub-Standard", "Doubtful", "Loss"],
};

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
  const token = sessionStorage.getItem("token");
  if (!token) {
    alert("Session expired. Please log in again.");
    window.location.href = "../../login.html";
    return;
  }
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

  const filterEl = document.getElementById("filterConclusion");
  SC_OPTION_LISTS.cboConclusion.forEach((opt) => {
    const o = document.createElement("option");
    o.value = opt;
    o.textContent = opt;
    filterEl.appendChild(o);
  });
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
  const map = {
    branch: get("txtBranch"),
    cif: get("txtCIF"),
    loanId: get("txtLoanID"),
    customerName: get("txtCustomerName"),
    disbursementDate: get("txtDisbursementDate"),
    maturityDate: get("txtMaturityDate"),
    loanSize: get("txtLoanSize"),
    currency: get("txtCurrency"),
    outstanding: get("txtOutstanding"),
    creditOfficer: get("txtCreditOfficer"),
    interestRate: get("txtInterestRate"),
    loanType: get("txtLoanType"),
    term: get("txtTerm"),
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
    conclusion: get("cboConclusion"),
    spotCheckDate: get("txtSpotCheckDate"),
    owner: scGetCurrentUser(),
    timestamp: new Date().toISOString(),
  };
  return SC_FIELD_ORDER.map((key) => map[key] || "");
}

// ---------------------------------------------------------
// Form open / close
// ---------------------------------------------------------
function scOpenForm(rec) {
  const overlay = document.getElementById("formOverlay");
  const title = document.getElementById("formPanelTitle");
  const form = document.getElementById("spotCheckForm");
  form.reset();
  scClearFieldErrors();

  if (rec) {
    scEditingCIF = rec.cif;
    title.textContent = `កែសម្រួល — ${rec.cif}`;
    document.getElementById("txtCIF").value = rec.cif || "";
    document.getElementById("txtCIF").readOnly = true;
    document.getElementById("txtBranch").value = rec.branch || "";
    document.getElementById("txtLoanID").value = rec.loanId || "";
    document.getElementById("txtCustomerName").value = rec.customerName || "";
    document.getElementById("txtDisbursementDate").value = rec.disbursementDate || "";
    document.getElementById("txtMaturityDate").value = rec.maturityDate || "";
    document.getElementById("txtLoanSize").value = rec.loanSize || "";
    document.getElementById("txtCurrency").value = rec.currency || "";
    document.getElementById("txtOutstanding").value = rec.outstanding || "";
    document.getElementById("txtCreditOfficer").value = rec.creditOfficer || "";
    document.getElementById("txtInterestRate").value = rec.interestRate || "";
    document.getElementById("txtLoanType").value = rec.loanType || "";
    document.getElementById("txtTerm").value = rec.term || "";
    document.getElementById("cboCycle").value = rec.cycle || "";
    document.getElementById("cboRepaymentHistory").value = rec.repaymentHistory || "";
    document.getElementById("txtLateDays").value = rec.lateDays || "";
    document.getElementById("cboLoanCompletion").value = rec.loanCompletion || "";
    document.getElementById("txtLoanCompletionNote").value = rec.loanCompletionNote || "";
    document.getElementById("txtOccupationInFile").value = rec.occupationInFile || "";
    document.getElementById("txtCurrentOccupation").value = rec.currentOccupation || "";
    document.getElementById("cboBusinessSituation").value = rec.businessSituation || "";
    document.getElementById("txtOccupationDifferenceNote").value = rec.occupationDifferenceNote || "";
    document.getElementById("cboCollateralType").value = rec.collateralType || "";
    document.getElementById("cboCollateralChange").value = rec.collateralChange || "";
    document.getElementById("cboCollateralPrice").value = rec.collateralPrice || "";
    document.getElementById("txtCollateralNote").value = rec.collateralNote || "";
    document.getElementById("cboPurpose").value = rec.purpose || "";
    document.getElementById("txtPurposeNote").value = rec.purposeNote || "";
    document.getElementById("cboRepaymentSource").value = rec.repaymentSource || "";
    document.getElementById("txtRepaymentSourceNote").value = rec.repaymentSourceNote || "";
    document.getElementById("cboConclusion").value = rec.conclusion || "";
    document.getElementById("txtSpotCheckDate").value = rec.spotCheckDate || "";
    document.getElementById("metaUser").textContent = rec.owner ? `អ្នកបញ្ចូល: ${rec.owner}` : "";
    document.getElementById("metaTimestamp").textContent = rec.uploadedAt
      ? `ធ្វើបច្ចុប្បន្នភាព: ${scFormatTimestamp(rec.uploadedAt)}`
      : "";
    document.getElementById("btnSaveForm").textContent = "កែប្រែ";
  } else {
    scEditingCIF = null;
    title.textContent = "បញ្ចូលថ្មី";
    document.getElementById("txtCIF").readOnly = false;
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
  if (!ok) {
    if (typeof CMToast !== "undefined") CMToast.show("សូមបំពេញគ្រប់ចន្លោះដែលចាំបាច់", "error");
    const firstError = document.querySelector(".sc-field-error");
    firstError?.scrollIntoView({ behavior: "smooth", block: "center" });
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

    if (typeof CMToast !== "undefined") CMToast.show(isNew ? "បញ្ចូលដោយជោគជ័យ" : "កែប្រែដោយជោគជ័យ", "success");
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
    if (typeof CMToast !== "undefined") CMToast.show("លុបដោយជោគជ័យ", "success");
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

  ["txtSpotCheckDate", "txtDisbursementDate", "txtMaturityDate"].forEach((id) => {
    document.getElementById(id).addEventListener("blur", (e) => {
      e.target.value = scFormatDateInput(e.target.value);
    });
  });
}

// ---------------------------------------------------------
// Helpers
// ---------------------------------------------------------
function scAuthHeaders() {
  const token = sessionStorage.getItem("token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function scGetCurrentUser() {
  try {
    const user = JSON.parse(sessionStorage.getItem("loggedInUser") || "{}");
    return user.username || user.fullname || "";
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

function scFormatDateInput(val) {
  const d = scParseDateFlexible(val);
  if (!d) return val;
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const dd = String(d.getDate()).padStart(2, "0");
  const mmm = months[d.getMonth()];
  const yy = String(d.getFullYear()).slice(-2);
  return `${dd}-${mmm}-${yy}`;
}

function scFormatTimestamp(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}
