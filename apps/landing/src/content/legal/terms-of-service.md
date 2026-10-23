---
title: Terms of Service
description: The terms for Mercurian's hosted services and the official Astrolabe builds, including AI providers, agents acting on your machine, and remote access.
updated: October 23, 2026
---

**Effective date:** [DECISION: effective date, proposed: the day the hosted services open to the public]

These terms are an agreement between you and Mercurian, Inc. ("Mercurian", "we", "us"). Please read them with our [Privacy Policy](/privacy-policy), which explains what data we collect and why.

## 1. What these terms cover

These terms cover:

- **Our hosted services:** the Mercurian account, workspaces, remote access and its relay, push notifications, and our websites at astrolabe.sh and app.astrolabe.sh.
- **The official builds of Astrolabe** that Mercurian distributes: the desktop app, the mobile app, and the `@mercurian/astrolabe` command-line package.

They don't cover builds you make from source, or forks that others make. The open-source licenses govern those (section 2). If such a build connects to our hosted services, these terms govern your use of the hosted services.

If you use Astrolabe for an organization, you accept these terms for it and confirm you have the authority to do so.

## 2. Open source and these terms

Astrolabe's app is open source under the MIT License. [PENDING: astrolabe/licensing] The source of our hosted backend is available under the Functional Source License (FSL-1.1-MIT), and each version becomes MIT-licensed two years after its release. The [Licenses](/licenses) page explains what covers what.

Nothing in these terms limits the rights an open-source license gives you. If these terms and such a license conflict, the license wins for the code it covers. The restrictions in these terms apply only to our hosted services.

The names Astrolabe and Mercurian, and their logos, are Mercurian's trademarks. The open-source licenses don't grant any rights in them.

## 3. Your account

- You must be at least [DECISION: minimum age, proposed: 16 in the EU and UK and 13 elsewhere, or 18 everywhere if simpler] to create an account.
- Give us accurate information, and keep your sign-in methods secure.
- You are responsible for what happens under your account, including on the machines you link and the devices you sign in on. This doesn't apply to activity caused by someone exploiting a flaw in our services.
- Tell us right away if you think someone else is using your account.

## 4. Early access and fees

The hosted services are in early access. They may change, have bugs, lose data or be unavailable, and we may limit who can join through a waitlist.

[DECISION: pricing, proposed: the hosted services are free during early access; if we introduce paid plans we'll give at least 30 days' notice, and Mercurian will never charge for using your own AI provider plan through Astrolabe]

## 5. Your content

Your content is what you put into Astrolabe or have it produce: prompts, code, files, threads, wikis and agent output. Between you and Mercurian, you own it.

You give Mercurian a limited, non-exclusive, worldwide license to host, copy, transmit and process your content only as needed to run, secure and troubleshoot the hosted features you turn on. For workspaces, that includes showing your profile to the other members. The license ends when we no longer need it for those purposes.

We don't use your content to train AI models. We don't access it except:

- to provide a feature you asked for, or with your permission, for example to answer a support request;
- to keep the services secure and working;
- when the law requires it.

You are responsible for having the rights to the content you send through Astrolabe.

## 6. Your AI providers

Astrolabe works with AI providers you choose, such as Anthropic, OpenAI and Cursor, through your own subscriptions, API keys or accounts.

- **Your agreement with each provider governs your use of it,** not these terms. You must follow that provider's terms and usage policies, including its rules about using its subscription plans through other apps.
- **Providers change those rules.** A provider may restrict, re-price or end your use of its service through Astrolabe, sometimes without notice. If that happens, you may need to use a different sign-in method, such as an API key, or a different provider.
- **Mercurian is not a party to your provider agreement.** We don't resell or pay for your usage, and we aren't responsible for a provider's availability, charges, data retention or training.
- **No endorsement.** No AI provider endorses Astrolabe. Provider names are their owners' trademarks, used only to say what Astrolabe works with.

## 7. Agents act on your machine

Agents in Astrolabe don't just write text. They act.

- **What agents can do.** An agent can read and change files, run commands, use the network, use your saved credentials and signed-in browser sessions, and act on websites and services. It acts with the permissions of the user account that runs the Astrolabe server.
- **Permission modes.** You choose how much an agent may do without asking: Supervised, Auto-accept edits, Auto or Full access. In Full access, agents run commands and change files without asking first. New threads start in Full access unless you choose a different default in Settings → General → Permissions.
- **Astrolabe doesn't sandbox agents.** Any approval prompts or sandbox come from the provider's own agent and the mode you choose. Full access removes them.
- **Agents can start without you at the keyboard.** Your phone or browser can start a turn through remote access. So can scheduled tasks, webhooks and outside agents you approve. Those turns run on your machine with the same permissions.
- **You are responsible for what your agents do.** That covers every action an agent takes at your direction or under the modes and settings you choose, and what it sends or publishes on your behalf. Agent output and actions can be wrong, insecure, incomplete or different from what you intended. Review them before you rely on, publish or deploy them.
- **By choosing or keeping a mode that lets agents act without asking, you accept the risks of those actions,** including lost data, security weaknesses, outages, charges, and changes to accounts and services the agent can reach.

