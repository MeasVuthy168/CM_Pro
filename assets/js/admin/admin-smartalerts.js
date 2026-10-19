/* =====================================================
   admin-smartalerts.js
   Smart Alerts admin: edit the nightly alert thresholds
   (GET/PUT /api/admin/smart-alerts/settings) and preview what
   today's run would raise and who would receive it
   (POST /api/admin/smart-alerts/run, dryRun) before sending.
   Send Now needs a preview of the same date with no unsaved
   threshold edits, then a confirm. Sending is idempotent per
   date + recipient on the server, so a second send is a no-op.
   ===================================================== */
(function () {
  if (!window.CMAdmin) return; // admin-loader.js already redirected away

  const API_BASE = (window.API && window.API.BASE_URL) || "";
  const t = (key, vars) => (window.CMI18n ? CMI18n.t(key, vars) : key);

  const FIELDS = {
    parRisePct: document.getElementById("saParRisePct"),
    osDropPct: document.getElementById("saOsDropPct"),
    nplRiseCount: document.getElementById("saNplRiseCount")
  };

  const el = {
    lastRun: document.getElementById("saLastRun"),
    btnDefaults: document.getElementById("saBtnDefaults"),
    btnSave: document.getElementById("saBtnSave"),
    btnUndo: document.getElementById("saBtnUndo"),
    saveBar: document.getElementById("saSaveBar"),
    osCompare: document.getElementById("saOsCompare"),
    osCompareDate: document.getElementById("saOsCompareDate"),
    date: document.getElementById("saDate"),
    btnPreview: document.getElementById("saBtnPreview"),
    btnSend: document.getElementById("saBtnSend"),
    result: document.getElementById("saResult"),
    compare: document.getElementById("saCompare"),
    kpiBranch: document.getElementById("saKpiBranch"),
    kpiOfficer: document.getElementById("saKpiOfficer"),
    kpiRecipients: document.getElementById("saKpiRecipients"),
    alertsWrap: document.getElementById("saAlertsWrap"),
    alertsBody: document.getElementById("saAlertsBody"),
    recipientsWrap: document.getElementById("saRecipientsWrap"),
    recipients: document.getElementById("saRecipients"),
    empty: document.getElementById("saEmpty")
  };

  let saved = null;      // thresholds as stored on the server
  let defaults = null;
  let lastPreview = null; // { date, total } — Send Now only for this date

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function money(n) {
    const v = Number(n) || 0;
    return "$" + v.toLocaleString("en-US", { maximumFractionDigits: 0 });
  }

  async function api(path, opts = {}) {
    const res = await fetch(`${API_BASE}${path}`, {
      ...opts,
      headers: { Authorization: `Bearer ${window.CMAdmin.token}`, "Content-Type": "application/json", ...(opts.headers || {}) }
    });
    if (res.status === 401 || res.status === 403) {
      location.replace(window.CM_ADMIN_CONFIG.loginPage);
      throw new Error("unauthorized");
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      const err = new Error(data.message || `HTTP ${res.status}`);
      err.serverMessage = data.message;
      throw err;
    }
    return data;
  }

  // ---------- thresholds ----------
  // OS is compared with the previous day, end of last month, end of
  // last year or a fixed date (osCompare) — set with the segmented
  // buttons; the date box shows only for "a fixed date".
  let osMode = "prev";

  function setOsMode(mode, date) {
    osMode = mode || "prev";
    el.osCompare.querySelectorAll("button").forEach((b) => {
      b.classList.toggle("on", b.dataset.mode === osMode);
      b.setAttribute("aria-checked", b.dataset.mode === osMode ? "true" : "false");
    });
    el.osCompareDate.hidden = osMode !== "date";
    if (date !== undefined) el.osCompareDate.value = date || "";
  }

  function fillForm(th) {
    Object.keys(FIELDS).forEach((k) => { FIELDS[k].value = th && th[k] != null ? th[k] : ""; });
    const c = (th && th.osCompare) || { mode: "prev", date: null };
    setOsMode(c.mode, c.date);
  }

  function readForm() {
    const out = {};
    Object.keys(FIELDS).forEach((k) => { out[k] = Number(FIELDS[k].value); });
    out.osCompare = { mode: osMode, date: osMode === "date" ? (el.osCompareDate.value || null) : null };
    return out;
  }

  function formValid() {
    const v = readForm();
    return v.parRisePct > 0 && v.osDropPct > 0 && v.nplRiseCount >= 1 &&
      (v.osCompare.mode !== "date" || !!v.osCompare.date);
  }

  function isDirty() {
    if (!saved) return false;
    const v = readForm();
    const sc = saved.osCompare || { mode: "prev", date: null };
    return Object.keys(FIELDS).some((k) => Number(saved[k]) !== v[k]) ||
      sc.mode !== v.osCompare.mode || (sc.date || null) !== v.osCompare.date;
  }

  function refreshButtons() {
    const dirty = isDirty();
    el.saveBar.hidden = !dirty;
    el.btnSave.disabled = !formValid();
    el.btnSend.disabled = !lastPreview || lastPreview.total === 0 || dirty || lastPreview.date !== currentDateKey();
  }

  function renderLastRun(date) {
    el.lastRun.textContent = date
      ? t("admin.smartAlerts.lastRun", { date })
      : t("admin.smartAlerts.lastRunNever");
  }

  async function loadSettings() {
    try {
      const data = await api("/api/admin/smart-alerts/settings");
      saved = data.thresholds;
      defaults = data.defaults;
      fillForm(saved);
      renderLastRun(data.lastRunDate);
    } catch (e) {
      if (e.message === "unauthorized") return;
      console.error("smart alerts settings failed:", e);
      AdminUI.toast(t("admin.smartAlerts.loadFailed"), "error");
    }
    refreshButtons();
  }

  async function saveSettings() {
    if (!formValid()) return AdminUI.toast(t("admin.smartAlerts.invalid"), "error");
    el.btnSave.disabled = true;
    try {
      const data = await api("/api/admin/smart-alerts/settings", {
        method: "PUT",
        body: JSON.stringify({ thresholds: readForm() })
      });
      saved = data.thresholds;
      fillForm(saved); // shows the server's rounding (NPL count is a whole number)
      AdminUI.toast(t("admin.smartAlerts.saved"), "success");
      // A preview made with the old thresholds no longer matches.
      if (lastPreview) runPreview();
    } catch (e) {
      if (e.message === "unauthorized") return;
      AdminUI.toast(e.serverMessage || t("admin.smartAlerts.saveFailed"), "error");
    }
    refreshButtons();
  }

  Object.values(FIELDS).forEach((input) => input.addEventListener("input", refreshButtons));

  // − / + steppers next to each threshold
  document.querySelectorAll(".sa-stepper").forEach((wrap) => {
    const input = wrap.querySelector("input");
    const step = Number(wrap.dataset.step) || 1;
    const min = Number(wrap.dataset.min) || step;
    wrap.querySelectorAll(".sa-step").forEach((b) => {
      b.addEventListener("click", () => {
        const cur = Number(input.value) || 0;
        const next = Math.max(min, Math.round((cur + step * Number(b.dataset.dir)) * 10) / 10);
        input.value = next;
        refreshButtons();
      });
    });
  });

  el.osCompare.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-mode]");
    if (!b) return;
    setOsMode(b.dataset.mode);
    if (osMode === "date" && !el.osCompareDate.value) el.osCompareDate.focus();
    refreshButtons();
  });
  el.osCompareDate.addEventListener("input", refreshButtons);
  el.btnUndo.addEventListener("click", () => {
    if (saved) fillForm(saved);
    refreshButtons();
  });
  el.btnSave.addEventListener("click", saveSettings);
  el.btnDefaults.addEventListener("click", () => {
    if (!defaults) return;
    fillForm(defaults);
    refreshButtons();
  });

  // ---------- preview / send ----------
  function currentDateKey() {
    return el.date.value || "";
  }

  function whoLabel(a) {
    if (a.scope === "officer") {
      const name = a.name || a.id || "";
      return `<b>${esc(name)}</b><span class="sa-who-sub">CO ${esc(a.id || "")}${a.branch ? " · " + esc(a.branch) : ""}</span>`;
    }
    return `<b>${esc(a.branch || "")}</b><span class="sa-who-sub">${esc(t("admin.smartAlerts.scopeBranch"))}</span>`;
  }

  function ruleLabel(a) {
    if (a.kind === "par_rise") return `<span class="sa-tag sa-tag-par">${esc(t("admin.smartAlerts.parRise"))}</span>`;
    if (a.kind === "os_drop") return `<span class="sa-tag sa-tag-os">${esc(t("admin.smartAlerts.osDrop"))}</span>`;
    return `<span class="sa-tag sa-tag-npl">${esc(t("admin.smartAlerts.nplRise"))}</span>`;
  }

  function changeLabel(a) {
    if (a.kind === "npl_rise") return `+${a.change} ${esc(t("admin.smartAlerts.accountsUnit"))}`;
    if (a.kind === "os_drop") return `−${a.changePct}%${a.since ? `<span class="sa-who-sub">${esc(t("admin.smartAlerts.vsDate", { date: a.since }))}</span>` : ""}`;
    return `+${a.changePct}%`;
  }

  function valuesLabel(a) {
    if (a.kind === "npl_rise") return `${a.from} → ${a.to}`;
    const extra = a.kind === "par_rise" && a.parPct != null ? ` <span class="sa-who-sub">PAR ${esc(a.parPct)}%</span>` : "";
    return `${money(a.from)} → ${money(a.to)}${extra}`;
  }

  function recipientLabel(key) {
    if (key === "role:admin") return t("admin.smartAlerts.toAdmins");
    return key.replace(/^user:/, "");
  }

  function renderResult(data) {
    const branch = data.branchAlerts || [];
    const officer = data.officerAlerts || [];
    const preview = data.preview || [];
    const recipients = data.recipients || [];
    const all = branch.concat(officer);

    el.result.hidden = false;

    const d = data.dates || {};
    const parts = [t("admin.smartAlerts.compareDate", { date: data.date })];
    if (d.branch && d.branch.prev) parts.push(t("admin.smartAlerts.comparePrev", { date: d.branch.prev }));
    if (d.branch && d.branch.osBase) parts.push(t("admin.smartAlerts.compareOs", { date: d.branch.osBase }));
    if (!d.officer) parts.push(t("admin.smartAlerts.noOfficerSnapshot"));
    el.compare.textContent = parts.join(" · ");

    el.kpiBranch.textContent = branch.length;
    el.kpiOfficer.textContent = officer.length;
    el.kpiRecipients.textContent = recipients.length;

    el.alertsWrap.hidden = all.length === 0;
    el.recipientsWrap.hidden = preview.length === 0;
    el.empty.hidden = all.length > 0;

    el.alertsBody.innerHTML = all.map((a) => `
      <tr>
        <td class="sa-who">${whoLabel(a)}</td>
        <td>${ruleLabel(a)}</td>
        <td class="sa-change sa-change-${a.kind}">${changeLabel(a)}</td>
        <td class="sa-values">${valuesLabel(a)}</td>
      </tr>`).join("");

    el.recipients.innerHTML = preview.map((p, i) => {
      const r = recipients[i] || {};
      const lines = p.lines || [];
      return `
      <details class="sa-recipient"${i === 0 ? " open" : ""}>
        <summary>
          <span class="adm-ico ${r.targetType === "role" ? "adm-ico-users" : "adm-ico-bell"}" aria-hidden="true"></span>
          <span class="sa-recipient-name">${esc(recipientLabel(p.to))}</span>
          <span class="sa-count">${lines.length}</span>
        </summary>
        <div class="sa-message">
          <div class="sa-message-title">⚠️ ចំណុចត្រូវយកចិត្តទុកដាក់ (${lines.length}) — ${esc(data.date)}</div>
          ${lines.slice(0, 8).map((l) => `<div class="sa-line">• ${esc(l)}</div>`).join("")}
          ${lines.length > 8 ? `<div class="sa-line sa-more">${esc(t("admin.smartAlerts.moreLines", { n: lines.length - 8 }))}</div>` : ""}
        </div>
      </details>`;
    }).join("");
  }

  async function runPreview() {
    el.btnPreview.disabled = true;
    const dateKey = currentDateKey();
    try {
      const body = { dryRun: true };
      if (dateKey) body.date = dateKey;
      const data = await api("/api/admin/smart-alerts/run", { method: "POST", body: JSON.stringify(body) });
      lastPreview = {
        date: dateKey,
        resolvedDate: data.date,
        total: (data.recipients || []).length,
        alerts: (data.branchAlerts || []).length + (data.officerAlerts || []).length
      };
      renderResult(data);
    } catch (e) {
      if (e.message === "unauthorized") return;
      lastPreview = null;
      el.result.hidden = true;
      AdminUI.toast(e.serverMessage || t("admin.smartAlerts.previewFailed"), "error");
    } finally {
      el.btnPreview.disabled = false;
      refreshButtons();
    }
  }

  async function sendNow() {
    if (isDirty()) return AdminUI.toast(t("admin.smartAlerts.saveFirst"), "error");
    if (!lastPreview || lastPreview.date !== currentDateKey()) return AdminUI.toast(t("admin.smartAlerts.previewFirst"), "error");

    const ok = await AdminUI.confirm({
      title: t("admin.smartAlerts.sendConfirmTitle"),
      message: t("admin.smartAlerts.sendConfirmMessage", { alerts: lastPreview.alerts, recipients: lastPreview.total, date: lastPreview.resolvedDate }),
      confirmLabel: t("admin.smartAlerts.sendNow")
    });
    if (!ok) return;

    el.btnSend.disabled = true;
    try {
      const body = { dryRun: false, date: lastPreview.resolvedDate };
      const data = await api("/api/admin/smart-alerts/run", { method: "POST", body: JSON.stringify(body) });
      AdminUI.toast(
        data.sent > 0
          ? t("admin.smartAlerts.sent", { n: data.sent })
          : t("admin.smartAlerts.alreadySent"),
        data.sent > 0 ? "success" : "info"
      );
    } catch (e) {
      if (e.message === "unauthorized") return;
      AdminUI.toast(e.serverMessage || t("admin.smartAlerts.sendFailed"), "error");
    } finally {
      refreshButtons();
    }
  }

  el.btnPreview.addEventListener("click", runPreview);
  el.btnSend.addEventListener("click", sendNow);
  el.date.addEventListener("change", refreshButtons);

  loadSettings();

  // ---------- CM Pro AI default comparison ----------
  const cmp = {
    radios: [...document.querySelectorAll('input[name="saCompare"]')],
    date: document.getElementById("saCompareDate"),
    save: document.getElementById("saBtnSaveCompare")
  };
  let savedCompare = null;

  function readCompare() {
    const mode = (cmp.radios.find((r) => r.checked) || {}).value || "prev";
    return { mode, date: mode === "date" ? cmp.date.value || null : null };
  }

  function refreshCompare() {
    const c = readCompare();
    cmp.date.disabled = c.mode !== "date";
    const valid = c.mode !== "date" || !!c.date;
    const dirty = !savedCompare || savedCompare.mode !== c.mode || (savedCompare.date || null) !== c.date;
    cmp.save.disabled = !valid || !dirty;
  }

  function fillCompare(c) {
    cmp.radios.forEach((r) => { r.checked = r.value === c.mode; });
    cmp.date.value = c.date || "";
    refreshCompare();
  }

  async function loadCompare() {
    try {
      const data = await api("/api/admin/assistant/settings");
      savedCompare = data.compareDefault;
      fillCompare(savedCompare);
    } catch (e) {
      if (e.message === "unauthorized") return;
      AdminUI.toast(t("admin.smartAlerts.loadFailed"), "error");
    }
  }

  cmp.radios.forEach((r) => r.addEventListener("change", refreshCompare));
  cmp.date.addEventListener("input", () => {
    if (cmp.date.value) cmp.radios.forEach((r) => { r.checked = r.value === "date"; });
    refreshCompare();
  });
  cmp.save.addEventListener("click", async () => {
    cmp.save.disabled = true;
    try {
      const data = await api("/api/admin/assistant/settings", {
        method: "PUT",
        body: JSON.stringify({ compareDefault: readCompare() })
      });
      savedCompare = data.compareDefault;
      fillCompare(savedCompare);
      AdminUI.toast(t("admin.smartAlerts.compareSaved"), "success");
    } catch (e) {
      if (e.message === "unauthorized") return;
      AdminUI.toast(e.serverMessage || t("admin.smartAlerts.saveFailed"), "error");
      refreshCompare();
    }
  });

  loadCompare();
})();

