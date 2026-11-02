import { FileCodeIcon, FileDiffIcon, WaypointsIcon } from "lucide-react";
import { lazy, Suspense, type ReactNode } from "react";

import { RepositoryDiffView } from "./RepositoryDiffView";
import { RepositoryFileView } from "./RepositoryFileView";
import { fileName, parseRepositoryTabKey, type RepositoryTab } from "./repositoryTabs";

// The local graph's renderer loads with its first tab, never with Repositories itself.
const RepositoryGraphView = lazy(() => import("./RepositoryGraphView"));

/** A file, a checkout's changes, or a file's local graph. */
export function RepositoryTabView({
  tabKey,
  tab,
}: {
  readonly tabKey: string;
  readonly tab: RepositoryTab;
}) {
  switch (tab.kind) {
    case "file":
      return <RepositoryFileView tabKey={tabKey} tab={tab} />;
    case "diff":
      return <RepositoryDiffView tab={tab} />;
    case "graph":
      return (
        <Suspense fallback={null}>
          <RepositoryGraphView tabKey={tabKey} tab={tab} />
        </Suspense>
      );
  }
}

/** A repository tab's title and icon: a file's name, a checkout's changes, or a local graph. */
export function repositoryTabLabel(tabKey: string): { title: string; icon: ReactNode } | null {
  const tab = parseRepositoryTabKey(tabKey);
  if (tab === null) return null;
  switch (tab.kind) {
    case "file":
      return { title: fileName(tab.path), icon: <FileCodeIcon className="size-3.5 shrink-0" /> };
    case "diff":
      return {
        title: tab.source === "working-tree" ? "Uncommitted changes" : "Branch changes",
        icon: <FileDiffIcon className="size-3.5 shrink-0" />,
      };
    case "graph":
      return {
        title: tab.path === null ? "Local graph" : `Local graph · ${fileName(tab.path)}`,
        icon: <WaypointsIcon className="size-3.5 shrink-0" />,
      };
  }
}
