import { useDesignateStorageSource } from "../../state/mercurianStorage";
import {
  emptyStorageLocations,
  ProjectDocumentLocationFields,
  storageLabels,
} from "./ProjectDocumentLocationFields";
import type { MercurianProject, MercurianRepositoryId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useState } from "react";

import { useProjectScopeStore } from "../../projectScopeStore";
import { useCreateMercurianProject } from "../../state/mercurian";
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
import { Input } from "../ui/input";
import { sortRepositoriesForPage } from "./RepositoriesPage.logic";

/**
 * Project creation is one act wherever it is hosted: name the project, choose
 * its repository context, then move the sidebar into that new scope.
 */
export function NewProjectDialog({
  open,
  onOpenChange,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const designateStorage = useDesignateStorageSource();
  const [locations, setLocations] = useState(emptyStorageLocations);
  const createProject = useCreateMercurianProject();
  const setProjectRepositories = useSetProjectRepositories();
  const setProjectScope = useProjectScopeStore((state) => state.setProjectScope);
  const { snapshot, isPending } = useRepositories();
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<MercurianRepositoryId>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdProject, setCreatedProject] = useState<MercurianProject | null>(null);
  const repositories = sortRepositoriesForPage(snapshot.repositories);

  const reset = useCallback(() => {
    setName("");
    setLocations(emptyStorageLocations());
    setSelected(new Set());
    setIsSubmitting(false);
    setError(null);
    setCreatedProject(null);
  }, []);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        if (createdProject !== null) setProjectScope(createdProject.projectId);
        reset();
      }
      onOpenChange(nextOpen);
    },
    [createdProject, onOpenChange, reset, setProjectScope],
  );

  const submit = useCallback(async () => {
    const trimmed = name.trim();
    if ((createdProject === null && trimmed.length === 0) || isSubmitting) return;
    setIsSubmitting(true);
    setError(null);

    const project = createdProject ?? (await createProject(trimmed));
    if (project === null) {
      setIsSubmitting(false);
      return;
    }

    setCreatedProject(project);
    if (selected.size > 0) {
      // Create, then connect: if the second command fails, the named project
      // is harmless and the dialog can retry just this replacement command.
      setCreatedProject(project);
      const connected = await setProjectRepositories(project.projectId, [...selected]);
      if (connected === null) {
        setIsSubmitting(false);
        setError("Could not connect the selected repositories. Try again.");
        return;
      }
    }

    for (const kind of ["memory", "plan", "spec"] as const) {
      const location = locations[kind];
      if (!location.repositoryId) continue;
      const saved = await designateStorage({
        projectId: project.projectId,
        kind,
        repositoryId: location.repositoryId as MercurianRepositoryId,
        subpath: location.subpath,
      });
      if (!saved.ok) {
        setIsSubmitting(false);
        setError(
          saved.error instanceof Error
            ? saved.error.message
            : `Could not configure ${storageLabels[kind].toLowerCase()}. Try again.`,
        );
        return;
      }
    }
    setProjectScope(project.projectId);
    reset();
    onOpenChange(false);
  }, [
    createProject,
    designateStorage,
    locations,
    createdProject,
    isSubmitting,
    name,
    onOpenChange,
    reset,
    selected,
    setProjectRepositories,
    setProjectScope,
  ]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          <div className="grid gap-1.5">
            <span className="text-xs font-medium text-foreground">Project name</span>
            <Input
              aria-label="Project name"
              autoFocus
              disabled={createdProject !== null}
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void submit();
                }
              }}
            />
          </div>
          <div className="grid gap-1.5">
            <span className="text-xs font-medium text-foreground">Repositories</span>
            {isPending ? (
              <p className="text-xs text-muted-foreground">Loading repositories…</p>
            ) : repositories.length > 0 ? (
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
                    handleOpenChange(false);
                    void navigate({ to: "/repositories" });
                  }}
                >
                  Manage Repos
                </Button>
              </>
            ) : (
              <div className="space-y-3 rounded-lg border border-dashed border-border px-3 py-6 text-center">
                <p className="text-xs text-muted-foreground">No repositories are registered yet.</p>
                <Button
                  variant="outline"
                  onClick={() => {
                    handleOpenChange(false);
                    void navigate({ to: "/repositories" });
                  }}
                >
                  Manage Repos
                </Button>
              </div>
            )}
            {error === null ? null : <p className="text-xs text-destructive">{error}</p>}
          </div>
          {!isPending && repositories.length > 0 && (
            <div className="space-y-4 border-t border-border pt-4">
              {(["memory", "plan", "spec"] as const).map((kind) => (
                <ProjectDocumentLocationFields
                  key={kind}
                  kind={kind}
                  repositories={repositories}
                  value={locations[kind]}
                  disabled={isSubmitting}
                  onChange={(value) => setLocations((current) => ({ ...current, [kind]: value }))}
                />
              ))}
            </div>
          )}
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={(createdProject === null && name.trim().length === 0) || isSubmitting}
            onClick={() => void submit()}
          >
            {createdProject === null ? "Create" : "Retry setup"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
