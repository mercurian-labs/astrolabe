/* oxlint-disable t3code/no-untranslated-copy -- Astrolabe-only copy, shipped in English. */
import {
  canvasGroups,
  parseCanvas,
  type CanvasData,
  type CanvasMarks,
} from "@mercurian/wiki/canvas";
import {
  CanvasBoard,
  type CanvasBoardHandle,
  type CanvasBoardSettings,
} from "@mercurian/wiki-editor/canvas-board";
import { CanvasDocument } from "@mercurian/wiki-editor/canvas-document";
import { useAtomValue } from "@effect/atom-react";
import { changeRequestCanvasReview } from "@t3tools/client-runtime/wikiLogic";
import type {
  EnvironmentId,
  UnifiedSettings,
  WikiChangeRequestId,
  ProjectRootId,
} from "@t3tools/contracts";
import { useBlocker } from "@tanstack/react-router";
import { TriangleAlertIcon } from "lucide-react";
import * as Schema from "effect/Schema";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { useLocalStorage } from "~/hooks/useLocalStorage";
import { useEnvironmentSettings, useUpdateEnvironmentSettings } from "~/hooks/useSettings";
import { ensureLocalApi } from "~/localApi";
import { TabHeader } from "~/panes/TabHeader";
import { useEnvironmentQuery } from "~/state/query";
import { wikiEnvironment } from "~/state/wiki";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";
import {
  describeWikiFailure,
  documentPath,
  documentTitle,
  exactWikiPath,
  isSettledChangeRequest,
} from "./wiki.logic";
import {
  holdsEdits,
  useChangeRequestTurn,
  useWikiAutosave,
  WikiSaveFailure,
  WikiSaveStatus,
} from "./wikiAutosave";
import {
  canvasReadOnlyKey,
  registerWikiCanvasBoard,
  useWikiCanvasFocus,
  type WikiCanvasGroup,
} from "./wikiCanvasBoards";
import { useWikiAutosaveCommand, useWikiCommand, useWikiTerms } from "./wikiEnvironment";
import { useCanvasDiskWrites, useWikiCanvasHost, type CanvasProjectLinks } from "./wikiCanvasHost";
import type { WikiDraftEdits } from "./WikiNoteView";

