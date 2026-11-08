import {
  changeRequestFiles,
  documentPath,
  draftLabel,
  draftMoveTargets,
} from "@t3tools/client-runtime/wikiLogic";
import type { EnvironmentId, WikiChangeRequest, WikiChangeRequestId } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { ChevronDownIcon, TriangleAlertIcon } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import { ensureLocalApi } from "~/localApi";
import { useEnvironmentQuery } from "~/state/query";
import { wikiEnvironment } from "~/state/wiki";
import { Alert, AlertDescription } from "../ui/alert";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Spinner } from "../ui/spinner";
import { mergeBlockedReason } from "./wiki.logic";
import { useChangeRequestTurn } from "./wikiAutosave";
import { useWikiCommand, useWikiTerms } from "./wikiEnvironment";

interface DraftActionsInput {
  readonly environmentId: EnvironmentId;
  readonly draft: WikiChangeRequest;
  readonly changeRequests: ReadonlyArray<WikiChangeRequest>;
  /** Lands what's still unsaved first; false if it couldn't. */
  readonly flush?: () => Promise<boolean>;
  /** Forgets what's still unsaved, as discarding the draft it would land in does. */
  readonly drop?: () => void;
  /** The change request the draft's documents went to. */
  readonly onLanded?: (changeRequestId: WikiChangeRequestId, files: ReadonlyArray<string>) => void;
}

/** A draft's ways out, wherever they're offered: its pill, and its own tab. */
export function useWikiDraftActions({
  environmentId,
  draft,
  changeRequests,
  flush,
  drop,
  onLanded,
}: DraftActionsInput) {
  const [dialog, setDialog] = useState<"promote" | "move" | null>(null);
  const setStatus = useWikiCommand(
    wikiEnvironment.setChangeRequestStatus,
    "Couldn't discard the draft",
  );
  const canAct = useAtomValue(wikiEnvironment.promoteDraft.permissionAtom(environmentId));
  const open = async (next: "promote" | "move") => {
    if (await (flush?.() ?? Promise.resolve(true))) setDialog(next);
  };
  const discard = async () => {
    const confirmed = await ensureLocalApi().dialogs.confirm(
      "Discard this draft? Its edits leave your documents. You can reopen it from Changes.",
      { variant: "destructive" },
    );
    if (!confirmed) return;
    drop?.();
    await setStatus({
      environmentId,
      input: { wikiId: draft.wikiId, changeRequestId: draft.changeRequestId, status: "closed" },
    });
  };
  const dialogs: ReactNode =
    dialog === "promote" ? (
      <PromoteDraftDialog
        environmentId={environmentId}
        draft={draft}
        onClose={() => setDialog(null)}
        onLanded={(id) => onLanded?.(id, changeRequestFiles(draft))}
      />
    ) : dialog === "move" ? (
      <MoveDraftDialog
        environmentId={environmentId}
        draft={draft}
        targets={draftMoveTargets(changeRequests)}
        onClose={() => setDialog(null)}
        {...(onLanded === undefined ? {} : { onLanded })}
      />
    ) : null;
  return {
    canAct,
    promote: () => void open("promote"),
    move: () => void open("move"),
    discard: () => void discard(),
    dialogs,
  };
}

/**
 * Where a document with a draft says so, in place of `Main`: how much the draft holds, and the
 * ways out of it. Never silent, and on every document of the wiki, because an edit to any of them
 * lands here.
 */
export function WikiDraftPill({
  onOpen,
  ...input
}: DraftActionsInput & {
  /** Opens the draft's own tab, where its amendments and files are. */
  readonly onOpen: () => void;
}) {
  const { environmentId, draft } = input;
  const actions = useWikiDraftActions(input);
  const terms = useWikiTerms(environmentId, draft.wikiId);
  const [open, setOpen] = useState(false);
  return (
    <>
      <Menu open={open} onOpenChange={setOpen}>
        <MenuTrigger render={<Button variant="outline" size="xs" />} aria-label="Draft actions">
          {draftLabel(draft)}
          <ChevronDownIcon />
        </MenuTrigger>
        <MenuPopup align="start">
          {open ? <DraftConflict environmentId={environmentId} draft={draft} /> : null}
          <MenuItem onClick={onOpen}>Open draft</MenuItem>
          <MenuSeparator />
          <MenuItem disabled={!actions.canAct} onClick={actions.promote}>
            {`Make it a ${terms.singular}…`}
          </MenuItem>
          <MenuItem disabled={!actions.canAct} onClick={actions.move}>
            Move to another one…
          </MenuItem>
          <MenuItem disabled={!actions.canAct} variant="destructive" onClick={actions.discard}>
            Discard…
          </MenuItem>
        </MenuPopup>
      </Menu>
      {actions.dialogs}
    </>
  );
}

/** What would stop this draft merging, asked only while its menu is open. */
function DraftConflict({
  environmentId,
  draft,
}: {
  readonly environmentId: EnvironmentId;
  readonly draft: WikiChangeRequest;
}) {
  const { data } = useEnvironmentQuery(
    wikiEnvironment.changeRequest({
      environmentId,
      input: { wikiId: draft.wikiId, changeRequestId: draft.changeRequestId },
    }),
  );
  if (data?.mergePreview.status !== "conflict") return null;
  return (
    <p className="max-w-64 px-2 py-1.5 text-xs text-muted-foreground">
      {mergeBlockedReason({ canWrite: true, preview: data.mergePreview })}
    </p>
  );
}

