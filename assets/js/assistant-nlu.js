/* =========================================================
   ASSISTANT NLU (CM Pro AI — Level 1)
   Turns what the user typed or said (Khmer or English) into one
   intent the chat / voice sheet can act on. Rule-based on purpose —
   keyword lists, no AI service — so nothing the user says leaves
   the phone except the data request itself.

   parse(text) returns one of:
     { type: "navigate", page }            open a page
     { type: "customer", query }           Customer Search with a keyword
     { type: "ask", metric, rank, text }   a data question; metric is
                                           os | par | npl | disb | summary,
                                           rank { dir: top|bottom, level:
                                           officer|branch } or null; the
                                           entity (branch / CO) is matched
                                           later against the loaded data
     { type: "alerts" }                    today's Smart Alerts
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
        { page: "creditReport", keywords: ["credit report", "report", "reports", "របាយការណ៍ឥណទាន", "របាយការណ៍"] },
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
        { metric: "par", keywords: ["par", "par t24", "portfolio at risk", "ផារ", "ប៉ារ", "ហានិភ័យឥណទាន", "ហានិភ័យ"] },
        { metric: "disb", keywords: ["disburse", "disbursed", "disbursement", "disbursements", "បញ្ចេញឥណទាន", "ផ្តល់ឥណទាន", "បើកប្រាក់កម្ចី", "បញ្ចេញ"] },
        { metric: "os", keywords: ["os", "outstanding", "loan outstanding", "portfolio", "អូអេស", "សមតុល្យឥណទាន", "ឥណទានសរុប", "ប្រាក់កម្ចីសរុប", "សមតុល្យ"] }
    ];
    const SUMMARY_WORDS = ["summary", "overview", "today", "how are we", "how is", "status", "សង្ខេប", "ស្ថានភាព", "ថ្ងៃនេះ", "ទិន្នន័យ", "យ៉ាងម៉េច", "យ៉ាងដូចម្តេច"];

    const TOP_WORDS = ["top", "highest", "most", "worst", "biggest", "largest", "ខ្ពស់ជាងគេ", "ច្រើនជាងគេ", "ខ្ពស់បំផុត", "ច្រើនបំផុត", "អាក្រក់ជាងគេ", "ធំជាងគេ", "ល្អជាងគេ", "ណាខ្លះ"];
    const BOTTOM_WORDS = ["lowest", "least", "smallest", "ទាបជាងគេ", "តិចជាងគេ", "ទាបបំផុត", "តិចបំផុត"];
    const OFFICER_WORDS = ["co", "cos", "officer", "officers", "staff", "មន្ត្រី", "បុគ្គលិក", "មន្រ្តី"];
    const BRANCH_WORDS = ["branch", "branches", "សាខា"];

    const ALERT_WORDS = ["alert", "alerts", "smart alert", "attention", "warning", "ត្រូវយកចិត្តទុកដាក់", "ការព្រមាន", "ព្រមាន", "ជូនដំណឹងឆ្លាតវៃ"];
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

    function findRank(text) {
        const dir = hasAny(text, BOTTOM_WORDS) ? "bottom" : hasAny(text, TOP_WORDS) ? "top" : null;
        if (!dir) return null;
        const level = hasAny(text, BRANCH_WORDS) && !hasAny(text, OFFICER_WORDS) ? "branch" : "officer";
        return { dir, level };
    }

    function parse(raw) {
        const text = normalize(raw);
        if (!text) return { type: "unknown", text };

        if (hasAny(text, HELP_WORDS)) return { type: "help", text };

        for (const th of THEMES) {
            if (hasAny(text, th.keywords)) return { type: "theme", value: th.value, text };
        }

        const wantsOpen = hasAny(text, OPEN_WORDS);

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
        if (rank) return { type: "ask", metric: "par", rank, text };
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

    const api = { normalize, parse, matchBranch, matchOfficer, PAGES };
    root.CMAssistantNLU = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
