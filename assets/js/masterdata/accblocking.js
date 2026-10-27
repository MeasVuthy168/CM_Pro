// ========================================
// Master Data > Account Blocking — List Account Blocking
// The Excel Acc_Blocking sheet as a page: each user keeps a daily list
// of CIFs and what to do with their payroll account (Block, Unblock,
// Update, Update&Unblock). The server looks up the account, name,
// amounts and description the way the sheet's formulas do
// (lib/acc-blocking.js); Generate Final List looks them up again and
// sorts by action. Admin / User / Managers edit their own list; everyone else
// can open the page and List Block, read-only.
// ========================================

const t = (key, vars) => (window.CMI18n ? CMI18n.t(key, vars) : key);
const abEsc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const AB_ACTIONS = ["Block", "Unblock", "Update", "Update&Unblock"];
// Row colours follow the sheet's conditional formatting.
const AB_CLASS = { "Block": "block", "Unblock": "unblock", "Update": "update", "Update&Unblock": "updunblock" };

// "2026-10-21" -> "21/10/2026"
function abDmy(key) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key || "");
    return m ? `${m[3]}/${m[2]}/${m[1]}` : (key || "-");
}

function abAmount(v) {
    if (v === null || v === undefined || v === "") return "";
    return (Number(v) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// One figure on the card: the amount the account ends up blocked at —
// the new amount for Update / Update&Unblock, otherwise the From amount
// (Block: the arrears; Unblock: what's blocked now). Export / Print
// keep both columns, like the sheet.
function abBlockingAmount(r) {
    const v = r.toAmount !== null && r.toAmount !== undefined && r.toAmount !== "" ? r.toAmount : r.fromAmount;
    const text = abAmount(v);
    return text ? `${text}${r.currency ? ` <small class="ab-cur">${abEsc(r.currency)}</small>` : ""}` : "-";
}

let abData = null;
let abAddAction = "Block";
let abEditRow = null;
let abEditAction = "";

async function abCall(path, body) {
    const res = await fetch(`${API.BASE_URL}/api/accblocking/${path}`, {
        method: body ? "POST" : "GET",
        headers: { Authorization: `Bearer ${API.getToken()}`, ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.message || t("masterdata.outArea.loadFailed"));
    return data;
}

function abToast(msg, type) {
    if (typeof showToast === "function") showToast(msg, type || "success");
}

// Four action buttons with their Khmer meaning (the sheet's dropdown note).
function abActionButtons(container, selected, onPick) {
    container.innerHTML = AB_ACTIONS.map(a => `
        <button type="button" role="radio" class="ab-act ab-act-${AB_CLASS[a]}${a === selected ? " on" : ""}" aria-checked="${a === selected}" data-action="${abEsc(a)}">
            <b>${abEsc(a)}</b><small>${abEsc(t(`masterdata.ab.act.${AB_CLASS[a]}`))}</small>
        </button>`).join("");
    container.onclick = e => {
        const b = e.target.closest(".ab-act");
        if (!b) return;
        container.querySelectorAll(".ab-act").forEach(x => {
            const on = x === b;
            x.classList.toggle("on", on);
            x.setAttribute("aria-checked", on ? "true" : "false");
        });
        onPick(b.dataset.action);
    };
}

function abPaint(data) {
    abData = data;
    const rows = data.rows || [];
    const canEdit = !!data.canEdit;

    document.getElementById("abHeroSub").textContent = t("masterdata.ab.forDate", { date: abDmy(data.date) });
    document.getElementById("abDateText").textContent = abDmy(data.date);
    const dateEl = document.getElementById("abDate");
    dateEl.value = data.date;
    dateEl.max = data.today;

    const counts = AB_ACTIONS.map(a => ({ a, n: rows.filter(r => r.action === a).length }));
    document.getElementById("abCounts").innerHTML = `
        <span class="ab-count ab-count-all"><b>${rows.length}</b>${abEsc(t("masterdata.ab.rows"))}</span>
        ${counts.map(c => `<span class="ab-count ab-count-${AB_CLASS[c.a]}"><b>${c.n}</b>${abEsc(c.a)}</span>`).join("")}`;

    document.getElementById("abAdd").hidden = !canEdit;
    document.getElementById("abReadOnly").hidden = canEdit;
    document.querySelectorAll("[data-edit]").forEach(b => { b.hidden = !canEdit; });
    document.getElementById("btnAbFinal").disabled = !rows.length;
    document.getElementById("btnAbClear").disabled = !rows.length;
    document.getElementById("btnAbExport").disabled = !rows.length;
    document.getElementById("btnAbPrint").disabled = !rows.length;

    const note = document.getElementById("abFinalNote");
    note.hidden = !data.finalizedAt || !rows.length;
    note.textContent = data.finalizedAt ? t("masterdata.ab.finalDone") : "";

    const list = document.getElementById("abList");
    if (!rows.length) {
        list.innerHTML = `<div class="ab-empty">${abEsc(t(canEdit ? "masterdata.ab.emptyEdit" : "masterdata.ab.empty"))}</div>`;
        abRowSel = null;
        list.classList.remove("ab-selecting");
        abPaintRowSelBar();
        return;
    }
    // Drop selected CIFs that are no longer on the list.
    if (abRowSel) {
        const live = new Set(rows.map(r => r.cif));
        abRowSel.forEach(c => { if (!live.has(c)) abRowSel.delete(c); });
        if (!abRowSel.size) abRowSel = null;
    }
    list.classList.toggle("ab-selecting", !!abRowSel);
    list.innerHTML = rows.map((r, i) => {
        const sel = !!abRowSel && abRowSel.has(r.cif);
        return `
        <button type="button" class="ab-row ab-row-${AB_CLASS[r.action] || "block"}${sel ? " ab-sel" : ""}" data-cif="${abEsc(r.cif)}" ${canEdit ? "" : "disabled"}${abRowSel ? ` aria-pressed="${sel}"` : ""}>
            ${abRowSel ? `<span class="ab-check${sel ? " on" : ""}" aria-hidden="true"></span>` : ""}
            <div class="ab-row-top">
                <span class="ab-no">${i + 1}</span>
                <span class="ab-cif">CIF ${abEsc(r.cif)}</span>
                <span class="ab-badge">${abEsc(r.action)}</span>
            </div>
            <div class="ab-name">${abEsc(r.accountName || "-")}</div>
            <div class="ab-acc">${abEsc(r.accountNo || "")}${r.currency ? ` · ${abEsc(r.currency)}` : ""}${r.accountManual ? ` <span class="ab-acc-tag">${abEsc(t("masterdata.ab.accountEdited"))}</span>` : ""}</div>
            ${r.found === false ? `<div class="ab-warn">${abEsc(t("masterdata.ab.notInPayroll"))}</div>` : ""}
            <div class="ab-amounts">
                <span><small>${abEsc(t("masterdata.ab.blockingAmount"))}</small><b>${abBlockingAmount(r)}</b>${r.fromAmountManual != null && r.action === "Block" ? ` <span class="ab-acc-tag">${abEsc(t("masterdata.ab.amountEdited"))}</span>` : ""}</span>
            </div>
            ${r.reference ? `<div class="ab-meta"><small>${abEsc(t("masterdata.ab.reference"))}</small> ${abEsc(r.reference)}</div>` : ""}
            ${r.description ? `<div class="ab-meta"><small>${abEsc(t("masterdata.ab.description"))}</small> ${abEsc(r.description)}</div>` : ""}
        </button>`;
    }).join("");
    abPaintRowSelBar();
}

async function abLoad(date) {
    if (typeof showAppLoading === "function") showAppLoading(t("masterdata.ab.loading"), { progress: true, key: "masterdata:accblocking" });
    try {
        abPaint(await abCall(`list${date ? `?date=${encodeURIComponent(date)}` : ""}`));
    } catch (err) {
        console.error("[accblocking] load failed:", err);
        document.getElementById("abList").innerHTML = `<div class="ab-empty">${abEsc(t("masterdata.outArea.loadFailed"))}<br><button type="button" class="ab-retry">${abEsc(t("masterdata.outArea.retry"))}</button></div>`;
        document.querySelector(".ab-retry")?.addEventListener("click", () => abLoad(date));
    } finally {
        if (typeof hideAppLoading === "function") hideAppLoading();
    }
}

// Runs one change, repaints, and reports what the server said.
async function abChange(path, body, done) {
    if (typeof showAppLoading === "function") showAppLoading(t("masterdata.ab.saving"), { key: "masterdata:accblocking" });
    try {
        const data = await abCall(path, { date: abData?.date, ...body });
        abPaint(data);
        if (done) done(data);
        return data;
    } catch (err) {
        abToast(err.message, "error");
        return null;
    } finally {
        if (typeof hideAppLoading === "function") hideAppLoading();
    }
}

// ---------- add ----------
abActionButtons(document.getElementById("abAddActions"), abAddAction, a => { abAddAction = a; });

document.getElementById("btnAbAdd").addEventListener("click", () => {
    const input = document.getElementById("abCifs");
    const cifs = [...new Set(input.value.split(/[\s,;]+/).map(s => s.trim()).filter(Boolean))];
    if (!cifs.length) {
        abToast(t("masterdata.ab.needCif"), "warning");
        input.focus();
        return;
    }
    abChange("add", { cifs, action: abAddAction }, data => {
        input.value = "";
        const parts = [];
        if (data.added) parts.push(t("masterdata.ab.addedN", { n: data.added }));
        if (data.updated) parts.push(t("masterdata.ab.updatedN", { n: data.updated }));
        abToast(parts.join(" · ") || t("masterdata.ab.saved"));
        if (data.notFound && data.notFound.length) abToast(t("masterdata.ab.notFoundN", { cifs: data.notFound.join(", ") }), "warning");
        if (data.full) abToast(t("masterdata.ab.full"), "warning");
    });
});

// ---------- edit one row ----------
function abOpen(id) {
    document.getElementById(id).hidden = false;
    document.body.classList.add("ab-sheet-open");
}

function abClose(id) {
    document.getElementById(id).hidden = true;
    if (["abEdit", "abBlocked", "abExport", "abPick"].every(id => document.getElementById(id).hidden)) document.body.classList.remove("ab-sheet-open");
    if (id === "abBlocked" && abSel) abSelEnd();
}

function abSyncToField() {
    // Only Update takes a typed amount; Update&Unblock's comes from the currency.
    document.getElementById("abToWrap").hidden = abEditAction !== "Update";
    // Block: the arrears by default (the placeholder); a typed amount wins.
    document.getElementById("abFromWrap").hidden = abEditAction !== "Block";
}

function abFillFromField(row) {
    const input = document.getElementById("abEditFrom");
    const arrears = row.action === "Block" && row.arrears != null ? row.arrears : (row.action === "Block" ? row.fromAmount : null);
    input.value = row.fromAmountManual != null ? row.fromAmountManual : "";
    input.placeholder = arrears != null ? abAmount(arrears) : "";
    document.getElementById("abFromHint").textContent = arrears != null
        ? t("masterdata.ab.blockAmountHint", { amount: abAmount(arrears) })
        : t("masterdata.ab.blockAmountHintNew");
}

// ---------- multi-select on the list (long press) to delete ----------
let abRowSel = null;     // Set of CIFs while selecting
let abRowTimer = null;
let abRowStart = null;
let abRowLong = false;
let abRowSkipUntil = 0;

function abPaintRowSelBar() {
    const bar = document.getElementById("abRowSelBar");
    bar.hidden = !abRowSel;
    if (!abRowSel) return;
    // Sit just above the bottom bar.
    const nav = document.querySelector(".bottom-nav");
    bar.style.bottom = `${(nav ? nav.getBoundingClientRect().height : 0) + 10}px`;
    document.getElementById("abRowSelN").textContent = t("masterdata.ab.selectedN", { n: abRowSel.size });
    document.getElementById("btnAbRowDelete").disabled = !abRowSel.size;
}

function abRowSelSet(next) {
    abRowSel = next;
    abPaint(abData);
}

const abListEl = document.getElementById("abList");
abListEl.addEventListener("pointerdown", e => {
    const row = e.target.closest(".ab-row[data-cif]");
    if (!row || abRowSel || !abData?.canEdit) return;
    abRowStart = { x: e.clientX, y: e.clientY };
    clearTimeout(abRowTimer);
    abRowTimer = setTimeout(() => {
        abRowTimer = null;
        abRowLong = true;
        if (navigator.vibrate) navigator.vibrate(15);
        abRowSelSet(new Set([row.dataset.cif]));
    }, 450);
});
abListEl.addEventListener("pointermove", e => {
    if (abRowTimer && abRowStart && Math.hypot(e.clientX - abRowStart.x, e.clientY - abRowStart.y) > 8) {
        clearTimeout(abRowTimer);
        abRowTimer = null;
    }
});
["pointerup", "pointercancel", "pointerleave"].forEach(ev => abListEl.addEventListener(ev, () => {
    clearTimeout(abRowTimer);
    abRowTimer = null;
    // A click may follow a long press (phones differ): ignore only that one.
    if (abRowLong) { abRowLong = false; abRowSkipUntil = Date.now() + 250; }
}));
abListEl.addEventListener("contextmenu", e => { if (e.target.closest(".ab-row")) e.preventDefault(); });

document.getElementById("btnAbRowCancel").addEventListener("click", () => abRowSelSet(null));
document.getElementById("btnAbRowAll").addEventListener("click", () => abRowSelSet(new Set((abData?.rows || []).map(r => r.cif))));
document.getElementById("btnAbRowDelete").addEventListener("click", async () => {
    const cifs = [...(abRowSel || [])];
    if (!cifs.length || !confirm(t("masterdata.ab.confirmRemoveN", { n: cifs.length }))) return;
    abRowSel = null;
    if (await abChange("remove", { cifs })) abToast(t("masterdata.ab.removedN", { n: cifs.length }));
});

document.getElementById("abList").addEventListener("click", e => {
    if (Date.now() < abRowSkipUntil) return;
    const card = e.target.closest(".ab-row[data-cif]");
    if (!card || !abData?.canEdit) return;
    if (abRowSel) {
        const next = new Set(abRowSel);
        if (next.has(card.dataset.cif)) next.delete(card.dataset.cif); else next.add(card.dataset.cif);
        abRowSelSet(next.size ? next : null);
        return;
    }
    abEditRow = (abData.rows || []).find(r => r.cif === card.dataset.cif);
    if (!abEditRow) return;
    abEditAction = abEditRow.action;
    document.getElementById("abEditTitle").textContent = abEditRow.accountName || `CIF ${abEditRow.cif}`;
    document.getElementById("abEditSub").textContent = [`CIF ${abEditRow.cif}`, abEditRow.accountNo].filter(Boolean).join(" · ");
    document.getElementById("abEditTo").value = abEditRow.action === "Update" && abEditRow.toAmount != null ? abEditRow.toAmount : "";
    document.getElementById("abEditRef").value = abEditRow.reference || "";
    abFillFromField(abEditRow);
    abActionButtons(document.getElementById("abEditActions"), abEditAction, a => { abEditAction = a; abSyncToField(); });
    abSyncToField();
    abFillAccounts(abEditRow);
    abOpen("abEdit");
});

// ---------- account picker in the edit sheet ----------
// Choices: the payroll account (the sheet's lookup), the CIF's other
// accounts from Acc Payroll / ListBlocked, or one typed by hand.
const AB_ACC_AUTO = "__auto";
const AB_ACC_MANUAL = "__manual";
let abAccSeq = 0;

function abSyncAccField() {
    const manual = document.getElementById("abEditAcc").value === AB_ACC_MANUAL;
    document.getElementById("abAccManualWrap").hidden = !manual;
    return manual;
}

async function abFillAccounts(row) {
    const sel = document.getElementById("abEditAcc");
    const typed = document.getElementById("abEditAccNo");
    const seq = ++abAccSeq;
    const paint = items => {
        const accs = items.map(i => i.account);
        // A typed account that isn't one of the CIF's still shows as itself.
        if (row.accountManual && row.accountNo && !accs.includes(row.accountNo)) items = [{ account: row.accountNo, name: row.accountName }, ...items];
        sel.innerHTML = [
            `<option value="${AB_ACC_AUTO}">${abEsc(t("masterdata.ab.accountAuto"))}</option>`,
            ...items.map(i => `<option value="${abEsc(i.account)}">${abEsc(i.account)}</option>`),
            `<option value="${AB_ACC_MANUAL}">${abEsc(t("masterdata.ab.accountManual"))}</option>`
        ].join("");
        sel.value = row.accountManual && row.accountNo ? row.accountNo : AB_ACC_AUTO;
        typed.value = "";
        abSyncAccField();
    };
    paint([]);
    sel.disabled = true;
    try {
        const data = await abCall(`accounts?cif=${encodeURIComponent(row.cif)}`);
        if (seq === abAccSeq) paint(data.items || []);
    } catch (err) {
        console.error("[accblocking] accounts failed:", err);
    } finally {
        if (seq === abAccSeq) sel.disabled = false;
    }
}

document.getElementById("abEditAcc").addEventListener("change", () => {
    if (abSyncAccField()) document.getElementById("abEditAccNo").focus();
});

// What to send as accountNo, or undefined when nothing changed. null = invalid.
function abEditAccountValue() {
    const v = document.getElementById("abEditAcc").value;
    let acc;
    if (v === AB_ACC_AUTO) acc = "";
    else if (v === AB_ACC_MANUAL) {
        acc = document.getElementById("abEditAccNo").value.replace(/[\s-]/g, "");
        if (!/^[0-9A-Za-z]{4,30}$/.test(acc)) return null;
    } else acc = v;
    const now = abEditRow.accountManual ? abEditRow.accountNo : "";
    return acc === now ? undefined : acc;
}

document.getElementById("btnAbSave").addEventListener("click", async () => {
    if (!abEditRow) return;
    const body = { cif: abEditRow.cif, action: abEditAction, reference: document.getElementById("abEditRef").value };
    if (abEditAction === "Update") body.toAmount = document.getElementById("abEditTo").value;
    if (abEditAction === "Block") {
        const typed = document.getElementById("abEditFrom").value.trim();
        const n = Number(typed.replace(/,/g, ""));
        if (typed && !(Number.isFinite(n) && n > 0)) {
            abToast(t("masterdata.ab.blockAmountBad"), "warning");
            document.getElementById("abEditFrom").focus();
            return;
        }
        body.fromAmount = typed;
    }
    const acc = abEditAccountValue();
    if (acc === null) {
        abToast(t("masterdata.ab.accountBad"), "warning");
        document.getElementById("abEditAccNo").focus();
        return;
    }
    if (acc !== undefined) body.accountNo = acc;
    if (await abChange("update", body)) {
        abClose("abEdit");
        abToast(t("masterdata.ab.saved"));
    }
});

document.getElementById("btnAbRemove").addEventListener("click", async () => {
    if (!abEditRow) return;
    if (!confirm(t("masterdata.ab.confirmRemove", { cif: abEditRow.cif }))) return;
    if (await abChange("remove", { cifs: [abEditRow.cif] })) abClose("abEdit");
});

// ---------- tools ----------
document.getElementById("btnAbFinal").addEventListener("click", () => {
    abChange("finalize", {}, () => abToast(t("masterdata.ab.finalDone")));
});

document.getElementById("btnAbClear").addEventListener("click", () => {
    if (!confirm(t("masterdata.ab.confirmClear", { date: abDmy(abData?.date) }))) return;
    abChange("remove", { all: true });
});

// The sheet's columns, in its order (Export copies A:H, Print the page).
function abSheetHeaders() {
    return ["masterdata.ab.colNo", "CIF", "masterdata.ab.colAccount", "masterdata.ab.colName", "masterdata.ab.fromAmount",
        "masterdata.ab.toAmount", "masterdata.ab.reference", "masterdata.ab.colOther", "masterdata.ab.description"]
        .map(k => (k.startsWith("masterdata.") ? t(k) : k));
}

function abSheetRows() {
    return (abData?.rows || []).map((r, i) => [i + 1, r.cif, r.accountNo, r.accountName,
        r.fromAmount ?? "", r.toAmount ?? "", r.reference || "", r.action, r.description || ""]);
}

function abLoadScript(src) {
    return new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = src;
        s.onload = resolve;
        s.onerror = reject;
        document.head.appendChild(s);
    });
}

// Export: Excel (columns A-H, like the sheet's ExportData) or PDF (the
// printed sheet, A4 landscape — drawn as an image so Khmer renders).
const AB_LIBS = {
    xlsx: "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js",
    html2canvas: "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js",
    jspdf: "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"
};
const abLibs = {};
function abLib(name) {
    if (!abLibs[name]) abLibs[name] = abLoadScript(AB_LIBS[name]).catch(e => { delete abLibs[name]; throw e; });
    return abLibs[name];
}

function abFileStamp() {
    return `${abData.date.replace(/-/g, "")}_${new Date().toTimeString().slice(0, 8).replace(/:/g, "")}`;
}

async function abExportExcel() {
    await abLib("xlsx");
    const title = t("masterdata.ab.sheetTitle", { date: abDmy(abData.date) });
    const headers = abSheetHeaders().slice(0, 8);
    const rows = abSheetRows().map(r => r.slice(0, 8));
    const ws = XLSX.utils.aoa_to_sheet([[title], headers, ...rows]);
    ws["!cols"] = [{ wch: 5 }, { wch: 11 }, { wch: 18 }, { wch: 24 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 15 }];
    ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 7 } }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `AccBlock_${abData.date.replace(/-/g, "")}`.slice(0, 31));
    XLSX.writeFile(wb, `AccBlock_${abFileStamp()}.xlsx`);
}