Use version control, keep backups, and run agents on untrusted code in an isolated environment, such as a container or a separate machine.

## 8. Remote access

Remote access lets your other devices reach Astrolabe on a machine you link to your account.

- Traffic travels through Cloudflare's network, and its encryption ends at Cloudflare's edge. Astrolabe doesn't add end-to-end encryption yet. The [Privacy Policy](/privacy-policy#43-remote-access) explains what that means.
- Any device signed in to your account can control the machines you've linked. Link only machines you are allowed to control, and unlink a machine when you no longer need it.
- Tunnels exist to reach your own Astrolabe server. Don't use them to host or proxy other services.
- We may limit usage, or revoke a tunnel that is abused or puts others at risk.

## 9. Workspaces

- Workspace owners and admins manage who belongs to a workspace. Members can see each other's names, email addresses, profile pictures, roles and teams.
- The owner is responsible for the people they invite and for how the workspace is used.
- If you leave a workspace, you lose access to it.

[DECISION: data processing agreement, proposed: available on request for workspaces whose owners need one]

## 10. Acceptable use

When you use our hosted services, don't:

- break the law or infringe anyone's rights;
- access machines, accounts or data you aren't authorized to;
- send malware, spam or abusive content through our services;
- probe, scan, overload or disrupt our services, or get around their rate limits, waitlist or access controls, except for good-faith security research reported to us;
- resell or share access to the hosted services, or create accounts automatically to get around limits;
- use Astrolabe to let other people use your AI provider subscription, or to run turns on someone else's subscription, unless that provider's terms allow it. For example, don't let a teammate's messages start turns on your personal plan through a machine you've linked;
- use agents to do anything your AI provider's usage policy forbids.

[DECISION: shared threads and provider subscriptions. Provider terms (OpenAI's Sign in with ChatGPT terms; Anthropic's consumer terms and usage policy) forbid one person's subscription serving another person's requests. Proposed: keep the rule above, and before shared threads ship, make teammates' turns run on the teammate's own provider account.]

Automation is welcome. Scheduled tasks, scripts and agents that use the hosted services for your own work are normal use.

## 11. Other services

Astrolabe connects to services that others run: your AI providers, code hosts, Apple, Google and Cloudflare among them. Their terms govern your use of them, and we aren't responsible for them.

If you got the mobile app from the App Store or Google Play, that store's terms also apply. Apple and Google aren't responsible for the app or for supporting it.

## 12. Feedback

If you send us ideas or feedback, we may use them without owing you anything.

## 13. Ending your account

- You can stop using the hosted services and delete your account at any time, in the app.
- We may suspend or close your account if you break these terms, if your use puts other people or our services at risk, or if the law requires it. Where we reasonably can, we'll tell you first and explain why.
- If we shut down a hosted service, we'll give you at least 30 days' notice.
- If your account ends, Astrolabe keeps working on your machine without it, and your local data stays where it is.

## 14. Disclaimers

The hosted services and the official builds are provided "as is" and "as available". To the extent the law allows, we disclaim all warranties, including merchantability, fitness for a particular purpose and non-infringement. We don't promise that the services will be uninterrupted or secure, that agents' output or actions will be correct, or that any AI provider will stay available through Astrolabe.

## 15. Limits on liability

To the extent the law allows:

- Mercurian isn't liable for indirect, incidental, special, consequential or punitive damages, or for lost profits, revenue or data.
- Mercurian isn't liable for actions agents take under the modes and settings you chose, or for charges from your AI providers.
- Mercurian's total liability for any claim about these terms or the services is limited to [DECISION: liability cap, proposed: the greater of what you paid us in the 12 months before the claim and US$100].

Nothing in these terms limits liability that the law doesn't allow to be limited, such as for fraud, or for death or personal injury caused by negligence.

## 16. Indemnity

If you use the hosted services for a business, you will defend and indemnify Mercurian against third-party claims that arise from your content, from actions your agents take under your control, or from your breach of these terms or of your AI providers' terms. If you are a consumer, this applies only as far as your local law allows.

## 17. Governing law and disputes

[DECISION: governing law and courts, proposed: the law of the state where Mercurian, Inc. is incorporated and its courts, with no arbitration clause]

If you live in the EU or the UK, you keep the protections of your local consumer law, and you can bring claims in your local courts.

## 18. Changes to these terms

We'll post every change here with a new date. If a change is significant, we'll tell account holders by email or in the app at least 30 days before it takes effect. If you don't agree with a change, stop using the hosted services and delete your account. If you keep using them after the change takes effect, the new terms apply.

## 19. General

- These terms and the [Privacy Policy](/privacy-policy) are the whole agreement between you and Mercurian about the hosted services and the official builds.
- If a court finds part of these terms unenforceable, the rest still applies.
- If we don't enforce a term right away, we haven't given up the right to enforce it later.
- We may transfer these terms if Mercurian merges or is acquired. You may not transfer them without our consent.
- You must follow the export control and sanctions laws that apply to you.
- We aren't responsible for delays or failures caused by events beyond our reasonable control.

## 20. Contact

Mercurian, Inc.<br>
[DECISION: postal address]<br>
[DECISION: contact email for these terms, proposed: legal@mercurian.ai]
