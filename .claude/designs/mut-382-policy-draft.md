# MUT-382 — English text for Basel's approval

Draft of 2026-10-26. Approve the English, and the Arabic is then translated from it (meaning-equal, not fresh copy).
Facts behind every sentence: `.claude/designs/mut-382-policy-checklist.md`.

## Answers (Basel, 2026-10-26): text approved as drafted

1. **Mailbox provider:** info@mtb3a.com is a Microsoft account. The policy says "kept by Microsoft, which hosts our mailbox".
2. **Old free apps:** `/download` and the Mac/Windows desktop apps are removed; only iOS, Android and the web are supported. The policy names no free app.
3. **Dates:** "Last updated October 26, 2026", and terms version `2026-10-26`.
4. **Terms §2:** yes, the new version says you can create your account yourself.
5. **Sentry:** `scripts/sentry-org-settings.ts --check` reports the org's privacy settings match.

## Privacy policy: changed sections

### Updated date

**Was:**

> Last updated October 24, 2026

**Now:**

> Last updated October 26, 2026

### Where your records live

**Was:**

> Your account (the web portal, and the iPhone and Android apps when you're signed in) keeps your records on MTB3A's servers in Google Cloud's Tel Aviv region (me-west1). We back them up every day and keep each backup for 14 days, and we can restore your records to any moment in the last 7 days. When something breaks, an error report goes to Sentry in the EU with the content of your records removed. Usage counts go to PostHog in the EU only if you agree. Our team opens your records only when you ask us to help, to fix a fault, or when the law requires it. When you close your account, we delete it and its records after 30 days, including the record that you accepted our terms, and our backups clear 14 days later. Accounts are also covered by our terms of service.

**Now:**

> Your account (the web portal, and the iPhone and Android apps when you're signed in) keeps your records on MTB3A's servers in Google Cloud's Tel Aviv region (me-west1), and our daily backups stay there too. We keep each backup for 14 days, and we can restore your records to any moment in the last 7 days. Google Cloud encrypts your records, receipts and backups where they are stored, and our servers reach the database only over encrypted connections. Our servers' technical logs are kept by Google Cloud for 30 days, and may be stored outside the Tel Aviv region. With your account we also keep, for each place you're signed in, a shortened description of your browser or app (never your IP address); for each passkey you add, its public key and identifier, never your fingerprint or face; and for each email we send you, a scrambled form of your address and whether it arrived, for 30 days. MTB3A is run by a small team, and the people who run it can technically reach your data. We look at your records only when you ask us to help, to fix a fault, or when the law requires it, and changes made with our admin tools are logged. Error reports go to Sentry in the EU, as described under "Error reports". Usage counts from the portal and the apps go to PostHog in the EU only if you agree; our website counts visits anonymously, as described under "Anonymous usage counts". What happens when you close your account is described under "Deleting your account and data". Accounts are also covered by our terms of service.

### Emails we send

**Was:**

> We email you only about your account: the link to finish creating it or to set a new password, a reminder that you already have an account if you try to sign up again, a notice when your password changes, a notice that we're reviewing your sign-up and then its outcome, and notices that your free trial is ending, that your account has become read-only, or that it will lock. Our emails never include amounts or your records, and we don't track whether you open them or click their links. We send them through Resend, which receives your email address, the message and what happens to it (for example, that it was delivered or bounced). Resend sends our emails from the EU (Ireland) and keeps its records of them, including your email address and their delivery, in the United States, under its data processing agreement with us. If an email to you bounces permanently or you mark it as spam, we stop emailing that address, and we keep the address on our do-not-email list so it stays that way.

**Now:**

> We email you only about your account: the link to finish creating it or to set a new password, a reminder that you already have an account if you try to sign up again, a notice when your password changes or a passkey is added to your account, a notice that we're reviewing your sign-up and then its outcome, notices that your free trial is ending, that your account has become read-only, or that it will lock, and, when you close your account, a notice with the day it will be deleted. Our emails never include amounts or your records, and we don't track whether you open them or click their links. We send them through Resend, which receives your email address, the message and what happens to it (for example, that it was delivered or bounced). Resend sends our emails from the EU (Ireland) and keeps its records of them, including your email address and their delivery, in the United States, under its data processing agreement with us. If an email to you bounces permanently or you mark it as spam, we stop emailing that address, and we keep the address on our do-not-email list so it stays that way.

### Who else handles your data

**Was:**

> We don't sell your data or share it with advertisers. Our servers and receipt storage run on Google Cloud, which processes the data only to host it for us. Cloudflare carries the connections between you and our hosted portal and servers, and runs the Turnstile check described under "When you create an account". Resend sends our emails, as described under "Emails we send". Sentry, hosted in the EU, receives the error reports described under "Error reports" and stores them for us. Our website runs on Netlify, which receives the account-request form and checks each request for spam with Akismet (made by Automattic). PostHog, hosted in the EU, processes the anonymous usage counts described under "Anonymous usage counts" for us. If your organization has linked its business profiles to Malafat, the records in those profiles are shared between Malafat and MTB3A. Beyond that, we disclose data only when the law requires it.

**Now:**

> We don't sell your data or share it with advertisers. Our servers and receipt storage run on Google Cloud, which processes the data only to host it for us. Cloudflare carries the connections between you and our hosted portal and servers, and runs the Turnstile check described under "When you create an account". Resend sends our emails, as described under "Emails we send". Stripe handles payments: when you subscribe, it receives your name, your email address and a random internal ID for your account, and you type your card and billing details on Stripe's own checkout page, so they never reach our servers. Sentry, hosted in the EU, receives the error reports described under "Error reports" and stores them for us. Our website runs on Netlify, which receives the account-request form and checks each request for spam with Akismet (made by Automattic). PostHog, hosted in the EU, processes the anonymous usage counts described under "Anonymous usage counts" for us. Emails you send to info@mtb3a.com are kept by Microsoft, which hosts our mailbox. Business profiles we set up for an organization that uses Malafat share their records with Malafat; profiles you create yourself never do. Beyond that, we disclose data only when the law requires it.

### Keeping the mobile apps secure

**Was:**

> Your password is stored on our servers only as a secure hash, and never on your phone. Your sign-in session is kept in the iPhone Keychain or in Android's encrypted storage. You can turn on App Lock so opening the app needs Face ID, Touch ID, your fingerprint, or your device passcode. That check happens on your device, and MTB3A never receives your biometric data. The mobile apps don't use your camera, contacts, or location, and they only see a photo or file when you choose to share it into the app.

**Now:**

> Your password is stored on our servers only as a secure hash, and never on your phone. Your sign-in session is kept in the iPhone Keychain or in Android's encrypted storage. On your phone, the app's records are protected by your phone's own encryption, and from version 0.1.13 they're left out of iCloud and Google backups. You can turn on App Lock so opening the app needs Face ID, Touch ID, your fingerprint, or your device passcode. That check happens on your device, and MTB3A never receives your biometric data. The mobile apps don't use your camera, contacts, or location, and they only see a photo or file when you choose to share it into the app.

### No ads, no tracking

**Was:**

> None of MTB3A's apps use advertising or tracking that follows you across sites or apps. Our website, our servers, the hosted portal, and the iPhone and Android apps send error reports when something breaks, as described under "Error reports". The free apps on Mac, Windows, and in the browser never send them. The anonymous usage counts we do keep are described under "Anonymous usage counts". Our servers keep standard technical logs (such as when a request arrived, its IP address, and whether it succeeded) so we can run the service. We don't use them to profile you.

**Now:**

> None of MTB3A's apps use advertising or tracking that follows you across sites or apps. Our website, our servers, the hosted portal, and the iPhone and Android apps send error reports when something breaks, as described under "Error reports". The anonymous usage counts we do keep are described under "Anonymous usage counts". Our servers keep technical logs for 30 days (when a request arrived, what it asked for, and whether it succeeded) so we can run the service. Our own log lines never include your IP address. Google Cloud's record of each request includes the address that connected, which is usually Cloudflare's rather than yours. Our servers use your IP address only briefly, in memory, to slow down repeated attempts such as wrong passwords, and pass it to Cloudflare Turnstile for the check described under "When you create an account". We don't use any of this to profile you.

### Anonymous usage counts

**Was:**

> Where we count usage, we use PostHog, hosted in the EU. We never send amounts, names, notes, contact details, your location, or anything you type, and nothing we send is linked to your account. Our website counts page visits and which buttons are pressed, without cookies and without storing anything on your device. To tell visits apart for a single day, PostHog combines your IP address and browser details into a code that changes every day and keeps neither, so a visit can't be linked to you or to visits on other days. The hosted portal asks you once whether you want to share anonymous usage, and it's off unless you turn it on. If you do, it sends a short note when you turn it on (saying whether you did so from the prompt or the account menu), each time you open the portal, each time you save an income, an expense or a payment received, and when it shows the free trial's reminder to add a card and whether you chose to add one or not. A note says only which of these it was, its currency, for an income whether it was already paid, and for the trial reminder whether it showed when you first signed in or on your Home page, along with the portal's version and its analytics library's version, its language, your browser's type, your device's operating system and its version, and whether it's a computer, tablet, or phone. Notes are sent under a random ID kept only in your browser, not linked to your account, and replaced when you sign out. If you turn it off from the account menu, we send one last note saying you turned it off, then stop and delete the random ID. The iPhone and Android apps ask you once whether you want to share anonymous usage, and it's off unless you turn it on. If you do, they send a short note each time you turn it on (saying whether you did so from the prompt or Settings), once more the first time you turn it on after signing in, and each time you add a client or save an income or an expense. A note says only which of these it was, its currency, and for an income whether it was already paid, along with the app's version and its analytics library's version, its language, your phone's operating system and its version, and whether it's a phone or a tablet. Notes are sent under a random ID kept only on your phone, not linked to your account, and replaced when you sign out. If you turn it off in Settings, we send one last note saying you turned it off, then stop and delete the random ID. These counts are used only to understand which parts of MTB3A people use. They're never used for advertising, and no one but PostHog, which processes them for us, receives them.

**Now:**

> Where we count usage, we use PostHog, hosted in the EU. We never send amounts, names, notes, contact details, your location, or anything you type, and nothing we send is linked to your account. Our website counts page visits and which buttons are pressed, without cookies and without storing anything on your device. With each count it sends the page's address, the page you came from, any campaign tags in the link (such as utm_source), and whether you're on a computer, tablet or phone. To tell visits apart for a single day, PostHog combines your IP address and browser details into a code that changes every day and keeps neither, so a visit can't be linked to you or to visits on other days. The hosted portal asks you once whether you want to share anonymous usage, and it's off unless you turn it on. If you do, it sends a short note when you turn it on (saying whether you did so from the prompt or the account menu), each time you open the portal, each time you save an income, an expense or a payment received, and when it shows the free trial's reminder to add a card and whether you chose to add one or not. A note says only which of these it was, its currency, for an income whether it was already paid, and for the trial reminder whether it showed when you first signed in or on your Home page, along with the portal's version and its analytics library's version, its language, your browser's type, your device's operating system and its version, and whether it's a computer, tablet, or phone. Notes are sent under a random ID kept only in your browser, not linked to your account, and replaced when you sign out. If you turn it off from the account menu, we send one last note saying you turned it off, then stop and delete the random ID. The iPhone and Android apps ask you once whether you want to share anonymous usage, and it's off unless you turn it on. If you do, they send a short note each time you turn it on (saying whether you did so from the prompt or Settings), once more the first time you turn it on after signing in, and each time you add a client or save an income or an expense. A note says only which of these it was, its currency, and for an income whether it was already paid, along with the app's version and its analytics library's version, its language, your phone's operating system and its version, and whether it's a phone or a tablet. Notes are sent under a random ID kept only on your phone, not linked to your account, and replaced when you sign out. If you turn it off in Settings, we send one last note saying you turned it off, then stop and delete the random ID. These counts are used only to understand which parts of MTB3A people use. They're never used for advertising, and no one but PostHog, which processes them for us, receives them.

### Error reports

**Was:**

> When something breaks, we want to know before you have to tell us. An error report says where in our code the problem happened, which version you were using, your language, and your device's operating system, browser, and model. It never includes amounts, names, notes, contact details, request contents, your IP address, or anything you type. If a report includes an account at all, it is a random internal ID. Reports are stored by Sentry in the EU. Our servers send a report when a request fails on our side, and the hosted portal sends one when a page crashes in your browser. Our website sends a report when one of its pages crashes or hits an error. The website's reports include no account at all, and the free web app you open from the website never sends one. The iPhone and Android apps send a report when the app crashes or hits an error it can't recover from. They never attach screenshots or what's on your screen.

**Now:**

> When something breaks, we want to know before you have to tell us. An error report says where in our code the problem happened, which version you were using, your language, and your device's operating system, browser, and model. Before a report is sent, we remove amounts, names, notes, contact details, request contents, your IP address, and anything you type. When the iPhone or Android app itself crashes, Sentry's own scrubbing removes them instead, because the app can't edit that report first. If a report includes an account at all, it is a random internal ID. Reports are stored by Sentry in the EU. Our servers send a report when a request fails on our side, and the hosted portal sends one when a page crashes in your browser. Our website sends a report when one of its pages crashes or hits an error. The website's reports include no account at all. The iPhone and Android apps send a report when the app crashes or hits an error it can't recover from, and so do the iPhone app's share extension, widgets and Siri shortcuts. They never attach screenshots or what's on your screen.

### Deleting your account and data

**Was:**

> You can delete individual entries in the mobile apps. To delete your whole account and everything stored with it, email info@malafat.app from your account's email address, and we'll do it within 30 days. Records in a business profile that belongs to your organization are your organization's, so we handle those together with them. Copies in our backups expire within 14 days of deletion. Signing out and uninstalling the mobile app removes MTB3A's data from your phone.

**Now:**

> You can delete individual entries at any time. To delete your whole account, choose Close my account: in the web portal under You › Account, or in the iPhone and Android apps on the Account tab. For 30 days you can sign in and keep your account; after that, we delete it. A business profile you share with someone who also owns it passes to them. If other people work in it and none of them is an owner, make one of them an owner, or remove them, before you close your account. We delete your account, the profiles you own with every record and receipt in them, your sign-ins and passkeys, the record that you accepted our terms, and your customer record at Stripe. On profiles that stay because you didn't own them, the records you added stay, without your name. We keep: in those profiles' history, a note that a removed account (a random internal ID, never your name or email) was deleted; at Stripe, the invoices for what you paid, which tax law requires us to keep; your address on our do-not-email list, if you asked us to stop emailing it; for up to 30 days, our email log and our servers' logs, which hold the internal ID or a scrambled form of your address; error reports with the internal ID, until Sentry's retention ends; Resend's records of the emails we sent you; and, if you sent our website's request form or wrote to us, your message, until we delete it within 12 months. Deleted receipt files can be recovered for 14 days, and copies in our backups clear 14 days after deletion. Signing out of the mobile app ends your session. On iPhone, the app's sign-in record can stay in the Keychain until you reinstall the app. Copies of the app's data in iCloud or Google backups made before version 0.1.13 can remain until those backups are replaced.

### When you ask for an account

**Was:**

> If you send the request form on our website, Netlify, which hosts the website, receives what you type: your name, your email and anything else you choose to add, plus the language the page was in and a random request number. Netlify also records technical details such as your IP address and browser, and checks the request for spam with Akismet. Netlify then emails it to us. We use it only to reply with an offer and, if you go ahead, to set up your account. We delete requests within 12 months; write to info@malafat.app and we'll delete yours sooner.

**Now:**

> If you send the request form on our website, Netlify, which hosts the website, receives what you type: your name, your email and anything else you choose to add, plus the language the page was in and a random request number. Netlify also records technical details such as your IP address and browser, and checks the request for spam with Akismet. Netlify then emails it to us. We use it only to reply with an offer and, if you go ahead, to set up your account. We delete requests within 12 months; write to info@mtb3a.com and we'll delete yours sooner.

### Contact

**Was:**

> Questions about this policy can be sent to info@malafat.app. MTB3A is made by Barmajiyat Ltd.

**Now:**

> Questions about this policy can be sent to info@mtb3a.com. MTB3A is made by Barmajiyat Ltd.

## Terms of service: new version 2026-10-26 (changed parts only)

### Intro

**Now:** These terms are the agreement between you and Barmajiyat Ltd, a company registered in England and Wales ("we"), for using a Mutaba3a hosted account: the web portal and the iPhone and Android apps when you are signed in.

(Drops: "The free app that keeps everything on your own device is covered by our privacy policy, not by these terms.")

### 2. Your account, first paragraph

**Was:** We set up your account and send you a link to choose your password. Keep your password to yourself…

**Now:** You create your account yourself on the web portal, or we set it up for you; either way, you choose your password through a link we email you. Keep your password to yourself: you are responsible for what is done with your account. If you think someone else has used it, tell us straight away.

### 5. Closing your account

**Was:** You can close your account at any time by writing to us. You then have 30 days to change your mind. After that we delete your account and its records, including the record that you accepted these terms. Our backups clear 14 days after that.

**Now:** You can close your account yourself at any time with Close my account: in the web portal under You › Account, or in the iPhone and Android apps on the Account tab. You then have 30 days to change your mind and keep it. After that we delete your account, the profiles you own with every record in them, and the record that you accepted these terms. Profiles you share with others stay with them, and what you added stays without your name. A few things are kept after that, such as the invoices that tax law requires us to keep; our privacy policy lists them. Our backups clear 14 days after deletion.

(Second paragraph unchanged: download your records first.)

### 12. Contact

**Now:** Write to us at info@mtb3a.com. We reply within 2 working days.

## Portal and phone: Close my account

**Was:** Your account and everything in it will be deleted 30 days from now.

**Now:** Your account will be deleted 30 days from now, with the profiles you own and everything in them.

(The screen's Deleted and Kept lists below that line were already accurate.)