function CanvasBoardPane({
  tabKey,
  environmentId,
  wikiId,
  changeRequestId,
  cardsFrom,
  savesTo,
  file,
  commit,
  data,
  marks,
  groups,
  canvas,
  readOnly,
  onReadOnly,
  onOpenNote,
  onOpenFile,
  onOpenTab,
  onOpenInNewTab,
  checkout,
  projectLinks,
}: {
  readonly tabKey: string;
  readonly environmentId: EnvironmentId;
  readonly wikiId: ProjectRootId;
  readonly checkout: string | undefined;
  readonly projectLinks: CanvasProjectLinks | undefined;
  readonly changeRequestId: WikiChangeRequestId | undefined;
  /** A person's draft, which can hold notes that a board read from main doesn't. */
  readonly cardsFrom: WikiChangeRequestId | undefined;
  readonly savesTo: WikiChangeRequestId | undefined;
  readonly file: string;
  readonly commit: string;
  readonly data: CanvasData;
  /** What the change request it's read in changes, until that's merged or closed. */
  readonly marks: CanvasMarks | undefined;
  readonly groups: ReadonlyArray<WikiCanvasGroup>;
  /** Set where this person can change cards. */
  readonly canvas: CanvasDocument | null;
  readonly readOnly: boolean;
  readonly onReadOnly: (on: boolean) => void;
  readonly onOpenNote: (name: string) => void;
  readonly onOpenFile: ((path: string) => void) | undefined;
  readonly onOpenTab: (key: string) => void;
  readonly onOpenInNewTab: ((name: string) => void) | undefined;
}) {
  const host = useWikiCanvasHost({
    environmentId,
    wikiId,
    file,
    changeRequestId,
    draftId: cardsFrom,
    commit,
    onOpenNote,
    onOpenFile,
    onOpenTab,
    savesTo,
    onOpenInNewTab,
    checkout,
    projectLinks,
  });
  const settings = useEnvironmentSettings(environmentId, selectCanvasSettings);
  const updateSettings = useUpdateEnvironmentSettings(environmentId);
  const onSettings = (patch: Partial<CanvasBoardSettings>) =>
    updateSettings({ wikiCanvas: { ...settings, ...patch } });

  const board = useRef<CanvasBoardHandle>(null);
  const editable = canvas !== null && !readOnly;
  const focus = useWikiCanvasFocus((state) => state.byTab[tabKey]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the command palette reaches this canvas through a registry outside React
  useEffect(
    () =>
      registerWikiCanvasBoard(tabKey, {
        groups,
        jumpToGroup: (id) => board.current?.focusCard(id),
        editable,
        run: (command) => board.current?.run(command),
      }),
    [tabKey, groups, editable],
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="min-h-0 flex-1">
        <CanvasBoard
          ref={board}
          data={data}
          mode="free"
          host={host}
          label={documentTitle(file)}
          revision={commit}
          document={canvas}
          readOnly={readOnly}
          onReadOnly={onReadOnly}
          settings={settings}
          onSettings={onSettings}
          focus={focus}
          {...(marks === undefined ? {} : { marks })}
        />
      </div>
    </div>
  );
}

const selectCanvasSettings = (settings: UnifiedSettings) => settings.wikiCanvas;

const EMPTY_GROUPS: ReadonlyArray<WikiCanvasGroup> = [];
const ReadOnlyFlag = Schema.Boolean;

/** A board read on disk has no commit of its own: its text names the version on screen. */
function diskVersion(commit: string, text: string | null) {
  const source = text ?? "";
  let hash = 0x811c9dc5;
  for (let at = 0; at < source.length; at++) {
    hash = Math.imul(hash ^ source.charCodeAt(at), 0x01000193);
  }
  return `${commit}:disk-${(hash >>> 0).toString(16)}`;
}

/**
 * A `.canvas` file in its own tab, read from main or a change request, and refreshed per commit
 * with its camera kept. In a change request it marks what that changes, so an agent's work shows
 * as it lands. Edits land by themselves, in the change request the tab is in or the person's draft,
 * so a canvas has no Save: only what's closed, or out of this person's reach, stays read only.
 */
export default function WikiCanvasPage({
  tabKey,
  environmentId,
  wikiId,
  file,
  changeRequestId,
  cardsFrom,
  savesTo,
  parent,
  renderDraftPill,
  registerUnsaved,
  onOpenNote,
  onOpenFile,
  onOpenTab,
  onOpenInNewTab,
  checkout,
  canWrite: canWriteHere,
  diskRevision,
  projectLinks,
}: {
  readonly tabKey: string;
  readonly environmentId: EnvironmentId;
  readonly wikiId: ProjectRootId;
  readonly file: string;
  /** Astrolabe: a project root's folder, read and written on disk rather than in a draft. */
  readonly checkout?: string | undefined;
  /** Whether this person can write where the board saves; the draft's permission without it. */
  readonly canWrite?: boolean | undefined;
  /** Changes when the folder's files change on disk, which reads the board again. */
  readonly diskRevision?: string | undefined;
  readonly projectLinks?: CanvasProjectLinks | undefined;
  /** The change request the canvas reads from; none reads main. */
  readonly changeRequestId: WikiChangeRequestId | undefined;
  readonly cardsFrom: WikiChangeRequestId | undefined;
  /** The change request the tab is in; none saves to the draft. */
  readonly savesTo: WikiChangeRequestId | undefined;
  /** Where the canvas is read from, as the tab header names it. */
  readonly parent: string;
  /** The draft's pill in the header's place for `parent`, when there's a draft. */
  readonly renderDraftPill?: (edits: WikiDraftEdits) => ReactNode;
  readonly registerUnsaved?: (isUnsaved: () => boolean, save: () => Promise<boolean>) => () => void;
  readonly onOpenNote: (name: string) => void;
  readonly onOpenFile: ((path: string) => void) | undefined;
  readonly onOpenTab: (key: string) => void;
  readonly onOpenInNewTab?: (name: string) => void;
}) {
  const scope =
    checkout !== undefined
      ? { checkout }
      : changeRequestId === undefined
        ? {}
        : { changeRequestId };
  const query = useEnvironmentQuery(
    wikiEnvironment.files({
      environmentId,
      input: { wikiId, ...scope, paths: [exactWikiPath(file)] },
    }),
  );
  const reread = query.refresh;
  const readAt = useRef(diskRevision);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- edits on disk (an agent, an editor, git) reach a checkout's board only through its folder's watch
  useEffect(() => {
    if (readAt.current === diskRevision) return;
    readAt.current = diskRevision;
    reread();
  }, [diskRevision, reread]);
  // The first edit moves the tab onto the draft: a new read, which mustn't take the board down.
  const [files, setFiles] = useState(query.data);
  if (query.data !== null && query.data !== files) setFiles(query.data);
  const read = files?.files[0];
  const text = read?.text ?? null;
  const parsed = text === null ? null : parseCanvas(text);
  const detail = useEnvironmentQuery(
    changeRequestId === undefined
      ? null
      : wikiEnvironment.changeRequest({ environmentId, input: { wikiId, changeRequestId } }),
  );
  const changeRequest = detail.data?.changeRequest;
  const review = changeRequestCanvasReview(detail.data, file, text);
  const title = documentTitle(file);
  const terms = useWikiTerms(environmentId, wikiId);
  const [creating, setCreating] = useState(false);
  const canAutosave = useAtomValue(wikiEnvironment.autosave.permissionAtom(environmentId));
  const canWrite = canWriteHere ?? canAutosave;
  const autosaveCommand = useWikiCommand(wikiEnvironment.autosave, "Couldn't start the canvas");
  const disk = useCanvasDiskWrites(environmentId, wikiId);
  const create = async () => {
    setCreating(true);
    if (checkout !== undefined) {
      const made = await disk.transform(checkout, file, { kind: "canvas-create", file });
      if (made.ok) reread();
      else
        toastManager.add({
          type: "error",
          title: "Couldn't start the canvas",
          description: made.message,
        });
      setCreating(false);
      return;
    }
    await autosaveCommand({
      environmentId,
      input: {
        wikiId,
        ...(savesTo === undefined ? {} : { changeRequestId: savesTo }),
        document: file,
        write: { kind: "transform", transform: { kind: "canvas-create", file } },
      },
    });
    setCreating(false);
  };

  const known = savesTo === undefined || changeRequest !== undefined;
  const canEdit = canWrite && known && !isSettledChangeRequest(changeRequest);
  const [readOnly, setReadOnly] = useLocalStorage(
    canvasReadOnlyKey(wikiId, file),
    false,
    ReadOnlyFlag,
  );

  const send = useWikiAutosaveCommand();
  const [canvas, setCanvas] = useState<CanvasDocument | null>(null);
  const { autosave, status } = useWikiAutosave({
    subject: title,
    save: async () => {
      const taken = canvas?.take() ?? null;
      if (taken === null) return { ok: true };
      if (checkout !== undefined) {
        const written = await disk.transform(checkout, file, {
          kind: "canvas",
          file,
          edits: [...taken.edits],
        });
        if (!written.ok) return written;
        canvas?.landed(taken.through, null);
        reread();
        return { ok: true };
      }
      const outcome = await send({
        environmentId,
        input: {
          wikiId,
          ...(savesTo === undefined ? {} : { changeRequestId: savesTo }),
          document: file,
          write: {
            kind: "transform",
            transform: { kind: "canvas", file, edits: [...taken.edits] },
          },
        },
      });
      if (!outcome.ok) return outcome;
      canvas?.landed(taken.through, outcome.value.commit);
      return { ok: true };
    },
  });
  const commit =
    files === null ? null : checkout === undefined ? files.commit : diskVersion(files.commit, text);
  const document = parsed?.ok === true ? parsed.document : null;
  if (canvas === null && document !== null && commit !== null) {
    setCanvas(new CanvasDocument({ document, revision: commit, onEdited: autosave.edited }));
  }
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- each commit read crosses into the document, which keeps this person's unlanded edits on top
  useEffect(() => {
    if (canvas !== null && commit !== null && document !== null) canvas.receive(document, commit);
  }, [canvas, commit, document]);
  const turn = useChangeRequestTurn(
    environmentId,
    changeRequest?.status === "open" ? changeRequest.threadId : null,
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a running turn holds the autosave store, which lives outside React
  useEffect(() => autosave.setHeld(turn.running), [autosave, turn.running]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- closing the tab asks whether edits are held back
  useEffect(
    () => registerUnsaved?.(() => holdsEdits(autosave.getStatus()), autosave.flush),
    [autosave, registerUnsaved],
  );
  useBlocker({
    disabled: !holdsEdits(status),
    enableBeforeUnload: () => holdsEdits(autosave.getStatus()),
    shouldBlockFn: async () => {
      if (!holdsEdits(autosave.getStatus())) return false;
      const leave = await ensureLocalApi().dialogs.confirm(
        `Leave ${title}? Your unsaved changes will be lost.`,
        { variant: "destructive" },
      );
      if (leave) autosave.cancel();
      return !leave;
    },
  });

  const groupData = canvas?.getState().data ?? (parsed?.ok === true ? parsed.data : null);
  const groups = groupData === null ? EMPTY_GROUPS : canvasGroups(groupData);

  const body = () => {
    if (files === null) {
      return query.error !== null ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Couldn't open {title}</EmptyTitle>
            <EmptyDescription>{describeWikiFailure(query.failure ?? query.error)}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Empty>
          <Spinner size="md" tone="muted" />
        </Empty>
      );
    }
    if (read === undefined || !read.exists) {
      return (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No canvas is called {title} yet</EmptyTitle>
            <EmptyDescription>
              {checkout !== undefined
                ? `It starts in ${parent}.`
                : savesTo === undefined
                  ? "It starts in your draft."
                  : `It starts in this ${terms.singular}.`}
            </EmptyDescription>
          </EmptyHeader>
          {canWrite ? (
            <Button size="sm" disabled={creating} onClick={() => void create()}>
              {creating ? <Spinner /> : null}
              Create canvas
            </Button>
          ) : null}
        </Empty>
      );
    }
    if (parsed === null) {
      return (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{title} is too large to show here</EmptyTitle>
          </EmptyHeader>
        </Empty>
      );
    }
    if (!parsed.ok) {
      return (
        <div className="min-h-0 flex-1 overflow-auto p-6">
          <Alert variant="warning">
            <TriangleAlertIcon />
            <AlertTitle>This canvas isn't valid JSON</AlertTitle>
            <AlertDescription>
              {parsed.error} Fix the file and it opens again; it is left as it is until then.
            </AlertDescription>
          </Alert>
          <pre className="mt-4 mb-0 font-mono text-xs whitespace-pre-wrap">{text}</pre>
        </div>
      );
    }
    return (
      <CanvasBoardPane
        tabKey={tabKey}
        environmentId={environmentId}
        wikiId={wikiId}
        checkout={checkout}
        projectLinks={projectLinks}
        changeRequestId={changeRequestId}
        cardsFrom={cardsFrom}
        savesTo={savesTo}
        file={file}
        commit={commit ?? files.commit}
        data={review?.data ?? parsed.data}
        // Your own draft's cards all read as changed, which says nothing a person doesn't know.
        marks={changeRequest?.draft === true ? undefined : review?.marks}
        groups={groups}
        canvas={canEdit ? canvas : null}
        readOnly={readOnly}
        onReadOnly={setReadOnly}
        onOpenNote={onOpenNote}
        onOpenFile={onOpenFile}
        onOpenTab={onOpenTab}
        onOpenInNewTab={onOpenInNewTab}
      />
    );
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <TabHeader.Root>
        <TabHeader.Title
          label="Canvas"
          parent={parent}
          parentControl={renderDraftPill?.({
            flush: autosave.flush,
            drop: () => {
              canvas?.discard();
              autosave.cancel();
            },
          })}
        >
          {documentPath(file)}
        </TabHeader.Title>
        {!canEdit || readOnly ? <TabHeader.Status>Read only</TabHeader.Status> : null}
        <WikiSaveStatus status={status} />
      </TabHeader.Root>
      <WikiSaveFailure status={status} autosave={autosave} />
      {body()}
    </div>
  );
}
