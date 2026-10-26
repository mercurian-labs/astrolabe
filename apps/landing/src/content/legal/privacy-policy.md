---
title: Privacy Policy
description: What Astrolabe and Mercurian's hosted services collect, where it goes, how long it stays, and what you control.
updated: October 23, 2026
---

**Effective date:** [DECISION: effective date, proposed: the day the hosted services open to the public]

## The short version

- Astrolabe is an app that runs on your own computer. Your projects, threads and code stay there. They leave it only through the features listed in section 3, and most of those send data to services you choose, not to Mercurian.
- Your prompts and code go to the AI provider you choose, under your own account with that provider and that provider's terms. They go straight from your machine to the provider, not through us.
- If you create a Mercurian account, we keep your profile, your sign-in details and your workspace memberships so we can run the account.
- Remote access carries your sessions through Cloudflare's network. Cloudflare can technically access that traffic while it passes through. We don't store it.
- We don't sell your data, show you ads, or train AI models on your content. Astrolabe collects no usage analytics.

## 1. Who we are and what this covers

Mercurian, Inc. ("Mercurian", "we", "us") makes Astrolabe. [DECISION: state of incorporation and postal address, proposed: Delaware, if that is where Mercurian, Inc. is incorporated, and the registered office address]

This policy covers two things that handle your data very differently.

- **The Astrolabe app.** This is the desktop app, the command-line server (`npx @mercurian/astrolabe`), the web app you open against your own server, and the mobile app. It runs on your devices.
- **Our hosted services.** These are the Mercurian account (the account you sign in to Astrolabe with), workspaces, remote access and its relay, push notifications, and our websites at astrolabe.sh and app.astrolabe.sh.

This policy describes the official builds that Mercurian distributes. If you build Astrolabe from source or use someone else's fork, whoever made that build decides what it does. This policy still applies to any data such a build sends to our hosted services.

## 2. The app: what stays on your machine

Astrolabe keeps its data in a folder on the computer that runs the Astrolabe server. By default that folder is `~/.astrolabe`. It holds:

- your threads in full: prompts, replies, the agent's reasoning, diffs, command and tool output, attachments and terminal scrollback;
- your projects, settings and scheduled tasks, and the last 50 webhook requests each task received;
- logs, including provider logs that contain prompts and replies, which are deleted after 14 days;
- the API keys and sign-in tokens you give Astrolabe for AI providers and code hosts;
- a list of the devices you've paired, with each one's IP address and browser or device type.

Astrolabe also saves a checkpoint of your project after each turn, so you can see and undo what an agent changed. Checkpoints are hidden git references inside your repository. They can include files that git doesn't track but your `.gitignore` doesn't exclude, such as an `.env` file you forgot to ignore. Astrolabe never pushes them.

Your API keys and tokens are stored in files that only your user account can read. They are not otherwise encrypted.

Each client keeps its own copy of what it needs. The web and desktop apps keep drafts, settings, saved connections and cached thread content in browser storage. The mobile app keeps saved servers and their credentials in the iOS Keychain or Android Keystore, and a cache of thread content in the app.

Mercurian doesn't receive any of this. It leaves your machine only in the ways section 3 describes.

**Deleting it.** Deleting a thread removes its attachments and terminal logs. [PENDING: astrolabe/thread-delete] It also erases the thread's transcript, its provider logs and the checkpoints no other thread uses, keeping only a record that the thread existed. If other threads were forked or delegated from it, it is erased once those are deleted too. Until that change ships, a deleted thread is hidden, its transcript stays in the database, and its provider logs expire after 14 days. Your provider's own tool may keep its own copy: Claude Code and Codex, for example, keep session files in your home folder. Uninstalling Astrolabe doesn't delete your data. To erase it, delete the `~/.astrolabe` folder.

## 3. The app: what leaves your machine, and when

The app sends data off your machine only in the cases below. Most happen because you use a feature. Some happen automatically, and we say so.

### 3.1 Your AI providers

