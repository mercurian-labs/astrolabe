import type { ScopedThreadRef, ThreadPullRequestLink } from "@t3tools/contracts";
import { ArrowUpRightIcon, EyeIcon, EyeOffIcon, LinkIcon, PlusIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { writeTextToClipboard } from "~/hooks/useCopyToClipboard";
import { openThreadPullRequest } from "../changeRequests/groups/openThreadChangeRequests";
import { openLinkPullRequestDialog } from "../pullRequest/LinkPullRequestDialog";
import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import { useLinkedPullRequestActions } from "../pullRequest/useLinkedPullRequestActions";
import { Menu, MenuItem, MenuPopup, MenuSeparator } from "../ui/menu";

/**
 * Astrolabe: a linked pull request row's context menu in the thread details, holding what T3
 * Code's linked pull requests panel offered per row: open, copy, watch, unlink, and linking more.
 */
export function ThreadDetailsPrRowMenu({
  threadRef,
  link,
  children,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly link: ThreadPullRequestLink | null;
  readonly children: ReactNode;
}) {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const { unlink, setWatching } = useLinkedPullRequestActions(threadRef);
  if (link === null) return children;
  const open = link.snapshot === null || link.snapshot.state === "open";
  const watching = link.watch !== undefined;
  return (
    <div
      className="contents"
      onContextMenu={(event) => {
        // Before the details card's own menu, which lists what the card shows.
        event.preventDefault();
        event.stopPropagation();
        setPosition({ x: event.clientX, y: event.clientY });
      }}
    >
      {children}
      <Menu open={position !== null} onOpenChange={(next) => !next && setPosition(null)}>
        <MenuPopup
          anchor={
            position
              ? { getBoundingClientRect: () => new DOMRect(position.x, position.y, 0, 0) }
              : undefined
          }
          align="start"
          side="bottom"
        >
          <MenuItem onClick={() => openThreadPullRequest(threadRef, link)}>
            <ArrowUpRightIcon className="size-3.5" />
            Open
          </MenuItem>
          <MenuItem onClick={() => void writeTextToClipboard(link.url, "link")}>
            <LinkIcon className="size-3.5" />
            Copy link
          </MenuItem>
          {setWatching !== null && open ? (
            <MenuItem onClick={() => setWatching(link, !watching)}>
              {watching ? <EyeOffIcon className="size-3.5" /> : <EyeIcon className="size-3.5" />}
              {watching ? "Stop watching" : "Watch for changes"}
            </MenuItem>
          ) : null}
          <MenuItem onClick={() => unlink(link)}>
            <PullRequestGlyph.unlink className="size-3.5" />
            {link.source === "stack" ? "Dismiss from thread" : "Unlink from thread"}
          </MenuItem>
          <MenuSeparator />
          <MenuItem onClick={() => openLinkPullRequestDialog(threadRef)}>
            <PlusIcon className="size-3.5" />
            Link pull request
          </MenuItem>
        </MenuPopup>
      </Menu>
    </div>
  );
}
