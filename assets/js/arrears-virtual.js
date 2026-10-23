// ========================================
// Daily Arrears — virtual scrolling for the LD and CIF tables
// Thousands of rows in the page made scrolling slow on phones (every
// row's frozen No / Customer cells, layout, paint). Only the rows near
// the screen are in the page now — a few dozen, plus a buffer — between
// two spacers as tall as the rows left out, so the scrollbar, the
// header and the frozen columns (plain position:sticky) behave as if
// every row were there. Rows are added / dropped at the edges as the
// table scrolls, in batches.
//
//   const v = new ArrVirtualList({ box, container, keep, makeSpacer,
//                                  build, heightOf, measure });
//   v.reset(count)      new data: renders from the top
//   v.render()          after a scroll (called by its own listeners)
//   v.relayout()        an item's height changed (CIF group opened)
//   v.reveal(i)         scroll item i to the middle and render it
//   v.renderFirst(n)    print / PDF: the first n items, all in the page
//   v.restore()         back to the window after print / PDF
// ========================================

(function () {
    // Rendered above and below what's on screen. A new window is built
    // only when the screen comes within EDGE_PX of the rendered rows'
    // edge, then with BUFFER_PX to spare — so most scroll frames change
    // nothing in the page (a re-render on every frame made phones jank).
    const BUFFER_PX = 1400;
    const EDGE_PX = 350;

    class ArrVirtualList {
        constructor({ box, container, keep, makeSpacer, build, heightOf, measure }) {
            this.box = box;                 // the scrolling element
            this.container = container;     // holds spacers + items
            this.build = build;             // i -> element
            this.heightOf = heightOf;       // i -> estimated height (px)
            this.measure = measure;         // (items[]) -> true when the estimates changed
            this.keep = keep || [];         // container children that stay first (a <thead>)
            this.top = makeSpacer();
            this.bot = makeSpacer();
            this.n = 0;
            this.s = 0;
            this.e = 0;
            this.off = [0];
            this.full = false;              // renderFirst() in effect
            this.queued = false;
            this.active = false;
            const onScroll = () => this.schedule();
            box.addEventListener("scroll", onScroll, { passive: true });
            window.addEventListener("scroll", onScroll, { passive: true });
            document.body.addEventListener("scroll", onScroll, { passive: true });
            window.addEventListener("resize", onScroll);
            // Shown again (card -> table, LD <-> CIF): fill the window.
            new ResizeObserver(onScroll).observe(box);
        }

        offsets() {
            const off = new Array(this.n + 1);
            off[0] = 0;
            for (let i = 0; i < this.n; i++) off[i + 1] = off[i] + this.heightOf(i);
            this.off = off;
        }

        // Index of the item at y (px from the first item's top).
        indexAt(y) {
            const off = this.off;
            let lo = 0, hi = this.n;
            while (lo < hi) {
                const mid = (lo + hi) >> 1;
                if (off[mid + 1] <= y) lo = mid + 1; else hi = mid;
            }
            return Math.min(lo, Math.max(0, this.n - 1));
        }

        setSpacer(el, h) {
            const cell = el.firstElementChild?.firstElementChild || el.firstElementChild || el;
            // Never hidden: the top spacer's position is where item 0 starts.
            cell.style.height = `${Math.max(0, Math.round(h))}px`;
        }

        items() {
            const out = [];
            for (let el = this.top.nextElementSibling; el && el !== this.bot; el = el.nextElementSibling) out.push(el);
            return out;
        }

        reset(n) {
            this.n = n;
            this.full = false;
            this.active = true;
            this.offsets();
            this.s = this.e = 0;
            this.container.replaceChildren(...this.keep, this.top, this.bot);
            this.render(true);
        }

        relayout() {
            if (!this.active) return;
            this.offsets();
            this.setSpacer(this.top, this.off[this.s]);
            this.setSpacer(this.bot, this.off[this.n] - this.off[this.e]);
            this.schedule();
        }

        schedule() {
            if (!this.active || this.full || this.queued) return;
            this.queued = true;
            requestAnimationFrame(() => { this.queued = false; this.render(); });
        }

        // The window [s, e) covering what's on screen, plus `buffer` px.
        wanted(buffer) {
            if (!this.n) return [0, 0];
            const box = this.box.getBoundingClientRect();
            const viewTop = Math.max(box.top, 0);
            const viewBottom = Math.min(box.bottom, window.innerHeight);
            const firstTop = this.top.getBoundingClientRect().top;   // where item 0 starts
            const y0 = viewTop - firstTop - buffer;
            const y1 = Math.max(viewBottom, viewTop + 1) - firstTop + buffer;
            let s = this.indexAt(Math.max(0, y0));
            let e = Math.min(this.n, this.indexAt(Math.max(0, y1)) + 1);
            return [s, Math.max(e, Math.min(this.n, s + 1))];
        }

        render(force) {
            if (!this.active || this.full) return;
            if (!force && this.s < this.e) {
                const [ns, ne] = this.wanted(EDGE_PX);
                if (ns >= this.s && ne <= this.e) return;   // still covered
            }
            const [s, e] = this.wanted(BUFFER_PX);
            if (!force && s === this.s && e === this.e) return;
            const c = this.container;
            const make = (a, b) => {
                const frag = document.createDocumentFragment();
                for (let i = a; i < b; i++) frag.appendChild(this.build(i));
                return frag;
            };
            if (force || e <= this.s || s >= this.e || this.s === this.e) {
                c.replaceChildren(...this.keep, this.top, make(s, e), this.bot);
            } else {
                // Drop what scrolled out, then add what scrolled in.
                for (let k = this.s; k < s; k++) this.top.nextElementSibling?.remove();
                for (let k = e; k < this.e; k++) this.bot.previousElementSibling?.remove();
                if (s < this.s) this.top.after(make(s, this.s));
                if (e > this.e) this.bot.before(make(this.e, e));
            }
            this.s = s;
            this.e = e;
            this.setSpacer(this.top, this.off[s]);
            this.setSpacer(this.bot, this.off[this.n] - this.off[e]);
            if (this.measure && this.measure(this.items(), s)) this.relayout();
        }

        rendered(i) {
            return i >= this.s && i < this.e;
        }

        reveal(i) {
            if (!this.active || i < 0 || i >= this.n) return;
            const firstTop = this.top.getBoundingClientRect().top + this.box.scrollTop - this.box.getBoundingClientRect().top;
            this.box.scrollTop = Math.max(0, firstTop + this.off[i] - this.box.clientHeight / 2);
            this.render(true);
        }

        renderFirst(count) {
            if (!this.active) return;
            this.full = true;
            const e = Math.min(this.n, count);
            const frag = document.createDocumentFragment();
            for (let i = 0; i < e; i++) frag.appendChild(this.build(i));
            this.container.replaceChildren(...this.keep, this.top, frag, this.bot);
            this.s = 0;
            this.e = e;
            this.setSpacer(this.top, 0);
            this.setSpacer(this.bot, 0);
        }

        restore() {
            if (!this.full) return;
            this.full = false;
            this.render(true);
        }

        stop() {
            this.active = false;
        }
    }

    window.ArrVirtualList = ArrVirtualList;
})();
