/* =========================================================
   ASSISTANT CHAT (CM Pro AI — Level 1)
   A chat sheet on the Home page's assistant box: type or speak a
   question in Khmer or English and get an answer from the real data,
   or a shortcut into the app.

   - assistant-nlu.js decides what was asked (no AI service).
   - Figures come from GET /api/assistant/overview (CM-backend
     lib/assistant-data.js): the latest Daily Monitoring snapshot,
     already scoped by the server to what this user may see — admin
     every branch, a branch manager their branch, a CO their own row.
   - Today's work (unfilled Reason Arrear, expired promises, promises
     due today, no officer responsible) comes from GET
     /api/assistant/work, scoped like Work to complete.
   - Voice uses the browser's speech recognition in Khmer (km-KH) or
     English (en-US); the choice is shared with the mic sheet.

   Public: CMAssistantChat.open(question?), .voiceLang(),
   .loadWork(), .workQuestion(kind)
========================================================= */
(function () {
    "use strict";

    const t = (key, vars) => (window.CMI18n ? CMI18n.t(key, vars) : key);
    const N = () => window.CMAssistantNLU;

    const OVERVIEW_KEY = "cm_asst_overview2"; // bumped when the overview gains fields
    const OVERVIEW_TTL = 10 * 60 * 1000;
    const HISTORY_KEY = "cm_asst_chat";
    const MAX_HISTORY = 40;

    const PAGE_URLS = {
        customers: "/CM_Pro/pages/customers/index.html",
        arrears: "/CM_Pro/pages/arrears/index.html",
        turnover: "/CM_Pro/pages/turnover/index.html",
        spotcheck: "/CM_Pro/pages/spotcheck/index.html",
        officertask: "/CM_Pro/pages/officertask/index.html",
        creditReport: "/CM_Pro/pages/creditreport/index.html",
        creditReportBranch: "/CM_Pro/pages/creditreport/RepDetailbyBranch.html",
        creditReportCO: "/CM_Pro/pages/creditreport/RepDetailbyCO.html",
        portfolioOverview: "/CM_Pro/pages/creditreport/PortfolioIntelligence.html",
        nplManagement: "/CM_Pro/pages/creditreport/NplIntelligence.html",
        riskIntelligence: "/CM_Pro/pages/creditreport/RiskIntelligence.html?view=contributors",
        earlyWarning: "/CM_Pro/pages/creditreport/EarlyWarning.html",
        masterData: "/CM_Pro/pages/masterdata/index.html",
        work: "/CM_Pro/pages/masterdata/work.html",
        outArea: "/CM_Pro/pages/masterdata/outarea.html",
        lgs: "/CM_Pro/pages/masterdata/lgs.html",
        land: "/CM_Pro/pages/landClassisfy/index.html",
        loanCalculator: "/CM_Pro/pages/loanCalculate/index.html",
        retirement: "/CM_Pro/pages/retirement/index.html",
        notifications: "/CM_Pro/pages/notifications/index.html",
        settings: "/CM_Pro/pages/settings/index.html",
        home: "/CM_Pro/index.html"
    };

    // Every branch the reports know, so a question about a branch the
    // user can't see gets "not in your scope" instead of "not found".
    const ALL_BRANCHES = ["Svay Rieng", "Romeas Haek", "Kraol Kou", "Nhor", "Svay Teab", "Rumduol", "Svay Chrom"];

    // A worse direction per metric: PAR / NPL going up is bad news,
    // OS / disbursement going down is.
    const UP_IS_GOOD = { os: true, disb: true, par: false, overdue: false, npl: false, wo: false };

    function esc(s) {
        return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    }

    function usd(n) {
        return "$" + Math.round(Number(n) || 0).toLocaleString("en-US");
    }

    function usdShort(n) {
        const v = Number(n) || 0;
        if (Math.abs(v) >= 1e6) return "$" + (v / 1e6).toFixed(2) + "M";
        if (Math.abs(v) >= 1e3) return "$" + (v / 1e3).toFixed(1) + "K";
        return "$" + Math.round(v);
    }

    // The snapshot stores PAR / NPL shares as fractions (0.1388 = 13.88%).
    function pct(fraction) {
        return (Math.round((Number(fraction) || 0) * 10000) / 100) + "%";
    }

    // A change in percent: one decimal, or two when it would round to 0.
    function changePct(delta, base) {
        const v = Math.abs(delta / base * 100);
        return (v < 0.1 ? Math.round(v * 100) / 100 : Math.round(v * 10) / 10) + "%";
    }

    // ---------- voice language ----------
    // Voice follows the app language the user chose (Settings).
    function voiceLang() {
        return (window.CMLanguage && CMLanguage.get()) === "en" ? "en" : "km";
    }

    // What to tell the user when speech recognition fails to start, by
    // its error code; null for errors that need no message. iPhone /
    // iPad (WebKit) answer Khmer with "service-not-allowed" — Apple's
    // speech service has no Khmer — which used to read as "microphone
    // blocked" although the mic was fine; in English the same code
    // means Siri / Dictation is off.
    function voiceErrorText(code) {
        if (code === "not-allowed") return t("voice.micBlockedHelp");
        if (code === "language-not-supported" || (code === "service-not-allowed" && voiceLang() === "km")) {
            return t("voice.kmUnsupported");
        }
        if (code === "service-not-allowed") return t("voice.dictationOff");
        return null;
    }

    function speechCode() {
        return voiceLang() === "en" ? "en-US" : "km-KH";
    }

    // ---------- data ----------
    // compare: { mode: prev|month|year|date, date } or null for the
    // admin's default (Admin → Smart Alerts → CM Pro AI comparison).
    async function loadOverview(compare) {
        const query = compare
            ? `?compare=${encodeURIComponent(compare.mode)}${compare.date ? `&date=${encodeURIComponent(compare.date)}` : ""}`
            : "";
        const cacheKey = OVERVIEW_KEY + query;
        try {
            const hit = JSON.parse(sessionStorage.getItem(cacheKey) || "null");
            if (hit && Date.now() - hit.at < OVERVIEW_TTL) return hit.data;
        } catch (e) {}
        const data = await API.get("/api/assistant/overview" + query);
        if (!data || !data.ok) throw new Error((data && data.message) || "overview failed");
        try { sessionStorage.setItem(cacheKey, JSON.stringify({ at: Date.now(), data })); } catch (e) {}
        return data;
    }

    // ---------- today's work ----------
    // GET /api/assistant/work?kind=&branch=&team=&officer= answers one
    // level of a drill-down — branches, then a branch's officers (with a
    // CO / FSRO switch), then an officer's clients (a CO starts on their
    // own clients). Tapping a
    // row, a tile or the path above redraws the same card in place.
    const WORK_KEY = "cm_asst_work2";
    const WORK_TTL = 2 * 60 * 1000;
    const WORK_KINDS = ["unfilled", "expired", "promiseToday", "noOfficer"];
    // The same line icons as Work to complete (base.css .ui-ico-*).
    const WORK_ICONS = { all: "clipboard", unfilled: "edit", expired: "clock", promiseToday: "calendar", noOfficer: "pin" };

    function ico(name, extra) {
        return `<span class="ui-ico ui-ico-${name}${extra ? " " + extra : ""}" aria-hidden="true"></span>`;
    }

    async function loadWork({ kind = "all", branch = "", team = "", officer = "" } = {}, { fresh = false } = {}) {
        const query = new URLSearchParams({ kind, ...(branch ? { branch } : {}), ...(team ? { team } : {}), ...(officer ? { officer } : {}) }).toString();
        const key = `${WORK_KEY}?${query}`;
        if (!fresh) {
            try {
                const hit = JSON.parse(sessionStorage.getItem(key) || "null");
                if (hit && Date.now() - hit.at < WORK_TTL) return hit.data;
            } catch (e) {}
        }
        const data = await API.get(`/api/assistant/work?${query}`);
        if (!data || !data.ok) throw new Error((data && data.message) || "work failed");
        try { sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), data })); } catch (e) {}
        return data;
    }

    // The question a work tile asks, in the app's language.
    function workQuestion(kind) {
        return t(`assistant.chip.work.${kind}`);
    }

    function userRole() {
        try {
            return String(JSON.parse(localStorage.getItem("loggedInUser") || sessionStorage.getItem("loggedInUser") || "{}").role || "").toLowerCase();
        } catch (e) {
            return "";
        }
    }

    // Where to go and fill / fix them.
    function workLink(kind, branch) {
        if (kind === "noOfficer") {
            const r = userRole();
            return r === "admin" || r === "user"
                ? { href: PAGE_URLS.outArea, label: t("assistant.work.openOutArea") }
                : { href: `${PAGE_URLS.arrears}?work=outarea${branch ? `&branch=${encodeURIComponent(branch)}` : ""}`, label: t("assistant.work.openOutArea") };
        }
        const tab = kind === "expired" ? "expired" : kind === "promiseToday" ? "filled" : "unfilled";
        return { href: `${PAGE_URLS.work}?tab=${tab}${branch ? `&branch=${encodeURIComponent(branch)}` : ""}`, label: t("assistant.work.openWork") };
    }

    function workAttr(kind, path) {
        return esc(JSON.stringify({ kind, branch: path.branch || "", team: path.team || "", officer: path.officer || "" }));
    }

    // Four count tiles; a tile switches the work card to that kind at
    // the same branch / officer.
    function workTiles(data, active, path) {
        return `<div class="ac-work-tiles">${WORK_KINDS.map(k => `
            <button type="button" class="ac-wtile ac-wtile-${k}${k === active ? " on" : ""}" data-work="${workAttr(k, path)}">
                ${ico(WORK_ICONS[k], "ac-wtile-ico")}
                <b>${(Number(data.counts[k]) || 0).toLocaleString("en-US")}</b>
                <span>${esc(t(`assistant.work.${k}`))}</span>
            </button>`).join("")}</div>`;
    }

    function officerLabel(key, kind) {
        if (key === "-") return t("assistant.work.noName");
        return kind === "noOfficer" ? `ID ${key}` : key;
    }

    // All branches › Svay Rieng › Sok Dara — each step goes back up.
    function workCrumbs(kind, path) {
        if (!path.branch && !path.officer) return "";
        const steps = [{ label: t("assistant.work.allBranches"), p: {} }];
        if (path.branch) steps.push({ label: path.branch, p: { branch: path.branch } });
        if (path.officer) steps.push({ label: officerLabel(path.officer, kind), p: { branch: path.branch, team: path.team, officer: path.officer } });
        return `<div class="ac-crumbs">${steps.map((s, i) => i === steps.length - 1
            ? `<span class="ac-crumb on">${esc(s.label)}</span>`
            : `<button type="button" class="ac-crumb" data-work="${workAttr(kind, s.p)}">${esc(s.label)}</button>${ico("chevron-right", "ac-crumb-sep")}`).join("")}</div>`;
    }

    function groupRow(g, data) {
        const kind = data.kind;
        const atBranch = data.level === "branch";
        const next = atBranch ? { branch: g.key } : { branch: data.path.branch || g.branch, team: data.path.team, officer: g.key };
        const counts = kind === "all"
            ? `<span class="ac-wn ac-wn-unfilled">${ico("edit")}${g.unfilled}</span><span class="ac-wn ac-wn-expired">${ico("clock")}${g.expired}</span>`
            : `<span class="ac-wn ac-wn-${kind}">${g.count.toLocaleString("en-US")}</span>`;
        return `
            <button type="button" class="ac-wrow" data-work="${workAttr(kind, next)}">
                <span class="ac-wrow-ico">${ico(atBranch ? "users" : "officer")}</span>
                <span class="ac-wrow-main"><b>${esc(atBranch ? g.key : officerLabel(g.key, kind))}${!atBranch && g.team ? ` <span class="ac-team ac-team-${esc(g.team.toLowerCase())}">${esc(g.team)}</span>` : ""}</b>${!atBranch && !data.path.branch && g.branch ? `<small>${esc(g.branch)}</small>` : ""}</span>
                ${counts}
                ${ico("chevron-right", "ac-wrow-go")}
            </button>`;
    }

    function clientRow(c, kind) {
        const day = Number(c.day);
        const right = kind === "noOfficer"
            ? `<span class="ac-cl-amt">${esc(usd(c.arreas))}${c.ccy && c.ccy !== "USD" ? ` ${esc(c.ccy)}` : ""}</span>`
            : (kind === "expired" || kind === "promiseToday") && c.al
                ? `<span class="ac-cl-date ac-cl-${kind}">${ico("calendar")}${esc(dmy(c.al))}</span>`
                : `<span class="ac-cl-day">${esc(t("assistant.work.days", { n: day }))}</span>`;
        const who = kind === "noOfficer" ? (c.coId ? `ID ${c.coId}` : "") : c.officer;
        return `
            <div class="ac-client">
                <div class="ac-client-main">
                    <b>${esc(c.customer || c.ld || "-")}</b>
                    <small>${esc([c.ld, c.cif ? `CIF ${c.cif}` : ""].filter(Boolean).join(" · "))}</small>
                    ${who || c.branch ? `<small class="ac-client-who">${ico("officer")}${esc([who, c.branch].filter(Boolean).join(" · "))}</small>` : ""}
                </div>
                ${right}
            </div>`;
    }

    // All | CO | FSRO over a branch's officers — counts for this question.
    function teamSwitch(data) {
        const p = data.path || {};
        const tm = data.teams || {};
        const atOfficers = !p.officer && (data.level === "officer" || p.team);
        if (!atOfficers || (!p.team && !(tm.CO && tm.FSRO))) return ""; // nothing to split
        const btn = (team, label, n) => `<button type="button" class="${(p.team || "") === team ? "on" : ""}" data-work="${workAttr(data.kind, { branch: p.branch, team })}">${esc(label)} <small>${(n || 0).toLocaleString("en-US")}</small></button>`;
        return `<div class="ac-cmp ac-teams" role="group" aria-label="${esc(t("assistant.work.team"))}">
            ${btn("", t("assistant.work.teamAll"), (tm.CO || 0) + (tm.FSRO || 0))}${btn("CO", "CO", tm.CO)}${btn("FSRO", "FSRO", tm.FSRO)}
        </div>`;
    }

    async function answerWork(intent, path = {}) {
        const kind = intent.kind || "all";
        let data;
        try {
            data = await loadWork({ kind, branch: path.branch, team: path.team, officer: path.officer });
        } catch (e) {
            return { html: esc(t("assistant.loadFailed")) };
        }
        const here = data.path || {};
        const n = Number(data.total) || 0;
        const lead = kind === "all"
            ? (n || data.counts.promiseToday || data.counts.noOfficer ? t("assistant.work.leadAll", { n: n.toLocaleString("en-US") }) : t("assistant.work.allDone"))
            : n ? t(`assistant.work.lead.${kind}`, { n: n.toLocaleString("en-US") }) : t(`assistant.work.none.${kind}`);
        const link = workLink(kind === "all" ? "unfilled" : kind, here.branch);
        const levelHint = data.level === "branch" ? t("assistant.work.byBranch")
            : data.level === "officer" ? t("assistant.work.byOfficer")
            : n > data.clients.length ? t("assistant.work.showing", { n: data.clients.length, total: n.toLocaleString("en-US") })
            : "";
        const body = data.level === "client"
            ? (data.clients.length ? `<div class="ac-clients">${data.clients.map(c => clientRow(c, kind)).join("")}</div>` : "")
            : `<div class="ac-wrows">${data.groups.map(g => groupRow(g, data)).join("")}</div>`;
        return {
            html: `
                <p>${esc(lead)}</p>
                <div class="ac-card ac-work" data-kind="${esc(kind)}">
                    <div class="ac-card-head">
                        <span class="ac-card-who">${ico(WORK_ICONS[kind], "ac-head-ico")}${esc(t(`assistant.work.title.${kind}`))}</span>
                        <span class="ac-card-date">${esc(dmy(data.today))}</span>
                    </div>
                    ${workCrumbs(kind, here)}
                    ${workTiles(data, kind === "all" ? null : kind, here)}
                    ${teamSwitch(data)}
                    ${n && levelHint ? `<div class="ac-foot ac-work-sub">${esc(levelHint)}</div>` : ""}
                    ${n ? body : ""}
                    ${n ? `<a class="ac-link" href="${esc(link.href)}">${esc(link.label)} ›</a>` : ""}
                </div>`
        };
    }

    // A row / tile / crumb in a work card: redraw that card in place.
    async function workDrill(el) {
        const msg = el.closest(".ac-msg");
        const bubble = msg && msg.querySelector(".ac-bubble");
        if (!bubble || busy) return;
        let q;
        try { q = JSON.parse(el.dataset.work); } catch (e) { return; }
        busy = true;
        bubble.classList.add("ac-loading");
        const reply = await answerWork({ kind: q.kind }, { branch: q.branch, team: q.team, officer: q.officer })
            .catch(() => ({ html: esc(t("assistant.loadFailed")) }));
        bubble.innerHTML = reply.html;
        bubble.classList.remove("ac-loading");
        const i = Number(msg.dataset.h);
        if (Number.isInteger(i) && history[i]) {
            history[i].html = reply.html;
            saveHistory();
        }
        busy = false;
        msg.scrollIntoView({ block: "nearest" });
    }

    // ---------- answer building ----------
    function metricLabel(m) {
        return t(`assistant.metric.${m}`);
    }

    function whoLabel(row, data) {
        if (!row || row === data.total) {
            const s = data.scope || {};
            if (s.type === "branch") return t("assistant.who.branch", { branch: s.branch });
            if (s.type === "officer") return t("assistant.who.me");
            return t("assistant.who.all");
        }
        if (row.id != null && row.name != null) return t("assistant.who.officer", { name: row.name || row.id, id: row.id, branch: row.branch || "" });
        return t("assistant.who.branch", { branch: row.branch });
    }

    // One "+1.2%" pill comparing to the comparison snapshot.
    function changePill(metric, cur, prev) {
        if (!prev) return "";
        const field = metric;
        const a = Number(prev[field]) || 0;
        const b = Number(cur[field]) || 0;
        const delta = b - a;
        if (!delta) return `<span class="ac-pill flat">0</span>`;
        const good = (delta > 0) === UP_IS_GOOD[metric];
        const sign = delta > 0 ? "+" : "−";
        const body = metric === "npl"
            ? `${sign}${Math.abs(delta)}`
            : a ? `${sign}${changePct(delta, a)}` : `${sign}${usdShort(Math.abs(delta))}`;
        return `<span class="ac-pill ${good ? "good" : "bad"}">${delta > 0 ? "▲" : "▼"} ${body}</span>`;
    }

    function metricValue(metric, r) {
        if (metric === "os") return usd(r.os);
        if (metric === "par") return usd(r.par);
        if (metric === "overdue") return usd(r.overdue);
        if (metric === "wo") return usd(r.wo);
        if (metric === "npl") return t("assistant.accounts", { n: r.npl });
        return usd(r.disb);
    }

    function metricSub(metric, r) {
        if (metric === "os") return t("assistant.sub.os", { loans: r.loans.toLocaleString("en-US"), clients: r.clients.toLocaleString("en-US") });
        if (metric === "par") return t("assistant.sub.par", { pct: pct(r.parPct), loans: (r.parLoans || 0).toLocaleString("en-US") });
        if (metric === "overdue") return t("assistant.sub.overdue", { pct: pct(r.overduePct), loans: (r.overdueLoans || 0).toLocaleString("en-US") });
        if (metric === "wo") return t("assistant.sub.wo", { n: r.woCount || 0, balance: usd(r.woBalance), collected: usd(r.woCollected) });
        if (metric === "npl") return t("assistant.sub.npl", { value: usd(r.nplValue), pct: pct(r.nplPct) });
        return t("assistant.sub.disb", { loans: r.disbLoans });
    }

    // RepDetailbyCO reads ?branch= (its branch filter); the by-branch
    // report already lists every branch side by side.
    function reportLink(row, data) {
        const isOfficer = row && row.id != null && row.name != null;
        if (isOfficer || (data.scope || {}).type === "officer") {
            const branch = row && row.branch;
            return {
                href: PAGE_URLS.creditReportCO + (branch ? `?branch=${encodeURIComponent(branch)}` : ""),
                label: t("assistant.openCoReport")
            };
        }
        return { href: PAGE_URLS.creditReportBranch, label: t("assistant.openBranchReport") };
    }

    // What the card is compared with, and buttons to change it. q is the
    // question that produced the card, re-asked with the new comparison.
    function compareBar(row, data, q, prevDate) {
        const mode = (data.compare && data.compare.mode) || "prev";
        const foot = row.prev && prevDate
            ? t(`assistant.vs.${mode}`, { date: prevDate })
            : t("assistant.vs.none");
        const btn = m => `<button type="button" data-cmp="${m}" class="${m === mode ? "on" : ""}">${esc(t(`assistant.cmp.${m}`))}</button>`;
        return `
            <div class="ac-foot">${esc(foot)}</div>
            <div class="ac-cmp" data-q="${esc(q)}">
                ${btn("prev")}${btn("month")}${btn("year")}
                <label class="${mode === "date" ? "on" : ""}" title="${esc(t("assistant.cmp.date"))}">📅
                    <input type="date" class="ac-cmp-date" value="${esc(mode === "date" && data.compare.date ? data.compare.date : "")}" aria-label="${esc(t("assistant.cmp.date"))}">
                </label>
            </div>`;
    }

    function isAdmin() {
        try {
            const u = JSON.parse(localStorage.getItem("loggedInUser") || sessionStorage.getItem("loggedInUser") || "{}");
            return String(u.role || "").toLowerCase() === "admin";
        } catch (e) {
            return false;
        }
    }

    function dmy(d) {
        const [y, m, day] = String(d || "").split("-");
        return day ? `${day}-${m}-${y}` : String(d || "");
    }

    // The figures come from the latest Daily History snapshot; when the
    // reports' live data is already newer (uploaded, not yet snapshotted
    // — that happens automatically after 18:00), say so, so a CO's
    // numbers here aren't mistaken for wrong. Admins can save it now.
    function staleNote(data, date, q) {
        if (!data.liveDate || !date || data.liveDate <= date) return "";
        return `
            <div class="ac-stale" data-q="${esc(q)}">
                <span>⚠️ ${esc(t("assistant.stale", { date: dmy(date), live: dmy(data.liveDate) }))}</span>
                ${isAdmin() ? `<button type="button" class="ac-snap">${esc(t("assistant.snapNow"))}</button>` : ""}
            </div>`;
    }

    // Same 4 reports the Credit Report hub's "Snapshot All" saves.
    const SNAPSHOT_URLS = [
        "/api/creditreport/summary/snapshot/run",
        "/api/creditreport/byco/snapshot/run",
        "/api/creditreport/byproduct/snapshot/run",
        "/api/creditreport/bylocation/snapshot/run"
    ];

    async function snapshotNow(btn) {
        const note = btn.closest(".ac-stale");
        if (busy || !note) return;
        btn.disabled = true;
        btn.textContent = t("assistant.snapSaving");
        const results = await Promise.all(SNAPSHOT_URLS.map(u => API.post(u, {}).catch(e => ({ ok: false, message: e.message }))));
        const failed = results.find(r => !r || !r.ok);
        if (failed) {
            btn.disabled = false;
            btn.textContent = t("assistant.snapNow");
            note.querySelector("span").textContent = "⚠️ " + t("assistant.snapFailed", { msg: (failed && failed.message) || "" });
            return;
        }
        try {
            Object.keys(sessionStorage).filter(k => k.startsWith(OVERVIEW_KEY)).forEach(k => sessionStorage.removeItem(k));
        } catch (e) {}
        recompare(note, null);
    }

    function statCard(row, data, metrics, q) {
        const date = row.id != null ? (data.officerDate || data.date) : data.date;
        const prevDate = row.id != null ? (data.officerPrevDate || data.prevDate) : data.prevDate;
        const link = reportLink(row, data);
        return `
            <div class="ac-card">
                <div class="ac-card-head">
                    <span class="ac-card-who">${esc(whoLabel(row, data))}</span>
                    <span class="ac-card-date">${esc(date || "")}</span>
                </div>
                ${staleNote(data, date, q)}
                ${metrics.map(m => `
                    <div class="ac-row ac-${m}">
                        <div class="ac-row-main">
                            <span class="ac-k">${esc(metricLabel(m))}</span>
                            <span class="ac-v">${esc(metricValue(m, row))}</span>
                            ${changePill(m, row, row.prev)}
                        </div>
                        <div class="ac-sub">${esc(metricSub(m, row))}</div>
                    </div>`).join("")}
                ${compareBar(row, data, q, prevDate)}
                <a class="ac-link" href="${esc(link.href)}">${esc(link.label)} ›</a>
            </div>`;
    }

    function rankKey(metric) {
        return { par: "parPct", overdue: "overduePct", npl: "npl", os: "os", disb: "disb", wo: "wo", summary: "overduePct" }[metric] || "overduePct";
    }

    function rankValue(metric, r, by) {
        if (metric === "par") return `${pct(r.parPct)} · ${usdShort(r.par)}`;
        if (metric === "overdue" || metric === "summary") return `${pct(r.overduePct)} · ${usdShort(r.overdue)}`;
        if (metric === "wo") return `${usdShort(r.wo)} · ${r.woCount || 0}`;
        if (metric === "npl") return `${t("assistant.accounts", { n: r.npl })} · ${usdShort(r.nplValue)}`;
        if (metric === "os") return usdShort(r.os);
        if (by === "loans") return `${t("assistant.loansN", { n: r.disbLoans || 0 })} · ${usdShort(r.disb)}`;
        return `${usdShort(r.disb)} · ${t("assistant.loansN", { n: r.disbLoans || 0 })}`;
    }

    // Disbursement rankings: by amount or by number of loans. q is the
    // question, re-ranked in place when the other button is tapped.
    function rankByBar(by, q) {
        const btn = b => `<button type="button" data-by="${b}" class="${b === by ? "on" : ""}">${esc(t(`assistant.rankBy.${b}`))}</button>`;
        return `<div class="ac-cmp ac-by" data-q="${esc(q)}">${btn("value")}${btn("loans")}</div>`;
    }

    // Rankings: PAR is ranked by NBC Overdue (what the Credit Report ranks
    // COs by), and COs moved to "Stop Disburse" are left out — they no
    // longer take new loans, so they'd crowd both ends of the list.
    function answerRank(intent, data, q) {
        let level = intent.rank.level;
        let list = level === "branch" ? data.branches : data.officers;
        // A one-branch manager has no other branch to rank against: rank
        // that branch's COs instead, and say so.
        let note = "";
        if (level === "branch" && list.length < 2) {
            level = "officer";
            list = data.officers;
            if ((data.scope || {}).type === "branch") note = t("assistant.rank.branchToCo", { branch: data.scope.branch });
        }
        const metric = intent.metric === "par" ? "overdue" : intent.metric;
        const by = metric === "disb" && intent.rank.by === "loans" ? "loans" : "value";
        const k = by === "loans" ? "disbLoans" : rankKey(metric);
        // CO rankings count only officers whose Position (List Officer)
        // is "Credit Officer" and who aren't in Stop Disburse. Until any
        // position has been set, fall back to excluding Stop Disburse only.
        const active = r => String(r.branch || "").trim().toLowerCase() !== "stop disburse";
        const byPosition = level === "officer" && list.some(r => r.position);
        const eligible = r => level !== "officer" || (active(r) && (!byPosition || r.position === "Credit Officer"));
        const rows = list
            .filter(r => r.os > 0 && eligible(r))
            .sort((a, b) => (intent.rank.dir === "bottom" ? a[k] - b[k] : b[k] - a[k]) || (intent.rank.dir === "bottom" ? a.disb - b.disb : b.disb - a.disb))
            .slice(0, 5);
        if (!rows.length) return { html: esc(t("assistant.noData")) };

        const title = t(`assistant.rank.${intent.rank.dir}`, {
            level: t(`assistant.level.${level}`),
            metric: metricLabel(metric === "summary" ? "overdue" : metric)
        });
        const href = level === "branch" ? PAGE_URLS.creditReportBranch : PAGE_URLS.creditReportCO;
        const date = level === "branch" ? data.date : (data.officerDate || data.date);
        return {
            html: `
                <div class="ac-card">
                    <div class="ac-card-head">
                        <span class="ac-card-who">${esc(title)}</span>
                        <span class="ac-card-date">${esc(date || "")}</span>
                    </div>
                    ${staleNote(data, date, q)}
                    ${note ? `<div class="ac-foot">${esc(note)}</div>` : ""}
                    ${metric === "disb" ? rankByBar(by, q) : ""}
                    ${level === "officer" ? `<div class="ac-foot">${esc(t(byPosition ? "assistant.rank.creditOfficersOnly" : "assistant.rank.activeOnly"))}</div>` : ""}
                    <ol class="ac-rank">
                        ${rows.map(r => `
                            <li>
                                <span class="ac-rank-name">${esc(level === "branch" ? r.branch : (r.name || r.id))}${level === "officer" ? `<small>${esc(r.id)}${r.branch ? " · " + esc(r.branch) : ""}</small>` : ""}</span>
                                <span class="ac-rank-v">${esc(rankValue(metric, r, by))}</span>
                            </li>`).join("")}
                    </ol>
                    <a class="ac-link" href="${href}">${esc(t(level === "branch" ? "assistant.openBranchReport" : "assistant.openCoReport"))} ›</a>
                </div>`
        };
    }

    async function answerAsk(intent, q) {
        let data;
        try {
            data = await loadOverview(intent.compare || null);
        } catch (e) {
            return { html: esc(t("assistant.loadFailed")) };
        }
        if (!data.date && !data.officerDate) return { html: esc(t("assistant.noSnapshot")) };
        if ((data.scope || {}).type === "none") return { html: esc(t("assistant.noScope")) };

        // A Credit Officer sees only their own row — a ranking would just be
        // them at #1, so answer with their own figures and say why.
        if (intent.rank && (data.scope || {}).type === "officer") {
            const own = data.officers[0] || data.total;
            if (!own) return { html: esc(t("assistant.noData")) };
            const m = intent.metric === "par" ? "overdue" : intent.metric;
            return { html: `<p>${esc(t("assistant.rank.ownOnly"))}</p>${statCard(own, data, m === "summary" ? ["os", "overdue", "npl", "disb", "wo"] : [m], q)}` };
        }
        if (intent.rank) return answerRank(intent, data, q);

        const nlu = N();
        let row = nlu.matchOfficer(intent.text, data.officers);
        if (!row) row = nlu.matchBranch(intent.text, data.branches);
        if (!row) {
            const other = nlu.matchBranch(intent.text, ALL_BRANCHES.map(b => ({ branch: b })));
            if (other) return { html: esc(t("assistant.notYourBranch", { branch: other.branch })) };
        }
        row = row || data.total;
        if (!row) return { html: esc(t("assistant.noData")) };

        const metrics = intent.metric === "summary" ? ["os", "overdue", "npl", "disb", "wo"] : [intent.metric];
        const lead = intent.metric === "summary"
            ? t("assistant.lead.summary", { who: whoLabel(row, data) })
            : t("assistant.lead.metric", { metric: metricLabel(intent.metric), who: whoLabel(row, data), value: metricValue(intent.metric, row) });
        return { html: `<p>${esc(lead)}</p>${statCard(row, data, metrics, q)}` };
    }

    // ---------- LGs loans ----------
    // GET /api/creditreport/lgs: loans disbursed this month inside the LGs
    // limit and how many are already refinanced, per branch (Master Data
    // → LGs Loans). A branch named in the question narrows the answer; the
    // per-branch detail stays on the page.
    const LGS_KEY = "cm_asst_lgs";
    const LGS_TTL = 5 * 60 * 1000;

    async function loadLgs() {
        try {
            const hit = JSON.parse(sessionStorage.getItem(LGS_KEY) || "null");
            if (hit && Date.now() - hit.at < LGS_TTL) return hit.data;
        } catch (e) {}
        const data = await API.get("/api/creditreport/lgs");
        if (!data || !data.ok) throw new Error((data && data.message) || "lgs failed");
        try { sessionStorage.setItem(LGS_KEY, JSON.stringify({ at: Date.now(), data })); } catch (e) {}
        return data;
    }

    async function answerLgs(intent) {
        let data;
        try {
            data = await loadLgs();
        } catch (e) {
            return { html: esc(t("assistant.loadFailed")) };
        }
        const branches = data.branches || [];
        const hit = N().matchBranch(intent.text, branches);
        if (!hit) {
            const other = N().matchBranch(intent.text, ALL_BRANCHES.map(b => ({ branch: b })));
            if (other) return { html: esc(t("assistant.notYourBranch", { branch: other.branch })) };
        }
        const row = hit || (branches.length === 1 ? branches[0] : data.total);
        const branch = hit ? hit.branch : branches.length === 1 ? branches[0].branch : "";
        const who = branch || t("assistant.lgs.allBranches");
        const num = n => (Number(n) || 0).toLocaleString("en-US");
        const share = row.lgs ? `${Math.round(row.refinanced / row.lgs * 1000) / 10}%` : "0%";
        const vars = { who, n: num(row.lgs), r: num(row.refinanced), pct: share, from: dmy(data.fromDate), to: dmy(data.toDate) };
        const lead = t(intent.focus === "refinanced" ? "assistant.lgs.leadRefin" : "assistant.lgs.lead", vars);
        const href = PAGE_URLS.lgs + (branch ? `?branch=${encodeURIComponent(branch)}` : "");
        return {
            html: `
                <p>${esc(lead)}</p>
                <div class="ac-card ac-lgs">
                    <div class="ac-card-head">
                        <span class="ac-card-who">${ico("trend-up", "ac-head-ico")}${esc(t("assistant.lgs.title"))}</span>
                        <span class="ac-card-date">${esc(dmy(data.fromDate))} → ${esc(dmy(data.toDate))}</span>
                    </div>
                    <div class="ac-foot ac-lgs-who">${ico("pin")} ${esc(who)}</div>
                    <div class="ac-lgs-tiles">
                        <div class="ac-lgs-tile"><b>${num(row.lgs)}</b><span>${esc(t("assistant.lgs.tileLgs"))}</span><small>${esc(t("assistant.lgs.ofDisbursed", { n: num(row.disbursed) }))}</small></div>
                        <div class="ac-lgs-tile ac-lgs-refin"><b>${num(row.refinanced)}</b><span>${esc(t("assistant.lgs.tileRefin"))}</span><small>${esc(t("assistant.lgs.share", { pct: share }))}</small></div>
                    </div>
                    <a class="ac-link" href="${esc(href)}">${esc(t("assistant.lgs.open"))} ›</a>
                </div>`
        };
    }

    async function answerAlerts() {
        try {
            const data = await API.get("/api/notifications/my?limit=50");
            const items = data && data.ok && Array.isArray(data.items) ? data.items : [];
            const n = items.find(x => x.type === "smart_alert" && Array.isArray(x.extra?.alerts) && x.extra.alerts.length);
            if (!n) return { html: esc(t("assistant.noAlerts")) };
            const describe = typeof describeSmartAlert === "function" ? describeSmartAlert : a => a.kind;
            const icon = typeof alertIcon === "function" ? alertIcon : () => "⚠️";
            return {
                html: `
                    <p>${esc(t("assistant.alertsLead", { n: n.extra.alerts.length, date: n.extra.date || "" }))}</p>
                    <div class="ac-card">
                        ${n.extra.alerts.slice(0, 8).map(a => `<div class="ac-alert">${icon(a.kind)} ${esc(describe(a))}</div>`).join("")}
                        ${n.extra.alerts.length > 8 ? `<div class="ac-foot">${esc(t("assistant.more", { n: n.extra.alerts.length - 8 }))}</div>` : ""}
                    </div>`
            };
        } catch (e) {
            return { html: esc(t("assistant.loadFailed")) };
        }
    }

    function helpHtml() {
        return `
            <p>${esc(t("assistant.help.lead"))}</p>
            <ul class="ac-help">
                <li>📊 ${esc(t("assistant.help.data"))}</li>
                <li>🔢 ${esc(t("assistant.help.figures"))}</li>
                <li>📅 ${esc(t("assistant.help.compare"))}</li>
                <li>🏆 ${esc(t("assistant.help.rank"))}</li>
                <li>🔎 ${esc(t("assistant.help.customer"))}</li>
                <li>📝 ${esc(t("assistant.help.work"))}</li>
                <li>🏦 ${esc(t("assistant.help.lgs"))}</li>
                <li>⚠️ ${esc(t("assistant.help.alerts"))}</li>
                <li>💬 ${esc(t("assistant.help.explain"))}</li>
                <li>🧭 ${esc(t("assistant.help.open"))}</li>
                <li>🎙️ ${esc(t("assistant.help.voice"))}</li>
            </ul>`;
    }

    // ---------- why the figures moved (Phase 4) ----------
    // The Credit Portfolio endpoint behind each topic (scoped by the server
    // like the page), explained by ci-explain.js — sentences only, every
    // number is one the backend computed.
    const EXPLAIN_SOURCES = {
        overview: ["overview", {}, "PortfolioIntelligence.html"],
        npl: ["npl", {}, "NplIntelligence.html"],
        recovery: ["recovery", { dim: "branch" }, "NplIntelligence.html?view=recovery"],
        risk: ["risk", { dim: "branch" }, "RiskIntelligence.html?view=contributors"],
        quality: ["quality", { dim: "branch" }, "RiskIntelligence.html?view=quality"],
        growth: ["risk", { dim: "branch" }, "RiskIntelligence.html?view=growth"],
        warning: ["early-warning", {}, "EarlyWarning.html"]
    };

    // What this user's figures cover — decides what a "which …" question
    // compares (the server still scopes every answer):
    //   all     admin, user, a manager of "All Branch" — branches
    //   branch  a manager of one branch — that branch's officers
    //   officer a Credit Officer — their own portfolio only
    function scopeKind() {
        const role = userRole();
        if (role === "viewer_staff" || role === "viewer") return "officer";
        if (/^viewer_manager_/.test(role)) {
            try {
                const u = JSON.parse(localStorage.getItem("loggedInUser") || sessionStorage.getItem("loggedInUser") || "{}");
                return String(u.branch || "").trim().toLowerCase() === "all branch" ? "all" : "branch";
            } catch (e) {
                return "branch";
            }
        }
        return "all";
    }

    async function ciGet(path, params) {
        const q = new URLSearchParams(params || {}).toString();
        try {
            const data = await API.get(`/api/credit-intelligence/${path}${q ? `?${q}` : ""}`);
            return data && data.ok ? data : null;
        } catch (e) {
            return null;
        }
    }

    async function answerExplain(intent) {
        const kind = scopeKind();
        let topic = intent.topic;
        // A Credit Officer has nobody to be compared with: "which branch /
        // officer is high-risk" becomes their own portfolio; "my portfolio"
        // from anyone else is the overview.
        if (kind === "officer" && (topic === "risk" || topic === "growth")) topic = "mine";
        if (topic === "mine" && kind !== "officer") topic = "overview";
        if (!window.CIExplain || (topic !== "mine" && !EXPLAIN_SOURCES[topic])) return { html: `<p>${esc(t("assistant.unknown", { q: intent.text }))}</p>`, chips: true };
        const dim = kind === "all" ? "branch" : "officer";
        let data, lines, page;
        if (topic === "mine") {
            const [risk, ews] = await Promise.all([ciGet("risk", { dim: "officer" }), ciGet("early-warning")]);
            if (!risk) return { html: `<p>${esc(t("assistant.explainFailed"))}</p>` };
            data = risk;
            lines = CIExplain.mine(risk, ews, t);
            page = "EarlyWarning.html";
        } else {
            const [path, params, pg] = EXPLAIN_SOURCES[topic];
            data = await ciGet(path, params.dim ? { ...params, dim } : params);
            if (!data) return { html: `<p>${esc(t("assistant.explainFailed"))}</p>` };
            lines = CIExplain[topic](data, t);
            page = params.dim && dim === "officer" ? `${pg}${pg.includes("?") ? "&" : "?"}dim=officer` : pg;
            // "Which branch …?" from a one-branch manager: say why officers.
            if (kind === "branch" && params.dim && /សាខា|branch/.test(intent.text) && data.scope && data.scope.branch) {
                lines = [t("ex.branchToOfficer", { branch: data.scope.branch })].concat(lines.filter(l => l !== t("ex.inBranch", { branch: data.scope.branch })));
            }
        }
        const asOf = data.asOf && data.asOf.osText ? ` · ${t("assistant.explainAsOf", { date: data.asOf.osText })}` : "";
        return {
            html: `<div class="ac-card ac-explain">
                <div class="ac-card-head"><span class="ac-card-who">${esc(t(`assistant.explain.${topic}`))}</span><span class="ac-card-date">${esc(asOf.replace(/^ · /, ""))}</span></div>
                <ul class="ac-explain-list">${lines.map(l => `<li>${esc(l)}</li>`).join("")}</ul>
                <p class="ac-explain-note">${esc(t("ex.note"))}</p>
                <a class="ac-link" href="/CM_Pro/pages/creditreport/${esc(page)}">${esc(t("assistant.explainOpen"))} ›</a>
            </div>`
        };
    }

    // Returns { html, go? } — go is a URL to open after the reply shows.
    async function respond(text) {
        const intent = N().parse(text);
        switch (intent.type) {
            case "navigate": {
                const label = t(`assistant.page.${intent.page}`);
                return { html: esc(t("assistant.opening", { page: label })), go: PAGE_URLS[intent.page] };
            }
            case "customer":
                return {
                    html: esc(t("assistant.searchingCustomer", { q: intent.query })),
                    go: `${PAGE_URLS.customers}?q=${encodeURIComponent(intent.query)}`
                };
            case "theme":
                if (window.CMTheme) CMTheme.set(intent.value);
                return { html: esc(t("assistant.themeChanged")) };
            case "help":
                return { html: helpHtml(), chips: true };
            case "alerts":
                return answerAlerts();
            case "work":
                return answerWork(intent);
            case "lgs":
                return answerLgs(intent);
            case "ask":
                return answerAsk(intent, text);
            case "explain":
                return answerExplain(intent);
            default:
                return { html: `<p>${esc(t("assistant.unknown", { q: text }))}</p>`, chips: true };
        }
    }

    // ---------- UI ----------
    // The full Home robot (assets/images/robot.svg + robot-animator.js)
    // stands on the panel's top edge. setFace() drives it: "think" while
    // an answer is on its way (thinking face, foot taps), "joy" when it
    // arrives (the little success jump), "neutral" otherwise — and
    // swaps the subtitle while it works.
    let chatRobot = null;
    function setFace(face) {
        const sub = sheet && sheet.querySelector(".ac-subtitle");
        if (sub) sub.textContent = t(face === "think" ? "assistant.thinking" : "assistant.subtitle");
        // While it thinks, the robot zooms in to just its head (CSS .ac-zoom);
        // the answer brings the whole robot back.
        const slot = sheet && sheet.querySelector(".ac-robot");
        if (slot) slot.classList.toggle("ac-zoom", face === "think");
        if (!chatRobot) return;
        if (face === "think") {
            chatRobot.think();
            chatRobot.setExpression("think"); // held until the answer arrives
        } else if (face === "joy") {
            chatRobot.success();
        } else {
            chatRobot.setExpression("neutral");
        }
    }

    const REDUCED_MOTION = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

    let sheet = null;
    let listEl = null;
    let inputEl = null;
    let busy = false;
    let history = [];

    // Suggested questions, in groups (the welcome message and "didn't
    // understand" show them all; the strip above the input the first of
    // each).
    function suggestionGroups() {
        const kind = scopeKind();
        return [
            { key: "work", items: ["unfilled", "expired", "promiseToday", "noOfficer"].map(workQuestion).concat(t("assistant.chip.work.all")) },
            { key: "data", items: kind === "officer"
                ? [t("assistant.chip.summary"), t("assistant.chip.par"), t("assistant.chip.lgs"), t("assistant.chip.alerts")]
                : [t("assistant.chip.summary"), t("assistant.chip.par"), t("assistant.chip.topCo"), t("assistant.chip.lowDisbCo"), t("assistant.chip.lgs"), t("assistant.chip.alerts")] },
            { key: "explain", items: [t("assistant.chip.whyNpl"), t("assistant.chip.whyRecovery"),
                t(kind === "officer" ? "assistant.chip.whyMine" : kind === "branch" ? "assistant.chip.whyRiskCo" : "assistant.chip.whyRisk"),
                t("assistant.chip.whyWarning")] },
            { key: "open", items: [t("assistant.chip.openWork"), t("assistant.chip.customer"), t("assistant.chip.help")] }
        ];
    }

    function quickStrip() {
        return [workQuestion("unfilled"), workQuestion("noOfficer"), t("assistant.chip.summary"), workQuestion("expired"),
            t("assistant.chip.par"), t("assistant.chip.lgs"), workQuestion("promiseToday"), t("assistant.chip.alerts"), t("assistant.chip.help")];
    }

    function saveHistory() {
        try { sessionStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-MAX_HISTORY))); } catch (e) {}
    }

    // The robot's head, cropped out of robot.svg, beside each bot reply.
    const BOT_AVATAR = `<span class="ac-av" aria-hidden="true"><img src="/CM_Pro/assets/images/robot.svg#svgView(viewBox(116,-26,224,224))" alt="" decoding="async"></span>`;

    function addMessage(role, html, { save = true } = {}) {
        const el = document.createElement("div");
        el.className = `ac-msg ac-${role}`;
        el.innerHTML = (role === "bot" ? BOT_AVATAR : "") + `<div class="ac-bubble">${html}</div>`;
        listEl.appendChild(el);
        listEl.scrollTop = listEl.scrollHeight;
        if (save) {
            history.push({ role, html });
            el.dataset.h = history.length - 1;
            saveHistory();
        }
        return el;
    }

    // A compare button / date on a card: re-answer that card's question
    // with the new comparison, in place.
    async function recompare(bar, compare, by) {
        const msg = bar.closest(".ac-msg");
        const bubble = msg && msg.querySelector(".ac-bubble");
        if (!bubble || busy) return;
        busy = true;
        bubble.classList.add("ac-loading");
        setFace("think");
        let reply;
        let failed = false;
        try {
            const intent = N().parse(bar.dataset.q);
            if (by && intent.rank) intent.rank = { ...intent.rank, by };
            reply = intent.type === "ask"
                ? await answerAsk({ ...intent, compare: compare || intent.compare }, bar.dataset.q)
                : { html: bubble.innerHTML };
        } catch (e) {
            reply = { html: esc(t("assistant.loadFailed")) };
            failed = true;
        }
        bubble.innerHTML = reply.html;
        bubble.classList.remove("ac-loading");
        setFace(failed ? "neutral" : "joy");
        const i = Number(msg.dataset.h);
        if (Number.isInteger(i) && history[i]) {
            history[i].html = reply.html;
            saveHistory();
        }
        busy = false;
    }

    function chipsHtml() {
        return suggestionGroups().map(g => `
            <div class="ac-chip-group">
                <div class="ac-chip-label">${esc(t(`assistant.group.${g.key}`))}</div>
                <div class="ac-chips">${g.items.map(s => `<button type="button" class="ac-chip">${esc(s)}</button>`).join("")}</div>
            </div>`).join("");
    }

    async function ask(text) {
        text = String(text || "").trim();
        if (!text || busy) return;
        busy = true;
        inputEl.value = "";
        updateSend();
        addMessage("me", esc(text));
        const typing = addMessage("bot", `<span class="ac-typing"><i></i><i></i><i></i></span>`, { save: false });
        setFace("think");
        let reply;
        let failed = false;
        try {
            reply = await respond(text);
        } catch (e) {
            console.warn("[assistant-chat] reply failed:", e);
            reply = { html: esc(t("assistant.loadFailed")) };
            failed = true;
        }
        typing.remove();
        setFace(failed ? "neutral" : "joy");
        if (!failed) answeredSinceOpen++;
        addMessage("bot", reply.html + (reply.chips ? chipsHtml() : ""));
        busy = false;
        if (reply.go) setTimeout(() => { location.href = reply.go; }, 700);
    }

    function updateSend() {
        sheet.querySelector(".ac-send").disabled = !inputEl.value.trim();
    }

    // ---------- voice inside the chat ----------
    let rec = null;

    function stopRec() {
        if (!rec) return;
        try { rec.stop(); } catch (e) {}
        try { rec.abort(); } catch (e) {}
    }

    function startRec() {
        const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!Ctor) return;
        if (rec) { stopRec(); return; }
        const r = new Ctor();
        rec = r;
        r.lang = speechCode();
        r.interimResults = true;
        r.maxAlternatives = 1;
        const micBtn = sheet.querySelector(".ac-mic");
        micBtn.classList.add("on");
        inputEl.placeholder = t("assistant.listening");
        r.onresult = (ev) => {
            const res = ev.results[0];
            inputEl.value = res[0].transcript;
            updateSend();
            if (res.isFinal) {
                stopRec();
                ask(res[0].transcript);
            }
        };
        r.onerror = (ev) => {
            const msg = voiceErrorText(ev.error);
            if (msg) addMessage("bot", esc(msg), { save: false });
        };
        r.onend = () => {
            if (rec === r) {
                r.onresult = r.onerror = r.onend = null;
                rec = null;
            }
            micBtn.classList.remove("on");
            inputEl.placeholder = t("assistant.placeholder");
        };
        try { r.start(); } catch (e) { r.onend && r.onend(); }
    }

    function build() {
        sheet = document.createElement("div");
        sheet.id = "cmAssistantChat";
        sheet.className = "ac-dim";
        sheet.hidden = true;
        const hasSpeech = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
        sheet.innerHTML = `
            <div class="ac-sheet" role="dialog" aria-modal="true" aria-labelledby="acTitle">
                <div class="ac-top">
                    <button type="button" class="ac-grab" aria-label="${esc(t("assistant.expand"))}" aria-expanded="false"><span></span></button>
                    <div class="ac-head">
                        <div class="ac-robot" aria-hidden="true"></div>
                        <div class="ac-head-text">
                            <div class="ac-title" id="acTitle">CM Pro AI</div>
                            <div class="ac-subtitle">${esc(t("assistant.subtitle"))}</div>
                        </div>
                        <button type="button" class="ac-refresh" aria-label="${esc(t("assistant.refresh"))}" title="${esc(t("assistant.refresh"))}">
                            <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.34-5.66M4 4v4h4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                        </button>
                        <button type="button" class="ac-clear" aria-label="${esc(t("assistant.clear"))}" title="${esc(t("assistant.clearShort"))}">
                            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4h6v3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                        </button>
                        <button type="button" class="ac-close" aria-label="${esc(t("assistant.close"))}">×</button>
                    </div>
                </div>
                <div class="ac-list" aria-live="polite"></div>
                <div class="ac-quick" role="group" aria-label="${esc(t("assistant.suggested"))}">
                    ${quickStrip().map(q => `<button type="button" class="ac-chip">${esc(q)}</button>`).join("")}
                </div>
                <div class="ac-bar">
                    <input type="text" class="ac-input" enterkeyhint="send" autocomplete="off" placeholder="${esc(t("assistant.placeholder"))}">
                    ${hasSpeech ? `<button type="button" class="ac-mic" aria-label="${esc(t("assistant.speak"))}">
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Z"/><path d="M19 11a1 1 0 0 0-2 0 5 5 0 0 1-10 0 1 1 0 0 0-2 0 7 7 0 0 0 6 6.92V20H9a1 1 0 0 0 0 2h6a1 1 0 0 0 0-2h-2v-2.08A7 7 0 0 0 19 11Z"/></svg>
                    </button>` : ""}
                    <button type="button" class="ac-send" disabled aria-label="${esc(t("assistant.send"))}">
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M3.4 20.4 21 12 3.4 3.6 3.4 10l12.6 2-12.6 2z"/></svg>
                    </button>
                </div>
            </div>`;
        document.body.appendChild(sheet);

        listEl = sheet.querySelector(".ac-list");
        inputEl = sheet.querySelector(".ac-input");

        sheet.addEventListener("click", (e) => {
            if (e.target === sheet) close();
            const chip = e.target.closest(".ac-chip");
            if (chip) ask(chip.textContent);
            const tile = e.target.closest("[data-ask]");
            if (tile) ask(tile.dataset.ask);
            const drill = e.target.closest("[data-work]");
            if (drill) workDrill(drill);
            const cmp = e.target.closest(".ac-cmp button[data-cmp]");
            if (cmp) recompare(cmp.closest(".ac-cmp"), { mode: cmp.dataset.cmp, date: null });
            const snap = e.target.closest(".ac-snap");
            if (snap) snapshotNow(snap);
            const byBtn = e.target.closest(".ac-by button[data-by]");
            if (byBtn && !byBtn.classList.contains("on")) recompare(byBtn.closest(".ac-by"), null, byBtn.dataset.by);
        });
        sheet.addEventListener("change", (e) => {
            if (e.target.classList.contains("ac-cmp-date") && e.target.value) {
                recompare(e.target.closest(".ac-cmp"), { mode: "date", date: e.target.value });
            }
        });
        sheet.querySelector(".ac-close").onclick = close;
        sheet.querySelector(".ac-clear").onclick = clearChat;
        sheet.querySelector(".ac-refresh").onclick = refreshChat;
        initDrag();

        // The full robot on the panel's edge (only where the robot scripts
        // are loaded — Home). Not window.cmProRobot: that stays Home's.
        if (typeof window.embedCMProRobot === "function") {
            window.embedCMProRobot(sheet.querySelector(".ac-robot"), { src: "/CM_Pro/assets/images/robot.svg" })
                .then((r) => { chatRobot = r; })
                .catch(() => {});
        }
        sheet.querySelector(".ac-send").onclick = () => ask(inputEl.value);
        inputEl.addEventListener("input", updateSend);
        inputEl.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); ask(inputEl.value); }
        });
        sheet.querySelector(".ac-mic")?.addEventListener("click", startRec);

        try { history = JSON.parse(sessionStorage.getItem(HISTORY_KEY) || "[]"); } catch (e) { history = []; }
        if (history.length) {
            history.forEach((m, i) => { addMessage(m.role, m.html, { save: false }).dataset.h = i; });
        } else {
            welcome();
        }

        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape" && !sheet.hidden) close();
        });
        // A back-forward cache restore brings the page back exactly as
        // it was left — sheet open mid-answer included.
        window.addEventListener("pageshow", (e) => { if (e.persisted) { stopRec(); close(); } });
        window.addEventListener("pagehide", stopRec);
    }

    // Greeting and what to ask.
    function welcome() {
        const name = typeof getVoiceUserFirstName === "function" ? getVoiceUserFirstName() : "";
        addMessage("bot", `<p>${esc(name ? t("assistant.hello", { name }) : t("assistant.helloNoName"))}</p>${chipsHtml()}`);
    }

    function clearChat() {
        if (busy) return;
        history = [];
        saveHistory();
        listEl.innerHTML = "";
        welcome();
    }

    // Refresh: drop the cached figures and ask the last question again,
    // so the answer is today's latest (with no question yet, the
    // greeting is redrawn).
    function refreshChat() {
        if (busy) return;
        for (let i = sessionStorage.length - 1; i >= 0; i--) {
            const k = sessionStorage.key(i);
            if (k && (k.startsWith(OVERVIEW_KEY) || k.startsWith(WORK_KEY) || k.startsWith(LGS_KEY))) sessionStorage.removeItem(k);
        }
        const last = [...history].reverse().find(m => m.role === "me");
        if (!last) return clearChat();
        const tmp = document.createElement("div");
        tmp.innerHTML = last.html;
        ask(tmp.textContent);
    }

    // ---------- size: normal sheet <-> fullscreen ----------
    // Drag the top bar (handle or header) up to go fullscreen, down to
    // shrink back or — far enough — close; a tap on the handle toggles.
    let full = false;

    function setFull(on) {
        full = on;
        const panel = sheet.querySelector(".ac-sheet");
        panel.classList.toggle("ac-full", on);
        panel.style.height = "";
        sheet.querySelector(".ac-grab").setAttribute("aria-expanded", String(on));
    }

    function initDrag() {
        const panel = sheet.querySelector(".ac-sheet");
        const top = sheet.querySelector(".ac-top");
        let drag = null;
        top.addEventListener("pointerdown", (e) => {
            if (e.button !== 0) return;
            if (e.target.closest("button") && !e.target.closest(".ac-grab")) return;
            drag = { y: e.clientY, h: panel.getBoundingClientRect().height, moved: false, onGrab: !!e.target.closest(".ac-grab") };
            top.setPointerCapture(e.pointerId);
        });
        top.addEventListener("pointermove", (e) => {
            if (!drag) return;
            const dy = e.clientY - drag.y;
            if (!drag.moved && Math.abs(dy) < 6) return;
            if (!drag.moved) panel.classList.add("ac-dragging");
            drag.moved = true;
            panel.style.height = `${Math.max(140, Math.min(sheet.clientHeight, drag.h - dy))}px`;
        });
        const end = () => {
            if (!drag) return;
            const d = drag;
            drag = null;
            panel.classList.remove("ac-dragging");
            if (!d.moved) {
                if (d.onGrab) setFull(!full);
                return;
            }
            const h = panel.getBoundingClientRect().height;
            const room = sheet.clientHeight; // the space above the bottom bar
            const normal = Math.min(room - 90, 720);
            if (h > (normal + room) / 2) setFull(true);
            else if (h < normal * 0.55) { setFull(false); close(); }
            else setFull(false);
        };
        top.addEventListener("pointerup", end);
        top.addEventListener("pointercancel", end);
    }

    // ---------- open / close: grow out of (and back into) the assistant box ----------
    // The panel is revealed with a clip-path running from the box's
    // rectangle to the whole panel, so nothing inside is scaled or
    // squashed on the way.
    function boxClip(panel) {
        const box = document.querySelector(".assistant-box");
        if (!box || REDUCED_MOTION || !box.getClientRects().length) return null;
        const b = box.getBoundingClientRect();
        const s = panel.getBoundingClientRect();
        if (!b.width || !s.width) return null;
        return `inset(${b.top - s.top}px ${s.right - b.right}px ${s.bottom - b.bottom}px ${b.left - s.left}px round 24px)`;
    }

    function open(question) {
        if (!sheet) build();
        sheet.hidden = false;
        document.body.classList.add("ac-open");
        const panel = sheet.querySelector(".ac-sheet");
        const from = boxClip(panel);
        if (from) {
            panel.classList.add("ac-from-box");
            panel.animate(
                [{ clipPath: from }, { clipPath: `inset(0px 0px 0px 0px round ${full ? "0px" : "22px 22px 0px 0px"})` }],
                { duration: 380, easing: "cubic-bezier(.2,.8,.2,1)" }
            ).finished.catch(() => {}).finally(() => panel.classList.remove("ac-from-box"));
        }
        if (chatRobot) chatRobot.wave();
        listEl.scrollTop = listEl.scrollHeight;
        if (question) ask(question);
        else if (window.matchMedia("(pointer:fine)").matches) inputEl.focus();
    }

    // Answers given since the chat was last opened — on close, the page
    // hears "cm-assistant-close" with that count (Home's robot gives a
    // thumbs-up when it's > 0).
    let answeredSinceOpen = 0;

    let closing = false;

    function close() {
        if (!sheet || sheet.hidden || closing) return;
        stopRec();
        const finish = () => {
            closing = false;
            sheet.hidden = true;
            sheet.classList.remove("ac-closing");
            document.body.classList.remove("ac-open");
            document.dispatchEvent(new CustomEvent("cm-assistant-close", { detail: { answered: answeredSinceOpen } }));
            answeredSinceOpen = 0;
        };
        const panel = sheet.querySelector(".ac-sheet");
        const to = boxClip(panel);
        if (!to) return finish();
        closing = true;
        sheet.classList.add("ac-closing");
        panel.classList.add("ac-from-box");
        panel.animate(
            [{ clipPath: `inset(0px 0px 0px 0px round ${full ? "0px" : "22px 22px 0px 0px"})` }, { clipPath: to }],
            { duration: 300, easing: "cubic-bezier(.4,0,.6,1)" }
        ).finished.catch(() => {}).finally(() => {
            panel.classList.remove("ac-from-box");
            finish();
        });
    }

    window.CMAssistantChat = { open, close, voiceLang, speechCode, voiceErrorText, respond, loadWork, workQuestion };

    document.addEventListener("DOMContentLoaded", () => {
        // Tapping anywhere on the assistant box opens the chat (the mic
        // and the alert / update modes' own buttons keep their action).
        const box = document.querySelector(".assistant-box");
        if (box) {
            box.addEventListener("click", (e) => {
                if (box.dataset.mode === "greeting" && !e.target.closest("button,a")) open();
            });
        }
    });
})();
