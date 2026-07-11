/* =========================
   Assistant Box — Greeting / Update Logic
   Greeting mode: "Good {Morning/Afternoon/Evening} {fullname}"
   Update mode: pulls the real latest version from
   GET /api/app/version?app=SVG_CreditMonitoring (your existing,
   JWT-protected endpoint in server.js) and links to about.html.
========================= */

const ASSISTANT_APP_NAME = 'SVG_CreditMonitoring';
const ASSISTANT_ABOUT_URL = './pages/settings/about.html';

function getGreeting(fullname) {
    const h = new Date().getHours();
    const period = h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : 'Evening';
    return `Good ${period} ${fullname}`;
}

/**
 * Reads the logged-in user's fullname from the loggedInUser object
 * (confirmed via session.js's autoLogout, which clears this same key).
 * Mirrors API.getToken()'s localStorage-or-sessionStorage check, since
 * "remember me" determines which storage login.js actually used.
 */
function getStoredFullname() {
    try {
        const raw =
            localStorage.getItem('loggedInUser') ||
            sessionStorage.getItem('loggedInUser');

        if (raw) {
            const u = JSON.parse(raw);
            if (u?.fullname) return u.fullname;
        }
    } catch (e) {
        console.warn('[assistant-box] could not read loggedInUser:', e);
    }
    return null;
}

function renderUpdateBox(box, textEl, version, notes) {
    box.dataset.mode = 'update';

    if (!box.querySelector('.assistant-new-badge')) {
        const badge = document.createElement('span');
        badge.className = 'assistant-new-badge';
        badge.textContent = 'NEW';
        box.prepend(badge);
    }

    if (!box.querySelector('.assistant-dismiss')) {
        const dismiss = document.createElement('button');
        dismiss.className = 'assistant-dismiss';
        dismiss.setAttribute('aria-label', 'Dismiss update notice');
        dismiss.textContent = '×';
        dismiss.onclick = () => dismissUpdate(version, box, textEl);
        box.appendChild(dismiss);
    }

    textEl.innerHTML = `
        <span class="update-version">កំណែថ្មី Version ${version} មកដល់ហើយ!</span>
        <span class="update-highlights">សូមចូលទៅ Download កំណែថ្មីក្នុងកម្មវិធី Excel ឈ្មោះ SVG Credit Monitoring</span>
        <button class="assistant-cta" onclick="location.href='${ASSISTANT_ABOUT_URL}'">មើលអ្វីថ្មី</button>
    `;
}

function renderGreetingBox(box, textEl, fullname) {
    box.dataset.mode = 'greeting';
    box.querySelector('.assistant-new-badge')?.remove();
    box.querySelector('.assistant-dismiss')?.remove();
    textEl.textContent = getGreeting(fullname);
}

function dismissUpdate(version, box, textEl) {
    localStorage.setItem('cmpro_seen_version', version);
    renderGreetingBox(box, textEl, window.currentUserFullname || '');
}

/**
 * Call this once on dashboard load, after login.
 * userName is optional — if omitted, we try to read it from session storage.
 */
async function initAssistantBox({ userName } = {}) {
    const box = document.querySelector('.assistant-box');
    const textEl = document.getElementById('assistantText');
    if (!box || !textEl) return;

    const fullname = userName || getStoredFullname() || 'អ្នកប្រើប្រាស់';
    window.currentUserFullname = fullname;

    // Show the greeting immediately so the box isn't empty while we fetch.
    renderGreetingBox(box, textEl, fullname);

    try {
        const data = await API.get(`/api/app/version?app=${ASSISTANT_APP_NAME}`);

        if (!data || !data.ok || !data.hasVersion) return; // stays on greeting

        const currentVersion = data.latestVersion;
        const seenVersion = localStorage.getItem('cmpro_seen_version');

        if (seenVersion !== currentVersion) {
            renderUpdateBox(box, textEl, currentVersion, data.notes || '');
        }
        // if already seen, greeting (already rendered) stays.
    } catch (err) {
        // Network hiccup, expired token, etc. — fail quietly to the
        // greeting that's already showing rather than breaking the dashboard.
        console.warn('[assistant-box] could not check app version:', err);
    }
}

// Example call, once the page has loaded and the user is authenticated:
// initAssistantBox();                       // pulls fullname from session
// initAssistantBox({ userName: 'Meas Vuthy' }); // or pass it explicitly
