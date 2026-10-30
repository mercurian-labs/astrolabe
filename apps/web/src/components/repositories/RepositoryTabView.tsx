import { FileCodeIcon, FileDiffIcon } from "lucide-react";
import type { ReactNode } from "react";

import { RepositoryDiffView } from "./RepositoryDiffView";
import { RepositoryFileView } from "./RepositoryFileView";
import { fileName, parseRepositoryTabKey, type RepositoryTab } from "./repositoryTabs";

/** A file, or a checkout's changes. */
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
  }
}

/** A repository tab's title and icon: a file's name, or a checkout's changes. */
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
  }
}
