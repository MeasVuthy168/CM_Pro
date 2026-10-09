// shared/i18n/creditreport.js
//
// Strings for the Credit Report section: the hub (pages/creditreport/
// index.html), Credit Portfolio Trends / Report Comparison, the 4 Daily
// Monitoring detail reports (by Officer/Branch/Product/Location), and the
// 4 Productivity/Performance pages (Officer/Branch/Product/Location).
// Load alongside shared/i18n/common.js and shared/i18n/core.js on every
// page under pages/creditreport/.

CMI18n.register({
  // ==================================================================
  // HUB (pages/creditreport/index.html, creditreport-hub.js)
  // ==================================================================
  "creditreport.hub.dailyArrearsByCO": { km: "ការយឺតយ៉ាវប្រចាំថ្ងៃតាមមន្ត្រីឥណទាន", en: "Daily Arrears by Credit Officer" },
  "creditreport.hub.dailyArrearsByCOSub": { km: "ប្រចាំថ្ងៃតាមភ្នាក់ងារ", en: "Daily, by officer" },
  "creditreport.hub.byOfficer": { km: "ការត្រួតពិនិត្យប្រចាំថ្ងៃតាមមន្ត្រី", en: "Daily Monitoring by Officer" },
  "creditreport.hub.byOfficerSub": { km: "ត្រួតពិនិត្យប្រចាំថ្ងៃតាមភ្នាក់ងារ", en: "Daily monitoring, by officer" },
  "creditreport.hub.byBranch": { km: "ការត្រួតពិនិត្យប្រចាំថ្ងៃតាមសាខា", en: "Daily Monitoring by Branch" },
  "creditreport.hub.byBranchSub": { km: "ត្រួតពិនិត្យប្រចាំថ្ងៃតាមសាខា", en: "Daily monitoring, by branch" },
  "creditreport.hub.byProduct": { km: "ការត្រួតពិនិត្យប្រចាំថ្ងៃតាមផលិតផល", en: "Daily Monitoring by Product" },
  "creditreport.hub.byProductSub": { km: "ត្រួតពិនិត្យប្រចាំថ្ងៃតាមផលិតផល", en: "Daily monitoring, by product" },
  "creditreport.hub.byLocation": { km: "ការត្រួតពិនិត្យប្រចាំថ្ងៃតាមទីតាំង", en: "Daily Monitoring by Location" },
  "creditreport.hub.byLocationSub": { km: "ត្រួតពិនិត្យប្រចាំថ្ងៃតាមទីតាំង", en: "Daily monitoring, by location" },
  "creditreport.hub.portfolioTrends": { km: "និន្នាការផលប័ត្រឥណទាន", en: "Credit Portfolio Trends" },
  "creditreport.hub.portfolioTrendsSub": { km: "ប្រៀបធៀបរបាយការណ៍ប្រចាំថ្ងៃ", en: "Compare daily reports" },

  "creditreport.hub.snapshotAll": { km: "រក្សាទុករូបថតទាំងអស់", en: "Snapshot All" },
  "creditreport.hub.dismiss": { km: "បិទ", en: "Dismiss" },
  "creditreport.hub.running": { km: "កំពុងដំណើរការ...", en: "Running..." },
  "creditreport.hub.snapshotSavedCount": { km: "បានរក្សាទុក {ok}/{total}", en: "{ok}/{total} saved" },
  "creditreport.hub.snapshotAllSaved": { km: "បានរក្សាទុករូបថតទាំង 4 ជោគជ័យ។", en: "All 4 snapshots saved." },
  "creditreport.hub.snapshotSomeFailed": { km: "រូបថតមួយចំនួនបរាជ័យ — សូមមើលព័ត៌មានលម្អិតខាងក្រោម។", en: "Some snapshots failed — see details below." },
  "creditreport.hub.snapshotFailed": { km: "បរាជ័យ", en: "Failed" },
  "creditreport.hub.networkError": { km: "មានបញ្ហាការតភ្ជាប់បណ្តាញ", en: "Network error" },
  "creditreport.hub.targetBranch": { km: "សាខា", en: "Branch" },
  "creditreport.hub.targetOfficer": { km: "មន្ត្រី", en: "Officer" },
  "creditreport.hub.targetProduct": { km: "ផលិតផល", en: "Product" },
  "creditreport.hub.targetLocation": { km: "ទីតាំង", en: "Location" },
  "creditreport.hub.targetCompare": { km: "ប្រៀបធៀប", en: "Compare" },

  // Shared across report pages — a generic loading overlay message
  // (crShowLoading("Loading Report Data...") convention).
  "creditreport.loadingReportData": { km: "កំពុងផ្ទុកទិន្នន័យរបាយការណ៍...", en: "Loading Report Data..." },

  // ==================================================================
  // "..." MENU — shared by the 4 Daily Monitoring detail pages and
  // Report Comparison's topbar menu.
  // ==================================================================
  "creditreport.menu.snapshot": { km: "ថតរក្សាទុក", en: "Snapshot" },
  "creditreport.menu.deleteSnapshot": { km: "លុបរូបថតរក្សាទុក", en: "Delete Snapshot" },
  "creditreport.menu.exportExcel": { km: "នាំចេញ Excel", en: "Export Excel" },
  "creditreport.menu.exportPdf": { km: "នាំចេញ PDF", en: "Export PDF" },
  "creditreport.menu.print": { km: "បញ្ចូលទិន្នន័យពុម្ព", en: "Print" },
  "creditreport.menu.landscape": { km: "ទិដ្ឋភាពផ្ដេក", en: "Landscape" },
  "creditreport.menu.refreshData": { km: "ផ្ទុកទិន្នន័យឡើងវិញ", en: "Refresh Data" },
  "creditreport.menu.moreActions": { km: "សកម្មភាពបន្ថែម", en: "More actions" },
  "creditreport.menu.exitLandscape": { km: "✕ ត្រឡប់ក្រោយ", en: "✕ Exit" },
  "creditreport.menu.landscapeHint": { km: "ចុចអេក្រង់ដើម្បីបង្ហាញ/លាក់ម៉ឺនុយ", en: "Tap the screen to show/hide the menu" },

  // ==================================================================
  // REPORT COMPARISON / CREDIT PORTFOLIO TRENDS (ReportCompare.html/js)
  // ==================================================================
  "creditreport.compare.title": { km: "និន្នាការផលប័ត្រឥណទាន", en: "Credit Portfolio Trends" },
  "creditreport.compare.deleteCalHint": { km: "ជ្រើសរើសកាលបរិច្ឆេទដែលបានបន្លិចដើម្បីលុបរូបថតរក្សាទុករបស់វា។", en: "Pick a highlighted date to delete its saved snapshot." },
  "creditreport.compare.fromDate": { km: "ពីកាលបរិច្ឆេទ", en: "From Date" },
  "creditreport.compare.toDate": { km: "ដល់កាលបរិច្ឆេទ", en: "To Date" },
  "creditreport.compare.compareBtn": { km: "ប្រៀបធៀប", en: "Compare" },

  "creditreport.compare.tabOs": { km: "សមតុល្យ​ឥណទាន", en: "OS" },
  "creditreport.compare.tabDisburse": { km: "​ការបញ្ចេញឥណទាន", en: "Disb" },
  "creditreport.compare.tabT24": { km: "យឺតយ៉ាវT24", en: "T24 OV" },
  "creditreport.compare.tabOverdue": { km: "យឺតយ៉ាវNBC", en: "NBC OV" },
  "creditreport.compare.tabWo": { km: "លុបចេញ​ពីបញ្ជី", en: "WO" },

  "creditreport.compare.sectionOsFull": { km: "សមតុល្យ​ឥណទាន​", en: "Loan Outstanding" },
  "creditreport.compare.sectionDisburseFull": { km: "ការបញ្ចេញឥណទាន", en: "Loan Disburse" },
  "creditreport.compare.sectionT24Full": { km: "សមតុល្យ​ឥណទានយឺតយ៉ាវ (T24)", en: "Balance Loan at Risk (T24)" },
  "creditreport.compare.sectionOverdueFull": { km: "សមតុល្យ​ឥណទានយឺតយ៉ាវ (NBC Overdue)", en: "Balance Loan at Risk (NBC Overdue)" },
  "creditreport.compare.sectionWoFull": { km: "បំណុលលុបចេញីបញ្ជី", en: "Write Off" },

  "creditreport.compare.dimOfficer": { km: "មន្ត្រី", en: "Officer" },
  "creditreport.compare.dimBranch": { km: "សាខា", en: "Branch" },
  "creditreport.compare.dimProduct": { km: "ផលិតផល", en: "Product" },
  "creditreport.compare.dimLocation": { km: "ទីតាំង", en: "Location" },
  "creditreport.compare.allOfDim": { km: "{dim} ទាំងអស់", en: "All {dim}s" },
  "creditreport.compare.notTrackedForWo": { km: "មិនបានកត់ត្រាសម្រាប់ឥណទានលុបចាក់បញ្ជី", en: "Not tracked for Write Off" },

  "creditreport.compare.noRows": { km: "មិនមានជួរទិន្នន័យ។", en: "No rows." },
  "creditreport.compare.noRowsCategory": { km: "មិនមានជួរទិន្នន័យក្នុងប្រភេទនេះទេ។", en: "No rows in this category." },

  "creditreport.compare.colLoan": { km: "# កម្ចី", en: "# Loan" },
  "creditreport.compare.colEntered": { km: "ចូល", en: "Entered" },
  "creditreport.compare.colExited": { km: "ចេញ", en: "Exited" },
  "creditreport.compare.colUpgrade": { km: "ឡើងកម្រិត", en: "Upgrade" },
  "creditreport.compare.colDowngrade": { km: "ចុះកម្រិត", en: "Downgrade" },
  "creditreport.compare.colCif": { km: "CIF", en: "CIF" },
  "creditreport.compare.colName": { km: "ឈ្មោះ", en: "Name" },
  "creditreport.compare.colBranch": { km: "សាខា", en: "Branch" },
  "creditreport.compare.colOfficer": { km: "មន្ត្រី", en: "Officer" },
  "creditreport.compare.colInt": { km: "ការប្រាក់", en: "Int" },
  "creditreport.compare.colPrn": { km: "ប្រាក់ដើម", en: "Prn" },
  "creditreport.compare.colLoanNo": { km: "លេខកម្ចី", en: "Loan #" },
  "creditreport.compare.colClass": { km: "ចំណាត់ថ្នាក់", en: "Class" },
  "creditreport.compare.colValue": { km: "តម្លៃ", en: "Value" },

  "creditreport.compare.valueLabelOs": { km: "ប្រាក់នៅសល់ (USD)", en: "OS (USD)" },
  "creditreport.compare.valueLabelDisburse": { km: "ប្រាក់ផ្តល់ឱ្យខ្ចី (USD)", en: "Disbursed (USD)" },

  "creditreport.compare.subEntered": { km: "✅ ចូល ({count})", en: "Entered ({count})" },
  "creditreport.compare.subExited": { km: "↩️ ចេញ ({count})", en: "Exited ({count})" },
  "creditreport.compare.subChanged": { km: "🔀 ផ្លាស់ប្តូរ ({count})", en: "Changed ({count})" },
  "creditreport.compare.subNewOverdue": { km: "ថ្មីយឺតយ៉ាវ ({count})", en: "New Overdue ({count})" },
  "creditreport.compare.subResolved": { km: "បានដោះស្រាយ ({count})", en: "Resolved ({count})" },

  "creditreport.compare.kpiLoan": { km: "# កម្ចី", en: "# Loan" },
  "creditreport.compare.kpiClient": { km: "# អតិថិជន", en: "# Client" },
  "creditreport.compare.kpiValueUsd": { km: "តម្លៃ (USD)", en: "Value (USD)" },
  "creditreport.compare.kpiPar": { km: "PAR", en: "PAR" },
  "creditreport.compare.kpiCif": { km: "# (CIF)", en: "# (CIF)" },
  "creditreport.compare.kpiInt": { km: "ការប្រាក់", en: "Int" },
  "creditreport.compare.kpiPrn": { km: "ប្រាក់ដើម", en: "Prn" },
  "creditreport.compare.was": { km: "ពីមុន {value}", en: "was {value}" },

  "creditreport.compare.dowSun": { km: "អា", en: "Sun" },
  "creditreport.compare.dowMon": { km: "ច", en: "Mon" },
  "creditreport.compare.dowTue": { km: "អ", en: "Tue" },
  "creditreport.compare.dowWed": { km: "ព", en: "Wed" },
  "creditreport.compare.dowThu": { km: "ព្រ", en: "Thu" },
  "creditreport.compare.dowFri": { km: "សុ", en: "Fri" },
  "creditreport.compare.dowSat": { km: "ស", en: "Sat" },

  "creditreport.compare.noSnapshotsYet": { km: "មិនទាន់មានរូបថតរក្សាទុកនៅឡើយទេ។", en: "No snapshots saved yet." },
  "creditreport.compare.legendHasSnapshot": { km: "មានរូបថតរក្សាទុក — ចុចដើម្បីលុប", en: "Has saved snapshot — tap to delete" },
  "creditreport.compare.prevMonth": { km: "ខែមុន", en: "Previous month" },
  "creditreport.compare.nextMonth": { km: "ខែបន្ទាប់", en: "Next month" },

  "creditreport.compare.failedLoadDates": { km: "បរាជ័យក្នុងការផ្ទុកកាលបរិច្ឆេទរូបថតរក្សាទុក។", en: "Failed to load snapshot dates." },
  "creditreport.compare.failedCompare": { km: "បរាជ័យក្នុងការប្រៀបធៀប។", en: "Failed to compare." },
  "creditreport.compare.serverErrorCompare": { km: "មានបញ្ហាម៉ាស៊ីនមេពេលប្រៀបធៀប។", en: "Server error while comparing." },
  "creditreport.compare.noBackupAdmin": { km: "មិនទាន់មានទិន្នន័យបម្រុងទុកនៅឡើយទេ — សូមប្រើ \"Snapshot All\" នៅទំព័រ Credit Report ដើម្បីចាប់ផ្តើម។", en: "No backup yet — use Snapshot All on the Credit Report hub to start." },
  "creditreport.compare.noBackupNonAdmin": { km: "មិនទាន់មានទិន្នន័យបម្រុងទុកនៅឡើយទេ — សូមសួរអ្នកគ្រប់គ្រងឱ្យដំណើរការ \"Snapshot All\" នៅទំព័រ Credit Report។", en: "No backup yet — ask an admin to run Snapshot All on the Credit Report hub." },

  "creditreport.compare.confirmDeleteSnapshot": { km: "លុបរូបថតរក្សាទុកសម្រាប់ {date}? សកម្មភាពនេះមិនអាចត្រឡប់វិញបានទេ។", en: "Delete the saved snapshot for {date}? This cannot be undone." },
  "creditreport.compare.snapshotDeletedFor": { km: "បានលុបរូបថតរក្សាទុកសម្រាប់ {date}", en: "Snapshot deleted for {date}" },
  "creditreport.compare.deleteFailed": { km: "ការលុបបានបរាជ័យ", en: "Delete failed" },
  "creditreport.compare.savingSnapshot": { km: "កំពុងរក្សាទុករូបថត...", en: "Saving snapshot..." },
  "creditreport.compare.snapshotSavedFor": { km: "បានរក្សាទុករូបថតសម្រាប់ {date}", en: "Snapshot saved for {date}" },
  "creditreport.compare.snapshotFailed": { km: "ការរក្សាទុករូបថតបានបរាជ័យ", en: "Snapshot failed" },

  // ==================================================================
  // SHARED ACROSS THE 4 "DAILY MONITORING" DETAIL REPORTS (by Location /
  // Product / Officer / Branch) — filter card info rows, view controls,
  // section/class/product selects, search, landscape, chart.
  // ==================================================================
  "creditreport.detail.loanDisbFrom": { km: "ការបញ្ចេញឥណទានចាប់ពី", en: "Loan Disbursement from" },
  "creditreport.detail.writeOffFrom": { km: "ឥណទាន​លុបចេញពីបញ្ជីចាប់", en: "Write Off from" },
  "creditreport.detail.osGridMerge": { km: "សមតុល្យ​ឥណទាន​បញ្ចូលគ្នា NBC", en: "NBC Loan Outstanding Grid Merge" },
  "creditreport.detail.overdueGridMerge": { km: "ឥណទានយឺតយ៉ាវបញ្ចូលគ្នា ​NBC", en: "NBC Overdue Loan Grid Merge" },
  "creditreport.detail.arrearsPenalty": { km: "ឥណទានយឺតយ៉ាវមានប្រាក់ពិន័យ​ T24", en: "Payment in Arears with Penalty" },

  "creditreport.detail.current": { km: "បច្ចុប្បន្ន", en: "Current" },
  "creditreport.detail.dailyHistory": { km: "ប្រវត្តិប្រចាំថ្ងៃ", en: "Daily History" },
  "creditreport.detail.from": { km: "ពី", en: "From" },
  "creditreport.detail.to": { km: "ដល់", en: "To" },
  "creditreport.detail.branch": { km: "សាខា", en: "Branch" },
  "creditreport.detail.officer": { km: "មន្ត្រី", en: "Officer" },
  "creditreport.detail.all": { km: "ទាំងអស់", en: "All" },

  "creditreport.detail.showing": { km: "កំពុងបង្ហាញ", en: "Showing" },
  "creditreport.detail.allSections": { km: "គ្រប់ផ្នែកទាំងអស់", en: "All Sections" },
  "creditreport.detail.sectionOutstanding": { km: "សមតុល្យ​ឥណទាន​", en: "Loan Outstanding" },
  "creditreport.detail.sectionDisburse": { km: "ការបញ្ចេញឥណទាន", en: "Loan Disburse" },
  "creditreport.detail.sectionT24": { km: "សមតុល្យ​ឥណទានយឺតយ៉ាវ (T24)", en: "Balance Loan at Risk (T24)" },
  "creditreport.detail.sectionNbcOverdue": { km: "សមតុល្យ​ឥណទានយឺតយ៉ាវ (NBC Overdue)", en: "Balance Loan at Risk (NBC Overdue)" },
  "creditreport.detail.sectionWriteOff": { km: "បំណុលលុបចេញីបញ្ជី", en: "Write Off" },

  "creditreport.detail.loanClass": { km: "ចំណាត់ថ្នាក់ឥណទាន", en: "Loan Class" },
  "creditreport.detail.classTotalT24": { km: "ឥណទានយឺតយ៉ាវសរុប (T24)", en: "Total T24 Overdue" },
  "creditreport.detail.classNormalToSpecial": { km: "ធម្មតា → ត្រូវការយកចិត្តទុកដាក់ពិសេស", en: "Normal → Special Mention" },
  "creditreport.detail.classSubToLoss": { km: "ក្រោមគុណភាព → ខាតបង់", en: "Sub Standard → Loss" },
  "creditreport.detail.classNormal": { km: "ធម្មតា", en: "Normal" },
  "creditreport.detail.classSpecialMention": { km: "ឃ្លាំមេីល", en: "Special Mention" },
  "creditreport.detail.classSubStandard": { km: "ក្រោមគុណភាព", en: "Sub Standard" },
  "creditreport.detail.classSubStandardHyphen": { km: "ក្រោមស្តង់ដារ", en: "Sub-Standard" },
  "creditreport.detail.classDoubtful": { km: "សង្ស័យ​", en: "Doubtful" },
  "creditreport.detail.classLoss": { km: "បាត់បង់", en: "Loss" },
  "creditreport.detail.classMinorDefault": { km: "ធម្មតា​", en: "Minor Default" },
  "creditreport.detail.classMajorDefault": { km: "Major Default", en: "Major Default" },
  "creditreport.detail.classNonPerformingLoan": { km: "ឥឥណទានមិនដំណើរការ", en: "Non Performing Loan" },
  "creditreport.detail.classTotalNbcOverdue": { km: "ឥណទាន​យឺតយ៉ាវ​សរុប NBC", en: "Total NBC Overdue" },

  "creditreport.detail.productType": { km: "ប្រភេទផលិតផល", en: "Product Type" },
  "creditreport.detail.digitalProducts": { km: "ផលិតផលឌីជីថល", en: "Digital Products" },
  "creditreport.detail.nonDigitalProducts": { km: "ផលិតផលមិនមែនឌីជីថល", en: "Non-Digital Products" },

  "creditreport.detail.viewHistory": { km: "មើលប្រវត្តិ", en: "View History" },
  "creditreport.detail.chart": { km: "ក្រាប", en: "Chart" },
  "creditreport.detail.exitLandscapeAria": { km: "ត្រឡប់ចេញពីទិដ្ឋភាពផ្ដេក", en: "Exit landscape" },
  "creditreport.detail.clearSearchAria": { km: "សម្អាតការស្វែងរក", en: "Clear search" },
  "creditreport.detail.closeChartAria": { km: "បិទក្រាប", en: "Close chart" },

  "creditreport.detail.colLoanHash": { km: "# កម្ចី", en: "# Loan" },
  "creditreport.detail.colClient": { km: "# អតិថិជន", en: "# Client" },
  "creditreport.detail.colValue": { km: "តម្លៃ", en: "Value" },
  "creditreport.detail.colParPct": { km: "PAR %", en: "PAR %" },
  "creditreport.detail.colCifHash": { km: "# (cif)", en: "# (cif)" },
  "creditreport.detail.colInt": { km: "ការប្រាក់", en: "Int" },
  "creditreport.detail.colPrn": { km: "ប្រាក់ដើម", en: "Prn" },
  "creditreport.detail.woBalanceWO": { km: "សមតុល្យឥណទានលុបចាក់បញ្ជី", en: "Balance WO" },
  "creditreport.detail.woWO": { km: "ឥណទានលុបចាក់បញ្ជី", en: "WO" },
  "creditreport.detail.woCollected": { km: "ឥណទានលុបចាក់បញ្ជីប្រមូលបាន", en: "WO Collected" },

  "creditreport.detail.t24AsOfTooltip": { km: "សមតុល្យឥណទានប្រថុយប្រថាន (T24) គឺគិតតាមទិន្នន័យផ្ទាល់របស់វា មិនមែនតាមកាលបរិច្ឆេទជួរដេកនេះទេ", en: "Balance Loan at Risk (T24) is as of its own ArreasT24ByCO feed, not this row's Date" },
  "creditreport.detail.deleteDaySnapshotTitle": { km: "លុបរូបថតរក្សាទុកសម្រាប់ថ្ងៃនេះ", en: "Delete this day's snapshot" },
  "creditreport.detail.noHistorySaved": { km: "មិនទាន់មានប្រវត្តិរក្សាទុកសម្រាប់កំឡុងកាលបរិច្ឆេទនេះនៅឡើយទេ។", en: "No history saved for this date range yet." },
  "creditreport.detail.failedLoadHistory": { km: "បរាជ័យក្នុងការផ្ទុកប្រវត្តិ។", en: "Failed to load history." },
  "creditreport.detail.networkErrorHistory": { km: "មានបញ្ហាការតភ្ជាប់បណ្តាញពេលផ្ទុកប្រវត្តិ។", en: "Network error loading history." },
  "creditreport.detail.failedLoadReport": { km: "បរាជ័យក្នុងការផ្ទុករបាយការណ៍។", en: "Failed to load report." },
  "creditreport.detail.networkErrorReport": { km: "មានបញ្ហាការតភ្ជាប់បណ្តាញពេលផ្ទុករបាយការណ៍។", en: "Network error loading report." },
  "creditreport.detail.dateRange": { km: "{from} ដល់ {to}", en: "{from} to {to}" },

  "creditreport.detail.excelLibFailed": { km: "បរាជ័យក្នុងការផ្ទុកបណ្ណាល័យ Excel។", en: "Excel export library failed to load." },
  "creditreport.detail.nothingToExport": { km: "មិនមានទិន្នន័យសម្រាប់នាំចេញ។", en: "Nothing to export." },
  "creditreport.detail.pdfLibFailed": { km: "បរាជ័យក្នុងការផ្ទុកបណ្ណាល័យ PDF។", en: "PDF export library failed to load." },
  "creditreport.detail.generatingPdf": { km: "កំពុងបង្កើត PDF...", en: "Generating PDF..." },
  "creditreport.detail.pdfGenerateFailed": { km: "មិនអាចបង្កើត PDF បានទេ។", en: "Could not generate the PDF." },

  "creditreport.detail.refreshingFromDb": { km: "កំពុងផ្ទុកឡើងវិញពីមូលដ្ឋានទិន្នន័យ...", en: "Refreshing from database..." },
  "creditreport.detail.refreshFailed": { km: "មិនអាចផ្ទុកទិន្នន័យឡើងវិញបានទេ។", en: "Could not refresh data." },
  "creditreport.detail.networkErrorRefresh": { km: "មានបញ្ហាការតភ្ជាប់បណ្តាញពេលផ្ទុកទិន្នន័យឡើងវិញ។", en: "Network error refreshing data." },

  "creditreport.detail.rowsCount": { km: "{count} ជួរដេក", en: "{count} rows" },
  "creditreport.detail.chartLibFailed": { km: "បរាជ័យក្នុងការផ្ទុកបណ្ណាល័យក្រាប — សូមពិនិត្យការតភ្ជាប់របស់អ្នក ហើយផ្ទុកទំព័រឡើងវិញ។", en: "Chart library failed to load — check your connection and refresh." },

  "creditreport.detail.area": { km: "ក្រុម", en: "Area" },
  "creditreport.detail.own": { km: "ផ្ទាល់ខ្លួន", en: "Own" },

  // ==================================================================
  // DAILY MONITORING BY LOCATION
  // ==================================================================
  "creditreport.byLocation.printTitle": { km: "របាយការណ៍ត្រួតពិនិត្យប្រចាំថ្ងៃតាមទីតាំង", en: "Daily Monitoring Report by Location" },
  "creditreport.byLocation.locationsCount": { km: "ទីតាំង", en: "Locations" },
  "creditreport.byLocation.locationLabel": { km: "ទីតាំង", en: "Location" },
  "creditreport.byLocation.searchPlaceholder": { km: "ស្វែងរកទីតាំង...", en: "Search location..." },
  "creditreport.byLocation.clearLocationSearch": { km: "សម្អាតការស្វែងរកទីតាំង", en: "Clear location search" },
  "creditreport.byLocation.district": { km: "ស្រុក", en: "District" },
  "creditreport.byLocation.commune": { km: "ឃុំ", en: "Commune" },
  "creditreport.byLocation.colFamily": { km: "# គ្រួសារ", en: "# Family" },
  "creditreport.byLocation.colSegmentationPct": { km: "ភាគរយចែកសម្រាប់", en: "Segmentation%" },
  "creditreport.byLocation.otherAddress": { km: "អាសយដ្ឋានផ្សេងទៀត", en: "Other Address" },
  "creditreport.byLocation.selectThenViewHistory": { km: "សូមស្វែងរក ហើយជ្រើសរើសទីតាំង រួចចុច \"{viewHistory}\"។", en: "Search and select a location, then click \"{viewHistory}\"." },
  "creditreport.byLocation.noLocationsMatch": { km: "មិនមានទីតាំងដែលត្រូវនឹងតម្រងទាំងនេះទេ។", en: "No locations match these filters." },

  // ==================================================================
  // DAILY MONITORING BY PRODUCT
  // ==================================================================
  "creditreport.byProduct.printTitle": { km: "របាយការណ៍ត្រួតពិនិត្យប្រចាំថ្ងៃតាមផលិតផល", en: "Daily Monitoring Report by Product" },
  "creditreport.byProduct.productsCount": { km: "ផលិតផល", en: "Products" },
  "creditreport.byProduct.searchPlaceholder": { km: "ស្វែងរកផលិតផល...", en: "Search product..." },
  "creditreport.byProduct.clearProductSearch": { km: "សម្អាតការស្វែងរកផលិតផល", en: "Clear product search" },
  "creditreport.byProduct.selectThenViewHistory": { km: "សូមស្វែងរក ហើយជ្រើសរើសផលិតផល រួចចុច \"{viewHistory}\"។", en: "Search and select a product, then click \"{viewHistory}\"." },
  "creditreport.byProduct.noProductsMatch": { km: "មិនមានផលិតផលដែលត្រូវនឹងតម្រងទាំងនេះទេ។", en: "No products match these filters." },

  // ==================================================================
  // DAILY MONITORING BY OFFICER (CO)
  // ==================================================================
  "creditreport.byCO.printTitle": { km: "របាយការណ៍ត្រួតពិនិត្យប្រចាំថ្ងៃតាមភ្នាក់ងារ", en: "Daily Monitoring Report by Officer" },
  "creditreport.byCO.officersCount": { km: "ភ្នាក់ងារលក់", en: "Officers" },
  "creditreport.byCO.searchPlaceholder": { km: "ស្វែងរកមន្ត្រី...", en: "Search officer..." },
  "creditreport.byCO.clearOfficerSearch": { km: "សម្អាតការស្វែងរកមន្ត្រី", en: "Clear officer search" },
  "creditreport.byCO.allBranch": { km: "គ្រប់សាខាទាំងអស់", en: "All Branch" },
  "creditreport.byCO.team": { km: "ក្រុម", en: "Team" },
  "creditreport.byCO.allTeam": { km: "គ្រប់ក្រុមទាំងអស់", en: "All Team" },
  "creditreport.byCO.creditOfficer": { km: "មន្ត្រីឥណទាន", en: "Credit Officer" },
  "creditreport.byCO.fsro": { km: "FSRO", en: "FSRO" },
  "creditreport.byCO.sectionOutstandingArea": { km: "សមតុល្យ​ឥណទាន_តំបន់", en: "Loan Outstanding_Area" },
  "creditreport.byCO.sectionOutstandingOwn": { km: "សមតុល្យ​ឥណទាន_ផ្ទាល់​ខ្លួន​", en: "Loan Outstanding_Own" },
  "creditreport.byCO.sectionDisburseArea": { km: "ការបញ្ចេញឥណទាន_តំបន់", en: "Loan Disburse_Area" },
  "creditreport.byCO.sectionDisburseOwn": { km: "ការបញ្ចេញឥណទាន_ផ្ទាល់ខ្លួន", en: "Loan Disburse_Own" },
  "creditreport.byCO.sectionT24Area": { km: "សមតុល្យ​ឥណទានយឺតយ៉ាវ (T24)_តំបន់", en: "Balance Loan at Risk (T24)_Area" },
  "creditreport.byCO.sectionT24Own": { km: "សមតុល្យ​ឥណទានយឺតយ៉ាវ​(T24)_ផ្ទាល់ខ្លួន", en: "Balance Loan at Risk (T24)_Own" },
  "creditreport.byCO.sectionNbcOverdueArea": { km: "សមតុល្យ​ឥណទានយឺតយ៉ាវ (NBC Overdue)_តំបន់", en: "Balance Loan at Risk (NBC Overdue)_Area" },
  "creditreport.byCO.sectionNbcOverdueOwn": { km: "សមតុល្យ​ឥណទានយឺតយ៉ាវ​ (NBC Overdue)_ផ្ទាល់ខ្លួន", en: "Balance Loan at Risk (NBC Overdue)_Own" },
  "creditreport.byCO.sectionWriteOffArea": { km: "បំណុលលុបចេញីបញ្ជី_តំបន់", en: "Write Off_Area" },
  "creditreport.byCO.sectionWriteOffOwn": { km: "បំណុលលុបចេញីបញ្ជី_ផ្ទាល់​ខ្លួន​", en: "Write Off_Own" },
  "creditreport.byCO.selectThenViewHistory": { km: "សូមស្វែងរក ហើយជ្រើសរើសមន្ត្រី រួចចុច \"{viewHistory}\"។", en: "Search and select an officer, then click \"{viewHistory}\"." },
  "creditreport.byCO.noOfficersMatch": { km: "មិនមានមន្ត្រីដែលត្រូវនឹងតម្រងទាំងនេះទេ។", en: "No officers match these filters." },

  // ==================================================================
  // DAILY MONITORING BY BRANCH
  // ==================================================================
  "creditreport.byBranch.printTitle": { km: "របាយការណ៍ឥណទានតាមសាខាប្រចាំថ្ងៃ", en: "Daily Credit Report by Branch" },
  "creditreport.byBranch.teamCo": { km: "មន្ត្រីឥណទាន", en: "CO" },
  "creditreport.byBranch.teamDigital": { km: "ឌីជីថល", en: "Digital" },
  "creditreport.byBranch.totalRow": { km: "សរុប", en: "Total" },
  "creditreport.byBranch.noBranchesMatch": { km: "មិនមានសាខាដែលត្រូវនឹងតម្រងទាំងនេះទេ។", en: "No branches match these filters." },
  "creditreport.byBranch.colDate": { km: "កាលបរិច្ឆេទ", en: "Date" },
  "creditreport.byBranch.toggleBreakdownAria": { km: "បង្ហាញ/លាក់ការបំបែកតាម CO/FSRO/ឌីជីថល", en: "Toggle CO/FSRO/Digital breakdown" },
  "creditreport.byBranch.expandAllAria": { km: "បង្ហាញ/លាក់ជួរទាំងអស់", en: "Expand or collapse all rows" },
  "creditreport.byBranch.loadingBreakdown": { km: "កំពុងផ្ទុកការបំបែក...", en: "Loading breakdown..." },
  "creditreport.byBranch.breakdownLoadFailed": { km: "មិនអាចផ្ទុកការបំបែកបានទេ។", en: "Could not load the breakdown." },
  "creditreport.byBranch.breakdownLoadFailedRetry": { km: "មិនអាចផ្ទុកការបំបែកបានទេ។ សូមព្យាយាមម្តងទៀត។", en: "Could not load the breakdown. Please try again." },
  "creditreport.byBranch.excelLibFailedRetry": { km: "បរាជ័យក្នុងការផ្ទុកបណ្ណាល័យ Excel — សូមពិនិត្យការតភ្ជាប់របស់អ្នក ហើយព្យាយាមម្តងទៀត។", en: "Excel export library failed to load — check your connection and try again." },
  "creditreport.byBranch.pdfLibFailedRetry": { km: "បរាជ័យក្នុងការផ្ទុកបណ្ណាល័យ PDF — សូមពិនិត្យការតភ្ជាប់របស់អ្នក ហើយព្យាយាមម្តងទៀត។", en: "PDF export library failed to load — check your connection and try again." },

  // ==================================================================
  // PRODUCTIVITY / PERFORMANCE PAGES — shared by Officer/Branch
  // Productivity and Location/Product Performance (drill-down pages
  // reached by clicking a name on the 4 Daily Monitoring reports).
  // ==================================================================
  "creditreport.productivity.officerTitle": { km: "ផលិតភាពមន្ត្រី", en: "Officer Productivity" },
  "creditreport.productivity.branchTitle": { km: "ផលិតភាពសាខា", en: "Branch Productivity" },
  "creditreport.productivity.locationTitle": { km: "សមិទ្ធកម្មទីតាំង", en: "Location Performance" },
  "creditreport.productivity.productTitle": { km: "សមិទ្ធកម្មផលិតផល", en: "Product Performance" },
  "creditreport.productivity.closeFullscreenAria": { km: "បិទអេក្រង់ពេញ", en: "Close fullscreen" },

  "creditreport.productivity.colLoan": { km: "កម្ចី", en: "Loan" },
  "creditreport.productivity.colClient": { km: "អតិថិជន", en: "Client" },
  "creditreport.productivity.colPar": { km: "PAR", en: "PAR" },
  "creditreport.productivity.listOfClient": { km: "បញ្ជីអតិថិជន", en: "List of Client" },
  "creditreport.productivity.noClientsFound": { km: "រកមិនឃើញអតិថិជនសម្រាប់ប្រភេទនេះទេ។", en: "No clients found for this category." },
  "creditreport.productivity.clientListLoadFailed": { km: "មិនអាចផ្ទុកបញ្ជីអតិថិជនបានទេ។", en: "Could not load the client list." },
  "creditreport.productivity.clientListLoadFailedRetry": { km: "មិនអាចផ្ទុកបញ្ជីអតិថិជនបានទេ។ សូមព្យាយាមម្តងទៀត។", en: "Could not load the client list. Please try again." },

  "creditreport.productivity.colNo": { km: "ល.រ", en: "No" },
  "creditreport.productivity.colLoanNumber": { km: "លេខកម្ចី", en: "Loan Number" },
  "creditreport.productivity.colDisburseDate": { km: "កាលបរិច្ឆេទផ្តល់ឱ្យខ្ចី", en: "Disburse Date" },
  "creditreport.productivity.colAddress": { km: "អាសយដ្ឋាន", en: "Address" },
  "creditreport.productivity.colLoanSize": { km: "ទំហំកម្ចី", en: "Loan Size" },
  "creditreport.productivity.colOsUsd": { km: "OS USD", en: "OS USD" },
  "creditreport.productivity.colCustomer": { km: "អតិថិជន", en: "Customer" },
  "creditreport.productivity.colDisDate": { km: "ថ្ងៃផ្តល់ឱ្យខ្ចី", en: "DisDate" },
  "creditreport.productivity.colPrnOs": { km: "ប្រាក់ដើមនៅសល់", en: "Prn.OS" },
  "creditreport.productivity.colIntOs": { km: "ការប្រាក់នៅសល់", en: "Int.OS" },
  "creditreport.productivity.colPrnDue": { km: "ប្រាក់ដើមត្រូវបង់", en: "Prn.Due" },
  "creditreport.productivity.colIntDue": { km: "ការប្រាក់ត្រូវបង់", en: "Int.Due" },
  "creditreport.productivity.colPenalty": { km: "ការពិន័យ", en: "Penalty" },
  "creditreport.productivity.colArreas": { km: "យឺតយ៉ាវ", en: "Arreas" },
  "creditreport.productivity.colDay": { km: "ថ្ងៃ", en: "Day" },
  "creditreport.productivity.colBalnce": { km: "នៅសល់", en: "Balnce" },
  "creditreport.productivity.colAccountLoan": { km: "គណនីកម្ចី", en: "Account Loan" },

  "creditreport.productivity.dailyLoanDisbursement": { km: "ប្រាក់កម្ចីបានផ្តល់ឱ្យខ្ចីប្រចាំថ្ងៃ", en: "Daily Loan Disbursement" },
  "creditreport.productivity.periodDate": { km: "កំឡុងកាលបរិច្ឆេទ", en: "Period Date" },
  "creditreport.productivity.totalDisburse": { km: "សរុបបានផ្តល់ឱ្យខ្ចី", en: "Total Disburse" },
  "creditreport.productivity.less": { km: "តិច", en: "Less" },
  "creditreport.productivity.more": { km: "ច្រើន", en: "More" },
  "creditreport.productivity.weekend": { km: "ចុងសប្តាហ៍", en: "Weekend" },
  "creditreport.productivity.holiday": { km: "ថ្ងៃបុណ្យ", en: "Holiday" },
  "creditreport.productivity.noDisbursement": { km: "មិនមានការផ្តល់ឱ្យខ្ចី", en: "No disbursement" },
  "creditreport.productivity.loanCount": { km: "កម្ចី {count}", en: "{count} loan(s)" },
  "creditreport.productivity.dayClientsLoadFailed": { km: "មិនអាចផ្ទុកអតិថិជនសម្រាប់ថ្ងៃនេះបានទេ។", en: "Could not load clients for this day." },
  "creditreport.productivity.dayClientsLoadFailedRetry": { km: "មិនអាចផ្ទុកអតិថិជនសម្រាប់ថ្ងៃនេះបានទេ។ សូមព្យាយាមម្តងទៀត។", en: "Could not load clients for this day. Please try again." },
  "creditreport.productivity.chartLoadFailed": { km: "មិនអាចផ្ទុកក្រាបការផ្តល់ឱ្យខ្ចីបានទេ។", en: "Could not load the disbursement chart." },
  "creditreport.productivity.chartLoadFailedRetry": { km: "មិនអាចផ្ទុកក្រាបការផ្តល់ឱ្យខ្ចីបានទេ។ សូមព្យាយាមម្តងទៀត។", en: "Could not load the disbursement chart. Please try again." },
  "creditreport.productivity.fullscreenChartAria": { km: "ក្រាបអេក្រង់ពេញ", en: "Fullscreen chart" },

  "creditreport.productivity.noOfficerSpecified": { km: "មិនបានបញ្ជាក់មន្ត្រីទេ។ សូមត្រឡប់ក្រោយ ហើយជ្រើសរើសមន្ត្រីពីរបាយការណ៍។", en: "No officer was specified. Go back and select an officer from the report." },
  "creditreport.productivity.couldNotFindOfficer": { km: "រកមិនឃើញ \"{name}\" នៅក្រោមតម្រងរបាយការណ៍បច្ចុប្បន្ន។", en: "Could not find \"{name}\" under the current report filters." },
  "creditreport.productivity.networkErrorOfficerData": { km: "មានបញ្ហាការតភ្ជាប់បណ្តាញពេលផ្ទុកទិន្នន័យមន្ត្រី។", en: "Network error loading officer data." },

  "creditreport.byBranch.teamDigitalLoan": { km: "ឥណទានឌីជីថល", en: "Digital Loan" },
  "creditreport.productivity.failedLoadBranchData": { km: "បរាជ័យក្នុងការផ្ទុកទិន្នន័យសាខា។", en: "Failed to load branch data." },
  "creditreport.productivity.networkErrorBranchData": { km: "មានបញ្ហាការតភ្ជាប់បណ្តាញពេលផ្ទុកទិន្នន័យសាខា។", en: "Network error loading branch data." },
  "creditreport.productivity.noBranchSpecified": { km: "មិនបានបញ្ជាក់សាខាទេ។ សូមត្រឡប់ក្រោយ ហើយជ្រើសរើសសាខាពីរបាយការណ៍។", en: "No branch was specified. Go back and select a branch from the report." },
  "creditreport.productivity.showMore": { km: "មើលបន្ថែម", en: "Show More" },
  "creditreport.productivity.showingXOfY": { km: "បង្ហាញ {shown} ក្នុងចំណោម {total}", en: "Showing {shown} of {total}" },

  "creditreport.productivity.failedLoadLocationData": { km: "បរាជ័យក្នុងការផ្ទុកទិន្នន័យទីតាំង។", en: "Failed to load location data." },
  "creditreport.productivity.networkErrorLocationData": { km: "មានបញ្ហាការតភ្ជាប់បណ្តាញពេលផ្ទុកទិន្នន័យទីតាំង។", en: "Network error loading location data." },
  "creditreport.productivity.noDisbursementDataPeriod": { km: "មិនមានទិន្នន័យការផ្តល់ឱ្យខ្ចីសម្រាប់កំឡុងកាលបរិច្ឆេទនេះទេ។", en: "No disbursement data for this period." },
  "creditreport.productivity.noLocationSpecified": { km: "មិនបានបញ្ជាក់ទីតាំងទេ។ សូមត្រឡប់ក្រោយ ហើយជ្រើសរើសទីតាំងពីរបាយការណ៍។", en: "No location was specified. Go back and select a location from the report." },

  "creditreport.productivity.failedLoadProductData": { km: "បរាជ័យក្នុងការផ្ទុកទិន្នន័យផលិតផល។", en: "Failed to load product data." },
  "creditreport.productivity.networkErrorProductData": { km: "មានបញ្ហាការតភ្ជាប់បណ្តាញពេលផ្ទុកទិន្នន័យផលិតផល។", en: "Network error loading product data." },
  "creditreport.productivity.noProductSpecified": { km: "មិនបានបញ្ជាក់ផលិតផលទេ។ សូមត្រឡប់ក្រោយ ហើយជ្រើសរើសផលិតផលពីរបាយការណ៍។", en: "No product was specified. Go back and select a product from the report." }
});
