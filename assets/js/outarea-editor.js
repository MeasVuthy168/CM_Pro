// =========================================================
// EDIT OUT-OF-AREA ARREARS — កែសម្រួលArrearក្រៅតំបន់
// List -> pick one customer -> reassign Branch/CO -> Save.
//
// Shared by two pages, which both carry the same markup (same IDs):
//   - Daily Arrears (pages/arrears) — as a modal, opened from Work to
//     complete > NoCoRespone; rows come from the page's arrears data.
//   - Master Data > Edit Out-of-Area Arrears (pages/masterdata/outarea.html)
//     — as its own page; rows come from /api/arreast24byco/outarea.
// Each page calls OutAreaEditor.init(host) once, where host gives:
//   token()               JWT for API calls
//   getCandidateRows()    rows to list in "To edit" (NoCoRespone filtered here)
//   getAllRows()          rows to match saved records against ("Edited")
//   getOfficerNames(br)   officer (CO Response) names for a branch
//   canEdit               upload roles only (Admin / User); else read-only
//   onSaved(), onClose()  optional page hooks
//   formatDateTime(v)     optional, the page's own date-time format
//
// Field mapping confirmed against the VBA (frmOutArea + modCM_Syn's
// Upload_WrongAddress, firstCol="B" lastCol="D"):
//   LD-CIF          -> row.concate   (VBA's "LD_CIF" is this same
//                       Concate/AG column, also used as the Reason
//                       Arrear key on Daily Arrears)
//   Name            -> row.customer
//   Address         -> row.location
//   Account Loan    -> row.accountLoan
//   Current Branch  -> row.branch
//   Current CO      -> row.coId
// Saved as values=[ldCif, newBranch, newCoResponse] into the SAME
// "wrongaddress" Mongo collection the VBA bulk-uploads to.
// =========================================================

