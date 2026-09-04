# Trackers

If your backlog lives in an external issue tracker, connect it and its issues can become the
starting points of threads. Connections are made and managed in **Settings → Trackers**; the issues
themselves never arrive through Settings.

Mercurian only reads. Importing pulls from the tracker, and nothing you do in Mercurian is ever
written back to it — no status changes, no comments, no new issues.

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

## Connecting Jira

Jira connections support Jira Cloud. Jira Server and Jira Data Center use different authentication
and are not supported.

1. At [id.atlassian.com](https://id.atlassian.com/manage-profile/security/api-tokens), open
   **Security → Create and manage API tokens** and create an API token.
2. In Mercurian, go to **Settings → Trackers**, press **Connect tracker**, and choose **Jira**.
3. Enter your Atlassian site (for example, `acme.atlassian.net`), the email address for your
   Atlassian account, and the API token, then press **Connect**.

Mercurian checks both the site and the credentials before saving anything. Once accepted, the
connection is named after the Jira site it reaches. The site, email, and token are kept together in
the server's protected secret store and are never shown again.

## Connecting GitHub

1. In GitHub, open **Settings → Developer settings → Personal access tokens** and create either a
   classic token with the `repo` scope or a fine-grained token with read access to repository
   metadata and issues for the repositories you want to browse.
2. In Mercurian, go to **Settings → Trackers**, press **Connect tracker**, and choose
   **GitHub Issues**.
3. Paste the token and press **Connect**.

The connection is named after the GitHub account the token authenticates as. Browsing covers your
repositories and your organizations' repositories. Repositories you can reach only as an outside
collaborator are not included. Pull requests never appear, and issue ids include their repository —
for example, `owner/repo#123`.

## Connecting GitLab

1. In GitLab, open **Preferences → Access tokens** and create a personal access token with the
   `read_api` scope.
2. In Mercurian, go to **Settings → Trackers**, press **Connect tracker**, and choose **GitLab**.
3. Paste the token. For gitlab.com, leave **GitLab host** empty. For a self-hosted instance, enter
   its host, such as `gitlab.example.com`, then press **Connect**.

The connection is named after the GitLab username the token authenticates as. Self-hosted
connections also show their host — for example, `alex · gitlab.example.com` — so connections to
different GitLab instances are easy to tell apart. Browsing covers issues across the projects you
are a member of — up to your twenty most active projects — not every public project the token could
technically read; search narrows within them. Issue ids include their full project path, such as
`group/project#31`, so the same issue number in two projects stays distinct. Merge requests never
appear.

## Connecting Azure DevOps

Azure DevOps connections support Azure DevOps Services at dev.azure.com. On-premises Azure DevOps
Server is not supported.

1. In Azure DevOps, open **User settings → Personal access tokens** and create a personal access
   token with the **Work Items (Read)** scope.
2. In Mercurian, go to **Settings → Trackers**, press **Connect tracker**, and choose
   **Azure DevOps**.
3. Enter the organization name from `dev.azure.com/<organization>` — for example, `acme` — and
   paste the token, then press **Connect**.

The connection is named after the organization. Work items are the issues that cross into
Mercurian, and their ids are their Azure DevOps work item numbers. Browsing covers the projects the
token can reach across the organization and pages through the 1000 most recently changed matches;
search narrows that set. Azure DevOps rich-text descriptions arrive as plain text.

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

Importing starts in the search palette, not in the draft composer or Settings. With nothing typed,
choose **Import from a tracker** beside **New thread**. Unless you are already inside one of a
project's threads, the palette first asks which project to **Import into**; inside one, it opens the
tracker picker for that project immediately.

The dialog browses your connected trackers. Pick a connection if you have more than one, type to
search, and press **Load more** to page further — the search goes to the tracker, which is the only
thing that knows how to search its own backlog. Every issue on screen was fetched just now and is
kept nowhere: close the dialog and it is gone. Nothing is stored until you import.

Select an issue and press **Import**. The thread exists immediately, appears under its project, and
takes the issue's title. The issue title becomes the Spec's **Goal / user story**, and the issue
description becomes its **Acceptance criteria**. Together they form the thread's root **Spec**
revision: the contract the thread is planned from.

Three things follow from importing rather than starting blank:

- **The thread is shared from the start.** The issue having a thread is not a private fact, so the
  thread and the imported Spec are published as soon as they exist. Everything you add afterwards is
  a private draft until you publish it. Because something is published from birth, an imported thread
  can only be archived, never deleted.
- **The Plan is empty.** The issue is what the thread is planned _from_, not the Plan itself, so the
  Plan artifact starts blank and the assistant fills it in.
- **The thread has no repositories yet.** Which code the work touches is something the thread works
  out, not something importing decides.

### Importing the same issue twice

You cannot end up with two threads for one issue. Importing an issue you have already imported takes
you to its thread and says **This issue already has a thread**. If that thread had been archived, importing brings it
back out of the archive, in the place in the list it had before.

That link is to a specific connection. If you disconnect a tracker and connect the same workspace
again, the new connection is a new starting point, and importing an issue through it starts a new
thread.

Issues are not synchronized after import — the Spec records the issue as it read when imported.

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
your workspace. Nothing in the tracker is touched, and threads that started from its issues are
unaffected — they are yours, and they keep their link back.
