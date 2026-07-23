// ========================================
// Credit Report hub — 5 report cards.
// Only "Daily Monitoring by Branch" is built (plain <a href> to
// RepDetailbyBranch.html). The other 4 are placeholders that show a
// toast instead of navigating anywhere.
// ========================================

let crHubToastTimer = null;

function crHubShowToast(message) {
    const el = document.getElementById("cr-hub-toast");
    if (!el) return;
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(crHubToastTimer);
    crHubToastTimer = setTimeout(() => {
        el.classList.remove("show");
    }, 1800);
}

document.querySelectorAll(".cr-hub-soon").forEach(card => {
    card.addEventListener("click", () => {
        crHubShowToast("Coming soon");
    });
});
