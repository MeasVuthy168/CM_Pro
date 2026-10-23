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

    // ---------- sizes ----------
    function measure() {
        const top = document.querySelector(".topbar");
        const nav = document.querySelector(".bottom-nav");
        const topH = top ? Math.round(top.getBoundingClientRect().height) : 0;
        const navH = nav ? Math.round(nav.getBoundingClientRect().height) : 0;
        const barH = Math.round(bar.getBoundingClientRect().height);
        root.style.setProperty("--arr-top", `${topH}px`);
        root.style.setProperty("--arr-bottom", `${navH}px`);
        const hbarRoom = phone.matches ? 0 : HBAR_H;
        root.style.setProperty("--arr-box-h", `${Math.max(220, window.innerHeight - topH - barH - navH - hbarRoom - 30)}px`);
        paintBar();
    }

    // ---------- scrollbars: horizontal (above the bottom bar) and vertical
    // (the table's right edge), gold, always shown on computers. Phones
    // scroll by touch, so neither is shown there. ----------
    const HBAR_H = 18;
    const phone = window.matchMedia("(max-width: 768px), (hover: none) and (pointer: coarse)");
    const landscape = () => document.body.classList.contains("arrears-force-landscape");
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
    function paintBar() {
        const box = activeBox();
        const on = !!box && boxOnScreen && !landscape() && !phone.matches;
        // The gold bars replace the page's own scrollbar while they show.
        document.body.classList.toggle("arr-sbars-on", on);
        hbar.el.hidden = !(on && box.scrollWidth > box.clientWidth + 2);
        vbar.el.hidden = !(on && box.scrollHeight > box.clientHeight + 2);
        if (!on) return;
        const r = box.getBoundingClientRect();
        const topH = parseFloat(getComputedStyle(root).getPropertyValue("--arr-top")) || 0;
        const navH = parseFloat(getComputedStyle(root).getPropertyValue("--arr-bottom")) || 0;
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
    const pinned = () => bar.getBoundingClientRect().top <= (parseFloat(getComputedStyle(root).getPropertyValue("--arr-top")) || 0) + 1;
    const lastTop = new WeakMap();
    function onBoxScroll(e) {
        const box = e.currentTarget;
        paintBar();
        const prev = lastTop.get(box) || 0;
        lastTop.set(box, box.scrollTop);
        if (box.scrollTop > prev && !pinned() && !landscape()) {
            const topH = parseFloat(getComputedStyle(root).getPropertyValue("--arr-top")) || 0;
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
    const ro = new ResizeObserver(measure);
    [bar, ldBox, cifBox, ldBox.firstElementChild, cifBox?.firstElementChild].forEach(el => el && ro.observe(el));
    window.addEventListener("resize", measure);
    document.body.addEventListener("scroll", paintBar, { passive: true });
    window.addEventListener("scroll", paintBar, { passive: true });
    // View / LD-CIF switches and the injected bottom bar change what's measured.
    new MutationObserver(() => requestAnimationFrame(() => {
        const box = activeBox();
        boxOnScreen = !!box && box.getBoundingClientRect().bottom > 0 && box.getBoundingClientRect().top < window.innerHeight;
        measure();
    })).observe(document.body, { attributes: true, attributeFilter: ["class"] });
    measure();
    setTimeout(measure, 600);
})();
