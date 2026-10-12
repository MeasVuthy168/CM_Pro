// shared/i18n/masterdata.js
//
// Strings for the Master Data section: the hub (pages/masterdata/
// index.html) and the List Officer page. Load alongside
// shared/i18n/common.js and shared/i18n/core.js on every page under
// pages/masterdata/.

CMI18n.register({
  // ==================================================================
  // HUB (pages/masterdata/index.html)
  // ==================================================================
  "masterdata.hub.title": { km: "ទិន្នន័យមូលដ្ឋាន", en: "Master Data" },
  "masterdata.hub.listOfficer": { km: "បញ្ជីមន្ត្រីឥណទាន", en: "List Officer" },
  "masterdata.hub.listOfficerSub": { km: "គ្រប់គ្រងមន្ត្រីឥណទាន", en: "Manage credit officers" },
  "masterdata.hub.listLocation": { km: "បញ្ជីទីតាំង", en: "List Location" },
  "masterdata.hub.listLocationSub": { km: "គ្រប់គ្រងទីតាំង", en: "Manage locations" },
  "masterdata.hub.listProduct": { km: "បញ្ជីផលិតផល", en: "List Product" },
  "masterdata.hub.listProductSub": { km: "គ្រប់គ្រងផលិតផល", en: "Manage products" },
  "masterdata.hub.comingSoon": { km: "នឹងមកដល់ឆាប់ៗនេះ", en: "Coming soon" },

  // ==================================================================
  // LIST OFFICER (pages/masterdata/officer.html)
  // ==================================================================
  "masterdata.officer.title": { km: "បញ្ជីមន្ត្រីឥណទាន", en: "List Officer" },
  "masterdata.officer.searchPlaceholder": { km: "ស្វែងរកតាមលេខសម្គាល់ ឬឈ្មោះ...", en: "Search by ID or name..." },
  "masterdata.officer.filterTeam": { km: "ក្រុម", en: "Team" },
  "masterdata.officer.filterBranch": { km: "សាខា", en: "Branch" },
  "masterdata.officer.allTeams": { km: "គ្រប់ក្រុមទាំងអស់", en: "All Teams" },
  "masterdata.officer.allBranches": { km: "គ្រប់សាខាទាំងអស់", en: "All Branches" },
  "masterdata.officer.sortNameAsc": { km: "ឈ្មោះ (ក-អ)", en: "Name (A-Z)" },
  "masterdata.officer.sortNameDesc": { km: "ឈ្មោះ (អ-ក)", en: "Name (Z-A)" },
  "masterdata.officer.sortIdAsc": { km: "លេខសម្គាល់ (ក-អ)", en: "Officer ID (A-Z)" },
  "masterdata.officer.sortIdDesc": { km: "លេខសម្គាល់ (អ-ក)", en: "Officer ID (Z-A)" },

  "masterdata.officer.colId": { km: "លេខសម្គាល់", en: "Officer ID" },
  "masterdata.officer.colName": { km: "ឈ្មោះ", en: "Name" },
  "masterdata.officer.colTeam": { km: "ក្រុម", en: "Team" },
  "masterdata.officer.colBranch": { km: "សាខា", en: "Branch" },
  "masterdata.officer.colActions": { km: "សកម្មភាព", en: "Actions" },

  "masterdata.officer.summaryTotal": { km: "មន្ត្រីសរុប", en: "Total Officers" },
  "masterdata.officer.summaryCO": { km: "មន្ត្រីឥណទាន", en: "Credit Officers" },
  "masterdata.officer.summaryFSRO": { km: "FSRO", en: "FSRO" },
  "masterdata.officer.summaryBranches": { km: "សាខា", en: "Branches" },

  "masterdata.officer.addBtn": { km: "បន្ថែមមន្ត្រី", en: "Add Officer" },
  "masterdata.officer.editBtn": { km: "កែប្រែ", en: "Edit" },
  "masterdata.officer.deleteBtn": { km: "លុប", en: "Delete" },

  "masterdata.officer.modalAddTitle": { km: "បន្ថែមមន្ត្រី", en: "Add Officer" },
  "masterdata.officer.modalEditTitle": { km: "កែប្រែមន្ត្រី", en: "Edit Officer" },
  "masterdata.officer.fieldId": { km: "លេខសម្គាល់មន្ត្រី", en: "Officer ID" },
  "masterdata.officer.fieldName": { km: "ឈ្មោះ", en: "Name" },
  "masterdata.officer.fieldTeam": { km: "ក្រុម", en: "Team" },
  "masterdata.officer.fieldBranch": { km: "សាខា", en: "Branch" },
  "masterdata.officer.save": { km: "រក្សាទុក", en: "Save" },
  "masterdata.officer.cancel": { km: "បោះបង់", en: "Cancel" },
  "masterdata.officer.idRequired": { km: "សូមបញ្ចូលលេខសម្គាល់មន្ត្រី។", en: "Officer ID is required." },
  "masterdata.officer.nameRequired": { km: "សូមបញ្ចូលឈ្មោះ។", en: "Name is required." },
  "masterdata.officer.idLocked": { km: "លេខសម្គាល់មិនអាចកែប្រែបានទេពេលកែប្រែ", en: "ID can't be changed while editing" },

  "masterdata.officer.deleteConfirmTitle": { km: "លុបមន្ត្រីនេះ?", en: "Delete this officer?" },
  "masterdata.officer.deleteConfirmBody": { km: "តើអ្នកពិតជាចង់លុប {name} មែនទេ? សកម្មភាពនេះមិនអាចត្រឡប់វិញបានទេ។", en: "Are you sure you want to delete {name}? This can't be undone." },
  "masterdata.officer.confirmDelete": { km: "លុប", en: "Delete" },

  "masterdata.officer.noData": { km: "រកមិនឃើញមន្ត្រីទេ។", en: "No officers found." },
  "masterdata.officer.loadFailed": { km: "បរាជ័យក្នុងការផ្ទុកបញ្ជីមន្ត្រី។", en: "Failed to load the officer list." },
  "masterdata.officer.networkError": { km: "មានបញ្ហាការតភ្ជាប់បណ្តាញ។", en: "Network error." },
  "masterdata.officer.saveSuccess": { km: "បានរក្សាទុកដោយជោគជ័យ។", en: "Saved successfully." },
  "masterdata.officer.saveFailed": { km: "បរាជ័យក្នុងការរក្សាទុក។", en: "Failed to save." },
  "masterdata.officer.deleteSuccess": { km: "បានលុបដោយជោគជ័យ។", en: "Deleted successfully." },
  "masterdata.officer.deleteFailed": { km: "បរាជ័យក្នុងការលុប។", en: "Failed to delete." },
  "masterdata.officer.adminOnly": { km: "មានតែអ្នកគ្រប់គ្រងប៉ុណ្ណោះដែលអាចកែប្រែបាន។", en: "Only admins can make changes." }
});
