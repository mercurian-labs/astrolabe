---
title: Terms of Service
description: The terms for Astrolabe's websites and the Astrolabe software Mercurian distributes, including your AI providers and the agents that act on your machine.
updated: October 25, 2026
---

**Effective date:** [DECISION: effective date, proposed: the day astrolabe.sh launches]

These terms are an agreement between you and Mercurian, Inc. ("Mercurian", "we", "us"). Please read them with our [Privacy Policy](/privacy-policy).

## 1. What these terms cover

- **Our websites:** astrolabe.sh, and the web app at app.astrolabe.sh, which your browser uses to connect to an Astrolabe server you run.
- **The Astrolabe software we distribute:** the desktop app for macOS and Linux, and the command-line server, including the `@mercurian/astrolabe` package on npm and the downloads on Astrolabe's GitHub Releases page.

Mercurian doesn't offer accounts or other hosted services yet. If we do, we'll update these terms before they open.

You must be at least 18 to use them. If you use Astrolabe for an organization, you accept these terms for it and confirm you have the authority to do so.

## 2. Open source comes first

Astrolabe is open source. Its code is licensed under the MIT License, apart from a few directories under the Functional Source License (FSL-1.1-MIT). The [Licenses](/licenses) page says which license covers what.

Those licenses give you their rights directly, and nothing in these terms takes any of them away. If these terms and an open-source license conflict, the license wins for the code it covers. Builds you make from source, and forks others make, are governed by the licenses alone.

The licenses cover code, not names. "Astrolabe" and "Mercurian" and their logos are Mercurian's trademarks; the [trademark policy](https://github.com/mercurian-labs/astrolabe/blob/main/TRADEMARKS.md) says how you can use them.

## 3. Your AI providers

Astrolabe runs AI coding agents from providers you choose, such as Anthropic, OpenAI and Cursor, using your own subscriptions, API keys or accounts.

- **Your agreement with each provider governs your use of it.** You must follow that provider's terms and usage policies, including its rules about using a subscription through other apps.
- **Keep your subscription to yourself.** Don't use Astrolabe to let other people run turns on your personal plan, for example by giving a teammate access to a server signed in to your account, or to run turns on someone else's plan, unless that provider's terms allow it.
- **Providers change their rules.** A provider may restrict, re-price or end your use of its service through Astrolabe. If that happens, you may need a different sign-in method, such as an API key, or a different provider.
- **Mercurian isn't part of that agreement.** We don't resell or pay for your usage, and we aren't responsible for a provider's availability, charges, data retention or training.
- **No endorsement.** No AI provider endorses Astrolabe. Their names are their owners' trademarks, used only to say what Astrolabe works with.

Some parts of what Astrolabe installs aren't open source. For example, it uses Anthropic's Claude Agent SDK, which is subject to [Anthropic's own terms](https://code.claude.com/docs/en/legal-and-compliance).

## 4. Agents act on your machine

Agents in Astrolabe don't just write text. They act.

- **What agents can do.** An agent can read and change files, run commands, use the network, use your saved credentials and signed-in browser sessions, and act on websites and services. It acts with the permissions of the user account that runs the Astrolabe server.
- **Permission modes.** You choose how much an agent may do without asking: Supervised, Auto-accept edits, Auto or Full access. In Full access, agents run commands and change files without asking first. New threads start in Full access unless you choose another default in Settings → General → Permissions.
- **Astrolabe doesn't sandbox agents.** Any approval prompts or sandbox come from the provider's own agent and the mode you choose. Full access removes them.
- **Agents can start without you at the keyboard.** A device you've paired, a scheduled task, a webhook or an outside agent you approve can start a turn. It runs on your machine with the same permissions.
- **You are responsible for what your agents do,** at your direction or under the modes and settings you choose, including what they send or publish on your behalf. Their output and actions can be wrong, insecure or different from what you intended. Review them before you rely on, publish or deploy them.

Use version control, keep backups, and run agents on untrusted code in an isolated environment, such as a container or a separate machine.

## 5. Using our websites

Don't use our websites to break the law, to attack or overload them or anyone else, or to get access to machines or data you aren't authorized to reach. Good-faith security research is welcome; report what you find to [security@mercurian.ai](mailto:security@mercurian.ai).

app.astrolabe.sh connects your browser to an Astrolabe server whose address you give it. Connect it only to servers you are allowed to use.

## 6. Feedback

If you send us ideas or feedback, we may use them without owing you anything.

## 7. Disclaimer

The websites and the software are provided "as is" and "as available", without warranties of any kind. To the extent the law allows, we disclaim all warranties, including merchantability, fitness for a particular purpose and non-infringement. We don't promise that they will be uninterrupted, secure or free of errors, that agents' output or actions will be correct, or that any AI provider will keep working with Astrolabe.

## 8. Limits on liability

To the extent the law allows:

- Mercurian isn't liable for indirect, incidental, special, consequential or punitive damages, or for lost profits, revenue or data.
- Mercurian isn't liable for actions agents take under the modes and settings you chose, or for charges from your AI providers.
- Mercurian's total liability for all claims about these terms, the websites or the software is limited to the greater of US$100 or what you paid Mercurian in the 12 months before the claim arose.

Nothing in these terms excludes or limits any liability, or any of your rights as a consumer, that the law doesn't allow to be excluded or limited, such as liability for fraud, or for death or personal injury caused by negligence. This applies to the warranty disclaimer in section 7 too.

## 9. Governing law

These terms are governed by the laws of the State of Delaware, and disputes about them go to the state or federal courts there. There's no arbitration clause.

If you live in the EU or the UK, you keep the protections of your local consumer law, and you can bring claims in your local courts.

## 10. Changes and general terms

- We'll post every change to these terms here with a new date. Earlier versions stay in Astrolabe's public repository. If you keep using the websites or the software we distribute after a change takes effect, the new terms apply.
- If a court finds part of these terms unenforceable, the rest still applies. If we don't enforce a term right away, we haven't given up the right to enforce it later.
- We may transfer these terms if Mercurian merges or is acquired.
- You must follow the export control and sanctions laws that apply to you.

## 11. Contact

Mercurian, Inc.<br>
[legal@mercurian.ai](mailto:legal@mercurian.ai)

See also our [Privacy Policy](/privacy-policy) and [Licenses](/licenses).
