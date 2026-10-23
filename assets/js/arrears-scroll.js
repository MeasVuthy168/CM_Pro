// ========================================
// Daily Arrears — easier scrolling
// 1. The results bar ("បង្ហាញទាំងអស់ …" + LD/CIF + views) sticks under
//    the topbar (CSS: position:sticky, top = --arr-top).
// 2. Each table (LD .table-scroll, CIF .arr-cif-table-wrap) is its own
//    scroll box sized to the screen left under the pinned bar
//    (--arr-box-h), so its header row stays in view, and a horizontal
//    scrollbar is always shown just above the bottom bar (phones hide
//    the native one). Scrolling a table down first pins the page.
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
        root.style.setProperty("--arr-box-h", `${Math.max(220, window.innerHeight - topH - barH - navH - HBAR_H - 30)}px`);
        paintBar();
    }

    // ---------- horizontal scrollbar (fixed above the bottom bar) ----------
    const HBAR_H = 18;
    const hbar = document.createElement("div");
    hbar.className = "arr-hbar";
    hbar.hidden = true;
    hbar.innerHTML = `<div class="arr-hbar-track"><div class="arr-hbar-thumb"></div></div>`;
    document.body.appendChild(hbar);
    const track = hbar.firstElementChild;
    const thumb = track.firstElementChild;

    const landscape = () => document.body.classList.contains("arrears-force-landscape");
    function activeBox() {
        if (typeof arrViewMode !== "undefined" && arrViewMode === "card") return null;
        return typeof arrGroupMode !== "undefined" && arrGroupMode === "cif" ? cifBox : ldBox;
    }

    let boxOnScreen = false;
    function paintBar() {
        const box = activeBox();
        const show = !!box && boxOnScreen && !landscape() && box.scrollWidth > box.clientWidth + 2;
        hbar.hidden = !show;
        if (!show) return;
        const r = box.getBoundingClientRect();
        hbar.style.left = `${Math.max(r.left, 0)}px`;
        hbar.style.width = `${Math.min(r.width, window.innerWidth)}px`;
        const tw = track.clientWidth;
        const w = Math.max(36, tw * box.clientWidth / box.scrollWidth);
        const max = box.scrollWidth - box.clientWidth;
        thumb.style.width = `${w}px`;
        thumb.style.transform = `translateX(${max > 0 ? (tw - w) * box.scrollLeft / max : 0}px)`;
    }

    // Drag the thumb; tap the track to jump there.
    let drag = null;
    thumb.addEventListener("pointerdown", e => {
        const box = activeBox();
        if (!box) return;
        e.preventDefault();
        thumb.setPointerCapture(e.pointerId);
        drag = { x: e.clientX, left: box.scrollLeft, box };
        hbar.classList.add("dragging");
    });
    thumb.addEventListener("pointermove", e => {
        if (!drag) return;
        const tw = track.clientWidth;
        const w = thumb.getBoundingClientRect().width;
        const max = drag.box.scrollWidth - drag.box.clientWidth;
        drag.box.scrollLeft = drag.left + (e.clientX - drag.x) * max / Math.max(1, tw - w);
    });
    ["pointerup", "pointercancel"].forEach(ev => thumb.addEventListener(ev, () => {
        drag = null;
        hbar.classList.remove("dragging");
    }));
    track.addEventListener("pointerdown", e => {
        if (e.target === thumb) return;
        const box = activeBox();
        if (!box) return;
        const r = track.getBoundingClientRect();
        const w = thumb.getBoundingClientRect().width;
        const max = box.scrollWidth - box.clientWidth;
        box.scrollTo({ left: (e.clientX - r.left - w / 2) / Math.max(1, r.width - w) * max, behavior: "smooth" });
    });

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
