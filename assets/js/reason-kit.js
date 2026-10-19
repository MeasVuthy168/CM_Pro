// =========================================================
// REASON ARREAR KIT
// The parts of Reason Arrear shared by Daily Arrears (its modal) and
// Master Data > Work to complete (pages/masterdata/work.html):
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

    function setPending(concate, aj, ak, alISO, gps) {
        const map = getPending();
        map[concate] = {
            aj,
            ak,
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
    function parseGps(text) {
        const m = String(text || "").trim().match(
            /^(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$/
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
    async function upsertPending(concates, map, token, uploadedBy) {
        const UP_CHUNK = 1000;
        for (let i = 0; i < concates.length; i += UP_CHUNK) {
            const chunkConcates = concates.slice(i, i + UP_CHUNK);
            // The 5th element tells the server this client manages GPS.
            // Always sent, even when empty, so clearing a coordinate
            // actually clears it server-side.
            const rows = chunkConcates.map(c =>
                [c, map[c].aj, map[c].ak, map[c].al, map[c].gps || ""]
            );

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
        }
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

    // Opens the platform's map app at a coordinate.
    function openInMaps(lat, lng) {
        // maps.apple.com rather than maps://, so it resolves where custom
        // schemes are blocked.
        const isApple = /iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent);
        const url = isApple
            ? `https://maps.apple.com/?q=${lat},${lng}`
            : `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
        window.open(url, "_blank", "noopener");
    }

    // ---------- field templates ----------
    // Both fields follow a fixed "(label)value, (label)value" shape. The
    // scaffolding is inserted on focus so it never has to be typed, with
    // the caret parked after the first label. A value that is still
    // nothing but scaffolding counts as empty (isTemplateOnly), so merely
    // tapping a field doesn't save a row of empty brackets.
    const TEMPLATE_AJ = "(ពេលខ្ចី), (បច្ចុប្បន្ន)";
    const TEMPLATE_AK = "(មូលហេតុ), (ដំណោះស្រាយ)";

    function isTemplateOnly(value, template) {
        const labels = template.match(/\([^)]*\)/g) || [];
        let rest = String(value || "");
        labels.forEach(l => { rest = rest.split(l).join(""); });
        return rest.replace(/[\s,]/g, "") === "";
    }

    function attachTemplate(el, tpl) {
        if (!el) return;
        el.addEventListener("focus", () => {
            if (el.value.trim() !== "") return;
            el.value = tpl;
            // Caret after the first "(label)", so typing continues there.
            const pos = tpl.indexOf(")") + 1;
            requestAnimationFrame(() => {
                try { el.setSelectionRange(pos, pos); } catch (e) { /* not supported */ }
            });
        });
        // Left holding only scaffolding -> clear it, so it isn't saved as
        // if it were a real answer.
        el.addEventListener("blur", () => {
            if (isTemplateOnly(el.value, tpl)) el.value = "";
        });
    }

    function attachTemplates(ajEl, akEl) {
        attachTemplate(ajEl, TEMPLATE_AJ);
        attachTemplate(akEl, TEMPLATE_AK);
    }

    // ---------- predictive suggestions ----------
    // A custom dropdown rather than <datalist> (AK is a <textarea>):
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

    window.ReasonKit = {
        attachTemplates,
        attachSuggestions,
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