When an agent runs a turn, Astrolabe starts that provider's own tool on your machine (such as Claude Code, Codex or Cursor) with your credentials. The provider receives your prompt, your attachments, and whatever the agent reads or produces: file contents, command output, screenshots and tool results. Agents can also read your other threads, wikis, pull request comments and preview pages through Astrolabe's tools, and what they read goes to the provider too.

This traffic goes from your machine to the provider. It doesn't pass through Mercurian.

You send it at your direction, under your own account and your agreement with that provider. The provider is not Mercurian's subprocessor. It decides how long it keeps your data and whether it trains on it. Some providers train on content from consumer plans unless you opt out, so check your settings with each one. We can't change what a provider keeps.

A few provider calls happen without you starting a turn:

- **Titles and commit messages.** Astrolabe asks a provider to write thread titles, branch names, commit messages, pull request text and review guides. By default it asks Codex (OpenAI), even for threads that run on another provider, as long as Codex is enabled. That provider receives the thread's first message and its images, or the diff. You can change this in Settings → General → Text generation model.
- **Usage limits.** To show how much of your plan you have left, the server calls some providers' usage services with your saved credentials: Claude on Linux and Windows, Cursor, Grok, OpenCode Go and Antigravity. It checks at startup, when you change settings, and every 5 minutes by default.
- **Switching providers.** If you move a thread to another provider, Astrolabe sends the new provider earlier messages from the thread so it can carry on.
- **Signing in to a provider inside Astrolabe.** If you sign in to ChatGPT or Cursor from Astrolabe, the tokens are stored on your machine. Signing in to Cursor creates a Cursor API key named after Astrolabe. [PENDING: astrolabe/upstream-defaults] When you sign in to ChatGPT, OpenAI sees the request come from Astrolabe, with an ID for your Astrolabe installation.

### 3.2 Code hosts and other services you connect

- **GitHub, GitLab, Bitbucket, Azure DevOps and others.** Astrolabe uses the tokens you give it, or that your git tools already hold, to read and write on your behalf: pull requests, comments, checks and branches. While you watch a pull request, it checks for changes every one to two minutes. Comments and check results from a watched pull request are added to the thread, so they reach that thread's provider.
- **Outside agents.** If you approve an outside MCP client, such as ChatGPT, it can read your projects and threads, and its operator receives what it reads. Access is read-only unless you grant more, and lasts 30 days unless you revoke it.
- **Wiki mirrors.** If you give a wiki a git remote, Astrolabe pushes the wiki's full history there after every merge.
- **Expo cloud devices.** If you set up Expo cloud simulators, Astrolabe uses your Expo token to start them on your Expo account.
- **Telemetry export.** If you set an OpenTelemetry endpoint in Settings → Diagnostics, Astrolabe sends traces, metrics and logs to that endpoint. It's empty by default.
- **Webhooks.** A scheduled task's webhook address lets anyone who has it start that task. The request's content goes into the agent's prompt.

### 3.3 The browser inside Astrolabe

- **Searches.** Text you type into the preview browser's address bar that isn't a web address goes to DuckDuckGo by default. You can choose another search engine.
- **Imported cookies (desktop).** You can import cookies from another browser on your machine: Chrome, Edge, Brave, Vivaldi, Opera, Arc, Helium, Safari or Firefox. Astrolabe copies every cookie in the profile you choose into its own preview browser. They stay on your machine, but an agent that drives the preview browser acts on websites signed in as you.
- **Agents in the browser.** When an agent uses the preview browser, the page's address, text, console messages and screenshots go to the thread's provider. Agents can also upload files from your machine to websites.
- **Pages agents draw.** When an agent renders a page, Astrolabe's built-in browser loads any images or files the page links to from public websites.
- **Window capture (desktop, off by default).** If you turn it on and press its shortcut, Astrolabe captures the active window, with its title and accessibility text. It goes to the provider only when you send it.

### 3.4 Automatic requests

These happen without a specific action from you. They don't include your prompts or code.

