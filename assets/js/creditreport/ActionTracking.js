// ========================================
// Credit Portfolio Intelligence — Management Action Tracking (Module 08)
// /api/credit-intelligence/actions: create an action (from any report:
// Early Warning and NPL rows link here with ?new=1&loan=…), assign it,
// move it along, add notes / evidence links / comments, and have an admin
// approve it. The server decides who may do what and returns `can` on
// each action; this page only shows the buttons it allows. Every change
// lands in the action's history.
// ========================================

const t = CI.t;
const ACT_API = () => `${API.BASE_URL}/api/credit-intelligence/actions`;
const ACT_EVENTS = ["created", "status", "notes", "edited", "comment", "evidence", "approved", "rejected"];

let actStatus = "active";
let actItems = [];
let actOptions = { branches: [], officers: [] };
let actOpenId = null;

function actToken() {
    return localStorage.getItem("token") || sessionStorage.getItem("token");
}

async function actFetch(path, opts = {}) {
    const res = await fetch(`${ACT_API()}${path}`, {
        ...opts,
        headers: { Authorization: `Bearer ${actToken()}`, "Content-Type": "application/json" }
    });
    const data = await res.json().catch(() => ({ ok: false }));
    if (!data.ok) throw new Error(data.message || t("creditreport.pi.loadFailed"));
    return data;
}

