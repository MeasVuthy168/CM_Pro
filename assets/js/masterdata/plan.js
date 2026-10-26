// ========================================
// Master Data > Monthly Plan — ផែនការប្រចាំខែ (admin only)
// The targets the Daily Monitoring reports by Branch / Officer are
// measured against, one month at a time:
//   GET|PUT /api/admin/monthly-plan?month=YYYY-MM&dim=branch|officer
// The table is filled from the server's list of branches / officers
// (plus any planned key no longer in it), edited in place, and
// saved for the whole tab at once. "Copy from last month" and Excel
// import only fill the table — nothing is saved until Save.
// ========================================

const mpUser = (() => {
    try {
        return JSON.parse(localStorage.getItem("loggedInUser") || sessionStorage.getItem("loggedInUser") || "{}");
    } catch (e) {
        return {};
    }
})();
if (String(mpUser.role || "").toLowerCase() !== "admin") location.replace("/CM_Pro/pages/masterdata/index.html");

const t = (key, vars) => {
    let s = window.CMI18n ? CMI18n.t(key) : key;
    for (const [k, v] of Object.entries(vars || {})) s = s.replace(`{${k}}`, v);
    return s;
};

const MP_EP = API.BASE_URL + "/api/admin/monthly-plan";

// Column groups, in table order. A metric the tab doesn't have is skipped.
const MP_GROUPS = [
    {
        label: "masterdata.plan.grpOs",
        metrics: [
            ["osCount", "masterdata.plan.colLoans"],
            ["osClients", "masterdata.plan.colClients"],
            ["osKhr", "masterdata.plan.colKhr"],
            ["osSmall", "masterdata.plan.colSmall"],
            ["osAmount", "masterdata.plan.colOsAmount"]
        ]
    },
    { label: "masterdata.plan.grpDisb", metrics: [["disbCount", "masterdata.plan.colLoans"], ["disbAmount", "masterdata.plan.colAmount"]] },
    { label: "masterdata.plan.grpLos", metrics: [["losCount"]] },
    { label: "masterdata.plan.colNbc", metrics: [["nbcOverduePct"]] },
    { label: "masterdata.plan.colNpl", metrics: [["nplPct"]] },
    { label: "masterdata.plan.colWo", metrics: [["woCollected"]] },
    { label: "masterdata.plan.colRecovery", metrics: [["nplRecovery"]] }
];
// Officer rows are compared with their branch plan on these.
const MP_COMPARE = ["osAmount", "disbAmount"];

const mp = {
    month: "",
    dim: "branch",
    metrics: [],          // [{ key, kind }]
    options: [],          // [{ key, label, id?, branch? }]
    saved: {},            // key -> { metric: number }
    values: {},           // key -> { metric: string } (what the inputs hold)
    branchPlan: {},       // officer tab: the branch plan, for the comparison
    loading: false
};

function mpEsc(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function mpNotify(message, type = "info") {
    if (typeof CMToast !== "undefined" && CMToast.show) CMToast.show({ type, title: message, message: "", duration: 3000 });
    else alert(message);
}

function mpHeaders(json) {
    const h = { Authorization: `Bearer ${API.getToken()}` };
    if (json) h["Content-Type"] = "application/json";
    return h;
}

function mpKind(metric) {
    return (mp.metrics.find(m => m.key === metric) || {}).kind || "amount";
}

// "1,200.5" / "$1200" / "2.5%" -> number, "" -> null
function mpParse(v) {
    const s = String(v ?? "").replace(/[,\s$%]/g, "");
    if (s === "") return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
}

function mpFormat(kind, n) {
    if (n === null || n === undefined || n === "" || Number.isNaN(n)) return "";
    if (kind === "pct") return String(n);
    return Number(n).toLocaleString("en-US", { maximumFractionDigits: kind === "count" ? 0 : 2 });
}

function mpShort(n) {
    if (!Number.isFinite(n)) return "-";
    const a = Math.abs(n);
    if (a >= 1e6) return (n / 1e6).toFixed(2).replace(/\.?0+$/, "") + "M";
    if (a >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "K";
    return mpFormat("amount", n);
}

function mpThisMonth() {
    return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 7);
}

function mpPrevMonth(month) {
    const [y, m] = month.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 2, 1));
    return d.toISOString().slice(0, 7);
}

