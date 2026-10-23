import type {
  EnvironmentId,
  ThreadId,
  WikiChangeRequest,
  WikiChangeRequestId,
  WikiId,
} from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useAtomValue } from "@effect/atom-react";
import { useBlocker } from "@tanstack/react-router";
import { TriangleAlertIcon } from "lucide-react";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";

import { ensureLocalApi } from "~/localApi";
import { useThreadShell } from "~/state/entities";
import { useEnvironmentQuery } from "~/state/query";
import { wikiEnvironment } from "~/state/wiki";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { ScrollArea } from "../ui/scroll-area";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";
import {
  authorColor,
  defaultSaveTarget,
  describeWikiFailure,
  isTurnRunning,
  latestAmendmentFor,
  noteKey,
  PERSON_ACTOR,
  queuedSaveStep,
  type QueuedWikiSave,
} from "./wiki.logic";
import { WikiNoteBuffer, type WikiNoteAuthor } from "@mercurian/wiki-editor/note-buffer";
import { WikiNoteEditor } from "./WikiNoteEditor";
import { useWikiCommand } from "./wikiEnvironment";
import { WikiPart } from "./WikiParts";

const NEW_CHANGE_REQUEST = "new";

/** Where a save lands: an open change request, or a new one with this title. */
type SaveTarget = { readonly changeRequestId: WikiChangeRequestId } | { readonly title: string };

/** Whether the turn of the change request's thread is running, read from its thread shell. */
function useChangeRequestTurn(environmentId: EnvironmentId, threadId: ThreadId | null | undefined) {
  const shell = useThreadShell(
    threadId === null || threadId === undefined ? null : scopeThreadRef(environmentId, threadId),
  );
  const running = isTurnRunning(shell?.source.status);
  return { running, runId: running ? (shell?.latestRun?.runId ?? null) : null };
}

/**
 * One note, editable. Edits stay in the buffer until saved to a change request.
 *
 * Read inside a change request, every new version of the note that is not the person's own
 * save is an amendment (by the thread's agent, mostly) and lands live in the open document,
 * attributed to the amendment's actor and reviewable from the change bar, without touching the
 * person's unsaved edits. While that thread's turn runs, Save waits for the turn to end and then
 * commits the buffer, which already holds both. Read from main, a change reloads the note only
 * while there are no unsaved edits, and otherwise says so.
 */