function PromoteDraftDialog({
  environmentId,
  draft,
  onClose,
  onLanded,
}: {
  readonly environmentId: EnvironmentId;
  readonly draft: WikiChangeRequest;
  readonly onClose: () => void;
  readonly onLanded: (changeRequestId: WikiChangeRequestId) => void;
}) {
  const id = useId();
  const terms = useWikiTerms(environmentId, draft.wikiId);
  const [title, setTitle] = useState(draft.title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const promote = useWikiCommand(wikiEnvironment.promoteDraft);
  const canSubmit = title.trim().length > 0 && !busy;
  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    const outcome = await promote({
      environmentId,
      input: {
        wikiId: draft.wikiId,
        changeRequestId: draft.changeRequestId,
        title: title.trim(),
      },
    });
    setBusy(false);
    if (!outcome.ok) {
      setError(outcome.message);
      return;
    }
    onClose();
    onLanded(outcome.value.changeRequestId);
  };
  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogPopup className="sm:max-w-md">
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{`Make it a ${terms.singular}`}</DialogTitle>
            <DialogDescription>
              {`Your draft becomes a ${terms.singular} you can merge. Main changes only when it does.`}
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${id}-title`}>Title</Label>
                <Input
                  id={`${id}-title`}
                  autoFocus
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </div>
              {error ? <DraftError message={error} /> : null}
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {busy ? <Spinner /> : null}
              {`Make it a ${terms.singular}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

/** A change request a draft can move into, unless an agent is working in it right now. */
function MoveTarget({
  environmentId,
  changeRequest,
}: {
  readonly environmentId: EnvironmentId;
  readonly changeRequest: WikiChangeRequest;
}) {
  const { running } = useChangeRequestTurn(environmentId, changeRequest.threadId);
  return (
    <SelectItem value={changeRequest.changeRequestId} disabled={running}>
      {running ? `${changeRequest.title} · agent working` : changeRequest.title}
    </SelectItem>
  );
}

function MoveDraftDialog({
  environmentId,
  draft,
  targets,
  onClose,
  onLanded,
}: {
  readonly environmentId: EnvironmentId;
  readonly draft: WikiChangeRequest;
  readonly targets: ReadonlyArray<WikiChangeRequest>;
  readonly onClose: () => void;
  readonly onLanded?: (changeRequestId: WikiChangeRequestId, files: ReadonlyArray<string>) => void;
}) {
  const id = useId();
  const terms = useWikiTerms(environmentId, draft.wikiId);
  const files = changeRequestFiles(draft);
  const [target, setTarget] = useState<WikiChangeRequestId | null>(null);
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set(files));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const move = useWikiCommand(wikiEnvironment.moveDraft);
  const canSubmit = target !== null && picked.size > 0 && !busy;
  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    const moving = [...picked];
    const outcome = await move({
      environmentId,
      input: {
        wikiId: draft.wikiId,
        changeRequestId: draft.changeRequestId,
        to: target,
        ...(picked.size === files.length ? {} : { files: moving }),
      },
    });
    setBusy(false);
    if (!outcome.ok) {
      setError(outcome.message);
      return;
    }
    onClose();
    onLanded?.(target, moving);
  };
  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogPopup className="sm:max-w-md">
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{`Move to another ${terms.singular}`}</DialogTitle>
            <DialogDescription>
              The documents you pick join it as one amendment and leave your draft.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="flex flex-col gap-4">
              {targets.length === 0 ? (
                <DraftError message={`No other ${terms.singular} is open on this wiki.`} />
              ) : (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`${id}-target`}>{terms.Singular}</Label>
                  <Select
                    value={target}
                    items={Object.fromEntries(
                      targets.map((entry) => [entry.changeRequestId, entry.title]),
                    )}
                    onValueChange={(value) => setTarget(value)}
                  >
                    <SelectTrigger id={`${id}-target`}>
                      <SelectValue placeholder="Choose one" />
                    </SelectTrigger>
                    <SelectPopup>
                      {targets.map((entry) => (
                        <MoveTarget
                          key={entry.changeRequestId}
                          environmentId={environmentId}
                          changeRequest={entry}
                        />
                      ))}
                    </SelectPopup>
                  </Select>
                </div>
              )}
              <div className="flex flex-col gap-1.5">
                <Label>Documents</Label>
                {files.map((file) => (
                  <label key={file} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={picked.has(file)}
                      onCheckedChange={(checked) =>
                        setPicked((current) => {
                          const next = new Set(current);
                          if (checked) next.add(file);
                          else next.delete(file);
                          return next;
                        })
                      }
                    />
                    <span className="min-w-0 truncate">{documentPath(file)}</span>
                  </label>
                ))}
              </div>
              {error ? <DraftError message={error} /> : null}
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {busy ? <Spinner /> : null}
              Move
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

function DraftError({ message }: { readonly message: string | null }) {
  return (
    <Alert variant="error">
      <TriangleAlertIcon />
      <AlertDescription>{message ?? "That was cancelled."}</AlertDescription>
    </Alert>
  );
}
