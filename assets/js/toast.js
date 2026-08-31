// ===========================================
// CM_Pro Toast
// Version 3.0
// ===========================================

// Escapes for both HTML text content and quoted attribute values (title/
// message/uploadedBy/photo below all land in one or the other, and all can
// carry attacker-controlled text — pushed notification data ends up here
// verbatim, so this has to be attribute-safe, not just tag-safe).
function escapeHtml(text){

  const div=document.createElement("div");

  div.textContent=text == null ? "" : String(text);

  return div.innerHTML.replace(/"/g,"&quot;").replace(/'/g,"&#39;");

}

// notification.url comes straight from the push payload, same as
// title/message above — restricting it to an in-app path before it's
// ever handed to location.href (see the onDetail callbacks below)
// stops a notification from being able to send a click into an
// external (phishing) site, same reasoning as login.js's
// getSafeNextParam() and service-worker.js's notificationclick guard.
function safeNotificationUrl(url){

  return (typeof url === "string" && url.startsWith("/CM_Pro/"))
    ? url
    : "/CM_Pro/pages/notifications/";

}

const CMToast = {

  version: "3.0",

  queue: [],

  busy: false,

  container: null,

  active: null,

  timer: null,

  remaining: 0,

  startTime: 0,

  // =====================================
  // SHOW
  // =====================================

  async show(options = {}) {

    this.queue.push(options);

    if (!this.busy) {

      await this.next();

    }

  },

  // =====================================
  // NEXT
  // =====================================

  async next() {

    if (this.queue.length === 0) {

      this.busy = false;

      return;

    }

    this.busy = true;

    await this.render(this.queue.shift());

  },

  // =====================================
  // CONTAINER
  // =====================================

  getContainer() {

    if (this.container) {

      return this.container;

    }

    let box = document.querySelector(".cm-toast-container");

    if (!box) {

      box = document.createElement("div");

      box.className = "cm-toast-container";

      document.body.appendChild(box);

    }

    this.container = box;

    return box;

  },

  // =====================================
  // ICON
  // =====================================

  getIcon(type) {

    switch (type) {

      case "backup":
        return "💾";

      case "upload":
        return "📤";

      case "warning":
        return "⚠️";

      case "error":
        return "❌";

      case "success":
        return "✅";

      case "update":
        return "⬆️";

      case "delete":
        return "🗑️";

      case "system":
        return "🖥️";

      default:
        return "🔔";

    }

  },

  // =====================================
  // USER PHOTO
  // =====================================

  async getUserPhoto(username) {

    try {

      let targetUsername = username;

      // No specific uploader given — fall back to the
      // currently logged-in viewer (e.g. manual test toasts).

      if (!targetUsername) {

        const user = JSON.parse(

          localStorage.getItem("loggedInUser") ||

          "{}"

        );

        targetUsername = user.username;

      }

      // "System" isn't a real account with a photo — skip
      // the network call entirely and use the default image.

      if (!targetUsername || targetUsername === "System") {

        return "/CM_Pro/assets/images/profile.jpg";

      }

      const token = API.getToken();

      const response = await fetch(

        `${API.BASE_URL}/assets/user-photo/${encodeURIComponent(targetUsername)}`,

        {

          headers: {

            Authorization: `Bearer ${token}`

          }

        }

      );

      if (!response.ok) {

        return "/CM_Pro/assets/images/profile.jpg";

      }

      const blob = await response.blob();

      return URL.createObjectURL(blob);

    } catch (err) {

      console.error("getUserPhoto failed for", username, ":", err);

      return "/CM_Pro/assets/images/profile.jpg";

    }

  },

  // =====================================
  // USER PHOTO (timeout-guarded)
  // =====================================
  // iOS can silently hang the fetch above (throttled/backgrounded
  // network stack) instead of rejecting it. Since render() awaits
  // this before the toast even exists in the DOM, a hang here means
  // the toast never appears at all, with no console error. This
  // wrapper guarantees a result within timeoutMs no matter what.

  async getUserPhotoSafe(username, timeoutMs = 1500) {

    try {

      return await Promise.race([

        this.getUserPhoto(username),

        new Promise((resolve) => {

          setTimeout(() => {

            resolve("/CM_Pro/assets/images/profile.jpg");

          }, timeoutMs);

        })

      ]);

    } catch {

      return "/CM_Pro/assets/images/profile.jpg";

    }

  },

  // =====================================
  // TIME AGO
  // =====================================

  timeAgo(date) {

    if (!date) {

      return "Just now";

    }

    const d = new Date(date);

    const diff =
      Math.floor(
        (Date.now() - d.getTime()) / 1000
      );

    if (diff < 60) {

      return "Just now";

    }

    if (diff < 3600) {

      return Math.floor(diff / 60) + " min ago";

    }

    if (diff < 86400) {

      return Math.floor(diff / 3600) + " hr ago";

    }

    return d.toLocaleString();

  },

  // =====================================
  // RENDER
  // =====================================

  async render(opt) {

   try {

    const container = this.getContainer();

    const type = opt.type || "info";

    const title = opt.title || "Notification";

    const message = opt.message || "";

    const uploadedBy = opt.uploadedBy || "System";

    const createdAt = opt.createdAt || new Date().toISOString();

    const photo = opt.photo || await this.getUserPhotoSafe(opt.uploadedBy);

    const icon = this.getIcon(type);

    const duration = opt.duration || 5000;

    const toast = document.createElement("div");

    toast.className = `cm-toast toast-${type}`;

    toast.innerHTML = `
      <div class="cm-toast-left">
        <div class="cm-toast-icon">
          ${icon}
        </div>
      </div>

      <div class="cm-toast-center">
        <div class="cm-toast-title">
          ${escapeHtml(title)}
        </div>

        <div class="cm-toast-message">
          ${escapeHtml(message)}
        </div>

        <div class="cm-toast-meta">
          <div class="cm-toast-user">
            <img
              class="cm-toast-avatar"
              src="${escapeHtml(photo)}"
              onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath fill=%22%239AA5B1%22 d=%22M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z%22/%3E%3C/svg%3E'">
            <span class="cm-toast-username">
              ${escapeHtml(uploadedBy)}
            </span>
          </div>

          <div class="cm-toast-time">
            ${this.timeAgo(createdAt)}
          </div>
        </div>

        <div class="cm-toast-progress">
          <div class="cm-toast-bar"></div>
        </div>
      </div>

      <div class="cm-toast-right">
        <button class="cm-toast-close">✕</button>
      </div>
    `;

    container.appendChild(toast);

    this.active = toast;

    this.remaining = duration;

    this.startTime = Date.now();

    // ========================
    // Slide animation
    // ========================

    requestAnimationFrame(() => {

      toast.classList.add("show");

    });

    // ========================
    // Progress bar
    // ========================

    const bar = toast.querySelector(".cm-toast-bar");

    bar.style.animationDuration = duration + "ms";

    bar.classList.add("run");

    toast._bar = bar;

    // ========================
    // Detail callback
    // ========================

    toast._detail =
      typeof opt.onDetail === "function"
        ? opt.onDetail
        : null;

    // ========================
    // Close button
    // ========================

    const closeBtn = toast.querySelector(".cm-toast-close");

    closeBtn.addEventListener("click", (e) => {

      e.stopPropagation();

      this.close();

    });

    // ========================
    // Click to open detail
    // ========================

    toast.addEventListener("click", () => {

      if (toast._detail) {

        toast._detail();

      }

      this.close();

    });

    // ========================
    // Auto-dismiss timer
    // ========================

    clearTimeout(this.timer);

    this.timer = setTimeout(() => {

      this.close();

    }, duration);

    // ========================
    // Pause on hover (desktop)
    // ========================

    toast.addEventListener("mouseenter", () => {

      clearTimeout(this.timer);

      this.remaining -= Date.now() - this.startTime;

      toast._bar.style.animationPlayState = "paused";

    });

    toast.addEventListener("mouseleave", () => {

      this.startTime = Date.now();

      toast._bar.style.animationPlayState = "running";

      this.timer = setTimeout(() => {

        this.close();

      }, this.remaining);

    });

    // ========================
    // Swipe up to dismiss (mobile)
    // ========================

    let startY = 0;

    toast.addEventListener(

      "touchstart",

      e => {

        startY = e.touches[0].clientY;

      },

      { passive: true }

    );

    toast.addEventListener(

      "touchend",

      e => {

        const diff = startY - e.changedTouches[0].clientY;

        if (diff > 70) {

          this.close();

        }

      },

      { passive: true }

    );

   } catch (err) {

    // Any unexpected failure (DOM, animation, gesture APIs, etc.)
    // must never leave the queue stuck — log it and move on so
    // one bad toast can't silently block every toast after it.

    console.error("CMToast render failed:", err);

    this.busy = false;

    this.next();

   }

  },

  // =====================================
  // CLOSE
  // =====================================

  close() {

    if (!this.active) {

      return;

    }

    clearTimeout(this.timer);

    const toast = this.active;

    toast.classList.remove("show");

    toast.classList.add("hide");

    setTimeout(() => {

      toast.remove();

      this.active = null;

      this.busy = false;

      this.next();

    }, 300);

  }

};

// ===========================================
// IndexedDB catch-up queue (iOS-safe path)
// ===========================================
// iOS freezes ALL JavaScript for a backgrounded/closed PWA, so a
// notification that arrives in that state can never trigger a
// live toast — no message-passing mechanism can wake the page up.
// The Service Worker stashes every notification into IndexedDB as
// a catch-up copy. If the page receives it live (via BroadcastChannel
// or the message listener below), it deletes its own catch-up entry.
// Anything left over when the page next loads means it was missed
// live, and gets shown then — the closest honest approximation to
// "the toast appears" for the backgrounded/closed case.

const CM_IDB_NAME = "cmProNotifications";

const CM_IDB_STORE = "pending";

function cmIdbOpen() {

  return new Promise((resolve, reject) => {

    const req = indexedDB.open(CM_IDB_NAME, 1);

    req.onupgradeneeded = () => {

      const db = req.result;

      if (!db.objectStoreNames.contains(CM_IDB_STORE)) {

        db.createObjectStore(CM_IDB_STORE, { keyPath: "id" });

      }

    };

    req.onsuccess = () => resolve(req.result);

    req.onerror = () => reject(req.error);

  });

}

async function cmIdbDeletePending(id) {

  if (!id) return;

  try {

    const db = await cmIdbOpen();

    await new Promise((resolve, reject) => {

      const tx = db.transaction(CM_IDB_STORE, "readwrite");

      tx.objectStore(CM_IDB_STORE).delete(id);

      tx.oncomplete = () => resolve();

      tx.onerror = () => reject(tx.error);

    });

  } catch (err) {

    console.error("⚠️ cmIdbDeletePending failed:", err);

  }

}

async function cmIdbGetAllPending() {

  try {

    const db = await cmIdbOpen();

    return await new Promise((resolve, reject) => {

      const tx = db.transaction(CM_IDB_STORE, "readonly");

      const req = tx.objectStore(CM_IDB_STORE).getAll();

      req.onsuccess = () => resolve(req.result || []);

      req.onerror = () => reject(req.error);

    });

  } catch (err) {

    console.error("⚠️ cmIdbGetAllPending failed:", err);

    return [];

  }

}

async function cmFlushPendingNotifications() {

  if (!("indexedDB" in window)) return;

  const pending = await cmIdbGetAllPending();

  if (pending.length === 0) return;

  console.log(`📬 Flushing ${pending.length} missed notification(s) from IndexedDB`);

  // Oldest first, so they appear in the order they were sent.

  pending.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  for (const n of pending) {

    if (n.id && cmShownNotificationIds.has(n.id)) {

      // Already shown live in this page session — just clean up.

      await cmIdbDeletePending(n.id);

      continue;

    }

    if (n.id) cmShownNotificationIds.add(n.id);

    await CMToast.show({

      type: n.type || "info",

      title: n.title || "Notification",

      message: n.message || "",

      uploadedBy: n.uploadedBy || "System",

      createdAt: n.createdAt,

      duration: 5000,

      onDetail() {

        location.href = safeNotificationUrl(n.url);

      }

    });

    await cmIdbDeletePending(n.id);

  }

}

if (document.readyState === "loading") {

  document.addEventListener("DOMContentLoaded", cmFlushPendingNotifications);

} else {

  cmFlushPendingNotifications();

}

// ===========================================
// Service Worker Listener
// Version 3.0
// ===========================================
// A Set of notification ids already shown, so that if a
// notification is ever delivered more than once (e.g. both
// BroadcastChannel and the fallback message listener fire, or
// a live delivery races the IndexedDB flush), it can only ever
// render as a toast once per page session.

const cmShownNotificationIds = new Set();

function handleSWMessage(msg) {

  if (!msg) return;

  // =====================================
  // Refresh Badge
  // =====================================

  if (msg.type === "REFRESH_BADGE") {

    if (typeof loadNotificationBadge === "function") {

      loadNotificationBadge();

    }

    return;

  }

  // =====================================
  // Toast
  // =====================================

  if (msg.type === "NEW_NOTIFICATION") {

    const n = msg.notification || {};

    if (n.id) {

      if (cmShownNotificationIds.has(n.id)) {

        // Already shown once this session — skip the duplicate,
        // but still clean up its IndexedDB catch-up copy.

        cmIdbDeletePending(n.id);

        return;

      }

      cmShownNotificationIds.add(n.id);

    }

    CMToast.show({

      type: n.type || "info",

      title: n.title || "Notification",

      message: n.message || "",

      uploadedBy: n.uploadedBy || "System",

      createdAt: n.createdAt,

      photo: n.photo,

      duration: 5000,

      onDetail() {

        location.href = safeNotificationUrl(n.url);

      }

    });

    // Delivered live — remove the IndexedDB catch-up copy so it
    // doesn't show again as a "missed" notification on next load.

    cmIdbDeletePending(n.id);


  }

}

if ("serviceWorker" in navigator) {

  navigator.serviceWorker.addEventListener(

    "message",

    (event) => handleSWMessage(event.data)

  );

}

// ===========================================
// BroadcastChannel Listener (iOS-safe path)
// ===========================================
// clients.matchAll() inside the Service Worker's push
// handler appears to unreliably find zero open window
// clients on iOS, which silently breaks the message-based
// path above. BroadcastChannel doesn't depend on client
// discovery at all, so it's used as the primary delivery
// path for iOS while the message listener above remains
// as a fallback for browsers where matchAll() does work.

if ("BroadcastChannel" in window) {

  const cmProChannel = new BroadcastChannel("cm-pro-notifications");

  cmProChannel.onmessage = (event) => handleSWMessage(event.data);

}