export function WikiNoteView({
  environmentId,
  wikiId,
  name,
  changeRequestId,
  openChangeRequests,
  onOpenNote,
  onSaved,
  registerUnsaved,
}: {
  readonly environmentId: EnvironmentId;
  readonly wikiId: WikiId;
  readonly name: string;
  readonly changeRequestId: WikiChangeRequestId | undefined;
  readonly openChangeRequests: ReadonlyArray<WikiChangeRequest>;
  readonly onOpenNote: (name: string) => void;
  readonly onSaved: (changeRequestId: WikiChangeRequestId) => void;
  /** Lets whoever shows the note ask whether its edits are unsaved, as closing its tab does. */
  readonly registerUnsaved?: (isUnsaved: () => boolean) => () => void;
}) {
  const scope = changeRequestId === undefined ? {} : { changeRequestId };
  const note = useEnvironmentQuery(
    wikiEnvironment.note({ environmentId, input: { wikiId, name, ...scope } }),
  );
  const index = useEnvironmentQuery(
    wikiEnvironment.index({ environmentId, input: { wikiId, ...scope } }),
  );
  const viewingChange = openChangeRequests.find(
    (changeRequest) => changeRequest.changeRequestId === changeRequestId,
  );
  const viewingTurn = useChangeRequestTurn(environmentId, viewingChange?.threadId);
  const file = note.data?.file ?? null;
  // Who a live version is by: the newest amendment of this note in the change request.
  const latest = file === null ? null : latestAmendmentFor(viewingChange, file);
  const authorName =
    latest === null ? "Agent" : latest.actor === PERSON_ACTOR ? "You, elsewhere" : latest.actor;
  const turnId =
    viewingTurn.runId !== null ? `run:${viewingTurn.runId}` : `amendment:${latest?.commit ?? ""}`;

  const [buffer] = useState(() => new WikiNoteBuffer());
  useEffect(() => () => buffer.release(), [buffer]);
  const incoming = note.data?.source ?? null;
  const live = changeRequestId !== undefined;
  useEffect(() => {
    if (incoming === null) return;
    const author: WikiNoteAuthor | null = live
      ? { name: authorName, color: authorColor(authorName), turnId }
      : null;
    buffer.receive(incoming, author);
    // Outside a running turn a write is the whole turn: it settles at once.
    if (!viewingTurn.running) buffer.endTurn();
  }, [buffer, incoming, live, authorName, turnId, viewingTurn.running]);
  const snapshot = useSyncExternalStore(buffer.subscribe, buffer.getSnapshot);
  useEffect(() => registerUnsaved?.(() => buffer.getSnapshot().dirty), [buffer, registerUnsaved]);

  // Leaving the note, for another note or another page, would drop unsaved edits.
  useBlocker({
    disabled: !snapshot.dirty,
    enableBeforeUnload: () => buffer.getSnapshot().dirty,
    shouldBlockFn: async () => {
      if (!buffer.getSnapshot().dirty) return false;
      const leave = await ensureLocalApi().dialogs.confirm(
        `Leave ${name}? Your unsaved edits will be lost.`,
        { variant: "destructive" },
      );
      return !leave;
    },
  });

  const amend = useWikiCommand(wikiEnvironment.amend, "Couldn't save the note");
  /** Commits the buffer as it stands now; the outcome's message, or null on success. */
  const commit = async (target: SaveTarget, message: string): Promise<string | null> => {
    if (file === null) return "The note isn't loaded yet.";
    const text = buffer.current();
    const outcome = await amend({
      environmentId,
      input: { wikiId, message, changes: { [file]: text }, ...target },
    });
    if (!outcome.ok) return outcome.message ?? "The save was cancelled.";
    buffer.markSaved(text);
    onSaved(outcome.value.changeRequest.changeRequestId);
    return null;
  };

  // A save queued behind a running turn commits once that turn ends.
  const [queued, setQueued] = useState<QueuedWikiSave | null>(null);
  const committing = useRef(false);
  const queuedChange = openChangeRequests.find(
    (changeRequest) => changeRequest.changeRequestId === queued?.changeRequestId,
  );
  const queuedTurn = useChangeRequestTurn(environmentId, queuedChange?.threadId);
  useEffect(() => {
    const step = queuedSaveStep({
      queued,
      turnRunning: queuedTurn.running,
      committing: committing.current,
    });
    if (step !== "commit" || queued === null) return;
    // The buffer is committed as it stands when the turn ends: the agent's writes and the
    // person's edits together.
    committing.current = true;
    void commit({ changeRequestId: queued.changeRequestId }, queued.message).finally(() => {
      committing.current = false;
      setQueued(null);
    });
  }, [queued, queuedTurn.running, commit]);

  const [saving, setSaving] = useState(false);
  const known = new Set((index.data?.notes ?? []).map((entry) => noteKey(entry.name)));

  if (note.data === null) {
    return note.error !== null ? (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Couldn't open {name}</EmptyTitle>
          <EmptyDescription>{describeWikiFailure(note.failure ?? note.error)}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    ) : (
      <Empty>
        <Spinner size="md" tone="muted" />
      </Empty>
    );
  }
  const data = note.data;
  const readOnly = data.file.endsWith(".skillmap.md");

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/* The view's header, as Obsidian's: one line as tall as the pane's tab strip above it,
          whose bottom border is the only line between them and the note. */}
      <div className="flex h-(--workspace-topbar-height) shrink-0 items-center gap-2 overflow-hidden px-6">
        <h2 className="min-w-0 truncate text-base font-semibold">{data.name}</h2>
        {readOnly ? <Badge variant="secondary">Skill map · read only</Badge> : null}
        {data.exists ? null : <Badge variant="warning">Not written yet</Badge>}
        <span className="min-w-0 truncate text-xs text-muted-foreground">
          {changeRequestId === undefined
            ? "Main"
            : viewingChange
              ? `In “${viewingChange.title}”${viewingTurn.running ? " · agent working" : ""}`
              : "In a change request"}
        </span>
        <div className="min-w-0 flex-1" />
        {queued !== null ? (
          <>
            <span className="text-xs text-muted-foreground">Saves when the turn ends</span>
            <Button variant="ghost" size="sm" onClick={() => setQueued(null)}>
              Cancel save
            </Button>
          </>
        ) : snapshot.dirty ? (
          <>
            <Button variant="ghost" size="sm" onClick={() => buffer.discard()}>
              Discard edits
            </Button>
            <Button size="sm" onClick={() => setSaving(true)}>
              Save to change request
            </Button>
          </>
        ) : null}
      </div>
      {snapshot.changedUnderneath ? (
        <div className="shrink-0 px-6 pt-3">
          <Alert variant="warning">
            <TriangleAlertIcon />
            <AlertTitle>This note changed while you were editing</AlertTitle>
            <AlertDescription>
              Your edits are kept. Save them, or load the new version and lose them.
            </AlertDescription>
            <AlertAction>
              <Button variant="outline" size="sm" onClick={() => buffer.loadChanged()}>
                Load new version
              </Button>
            </AlertAction>
          </Alert>
        </div>
      ) : null}
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 pt-6 pb-12">
          {data.exists ? null : (
            <WikiPart.Muted>
              {`No note is called ${data.name} yet. Write it here and save it to a change request.`}
            </WikiPart.Muted>
          )}
          {snapshot.session ? (
            <WikiNoteEditor
              key={snapshot.session.doc.guid}
              session={snapshot.session}
              readOnly={readOnly}
              onOpenNote={onOpenNote}
              onWrite={() => {
                if (buffer.getSnapshot().dirty) setSaving(true);
                else toastManager.add({ type: "info", title: "No edits to save" });
              }}
            />
          ) : null}
          <div className="grid gap-6 border-t border-border pt-4 sm:grid-cols-2">
            <WikiPart.Section title="Links here">
              {data.incoming.length === 0 ? (
                <WikiPart.Muted>No note links here yet.</WikiPart.Muted>
              ) : (
                data.incoming.map((source) => (
                  <WikiPart.Row key={source} title={source} onClick={() => onOpenNote(source)} />
                ))
              )}
            </WikiPart.Section>
            <WikiPart.Section title="Links to">
              {data.outgoing.length === 0 ? (
                <WikiPart.Muted>This note links nowhere yet.</WikiPart.Muted>
              ) : (
                data.outgoing.map((target) => (
                  <WikiPart.Row
                    key={target}
                    title={target}
                    tone={index.data === null || known.has(noteKey(target)) ? "default" : "missing"}
                    onClick={() => onOpenNote(target)}
                  />
                ))
              )}
            </WikiPart.Section>
          </div>
        </div>
      </ScrollArea>
      {saving ? (
        <SaveToChangeRequestDialog
          environmentId={environmentId}
          noteName={data.name}
          openChangeRequests={openChangeRequests}
          viewing={changeRequestId}
          onClose={() => setSaving(false)}
          onSave={async (target, message) => {
            const error = await commit(target, message);
            if (error === null) setSaving(false);
            return error;
          }}
          onQueue={(save) => {
            setQueued(save);
            setSaving(false);
          }}
        />
      ) : null}
    </div>
  );
}

