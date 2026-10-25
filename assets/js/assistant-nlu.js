/* =========================================================
   ASSISTANT NLU (CM Pro AI — Level 1)
   Turns what the user typed or said (Khmer or English) into one
   intent the chat / voice sheet can act on. Rule-based on purpose —
   keyword lists, no AI service — so nothing the user says leaves
   the phone except the data request itself.

   parse(text) returns one of:
     { type: "navigate", page }            open a page
     { type: "customer", query }           Customer Search with a keyword
     { type: "ask", metric, rank, text,    a data question; metric is
       compare }
                                           os | par | npl | disb | summary,
                                           rank { dir: top|bottom, level:
                                           officer|branch, by: value|loans }
                                           or null; the
                                           entity (branch / CO) is matched
                                           later against the loaded data;
                                           compare (optional) { mode: prev |
                                           month | year | date, date } when
                                           the question names what to
                                           compare with ("ធៀបនឹងចុងខែមុន",
                                           "vs 30/09/2026")
     { type: "lgs", focus }                loans inside the LGs limit
                                           disbursed this month; focus
                                           lgs | refinanced
     { type: "alerts" }                    today's Smart Alerts
     { type: "work", kind }                today's work to complete; kind
                                           unfilled | expired | promiseToday
                                           | noOfficer | all
     { type: "explain", topic }            why the figures moved (Credit
                                           Portfolio, ci-explain.js); topic
                                           overview | npl | recovery | risk
                                           | quality | growth | warning | mine
                                           (a Credit Officer's own portfolio)
     { type: "theme", value }              light | dark | auto
     { type: "help" }
     { type: "unknown" }

   Latin keywords match whole words only (so "co" never matches inside
   "account"); Khmer keywords match anywhere, since Khmer is written
   without spaces between words.
========================================================= */
(function (root) {
    "use strict";

    const KM_DIGITS = "០១២៣៤៥៦៧៨៩";

    function normalize(text) {
        return String(text || "")
            .replace(/[​‌‍⁠﻿]/g, "")
            .replace(/[០-៩]/g, d => String(KM_DIGITS.indexOf(d)))
            .toLowerCase()
            .replace(/[?？!។៕,;:"“”«»()]/g, " ")
            .replace(/\s+/g, " ")
            .trim();
    }

    const LATIN = /^[\x00-\x7f]+$/;

    function has(text, kw) {
        if (!LATIN.test(kw)) return text.includes(kw);
        const esc = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return new RegExp(`(^|[^a-z0-9])${esc}([^a-z0-9]|$)`).test(text);
    }

    function hasAny(text, list) {
        return list.some(kw => has(text, kw));
    }

    // Removes every listed keyword (longest first) — what's left of a
    // "search customer …" phrase is the keyword to search for.
    function strip(text, list) {
        let out = ` ${text} `;
        for (const kw of [...list].sort((a, b) => b.length - a.length)) {
            if (LATIN.test(kw)) {
                const esc = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                out = out.replace(new RegExp(`(^|[^a-z0-9])${esc}(?=[^a-z0-9]|$)`, "g"), "$1 ");
            } else {
                out = out.split(kw).join(" ");
            }
        }
        return out.replace(/\s+/g, " ").trim();
    }

    // ---------- vocabulary ----------
    // LGs Loans (Master Data): loans inside the LGs limit and the ones
    // already refinanced. Declared first — PAGES below uses it.
    const LGS_WORDS = ["lgs", "lg loan", "lg loans", "lgs loan", "lgs loans", "refinance", "refinanced", "refinancing",
        "ដែនកំណត់", "បុនហិរញ្ញប្បទាន", "ហិរញ្ញប្បទានឡើងវិញ", "បុនរួច"];
    const REFIN_WORDS = ["refinance", "refinanced", "refinancing", "បុនហិរញ្ញប្បទាន", "ហិរញ្ញប្បទានឡើងវិញ", "បុនរួច"];

    const OPEN_WORDS = ["open", "go to", "goto", "show me", "take me to", "បើក", "ទៅកាន់", "ទៅទំព័រ", "ចូលទៅ", "ចូល"];

    // Most specific first — the first page whose keyword appears wins.
    const PAGES = [
        { page: "creditReportBranch", keywords: ["report by branch", "branch report", "របាយការណ៍តាមសាខា"] },
        { page: "creditReportCO", keywords: ["report by co", "co report", "officer report", "របាយការណ៍តាម co", "របាយការណ៍តាមមន្ត្រី"] },
        { page: "customers", keywords: ["customer search", "search customer", "customer", "customers", "ស្វែងរកអតិថិជន", "អតិថិជន"] },
        { page: "arrears", keywords: ["daily arrears", "arrears", "ឥណទានយឺតយ៉ាវ", "យឺតយ៉ាវ", "ហួសកាលកំណត់"] },
        { page: "turnover", keywords: ["average turnover", "turnover", "ការបង្វិលជុំមធ្យម", "បង្វិលជុំ", "ចរាចរណ៍", "ទឹកប្រាក់ចរាចរ"] },
        { page: "spotcheck", keywords: ["spot check", "spotcheck", "ស្ប៉តឆែក", "ស្ប៉ត់ឆែក", "ពិនិត្យដល់ទីតាំង", "ត្រួតពិនិត្យភ្លាមៗ"] },
        { page: "officertask", keywords: ["officer task", "ភារកិច្ចមន្ត្រី", "កិច្ចការមន្ត្រី"] },
        { page: "earlyWarning", keywords: ["early warning", "ការព្រមានជាមុន"] },
        { page: "nplManagement", keywords: ["npl management", "ការគ្រប់គ្រង npl"] },
        { page: "riskIntelligence", keywords: ["risk intelligence", "risk analysis", "វិភាគហានិភ័យ"] },
        { page: "portfolioOverview", keywords: ["portfolio overview", "portfolio intelligence", "ទិដ្ឋភាពទូទៅផលប័ត្រ"] },
        { page: "creditReport", keywords: ["credit report", "report", "reports", "របាយការណ៍ឥណទាន", "របាយការណ៍"] },
        { page: "work", keywords: ["work to complete", "ការងារត្រូវបំពេញ"] },
        { page: "lgs", keywords: LGS_WORDS },
        { page: "outArea", keywords: ["out of area arrears", "edit out-of-area", "កែសម្រួលarrearក្រៅតំបន់", "arrearក្រៅតំបន់"] },
        { page: "masterData", keywords: ["master data", "ទិន្នន័យមូលដ្ឋាន"] },
        { page: "land", keywords: ["land classification", "land", "ចំណាត់ថ្នាក់ដីធ្លី", "ចំណាត់ថ្នាក់ដី", "ដីធ្លី"] },
        { page: "loanCalculator", keywords: ["loan calculator", "loan calculate", "calculate loan", "calculator", "គណនាឥណទាន", "គណនាប្រាក់កម្ចី", "គណនាកម្ចី", "ម៉ាស៊ីនគិតលេខ"] },
        { page: "retirement", keywords: ["retirement", "retire", "និវត្តន៍"] },
        { page: "notifications", keywords: ["notification", "notifications", "ការជូនដំណឹង", "សារជូនដំណឹង"] },
        { page: "settings", keywords: ["setting", "settings", "ការកំណត់"] },
        { page: "home", keywords: ["home", "dashboard", "ទំព័រដើម"] }
    ];

    const CUSTOMER_WORDS = ["search customer", "find customer", "customer search", "search", "find", "look up", "customer", "client",
        "ស្វែងរកអតិថិជន", "រកអតិថិជន", "ស្វែងរក", "អតិថិជនឈ្មោះ", "អតិថិជនលេខ", "អតិថិជន", "ឈ្មោះ", "លេខ", "គណនី"];
    const SEARCH_VERBS = ["search", "find", "look up", "ស្វែងរក", "រក"];
    const CUSTOMER_NOUNS = ["customer", "client", "cif", "អតិថិជន"];

    const METRICS = [
        { metric: "npl", keywords: ["npl", "non performing", "non-performing", "អិនភីអិល", "ឥណទានមិនដំណើរការ", "មិនដំណើរការ"] },
        { metric: "overdue", keywords: ["nbc overdue", "overdue", "nbc", "ហួសកាលកំណត់ nbc"] },
        { metric: "par", keywords: ["par", "par t24", "portfolio at risk", "ផារ", "ប៉ារ", "ហានិភ័យឥណទាន", "ហានិភ័យ"] },
        { metric: "wo", keywords: ["write off", "write-off", "written off", "writeoff", "wo", "លុបចេញពីបញ្ជី", "លុបចេញបញ្ជី", "ឥណទានលុប"] },
        { metric: "disb", keywords: ["disburse", "disbursed", "disbursement", "disbursements", "បញ្ចេញឥណទាន", "ផ្តល់ឥណទាន", "បើកប្រាក់កម្ចី", "បញ្ចេញ"] },
        { metric: "os", keywords: ["os", "outstanding", "loan outstanding", "portfolio", "អូអេស", "សមតុល្យឥណទាន", "ឥណទានសរុប", "ប្រាក់កម្ចីសរុប", "សមតុល្យ"] }
    ];
    const SUMMARY_WORDS = ["summary", "overview", "today", "how are we", "how is", "status", "សង្ខេប", "ស្ថានភាព", "ថ្ងៃនេះ", "ទិន្នន័យ", "យ៉ាងម៉េច", "យ៉ាងដូចម្តេច"];

    const TOP_WORDS = ["top", "highest", "most", "worst", "biggest", "largest", "ខ្ពស់ជាងគេ", "ច្រើនជាងគេ", "ខ្ពស់បំផុត", "ច្រើនបំផុត", "អាក្រក់ជាងគេ", "ធំជាងគេ", "ល្អជាងគេ", "ណាខ្លះ"];
    const BOTTOM_WORDS = ["lowest", "least", "smallest", "ទាបជាងគេ", "តិចជាងគេ", "ទាបបំផុត", "តិចបំផុត"];
    const OFFICER_WORDS = ["co", "cos", "officer", "officers", "staff", "មន្ត្រី", "បុគ្គលិក", "មន្រ្តី"];
    const BRANCH_WORDS = ["branch", "branches", "សាខា"];

    // ---------- today's work (Reason Arrear) ----------
    // Most specific first. Checked before the customer search, since
    // "client arrear no officer responsible" names a client too.
    const WORK_KINDS = [
        { kind: "noOfficer", keywords: ["no officer responsible", "no officer", "without officer", "without an officer", "no co responsible", "no co",
            "nocorespone", "no co respone", "no responsible", "out of area", "out-of-area",
            "គ្មានមន្ត្រីទទួលខុសត្រូវ", "គ្មានមន្រ្តីទទួលខុសត្រូវ", "គ្មានអ្នកទទួលខុសត្រូវ", "គ្មានមន្ត្រី", "គ្មានមន្រ្តី", "គ្មានភ្នាក់ងារ", "ក្រៅតំបន់"] },
        { kind: "promiseToday", keywords: ["promise today", "promised today", "promises today", "promise to pay today", "pay today", "due today", "today payment", "today_payment",
            "សន្យាសងថ្ងៃនេះ", "សន្យាថ្ងៃនេះ", "ត្រូវសងថ្ងៃនេះ", "ថ្ងៃសន្យាថ្ងៃនេះ", "សងថ្ងៃនេះ"] },
        { kind: "expired", keywords: ["expired promise", "expired promises", "broken promise", "broken promises", "promise expired", "expired",
            "សន្យាផុតកំណត់", "ផុតកំណត់សន្យា", "ផុតកំណត់", "ខកសន្យា", "បំពានសន្យា"] },
        { kind: "unfilled", keywords: ["unfilled", "not filled", "no reason", "without reason", "missing reason", "reason arrear", "reason arrears", "fill reason",
            "មិនទាន់បំពេញ", "មិនទាន់មានមូលហេតុ", "គ្មានមូលហេតុ", "មិនទាន់ដាក់មូលហេតុ", "មូលហេតុយឺតយ៉ាវ", "reason"] },
        { kind: "all", keywords: ["work to complete", "my work", "today's work", "todays work", "to do", "todo", "to-do", "what should i do", "tasks today",
            "ការងារត្រូវបំពេញ", "ការងារថ្ងៃនេះ", "ការងាររបស់ខ្ញុំ", "ត្រូវធ្វើអ្វី", "កិច្ចការថ្ងៃនេះ"] }
    ];

    function findWork(text) {
        for (const w of WORK_KINDS) {
            if (hasAny(text, w.keywords)) return w.kind;
        }
        return null;
    }

    const ALERT_WORDS = ["alert", "alerts", "smart alert", "attention", "warning", "ត្រូវយកចិត្តទុកដាក់", "ការព្រមាន", "ព្រមាន", "ជូនដំណឹងឆ្លាតវៃ"];
    // "Why …" / "explain …" — or a Credit Portfolio page named on its own
    // ("ការព្រមានជាមុន") — asks for the explanation of that page's figures.
    const EXPLAIN_WORDS = ["ហេតុអ្វី", "ហេតុអី", "ពន្យល់", "ដោយសារអ្វី", "មកពីអ្វី", "why", "explain", "what happened", "how come"];
    const EXPLAIN_DIRECT = ["ការព្រមានជាមុន", "early warning", "ការប្រមូល npl", "npl recovery", "ចលនា npl", "npl movement",
        "វិភាគហានិភ័យ", "risk analysis", "គុណភាពផលប័ត្រ", "portfolio quality", "កំណើន និងហានិភ័យ", "growth vs risk",
        "ឥណទានណាត្រូវតាមដាន", "which loans to follow up", "ផលប័ត្ររបស់ខ្ញុំ", "my portfolio"];
    // Most specific first.
    const EXPLAIN_TOPICS = [
        { topic: "warning", keywords: ["ការព្រមានជាមុន", "ព្រមាន", "early warning", "warning", "ត្រូវតាមដាន", "follow up"] },
        { topic: "mine", keywords: ["ផលប័ត្ររបស់ខ្ញុំ", "របស់ខ្ញុំ", "my portfolio", "my loans", "my npl"] },
        { topic: "recovery", keywords: ["ការប្រមូល", "ប្រមូល", "recovery", "recovered", "recover"] },
        { topic: "growth", keywords: ["កំណើន", "growth"] },
        { topic: "quality", keywords: ["គុណភាព", "quality", "aging"] },
        { topic: "risk", keywords: ["វិភាគហានិភ័យ", "អ្នករួមចំណែក", "សាខាណា", "មន្ត្រីណា", "which officer", "contributor", "contributors", "risk"] },
        { topic: "npl", keywords: ["npl", "អិនភីអិល"] },
        { topic: "overview", keywords: ["ផលប័ត្រ", "portfolio", "overview", "ទិដ្ឋភាពទូទៅ"] }
    ];

    function findExplain(text) {
        const asked = hasAny(text, EXPLAIN_WORDS);
        if (!asked && !hasAny(text, EXPLAIN_DIRECT)) return null;
        const hit = EXPLAIN_TOPICS.find(x => hasAny(text, x.keywords));
        return hit ? hit.topic : asked ? "overview" : null;
    }

    const HELP_WORDS = ["help", "what can you do", "commands", "ជំនួយ", "អាចធ្វើអ្វី", "ធ្វើអ្វីបាន", "របៀបប្រើ"];
    const THEMES = [
        { value: "dark", keywords: ["dark mode", "dark theme", "រូបរាងងងឹត", "ពណ៌ងងឹត", "របៀបងងឹត"] },
        { value: "light", keywords: ["light mode", "classic mode", "light theme", "រូបរាងភ្លឺ", "ពណ៌ភ្លឺ", "របៀបភ្លឺ"] },
        { value: "auto", keywords: ["auto mode", "system mode", "រូបរាងស្វ័យប្រវត្តិ", "ស្វ័យប្រវត្តិ"] }
    ];

    function findPage(text) {
        for (const p of PAGES) {
            if (hasAny(text, p.keywords)) return p.page;
        }
        return null;
    }

    function findMetric(text) {
        for (const m of METRICS) {
            if (hasAny(text, m.keywords)) return m.metric;
        }
        return null;
    }

    // "by number of loans" — disbursement rankings count loans instead of $.
    const LOAN_COUNT_WORDS = ["# loan", "# loans", "#loan", "#loans", "number of loans", "loan count", "by loans", "ចំនួនកម្ចី", "ចំនួនគណនី", "តាមចំនួន"];

    function findRank(text) {
        const dir = hasAny(text, BOTTOM_WORDS) ? "bottom" : hasAny(text, TOP_WORDS) ? "top" : null;
        if (!dir) return null;
        const level = hasAny(text, BRANCH_WORDS) && !hasAny(text, OFFICER_WORDS) ? "branch" : "officer";
        const by = hasAny(text, LOAN_COUNT_WORDS) ? "loans" : "value";
        return { dir, level, by };
    }

    // ---------- "compared with …" ----------
    const COMPARE_WORDS = ["compared with", "compared to", "compare with", "compare to", "compare", "versus", "vs", "since",
        "ធៀបជាមួយ", "ធៀបនឹង", "ប្រៀបធៀប", "ធៀប", "តាំងពី", "គិតពី"];
    const COMPARE_MODES = [
        { mode: "year", keywords: ["end of last year", "last year end", "year end", "year to date", "ytd", "last year", "this year", "start of the year", "start of year",
            "ចុងឆ្នាំមុន", "ឆ្នាំមុន", "ដើមឆ្នាំ", "ឆ្នាំនេះ"] },
        { mode: "month", keywords: ["end of last month", "last month end", "month end", "month to date", "mtd", "last month", "previous month", "this month", "start of the month", "start of month",
            "ចុងខែមុន", "ខែមុន", "ដើមខែ", "ខែនេះ"] },
        { mode: "prev", keywords: ["yesterday", "previous day", "day before", "last day", "ម្សិលមិញ", "ថ្ងៃមុន"] }
    ];

    function pad2(n) {
        return String(n).padStart(2, "0");
    }

    // A real calendar date as YYYY-MM-DD, or null.
    function dateKey(y, m, d) {
        const dt = new Date(Date.UTC(+y, +m - 1, +d));
        if (dt.getUTCFullYear() !== +y || dt.getUTCMonth() !== +m - 1 || dt.getUTCDate() !== +d) return null;
        return `${y}-${pad2(m)}-${pad2(d)}`;
    }

    // Pulls the comparison out of the text (so a date's digits never
    // read as a CO ID) — returns { compare, rest }.
    function extractCompare(text) {
        let compare = null;
        let rest = text;
        const iso = rest.match(/(^|\D)(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)/);
        const dmy = rest.match(/(^|\D)(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?!\d)/);
        if (iso && dateKey(iso[2], iso[3], iso[4])) {
            compare = { mode: "date", date: dateKey(iso[2], iso[3], iso[4]) };
            rest = rest.replace(iso[0], iso[1] + " ");
        } else if (dmy && dateKey(dmy[4], dmy[3], dmy[2])) {
            compare = { mode: "date", date: dateKey(dmy[4], dmy[3], dmy[2]) };
            rest = rest.replace(dmy[0], dmy[1] + " ");
        } else {
            for (const c of COMPARE_MODES) {
                if (hasAny(rest, c.keywords)) {
                    compare = { mode: c.mode, date: null };
                    rest = strip(rest, c.keywords);
                    break;
                }
            }
        }
        if (compare) rest = strip(rest, COMPARE_WORDS);
        return { compare, rest };
    }

    function parse(raw) {
        const { compare, rest } = extractCompare(normalize(raw));
        const intent = parseCore(rest);
        if (!compare) return intent;
        if (intent.type === "ask") return { ...intent, compare };
        // "ធៀបនឹងចុងខែមុន" on its own — the summary, compared that way.
        if (intent.type === "unknown") return { type: "ask", metric: "summary", rank: null, text: rest, compare };
        return intent;
    }

    function parseCore(text) {
        if (!text) return { type: "unknown", text };

        if (hasAny(text, HELP_WORDS)) return { type: "help", text };

        for (const th of THEMES) {
            if (hasAny(text, th.keywords)) return { type: "theme", value: th.value, text };
        }

        const explain = findExplain(text);
        if (explain && !hasAny(text, OPEN_WORDS)) return { type: "explain", topic: explain, text };

        const wantsOpen = hasAny(text, OPEN_WORDS);

        // "LGs loans this month", "refinanced Nhor" — "open LGs loans"
        // goes to the page instead.
        if (hasAny(text, LGS_WORDS)) {
            if (wantsOpen) return { type: "navigate", page: "lgs", text };
            return { type: "lgs", focus: hasAny(text, REFIN_WORDS) ? "refinanced" : "lgs", text };
        }

        // "today's unfilled reason arrear", "client arrear no officer
        // responsible" — unless it's "open work to complete".
        const work = findWork(text);
        if (work && !(wantsOpen && findPage(text))) return { type: "work", kind: work, text };

        // "search customer 0012345" / "ស្វែងរកអតិថិជន សុខ ដារា" /
        // "អតិថិជន 0012345" — a customer word plus something to look for.
        if (hasAny(text, SEARCH_VERBS) || hasAny(text, CUSTOMER_NOUNS)) {
            const query = strip(strip(text, OPEN_WORDS), CUSTOMER_WORDS);
            const looksLikeData = findMetric(text) || hasAny(text, OFFICER_WORDS) || hasAny(text, BRANCH_WORDS);
            if (query.length >= 2 && (hasAny(text, CUSTOMER_NOUNS) || (/\d{3,}/.test(query) && !looksLikeData))) {
                return { type: "customer", query, text };
            }
        }

        if (hasAny(text, ALERT_WORDS) && !wantsOpen) return { type: "alerts", text };

        const page = findPage(text);
        const metric = findMetric(text);
        const rank = findRank(text);

        // "open daily arrears" — an explicit open wins over a data word.
        if (wantsOpen && page) return { type: "navigate", page, text };

        if (metric) return { type: "ask", metric, rank, text };
        if (rank) return { type: "ask", metric: "overdue", rank, text };
        if (page) return { type: "navigate", page, text };
        if (hasAny(text, SUMMARY_WORDS) || hasAny(text, OFFICER_WORDS) || hasAny(text, BRANCH_WORDS)) {
            return { type: "ask", metric: "summary", rank: null, text };
        }

        return { type: "unknown", text };
    }

    // ---------- entity matching against the loaded overview ----------
    // Branch names as the sheet spells them, with the Khmer spelling a
    // Khmer speech engine writes them in.
    const BRANCH_ALIASES = {
        "svay rieng": ["ស្វាយរៀង"],
        "romeas haek": ["រមាសហែក", "romeas hek"],
        "kraol kou": ["ក្រោលគោ", "kroul kou"],
        "nhor": ["ញរ", "ញ៉ រ"],
        "svay teab": ["ស្វាយទាប"],
        "rumduol": ["រំដួល", "romduol"],
        "svay chrom": ["ស្វាយជ្រំ", "svay chrum"]
    };

    function stripZeros(v) {
        return String(v || "").trim().toLowerCase().replace(/^0+/, "");
    }

    function matchBranch(text, branches) {
        const t = normalize(text);
        for (const b of branches || []) {
            const name = String(b.branch || "").toLowerCase();
            if (!name) continue;
            const aliases = [name, ...(BRANCH_ALIASES[name] || [])];
            if (aliases.some(a => has(t, a))) return b;
        }
        return null;
    }

    function matchOfficer(text, officers) {
        const t = normalize(text);
        const ids = t.match(/\d{3,}/g) || [];
        for (const id of ids) {
            const hit = (officers || []).find(o => stripZeros(o.id) === stripZeros(id));
            if (hit) return hit;
        }
        // Full name first, then any name word of 3+ letters ("sok").
        for (const o of officers || []) {
            const name = normalize(o.name);
            if (name && t.includes(name)) return o;
        }
        const words = t.split(" ").filter(w => w.length >= 3 && !/^\d+$/.test(w));
        for (const o of officers || []) {
            const parts = normalize(o.name).split(" ");
            if (words.some(w => parts.includes(w))) return o;
        }
        return null;
    }

    const api = { normalize, parse, extractCompare, matchBranch, matchOfficer, PAGES };
    root.CMAssistantNLU = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