- **Link icons.** When a chat or pull request shows a link to a public website, Astrolabe asks Google's favicon service for that site's icon. Google learns the website's name and your IP address. Images in messages load straight from the websites that host them. There's no setting to turn this off yet.
- **Update checks.** The desktop app checks GitHub for a new release 15 seconds after it opens and then every 4 minutes. It sends its version and platform, and GitHub sees your IP address. Setting `ASTROLABE_DISABLE_AUTO_UPDATE` turns this off. When a server you connect to is older than your client and wasn't installed by the desktop app, the client checks npm every 5 minutes for the newer version of `@mercurian/astrolabe`.
- **Downloads.** [PENDING: astrolabe/upstream-defaults] The command-line launcher downloads Astrolabe's server from Mercurian's releases on GitHub the first time you run each version. `astrolabe update` and setting up Astrolabe on a remote machine over SSH download it the same way. On first use, Astrolabe also downloads tools it needs: a headless Chrome from Google, `cloudflared` and Codex from GitHub, and mobile device tools from npm.
- **Provider lists.** To keep provider versions, model lists and prices current, the server fetches lists from GitHub, npm, the Agent Client Protocol registry and Meta. These requests carry only package names, and the services see your IP address.
- **Mobile updates.** [PENDING: astrolabe/upstream-defaults] Each time the mobile app starts, it asks Expo, the service that delivers its updates, whether a newer version exists. Expo receives your IP address, an ID for your install, your platform, the app version and, if the app crashed last time, the text of that error (up to 1,024 characters).
- **Your server's public description.** Anyone who can reach your Astrolabe server can read its machine name, operating system and Astrolabe version without signing in. By default the server only accepts connections from your own computer. Once you turn on remote access, anyone who knows your machine's tunnel address can read it too.

### 3.5 Links you share and problem reports

- **Prompt links.** [PENDING: astrolabe/upstream-defaults] "Copy prompt link" puts the prompt's full text, the GitHub repository and the model into a link to app.astrolabe.sh. Anyone you give it to can read it, and our web host receives it when someone opens the link.
- **Pairing links.** [PENDING: astrolabe/upstream-defaults] The backup pairing link puts your server's address and name into a link to app.astrolabe.sh. The one-time pairing code sits in the part of the link that browsers don't send to the server.
- **`astrolabe triage`.** This command asks your own AI provider to read Astrolabe's logs and database on your machine to find a problem. [PENDING: astrolabe/upstream-defaults] If you approve the report it drafts, it files that text as an issue on Astrolabe's public issue tracker on GitHub. Read it before you approve.

### 3.6 Connecting your devices without our services

You can reach your machine from your other devices without a Mercurian account:

- **Local network.** Pairing over your local network uses plain HTTP unless you set up HTTPS yourself, so anyone on that network could read the traffic.
- **Tailscale and SSH.** These connect through your own tailnet or SSH host. No Mercurian server is involved.

On the mobile app, the camera is used only to scan pairing QR codes. Photos and files are used only as attachments you choose. On iPhone, voice input is transcribed on the device, and the audio is deleted afterwards. All three go only to your own server, and from there to your provider when you send them.

### 3.7 Analytics and crash reports

Astrolabe collects no usage analytics and has no crash-reporting service. The one exception is the mobile update check in section 3.4, which includes the text of the last fatal error.

The server contains an analytics client that stays off unless whoever runs the server sets both an analytics key and a destination. Official builds set neither. If you build Astrolabe yourself and set them, events go where you pointed them.

