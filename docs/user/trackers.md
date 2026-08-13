# Trackers

If your backlog lives in an external issue tracker, connect it and its issues can become the
starting points of plans. Connections are made and managed in **Settings → Trackers**; the issues
themselves never arrive through Settings.

Mercurian only reads. Importing and refreshing pull from the tracker, and nothing you do in
Mercurian is ever written back to it — no status changes, no comments, no new issues.

## Connecting Linear

1. In Linear, open **Settings → Security & access** and create a personal API key.
2. In Mercurian, go to **Settings → Trackers** and press **Connect tracker**.
3. Paste the key and press **Connect**.

The key is checked against Linear before anything is saved, so a mistyped or expired key is
refused on the spot and leaves nothing behind. Once it is accepted, the connection appears in the
list, named after the Linear workspace the key reaches.

The key is stored on the machine running your Mercurian server, in the same protected place the
server keeps its other secrets. It is never shown again — not in the list, not anywhere else.

You can connect more than one tracker workspace. Each connection is its own row with its own key.

## What crosses over

Whatever the tracker, an issue arrives as exactly five things:

- its **id** — the key you would say out loud, like `M-98`
- its **title**
- its **description**
- a **link back** to the issue in the tracker
- its **status**, in the tracker's own words

Labels, assignees, sprints, priorities and everything else stay in the tracker, one click away
through the link. Mercurian is where issues get planned; it is not a second copy of your tracker.

## Importing an issue

Importing happens where plans start, not in Settings. Hover a project in the sidebar, press
**new plan**, and the empty composer offers **Import from a tracker**.

The dialog browses your connected trackers. Pick a connection if you have more than one, type to
search, and press **Load more** to page further — the search goes to the tracker, which is the only
thing that knows how to search its own backlog. Every issue on screen was fetched just now and is
kept nowhere: close the dialog and it is gone. Nothing is stored until you import.

Select an issue and press **Import**. The plan exists immediately, appears under its project, and
takes the issue's title. The issue's title and description become the plan's root **spec** revision:
the contract the plan is planned from.

Three things follow from importing rather than starting blank:

- **The plan is shared from the start.** The issue having a plan is not a private fact, so the plan
  and the imported spec are published as soon as they exist. Everything you add afterwards is a
  private draft until you publish it. Because something is published from birth, an imported plan
  can only be archived, never deleted.
- **The plan is empty.** The issue is what you plan _from_, not the plan itself, so the plan
  document starts blank and you fill it in.
- **The plan has no repositories yet.** Which code the work touches is something planning works
  out, not something importing decides.

### Importing the same issue twice

You cannot end up with two plans for one issue. Importing an issue you have already imported takes
you to the plan it already has and says so. If that plan had been archived, importing brings it
back out of the archive, in the place in the list it had before.

That link is to a specific connection. If you disconnect a tracker and connect the same workspace
again, the new connection is a new starting point, and importing an issue through it starts a new
plan.

Issues are not synchronized in the background. In the plan's **Spec** pane, **Refresh from issue**
performs one explicit live read. If only the issue changed, its new content lands as a spec revision
on the current path and the assistant absorbs it into the existing plan. If the local spec and the
issue both changed, nothing is overwritten: a reconciliation shows the base, local, and upstream
documents. Choose local, upstream, or edit a resolution, then confirm to land one reconciliation
revision. An unchanged issue writes nothing.

## Connection status

Each connection shows where it stands right now:

- **Connected** — the tracker is answering.
- **Key rejected** — the tracker is no longer accepting this key, usually because it was revoked or
  expired. Disconnect and connect again with a new one.
- **Unreachable** — the tracker could not be reached. This usually clears on its own.

There is no refresh button because there is nothing to refresh: the status is checked against the
tracker as the page reads it, so a key revoked in the tracker shows up here within a minute.

## Disconnecting

Press **Disconnect** on a connection and confirm. The connection and its API key are removed from
your workspace. Nothing in the tracker is touched, and plans that started from its issues are
unaffected — they are yours, and they keep their link back.