async function abExportPdf() {
    await Promise.all([abLib("html2canvas"), abLib("jspdf")]);
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    // The print sheet, laid out off-screen at a fixed width.
    const holder = document.createElement("div");
    holder.className = "ab-print ab-pdf";
    holder.innerHTML = abPrintHtml();
    document.body.appendChild(holder);
    try {
        const SCALE = 2;
        const full = await html2canvas(holder, { scale: SCALE, backgroundColor: "#ffffff" });
        const top = holder.getBoundingClientRect().top;
        const bounds = [...holder.querySelectorAll("tbody tr")].map(tr => (tr.getBoundingClientRect().bottom - top) * SCALE);
        // The repeated header is cut from the same render, so it lines up
        // with the columns below; pages stop at the last row (no blank page
        // from the sheet's bottom padding).
        const headRect = holder.querySelector("thead").getBoundingClientRect();
        const headTop = Math.round((headRect.top - top) * SCALE);
        const headH = Math.round(headRect.height * SCALE);
        const lastRow = Math.min(full.height, Math.ceil(bounds[bounds.length - 1] || full.height) + SCALE);

        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
        const pageW = 297, pageH = 210, margin = 8;
        const usableW = pageW - margin * 2, usableH = pageH - margin * 2;
        const sliceH = full.width * (usableH / usableW);
        // One page at a time, cut between rows; the header repeats.
        let start = 0, first = true, page = 0;
        while (start < lastRow - 2) {
            const end = start + (first ? sliceH : sliceH - headH);
            let cut = end;
            for (const b of bounds) if (b > start && b <= end) cut = b;
            if (cut <= start) cut = Math.min(end, lastRow);
            cut = Math.min(cut, lastRow);
            const canvas = document.createElement("canvas");
            canvas.width = full.width;
            canvas.height = (cut - start) + (first ? 0 : headH);
            const ctx = canvas.getContext("2d");
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            let y = 0;
            if (!first) { ctx.drawImage(full, 0, headTop, full.width, headH, 0, 0, full.width, headH); y = headH; }
            ctx.drawImage(full, 0, start, full.width, cut - start, 0, y, full.width, cut - start);
            if (page > 0) pdf.addPage();
            pdf.addImage(canvas.toDataURL("image/jpeg", 0.9), "JPEG", margin, margin, usableW, usableW * (canvas.height / canvas.width));
            pdf.setFontSize(8);
            pdf.setTextColor(140);
            pdf.text(String(page + 1), pageW - margin, pageH - 3, { align: "right" });
            start = cut;
            first = false;
            page++;
        }
        pdf.save(`AccBlock_${abFileStamp()}.pdf`);
    } finally {
        holder.remove();
    }
}

