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
    osDropDays: document.getElementById("saOsDropDays"),
    nplRiseCount: document.getElementById("saNplRiseCount")
  };

  const el = {
    lastRun: document.getElementById("saLastRun"),
    btnDefaults: document.getElementById("saBtnDefaults"),
    btnSave: document.getElementById("saBtnSave"),
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
  function fillForm(th) {
    Object.keys(FIELDS).forEach((k) => { FIELDS[k].value = th && th[k] != null ? th[k] : ""; });
  }

  function readForm() {
    const out = {};
    Object.keys(FIELDS).forEach((k) => { out[k] = Number(FIELDS[k].value); });
    return out;
  }

  function formValid() {
    const v = readForm();
    return v.parRisePct > 0 && v.osDropPct > 0 && v.osDropDays >= 1 && v.nplRiseCount >= 1;
  }

  function isDirty() {
    if (!saved) return false;
    const v = readForm();
    return Object.keys(FIELDS).some((k) => Number(saved[k]) !== v[k]);
  }

  function refreshButtons() {
    const dirty = isDirty();
    el.btnSave.disabled = !dirty || !formValid();
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
    if (a.kind === "os_drop") return `−${a.changePct}%`;
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
    if (d.branch && d.branch.weekAgo) parts.push(t("admin.smartAlerts.compareWeek", { date: d.branch.weekAgo }));
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