(function () {
    const t = (key) => (window.CMI18n ? CMI18n.t(key) : key);

    function notify(message, type = "info") {
        if (typeof CMToast !== "undefined" && CMToast.show) {
            CMToast.show({ type, title: message, message: "", duration: 3000 });
        } else {
            alert(message);
        }
    }

    function escapeHtml(text) {
        const div = document.createElement("div");
        div.textContent = text == null ? "" : String(text);
        return div.innerHTML.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }

    function classRowCssClass(classValue) {
        switch (classValue) {
            case "Loss": return "row-class-loss";
            case "Doubtful": return "row-class-doubtful";
            case "Sub Standard":
            case "Sub-Standard": return "row-class-substandard";
            case "Special Mention": return "row-class-specialmention";
            default: return "";
        }
    }

    function arrFormatAmount(value) {
        const n = parseFloat(String(value ?? "").replace(/,/g, ""));
        if (!Number.isFinite(n)) return value || "-";
        return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function normalizeOfficerId(id) {
        return String(id || "").trim().replace(/^0+/, "");
    }

    // "2026-10-19 04:06 PM", Cambodia time — unless the page has its own.
    function defaultDateTime(value) {
        const d = new Date(value);
        if (!value || isNaN(d)) return value || "";
        const k = new Date(d.getTime() + 7 * 3600 * 1000);
        const pad = n => String(n).padStart(2, "0");
        let h = k.getUTCHours();
        const ampm = h >= 12 ? "PM" : "AM";
        h = h % 12 || 12;
        return `${k.getUTCFullYear()}-${pad(k.getUTCMonth() + 1)}-${pad(k.getUTCDate())} ${pad(h)}:${pad(k.getUTCMinutes())} ${ampm}`;
    }

    let host = null;
    const fmtDateTime = v => (host && host.formatDateTime ? host.formatDateTime(v) : defaultDateTime(v));
    const api = { normalizeOfficerId, officerNames: () => null };

    api.init = function init(h) {
        host = h;
        document.getElementById("outAreaCard")?.classList.toggle("oa-readonly", !host.canEdit);

        let outAreaSelectedRow = null;

        let outAreaViewMode = "candidates"; // "candidates" | "edited"

        function getOutAreaCandidates(searchTerm) {
            const q = (searchTerm || "").trim().toLowerCase();
            return host.getCandidateRows().filter(row => {
                if (!row.concate) return false; // no LD-CIF/Concate key, nothing to reassign

                // Base filter: only customers flagged with the "NoCoRespone" marker
                // in their coResponse field — matches the VBA's own default view
                // (btnShowLastBackup_Click presets its search to this same text).
                if (!(row.coResponse || "").toLowerCase().includes("nocorespone")) return false;

                if (!q) return true;
                return (row.customer || "").toLowerCase().includes(q)
                    || (row.concate || "").toLowerCase().includes(q)
                    || (row.branch || "").toLowerCase().includes(q);
            });
        }

        // Web equivalent of VBA's "Show Last Backup" — everyone who already has a
        // saved reassignment, fetched from the server (not client-side data, since
        // WrongAddress records aren't part of the arrears rows already in memory).
        async function fetchOutAreaEditedItems(searchTerm) {
            const params = new URLSearchParams();
            if (searchTerm) params.set("keyword", searchTerm);
            params.set("limit", "2000"); // matches the backend's max cap — shows the full list, not just the newest 500

            const res = await fetch(`${API.BASE_URL}/api/wrongaddress/list?${params.toString()}`, {
                headers: { Authorization: `Bearer ${host.token()}` }
            });
            const data = await res.json();
            if (!data.ok) throw new Error(data.message || "Failed to load edited list.");
            return data;
        }

        let outAreaBranchFilter = ""; // quick branch chip on the list ("" = all)

        // "LD2400000|1000000" -> "LD2400000 · CIF 1000000"
        function formatLdCif(ldCif) {
            const [ld, cif] = String(ldCif || "").split("|");
            return cif ? `${ld} · CIF ${cif}` : String(ldCif || "");
        }

        // The Edited tab's count, without waiting for the tab to be opened.
        function refreshOutAreaEditedCount() {
            fetchOutAreaEditedItems("").then(d => setOutAreaTabCount("edited", (d.items || []).length)).catch(() => {});
        }

        function setOutAreaTabCount(view, n) {
            const el = document.getElementById(view === "edited" ? "oaTabEditedCount" : "oaTabCandidatesCount");
            if (el) el.textContent = Number.isFinite(n) ? n.toLocaleString() : "";
            if (host.onCounts) host.onCounts(view, n);
        }

        // Branch chips with a count each; tapping one narrows the list.
        function renderOutAreaBranchFilter(entries) {
            const wrap = document.getElementById("outAreaBranchFilter");
            if (!wrap) return;
            const counts = new Map();
            entries.forEach(e => {
                const b = e.thirdCol || "-";
                counts.set(b, (counts.get(b) || 0) + 1);
            });
            if (outAreaBranchFilter && !counts.has(outAreaBranchFilter)) outAreaBranchFilter = "";
            if (counts.size < 2 && !outAreaBranchFilter) { wrap.innerHTML = ""; return; }
            const chip = (value, label, n) => `
                <button type="button" class="oa-filter-chip ${outAreaBranchFilter === value ? "active" : ""}" data-branch="${escapeHtml(value)}">
                    ${escapeHtml(label)} <span>${n.toLocaleString()}</span>
                </button>`;
            wrap.innerHTML = chip("", t("arrears.optionAll"), entries.length) +
                [...counts.entries()].sort((x, y) => x[0].localeCompare(y[0])).map(([b, n]) => chip(b, b, n)).join("");
        }

        function applyOutAreaBranchFilter(entries) {
            renderOutAreaBranchFilter(entries);
            return outAreaBranchFilter ? entries.filter(e => (e.thirdCol || "-") === outAreaBranchFilter) : entries;
        }

        document.getElementById("outAreaBranchFilter")?.addEventListener("click", (e) => {
            const chip = e.target.closest("[data-branch]");
            if (!chip) return;
            outAreaBranchFilter = chip.dataset.branch;
            renderOutAreaList();
        });

        async function renderOutAreaList() {
            const searchTerm = document.getElementById("outAreaSearch").value;
            const tbody = document.getElementById("outAreaTbody");

            if (outAreaViewMode === "candidates") {
                document.getElementById("outAreaSelectBar").hidden = true;
                document.getElementById("outAreaBulkBar").hidden = true;
                outAreaSelectedForDelete.clear();
                if (!searchTerm.trim()) setOutAreaTabCount("candidates", getOutAreaCandidates("").length);
                const all = getOutAreaCandidates(searchTerm).map(row => ({
                    customer: row.customer,
                    ldCif: row.concate,
                    thirdCol: row.branch,
                    row // full row object, ready for selectOutAreaCustomer as-is
                }));
                const rows = applyOutAreaBranchFilter(all);
                renderOutAreaRows(
                    rows.slice(0, 300),
                    rows.length,
                    (rows.length > 300)
                        ? `NoCoRespone: ${rows.length.toLocaleString()} នាក់ (បង្ហាញ 300 ដំបូង — ស្វែងរកដើម្បីតូចចង្អៀត)`
                        : `NoCoRespone: ${rows.length.toLocaleString()} នាក់`,
                    false,
                    false
                );
                return;
            }

            // "edited" mode
            document.getElementById("outAreaSelectBar").hidden = false;
            tbody.innerHTML = `<div class="oa-empty">${escapeHtml(t("arrears.oaLoadingEdited"))}</div>`;
            document.getElementById("outAreaListSubtitle").textContent = "";

            // % bar for the whole load (saved list, then the OS check of
            // anything not in the loaded rows, chunk by chunk) — not while
            // typing a search, which re-runs this on every keystroke.
            const withProgress = !searchTerm.trim() && typeof showAppLoading === "function";
            const progress = (pct, sub) => {
                if (withProgress && typeof setAppLoadingProgress === "function") setAppLoadingProgress(pct, sub);
            };
            if (withProgress) showAppLoading(t("arrears.oaLoadingEdited"), { progress: true, key: "outarea:edited" });

            try {
                const data = await fetchOutAreaEditedItems(searchTerm);
                const items = data.items || [];
                if (!searchTerm.trim()) setOutAreaTabCount("edited", items.length);

                const allRows = host.getAllRows();
                // For anything not in currently-loaded arrears data, batch-lookup
                // the REAL data from OS — exactly what the VBA's own VLOOKUP does.
                // Found in OS -> real Name/Address/Branch. Not found -> "Paid off".
                // (No more invented placeholder text — your VBA only has these two
                // outcomes, so the web version shouldn't show a third made-up one.)
                const missingLdCifs = items
                    .filter(item => !allRows.find(r => r.concate === item.ldCif))
                    .map(item => item.ldCif);
                progress(missingLdCifs.length ? 20 : 95, missingLdCifs.length ? `${t("arrears.oaCheckingOs")} 0 / ${missingLdCifs.length.toLocaleString()}` : "");
                const { items: osLookup, failedLdCifs } = await fetchOsLookupBatch(missingLdCifs, (done, total) =>
                    progress(20 + 75 * done / total, `${t("arrears.oaCheckingOs")} ${done.toLocaleString()} / ${total.toLocaleString()}`));

                if (failedLdCifs.size > 0) {
                    notify(`ការត្រួតពិនិត្យ OS បរាជ័យសម្រាប់ ${failedLdCifs.size} កំណត់ត្រា — មិនបានចាត់ថ្នាក់ជា Paid off ទេ (ដើម្បីជៀសវាងកំហុស)`, "error");
                }

                const mapped = items.map(item => {
                    const liveRow = allRows.find(r => r.concate === item.ldCif);
                    const osMatch = osLookup[item.ldCif];
                    const lookupFailed = failedLdCifs.has(item.ldCif);
                    // Only ever mark "Paid off" when the OS check actually ran and
                    // genuinely found nothing — never as a side effect of a failed
                    // request. A failed check falls back to the same honest "not
                    // currently in arrears, status unknown" state instead.
                    const isPaidOff = !liveRow && !osMatch && !lookupFailed;

                    const row = liveRow || (osMatch
                        ? {
                            concate: item.ldCif,
                            customer: osMatch.name || "(គ្មានឈ្មោះក្នុង OS)",
                            location: osMatch.address || "",
                            accountLoan: "",
                            branch: osMatch.branch || item.newBranch,
                            branchCode: osMatch.branchCode || "",
                            coId: osMatch.coOwner || item.newCoResponse,
                            coResponse: osMatch.coOwner || item.newCoResponse
                        }
                        : {
                            concate: item.ldCif,
                            customer: lookupFailed ? "(មិនអាចត្រួតពិនិត្យបាន)" : "Paid off (បានទូទាត់)",
                            location: "",
                            accountLoan: "",
                            branch: item.newBranch,
                            coId: item.newCoResponse,
                            coResponse: item.newCoResponse
                        });
                    return {
                        customer: row.customer,
                        ldCif: item.ldCif,
                        thirdCol: item.newBranch,
                        newCo: item.newCoResponse,
                        uploadedBy: item.uploadedBy,
                        updatedAt: item.updatedAt,
                        isPaidOff,
                        row
                    };
                });

                outAreaPaidOffLdCifs = new Set(mapped.filter(m => m.isPaidOff).map(m => m.ldCif));
                const shown = applyOutAreaBranchFilter(mapped);
                renderOutAreaRows(shown, shown.length, buildEditedSubtitle(shown), true, true);
            } catch (err) {
                console.error("[outArea] fetch edited list failed:", err);
                tbody.innerHTML = `<div class="oa-empty">មិនអាចផ្ទុកទិន្នន័យបានទេ</div>`;
            } finally {
                if (withProgress && typeof hideAppLoading === "function") hideAppLoading();
            }
        }

        // Chunked (200 at a time) and resilient — a slow/failed chunk no longer
        // silently marks everything in it as "Paid off". Each ldCif that couldn't
        // actually be checked comes back in failedLdCifs so the caller can show an
        // honest "unknown" state instead of a confident wrong answer.
        async function fetchOsLookupBatch(ldCifs, onProgress) {
            const CHUNK_SIZE = 200;
            const items = {};
            const failedLdCifs = new Set();

            for (let i = 0; i < ldCifs.length; i += CHUNK_SIZE) {
                const chunk = ldCifs.slice(i, i + CHUNK_SIZE);
                try {
                    const res = await fetch(`${API.BASE_URL}/api/grid/lookup-batch`, {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            Authorization: `Bearer ${host.token()}`
                        },
                        body: JSON.stringify({ ldCifs: chunk })
                    });
                    const data = await res.json();
                    if (data.ok) {
                        Object.assign(items, data.items || {});
                    } else {
                        chunk.forEach(c => failedLdCifs.add(c));
                    }
                } catch (err) {
                    console.error("[outArea] OS lookup-batch chunk failed:", err);
                    chunk.forEach(c => failedLdCifs.add(c));
                }
                if (onProgress) onProgress(Math.min(i + CHUNK_SIZE, ldCifs.length), ldCifs.length);
            }

            return { items, failedLdCifs };
        }

        function buildEditedSubtitle(mapped) {
            const paidOffCount = mapped.filter(m => m.isPaidOff).length;
            const unknownCount = mapped.filter(m => m.customer === "(មិនអាចត្រួតពិនិត្យបាន)").length;
            let text = `បានកែសម្រួល: ${mapped.length.toLocaleString()} នាក់`;
            if (paidOffCount > 0) text += ` · Paid off: ${paidOffCount.toLocaleString()} នាក់`;
            if (unknownCount > 0) text += ` · មិនអាចត្រួតពិនិត្យបាន: ${unknownCount.toLocaleString()} នាក់`;
            return text;
        }

        let outAreaSelectedForDelete = new Set(); // LD-CIFs currently checked for bulk delete
        let outAreaPaidOffLdCifs = new Set();     // LD-CIFs marked "Paid off" in the current render — powers the quick "select all Paid off" action

        function renderOutAreaRows(entries, totalCount, subtitleText, showActions, showCheckbox) {
            const list = document.getElementById("outAreaTbody");
            list.innerHTML = "";

            // One card per customer: name + LD-CIF on the left, branch chip on
            // the right (current branch in "To edit", new branch in "Edited"),
            // checkbox + edit/delete only in the "Edited" view.
            entries.forEach(entry => {
                const item = document.createElement("div");
                const row = entry.row || {};
                const day = parseInt(row.day, 10);
                item.className = "oa-item" + (entry.isPaidOff ? " oa-item-paidoff" : "") +
                    (classRowCssClass(row.class) ? ` oa-item-${classRowCssClass(row.class)}` : "");
                item.setAttribute("role", "button");
                item.tabIndex = 0;
                // To edit: address + days late (what decides the move).
                // Edited: new branch -> new officer, and who saved it when.
                const detail = showActions
                    ? `<div class="oa-item-move"><span class="ui-ico ui-ico-officer" aria-hidden="true"></span> ${escapeHtml(entry.thirdCol || "-")} · ${escapeHtml(entry.newCo || "-")}</div>
                       ${entry.uploadedBy || entry.updatedAt ? `<div class="oa-item-by">${escapeHtml(entry.uploadedBy || "")}${entry.updatedAt ? ` · ${escapeHtml(fmtDateTime(entry.updatedAt))}` : ""}</div>` : ""}`
                    : (row.location ? `<div class="oa-item-addr"><span class="ui-ico ui-ico-pin" aria-hidden="true"></span> ${escapeHtml(row.location)}</div>` : "") +
                      `<div class="oa-item-meta">
                          ${row.coId ? `<span><span class="ui-ico ui-ico-officer" aria-hidden="true"></span> ${escapeHtml(officerLabel(row.coId, outAreaOfficerNames))}</span>` : ""}
                          ${parseFloat(row.arreas) > 0 ? `<span class="oa-item-amt">${escapeHtml(arrFormatAmount(row.arreas))}${row.ccy ? ` ${escapeHtml(row.ccy)}` : ""}</span>` : ""}
                      </div>`;
                item.innerHTML = `
                    ${showCheckbox ? `
                    <label class="oa-item-check" data-stop><input type="checkbox" class="outarea-row-checkbox" data-ldcif="${escapeHtml(entry.ldCif)}" ${outAreaSelectedForDelete.has(entry.ldCif) ? "checked" : ""}></label>` : ""}
                    <div class="oa-item-main">
                        <div class="oa-item-name">${escapeHtml(entry.customer)}${entry.isPaidOff ? ` <span class="oa-paidoff-chip">Paid off</span>` : ""}</div>
                        <div class="oa-item-sub">${escapeHtml(formatLdCif(entry.ldCif))}</div>
                        ${detail}
                    </div>
                    <div class="oa-item-side">
                        ${!showActions && entry.thirdCol ? `<span class="oa-branch-chip">${escapeHtml(entry.thirdCol)}</span>` : ""}
                        ${!showActions && Number.isFinite(day) ? `<span class="arr-day-badge">${day.toLocaleString()} <small>${escapeHtml(t("arrears.cardDays"))}</small></span>` : ""}
                        ${showActions ? `
                        <button type="button" class="outarea-row-btn outarea-row-btn-danger" data-action="delete" title="លុប" aria-label="លុប" data-i18n-title="common.delete"><span class="ui-ico ui-ico-trash" aria-hidden="true"></span></button>` : `<span class="oa-item-chevron" aria-hidden="true">›</span>`}
                    </div>
                `;
                item.addEventListener("click", (e) => {
                    if (e.target.closest("[data-stop]")) return;
                    selectOutAreaCustomer(entry.row);
                });
                item.addEventListener("keydown", (e) => {
                    if (e.key === "Enter") selectOutAreaCustomer(entry.row);
                });

                if (showCheckbox) {
                    const checkbox = item.querySelector(".outarea-row-checkbox");
                    checkbox.addEventListener("click", (e) => e.stopPropagation());
                    checkbox.addEventListener("change", () => {
                        if (checkbox.checked) outAreaSelectedForDelete.add(entry.ldCif);
                        else outAreaSelectedForDelete.delete(entry.ldCif);
                        updateOutAreaBulkBar();
                    });
                }

                if (showActions) {
                    item.querySelector('[data-action="delete"]').addEventListener("click", (e) => {
                        e.stopPropagation();
                        deleteWrongAddressRecord(entry.ldCif);
                    });
                }

                list.appendChild(item);
            });

            if (!entries.length) {
                const doneAll = !showActions && !document.getElementById("outAreaSearch").value.trim() && !outAreaBranchFilter;
                list.innerHTML = `<div class="oa-empty oa-empty-art">
                    <span class="oa-empty-ico"><span class="ui-ico ui-ico-clipboard" aria-hidden="true"></span></span>
                    <strong>${escapeHtml(t(doneAll ? "arrears.oaEmptyDone" : "arrears.oaEmpty"))}</strong>
                </div>`;
            }

            document.getElementById("outAreaListSubtitle").textContent = subtitleText;

            // Keep the bulk-delete bar and "select all" checkbox in sync with the
            // actual selection state after every render — without this, both stay
            // showing stale count/visibility from before (e.g. after a successful
            // delete clears the selection, or after switching back to candidates
            // mode where there's nothing to select at all).
            const selectAll = document.getElementById("outAreaSelectAll");
            if (selectAll) selectAll.checked = false;
            updateOutAreaBulkBar();
        }

        function setOutAreaTab(mode) {
            outAreaViewMode = mode;
            document.querySelectorAll(".oa-tab[data-view]").forEach(tab => {
                const active = tab.dataset.view === mode;
                tab.classList.toggle("active", active);
                tab.setAttribute("aria-selected", active ? "true" : "false");
            });
        }

        document.querySelectorAll(".oa-tab[data-view]").forEach(tab => tab.addEventListener("click", () => {
            if (tab.dataset.view === outAreaViewMode) return;
            setOutAreaTab(tab.dataset.view);
            outAreaBranchFilter = "";
            document.getElementById("outAreaSearch").value = "";
            outAreaSelectedForDelete.clear();
            document.getElementById("outAreaBulkBar").hidden = true;
            const selectAll = document.getElementById("outAreaSelectAll");
            if (selectAll) selectAll.checked = false;
            renderOutAreaList();
        }));

        function populateOutAreaCoOptions(branch, preselect) {
            const coSelect = document.getElementById("outAreaNewCO");
            coSelect.innerHTML = "";

            if (!branch) {
                coSelect.innerHTML = `<option value="">— ជ្រើសសាខាមុន —</option>`;
                return;
            }

            // Derived from already-loaded data (which CO names currently appear
            // for rows assigned to this branch) — same source the page's own
            // "ភ្នាក់ងារទទួលខុសត្រូវ" filter already treats as the canonical
            // officer-name list, so this stays consistent with that convention.
            const coNames = host.getOfficerNames(branch);

            coSelect.innerHTML = `<option value="">— ជ្រើសភ្នាក់ងារ —</option>` +
                coNames.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("");

            if (preselect && coNames.includes(preselect)) {
                coSelect.value = preselect;
            } else if (preselect) {
                // saved value isn't in the derived list (e.g. CO no longer has
                // active rows in this branch) — add it anyway so Save doesn't
                // silently lose what was previously on record
                const opt = document.createElement("option");
                opt.value = preselect;
                opt.textContent = preselect;
                coSelect.appendChild(opt);
                coSelect.value = preselect;
            }
        }

        // Officer ID -> English name, from the Master Data officer list
        // (/api/creditofficer/list), so the detail screen can show the current
        // officer as "11088-Neth CheaChanto" instead of a bare code. Loaded once
        // on first use; a failed load just leaves the bare code.
        let outAreaOfficerNames = null;
        let outAreaOfficerNamesLoading = null;

        function normalizeOfficerId(id) {
            return String(id || "").trim().replace(/^0+/, "");
        }

        function loadOutAreaOfficerNames() {
            if (outAreaOfficerNames) return Promise.resolve(outAreaOfficerNames);
            if (!outAreaOfficerNamesLoading) {
                outAreaOfficerNamesLoading = fetch(`${API.BASE_URL}/api/creditofficer/list`, {
                    headers: { Authorization: `Bearer ${host.token()}` }
                })
                    .then(res => res.json())
                    .then(data => {
                        const map = new Map();
                        (data.ok ? data.items || [] : []).forEach(o => {
                            const id = normalizeOfficerId(o.officerId);
                            if (id) map.set(id, o.name || o.nameKh || "");
                        });
                        outAreaOfficerNames = map;
                        return map;
                    })
                    .catch(err => {
                        console.error("[outArea] officer list failed:", err);
                        outAreaOfficerNamesLoading = null; // retry next time
                        return new Map();
                    });
            }
            return outAreaOfficerNamesLoading;
        }

        function officerLabel(coId, names) {
            const code = String(coId || "").trim();
            if (!code) return "-";
            const name = names && names.get(normalizeOfficerId(code));
            return name ? `${code}-${name}` : code;
        }

        let outAreaHasSavedRecord = false; // tracks whether the currently viewed customer has a real WrongAddress record to delete

        async function selectOutAreaCustomer(row) {
            outAreaSelectedRow = row;
            outAreaHasSavedRecord = false;

            document.getElementById("outAreaListScreen").style.display = "none";
            document.getElementById("outAreaDetailScreen").style.display = "block";
            // Standalone page: start the loan at the top, not where the list was scrolled.
            if (host.standalone) { document.body.scrollTo?.(0, 0); window.scrollTo(0, 0); }
            document.getElementById("btnOutAreaDelete").style.display = "none";

            document.getElementById("outAreaDetailName").textContent = row.customer || "-";
            const heroDay = parseInt(row.day, 10);
            const heroArrears = parseFloat(row.arreas) || 0;
            document.getElementById("outAreaDetailSubtitle").innerHTML = `
                <span>${escapeHtml(formatLdCif(row.concate))}</span>
                ${Number.isFinite(heroDay) ? `<span class="arr-day-badge">${heroDay.toLocaleString()} <small>${escapeHtml(t("arrears.cardDays"))}</small></span>` : ""}
                ${heroArrears > 0 ? `<span class="oa-hero-arrears">Arrears ${escapeHtml(arrFormatAmount(row.arreas))}${row.ccy ? ` ${escapeHtml(row.ccy)}` : ""}</span>` : ""}`;

            const infoRow = (icon, label, value, id = "") => `
                <div class="oa-info-row">
                    <span class="oa-info-ico"><span class="ui-ico ui-ico-${icon}" aria-hidden="true"></span></span>
                    <div class="oa-info-text">
                        <div class="oa-info-label">${label}</div>
                        <div class="oa-info-value"${id ? ` id="${id}"` : ""}>${escapeHtml(value || "-")}</div>
                    </div>
                </div>`;
            document.getElementById("outAreaInfo").innerHTML =
                infoRow("pin", "អាសយដ្ឋាន", row.location) +
                infoRow("idcard", "គណនីកម្ចី", row.accountLoan) +
                infoRow("map", "សាខាបច្ចុប្បន្ន", row.branch + (row.branchCode ? ` (${row.branchCode})` : "")) +
                infoRow("officer", "ភ្នាក់ងារបច្ចុប្បន្ន", officerLabel(row.coId, outAreaOfficerNames), "outAreaCurrentCO");

            // Fill in the officer's name once the list arrives (first open only).
            if (!outAreaOfficerNames && row.coId) {
                loadOutAreaOfficerNames().then(names => {
                    if (outAreaSelectedRow !== row) return;
                    const el = document.getElementById("outAreaCurrentCO");
                    if (el) el.textContent = officerLabel(row.coId, names);
                });
            }

            const branchSelect = document.getElementById("outAreaNewBranch");
            const metaEl = document.getElementById("outAreaMeta");
            branchSelect.value = "";
            populateOutAreaCoOptions("", "");
            updateOutAreaMove();
            metaEl.textContent = "កំពុងពិនិត្យកំណត់ត្រាចាស់...";

            // Check whether this customer already has a saved reassignment, and
            // pre-fill if so — mirrors the VBA's FindIndexInCurrentCache behavior
            // for existing entries.
            try {
                const res = await fetch(`${API.BASE_URL}/api/wrongaddress/lookup?ldCif=${encodeURIComponent(row.concate)}`, {
                    headers: { Authorization: `Bearer ${host.token()}` }
                });
                const data = await res.json();

                if (data.ok && data.found) {
                    branchSelect.value = data.newBranch;
                    populateOutAreaCoOptions(data.newBranch, data.newCoResponse);
                            updateOutAreaMove();
                    metaEl.textContent = `មានកំណត់ត្រារួចហើយ — ធ្វើបច្ចុប្បន្នភាពដោយ ${data.uploadedBy || "-"}` +
                        (data.updatedAt ? ` · ${fmtDateTime(data.updatedAt)}` : "");
                    outAreaHasSavedRecord = true;
                    document.getElementById("btnOutAreaDelete").style.display = "block";
                } else {
                    metaEl.textContent = "";
                }
            } catch (err) {
                console.error("[outArea] lookup failed:", err);
                metaEl.textContent = "";
            }
        }

        document.getElementById("btnOutAreaDelete")?.addEventListener("click", async () => {
            if (!outAreaSelectedRow || !outAreaHasSavedRecord) return;
            await deleteWrongAddressRecord(outAreaSelectedRow.concate);
        });

        // Shared by both the detail screen's Delete button and the inline 🗑️
        // buttons in the "edited" list — same confirm + API call + refresh either way.
        async function deleteWrongAddressRecord(ldCif) {
            if (!confirm(`តើអ្នកពិតជាចង់លុបកំណត់ត្រា ${ldCif} មែនទេ?`)) return;

            if (typeof showAppLoading === "function") showAppLoading("កំពុងលុប...");

            try {
                const res = await fetch(`${API.BASE_URL}/api/wrongaddress/${encodeURIComponent(ldCif)}`, {
                    method: "DELETE",
                    headers: { Authorization: `Bearer ${host.token()}` }
                });
                const data = await res.json();
                if (!data.ok) throw new Error(data.message || "Delete failed.");

                notify("បានលុបដោយជោគជ័យ", "success");
                if (outAreaViewMode !== "edited") refreshOutAreaEditedCount();

                // Back to the list, refreshed — same pattern as a successful Save.
                renderOutAreaList();
                document.getElementById("outAreaListScreen").style.display = "block";
                document.getElementById("outAreaDetailScreen").style.display = "none";
                outAreaSelectedRow = null;
                outAreaHasSavedRecord = false;
            } catch (err) {
                console.error("[outArea] delete failed:", err);
                notify(err.message || "លុបបរាជ័យ", "error");
            } finally {
                if (typeof hideAppLoading === "function") hideAppLoading();
            }
        }

        document.getElementById("outAreaNewBranch")?.addEventListener("change", (e) => {
            populateOutAreaCoOptions(e.target.value, "");
            updateOutAreaMove();
        });

        document.getElementById("outAreaNewCO")?.addEventListener("change", updateOutAreaMove);

        // "Current branch · officer -> new branch · officer" preview above Save.
        function updateOutAreaMove() {
            const el = document.getElementById("outAreaMove");
            const row = outAreaSelectedRow;
            if (!el || !row) return;
            const newBranch = document.getElementById("outAreaNewBranch").value;
            const newCo = document.getElementById("outAreaNewCO").value;
            if (!newBranch) { el.hidden = true; return; }
            el.hidden = false;
            el.innerHTML = `
                <div class="oa-move-side">
                    <span class="oa-move-label">${escapeHtml(t("arrears.oaFrom"))}</span>
                    <strong>${escapeHtml(row.branch || "-")}</strong>
                    <span>${escapeHtml(officerLabel(row.coId, outAreaOfficerNames))}</span>
                </div>
                <span class="oa-move-arrow" aria-hidden="true">→</span>
                <div class="oa-move-side oa-move-to">
                    <span class="oa-move-label">${escapeHtml(t("arrears.oaTo"))}</span>
                    <strong>${escapeHtml(newBranch)}</strong>
                    <span>${escapeHtml(newCo || t("arrears.oaPickOfficer"))}</span>
                </div>`;
        }

        function openOutAreaModal() {
            outAreaSelectedRow = null;
            outAreaViewMode = "candidates";
            outAreaBranchFilter = "";
            outAreaSelectedForDelete.clear();
            setOutAreaTabCount("edited", NaN);
            refreshOutAreaEditedCount();
            outAreaPaidOffLdCifs.clear();
            document.getElementById("outAreaSearch").value = "";
            setOutAreaTab("candidates");
            // Officer names for the cards and detail screen; on first load the
            // "To edit" cards show bare IDs until they arrive, then redraw.
            const hadNames = !!outAreaOfficerNames;
            loadOutAreaOfficerNames().then(() => {
                if (!hadNames && outAreaViewMode === "candidates" && document.getElementById("outAreaListScreen").style.display !== "none") renderOutAreaList();
            });
            document.getElementById("outAreaListScreen").style.display = "block";
            document.getElementById("outAreaDetailScreen").style.display = "none";
            document.getElementById("outAreaBulkBar").hidden = true;
            renderOutAreaList();
            document.getElementById("outAreaBackdrop")?.classList.add("show");
        }

        function closeOutAreaModal() {
            document.getElementById("outAreaBackdrop")?.classList.remove("show");
            if (host.onClose) host.onClose();
        }

        document.getElementById("btnOutAreaCloseX2")?.addEventListener("click", closeOutAreaModal);
        document.getElementById("btnOutAreaCloseX")?.addEventListener("click", closeOutAreaModal);
        document.getElementById("outAreaBackdrop")?.addEventListener("click", (e) => {
            if (e.target.id === "outAreaBackdrop") closeOutAreaModal();
        });

        document.getElementById("outAreaSelectAll")?.addEventListener("change", (e) => {
            const checkboxes = document.querySelectorAll(".outarea-row-checkbox");
            checkboxes.forEach(cb => {
                cb.checked = e.target.checked;
                const ldCif = cb.dataset.ldcif;
                if (e.target.checked) outAreaSelectedForDelete.add(ldCif);
                else outAreaSelectedForDelete.delete(ldCif);
            });
            updateOutAreaBulkBar();
        });

        document.getElementById("btnOutAreaSelectPaidOff")?.addEventListener("click", () => {
            const checkboxes = document.querySelectorAll(".outarea-row-checkbox");
            checkboxes.forEach(cb => {
                const ldCif = cb.dataset.ldcif;
                if (outAreaPaidOffLdCifs.has(ldCif)) {
                    cb.checked = true;
                    outAreaSelectedForDelete.add(ldCif);
                }
            });
            updateOutAreaBulkBar();
        });

        function updateOutAreaBulkBar() {
            const bar = document.getElementById("outAreaBulkBar");
            const countEl = document.getElementById("outAreaBulkCount");
            const count = outAreaSelectedForDelete.size;

            // Only ever visible in the "edited" view — the "candidates" view has no
            // checkboxes at all, so the bar has no business showing there regardless
            // of count (defensive, in case selection state ever gets out of sync).
            bar.hidden = (outAreaViewMode !== "edited") || count === 0;
            countEl.textContent = `បានជ្រើសរើស ${count.toLocaleString()} នាក់`;
        }

        document.getElementById("btnOutAreaBulkDelete")?.addEventListener("click", async () => {
            const ldCifs = [...outAreaSelectedForDelete];
            if (!ldCifs.length) return;

            if (!confirm(`តើអ្នកពិតជាចង់លុបកំណត់ត្រាដែលបានជ្រើសរើសចំនួន ${ldCifs.length} មែនទេ? សកម្មភាពនេះមិនអាចត្រឡប់វិញបានទេ។`)) return;

            if (typeof showAppLoading === "function") showAppLoading("កំពុងលុប...");

            try {
                const res = await fetch(`${API.BASE_URL}/api/wrongaddress/bulk-delete`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${host.token()}`
                    },
                    body: JSON.stringify({ ldCifs })
                });
                const data = await res.json();
                if (!data.ok) throw new Error(data.message || "Bulk delete failed.");

                notify(`បានលុប ${data.deletedCount} កំណត់ត្រា`, "success");
                if (outAreaViewMode !== "edited") refreshOutAreaEditedCount();
                outAreaSelectedForDelete.clear();
                renderOutAreaList();
            } catch (err) {
                console.error("[outArea] bulk delete failed:", err);
                notify(err.message || "លុបបរាជ័យ", "error");
            } finally {
                if (typeof hideAppLoading === "function") hideAppLoading();
            }
        });

        document.getElementById("outAreaSearch")?.addEventListener("input", () => {
            clearTimeout(window.__outAreaSearchDebounce);
            window.__outAreaSearchDebounce = setTimeout(renderOutAreaList, 200);
        });

        document.getElementById("btnOutAreaBackTop")?.addEventListener("click", () => {
            document.getElementById("outAreaListScreen").style.display = "block";
            document.getElementById("outAreaDetailScreen").style.display = "none";
        });

        document.getElementById("btnOutAreaSave")?.addEventListener("click", async () => {
            if (!outAreaSelectedRow) return;

            const newBranch = document.getElementById("outAreaNewBranch").value.trim();
            const newCoResponse = document.getElementById("outAreaNewCO").value.trim();

            if (!newBranch) return notify("សូមជ្រើសសាខាថ្មី", "warning");
            if (!newCoResponse) return notify("សូមជ្រើសភ្នាក់ងារឥណទានថ្មី", "warning");

            const uploadedBy =
                JSON.parse(localStorage.getItem("loggedInUser") || sessionStorage.getItem("loggedInUser") || "{}").fullname
                || "unknown";

            if (typeof showAppLoading === "function") showAppLoading("កំពុងរក្សាទុក...");

            try {
                const res = await fetch(`${API.BASE_URL}/api/wrongaddress/upsert`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${host.token()}`
                    },
                    body: JSON.stringify({
                        ldCif: outAreaSelectedRow.concate,
                        newBranch,
                        newCoResponse,
                        uploadedBy
                    })
                });
                const data = await res.json();
                if (!data.ok) throw new Error(data.message || "Save failed.");

                // Mirrors the backend, which now also writes newBranch/newCoResponse
                // directly onto the ArreasT24ByCO record (matching VBA's dual write).
                // Patch the SAME in-memory row object here too — the page's row
                // lists reference it, so this instantly removes the customer from
                // the "NoCoRespone" list (and, on Daily Arrears, updates the main
                // table via onSaved) with no need for a full reload.
                outAreaSelectedRow.branch = newBranch;
                outAreaSelectedRow.coResponse = newCoResponse;

                notify("បានរក្សាទុកដោយជោគជ័យ", "success");
                if (outAreaViewMode !== "edited") refreshOutAreaEditedCount();

                // Back to the list instead of closing — lets the admin pick the
                // next customer without having to reopen the whole modal each time.
                renderOutAreaList();
                document.getElementById("outAreaListScreen").style.display = "block";
                document.getElementById("outAreaDetailScreen").style.display = "none";
                outAreaSelectedRow = null;

                if (host.onSaved) host.onSaved();
            } catch (err) {
                console.error("[outArea] save failed:", err);
                notify(err.message || "រក្សាទុកបរាជ័យ", "error");
            } finally {
                if (typeof hideAppLoading === "function") hideAppLoading();
            }
        });

        api.open = openOutAreaModal;
        api.close = closeOutAreaModal;
        api.select = selectOutAreaCustomer;
        api.renderList = renderOutAreaList;
        api.loadOfficerNames = loadOutAreaOfficerNames;
        api.officerNames = () => outAreaOfficerNames;
    };

    window.OutAreaEditor = api;
})();