document.getElementById("btnAbExport").addEventListener("click", () => {
    if (abData?.rows?.length) abOpen("abExport");
});

document.getElementById("abExport").addEventListener("click", async e => {
    const opt = e.target.closest("[data-export]");
    if (!opt) return;
    abClose("abExport");
    if (typeof showAppLoading === "function") showAppLoading(t("masterdata.ab.exporting"));
    try {
        if (opt.dataset.export === "pdf") await abExportPdf();
        else await abExportExcel();
    } catch (err) {
        console.error("[accblocking] export failed:", err);
        abToast(t("masterdata.ab.exportFailed"), "error");
    } finally {
        if (typeof hideAppLoading === "function") hideAppLoading();
    }
});

// The sheet as a table (Print and PDF): title, headers, rows tinted by action.
function abPrintHtml() {
    return `
        <h1>${abEsc(t("masterdata.ab.sheetTitle", { date: abDmy(abData.date) }))}</h1>
        <table>
            <thead><tr>${abSheetHeaders().map(h => `<th>${abEsc(h)}</th>`).join("")}</tr></thead>
            <tbody>${abSheetRows().map((r, i) => `<tr class="ab-p-${AB_CLASS[abData.rows[i].action] || "block"}">${r.map((v, c) =>
                `<td${c === 4 || c === 5 ? ' class="num"' : ""}>${abEsc(c === 4 || c === 5 ? abAmount(v) : v)}</td>`).join("")}</tr>`).join("")}</tbody>
        </table>`;
}