/* ---------- Officer Reminders (09:00 / 15:00) ----------
   GET/PUT /api/admin/officer-reminders/settings (on / off) and
   POST /api/admin/officer-reminders/run (preview, or send now —
   once per day per recipient on the server). */
(function () {
  if (!window.CMAdmin) return;

  const API_BASE = (window.API && window.API.BASE_URL) || "";
  const t = (key, vars) => (window.CMI18n ? CMI18n.t(key, vars) : key);
  const $ = (id) => document.getElementById(id);
  const el = {
    toggle: $("orToggle"), lastRun: $("orLastRun"),
    preview: $("orBtnPreview"), send: $("orBtnSend"),
    result: $("orResult"), body: $("orBody"), tableWrap: $("orTableWrap"),
    recipients: $("orRecipients"), recipientsTitle: $("orRecipientsTitle"), empty: $("orEmpty"),
    kOfficers: $("orKpiOfficers"), kUnfilled: $("orKpiUnfilled"), kExpired: $("orKpiExpired"), kOutArea: $("orKpiOutArea")
  };
  if (!el.toggle) return;

  let enabled = false;
  let previewCount = 0;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  async function api(path, opts = {}) {
    const res = await fetch(`${API_BASE}${path}`, {
      ...opts,
      headers: { Authorization: `Bearer ${window.CMAdmin.token}`, "Content-Type": "application/json", ...(opts.headers || {}) }
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      const err = new Error(data.message || `HTTP ${res.status}`);
      err.serverMessage = data.message;
      throw err;
    }
    return data;
  }

  function setToggle(on) {
    enabled = on;
    el.toggle.classList.toggle("adm-toggle-on", on);
    el.toggle.setAttribute("aria-checked", on ? "true" : "false");
  }

  function renderLastRun(v) {
    // "2026-10-19:09" -> "2026-10-19 9:00"
    const m = String(v || "").match(/^(\d{4}-\d{2}-\d{2}):(\d{2})$/);
    el.lastRun.textContent = m
      ? t("admin.officerReminders.lastRun", { when: `${m[1]} ${m[2] === "09" ? "9:00" : "15:00"}` })
      : t("admin.officerReminders.neverRun");
  }

  async function load() {
    try {
      const data = await api("/api/admin/officer-reminders/settings");
      setToggle(!!(data.settings && data.settings.enabled));
      renderLastRun(data.lastRun);
      if (data.workDay === false) el.lastRun.textContent += " · " + t("admin.officerReminders.offDay");
    } catch (e) {
      AdminUI.toast(t("admin.smartAlerts.loadFailed"), "error");
    }
  }

  async function flip() {
    const next = !enabled;
    setToggle(next);
    try {
      await api("/api/admin/officer-reminders/settings", { method: "PUT", body: JSON.stringify({ settings: { enabled: next } }) });
      AdminUI.toast(t(next ? "admin.officerReminders.on" : "admin.officerReminders.off"), "success");
    } catch (e) {
      setToggle(!next);
      AdminUI.toast(e.serverMessage || t("admin.smartAlerts.saveFailed"), "error");
    }
  }

  function recipientLabel(key) {
    return key === "role:admin" ? t("admin.smartAlerts.toAdmins") : key.replace(/^user:/, "");
  }

  function render(data) {
    const list = data.reminders || [];
    const preview = data.preview || [];
    const sum = (k) => list.reduce((a, r) => a + (r[k] || 0), 0);
    el.result.hidden = false;
    el.kOfficers.textContent = list.length;
    el.kUnfilled.textContent = sum("unfilled");
    el.kExpired.textContent = sum("expired");
    el.kOutArea.textContent = sum("outArea");
    el.tableWrap.hidden = el.recipientsTitle.hidden = el.recipients.hidden = !list.length;
    el.empty.hidden = list.length > 0;
    const cell = (n) => `<td class="or-n${n ? " or-hot" : ""}">${n || "–"}</td>`;
    el.body.innerHTML = list.map((r) => `
      <tr>
        <td class="sa-who"><b>${esc(r.name || r.id)}</b><span class="sa-who-sub">${esc(r.id)} · ${esc(r.branch)}</span></td>
        ${cell(r.unfilled)}${cell(r.expired)}${cell(r.outArea)}
      </tr>`).join("");
    el.recipients.innerHTML = preview.map((p, i) => `
      <details class="sa-recipient"${i === 0 ? " open" : ""}>
        <summary>
          <span class="adm-ico ${p.to === "role:admin" ? "adm-ico-users" : "adm-ico-bell"}" aria-hidden="true"></span>
          <span class="sa-recipient-name">${esc(recipientLabel(p.to))}</span>
          <span class="sa-count">${p.lines.length}</span>
        </summary>
        <div class="sa-message">
          ${p.lines.slice(0, 10).map((l) => `<div class="sa-line">${esc(l)}</div>`).join("")}
          ${p.lines.length > 10 ? `<div class="sa-line sa-more">${esc(t("admin.smartAlerts.moreLines", { n: p.lines.length - 10 }))}</div>` : ""}
        </div>
      </details>`).join("");
  }

  async function runPreview() {
    el.preview.disabled = true;
    try {
      const data = await api("/api/admin/officer-reminders/run", { method: "POST", body: JSON.stringify({ dryRun: true }) });
      previewCount = (data.recipients || []).length;
      render(data);
    } catch (e) {
      previewCount = 0;
      el.result.hidden = true;
      AdminUI.toast(e.serverMessage || t("admin.smartAlerts.previewFailed"), "error");
    } finally {
      el.preview.disabled = false;
      el.send.disabled = previewCount === 0;
    }
  }

  async function sendNow() {
    const ok = await AdminUI.confirm({
      title: t("admin.officerReminders.sendConfirmTitle"),
      message: t("admin.officerReminders.sendConfirm", { n: previewCount }),
      confirmLabel: t("admin.smartAlerts.sendNow")
    });
    if (!ok) return;
    el.send.disabled = true;
    try {
      const data = await api("/api/admin/officer-reminders/run", { method: "POST", body: JSON.stringify({ dryRun: false }) });
      AdminUI.toast(data.sent > 0 ? t("admin.smartAlerts.sent", { n: data.sent }) : t("admin.smartAlerts.alreadySent"), data.sent > 0 ? "success" : "info");
    } catch (e) {
      AdminUI.toast(e.serverMessage || t("admin.smartAlerts.sendFailed"), "error");
    } finally {
      el.send.disabled = previewCount === 0;
    }
  }

  el.toggle.addEventListener("click", flip);
  el.preview.addEventListener("click", runPreview);
  el.send.addEventListener("click", sendNow);
  load();
})();
