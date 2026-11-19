// =========================================================
// REASON ARREAR KIT
// The parts of Reason Arrear shared by Daily Arrears (its modal) and
// Master Data > Work to complete (pages/masterdata/work.html):
//   - the five reason fields: split / compose of the combined texts
//   - the local pending store: Save writes to localStorage instantly,
//     Submit pushes every pending edit in one batch. Same key on both
//     pages, so a draft saved on one shows on the other.
//   - promise status (VBA StatusFromDate), GPS parsing
//   - reasonarrear fetch / upsert
//   - the map picker (Leaflet; the page carries the #mapBackdrop markup)
// =========================================================

(function () {
    const PENDING_KEY = "cmpro_pending_reasons";
    const pendingListeners = [];

    function getPending() {
        try {
            return JSON.parse(localStorage.getItem(PENDING_KEY) || "{}");
        } catch (err) {
            console.error("[pending reasons] corrupt localStorage data, resetting:", err);
            return {};
        }
    }

    function writePending(map) {
        localStorage.setItem(PENDING_KEY, JSON.stringify(map));
        pendingListeners.forEach(fn => { try { fn(); } catch (e) {} });
    }

    // ---------- the five reason fields (layout v2, 13/11/2026) ----------
    // The server keeps the combined texts aj "(ពេលខ្ចី)X, (បច្ចុប្បន្ន)Y"
    // and ak "(មូលហេតុ)X, (ដំណោះស្រាយ)Y" in step with the five parts; these
    // match CM-backend lib/reason-fields.js, so a draft shows the same
    // combined text the server will save.
    const LBL_OCC_LOAN = "(ពេលខ្ចី)";
    const LBL_OCC_NOW = "(បច្ចុប្បន្ន)";
    const LBL_REASON = "(មូលហេតុ)";
    const LBL_SOLUTION = "(ដំណោះស្រាយ)";
    const PARTS = ["occupationLoan", "occupationNow", "purpose", "reason", "solution"];
    const str = v => (v == null ? "" : String(v));

    // Splitting (v3, 16/11/2026) — the same rules as CM-backend's
    // lib/reason-fields.js. Labels were typed in many shapes, so each part
    // has a pattern: "(ពេលខ្ចី)", "(មុនពេលខ្ចី)", "(មុខរបរពេលខ្ចី):",
    // "(បច្ចុប្បន្ន)", "(មុខរបរបច្ចុប្បន្ន):", "(មូលហេតុ)", "(ដំណោះស្រាយ)" …
    // In brackets: anywhere. Without: only at the very start, or after
    // "," / ";" / a new line with a ":" after it — a word inside a
    // sentence is never a label. Text before the first label goes in
    // front of the first part; a part labelled twice keeps both; no label
    // at all -> all of it is the first part.
    const SP = "[\\s\\u200b]*";
    const LABEL_SRC = {
        occupationLoan: `(?:មុខរបរ${SP})?(?:មុន${SP})?ពេល${SP}ខ្ចី`,
        occupationNow: `(?:មុខរបរ${SP})?(?:ពេល${SP})?បច្ចុប្បន្ន`,
        reason: `មូល${SP}ហេតុ`,
        solution: `ដំណោះ${SP}ស្រាយ`
    };

    function findLabels(s, keys) {
        const hits = [];
        for (const key of keys) {
            const src = LABEL_SRC[key];
            const bracket = new RegExp(`[(（]${SP}${src}${SP}[)）]${SP}[:：]?`, "g");
            let m;
            while ((m = bracket.exec(s))) hits.push({ key, start: m.index, end: m.index + m[0].length });
            const startBare = new RegExp(`^${SP}${src}${SP}(?:[:：]|\\s)`);
            if ((m = startBare.exec(s))) hits.push({ key, start: m.index, end: m.index + m[0].length });
            const afterSep = new RegExp(`([,，;；\\n])${SP}(${src})${SP}[:：]`, "g");
            while ((m = afterSep.exec(s))) hits.push({ key, start: m.index + m[1].length, end: m.index + m[0].length });
        }
        hits.sort((x, y) => x.start - y.start || y.end - x.end);
        const out = [];
        for (const h of hits) if (!out.length || h.start >= out[out.length - 1].end) out.push(h);
        return out;
    }

    function cleanPart(s) {
        return str(s).replace(/^[\s:：,，;；​]+/, "").replace(/[\s,，;；​]+$/, "").trim();
    }

    function splitLabeled(text, firstKey, secondKey) {
        const out = { [firstKey]: "", [secondKey]: "" };
        const s = str(text);
        if (!s.trim()) return out;
        const hits = findLabels(s, [firstKey, secondKey]);
        if (!hits.length) { out[firstKey] = cleanPart(s); return out; }
        const pieces = { [firstKey]: [], [secondKey]: [] };
        hits.forEach((h, i) => {
            const v = cleanPart(s.slice(h.end, i + 1 < hits.length ? hits[i + 1].start : s.length));
            if (v) pieces[h.key].push(v);
        });
        const lead = cleanPart(s.slice(0, hits[0].start));
        if (lead) pieces[firstKey].unshift(lead);
        out[firstKey] = pieces[firstKey].join(", ");
        out[secondKey] = pieces[secondKey].join(", ");
        return out;
    }

    function splitOccupation(aj) {
        return splitLabeled(aj, "occupationLoan", "occupationNow");
    }

    function splitReason(ak) {
        return splitLabeled(ak, "reason", "solution");
    }

    function composeOccupation(occupationLoan, occupationNow) {
        const a = str(occupationLoan).trim();
        const b = str(occupationNow).trim();
        return a || b ? `${LBL_OCC_LOAN}${a}, ${LBL_OCC_NOW}${b}` : "";
    }

    function composeReason(reason, solution) {
        const a = str(reason).trim();
        const b = str(solution).trim();
        return a || b ? `${LBL_REASON}${a}, ${LBL_SOLUTION}${b}` : "";
    }

    // The five parts of a record / row / draft: its own fields when it
    // carries them, else split out of its combined aj / ak (a draft saved
    // before this version, a row handed over from Daily Arrears).
    function hasParts(o) {
        return !!o && PARTS.some(k => typeof o[k] === "string");
    }
    function partsOf(o) {
        const d = o || {};
        if (hasParts(d)) return Object.fromEntries(PARTS.map(k => [k, str(d[k])]));
        return { ...splitOccupation(d.aj), purpose: "", ...splitReason(d.ak) };
    }

    // parts: { occupationLoan, occupationNow, purpose, reason, solution }.
    // The combined aj / ak go along, for every page that shows them.
    function setPending(concate, parts, alISO, gps) {
        const p = partsOf(parts);
        const map = getPending();
        map[concate] = {
            aj: composeOccupation(p.occupationLoan, p.occupationNow),
            ak: composeReason(p.reason, p.solution),
            ...p,
            al: alISO,
            gps: gps || "",
            savedAt: new Date().toISOString()
        };
        writePending(map);
    }

    function removePending(concates) {
        const map = getPending();
        concates.forEach(c => delete map[c]);
        writePending(map);
    }

    // Mirrors VBA's StatusFromDate exactly: compares the follow-up date
    // (AL, dd/mm/yyyy) against today, in whole days.
    //   diff == 0  -> "Today_Payment"
    //   diff  > 0  -> "Upcoming_left: N Days"
    //   diff  < 0  -> "Expired: N Days"
    //   no date    -> ""
    function computeStatus(alFollowupDMY) {
        if (!alFollowupDMY) return "";

        const parts = alFollowupDMY.split("/");
        if (parts.length !== 3) return "";
        const [dd, mm, yyyy] = parts.map(Number);
        if (!dd || !mm || !yyyy) return "";

        const followup = Date.UTC(yyyy, mm - 1, dd);
        const now = new Date();
        const todayUTC = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());

        const diffDays = Math.round((followup - todayUTC) / 86400000);

        if (diffDays === 0) return "Today_Payment";
        if (diffDays > 0) return `Upcoming_left: ${diffDays} Days`;
        return `Expired: ${Math.abs(diffDays)} Days`;
    }

    // Accepts "11.5564, 104.9282" or "11.5564,104.9282".
    // Returns null when it isn't a usable coordinate pair.
    // "lat, lng" — the two numbers may also be split by a space, ";" or
    // "/" (iOS's number pad has no ","; 19/11/2026).
    function parseGps(text) {
        const m = String(text || "").trim().match(
            /^(-?\d{1,2}(?:\.\d+)?)\s*(?:[,;/，]\s*|\s+)(-?\d{1,3}(?:\.\d+)?)$/
        );
        if (!m) return null;

        const lat = parseFloat(m[1]);
        const lng = parseFloat(m[2]);
        if (!isFinite(lat) || !isFinite(lng)) return null;
        if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

        return { lat, lng };
    }

    // Canonical reasonarrear records for a batch of LD-CIF keys, as a Map
    // keyed by LD-CIF. Chunked (800, the VBA's GET_CHUNK) and fired
    // concurrently; a failed chunk just isn't in the map.
    async function fetchReasons(concates, token) {
        const CHUNK = 800;
        const chunks = [];
        for (let i = 0; i < concates.length; i += CHUNK) {
            const chunk = concates.slice(i, i + CHUNK);
            if (chunk.length) chunks.push(chunk);
        }

        const results = await Promise.all(chunks.map(async (chunk) => {
            try {
                const res = await fetch(`${API.BASE_URL}/api/reasonarrear/get`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${token}`
                    },
                    body: JSON.stringify({ cifs: chunk })
                });
                const data = await res.json();
                return data.ok ? (data.data || []) : [];
            } catch (err) {
                console.error("[reasonarrear] chunk fetch failed:", err);
                return [];
            }
        }));

        const map = new Map();
        results.flat().forEach(item => {
            if (item.cif) map.set(item.cif, item);
        });
        return map;
    }

    // Pushes the given pending edits (chunked at 1000, the VBA's
    // UP_CHUNK). Throws on the first failed chunk; the pending store is
    // left for the caller to clear once it's confirmed.
    // Returns { pending, keptAdmin }: LD-CIFs whose change waits for
    // Admin's approval / that kept Admin's correction (server's review of
    // admin-corrected reasons).
    async function upsertPending(concates, map, token, uploadedBy) {
        const UP_CHUNK = 1000;
        const out = { pending: [], keptAdmin: [] };
        for (let i = 0; i < concates.length; i += UP_CHUNK) {
            const chunkConcates = concates.slice(i, i + UP_CHUNK);
            // v2 rows (8 values): the five parts, promise date, GPS — the
            // only shape the server accepts (older rows mean an old Excel).
            // A draft saved before the five fields existed (combined text
            // only) is split here first. GPS is always sent, even when
            // empty, so clearing a coordinate actually clears it.
            // Such a draft has no purpose: keep the one already saved.
            const legacy = chunkConcates.filter(c => !hasParts(map[c]));
            const saved = legacy.length ? await fetchReasons(legacy, token) : new Map();
            const rows = chunkConcates.map(c => {
                const d = map[c];
                const p = partsOf(d);
                if (!hasParts(d)) p.purpose = String(saved.get(c)?.purpose || "");
                return [c, p.occupationLoan, p.occupationNow, p.purpose, p.reason, p.solution, d.al, d.gps || ""];
            });

            const res = await fetch(`${API.BASE_URL}/api/reasonarrear/upsert`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({ uploadedBy, rows })
            });
            const data = await res.json();
            if (!data.ok) throw new Error(data.message || "Submit failed.");
            out.pending.push(...(data.pending || []));
            out.keptAdmin.push(...(data.keptAdmin || []));
        }
        return out;
    }

    // The toast text for what the review held back ("" when nothing).
    function reviewNote(r) {
        const t = (k, v) => (window.CMI18n ? CMI18n.t(k, v) : k);
        const parts = [];
        if (r && r.pending && r.pending.length) parts.push(t("reason.review.pending", { n: r.pending.length }));
        if (r && r.keptAdmin && r.keptAdmin.length) parts.push(t("reason.review.kept", { n: r.keptAdmin.length }));
        return parts.join(" ");
    }

    // ---------- map picker ----------
    // Leaflet + OpenStreetMap / Esri tiles: no API key needed. Created
    // lazily on first open, since most sessions never touch it.
    let map = null;
    let marker = null;
    let layers = null;
    let onConfirm = null;

    const MAP_TILES = {
        street: {
            url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
            opts: { maxZoom: 19, attribution: "© OpenStreetMap" }
        },
        satellite: {
            url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
            // Esri serves imagery to z19 in most of Cambodia; maxNativeZoom
            // lets Leaflet upscale beyond that instead of blank tiles.
            opts: { maxZoom: 21, maxNativeZoom: 19, attribution: "© Esri" }
        }
    };

    // Remembered across sessions.
    const MAP_MODE_KEY = "CMPRO_map_mode";
    // Svay Rieng town when there's no coordinate yet.
    const MAP_FALLBACK = { lat: 11.0879, lng: 105.7993 };

    function currentMapMode() {
        return localStorage.getItem(MAP_MODE_KEY) === "satellite" ? "satellite" : "street";
    }

    function setMapMode(mode) {
        if (!map || !layers) return;
        const next = mode === "satellite" ? "satellite" : "street";
        const other = next === "satellite" ? "street" : "satellite";
        if (map.hasLayer(layers[other])) map.removeLayer(layers[other]);
        if (!map.hasLayer(layers[next])) layers[next].addTo(map);
        localStorage.setItem(MAP_MODE_KEY, next);
        document.querySelectorAll(".map-mode-btn").forEach(btn => {
            btn.classList.toggle("active", btn.dataset.mode === next);
        });
    }

    function setMapCoords(lat, lng) {
        const el = document.getElementById("mapCoords");
        if (el) el.textContent = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    }

    function closeMapPicker() {
        document.getElementById("mapBackdrop")?.classList.remove("show");
    }

    let mapBound = false;
    function bindMapControls(notify) {
        if (mapBound) return;
        mapBound = true;
        document.querySelectorAll(".map-mode-btn").forEach(btn => {
            btn.addEventListener("click", () => setMapMode(btn.dataset.mode));
        });
        document.getElementById("btnMapClose")?.addEventListener("click", closeMapPicker);
        document.getElementById("mapBackdrop")?.addEventListener("click", (e) => {
            if (e.target.id === "mapBackdrop") closeMapPicker();
        });
        // Centre the picker on the device's position without leaving the map.
        document.getElementById("btnMapHere")?.addEventListener("click", () => {
            locateHere(
                (lat, lng) => {
                    map.setView([lat, lng], 17);
                    marker.setLatLng([lat, lng]);
                    setMapCoords(lat, lng);
                },
                () => notify("មិនអាចកំណត់ទីតាំងបានទេ", "warning")
            );
        });
        document.getElementById("btnMapConfirm")?.addEventListener("click", () => {
            if (!marker) return;
            const { lat, lng } = marker.getLatLng();
            closeMapPicker();
            if (onConfirm) onConfirm(lat, lng);
        });
    }

    // initial: the current "lat, lng" text (may be blank / invalid);
    // confirm(lat, lng) is called when the person taps OK.
    function openMapPicker({ initial, confirm, notify }) {
        const backdrop = document.getElementById("mapBackdrop");
        if (!backdrop) return;
        if (typeof L === "undefined") {
            notify("មិនអាចផ្ទុកផែនទីបានទេ — សូមពិនិត្យអ៊ីនធឺណិត", "error");
            return;
        }
        bindMapControls(notify);
        onConfirm = confirm;

        const existing = parseGps(initial);
        const start = existing || MAP_FALLBACK;
        backdrop.classList.add("show");

        if (!map) {
            map = L.map("mapCanvas").setView([start.lat, start.lng], existing ? 17 : 13);
            layers = {
                street: L.tileLayer(MAP_TILES.street.url, MAP_TILES.street.opts),
                satellite: L.tileLayer(MAP_TILES.satellite.url, MAP_TILES.satellite.opts)
            };
            layers[currentMapMode()].addTo(map);

            // A CSS-drawn divIcon: Leaflet's default marker image 404s
            // from the CDN, which left the pin invisible.
            const pinIcon = L.divIcon({
                className: "map-pin-wrap",
                html: '<div class="map-pin"></div>',
                iconSize: [26, 34],
                iconAnchor: [13, 34]
            });
            marker = L.marker([start.lat, start.lng], { icon: pinIcon, draggable: true }).addTo(map);
            marker.on("dragend", () => {
                const { lat, lng } = marker.getLatLng();
                setMapCoords(lat, lng);
            });
            // Tap anywhere to place the pin — quicker than dragging on a phone.
            map.on("click", (e) => {
                marker.setLatLng(e.latlng);
                setMapCoords(e.latlng.lat, e.latlng.lng);
            });
        } else {
            map.setView([start.lat, start.lng], existing ? 17 : 13);
            marker.setLatLng([start.lat, start.lng]);
        }

        setMapCoords(start.lat, start.lng);
        setMapMode(currentMapMode());
        // Leaflet measures its container on creation; inside a hidden
        // modal that's zero-sized, so the tiles render grey without this.
        setTimeout(() => map.invalidateSize(), 60);
    }

    // The device's position: ok(lat, lng, accuracyM) or fail(error|null).
    function locateHere(ok, fail) {
        if (!navigator.geolocation) return fail(null);
        navigator.geolocation.getCurrentPosition(
            pos => ok(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy),
            err => fail(err),
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
    }

    // Opens a coordinate in Google Maps. On iPhone / iPad that means the
    // Google Maps app (comgooglemaps://); when it isn't installed the
    // page is still showing a moment later, so fall back to Google Maps
    // on the web rather than Apple Maps.
    function openInMaps(lat, lng) {
        const web = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
            || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
        if (!isIOS) {
            window.open(web, "_blank", "noopener");
            return;
        }
        let left = false;
        const away = () => { left = true; };
        document.addEventListener("visibilitychange", away, { once: true });
        window.addEventListener("pagehide", away, { once: true });
        window.location.href = `comgooglemaps://?q=${lat},${lng}&center=${lat},${lng}&zoom=17`;
        setTimeout(() => {
            document.removeEventListener("visibilitychange", away);
            window.removeEventListener("pagehide", away);
            if (!left && !document.hidden) window.location.href = web;
        }, 1500);
    }

    // ---------- predictive suggestions ----------
    // A custom dropdown rather than <datalist> (some fields are textareas):
    // previously-used answers from getSourceValues(), so a person can pick
    // one instead of retyping it.
    function attachSuggestions(fieldEl, getSourceValues) {
        if (!fieldEl) return;
        const list = document.createElement("ul");
        list.className = "suggestion-list";
        fieldEl.parentElement.appendChild(list);

        function hide() {
            list.classList.remove("show");
            list.innerHTML = "";
        }

        function showSuggestionsFor(query) {
            const q = query.trim().toLowerCase();
            if (!q) { hide(); return; }
            const matches = getSourceValues()
                .filter(v => v.toLowerCase().includes(q) && v.toLowerCase() !== q)
                .slice(0, 8);
            if (!matches.length) { hide(); return; }

            list.innerHTML = "";
            matches.forEach(value => {
                const li = document.createElement("li");
                li.textContent = value;
                li.addEventListener("mousedown", (e) => {
                    // mousedown (not click) fires before the field's blur
                    e.preventDefault();
                    fieldEl.value = value;
                    hide();
                    fieldEl.focus();
                });
                list.appendChild(li);
            });
            list.classList.add("show");
        }

        fieldEl.addEventListener("input", () => showSuggestionsFor(fieldEl.value));
        fieldEl.addEventListener("focus", () => showSuggestionsFor(fieldEl.value));
        fieldEl.addEventListener("blur", hide);
    }

    // Purpose (គោលបំណងប្រើប្រាស់) for a blank one, from the loan's product.
    // Same table as CM-backend lib/reason-purpose.js.
    const PURPOSE_BY_PRODUCT = {
        "personal loan": "ប្រើប្រាស់ផ្ទាល់ខ្លួន",
        "visa card": "ប្រើប្រាស់ផ្ទាល់ខ្លួន",
        "advance salary loan": "ប្រើប្រាស់ផ្ទាល់ខ្លួន",
        "by now pay later": "ប្រើប្រាស់ផ្ទាល់ខ្លួន",   // spelled so in T24
        "buy now pay later": "ប្រើប្រាស់ផ្ទាល់ខ្លួន",
        "consumer credit card": "ប្រើប្រាស់ផ្ទាល់ខ្លួន",
        "master credit card": "ប្រើប្រាស់ផ្ទាល់ខ្លួន",
        "payroll loan": "ប្រើប្រាស់ផ្ទាល់ខ្លួន",
        "small loan": "បន្ថែមទុនក្នុងមុខរបរ",
        "ac moblie merchants": "បង្វិលទុនក្នុងមុខរបរ",   // spelled so in T24
        "ac mobile merchants": "បង្វិលទុនក្នុងមុខរបរ",
        "home improvement loan": "កែលម្អលំនៅឋាន",
        "public housing loan": "សាងសង់/ទិញផ្ទះ"
    };
    function purposeForProduct(product) {
        return PURPOSE_BY_PRODUCT[String(product ?? "").trim().toLowerCase().replace(/\s+/g, " ")] || "";
    }

    window.ReasonKit = {
        reviewNote,
        purposeForProduct,
        attachSuggestions,
        PARTS,
        partsOf,
        splitOccupation,
        splitReason,
        composeOccupation,
        composeReason,
        PENDING_KEY,
        getPending,
        setPending,
        removePending,
        pendingCount: () => Object.keys(getPending()).length,
        onPendingChange: fn => pendingListeners.push(fn),
        computeStatus,
        parseGps,
        fetchReasons,
        upsertPending,
        openMapPicker,
        closeMapPicker,
        locateHere,
        openInMaps
    };
})();
