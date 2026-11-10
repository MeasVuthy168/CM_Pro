/* =====================================================
   Admin — WO YTD Check (pages/admin/wo-check.html)
   GET /api/creditreport/wo-ytd-check?year=YYYY (admin): the WO rows behind
   the Daily Report's "WO YTD" per branch, and the rows with an amount it
   leaves out, with why. Read only — for comparing with another report.
   ===================================================== */
(function () {
  if (!window.CMAdmin) return; // admin-loader.js already redirected away

  const API_BASE = (window.API && window.API.BASE_URL) || "";
  const t = (key, vars) => (window.CMI18n ? CMI18n.t(key, vars) : key);
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const nf = v => Number(v || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
  const dmy = k => (k ? k.split("-").reverse().join("-") : "—");
  let last = null;

  function kpi(label, value, sub) {
    return `<div class="adm-card"><div class="adm-card-label">${esc(label)}</div><div class="adm-card-value">${esc(value)}</div>${sub ? `<div class="wo-sub">${esc(sub)}</div>` : ""}</div>`;
  }
  const rowCells = r => `
    <td>${esc(r.branch || "—")}</td>
    <td><code>${esc(r.cif)}</code></td>
    <td>${esc(r.name)}</td>
    <td>${esc(r.officerId)}<div class="wo-sub">${esc(String(r.team || "").toUpperCase())}</div></td>
    <td>${esc(dmy(r.date))}${r.dateRaw && r.dateRaw !== dmy(r.date) ? `<div class="wo-sub">${esc(r.dateRaw)}</div>` : ""}</td>
    <td class="num"><b>${nf(r.cn)}</b></td>
    <td class="num">${nf(r.cm)}</td>
    <td class="num">${nf(r.cl)}</td>`;
  const rowHead = extra => `<thead><tr>${extra || ""}<th>${esc(t("admin.wo.cBranch"))}</th><th>CIF</th><th>${esc(t("admin.wo.cName"))}</th><th>${esc(t("admin.wo.cOfficer"))}</th><th>${esc(t("admin.wo.cDate"))}</th><th class="num">CN (Prn)</th><th class="num">CM</th><th class="num">CL</th></tr></thead>`;

  function render(d) {
    last = d;
    $("woCsv").disabled = false;
    const skippedSum = d.skipped.reduce((n, r) => n + r.cn, 0);
    $("woKpis").innerHTML =
      kpi(t("admin.wo.kPrn"), `$${nf(d.total.prn)}`, `${dmy(d.from)} → ${dmy(d.to)}`) +
      kpi(t("admin.wo.kRows"), nf(d.total.count), t("admin.wo.kCifs", { n: nf(d.total.cifs) })) +
      kpi(t("admin.wo.kCm"), `$${nf(d.total.cmOfCounted)}`, t("admin.wo.kCmSub")) +
      kpi(t("admin.wo.kSkipped"), nf(d.skipped.length), d.skipped.length ? `$${nf(skippedSum)}` : "");
    $("woBranch").innerHTML = `<thead><tr><th>${esc(t("admin.wo.cBranch"))}</th><th class="num">#</th><th class="num">CIF</th><th class="num">Prn (CN)</th></tr></thead><tbody>` +
      d.perBranch.map(b => `<tr><td>${esc(b.branch)}</td><td class="num">${nf(b.count)}</td><td class="num">${nf(b.cifs)}</td><td class="num">${nf(b.prn)}</td></tr>`).join("") +
      `<tr class="wo-total"><td>${esc(t("admin.wo.total"))}</td><td class="num">${nf(d.total.count)}</td><td class="num">${nf(d.total.cifs)}</td><td class="num">${nf(d.total.prn)}</td></tr></tbody>`;
    $("woCountedTitle").textContent = `${t("admin.wo.counted")} (${d.counted.length})`;
    $("woCounted").innerHTML = rowHead() + `<tbody>${d.counted.length ? d.counted.map(r => `<tr>${rowCells(r)}</tr>`).join("") : `<tr><td colspan="8" class="adm-table-empty">${esc(t("admin.wo.none"))}</td></tr>`}</tbody>`;
    $("woSkippedTitle").textContent = `${t("admin.wo.skipped")} (${d.skipped.length})`;
    $("woSkipped").innerHTML = rowHead(`<th>${esc(t("admin.wo.cReason"))}</th>`) + `<tbody>${d.skipped.length ? d.skipped.map(r => `<tr><td><span class="wo-reason">${esc(t(`admin.wo.r.${r.reason}`))}</span></td>${rowCells(r)}</tr>`).join("") : `<tr><td colspan="9" class="adm-table-empty">${esc(t("admin.wo.noneSkipped"))}</td></tr>`}</tbody>`;
  }

  async function run() {
    const year = Number($("woYear").value) || new Date().getFullYear();
    $("woRun").disabled = true;
    $("woKpis").innerHTML = `<div class="wo-note">${esc(t("admin.wo.loading"))}</div>`;
    try {
      const res = await fetch(`${API_BASE}/api/creditreport/wo-ytd-check?year=${year}`, { headers: { Authorization: `Bearer ${window.CMAdmin.token}` } });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) throw new Error(body.message || `HTTP ${res.status}`);
      $("woYear").value = body.year;
      render(body);
    } catch (e) {
      $("woKpis").innerHTML = `<div class="wo-note wo-err">${esc(t("admin.wo.failed"))}</div>`;
      if (window.AdminUI) AdminUI.toast(t("admin.wo.failed"), "error");
    } finally {
      $("woRun").disabled = false;
    }
  }

  // CSV of every row (counted and left out), for matching against another report.
  function csv() {
    if (!last) return;
    const q = v => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
    const lines = [["status", "reason", "branch", "cif", "name", "officerId", "team", "woDate", "woDateRaw", "CN_prn", "CM", "CL"].join(",")];
    const add = (status, r) => lines.push([status, r.reason || "", r.branch, r.cif, r.name, r.officerId, r.team, r.date || "", r.dateRaw, r.cn, r.cm, r.cl].map(q).join(","));
    last.counted.forEach(r => add("counted", r));
    last.skipped.forEach(r => add("left_out", r));
    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `WO_YTD_check_${last.year}.csv`;
    document.body.appendChild(link);
    link.click();
    link.parentNode.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("woYear").value = new Date().getFullYear();
    $("woRun").addEventListener("click", run);
    $("woCsv").addEventListener("click", csv);
    run();
  });
})();
