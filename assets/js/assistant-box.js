/* =========================
   Assistant Box — Greeting / Update Logic
   Greeting mode: "Good {Morning/Afternoon/Evening} {fullname}"
   Update mode: driven by the real notifications API, not localStorage.
   Every app-version upload creates one Notification (eventKey:
   "app_version") on the server. We look for the latest one and check
   its per-user isRead flag from GET /api/notifications/my. Clicking
   the X calls POST /api/notifications/mark-read, which persists
   server-side — so the banner stays gone until the NEXT version
   upload creates a brand new (unread) notification.
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

/**
 * Finds the latest unread "app_version" notification for this app,
 * or null if there isn't one / user has already read it.
 */
async function getPendingVersionNotification() {
    const data = await API.get('/api/notifications/my?limit=50');
    if (!data || !data.ok || !Array.isArray(data.items)) return null;

    // server already sorts by createdAt desc, so the first match is latest
    const match = data.items.find(
        n => n.eventKey === 'app_version' && n.extra?.app === ASSISTANT_APP_NAME
    );

    if (!match || match.isRead) return null;
    return match;
}

function renderUpdateBox(box, textEl, notification) {
    box.dataset.mode = 'update';
    const version = notification.extra?.version || '';

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
        dismiss.onclick = () => dismissUpdate(notification._id, box, textEl);
        box.appendChild(dismiss);
    }

    textEl.innerHTML = `
        <span class="update-version">កំណែថ្មី Version ${version} មកដល់ហើយ!</span>
        <span class="update-highlights">សូមចូលទៅ Download កំណែថ្មីក្នុងកម្មវិធី Excel ឈ្មោះ SVG Credit Monitoring</span>
        <button class="assistant-cta" onclick="location.href='${ASSISTANT_ABOUT_URL}'">ចុចមើលព៌តមានកំណែថ្មី</button>
    `;
}

function renderGreetingBox(box, textEl, fullname) {
    box.dataset.mode = 'greeting';
    box.querySelector('.assistant-new-badge')?.remove();
    box.querySelector('.assistant-dismiss')?.remove();
    textEl.textContent = getGreeting(fullname);
}

async function dismissUpdate(notificationId, box, textEl) {
    renderGreetingBox(box, textEl, window.currentUserFullname || '');
    try {
        await API.post('/api/notifications/mark-read', { notificationId });
    } catch (err) {
        // If this fails, the banner will just reappear on next load —
        // annoying but not harmful, so fail quietly here.
        console.warn('[assistant-box] mark-read failed:', err);
    }
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
        const pending = await getPendingVersionNotification();
        if (pending) {
            renderUpdateBox(box, textEl, pending);
        }
        // otherwise: no unread version notification, greeting stays.
    } catch (err) {
        // Network hiccup, expired token, etc. — fail quietly to the
        // greeting that's already showing rather than breaking the dashboard.
        console.warn('[assistant-box] could not check notifications:', err);
    }
}

// Example call, once the page has loaded and the user is authenticated:
// initAssistantBox();                       // pulls fullname from session
// initAssistantBox({ userName: 'Meas Vuthy' }); // or pass it explicitly
