# Astrolabe feature map

Astrolabe's own user-facing features, the parts upstream T3 Code does not have.
Everything else verifies through [test-t3-app](../../test-t3-app/SKILL.md).
Each file covers what the feature is, how a user reaches it, how to drive it in
the Browser panel, the end state that proves it, and the source files it owns.

| Feature                          | File                                     | Owns                                                                                             |
| -------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Tabs and splits in the main area | [panes.md](panes.md)                     | `apps/web/src/panes/`                                                                            |
| Guest threads                    | [guest-threads.md](guest-threads.md)     | `apps/web/src/panes/guestWorkspace.ts`, `GuestWorkspaceDialog.tsx`                               |
| Thread header in the tab strip   | [thread-header.md](thread-header.md)     | `PaneChatHeader.tsx`, `ChatView.tsx`, `ThreadRouteView.tsx`                                      |
| Sidebar header                   | [sidebar-header.md](sidebar-header.md)   | `components/sidebar/SidebarChrome.tsx`, `SidebarThreadHeader.tsx`, `Sidebar.tsx`                 |
| Mercurian theme and branding     | [theme-and-brand.md](theme-and-brand.md) | `packages/shared/src/mercurianTheme.ts`, `components/brand/`, `ThemeSettings.tsx`, `useTheme.ts` |

When a sync conflicts in one of the owned files, or when upstream rewrote what
an owned file wraps (ChatView, the right panel, the sidebar), walk that feature
before the others.