[DECISION: earlier builds. Builds made before October 22, 2026 sent usage events with hashed account IDs to T3 Code's analytics service by default. Proposed: if any such Astrolabe build reached users, add a dated note here saying so; otherwise drop this marker.]

Remote-access diagnostics are covered in section 4.3.

## 4. Hosted services: what we collect

You need a Mercurian account only for remote access, workspaces and push notifications. The app works without one.

### 4.1 Your account

- **Profile.** Your email address, name, profile picture and whether your email is verified. If you sign in with Microsoft, we store your Microsoft profile photo. We also record your access status, such as on the waitlist or approved.
- **Sign-in methods.** If you set a password, we store only a scrypt hash of it. For passkeys we store the public key and the passkey's name. For an authenticator app we store its secret and your backup codes, encrypted.
- **Sign-in providers.** You can sign in with [DECISION: sign-in providers at launch, proposed: list whichever of Google, GitHub, Microsoft and Apple are enabled]. When you do, that provider sends us your account ID with it, your name, email and picture, and sign-in tokens. We store those tokens but don't use them after you sign in.
- **Sessions.** For each device you sign in on, we keep a session with its IP address (shortened, for IPv6) and its browser or device type. Sessions last 7 days and renew while you use them. Your devices keep a sign-in token: in browser storage on web and desktop, in the Keychain or Keystore on mobile, and in a file in Astrolabe's data folder for the command line.
- **Short-lived codes.** One-time sign-in codes, password resets and codes for signing in another device. A device's sign-in request can include your computer's local or Tailscale address in its name. We also count requests per IP address to stop abuse.
- **Breached-password check.** When you set a password, we send the first 5 characters of its SHA-1 hash to Have I Been Pwned to check it against known breaches. Your password and its full hash never leave our servers.
- **Bot checks.** [DECISION: Cloudflare Turnstile at launch, proposed: on for sign-up and email sign-in] Our sign-in pages use Cloudflare Turnstile to tell people from bots. Cloudflare checks your browser, and we send it your IP address with the result.
- **Email.** We send sign-in codes, invitations and waitlist approvals through Amazon SES.
- **Waitlist.** When we approve or decline access, we log which of our staff decided and the email address it applied to.

### 4.2 Workspaces

- A workspace has a name, members, their roles, teams and team owners, and invitations. An invitation records the invitee's email, their role and who invited them.
- Every member can see each member's name, email address, profile picture, role and teams, and the email addresses of pending invitations.
- Workspace details sync to members' devices while the Workspaces view is open. The mobile app keeps a copy until you sign out.
- Invitation emails include the inviter's name and email address and the workspace's name.
- At launch, workspaces don't share threads, code or wikis. [DECISION: publishing threads to teams is not in the launch product. Proposed: before it ships, add a section here covering what is uploaded, who can see it and how to delete it.]

[DECISION: roles. Proposed: Mercurian is the controller for account data, and a processor for workspace content on behalf of the workspace's owner, with a data processing agreement available on request. Note that at launch a workspace holds only names, teams and memberships.]

### 4.3 Remote access

When you turn on Remote access for a machine (Settings → Connections), you link it to your account.

- **The link.** We store your account ID, an ID for the machine's Astrolabe server, the machine's name, its public key, its tunnel's hostname and address, and the ID of the device that created the link.
- **The tunnel.** We create a Cloudflare Tunnel and a hostname for the machine.
- **Your sessions.** Everything that passes between your devices and that machine travels through Cloudflare's network to the tunnel on your machine: prompts, agent output, files, diffs, terminal output and sign-in tokens. The connection is encrypted with HTTPS, but that encryption ends at Cloudflare's edge, so Cloudflare can technically access the content as it passes through. Mercurian's relay isn't on this path, and we don't store your session content. Astrolabe doesn't add its own end-to-end encryption yet. If that matters for your work, connect over your local network, Tailscale or SSH instead (section 3.6).
- **Who can connect.** Any device signed in to your Mercurian account can connect to the machines you've linked to it and run agents there. Keep your account secure.
- **Webhooks.** If a scheduled task receives webhooks through remote access, the relay passes each request (most of its headers and up to 1 MiB of body) to your machine. If you turn on "Hold webhooks while offline", the relay keeps requests that arrive while your machine is offline for up to 24 hours, up to 1,000 requests or 50 MB, and deletes each one once it is delivered.
- **Diagnostics.** When you use remote access, Astrolabe's clients and our relay send diagnostic traces to Axiom. They hold connection details: request addresses, your account ID, IDs for your machines, threads and devices, the machine's name, your browser or app, the country of the Cloudflare location that handled the request, error messages and, possibly, your machine's local network addresses. They don't hold messages, prompts or code. Axiom keeps them for 30 days. On the command-line server and the desktop app, setting `ASTROLABE_TELEMETRY_ENABLED=false` turns them off. The web and mobile apps don't have a switch yet.
- **Cloudflare's logs.** Cloudflare also logs requests to our relay, including account and machine IDs, tunnel hostnames and, possibly, webhook addresses. [VERIFY: how long Cloudflare keeps the relay's Workers Logs; the code doesn't set it.]

### 4.4 Push notifications and agent activity

- **Agent activity.** While "Publish agent activity" is on for a linked machine, the machine sends our relay a short status for each thread: machine and thread IDs, the project's name, the thread's title, the model's name, and whether the agent is working, waiting for you, finished or failed. No message text is sent. Thread titles are written by an AI provider from your first message, so a title can reflect what you asked.
- **Defaults.** Remote access and "Publish agent activity" are both selected when you first set up remote access. You can turn either off there, or later in Settings → Connections.
- **Your phone.** When you sign in on the mobile app, it registers with our relay: a random device ID, the device name set in your phone's settings, its platform and system version, the app version, its push tokens and your notification preferences.
- **Delivery.** We send notifications through Apple Push Notification service on iPhone and Firebase Cloud Messaging (Google) on Android. An iPhone notification contains the thread's title. A Live Activity on iPhone shows up to five threads at once, with thread, project and model names. Android notifications carry the titles plus your account ID and device ID. Apple and Google handle notifications under their own terms.
- **Delivery records.** Each notification we send is logged with account, machine, thread and device IDs, the last 8 characters of the push token and the result. Notifications waiting to go out sit briefly in Cloudflare's queues.
- **Turning it off.** You can block notifications in your phone's settings. [PENDING: astrolabe/cloud-deletion] Signing out of the mobile app removes the phone's registration.

### 4.5 Hosted wikis

[DECISION: hosted wikis are planned but not built; today every wiki is a git repository on your machine, and a mirror pushes only to a git remote you choose (section 3.2). Proposed: leave hosted wikis out of the launch policy and add this section when they ship.]

### 4.6 Our websites

- **astrolabe.sh** sets no cookies and runs no analytics. It reads your time zone in your browser to set the page's light, and that never leaves your browser.
- **app.astrolabe.sh** uses only the cookies it needs to keep you signed in. No advertising or analytics cookies. [VERIFY: the cookies app.astrolabe.sh sets once deployed, including any that Turnstile sets]
- Like any website, our web host receives your IP address and browser details when you visit. [DECISION: web host for astrolabe.sh and app.astrolabe.sh, proposed: name it in section 6 once chosen]

## 5. How we use your data

We use the data in section 4 to:

- run the hosted services: sign you in, connect your devices, deliver notifications and send account emails;
- keep the services and our users secure: stop abuse, limit request rates and check for breached passwords;
- find and fix problems, using diagnostic traces and logs;
- tell you about your account and about changes to these services;
- meet our legal obligations.

We don't sell or rent personal data. We don't use it for advertising. We don't train AI models on your content, meaning your prompts, code, threads and wikis. We don't inspect the content of your remote sessions.

## 6. Who we share it with

These companies process data to run our hosted services. Each receives only what its part of the service needs.

| Company                                                                                                                                                                                                 | What it does for us                                                                                                                                                                             | What it handles                                                                                                                           | Where                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Cloudflare                                                                                                                                                                                              | Carries remote-access traffic (Tunnel and DNS), runs the relay, queues notifications, holds webhooks while you're offline, logs relay requests, and runs bot checks on sign-in pages if enabled | Remote session traffic in transit, relay records, notification content and push tokens in its queues, held webhook requests, IP addresses | Cloudflare's global network                                                         |
| [DECISION: relay database host, proposed: Amazon Web Services, as the October 13 plan says, because account deletion assumes the relay shares the account database; the code still targets PlanetScale] | Stores the relay's database                                                                                                                                                                     | Remote-access links, phone registrations, agent activity and delivery records                                                             | [DECISION: deployed region, proposed: us-east-1; the code says PlanetScale us-west] |
| Amazon Web Services                                                                                                                                                                                     | Runs the account and workspace service and its database, and sends email through Amazon SES                                                                                                     | Account, session and workspace data; email addresses and email content                                                                    | [DECISION: deployed region, proposed: us-east-1]                                    |
| Axiom                                                                                                                                                                                                   | Stores diagnostic traces for 30 days                                                                                                                                                            | Account, machine, thread and device IDs, machine names, connection details                                                                | [DECISION: Axiom region, proposed: US]                                              |
| Apple                                                                                                                                                                                                   | Delivers iPhone notifications and Live Activities                                                                                                                                               | Notification content and push tokens                                                                                                      | Apple                                                                               |
| Google                                                                                                                                                                                                  | Delivers Android notifications through Firebase Cloud Messaging                                                                                                                                 | Notification content, push tokens, account and device IDs                                                                                 | Google                                                                              |
| Expo                                                                                                                                                                                                    | Delivers mobile app updates                                                                                                                                                                     | IP address, install ID, platform, app version, the last fatal error's text                                                                | Expo [PENDING: astrolabe/upstream-defaults]                                         |
| Have I Been Pwned                                                                                                                                                                                       | Checks passwords against known breaches                                                                                                                                                         | The first 5 characters of a password's SHA-1 hash                                                                                         | Not stated                                                                          |

If you sign in with Google, GitHub, Microsoft or Apple, that company also learns that you signed in to Mercurian. It handles that under its own terms.

**Services you choose.** Your AI providers, code hosts, the outside agents you approve, your search engine, your telemetry endpoint, your wiki mirrors and your Expo account receive data because you send it to them. You send it at your direction, under your agreement with them. They are not our subprocessors.

**Services the app contacts automatically.** GitHub, npm, Google, the Agent Client Protocol registry and Meta receive your IP address and the item requested, as section 3.4 explains.

**When the law requires it.** We disclose data to authorities only when the law requires it and the request is valid. Unless the law forbids it, we'll tell you first.

**If Mercurian changes hands.** If Mercurian is acquired or merges with another company, your data may transfer to the new owner under this policy. We'll tell you before that happens.

## 7. How long we keep it

[DECISION: retention periods, proposed: 30 days for logs, backups, ended invitations and unlinked machines, as listed below]

| Data                                                       | How long we keep it                                                                                                                                                                                   |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Account profile, sign-in methods and workspace memberships | Until you delete your account                                                                                                                                                                         |
| Sessions                                                   | 7 days, renewed while you use them. [PENDING: astrolabe/cloud-deletion] Expired sessions are deleted once they expire.                                                                                |
| One-time codes and password resets                         | Valid for 3 to 5 minutes (codes), 1 hour (resets), 30 minutes (device sign-in codes) and 30 days (trusted devices). [PENDING: astrolabe/cloud-deletion] Expired records are deleted once they expire. |
| Invitations                                                | An invitation expires 48 hours after it is sent. [PENDING: astrolabe/cloud-deletion] It is deleted 30 days after it expires, whether or not it was accepted.                                          |
| Remote-access links                                        | While the machine is linked. [PENDING: astrolabe/cloud-deletion] Deleted 30 days after you unlink it.                                                                                                 |
| Held webhooks                                              | Up to 24 hours; deleted once delivered                                                                                                                                                                |
| Agent activity                                             | Finished and failed threads: 30 minutes. [PENDING: astrolabe/cloud-deletion] Activity a machine stops updating: 24 hours.                                                                             |
| Notification delivery records                              | [PENDING: astrolabe/cloud-deletion] 30 days                                                                                                                                                           |
| Diagnostic traces in Axiom                                 | 30 days                                                                                                                                                                                               |
| Service logs and backups                                   | 30 days                                                                                                                                                                                               |

## 8. Deleting your account and your data

You can delete your account in the app: in Settings on web and desktop, in Settings → Account on mobile, or on your account page at app.astrolabe.sh. You don't need to email us.

To protect you, we ask you to sign in again if your session is more than a day old. If you own a workspace that has other members, transfer it or delete it first.

When you confirm, we delete your profile, sign-in methods, sessions and workspace memberships, and the invitations you sent, at once. [PENDING: astrolabe/cloud-deletion] We also delete your linked machines and their tunnels, your phones' registrations, your agent activity and notification records, and the sign-in codes and invitations addressed to your email. Copies in our logs and backups expire within 30 days.

Deleting your account doesn't reach everything:

- **Your devices.** Astrolabe's data folder, browser storage and the mobile app's cache stay on your devices. Delete them yourself, or uninstall Astrolabe and delete `~/.astrolabe`.
- **Your providers and code hosts.** They keep what you sent them under their own terms. Delete it with them. Disconnecting a provider and deleting what it already received are separate steps.
- **Email already sent.** Emails we sent stay in the recipient's mailbox.

## 9. Security

- Connections to our hosted services use HTTPS. [VERIFY: HTTPS on every hosted endpoint once deployed; no production deployment exists in the code yet]
- Passwords are stored only as scrypt hashes. Authenticator secrets and backup codes are encrypted.
- The tokens your devices use with our relay are tied to a key held on that device, and the relay's own tokens expire after 15 minutes and carry only your account ID.
- On your machine, Astrolabe's secrets are protected by your operating system's file permissions, not by extra encryption. Pairing over a local network is unencrypted unless you add HTTPS.

No system is perfectly secure. If we learn of a breach that affects your data, we'll tell you and the authorities as the law requires. To report a vulnerability, write to [DECISION: security contact, proposed: security@mercurian.ai].

## 10. International transfers

Mercurian is based in the United States, and our providers process data in the United States and elsewhere. Cloudflare processes traffic wherever its network handles it. When we transfer personal data from the European Economic Area, the United Kingdom or Switzerland, we use [DECISION: transfer mechanism, proposed: the European Commission's Standard Contractual Clauses and the UK Addendum].

## 11. Your rights

Wherever you live, you can ask us for a copy of your data, to correct it, or to delete it. You can edit your name and delete your account in the app yourself. For anything else, write to the contact in section 14. We'll answer within one month, or 45 days in California, and tell you if we need longer.

### If you are in the EU or the UK

Under the GDPR and the UK GDPR you have the right to access, correct, delete, restrict and port your data, and to object to how we use it. Where we rely on your consent, you can withdraw it at any time. You can complain to your local data protection authority, or in the UK to the Information Commissioner's Office.

We rely on these legal bases:

- **To provide the service you asked for:** your account, workspaces, remote access and notifications.
- **Our legitimate interests:** keeping the services secure, stopping abuse, fixing problems with diagnostic traces, and account emails.
- **Your consent:** push notifications, which you allow in your phone's settings.
- **Legal obligations:** keeping records the law requires.

[DECISION: EU and UK representative, proposed: appoint one under Article 27 before offering the hosted services in the EU and UK]

### If you are in California

In the last 12 months we collected these categories of personal information, for the purposes in section 5:

- **Identifiers:** name, email address, account and device IDs, IP address.
- **Internet and network activity:** sign-in sessions, request records and diagnostic traces.
- **Approximate location:** the country of the Cloudflare location that handled a request.
- **Account credentials:** password hashes, passkeys and authenticator secrets. We use these only to sign you in.

We don't sell personal information or share it for cross-context behavioral advertising. You have the right to know what we collect, to delete it and to correct it, and we won't treat you differently for using these rights. An authorized agent can make a request for you.

## 12. Children

Astrolabe is not for children. You must be at least [DECISION: minimum age, proposed: 16 in the EU and UK and 13 elsewhere, or 18 everywhere if simpler] to create a Mercurian account. If we learn that a child under that age has an account, we'll delete it.

## 13. Changes to this policy

We'll post every change here with a new date. If a change is significant, we'll tell account holders by email or in the app at least 30 days before it takes effect. [DECISION: change history, proposed: keep every version in the public repository so anyone can compare them]

## 14. Contact

Mercurian, Inc.<br>
[DECISION: postal address]<br>
[DECISION: privacy contact email, proposed: privacy@mercurian.ai]

See also our [Terms of Service](/terms-of-service) and [Licenses](/licenses).
