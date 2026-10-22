// ========================================
// Daily Arrears — what a tapped loan can do
// Tap a loan (card, table row, or an LD inside a CIF group) and pick:
//   • Reason Arrear — Work to complete for that loan (openWorkFor), or
//   • Account Blocking — add its CIF to today's blocking list
//     (/api/accblocking/add, the same list as Master Data > Account Blocking).
// Long press starts multi-select: the bar at the bottom opens Reason
// Arrear for the picked loans (‹ › limited to them) or adds all their
// CIFs to the blocking list. Roles that can't build a blocking list
// (Viewer, Viewer_Staff) keep the old tap -> Reason Arrear.
// Uses arrears.js globals: currentRows, openWorkFor, arrCardList,
// tbodyArrears, arrCifTable.
// ========================================

(function () {
    const tr = (key, vars) => (window.CMI18n ? CMI18n.t(key, vars) : key);
    const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const ACTIONS = ["Block", "Unblock", "Update", "Update&Unblock"];
    const ACT_CLASS = { "Block": "block", "Unblock": "unblock", "Update": "update", "Update&Unblock": "updunblock" };
    const BLOCK_ROLES = ["admin", "user", "viewer_manager_a", "viewer_manager_b", "viewer_manager_c"];
    const ROW_SEL = ".arr-card[data-index], .arr-group-ld[data-index], #tbodyArrears tr[data-index], tr.arr-cif-ld[data-index]";

    function role() {
        try { return String(JSON.parse(localStorage.getItem("loggedInUser") || "{}").role || "").toLowerCase(); }
        catch (e) { return ""; }
    }
    const canBlock = () => BLOCK_ROLES.includes(role());

    function toast(msg, type) {
        if (typeof showToast === "function") showToast(msg, type || "success");
    }

    // ---------- sheets ----------
    const host = document.createElement("div");
    host.innerHTML = `
<div class="arx-dim" id="arxPick" hidden>
  <div class="arx-sheet" role="dialog" aria-modal="true" aria-labelledby="arxPickTitle">
    <div class="arx-head">
      <div><div class="arx-title" id="arxPickTitle">-</div><div class="arx-sub" id="arxPickSub">-</div></div>
      <button type="button" class="arx-x" data-arx-close aria-label="Close">×</button>
    </div>
    <div class="arx-opts">
      <button type="button" class="arx-opt" data-arx="reason">
        <span class="arx-ico arx-ico-reason" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22"><path d="M5 4h10l4 4v12H5z M14 4v5h5 M8 13h8 M8 17h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg></span>
        <span><b data-arx-t="arrears.act.reason"></b><small data-arx-t="arrears.act.reasonSub"></small></span>
      </button>
      <button type="button" class="arx-opt" data-arx="block">
        <span class="arx-ico arx-ico-block" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22"><rect x="5" y="10" width="14" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="2"/></svg></span>
        <span><b data-arx-t="arrears.act.block"></b><small data-arx-t="arrears.act.blockSub"></small></span>
      </button>
    </div>
  </div>
</div>
<div class="arx-dim" id="arxBlock" hidden>
  <div class="arx-sheet" role="dialog" aria-modal="true" aria-labelledby="arxBlockTitle">
    <div class="arx-head">
      <div><div class="arx-title" id="arxBlockTitle" data-arx-t="arrears.act.blockTitle"></div><div class="arx-sub" id="arxBlockSub">-</div></div>
      <button type="button" class="arx-x" data-arx-close aria-label="Close">×</button>
    </div>
    <div class="arx-label" data-arx-t="arrears.act.action"></div>
    <div class="arx-acts" id="arxActs" role="radiogroup"></div>
    <div class="arx-btns">
      <a class="arx-link" href="/CM_Pro/pages/masterdata/accblocking.html" data-arx-t="arrears.act.openList"></a>
      <button type="button" class="arx-primary" id="arxBlockGo" data-arx-t="arrears.act.add"></button>
    </div>
  </div>
</div>
<div class="arx-selbar" id="arxSelBar" hidden>
  <div class="arx-selbar-top">
    <span class="arx-seln" id="arxSelN">0</span>
    <button type="button" class="arx-selbtn" id="arxSelCancel" data-arx-t="common.cancel"></button>
  </div>
  <div class="arx-selbar-acts">
    <button type="button" class="arx-selbtn arx-selbtn-main" id="arxSelReason" data-arx-t="arrears.act.reason"></button>
    <button type="button" class="arx-selbtn arx-selbtn-block" id="arxSelBlock" data-arx-t="arrears.act.block"></button>
  </div>
</div>`;
    document.body.append(...host.children);

    function paintText() {
        document.querySelectorAll("[data-arx-t]").forEach(el => { el.textContent = tr(el.dataset.arxT); });
    }
    paintText();
    window.addEventListener("cm-language-changed", () => { paintText(); paintActions(); });

    function openSheet(id) { document.getElementById(id).hidden = false; }
    function closeSheet(id) { document.getElementById(id).hidden = true; }
    ["arxPick", "arxBlock"].forEach(id => {
        const el = document.getElementById(id);
        el.addEventListener("click", e => { if (e.target === el || e.target.closest("[data-arx-close]")) closeSheet(id); });
    });
    document.addEventListener("keydown", e => {
        if (e.key === "Escape") ["arxPick", "arxBlock"].forEach(closeSheet);
    });

    // ---------- tap: pick Reason Arrear or Account Blocking ----------
    let pickRow = null;
    let pickNav = null;

    function tap(row, navRows) {
        if (sel) { toggle(currentRows.indexOf(row)); return; }
        if (!canBlock()) { openWorkFor(row, navRows); return; }
        pickRow = row;
        pickNav = navRows || null;
        document.getElementById("arxPickTitle").textContent = row.customer || "-";
        document.getElementById("arxPickSub").textContent = [row.loanNumber, row.cif ? `CIF ${row.cif}` : ""].filter(Boolean).join(" · ");
        openSheet("arxPick");
    }

    document.getElementById("arxPick").addEventListener("click", e => {
        const opt = e.target.closest("[data-arx]");
        if (!opt || !pickRow) return;
        closeSheet("arxPick");
        if (opt.dataset.arx === "reason") openWorkFor(pickRow, pickNav);
        else openBlock([pickRow]);
    });

    // ---------- add CIFs to the blocking list ----------
    let blockCifs = [];
    let blockAction = "Block";

    function paintActions() {
        document.getElementById("arxActs").innerHTML = ACTIONS.map(a => `
            <button type="button" role="radio" class="arx-act arx-act-${ACT_CLASS[a]}${a === blockAction ? " on" : ""}" aria-checked="${a === blockAction}" data-act="${esc(a)}">
                <b>${esc(a)}</b><small>${esc(tr(`arrears.act.a.${ACT_CLASS[a]}`))}</small>
            </button>`).join("");
    }
    document.getElementById("arxActs").addEventListener("click", e => {
        const b = e.target.closest("[data-act]");
        if (!b) return;
        blockAction = b.dataset.act;
        paintActions();
    });

    function openBlock(rows) {
        blockCifs = [...new Set(rows.map(r => String(r.cif || "").trim()).filter(Boolean))];
        if (!blockCifs.length) { toast(tr("arrears.act.noCif"), "warning"); return; }
        document.getElementById("arxBlockSub").textContent = blockCifs.length === 1
            ? `CIF ${blockCifs[0]}${rows[0]?.customer ? ` · ${rows[0].customer}` : ""}`
            : tr("arrears.act.cifN", { n: blockCifs.length });
        paintActions();
        openSheet("arxBlock");
    }

    document.getElementById("arxBlockGo").addEventListener("click", async () => {
        if (!blockCifs.length) return;
        const btn = document.getElementById("arxBlockGo");
        btn.disabled = true;
        if (typeof showAppLoading === "function") showAppLoading(tr("arrears.act.saving"));
        try {
            const res = await fetch(`${API.BASE_URL}/api/accblocking/add`, {
                method: "POST",
                headers: { Authorization: `Bearer ${API.getToken()}`, "Content-Type": "application/json" },
                body: JSON.stringify({ cifs: blockCifs, action: blockAction })
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.ok) throw new Error(data.message || tr("arrears.act.failed"));
            closeSheet("arxBlock");
            endSelect();
            const parts = [];
            if (data.added) parts.push(tr("arrears.act.addedN", { n: data.added }));
            if (data.updated) parts.push(tr("arrears.act.updatedN", { n: data.updated }));
            toast(parts.join(" · ") || tr("arrears.act.saved"));
            if (data.notFound && data.notFound.length) toast(tr("arrears.act.notFoundN", { cifs: data.notFound.join(", ") }), "warning");
            if (data.full) toast(tr("arrears.act.full"), "warning");
        } catch (err) {
            toast(err.message, "error");
        } finally {
            btn.disabled = false;
            if (typeof hideAppLoading === "function") hideAppLoading();
        }
    });

    // ---------- long press: multi-select ----------
    let sel = null;          // Set of currentRows indexes
    let timer = null;
    let start = null;
    let longFired = false;
    let skipUntil = 0;

    function selectedRows() {
        return [...(sel || [])].sort((a, b) => a - b).map(i => currentRows[i]).filter(Boolean);
    }

    function mark() {
        document.body.classList.toggle("arx-selecting", !!sel);
        document.querySelectorAll(ROW_SEL).forEach(el => {
            const on = !!sel && sel.has(Number(el.dataset.index));
            el.classList.toggle("arx-sel", on);
        });
        const bar = document.getElementById("arxSelBar");
        bar.hidden = !sel;
        if (!sel) return;
        const nav = document.querySelector(".bottom-nav");
        bar.style.bottom = `${(nav ? nav.getBoundingClientRect().height : 0) + 10}px`;
        const rows = selectedRows();
        document.getElementById("arxSelN").textContent = tr("arrears.act.selectedN", { n: rows.length });
        document.getElementById("arxSelReason").disabled = !rows.length;
        const blockBtn = document.getElementById("arxSelBlock");
        blockBtn.hidden = !canBlock();
        blockBtn.disabled = !rows.some(r => String(r.cif || "").trim());
    }

    function toggle(idx) {
        if (!sel || idx < 0) return;
        if (sel.has(idx)) sel.delete(idx); else sel.add(idx);
        if (!sel.size) sel = null;
        mark();
    }

    function endSelect() {
        sel = null;
        mark();
    }

    document.addEventListener("pointerdown", e => {
        const el = e.target.closest(ROW_SEL);
        if (!el || sel || e.target.closest("[data-stop]")) return;
        start = { x: e.clientX, y: e.clientY };
        clearTimeout(timer);
        timer = setTimeout(() => {
            timer = null;
            longFired = true;
            if (navigator.vibrate) navigator.vibrate(15);
            sel = new Set([Number(el.dataset.index)]);
            mark();
        }, 450);
    });
    document.addEventListener("pointermove", e => {
        if (timer && start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 8) {
            clearTimeout(timer);
            timer = null;
        }
    });
    ["pointerup", "pointercancel"].forEach(ev => document.addEventListener(ev, () => {
        clearTimeout(timer);
        timer = null;
        // A click may follow a long press (phones differ): ignore only that one.
        if (longFired) { longFired = false; skipUntil = Date.now() + 250; }
    }));
    // Runs before arrears.js's list handlers: swallow the long press's
    // click, and while selecting a tap only toggles the loan.
    document.addEventListener("click", e => {
        const el = e.target.closest(ROW_SEL);
        if (!el) return;
        if (Date.now() < skipUntil) { e.stopPropagation(); e.preventDefault(); return; }
        if (sel && !e.target.closest("[data-stop]")) {
            e.stopPropagation();
            e.preventDefault();
            toggle(Number(el.dataset.index));
        }
    }, true);
    document.addEventListener("contextmenu", e => { if (e.target.closest(ROW_SEL)) e.preventDefault(); });

    // Cards / rows rendered later (scrolling, CIF groups opening) pick up the marks.
    const observer = new MutationObserver(() => { if (sel) mark(); });
    [typeof arrCardList !== "undefined" ? arrCardList : null, typeof tbodyArrears !== "undefined" ? tbodyArrears : null, typeof arrCifTable !== "undefined" ? arrCifTable : null]
        .filter(Boolean).forEach(el => observer.observe(el, { childList: true, subtree: true }));

    document.getElementById("arxSelCancel").addEventListener("click", endSelect);
    document.getElementById("arxSelReason").addEventListener("click", () => {
        const rows = selectedRows();
        if (!rows.length) return;
        endSelect();
        openWorkFor(rows[0], rows);
    });
    document.getElementById("arxSelBlock").addEventListener("click", () => {
        const rows = selectedRows();
        if (rows.length) openBlock(rows);
    });

    window.arrRowTap = tap;
})();
