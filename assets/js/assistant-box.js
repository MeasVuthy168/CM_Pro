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

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text == null ? '' : String(text);
    return div.innerHTML;
}

function getGreeting(fullname) {
    const h = new Date().getHours();
    const key = h < 12 ? 'dashboard.greeting.morning' : h < 17 ? 'dashboard.greeting.afternoon' : 'dashboard.greeting.evening';
    return window.CMI18n ? CMI18n.t(key, { name: fullname }) : `${key} ${fullname}`;
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
async function getPendingVersionNotification(items) {
    if (!Array.isArray(items)) {
        const data = await API.get('/api/notifications/my?limit=50');
        if (!data || !data.ok || !Array.isArray(data.items)) return null;
        items = data.items;
    }

    // server already sorts by createdAt desc, so the first match is latest
    const match = items.find(
        n => n.eventKey === 'app_version' && n.extra?.app === ASSISTANT_APP_NAME
    );

    if (!match || match.isRead) return null;
    return match;
}

function renderUpdateBox(box, textEl, notification) {
    box.dataset.mode = 'update';
    const version = notification.extra?.version || '';

    const t = (key, vars) => window.CMI18n ? CMI18n.t(key, vars) : key;

    if (!box.querySelector('.assistant-new-badge')) {
        const badge = document.createElement('span');
        badge.className = 'assistant-new-badge';
        badge.textContent = t('dashboard.update.badge');
        box.prepend(badge);
    }

    if (!box.querySelector('.assistant-dismiss')) {
        const dismiss = document.createElement('button');
        dismiss.className = 'assistant-dismiss';
        dismiss.setAttribute('aria-label', t('dashboard.update.dismissAria'));
        dismiss.textContent = '×';
        dismiss.onclick = () => dismissUpdate(notification._id, box, textEl);
        box.appendChild(dismiss);
    }

    textEl.innerHTML = `
        <span class="update-version">${escapeHtml(t('dashboard.update.version', { v: version }))}</span>
        <span class="update-highlights">${escapeHtml(t('dashboard.update.highlights'))}</span>
        <button class="assistant-cta" onclick="location.href='${ASSISTANT_ABOUT_URL}'">${escapeHtml(t('dashboard.update.cta'))}</button>
    `;
}

function renderGreetingBox(box, textEl, fullname) {
    stopAlertRotation();
    box.dataset.mode = 'greeting';
    box.querySelector('.assistant-new-badge')?.remove();
    box.querySelector('.assistant-dismiss')?.remove();
    textEl.textContent = getGreeting(fullname);
}

/* =========================
   SMART ALERTS (CM Pro AI — Stage 1)
   The server checks the Daily Monitoring history every evening (see
   CM-backend lib/smart-alerts.js) and sends each person one digest
   notification (type "smart_alert") listing what needs attention in
   their scope. The latest unread one takes over the assistant box:
   a gold card that cycles through the items, with a sheet listing
   them all and a shortcut to the matching report.
========================= */

const SMART_ALERT_LINKS = {
    branch: './pages/creditreport/RepDetailbyBranch.html',
    officer: './pages/creditreport/RepDetailbyCO.html'
};

let alertRotationTimer = null;

function stopAlertRotation() {
    if (alertRotationTimer) {
        clearInterval(alertRotationTimer);
        alertRotationTimer = null;
    }
}

function getPendingSmartAlert(items) {
    if (!Array.isArray(items)) return null;
    return items.find(n =>
        n.type === 'smart_alert' &&
        !n.isRead &&
        Array.isArray(n.extra?.alerts) &&
        n.extra.alerts.length
    ) || null;
}

function alertIcon(kind) {
    return kind === 'os_drop' ? '📉' : kind === 'npl_rise' ? '🔺' : '⚠️';
}

function fmtUsd(n) {
    return '$' + Math.round(Number(n) || 0).toLocaleString('en-US');
}

function describeSmartAlert(a) {
    const t = (key, vars) => window.CMI18n ? CMI18n.t(key, vars) : key;
    const who = a.scope === 'officer'
        ? t('dashboard.alert.who.officer', { name: a.name || a.id, branch: a.branch || '' })
        : t('dashboard.alert.who.branch', { branch: a.branch || '' });
    if (a.kind === 'par_rise') {
        return t('dashboard.alert.parRise', {
            who, pct: a.changePct, from: fmtUsd(a.from), to: fmtUsd(a.to),
            // parPct is a fraction, like the snapshot (0.0312 = 3.12%)
            par: Math.round((Number(a.parPct) || 0) * 1000) / 10
        });
    }
    if (a.kind === 'os_drop') {
        return t('dashboard.alert.osDrop', { who, pct: a.changePct, from: fmtUsd(a.from), to: fmtUsd(a.to) });
    }
    if (a.kind === 'npl_rise') {
        return t('dashboard.alert.nplRise', { who, n: a.change, from: a.from, to: a.to });
    }
    return who;
}

function renderAlertBox(box, textEl, notification) {
    const t = (key, vars) => window.CMI18n ? CMI18n.t(key, vars) : key;
    const alerts = notification.extra.alerts;

    stopAlertRotation();
    box.dataset.mode = 'alert';
    box.querySelector('.assistant-new-badge')?.remove();
    box.querySelector('.assistant-dismiss')?.remove();

    const badge = document.createElement('span');
    badge.className = 'assistant-new-badge assistant-alert-badge';
    badge.textContent = `⚠️ ${alerts.length}`;
    box.prepend(badge);

    const dismiss = document.createElement('button');
    dismiss.className = 'assistant-dismiss';
    dismiss.setAttribute('aria-label', t('dashboard.alert.dismissAria'));
    dismiss.textContent = '×';
    dismiss.onclick = () => dismissUpdate(notification._id, box, textEl);
    box.appendChild(dismiss);

    textEl.innerHTML = `
        <span class="alert-title">${escapeHtml(t('dashboard.alert.title', { n: alerts.length }))}</span>
        <span class="alert-line" id="assistantAlertLine"></span>
        <button class="assistant-cta assistant-alert-cta" type="button">${escapeHtml(t('dashboard.alert.view'))}</button>
    `;
    textEl.querySelector('.assistant-alert-cta').onclick = () => openSmartAlertSheet(notification);

    const lineEl = textEl.querySelector('#assistantAlertLine');
    let i = 0;
    const show = () => {
        const a = alerts[i % alerts.length];
        lineEl.classList.remove('in');
        void lineEl.offsetWidth; // restart the fade
        lineEl.textContent = `${alertIcon(a.kind)} ${describeSmartAlert(a)}`;
        lineEl.classList.add('in');
        i++;
    };
    show();
    if (alerts.length > 1) alertRotationTimer = setInterval(show, 4500);
}

function openSmartAlertSheet(notification) {
    const t = (key, vars) => window.CMI18n ? CMI18n.t(key, vars) : key;
    const alerts = notification.extra.alerts;

    document.getElementById('smartAlertSheet')?.remove();
    const wrap = document.createElement('div');
    wrap.id = 'smartAlertSheet';
    wrap.className = 'sa-dim';
    wrap.innerHTML = `
        <div class="sa-sheet" role="dialog" aria-modal="true" aria-labelledby="saTitle">
            <div class="sa-grab"></div>
            <div class="sa-head">
                <div>
                    <div class="sa-title" id="saTitle">${escapeHtml(t('dashboard.alert.sheetTitle'))}</div>
                    <div class="sa-sub">${escapeHtml(t('dashboard.alert.sheetSub', { date: notification.extra.date || '' }))}</div>
                </div>
                <button type="button" class="sa-close" aria-label="Close">×</button>
            </div>
            <div class="sa-list">
                ${alerts.map(a => `
                    <div class="sa-item sa-${escapeHtml(a.kind)}">
                        <span class="sa-ic">${alertIcon(a.kind)}</span>
                        <div class="sa-body">
                            <div class="sa-text">${escapeHtml(describeSmartAlert(a))}</div>
                            <a class="sa-link" href="${SMART_ALERT_LINKS[a.scope] || SMART_ALERT_LINKS.branch}">${escapeHtml(t(a.scope === 'officer' ? 'dashboard.alert.openOfficer' : 'dashboard.alert.openBranch'))} ›</a>
                        </div>
                    </div>`).join('')}
            </div>
        </div>`;
    const close = () => wrap.remove();
    wrap.addEventListener('click', e => { if (e.target === wrap) close(); });
    wrap.querySelector('.sa-close').onclick = close;
    document.body.appendChild(wrap);

    // Opening the list counts as having seen it; the card stays up for
    // this visit and goes back to the greeting next time.
    if (!notification.isRead && !String(notification._id).startsWith('TEST-')) {
        notification.isRead = true;
        API.post('/api/notifications/mark-read', { notificationId: notification._id }).catch(() => {});
    }
}

async function dismissUpdate(notificationId, box, textEl) {
    renderGreetingBox(box, textEl, window.currentUserFullname || '');

    if (String(notificationId).startsWith('TEST-')) {
        console.log('[assistant-box] test dismiss — no real API call made.');
        return;
    }

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

    // textEl starts tagged data-i18n="common.loading" (shown before this
    // runs) — remove it now that JS owns this element's content, so a
    // later CMI18n.apply() pass (e.g. triggered by topbar/bottomnav
    // loading in elsewhere on the page) doesn't stomp the greeting back
    // to "Loading...".
    textEl.removeAttribute('data-i18n');

    const fullname = userName || getStoredFullname() || (window.CMI18n ? CMI18n.t('dashboard.defaultUser') : 'User');
    window.currentUserFullname = fullname;

    // Show the greeting immediately so the box isn't empty while we fetch.
    renderGreetingBox(box, textEl, fullname);

    try {
        const data = await API.get('/api/notifications/my?limit=50');
        const items = data && data.ok && Array.isArray(data.items) ? data.items : [];

        // Something needing attention beats the version banner.
        const alert = getPendingSmartAlert(items);
        const pending = alert ? null : await getPendingVersionNotification(items);
        if (alert) {
            renderAlertBox(box, textEl, alert);
        } else if (pending) {
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

/* =========================
   TEST HOOK — no real release needed
   Run this from the browser console (or a temporary <script> tag) to
   preview the update banner. It does NOT call /api/app/upload, does
   NOT touch GitHub Releases or MongoDB, and clicking × just resets
   to the greeting locally — no /api/notifications/mark-read call.

   Usage:
     testAssistantUpdate('8.1.0');
========================= */
function testAssistantUpdate(version = '9.9.9') {
    const box = document.querySelector('.assistant-box');
    const textEl = document.getElementById('assistantText');
    if (!box || !textEl) {
        console.warn('[assistant-box] .assistant-box or #assistantText not found on this page.');
        return;
    }

    const fakeNotification = {
        _id: `TEST-${Date.now()}`,
        eventKey: 'app_version',
        isRead: false,
        extra: { app: ASSISTANT_APP_NAME, version }
    };

    renderUpdateBox(box, textEl, fakeNotification);
    console.log(`[assistant-box] Test update banner shown for version ${version}. Nothing was sent to the server.`);
}

/* Preview the Smart Alert card without the server:
     testAssistantAlert();
*/
function testAssistantAlert() {
    const box = document.querySelector('.assistant-box');
    const textEl = document.getElementById('assistantText');
    if (!box || !textEl) return;
    renderAlertBox(box, textEl, {
        _id: `TEST-${Date.now()}`,
        type: 'smart_alert',
        isRead: false,
        extra: {
            date: '2026-10-18',
            alerts: [
                { scope: 'branch', branch: 'Svay Rieng', kind: 'par_rise', changePct: 4.2, from: 250000, to: 260500, parPct: 0.031 },
                { scope: 'branch', branch: 'Nhor', kind: 'os_drop', changePct: 3.6, from: 1820000, to: 1754000 },
                { scope: 'officer', id: '9027', name: 'Sok Dara', branch: 'Nhor', kind: 'npl_rise', change: 6, from: 4, to: 10 }
            ]
        }
    });
}
