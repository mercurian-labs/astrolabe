---
title: Privacy Policy
description: What Astrolabe keeps on your machine, what it sends and to whom, and what our websites see.
updated: October 26, 2026
---

**Effective date:** October 26, 2026

## The short version

- Astrolabe is software that runs on your own computer. Your projects, threads and code stay there. Mercurian doesn't receive them.
- Your prompts and code go to the AI provider you choose, through that provider's own tool, under your account and that provider's terms. They go from your machine to the provider, not through us.
- Mercurian runs no accounts or other hosted services yet. We don't collect usage analytics or crash reports, and we don't sell your data, show you ads or train AI models on your content.
- A few requests happen automatically, such as update checks to GitHub. Section 3.4 lists them all.
- Our websites set no tracking or advertising cookies and run no analytics. Our web host sees your IP address when you visit.

## 1. Who we are and what this covers

Mercurian, Inc. ("Mercurian", "we", "us"), a Delaware corporation, makes Astrolabe. How to reach us is in section 10.

This policy covers:

- **The Astrolabe software we distribute:** the desktop app for macOS and Linux and the command-line server, including the `@mercurian/astrolabe` package on npm and the downloads on Astrolabe's GitHub Releases page.
- **Our websites:** astrolabe.sh, and the web app at app.astrolabe.sh, which your browser uses to connect to an Astrolabe server you run.

**We don't offer hosted services yet.** There are no Mercurian accounts, and we run no relay, sync, workspaces, push notifications or hosted wikis for you. If we launch any of them, we'll update this policy before they open.

This policy describes the builds Mercurian distributes. If you build Astrolabe from source or use someone else's fork, whoever made that build decides what it does.

## 2. What stays on your machine

Astrolabe keeps its data in a folder on the computer that runs the Astrolabe server. By default that folder is `~/.astrolabe`. It holds:

- your threads in full: prompts, replies, the agent's reasoning, diffs, command and tool output, attachments and terminal scrollback;
- your projects, settings and scheduled tasks, and the last 50 webhook requests each task received;
- logs. Provider logs, which contain prompts and replies, are deleted after 14 days. Other logs are kept up to a fixed size, with the oldest deleted first;
- the API keys and sign-in tokens you give Astrolabe for AI providers and code hosts;
- a list of the browsers and devices you've paired, with each one's IP address and browser type.

Astrolabe also saves a checkpoint of your project after each turn, so you can see and undo what an agent changed. Checkpoints are hidden git references inside your repository. They can include files that git doesn't track but your `.gitignore` doesn't exclude, such as an `.env` file you forgot to ignore. Astrolabe never pushes them.

Your API keys and tokens are stored in files that only your user account can read. They are not otherwise encrypted.

The web and desktop apps keep drafts, settings, saved connections (with the credentials for them) and cached thread content in browser storage on each device.

Mercurian doesn't receive any of this. It leaves your machine only in the ways section 3 describes.

**Deleting it.** Deleting a thread erases its transcript, attachments, terminal logs, provider logs, and the checkpoints no other thread uses. It keeps only a record that a thread existed, with its ids and timestamps. Threads an agent delegated from it are deleted with it. If you forked other threads from it, the history they share stays until those are deleted too. Some copies remain after a delete:

- other devices keep unsent drafts and cached content until you open Astrolabe there;
- old pages of the database stay on disk until the database reuses that space;
- checkpoints made by earlier versions of Astrolabe stay in your repository;
- your provider's own tool keeps its own copy: Claude Code and Codex, for example, keep session files in your home folder.

Uninstalling Astrolabe doesn't delete your data. To erase all of it, delete the `~/.astrolabe` folder.

## 3. What leaves your machine, and when

The software sends data off your machine only in the cases below. Most happen because you use a feature. Some happen automatically, and section 3.4 lists those.

### 3.1 Your AI providers

When an agent runs a turn, Astrolabe starts that provider's own tool on your machine (such as Claude Code, Codex or Cursor) with your credentials. The provider receives your prompt, your attachments, and whatever the agent reads or produces: file contents, command output, screenshots and tool results. Agents can also read your other threads, wikis, pull request comments and preview pages through Astrolabe's tools, and what they read goes to the provider too.

This traffic goes from your machine to the provider. It doesn't pass through Mercurian, and we don't receive it.

You send it at your direction, under your own account and your agreement with that provider. The provider decides how long it keeps your data and whether it trains on it. Some providers train on content from consumer plans unless you opt out, so check your settings with each one.

A few provider requests happen without you starting a turn:

