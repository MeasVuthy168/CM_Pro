// shared/i18n/core.js
//
// Strings shared by the shell every page loads: bottom nav, topbar,
// the Home dashboard (cards, greeting, voice command sheet), and the
// login page. Load alongside shared/i18n/common.js on every page.

CMI18n.register({
  // Bottom nav
  "nav.home": { km: "ទំព័រដើម", en: "Home" },
  "nav.setting": { km: "ការកំណត់", en: "Setting" },
  "nav.notification": { km: "ការជូនដំណឹង", en: "Notification" },

  // Topbar
  "topbar.action": { km: "សកម្មភាព", en: "Action" },

  // Dashboard cards
  "dashboard.customerSearch": { km: "ស្វែងរកអតិថិជន", en: "Customer Search" },
  "dashboard.dailyArrears": { km: "ការយឺតយ៉ាវប្រចាំថ្ងៃ", en: "Daily Arrears" },
  "dashboard.averageTurnover": { km: "ការបង្វិលជុំមធ្យម", en: "Average Turnover" },
  "dashboard.spotCheck": { km: "ត្រួតពិនិត្យភ្លាមៗ", en: "Spot Check" },
  "dashboard.officerTask": { km: "កិច្ចការមន្ត្រី", en: "Officer Task" },
  "dashboard.landClassification": { km: "ចំណាត់ថ្នាក់ដីធ្លី", en: "Land Classification" },
  "dashboard.creditReport": { km: "របាយការណ៍ឥណទាន", en: "Credit Report" },
  "dashboard.loanCalculator": { km: "គណនាឥណទាន", en: "Loan Calculator" },
  "dashboard.retirementLeft": { km: "ចំនួនខែចូលនិវត្តន៍", en: "Retirement Left" },

  // Dashboard assistant box (greeting / update banner) — see assets/js/assistant-box.js
  "dashboard.greeting.morning": { km: "អរុណសួស្តី {name}", en: "Good Morning {name}" },
  "dashboard.greeting.afternoon": { km: "ទិវាសួស្តី {name}", en: "Good Afternoon {name}" },
  "dashboard.greeting.evening": { km: "សាយណ្ហសួស្តី {name}", en: "Good Evening {name}" },
  "dashboard.defaultUser": { km: "អ្នកប្រើប្រាស់", en: "User" },
  "dashboard.update.badge": { km: "ថ្មី", en: "NEW" },
  "dashboard.update.version": { km: "កំណែថ្មី Version {v} មកដល់ហើយ!", en: "New Version {v} is available!" },
  "dashboard.update.highlights": { km: "សូមចូលទៅ Download កំណែថ្មីក្នុងកម្មវិធី Excel ឈ្មោះ SVG Credit Monitoring", en: "Please download the new version in the Excel add-in named SVG Credit Monitoring" },
  "dashboard.update.cta": { km: "ចុចមើលព័ត៌មានកំណែថ្មី", en: "Tap to see what's new" },
  "dashboard.update.dismissAria": { km: "បិទការជូនដំណឹងកំណែថ្មី", en: "Dismiss update notice" },

  // Voice command sheet (assets/js/voice-command.js, index.html)
  "voice.greeting": { km: "សួស្តី {name}", en: "Hi {name}," },
  "voice.greetingNoName": { km: "សួស្តី,", en: "Hi," },
  "voice.prompt": { km: "តើខ្ញុំអាចជួយអ្វីបាន?", en: "What can I do for you?" },
  "voice.hint": { km: "សាកល្បងនិយាយថា \"Open Customer Search\"", en: "Try saying \"Open Customer Search\"" },
  "voice.stopAria": { km: "បញ្ឈប់ការស្តាប់", en: "Stop listening" },
  "voice.notFound": { km: "រកមិនឃើញពាក្យបញ្ជា", en: "Voice command not found" },
  "voice.help": { km: "ជំនួយ", en: "HELP" },
  "voice.micBlocked": { km: "មីក្រូហ្វូនត្រូវបានទប់ស្កាត់", en: "Microphone access blocked" },
  "voice.noSpeech": { km: "មិនបានឮអ្វីទេ", en: "Didn't hear anything" },
  "voice.genericError": { km: "មានបញ្ហាកើតឡើង", en: "Something went wrong" },
  "voice.startFailed": { km: "មិនអាចចាប់ផ្តើមស្តាប់បានទេ", en: "Couldn't start listening" },

  // Login page
  "login.title": { km: "ត្រួតពិនិត្យ​ឥណទានស្វាយរៀង​", en: "Svay Rieng Credit Monitoring" },
  "login.subtitle": { km: "ប្រព័ន្ធត្រួតពិនិត្យឥណទាន SVG", en: "SVG Credit Monitoring System" },
  "login.usernamePlaceholder": { km: "ឈ្មោះអ្នកប្រើប្រាស់", en: "Username" },
  "login.passwordPlaceholder": { km: "ពាក្យសម្ងាត់", en: "Password" },
  "login.show": { km: "បង្ហាញ", en: "Show" },
  "login.hide": { km: "លាក់", en: "Hide" },
  "login.rememberMe": { km: "ចងចាំខ្ញុំ", en: "Remember Me" },
  "login.submit": { km: "ចូលប្រើប្រាស់", en: "Log In" },
  "login.fingerprint": { km: "👆 ចូលដោយស្នាមម្រាមដៃ ឬ ផ្ទៃមុខ", en: "👆 Login with Fingerprint or Face" },
  "login.installTitle": { km: "📲 ដំឡើង CM_Pro", en: "📲 Install CM_Pro" },
  "login.installText": { km: "ចុច <b>Share</b> បន្ទាប់មក <b>Add to Home Screen</b>", en: "Tap <b>Share</b> then <b>Add to Home Screen</b>" },
  "login.installOk": { km: "យល់ព្រម", en: "OK" },
  "login.msg.missingFields": { km: "សូមបញ្ចូលឈ្មោះអ្នកប្រើប្រាស់/ពាក្យសម្ងាត់", en: "Please enter username/password" },
  "login.msg.loginFailed": { km: "ការចូលប្រើប្រាស់បានបរាជ័យ", en: "Login failed" },
  "login.msg.success": { km: "ចូលប្រើប្រាស់ជោគជ័យ", en: "Login successful" },
  "login.msg.cannotConnect": { km: "មិនអាចភ្ជាប់ទៅម៉ាស៊ីនមេបានទេ", en: "Cannot connect to server" },
  "login.msg.enterUsernameFirst": { km: "សូមវាយបញ្ចូល Username មុនសិន", en: "Please enter your Username first" },
  "login.msg.fingerprintFailed": { km: "ការចូលដោយស្នាមម្រាមដៃ ឬ ផ្ទៃមុខបានបរាជ័យ", en: "Fingerprint or Face login failed" },

  // WebAuthn (shared by login.html and pages/settings/fingerprint.html)
  "webauthn.registerStartFailed": { km: "មិនអាចចាប់ផ្តើមការចុះឈ្មោះបានទេ។", en: "Could not start registration." },
  "webauthn.registerFailed": { km: "ការចុះឈ្មោះបានបរាជ័យ។", en: "Registration failed." },
  "webauthn.verifyFailed": { km: "មិនអាចផ្ទៀងផ្ទាត់ការចុះឈ្មោះបានទេ។", en: "Could not verify registration." },
  "webauthn.loadDevicesFailed": { km: "មិនអាចផ្ទុកឧបករណ៍ដែលបានចុះឈ្មោះបានទេ។", en: "Could not load registered devices." },
  "webauthn.removeDeviceFailed": { km: "មិនអាចលុបឧបករណ៍បានទេ។", en: "Could not remove device." },
  "webauthn.noFingerprint": { km: "គណនីនេះមិនទាន់បានចុះឈ្មោះស្នាមម្រាមដៃទេ។", en: "No fingerprint registered for this account." },
  "webauthn.loginFailed": { km: "ការចូលប្រើប្រាស់បានបរាជ័យ។", en: "Login failed." },
  "webauthn.cancelled": { km: "បានបោះបង់ ឬអស់ម៉ោង។", en: "Cancelled or timed out." }
});
