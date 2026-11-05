/* =====================================================
   admin-security.js — Security Center (pages/admin/security-center.html)

   Reads and acts through the admin-only Security Center API
   (CM-backend lib/security-center.js):
     GET  /api/security/overview        sections 1, 4, 5 (and 9's state)
     GET  /api/security/events          section 2 (paginated, live)
     GET/POST/PATCH /api/security/incidents   section 3
     GET/POST/DELETE /api/security/block-rules section 5
     GET  /api/security/alerts          section 6
     GET  /api/security/audit           section 7
     GET/PUT /api/security/settings     section 8
     POST /api/security/emergency/lockdown    section 9
   The server checks the admin role on every call; this page only shows
   what it is given. Every value from the server is escaped before it is
   put in the page. Every change asks for a reason (and lockdown for a
   typed word) and nothing is changed by opening or refreshing the page.
   Each section has its own loading, empty, error and permission-denied
   state, so one failing section never blanks the others.
   ===================================================== */
(function () {
  if (!window.CMAdmin) return; // admin-loader.js already redirected away

  const API_BASE = (window.API && window.API.BASE_URL) || "";
  const t = (key, vars) => (window.CMI18n ? CMI18n.t(key, vars) : key);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = n => (Number(n) || 0).toLocaleString("en-US");
  const when = v => {
    if (!v) return "—";
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return "—";
    const p = n => String(n).padStart(2, "0");
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  const $ = id => document.getElementById(id);
  const body = key => $(`sec-${key}-body`);
  const LIMIT = 20;

  // ---------- API ----------
  // 401: the session is over → login. 403: shown as "permission denied"
  // in the section (the server refused). Anything else: an error state.
  async function api(path, opts = {}) {
    let res;
    try {
      res = await fetch(`${API_BASE}${path}`, {
        ...opts,
        headers: { Authorization: `Bearer ${window.CMAdmin.token}`, "Content-Type": "application/json", ...(opts.headers || {}) }
      });
    } catch (e) {
      const err = new Error("network");
      err.kind = "unavailable";
      throw err;
    }
    if (res.status === 401) {
      location.replace(window.CM_ADMIN_CONFIG.loginPage);
      const err = new Error("unauthorized");
      err.kind = "unauthorized";
      throw err;
    }
    const data = await res.json().catch(() => null);
    if (res.status === 403) { const err = new Error("forbidden"); err.kind = "denied"; throw err; }
    if (res.status === 404 && !data) { const err = new Error("missing"); err.kind = "unavailable"; throw err; }
    if (!res.ok || !data || !data.ok) {
      const err = new Error((data && data.message) || `HTTP ${res.status}`);
      err.kind = res.status >= 500 || !data ? "unavailable" : "error";
      err.serverMessage = data && data.message;
      err.code = data && data.code;
      throw err;
    }
    return data;
  }

  // ---------- section states ----------
  function loading(key) {
    body(key).innerHTML = `<div class="sec-state"><span class="sec-spin" aria-hidden="true"></span>${esc(t("admin.security.loading"))}</div>`;
  }
  function empty(key, msgKey) {
    body(key).innerHTML = `<div class="sec-state">${esc(t(msgKey || "admin.security.empty"))}</div>`;
  }
  function failed(key, err, retry) {
    if (err && err.kind === "unauthorized") return;
    const denied = err && err.kind === "denied";
    const msg = denied ? t("admin.security.denied")
      : err && err.kind === "unavailable" ? t("admin.security.unavailable")
      : t("admin.security.loadFailed");
    body(key).innerHTML = `<div class="sec-state ${denied ? "sec-state-denied" : "sec-state-error"}" role="alert">${esc(msg)}${denied ? "" : `<br><button type="button" class="adm-btn" data-retry>${esc(t("admin.security.retry"))}</button>`}</div>`;
    const b = body(key).querySelector("[data-retry]");
    if (b) b.addEventListener("click", retry);
  }
  function pager(key, data, go) {
    const pages = Math.max(1, Math.ceil((data.total || 0) / data.limit));
    const wrap = document.createElement("div");
    wrap.className = "sec-pager";
    wrap.innerHTML = `<span>${esc(t("admin.security.pageOf", { page: data.page, pages, total: num(data.total) }))}</span>
      <button type="button" class="adm-btn" data-p="-1" ${data.page <= 1 ? "disabled" : ""}>‹ ${esc(t("admin.security.prev"))}</button>
      <button type="button" class="adm-btn" data-p="1" ${data.page >= pages ? "disabled" : ""}>${esc(t("admin.security.next"))} ›</button>`;
    wrap.addEventListener("click", e => {
      const b = e.target.closest("[data-p]");
      if (b && !b.disabled) go(data.page + Number(b.dataset.p));
    });
    body(key).appendChild(wrap);
  }
  const badge = (text, tone) => `<span class="sec-badge${tone ? ` is-${tone}` : ""}">${esc(text)}</span>`;
  const sevTone = s => (s === "critical" || s === "high" ? "bad" : s === "medium" ? "warn" : "");
  const stTone = s => (s === "open" ? "bad" : s === "investigating" ? "warn" : s === "resolved" ? "ok" : "");

  // ---------- a form in a modal (reason always required) ----------
  // fields: [{ name, label, type: text|textarea|select|number, options, required, placeholder, help }]
  function formDialog({ title, intro, fields, confirmLabel, danger, validate }) {
    return new Promise(resolve => {
      const node = document.createElement("div");
      node.innerHTML = `${intro ? `<p class="adm-modal-message">${intro}</p>` : ""}
        <form class="sec-form" novalidate>
          ${fields.map(f => `<label>${esc(f.label)}${f.type === "textarea"
            ? `<textarea name="${f.name}" maxlength="${f.max || 500}" placeholder="${esc(f.placeholder || "")}"></textarea>`
            : f.type === "select"
              ? `<select name="${f.name}">${f.options.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("")}</select>`
              : `<input name="${f.name}" type="${f.type || "text"}" maxlength="${f.max || 200}" placeholder="${esc(f.placeholder || "")}" value="${esc(f.value || "")}" autocomplete="off">`}
            ${f.help ? `<small>${esc(f.help)}</small>` : ""}</label>`).join("")}
          <div class="sec-form-error" aria-live="polite"></div>
          <div class="adm-modal-footer">
            <button type="button" class="adm-btn" data-cancel>${esc(t("admin.ui.cancel"))}</button>
            <button type="submit" class="adm-btn ${danger ? "adm-btn-danger" : "adm-btn-primary"}">${esc(confirmLabel || t("admin.ui.confirm"))}</button>
          </div>
        </form>`;
      let done = false;
      AdminUI.openModal({ title: esc(title), bodyNode: node, onClose: r => { if (!done) resolve(null); else resolve(r); } });
      const form = node.querySelector("form");
      const errEl = node.querySelector(".sec-form-error");
      node.querySelector("[data-cancel]").addEventListener("click", () => document.querySelector(".adm-modal-close").click());
      form.addEventListener("submit", e => {
        e.preventDefault();
        const values = Object.fromEntries(fields.map(f => [f.name, String(form.elements[f.name].value || "").trim()]));
        const missing = fields.find(f => f.required && !values[f.name]);
        if (missing) { errEl.textContent = t("admin.security.required", { field: missing.label }); return; }
        if (values.reason !== undefined && values.reason.length < 3) { errEl.textContent = t("admin.security.reasonShort"); return; }
        const problem = validate ? validate(values) : null;
        if (problem) { errEl.textContent = problem; return; }
        done = true;
        resolve(values);
        document.querySelector(".adm-modal-close").click();
      });
      const first = form.querySelector("input, textarea, select");
      if (first) first.focus();
    });
  }
  const reasonField = () => ({ name: "reason", label: t("admin.security.reason"), type: "textarea", required: true, placeholder: t("admin.security.reasonHint") });

  // A refusal in the user's language: the server's code when this page
  // knows it, else the server's own message.
  function refusal(e) {
    const key = e && e.code ? `admin.security.err.${e.code}` : "";
    const txt = key ? t(key) : key;
    return key && txt !== key ? txt : (e && e.serverMessage) || t("admin.security.actionFailed");
  }

  // Runs a change; a refusal from the server is shown as a toast.
  async function act(fn, okKey, after) {
    try {
      const data = await fn();
      AdminUI.toast(t(data && data.unchanged ? "admin.security.unchanged" : okKey), "success");
      after.forEach(f => f());
    } catch (e) {
      if (e.kind === "unauthorized") return;
      AdminUI.toast(e.kind === "denied" ? t("admin.security.denied") : refusal(e), "error");
    }
  }

  // ========== 1. Overview (also 4. Login Monitoring and part of 5.) ==========
  let overview = null;
  async function loadOverview() {
    ["overview", "logins"].forEach(loading);
    try {
      overview = await api("/api/security/overview");
      renderOverview();
      renderLogins();
      renderThreatIps();
      renderEmergency();
    } catch (e) {
      overview = null;
      ["overview", "logins"].forEach(k => failed(k, e, loadOverview));
      renderThreatIps(e);
      renderEmergency(e);
    }
  }
  function renderOverview() {
    const o = overview;
    const tile = (label, value, tone) => `<div class="sec-kpi${tone ? ` is-${tone}` : ""}"><div class="sec-kpi-l">${esc(label)}</div><div class="sec-kpi-v">${value}</div></div>`;
    body("overview").innerHTML = `<p class="sec-note">${esc(t("admin.security.since", { since: when(o.since), now: when(o.generatedAt) }))}</p>
      <div class="sec-kpis">
        ${tile(t("admin.security.k.success"), num(o.logins.success), "ok")}
        ${tile(t("admin.security.k.failed"), num(o.logins.failed), o.logins.failed ? "warn" : "")}
        ${tile(t("admin.security.k.blocked"), num(o.logins.blocked), o.logins.blocked ? "bad" : "")}
        ${tile(t("admin.security.k.rateLimited"), num(o.logins.rateLimited), o.logins.rateLimited ? "warn" : "")}
        ${tile(t("admin.security.k.incidents"), num(o.openIncidents), o.openIncidents ? "bad" : "ok")}
        ${tile(t("admin.security.k.alerts"), num(o.alerts24h), o.alerts24h ? "warn" : "")}
        ${tile(t("admin.security.k.rules"), num(o.activeBlockRules))}
        ${tile(t("admin.security.k.lockdown"), esc(t(o.lockdown ? "admin.security.on" : "admin.security.off")), o.lockdown ? "bad" : "ok")}
      </div>`;
  }
  function renderLogins() {
    const o = overview;
    const rows = o.topFailedUsers || [];
    body("logins").innerHTML = `<div class="sec-kpis">
        <div class="sec-kpi is-ok"><div class="sec-kpi-l">${esc(t("admin.security.k.success"))}</div><div class="sec-kpi-v">${num(o.logins.success)}</div></div>
        <div class="sec-kpi is-warn"><div class="sec-kpi-l">${esc(t("admin.security.k.failed"))}</div><div class="sec-kpi-v">${num(o.logins.failed)}</div></div>
      </div>
      <h3 class="sec-note" style="margin-top:12px">${esc(t("admin.security.topUsers"))}</h3>
      ${rows.length ? `<div class="sec-table-wrap"><table class="adm-table"><thead><tr><th>${esc(t("admin.security.col.user"))}</th><th>${esc(t("admin.security.col.failed"))}</th><th>${esc(t("admin.security.col.last"))}</th><th></th></tr></thead><tbody>
        ${rows.map(r => `<tr><td>${esc(r.username || "—")}</td><td>${num(r.failed)}</td><td>${esc(when(r.last))}</td><td><button type="button" class="adm-btn" data-user="${esc(r.username)}">${esc(t("admin.security.showEvents"))}</button></td></tr>`).join("")}
      </tbody></table></div>` : `<div class="sec-state">${esc(t("admin.security.noFailed"))}</div>`}`;
    body("logins").querySelectorAll("[data-user]").forEach(b => b.addEventListener("click", () => {
      $("secEvUser").value = b.dataset.user;
      $("secEvIp").value = "";
      $("secEvType").value = "login";
      $("secEvResult").value = "Failed";
      loadEvents(1);
      $("sec-events").scrollIntoView({ behavior: "smooth" });
    }));
  }

  // ========== 2. Live Security Events ==========
  let evPage = 1;
  async function loadEvents(p = evPage, quiet = false) {
    evPage = p;
    if (!quiet) loading("events");
    const q = new URLSearchParams({ page: p, limit: LIMIT });
    const type = $("secEvType").value, result = $("secEvResult").value, ip = $("secEvIp").value.trim(), user = $("secEvUser").value.trim();
    if (type) q.set("type", type);
    if (result) q.set("result", result);
    if (ip) q.set("ip", ip);
    if (user) q.set("username", user);
    try {
      const d = await api(`/api/security/events?${q}`);
      if (!d.items.length) return empty("events", "admin.security.noEvents");
      body("events").innerHTML = `<div class="sec-table-wrap"><table class="adm-table"><thead><tr>
        <th>${esc(t("admin.security.col.time"))}</th><th>${esc(t("admin.security.col.user"))}</th><th>${esc(t("admin.security.col.action"))}</th><th>${esc(t("admin.security.col.result"))}</th><th>IP</th><th>${esc(t("admin.security.col.detail"))}</th></tr></thead><tbody>
        ${d.items.map(e => `<tr><td>${esc(when(e.at))}</td><td>${esc(e.username || "—")}${e.role ? `<div class="sec-msg">${esc(e.role)}</div>` : ""}</td><td>${esc(e.action)}</td>
          <td>${badge(e.result || "—", e.result === "Success" ? "ok" : e.result === "Failed" ? "bad" : "")}</td>
          <td class="sec-mono">${esc(e.ip || "—")}</td><td class="sec-msg">${esc(e.message || "")}</td></tr>`).join("")}
        </tbody></table></div>`;
      pager("events", d, loadEvents);
    } catch (e) {
      failed("events", e, () => loadEvents(evPage));
    }
  }
  let liveTimer = null;
  function setLive(on) {
    clearInterval(liveTimer);
    liveTimer = on ? setInterval(() => { if (!document.hidden && evPage === 1) loadEvents(1, true); }, 30000) : null;
  }

  // ========== 3. Incident Management ==========
  let incPage = 1;
  const SEV = ["low", "medium", "high", "critical"];
  const ST = ["open", "investigating", "resolved", "dismissed"];
  async function loadIncidents(p = incPage) {
    incPage = p;
    loading("incidents");
    const q = new URLSearchParams({ page: p, limit: LIMIT });
    if ($("secIncStatus").value) q.set("status", $("secIncStatus").value);
    try {
      const d = await api(`/api/security/incidents?${q}`);
      if (!d.items.length) return empty("incidents", "admin.security.noIncidents");
      body("incidents").innerHTML = `<div class="sec-table-wrap"><table class="adm-table"><thead><tr>
        <th>${esc(t("admin.security.col.incident"))}</th><th>${esc(t("admin.security.col.severity"))}</th><th>${esc(t("admin.security.col.status"))}</th><th>${esc(t("admin.security.col.updated"))}</th><th></th></tr></thead><tbody>
        ${d.items.map(i => `<tr><td><b>${esc(i.title)}</b>${i.description ? `<div class="sec-msg">${esc(i.description)}</div>` : ""}<div class="sec-msg">${esc(t("admin.security.openedBy", { by: i.createdBy || "—", at: when(i.createdAt) }))}</div>
            ${(i.history || []).length > 1 ? `<details><summary class="sec-msg">${esc(t("admin.security.history"))}</summary>${i.history.map(h => `<div class="sec-msg">${esc(when(h.at))} · ${esc(h.by)}: ${esc(h.from ? t(`admin.security.st.${h.from}`) : "")} → ${esc(t(`admin.security.st.${h.to}`))} — ${esc(h.reason)}</div>`).join("")}</details>` : ""}</td>
          <td>${badge(t(`admin.security.sev.${i.severity}`), sevTone(i.severity))}</td>
          <td>${badge(t(`admin.security.st.${i.status}`), stTone(i.status))}</td>
          <td>${esc(when(i.updatedAt))}</td>
          <td><button type="button" class="adm-btn" data-inc="${esc(i.id)}" data-status="${esc(i.status)}">${esc(t("admin.security.inc.change"))}</button></td></tr>`).join("")}
        </tbody></table></div>`;
      body("incidents").querySelectorAll("[data-inc]").forEach(b => b.addEventListener("click", () => changeIncident(b.dataset.inc, b.dataset.status)));
      pager("incidents", d, loadIncidents);
    } catch (e) {
      failed("incidents", e, () => loadIncidents(incPage));
    }
  }
  async function newIncident() {
    const v = await formDialog({
      title: t("admin.security.inc.new"),
      fields: [
        { name: "title", label: t("admin.security.inc.title"), required: true, max: 140 },
        { name: "severity", label: t("admin.security.col.severity"), type: "select", options: SEV.map(s => [s, t(`admin.security.sev.${s}`)]) },
        { name: "description", label: t("admin.security.inc.description"), type: "textarea", max: 2000 },
        reasonField()
      ],
      confirmLabel: t("admin.security.inc.open")
    });
    if (!v) return;
    await act(() => api("/api/security/incidents", { method: "POST", body: JSON.stringify(v) }), "admin.security.saved", [() => loadIncidents(1), loadAudit, loadOverview]);
  }
  async function changeIncident(id, current) {
    const v = await formDialog({
      title: t("admin.security.inc.change"),
      fields: [
        { name: "status", label: t("admin.security.col.status"), type: "select", options: ST.filter(s => s !== current).map(s => [s, t(`admin.security.st.${s}`)]) },
        reasonField()
      ]
    });
    if (!v) return;
    await act(() => api(`/api/security/incidents/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(v) }), "admin.security.saved", [() => loadIncidents(incPage), loadAudit, loadOverview]);
  }

  // ========== 5. IP Threat Monitor ==========
  let rules = null, rulesErr = null;
  async function loadRules() {
    loading("ips");
    try {
      rules = (await api("/api/security/block-rules")).items;
      rulesErr = null;
    } catch (e) {
      rules = null;
      rulesErr = e;
    }
    renderThreatIps();
  }
  function renderThreatIps(ovErr) {
    if (rulesErr) return failed("ips", rulesErr, loadRules);
    if (!rules) return; // still loading
    const ips = overview ? overview.topFailedIps || [] : [];
    const ruleRows = rules.filter(r => r.active);
    body("ips").innerHTML = `
      <h3 class="sec-note">${esc(t("admin.security.ip.threats"))}</h3>
      ${!overview ? `<div class="sec-state sec-state-error">${esc(t(ovErr && ovErr.kind === "denied" ? "admin.security.denied" : "admin.security.loadFailed"))}</div>`
        : ips.length ? `<div class="sec-table-wrap"><table class="adm-table"><thead><tr><th>IP</th><th>${esc(t("admin.security.col.failed"))}</th><th>${esc(t("admin.security.col.users"))}</th><th>${esc(t("admin.security.col.last"))}</th><th></th></tr></thead><tbody>
        ${ips.map(r => `<tr><td><span class="sec-mono">${esc(r.ip || "—")}</span>${r.yours ? `<div>${badge(t("admin.security.ip.yours"), "warn")}</div><div class="sec-msg sec-yours">${esc(t("admin.security.ip.yoursHint"))}</div>` : ""}</td><td>${num(r.failed)}</td><td class="sec-msg">${esc((r.usernames || []).join(", "))}</td><td>${esc(when(r.last))}</td>
          <td>${r.blocked ? badge(t("admin.security.ip.isBlocked"), "bad")
            : r.yours ? ""
            : r.ip ? `<button type="button" class="adm-btn adm-btn-danger" data-block="${esc(r.ip)}">${esc(t("admin.security.ip.block"))}</button>` : ""}</td></tr>`).join("")}
        </tbody></table></div>` : `<div class="sec-state">${esc(t("admin.security.noThreats"))}</div>`}
      <h3 class="sec-note" style="margin-top:14px">${esc(t("admin.security.ip.rules"))}</h3>
      ${ruleRows.length ? `<div class="sec-table-wrap"><table class="adm-table"><thead><tr><th>${esc(t("admin.security.col.target"))}</th><th>${esc(t("admin.security.reason"))}</th><th>${esc(t("admin.security.col.by"))}</th><th>${esc(t("admin.security.col.until"))}</th><th></th></tr></thead><tbody>
        ${ruleRows.map(r => `<tr><td>${badge(r.type === "ip" ? "IP" : t("admin.security.col.user"))} <span class="sec-mono">${esc(r.value)}</span></td><td class="sec-msg">${esc(r.reason)}</td><td>${esc(r.createdBy)}<div class="sec-msg">${esc(when(r.createdAt))}</div></td>
          <td>${esc(r.expiresAt ? when(r.expiresAt) : t("admin.security.noEnd"))}</td>
          <td><button type="button" class="adm-btn" data-lift="${esc(r.id)}" data-what="${esc(r.value)}">${esc(t("admin.security.ip.lift"))}</button></td></tr>`).join("")}
        </tbody></table></div>` : `<div class="sec-state">${esc(t("admin.security.noRules"))}</div>`}`;
    body("ips").querySelectorAll("[data-block]").forEach(b => b.addEventListener("click", () => addRule("ip", b.dataset.block)));
    body("ips").querySelectorAll("[data-lift]").forEach(b => b.addEventListener("click", () => liftRule(b.dataset.lift, b.dataset.what)));
  }
  async function addRule(type, value) {
    const v = await formDialog({
      title: t("admin.security.ip.add"),
      // A username block stops a login like Inactive does: point to User
      // Management for stopping a staff member for good.
      intro: `${esc(t("admin.security.ip.addIntro"))}<br><small>${esc(t("admin.security.ip.staffNote"))} <a href="/CM_Pro/pages/admin/users.html">${esc(t("admin.nav.users"))} →</a></small>`,
      fields: [
        { name: "type", label: t("admin.security.ip.type"), type: "select", options: (type ? [[type, type === "ip" ? "IP" : t("admin.security.col.user")]] : [["ip", "IP"], ["username", t("admin.security.col.user")]]) },
        { name: "value", label: t("admin.security.ip.value"), required: true, value: value || "", placeholder: "203.0.113.7" },
        { name: "hours", label: t("admin.security.ip.hours"), type: "number", placeholder: "24", help: t("admin.security.ip.hoursHelp") },
        reasonField()
      ],
      confirmLabel: t("admin.security.ip.block"),
      danger: true,
      validate: v => (v.type === "ip" && overview && overview.yourIp && v.value.toLowerCase() === overview.yourIp ? t("admin.security.err.own_ip") : null)
    }).then(x => x, () => null);
    if (!v) return;
    await act(() => api("/api/security/block-rules", { method: "POST", body: JSON.stringify({ ...v, hours: v.hours === "" ? null : Number(v.hours) }) }),
      "admin.security.saved", [loadRules, loadAudit, loadOverview]);
  }
  async function liftRule(id, what) {
    const v = await formDialog({ title: t("admin.security.ip.lift"), intro: esc(t("admin.security.ip.liftIntro", { what })), fields: [reasonField()], confirmLabel: t("admin.security.ip.lift") });
    if (!v) return;
    await act(() => api(`/api/security/block-rules/${encodeURIComponent(id)}`, { method: "DELETE", body: JSON.stringify(v) }), "admin.security.saved", [loadRules, loadAudit, loadOverview]);
  }

  // ========== 6. Email Alert History ==========
  let alPage = 1;
  async function loadAlerts(p = alPage) {
    alPage = p;
    loading("alerts");
    try {
      const d = await api(`/api/security/alerts?page=${p}&limit=${LIMIT}`);
      $("secEmailNote").textContent = t(d.emailConfigured ? "admin.security.emailOn" : "admin.security.emailOff");
      if (!d.items.length) return empty("alerts", "admin.security.noAlerts");
      body("alerts").innerHTML = `<div class="sec-table-wrap"><table class="adm-table"><thead><tr><th>${esc(t("admin.security.col.time"))}</th><th>${esc(t("admin.security.col.severity"))}</th><th>${esc(t("admin.security.col.alert"))}</th><th>IP</th><th>${esc(t("admin.security.col.email"))}</th></tr></thead><tbody>
        ${d.items.map(a => `<tr><td>${esc(when(a.at))}</td><td>${badge(t(`admin.security.sev.${a.severity}`), sevTone(a.severity))}</td><td class="sec-msg">${esc(a.message)}</td><td class="sec-mono">${esc(a.ip || "—")}</td>
          <td>${badge(t(`admin.security.email.${a.email === "sent" || a.email === "failed" ? a.email : "not_configured"}`), a.email === "sent" ? "ok" : a.email === "failed" ? "bad" : "")}</td></tr>`).join("")}
        </tbody></table></div>`;
      pager("alerts", d, loadAlerts);
    } catch (e) {
      failed("alerts", e, () => loadAlerts(alPage));
    }
  }

  // ========== 7. Security Audit Logs ==========
  let auPage = 1;
  async function loadAudit(p = auPage) {
    if (typeof p !== "number") p = 1;
    auPage = p;
    loading("audit");
    try {
      const d = await api(`/api/security/audit?page=${p}&limit=${LIMIT}`);
      if (!d.items.length) return empty("audit", "admin.security.noAudit");
      body("audit").innerHTML = `<div class="sec-table-wrap"><table class="adm-table"><thead><tr><th>${esc(t("admin.security.col.time"))}</th><th>${esc(t("admin.security.col.by"))}</th><th>${esc(t("admin.security.col.action"))}</th><th>${esc(t("admin.security.col.target"))}</th><th>${esc(t("admin.security.reason"))}</th></tr></thead><tbody>
        ${d.items.map(a => `<tr><td>${esc(when(a.at))}</td><td>${esc(a.by)}</td><td>${esc(t(`admin.security.au.${a.action}`) === `admin.security.au.${a.action}` ? a.action : t(`admin.security.au.${a.action}`))}</td><td class="sec-mono">${esc(a.target || "")}</td><td class="sec-msg">${esc(a.reason)}</td></tr>`).join("")}
        </tbody></table></div>`;
      pager("audit", d, loadAudit);
    } catch (e) {
      failed("audit", e, () => loadAudit(auPage));
    }
  }

  // ========== 8. Protection Settings ==========
  let settings = null;
  async function loadSettings() {
    loading("settings");
    try {
      const d = await api("/api/security/settings");
      settings = d.settings;
      body("settings").innerHTML = `<form class="sec-form" id="secSettingsForm" novalidate>
        <div class="sec-settings">
          <label>${esc(t("admin.security.set.threshold"))}<input type="number" name="failedLoginThreshold" min="2" max="100" value="${esc(settings.failedLoginThreshold)}"></label>
          <label>${esc(t("admin.security.set.window"))}<input type="number" name="windowMinutes" min="1" max="1440" value="${esc(settings.windowMinutes)}"></label>
          <label class="sec-check"><input type="checkbox" name="autoBlock" ${settings.autoBlock ? "checked" : ""}> ${esc(t("admin.security.set.autoBlock"))}</label>
          <label>${esc(t("admin.security.set.autoMinutes"))}<input type="number" name="autoBlockMinutes" min="5" max="10080" value="${esc(settings.autoBlockMinutes)}"></label>
        </div>
        <p class="sec-note">${esc(t("admin.security.set.defaults", { th: d.defaults.failedLoginThreshold, win: d.defaults.windowMinutes, min: d.defaults.autoBlockMinutes }))}</p>
        <div><button type="submit" class="adm-btn adm-btn-primary">${esc(t("admin.security.set.save"))}</button></div>
      </form>`;
      $("secSettingsForm").addEventListener("submit", saveSettings);
    } catch (e) {
      failed("settings", e, loadSettings);
    }
  }
  async function saveSettings(e) {
    e.preventDefault();
    const f = e.target.elements;
    const next = { failedLoginThreshold: Number(f.failedLoginThreshold.value), windowMinutes: Number(f.windowMinutes.value), autoBlock: f.autoBlock.checked, autoBlockMinutes: Number(f.autoBlockMinutes.value) };
    const v = await formDialog({ title: t("admin.security.set.save"), intro: esc(t("admin.security.set.confirm")), fields: [reasonField()] });
    if (!v) return;
    await act(() => api("/api/security/settings", { method: "PUT", body: JSON.stringify({ settings: next, reason: v.reason }) }), "admin.security.saved", [loadSettings, loadAudit]);
  }

  // ========== 9. Emergency Response ==========
  function renderEmergency(err) {
    if (!overview) return failed("emergency", err || new Error("x"), loadOverview);
    const on = !!overview.lockdown;
    body("emergency").innerHTML = `<div class="sec-lock-state${on ? " is-on" : ""}">
        <span class="adm-ico adm-ico-lock" aria-hidden="true"></span>
        <div><b>${esc(t(on ? "admin.security.lock.on" : "admin.security.lock.off"))}</b><div class="sec-msg">${esc(t(on ? "admin.security.lock.onHint" : "admin.security.lock.offHint"))}</div></div>
        <button type="button" class="adm-btn ${on ? "adm-btn-primary" : "adm-btn-danger"}" id="secLockBtn">${esc(t(on ? "admin.security.lock.disable" : "admin.security.lock.enable"))}</button>
      </div>`;
    $("secLockBtn").addEventListener("click", () => toggleLockdown(!on));
  }
  async function toggleLockdown(enable) {
    const word = enable ? "LOCKDOWN" : "UNLOCK";
    const v = await formDialog({
      title: t(enable ? "admin.security.lock.enable" : "admin.security.lock.disable"),
      intro: esc(t(enable ? "admin.security.lock.enableIntro" : "admin.security.lock.disableIntro")),
      fields: [reasonField(), { name: "confirm", label: t("admin.security.lock.type", { word }), required: true, placeholder: word }],
      confirmLabel: t(enable ? "admin.security.lock.enable" : "admin.security.lock.disable"),
      danger: enable,
      validate: x => (x.confirm !== word ? t("admin.security.lock.mismatch", { word }) : null)
    });
    if (!v) return;
    await act(() => api("/api/security/emergency/lockdown", { method: "POST", body: JSON.stringify({ enabled: enable, reason: v.reason, confirm: v.confirm }) }),
      "admin.security.saved", [loadOverview, loadAudit, loadSettings]);
  }

  // ---------- wiring ----------
  const LOADERS = { overview: loadOverview, events: () => loadEvents(evPage), incidents: () => loadIncidents(incPage), ips: () => { loadRules(); loadOverview(); }, alerts: () => loadAlerts(alPage), audit: () => loadAudit(auPage) };
  document.addEventListener("DOMContentLoaded", () => {
    const keys = ["overview", "events", "incidents", "logins", "ips", "alerts", "audit", "settings", "emergency"];
    $("secJump").innerHTML = keys.map(k => `<a href="#sec-${k}">${esc(t(`admin.security.s.${k}`))}</a>`).join("");
    document.querySelectorAll("[data-refresh]").forEach(b => b.addEventListener("click", () => LOADERS[b.dataset.refresh]()));
    ["secEvType", "secEvResult"].forEach(id => $(id).addEventListener("change", () => loadEvents(1)));
    let typing = null;
    ["secEvIp", "secEvUser"].forEach(id => $(id).addEventListener("input", () => { clearTimeout(typing); typing = setTimeout(() => loadEvents(1), 400); }));
    $("secIncStatus").addEventListener("change", () => loadIncidents(1));
    $("secNewIncident").addEventListener("click", newIncident);
    $("secNewRule").addEventListener("click", () => addRule(null, ""));
    $("secLive").addEventListener("change", e => setLive(e.target.checked));
    loading("emergency");
    loading("ips");
    // Reads only: nothing on this page changes anything until an admin
    // confirms an action.
    loadOverview();
    loadEvents(1);
    loadIncidents(1);
    loadRules();
    loadAlerts(1);
    loadAudit(1);
    loadSettings();
    setLive(true);
  });
})();
