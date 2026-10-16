// shared/i18n/settings.js
//
// Strings for the Settings tree: the main list (pages/settings/index.html),
// account.html, fingerprint.html (+ assets/js/settings-fingerprint.js),
// about.html, voicecommand.html. Load alongside shared/i18n/common.js and
// shared/i18n/core.js on every page under pages/settings/.

CMI18n.register({
  // Main Settings list
  "settings.myAccount": { km: "គណនីរបស់ខ្ញុំ", en: "My Account" },
  "settings.fingerprintRow": { km: "ការចូលដោយស្នាមម្រាមដៃ ឬ ផ្ទៃមុខ", en: "Login with Fingerprint or Face" },
  "settings.manageDevicesRow": { km: "គ្រប់គ្រងឧបករណ៍", en: "Manage Devices" },
  "settings.about": { km: "អំពីកម្មវិធី", en: "About" },
  "settings.contactRow": { km: "ទំនាក់ទំនង", en: "Contact" },
  "settings.notification": { km: "ការជូនដំណឹង", en: "Notification" },
  "settings.logout": { km: "ចាកចេញ", en: "Log Out" },
  "settings.logoutConfirm": { km: "តើអ្នកពិតជាចង់ចាកចេញមែនទេ?", en: "Are you sure you want to log out?" },

  // Settings main list — section labels
  "settings.preferencesSectionTitle": { km: "ចំណូលចិត្ត", en: "Preferences" },
  "settings.informationSectionTitle": { km: "ព័ត៌មាន", en: "Information" },

  // Theme / Language accordion rows
  "settings.theme.title": { km: "រូបរាង", en: "Theme" },
  "settings.theme.subtitle": { km: "ជ្រើសរើសរូបរាងកម្មវិធី", en: "Choose app appearance" },
  "settings.theme.auto": { km: "ស្វ័យប្រវត្តិ", en: "Auto" },
  "settings.theme.light": { km: "ភ្លឺ", en: "Light" },
  "settings.theme.dark": { km: "ងងឹត", en: "Dark" },
  "settings.language.title": { km: "ភាសា", en: "Language" },
  "settings.language.subtitle": { km: "ភាសាបង្ហាញកម្មវិធី", en: "App display language" },

  // account.html
  "settings.account.employeeId": { km: "អត្តលេខៈ", en: "Employee ID" },
  "settings.account.role": { km: "តួនាទី", en: "Role" },
  "settings.account.branch": { km: "សាខា", en: "Branch" },
  "settings.account.phone": { km: "លេខទូរស័ព្ទ", en: "Phone Number" },
  "settings.account.unknown": { km: "មិនស្គាល់", en: "Unknown" },

  // Settings main list — "Account" group (fingerprint toggle, change
  // password, change pin, sign out)
  "settings.account.sectionTitle": { km: "គណនី", en: "Account" },
  "settings.account.manageDevices": { km: "គ្រប់គ្រងឧបករណ៍ដែលបានចុះឈ្មោះ", en: "Manage registered devices" },

  // Change Password (bottom sheet, pages/settings/index.html)
  "settings.account.changePassword": { km: "ប្តូរពាក្យសម្ងាត់", en: "Change Password" },
  "settings.account.oldPassword": { km: "ពាក្យសម្ងាត់ចាស់", en: "Old Password" },
  "settings.account.newPassword": { km: "ពាក្យសម្ងាត់ថ្មី", en: "New Password" },
  "settings.account.confirmPassword": { km: "បញ្ជាក់ពាក្យសម្ងាត់", en: "Confirm Password" },
  "settings.account.rule.length": { km: "យ៉ាងតិច ១២ តួអក្សរ", en: "Minimum 12 characters" },
  "settings.account.rule.lowercase": { km: "យ៉ាងតិចមានអក្សរតូចមួយ", en: "At least one lowercase letter" },
  "settings.account.rule.uppercase": { km: "យ៉ាងតិចមានអក្សរធំមួយ", en: "At least one uppercase letter" },
  "settings.account.rule.number": { km: "យ៉ាងតិចមានលេខមួយ", en: "At least one number" },
  "settings.account.rule.special": { km: "យ៉ាងតិចមានតួអក្សរពិសេសមួយ", en: "At least one special character" },
  "settings.account.passwordMismatch": { km: "ពាក្យសម្ងាត់ថ្មី និង ការបញ្ជាក់មិនដូចគ្នាទេ", en: "New password and confirmation do not match" },
  "settings.account.changePasswordSuccess": { km: "បានប្តូរពាក្យសម្ងាត់ដោយជោគជ័យ", en: "Password changed successfully" },
  "settings.account.changePasswordFailed": { km: "ប្តូរពាក្យសម្ងាត់បរាជ័យ", en: "Could not change password" },
  "settings.account.changing": { km: "កំពុងដំណើរការ...", en: "Changing..." },

  // Change Pin (pages/settings/change-pin.html)
  "settings.account.changePin": { km: "ប្តូរកូដ PIN", en: "Change Pin" },
  "settings.account.currentPassword": { km: "ពាក្យសម្ងាត់បច្ចុប្បន្ន", en: "Current Password" },
  "settings.account.newPin": { km: "កូដ PIN ថ្មី", en: "New PIN" },
  "settings.account.confirmPin": { km: "បញ្ជាក់កូដ PIN", en: "Confirm PIN" },
  "settings.account.rule.pinDigits": { km: "ត្រូវតែមាន ៦ ខ្ទង់", en: "Must be 6 digits" },
  "settings.account.rule.pinMatch": { km: "ត្រូវតែដូចគ្នា", en: "Must be the same" },
  "settings.account.changePinSuccess": { km: "បានប្តូរកូដ PIN ដោយជោគជ័យ", en: "PIN changed successfully" },
  "settings.account.changePinFailed": { km: "ប្តូរកូដ PIN បរាជ័យ", en: "Could not change PIN" },

  // Auto-lock (pages/settings/index.html Account section)
  "settings.account.autoLock.title": { km: "ចាក់សោស្វ័យប្រវត្តិ", en: "Auto-lock" },
  "settings.account.autoLock.subtitle": { km: "ចាក់សោកម្មវិធីបន្ទាប់ពីអសកម្ម", en: "Lock the app after inactivity" },
  "settings.account.autoLock.immediate": { km: "ភ្លាមៗពេលចាកចេញ", en: "Immediately" },
  "settings.account.autoLock.1min": { km: "១ នាទី", en: "1 minute" },
  "settings.account.autoLock.5min": { km: "៥ នាទី", en: "5 minutes" },
  "settings.account.autoLock.10min": { km: "១០ នាទី", en: "10 minutes" },
  "settings.account.autoLock.15min": { km: "១៥ នាទី", en: "15 minutes" },

  // fingerprint.html + settings-fingerprint.js
  "settings.fingerprint.title": { km: "ចូលដោយស្នាមម្រាមដៃ ឬ ផ្ទៃមុខ", en: "Fingerprint Login" },
  "settings.fingerprint.introTitle": { km: "ការចូលដោយស្នាមម្រាមដៃ ឬ ផ្ទៃមុខ", en: "Login with Fingerprint or Face" },
  "settings.fingerprint.introText": { km: "ចុះឈ្មោះស្នាមម្រាមដៃ ឬ Face ID លើឧបករណ៍នេះ ដើម្បីចូលប្រើប្រាស់ដោយមិនចាំបាច់វាយពាក្យសម្ងាត់។", en: "Register your fingerprint or Face ID on this device to log in without typing your password." },
  "settings.fingerprint.unsupported": { km: "ឧបករណ៍ ឬកម្មវិធីរុករកនេះ មិនគាំទ្រការចូលដោយស្នាមម្រាមដៃ ឬ ផ្ទៃមុខទេ។", en: "This device or browser doesn't support fingerprint or face login." },
  "settings.fingerprint.addBtn": { km: "បន្ថែមឧបករណ៍នេះ", en: "Add This Device" },
  "settings.fingerprint.registering": { km: "កំពុងចុះឈ្មោះ...", en: "Registering..." },
  "settings.fingerprint.registeredDevices": { km: "ឧបករណ៍ដែលបានចុះឈ្មោះ", en: "Registered Devices" },
  "settings.fingerprint.noDevices": { km: "មិនទាន់មានឧបករណ៍ត្រូវបានចុះឈ្មោះទេ", en: "No devices registered yet" },
  "settings.fingerprint.loadFailed": { km: "មិនអាចផ្ទុកបញ្ជីឧបករណ៍បានទេ", en: "Could not load device list" },
  "settings.fingerprint.addedOn": { km: "បន្ថែមនៅ {date}", en: "Added on {date}" },
  "settings.fingerprint.confirmRemove": { km: "តើអ្នកពិតជាចង់លុបឧបករណ៍នេះមែនទេ?", en: "Are you sure you want to remove this device?" },
  "settings.fingerprint.removeSuccess": { km: "បានលុបដោយជោគជ័យ", en: "Removed successfully" },
  "settings.fingerprint.removeFailed": { km: "លុបបរាជ័យ", en: "Remove failed" },
  "settings.fingerprint.namePrompt": { km: "ដាក់ឈ្មោះឧបករណ៍នេះ (ឧ. iPhone របស់ខ្ញុំ)", en: "Name this device (e.g. My iPhone)" },
  "settings.fingerprint.registerSuccess": { km: "បានចុះឈ្មោះស្នាមម្រាមដៃ ឬ ផ្ទៃមុខដោយជោគជ័យ", en: "Fingerprint or Face registered successfully" },
  "settings.fingerprint.quickDisableSuccess": { km: "បានបិទការចូលដោយស្នាមម្រាមដៃ ឬ ផ្ទៃមុខនៅលើឧបករណ៍នេះ (ព័ត៌មានចុះឈ្មោះនៅតែរក្សាទុក)", en: "Fingerprint/Face login turned off on this device (registration kept)" },
  "settings.fingerprint.quickEnableSuccess": { km: "បានបើកការចូលដោយស្នាមម្រាមដៃ ឬ ផ្ទៃមុខឡើងវិញ", en: "Fingerprint/Face login turned back on" },
  "settings.fingerprint.registerFailed": { km: "ចុះឈ្មោះបរាជ័យ", en: "Registration failed" },

  // fingerprint.html — Reset All Fingerprints
  "settings.fingerprint.deviceCount": { km: "ឧបករណ៍ដែលបានចុះឈ្មោះ: {n}", en: "{n} device(s) registered" },
  "settings.fingerprint.resetAllBtn": { km: "លុបការចុះឈ្មោះស្នាមម្រាមដៃទាំងអស់", en: "Reset All Fingerprints" },
  "settings.fingerprint.resetAllTitle": { km: "លុបការចុះឈ្មោះស្នាមម្រាមដៃទាំងអស់?", en: "Reset All Fingerprint Registrations?" },
  "settings.fingerprint.resetAllWarning": { km: "សកម្មភាពនេះនឹងលុបឧបករណ៍ដែលបានចុះឈ្មោះទាំងអស់ចេញពីគណនីរបស់អ្នក។ សកម្មភាពនេះមិនអាចត្រឡប់វិញបានទេ។", en: "This will remove every registered device from your account. This cannot be undone." },
  "settings.fingerprint.resetAllAuthHint": { km: "សូមបញ្ចូលពាក្យសម្ងាត់ ឬ លេខកូដ PIN ៦ខ្ទង់ ដើម្បីបញ្ជាក់អត្តសញ្ញាណ", en: "Enter your password or your 6-digit PIN to confirm your identity" },
  "settings.fingerprint.resetAllPasswordPlaceholder": { km: "ពាក្យសម្ងាត់", en: "Password" },
  "settings.fingerprint.resetAllOr": { km: "ឬ", en: "OR" },
  "settings.fingerprint.resetAllPinPlaceholder": { km: "លេខកូដ PIN ៦ខ្ទង់", en: "6-digit PIN" },
  "settings.fingerprint.resetAllConfirmBtn": { km: "លុបទាំងអស់", en: "Reset All" },
  "settings.fingerprint.resetAllMissingCreds": { km: "សូមបញ្ចូលពាក្យសម្ងាត់ ឬ លេខកូដ PIN", en: "Please enter your password or PIN" },
  "settings.fingerprint.resetAllSuccess": { km: "បានលុបឧបករណ៍ទាំងអស់នៅលើ Server ដោយជោគជ័យ", en: "All devices removed from the server successfully" },
  "settings.fingerprint.resetAllFailed": { km: "លុបបរាជ័យ", en: "Reset failed" },
  "settings.fingerprint.resetAllCleanupNotice": { km: "ប្រសិនបើអ្នកធ្លាប់រក្សាទុក Passkey ចាស់នៅលើទូរស័ព្ទនេះ សូមចូលទៅកាន់ Settings → Passwords លើទូរស័ព្ទរបស់អ្នក ហើយលុបវាដោយដៃផងដែរ — ជំហាននេះមិនអាចធ្វើពីគេហទំព័រនេះបានទេ។", en: "If you previously saved a passkey on this phone, please also go to Settings → Passwords on your device and delete it manually — that step can't be done from this website." },

  // about.html
  "settings.about.sectionAbout": { km: "អំពីកម្មវិធី", en: "About the App" },
  "settings.about.sectionAboutBody": {
    km: "CM_Pro គឺជាប្រព័ន្ធតាមដានឥណទាន (Credit Monitoring System) ដែលត្រូវបានបង្កើតឡើងសម្រាប់បុគ្គលិកឥណទានរបស់ ACLEDA Bank ដើម្បីស្វែងរកព័ត៌មានអតិថិជន តាមដានបំណុលយឺត ពិនិត្យ Average Turnover, Spot Check និងព័ត៌មានឥណទានផ្សេងៗបានគ្រប់ពេលវេលា និងគ្រប់ទីកន្លែង។",
    en: "CM_Pro is a Credit Monitoring System built for ACLEDA Bank's credit officers to search customer information, track overdue loans, review Average Turnover and Spot Check data, and access other credit information anytime, anywhere."
  },
  "settings.about.sectionTerms": { km: "លក្ខខណ្ឌប្រើប្រាស់", en: "Terms of Use" },
  "settings.about.sectionTermsBody": {
    km: "CM_Pro ប្រើប្រាស់ព័ត៌មានអ្នកប្រើប្រាស់ ដូចជា ឈ្មោះ អត្តលេខ និងសិទ្ធិប្រើប្រាស់ សម្រាប់ការផ្ទៀងផ្ទាត់អត្តសញ្ញាណ ការកំណត់សិទ្ធិប្រើប្រាស់ និងការពារសុវត្ថិភាពប្រព័ន្ធ។ ព័ត៌មានទាំងអស់ត្រូវបានរក្សាទុក និងបញ្ជូនដោយសុវត្ថិភាព។",
    en: "CM_Pro uses user information such as name, employee ID and access rights for identity verification, access control, and system security. All information is stored and transmitted securely."
  },
  "settings.about.sectionVersion": { km: "ប្រវត្តិកំណែ", en: "Version History" },
  "settings.about.versionPrefix": { km: "កំណែ", en: "Version" },
  "settings.about.noVersionInfo": { km: "មិនទាន់មានព័ត៌មានអំពីកំណែ", en: "No version info available yet" },
  "settings.about.defaultReleaseNotes": { km: "សូមធ្វើបច្ចុប្បន្នភាពទៅកំណែចុងក្រោយ ដើម្បីទទួលបានមុខងារថ្មីៗ ការកែលម្អប្រសិទ្ធភាព និងការជួសជុលបញ្ហាផ្សេងៗ។", en: "Please update to the latest version for new features, performance improvements, and bug fixes." },
  "settings.about.versionLoadFailed": { km: "មិនអាចទាញយកព័ត៌មាន Version បាន។", en: "Could not load version information." },

  // contact.html
  "settings.contact.branchName": { km: "ធនាគារ ACLEDA សាខាខេត្តស្វាយរៀង", en: "ACLEDA Bank Svay Rieng Branch" },
  "settings.contact.roleSenior": { km: "ប្រធានក្រុមឥណទានសាខា", en: "Senior Branch Credit Manager" },
  "settings.contact.roleAssistant": { km: "ជំនួយការប្រធានឥណទានសាខា", en: "Assistant Branch Credit Manager" },
  "settings.contact.telegramTitle": { km: "ទាក់ទងតាម Telegram", en: "Contact Us via Telegram" },

  // voicecommand.html
  "settings.voice.cardTitle": { km: "ពាក្យបញ្ជាសំឡេង", en: "Voice Command" },
  "settings.voice.whatIsTitle": { km: "តើពាក្យបញ្ជាសំឡេងជាអ្វី?", en: "What is voice command?" },
  "settings.voice.whatIsBody": {
    km: "ពាក្យបញ្ជាសំឡេងនៅក្នុង CM_Pro គឺជាវិធីផ្លាស់ទីក្នុងកម្មវិធីដោយមិនប្រើដៃ។ ចុចមីក្រូហ្វូននៅទំព័រដើម ហើយនិយាយពាក្យបញ្ជា ដូចជា <b>\"Open Daily Arrears\"</b> ឬ <b>\"Switch to Dark Mode\"</b> ហើយកម្មវិធីនឹងបើកទំព័រ ឬផ្លាស់ប្តូររូបរាងនោះឱ្យអ្នក។",
    en: "Voice commands in CM_Pro are a hands-free way to move around the app. Tap the microphone on the Home page and speak a command, such as <b>\"Open Daily Arrears\"</b> or <b>\"Switch to Dark Mode\"</b>, and the app opens that page or applies that theme for you."
  },
  "settings.voice.whatYouCanSay": { km: "អ្វីដែលអ្នកអាចនិយាយ", en: "What you can say" },
  "settings.voice.openPage": { km: "I. បើកទំព័រ", en: "I. Open a page" },
  "settings.voice.openPageList": {
    km: `<li>បើក <b>ស្វែងរកអតិថិជន</b></li>
<li>បើក <b>ការយឺតយ៉ាវប្រចាំថ្ងៃ</b></li>
<li>បើក <b>ការបង្វិលជុំមធ្យម</b></li>
<li>បើក <b>ត្រួតពិនិត្យភ្លាមៗ</b></li>
<li>បើក <b>កិច្ចការមន្ត្រី</b></li>
<li>បើក <b>របាយការណ៍ឥណទាន</b></li>
<li>បើក <b>គណនាឥណទាន</b></li>
<li>បើក <b>និវត្តន៍</b></li>
<li>បើក <b>ការជូនដំណឹង</b></li>
<li>បើក <b>ការកំណត់</b></li>
<li>បើក <b>ទំព័រដើម</b></li>`,
    en: `<li>Open <b>Customer Search</b></li>
<li>Open <b>Daily Arrears</b></li>
<li>Open <b>Average Turnover</b></li>
<li>Open <b>Spot Check</b></li>
<li>Open <b>Officer Task</b></li>
<li>Open <b>Credit Report</b></li>
<li>Open <b>Loan Calculate</b></li>
<li>Open <b>Retirement</b></li>
<li>Open <b>Notification</b></li>
<li>Open <b>Setting</b></li>
<li>Open <b>Home</b></li>`
  },
  "settings.voice.changeTheme": { km: "II. ប្តូររូបរាងកម្មវិធី", en: "II. Change the app theme" },
  "settings.voice.themeList": {
    km: `<li>ប្តូរទៅ <b>រូបរាងភ្លឺ</b></li>
<li>ប្តូរទៅ <b>រូបរាងងងឹត</b></li>
<li>ប្តូរទៅ <b>រូបរាងស្វ័យប្រវត្តិ</b></li>`,
    en: `<li>Switch to <b>Light Mode</b></li>
<li>Switch to <b>Dark Mode</b></li>
<li>Switch to <b>Auto Mode</b></li>`
  },
  "settings.voice.conclusion": { km: "សេចក្តីសន្និដ្ឋាន", en: "Conclusion" },
  "settings.voice.conclusionBody": {
    km: "បច្ចុប្បន្ននេះ ពាក្យបញ្ជាសំឡេងអាចប្រើបានតែសម្រាប់បើកទំព័រ និងប្តូររូបរាងកម្មវិធីប៉ុណ្ណោះ។ យើងកំពុងបន្តពង្រីកដែលគាំទ្រ និងកែលម្អភាពត្រឹមត្រូវនៃការសម្គាល់សំឡេងជាបន្តបន្ទាប់។",
    en: "Voice commands are currently limited to opening pages and switching themes. We're continuing to expand the range of supported commands and improve recognition accuracy over time."
  },
  "settings.voice.gotIt": { km: "យល់ព្រម", en: "Ok, got it" }
});
