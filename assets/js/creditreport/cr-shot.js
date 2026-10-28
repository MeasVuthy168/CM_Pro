// ========================================
// Credit Report — "Screenshot": the report's table card (its title,
// the whole table and its notes, not just the part on screen) as a PNG,
// copied to the clipboard to paste into Telegram & co. Where the
// browser can't put an image on the clipboard it opens the share sheet,
// and failing that saves the file.
// ========================================

window.CRShot = (() => {
    const LIB = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
    let libLoading = null;

    function loadLib() {
        if (window.html2canvas) return Promise.resolve();
        if (!libLoading) {
            libLoading = new Promise((resolve, reject) => {
                const s = document.createElement("script");
                s.src = LIB;
                s.onload = resolve;
                s.onerror = () => { libLoading = null; reject(new Error("html2canvas failed to load")); };
                document.head.appendChild(s);
            });
        }
        return libLoading;
    }

    // el laid out in full (no scroll box, no sticky cells) while drawn.
    async function render(el) {
        await loadLib();
        if (document.fonts && document.fonts.ready) await document.fonts.ready;
        el.classList.add("cr-capturing");
        el.style.width = "max-content";
        try {
            const bg = getComputedStyle(el).backgroundColor || "#ffffff";
            const canvas = await html2canvas(el, {
                scale: 2,
                backgroundColor: bg,
                windowWidth: Math.max(document.documentElement.clientWidth, el.scrollWidth + 80),
                ignoreElements: n => n.classList && (n.classList.contains("cr-shot-btn") || n.classList.contains("cr-skeleton")),
                // In html2canvas's own copy of the page: as wide as the
                // whole table there (the notes wrap under it), at least a
                // phone's width.
                onclone: doc => {
                    const c = el.id && doc.getElementById(el.id);
                    const table = c && c.querySelector("table");
                    if (table) c.style.width = `${Math.max(380, table.scrollWidth + 24)}px`;
                }
            });
            return await new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error("empty image"))), "image/png"));
        } finally {
            el.classList.remove("cr-capturing");
            el.style.width = "";
        }
    }

    // Starts drawing at once (still inside the tap, which the clipboard
    // needs) and resolves to "copied", "shared" or "saved".
    async function capture(el, filename) {
        const blob = render(el);
        if (navigator.clipboard && window.ClipboardItem) {
            try {
                await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
                return "copied";
            } catch (e) {
                console.warn("clipboard image failed, trying share / download:", e);
            }
        }
        const file = new File([await blob], filename, { type: "image/png" });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            try {
                await navigator.share({ files: [file] });
                return "shared";
            } catch (e) {
                if (e && e.name === "AbortError") return "cancelled";
            }
        }
        const a = document.createElement("a");
        a.href = URL.createObjectURL(file);
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        return "saved";
    }

    return { capture, render };
})();