document.getElementById("btnAbPrint").addEventListener("click", () => {
    if (!abData?.rows?.length) return;
    document.getElementById("abPrint").innerHTML = abPrintHtml();
    window.print();
});

// ---------- List Block ----------
// Accounts blocked now (ListBlocked): status, branch, officer, team;
// search, filter, sort, card or list view, a page at a time.
const AB_BL_PAGE = 100;
const AB_BL_FILTERS = [
    { key: "status", label: "masterdata.ab.colStatus" },
    { key: "branch", label: "masterdata.ab.colBranch" },
    { key: "inputBranch", label: "masterdata.ab.colInputBranch" },
    { key: "team", label: "masterdata.ab.colTeam" }
];
const abBl = { status: "", branch: "", inputBranch: "", team: "", items: [], total: 0, seq: 0, facets: null };
const abPref = (k, v) => {
    try {
        if (v === undefined) return localStorage.getItem(`cm_ab_bl_${k}`);
        localStorage.setItem(`cm_ab_bl_${k}`, v);
    } catch (e) {}
    return null;
};
let abBlView = abPref("view") === "list" ? "list" : "card";
let abBlTimer = null;

function abStatusClass(s) {
    const v = String(s || "").toLowerCase();
    return v.includes("full") ? "full" : v.includes("partial") ? "partial" : "other";
}

