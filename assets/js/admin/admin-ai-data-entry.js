/* =====================================================
   admin-ai-data-entry.js — Admin → AI Data Entry
   Monthly Plans proposed by an AI client (cm-backend
   lib/ai-monthly-plan.js). Nothing is saved until an admin approves:
     GET  /api/ai/v1/monthly-plans/history          list + counts
     GET  /api/ai/v1/monthly-plans/preview/:id      one preview
     GET  /api/ai/v1/monthly-plans/preview/:id/audit
     POST /api/ai/v1/monthly-plans/preview/:id/approve   (MERGE)
     POST /api/ai/v1/monthly-plans/preview/:id/reject    { reason }
     GET|POST /api/admin/ai-clients, …/:id/rotate, …/:id/revoke
   Every call uses the admin's own JWT. The page never stores an AI key:
   a new / rotated key is shown once in a dialog and then forgotten.
   ===================================================== */
(function () {
  if (!window.CMAdmin) return; // admin-loader.js already redirected away

  const API_BASE = (window.API && window.API.BASE_URL) || "";
  const t = (key, vars) => (window.CMI18n ? CMI18n.t(key, vars) : key);
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const toast = (m, type) => (window.AdminUI ? AdminUI.toast(m, type) : null);

  const METRIC_KIND = {
    osCount: "count", osClients: "count", osKhr: "amount", osSmall: "amount", osAmount: "amount",
    disbCount: "count", disbAmount: "amount", losCount: "count",
    nbcOverduePct: "pct", nplPct: "pct", woCollected: "amount", woYtd: "amount", nplRecovery: "amount"
  };
  const APPROVABLE = ["PENDING", "FAILED"];
  const READ = "ai.monthly_plan.read";
  const REJECTABLE = ["PENDING", "FAILED", "STALE"];
  let page = 1;
  let current = null;   // the preview shown in the detail panel

  async function api(path, opts = {}) {
    const res = await fetch(`${API_BASE}${path}`, {
      ...opts,
      headers: { Authorization: `Bearer ${window.CMAdmin.token}`, "Content-Type": "application/json", ...(opts.headers || {}) }
    });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
  }

  // ---------- formatting ----------
  const nf = (v, d = 0) => Number(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  function fmtVal(metric, v) {
    if (v === null || v === undefined) return "—";
    const k = METRIC_KIND[metric];
    if (k === "pct") return `${nf(v, 2)}%`;
    if (k === "amount") return `$${nf(v, Number.isInteger(v) ? 0 : 2)}`;
    return nf(v);
  }
  function fmtDiff(metric, d) {
    if (d === null || d === undefined) return "—";
    if (d === 0) return "0";
    const sign = d > 0 ? "+" : "−";
    const k = METRIC_KIND[metric];
    const a = Math.abs(d);
    return `${sign}${k === "pct" ? `${nf(a, 2)} ${t("admin.ai.pts")}` : k === "amount" ? `$${nf(a, Number.isInteger(a) ? 0 : 2)}` : nf(a)}`;
  }
  const fmtTime = v => (v ? new Date(v).toLocaleString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
  const fmtMonth = m => { const [y, mo] = String(m || "").split("-"); return y ? `${mo}/${y}` : "—"; };
  const metricLabel = m => t(`admin.ai.m.${m}`);
  const dimLabel = d => t(`admin.ai.dim.${d}`);
  const badge = st => `<span class="aid-badge aid-badge-${esc(String(st).toLowerCase())}">${esc(t(`admin.ai.st.${st}`))}</span>`;
  const actBadge = a => `<span class="aid-act aid-act-${esc(String(a).toLowerCase())}">${esc(t(`admin.ai.act.${a}`))}</span>`;
  const errText = e => t(`admin.ai.err.${e.code}`, { metric: e.metric ? metricLabel(e.metric) : "" });

  // ---------- A + B. summary and list ----------
  async function loadList() {
    const q = new URLSearchParams({ page: String(page), limit: "20" });
    const st = $("aidFStatus").value, mo = $("aidFMonth").value, dim = $("aidFDim").value;
    if (st) q.set("status", st);
    if (mo) q.set("month", mo);
    if (dim) q.set("dim", dim);
    $("aidListBody").innerHTML = `<tr><td colspan="8" class="adm-table-empty">${esc(t("admin.ai.loading"))}</td></tr>`;
    const { status, body } = await api(`/api/ai/v1/monthly-plans/history?${q}`).catch(() => ({ status: 0, body: {} }));
    if (status !== 200 || !body.ok) {
      $("aidListBody").innerHTML = `<tr><td colspan="8" class="adm-table-empty">${esc(t("admin.ai.loadFailed"))}</td></tr>`;
      return;
    }
    renderKpis(body.counts || {}, !st && !mo && !dim);
    $("aidListBody").innerHTML = (body.items || []).length ? body.items.map(p => `
      <tr class="${current && current.previewId === p.previewId ? "aid-row-active" : ""}">
        <td><code class="aid-code">${esc(p.previewId.slice(0, 11))}…</code><div class="aid-sub">${esc(p.requestId || "")}</div></td>
        <td>${esc(fmtTime(p.createdAt))}</td>
        <td><code class="aid-code">${esc(p.clientId || "")}</code></td>
        <td>${esc(fmtMonth(p.month))}</td>
        <td>${esc(dimLabel(p.dim))}</td>
        <td class="num">${nf(p.rows || 0)}</td>
        <td>${badge(p.status)}</td>
        <td><button type="button" class="adm-btn aid-view" data-id="${esc(p.previewId)}">${esc(t("admin.ai.view"))}</button></td>
      </tr>`).join("") : `<tr><td colspan="8" class="adm-table-empty">${esc(t("admin.ai.none"))}</td></tr>`;
    const pages = Math.max(1, Math.ceil((body.total || 0) / (body.limit || 20)));
    $("aidPager").innerHTML = pages > 1 ? `
      <button type="button" class="adm-btn" data-page="${page - 1}" ${page <= 1 ? "disabled" : ""}>‹</button>
      <span>${esc(t("admin.ai.pageOf", { page, pages }))}</span>
      <button type="button" class="adm-btn" data-page="${page + 1}" ${page >= pages ? "disabled" : ""}>›</button>` : "";
  }

  function renderKpis(counts, unfiltered) {
    ["PENDING", "APPROVED", "REJECTED", "EXPIRED"].forEach(s => { $(`aidKpi${s}`).textContent = nf(counts[s] || 0); });
    const other = (counts.STALE || 0) + (counts.FAILED || 0) + (counts.COMMITTING || 0);
    $("aidKpiNote").textContent = [
      unfiltered ? "" : t("admin.ai.kpiFiltered"),
      other ? t("admin.ai.kpiOther", { stale: counts.STALE || 0, failed: counts.FAILED || 0 }) : ""
    ].filter(Boolean).join(" ");
  }

  // ---------- C + D. detail ----------
  async function openPreview(id) {
    const box = $("aidDetail");
    box.hidden = false;
    box.innerHTML = `<p class="adm-table-empty">${esc(t("admin.ai.loading"))}</p>`;
    const [{ status, body }, audit] = await Promise.all([
      api(`/api/ai/v1/monthly-plans/preview/${encodeURIComponent(id)}`),
      api(`/api/ai/v1/monthly-plans/preview/${encodeURIComponent(id)}/audit`).catch(() => ({ body: {} }))
    ]).catch(() => [{ status: 0, body: {} }, { body: {} }]);
    if (status !== 200 || !body.ok) { box.innerHTML = `<p class="adm-table-empty">${esc(t("admin.ai.loadFailed"))}</p>`; return; }
    current = body;
    renderDetail(body, (audit.body && audit.body.items) || []);
    box.scrollIntoView({ behavior: "smooth", block: "start" });
    document.querySelectorAll("#aidListBody tr").forEach(tr => tr.classList.toggle("aid-row-active", !!tr.querySelector(`[data-id="${CSS.escape(id)}"]`)));
  }

  function renderDetail(p, audit, stale) {
    const s = p.summary || {};
    const blocking = (p.validationErrors || []).filter(e => e.blocking);
    const warnings = (p.validationErrors || []).filter(e => !e.blocking);
    const canApprove = APPROVABLE.includes(p.status) && !blocking.length;
    const canReject = REJECTABLE.includes(p.status);
    const errsFor = key => (p.validationErrors || []).filter(e => String(e.key) === String(key));
    const recordRows = (p.records || []).map(r => {
      const errs = errsFor(r.key);
      const ms = r.metrics.length ? r.metrics : [{ metric: null }];
      return ms.map((m, i) => `
        <tr class="aid-rec aid-rec-${esc(r.action.toLowerCase())}${i === 0 ? " aid-rec-first" : ""}">
          ${i === 0 ? `<td rowspan="${ms.length}"><b>${esc(r.key)}</b>${errs.length ? `<div class="aid-errs">${errs.map(e => `<div class="${e.blocking ? "aid-err" : "aid-warn"}">${esc(errText(e))}</div>`).join("")}</div>` : ""}</td>` : ""}
          <td>${m.metric ? esc(metricLabel(m.metric)) : "—"}</td>
          <td class="num">${m.metric ? esc(fmtVal(m.metric, m.existing)) : "—"}</td>
          <td class="num"><b>${m.metric ? esc(fmtVal(m.metric, m.proposed)) : "—"}</b></td>
          <td class="num ${m.diff > 0 ? "aid-up" : m.diff < 0 ? "aid-down" : ""}">${m.metric ? esc(fmtDiff(m.metric, m.diff)) : "—"}</td>
          <td>${m.metric ? actBadge(m.action) : ""}</td>
          ${i === 0 ? `<td rowspan="${ms.length}">${actBadge(r.action)}</td>` : ""}
        </tr>`).join("");
    }).join("");
    // Errors not tied to a submitted row (e.g. a row without a key).
    const loose = (p.validationErrors || []).filter(e => !(p.records || []).some(r => String(r.key) === String(e.key)));
    $("aidDetail").innerHTML = `
      <div class="aid-detail-head">
        <div>
          <h2>${esc(t("admin.ai.detailTitle", { dim: dimLabel(p.dim), month: fmtMonth(p.month) }))} ${badge(p.status)}</h2>
          <div class="aid-sub"><code class="aid-code">${esc(p.previewId)}</code> · ${esc(t("admin.ai.cClient"))}: <code class="aid-code">${esc(p.clientId)}</code> · ${esc(t("admin.ai.request"))}: ${esc(p.requestId)}</div>
          <div class="aid-sub">${esc(t("admin.ai.cSubmitted"))}: ${esc(fmtTime(p.createdAt))} · ${esc(t("admin.ai.expires"))}: ${esc(fmtTime(p.expiresAt))} · ${esc(t("admin.ai.mergeNote"))}</div>
        </div>
        <button type="button" class="adm-btn" id="aidClose">${esc(t("admin.ai.close"))}</button>
      </div>
      <div class="aid-sum">
        ${[["new", "NEW"], ["update", "UPDATE"], ["unchanged", "UNCHANGED"], ["conflict", "CONFLICT"], ["invalid", "INVALID"]].map(([k, a]) => `<div class="aid-sum-item aid-act-${a.toLowerCase()}"><b>${nf(s[k] || 0)}</b><span>${esc(t(`admin.ai.act.${a}`))}</span></div>`).join("")}
        <div class="aid-sum-item"><b>${nf(s.total || 0)}</b><span>${esc(t("admin.ai.total"))}</span></div>
      </div>
      ${stale && stale.length ? `<div class="aid-banner aid-banner-bad">${esc(t("admin.ai.staleBanner"))}<ul>${stale.map(x => `<li>${esc(x.key)} · ${esc(metricLabel(x.metric))}: ${esc(fmtVal(x.metric, x.expected))} → ${esc(fmtVal(x.metric, x.found))}</li>`).join("")}</ul></div>` : ""}
      ${blocking.length ? `<div class="aid-banner aid-banner-bad">${esc(t("admin.ai.blockingBanner", { n: blocking.length }))}</div>` : ""}
      ${s.conflict ? `<div class="aid-banner aid-banner-warn">${esc(t("admin.ai.conflictBanner"))}</div>` : ""}
      ${p.status === "STALE" ? `<div class="aid-banner aid-banner-warn">${esc(t("admin.ai.staleStatus"))}</div>` : ""}
      ${loose.length ? `<div class="aid-banner aid-banner-bad"><ul>${loose.map(e => `<li>${esc(t("admin.ai.rowN", { n: (e.index ?? 0) + 1 }))}: ${esc(errText(e))}</li>`).join("")}</ul></div>` : ""}
      ${warnings.length ? `<p class="aid-note">${esc(t("admin.ai.warningsNote", { n: warnings.length }))}</p>` : ""}
      <div class="aid-table-wrap">
        <table class="adm-table aid-table aid-rec-table">
          <thead><tr>
            <th>${esc(t(p.dim === "officer" ? "admin.ai.dim.officer" : "admin.ai.dim.branch"))}</th>
            <th>${esc(t("admin.ai.cMetric"))}</th>
            <th class="num">${esc(t("admin.ai.cExisting"))}</th>
            <th class="num">${esc(t("admin.ai.cProposed"))}</th>
            <th class="num">${esc(t("admin.ai.cDiff"))}</th>
            <th>${esc(t("admin.ai.cAction"))}</th>
            <th>${esc(t("admin.ai.cRecord"))}</th>
          </tr></thead>
          <tbody>${recordRows || `<tr><td colspan="7" class="adm-table-empty">${esc(t("admin.ai.none"))}</td></tr>`}</tbody>
        </table>
      </div>
      <div class="aid-actions">
        ${canReject ? `<button type="button" class="adm-btn adm-btn-danger" id="aidReject">${esc(t("admin.ai.reject"))}</button>` : ""}
        ${APPROVABLE.includes(p.status) ? `<button type="button" class="adm-btn adm-btn-primary" id="aidApprove" ${canApprove ? "" : "disabled"}>${esc(t(p.status === "FAILED" ? "admin.ai.retry" : "admin.ai.approve"))}</button>` : ""}
        ${APPROVABLE.includes(p.status) && !canApprove ? `<span class="aid-note">${esc(t("admin.ai.cantApprove"))}</span>` : ""}
      </div>
      ${audit.length ? `<details class="aid-audit"><summary>${esc(t("admin.ai.auditTitle"))}</summary><ul>${audit.map(a => `<li>${esc(fmtTime(a.timestamp))} · ${esc(t(`admin.ai.au.${a.action}`))} · ${esc(a.actorId || a.actorType || "")}${a.errorCode ? ` · ${esc(a.errorCode)}` : ""}</li>`).join("")}</ul></details>` : ""}`;
    $("aidClose").addEventListener("click", () => { $("aidDetail").hidden = true; current = null; document.querySelectorAll("#aidListBody tr").forEach(tr => tr.classList.remove("aid-row-active")); });
    const ap = $("aidApprove");
    if (ap) ap.addEventListener("click", () => approve(p));
    const rj = $("aidReject");
    if (rj) rj.addEventListener("click", () => reject(p));
  }

  // The biggest changes, for the confirmation.
  function importantChanges(p, n = 5) {
    const all = [];
    for (const r of p.records || []) for (const m of r.metrics || []) {
      if (m.action === "UNCHANGED") continue;
      const rel = m.existing ? Math.abs(m.diff) / Math.abs(m.existing) : Infinity;
      all.push({ key: r.key, ...m, rel });
    }
    return all.sort((a, b) => b.rel - a.rel || Math.abs(b.diff || 0) - Math.abs(a.diff || 0)).slice(0, n);
  }

  async function approve(p) {
    const s = p.summary || {};
    const top = importantChanges(p);
    const message = `
      <div class="aid-confirm">
        <div><b>${esc(t("admin.ai.detailTitle", { dim: dimLabel(p.dim), month: fmtMonth(p.month) }))}</b></div>
        <ul>
          <li>${esc(t("admin.ai.act.NEW"))}: <b>${nf(s.new || 0)}</b></li>
          <li>${esc(t("admin.ai.act.UPDATE"))}: <b>${nf(s.update || 0)}</b></li>
          <li>${esc(t("admin.ai.act.UNCHANGED"))}: <b>${nf(s.unchanged || 0)}</b></li>
          ${s.conflict ? `<li>${esc(t("admin.ai.act.CONFLICT"))}: <b>${nf(s.conflict)}</b></li>` : ""}
          <li>${esc(t("admin.ai.total"))}: <b>${nf(s.total || 0)}</b> · ${esc(t("admin.ai.valuesChanged", { n: nf(s.metricsChanged || 0) }))}</li>
          <li>${esc(t("admin.ai.validation"))}: <b>${nf(s.blockingErrors || 0)}</b> ${esc(t("admin.ai.blockingWord"))} · ${nf(s.warnings || 0)} ${esc(t("admin.ai.warningWord"))}</li>
        </ul>
        ${top.length ? `<div>${esc(t("admin.ai.important"))}</div><ul>${top.map(m => `<li>${esc(m.key)} · ${esc(metricLabel(m.metric))}: ${esc(fmtVal(m.metric, m.existing))} → <b>${esc(fmtVal(m.metric, m.proposed))}</b></li>`).join("")}</ul>` : ""}
        <p class="aid-note">${esc(t("admin.ai.mergeNote"))}</p>
      </div>`;
    const ok = await AdminUI.confirm({ title: t("admin.ai.confirmTitle"), message, confirmLabel: t("admin.ai.approve") });
    if (!ok) return;
    const btn = $("aidApprove");
    if (btn) btn.disabled = true;
    const { status, body } = await api(`/api/ai/v1/monthly-plans/preview/${encodeURIComponent(p.previewId)}/approve`, { method: "POST", body: "{}" }).catch(() => ({ status: 0, body: {} }));
    if (status === 200 && body.ok) {
      toast(t("admin.ai.approvedToast", { n: nf((body.resultSummary && (body.resultSummary.planValues + body.resultSummary.recoveryTargets)) || 0) }), "success");
      await Promise.all([loadList(), openPreview(p.previewId)]);
      return;
    }
    toast(t(`admin.ai.code.${body.code || "commit_failed"}`), "error");
    await loadList();
    if (body.code === "stale_data" && body.stale) {
      const fresh = await api(`/api/ai/v1/monthly-plans/preview/${encodeURIComponent(p.previewId)}`).catch(() => null);
      if (fresh && fresh.body && fresh.body.ok) { current = fresh.body; renderDetail(fresh.body, [], body.stale); }
    } else {
      await openPreview(p.previewId);
    }
  }

  async function reject(p) {
    const reason = await AdminUI.prompt({ title: t("admin.ai.rejectTitle"), message: esc(t("admin.ai.rejectMsg")), label: t("admin.ai.reason"), confirmLabel: t("admin.ai.reject") });
    if (!reason) return;
    const { status, body } = await api(`/api/ai/v1/monthly-plans/preview/${encodeURIComponent(p.previewId)}/reject`, { method: "POST", body: JSON.stringify({ reason }) }).catch(() => ({ status: 0, body: {} }));
    if (status === 200 && body.ok) toast(t("admin.ai.rejectedToast"), "success");
    else toast(t(`admin.ai.code.${body.code || "commit_failed"}`), "error");
    await Promise.all([loadList(), openPreview(p.previewId)]);
  }

  // ---------- AI clients ----------
  async function loadClients() {
    const { status, body } = await api("/api/admin/ai-clients").catch(() => ({ status: 0, body: {} }));
    const tb = $("aidClientsBody");
    if (status !== 200 || !body.ok) { tb.innerHTML = `<tr><td colspan="7" class="adm-table-empty">${esc(t("admin.ai.loadFailed"))}</td></tr>`; return; }
    tb.innerHTML = (body.items || []).length ? body.items.map(c => `
      <tr>
        <td><b>${esc(c.name)}</b><div class="aid-sub"><code class="aid-code">${esc(c.clientId)}</code></div></td>
        <td><code class="aid-code">cmai_${esc(c.keyPrefix)}_…</code></td>
        <td>${c.active ? `<span class="aid-badge aid-badge-approved">${esc(t("admin.ai.active"))}</span>` : `<span class="aid-badge aid-badge-rejected">${esc(t("admin.ai.revoked"))}</span>`}</td>
        <td>${esc(fmtTime(c.createdAt))}<div class="aid-sub">${esc(c.createdBy || "")}</div></td>
        <td>${esc(fmtTime(c.lastUsedAt))}</td>
        <td>${c.active ? `<label class="aid-switch"><input type="checkbox" data-read="${esc(c.clientId)}" ${(c.permissions || []).includes(READ) ? "checked" : ""}> <span>${esc(t("admin.ai.readAllowed"))}</span></label>`
          : ((c.permissions || []).includes(READ) ? esc(t("admin.ai.readAllowed")) : "—")}</td>
        <td class="aid-row-btns">${c.active ? `
          <button type="button" class="adm-btn" data-rotate="${esc(c.clientId)}">${esc(t("admin.ai.rotate"))}</button>
          <button type="button" class="adm-btn adm-btn-danger" data-revoke="${esc(c.clientId)}">${esc(t("admin.ai.revoke"))}</button>` : esc(c.revokedBy ? `${t("admin.ai.revokedBy")} ${c.revokedBy}` : "")}</td>
      </tr>`).join("") : `<tr><td colspan="7" class="adm-table-empty">${esc(t("admin.ai.noClients"))}</td></tr>`;
  }

  // Shown once; the page keeps no copy.
  function showKey(key) {
    const node = document.createElement("div");
    node.innerHTML = `
      <p class="adm-modal-message">${esc(t("admin.ai.keyOnce"))}</p>
      <div class="aid-key"><code id="aidKeyText">${esc(key)}</code></div>
      <div class="adm-modal-footer">
        <button type="button" class="adm-btn" id="aidKeyCopy">${esc(t("admin.ai.copy"))}</button>
        <button type="button" class="adm-btn adm-btn-primary" id="aidKeyDone">${esc(t("admin.ai.done"))}</button>
      </div>`;
    const m = AdminUI.openModal({ title: t("admin.ai.keyTitle"), bodyNode: node });
    m.body.querySelector("#aidKeyCopy").addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(key); toast(t("admin.ai.copied"), "success"); } catch (e) { toast(t("admin.ai.copyFailed"), "error"); }
    });
    m.body.querySelector("#aidKeyDone").addEventListener("click", () => { node.innerHTML = ""; AdminUI.closeModal(null); });
  }

  async function newClient() {
    const name = await AdminUI.prompt({ title: t("admin.ai.newClient"), label: t("admin.ai.cName"), placeholder: "Claude", confirmLabel: t("admin.ai.create") });
    if (!name) return;
    const { status, body } = await api("/api/admin/ai-clients", { method: "POST", body: JSON.stringify({ name }) }).catch(() => ({ status: 0, body: {} }));
    if (status !== 201 || !body.key) { toast(t("admin.ai.loadFailed"), "error"); return; }
    await loadClients();
    showKey(body.key);
  }
  async function rotate(id) {
    const reason = await AdminUI.prompt({ title: t("admin.ai.rotateTitle"), message: esc(t("admin.ai.rotateMsg")), label: t("admin.ai.reason"), confirmLabel: t("admin.ai.rotate") });
    if (!reason) return;
    const { status, body } = await api(`/api/admin/ai-clients/${encodeURIComponent(id)}/rotate`, { method: "POST", body: JSON.stringify({ reason }) }).catch(() => ({ status: 0, body: {} }));
    if (status !== 200 || !body.key) { toast(t("admin.ai.loadFailed"), "error"); return; }
    await loadClients();
    showKey(body.key);
  }
  // Read permission: the key may read the stored plan (never write).
  async function setRead(id, on, box) {
    if (on) {
      const ok = await AdminUI.confirm({ title: t("admin.ai.readTitle"), message: esc(t("admin.ai.readMsg")), confirmLabel: t("admin.ai.readAllowed") });
      if (!ok) { box.checked = false; return; }
    }
    box.disabled = true;
    const { status } = await api(`/api/admin/ai-clients/${encodeURIComponent(id)}/permissions`, { method: "POST", body: JSON.stringify({ read: on }) }).catch(() => ({ status: 0 }));
    toast(t(status === 200 ? (on ? "admin.ai.readOnToast" : "admin.ai.readOffToast") : "admin.ai.loadFailed"), status === 200 ? "success" : "error");
    await loadClients();
  }
  async function revoke(id) {
    const reason = await AdminUI.prompt({ title: t("admin.ai.revokeTitle"), message: esc(t("admin.ai.revokeMsg")), label: t("admin.ai.reason"), confirmLabel: t("admin.ai.revoke") });
    if (!reason) return;
    const { status } = await api(`/api/admin/ai-clients/${encodeURIComponent(id)}/revoke`, { method: "POST", body: JSON.stringify({ reason }) }).catch(() => ({ status: 0 }));
    toast(t(status === 200 ? "admin.ai.revokedToast" : "admin.ai.loadFailed"), status === 200 ? "success" : "error");
    await loadClients();
  }

  // ---------- wiring ----------
  document.addEventListener("DOMContentLoaded", () => {
    ["aidFStatus", "aidFMonth", "aidFDim"].forEach(id => $(id).addEventListener("change", () => { page = 1; loadList(); }));
    $("aidRefresh").addEventListener("click", () => { loadList(); loadClients(); if (current) openPreview(current.previewId); });
    $("aidKpis").addEventListener("click", e => {
      const b = e.target.closest("[data-status]");
      if (!b) return;
      $("aidFStatus").value = $("aidFStatus").value === b.dataset.status ? "" : b.dataset.status;
      page = 1;
      loadList();
    });
    $("aidListBody").addEventListener("click", e => { const b = e.target.closest("[data-id]"); if (b) openPreview(b.dataset.id); });
    $("aidPager").addEventListener("click", e => { const b = e.target.closest("[data-page]"); if (b && !b.disabled) { page = Number(b.dataset.page); loadList(); } });
    $("aidNewClient").addEventListener("click", newClient);
    $("aidClientsBody").addEventListener("click", e => {
      const r = e.target.closest("[data-rotate]"), v = e.target.closest("[data-revoke]");
      if (r) rotate(r.dataset.rotate);
      if (v) revoke(v.dataset.revoke);
    });
    $("aidClientsBody").addEventListener("change", e => {
      const box = e.target.closest("[data-read]");
      if (box) setRead(box.dataset.read, box.checked, box);
    });
    const deep = new URLSearchParams(location.search).get("preview");
    loadList();
    loadClients();
    if (deep) openPreview(deep);
  });
})();