function mpMonthText(month) {
    const [y, m] = month.split("-");
    return `${m}-${y}`;
}

// ---------- dirty state ----------
function mpRowsFromValues() {
    const out = {};
    for (const [key, row] of Object.entries(mp.values)) {
        const clean = {};
        for (const m of mp.metrics) {
            const n = mpParse(row[m.key]);
            if (n !== null && !Number.isNaN(n)) clean[m.key] = n;
        }
        if (Object.keys(clean).length) out[key] = clean;
    }
    return out;
}

function mpChangedCount() {
    const now = mpRowsFromValues();
    const keys = new Set([...Object.keys(now), ...Object.keys(mp.saved)]);
    let n = 0;
    for (const k of keys) {
        const a = now[k] || {};
        const b = mp.saved[k] || {};
        if (mp.metrics.some(m => (a[m.key] ?? null) !== (b[m.key] ?? null))) n++;
    }
    return n;
}

function mpInvalidCount() {
    let n = 0;
    for (const row of Object.values(mp.values)) {
        for (const m of mp.metrics) {
            const v = mpParse(row[m.key]);
            if (v === null) continue;
            if (Number.isNaN(v) || v < 0 || (m.kind === "pct" && v > 100)) n++;
        }
    }
    return n;
}

function mpIsDirty() {
    return mpChangedCount() > 0;
}

function mpPaintSaveBar() {
    const n = mpChangedCount();
    const bar = document.getElementById("mpSaveBar");
    bar.hidden = n === 0;
    document.getElementById("mpDirtyText").textContent = t("masterdata.plan.unsavedCount", { n });
}

function mpConfirmDiscard() {
    return !mpIsDirty() || window.confirm(t("masterdata.plan.discardConfirm"));
}

// ---------- load ----------
async function mpFetch(month, dim, withOptions) {
    const url = `${MP_EP}?month=${encodeURIComponent(month)}&dim=${dim}${withOptions ? "" : "&options=0"}`;
    const res = await fetch(url, { headers: mpHeaders() });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) throw new Error(body.message || `HTTP ${res.status}`);
    return body;
}

async function mpLoad() {
    mp.loading = true;
    mpState(t("masterdata.plan.loading"));
    document.getElementById("mpTable").innerHTML = "";
    try {
        const [data, branch] = await Promise.all([
            mpFetch(mp.month, mp.dim, true),
            mp.dim === "officer" ? mpFetch(mp.month, "branch", false) : Promise.resolve(null)
        ]);
        mp.metrics = data.metrics || [];
        mp.options = data.options || [];
        mp.saved = data.rows || {};
        mp.branchPlan = branch ? branch.rows || {} : {};
        mp.values = {};
        for (const [key, row] of Object.entries(mp.saved)) {
            mp.values[key] = {};
            for (const m of mp.metrics) {
                if (row[m.key] !== undefined) mp.values[key][m.key] = mpFormat(m.kind, row[m.key]);
            }
        }
        const by = data.updatedBy ? t("masterdata.plan.updatedBy", {
            user: data.updatedBy,
            at: data.updatedAt ? new Date(data.updatedAt).toLocaleString("en-GB", { timeZone: "Asia/Phnom_Penh", hour12: false }).slice(0, 17) : ""
        }) : t("masterdata.plan.notSetYet");
        document.getElementById("mpUpdated").textContent = by;
        mpState("");
        mpPaintFilters();
        mpRender();
    } catch (e) {
        console.error("monthly plan load failed:", e);
        mpState(t("masterdata.plan.loadFailed"));
    } finally {
        mp.loading = false;
        mpPaintSaveBar();
    }
}

function mpState(text) {
    const el = document.getElementById("mpState");
    el.hidden = !text;
    el.textContent = text || "";
}

