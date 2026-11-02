# T3code Settings

The settings surface of t3code, the shell this design adapts — documented as built, verified against the t3code repository, in product terms. Nothing here is settled Mercurian design; the reconciliation lives on [[Settings]]. The navigation around settings is [[T3code Sidebar]]; the threads its pages govern are [[T3code Thread]].

## Shape

Settings is a place you go, not a dialog: entering it replaces the main screen, and the sidebar yields its panel to settings navigation until you leave ([[T3code Sidebar]]). Six pages: **General**, **Keybindings**, **Providers**, **Source Control**, **Connections**, and **Archive**; the signed-in account sits in the settings sidebar's footer. Every row knows its own default: a setting you've changed carries a reset affordance, so drift from stock is always visible and reversible row by row.

## General

One page of workspace-wide defaults:

- **Appearance and reading** — theme, time format, word wrap in code and diffs, whether diffs hide whitespace-only changes by default, and whether assistant output streams token by token.
- **Working defaults** — whether a new thread starts in the project's main checkout or an isolated worktree, and, when worktrees, whether a new worktree starts **from the latest matching branch on origin instead of your local branch**; the directory the add-project browser opens in; whether the plan panel opens itself when steps appear; whether installed provider CLIs are checked for newer versions.
- **Guard rails** — **archive confirmation** (require a second click on the inline archive action before a thread is archived) and **delete confirmation** (ask before deleting a thread and its history). Both are optional gates; the actions they gate are on [[T3code Sidebar]]'s thread rows.
- **Glue** — the **text generation model**: which provider instance and model writes generated Git text such as commit messages and PR titles (the quiet selection [[T3code Providers]] keeps apart from thread models).

An About section carries the version, the update track, and diagnostics.

## Keybindings

Every shortcut is rebindable, with the whole binding table on one page; when two bindings could both apply, the most recently made one wins.

## Providers

Where coding agents are connected — the settings face of the provider/instance/model pattern documented in full on [[T3code Providers]]. Each provider has a default instance that can be reset but never removed; custom instances are added here by a short wizard and can be deleted. An instance card shows live status and who it's authenticated as, and offers enable/disable, an accent color, per-instance variables for keys or endpoints (write-only once saved), and curation of the instance's model list — hide, favorite, reorder — which shapes what the composer's model picker offers ([[T3code Thread View]]). An instance whose agent has a newer version wears an update nudge with a one-click update.

## Source Control

Discovery you review rather than configuration you author: the page scans the environment for version control (Git, with a fetch-interval setting) and for hosting integrations and credentials, shows each finding with its status, and offers a rescan. Documented in full — add paths, probing, the gate-nothing toggles, provider-from-remotes — on [[T3code Source Control]].

## Connections

The environments page — t3code's environments-as-first-class stance made visible (the stance Mercurian's [[Environments]] declines). It gathers: an account plus a tunnel that makes this environment reachable from your other devices, and a switch to publish agent activity to mobile clients for notifications; pairing links, scannable to open the environment on another device; this environment's administrative state — authorized clients, version drift, access level; **remote environments** — pair another machine by host and pairing code or over SSH, each listed and removable; and platform particulars like network access, HTTPS, and a Windows/WSL backend choice.

## Archive

Archived threads, grouped by project, newest first — each restorable with one click, with permanent delete (confirm-gated) alongside. This page is the other half of archiving's reversibility: archiving removes a thread from the sidebar ([[T3code Sidebar]]), and this is where it comes back.
