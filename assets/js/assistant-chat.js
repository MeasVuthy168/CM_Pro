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
   - Voice uses the browser's speech recognition in Khmer (km-KH) or
     English (en-US); the choice is shared with the mic sheet.

   Public: CMAssistantChat.open(question?), .voiceLang(), .setVoiceLang()
========================================================= */
(function () {
    "use strict";

    const t = (key, vars) => (window.CMI18n ? CMI18n.t(key, vars) : key);
    const N = () => window.CMAssistantNLU;

    const OVERVIEW_KEY = "cm_asst_overview";
    const OVERVIEW_TTL = 10 * 60 * 1000;
    const HISTORY_KEY = "cm_asst_chat";
    const VOICE_LANG_KEY = "cm_voice_lang";
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
        masterData: "/CM_Pro/pages/masterdata/index.html",
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
    const UP_IS_GOOD = { os: true, disb: true, par: false, npl: false };

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
    function voiceLang() {
        let v = null;
        try { v = localStorage.getItem(VOICE_LANG_KEY); } catch (e) {}
        if (v !== "km" && v !== "en") v = (window.CMLanguage && CMLanguage.get()) === "en" ? "en" : "km";
        return v;
    }

    function setVoiceLang(v) {
        try { localStorage.setItem(VOICE_LANG_KEY, v === "en" ? "en" : "km"); } catch (e) {}
        document.querySelectorAll("[data-voice-lang]").forEach(b => {
            b.classList.toggle("on", b.dataset.voiceLang === voiceLang());
        });
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
        const field = metric === "par" ? "par" : metric;
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
        if (metric === "npl") return t("assistant.accounts", { n: r.npl });
        return usd(r.disb);
    }

    function metricSub(metric, r) {
        if (metric === "os") return t("assistant.sub.os", { loans: r.loans.toLocaleString("en-US"), clients: r.clients.toLocaleString("en-US") });
        if (metric === "par") return t("assistant.sub.par", { pct: pct(r.parPct), loans: r.parLoans });
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
        return { par: "parPct", npl: "npl", os: "os", disb: "disb", summary: "parPct" }[metric] || "parPct";
    }

    function rankValue(metric, r) {
        if (metric === "par" || metric === "summary") return `${pct(r.parPct)} · ${usdShort(r.par)}`;
        if (metric === "npl") return `${t("assistant.accounts", { n: r.npl })} · ${usdShort(r.nplValue)}`;
        if (metric === "os") return usdShort(r.os);
        return usdShort(r.disb);
    }

    function answerRank(intent, data) {
        let level = intent.rank.level;
        let list = level === "branch" ? data.branches : data.officers;
        if (!list.length && level === "branch") { level = "officer"; list = data.officers; }
        const metric = intent.metric;
        const k = rankKey(metric);
        const rows = list
            .filter(r => r.os > 0)
            .sort((a, b) => intent.rank.dir === "bottom" ? a[k] - b[k] : b[k] - a[k])
            .slice(0, 5);
        if (!rows.length) return { html: esc(t("assistant.noData")) };

        const title = t(`assistant.rank.${intent.rank.dir}`, {
            level: t(`assistant.level.${level}`),
            metric: metricLabel(metric === "summary" ? "par" : metric)
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
                    <ol class="ac-rank">
                        ${rows.map(r => `
                            <li>
                                <span class="ac-rank-name">${esc(level === "branch" ? r.branch : (r.name || r.id))}${level === "officer" ? `<small>${esc(r.id)}${r.branch ? " · " + esc(r.branch) : ""}</small>` : ""}</span>
                                <span class="ac-rank-v">${esc(rankValue(metric, r))}</span>
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

        if (intent.rank) return answerRank(intent, data);

        const nlu = N();
        let row = nlu.matchOfficer(intent.text, data.officers);
        if (!row) row = nlu.matchBranch(intent.text, data.branches);
        if (!row) {
            const other = nlu.matchBranch(intent.text, ALL_BRANCHES.map(b => ({ branch: b })));
            if (other) return { html: esc(t("assistant.notYourBranch", { branch: other.branch })) };
        }
        row = row || data.total;
        if (!row) return { html: esc(t("assistant.noData")) };

        const metrics = intent.metric === "summary" ? ["os", "par", "npl", "disb"] : [intent.metric];
        const lead = intent.metric === "summary"
            ? t("assistant.lead.summary", { who: whoLabel(row, data) })
            : t("assistant.lead.metric", { metric: metricLabel(intent.metric), who: whoLabel(row, data), value: metricValue(intent.metric, row) });
        return { html: `<p>${esc(lead)}</p>${statCard(row, data, metrics, q)}` };
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
                <li>📅 ${esc(t("assistant.help.compare"))}</li>
                <li>🏆 ${esc(t("assistant.help.rank"))}</li>
                <li>🔎 ${esc(t("assistant.help.customer"))}</li>
                <li>⚠️ ${esc(t("assistant.help.alerts"))}</li>
                <li>🧭 ${esc(t("assistant.help.open"))}</li>
                <li>🎙️ ${esc(t("assistant.help.voice"))}</li>
            </ul>`;
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
            case "ask":
                return answerAsk(intent, text);
            default:
                return { html: `<p>${esc(t("assistant.unknown", { q: text }))}</p>`, chips: true };
        }
    }

    // ---------- UI ----------
    let sheet = null;
    let listEl = null;
    let inputEl = null;
    let busy = false;
    let history = [];

    function suggestions() {
        return [
            t("assistant.chip.summary"),
            t("assistant.chip.par"),
            t("assistant.chip.topCo"),
            t("assistant.chip.alerts"),
            t("assistant.chip.customer"),
            t("assistant.chip.help")
        ];
    }

    function saveHistory() {
        try { sessionStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-MAX_HISTORY))); } catch (e) {}
    }

    function addMessage(role, html, { save = true } = {}) {
        const el = document.createElement("div");
        el.className = `ac-msg ac-${role}`;
        el.innerHTML = `<div class="ac-bubble">${html}</div>`;
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
    async function recompare(bar, compare) {
        const msg = bar.closest(".ac-msg");
        const bubble = msg && msg.querySelector(".ac-bubble");
        if (!bubble || busy) return;
        busy = true;
        bubble.classList.add("ac-loading");
        let reply;
        try {
            const intent = N().parse(bar.dataset.q);
            reply = intent.type === "ask"
                ? await answerAsk({ ...intent, compare }, bar.dataset.q)
                : { html: bubble.innerHTML };
        } catch (e) {
            reply = { html: esc(t("assistant.loadFailed")) };
        }
        bubble.innerHTML = reply.html;
        bubble.classList.remove("ac-loading");
        const i = Number(msg.dataset.h);
        if (Number.isInteger(i) && history[i]) {
            history[i].html = reply.html;
            saveHistory();
        }
        busy = false;
    }

    function chipsHtml() {
        return `<div class="ac-chips">${suggestions().map(s => `<button type="button" class="ac-chip">${esc(s)}</button>`).join("")}</div>`;
    }

    async function ask(text) {
        text = String(text || "").trim();
        if (!text || busy) return;
        busy = true;
        inputEl.value = "";
        updateSend();
        addMessage("me", esc(text));
        const typing = addMessage("bot", `<span class="ac-typing"><i></i><i></i><i></i></span>`, { save: false });
        let reply;
        try {
            reply = await respond(text);
        } catch (e) {
            console.warn("[assistant-chat] reply failed:", e);
            reply = { html: esc(t("assistant.loadFailed")) };
        }
        typing.remove();
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
            if (ev.error === "not-allowed" || ev.error === "service-not-allowed") {
                addMessage("bot", esc(t("voice.micBlocked")), { save: false });
            } else if (ev.error === "language-not-supported") {
                addMessage("bot", esc(t("assistant.voiceLangUnsupported")), { save: false });
            }
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
                <div class="ac-grab"></div>
                <div class="ac-head">
                    <div class="ac-avatar">AI</div>
                    <div class="ac-head-text">
                        <div class="ac-title" id="acTitle">CM Pro AI</div>
                        <div class="ac-subtitle">${esc(t("assistant.subtitle"))}</div>
                    </div>
                    <button type="button" class="ac-close" aria-label="${esc(t("assistant.close"))}">×</button>
                </div>
                <div class="ac-list" aria-live="polite"></div>
                <div class="ac-bar">
                    ${hasSpeech ? `
                    <div class="ac-lang" role="group" aria-label="${esc(t("assistant.voiceLang"))}">
                        <button type="button" data-voice-lang="km">ខ្មែរ</button>
                        <button type="button" data-voice-lang="en">EN</button>
                    </div>` : ""}
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
            const cmp = e.target.closest(".ac-cmp button[data-cmp]");
            if (cmp) recompare(cmp.closest(".ac-cmp"), { mode: cmp.dataset.cmp, date: null });
        });
        sheet.addEventListener("change", (e) => {
            if (e.target.classList.contains("ac-cmp-date") && e.target.value) {
                recompare(e.target.closest(".ac-cmp"), { mode: "date", date: e.target.value });
            }
        });
        sheet.querySelector(".ac-close").onclick = close;
        sheet.querySelector(".ac-send").onclick = () => ask(inputEl.value);
        inputEl.addEventListener("input", updateSend);
        inputEl.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); ask(inputEl.value); }
        });
        sheet.querySelector(".ac-mic")?.addEventListener("click", startRec);
        sheet.querySelectorAll("[data-voice-lang]").forEach(b => {
            b.onclick = () => {
                setVoiceLang(b.dataset.voiceLang);
                if (rec) { stopRec(); setTimeout(startRec, 250); }
            };
        });
        setVoiceLang(voiceLang());

        try { history = JSON.parse(sessionStorage.getItem(HISTORY_KEY) || "[]"); } catch (e) { history = []; }
        if (history.length) {
            history.forEach((m, i) => { addMessage(m.role, m.html, { save: false }).dataset.h = i; });
        } else {
            const name = typeof getVoiceUserFirstName === "function" ? getVoiceUserFirstName() : "";
            addMessage("bot", `<p>${esc(name ? t("assistant.hello", { name }) : t("assistant.helloNoName"))}</p>${chipsHtml()}`);
        }

        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape" && !sheet.hidden) close();
        });
        // A back-forward cache restore brings the page back exactly as
        // it was left — sheet open mid-answer included.
        window.addEventListener("pageshow", (e) => { if (e.persisted) { stopRec(); close(); } });
        window.addEventListener("pagehide", stopRec);
    }

    function open(question) {
        if (!sheet) build();
        sheet.hidden = false;
        document.body.classList.add("ac-open");
        listEl.scrollTop = listEl.scrollHeight;
        if (question) ask(question);
        else if (window.matchMedia("(pointer:fine)").matches) inputEl.focus();
    }

    function close() {
        if (!sheet) return;
        stopRec();
        sheet.hidden = true;
        document.body.classList.remove("ac-open");
    }

    window.CMAssistantChat = { open, close, voiceLang, setVoiceLang, speechCode, respond };

    document.addEventListener("DOMContentLoaded", () => {
        const btn = document.getElementById("assistantChatBtn");
        if (btn) btn.addEventListener("click", () => open());
        // Tapping the greeting itself also opens the chat (alert / update
        // modes keep their own buttons).
        const text = document.getElementById("assistantText");
        const box = document.querySelector(".assistant-box");
        if (text && box) {
            text.addEventListener("click", (e) => {
                if (box.dataset.mode === "greeting" && !e.target.closest("button,a")) open();
            });
        }
    });
})();
