/* =========================================================
   VOICE COMMAND
   Mic button on the Home page's assistant box. Uses the Web Speech
   API (SpeechRecognition) — not supported in every browser (notably
   older/some non-Chromium mobile browsers), so this fails soft with
   a toast rather than breaking the page when it's missing.

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

function matchVoiceCommand(transcript) {
    const text = transcript.toLowerCase();
    for (const cmd of VOICE_COMMANDS) {
        if (cmd.keywords.some(k => text.includes(k))) {
            return cmd;
        }
    }
    return null;
}

function voiceToast(type, title, message) {
    if (typeof CMToast === "undefined") return;
    CMToast.show({ type, title, message, duration: 3500 });
}

function initVoiceCommand() {
    const micBtn = document.getElementById("assistantMicBtn");
    if (!micBtn) return;

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
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    let listening = false;

    recognition.onstart = () => {
        listening = true;
        micBtn.classList.add("listening");
        voiceToast("info", "Listening...", "Try saying “Open Daily Arrears” or “Switch to Dark Mode”");
    };

    recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        const command = matchVoiceCommand(transcript);

        if (command) {
            voiceToast("success", "Voice Command", `Opening ${command.label}...`);
            setTimeout(() => command.action(), 600);
        } else {
            voiceToast("warning", "Not Recognized", `Didn't catch a known command in "${transcript}"`);
        }
    };

    recognition.onerror = (event) => {
        if (event.error === "not-allowed" || event.error === "service-not-allowed") {
            voiceToast("error", "Microphone Blocked", "Allow microphone access in your browser/app settings to use voice commands.");
        } else if (event.error === "no-speech") {
            voiceToast("warning", "No Speech Detected", "Didn't hear anything — try again.");
        } else {
            voiceToast("error", "Voice Command Error", "Something went wrong — please try again.");
        }
    };

    recognition.onend = () => {
        listening = false;
        micBtn.classList.remove("listening");
    };

    micBtn.addEventListener("click", () => {
        if (listening) {
            recognition.stop();
            return;
        }
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
