import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  projectRootId,
  WikiId,
  type ProjectRootCheckout,
  type ProjectWorktree,
} from "@t3tools/contracts";
import { workspaceRelativeFilePath } from "@t3tools/shared/path";
import { useGT } from "gt-react";
import { FolderGit2Icon, FolderIcon } from "lucide-react";
import { Fragment, useState } from "react";

import { workspace } from "~/panes/workspace";
import { projectRootsEnvironment } from "~/state/projectRoots";
import { useEnvironmentQuery } from "~/state/query";
import { useProjectWorktrees, type WorktreesTarget } from "~/state/worktrees";
import { CollapsibleSectionHeader } from "../ui/collapsible-section-header";
import {
  checkoutOf,
  repositoryTabKey,
  sameCheckout,
  type RepositoryFileTab,
  type RepositoryTab,
} from "./repositoryTabs";
import { WorktreeFiles, WorktreeHeader, WorktreesUnread } from "./RepositoryWorktrees";

const outsideOf = (project: EnvironmentProject, path: string) =>
  workspaceRelativeFilePath(path, project.workspaceRoot) === null;

/**
 * Astrolabe: a project's tracked folders outside its own folder (those inside it show in its tree),
 * each a section with its file tree, or with its worktrees' when it has more than one checkout.
 * Their files open as the root's own (its id as their owner), so a tab finds its branch among the
 * root's worktrees.
 */
export function ProjectRootSections({
  repository,
  docs,
  focusedTab,
}: {
  readonly repository: EnvironmentProject;
  /** The Projects filter's Docs: each tree shows its documents and what they link. */
  readonly docs: boolean;
  readonly focusedTab: RepositoryTab | null;
}) {
  const gt = useGT();
  const tracksOutside = (repository.trackedFolders ?? []).some((folder) =>
    outsideOf(repository, folder.path),
  );
  const listed = useEnvironmentQuery(
    tracksOutside
      ? projectRootsEnvironment.list({
          environmentId: repository.environmentId,
          input: { projectId: repository.id },
        })
      : null,
  );
  if (listed.error !== null) {
    return (
      <p role="alert" className="px-2 py-2 text-xs text-sidebar-muted-foreground">
        {gt("Couldn't read the project's folders. {error}", { error: listed.error })}
      </p>
    );
  }
  const roots = (listed.data?.roots ?? []).filter(
    (root) => root.kind === "tracked" && outsideOf(repository, root.path),
  );
  return roots.map((root) => (
    <RootSection
      key={root.key}
      repository={repository}
      root={root}
      docs={docs}
      focusedTab={focusedTab}
    />
  ));
}

function RootSection({
  repository,
  root,
  docs,
  focusedTab,
}: {
  readonly repository: EnvironmentProject;
  readonly root: ProjectRootCheckout;
  readonly docs: boolean;
  readonly focusedTab: RepositoryTab | null;
}) {
  const gt = useGT();
  const [expanded, setExpanded] = useState(true);
  const missing = root.state === "missing";
  const Icon = root.state === "git" ? FolderGit2Icon : FolderIcon;
  return (
    <ul role="presentation" aria-label={root.name} className="flex flex-col gap-px">
      <li className="mx-0.5 flex h-8 list-none items-center gap-1">
        <CollapsibleSectionHeader
          onClick={() => setExpanded(!expanded)}
          expanded={expanded}
          tone="muted"
          title={root.path}
          accessory={
            missing ? (
              <span className="text-3xs text-sidebar-muted-foreground/70">
                {gt("Missing", { $context: "a folder that is not on disk" })}
              </span>
            ) : null
          }
        >
          <span className="flex items-center gap-1.5">
            <Icon aria-hidden className="size-3.5 shrink-0" />
            {root.name}
          </span>
        </CollapsibleSectionHeader>
      </li>
      {expanded ? (
        <li className="list-none">
          {missing ? (
            <p
              role="status"
              className="px-2 py-3 text-center text-xs text-sidebar-muted-foreground"
            >
              {gt("This folder isn't on disk any more: {path}", { path: root.path })}
            </p>
          ) : (
            <RootWorktrees
              repository={repository}
              root={root}
              docs={docs}
              focusedTab={focusedTab}
            />
          )}
        </li>
      ) : null}
    </ul>
  );
}

function RootWorktrees({
  repository,
  root,
  docs,
  focusedTab,
}: {
  readonly repository: EnvironmentProject;
  readonly root: ProjectRootCheckout;
  readonly docs: boolean;
  readonly focusedTab: RepositoryTab | null;
}) {
  const gt = useGT();
  const owner: WorktreesTarget = {
    environmentId: repository.environmentId,
    wikiId: WikiId.make(projectRootId(repository.id, root.key)),
  };
  const { data, error } = useProjectWorktrees(owner);
  const [chosen, setChosen] = useState<ReadonlyMap<string, boolean>>(new Map());
  if (data === null) {
    return error === null ? (
      <p role="status" className="px-2 py-3 text-center text-xs text-sidebar-muted-foreground">
        {gt("Reading worktrees…")}
      </p>
    ) : (
      <WorktreesUnread owner={owner} error={error} />
    );
  }
  const fileTab = (worktree: ProjectWorktree, path: string): RepositoryFileTab => ({
    kind: "file",
    environmentId: owner.environmentId,
    wikiId: owner.wikiId,
    checkout: checkoutOf(worktree),
    path,
  });
  const selectedIn = (worktree: ProjectWorktree) =>
    focusedTab?.kind === "file" && sameCheckout(focusedTab, fileTab(worktree, focusedTab.path))
      ? focusedTab.path
      : null;
  const files = (worktree: ProjectWorktree) => (
    <WorktreeFiles
      owner={owner}
      worktree={worktree}
      projectName={`${repository.title} · ${root.name}`}
      selectedPath={selectedIn(worktree)}
      onOpenFile={(path) => workspace.show(repositoryTabKey(fileTab(worktree, path)))}
      docsOf={docs ? { projectId: repository.id, rootKey: root.key } : null}
    />
  );
  const [only] = data.worktrees;
  if (data.worktrees.length === 1 && only) return files(only);
  return data.worktrees.map((worktree) => {
    const open = chosen.get(worktree.path) ?? (worktree.isMain || selectedIn(worktree) !== null);
    return (
      <Fragment key={worktree.path}>
        <ul role="presentation" className="flex flex-col gap-px">
          <WorktreeHeader
            repository={owner}
            worktree={worktree}
            expanded={open}
            onToggle={() => setChosen((current) => new Map(current).set(worktree.path, !open))}
          />
        </ul>
        {open ? files(worktree) : null}
      </Fragment>
    );
  });
}