/** Saves the buffer as one amendment: into an open change request, or a new one. */
function SaveToChangeRequestDialog({
  environmentId,
  noteName,
  openChangeRequests,
  viewing,
  onClose,
  onSave,
  onQueue,
}: {
  readonly environmentId: EnvironmentId;
  readonly noteName: string;
  readonly openChangeRequests: ReadonlyArray<WikiChangeRequest>;
  readonly viewing: WikiChangeRequestId | undefined;
  readonly onClose: () => void;
  /** Saves now; resolves to the failure's message, or null. */
  readonly onSave: (target: SaveTarget, message: string) => Promise<string | null>;
  /** Saves once the turn of the target's thread ends. */
  readonly onQueue: (save: QueuedWikiSave) => void;
}) {
  const id = useId();
  const canAmend = useAtomValue(wikiEnvironment.amend.permissionAtom(environmentId));
  const [target, setTarget] = useState<string>(
    () => defaultSaveTarget(openChangeRequests, viewing) ?? NEW_CHANGE_REQUEST,
  );
  const [title, setTitle] = useState(`Edit ${noteName}`);
  const [message, setMessage] = useState(`Edit ${noteName}`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const opensNew = target === NEW_CHANGE_REQUEST;
  const shownError = error ?? (canAmend ? null : "You don't have permission to change this wiki.");
  const canSubmit =
    canAmend && message.trim().length > 0 && (!opensNew || title.trim().length > 0) && !busy;
  const targetChange = openChangeRequests.find(
    (changeRequest) => changeRequest.changeRequestId === target,
  );
  // The target's thread is mid-turn: the save waits for the turn to end rather than steer it.
  const waitsForTurn = useChangeRequestTurn(environmentId, targetChange?.threadId).running;

  const submit = async () => {
    if (!canSubmit) return;
    if (waitsForTurn && targetChange) {
      onQueue({ changeRequestId: targetChange.changeRequestId, message: message.trim() });
      return;
    }
    setBusy(true);
    setError(null);
    const failure = await onSave(
      opensNew ? { title: title.trim() } : { changeRequestId: target as WikiChangeRequestId },
      message.trim(),
    );
    setBusy(false);
    setError(failure);
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogPopup className="sm:max-w-md">
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>Save to change request</DialogTitle>
            <DialogDescription>
              Your edit is added to a change request. Main changes only when someone merges it.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${id}-target`}>Change request</Label>
                <Select
                  value={target}
                  items={{
                    [NEW_CHANGE_REQUEST]: "New change request",
                    ...Object.fromEntries(
                      openChangeRequests.map((changeRequest) => [
                        changeRequest.changeRequestId,
                        changeRequest.title,
                      ]),
                    ),
                  }}
                  onValueChange={(value) => {
                    if (typeof value === "string") setTarget(value);
                  }}
                >
                  <SelectTrigger id={`${id}-target`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectPopup>
                    <SelectItem value={NEW_CHANGE_REQUEST}>New change request</SelectItem>
                    {openChangeRequests.map((changeRequest) => (
                      <SelectItem
                        key={changeRequest.changeRequestId}
                        value={changeRequest.changeRequestId}
                      >
                        {changeRequest.title}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </div>
              {opensNew ? (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`${id}-title`}>Title</Label>
                  <Input
                    id={`${id}-title`}
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                  />
                </div>
              ) : null}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${id}-message`}>What changed</Label>
                <Input
                  id={`${id}-message`}
                  autoFocus
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                />
              </div>
              {waitsForTurn ? (
                <WikiPart.Muted>
                  {`The agent is working in this change request. Your edit is saved when its turn ends; until then the agent's writes keep landing around it.`}
                </WikiPart.Muted>
              ) : null}
              {shownError ? (
                <Alert variant="error">
                  <TriangleAlertIcon />
                  <AlertDescription>{shownError}</AlertDescription>
                </Alert>
              ) : null}
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {busy ? <Spinner /> : null}
              {waitsForTurn ? "Save when the turn ends" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
