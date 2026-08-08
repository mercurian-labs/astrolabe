import { useCallback, useState } from "react";

import { useCreateMercurianProject } from "../../state/mercurian";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";

/**
 * A project needs one thing to exist: a name. Two surfaces ask for it — the
 * tree's header button and the palette's action — and they host their own
 * instance of this rather than sharing an open one, so neither has to know the
 * other exists.
 */
export function NewProjectDialog({
  open,
  onOpenChange,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const createProject = useCreateMercurianProject();
  const [name, setName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = useCallback(async () => {
    const trimmed = name.trim();
    if (trimmed.length === 0 || isSubmitting) return;
    setIsSubmitting(true);
    const project = await createProject(trimmed);
    setIsSubmitting(false);
    if (project !== null) {
      setName("");
      onOpenChange(false);
    }
  }, [createProject, isSubmitting, name, onOpenChange]);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          setName("");
        }
        onOpenChange(nextOpen);
      }}
    >
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
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={name.trim().length === 0 || isSubmitting} onClick={() => void submit()}>
            Create
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
