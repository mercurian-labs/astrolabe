# Astrolabe feature map

Astrolabe's own user-facing features, the parts upstream T3 Code does not have.
Everything else verifies through [test-t3-app](../../test-t3-app/SKILL.md).
Each file covers what the feature is, how a user reaches it, how to drive it in
the Browser panel, the end state that proves it, and the source files it owns.

| Feature                            | File                                     | Owns                                                                                                                                                                                                                                                                                                                |
| ---------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chat tabs                          | [chat-tabs.md](chat-tabs.md)             | `apps/web/src/chatTabs/`, `panes/PaneChatHeader.tsx`                                                                                                                                                                                                                                                                |
| Tabs and splits in the right panel | [panes.md](panes.md)                     | `apps/web/src/panes/`, the panel hooks in `ChatView.tsx`, `ThreadPanesProvider` in `chatTabs/ChatTabs.tsx`, `RightPanelTabs.tsx` (launcher, titles)                                                                                                                                                                 |
| Sidebar header and icon rail       | [sidebar-header.md](sidebar-header.md)   | `components/sidebar/AppIconRail.tsx`, `AppSidebarLayout.tsx`, `components/sidebar/SidebarChrome.tsx`, `SidebarThreadHeader.tsx`, `Sidebar.tsx`, `sidebar/mainAppLocation.ts`, `pullRequest/PullRequestsSidebar.tsx`                                                                                                 |
| Wikis                              | [wikis.md](wikis.md)                     | `apps/web/src/components/wiki/`, `routes/_chat.wikis*.tsx`, `sidebar/SidebarCard.tsx`, `panes/panesHost.ts`                                                                                                                                                                                                         |
| Mercurian theme and branding       | [theme-and-brand.md](theme-and-brand.md) | `packages/shared/src/mercurianTheme.ts`, `components/brand/`, `ThemeSettings.tsx`, `useTheme.ts`, `apps/web/index.html`, `index.css` (pivot), `branding.ts`                                                                                                                                                         |
| Vim mode                           | [vim-mode.md](vim-mode.md)               | `packages/editor/src/vim.ts`, `shared/src/vimrc.ts`, `server/src/vimrc.ts`, `settings/VimrcSettings.tsx`, `components/composerCodeMirror/`, `settings/VimModeSetting.tsx`, `settings/vimQuitGate.ts`, `settings/KeybindingsDeviceSettings.tsx` (Vim), `editorKeybindings.ts`, `wiki/WikiNoteEditor.tsx`             |
| Keyboard menu and leader key       | [which-key.md](which-key.md)             | `apps/web/src/whichKey/`, `commandPaletteBus.ts`, `panes/paneCommands.ts`, `sidebar/AppIconRail.tsx` (`useAppSections`), `settings/KeybindingsDeviceSettings.tsx` (leader), `settings/KeybindingTrigger*`, `settings/KeybindingsTable*`, `packages/shared/src/keybindingTriggers.ts`, the server keybindings config |

The panes engine is shared: a change in `panes/` walks panes.md and wikis.md. The
keyboard menu calls into chat tabs, panes, the sidebar and Wikis, so after any of
those changes walk which-key.md's flows too; vim-mode.md's flows cross the composer,
notes and the palette.

When a sync conflicts in one of the owned files, or when upstream rewrote what
an owned file wraps (ChatView's header and right panel, the sidebar), walk that feature
before the others.
