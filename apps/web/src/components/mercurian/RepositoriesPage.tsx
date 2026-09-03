import type {
  MercurianProjectId,
  MercurianRepository,
  SourceControlDiscoveryResult,
} from "@t3tools/contracts";
import {
  FolderGit2Icon,
  GitBranchIcon,
  MoreHorizontalIcon,
  PlusIcon,
  TerminalIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { cn } from "../../lib/utils";
import { usePrimaryEnvironment, usePrimaryEnvironmentId } from "../../state/environments";
import { useMercurianTree } from "../../state/mercurian";
import {
  useRemoveRepository,
  useRepositories,
  useSetProjectRepositories,
} from "../../state/mercurianRepositories";
import { useEnvironmentQuery } from "../../state/query";
import { sourceControlEnvironment } from "../../state/sourceControl";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { RedactedSensitiveText } from "../settings/RedactedSensitiveText";
import { AddRepositoryDialog } from "./AddRepositoryDialog";
import { HostingProviderMark, HostingProvidersSection } from "./HostingProvidersSection";
import {
  describeScriptDeclarations,
  NOT_A_GIT_REPOSITORY_NOTE,
  projectsForRepository,
  repositoryIdsForProject,
  repositoryHostingPresentation,
  sortRepositoriesForPage,
} from "./RepositoriesPage.logic";
import { PublishRepositoryDialog } from "./PublishRepositoryDialog";
import { RepositoryScriptsDialog } from "./RepositoryScriptsDialog";

/**
 * The one surface that answers "what code can Mercurian reach, and how".
 *
 * A repository lives on the environment where its files are, and the row says
 * so — as a fact about where the answer came from, never as a link. There is
 * nowhere to navigate to from it, because environments are plumbing.
 */
export function RepositoriesPage() {
  const { snapshot, isPending, error } = useRepositories();
  const environmentId = usePrimaryEnvironmentId();
  const providerDiscovery = useEnvironmentQuery(
    environmentId === null
      ? null
      : sourceControlEnvironment.discovery({ environmentId, input: {} }),
  );
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [scriptsFor, setScriptsFor] = useState<MercurianRepository | null>(null);
  const [removing, setRemoving] = useState<MercurianRepository | null>(null);
  const [publishing, setPublishing] = useState<MercurianRepository | null>(null);

  const repositories = useMemo(
    () => sortRepositoriesForPage(snapshot.repositories),
    [snapshot.repositories],
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <HostingProvidersSection />
        {error !== null ? (
          <p className="px-3 py-3 text-sm text-destructive sm:px-5">{error}</p>
        ) : null}
        {repositories.length === 0 ? (
          <Empty className="flex-1">
            <EmptyHeader className="max-w-md">
              <div className="mx-auto mb-4 flex size-10 items-center justify-center rounded-xl border border-border/70 bg-background/70 text-muted-foreground">
                <GitBranchIcon className="size-5" />
              </div>
              <EmptyTitle className="text-xl text-foreground">
                {isPending ? "Loading repositories…" : "No repositories yet"}
              </EmptyTitle>
              <EmptyDescription className="mt-2 text-sm text-muted-foreground/78">
                Repositories are the context a project&rsquo;s threads ground in. Add one to give
                Mercurian something to read.
              </EmptyDescription>
              {isPending ? null : (
                <Button className="mx-auto mt-4" onClick={() => setIsAddOpen(true)}>
                  <PlusIcon className="size-4" />
                  Add repository
                </Button>
              )}
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="divide-y divide-border">
            {repositories.map((repository) => (
              <RepositoryRow
                key={repository.repositoryId}
                repository={repository}
                projectIds={projectsForRepository(
                  snapshot.projectRepositories,
                  repository.repositoryId,
                )}
                onEditScripts={() => setScriptsFor(repository)}
                onPublish={() => setPublishing(repository)}
                onRemove={() => setRemoving(repository)}
                discovery={providerDiscovery.data}
              />
            ))}
          </ul>
        )}
      </div>

      <AddRepositoryDialog open={isAddOpen} onOpenChange={setIsAddOpen} />
      <PublishRepositoryDialog
        open={publishing !== null}
        repository={publishing}
        discovery={providerDiscovery.data}
        onOpenChange={(open) => {
          if (!open) setPublishing(null);
        }}
      />
      <RepositoryScriptsDialog
        open={scriptsFor !== null}
        repository={scriptsFor}
        onOpenChange={(open) => {
          if (!open) setScriptsFor(null);
        }}
      />
      <RemoveRepositoryDialog
        repository={removing}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
      />
    </div>
  );
}

/** The page header's own action, so the route keeps its chrome. */
export function AddRepositoryHeaderButton() {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setIsOpen(true)}>
        <PlusIcon className="size-4" />
        Add repository
      </Button>
      <AddRepositoryDialog open={isOpen} onOpenChange={setIsOpen} />
    </>
  );
}

