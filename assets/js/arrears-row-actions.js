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

    // The signed-in user sits in localStorage ("stay signed in") or
    // sessionStorage. The server has the final say (canEdit on the
    // Account Blocking list); the role is only the guess until it answers.
    function role() {
        try { return String(JSON.parse(localStorage.getItem("loggedInUser") || sessionStorage.getItem("loggedInUser") || "{}").role || "").toLowerCase(); }
        catch (e) { return ""; }
    }
    let blockAllowed = null;
    const canBlock = () => (blockAllowed !== null ? blockAllowed : BLOCK_ROLES.includes(role()));
    fetch(`${API.BASE_URL}/api/accblocking/list`, { headers: { Authorization: `Bearer ${API.getToken()}` } })
        .then(res => res.json())
        .then(data => {
            if (data && data.ok) {
                blockAllowed = !!data.canEdit;
                setBlocked(data.rows);
                if (sel) mark();
            }
        })
        .catch(() => {});

    // The app's toast (toast.js); this page has no global showToast().
    function toast(msg, type, duration) {
        if (typeof CMToast !== "undefined" && CMToast.show) CMToast.show({ type: type || "success", title: msg, message: "", duration: duration || 3000 });
        else if (typeof showToast === "function") showToast(msg, type || "success");
    }

    // ---------- sheets ----------
    const host = document.createElement("div");
    host.innerHTML = `
<div class="arx-dim" id="arxPick" hidden>
  <div class="arx-sheet" role="dialog" aria-modal="true" aria-labelledby="arxPickTitle">
    <div class="arx-info">
      <div class="arx-sum">
        <div class="arx-head">
          <div class="arx-pick-who"><button type="button" class="arx-title arx-name" id="arxPickTitle" data-copy="">-</button><div class="arx-sub" id="arxPickSub">-</div></div>
          <button type="button" class="arx-x" data-arx-close aria-label="Close">×</button>
        </div>
        <div id="arxPickStats"></div>
      </div>
      <div class="arx-ids" id="arxPickIds"></div>
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
<div class="arx-dim" id="arxDone" hidden>
  <div class="arx-sheet arx-done" role="dialog" aria-modal="true" aria-labelledby="arxDoneTitle">
    <div class="arx-done-ico" aria-hidden="true">✓</div>
    <div class="arx-title" id="arxDoneTitle" data-arx-t="arrears.act.doneTitle"></div>
    <div class="arx-done-lines" id="arxDoneLines"></div>
    <div class="arx-done-btns">
      <a class="arx-primary arx-done-open" href="/CM_Pro/pages/masterdata/accblocking.html" data-arx-t="arrears.act.openBlocking"></a>
      <button type="button" class="arx-done-stay" data-arx-close data-arx-t="arrears.act.stay"></button>
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
    ["arxPick", "arxBlock", "arxDone"].forEach(id => {
        const el = document.getElementById(id);
        el.addEventListener("click", e => { if (e.target === el || e.target.closest("[data-arx-close]")) closeSheet(id); });
    });
    document.addEventListener("keydown", e => {
        if (e.key === "Escape") ["arxPick", "arxBlock", "arxDone"].forEach(closeSheet);
    });

    // ---------- tap: pick Reason Arrear or Account Blocking ----------
    let pickRow = null;
    let pickNav = null;

    function tap(row, navRows) {
        if (sel) { toggle(currentRows.indexOf(row)); return; }
        if (!canBlock()) { openWorkFor(row, navRows); return; }
        pickRow = row;
        pickNav = navRows || null;
        paintPick(row);
        openSheet("arxPick");
    }

    // ---------- the loan's details on the pick sheet ----------
    const COPY_ICO = `<svg class="arx-cp-ico" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M5 15V5a1 1 0 0 1 1-1h10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
    const amount = v => (typeof arrFormatAmount === "function" ? arrFormatAmount(v) : String(v ?? "-"));
    const phoneOf = v => (typeof formatPhone === "function" ? formatPhone(v) : String(v || "").trim());
    const hasAmount = v => String(v ?? "").trim() !== "";

    function paintPick(row) {
        const title = document.getElementById("arxPickTitle");
        title.textContent = row.customer || "-";
        title.dataset.copy = row.customer || "";
        title.dataset.copyLabel = tr("arrears.act.d.name");
        const day = parseInt(row.day, 10);
        document.getElementById("arxPickSub").innerHTML = [
            Number.isFinite(day) ? `<span class="arx-day">${esc(day.toLocaleString())} ${esc(tr("arrears.act.d.days"))}</span>` : "",
            row.class ? `<span class="arx-chip">${esc(row.class)}</span>` : "",
            row.ccy ? `<span class="arx-chip">${esc(row.ccy)}</span>` : "",
            row.coId ? `<span class="arx-chip">CO ${esc(row.coId)}</span>` : ""
        ].filter(Boolean).join("");

        const phone = phoneOf(row.tell);
        const copy = (label, value, extra) => value ? `
            <div class="arx-cp-row">
              <button type="button" class="arx-cp" data-copy="${esc(value)}" data-copy-label="${esc(label)}">
                <span class="arx-k">${esc(label)}</span><span class="arx-v">${esc(value)}</span>${COPY_ICO}
              </button>${extra || ""}
            </div>` : "";
        const call = phone ? `<a class="arx-call" href="tel:${esc(phone.replace(/[^\d+]/g, ""))}" aria-label="${esc(tr("arrears.act.d.call"))}"><span class="ui-ico ui-ico-phone" aria-hidden="true"></span></a>` : "";
        const ids = [
            copy("LD", row.loanNumber),
            copy("CIF", row.cif),
            copy(tr("arrears.act.d.phone"), phone, call),
            copy(tr("arrears.act.d.account"), row.accountLoan),
            copy(tr("arrears.act.d.coCif"), row.cifCoborrower)
        ].join("");
        const arrears = parseFloat(String(row.arreas ?? "").replace(/,/g, "")) || 0;
        const stats = [
            [tr("arrears.act.d.arrear"), hasAmount(row.arreas) ? amount(row.arreas) : "", arrears > 0 ? "bad" : ""],
            [tr("arrears.act.d.prnOs"), hasAmount(row.prnOS) ? amount(row.prnOS) : ""],
            [tr("arrears.act.d.occu"), row.occu]
        ].filter(x => x[1]).map(([k, v, cls]) => `<div class="arx-stat${cls ? ` arx-stat-${cls}` : ""}"><span class="arx-k">${esc(k)}</span><b>${esc(v)}</b></div>`).join("");
        const address = row.location ? `<div class="arx-addr"><span class="ui-ico ui-ico-pin" aria-hidden="true"></span><span><span class="arx-k">${esc(tr("arrears.act.d.address"))}</span>${esc(row.location)}</span></div>` : "";
        // one card for who the loan is, one for what can be copied
        document.getElementById("arxPickStats").innerHTML = (stats ? `<div class="arx-stats">${stats}</div>` : "") + address;
        const idsBox = document.getElementById("arxPickIds");
        idsBox.innerHTML = ids;
        idsBox.hidden = !ids;
    }

    async function copyText(text) {
        try {
            if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; }
        } catch (e) { /* fall back below */ }
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;";
        document.body.appendChild(ta);
        ta.select();
        let ok = false;
        try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
        ta.remove();
        return ok;
    }

    document.getElementById("arxPick").addEventListener("click", async e => {
        const btn = e.target.closest("[data-copy]");
        if (!btn || !btn.dataset.copy) return;
        const ok = await copyText(btn.dataset.copy);
        if (!ok) { toast(tr("arrears.act.copyFailed"), "error"); return; }
        btn.classList.add("arx-copied");
        setTimeout(() => btn.classList.remove("arx-copied"), 1100);
        toast(tr("arrears.act.copied", { what: btn.dataset.copyLabel || "", value: btn.dataset.copy }), "success", 1800);
    });

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
            setBlocked(data.rows);
            endSelect();
            // Done: open the blocking list, or stay on Daily Arrears.
            const lines = [];
            if (data.added) lines.push([tr("arrears.act.doneAddedN", { n: data.added, action: blockAction }), ""]);
            if (data.updated) lines.push([tr("arrears.act.updatedN", { n: data.updated }), ""]);
            if (!lines.length) lines.push([tr("arrears.act.saved"), ""]);
            if (data.notFound && data.notFound.length) lines.push([tr("arrears.act.notFoundN", { cifs: data.notFound.join(", ") }), "warn"]);
            if (data.full) lines.push([tr("arrears.act.full"), "warn"]);
            document.getElementById("arxDoneLines").innerHTML = lines
                .map(([text, kind]) => `<div class="arx-done-line${kind ? ` arx-done-${kind}` : ""}">${esc(text)}</div>`).join("");
            openSheet("arxDone");
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
    // ---------- tags: what's already done for each loan ----------
    // "Reason Arrear" when the loan has one (or one waiting to be sent),
    // and the action when its CIF is on today's blocking list.
    let blockedByCif = new Map();
    const cifKey = c => String(c || "").trim().replace(/^0+/, "").toUpperCase();

    function setBlocked(rows) {
        if (!Array.isArray(rows)) return;
        blockedByCif = new Map(rows.filter(r => r && r.cif).map(r => [cifKey(r.cif), r.action || "Block"]));
        tagAll();
    }

    function tagsHtml(row, compact) {
        const tags = [];
        const pending = !!row.__pendingSubmit;
        if (pending) tags.push(`<span class="arx-tag arx-tag-pending" title="${esc(tr("arrears.act.tagPending"))}">⏳${compact ? "" : ` ${esc(tr("arrears.act.tagPending"))}`}</span>`);
        else if (row.ajReason || row.akSolution || row.alFollowup) tags.push(`<span class="arx-tag arx-tag-reason" title="${esc(tr("arrears.act.tagReason"))}">✓${compact ? "" : ` ${esc(tr("arrears.act.tagReason"))}`}</span>`);
        const action = row.cif ? blockedByCif.get(cifKey(row.cif)) : "";
        if (action) tags.push(`<span class="arx-tag arx-tag-block arx-tag-${ACT_CLASS[action] || "block"}" title="${esc(tr("arrears.act.tagBlock"))} · ${esc(action)}">🔒${compact ? "" : ` ${esc(tr("arrears.act.tagBlock"))} · ${esc(action)}`}</span>`);
        return tags.join("");
    }

    function tagOne(el) {
        const row = currentRows[Number(el.dataset.index)];
        if (!row) return;
        const compact = el.tagName === "TR";
        const html = tagsHtml(row, compact);
        if (el.dataset.arxTags === html && (!html || el.querySelector(".arx-tags"))) return;
        el.dataset.arxTags = html;
        el.querySelectorAll(":scope .arx-tags").forEach(x => x.remove());
        if (!html) return;
        const box = document.createElement(compact ? "span" : "div");
        box.className = "arx-tags";
        box.innerHTML = html;
        if (el.classList.contains("arr-card")) {
            const ids = el.querySelector(".arr-card-ids");
            if (ids) ids.after(box); else el.prepend(box);
        } else if (el.classList.contains("arr-group-ld")) {
            const top = el.querySelector(".arr-group-ld-top");
            if (top) top.after(box); else el.prepend(box);
        } else {
            // Table (LD rows and a CIF group's LDs): two small round icons
            // on the right of the frozen No cell, stacked beside the number.
            box.classList.add("arx-tags-corner");
            if (el.cells[0]) el.cells[0].append(box);
        }
    }

    let tagQueued = false;
    function tagAll() {
        if (tagQueued) return;
        tagQueued = true;
        requestAnimationFrame(() => {
            tagQueued = false;
            document.querySelectorAll(ROW_SEL).forEach(tagOne);
        });
    }

    // Only the rows that were added or changed (more loaded on scroll, a
    // cell rewritten) — not every row on each change, which made long
    // lists stutter while more loaded. Our own tag boxes are skipped.
    const pending = new Set();
    let pendingQueued = false;
    const observer = new MutationObserver(records => {
        for (const r of records) {
            const ownOnly = r.addedNodes.length && [...r.addedNodes].every(n => n.nodeType === 1 && n.classList.contains("arx-tags"));
            if (ownOnly && !r.removedNodes.length) continue;
            const host = r.target.nodeType === 1 ? r.target.closest(ROW_SEL) : null;
            if (host) pending.add(host);
            r.addedNodes.forEach(n => {
                if (n.nodeType !== 1 || n.classList.contains("arx-tags")) return;
                if (n.matches(ROW_SEL)) pending.add(n);
                n.querySelectorAll(ROW_SEL).forEach(e => pending.add(e));
            });
        }
        if (!pending.size || pendingQueued) return;
        pendingQueued = true;
        requestAnimationFrame(() => {
            pendingQueued = false;
            const els = [...pending];
            pending.clear();
            els.forEach(el => {
                if (!el.isConnected) return;
                tagOne(el);
                if (sel) el.classList.toggle("arx-sel", sel.has(Number(el.dataset.index)));
            });
        });
    });
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

    // ---------- Account Blocking button (left of Work to complete) ----------
    const workBtn = document.getElementById("btnNoReasonSummary");
    if (workBtn && role() !== "viewer_staff") {
        const link = document.createElement("a");
        link.id = "btnArrBlocking";
        link.className = "arr-work-btn arr-blocking-btn";
        link.href = "/CM_Pro/pages/masterdata/accblocking.html";
        link.innerHTML = `<span class="arx-btn-ico" aria-hidden="true"><svg viewBox="0 0 24 24" width="15" height="15"><rect x="5" y="10" width="14" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M8 10V7a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="2.2"/></svg></span> <span data-arx-t="arrears.act.blockingBtn">${esc(tr("arrears.act.blockingBtn"))}</span>`;
        workBtn.before(link);
    }

    window.arrRowTap = tap;
})();