// CIF -> action for the CIFs already on this day's list.
function abListed() {
    return new Map((abData?.rows || []).map(r => [String(r.cif).replace(/^0+/, ""), r.action]));
}

function abBlockedItem(b, listed) {
    const status = b.status ? `<span class="ab-st ab-st-${abStatusClass(b.status)}">${abEsc(b.status)}</span>` : "";
    const key = String(b.cif || "").replace(/^0+/, "");
    const inList = listed.get(key);
    const mark = inList ? `<span class="ab-inlist ab-inlist-${AB_CLASS[inList] || "block"}">✓ ${abEsc(inList)}</span>` : "";
    const sel = abSel && abSel.has(key);
    const attrs = `data-cif="${abEsc(b.cif)}" data-name="${abEsc(b.name || "")}"${sel ? ' aria-selected="true"' : ""}`;
    const check = abSel ? `<span class="ab-check${sel ? " on" : ""}" aria-hidden="true"></span>` : "";
    // Account numbers arrive masked ("1300xxxxxxxx20").
    if (abBlView === "list") {
        return `<div class="ab-bl-row ab-pickable${sel ? " ab-sel" : ""}" ${attrs}>${check}
            <div class="ab-bl-main"><b>${abEsc(b.name || b.account || "-")}</b><small>${abEsc(b.account || "-")} · CIF ${abEsc(b.cif || "-")} · ${abEsc(b.branch || "-")}${b.team ? ` · ${abEsc(b.team)}` : ""}</small></div>
            <div class="ab-bl-side"><b>${abAmount(b.amount)} <small>${abEsc(b.currency)}</small></b>${status}${mark}</div>
        </div>`;
    }
    return `<div class="ab-blocked ab-pickable${sel ? " ab-sel" : ""}" ${attrs}>${check}
        <div class="ab-blocked-top"><b>${abEsc(b.name || "-")}</b><span>${abAmount(b.amount)} ${abEsc(b.currency)}</span></div>
        <div class="ab-blocked-acc">${abEsc(b.account || "-")} · CIF ${abEsc(b.cif || "-")}</div>
        <div class="ab-blocked-tags">${status}${b.team ? `<span class="ab-tag">${abEsc(b.team)}</span>` : ""}${mark}</div>
        <div class="ab-blocked-meta"><span class="ui-ico ui-ico-pin" aria-hidden="true"></span> ${abEsc(b.branch || "-")} · <span class="ui-ico ui-ico-officer" aria-hidden="true"></span> ${abEsc(b.officer || "-")}</div>
        ${b.inputBranch ? `<div class="ab-blocked-meta"><span class="ui-ico ui-ico-edit" aria-hidden="true"></span> ${abEsc(t("masterdata.ab.colInputBranch"))}: ${abEsc(b.inputBranch)}</div>` : ""}
        ${b.description ? `<div class="ab-blocked-meta">${abEsc(b.description)}</div>` : ""}
    </div>`;
}