- **Titles and commit messages.** Astrolabe asks a provider to write thread titles, branch names, commit messages, pull request text and review guides. By default it asks Codex (OpenAI), even for threads that run on another provider, and another enabled provider if Codex is off. That provider receives the thread's first message and its images, or the diff. You can change this in Settings → General → Text generation model.
- **Usage limits.** To show how much of your plan you have left, the server calls some providers' usage services with your saved credentials: Claude on Linux, Cursor, Grok, OpenCode Go and Antigravity. It checks at startup, when you change settings, and every 5 minutes by default.
- **Switching providers.** If you move a thread to another provider, Astrolabe sends the new provider earlier messages from the thread so it can carry on.
- **Signing in to a provider inside Astrolabe.** If you sign in to ChatGPT or Cursor from Astrolabe, the tokens are stored on your machine. When you sign in to ChatGPT, OpenAI sees the request come from Astrolabe, with an ID for your Astrolabe server. Signing in to Cursor creates a Cursor API key named after Astrolabe.

### 3.2 Code hosts and other services you connect

- **GitHub, GitLab, Bitbucket, Azure DevOps and others.** Astrolabe uses the tokens you give it, or that your git tools already hold, to read and write on your behalf: pull requests, comments, checks and branches. While you watch a pull request, it checks for changes every one to two minutes. Comments and check results from a watched pull request are added to the thread, so they reach that thread's provider.
- **Outside agents.** If you approve an outside MCP client, such as ChatGPT, it can read your projects and threads, and its operator receives what it reads. Access is read-only unless you grant more, and lasts 30 days unless you revoke it.
- **Wiki mirrors.** If you give a wiki a git remote, Astrolabe pushes the wiki's full history there after every merge.
- **Expo cloud devices.** If you set up Expo cloud simulators, Astrolabe uses your Expo token to start them on your Expo account.
- **Theme search.** Searching for an editor theme in Settings sends your search to the Open VSX registry.
- **Telemetry export.** If you set an OpenTelemetry endpoint in Settings → Diagnostics, Astrolabe sends traces, metrics and logs to that endpoint. It's empty by default.
- **Webhooks.** A scheduled task's webhook address lets anyone who has it, and can reach your server, start that task. The request's content goes into the agent's prompt.

### 3.3 The browser inside Astrolabe

- **Searches.** Text you type into the preview browser's address bar that isn't a web address goes to DuckDuckGo by default. You can choose another search engine.
- **Imported cookies (desktop).** You can import cookies from another browser on your machine, such as Chrome, Brave, Arc, Safari or Firefox. Astrolabe copies every cookie in the profile you choose into its own preview browser. They stay on your machine, but an agent that drives the preview browser acts on websites signed in as you.
- **Agents in the browser.** When an agent uses the preview browser, the page's address, text, console messages and screenshots go to the thread's provider. Agents can also upload files from your machine to websites.
- **Pages agents draw.** When an agent renders a page, Astrolabe's built-in browser loads any images or files the page links to from public websites.
- **Window capture (desktop, off by default).** If you turn it on and press its shortcut, Astrolabe captures the active window, with its title and accessibility text. It goes to the provider only when you send it.

### 3.4 Automatic requests

These happen without a specific action from you. None of them include your prompts or code. Each service sees your IP address.

