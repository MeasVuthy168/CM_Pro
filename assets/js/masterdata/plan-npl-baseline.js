// ========================================
// Master Data > Monthly Plan — NPL Collected: HQ's year-to-date figure
// (admin only, approved 23/11/2026).
// NBC Overdue's COLL_PRI_PER is month to date and COLL_PRI_END is a loan's
// whole life, so the year to date is the year's months added up. The app
// only keeps those since 23/11/2026: for the months before, an admin
// enters HQ's "NPL COLLECT Y2D_PRN" per branch through a month end, and
// the reports add every later month themselves.
//   GET|PUT /api/admin/credit-intelligence/npl-collect-baseline
// Branches come from the Monthly Plan's own branch list.
// Uses plan.js's t(), mpHeaders(), mpNotify(), mpEsc(), mpParse(),
// mpThisMonth() and mpPrevMonth().
// ========================================

const NB_EP = API.BASE_URL + "/api/admin/credit-intelligence/npl-collect-baseline";
const nb = { month: "", branches: [], values: {}, saved: null };

function nbMoney(n) {
    return "$" + Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

async function nbLoad() {
    const box = document.getElementById("nbTable");
    const meta = document.getElementById("nbUpdated");
    const year = nb.month.slice(0, 4);
    try {
        const [plan, base] = await Promise.all([
            fetch(`${API.BASE_URL}/api/admin/monthly-plan?month=${encodeURIComponent(nb.month)}&dim=branch`, { headers: mpHeaders() }).then(r => r.json()),
            fetch(`${NB_EP}?year=${year}`, { headers: mpHeaders() }).then(r => r.json())
        ]);
        nb.branches = ((plan && plan.options) || []).map(o => o.key);
        nb.saved = base && base.ok ? base.baseline : null;
        // The saved figure of this year: its own month, its own amounts.
        if (nb.saved && nb.saved.month) {
            nb.month = nb.saved.month;
            document.getElementById("nbMonth").value = nb.month;
        }
        nb.values = {};
        const saved = (nb.saved && nb.saved.branches) || {};
        for (const b of new Set([...nb.branches, ...Object.keys(saved)])) {
            nb.values[b] = saved[b] !== undefined ? String(saved[b]) : "";
        }
        meta.textContent = nb.saved && nb.saved.updatedBy
            ? t("masterdata.plan.updatedBy", { user: nb.saved.updatedBy, at: new Date(nb.saved.updatedAt).toLocaleString("en-GB", { timeZone: "Asia/Phnom_Penh", hour12: false }).slice(0, 17) })
            : t("masterdata.plan.nplBaseNotSet");
        nbRender();
    } catch (e) {
        console.error("NPL baseline load failed:", e);
        box.innerHTML = "";
        meta.textContent = t("masterdata.plan.loadFailed");
    }
}

function nbRender() {
    const rows = Object.keys(nb.values);
    const total = rows.reduce((s, b) => s + (Number(mpParse(nb.values[b])) || 0), 0);
    document.getElementById("nbTable").innerHTML =
        `<thead><tr><th>${mpEsc(t("masterdata.plan.tabBranch"))}</th><th>${mpEsc(t("masterdata.plan.nplBaseCol"))}</th></tr></thead>` +
        `<tbody>${rows.map(b => {
            const n = mpParse(nb.values[b]);
            const bad = n !== null && (Number.isNaN(n) || n < 0);
            return `<tr><td>${mpEsc(b)}</td><td><input class="mp-in${bad ? " mp-bad" : ""}" data-nb="${mpEsc(b)}" value="${mpEsc(nb.values[b])}" inputmode="decimal" autocomplete="off" placeholder="—"></td></tr>`;
        }).join("")}</tbody>` +
        `<tfoot><tr><td>${mpEsc(t("common.total"))}</td><td id="nbTotal">${nbMoney(total)}</td></tr></tfoot>`;
}

async function nbSave() {
    const branches = {};
    for (const [b, v] of Object.entries(nb.values)) {
        const n = mpParse(v);
        if (n === null) continue;
        if (Number.isNaN(n) || n < 0) { mpNotify(t("masterdata.plan.invalid"), "error"); return; }
        branches[b] = n;
    }
    const btn = document.getElementById("nbSave");
    btn.disabled = true;
    try {
        const res = await fetch(NB_EP, {
            method: "PUT",
            headers: mpHeaders(true),
            body: JSON.stringify({ year: nb.month.slice(0, 4), month: nb.month, branches })
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body.ok) throw new Error(body.message || `HTTP ${res.status}`);
        mpNotify(t("masterdata.plan.nplBaseSaved"), "success");
        await nbLoad();
    } catch (e) {
        console.error("NPL baseline save failed:", e);
        mpNotify(t("masterdata.plan.saveFailed"), "error");
    } finally {
        btn.disabled = false;
    }
}

(function nbInit() {
    const monthEl = document.getElementById("nbMonth");
    if (!monthEl) return;
    // Default: the last closed month.
    nb.month = mpPrevMonth(mpThisMonth());
    monthEl.value = nb.month;
    monthEl.addEventListener("change", () => {
        if (!/^\d{4}-\d{2}$/.test(monthEl.value)) return;
        const yearChanged = monthEl.value.slice(0, 4) !== nb.month.slice(0, 4);
        nb.month = monthEl.value;
        if (yearChanged) nbLoad();
    });
    document.getElementById("nbTable").addEventListener("input", (e) => {
        const el = e.target.closest("input[data-nb]");
        if (!el) return;
        nb.values[el.dataset.nb] = el.value;
        const n = mpParse(el.value);
        el.classList.toggle("mp-bad", n !== null && (Number.isNaN(n) || n < 0));
        const total = Object.values(nb.values).reduce((s, v) => s + (Number(mpParse(v)) || 0), 0);
        const tot = document.getElementById("nbTotal");
        if (tot) tot.textContent = nbMoney(total);
    });
    document.getElementById("nbSave").addEventListener("click", nbSave);
    nbLoad();
})();
