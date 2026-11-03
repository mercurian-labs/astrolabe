import {
  CircleAlertIcon,
  FileDiffIcon,
  GitBranchIcon,
  ListTreeIcon,
  SearchIcon,
  WaypointsIcon,
} from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";

import { appAtomRegistry } from "~/rpc/atomRegistry";
import { reviewEnvironment } from "~/state/review";
import { useTheme } from "~/hooks/useTheme";
import type { PaneTabLabel } from "~/panes/panesHost";
import {
  useListedProjectWorktrees,
  useProjectWorktrees,
  type WorktreesTarget,
} from "~/state/worktrees";
import { PierreEntryIcon } from "../chat/PierreEntryIcon";
import { getProjectFileQueryAtom } from "../files/projectFilesQueryState";
import { Button } from "../ui/button";

import { diffPreviewInput, RepositoryDiffView } from "./RepositoryDiffView";
import { RepositoryFileView } from "./RepositoryFileView";
import {
  checkoutName,
  fileName,
  holderOf,
  parseRepositoryTabKey,
  type CheckedOutRepositoryTab,
  type CheckoutRepositoryTab,
  type RepositoryTab,
} from "./repositoryTabs";
import { locationList } from "./multibuffer/openMultibuffer";
import { useOpenBranch } from "./worktreeActions";
import { WorktreeNumber } from "./WorktreeNumber";
import { useNumberWhenOpened } from "./worktreeNumbering";

/** The worktrees a tab's checkout is among: its project's, or its wiki's. */
const worktreesOf = (tab: RepositoryTab): WorktreesTarget =>
  "wikiId" in tab
    ? { environmentId: tab.environmentId, wikiId: tab.wikiId }
    : { environmentId: tab.environmentId, projectId: tab.projectId };

// The local graph's renderer loads with its first tab, never with Repositories itself.
const RepositoryGraphView = lazy(() => import("./RepositoryGraphView"));
// The multi-file views load with their first tab.
const RepositorySearchView = lazy(() =>
  import("./multibuffer/RepositoryMultibufferViews").then((module) => ({
    default: module.RepositorySearchView,
  })),
);
const RepositoryProblemsView = lazy(() =>
  import("./multibuffer/RepositoryMultibufferViews").then((module) => ({
    default: module.RepositoryProblemsView,
  })),
);
const RepositoryLocationsView = lazy(() =>
  import("./multibuffer/RepositoryMultibufferViews").then((module) => ({
    default: module.RepositoryLocationsView,
  })),
);

/** A file, a checkout's changes, a file's local graph, or a multi-file view. */
export function RepositoryTabView({
  tabKey,
  tab,
}: {
  readonly tabKey: string;
  readonly tab: RepositoryTab;
}) {
  switch (tab.kind) {
    case "search":
      return (
        <Suspense fallback={null}>
          <RepositorySearchView tabKey={tabKey} tab={tab} />
        </Suspense>
      );
    case "problems":
      return (
        <Suspense fallback={null}>
          <RepositoryProblemsView tabKey={tabKey} tab={tab} />
        </Suspense>
      );
    case "locations":
      return (
        <Suspense fallback={null}>
          <RepositoryLocationsView tabKey={tabKey} tab={tab} />
        </Suspense>
      );
  }
  return (
    <CheckedOut tab={tab}>
      {(checkedOut) =>
        checkedOut.kind === "file" ? (
          <RepositoryFileView tabKey={tabKey} tab={checkedOut} />
        ) : checkedOut.kind === "diff" ? (
          <RepositoryDiffView tabKey={tabKey} tab={checkedOut} />
        ) : (
          <Suspense fallback={null}>
            <RepositoryGraphView tabKey={tabKey} tab={checkedOut} />
          </Suspense>
        )
      }
    </CheckedOut>
  );
}

/**
 * A branch's tab reads the worktree that holds the branch now. When none does, it says so and
 * offers to open the branch, rather than show a folder that has since taken another branch.
 */