function actDateTime(v) {
    if (!v) return "";
    const d = new Date(v);
    const p = n => String(n).padStart(2, "0");
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function actStatusPill(a) {
    const s = `<span class="ci-pill ci-st-${a.status}">${CI.esc(t(`creditreport.act.s.${a.status}`))}</span>`;
    return a.overdue ? `${s} <span class="ci-pill ci-pill-high">⚠ ${CI.esc(t("creditreport.act.s.overdue"))}</span>` : s;
}

function actPriorityPill(p) {
    return `<span class="ci-pill ci-pr-${p}">${CI.esc(t(`creditreport.act.p.${p}`))}</span>`;
}

// ---------- list ----------
async function actLoad() {
    const q = new URLSearchParams({ status: actStatus });
    if (document.getElementById("actMine").checked) q.set("mine", "1");
    try {
        const data = await actFetch(`?${q.toString()}`);
        actItems = data.actions || [];
        document.getElementById("actNewBtn").hidden = !data.canCreate;
        actRenderCounts(data.counts || {});
        actRenderList();
    } catch (e) {
        console.error(e);
        CI.toast(e.message, "error");
    }
}

function actRenderCounts(c) {
    const keys = ["active", "overdue", "pending_review", "completed", "cancelled"];
    document.getElementById("actCounts").innerHTML = keys.map(k =>
        `<button type="button" class="ci-act-count ci-act-count-${k}${k === actStatus ? " is-active" : ""}" data-status="${k}">
            <span>${CI.esc(t(`creditreport.act.s.${k}`))}</span><strong>${CI.num(c[k] || 0)}</strong></button>`).join("");
    document.querySelectorAll("#actTabs [data-status]").forEach(b => {
        const on = b.dataset.status === actStatus;
        b.classList.toggle("is-active", on);
        b.setAttribute("aria-selected", on ? "true" : "false");
    });
}

function actRenderList() {
    const q = document.getElementById("actSearch").value.trim().toLowerCase();
    const rows = actItems.filter(a => !q || [a.actionId, a.loanId, a.customerName, a.officerName, a.officerId, a.branch, a.description]
        .some(v => String(v || "").toLowerCase().includes(q)));
    document.getElementById("actCount").textContent = t("creditreport.act.countN", { n: CI.num(rows.length) });
    document.getElementById("actList").innerHTML = rows.length ? rows.map(a => `
        <li><button type="button" class="ci-act-item${a.overdue ? " is-overdue" : ""}" data-id="${CI.esc(a.id)}">
            <span class="ci-act-top"><strong>${CI.esc(a.actionId)}</strong> ${actPriorityPill(a.priority)} ${actStatusPill(a)}</span>
            <span class="ci-act-desc">${CI.esc(a.description)}</span>
            <span class="ci-sub">${CI.esc([a.branch, a.officerName || a.officerId, a.loanId].filter(Boolean).join(" · "))}</span>
            <span class="ci-sub">${CI.esc(t("creditreport.act.dueOn", { date: CI.dmy(a.dueDate) }))}</span>
        </button></li>`).join("") : `<li class="pi-note">${CI.esc(t("creditreport.act.none"))}</li>`;
}

// ---------- create ----------
async function actLoadOptions() {
    try {
        const data = await actFetch("/options");
        actOptions = { branches: data.branches || [], officers: data.officers || [] };
    } catch (e) {
        console.error(e);
    }
}

function actFillForm(prefill = {}) {
    const br = document.getElementById("afBranch");
    br.innerHTML = actOptions.branches.map(b => `<option value="${CI.esc(b)}">${CI.esc(b)}</option>`).join("");
    if (prefill.branch && actOptions.branches.includes(prefill.branch)) br.value = prefill.branch;
    actFillOfficers(prefill.officer);
    const due = new Date(Date.now() + 7 * 3600 * 1000 + 7 * 86400 * 1000).toISOString().slice(0, 10);
    document.getElementById("afDue").value = due;
    document.getElementById("afLoan").value = prefill.loan || "";
    document.getElementById("afCustomer").value = prefill.customer || "";
    document.getElementById("afDesc").value = prefill.desc || "";
    const src = document.getElementById("afSource");
    src.hidden = !prefill.source;
    src.textContent = prefill.source ? t("creditreport.act.fromSource", { source: t(`creditreport.act.src.${prefill.source}`) }) : "";
    src.dataset.source = prefill.source || "";
}

function actFillOfficers(want) {
    const branch = document.getElementById("afBranch").value;
    const sel = document.getElementById("afOfficer");
    const list = actOptions.officers.filter(o => !branch || o.branch === branch);
    sel.innerHTML = `<option value="">${CI.esc(t("creditreport.act.unassigned"))}</option>` +
        list.map(o => `<option value="${CI.esc(o.id)}">${CI.esc(o.name || o.id)}</option>`).join("");
    if (want && list.some(o => o.id === want)) sel.value = want;
}

async function actOpenForm(prefill) {
    if (!actOptions.branches.length) await actLoadOptions();
    actFillForm(prefill);
    const form = document.getElementById("actForm");
    form.hidden = false;
    form.scrollIntoView({ behavior: "smooth", block: "start" });
    document.getElementById("afDesc").focus();
}

async function actCreate(e) {
    e.preventDefault();
    const officer = document.getElementById("afOfficer");
    const src = document.getElementById("afSource").dataset.source;
    const body = {
        branch: document.getElementById("afBranch").value,
        officerId: officer.value,
        officerName: officer.value ? officer.options[officer.selectedIndex].textContent : "",
        priority: document.getElementById("afPriority").value,
        dueDate: document.getElementById("afDue").value,
        loanId: document.getElementById("afLoan").value.trim(),
        customerName: document.getElementById("afCustomer").value.trim(),
        description: document.getElementById("afDesc").value.trim(),
        source: src ? { module: src, ref: document.getElementById("afLoan").value.trim() } : undefined
    };
    if (!body.description || !body.dueDate) {
        CI.toast(t("creditreport.act.needFields"), "error");
        return;
    }
    try {
        const data = await actFetch("", { method: "POST", body: JSON.stringify(body) });
        CI.toast(t("creditreport.act.created", { id: data.action.actionId }), "success");
        document.getElementById("actForm").hidden = true;
        history.replaceState(null, "", location.pathname);
        actStatus = "active";
        await actLoad();
        actShow(data.action.id);
    } catch (err) {
        CI.toast(err.message, "error");
    }
}

// ---------- detail ----------
async function actShow(id) {
    try {
        const data = await actFetch(`/${encodeURIComponent(id)}`);
        actOpenId = id;
        actRenderDetail(data.action);
        const dlg = document.getElementById("actDialog");
        if (!dlg.open) dlg.showModal();
    } catch (e) {
        CI.toast(e.message, "error");
    }
}

function actHistoryText(h) {
    const ev = ACT_EVENTS.includes(h.event) ? t(`creditreport.act.ev.${h.event}`) : h.event;
    const move = h.from || h.to ? ` ${h.from ? t(`creditreport.act.s.${h.from}`) : ""}${h.from && h.to ? " → " : ""}${h.to ? t(`creditreport.act.s.${h.to}`) : ""}` : "";
    return `${ev}${move}${h.note ? ` — ${h.note}` : ""}`;
}

function actRenderDetail(a) {
    const can = a.can || {};
    document.getElementById("adTitle").innerHTML = `${CI.esc(a.actionId)} ${actPriorityPill(a.priority)} ${actStatusPill(a)}`;
    const field = (label, value) => value ? `<div class="ci-kv"><span>${CI.esc(t(label))}</span><strong>${CI.esc(value)}</strong></div>` : "";
    const next = [];
    if (can.progress && a.status === "open") next.push(["in_progress", "creditreport.act.start"]);
    if (can.progress && (a.status === "open" || a.status === "in_progress")) next.push(["pending_review", "creditreport.act.submit"]);
    if (can.progress && a.status === "pending_review") next.push(["in_progress", "creditreport.act.withdraw"]);
    if (can.cancel) next.push(["cancelled", "creditreport.act.cancel"]);
    const editOfficers = actOptions.officers.filter(o => o.branch === a.branch);
    document.getElementById("adBody").innerHTML = `
        <p class="ci-act-desc-big">${CI.esc(a.description)}</p>
        <div class="ci-kvs">
            ${field("creditreport.pi.branch", a.branch)}
            ${field("creditreport.act.responsible", a.officerName || a.officerId || t("creditreport.act.unassigned"))}
            ${field("creditreport.act.loanId", a.loanId)}
            ${field("creditreport.npl.colCustomer", a.customerName)}
            ${field("creditreport.act.assigned", CI.dmy(a.assignedDate))}
            ${field("creditreport.act.dueDate", CI.dmy(a.dueDate))}
            ${field("creditreport.act.completion", a.completionDate ? CI.dmy(a.completionDate) : "")}
            ${field("creditreport.act.createdBy", a.createdBy)}
            ${a.source && a.source.module ? field("creditreport.act.source", t(`creditreport.act.src.${a.source.module}`)) : ""}
            ${a.approval ? field("creditreport.act.approval", `${t(`creditreport.act.ev.${a.approval.decision === "approve" ? "approved" : "rejected"}`)} · ${a.approval.by} · ${actDateTime(a.approval.at)}${a.approval.note ? ` — ${a.approval.note}` : ""}`) : ""}
        </div>
        ${a.loanId ? `<p><a class="ci-link" href="/CM_Pro/pages/customers/index.html?q=${encodeURIComponent(a.loanId)}">${CI.esc(t("creditreport.act.openCustomer"))}</a></p>` : ""}

        ${next.length ? `<div class="ci-act-buttons">${next.map(([to, label]) => `<button type="button" class="${to === "cancelled" ? "pi-btn-ghost" : "ci-btn-primary"}" data-to="${to}">${CI.esc(t(label))}</button>`).join("")}</div>` : ""}

        ${can.approve ? `<div class="ci-approve">
            <label class="pi-field"><span>${CI.esc(t("creditreport.act.approvalNote"))}</span><input type="text" id="adApproveNote" maxlength="1000"></label>
            <div class="ci-act-buttons">
                <button type="button" class="ci-btn-primary ci-btn-good" data-decision="approve">${CI.esc(t("creditreport.act.approve"))}</button>
                <button type="button" class="pi-btn-ghost ci-btn-bad" data-decision="reject">${CI.esc(t("creditreport.act.reject"))}</button>
            </div></div>` : ""}

        ${can.edit ? `<details class="ci-edit"><summary>${CI.esc(t("creditreport.act.edit"))}</summary>
            <div class="pi-filter-grid">
                <label class="pi-field"><span>${CI.esc(t("creditreport.act.priority"))}</span><select id="adPriority">${["low", "medium", "high", "urgent"].map(p => `<option value="${p}"${p === a.priority ? " selected" : ""}>${CI.esc(t(`creditreport.act.p.${p}`))}</option>`).join("")}</select></label>
                <label class="pi-field"><span>${CI.esc(t("creditreport.act.dueDate"))}</span><input type="date" id="adDue" value="${CI.esc(a.dueDate)}"></label>
                <label class="pi-field"><span>${CI.esc(t("creditreport.act.responsible"))}</span><select id="adOfficer"><option value="">${CI.esc(t("creditreport.act.unassigned"))}</option>${editOfficers.map(o => `<option value="${CI.esc(o.id)}"${o.id === a.officerId ? " selected" : ""}>${CI.esc(o.name || o.id)}</option>`).join("")}</select></label>
            </div>
            <label class="pi-field"><span>${CI.esc(t("creditreport.act.description"))}</span><textarea id="adDesc" rows="3" maxlength="2000" class="ci-textarea">${CI.esc(a.description)}</textarea></label>
            <button type="button" class="pi-btn-ghost" id="adSaveEdit">${CI.esc(t("creditreport.act.save"))}</button>
        </details>` : ""}

        <h3 class="ci-h3">${CI.esc(t("creditreport.act.notes"))}</h3>
        ${can.progress ? `<textarea id="adNotes" rows="3" maxlength="5000" class="ci-textarea">${CI.esc(a.notes || "")}</textarea>
            <button type="button" class="pi-btn-ghost" id="adSaveNotes">${CI.esc(t("creditreport.act.save"))}</button>`
            : `<p class="ci-pre">${CI.esc(a.notes || "—")}</p>`}

        <h3 class="ci-h3">${CI.esc(t("creditreport.act.evidence"))}</h3>
        <ul class="ci-thread">${(a.evidence || []).map(e => `<li><div>${CI.esc(e.text || "")}${e.link ? ` <a class="ci-link" href="${CI.esc(e.link)}" target="_blank" rel="noopener noreferrer">${CI.esc(t("creditreport.act.openLink"))}</a>` : ""}</div><div class="ci-sub">${CI.esc(e.by)} · ${actDateTime(e.at)}</div></li>`).join("") || `<li class="pi-note">—</li>`}</ul>
        ${can.progress ? `<div class="ci-inline-fields">
            <label class="pi-field"><span>${CI.esc(t("creditreport.act.evidenceNote"))}</span><input type="text" id="adEvText" maxlength="2000"></label>
            <label class="pi-field"><span>${CI.esc(t("creditreport.act.evidenceLink"))}</span><input type="url" id="adEvLink" placeholder="https://"></label>
        </div><button type="button" class="pi-btn-ghost" id="adAddEvidence">${CI.esc(t("creditreport.act.addEvidence"))}</button>` : ""}

        <h3 class="ci-h3">${CI.esc(t("creditreport.act.comments"))}</h3>
        <ul class="ci-thread">${(a.comments || []).map(c => `<li><div>${CI.esc(c.text)}</div><div class="ci-sub">${CI.esc(c.by)} · ${actDateTime(c.at)}</div></li>`).join("") || `<li class="pi-note">—</li>`}</ul>
        ${can.comment ? `<div class="ci-inline-fields"><label class="pi-field"><span>${CI.esc(t("creditreport.act.addComment"))}</span><input type="text" id="adComment" maxlength="2000"></label></div>
            <button type="button" class="pi-btn-ghost" id="adSendComment">${CI.esc(t("creditreport.act.send"))}</button>` : ""}

        <h3 class="ci-h3">${CI.esc(t("creditreport.act.history"))}</h3>
        <ol class="ci-history">${(a.history || []).slice().reverse().map(h => `<li><span class="ci-sub">${actDateTime(h.at)} · ${CI.esc(h.by)}</span><div>${CI.esc(actHistoryText(h))}</div></li>`).join("")}</ol>`;
}

async function actPatch(body) {
    const data = await actFetch(`/${encodeURIComponent(actOpenId)}`, { method: "PATCH", body: JSON.stringify(body) });
    actRenderDetail(data.action);
    actLoad();
}

async function actDetailClick(e) {
    const b = e.target.closest("button");
    if (!b || !actOpenId) return;
    try {
        if (b.dataset.to) {
            let note = "";
            if (b.dataset.to === "cancelled") {
                note = prompt(t("creditreport.act.cancelWhy")) || "";
                if (!note) return;
            }
            await actPatch({ status: b.dataset.to, note });
        } else if (b.dataset.decision) {
            const note = (document.getElementById("adApproveNote").value || "").trim();
            if (b.dataset.decision === "reject" && !note) { CI.toast(t("creditreport.act.rejectWhy"), "error"); return; }
            const data = await actFetch(`/${encodeURIComponent(actOpenId)}/approve`, { method: "POST", body: JSON.stringify({ decision: b.dataset.decision, note }) });
            actRenderDetail(data.action);
            actLoad();
        } else if (b.id === "adSaveNotes") {
            await actPatch({ notes: document.getElementById("adNotes").value });
            CI.toast(t("creditreport.growth.saved"), "success");
        } else if (b.id === "adSaveEdit") {
            const o = document.getElementById("adOfficer");
            await actPatch({
                priority: document.getElementById("adPriority").value,
                dueDate: document.getElementById("adDue").value,
                description: document.getElementById("adDesc").value.trim(),
                officerId: o.value,
                officerName: o.value ? o.options[o.selectedIndex].textContent : ""
            });
            CI.toast(t("creditreport.growth.saved"), "success");
        } else if (b.id === "adAddEvidence") {
            const data = await actFetch(`/${encodeURIComponent(actOpenId)}/evidence`, {
                method: "POST",
                body: JSON.stringify({ text: document.getElementById("adEvText").value.trim(), link: document.getElementById("adEvLink").value.trim() })
            });
            actRenderDetail(data.action);
        } else if (b.id === "adSendComment") {
            const text = document.getElementById("adComment").value.trim();
            if (!text) return;
            const data = await actFetch(`/${encodeURIComponent(actOpenId)}/comments`, { method: "POST", body: JSON.stringify({ text }) });
            actRenderDetail(data.action);
        }
    } catch (err) {
        CI.toast(err.message, "error");
    }
}

document.addEventListener("DOMContentLoaded", async () => {
    CI.mountNav("actions");
    document.getElementById("actTabs").addEventListener("click", e => {
        const b = e.target.closest("[data-status]");
        if (!b) return;
        actStatus = b.dataset.status;
        actLoad();
    });
    document.getElementById("actCounts").addEventListener("click", e => {
        const b = e.target.closest("[data-status]");
        if (!b) return;
        actStatus = b.dataset.status;
        actLoad();
    });
    document.getElementById("actMine").addEventListener("change", actLoad);
    document.getElementById("actSearch").addEventListener("input", actRenderList);
    document.getElementById("actList").addEventListener("click", e => {
        const b = e.target.closest("[data-id]");
        if (b) actShow(b.dataset.id);
    });
    document.getElementById("actNewBtn").addEventListener("click", () => actOpenForm({}));
    document.getElementById("afBranch").addEventListener("change", () => actFillOfficers());
    document.getElementById("afCancel").addEventListener("click", () => { document.getElementById("actForm").hidden = true; });
    document.getElementById("actCreate").addEventListener("submit", actCreate);
    document.getElementById("adClose").addEventListener("click", () => document.getElementById("actDialog").close());
    document.getElementById("adBody").addEventListener("click", actDetailClick);

    await actLoad();
    await actLoadOptions();
    // Opened from another module: ?new=1&loan=…&branch=…&officer=…&customer=…&desc=…&source=…
    const p = new URLSearchParams(location.search);
    if (p.get("new") === "1" && !document.getElementById("actNewBtn").hidden) {
        actOpenForm({ loan: p.get("loan"), branch: p.get("branch"), officer: p.get("officer"), customer: p.get("customer"), desc: p.get("desc"), source: p.get("source") });
    }
    if (p.get("id")) actShow(p.get("id"));
});
