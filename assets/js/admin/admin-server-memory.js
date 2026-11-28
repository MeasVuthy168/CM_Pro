/* =====================================================
   admin-server-memory.js — Admin › Server Monitoring, "Server Memory"
   card (owner, 28/11/2026): the server's memory against its 512 MB
   limit (GET /api/admin/server-memory), the last 24 hours, restarts in
   the last 7 days (an unexpected one = out of memory / a crash) and the
   biggest data held in memory. Refreshed every minute.
   ===================================================== */
(function () {
  if (!window.CMAdmin) return;
  const card = document.getElementById("admMemCard");
  if (!card) return;
  const API_BASE = (window.API && window.API.BASE_URL) || "";
  const t = (key, vars) => {
    let s = window.CMI18n ? CMI18n.t(key, vars) : key;
    if (s === key) s = key;
    return s;
  };
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const $ = id => document.getElementById(id);
  let chart = null;

  // Phnom Penh time, "28/11 13:47"
  function kh(iso) {
    if (!iso) return "—";
    const d = new Date(new Date(iso).getTime() + 7 * 3600 * 1000).toISOString();
    return `${d.slice(8, 10)}/${d.slice(5, 7)} ${d.slice(11, 16)}`;
  }
  function uptime(sec) {
    const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
    return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
  }
  const level = pct => (pct >= 85 ? "bad" : pct >= 70 ? "warn" : "ok");

  function render(d) {
    const pct = d.current.pct;
    $("admMemTotal").textContent = `${d.current.rssMb.toFixed(1)} MB / ${d.limitMb} MB`;
    $("admMemSub").textContent = t("admin.memory.sub", { pct, peak: d.peak24hMb.toFixed(1), up: uptime(d.uptimeSec) });
    const bar = $("admMemBar");
    bar.style.width = `${Math.min(100, pct)}%`;
    bar.className = `adm-bar-fill adm-mem-${level(pct)}`;
    $("admMemHeap").textContent = t("admin.memory.heap", { used: d.current.heapUsedMb.toFixed(1), total: d.current.heapTotalMb.toFixed(1), limit: d.heapLimitMb.toFixed(0) });
    const badge = $("admMemBadge");
    badge.className = `adm-mem-badge adm-mem-${level(pct)}`;
    badge.textContent = t(pct >= 85 ? "admin.memory.stateHigh" : pct >= 70 ? "admin.memory.stateWatch" : "admin.memory.stateOk");

    // restarts in the last 7 days
    const r = d.restarts7d || [];
    $("admMemRestarts").innerHTML = r.length ? r.map(x => `
      <li class="adm-mem-restart adm-mem-${x.reason === "crash" ? "bad" : "ok"}">
        <b>${esc(kh(x.endedAt))}</b>
        <span>${esc(t(`admin.memory.reason_${x.reason}`))}</span>
        <small>${esc(t("admin.memory.peakWas", { mb: x.peakRssMb != null ? x.peakRssMb : "?" }))}</small>
      </li>`).join("") : `<li class="adm-mem-none">${esc(t("admin.memory.noRestarts"))}</li>`;
    $("admMemCrashes").textContent = t("admin.memory.crashes", { n: d.crashes7d || 0 });

    // the biggest data held in memory
    const c = (d.caches || []).slice(0, 6);
    $("admMemCaches").innerHTML = c.length ? c.map(x => `
      <li><span>${esc(String(x.key).split("|").reverse().join(" · "))}</span><small>${esc(t("admin.memory.cacheRows", { rows: Number(x.rows).toLocaleString(), cols: x.columns, min: x.ageMin }))}</small></li>`).join("")
      : `<li class="adm-mem-none">${esc(t("admin.memory.noCaches"))}</li>`;

    // the last 24 hours, with the limit and the alert line
    if (typeof Chart === "undefined") return;
    const labels = d.series.map(p => kh(p.t).slice(6));
    const data = d.series.map(p => p.mb);
    const cs = getComputedStyle(document.documentElement);
    const textC = cs.getPropertyValue("--adm-text-muted").trim() || "#8a94a6";
    const ds = [
      { label: t("admin.memory.used"), data, borderColor: "#3987e5", backgroundColor: "rgba(57,135,229,.12)", fill: true, pointRadius: 0, borderWidth: 2, tension: 0 },
      { label: t("admin.memory.alertLine", { pct: d.alertPct }), data: data.map(() => Math.round(d.limitMb * d.alertPct) / 100), borderColor: "#D4A017", borderDash: [6, 4], pointRadius: 0, borderWidth: 1.5 },
      { label: t("admin.memory.limitLine"), data: data.map(() => d.limitMb), borderColor: "#d64545", pointRadius: 0, borderWidth: 1.5 }
    ];
    if (chart) { chart.data.labels = labels; chart.data.datasets = ds; chart.update("none"); return; }
    chart = new Chart($("admMemChart"), {
      type: "line",
      data: { labels, datasets: ds },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        interaction: { mode: "index", intersect: false },
        plugins: { legend: { labels: { color: textC, boxWidth: 12 } }, tooltip: { callbacks: { label: x => `${x.dataset.label}: ${x.parsed.y} MB` } } },
        scales: {
          x: { ticks: { color: textC, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 }, grid: { display: false } },
          y: { min: 0, suggestedMax: d.limitMb * 1.05, ticks: { color: textC, callback: v => `${v} MB` } }
        }
      }
    });
  }

  async function load() {
    try {
      const res = await fetch(`${API_BASE}/api/admin/server-memory`, { headers: { Authorization: `Bearer ${window.CMAdmin.token}` } });
      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error(d.message || `HTTP ${res.status}`);
      $("admMemLoading").hidden = true;
      $("admMemError").hidden = true;
      $("admMemBody").hidden = false;
      render(d);
    } catch (e) {
      console.error("server memory failed:", e);
      $("admMemLoading").hidden = true;
      $("admMemError").hidden = false;
    }
  }

  load();
  setInterval(load, 60 * 1000);
  window.addEventListener("cm-language-changed", load);
})();
