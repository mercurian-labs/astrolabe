import { threadPullRequestKeyOf } from "@t3tools/client-runtime/thread-pull-requests";
import type { ScopedThreadRef, ThreadPullRequestLink } from "@t3tools/contracts";
import { ArrowUpRightIcon, EyeIcon, EyeOffIcon, LinkIcon } from "lucide-react";

import { writeTextToClipboard } from "~/hooks/useCopyToClipboard";
import { openThreadPullRequest } from "../changeRequests/groups/openThreadChangeRequests";
import {
  ADDON_ICON_CLASS,
  ITEM_ICON_CLASS,
  type CommandPaletteActionItem,
  type CommandPaletteSubmenuItem,
} from "../CommandPalette.logic";
import { PullRequestGlyph } from "./pullRequestIcons";
import type { useLinkedPullRequestActions } from "./useLinkedPullRequestActions";

/**
 * Astrolabe: the command palette's way to each of a thread's linked pull requests, one group per
 * pull request with what T3 Code's linked pull requests panel offered on its row.
 */
export function linkedPullRequestsSubmenu(
  threadRef: ScopedThreadRef,
  links: ReadonlyArray<ThreadPullRequestLink>,
  actions: ReturnType<typeof useLinkedPullRequestActions>,
): CommandPaletteSubmenuItem {
  return {
    kind: "submenu",
    value: "action:manage-thread-pull-requests",
    searchTerms: ["pull requests", "linked", "unlink", "watch", "copy", "prs"],
    title: "Manage linked pull requests...",
    icon: <PullRequestGlyph.link className={ITEM_ICON_CLASS} />,
    addonIcon: <PullRequestGlyph.link className={ADDON_ICON_CLASS} />,
    groups: links.map((link) => {
      const key = threadPullRequestKeyOf(link);
      const name = `#${link.number}`;
      const terms = [name, link.snapshot?.title ?? link.repository];
      const open = link.snapshot === null || link.snapshot.state === "open";
      const watching = link.watch !== undefined;
      const item = (
        action: string,
        title: string,
        icon: CommandPaletteActionItem["icon"],
        run: () => void,
      ): CommandPaletteActionItem => ({
        kind: "action",
        value: `linked-pull-request:${key}:${action}`,
        searchTerms: [...terms, title],
        title,
        icon,
        run: async () => run(),
      });
      return {
        value: `linked-pull-request:${key}`,
        label: `${name} ${link.snapshot?.title ?? link.repository}`,
        items: [
          item("open", `Open ${name}`, <ArrowUpRightIcon className={ITEM_ICON_CLASS} />, () =>
            openThreadPullRequest(threadRef, link),
          ),
          item("copy", `Copy link to ${name}`, <LinkIcon className={ITEM_ICON_CLASS} />, () => {
            void writeTextToClipboard(link.url, "link");
          }),
          ...(actions.setWatching !== null && open
            ? [
                item(
                  "watch",
                  watching ? `Stop watching ${name}` : `Watch ${name} for changes`,
                  watching ? (
                    <EyeOffIcon className={ITEM_ICON_CLASS} />
                  ) : (
                    <EyeIcon className={ITEM_ICON_CLASS} />
                  ),
                  () => actions.setWatching?.(link, !watching),
                ),
              ]
            : []),
          item(
            "unlink",
            link.source === "stack" ? `Dismiss ${name} from thread` : `Unlink ${name} from thread`,
            <PullRequestGlyph.unlink className={ITEM_ICON_CLASS} />,
            () => actions.unlink(link),
          ),
        ],
      };
    }),
  };
}
