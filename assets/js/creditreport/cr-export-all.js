// ========================================
// Credit Report hub — "Export All (Excel)"
// One workbook, one sheet per report, straight from each report's own
// endpoint (no page needs to be open) — every branch/officer/product/
// location/customer/loan row, not just what's on screen. Reuses the
// same multi-sheet engine the 4 Daily Monitoring reports already use
// (ArrExport.excel, see arrears-export.js) rather than reinventing a
// workbook writer; "limit"/"top"/"cause" params that narrow a report's
// own default view are all overridden here for full detail, per each
// page's own JS (ewsExport/cpExport/rcExport/crkExport/nplExport…).
//
// Admin and user only (owner, 31/10/2026) — same gate as Credit
// Portfolio Intelligence (crHubIsAdmin / crHubAllowed in
// creditreport-hub.js); Daily Monitoring data is included too since
// it's open to every role, but the button itself only shows for the
// roles that may also see the Portfolio data, so there's one combined
// control rather than two overlapping ones.
//
// Pattern: each report is a small async "sheet builder" —
// () => Promise<Sheet|null> — returning null (not throwing) when its
// own fetch fails, so one broken endpoint doesn't block the rest. Run
// with limited concurrency (creditreport-hub.js's Snapshot All fires
// everything at once; this fires ~25 requests, so a small pool is
// kinder to the backend), then one ArrExport.excel() call with every
// sheet collected.
// ========================================
(function () {
    const t = (key, vars) => (window.CMI18n ? CMI18n.t(key, vars) : key);
    const token = () => localStorage.getItem("token") || sessionStorage.getItem("token");

    function toast(message, type) {
        if (typeof CMToast !== "undefined" && typeof CMToast.show === "function") {
            CMToast.show({ type, title: message, message: "", duration: 3500 });
        }
    }

    async function get(path, params) {
        const q = new URLSearchParams();
        Object.entries(params || {}).forEach(([k, v]) => {
            if (v === undefined || v === null || v === "") return;
            if (Array.isArray(v)) v.forEach(x => q.append(k, x)); else q.set(k, v);
        });
        const qs = [...q.keys()].length ? `?${q}` : "";
        try {
            const res = await fetch(`${API.BASE_URL}${path}${qs}`, { headers: { Authorization: `Bearer ${token()}` } });
            const data = await res.json().catch(() => null);
            return data && data.ok ? data : null;
        } catch (e) {
            console.error(`[export all] ${path} failed:`, e);
            return null;
        }
    }

    function getPath(obj, path) {
        return path.split(".").reduce((o, k) => (o === null || o === undefined ? undefined : o[k]), obj);
    }

    // No cap — every page's own "top"/"limit" default narrows its view
    // for on-screen paging; the export wants everything.
    const ALL = 100000;

    const exportedInfo = () => {
        let user = "";
        try { user = JSON.parse(localStorage.getItem("loggedInUser") || sessionStorage.getItem("loggedInUser") || "{}").username || ""; } catch (e) { /* no user line */ }
        const d = new Date();
        const pad = n => String(n).padStart(2, "0");
        return `${t("creditreport.export.exported")} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}${user ? " · " + user : ""}`;
    };

    // ---------- column helpers (ArrExport's col shape) ----------
    // Every getter runs through a safe wrapper: a getter that throws
    // (an unexpectedly-shaped real row — the mocked data this was
    // tested against can't cover every production edge case) or
    // returns something ExcelJS can't write (an object/array instead
    // of a primitive, NaN) blanks that one cell instead of failing the
    // whole workbook. A single bad cell is a small loss; a whole
    // failed export over one bad row is not.
    function safeNum(get) {
        return r => {
            let v;
            try { v = get(r); } catch (e) { return null; }
            if (v === null || v === undefined || v === "") return null;
            if (v instanceof Date) return null;
            const n = Number(v);
            return Number.isFinite(n) ? n : null;
        };
    }
    function safeText(get) {
        return r => {
            let v;
            try { v = get(r); } catch (e) { return ""; }
            if (v === null || v === undefined) return "";
            if (typeof v === "object") { try { return JSON.stringify(v); } catch (e) { return String(v); } }
            return String(v);
        };
    }
    const textCol = (label, get) => ({ label, type: "text", value: safeText(get) });
    const intCol = (label, get) => ({ label, type: "int", numFmt: "#,##0", value: safeNum(get) });
    const moneyCol = (label, get) => ({ label, type: "num", numFmt: "#,##0", value: safeNum(get) });
    const pctCol = (label, get) => ({ label, type: "num", numFmt: "0.00%", value: safeNum(get) });

    // A Daily-Monitoring-style field: {key, label, money|pct|optional}
    // against an item object (crSections()'s own field shape, reused
    // as-is from each report page rather than redefined).
    function fieldCol(f) {
        const get = r => getPath(r, f.key);
        if (f.pct) return pctCol(f.label, get);
        if (f.money) return moneyCol(f.label, get);
        return intCol(f.label, get);
    }

    // Identity column + groups of fields -> {cols, groups} for
    // ArrExport (a leading, ungrouped identity column, then each
    // group's fields under its own spanning header).
    function groupedCols(identityLabel, identityGet, groups) {
        const cols = [textCol(identityLabel, identityGet)];
        const colGroups = [{ span: 1 }];
        groups.forEach(g => {
            g.fields.forEach(f => cols.push(fieldCol(f)));
            colGroups.push({ label: g.label, span: g.fields.length });
        });
        return { cols, groups: colGroups };
    }

    function crGroupPct(prefix, label) {
        return { label, fields: [
            { key: `${prefix}.count`, label: "#" },
            { key: `${prefix}.value`, label: t("creditreport.detail.colValue") },
            { key: `${prefix}.parPct`, label: t("creditreport.detail.colParPct"), pct: true }
        ] };
    }

    // ========================================
    // 1-4: Daily Monitoring (Branch / Officer / Product / Location) —
    // the same /api/creditreport/{summary,byco,byproduct,bylocation}
    // endpoints and column layout as RepDetailby{Branch,CO,Product,
    // Location}.js's own crSections(), fetched directly instead of read
    // off that page's on-screen table.
    // ========================================
    function nbcOverdueGroups(prefix, totalKey) {
        return [
            crGroupPct(`${prefix}.minor`, t("creditreport.detail.classMinorDefault")),
            crGroupPct(`${prefix}.specialMention`, t("creditreport.detail.classSpecialMention")),
            crGroupPct(`${prefix}.subStandard`, t("creditreport.detail.classSubStandardHyphen")),
            crGroupPct(`${prefix}.doubtful`, t("creditreport.detail.classDoubtful")),
            crGroupPct(`${prefix}.loss`, t("creditreport.detail.classLoss")),
            crGroupPct(`${prefix}.majorDefault`, t("creditreport.detail.classMajorDefault")),
            crGroupPct(`${prefix}.nonPerformingLoan`, t("creditreport.detail.classNonPerformingLoan")),
            crGroupPct(`${prefix}.${totalKey}`, t("creditreport.detail.classTotalNbcOverdue"))
        ];
    }
    function writeOffGroups(prefix) {
        return [
            { label: t("creditreport.detail.woBalanceWO"), fields: [
                { key: `${prefix}.balanceWO.cif`, label: t("creditreport.detail.colCifHash") },
                { key: `${prefix}.balanceWO.int`, label: t("creditreport.detail.colInt"), money: true },
                { key: `${prefix}.balanceWO.prn`, label: t("creditreport.detail.colPrn"), money: true }
            ] },
            { label: t("creditreport.detail.woWO"), fields: [
                { key: `${prefix}.wo.count`, label: "#" },
                { key: `${prefix}.wo.prn`, label: t("creditreport.detail.colPrn"), money: true }
            ] },
            { label: t("creditreport.detail.woCollected"), fields: [
                { key: `${prefix}.woCollected.int`, label: t("creditreport.detail.colInt"), money: true },
                { key: `${prefix}.woCollected.prn`, label: t("creditreport.detail.colPrn"), money: true }
            ] }
        ];
    }

    function branchGroups() {
        return [
            { label: t("creditreport.detail.sectionOutstanding"), fields: [
                { key: "loanOutstanding.loan", label: t("creditreport.detail.colLoanHash") },
                { key: "loanOutstanding.client", label: t("creditreport.detail.colClient") },
                { key: "loanOutstanding.value", label: t("creditreport.detail.colValue"), money: true }
            ] },
            { label: t("creditreport.detail.sectionKhr"), fields: [{ key: "osMix.khr", label: t("creditreport.detail.colValue"), money: true }] },
            { label: t("creditreport.detail.sectionSmall"), fields: [{ key: "osMix.small", label: t("creditreport.detail.colValue"), money: true }] },
            { label: t("creditreport.detail.sectionDisburse"), fields: [
                { key: "loanDisburse.loan", label: t("creditreport.detail.colLoanHash") },
                { key: "loanDisburse.value", label: t("creditreport.detail.colValue"), money: true }
            ] },
            { label: t("creditreport.detail.sectionLos"), fields: [{ key: "loanLos.loan", label: t("creditreport.detail.colLoanHash") }] },
            { label: t("creditreport.detail.sectionT24"), fields: [
                { key: "parT24.loan", label: t("creditreport.detail.colLoanHash") },
                { key: "parT24.value", label: t("creditreport.detail.colValue"), money: true },
                { key: "parT24.parPct", label: t("creditreport.detail.colParPct"), pct: true }
            ] },
            ...nbcOverdueGroups("nbcOverdue", "total"),
            ...writeOffGroups("writeOff")
        ];
    }
    function productLikeGroups() {
        return [
            { label: t("creditreport.detail.sectionOutstanding"), fields: [
                { key: "loanOutstanding.loan", label: t("creditreport.detail.colLoanHash") },
                { key: "loanOutstanding.client", label: t("creditreport.detail.colClient") },
                { key: "loanOutstanding.value", label: t("creditreport.detail.colValue"), money: true }
            ] },
            { label: t("creditreport.detail.sectionDisburse"), fields: [
                { key: "loanDisburse.loan", label: t("creditreport.detail.colLoanHash") },
                { key: "loanDisburse.value", label: t("creditreport.detail.colValue"), money: true }
            ] },
            { label: t("creditreport.detail.sectionT24"), fields: [
                { key: "parT24.loan", label: t("creditreport.detail.colLoanHash") },
                { key: "parT24.value", label: t("creditreport.detail.colValue"), money: true },
                { key: "parT24.parPct", label: t("creditreport.detail.colParPct"), pct: true }
            ] },
            ...nbcOverdueGroups("nbcOverdue", "total"),
            ...writeOffGroups("writeOff")
        ];
    }
    function officerGroups() {
        return [
            { label: t("creditreport.detail.sectionOutstanding") + " — Area", fields: [
                { key: "loanOutstandingArea.loan", label: t("creditreport.detail.colLoanHash") },
                { key: "loanOutstandingArea.client", label: t("creditreport.detail.colClient") },
                { key: "loanOutstandingArea.value", label: t("creditreport.detail.colValue"), money: true }
            ] },
            { label: t("creditreport.detail.sectionOutstanding") + " — Own", fields: [
                { key: "loanOutstanding.loan", label: t("creditreport.detail.colLoanHash") },
                { key: "loanOutstanding.client", label: t("creditreport.detail.colClient") },
                { key: "loanOutstanding.value", label: t("creditreport.detail.colValue"), money: true }
            ] },
            { label: t("creditreport.detail.sectionDisburse") + " — Area", fields: [
                { key: "loanDisburseArea.loan", label: t("creditreport.detail.colLoanHash") },
                { key: "loanDisburseArea.value", label: t("creditreport.detail.colValue"), money: true }
            ] },
            { label: t("creditreport.detail.sectionDisburse") + " — Own", fields: [
                { key: "loanDisburse.loan", label: t("creditreport.detail.colLoanHash") },
                { key: "loanDisburse.value", label: t("creditreport.detail.colValue"), money: true }
            ] },
            { label: t("creditreport.detail.sectionT24") + " — Area", fields: [
                { key: "parT24Area.loan", label: t("creditreport.detail.colLoanHash") },
                { key: "parT24Area.value", label: t("creditreport.detail.colValue"), money: true },
                { key: "parT24Area.parPct", label: t("creditreport.detail.colParPct"), pct: true }
            ] },
            { label: t("creditreport.detail.sectionT24") + " — Own", fields: [
                { key: "parT24.loan", label: t("creditreport.detail.colLoanHash") },
                { key: "parT24.value", label: t("creditreport.detail.colValue"), money: true },
                { key: "parT24.parPct", label: t("creditreport.detail.colParPct"), pct: true }
            ] },
            ...nbcOverdueGroups("nbcOverdueArea", "total"),
            ...nbcOverdueGroups("nbcOverdue", "totalOwn"),
            ...writeOffGroups("writeOffArea"),
            ...writeOffGroups("writeOffOwn")
        ];
    }

    async function sheetDailyMonitoring(path, name, title, identityKey, groups, otherLabel) {
        const d = await get(path, {});
        if (!d || !Array.isArray(d.items)) return null;
        const items = d.total && typeof d.total === "object" ? [...d.items, { ...d.total, [identityKey]: t("common.total") }] : d.items;
        const { cols, groups: colGroups } = groupedCols(
            t("creditreport.detail.branch"),
            r => r[identityKey] || (otherLabel || "—"),
            groups
        );
        return { name, title, info: [exportedInfo()], cols, groups: colGroups, rows: items, freezeCols: 1 };
    }

    // ========================================
    // 5: Customer Risk — GET /api/credit-intelligence/customers
    // (crkExport's own row shape, CustomerRisk.js)
    // ========================================
    async function sheetCustomerRisk() {
        const d = await get("/api/credit-intelligence/customers", { unit: "customer", sort: "par", top: ALL });
        if (!d || !Array.isArray(d.rows)) return null;
        const cols = [
            textCol("CIF", r => r.cif || ""),
            textCol(t("creditreport.npl.colCustomer"), r => r.name || ""),
            intCol(t("creditreport.crk.colLoans"), r => r.loans),
            moneyCol(t("creditreport.crk.colPar"), r => r.par),
            pctCol(t("creditreport.crk.colShare"), r => r.share),
            moneyCol(t("creditreport.crk.colOs"), r => r.os),
            intCol(t("creditreport.crk.colDpd"), r => r.day),
            textCol(t("creditreport.crk.hClass"), r => r.cls),
            intCol(t("creditreport.ews.score"), r => r.score),
            textCol(t("creditreport.crk.colStatus"), r => r.status ? t(`creditreport.crk.st.${r.status}`) : ""),
            moneyCol(t("creditreport.crk.colChange"), r => r.change),
            textCol(t("creditreport.pi.officer"), r => (r.officers || []).map(o => o.name).join(", ")),
            textCol(t("creditreport.pi.branch"), r => (r.branches || []).join(", "))
        ];
        return { name: "CustomerRisk", title: `${t("creditreport.hub.gRisk")} — ${t("creditreport.crk.title")}`, info: [exportedInfo()], cols, rows: d.rows, freezeCols: 1 };
    }

    // ========================================
    // 6: Early Warning — GET /api/credit-intelligence/early-warning
    // ========================================
    async function sheetEarlyWarning() {
        const d = await get("/api/credit-intelligence/early-warning", {});
        if (!d || !Array.isArray(d.rows)) return null;
        const cols = [
            textCol(t("creditreport.npl.colLoan"), r => r.ld),
            textCol(t("creditreport.npl.colCustomer"), r => r.name),
            textCol(t("creditreport.pi.officer"), r => r.officerName || r.officerId),
            textCol(t("creditreport.pi.branch"), r => r.branch),
            textCol(t("creditreport.npl.colLocation"), r => r.district || r.address),
            moneyCol(t("creditreport.crk.colOs"), r => r.bal),
            intCol(t("creditreport.crk.colDpd"), r => r.day),
            textCol("Warnings", r => (r.warnings || []).map(w => `${t(`creditreport.ews.r.${w.rule}`)} (+${w.points})`).join("; ")),
            intCol(t("creditreport.ews.score"), r => r.score),
            textCol("Level", r => t(`creditreport.ews.level.${r.level}`)),
            textCol("Follow-up", r => r.followUp || "")
        ];
        return { name: "EarlyWarning", title: t("creditreport.hub.gRisk") + " — Early Warning", info: [exportedInfo()], cols, rows: d.rows, freezeCols: 1 };
    }

    // ========================================
    // 7: Customer Prediction — GET /api/credit-intelligence/customers/prediction
    // ========================================
    async function sheetCustomerPrediction() {
        const d = await get("/api/credit-intelligence/customers/prediction", { unit: "customer", sort: "par", top: ALL, all: "1" });
        if (!d || !Array.isArray(d.rows)) return null;
        const cols = [
            textCol("CIF", r => r.cif || ""),
            textCol(t("creditreport.npl.colCustomer"), r => r.name),
            intCol(t("creditreport.crk.colLoans"), r => r.loans),
            textCol(t("creditreport.pi.branch"), r => (r.branches || []).join(", ")),
            textCol(t("creditreport.pi.officer"), r => (r.officers || []).join(", ")),
            intCol(t("creditreport.crk.colDpd"), r => r.day),
            moneyCol(t("creditreport.crk.colPar"), r => r.par),
            pctCol("Probability", r => r.p),
            moneyCol("Expected rolling", r => r.expected)
        ];
        return { name: "CustomerPrediction", title: t("creditreport.hub.gForecast") + " — Customer Prediction", info: [exportedInfo()], cols, rows: d.rows, freezeCols: 1 };
    }

    // ========================================
    // 8: Root Cause — GET /api/credit-intelligence/causes
    // (cause:"" for every cause, not just unclassified; rcExport's row shape)
    // ========================================
    async function sheetRootCause() {
        const d = await get("/api/credit-intelligence/causes", { dim: "branch", cause: "", limit: ALL });
        if (!d || !Array.isArray(d.accounts)) return null;
        const cols = [
            textCol(t("creditreport.npl.colLoan"), r => r.ld),
            textCol("CIF", r => r.cif || ""),
            textCol(t("creditreport.npl.colCustomer"), r => r.name),
            moneyCol("PAR", r => r.par),
            intCol(t("creditreport.crk.colDpd"), r => r.day),
            textCol(t("creditreport.crk.hClass"), r => r.cls),
            textCol(t("creditreport.pi.officer"), r => r.officerName || r.officerId),
            textCol(t("creditreport.pi.branch"), r => r.branch),
            textCol(t("creditreport.pi.product"), r => r.product),
            textCol(t("creditreport.rc.causeCol"), r => r.category ? t(`creditreport.rc.c.${r.category}`) : t("creditreport.rc.unclassified")),
            textCol(t("creditreport.rc.officerText") || "Officer's note", r => r.reason || ""),
            textCol(t("creditreport.rc.byCol"), r => r.classifiedBy || ""),
            textCol(t("creditreport.rc.atCol"), r => r.classifiedAt || "")
        ];
        return { name: "RootCause", title: t("creditreport.hub.gAction") + " — Root Cause", info: [exportedInfo()], cols, rows: d.accounts, freezeCols: 1 };
    }

    // ========================================
    // 9: Recovery Actions — GET /api/credit-intelligence/actions?view=all
    // ========================================
    async function sheetRecoveryActions() {
        const d = await get("/api/credit-intelligence/actions", { view: "all", limit: ALL });
        if (!d || !Array.isArray(d.rows)) return null;
        const cols = [
            textCol(t("creditreport.npl.colLoan"), r => r.ld),
            textCol(t("creditreport.npl.colCustomer"), r => r.name),
            textCol("CIF", r => r.cif || ""),
            moneyCol("PAR", r => r.par),
            intCol(t("creditreport.crk.colDpd"), r => r.day),
            textCol(t("creditreport.crk.hClass"), r => r.cls),
            textCol(t("creditreport.pi.officer"), r => r.officerName || r.officerId),
            textCol(t("creditreport.pi.branch"), r => r.branch),
            textCol(t("creditreport.pi.product"), r => r.product),
            textCol("Stage", r => (r.state || {}).stage || ""),
            textCol("Follow-up overdue", r => ((r.state || {}).followUpOverdue ? "Y" : "")),
            textCol("PTP broken", r => ((r.state || {}).ptpBroken ? "Y" : "")),
            textCol("PTP due", r => ((r.state || {}).ptpDue ? "Y" : "")),
            textCol("Assignee", r => ((r.latest || {}).assignee || {}).name || ""),
            textCol("Last contact", r => (r.latest || {}).contact || ""),
            textCol("Last visit", r => (r.latest || {}).visit || ""),
            textCol("Follow-up date", r => (r.latest || {}).followUp || ""),
            moneyCol("PTP amount", r => ((r.latest || {}).ptp || {}).amount),
            textCol("PTP date", r => ((r.latest || {}).ptp || {}).date || ""),
            textCol("Outcome", r => ((r.latest || {}).outcome || {}).status || ""),
            moneyCol("Outcome amount", r => ((r.latest || {}).outcome || {}).amount),
            textCol("Next step", r => (r.latest || {}).next || ""),
            textCol("By", r => (r.latest || {}).by || ""),
            textCol("At", r => (r.latest || {}).at || "")
        ];
        return { name: "RecoveryActions", title: t("creditreport.hub.gAction") + " — Recovery Actions", info: [exportedInfo()], cols, rows: d.rows, freezeCols: 1 };
    }

    // ========================================
    // 10-14: NPL movement — GET /api/credit-intelligence/npl (one fetch,
    // 5 sheets split client-side exactly as nplRowsOfTab() does)
    // ========================================
    const NPL_TABS = [
        ["new", "New"], ["balance", "Continuing (balance changed)"], ["writeoff", "Written off"],
        ["moved", "Class changed"], ["recovered", "Recovered"]
    ];
    function nplRowsOfTab(accounts, tab) {
        if (tab === "balance") return accounts.filter(a => a.category === "continuing" && a.change !== 0);
        if (tab === "writeoff") return accounts.filter(a => a.category === "recovered" && a.exit === "written_off");
        if (tab === "moved") return accounts.filter(a => a.category === "recovered" && a.exit === "class_changed");
        if (tab === "recovered") return accounts.filter(a => a.category === "recovered" && a.exit !== "written_off" && a.exit !== "class_changed");
        return accounts.filter(a => a.category === tab);
    }
    function nplCols() {
        return [
            textCol(t("creditreport.npl.colLoan"), r => r.ld),
            textCol(t("creditreport.npl.colCustomer"), r => r.name),
            textCol(t("creditreport.pi.branch"), r => r.branch),
            textCol(t("creditreport.list.colAreaOfficer"), r => r.areaOfficer),
            textCol(t("creditreport.list.colOwnOfficer"), r => r.ownOfficer),
            textCol(t("creditreport.pi.product"), r => r.product),
            textCol(t("creditreport.npl.colLocation"), r => r.district || r.location),
            textCol(t("creditreport.npl.colPrev"), r => r.prevCls),
            textCol(t("creditreport.npl.colCur"), r => r.curCls),
            moneyCol(t("creditreport.npl.colOpening"), r => r.openBal),
            moneyCol(t("creditreport.npl.colClosing"), r => r.closeBal),
            moneyCol(t("creditreport.npl.colChange"), r => r.change),
            intCol(t("creditreport.list.colDays"), r => r.day),
            textCol(t("creditreport.npl.colReason"), r => r.reason)
        ];
    }
    async function sheetsNplMovement() {
        const d = await get("/api/credit-intelligence/npl", {});
        if (!d || !Array.isArray(d.accounts)) return [];
        return NPL_TABS.map(([tab, label]) => ({
            name: `NPL_${tab}`.slice(0, 31),
            title: `${t("creditreport.hub.gRisk")} — NPL ${label}`,
            info: [exportedInfo()],
            cols: nplCols(),
            rows: nplRowsOfTab(d.accounts, tab),
            freezeCols: 1
        }));
    }

    // ========================================
    // 15-19: NPL Recovery — GET /api/credit-intelligence/recovery?dim=
    // (aggregate rows per dim bucket, NplRecovery.js)
    // ========================================
    const RECOVERY_DIMS = [
        ["officer", "Officer"], ["branch", "Branch"], ["product", "Product"], ["location", "District"], ["aging", "Days bucket"]
    ];
    async function sheetRecovery(dim, label) {
        const d = await get("/api/credit-intelligence/recovery", { dim });
        if (!d || !Array.isArray(d.byDim)) return null;
        const cols = [
            textCol(label, r => r.name || r.key),
            ...(dim === "officer" ? [textCol(t("creditreport.pi.branch"), r => r.branch)] : []),
            moneyCol("Opening", r => r.opening),
            moneyCol("Left (value)", r => (r.left || {}).value),
            intCol("Left (count)", r => (r.left || {}).count),
            pctCol("Recovery rate", r => r.recoveryRate),
            moneyCol("Reduction (value)", r => (r.reduction || {}).value),
            intCol("Reduction (count)", r => (r.reduction || {}).count),
            moneyCol("New NPL", r => (r.newNpl || {}).value),
            moneyCol("Net", r => r.net),
            ...(dim === "branch" ? [moneyCol("Target", r => r.target)] : [])
        ];
        return { name: `Recovery_${dim}`.slice(0, 31), title: `${t("creditreport.hub.gAction")} — Recovery by ${label}`, info: [exportedInfo()], cols, rows: d.byDim, freezeCols: 1 };
    }

    // ========================================
    // 20-23: Top Risk Contributors — GET /api/credit-intelligence/risk?dim=
    // (every row for the dim, not just the Top 10 the page itself shows)
    // ========================================
    const RISK_DIMS = [["branch", "Branch"], ["officer", "Officer"], ["product", "Product"], ["location", "District"]];
    async function sheetRisk(dim, label) {
        const d = await get("/api/credit-intelligence/risk", { dim });
        if (!d || !Array.isArray(d.rows)) return null;
        const cols = [
            textCol(t("creditreport.risk.colName"), r => r.name || r.key),
            ...(dim === "officer" ? [textCol(t("creditreport.pi.branch"), r => r.branch)] : []),
            moneyCol(t("creditreport.pi.kOutstanding"), r => r.os),
            moneyCol(t("creditreport.pi.kNplValue"), r => r.nplValue),
            intCol(t("creditreport.pi.kNplAccounts"), r => r.npl),
            pctCol(t("creditreport.pi.kNplPct"), r => r.nplPct),
            pctCol(t("creditreport.pi.kParPct"), r => r.parPct),
            pctCol(t("creditreport.risk.colNplGrowth"), r => r.nplGrowth),
            moneyCol(t("creditreport.risk.colNewNpl"), r => r.newNpl ? r.newNpl.value : null),
            pctCol(t("creditreport.risk.contribution"), r => r.contribution)
        ];
        return { name: `RiskContrib_${dim}`.slice(0, 31), title: `${t("creditreport.hub.gRisk")} — Top Risk Contributors (${label})`, info: [exportedInfo()], cols, rows: d.rows, freezeCols: 1 };
    }

    // ========================================
    // 24: Meeting Report's CO/FSRO/Digital team split (with WO balance)
    // — GET /api/creditreport/branch-productivity-summary, branch="All
    // Branch" (the server's own magic value for every branch combined).
    // The only figure on the Meeting Report unique to it (everything
    // else there is already covered by the Daily Monitoring / Risk
    // Contributor sheets above).
    // ========================================
    async function sheetMeetingTeamSplit() {
        const d = await get("/api/creditreport/branch-productivity-summary", { branch: "All Branch" });
        if (!d) return null;
        const buckets = [
            ["co", t("creditreport.byBranch.teamCo")], ["fsro", t("creditreport.byCO.fsro")],
            ["digital", t("creditreport.byBranch.teamDigital")], ["total", t("creditreport.risk.total")]
        ].map(([key, label]) => ({ label, ...(d[key] || {}) }));
        const cols = [
            textCol(t("creditreport.mr.byTeam"), r => r.label),
            moneyCol(t("creditreport.mr.k.os"), r => (r.loanOutstanding || {}).value),
            moneyCol(t("creditreport.mr.k.disb"), r => (r.loanDisburse || {}).value),
            pctCol("PAR %", r => (r.parT24 || {}).parPct),
            pctCol("NPL %", r => (r.nbcOverdue && r.nbcOverdue.nonPerformingLoan || {}).parPct),
            moneyCol(t("creditreport.detail.woBalanceWO"), r => (r.writeOff && r.writeOff.balanceWO || {}).prn),
            intCol(t("creditreport.detail.colCifHash"), r => (r.writeOff && r.writeOff.balanceWO || {}).cif)
        ];
        return { name: "MeetingReport_Team", title: `${t("creditreport.hub.meeting")} — CO / FSRO / Digital`, info: [exportedInfo()], cols, rows: buckets, freezeCols: 1 };
    }

    // ========================================
    // 25: Portfolio composition — GET /api/credit-intelligence/overview
    // (branch/product/location tabs, each row's share of the portfolio)
    // ========================================
    async function sheetPortfolioComposition() {
        const d = await get("/api/credit-intelligence/overview", {});
        if (!d || !d.composition) return null;
        const dims = [["branch", t("creditreport.pi.byBranch")], ["product", t("creditreport.pi.byProduct")], ["location", t("creditreport.pi.byDistrict")]];
        const rows = [];
        dims.forEach(([key, label]) => (d.composition[key] || []).forEach(r => rows.push({ ...r, dim: label })));
        const cols = [
            textCol(t("creditreport.hub.sectionPortfolio"), r => r.dim),
            textCol(t("creditreport.risk.colName"), r => r.name || t("creditreport.pi.otherAddress")),
            moneyCol(t("creditreport.pi.kOutstanding"), r => r.os),
            pctCol(t("creditreport.crk.colShare"), r => r.share),
            pctCol(t("creditreport.pi.kNplPct"), r => r.nplPct),
            pctCol(t("creditreport.pi.kParPct"), r => r.parPct)
        ];
        return { name: "Portfolio_Composition", title: `${t("creditreport.hub.gOverview")} — Composition`, info: [exportedInfo()], cols, rows, freezeCols: 1 };
    }

    // ========================================
    // 26: Forecast — GET /api/credit-intelligence/forecast?dim=
    // One row per (dimension group, month): history actual, then
    // Best/Base/Stress for the forecast months.
    // ========================================
    async function sheetForecast() {
        const rows = [];
        for (const [dim, label] of [["portfolio", "Portfolio"], ["branch", "Branch"], ["product", "Product"]]) {
            const d = await get("/api/credit-intelligence/forecast", { dim, horizon: 3 });
            if (!d || !Array.isArray(d.groups)) continue;
            d.groups.forEach(g => {
                if (!g.available) return;
                (g.history || []).forEach(h => rows.push({ dim: label, group: g.label || g.key, month: h.month, kind: "History", parPct: h.parPct, par: h.par, os: h.os }));
                (g.forecast && g.forecast.base || []).forEach((b, i) => {
                    const best = g.forecast.best[i], stress = g.forecast.stress[i];
                    rows.push({ dim: label, group: g.label || g.key, month: b.month, kind: "Forecast", parPct: b.parPct, par: b.par, best: best && best.parPct, stress: stress && stress.parPct });
                });
            });
        }
        if (!rows.length) return null;
        const cols = [
            textCol("Dimension", r => r.dim),
            textCol(t("creditreport.risk.colName"), r => r.group),
            textCol(t("creditreport.mr.month"), r => r.month),
            textCol("History / forecast", r => r.kind),
            pctCol("PAR % (base)", r => r.parPct),
            moneyCol("PAR", r => r.par),
            pctCol("PAR % (best)", r => r.best),
            pctCol("PAR % (stress)", r => r.stress)
        ];
        return { name: "ParForecast", title: `${t("creditreport.hub.gForecast")}`, info: [exportedInfo()], cols, rows, freezeCols: 1 };
    }

    // ========================================
    // Orchestrator — a pool of 3 concurrent sheet builders (25+ fetches
    // in total; firing them all at once the way Snapshot All does its 4
    // would be unkind to the backend), one progress bar, one workbook.
    // ========================================
    const SHEET_JOBS = [
        () => sheetDailyMonitoring("/api/creditreport/summary", "DailyMonitoring_Branch", t("creditreport.hub.tileBranch"), "branch", branchGroups()),
        () => sheetDailyMonitoring("/api/creditreport/byco", "DailyMonitoring_Officer", t("creditreport.hub.tileOfficer"), "name", officerGroups()),
        () => sheetDailyMonitoring("/api/creditreport/byproduct", "DailyMonitoring_Product", t("creditreport.hub.tileProduct"), "product", productLikeGroups()),
        () => sheetDailyMonitoring("/api/creditreport/bylocation", "DailyMonitoring_Location", t("creditreport.hub.tileLocation"), "location", productLikeGroups(), t("creditreport.pi.otherAddress")),
        sheetCustomerRisk,
        sheetEarlyWarning,
        sheetCustomerPrediction,
        sheetRootCause,
        sheetRecoveryActions,
        sheetsNplMovement, // returns an array of 5 sheets
        ...RECOVERY_DIMS.map(([dim, label]) => () => sheetRecovery(dim, label)),
        ...RISK_DIMS.map(([dim, label]) => () => sheetRisk(dim, label)),
        sheetMeetingTeamSplit,
        sheetPortfolioComposition,
        sheetForecast
    ];

    async function runPool(jobs, size, onProgress) {
        const sheets = [];
        let next = 0, done = 0;
        async function worker() {
            while (next < jobs.length) {
                const i = next++;
                try {
                    const result = await jobs[i]();
                    if (Array.isArray(result)) sheets.push(...result.filter(Boolean));
                    else if (result) sheets.push(result);
                } catch (e) {
                    console.error("[export all] sheet failed:", e);
                }
                done++;
                onProgress && onProgress(done, jobs.length);
            }
        }
        await Promise.all(Array.from({ length: Math.min(size, jobs.length) }, worker));
        return sheets;
    }

    function fileName() {
        const d = new Date();
        const pad = n => String(n).padStart(2, "0");
        return `CreditReport_All_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}.xlsx`;
    }

    // The message the user actually sees on a failure — on a phone
    // there's no console to check, so the real error (CDN blocked,
    // a backend 500, …) rides along in the toast itself rather than
    // only going to console.error.
    function failToast(reason, e) {
        const detail = e && e.message ? ` (${reason}: ${e.message})` : reason ? ` (${reason})` : "";
        toast(`${t("creditreport.export.failed")}${detail}`, "error");
    }

    async function exportAll() {
        if (typeof window.ArrExport === "undefined") { failToast("ArrExport"); return; }
        if (typeof showAppLoading === "function") showAppLoading(t("creditreport.hub.exportAllRunning"), { progress: true, key: "cr:export-all" });

        // Two phases, reported separately: gathering every report's own
        // data (each sheet builder already swallows its own fetch
        // errors — see runPool — so this only catches something truly
        // unexpected), then handing it all to ArrExport/ExcelJS to
        // actually write the file (loaded from a CDN the first time
        // it's used — a network/CDN block shows up here, the same way
        // it would on any of the 4 Daily Monitoring reports' own Excel
        // export).
        let sheets;
        try {
            sheets = await runPool(SHEET_JOBS, 3, (done, total) => {
                window.setAppLoadingProgress && window.setAppLoadingProgress((done / total) * 70, t("creditreport.hub.exportAllRunning"));
            });
        } catch (e) {
            console.error("[export all] gathering report data failed:", e);
            failToast("data", e);
            if (typeof hideAppLoading === "function") hideAppLoading();
            return;
        }
        if (!sheets.length) {
            failToast("no data");
            if (typeof hideAppLoading === "function") hideAppLoading();
            return;
        }
        try {
            window.setAppLoadingProgress && window.setAppLoadingProgress(75, t("creditreport.export.creatingExcel"));
            await window.ArrExport.excel({
                filename: fileName(),
                freezeCols: 1,
                sheets,
                onProgress: f => window.setAppLoadingProgress && window.setAppLoadingProgress(75 + f * 25, t("creditreport.export.wait"))
            });
            toast(t("creditreport.hub.exportAllDone", { n: sheets.length }), "success");
        } catch (e) {
            console.error("[export all] workbook build failed:", e);
            failToast("xlsx", e);
        } finally {
            if (typeof hideAppLoading === "function") hideAppLoading();
        }
    }

    window.crExportAll = exportAll;
})();