function CheckedOut({
  tab,
  children,
}: {
  readonly tab: CheckoutRepositoryTab;
  readonly children: (tab: CheckedOutRepositoryTab) => ReactNode;
}) {
  const worktrees = useProjectWorktrees(worktreesOf(tab));
  const openBranch = useOpenBranch();
  const [opening, setOpening] = useState(false);
  const { checkout } = tab;
  const holder = worktrees ? holderOf(worktrees.worktrees, checkout) : null;
  const cwd = "cwd" in checkout ? checkout.cwd : (holder?.path ?? null);
  const revision = holder?.head ?? null;
  useNumberWhenOpened(worktreesOf(tab), holder);
  const seen = useRef({ cwd, revision });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a reused worktree changes files under the same folder; its new commit re-reads what this tab shows
  useEffect(() => {
    const before = seen.current;
    seen.current = { cwd, revision };
    if (cwd === null || before.cwd !== cwd || before.revision === revision) return;
    if (tab.kind === "file") {
      appAtomRegistry.refresh(getProjectFileQueryAtom(tab.environmentId, cwd, tab.path));
    } else if (tab.kind === "diff") {
      appAtomRegistry.refresh(
        reviewEnvironment.diffPreview({
          environmentId: tab.environmentId,
          input: diffPreviewInput(cwd, tab.base),
        }),
      );
    }
  }, [cwd, revision, seen, tab]);
  if (cwd !== null) return children({ ...tab, cwd, checkoutName: checkoutName(checkout, holder) });
  if (worktrees === null || "cwd" in checkout) return null;
  const named = checkout.branch;
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground">
      <p role="status">{named} is not checked out in any worktree.</p>
      <Button
        size="sm"
        variant="outline"
        disabled={opening}
        onClick={async () => {
          setOpening(true);
          await openBranch(worktreesOf(tab), named);
          setOpening(false);
        }}
      >
        <GitBranchIcon />
        {opening ? "Opening…" : `Open ${named}`}
      </Button>
    </div>
  );
}

/**
 * A repository tab's title and icon, a file's name, a checkout's changes or a local graph, with the
 * number of the worktree holding it now; hovering it names the checkout.
 */
export function useRepositoryTabLabel(tabKey: string): PaneTabLabel | null {
  const tab = parseRepositoryTabKey(tabKey);
  const listed = useListedProjectWorktrees(tab === null ? null : worktreesOf(tab));
  const { resolvedTheme } = useTheme();
  if (tab === null) return null;
  switch (tab.kind) {
    case "search":
      return {
        title: `Search: ${tab.search.query}`,
        icon: <SearchIcon className="size-3.5 shrink-0" />,
      };
    case "problems":
      return { title: "Problems", icon: <CircleAlertIcon className="size-3.5 shrink-0" /> };
    case "locations":
      return {
        title: locationList(tab.id)?.title ?? "Places",
        icon: <ListTreeIcon className="size-3.5 shrink-0" />,
      };
  }
  const holder = listed ? holderOf(listed.worktrees, tab.checkout) : null;
  const label =
    tab.kind === "graph"
      ? {
          title: tab.path === null ? "Local graph" : `Local graph · ${fileName(tab.path)}`,
          icon: <WaypointsIcon className="size-3.5 shrink-0" />,
        }
      : tab.kind === "file"
        ? {
            title: fileName(tab.path),
            icon: (
              <PierreEntryIcon
                pathValue={tab.path}
                kind="file"
                theme={resolvedTheme}
                className="size-3.5"
              />
            ),
          }
        : {
            title:
              tab.source === "working-tree"
                ? "Uncommitted changes"
                : tab.base === undefined
                  ? "Branch changes"
                  : `Against ${tab.base}`,
            icon: <FileDiffIcon className="size-3.5 shrink-0" />,
          };
  const place =
    holder === null
      ? listed === null
        ? null
        : "not in a worktree"
      : holder.number === null
        ? "main checkout"
        : `worktree ${holder.number}`;
  return {
    ...label,
    ...(holder?.number ? { trailing: <WorktreeNumber number={holder.number} /> } : {}),
    tooltip: (
      <div className="flex flex-col">
        <span className={tab.kind === "file" ? "font-mono" : undefined}>
          {tab.kind === "file" ? tab.path : label.title}
        </span>
        <span className="text-muted-foreground">
          {[checkoutName(tab.checkout, holder), place].filter(Boolean).join(" · ")}
        </span>
      </div>
    ),
  };
}
