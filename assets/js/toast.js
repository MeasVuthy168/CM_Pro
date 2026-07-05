// ===========================================
// TEMPORARY iOS On-Screen Debug Console
// Paste this at the very TOP of your page's
// script (before cm-toast.js loads), test on
// the iPhone, then delete it when done.
// ===========================================

(function () {

  const box = document.createElement("div");

  box.id = "ios-debug-box";

  box.style.cssText = `
    position:fixed;
    bottom:44px;
    left:0;
    right:0;
    max-height:35vh;
    overflow-y:auto;
    background:rgba(0,0,0,0.9);
    color:#0f0;
    font-family:monospace;
    font-size:11px;
    line-height:1.4;
    z-index:999999;
    padding:8px;
    white-space:pre-wrap;
    word-break:break-word;
    display:none;
  `;

  let expanded = false;

  document.addEventListener("DOMContentLoaded", () => {

    document.body.appendChild(box);

    addButton();

    addToggle();

  });

  function log(type, args) {

    const time = new Date().toLocaleTimeString();

    const color =
      type === "ERROR" ? "#ff5555" :
      type === "WARN" ? "#ffcc00" :
      type === "NET" ? "#66ccff" :
      "#0f0";

    const line = document.createElement("div");

    line.style.color = color;

    line.textContent = `[${time}] [${type}] ` +
      args.map(a => {
        try {
          return typeof a === "object" ? JSON.stringify(a) : String(a);
        } catch {
          return String(a);
        }
      }).join(" ");

    box.appendChild(line);

    box.scrollTop = box.scrollHeight;

  }

  // ========================
  // Capture console.*
  // ========================

  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;

  console.log = (...args) => { origLog(...args); log("LOG", args); };

  console.warn = (...args) => { origWarn(...args); log("WARN", args); };

  console.error = (...args) => { origError(...args); log("ERROR", args); };

  // ========================
  // Capture uncaught errors
  // ========================

  window.onerror = (msg, src, line, col) => {

    log("ERROR", [`${msg} @ ${src}:${line}:${col}`]);

  };

  // ========================
  // Capture hung/rejected promises
  // ========================
  // This is the important one for the "toast silently
  // never appears" bug — an unhandled rejection means
  // an await somewhere failed instead of hanging forever.

  window.addEventListener("unhandledrejection", (e) => {

    log("ERROR", [`Unhandled promise rejection: ${e.reason}`]);

  });

  // ========================
  // Wrap fetch to log timing
  // ========================
  // Shows exactly how long each network call takes on
  // this device — if the user-photo fetch is hanging,
  // you'll see it start but never see it finish.

  const origFetch = window.fetch;

  window.fetch = function (...args) {

    const url = args[0];

    const start = Date.now();

    log("NET", [`→ fetch start: ${url}`]);

    return origFetch.apply(this, args)
      .then(res => {

        log("NET", [`← fetch done (${Date.now() - start}ms, status ${res.status}): ${url}`]);

        return res;

      })
      .catch(err => {

        log("NET", [`✕ fetch FAILED (${Date.now() - start}ms): ${url} — ${err}`]);

        throw err;

      });

  };

  // ========================
  // Manual test button
  // ========================

  function addButton() {

    const btn = document.createElement("button");

    btn.textContent = "Test Toast";

    btn.style.cssText = `
      position:fixed;
      top:8px;
      right:8px;
      z-index:999999;
      padding:8px 12px;
      background:#333;
      color:#fff;
      border:1px solid #666;
      border-radius:6px;
      font-size:12px;
    `;

    btn.addEventListener("click", () => {

      log("LOG", ["Manually triggering CMToast.show()..."]);

      if (typeof CMToast === "undefined") {

        log("ERROR", ["CMToast is not defined — script didn't load"]);

        return;

      }

      CMToast.show({

        type: "info",

        title: "Debug Test",

        message: "If you can see this, rendering works.",

        onDetail() {

          log("LOG", ["onDetail fired"]);

        }

      });

    });

    document.body.appendChild(btn);

  }

  // ========================
  // Collapse/expand toggle
  // ========================
  // Log panel starts hidden so it never covers the bottom
  // nav bar (e.g. blocking access to Settings). Tap the
  // small pill to show/hide it on demand.

  function addToggle() {

    const toggle = document.createElement("button");

    toggle.id = "ios-debug-toggle";

    toggle.textContent = "🐞 Log";

    toggle.style.cssText = `
      position:fixed;
      top:8px;
      left:8px;
      z-index:999999;
      padding:6px 10px;
      background:#333;
      color:#0f0;
      border:1px solid #666;
      border-radius:14px;
      font-size:11px;
      font-family:monospace;
    `;

    toggle.addEventListener("click", () => {

      expanded = !expanded;

      box.style.display = expanded ? "block" : "none";

      toggle.textContent = expanded ? "🐞 Hide" : "🐞 Log";

    });

    document.body.appendChild(toggle);

  }

})();

// ===========================================
// CM_Pro Toast
// Version 3.0
// ===========================================

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

  async getUserPhoto() {

    try {

      const user = JSON.parse(

        localStorage.getItem("loggedInUser") ||

        "{}"

      );

      if (!user.username) {

        return "/CM_Pro/assets/images/profile.jpg";

      }

      const token = API.getToken();

      const response = await fetch(

        `${API.BASE_URL}/assets/user-photo/${encodeURIComponent(user.username)}`,

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

    } catch {

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

  async getUserPhotoSafe(timeoutMs = 1500) {

    try {

      return await Promise.race([

        this.getUserPhoto(),

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

    const photo = opt.photo || await this.getUserPhotoSafe();

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
          ${title}
        </div>

        <div class="cm-toast-message">
          ${message}
        </div>

        <div class="cm-toast-meta">
          <div class="cm-toast-user">
            <img
              class="cm-toast-avatar"
              src="${photo}"
              onerror="this.src='/CM_Pro/assets/images/default-user.png'">
            <span class="cm-toast-username">
              ${uploadedBy}
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
// Service Worker Listener
// Version 3.0
// ===========================================

function handleSWMessage(msg) {

  console.log("📩 MESSAGE", msg);

  if (!msg) return;

  // =====================================
  // Debug pings from the Service Worker
  // =====================================

  if (msg.type === "PUSH_DEBUG") {

    console.log("🛰️ SW DEBUG:", msg.stage, msg);

    return;

  }

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

    CMToast.show({

      type: n.type || "info",

      title: n.title || "Notification",

      message: n.message || "",

      uploadedBy: n.uploadedBy || "System",

      createdAt: n.createdAt,

      photo: n.photo,

      duration: 5000,

      onDetail() {

        location.href = n.url || "/CM_Pro/pages/notifications/";

      }

    });

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
