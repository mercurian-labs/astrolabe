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