// Filters as dropdowns (status / branch / inputter branch / team), each
// value with its count over the search.
function abPaintBlFilters() {
    const f = abBl.facets || {};
    const fmt = n => n.toLocaleString("en-US");
    const n = AB_BL_FILTERS.filter(x => abBl[x.key]).length;
    document.getElementById("abBlFilters").innerHTML = `<div class="ab-bl-selects">${AB_BL_FILTERS.map(({ key, label }) => {
        const opts = (f[key] || []).filter(o => o.value);
        const total = (f[key] || []).reduce((sum, o) => sum + o.n, 0);
        // Keep a chosen value listed even if the search no longer has it.
        if (abBl[key] && !opts.some(o => o.value === abBl[key])) opts.unshift({ value: abBl[key], n: 0 });
        return `<label class="ab-bl-select${abBl[key] ? " on" : ""}">
            <span>${abEsc(t(label))}</span>
            <select data-key="${key}" ${opts.length ? "" : "disabled"}>
                <option value="">${abEsc(t("masterdata.ab.all"))} (${fmt(total)})</option>
                ${opts.map(o => `<option value="${abEsc(o.value)}"${o.value === abBl[key] ? " selected" : ""}>${abEsc(o.value)} (${fmt(o.n)})</option>`).join("")}
            </select>
        </label>`;
    }).join("")}</div>${n ? `<button type="button" class="ab-bl-clear" data-clear>${abEsc(t("masterdata.ab.clearFilters"))}</button>` : ""}`;
    const badge = document.getElementById("abBlFilterN");
    badge.hidden = !n;
    badge.textContent = n;
}