function RepositoryRow({
  repository,
  projectIds,
  onEditScripts,
  onPublish,
  onRemove,
  discovery,
}: {
  readonly repository: MercurianRepository;
  readonly projectIds: ReadonlyArray<string>;
  readonly onEditScripts: () => void;
  readonly onPublish: () => void;
  readonly onRemove: () => void;
  readonly discovery: SourceControlDiscoveryResult | null;
}) {
  const environment = usePrimaryEnvironment();
  const { snapshot: tree } = useMercurianTree();
  const [isManageOpen, setIsManageOpen] = useState(false);
  const scripts = useMemo(
    () => describeScriptDeclarations(repository.scripts),
    [repository.scripts],
  );
  const hosting = useMemo(
    () =>
      repositoryHostingPresentation({
        hasGit: repository.hasGit,
        hosting: repository.hosting,
        discovery,
      }),
    [discovery, repository.hasGit, repository.hosting],
  );
  const projectNames = useMemo(
    () =>
      tree.projects
        .filter((project) => projectIds.includes(project.projectId))
        .map((project) => project.name),
    [projectIds, tree.projects],
  );

  return (
    <li className="px-3 py-3.5 sm:px-5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">{repository.name}</span>
            {/* The environment as a plain fact — where its files are. Not a
                link, not a grouping: environments are never navigational. */}
            <Badge variant="secondary" className="font-normal">
              {environment?.label ?? "This machine"}
            </Badge>
          </div>
          <p className="mt-0.5 break-all text-xs text-muted-foreground">{repository.path}</p>

          {repository.hasGit ? null : (
            <p className="mt-1.5 text-xs text-muted-foreground/80">{NOT_A_GIT_REPOSITORY_NOTE}</p>
          )}

          {hosting?.kind === "hosting" ? (
            <p className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground/80">
              <HostingProviderMark
                provider={hosting.standing.provider}
                tone={
                  hosting.standing.provider === "unknown"
                    ? "neutral"
                    : hosting.standing.detail.startsWith("authenticated")
                      ? "ready"
                      : "warning"
                }
              />
              <span className="font-medium text-foreground/85">{hosting.standing.label}</span>
              <span aria-hidden>·</span>
              <span>{hosting.standing.detail}</span>
              {hosting.standing.account === null ? null : (
                <RedactedSensitiveText
                  value={hosting.standing.account}
                  ariaLabel={`Toggle ${hosting.standing.label} account visibility`}
                  revealTooltip="Click to reveal account"
                  hideTooltip="Click to hide account"
                />
              )}
            </p>
          ) : hosting?.kind === "publish" ? (
            <button
              type="button"
              className="mt-1.5 text-xs font-medium text-primary hover:underline"
              onClick={onPublish}
            >
              {hosting.label}
            </button>
          ) : hosting?.kind === "no-remote" ? (
            <p className="mt-1.5 text-xs text-muted-foreground/80">{hosting.label}</p>
          ) : null}

          {scripts.length === 0 ? null : (
            <ul className="mt-2 space-y-1">
              {scripts.map((script) => (
                <li
                  key={script.scriptId}
                  className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs"
                >
                  <TerminalIcon className="size-3.5 shrink-0 text-muted-foreground/70" />
                  <span className="font-medium text-foreground">{script.name}</span>
                  <code className="rounded bg-muted px-1 py-0.5 text-[11px] text-muted-foreground">
                    {script.command}
                  </code>
                  {script.badges.map((badge) => (
                    <Badge key={badge} variant="outline" className="font-normal">
                      {badge}
                    </Badge>
                  ))}
                </li>
              ))}
            </ul>
          )}

          {projectNames.length === 0 ? null : (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
              <FolderGit2Icon className="size-3.5 shrink-0 opacity-70" />
              Context for {projectNames.join(", ")}
            </p>
          )}
        </div>

        <Menu>
          <MenuTrigger
            aria-label={`Actions for ${repository.name}`}
            className={cn(
              "inline-flex size-7 shrink-0 items-center justify-center rounded-md",
              "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <MoreHorizontalIcon className="size-4" />
          </MenuTrigger>
          <MenuPopup align="end" side="bottom" sideOffset={4} className="min-w-48">
            <MenuItem onClick={onEditScripts}>Edit scripts…</MenuItem>
            <MenuItem onClick={() => setIsManageOpen(true)}>Manage in projects…</MenuItem>
            {hosting?.kind === "publish" ? (
              <MenuItem onClick={onPublish}>Publish repository…</MenuItem>
            ) : null}
            <MenuItem onClick={onRemove}>Remove…</MenuItem>
          </MenuPopup>
        </Menu>
      </div>

      <ManageRepositoryProjectsDialog
        open={isManageOpen}
        repository={repository}
        onOpenChange={setIsManageOpen}
      />
    </li>
  );
}

/**
 * The same membership, entered from the repository's side: which projects this
 * repository is context for.
 *
 * It writes through `setProjectRepositories` one project at a time, and only
 * for the projects whose set actually changed — the set belongs to the
 * project, and this is a second door onto it rather than a second model.
 */
function ManageRepositoryProjectsDialog({
  repository,
  open,
  onOpenChange,
}: {
  readonly repository: MercurianRepository;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const { snapshot: tree } = useMercurianTree();
  const { snapshot } = useRepositories();
  const setProjectRepositories = useSetProjectRepositories();
  const [selected, setSelected] = useState<ReadonlySet<MercurianProjectId>>(new Set());
  const [isSaving, setIsSaving] = useState(false);

  const memberOf = useMemo(
    () => new Set(projectsForRepository(snapshot.projectRepositories, repository.repositoryId)),
    [repository.repositoryId, snapshot.projectRepositories],
  );

  useEffect(() => {
    if (!open) return;
    setSelected(memberOf);
    // Deliberately keyed to the opening: a live re-read would fight whoever is
    // checking boxes.
  }, [open]);

  const submit = useCallback(async () => {
    if (isSaving) return;
    setIsSaving(true);
    for (const project of tree.projects) {
      const wasMember = memberOf.has(project.projectId);
      const isMember = selected.has(project.projectId);
      if (wasMember === isMember) continue;
      const current = repositoryIdsForProject(snapshot.projectRepositories, project.projectId);
      const next = new Set(current);
      if (isMember) next.add(repository.repositoryId);
      else next.delete(repository.repositoryId);
      await setProjectRepositories(project.projectId, [...next]);
    }
    setIsSaving(false);
    onOpenChange(false);
  }, [
    isSaving,
    memberOf,
    onOpenChange,
    repository.repositoryId,
    selected,
    setProjectRepositories,
    snapshot.projectRepositories,
    tree.projects,
  ]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>Projects using {repository.name}</DialogTitle>
        </DialogHeader>
        <DialogPanel className="space-y-3">
          {tree.projects.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
              No projects yet. Create one from the sidebar to give it context.
            </p>
          ) : (
            <ul className="space-y-1">
              {tree.projects.map((project) => (
                <li key={project.projectId}>
                  <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 text-xs text-foreground transition-colors hover:bg-accent/40">
                    <Checkbox
                      checked={selected.has(project.projectId)}
                      onCheckedChange={(checked) =>
                        setSelected((current) => {
                          const next = new Set(current);
                          if (checked === true) next.add(project.projectId);
                          else next.delete(project.projectId);
                          return next;
                        })
                      }
                    />
                    <span className="truncate">{project.name}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={isSaving || tree.projects.length === 0} onClick={() => void submit()}>
            Save
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

/**
 * Removal is disconnection, and the copy says exactly that. The worktree floor
 * has no override: when the app is holding workspaces open on a repository,
 * the refusal is shown here and the way out is to end them.
 */
function RemoveRepositoryDialog({
  repository,
  onOpenChange,
}: {
  readonly repository: MercurianRepository | null;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const removeRepository = useRemoveRepository();
  const [refusal, setRefusal] = useState<string | null>(null);
  const [isRemoving, setIsRemoving] = useState(false);
  // Held past the removal so the dialog keeps saying whose name it asked
  // about while it closes, rather than blanking as the row disappears.
  const [name, setName] = useState("");
  useEffect(() => {
    if (repository !== null) setName(repository.name);
  }, [repository]);

  const confirm = useCallback(async () => {
    if (repository === null || isRemoving) return;
    setIsRemoving(true);
    setRefusal(null);
    const result = await removeRepository(repository.repositoryId);
    setIsRemoving(false);
    if (result.ok) {
      onOpenChange(false);
      return;
    }
    setRefusal(
      result.error instanceof Error && result.error.message.trim().length > 0
        ? result.error.message
        : "Could not remove this repository.",
    );
  }, [isRemoving, onOpenChange, removeRepository, repository]);

  return (
    <AlertDialog
      open={repository !== null}
      onOpenChange={(open) => {
        if (!open) setRefusal(null);
        onOpenChange(open);
      }}
    >
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {name}?</AlertDialogTitle>
          <AlertDialogDescription>
            This disconnects the repository: its scripts and its project memberships go with it. The
            files on disk are untouched, and anything already written into a plan&rsquo;s history
            stays there as record.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {refusal === null ? null : <p className="px-6 text-sm text-destructive">{refusal}</p>}
        <AlertDialogFooter>
          <AlertDialogClose disabled={isRemoving} render={<Button variant="outline" />}>
            Cancel
          </AlertDialogClose>
          <Button disabled={isRemoving} variant="destructive" onClick={() => void confirm()}>
            Remove
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
