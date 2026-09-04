import type { MemoryIndex, MercurianProjectId, MercurianRepositoryId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";

import {
  useDesignateMemorySource,
  useGenerateProductMap,
  useMemorySourceForProject,
  useReadMemoryIndex,
  useRemoveMemorySource,
} from "../../state/mercurianMemory";
import { useRepositories, useSetProjectRepositories } from "../../state/mercurianRepositories";
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
import { repositoryIdsForProject, sortRepositoriesForPage } from "./RepositoriesPage.logic";

/**
 * A project's repository set.
 *
 * The set is context and never a stamp: nothing else moves when it changes —
 * no grouping in the tree, no badge on a plan, nothing filed under a
 * repository. What it does is tell the thread which code to reach for
 * when someone mentions a file.
 */
export function ManageProjectRepositoriesDialog({
  projectId,
  projectName,
  open,
  onOpenChange,
}: {
  readonly projectId: MercurianProjectId | null;
  readonly projectName: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const { snapshot } = useRepositories();
  const setProjectRepositories = useSetProjectRepositories();
  const memorySource = useMemorySourceForProject(projectId);
  const designateMemorySource = useDesignateMemorySource();
  const removeMemorySource = useRemoveMemorySource();
  const readMemoryIndex = useReadMemoryIndex();
  const generateProductMap = useGenerateProductMap();
  const [selected, setSelected] = useState<ReadonlySet<MercurianRepositoryId>>(new Set());
  const [isSaving, setIsSaving] = useState(false);
  const [memoryRepositoryId, setMemoryRepositoryId] = useState("");
  const [memorySubpath, setMemorySubpath] = useState("");
  const [memoryIndex, setMemoryIndex] = useState<MemoryIndex | null>(null);
  const [memoryError, setMemoryError] = useState<string | null>(null);
  const [memoryBusy, setMemoryBusy] = useState(false);

  useEffect(() => {
    if (!open || projectId === null) return;
    setSelected(repositoryIdsForProject(snapshot.projectRepositories, projectId));
    setMemoryRepositoryId(snapshot.repositories[0]?.repositoryId ?? "");
    setMemorySubpath("");
    setMemoryIndex(null);
    setMemoryError(null);
    // Deliberately keyed to the opening, not to the snapshot: a live re-read
    // would fight whoever is checking boxes.
  }, [open, projectId]);

  useEffect(() => {
    if (!open || projectId === null || memorySource === null) return;
    let active = true;
    void readMemoryIndex(projectId).then((result) => {
      if (!active) return;
      if (result.ok) setMemoryIndex(result.value);
      else setMemoryError(memoryRefusalMessage(result.error));
    });
    return () => {
      active = false;
    };
  }, [memorySource?.updatedAt, open, projectId, readMemoryIndex]);

  const submit = useCallback(async () => {
    if (projectId === null || isSaving) return;
    setIsSaving(true);
    const saved = await setProjectRepositories(projectId, [...selected]);
    setIsSaving(false);
    if (saved !== null) onOpenChange(false);
  }, [isSaving, onOpenChange, projectId, selected, setProjectRepositories]);

  const repositories = sortRepositoriesForPage(snapshot.repositories);
  const designatedRepository =
    memorySource === null
      ? null
      : (snapshot.repositories.find(
          (repository) => repository.repositoryId === memorySource.repositoryId,
        ) ?? null);

  const designate = useCallback(async () => {
    if (projectId === null || memoryRepositoryId.length === 0 || memoryBusy) return;
    setMemoryBusy(true);
    setMemoryError(null);
    const result = await designateMemorySource({
      projectId,
      repositoryId: memoryRepositoryId as MercurianRepositoryId,
      ...(memorySubpath.trim() ? { subpath: memorySubpath.trim() } : {}),
    });
    if (result.ok) {
      const indexResult = await readMemoryIndex(projectId);
      if (indexResult.ok) setMemoryIndex(indexResult.value);
      else setMemoryError(memoryRefusalMessage(indexResult.error));
    } else {
      setMemoryError(memoryRefusalMessage(result.error));
    }
    setMemoryBusy(false);
  }, [
    designateMemorySource,
    memoryBusy,
    memoryRepositoryId,
    memorySubpath,
    projectId,
    readMemoryIndex,
  ]);

  const removeDesignation = useCallback(async () => {
    if (projectId === null || memoryBusy) return;
    setMemoryBusy(true);
    setMemoryError(null);
    const result = await removeMemorySource(projectId);
    if (!result.ok) setMemoryError(memoryRefusalMessage(result.error));
    else setMemoryIndex(null);
    setMemoryBusy(false);
  }, [memoryBusy, projectId, removeMemorySource]);

  const generate = useCallback(async () => {
    if (projectId === null || memoryBusy) return;
    setMemoryBusy(true);
    setMemoryError(null);
    const result = await generateProductMap(projectId);
    if (!result.ok) {
      setMemoryError(memoryRefusalMessage(result.error));
    } else {
      const indexResult = await readMemoryIndex(projectId);
      if (indexResult.ok) setMemoryIndex(indexResult.value);
      else setMemoryError(memoryRefusalMessage(indexResult.error));
    }
    setMemoryBusy(false);
  }, [generateProductMap, memoryBusy, projectId, readMemoryIndex]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>Repositories for {projectName}</DialogTitle>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          {repositories.length === 0 ? (
            <div className="space-y-3 rounded-lg border border-dashed border-border px-3 py-6 text-center">
              <p className="text-xs text-muted-foreground">No repositories are registered yet.</p>
              <Button
                variant="outline"
                onClick={() => {
                  onOpenChange(false);
                  void navigate({ to: "/repositories" });
                }}
              >
                Manage Repos
              </Button>
            </div>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                A project&rsquo;s repositories are the context its threads ground in — a default,
                not a boundary.
              </p>
              <ul className="space-y-1">
                {repositories.map((repository) => (
                  <li key={repository.repositoryId}>
                    <label className="flex cursor-pointer items-start gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-accent/40">
                      <Checkbox
                        className="mt-0.5"
                        checked={selected.has(repository.repositoryId)}
                        onCheckedChange={(checked) =>
                          setSelected((current) => {
                            const next = new Set(current);
                            if (checked === true) next.add(repository.repositoryId);
                            else next.delete(repository.repositoryId);
                            return next;
                          })
                        }
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-medium text-foreground">
                          {repository.name}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {repository.path}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              <Button
                variant="outline"
                onClick={() => {
                  onOpenChange(false);
                  void navigate({ to: "/repositories" });
                }}
              >
                Manage Repos
              </Button>
            </>
          )}
          <section className="space-y-3 border-t border-border pt-4">
            <div>
              <h3 className="text-sm font-medium text-foreground">Memory</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Designate one repository or folder as this project&rsquo;s durable design memory.
              </p>
            </div>
            {memorySource === null ? (
              repositories.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Register a repository before designating memory.
                </p>
              ) : (
                <div className="space-y-2">
                  <label className="block space-y-1 text-xs text-muted-foreground">
                    <span>Repository</span>
                    <select
                      className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
                      value={memoryRepositoryId}
                      onChange={(event) => setMemoryRepositoryId(event.target.value)}
                    >
                      {repositories.map((repository) => (
                        <option key={repository.repositoryId} value={repository.repositoryId}>
                          {repository.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block space-y-1 text-xs text-muted-foreground">
                    <span>Subpath (optional)</span>
                    <input
                      className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
                      placeholder="notes"
                      value={memorySubpath}
                      onChange={(event) => setMemorySubpath(event.target.value)}
                    />
                  </label>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={memoryBusy || memoryRepositoryId.length === 0}
                    onClick={() => void designate()}
                  >
                    Designate memory
                  </Button>
                </div>
              )
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
                  <div className="min-w-0 text-xs">
                    <p className="truncate font-medium text-foreground">
                      {designatedRepository?.name ?? "Unknown repository"}
                      {memorySource.subpath ? ` / ${memorySource.subpath}` : ""}
                    </p>
                    <p className="truncate text-muted-foreground">
                      {designatedRepository?.path ?? memorySource.repositoryId}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={memoryBusy}
                    onClick={() => void removeDesignation()}
                  >
                    Remove
                  </Button>
                </div>
                {memoryIndex?.productMapOffer === null ||
                memoryIndex?.productMapOffer === undefined ? null : (
                  <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                    <span>
                      Generate the product map from {memoryIndex.productMapOffer.declarationCount}{" "}
                      containment declarations
                    </span>
                    <Button size="sm" disabled={memoryBusy} onClick={() => void generate()}>
                      Generate
                    </Button>
                  </div>
                )}
              </div>
            )}
            {memoryError === null ? null : (
              <p role="alert" className="text-xs text-destructive">
                {memoryError}
              </p>
            )}
          </section>
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={isSaving || projectId === null || repositories.length === 0}
            onClick={() => void submit()}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function memoryRefusalMessage(error: unknown): string {
  if (typeof error !== "object" || error === null) return "The memory operation failed.";
  if ("_tag" in error && error._tag === "MemorySourceInvalidError" && "reason" in error) {
    switch (error.reason) {
      case "repository-not-found":
        return "That repository is no longer registered.";
      case "missing":
        return "That memory folder does not exist.";
      case "not-a-directory":
        return "The memory subpath must point to a directory.";
    }
  }
  if ("_tag" in error && error._tag === "ProductMapAlreadyExistsError") {
    return "The product map already exists.";
  }
  if ("_tag" in error && error._tag === "ProductMapCycleError" && "cycle" in error) {
    const cycle = Array.isArray(error.cycle) ? error.cycle.join(" → ") : "the declarations";
    return `The product map cannot be generated because containment forms a cycle: ${cycle}.`;
  }
  return error instanceof Error ? error.message : "The memory operation failed.";
}
