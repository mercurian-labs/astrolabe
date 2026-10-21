# Astrolabe feature map

Astrolabe's own user-facing features, the parts upstream T3 Code does not have.
Everything else verifies through [test-t3-app](../../test-t3-app/SKILL.md).
Each file covers what the feature is, how a user reaches it, how to drive it in
the Browser panel, the end state that proves it, and the source files it owns.

| Feature                            | File                                     | Owns                                                                                                                                           |
| ---------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Chat tabs                          | [chat-tabs.md](chat-tabs.md)             | `apps/web/src/titlebarTabs/`, `apps/web/src/chatTabs/`, `panes/PaneChatHeader.tsx`                                                             |
| Settings tabs                      | [settings-tabs.md](settings-tabs.md)     | `apps/web/src/settingsTabs/`, `titlebarTabs/`, `routes/settings.tsx`                                                                           |
| Tabs and splits in the right panel | [panes.md](panes.md)                     | `apps/web/src/panes/`, the panel hooks in `ChatView.tsx`                                                                                       |
| Sidebar header and icon rail       | [sidebar-header.md](sidebar-header.md)   | `components/sidebar/AppIconRail.tsx`, `AppSidebarLayout.tsx`, `components/sidebar/SidebarChrome.tsx`, `SidebarThreadHeader.tsx`, `Sidebar.tsx` |
| Mercurian theme and branding       | [theme-and-brand.md](theme-and-brand.md) | `packages/shared/src/mercurianTheme.ts`, `components/brand/`, `ThemeSettings.tsx`, `useTheme.ts`                                               |

When a sync conflicts in one of the owned files, or when upstream rewrote what
an owned file wraps (ChatView's header and right panel, the sidebar), walk that feature
before the others.
