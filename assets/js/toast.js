// ===========================================
// CM_Pro Toast
// Version 2.0
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

  show(options = {}) {

    this.queue.push(options);

    if (!this.busy) {

      this.next();

    }

  },

  // =====================================
  // NEXT
  // =====================================

  next() {

    if (this.queue.length === 0) {

      this.busy = false;

      return;

    }

    this.busy = true;

    this.render(this.queue.shift());

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

  getUserPhoto() {

    try {

      const user =
        JSON.parse(
          localStorage.getItem("loggedInUser") || "{}"
        );

      return (
        user.image ||
        user.photo ||
        "/CM_Pro/assets/images/default-user.png"
      );

    } catch {

      return "/CM_Pro/assets/images/default-user.png";

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

  render(opt) {

    const container = this.getContainer();

    const type = opt.type || "info";

    const title = opt.title || "Notification";

    const message = opt.message || "";

    const uploadedBy = opt.uploadedBy || "System";

    const createdAt = opt.createdAt || new Date().toISOString();

    const photo = opt.photo || this.getUserPhoto();

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

    });

    // ========================
    // Auto-dismiss timer
    // ========================

    clearTimeout(this.timer);

    this.timer = setTimeout(() => {

      this.close();

    }, duration);

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

if ("serviceWorker" in navigator) {

  navigator.serviceWorker.ready.then(() => {

    navigator.serviceWorker.addEventListener(

      "message",

      (event) => {

        const msg = event.data;

        if (!msg) {

          return;

        }

        // =====================================
        // Refresh Badge
        // =====================================

        if (msg.type === "REFRESH_BADGE") {

          console.log("🔔 Refresh Badge");

          if (typeof loadNotificationBadge === "function") {

            loadNotificationBadge();

          }

          return;

        }

        // =====================================
        // Toast
        // =====================================

        if (msg.type === "NEW_NOTIFICATION") {

          console.log("📢 Toast Notification");

          const n = msg.notification || {};

          CMToast.show({

            type: n.type || "info",

            title: n.title || "Notification",

            message: n.message || "",

            uploadedBy: n.uploadedBy || "System",

            createdAt: n.createdAt || new Date().toISOString(),

            photo: n.photo || n.image || "",

            duration: 5000,

            onDetail() {

              location.href = n.url || "/CM_Pro/pages/notifications/";

            }

          });

        }

      }

    );

  });

}
