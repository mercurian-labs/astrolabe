import type { MercurianRepository, MercurianRepositoryScriptInput } from "@t3tools/contracts";
import { PlusIcon, TrashIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { useSaveRepositoryScripts } from "../../state/mercurianRepositories";
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

/**
 * Scripts, declared on the repository.
 *
 * App-owned and per-machine by construction: the list lives in Mercurian's own
 * store, and nothing here writes into the repository — there is no format to
 * design and nothing to pollute.
 *
 * Nothing runs from this dialog. Execution belongs to the session view, and a
 * disabled Run button here would promise it early.
 */
interface DraftScript {
  /** Absent for a newly declared script; the server mints the id. */
  readonly scriptId?: string;
  readonly name: string;
  readonly command: string;
  readonly previewUrl: string;
  readonly isSetup: boolean;
  /** Local only, so React can key rows that have no id yet. */
  readonly key: string;
}

const emptyDraft = (key: string): DraftScript => ({
  name: "",
  command: "",
  previewUrl: "",
  isSetup: false,
  key,
});

function toDrafts(repository: MercurianRepository): ReadonlyArray<DraftScript> {
  return repository.scripts.map((script) => ({
    scriptId: script.scriptId,
    name: script.name,
    command: script.command,
    previewUrl: script.previewUrl ?? "",
    isSetup: script.isSetup,
    key: script.scriptId,
  }));
}

/** Blank rows are how a person leaves; they are not declarations. */
export function toScriptInputs(
  drafts: ReadonlyArray<DraftScript>,
): ReadonlyArray<MercurianRepositoryScriptInput> {
  return drafts
    .filter((draft) => draft.name.trim().length > 0 && draft.command.trim().length > 0)
    .map((draft) => ({
      ...(draft.scriptId === undefined
        ? {}
        : { scriptId: draft.scriptId as MercurianRepositoryScriptInput["scriptId"] }),
      name: draft.name.trim(),
      command: draft.command.trim(),
      ...(draft.previewUrl.trim().length === 0 ? {} : { previewUrl: draft.previewUrl.trim() }),
      isSetup: draft.isSetup,
    }));
}

export function RepositoryScriptsDialog({
  repository,
  open,
  onOpenChange,
}: {
  readonly repository: MercurianRepository | null;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const saveScripts = useSaveRepositoryScripts();
  const [drafts, setDrafts] = useState<ReadonlyArray<DraftScript>>([]);
  const [nextKey, setNextKey] = useState(0);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!open || repository === null) return;
    setDrafts(toDrafts(repository));
  }, [open, repository]);

  const update = useCallback((key: string, patch: Partial<DraftScript>) => {
    setDrafts((current) =>
      current.map((draft) => (draft.key === key ? { ...draft, ...patch } : draft)),
    );
  }, []);

  const submit = useCallback(async () => {
    if (repository === null || isSaving) return;
    setIsSaving(true);
    const saved = await saveScripts(repository.repositoryId, toScriptInputs(drafts));
    setIsSaving(false);
    if (saved !== null) onOpenChange(false);
  }, [drafts, isSaving, onOpenChange, repository, saveScripts]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Scripts on {repository?.name ?? "this repository"}</DialogTitle>
        </DialogHeader>
        <DialogPanel className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Declared here and kept on this machine — nothing is written into the repository. Running
            them arrives with coding sessions.
          </p>
          {drafts.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
              No scripts declared yet.
            </p>
          ) : null}
          {drafts.map((draft) => (
            <div key={draft.key} className="space-y-2 rounded-lg border border-border p-3">
              <div className="flex items-start gap-2">
                <div className="grid flex-1 gap-1.5">
                  <span className="text-xs font-medium text-foreground">Name</span>
                  <Input
                    aria-label="Script name"
                    value={draft.name}
                    onChange={(event) => update(draft.key, { name: event.target.value })}
                  />
                </div>
                <Button
                  aria-label={`Remove ${draft.name || "script"}`}
                  className="mt-6 shrink-0 text-muted-foreground"
                  size="icon-sm"
                  variant="ghost"
                  onClick={() =>
                    setDrafts((current) => current.filter((one) => one.key !== draft.key))
                  }
                >
                  <TrashIcon />
                </Button>
              </div>
              <div className="grid gap-1.5">
                <span className="text-xs font-medium text-foreground">Command</span>
                <Input
                  aria-label="Script command"
                  value={draft.command}
                  onChange={(event) => update(draft.key, { command: event.target.value })}
                />
              </div>
              <div className="grid gap-1.5">
                <span className="text-xs font-medium text-foreground">
                  Preview address <span className="text-muted-foreground">(optional)</span>
                </span>
                <Input
                  aria-label="Preview address"
                  placeholder="http://localhost:3000"
                  value={draft.previewUrl}
                  onChange={(event) => update(draft.key, { previewUrl: event.target.value })}
                />
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-xs text-foreground">
                <Checkbox
                  checked={draft.isSetup}
                  onCheckedChange={(checked) => update(draft.key, { isSetup: checked === true })}
                />
                Setup script
              </label>
            </div>
          ))}
          <Button
            variant="outline"
            onClick={() => {
              setDrafts((current) => [...current, emptyDraft(`draft-${nextKey}`)]);
              setNextKey((key) => key + 1);
            }}
          >
            <PlusIcon className="size-4" />
            Add script
          </Button>
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={isSaving || repository === null} onClick={() => void submit()}>
            Save scripts
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