// ---------- render ----------
function mpGroups() {
    return MP_GROUPS
        .map(g => ({ ...g, metrics: g.metrics.filter(([k]) => mp.metrics.some(m => m.key === k)) }))
        .filter(g => g.metrics.length);
}

// Options plus any planned key the reports no longer list (kept visible
// so its plan isn't silently lost on the next save).
function mpAllRows() {
    const known = new Set(mp.options.map(o => o.key));
    const extra = Object.keys(mp.values).filter(k => !known.has(k))
        .map(k => ({ key: k, label: k, missing: true }));
    return mp.options.concat(extra);
}

function mpVisibleRows() {
    let rows = mpAllRows();
    if (mp.dim !== "officer") return rows;
    const branch = document.getElementById("mpBranchFilter").value;
    const team = document.getElementById("mpTeamFilter").value;
    const q = document.getElementById("mpSearch").value.trim().toLowerCase();
    if (branch) rows = rows.filter(r => (r.branch || "") === branch);
    if (team) rows = rows.filter(r => r.team === team);
    if (q) rows = rows.filter(r => `${r.label} ${r.id || r.key}`.toLowerCase().includes(q));
    return rows;
}

function mpInputCell(key, metric) {
    const kind = mpKind(metric);
    const v = (mp.values[key] || {})[metric] ?? "";
    const n = mpParse(v);
    const bad = n !== null && (Number.isNaN(n) || n < 0 || (kind === "pct" && n > 100));
    return `<td><input class="mp-in${bad ? " mp-bad" : ""}" data-key="${mpEsc(key)}" data-metric="${metric}" value="${mpEsc(v)}" inputmode="${kind === "count" ? "numeric" : "decimal"}" autocomplete="off" placeholder="—"></td>`;
}

function mpSum(rows, metric) {
    let s = 0, any = false;
    for (const r of rows) {
        const n = mpParse((mp.values[r.key] || {})[metric]);
        if (n !== null && !Number.isNaN(n)) { s += n; any = true; }
    }
    return any ? s : null;
}

// The Total row's figure for one column. Counts and amounts add up. A %
// can't: it is weighted by each row's Loan Outstanding plan —
// Σ(% × outstanding) ÷ Σ outstanding — and only when every row shown has
// both, so a partial total never reads as the whole one.
function mpTotal(rows, metric) {
    if (mpKind(metric) !== "pct") return mpSum(rows, metric);
    if (!rows.length) return null;
    let weighted = 0, os = 0;
    for (const r of rows) {
        const v = mp.values[r.key] || {};
        const pct = mpParse(v[metric]);
        const amt = mpParse(v.osAmount);
        if (pct === null || Number.isNaN(pct) || amt === null || Number.isNaN(amt)) return null;
        weighted += pct * amt;
        os += amt;
    }
    return os > 0 ? Math.round((weighted / os) * 100) / 100 : null;
}

// Officer tab: each branch's officers added up next to its branch plan —
// all of them, whatever the team / search filter shows.
function mpBranchOfficers(branch) {
    return mpAllRows().filter(r => (r.branch || "—") === branch);
}

function mpCompareChips(branch, rows = mpBranchOfficers(branch)) {
    return MP_COMPARE.filter(k => mp.metrics.some(m => m.key === k)).map(k => {
        const sum = mpSum(rows, k);
        const plan = (mp.branchPlan[branch] || {})[k];
        const label = t(k === "osAmount" ? "masterdata.plan.grpOs" : "masterdata.plan.grpDisb");
        if (plan === undefined) return `<span class="mp-chip">${mpEsc(label)}: ${mpShort(sum ?? 0)} · ${mpEsc(t("masterdata.plan.noBranchPlan"))}</span>`;
        const same = Math.abs((sum ?? 0) - plan) < 0.005;
        return `<span class="mp-chip ${same ? "mp-chip-ok" : "mp-chip-warn"}">${same ? "✓" : "⚠"} ${mpEsc(label)}: ${mpShort(sum ?? 0)} / ${mpShort(plan)}</span>`;
    }).join("");
}

