import { ProjectStorageSettings } from "./ProjectStorageSettings";
import type { MemoryIndex, MercurianProjectId, MercurianRepositoryId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";

import {
  useGenerateProductMap,
  useMemorySourceForProject,
  useReadMemoryIndex,
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
  const readMemoryIndex = useReadMemoryIndex();
  const generateProductMap = useGenerateProductMap();
  const [selected, setSelected] = useState<ReadonlySet<MercurianRepositoryId>>(new Set());
  const [isSaving, setIsSaving] = useState(false);
  const [memoryIndex, setMemoryIndex] = useState<MemoryIndex | null>(null);
  const [memoryError, setMemoryError] = useState<string | null>(null);
  const [memoryBusy, setMemoryBusy] = useState(false);

  useEffect(() => {
    if (!open || projectId === null) return;
    setSelected(repositoryIdsForProject(snapshot.projectRepositories, projectId));
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
                Designate a whole registered repository, or a folder inside that same repository, as
                this project&rsquo;s durable design memory. A nested Git repository cannot be used
                as a subpath.
              </p>
            </div>
            {projectId !== null && (
              <ProjectStorageSettings
                projectId={projectId}
                kind="memory"
                repositories={repositories}
              />
            )}
            <div className="space-y-2">
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
            {memoryError === null ? null : (
              <p role="alert" className="text-xs text-destructive">
                {memoryError}
              </p>
            )}
          </section>
          {projectId !== null &&
            (["plan", "spec"] as const).map((kind) => (
              <ProjectStorageSettings
                key={kind}
                projectId={projectId}
                kind={kind}
                repositories={repositories}
              />
            ))}
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
      case "nested-repository":
        return "Choose the whole registered repository or a folder inside its Git worktree, not a nested repository.";
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