- **Desktop update checks.** The desktop app checks Astrolabe's releases on GitHub 15 seconds after it opens and then every 4 minutes. Each check carries a random ID the updater creates for your installation. Setting the environment variable `ASTROLABE_DISABLE_AUTO_UPDATE` turns this off.
- **Server update checks.** When a server you connect to is older than your client and wasn't installed by the desktop app, the client asks npm every 5 minutes whether the newer `@mercurian/astrolabe` is published.
- **Downloads.** The `@mercurian/astrolabe` launcher downloads Astrolabe's server from Astrolabe's GitHub Releases the first time you run each version. `astrolabe update` and installing Astrolabe on a remote machine over SSH download it the same way. On first use, Astrolabe also downloads tools it needs: a headless Chrome from Google, Codex from GitHub, Antigravity's agent server from Google, and device tools from npm.
- **Provider lists.** To keep provider versions, model lists and prices current, the server fetches lists from GitHub (including a model list from T3 Code's public repository), npm, the Agent Client Protocol registry and Meta. These requests carry only package and list names. You can turn them off in Settings → General → Provider update checks.
- **Link icons.** When a chat or a preview tab shows a link to a public website, Astrolabe asks Google's favicon service for that site's icon, so Google learns the site's name. Some tool activity loads a site's icon from the site itself. Images in messages load straight from the websites that host them. There's no setting to turn these off yet.
- **Spell-check dictionaries (Linux desktop).** The desktop app's spell checker downloads its dictionaries from Google the first time it needs them. On macOS it uses the system's.
- **Your server's public description.** Anyone who can reach your Astrolabe server can read its ID, machine name, operating system and Astrolabe version without signing in. By default the server only accepts connections from your own computer. If you open it to your network or your tailnet, anyone who can reach it there can read this too.

### 3.5 Links you share

- **Prompt links.** "Copy prompt link" puts the prompt's full text, the repository and the model into a link to app.astrolabe.sh. Anyone you give it to can read it, and our web host receives it when someone opens the link.
- **Pairing links.** A pairing link puts your server's address and name into a link to app.astrolabe.sh. The one-time pairing code sits in the part of the link that browsers don't send to the web host.

### 3.6 Connecting your other devices

You can reach your machine from a browser on another device by pairing it with your server:

- **Local network.** Pairing over your local network uses plain HTTP unless you set up HTTPS yourself, so anyone on that network could read the traffic.
- **Tailscale and SSH.** These connect through your own tailnet or SSH host. No Mercurian server is involved.

Once paired, your server sets a sign-in cookie in that browser for its own address.

### 3.7 Analytics and crash reports

Astrolabe collects no usage analytics and has no crash-reporting service.

The server contains an analytics client that stays off unless whoever builds or runs the server sets both an analytics key and a destination. Official builds set neither. If you build Astrolabe yourself and set them, events go where you pointed them.

## 4. Our websites

- **astrolabe.sh** sets no cookies and runs no analytics or third-party scripts. Its fonts are served from the site itself. It reads your time zone in your browser to set the page's light, and that never leaves your browser. The download page asks GitHub for the latest release from your browser, so GitHub sees your IP address, and keeps the answer in your browser until you close the tab.
- **app.astrolabe.sh** is the web app, served as static files. It has no accounts. It sets one cookie that remembers whether the sidebar is open. Everything else it keeps, such as your saved servers, their credentials, drafts and settings, stays in your browser's storage, and it talks to the Astrolabe servers you connect it to, straight from your browser. It makes the automatic requests in section 3.4 that happen in the client: link icons from Google and the npm update check.
- **Hosting.** Our web host, Cloudflare, serves both sites. Like any web host, it receives your IP address, browser details and the addresses you request, including the text of any prompt link you open, and may keep request logs to run and protect the sites.

## 5. How we use and share data

The only personal data Mercurian receives is what our web host logs when you visit our websites, and anything you choose to send us, such as an email. We use it to run and protect the websites and to answer you.

We don't sell or rent personal data. We don't use it for advertising. We don't train AI models on your content.

We share it only with our web host, which processes it for us, and with authorities when the law requires it and the request is valid. Unless the law forbids it, we'll tell you first. If Mercurian is acquired or merges with another company, this policy will apply to the data it receives.

The services in section 3 (your AI providers, code hosts, GitHub, npm, Google and the others) receive data because the software you run on your machine contacts them. They handle it under their own terms. They aren't processing it for Mercurian.

## 6. Security

To report a vulnerability, write to [security@mercurian.ai](mailto:security@mercurian.ai).

On your machine, Astrolabe's secrets are protected by your operating system's file permissions, not by extra encryption, and pairing over a local network is unencrypted unless you add HTTPS. Keep the machine that runs your server secure.

## 7. Your rights

Wherever you live, you can ask us what personal data we hold about you, and ask us to correct or delete it. Write to the contact in section 10. We'll answer within one month, or 45 days in California. Most of your data is on your own devices, where you control it directly.

If you are in the EU or the UK, you also have the right to restrict and port your data, to object to how we use it, and to complain to your data protection authority. We rely on our legitimate interest in running and protecting our websites. Our web host may process data outside your country, under the safeguards the law requires.

If you are in California: we don't sell personal information or share it for cross-context behavioral advertising, and we won't treat you differently for using your rights.

## 8. Children

Astrolabe is for adults: you must be at least 18 to use it. We don't knowingly collect data from children.

## 9. Changes to this policy

We'll post every change here with a new date, and every earlier version stays in Astrolabe's public repository. If a change is significant, we'll say so on this page before it takes effect.

## 10. Contact

Mercurian, Inc.<br>
[privacy@mercurian.ai](mailto:privacy@mercurian.ai)

See also our [Terms of Service](/terms-of-service) and [Licenses](/licenses).