function mpRender() {
    const groups = mpGroups();
    const cols = groups.flatMap(g => g.metrics.map(([k]) => k));
    const two = groups.some(g => g.metrics.length > 1);
    const nameHead = t(mp.dim === "branch" ? "masterdata.plan.tabBranch" : "masterdata.plan.tabOfficer");

    let head = `<thead><tr><th class="mp-name" ${two ? 'rowspan="2"' : ""}>${mpEsc(nameHead)}</th>`;
    head += groups.map(g => g.metrics.length > 1
        ? `<th class="mp-grp" colspan="${g.metrics.length}"><span>${mpEsc(t(g.label))}</span></th>`
        : `<th ${two ? 'rowspan="2"' : ""}>${mpEsc(t(g.label))}</th>`).join("");
    head += "</tr>";
    if (two) {
        head += "<tr>" + groups.filter(g => g.metrics.length > 1)
            .flatMap(g => g.metrics.map(([, l]) => `<th>${mpEsc(t(l))}</th>`)).join("") + "</tr>";
    }
    head += "</thead>";

    const rows = mpVisibleRows();
    const rowHtml = r => {
        const sub = mp.dim === "officer" ? `<small>${mpEsc(r.id || r.key)}${r.branch ? ` · ${mpEsc(r.branch)}` : ""}</small>` : "";
        const miss = r.missing ? `<small class="mp-missing">${mpEsc(t("masterdata.plan.notInReport"))}</small>` : "";
        return `<tr><td class="mp-name"><b>${mpEsc(r.label)}</b>${sub}${miss}</td>${cols.map(c => mpInputCell(r.key, c)).join("")}</tr>`;
    };

    let body = "";
    if (mp.dim === "officer") {
        const byBranch = new Map();
        rows.forEach(r => {
            const b = r.branch || "—";
            if (!byBranch.has(b)) byBranch.set(b, []);
            byBranch.get(b).push(r);
        });
        for (const [b, list] of byBranch) {
            // The cell spans the row; its content stays in view while the
            // table scrolls sideways.
            body += `<tr class="mp-group"><td colspan="${cols.length + 1}"><div class="mp-group-in"><b>${mpEsc(b)}</b> <span class="mp-group-n">${list.length}</span><div class="mp-chips">${mpCompareChips(b)}</div></div></td></tr>`;
            body += list.map(rowHtml).join("");
        }
    } else {
        body = rows.map(rowHtml).join("");
    }

    const totals = cols.map(c => {
        const s = mpTotal(rows, c);
        return `<td>${s === null ? "—" : mpEsc(mpFormat(mpKind(c), s))}</td>`;
    }).join("");
    const foot = rows.length ? `<tfoot><tr><td class="mp-name"><b>${mpEsc(t("masterdata.plan.total"))}</b></td>${totals}</tr></tfoot>` : "";

    document.getElementById("mpTable").innerHTML = head + `<tbody>${body}</tbody>` + foot;
    document.getElementById("mpTitle").textContent = `${nameHead} · ${t("masterdata.plan.heroTitle")} ${mpMonthText(mp.month)}`;
    if (!rows.length) mpState(t("masterdata.plan.noRows"));
    document.getElementById("mpNoteDim").textContent = t(`masterdata.plan.note_${mp.dim}`);
}

function mpPaintFilters() {
    const box = document.getElementById("mpOfficerFilters");
    box.hidden = mp.dim !== "officer";
    if (mp.dim !== "officer") return;
    const sel = document.getElementById("mpBranchFilter");
    const keep = sel.value;
    const branches = [...new Set(mp.options.map(o => o.branch).filter(Boolean))].sort();
    sel.innerHTML = `<option value="">${mpEsc(t("masterdata.plan.allBranches"))}</option>` +
        branches.map(b => `<option value="${mpEsc(b)}">${mpEsc(b)}</option>`).join("");
    if (branches.includes(keep)) sel.value = keep;
    const team = document.getElementById("mpTeamFilter");
    const keepTeam = team.value;
    team.innerHTML = [["", "masterdata.plan.allTeams"], ["co", "masterdata.plan.teamCo"], ["fsro", "masterdata.plan.teamFsro"]]
        .map(([v, k]) => `<option value="${v}">${mpEsc(t(k))}</option>`).join("");
    team.value = keepTeam;
}

