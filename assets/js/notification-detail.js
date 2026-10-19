/* =========================================================
   NOTIFICATION DETAIL
   Opened by tapping a Smart Alert or Officer Reminder card on the
   Notifications page (?id=<notification id>). Everything shown comes
   from the notification's own `extra` data, so it matches exactly what
   was sent:
     - smart_alert ....... every alert (branch / CO), what changed and
                           a link into the matching Credit Report
     - officer_reminder .. per officer: unfilled Reason Arrear, expired
                           promises, Out of Area NoCoRespone — each one
                           opens Daily Arrears showing only those clients
   The list page hands the item over in sessionStorage; a direct open
   (push tap, reload) fetches /api/notifications/my and finds it.
========================================================= */
(function () {
    "use strict";

    const t = (key, vars) => (window.CMI18n ? CMI18n.t(key, vars) : key);
    const token = localStorage.getItem("token") || sessionStorage.getItem("token");
    const id = new URLSearchParams(location.search).get("id") || "";

    const el = {
        hero: document.getElementById("ndHero"),
        body: document.getElementById("ndBody"),
        loading: document.getElementById("ndLoading"),
        empty: document.getElementById("ndEmpty"),
        filter: document.getElementById("ndFilter")
    };

    // Filters for the roles that see more than one branch's alerts /
    // officers (Admin, User, Viewer_Manager_A): by branch, and — for
    // Officer Reminders, whose rows carry the List Officer position — by
    // position (CO / FSRO). Each row's counts follow the other filter.
    const FILTER_ROLES = ["admin", "user", "viewer_manager_a"];
    const POSITIONS = { co: "Credit Officer", fsro: "Financial Service Relation Officer" };
    let current = null;
    let branchFilter = "";
    let posFilter = "";

    function userRole() {
        try {
            const u = JSON.parse(localStorage.getItem("loggedInUser") || sessionStorage.getItem("loggedInUser") || "{}");
            return String(u.role || "").trim().toLowerCase();
        } catch (e) {
            return "";
        }
    }

    function itemsOf(n) {
        const x = n.extra || {};
        return (n.type === "smart_alert" ? x.alerts : x.reminders) || [];
    }

    function branchOf(i) {
        return String(i.branch || "").trim();
    }

    function posOf(i) {
        return i.position === POSITIONS.fsro ? "fsro" : i.position === POSITIONS.co ? "co" : "";
    }

    function applyFilters(list, { branch = branchFilter, pos = posFilter } = {}) {
        return list.filter(i => (!branch || branchOf(i) === branch) && (!pos || posOf(i) === pos));
    }

    function countBy(list, keyOf) {
        const m = new Map();
        for (const i of list) {
            const k = keyOf(i);
            if (k) m.set(k, (m.get(k) || 0) + 1);
        }
        return m;
    }

    function chipRow(labelKey, attr, active, allCount, entries) {
        const chip = (value, label, n) =>
            `<button type="button" class="nd-chip${value === active ? " on" : ""}" data-${attr}="${esc(value)}">${esc(label)}<span>${n}</span></button>`;
        return `
            <div class="nd-filter-row">
                <div class="nd-filter-label">${esc(t(labelKey))}</div>
                <div class="nd-chips">
                    ${chip("", t("notifDetail.allBranches"), allCount)}
                    ${entries.map(([value, label, n]) => chip(value, label, n)).join("")}
                </div>
            </div>`;
    }

    function renderFilter(n) {
        const items = itemsOf(n);
        const allowed = FILTER_ROLES.includes(userRole());
        const showBranch = allowed && countBy(items, branchOf).size >= 2;
        const showPos = allowed && n.type === "officer_reminder" && countBy(items, posOf).size >= 2;
        if (!showBranch) branchFilter = "";
        if (!showPos) posFilter = "";
        if (!showBranch && !showPos) {
            el.filter.hidden = true;
            return;
        }
        let html = "";
        if (showBranch) {
            const pool = applyFilters(items, { branch: "" });
            const counts = countBy(pool, branchOf);
            if (branchFilter && !counts.has(branchFilter)) branchFilter = "";
            const entries = [...counts.keys()].sort((a, b) => a.localeCompare(b)).map(b => [b, b, counts.get(b)]);
            html += chipRow("notifDetail.filterBranch", "branch", branchFilter, pool.length, entries);
        }
        if (showPos) {
            const pool = applyFilters(items, { pos: "" });
            const counts = countBy(pool, posOf);
            const entries = ["co", "fsro"].map(k => [k, t(`notifDetail.pos.${k}`), counts.get(k) || 0]);
            html += chipRow("notifDetail.filterPosition", "pos", posFilter, pool.length, entries);
        }
        el.filter.innerHTML = html;
        el.filter.hidden = false;
    }

    function render() {
        renderFilter(current);
        if (current.type === "smart_alert") renderSmartAlert(current);
        else renderReminder(current);
    }

    const ARREARS_URL = "/CM_Pro/pages/arrears/index.html";
    const BRANCH_REPORT_URL = "/CM_Pro/pages/creditreport/RepDetailbyBranch.html";
    const CO_REPORT_URL = "/CM_Pro/pages/creditreport/RepDetailbyCO.html";

    function esc(s) {
        return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    }

    function usd(n) {
        return "$" + Math.round(Number(n) || 0).toLocaleString("en-US");
    }

    function dmy(d) {
        const [y, m, day] = String(d || "").split("-");
        return day ? `${day}-${m}-${y}` : String(d || "");
    }

    // ---------- shell (topbar / bottom nav) ----------
    async function loadComponent(slotId, file) {
        const slot = document.getElementById(slotId);
        if (!slot) return;
        try {
            slot.innerHTML = await (await fetch(file)).text();
        } catch (e) {
            return;
        }
        if (slotId === "topbar-container" && typeof initTopbar === "function") {
            initTopbar({ titleKey: "notifDetail.title", showBack: true, showProfile: false, showLogo: false });
        }
        if (slotId === "bottomnav-container") {
            const items = document.querySelectorAll(".bottom-nav-item");
            items.forEach(i => i.classList.remove("active"));
            items[2]?.classList.add("active");
        }
    }

    // ---------- data ----------
    async function findNotification() {
        try {
            const handed = JSON.parse(sessionStorage.getItem("cm_notif_detail") || "null");
            if (handed && String(handed._id) === id) return handed;
        } catch (e) {}
        const res = await fetch(`${API.BASE_URL}/api/notifications/my?limit=200`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const items = data.items || data.notifications || [];
        return items.find(n => String(n._id) === id) || null;
    }

    function markRead() {
        fetch(`${API.BASE_URL}/api/notifications/mark-read`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ notificationId: id })
        }).then(() => {
            if (typeof loadNotificationBadge === "function") loadNotificationBadge();
        }).catch(() => {});
    }

    // ---------- Smart Alert ----------
    const KIND = {
        par_rise: { ico: "trend-up", cls: "par", label: "notifDetail.kind.par" },
        os_drop: { ico: "trend-down", cls: "os", label: "notifDetail.kind.os" },
        npl_rise: { ico: "plus", cls: "npl", label: "notifDetail.kind.npl" }
    };

    function alertChange(a) {
        if (a.kind === "npl_rise") return t("notifDetail.accounts", { n: `+${a.change}` });
        if (a.kind === "os_drop") return `−${a.changePct}%`;
        return `+${a.changePct}%`;
    }

    function alertValues(a) {
        if (a.kind === "npl_rise") return `${a.from} → ${a.to}`;
        return `${usd(a.from)} → ${usd(a.to)}`;
    }

    function alertSub(a) {
        if (a.kind === "par_rise") {
            const par = Math.round((Number(a.parPct) || 0) * 10000) / 100;
            return [t("dashboard.alert.since.prev"), `PAR ${par}%`].join(" · ");
        }
        if (a.kind === "os_drop") {
            return a.mode ? t(`dashboard.alert.since.${a.mode}`, { date: a.since || "" }).trim() : t("dashboard.alert.since.week");
        }
        return t("dashboard.alert.since.prev");
    }

    function alertLink(a) {
        const q = new URLSearchParams();
        if (a.branch) q.set("branch", a.branch);
        return a.scope === "officer" ? `${CO_REPORT_URL}?${q}` : `${BRANCH_REPORT_URL}?${q}`;
    }

    function alertCard(a) {
        const k = KIND[a.kind] || KIND.par_rise;
        const who = a.scope === "officer"
            ? `<b>${esc(a.name || a.id)}</b><small>CO ${esc(a.id)}${a.branch ? " · " + esc(a.branch) : ""}</small>`
            : `<b>${esc(a.branch)}</b><small>${esc(t("notifDetail.branch"))}</small>`;
        return `
            <a class="nd-card nd-alert" href="${esc(alertLink(a))}">
                <span class="nd-kind nd-kind-${k.cls}" aria-hidden="true"><span class="ui-ico ui-ico-${k.ico}"></span></span>
                <span class="nd-who">${who}</span>
                <span class="nd-change">
                    <span class="nd-rule nd-rule-${k.cls}">${esc(t(k.label))}</span>
                    <b>${esc(alertChange(a))}</b>
                </span>
                <span class="nd-line">${esc(alertValues(a))}<em>${esc(alertSub(a))}</em></span>
            </a>`;
    }

    function renderSmartAlert(n) {
        const alerts = applyFilters((n.extra && n.extra.alerts) || []);
        const count = kind => alerts.filter(a => a.kind === kind).length;
        const branches = alerts.filter(a => a.scope !== "officer");
        const officers = alerts.filter(a => a.scope === "officer");

        el.hero.innerHTML = `
            <div class="nd-hero-top">
                <span class="nd-hero-ico"><span class="ui-ico ui-ico-alert" aria-hidden="true"></span></span>
                <div>
                    <div class="nd-hero-title">${esc(t("notifDetail.alertTitle"))}</div>
                    <div class="nd-hero-sub">${esc(t("notifDetail.dataOf", { date: dmy(n.extra && n.extra.date) }))}</div>
                </div>
            </div>
            <div class="nd-stats">
                <div class="nd-stat nd-stat-par"><b>${count("par_rise")}</b><span>${esc(t("notifDetail.kind.par"))}</span></div>
                <div class="nd-stat nd-stat-os"><b>${count("os_drop")}</b><span>${esc(t("notifDetail.kind.os"))}</span></div>
                <div class="nd-stat nd-stat-npl"><b>${count("npl_rise")}</b><span>${esc(t("notifDetail.kind.npl"))}</span></div>
            </div>`;

        const section = (titleKey, list) => list.length ? `
            <h3 class="nd-section">${esc(t(titleKey))} <span>${list.length}</span></h3>
            <div class="nd-list">${list.map(alertCard).join("")}</div>` : "";

        el.body.innerHTML = alerts.length
            ? section("notifDetail.branches", branches) + section("notifDetail.officers", officers) +
              `<p class="nd-hint">${esc(t("notifDetail.alertHint"))}</p>`
            : `<p class="nd-hint">${esc(n.message || "")}</p>`;
    }

    // ---------- Officer Reminder ----------
    const REMIND = [
        { key: "unfilled", ico: "edit", label: "notifDetail.remind.unfilled", short: "notifDetail.short.unfilled" },
        { key: "expired", ico: "clock", label: "notifDetail.remind.expired", short: "notifDetail.short.expired" },
        { key: "outArea", ico: "pin", label: "notifDetail.remind.outArea", short: "notifDetail.short.outArea" }
    ];

    function arrearsLink(r, key) {
        const q = new URLSearchParams({
            focus: key === "outArea" ? "outarea" : key,
            co: r.name || "",
            coId: r.id || ""
        });
        return `${ARREARS_URL}?${q}`;
    }

    function officerCard(r) {
        const tiles = REMIND.map(m => {
            const n = Number(r[m.key]) || 0;
            const inner = `
                <span class="nd-tile-top"><span class="nd-tile-ico"><span class="ui-ico ui-ico-${m.ico}" aria-hidden="true"></span></span><b>${n}</b></span>
                <span class="nd-tile-label">${esc(t(m.short))}</span>`;
            return n
                ? `<a class="nd-tile nd-tile-${m.key}" href="${esc(arrearsLink(r, m.key))}" title="${esc(t(m.label))}">${inner}<i class="ui-ico ui-ico-chevron-right" aria-hidden="true"></i></a>`
                : `<div class="nd-tile nd-tile-zero" title="${esc(t(m.label))}">${inner}</div>`;
        }).join("");
        return `
            <div class="nd-card nd-officer">
                <div class="nd-officer-head">
                    <span class="nd-avatar">${esc(String(r.name || r.id || "?").trim().charAt(0).toUpperCase())}</span>
                    <span class="nd-who"><b>${esc(r.name || r.id)}</b><small>${esc([r.id, r.branch, posOf(r) ? t(`notifDetail.pos.${posOf(r)}`) : r.position].filter(Boolean).join(" · "))}</small></span>
                </div>
                <div class="nd-tiles">${tiles}</div>
            </div>`;
    }

    function renderReminder(n) {
        const list = applyFilters((n.extra && n.extra.reminders) || []).slice()
            .sort((a, b) => (b.unfilled + b.expired + b.outArea) - (a.unfilled + a.expired + a.outArea));
        const sum = k => list.reduce((s, r) => s + (Number(r[k]) || 0), 0);
        const slot = n.extra && n.extra.slot;
        const time = slot === "09" ? "9:00" : slot === "15" ? "15:00" : "";

        el.hero.innerHTML = `
            <div class="nd-hero-top">
                <span class="nd-hero-ico"><span class="ui-ico ui-ico-clipboard" aria-hidden="true"></span></span>
                <div>
                    <div class="nd-hero-title">${esc(t("notifDetail.remindTitle"))}</div>
                    <div class="nd-hero-sub">${esc([dmy(n.extra && n.extra.date), time].filter(Boolean).join(" · "))}${list.length > 1 ? " · " + esc(t("notifDetail.officerCount", { n: list.length })) : ""}</div>
                </div>
            </div>
            <div class="nd-stats">
                ${REMIND.map(m => `<div class="nd-stat nd-stat-${m.key}"><b>${sum(m.key)}</b><span>${esc(t(m.label))}</span></div>`).join("")}
            </div>`;

        el.body.innerHTML = list.length
            ? `<p class="nd-hint nd-hint-top">${esc(t("notifDetail.remindHint"))}</p>
               <div class="nd-list">${list.map(officerCard).join("")}</div>`
            : `<p class="nd-hint">${esc(n.message || "")}</p>`;
    }

    // ---------- go ----------
    async function init() {
        loadComponent("topbar-container", "/CM_Pro/components/topbar.html");
        loadComponent("bottomnav-container", "/CM_Pro/components/bottomnav.html");
        let n = null;
        try {
            n = id ? await findNotification() : null;
        } catch (e) {
            console.error("[notification-detail] load failed:", e);
        }
        el.loading.hidden = true;
        el.loading.style.display = "none";
        if (!n || (n.type !== "smart_alert" && n.type !== "officer_reminder")) {
            el.empty.style.display = "";
            return;
        }
        el.hero.hidden = false;
        current = n;
        el.filter.addEventListener("click", e => {
            const b = e.target.closest(".nd-chip");
            if (!b) return;
            if (b.dataset.pos !== undefined) posFilter = b.dataset.pos;
            else branchFilter = b.dataset.branch || "";
            render();
        });
        render();
        if (!n.isRead) markRead();
    }

    init();
})();
