# Guest threads

Another thread can visit a thread's workspace as a tab beside the **Main Thread**.
It keeps its own conversation, composer and header, and works in its own
checkout. The tab label is the guest's title, plus where it works when that
differs from the host. A guest can leave and become the host of its own workspace.

## Sub-features

- **Open a guest from the New tab menu**: `+` → **Thread** → pick a thread. It
  offers recent threads not already here.
- **Drag a thread from the sidebar** onto a pane: it joins as a guest there.
- **Thread details toggle** per conversation: each conversation in front, the
  host's or a guest's, carries its own toggle at the end of its header row.
- **Open in its own workspace** (right-click a guest tab): a dialog titled
  "Open <thread> in its own workspace" offers the host and the other guests as
  companions, all checked. **Open workspace** navigates to the guest's thread
  with the kept companions as guests there. The workspace it left is unchanged.
- **Close** a guest tab: the guest leaves, and its thread is untouched.

## How to get to it (user POV)

Open a thread, press `+` in a strip, and choose **Thread**. Or drag a thread row
from the sidebar into the main area.

## Driving it with the Browser panel

Needs at least two real threads. A clean home has only one draft, so seed with
`vp run migrate-dev-db` (server stopped) into the worktree's `.t3`.

```
preview_click  role=button[name='New tab']
preview_click  role=menuitem[name='Thread']
preview_click  role=menuitem[name=/<guest title>/]
preview_drag   source=role=button[name='<title>, <project>']  target=role=tab[name='Main Thread']
preview_click  role=button[name='Toggle thread details panel'] >> visible=true
preview_click  role=tab[name=/<guest title>/]  button=right
preview_click  role=button[name='Open in its own workspace']
preview_click  role=button[name='Open workspace']
```

**Proof:** the stored arrangement (see panes.md) holds a tab key
`guest:<URI-encoded scoped thread key>`. After **Open workspace**, the URL is
the guest's thread, its strip shows the companions as guest tabs, and the
original thread's stored `.root` is unchanged. Compare `.root`, not the whole
value: right-clicking a tab moves `focused`. Closing the last guest returns the
arrangement to the default and deletes its key.

## Gotchas

- Pairing lands on a draft in the **server** project. Open a real thread first
  by clicking its sidebar row, `role=button[name='<title>, <project>']`.
- The Thread submenu offers recent threads, leaving out the host and current
  guests. The guest context menu also lists "Open in Cursor".
- Arrangements are per device. A guest added in one browser profile is not
  seen in another.
