// =========================
// TOPBAR "⋮" DROPDOWN MENU
// Generic open/close for #topbarMenu, the dropdown anchored under the
// topbar's own "⋮" action button (#topbarActionBtn). A page renders
// its own <div class="topbar-menu" id="topbarMenu"> with whatever
// <button class="topbar-menu-item"> items it needs, passes
// actionHandler:toggleTopbarMenu to initTopbar(), and wires each
// item's own click handler itself — this file only owns the
// show/hide/outside-click toggle, shared across every page that opts
// in (Credit Portfolio Trends and the 4 Daily Monitoring report
// pages, per explicit request 2026-10-08).
// =========================
window.toggleTopbarMenu = function(){

    const menu =
        document.getElementById("topbarMenu");

    if(!menu) return;

    menu.style.display =

        menu.style.display === "block"

        ? "none"

        : "block";

};

// Capture phase (not bubble) — same rationale as the Notifications
// page's own #notificationMenu outside-click handler: closes the menu
// on a tap anywhere outside it no matter what that element's own click
// handler does (e.g. stopPropagation()).
document.addEventListener(

    "click",

    (e)=>{

        const menu =
            document.getElementById("topbarMenu");

        if(!menu || menu.style.display !== "block") return;

        if(
            e.target.closest("#topbarMenu") ||
            e.target.closest("#topbarActionBtn")
        ) return;

        menu.style.display = "none";

    },

    true

);
