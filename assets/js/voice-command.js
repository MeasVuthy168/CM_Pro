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
    let hadError = false;
    let cancelledByUser = false;
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

    // Tapping stop / outside is a deliberate cancel, not a failed
    // command — the abort() this triggers still fires onerror/onend
    // just like any other stop, so this flag is what keeps that from
    // being mistaken for "heard something, didn't understand it".
    function userStop() {
        cancelledByUser = true;
        stopListening();
        closeModal();
    }

    modal.addEventListener("click", (e) => {
        if (e.target === modal) userStop();
    });

    stopBtn.addEventListener("click", userStop);

    snackbarHelp.addEventListener("click", () => {
        location.href = VOICE_HELP_URL;
    });

    // Safety net: if the page unloads for any other reason while
    // still listening (a matched command's own navigation included),
    // make sure the mic is released rather than riding the unload.
    window.addEventListener("pagehide", stopListening);

    // Mobile browsers (Safari especially) often freeze the page into
    // the back-forward cache instead of unloading it when a matched
    // command navigates away — the sheet was mid-"show" at that
    // instant. Navigating back then restores that exact frozen DOM
    // with no JS re-running, so the stale "Customer Search" sheet
    // reappeared over the Home page. event.persisted is how a bfcache
    // restore is told apart from a normal fresh load.
    window.addEventListener("pageshow", (event) => {
        if (!event.persisted) return;
        stopListening();
        closeModal();
        snackbar.classList.remove("show");
        clearTimeout(snackbarTimer);
    });

    recognition.onstart = () => {
        matched = false;
        heardAnything = false;
        hadError = false;
        cancelledByUser = false;
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
            } else {
                // Stop right here, while the session is still verifiably
                // active — by the time onend fires naturally, the service
                // has already disconnected on its own and abort() there is
                // a no-op, which is why the mic kept recording past the
                // "not found" result even after adding a call in onend.
                stopListening();
            }
        }
    };

    recognition.onerror = (event) => {
        // "aborted" is us calling stop()/abort() ourselves (a match,
        // or the user cancelling) — not a real failure, and already
        // handled by whichever of those triggered it.
        if (event.error === "aborted") return;

        hadError = true;
        if (event.error === "not-allowed" || event.error === "service-not-allowed") {
            statusEl.textContent = "Microphone access blocked";
        } else if (event.error === "no-speech") {
            statusEl.textContent = "Didn't hear anything";
        } else {
            statusEl.textContent = "Something went wrong";
        }
    };

    recognition.onend = () => {
        if (matched || cancelledByUser) return;

        // onend firing doesn't guarantee the underlying mic session is
        // actually released (some WebView/native bridges keep recording
        // past it) — the same reason the matched-command and user-cancel
        // paths already call this explicitly. The error/no-match/silent
        // paths below were missing it, which is what let the mic keep
        // recording after a "Voice command not found" result.
        stopListening();

        // Listening has genuinely stopped either way — drop the
        // pulsing ring now even though the sheet itself stays up a
        // moment longer below, so it doesn't look like it's still
        // recording.
        btnWrap.classList.remove("listening");

        if (hadError) {
            // Give the user a moment to actually read the message
            // above before the sheet disappears out from under it.
            setTimeout(closeModal, 1500);
            return;
        }

        if (heardAnything) {
            // Same reasoning — let the unrecognized phrase sit on
            // screen briefly before swapping to the snackbar.
            setTimeout(() => {
                closeModal();
                showNotFoundSnackbar();
            }, 700);
            return;
        }

        closeModal();
    };

    micBtn.addEventListener("click", () => {
        openModal();
        try {
            recognition.start();
        } catch (err) {
            // start() throws if called while already running/starting —
            // a rapid double-tap is the only realistic cause here. Don't
            // leave the sheet stuck showing "listening" forever.
            console.warn("[voice-command] start failed:", err);
            statusEl.textContent = "Couldn't start listening";
            setTimeout(closeModal, 1200);
        }
    });
}

document.addEventListener("DOMContentLoaded", initVoiceCommand);