// ---------- editing ----------
document.getElementById("mpTable").addEventListener("input", e => {
    const el = e.target.closest("input.mp-in");
    if (!el) return;
    const { key, metric } = el.dataset;
    if (!mp.values[key]) mp.values[key] = {};
    mp.values[key][metric] = el.value;
    const n = mpParse(el.value);
    const kind = mpKind(metric);
    el.classList.toggle("mp-bad", n !== null && (Number.isNaN(n) || n < 0 || (kind === "pct" && n > 100)));
    mpPaintSaveBar();
    mpPaintTotals();
});

// Thousands separators once the field is left; plain digits while typing.
document.getElementById("mpTable").addEventListener("focusout", e => {
    const el = e.target.closest("input.mp-in");
    if (!el) return;
    const n = mpParse(el.value);
    if (n === null || Number.isNaN(n)) return;
    el.value = mpFormat(mpKind(el.dataset.metric), n);
    mp.values[el.dataset.key][el.dataset.metric] = el.value;
    if (mp.dim === "officer") mpRepaintChips();
});

document.getElementById("mpTable").addEventListener("focusin", e => {
    const el = e.target.closest("input.mp-in");
    if (!el) return;
    el.value = el.value.replace(/,/g, "");
});

// Total row (and the officer chips) without rebuilding the inputs.
function mpPaintTotals() {
    const foot = document.querySelector("#mpTable tfoot tr");
    if (!foot) return;
    const rows = mpVisibleRows();
    const cols = mpGroups().flatMap(g => g.metrics.map(([k]) => k));
    cols.forEach((c, i) => {
        const s = mpTotal(rows, c);
        foot.children[i + 1].textContent = s === null ? "—" : mpFormat(mpKind(c), s);
    });
}

function mpRepaintChips() {
    document.querySelectorAll("#mpTable tr.mp-group").forEach(tr => {
        const b = tr.querySelector("b").textContent;
        tr.querySelector(".mp-chips").innerHTML = mpCompareChips(b);
    });
}

