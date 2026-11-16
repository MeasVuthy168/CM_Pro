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
     - Reason Arrear submit (moduleCode ReasonArrear_Submit) .. who
                           submitted, and each client: LD, reason,
                           promise date
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
    // Viewer_Staff doesn't get the "Open work to complete" shortcut on
    // Officer Reminders.
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

    // Officer Reminders show LIVE counts (GET /api/officer-reminders/live —
    // the same rules, computed now, only the officers this user is
    // reminded about); the figures sent at 9:00 / 15:00 stay as a
    // reference line. Until the live list arrives — or if it fails —
    // the sent figures are shown.
    let live = null;          // { at, reminders }
    let liveState = "idle";   // idle | loading | ok | fail

    // The live figures come from one server call (it reads the whole
    // arrears sheet), so the % is an estimate from elapsed time that
    // eases toward 95% and jumps to 100% when the answer lands.
    const LIVE_EXPECT_MS = 6000;
    let liveStarted = 0;
    let liveTimer = null;

    function livePct() {
        const elapsed = Date.now() - liveStarted;
        return Math.min(95, Math.round(95 * (1 - Math.exp(-elapsed / LIVE_EXPECT_MS))));
    }

    function paintLiveProgress(pct) {
        const bar = document.getElementById("ndLiveBar");
        const label = document.getElementById("ndLivePct");
        if (bar) bar.style.width = `${pct}%`;
        if (label) label.textContent = `${pct}%`;
    }

    async function loadLive() {
        liveState = "loading";
        liveStarted = Date.now();
        clearInterval(liveTimer);
        liveTimer = setInterval(() => paintLiveProgress(livePct()), 200);
        try {
            const res = await fetch(`${API.BASE_URL}/api/officer-reminders/live`, { headers: { Authorization: `Bearer ${token}` } });
            const data = await res.json();
            if (!res.ok || !data.ok) throw new Error(data.message || `HTTP ${res.status}`);
            live = { at: data.at, reminders: data.reminders || [] };
            liveState = "ok";
            paintLiveProgress(100);
            await new Promise(r => setTimeout(r, 250)); // let 100% show for a beat
        } catch (e) {
            console.warn("[notification-detail] live counts failed:", e);
            liveState = "fail";
        } finally {
            clearInterval(liveTimer);
        }
    }

    function isSubmit(n) {
        return n && n.moduleCode === "ReasonArrear_Submit";
    }

    function snapshotItems(n) {
        const x = n.extra || {};
        if (isSubmit(n)) return x.clients || [];
        return (n.type === "smart_alert" ? x.alerts : x.reminders) || [];
    }

    function itemsOf(n) {
        return n.type === "officer_reminder" && live ? live.reminders : snapshotItems(n);
    }

    function hhmm(iso) {
        const d = new Date(iso);
        return Number.isNaN(d.getTime()) ? "" : `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
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

    // Same controls as Daily Arrears › ការងារត្រូវបំពេញ: a branch dropdown
    // and an All / CO / FSRO segmented switch, side by side. Counts follow
    // the other filter.
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
            html += `
                <select class="nd-branch" aria-label="${esc(t("notifDetail.filterBranch"))}">
                    <option value="">${esc(t("notifDetail.allBranchesLong"))} (${pool.length})</option>
                    ${[...counts.keys()].sort((a, b) => a.localeCompare(b)).map(b =>
                        `<option value="${esc(b)}"${b === branchFilter ? " selected" : ""}>${esc(b)} (${counts.get(b)})</option>`).join("")}
                </select>`;
        }
        if (showPos) {
            const pool = applyFilters(items, { pos: "" });
            const counts = countBy(pool, posOf);
            const seg = (value, label, c) =>
                `<button type="button" class="nd-seg-btn${value === posFilter ? " on" : ""}" data-pos="${value}">${esc(label)}<small>${c}</small></button>`;
            html += `
                <div class="nd-seg" role="tablist" aria-label="${esc(t("notifDetail.filterPosition"))}">
                    ${seg("", t("notifDetail.allBranches"), pool.length)}
                    ${seg("co", t("notifDetail.pos.co"), counts.get("co") || 0)}
                    ${seg("fsro", t("notifDetail.pos.fsro"), counts.get("fsro") || 0)}
                </div>`;
        }
        el.filter.innerHTML = `<div class="nd-filter-bar${showBranch && showPos ? "" : " single"}">${html}</div>`;
        el.filter.hidden = false;
    }

    function render() {
        renderFilter(current);
        if (isSubmit(current)) renderSubmit(current);
        else if (current.type === "smart_alert") renderSmartAlert(current);
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
            if (typeof loadNotificationBadge === "function") loadNotificationBadge(true);
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
        const list = applyFilters(itemsOf(n)).slice()
            .sort((a, b) => (b.unfilled + b.expired + b.outArea) - (a.unfilled + a.expired + a.outArea));
        const sum = k => list.reduce((s, r) => s + (Number(r[k]) || 0), 0);
        const slot = n.extra && n.extra.slot;
        const time = slot === "09" ? "9:00" : slot === "15" ? "15:00" : "";

        el.hero.innerHTML = `
            <div class="nd-hero-top">
                <span class="nd-hero-ico"><span class="ui-ico ui-ico-clipboard" aria-hidden="true"></span></span>
                <div>
                    <div class="nd-hero-title">${esc(t("notifDetail.remindTitle"))}</div>
                    <div class="nd-hero-sub">${live
                        ? `<span class="nd-live-dot" aria-hidden="true"></span>${esc(t("notifDetail.liveAt", { time: hhmm(live.at) }))}`
                        : esc([dmy(n.extra && n.extra.date), time].filter(Boolean).join(" · "))}${list.length > 1 ? " · " + esc(t("notifDetail.officerCount", { n: list.length })) : ""}</div>
                </div>
            </div>
            <div class="nd-stats">
                ${REMIND.map(m => `<div class="nd-stat nd-stat-${m.key}"><b>${sum(m.key)}</b><span>${esc(t(m.label))}</span></div>`).join("")}
            </div>
            ${(() => {
                const sent = applyFilters(snapshotItems(n));
                const sentSum = k => sent.reduce((s2, r) => s2 + (Number(r[k]) || 0), 0);
                const sentLine = t("notifDetail.sentAt", { time: time || dmy(n.extra && n.extra.date), a: sentSum("unfilled"), b: sentSum("expired"), c: sentSum("outArea") });
                if (live) return `<div class="nd-hero-foot">${esc(sentLine)}</div>`;
                if (liveState === "loading") {
                    const pct = liveStarted ? livePct() : 0;
                    return `<div class="nd-hero-foot nd-live-loading">
                        <span class="nd-spin" aria-hidden="true"></span>${esc(t("notifDetail.liveLoading"))}
                        <b id="ndLivePct">${pct}%</b>
                        <span class="nd-live-track"><span id="ndLiveBar" style="width:${pct}%"></span></span>
                    </div>`;
                }
                if (liveState === "fail") return `<div class="nd-hero-foot">${esc(t("notifDetail.liveFailed"))}</div>`;
                return "";
            })()}
            ${userRole() === "viewer_staff" ? "" : `<a class="nd-work-btn" href="/CM_Pro/pages/masterdata/work.html?${new URLSearchParams({ tab: "unfilled", ...(branchFilter ? { branch: branchFilter } : {}) })}">
                <span class="ui-ico ui-ico-clipboard" aria-hidden="true"></span>${esc(t("notifDetail.openWork"))}<span class="ui-ico ui-ico-chevron-right" aria-hidden="true"></span>
            </a>`}`;

        el.body.innerHTML = list.length
            ? `<p class="nd-hint nd-hint-top">${esc(t("notifDetail.remindHint"))}</p>
               <div class="nd-list">${list.map(officerCard).join("")}</div>`
            : `<p class="nd-hint">${esc(n.message || "")}</p>`;
    }

    // ---------- Reason Arrear submitted ----------
    function whenOf(iso) {
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return "";
        const p = v => String(v).padStart(2, "0");
        return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
    }

    // The five parts: the notification's own (sent since 17/11/2026), else
    // split out of the combined aj / ak older ones carry.
    const PART_LABELS = [
        ["occupationLoan", "notifDetail.part.occLoan"],
        ["occupationNow", "notifDetail.part.occNow"],
        ["purpose", "notifDetail.part.purpose"],
        ["reason", "notifDetail.part.reason"],
        ["solution", "notifDetail.part.solution"]
    ];
    function partsOfClient(c) {
        if (window.ReasonKit) return ReasonKit.partsOf(c);
        return { occupationLoan: c.aj || "", occupationNow: "", purpose: "", reason: c.ak || "", solution: "" };
    }

    function todayKey() {
        const d = new Date();
        const p = v => String(v).padStart(2, "0");
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    }

    // Promise date against today: upcoming (in N days) / today / passed.
    function promiseState(al) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(al || ""))) return null;
        const diff = Math.round((Date.parse(al) - Date.parse(todayKey())) / 86400000);
        if (diff < 0) return { cls: "past", note: t("notifDetail.promisePassed") };
        if (diff === 0) return { cls: "today", note: t("notifDetail.promiseToday") };
        return { cls: "soon", note: t("notifDetail.promiseIn", { n: diff }) };
    }

    const canOpenWork = () => userRole() !== "viewer_staff";

    function clientCard(c) {
        const day = parseInt(c.day, 10);
        const meta = [c.ld, c.cif ? `CIF ${c.cif}` : "", c.officer, c.branch].filter(Boolean).join(" · ");
        const parts = partsOfClient(c);
        const ps = promiseState(c.al);
        const rows = PART_LABELS.map(([k, label]) => {
            const v = String(parts[k] || "").trim();
            return `<div class="nd-part${v ? "" : " nd-part-empty"}"><span>${esc(t(label))}</span><b>${esc(v || "—")}</b></div>`;
        }).join("");
        const ld = String(c.ld || "").trim();
        const open = canOpenWork() && ld && c.customer
            ? `<a class="nd-client-open" href="/CM_Pro/pages/masterdata/work.html?${new URLSearchParams({ q: ld })}">${esc(t("notifDetail.openClient"))}<span class="ui-ico ui-ico-chevron-right" aria-hidden="true"></span></a>`
            : "";
        return `
            <div class="nd-card nd-client">
                <div class="nd-client-head">
                    <span class="nd-who"><b>${esc(c.customer || c.ld || "-")}</b><small>${esc(meta)}</small></span>
                    ${Number.isFinite(day) ? `<span class="nd-client-day">${esc(t("notifDetail.daysLate", { n: day }))}</span>` : ""}
                </div>
                <div class="nd-parts">${rows}</div>
                <div class="nd-client-foot">
                    ${ps ? `<span class="nd-client-promise nd-promise-${ps.cls}"><span class="ui-ico ui-ico-calendar" aria-hidden="true"></span>${esc(t("notifDetail.promiseOn", { d: dmy(c.al) }))}<small>${esc(ps.note)}</small></span>`
                         : `<span class="nd-client-promise nd-promise-none">${esc(t("notifDetail.noPromise"))}</span>`}
                    ${open}
                </div>
            </div>`;
    }

    let submitQuery = "";

    function matchesQuery(c, q) {
        if (!q) return true;
        return [c.customer, c.ld, c.cif, c.officer, c.concate].join(" ").toLowerCase().includes(q);
    }

    function paintSubmitList(list) {
        const q = submitQuery.trim().toLowerCase();
        const shown = list.filter(c => matchesQuery(c, q));
        const box = document.getElementById("ndSubmitList");
        if (!box) return;
        box.innerHTML = shown.length
            ? shown.map(clientCard).join("")
            : `<p class="nd-hint">${esc(t("notifDetail.noMatch"))}</p>`;
    }

    function renderSubmit(n) {
        const x = n.extra || {};
        const list = applyFilters(x.clients || []);
        const who = [x.submittedByName, x.submittedBy || n.createdBy].filter(Boolean);
        const states = list.map(c => promiseState(c.al));
        const withPromise = states.filter(Boolean).length;
        const passed = states.filter(s => s && s.cls === "past").length;
        el.hero.innerHTML = `
            <div class="nd-hero-top">
                <span class="nd-hero-ico"><span class="ui-ico ui-ico-edit" aria-hidden="true"></span></span>
                <div>
                    <div class="nd-hero-title">${esc(t("notifDetail.submitTitle"))}</div>
                    <div class="nd-hero-sub">${esc([who.length > 1 ? `${who[0]} (${who[1]})` : who[0], whenOf(n.createdAt), x.source === "excel" ? t("notifDetail.viaExcel") : ""].filter(Boolean).join(" · "))}</div>
                </div>
            </div>
            <div class="nd-stats">
                <div class="nd-stat"><b>${list.length}</b><span>${esc(t("notifDetail.statClients"))}</span></div>
                <div class="nd-stat nd-stat-promise"><b>${withPromise}</b><span>${esc(t("notifDetail.statPromise"))}</span></div>
                <div class="nd-stat nd-stat-passed"><b>${passed}</b><span>${esc(t("notifDetail.statPassed"))}</span></div>
            </div>`;
        if (!list.length) {
            el.body.innerHTML = `<p class="nd-hint">${esc(n.message || "")}</p>`;
            return;
        }
        el.body.innerHTML = `
            ${list.length > 5 ? `<div class="nd-search"><span class="ui-ico ui-ico-search" aria-hidden="true"></span><input type="search" id="ndSubmitSearch" autocomplete="off" placeholder="${esc(t("notifDetail.searchClient"))}" value="${esc(submitQuery)}"></div>` : ""}
            <div class="nd-list" id="ndSubmitList"></div>`;
        paintSubmitList(list);
        document.getElementById("ndSubmitSearch")?.addEventListener("input", e => {
            submitQuery = e.target.value;
            paintSubmitList(list);
        });
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
        if (!n || (n.type !== "smart_alert" && n.type !== "officer_reminder" && !isSubmit(n))) {
            el.empty.style.display = "";
            return;
        }
        el.hero.hidden = false;
        current = n;
        el.filter.addEventListener("click", e => {
            const b = e.target.closest(".nd-seg-btn");
            if (!b) return;
            posFilter = b.dataset.pos || "";
            render();
        });
        el.filter.addEventListener("change", e => {
            if (!e.target.classList.contains("nd-branch")) return;
            branchFilter = e.target.value;
            render();
        });
        render();
        if (!n.isRead) markRead();
        if (n.type === "officer_reminder") {
            loadLive().then(render);
            render(); // shows "loading live…" until it lands
        }
    }

    init();
})();