function abPaintBlList() {
    const list = document.getElementById("abBlockedList");
    list.classList.toggle("ab-as-list", abBlView === "list");
    document.querySelectorAll(".ab-view [data-view]").forEach(b => {
        const on = b.dataset.view === abBlView;
        b.classList.toggle("on", on);
        b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    if (!abBl.items.length) {
        list.innerHTML = `<div class="ab-empty">${abEsc(t("masterdata.ab.noBlocked"))}</div>`;
        return;
    }
    const more = abBl.items.length < abBl.total;
    const listed = abListed();
    list.classList.toggle("ab-selecting", !!abSel);
    list.innerHTML = abBl.items.map(b => abBlockedItem(b, listed)).join("") +
        (more ? `<button type="button" class="ab-bl-more" data-more>${abEsc(t("masterdata.ab.showMore", { shown: abBl.items.length.toLocaleString("en-US"), total: abBl.total.toLocaleString("en-US") }))}</button>` : "");
}

// Opening, sorting and filtering show the % loader like other pages;
// typing in search (quiet) keeps the inline note so the keyboard stays.
async function abLoadBlocked(append, quiet) {
    const seq = ++abBl.seq;
    const q = document.getElementById("abBlockedQ").value.trim();
    const list = document.getElementById("abBlockedList");
    const overlay = !append && !quiet && typeof showAppLoading === "function";
    if (!append) list.innerHTML = `<div class="ab-empty">${abEsc(t("masterdata.ab.loading"))}</div>`;
    if (overlay) showAppLoading(t("masterdata.ab.loading"), { progress: true, key: "masterdata:accblocking:blocked" });
    const params = new URLSearchParams({
        limit: AB_BL_PAGE, offset: append ? abBl.items.length : 0, sort: document.getElementById("abBlSort").value,
        ...(q ? { q } : {}),
        ...Object.fromEntries(AB_BL_FILTERS.filter(x => abBl[x.key]).map(x => [x.key, abBl[x.key]]))
    });
    try {
        const data = await abCall(`blocked?${params}`);
        if (seq !== abBl.seq) return;
        abBl.items = append ? abBl.items.concat(data.items) : data.items;
        abBl.total = data.total;
        abBl.facets = data.facets;
        const sums = Object.entries(data.sums || {}).map(([cur, v]) => `${abAmount(v)} ${cur}`).join(" · ");
        document.getElementById("abBlockedSub").textContent = t("masterdata.ab.blockedN", { n: (data.all || 0).toLocaleString("en-US") });
        document.getElementById("abBlSum").innerHTML = `<b>${abEsc(t("masterdata.ab.matchN", { n: data.total.toLocaleString("en-US") }))}</b>${sums ? ` · ${abEsc(sums)}` : ""}`;
        abPaintBlFilters();
        abPaintBlList();
    } catch (err) {
        if (seq === abBl.seq) list.innerHTML = `<div class="ab-empty">${abEsc(err.message)}</div>`;
    } finally {
        if (overlay && typeof hideAppLoading === "function") hideAppLoading();
    }
}

const abSavedSort = abPref("sort");
if (abSavedSort && document.querySelector(`#abBlSort option[value="${abSavedSort}"]`)) document.getElementById("abBlSort").value = abSavedSort;

document.getElementById("btnAbBlocked").addEventListener("click", () => {
    abOpen("abBlocked");
    abLoadBlocked();
});
document.getElementById("abBlockedQ").addEventListener("input", () => {
    clearTimeout(abBlTimer);
    abBlTimer = setTimeout(() => abLoadBlocked(false, true), 350);
});
document.getElementById("abBlSort").addEventListener("change", e => {
    abPref("sort", e.target.value);
    abLoadBlocked();
});
document.getElementById("btnAbBlFilter").addEventListener("click", e => {
    const panel = document.getElementById("abBlFilters");
    panel.hidden = !panel.hidden;
    e.currentTarget.setAttribute("aria-expanded", panel.hidden ? "false" : "true");
});
document.getElementById("abBlFilters").addEventListener("click", e => {
    if (!e.target.closest("[data-clear]")) return;
    AB_BL_FILTERS.forEach(x => { abBl[x.key] = ""; });
    abLoadBlocked();
});
document.getElementById("abBlFilters").addEventListener("change", e => {
    const sel = e.target.closest("select[data-key]");
    if (!sel) return;
    abBl[sel.dataset.key] = sel.value;
    abLoadBlocked();
});
document.querySelector(".ab-view").addEventListener("click", e => {
    const b = e.target.closest("[data-view]");
    if (!b) return;
    abBlView = b.dataset.view;
    abPref("view", abBlView);
    abPaintBlList();
});
// ---------- add from List Block ----------
// Tap an account: pick an action and it joins this day's list. Long-press
// one to start choosing several (by CIF), then add them all at once.
let abSel = null;          // Set of CIF keys while multi-selecting
let abPickCifs = [];       // CIFs the action sheet will add
let abPressTimer = null;
let abPressStart = null;
// A long press may or may not be followed by a click (phones differ), so
// only a click right after letting go of one is ignored.
let abLongPressed = false;
let abSkipUntil = 0;

const abCifKey = c => String(c || "").replace(/^0+/, "");

function abPaintSelBar() {
    const bar = document.getElementById("abSelBar");
    bar.hidden = !abSel;
    if (!abSel) return;
    document.getElementById("abSelN").textContent = t("masterdata.ab.selectedN", { n: abSel.size });
    document.getElementById("btnAbSelAdd").disabled = !abSel.size;
}

function abSelStart(cif) {
    abSel = new Set([abCifKey(cif)]);
    if (navigator.vibrate) navigator.vibrate(15);
    abPaintBlList();
    abPaintSelBar();
}

function abSelEnd() {
    abSel = null;
    abPaintBlList();
    abPaintSelBar();
}

function abSelToggle(cif) {
    const k = abCifKey(cif);
    if (abSel.has(k)) abSel.delete(k); else abSel.add(k);
    abPaintBlList();
    abPaintSelBar();
}

function abOpenPick(cifs, label) {
    abPickCifs = cifs;
    const listed = abListed();
    const already = cifs.map(c => listed.get(abCifKey(c))).filter(Boolean);
    document.getElementById("abPickSub").textContent = label;
    const note = document.getElementById("abPickNote");
    note.hidden = !already.length;
    note.textContent = already.length
        ? (cifs.length === 1 ? t("masterdata.ab.alreadyAs", { action: already[0] }) : t("masterdata.ab.alreadyN", { n: already.length }))
        : "";
    // One tap adds — no separate confirm button.
    abActionButtons(document.getElementById("abPickActions"), "", action => abAddPicked(action));
    abOpen("abPick");
}

async function abAddPicked(action) {
    const cifs = abPickCifs;
    abClose("abPick");
    const data = await abChange("add", { cifs, action });
    if (!data) return;
    const parts = [];
    if (data.added) parts.push(t("masterdata.ab.addedN", { n: data.added }));
    if (data.updated) parts.push(t("masterdata.ab.updatedN", { n: data.updated }));
    abToast(`${action}: ${parts.join(" · ") || t("masterdata.ab.saved")}`);
    if (data.full) abToast(t("masterdata.ab.full"), "warning");
    if (abSel) abSelEnd(); else abPaintBlList();
}

const abList = document.getElementById("abBlockedList");
abList.addEventListener("pointerdown", e => {
    const item = e.target.closest(".ab-pickable");
    if (!item || abSel || !abData?.canEdit) return;
    abPressStart = { x: e.clientX, y: e.clientY };
    clearTimeout(abPressTimer);
    abPressTimer = setTimeout(() => {
        abPressTimer = null;
        abLongPressed = true;
        abSelStart(item.dataset.cif);
    }, 450);
});
const abPressCancel = () => { clearTimeout(abPressTimer); abPressTimer = null; };
abList.addEventListener("pointermove", e => {
    if (abPressTimer && abPressStart && Math.hypot(e.clientX - abPressStart.x, e.clientY - abPressStart.y) > 8) abPressCancel();
});
["pointerup", "pointercancel", "pointerleave"].forEach(ev => abList.addEventListener(ev, () => {
    abPressCancel();
    if (abLongPressed) {
        abLongPressed = false;
        abSkipUntil = Date.now() + 250;
    }
}));
abList.addEventListener("scroll", abPressCancel, { passive: true });
abList.addEventListener("contextmenu", e => { if (e.target.closest(".ab-pickable")) e.preventDefault(); });

abList.addEventListener("click", e => {
    if (Date.now() < abSkipUntil) return;
    if (e.target.closest("[data-more]")) return abLoadBlocked(true);
    const item = e.target.closest(".ab-pickable");
    if (!item || !abData?.canEdit) return;
    if (abSel) return abSelToggle(item.dataset.cif);
    abOpenPick([item.dataset.cif], [item.dataset.name, `CIF ${item.dataset.cif}`].filter(Boolean).join(" · "));
});

document.getElementById("btnAbSelCancel").addEventListener("click", abSelEnd);
document.getElementById("btnAbSelAll").addEventListener("click", () => {
    abBl.items.forEach(b => abSel.add(abCifKey(b.cif)));
    abPaintBlList();
    abPaintSelBar();
});
document.getElementById("btnAbSelAdd").addEventListener("click", () => {
    // Keep the CIFs as the list shows them (the first row of each).
    const cifs = [];
    const seen = new Set();
    for (const b of abBl.items) {
        const k = abCifKey(b.cif);
        if (abSel.has(k) && !seen.has(k)) { seen.add(k); cifs.push(b.cif); }
    }
    if (cifs.length) abOpenPick(cifs, t("masterdata.ab.cifsN", { n: cifs.length }));
});

// Sheets close on ×, the dim, or Esc.
["abEdit", "abBlocked", "abExport", "abPick"].forEach(id => {
    const el = document.getElementById(id);
    el.addEventListener("click", e => { if (e.target === el || e.target.closest("[data-close]")) abClose(id); });
});
document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    // The top-most sheet first; Esc in multi-select just leaves it.
    if (!document.getElementById("abPick").hidden) return abClose("abPick");
    if (abRowSel && [...document.querySelectorAll(".ab-dim")].every(d => d.hidden)) return abRowSelSet(null);
    if (abSel) return abSelEnd();
    ["abEdit", "abBlocked", "abExport"].forEach(id => { if (!document.getElementById(id).hidden) abClose(id); });
});

