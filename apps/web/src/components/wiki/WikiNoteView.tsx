import { useAtomValue } from "@effect/atom-react";
import type { WikiSaveOutcome } from "@t3tools/client-runtime/wikiAutosave";
import type {
  EnvironmentId,
  WikiChangeRequest,
  WikiChangeRequestId,
  WikiId,
  WikiIndexResult,
} from "@t3tools/contracts";
import { useBlocker } from "@tanstack/react-router";
import { TriangleAlertIcon } from "lucide-react";
import { lazy, Suspense, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";

import { ensureLocalApi } from "~/localApi";
import { useEnvironmentQuery } from "~/state/query";
import { wikiEnvironment } from "~/state/wiki";
import { TabHeader } from "~/panes/TabHeader";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "../ui/alert";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";
import {
  authorColor,
  describeWikiFailure,
  isSettledChangeRequest,
  latestAmendmentFor,
  noteKey,
  PERSON_ACTOR,
} from "./wiki.logic";
import { WikiLinkPreview, type WikiLinkPeek } from "@mercurian/wiki-editor/link-tools";
import { WikiNoteBuffer, type WikiNoteAuthor } from "@mercurian/wiki-editor/note-buffer";
import { WikiBase } from "./WikiBaseView";
import { WikiMermaid } from "./WikiMermaid";
import { WikiNoteEditor } from "./WikiNoteEditor";
import {
  holdsEdits,
  useChangeRequestTurn,
  useWikiAutosave,
  WikiSaveFailure,
  WikiSaveStatus,
} from "./wikiAutosave";
import { useWikiAutosaveCommand } from "./wikiEnvironment";
import { WikiPart } from "./WikiParts";

const NO_LINK_TYPES: ReadonlyArray<string> = [];

/** What a document gives its draft's pill: acting on the draft acts on what's still unsaved. */
export interface WikiDraftEdits {
  readonly flush: () => Promise<boolean>;
  readonly drop: () => void;
}

const WikiCanvasEmbed = lazy(() => import("./WikiCanvasEmbed"));

/** What a `[[` can complete to: notes by name, bases and canvases by file. */
const wikiLinkNames = (index: WikiIndexResult | null): ReadonlyArray<string> => [
  ...(index?.notes ?? []).map((note) => note.name),
  ...(index?.canvases ?? []).map((canvas) => canvas.file),
  ...(index?.bases ?? []).map((base) => base.file),
];

function LinkPreview({
  environmentId,
  wikiId,
  changeRequestId,
  link,
}: {
  readonly environmentId: EnvironmentId;
  readonly wikiId: WikiId;
  readonly changeRequestId: WikiChangeRequestId | undefined;
  readonly link: WikiLinkPeek;
}) {
  const scope = changeRequestId === undefined ? {} : { changeRequestId };
  const { data } = useEnvironmentQuery(
    wikiEnvironment.note({ environmentId, input: { wikiId, name: link.name, ...scope } }),
  );
  return (
    <WikiLinkPreview
      link={link}
      source={data === null ? undefined : data.exists ? data.source : null}
    />
  );
}

/**
 * One note, editable; edits save by themselves, to the change request the tab is in, else the
 * person's draft. Reading from a change request, every version that isn't this buffer's own is an
 * amendment landing live, attributed and reviewable, beside whatever hasn't saved yet. While the
 * thread's turn runs, saves wait for it to end. Read from main, a change reloads the note.
 */
export function WikiNoteView({
  environmentId,
  wikiId,
  name,
  changeRequestId,
  savesTo,
  changeRequests,
  location,
  renderDraftPill,
  onOpenNote,
  registerUnsaved,
}: {
  readonly environmentId: EnvironmentId;
  readonly wikiId: WikiId;
  readonly name: string;
  /** The change request the note reads from; none reads main. */
  readonly changeRequestId: WikiChangeRequestId | undefined;
  /** The change request the tab is in; none saves to the draft. */
  readonly savesTo: WikiChangeRequestId | undefined;
  readonly changeRequests: ReadonlyArray<WikiChangeRequest>;
  /** Where the note reads from, as the tab header names it. */
  readonly location: string;
  /** The draft's pill in the header's place for `location`, when there's a draft. */
  readonly renderDraftPill?: (edits: WikiDraftEdits) => ReactNode;
  readonly onOpenNote: (name: string) => void;
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
  const viewingChange = changeRequests.find(
    (changeRequest) => changeRequest.changeRequestId === changeRequestId,
  );
  const settled = isSettledChangeRequest(viewingChange);
  const viewingTurn = useChangeRequestTurn(
    environmentId,
    viewingChange?.status === "open" ? viewingChange.threadId : null,
  );
  // A first save moves the read from main to the draft; the note stays on screen across it.
  const [lastNote, setLastNote] = useState(note.data);
  if (note.data !== null && note.data !== lastNote) setLastNote(note.data);
  const data = note.data ?? lastNote;
  const file = data?.file ?? null;
  // Who a live version is by: the newest amendment of this note in the change request.
  const latest = file === null ? null : latestAmendmentFor(viewingChange, file);
  const authorName =
    latest === null ? "Agent" : latest.actor === PERSON_ACTOR ? "You, elsewhere" : latest.actor;
  const turnId =
    viewingTurn.runId !== null ? `run:${viewingTurn.runId}` : `amendment:${latest?.commit ?? ""}`;

  const [buffer] = useState(() => new WikiNoteBuffer());
  const incoming = note.data?.source ?? null;
  const incomingCommit = note.data?.commit ?? null;
  const live = changeRequestId !== undefined;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- feeds the fetched note source and its author into the note buffer
  useEffect(() => {
    if (incoming === null) return;
    const author: WikiNoteAuthor | null = live
      ? { name: authorName, color: authorColor(authorName), turnId }
      : null;
    buffer.receive(incoming, author, incomingCommit);
    // Outside a running turn a write is the whole turn: it settles at once.
    if (!viewingTurn.running) buffer.endTurn();
  }, [buffer, incoming, incomingCommit, live, authorName, turnId, viewingTurn.running]);
  const snapshot = useSyncExternalStore(buffer.subscribe, buffer.getSnapshot);

  const send = useWikiAutosaveCommand();
  /** Lands `text`, which agreed with `readAt` when typed. */
  const land = async (text: string, readAt: string | null): Promise<WikiSaveOutcome> => {
    if (file === null) return { ok: true };
    const outcome = await send({
      environmentId,
      input: {
        wikiId,
        ...(savesTo === undefined ? {} : { changeRequestId: savesTo }),
        document: file,
        write: { kind: "text", file, text, ...(readAt === null ? {} : { readAt }) },
      },
    });
    if (!outcome.ok) return outcome;
    buffer.markSaved(text, outcome.value.commit ?? undefined);
    return { ok: true };
  };
  const { autosave, status } = useWikiAutosave({
    subject: name,
    save: async () =>
      buffer.getSnapshot().dirty ? land(buffer.current(), buffer.version()) : { ok: true },
    freeze: () => {
      const text = buffer.current();
      const readAt = buffer.version();
      return () => land(text, readAt);
    },
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- releases the note buffer on unmount, after the store above took what it holds
  useEffect(() => () => buffer.release(), [buffer]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- each edit reaches the autosave store outside React, so typing renders nothing
  useEffect(() => buffer.onEdit(autosave.edited), [buffer, autosave]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a running turn holds the autosave store, which lives outside React
  useEffect(() => autosave.setHeld(viewingTurn.running), [autosave, viewingTurn.running]);
  const holding = holdsEdits(status);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- registers this note's held-edits check with its tab until unmount
  useEffect(
    () => registerUnsaved?.(() => holdsEdits(autosave.getStatus())),
    [autosave, registerUnsaved],
  );

  // Edits that save by themselves don't stop anyone leaving; ones that can't yet do.
  useBlocker({
    disabled: !holding,
    enableBeforeUnload: () => holdsEdits(autosave.getStatus()),
    shouldBlockFn: async () => {
      if (!holdsEdits(autosave.getStatus())) return false;
      const leave = await ensureLocalApi().dialogs.confirm(
        `Leave ${name}? Your unsaved edits will be lost.`,
        { variant: "destructive" },
      );
      if (leave) autosave.cancel();
      return !leave;
    },
  });

  const canEdit = useAtomValue(wikiEnvironment.autosave.permissionAtom(environmentId));
  const documents = wikiLinkNames(index.data);
  const known = new Set(documents.map(noteKey));

  if (data === null) {
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
  const skillMap = data.file.endsWith(".skillmap.md");
  const readOnly = skillMap || settled || !canEdit;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <TabHeader.Root>
        <TabHeader.Title
          label="Document"
          parent={location}
          parentControl={renderDraftPill?.({
            flush: autosave.flush,
            drop: () => {
              autosave.cancel();
            },
          })}
        >
          {data.name}
        </TabHeader.Title>
        {skillMap ? <TabHeader.Status>Skill map · read only</TabHeader.Status> : null}
        {settled ? (
          <TabHeader.Status>{`${viewingChange?.status === "merged" ? "Merged" : "Closed"} · read only`}</TabHeader.Status>
        ) : null}
        {data.exists ? null : <TabHeader.Status>Not written yet</TabHeader.Status>}
        {viewingTurn.running ? <TabHeader.Status>Agent working</TabHeader.Status> : null}
        <WikiSaveStatus status={status} />
      </TabHeader.Root>
      <WikiSaveFailure status={status} autosave={autosave} />
      {snapshot.changedUnderneath ? (
        <div className="shrink-0 px-6 pt-3">
          <Alert variant="warning">
            <TriangleAlertIcon />
            <AlertTitle>This note changed while you were editing</AlertTitle>
            <AlertDescription>
              Your edits are kept, and they save over it unless you load the new version.
            </AlertDescription>
            <AlertAction>
              <Button variant="outline" size="sm" onClick={() => buffer.loadChanged()}>
                Load new version
              </Button>
            </AlertAction>
          </Alert>
        </div>
      ) : null}
      <div className="topbar-scroll-fade scrollbar-gutter-both min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 pt-6 pb-12">
          {data.exists ? null : (
            <WikiPart.Muted>
              {`No note is called ${data.name} yet. Write it here, and it saves to your draft.`}
            </WikiPart.Muted>
          )}
          {snapshot.session ? (
            <WikiNoteEditor
              key={snapshot.session.doc.guid}
              session={snapshot.session}
              readOnly={readOnly}
              onOpenNote={onOpenNote}
              linkTypes={index.data?.linkTypes ?? NO_LINK_TYPES}
              linkNames={documents}
              renderLinkPreview={(link) => (
                <LinkPreview
                  environmentId={environmentId}
                  wikiId={wikiId}
                  changeRequestId={changeRequestId}
                  link={link}
                />
              )}
              renderBase={(source) => (
                <WikiBase
                  environmentId={environmentId}
                  wikiId={wikiId}
                  changeRequestId={changeRequestId}
                  from={{ source, note: data.name }}
                  onOpenNote={onOpenNote}
                />
              )}
              renderBaseEmbed={(target) => {
                const [base = "", view] = target.split("#");
                return (
                  <WikiBase
                    environmentId={environmentId}
                    wikiId={wikiId}
                    changeRequestId={changeRequestId}
                    from={{ base: base.trim() }}
                    view={view?.trim() || undefined}
                    onOpenNote={onOpenNote}
                  />
                );
              }}
              renderCanvasEmbed={(target) => (
                <Suspense fallback={null}>
                  <WikiCanvasEmbed
                    environmentId={environmentId}
                    wikiId={wikiId}
                    changeRequestId={changeRequestId}
                    file={target.split("#")[0]?.trim() ?? target}
                    onOpen={onOpenNote}
                  />
                </Suspense>
              )}
              renderMermaid={(source) => <WikiMermaid source={source} />}
              onWrite={() => {
                if (buffer.getSnapshot().dirty) void autosave.flush();
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
      </div>
    </div>
  );
}
