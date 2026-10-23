// ========================================
// Daily Arrears — easier scrolling
// 1. The results bar ("បង្ហាញទាំងអស់ …" + LD/CIF + views) sticks under
//    the topbar (CSS: position:sticky, top = --arr-top).
// 2. Each table (LD .table-scroll, CIF .arr-cif-table-wrap) is its own
//    scroll box sized to the screen left under the pinned bar
//    (--arr-box-h), so its header row stays in view, and a horizontal
//    scrollbar is always shown just above the bottom bar (phones hide
//    the native one). Scrolling a table down first pins the page.
// 3. A gold vertical scrollbar on the table's right edge, like the
//    horizontal one. Both show on computers only; phones scroll by touch.
// Uses arrears.js globals: arrViewMode, arrGroupMode, arrGroups,
// renderedGroupCount, appendMoreGroups.
// ========================================

(function () {
    const root = document.documentElement;
    const bar = document.querySelector(".arr-results-bar");
    const ldBox = document.querySelector(".table-scroll");
    const cifBox = document.getElementById("arrCifTableWrap");
    if (!bar || !ldBox) return;

    // Marks where the results bar sits in the page (it is sticky, so its
    // own position can't tell once it's pinned).
    const sentinel = document.createElement("div");
    sentinel.className = "arr-pin-sentinel";
    bar.before(sentinel);
    const page = bar.closest(".page-container");
    const scroller = () => (document.body.scrollHeight > window.innerHeight + 2 ? document.body : document.scrollingElement);

    // ---------- sizes ----------
    // Cached here so scrolling never reads styles; the CSS variables are
    // written only when a value really changes (writing them restyles the
    // whole page — with hundreds of table rows that made scrolling stutter
    // each time more rows loaded).
    let topH = 0, navH = 0;
    const written = {};
    function setVar(name, value) {
        if (written[name] === value) return;
        written[name] = value;
        root.style.setProperty(name, value);
    }
    function measure() {
        const top = document.querySelector(".topbar");
        const nav = document.querySelector(".bottom-nav");
        topH = top ? Math.round(top.getBoundingClientRect().height) : 0;
        navH = nav ? Math.round(nav.getBoundingClientRect().height) : 0;
        const barH = Math.round(bar.getBoundingClientRect().height);
        setVar("--arr-top", `${topH}px`);
        setVar("--arr-bottom", `${navH}px`);
        const hbarRoom = phone.matches ? 0 : HBAR_H;
        setVar("--arr-box-h", `${Math.max(220, window.innerHeight - topH - barH - navH - hbarRoom - 30)}px`);
        fitPageEnd();
        paintBar();
    }

    // Table view: the page may scroll only as far as pinning the bar —
    // any further and the table's top (its header row) slid under the
    // bar (e.g. a swipe carrying on past the table's end). The space
    // under the table is sized so the page ends exactly there.
    function fitPageEnd() {
        if (!page || !activeBox()) return;
        requestAnimationFrame(() => {
            const sc = scroller();
            const max = sc.scrollHeight - window.innerHeight;
            const pinAt = sc.scrollTop + sentinel.getBoundingClientRect().top + (parseFloat(getComputedStyle(bar).marginTop) || 0) - topH;
            const cur = parseFloat(getComputedStyle(page).paddingBottom) || 0;
            const want = Math.max(0, Math.round(cur + pinAt - max));
            if (Math.abs(want - cur) <= 1) return;
            // Page was held at its end (e.g. LD → CIF made it shorter):
            // keep it pinned once there's room again.
            const atEnd = sc.scrollTop >= max - 2 && pinAt > max;
            setVar("--arr-pad-bottom", `${want}px`);
            if (atEnd) requestAnimationFrame(() => { sc.scrollTop = pinAt; });
        });
    }

    // ---------- scrollbars: horizontal (above the bottom bar) and vertical
    // (the table's right edge), gold, always shown on computers. Phones
    // scroll by touch, so neither is shown there. ----------
    const HBAR_H = 18;
    const phone = window.matchMedia("(max-width: 768px), (hover: none) and (pointer: coarse)");
    function activeBox() {
        if (typeof arrViewMode !== "undefined" && arrViewMode === "card") return null;
        return typeof arrGroupMode !== "undefined" && arrGroupMode === "cif" ? cifBox : ldBox;
    }

    function makeBar(axis) {
        const el = document.createElement("div");
        el.className = `arr-sbar arr-sbar-${axis}`;
        el.hidden = true;
        el.innerHTML = `<div class="arr-sbar-track"><div class="arr-sbar-thumb"></div></div>`;
        document.body.appendChild(el);
        const track = el.firstElementChild;
        const thumb = track.firstElementChild;
        const X = axis === "x";
        const pos = box => (X ? box.scrollLeft : box.scrollTop);
        const max = box => (X ? box.scrollWidth - box.clientWidth : box.scrollHeight - box.clientHeight);
        const trackLen = () => (X ? track.clientWidth : track.clientHeight);
        const thumbLen = () => (X ? thumb.getBoundingClientRect().width : thumb.getBoundingClientRect().height);
        const setPos = (box, v) => { if (X) box.scrollLeft = v; else box.scrollTop = v; };

        function paint(box) {
            const tl = trackLen();
            const len = Math.max(36, tl * (X ? box.clientWidth / box.scrollWidth : box.clientHeight / box.scrollHeight));
            const m = max(box);
            const off = m > 0 ? (tl - len) * pos(box) / m : 0;
            thumb.style[X ? "width" : "height"] = `${len}px`;
            thumb.style.transform = X ? `translateX(${off}px)` : `translateY(${off}px)`;
        }

        // Drag the thumb; tap the track to jump there.
        let drag = null;
        thumb.addEventListener("pointerdown", e => {
            const box = activeBox();
            if (!box) return;
            e.preventDefault();
            e.stopPropagation();
            thumb.setPointerCapture(e.pointerId);
            drag = { at: X ? e.clientX : e.clientY, from: pos(box), box };
            el.classList.add("dragging");
        });
        thumb.addEventListener("pointermove", e => {
            if (!drag) return;
            const moved = (X ? e.clientX : e.clientY) - drag.at;
            setPos(drag.box, drag.from + moved * max(drag.box) / Math.max(1, trackLen() - thumbLen()));
        });
        ["pointerup", "pointercancel"].forEach(ev => thumb.addEventListener(ev, () => {
            drag = null;
            el.classList.remove("dragging");
        }));
        track.addEventListener("pointerdown", e => {
            if (e.target === thumb) return;
            const box = activeBox();
            if (!box) return;
            const r = track.getBoundingClientRect();
            const at = X ? e.clientX - r.left : e.clientY - r.top;
            const v = (at - thumbLen() / 2) / Math.max(1, trackLen() - thumbLen()) * max(box);
            box.scrollTo({ [X ? "left" : "top"]: v, behavior: "smooth" });
        });
        return { el, paint };
    }
    const hbar = makeBar("x");
    const vbar = makeBar("y");

    let boxOnScreen = false;
    // At most once a frame.
    let paintQueued = false;
    function paintBar() {
        if (paintQueued) return;
        paintQueued = true;
        requestAnimationFrame(() => { paintQueued = false; paintNow(); });
    }
    function paintNow() {
        const box = activeBox();
        const on = !!box && boxOnScreen && !phone.matches;
        // The gold bars replace the page's own scrollbar while they show.
        document.body.classList.toggle("arr-sbars-on", on);
        hbar.el.hidden = !(on && box.scrollWidth > box.clientWidth + 2);
        vbar.el.hidden = !(on && box.scrollHeight > box.clientHeight + 2);
        if (!on) return;
        const r = box.getBoundingClientRect();
        if (!hbar.el.hidden) {
            hbar.el.style.left = `${Math.max(r.left, 0)}px`;
            hbar.el.style.width = `${Math.min(r.width, window.innerWidth)}px`;
            hbar.paint(box);
        }
        if (!vbar.el.hidden) {
            const top = Math.max(r.top, topH + bar.getBoundingClientRect().height) + 4;
            const bottom = Math.min(r.bottom, window.innerHeight - navH - HBAR_H - 6) - 4;
            vbar.el.hidden = bottom - top < 60;
            vbar.el.style.left = `${Math.min(r.right, window.innerWidth) - 14}px`;
            vbar.el.style.top = `${top}px`;
            vbar.el.style.height = `${Math.max(0, bottom - top)}px`;
            vbar.paint(box);
        }
    }
    phone.addEventListener?.("change", measure);

    // ---------- pin the page when a table scrolls down ----------
    const pinned = () => bar.getBoundingClientRect().top <= topH + 1;
    const lastTop = new WeakMap();
    function onBoxScroll(e) {
        const box = e.currentTarget;
        if (!phone.matches) paintBar();
        const prev = lastTop.get(box) || 0;
        lastTop.set(box, box.scrollTop);
        if (box.scrollTop > prev && !pinned()) {
            const by = bar.getBoundingClientRect().top - topH;
            const scroller = document.body.scrollHeight > window.innerHeight + 2 ? document.body : document.scrollingElement;
            scroller.scrollBy({ top: by, behavior: "smooth" });
        }
        // CIF table: more customers near its own bottom (it used to grow with the page).
        if (box === cifBox && typeof renderedGroupCount !== "undefined" && renderedGroupCount < arrGroups.length
            && box.scrollTop + box.clientHeight >= box.scrollHeight - 400) {
            appendMoreGroups();
        }
    }
    ldBox.addEventListener("scroll", onBoxScroll, { passive: true });
    cifBox?.addEventListener("scroll", onBoxScroll, { passive: true });


    // ---------- keep it current ----------
    const io = new IntersectionObserver(entries => {
        boxOnScreen = entries.some(en => en.isIntersecting && en.target === activeBox()) ||
            [ldBox, cifBox].some(b => b && b === activeBox() && b.getBoundingClientRect().bottom > 0 && b.getBoundingClientRect().top < window.innerHeight);
        paintBar();
    });
    [ldBox, cifBox].forEach(b => b && io.observe(b));
    // The bar and the boxes only — not the tables, which grow on every
    // batch of rows (the thumbs are re-sized on paint anyway).
    const ro = new ResizeObserver(measure);
    [bar, ldBox, cifBox].forEach(el => el && ro.observe(el));
    window.addEventListener("resize", measure);
    const pagePaint = () => { if (!phone.matches) paintBar(); };
    document.body.addEventListener("scroll", pagePaint, { passive: true });
    window.addEventListener("scroll", pagePaint, { passive: true });
    // View / LD-CIF switches and the injected bottom bar change what's measured.
    new MutationObserver(() => requestAnimationFrame(() => {
        const box = activeBox();
        boxOnScreen = !!box && box.getBoundingClientRect().bottom > 0 && box.getBoundingClientRect().top < window.innerHeight;
        measure();
    })).observe(document.body, { attributes: true, attributeFilter: ["class"] });
    // ---------- fixed column widths ----------
    // With automatic table layout, every batch of rows added on scroll
    // made the browser re-measure every column of every row already shown
    // (hundreds of ms on a phone — the stutter while "កំពុងបង្ហាញ" grew).
    // After a full render the header widths are read once and fixed
    // (table-layout:fixed), so later rows only lay out themselves. Re-done
    // when the content or the visible columns change.
    const lockQueue = new Set();
    let lockQueued = false;
    // sample: () => elements added for the measurement only — rows with
    // the longest values in the whole list (only the rows near the
    // screen are in the page, so they alone would make columns too narrow).
    const samplers = new Map();
    function lockTable(table) {
        if (!table || !table.tHead || !table.tHead.rows[0]) return;
        const ths = [...table.tHead.rows[0].cells];
        table.classList.remove("arr-locked");
        table.style.tableLayout = "";
        table.style.width = "";
        ths.forEach(th => { th.style.width = ""; });
        if (!table.offsetParent) return; // not on screen: measured when shown
        const extra = samplers.get(table)?.() || [];
        extra.forEach(el => el.parent.appendChild(el.node));
        // A little slack: other rows' digits / letters can be a hair wider
        // than the sampled longest value.
        const ws = ths.map((th, i) => { const w = th.getBoundingClientRect().width; return w > 0 ? Math.ceil(w) + (i ? 8 : 2) : 0; });
        extra.forEach(el => el.node.remove());
        if (!ws.some(w => w > 0)) return;
        ths.forEach((th, i) => { if (ws[i] > 0) th.style.width = `${ws[i]}px`; });
        table.style.width = `${ws.reduce((a, b) => a + b, 0)}px`;
        table.style.tableLayout = "fixed";
        table.classList.add("arr-locked");
    }
    function lockSoon(table, sample) {
        if (!table) return;
        if (typeof sample === "function") samplers.set(table, sample);
        lockQueue.add(table);
        if (lockQueued) return;
        lockQueued = true;
        requestAnimationFrame(() => {
            lockQueued = false;
            const tables = [...lockQueue];
            lockQueue.clear();
            tables.forEach(lockTable);
            paintBar();
        });
    }
    const relockAll = () => [document.getElementById("arrearsTable"), document.getElementById("arrCifTable")].forEach(t => lockSoon(t));
    window.addEventListener("cm-language-changed", relockAll);
    // Card/table, LD/CIF or fullscreen switched: the table shown changed.
    const viewKey = () => ["arr-view-card", "arr-group-cif", "arr-fullscreen"].map(c => document.body.classList.contains(c) ? 1 : 0).join("");
    let lastView = viewKey();
    new MutationObserver(() => {
        const k = viewKey();
        if (k === lastView) return;
        lastView = k;
        relockAll();
    }).observe(document.body, { attributes: true, attributeFilter: ["class"] });
    window.ArrScroll = { lockSoon };

    measure();
    setTimeout(measure, 600);
})();
