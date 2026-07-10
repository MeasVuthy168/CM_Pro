/* =========================
   Assistant Box — Greeting / Update Logic
   Decides which mode to render on load, based on whether the
   user has already seen the current app version.
========================= */

function getKhmerGreeting(name) {
    const h = new Date().getHours();
    const greet = h < 11 ? "អរុណសួស្តី"
                : h < 14 ? "ថ្ងៃត្រង់សួស្តី"
                : h < 18 ? "រសៀលសួស្តី"
                : "សាយណ្ហសួស្តី";
    return `${greet}, ${name}! សូមស្វាគមន៍មកកាន់ CM Pro`;
}

/**
 * highlights: array of short strings, e.g. ['ស៊ីនក្រូ MongoDB លឿនជាងមុន', 'កែសម្រួល UI']
 */
function renderUpdateBox(box, textEl, version, highlights) {
    box.dataset.mode = 'update';

    // badge
    if (!box.querySelector('.assistant-new-badge')) {
        const badge = document.createElement('span');
        badge.className = 'assistant-new-badge';
        badge.textContent = 'NEW';
        box.prepend(badge);
    }

    // dismiss button
    if (!box.querySelector('.assistant-dismiss')) {
        const dismiss = document.createElement('button');
        dismiss.className = 'assistant-dismiss';
        dismiss.setAttribute('aria-label', 'Dismiss update notice');
        dismiss.textContent = '×';
        dismiss.onclick = () => dismissUpdate(version, box, textEl);
        box.appendChild(dismiss);
    }

    textEl.innerHTML = `
        <span class="update-version">កំណែថ្មី v${version} មកដល់ហើយ!</span>
        <span class="update-highlights">${highlights.join(' • ')}</span>
        <button class="assistant-cta" onclick="location.href='/whats-new'">មើលលម្អិត</button>
    `;
}

function renderGreetingBox(box, textEl, userName) {
    box.dataset.mode = 'greeting';
    box.querySelector('.assistant-new-badge')?.remove();
    box.querySelector('.assistant-dismiss')?.remove();
    textEl.textContent = getKhmerGreeting(userName);
}

function dismissUpdate(version, box, textEl) {
    localStorage.setItem('cmpro_seen_version', version);
    renderGreetingBox(box, textEl, window.currentUserName || '');
}

/**
 * Call this once on dashboard/login load.
 * highlights is only needed when a new version is actually being announced.
 */
function initAssistantBox({ currentVersion, userName, highlights = [] }) {
    const box = document.querySelector('.assistant-box');
    const textEl = document.getElementById('assistantText');
    if (!box || !textEl) return;

    window.currentUserName = userName;
    const seenVersion = localStorage.getItem('cmpro_seen_version');

    if (seenVersion !== currentVersion) {
        renderUpdateBox(box, textEl, currentVersion, highlights);
    } else {
        renderGreetingBox(box, textEl, userName);
    }
}

// Example call, once app knows the logged-in user and build version:
// initAssistantBox({
//     currentVersion: '1.4.0',
//     userName: 'Vuthy',
//     highlights: ['ស៊ីនក្រូ MongoDB លឿនជាងមុន', 'កែសម្រួល UI']
// });
