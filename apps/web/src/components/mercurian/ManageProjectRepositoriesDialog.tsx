import type { MercurianProjectId, MercurianRepositoryId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";

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
 * repository. What it does is tell the planning space which code to reach for
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
  const [selected, setSelected] = useState<ReadonlySet<MercurianRepositoryId>>(new Set());
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!open || projectId === null) return;
    setSelected(repositoryIdsForProject(snapshot.projectRepositories, projectId));
    // Deliberately keyed to the opening, not to the snapshot: a live re-read
    // would fight whoever is checking boxes.
  }, [open, projectId]);

  const submit = useCallback(async () => {
    if (projectId === null || isSaving) return;
    setIsSaving(true);
    const saved = await setProjectRepositories(projectId, [...selected]);
    setIsSaving(false);
    if (saved !== null) onOpenChange(false);
  }, [isSaving, onOpenChange, projectId, selected, setProjectRepositories]);

  const repositories = sortRepositoriesForPage(snapshot.repositories);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>Repositories for {projectName}</DialogTitle>
        </DialogHeader>
        <DialogPanel className="space-y-3">
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
                Open Repositories
              </Button>
            </div>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                A project&rsquo;s repositories are the context its plans ground in — a default, not
                a boundary.
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
            </>
          )}
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