// ---------- save ----------
async function mpSave() {
    if (mpInvalidCount()) {
        mpNotify(t("masterdata.plan.invalid"), "error");
        return;
    }
    const btn = document.getElementById("mpSave");
    btn.disabled = true;
    if (typeof showAppLoading === "function") showAppLoading(t("masterdata.plan.saving"));
    try {
        const res = await fetch(MP_EP, {
            method: "PUT",
            headers: mpHeaders(true),
            body: JSON.stringify({ month: mp.month, dim: mp.dim, rows: mpRowsFromValues() })
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body.ok) throw new Error(body.message || `HTTP ${res.status}`);
        mpNotify(t("masterdata.plan.saved"), "success");
        await mpLoad();
    } catch (e) {
        console.error("monthly plan save failed:", e);
        mpNotify(`${t("masterdata.plan.saveFailed")} ${e.message || ""}`, "error");
    } finally {
        btn.disabled = false;
        if (typeof hideAppLoading === "function") hideAppLoading();
    }
}

// ---------- copy from last month ----------
async function mpCopyPrev() {
    const prev = mpPrevMonth(mp.month);
    try {
        const data = await mpFetch(prev, mp.dim, false);
        const rows = data.rows || {};
        if (!Object.keys(rows).length) {
            mpNotify(t("masterdata.plan.prevEmpty", { month: mpMonthText(prev) }), "info");
            return;
        }
        if (Object.keys(mpRowsFromValues()).length && !window.confirm(t("masterdata.plan.copyConfirm", { month: mpMonthText(prev) }))) return;
        mp.values = {};
        for (const [key, row] of Object.entries(rows)) {
            mp.values[key] = {};
            for (const m of mp.metrics) if (row[m.key] !== undefined) mp.values[key][m.key] = mpFormat(m.kind, row[m.key]);
        }
        mpRender();
        mpPaintSaveBar();
        mpNotify(t("masterdata.plan.copied", { month: mpMonthText(prev) }), "success");
    } catch (e) {
        console.error(e);
        mpNotify(t("masterdata.plan.loadFailed"), "error");
    }
}

// ---------- Excel ----------
// Columns: ID/key, name, (branch), then one per metric headed
// "<label> [metricKey]" — the [key] is what import matches on.
function mpMetricLabel(metric) {
    for (const g of MP_GROUPS) {
        for (const [k, l] of g.metrics) {
            if (k === metric) return l ? `${t(g.label)} · ${t(l)}` : t(g.label);
        }
    }
    return metric;
}

async function mpExport() {
    try {
        const wb = await ArrExport.workbook();
        const ws = wb.addWorksheet(mp.dim);
        const metrics = mpGroups().flatMap(g => g.metrics.map(([k]) => k));
        const head = ["ID", t("masterdata.plan.colName")]
            .concat(mp.dim === "officer" ? [t("masterdata.plan.tabBranch")] : [])
            .concat(metrics.map(k => `${mpMetricLabel(k)} [${k}]`));
        ws.addRow([`${t("masterdata.plan.heroTitle")} ${mpMonthText(mp.month)} · ${mp.dim}`]);
        ws.addRow(head);
        const hr = ws.getRow(2);
        hr.font = { bold: true };
        hr.alignment = { wrapText: true, vertical: "middle", horizontal: "center" };
        hr.eachCell(c => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE7ECF5" } }; });
        mpAllRows().forEach(r => {
            const v = mp.values[r.key] || {};
            ws.addRow([r.key, r.label].concat(mp.dim === "officer" ? [r.branch || ""] : [])
                .concat(metrics.map(k => { const n = mpParse(v[k]); return n === null || Number.isNaN(n) ? null : n; })));
        });
        ws.columns.forEach((c, i) => { c.width = i === 1 ? 26 : i === 0 ? 14 : 16; });
        ws.views = [{ state: "frozen", xSplit: 2, ySplit: 2 }];
        await ArrExport.save(wb, `MonthlyPlan_${mp.month.replace("-", "")}_${mp.dim}.xlsx`);
    } catch (e) {
        console.error(e);
        mpNotify(t("masterdata.plan.excelFailed"), "error");
    }
}

async function mpImport(file) {
    try {
        await ArrExport.workbook();
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(await file.arrayBuffer());
        const ws = wb.worksheets[0];
        if (!ws) throw new Error("empty");
        // Header row: the first with "[metricKey]" cells.
        let headRow = null, cols = {};
        ws.eachRow((row, n) => {
            if (headRow) return;
            const found = {};
            row.eachCell((cell, c) => {
                const m = /\[([a-zA-Z]+)\]\s*$/.exec(String(cell.text || ""));
                if (m && mp.metrics.some(x => x.key === m[1])) found[m[1]] = c;
            });
            if (Object.keys(found).length) { headRow = n; cols = found; }
        });
        if (!headRow) throw new Error(t("masterdata.plan.importNoHeader"));

        const known = new Map(mpAllRows().map(r => [String(r.key), r.key]));
        const norm = k => mp.dim === "officer" ? String(k).replace(/^0+/, "") : String(k);
        let matched = 0;
        const unknown = [];
        ws.eachRow((row, n) => {
            if (n <= headRow) return;
            const raw = String(row.getCell(1).text || "").trim();
            if (!raw) return;
            const key = known.get(norm(raw));
            if (!key) { unknown.push(raw); return; }
            mp.values[key] = mp.values[key] || {};
            for (const [metric, c] of Object.entries(cols)) {
                const cell = row.getCell(c);
                const v = cell.value && typeof cell.value === "object" && "result" in cell.value ? cell.value.result : cell.value;
                mp.values[key][metric] = v === null || v === undefined || v === "" ? "" : mpFormat(mpKind(metric), mpParse(v));
            }
            matched++;
        });
        mpRender();
        mpPaintSaveBar();
        mpNotify(t("masterdata.plan.imported", { n: matched }) + (unknown.length ? " " + t("masterdata.plan.importUnknown", { n: unknown.length, list: unknown.slice(0, 5).join(", ") }) : ""), unknown.length ? "warning" : "success");
    } catch (e) {
        console.error(e);
        mpNotify(`${t("masterdata.plan.importFailed")} ${e.message || ""}`, "error");
    }
}

// ---------- wiring ----------
document.getElementById("mpMonth").value = mp.month = mpThisMonth();
document.getElementById("mpMonth").addEventListener("change", e => {
    if (!e.target.value) { e.target.value = mp.month; return; }
    if (!mpConfirmDiscard()) { e.target.value = mp.month; return; }
    mp.month = e.target.value;
    mpLoad();
});
document.querySelectorAll(".mp-tab").forEach(btn => btn.addEventListener("click", () => {
    if (btn.dataset.dim === mp.dim || mp.loading || !mpConfirmDiscard()) return;
    document.querySelectorAll(".mp-tab").forEach(b => b.classList.toggle("active", b === btn));
    mp.dim = btn.dataset.dim;
    mpLoad();
}));
document.getElementById("mpBranchFilter").addEventListener("change", mpRender);
document.getElementById("mpTeamFilter").addEventListener("change", mpRender);
document.getElementById("mpSearch").addEventListener("input", mpRender);
document.getElementById("mpSave").addEventListener("click", mpSave);
document.getElementById("mpCancel").addEventListener("click", () => { if (mpConfirmDiscard()) mpLoad(); });
document.getElementById("mpCopyPrev").addEventListener("click", mpCopyPrev);
document.getElementById("mpExport").addEventListener("click", mpExport);
document.getElementById("mpImportBtn").addEventListener("click", () => document.getElementById("mpImport").click());
document.getElementById("mpImport").addEventListener("change", e => {
    const f = e.target.files[0];
    e.target.value = "";
    if (f) mpImport(f);
});
window.addEventListener("beforeunload", e => {
    if (mpIsDirty()) { e.preventDefault(); e.returnValue = ""; }
});
window.addEventListener("cm-language-changed", () => { mpPaintFilters(); mpRender(); });

mpLoad();

// ========================================
// COMPONENT LOADER (topbar + bottomnav)
// ========================================
let mpLoaded = 0;
async function loadComponent(id, file) {
    try {
        const useCache = id !== "topbar-container";
        const cached = useCache ? sessionStorage.getItem("comp_" + id) : null;
        if (cached) {
            document.getElementById(id).innerHTML = cached;
        } else {
            const response = await fetch(file);
            const html = await response.text();
            document.getElementById(id).innerHTML = html;
            if (useCache) sessionStorage.setItem("comp_" + id, html);
        }
        if (id === "topbar-container") {
            initTopbar({ titleKey: "masterdata.hub.plan", showBack: true, showLogo: false, showProfile: false });
            const backBtn = document.getElementById("topbarBackBtn");
            if (backBtn) {
                backBtn.onclick = () => {
                    if (mpConfirmDiscard()) cmNav.back("/CM_Pro/pages/masterdata/index.html");
                };
            }
        }
    } catch (error) {
        console.error(error);
    } finally {
        mpLoaded++;
        if (mpLoaded >= 2) {
            setTimeout(() => {
                if (typeof hideGlobalSplash === "function") hideGlobalSplash();
            }, 300);
        }
    }
}
loadComponent("topbar-container", "/CM_Pro/components/topbar.html");
loadComponent("bottomnav-container", "/CM_Pro/components/bottomnav.html");

// ========================================
// OFFLINE DETECT
// ========================================
function mpUpdateOnline() {
    const el = document.getElementById("offlineBanner");
    if (el) el.style.display = navigator.onLine ? "none" : "block";
}
window.addEventListener("online", mpUpdateOnline);
window.addEventListener("offline", mpUpdateOnline);
mpUpdateOnline();

setTimeout(() => {
    if (typeof loadNotificationBadge === "function") loadNotificationBadge();
}, 500);
