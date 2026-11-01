// ========================================
// Credit Report hub — "Export All (Excel)"
// One workbook, one sheet per report, straight from each report's own
// endpoint (no page needs to be open) — every branch/officer/product/
// location/customer/loan row, not just what's on screen. Reuses the
// same multi-sheet engine the 4 Daily Monitoring reports already use
// (ArrExport.excel, see arrears-export.js) rather than reinventing a
// workbook writer; "limit"/"top"/"cause" params that narrow a report's
// own default view are all overridden here for full detail, per each
// page's own JS (cpExport/rcExport/crkExport/nplExport…). Early
// Warning is left out (owner request — its own export is already big).
// The 4 Daily Monitoring sheets (Branch/Officer/Product/Location) are
// titled and dated like the report itself and carry last month (and,
// for Branch/Officer, the Monthly Plan) merged into every section as
// extra columns, "like in app" (owner request 01/11/2026) — Arrear T24
// is left out of them, a live-only figure that doesn't belong in a
// downloaded file.
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
    // Same wrapper as safeNum/safeText, for a column's `style` getter: a
    // thrown error (or no style to give) just means no colour, never a
    // failed cell.
    function safeStyle(get) {
        return r => { try { return get(r) || null; } catch (e) { return null; } };
    }
    const textCol = (label, get) => ({ label, type: "text", value: safeText(get) });
    const intCol = (label, get) => ({ label, type: "int", numFmt: "#,##0", value: safeNum(get) });
    const moneyCol = (label, get) => ({ label, type: "num", numFmt: "#,##0", value: safeNum(get) });
    const pctCol = (label, get) => ({ label, type: "num", numFmt: "0.00%", value: safeNum(get) });

    // Same fields CRLastMonth.cell() (cr-last-month.js) treats as "risk"
    // figures, where a (+/-) going DOWN is the good direction — kept as
    // its own copy here since cr-last-month.js doesn't export it and
    // this file builds plain Excel columns, not live table cells.
    const RISK = /^(parT24|parT24Area|parT24ByClass|parT24AreaByClass|nbcOverdue|nbcOverdueArea|writeOff\.(balanceWO|wo)\.|writeOffOwn\.(balanceWO|wo)\.|writeOffArea\.(balanceWO|wo)\.)/;
    // Same green/amber/red the on-screen table uses for Achieved % / the
    // (+/-) columns (cr-table.js's planCell, cr-last-month.js's cell).
    const GOOD = "#0A7A35", WARN = "#B26A00", BAD = "#C0392B";
    // The Total row's own fill, same convention cr-export.js's own
    // single-page Excel export already uses for it.
    const TOTAL_FILL = "#FFF4C2";

    // A Daily-Monitoring-style field: {key, label, money|pct, planKey?,
    // ceiling?} against an item object (crSections()'s own field shape,
    // reused as-is from each report page rather than redefined).
    // planKey, where set, names the matching Monthly Plan metric
    // (ci-plan.js's own METRICS keys); ceiling marks a figure whose
    // plan is a maximum (PAR %/NPL %), compared as actual-minus-plan
    // rather than an achieved %.
    function fieldCol(f) {
        const get = r => getPath(r, f.key);
        if (f.pct) return pctCol(f.label, get);
        if (f.money) return moneyCol(f.label, get);
        return intCol(f.label, get);
    }

    // One section's fields, "like in app" (the on-screen report's own
    // Plan-vs-Actual and Last Month tables: a lane per comparison, that
    // lane's own fields underneath it — crBuildThead()/crPlanFields()/
    // CRLastMonth.expand() laid out the same way, just always-on rather
    // than a mode to switch between). Lane order: Plan, Last Month
    // (its own value), Actual, Achieved (or ± for a ceiling figure —
    // PAR %/NPL %, where the plan is a maximum), (+/-) vs Last Month —
    // Plan and Achieved only for the fields in this section that have a
    // planKey (not every field does; Product/Location sections have
    // none). Comparison data rides on the row itself (`row.lastMonth`,
    // `row.planVs`), attached once per sheet in sheetDailyMonitoring()
    // below, not refetched per field.
    function sectionCols(fields) {
        const cols = [];
        const lanes = [];
        const planFields = fields.filter(f => f.planKey);
        const anyCeiling = planFields.some(f => f.ceiling);

        // ---- Plan ----
        if (planFields.length) {
            const planCols = planFields.map(f => {
                const kindCol = f.ceiling ? pctCol : (f.money ? moneyCol : intCol);
                return kindCol(f.label, r => ((r.planVs || {})[f.planKey] || {}).plan);
            });
            cols.push(...planCols);
            lanes.push({ label: t(anyCeiling ? "creditreport.plan.planMax" : "creditreport.plan.plan"), span: planCols.length });
        }

        // ---- Last Month (its own value) — a light-blue tint, same as
        // the on-screen table's own cr-lm-value, so it reads as "the
        // other" comparison next to Actual's gold. ----
        const lmCols = fields.map(f => {
            const kindCol = f.pct ? pctCol : f.money ? moneyCol : intCol;
            return { ...kindCol(f.label, r => getPath(r.lastMonth, f.key)), tone: "past" };
        });
        cols.push(...lmCols);
        lanes.push({ label: t("creditreport.lastMonth.col"), span: lmCols.length, tone: "past" });

        // ---- Actual — the figure that matters most on this sheet,
        // tinted gold in its header and data cells, same highlight the
        // on-screen table gives its own Actual / Last-Month "now" lane
        // (cr-pv-cur / cr-lm-cur in cr-table.css). ----
        const actualCols = fields.map(f => ({ ...fieldCol(f), tone: "cur" }));
        cols.push(...actualCols);
        lanes.push({ label: t("creditreport.plan.actual"), span: actualCols.length, tone: "cur" });

        // ---- Achieved (vs Plan) — green / amber / red, same
        // thresholds as the on-screen table's own planCell(). ----
        if (planFields.length) {
            const achCols = planFields.map(f => {
                const raw = f.ceiling
                    ? r => {
                        const p = ((r.planVs || {})[f.planKey] || {}).plan, a = getPath(r, f.key);
                        return (p === null || p === undefined || a === null || a === undefined) ? null : a - p;
                    }
                    : r => {
                        const m = (r.planVs || {})[f.planKey] || {};
                        return (m.plan && m.actual !== null && m.actual !== undefined) ? m.actual / m.plan : null;
                    };
                const style = f.ceiling
                    ? safeStyle(r => { const v = raw(r); return v === null ? null : { color: v < 0 ? GOOD : BAD }; })
                    : safeStyle(r => {
                        const v = raw(r);
                        if (v === null) return null;
                        const redBelow = String(f.planKey).startsWith("disb") ? 0.7 : 0.8;
                        return { color: v >= 1 ? GOOD : v >= redBelow ? WARN : BAD };
                    });
                return { ...pctCol(f.label, raw), style };
            });
            cols.push(...achCols);
            lanes.push({ label: anyCeiling ? "±" : t("creditreport.plan.ach"), span: achCols.length });
        }

        // ---- (+/-) vs Last Month — green when it moved the good way,
        // red the other, same risk-aware direction as the on-screen
        // table's own CRLastMonth.cell(). ----
        const diffCols = fields.map(f => {
            const raw = r => {
                const a = getPath(r, f.key), lm = getPath(r.lastMonth, f.key);
                return (a === null || a === undefined || lm === null || lm === undefined) ? null : a - lm;
            };
            const kindCol = f.pct ? pctCol : f.money ? moneyCol : intCol;
            const style = safeStyle(r => {
                const v = raw(r);
                if (!v) return null;
                const good = RISK.test(f.key) ? v < 0 : v > 0;
                return { color: good ? GOOD : BAD };
            });
            return { ...kindCol(f.label, raw), style };
        });
        cols.push(...diffCols);
        lanes.push({ label: "(+/-)", span: diffCols.length });

        return { cols, lanes };
    }

    // Identity column + groups of fields -> {cols, groups} for
    // ArrExport (a leading, ungrouped identity column, then each
    // section under its own spanning header, each with its own lane
    // row — Plan/Last Month/Actual/Achieved/(+/-) — underneath).
    // isTotal(row), where given, gold-fills and bolds the Total row
    // across every column, same convention cr-export.js's single-page
    // export already uses — a column's own conditional colour (Achieved
    // / (+/-)) still shows through on top of it.
    function groupedCols(identityLabel, identityGet, groups, isTotal) {
        const cols = [textCol(identityLabel, identityGet)];
        const colGroups = [{ span: 1 }];
        groups.forEach(g => {
            const { cols: gcols, lanes } = sectionCols(g.fields);
            cols.push(...gcols);
            colGroups.push({ label: g.label, span: gcols.length, groups: lanes });
        });
        const withTotal = isTotal ? cols.map(c => ({
            ...c,
            style: (row, i) => {
                const own = c.style ? c.style(row, i) : null;
                let total; try { total = isTotal(row); } catch (e) { total = false; }
                return total ? { fill: TOTAL_FILL, bold: true, color: own && own.color } : own;
            }
        })) : cols;
        return { cols: withTotal, groups: colGroups };
    }

    // planKey set only on the "total" (PAR %) and "nonPerformingLoan"
    // (NPL %) rows, and only when `withPlan` (Branch and Officer's Own
    // figures; Product, Location and Officer's Area have no plan).
    function crGroupPct(prefix, label, planKey) {
        return { label, fields: [
            { key: `${prefix}.count`, label: "#" },
            { key: `${prefix}.value`, label: t("creditreport.detail.colValue") },
            { key: `${prefix}.parPct`, label: t("creditreport.detail.colParPct"), pct: true, planKey, ceiling: true }
        ] };
    }

    // ========================================
    // 1-4: Daily Monitoring (Branch / Officer / Product / Location) —
    // the same /api/creditreport/{summary,byco,byproduct,bylocation}
    // endpoints and column layout as RepDetailby{Branch,CO,Product,
    // Location}.js's own crSections(), fetched directly instead of read
    // off that page's on-screen table. Arrear T24 ("Balance Loan at
    // Risk") is left out — owner: it only ever reflects whatever the
    // live T24 feed showed, never a true historical or planned figure,
    // so it doesn't belong in a downloaded file.
    // ========================================
    function nbcOverdueGroups(prefix, totalKey, withPlan) {
        const pk = key => (withPlan ? key : undefined);
        return [
            crGroupPct(`${prefix}.minor`, t("creditreport.detail.classMinorDefault")),
            crGroupPct(`${prefix}.specialMention`, t("creditreport.detail.classSpecialMention")),
            crGroupPct(`${prefix}.subStandard`, t("creditreport.detail.classSubStandardHyphen")),
            crGroupPct(`${prefix}.doubtful`, t("creditreport.detail.classDoubtful")),
            crGroupPct(`${prefix}.loss`, t("creditreport.detail.classLoss")),
            crGroupPct(`${prefix}.majorDefault`, t("creditreport.detail.classMajorDefault")),
            crGroupPct(`${prefix}.nonPerformingLoan`, t("creditreport.detail.classNonPerformingLoan"), pk("nplPct")),
            crGroupPct(`${prefix}.${totalKey}`, t("creditreport.detail.classTotalNbcOverdue"), pk("nbcOverduePct"))
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
                { key: "loanOutstanding.loan", label: t("creditreport.detail.colLoanHash"), planKey: "osCount" },
                { key: "loanOutstanding.client", label: t("creditreport.detail.colClient"), planKey: "osClients" },
                { key: "loanOutstanding.value", label: t("creditreport.detail.colValue"), money: true, planKey: "osAmount" }
            ] },
            { label: t("creditreport.detail.sectionKhr"), fields: [{ key: "osMix.khr", label: t("creditreport.detail.colValue"), money: true }] },
            { label: t("creditreport.detail.sectionSmall"), fields: [{ key: "osMix.small", label: t("creditreport.detail.colValue"), money: true }] },
            { label: t("creditreport.detail.sectionDisburse"), fields: [
                { key: "loanDisburse.loan", label: t("creditreport.detail.colLoanHash"), planKey: "disbCount" },
                { key: "loanDisburse.value", label: t("creditreport.detail.colValue"), money: true, planKey: "disbAmount" }
            ] },
            { label: t("creditreport.detail.sectionLos"), fields: [{ key: "loanLos.loan", label: t("creditreport.detail.colLoanHash") }] },
            ...nbcOverdueGroups("nbcOverdue", "total", true),
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
            ...nbcOverdueGroups("nbcOverdue", "total", false),
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
                { key: "loanOutstanding.loan", label: t("creditreport.detail.colLoanHash"), planKey: "osCount" },
                { key: "loanOutstanding.client", label: t("creditreport.detail.colClient"), planKey: "osClients" },
                { key: "loanOutstanding.value", label: t("creditreport.detail.colValue"), money: true, planKey: "osAmount" }
            ] },
            { label: t("creditreport.detail.sectionDisburse") + " — Area", fields: [
                { key: "loanDisburseArea.loan", label: t("creditreport.detail.colLoanHash") },
                { key: "loanDisburseArea.value", label: t("creditreport.detail.colValue"), money: true }
            ] },
            { label: t("creditreport.detail.sectionDisburse") + " — Own", fields: [
                { key: "loanDisburse.loan", label: t("creditreport.detail.colLoanHash"), planKey: "disbCount" },
                { key: "loanDisburse.value", label: t("creditreport.detail.colValue"), money: true, planKey: "disbAmount" }
            ] },
            ...nbcOverdueGroups("nbcOverdueArea", "total", false),
            ...nbcOverdueGroups("nbcOverdue", "totalOwn", true),
            ...writeOffGroups("writeOffArea"),
            ...writeOffGroups("writeOffOwn")
        ];
    }

    // The last saved Daily History day on or before last month's end
    // (cr-last-month.js's own CRLastMonth.load(), shared with the 4
    // Daily Monitoring reports' own "Comparison: Last Month" — same
    // cutoff rule, same cache), unfiltered (every branch/officer/
    // product/location at once, matching the live sheet). `day.items`
    // / `day.total` are the same shape as the live {items,total}.
    async function lastMonthDay(historyPath, toDate) {
        if (!toDate || typeof window.CRLastMonth === "undefined") return null;
        try {
            const info = await CRLastMonth.load({ endpoint: historyPath, token: token(), toDate });
            return info && info.day ? info : null;
        } catch (e) {
            console.error(`[export all] last month ${historyPath} failed:`, e);
            return null;
        }
    }

    const dmy = iso => { const [y, m, d] = String(iso || "").split("-"); return y && m && d ? `${d}-${m}-${y}` : ""; };

    // One Daily Monitoring report, "like in app": a single sheet,
    // titled and dated the way the report's own page is, with last
    // month (and, for Branch/Officer, the Monthly Plan) merged into
    // every section as extra columns rather than separate sheets —
    // owner request 01/11/2026.
    //   planPath        /plan-vs-actual or /officer-plan-vs-actual, or
    //                    null for Product/Location (no plan exists)
    //   planMatchField   the live row's own field to match the plan
    //                    response's rows by — "branch" for Branch,
    //                    "id" for Officer (officer-plan-vs-actual's own
    //                    rows name their match field "branch" too, but
    //                    it holds the officer id there — ci-plan.js's
    //                    quirk, not this file's)
    async function sheetDailyMonitoring(opts) {
        const { path, historyPath, planPath, planMatchField, name, title, identityKey, groups, otherLabel } = opts;
        const d = await get(path, {});
        if (!d || !Array.isArray(d.items)) return [];
        const totalLabel = t("common.total");
        const toRows = (items, total) => (total && typeof total === "object" ? [...items, { ...total, [identityKey]: totalLabel }] : items);
        let rows = toRows(d.items, d.total);

        const lm = await lastMonthDay(historyPath, d.toDate);
        if (lm && lm.day) {
            const lmByKey = new Map(toRows(lm.day.items || [], lm.day.total).map(r => [String(r[identityKey]), r]));
            rows = rows.map(r => ({ ...r, lastMonth: lmByKey.get(String(r[identityKey])) || null }));
        }

        let planInfo = null;
        if (planPath) {
            const pd = await get(planPath, {});
            if (pd && Array.isArray(pd.rows)) {
                planInfo = pd;
                const byMatch = new Map(pd.rows.filter(r => r && r.branch !== undefined).map(r => [String(r.branch), r.metrics]));
                const totalMetrics = pd.total && pd.total.metrics ? pd.total.metrics : null;
                rows = rows.map(r => {
                    if (r[identityKey] === totalLabel) return { ...r, planVs: totalMetrics };
                    const key = r[planMatchField];
                    return { ...r, planVs: key !== undefined ? byMatch.get(String(key)) || null : null };
                });
            }
        }

        const { cols, groups: colGroups } = groupedCols(
            t("creditreport.detail.branch"),
            r => r[identityKey] || (otherLabel || "—"),
            groups,
            r => r[identityKey] === totalLabel
        );
        const info = [
            d.toDate ? t("creditreport.tblhead.asOf", { date: dmy(d.toDate) }) : "",
            lm && lm.date ? `${t("creditreport.lastMonth.col")}: ${dmy(lm.date)}` : "",
            planInfo && planInfo.month ? t("creditreport.plan.noteMonth", { month: planInfo.month.split("-").reverse().join("-"), from: dmy(planInfo.fromDate), to: dmy(planInfo.toDate), done: planInfo.daysDone, days: planInfo.daysInMonth }) : "",
            exportedInfo()
        ].filter(Boolean);
        return [{ name, title, info, cols, groups: colGroups, rows, freezeCols: 1 }];
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
    const dmTitle = tile => `${t("creditreport.hub.sectionDaily")} — ${t(tile)}`;
    const SHEET_JOBS = [
        () => sheetDailyMonitoring({
            path: "/api/creditreport/summary", historyPath: "/api/creditreport/summary/history",
            planPath: "/api/creditreport/plan-vs-actual", planMatchField: "branch",
            name: "DailyMonitoring_Branch", title: dmTitle("creditreport.hub.tileBranch"), identityKey: "branch", groups: branchGroups()
        }),
        () => sheetDailyMonitoring({
            path: "/api/creditreport/byco", historyPath: "/api/creditreport/byco/history",
            planPath: "/api/creditreport/officer-plan-vs-actual", planMatchField: "id",
            name: "DailyMonitoring_Officer", title: dmTitle("creditreport.hub.tileOfficer"), identityKey: "name", groups: officerGroups()
        }),
        () => sheetDailyMonitoring({
            path: "/api/creditreport/byproduct", historyPath: "/api/creditreport/byproduct/history",
            planPath: null, planMatchField: null,
            name: "DailyMonitoring_Product", title: dmTitle("creditreport.hub.tileProduct"), identityKey: "product", groups: productLikeGroups()
        }),
        () => sheetDailyMonitoring({
            path: "/api/creditreport/bylocation", historyPath: "/api/creditreport/bylocation/history",
            planPath: null, planMatchField: null,
            name: "DailyMonitoring_Location", title: dmTitle("creditreport.hub.tileLocation"), identityKey: "location", groups: productLikeGroups(), otherLabel: t("creditreport.pi.otherAddress")
        }),
        sheetCustomerRisk,
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
