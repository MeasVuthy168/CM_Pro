/* =========================================================
   VOICE COMMAND
   Mic button on the Home page's assistant box opens a bottom sheet
   (like the reference app) that shows the live transcript as it's
   recognized and auto-navigates once a known command matches. Uses
   the Web Speech API (SpeechRecognition) — not supported in every
   browser (notably some non-Chromium mobile browsers), so this fails
   soft: the mic button hides itself rather than offering something
   that can never work.

   Commands are matched by simple substring containment against the
   recognized phrase (case-insensitive), checked in the order listed
   below — most specific first, so e.g. "loan calculate" is checked
   before anything shorter that could also match part of it.
========================================================= */

const VOICE_COMMANDS = [
    { keywords: ["customer search", "customer"], action: () => location.href = "/CM_Pro/pages/customers/index.html", label: "Customer Search" },
    { keywords: ["daily arrears", "arrears"], action: () => location.href = "/CM_Pro/pages/arrears/index.html", label: "Daily Arrears" },
    { keywords: ["average turnover", "turnover"], action: () => location.href = "/CM_Pro/pages/turnover/index.html", label: "Average Turnover" },
    { keywords: ["spot check"], action: () => location.href = "/CM_Pro/pages/spotcheck/index.html", label: "Spot Check" },
    { keywords: ["officer task"], action: () => location.href = "/CM_Pro/pages/officertask/index.html", label: "Officer Task" },
    { keywords: ["credit report"], action: () => location.href = "/CM_Pro/pages/creditreport/index.html", label: "Credit Report" },
    { keywords: ["loan calculate", "calculate loan", "loan calculator"], action: () => location.href = "/CM_Pro/pages/loanCalculate/index.html", label: "Loan Calculate" },
    { keywords: ["retirement"], action: () => location.href = "/CM_Pro/pages/retirement/index.html", label: "Retirement" },
    { keywords: ["notification"], action: () => location.href = "/CM_Pro/pages/notifications/index.html", label: "Notification" },
    { keywords: ["setting"], action: () => location.href = "/CM_Pro/pages/settings/index.html", label: "Setting" },
    { keywords: ["home"], action: () => location.href = "/CM_Pro/index.html", label: "Home" },

    { keywords: ["light mode", "classic mode"], action: () => CMTheme.set("light"), label: "Light Mode" },
    { keywords: ["dark gray mode", "gray mode", "grey mode"], action: () => CMTheme.set("darkgray"), label: "Dark Gray Mode" },
    { keywords: ["dark mode"], action: () => CMTheme.set("dark"), label: "Dark Mode" },
    { keywords: ["gold mode"], action: () => CMTheme.set("gold"), label: "Gold Mode" },
];

const VOICE_HELP_URL = "/CM_Pro/pages/settings/voicecommand.html";

function matchVoiceCommand(transcript) {
    const text = transcript.toLowerCase();
    for (const cmd of VOICE_COMMANDS) {
        if (cmd.keywords.some(k => text.includes(k))) {
            return cmd;
        }
    }
    return null;
}

function getVoiceUserFirstName() {
    try {
        const raw = localStorage.getItem("loggedInUser") || sessionStorage.getItem("loggedInUser");
        if (raw) {
            const u = JSON.parse(raw);
            const full = u?.fullname || u?.username;
            if (full) return String(full).trim().split(/\s+/)[0];
        }
    } catch (e) {}
    return "";
}

function initVoiceCommand() {
    const micBtn = document.getElementById("assistantMicBtn");
    const modal = document.getElementById("voiceModal");
    const greetingEl = document.getElementById("voiceGreeting");
    const statusEl = document.getElementById("voiceStatus");
    const btnWrap = document.getElementById("voiceBtnWrap");
    const stopBtn = document.getElementById("voiceStopBtn");
    const snackbar = document.getElementById("voiceSnackbar");
    const snackbarHelp = document.getElementById("voiceSnackbarHelp");

    if (!micBtn || !modal) return;

    const SpeechRecognitionCtor =
        window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognitionCtor) {
        // Feature not supported on this browser — hide the button
        // rather than offer something that can never work.
        micBtn.style.display = "none";
        return;
    }

    const recognition = new SpeechRecognitionCtor();
    recognition.lang = "en-US";
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    let matched = false;
    let heardAnything = false;
    let snackbarTimer = null;

    function openModal() {
        const name = getVoiceUserFirstName();
        greetingEl.textContent = name ? `Hi ${name},` : "Hi,";
        statusEl.textContent = "What can I do for you?";
        btnWrap.classList.add("listening");
        modal.classList.add("show");
    }

    function closeModal() {
        modal.classList.remove("show");
        btnWrap.classList.remove("listening");
    }

    // Stops the mic track itself, not just the recognition session —
    // without this, some WebView/native bridges keep the underlying
    // audio-recording session alive past recognition.onend, which is
    // what was surfacing the OS-level "Stop audio recording?" prompt
    // when the sheet closed or the page navigated away mid-listen.
    function stopListening() {
        try {
            recognition.abort();
        } catch (e) {}
    }

    function showNotFoundSnackbar() {
        clearTimeout(snackbarTimer);
        snackbar.classList.add("show");
        snackbarTimer = setTimeout(() => {
            snackbar.classList.remove("show");
        }, 5000);
    }

    modal.addEventListener("click", (e) => {
        if (e.target === modal) {
            stopListening();
            closeModal();
        }
    });

    stopBtn.addEventListener("click", () => {
        stopListening();
        closeModal();
    });

    snackbarHelp.addEventListener("click", () => {
        location.href = VOICE_HELP_URL;
    });

    // Safety net: if the page unloads for any other reason while
    // still listening (a matched command's own navigation included),
    // make sure the mic is released rather than riding the unload.
    window.addEventListener("pagehide", stopListening);

    recognition.onstart = () => {
        matched = false;
        heardAnything = false;
    };

    recognition.onresult = (event) => {
        const result = event.results[0];
        const transcript = result[0].transcript;
        if (transcript.trim()) heardAnything = true;
        statusEl.textContent = transcript;

        if (result.isFinal) {
            const command = matchVoiceCommand(transcript);
            if (command) {
                matched = true;
                btnWrap.classList.remove("listening");
                statusEl.textContent = command.label;
                stopListening();
                setTimeout(() => command.action(), 600);
            }
        }
    };

    recognition.onerror = (event) => {
        if (event.error === "not-allowed" || event.error === "service-not-allowed") {
            statusEl.textContent = "Microphone access blocked";
        } else if (event.error === "no-speech") {
            statusEl.textContent = "Didn't hear anything";
        } else if (event.error !== "aborted") {
            statusEl.textContent = "Something went wrong";
        }
    };

    recognition.onend = () => {
        if (matched) return;
        closeModal();
        if (heardAnything) {
            showNotFoundSnackbar();
        }
    };

    micBtn.addEventListener("click", () => {
        openModal();
        try {
            recognition.start();
        } catch (err) {
            // start() throws if called while already running/starting —
            // a rapid double-tap is the only realistic cause here.
            console.warn("[voice-command] start failed:", err);
        }
    });
}

document.addEventListener("DOMContentLoaded", initVoiceCommand);