// ---------- date ----------
document.getElementById("abDate").addEventListener("change", e => {
    abRowSel = null;
    if (e.target.value) abLoad(e.target.value);
});

abLoad();

// ========================================
// COMPONENT LOADER (topbar + bottomnav)
// ========================================
let abLoaded = 0;
async function loadComponent(id, file) {
    try {
        const useCache = id !== "topbar-container";
        const cached = useCache ? sessionStorage.getItem("comp_" + id) : null;
        if (cached) {
            document.getElementById(id).innerHTML = cached;
        } else {
            const response = await fetch(file);
            const html = await response.text();
            document.getElementById(id).innerHTML = html;
            if (useCache) {
                sessionStorage.setItem("comp_" + id, html);
            }
        }
        if (id === "topbar-container") {
            initTopbar({
                titleKey: "masterdata.hub.accBlocking",
                showBack: true,
                showLogo: false,
                showProfile: false
            });
            // Belongs under Master Data — Back goes there, not history.back().
            const backBtn = document.getElementById("topbarBackBtn");
            if (backBtn) {
                backBtn.onclick = () => cmNav.back("/CM_Pro/pages/masterdata/index.html");
            }
        }
    } catch (error) {
        console.error(error);
    } finally {
        abLoaded++;
        if (abLoaded >= 2) {
            setTimeout(() => {
                if (typeof hideGlobalSplash === "function") {
                    hideGlobalSplash();
                }
            }, 300);
        }
    }
}
loadComponent("topbar-container", "/CM_Pro/components/topbar.html");
loadComponent("bottomnav-container", "/CM_Pro/components/bottomnav.html");

// ========================================
// OFFLINE DETECT
// ========================================
function updateOnlineStatus() {
    const banner = document.getElementById("offlineBanner");
    if (banner) {
        banner.style.display = navigator.onLine ? "none" : "block";
    }
}
window.addEventListener("online", updateOnlineStatus);
window.addEventListener("offline", updateOnlineStatus);
updateOnlineStatus();

setTimeout(() => {
    if (typeof loadNotificationBadge === "function") {
        loadNotificationBadge();
    }
}, 500);
