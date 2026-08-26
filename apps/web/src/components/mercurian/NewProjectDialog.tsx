import type {
  MercurianProject,
  MercurianRepository,
  MercurianRepositoryId,
} from "@t3tools/contracts";
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
import { AddRepositoryFlow } from "./AddRepositoryFlow";
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
  const createProject = useCreateMercurianProject();
  const setProjectRepositories = useSetProjectRepositories();
  const setProjectScope = useProjectScopeStore((state) => state.setProjectScope);
  const { snapshot, isPending } = useRepositories();
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<MercurianRepositoryId>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdProject, setCreatedProject] = useState<MercurianProject | null>(null);
  const [isRepositoryFlowAtPicker, setIsRepositoryFlowAtPicker] = useState(true);
  const repositories = sortRepositoriesForPage(snapshot.repositories);
  const showAddRepositoryFlow = !isPending && repositories.length === 0;

  const reset = useCallback(() => {
    setName("");
    setSelected(new Set());
    setIsSubmitting(false);
    setError(null);
    setCreatedProject(null);
    setIsRepositoryFlowAtPicker(true);
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

    setProjectScope(project.projectId);
    reset();
    onOpenChange(false);
  }, [
    createProject,
    createdProject,
    isSubmitting,
    name,
    onOpenChange,
    reset,
    selected,
    setProjectRepositories,
    setProjectScope,
  ]);

  const handleRepositoryAdded = useCallback((repository: MercurianRepository) => {
    setSelected((current) => new Set(current).add(repository.repositoryId));
  }, []);

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
                  A project&rsquo;s repositories are the context its plans ground in — a default,
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
              </>
            ) : null}
            {error === null ? null : <p className="text-xs text-destructive">{error}</p>}
          </div>
        </DialogPanel>
        {showAddRepositoryFlow ? (
          <AddRepositoryFlow
            key={open ? "open" : "closed"}
            onAdded={handleRepositoryAdded}
            onModeChange={(mode) => setIsRepositoryFlowAtPicker(mode === "picker")}
          />
        ) : null}
        {!showAddRepositoryFlow || isRepositoryFlowAtPicker ? (
          <DialogFooter>
            <Button variant="outline" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <Button
              disabled={(createdProject === null && name.trim().length === 0) || isSubmitting}
              onClick={() => void submit()}
            >
              {createdProject === null ? "Create" : "Retry connection"}
            </Button>
          </DialogFooter>
        ) : null}
      </DialogPopup>
    </Dialog>
  );
}
