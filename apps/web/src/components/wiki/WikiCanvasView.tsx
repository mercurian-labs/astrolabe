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
import { canvasStoryEdit } from "@mercurian/wiki/canvas-edits";
import { CanvasDocument } from "@mercurian/wiki-editor/canvas-document";
import { useAtomValue } from "@effect/atom-react";
import { changeRequestCanvasReview } from "@t3tools/client-runtime/wikiLogic";
import type {
  EnvironmentId,
  UnifiedSettings,
  WikiChangeRequestId,
  WikiId,
} from "@t3tools/contracts";
import { useBlocker } from "@tanstack/react-router";
import { ChevronDownIcon, TriangleAlertIcon } from "lucide-react";
import * as Schema from "effect/Schema";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

import { useLocalStorage } from "~/hooks/useLocalStorage";
import { useEnvironmentSettings, useUpdateEnvironmentSettings } from "~/hooks/useSettings";
import { ensureLocalApi } from "~/localApi";
import { TabHeader } from "~/panes/TabHeader";
import { useEnvironmentQuery } from "~/state/query";
import { wikiEnvironment } from "~/state/wiki";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Spinner } from "../ui/spinner";
import { CanvasStoryPill, onStepKey } from "../canvas/CanvasStoryPill";
import { useCanvasWalk } from "../canvas/useCanvasWalk";
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
  type WikiCanvasGroup,
} from "./wikiCanvasBoards";
import { useWikiAutosaveCommand, useWikiCommand, useWikiTerms } from "./wikiEnvironment";
import { useWikiCanvasHost } from "./wikiCanvasHost";
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
}: {
  readonly tabKey: string;
  readonly environmentId: EnvironmentId;
  readonly wikiId: WikiId;
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
  });
  const settings = useEnvironmentSettings(environmentId, selectCanvasSettings);
  const updateSettings = useUpdateEnvironmentSettings(environmentId);
  const onSettings = (patch: Partial<CanvasBoardSettings>) =>
    updateSettings({ wikiCanvas: { ...settings, ...patch } });

  const board = useRef<CanvasBoardHandle>(null);
  const editable = canvas !== null && !readOnly;
  const shown = useSyncExternalStore(
    canvas?.subscribe ?? noSubscription,
    () => canvas?.getState().data ?? data,
  );
  const walk = useCanvasWalk({ title: documentTitle(file), data: shown }, null);
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
    <div
      className="flex min-h-0 min-w-0 flex-1 flex-col"
      onKeyDown={(event) => onStepKey(event, walk.steps.length, walk.step, walk.go)}
    >
      {groups.length > 0 ? (
        <div className="flex shrink-0 justify-end border-b border-border px-3 py-1">
          <Menu>
            <MenuTrigger render={<Button variant="ghost" size="xs" />} aria-label="Jump to group">
              Jump to group
              <ChevronDownIcon />
            </MenuTrigger>
            <MenuPopup align="end">
              {groups.map((group) => (
                <MenuItem key={group.id} onClick={() => board.current?.focusCard(group.id)}>
                  {group.label}
                </MenuItem>
              ))}
            </MenuPopup>
          </Menu>
        </div>
      ) : null}
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
          story={walk.story}
          step={walk.step}
          onStepAdded={(index) => {
            if (walk.step !== null) walk.go(index);
          }}
          {...(marks === undefined ? {} : { marks })}
        >
          <CanvasStoryPill
            walk={walk}
            edit={
              canvas === null || !editable
                ? undefined
                : (change) => canvas.commit([canvasStoryEdit(canvas.document, change)])
            }
          />
        </CanvasBoard>
      </div>
    </div>
  );
}

const noSubscription = () => () => {};

const selectCanvasSettings = (settings: UnifiedSettings) => settings.wikiCanvas;

const EMPTY_GROUPS: ReadonlyArray<WikiCanvasGroup> = [];
const ReadOnlyFlag = Schema.Boolean;

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
}: {
  readonly tabKey: string;
  readonly environmentId: EnvironmentId;
  readonly wikiId: WikiId;
  readonly file: string;
  /** The change request the canvas reads from; none reads main. */
  readonly changeRequestId: WikiChangeRequestId | undefined;
  readonly cardsFrom: WikiChangeRequestId | undefined;
  /** The change request the tab is in; none saves to the draft. */
  readonly savesTo: WikiChangeRequestId | undefined;
  /** Where the canvas is read from, as the tab header names it. */
  readonly parent: string;
  /** The draft's pill in the header's place for `parent`, when there's a draft. */
  readonly renderDraftPill?: (edits?: WikiDraftEdits) => ReactNode;
  readonly registerUnsaved?: (isUnsaved: () => boolean, save: () => Promise<boolean>) => () => void;
  readonly onOpenNote: (name: string) => void;
  readonly onOpenFile: ((path: string) => void) | undefined;
  readonly onOpenTab: (key: string) => void;
  readonly onOpenInNewTab?: (name: string) => void;
}) {
  const scope = changeRequestId === undefined ? {} : { changeRequestId };
  const query = useEnvironmentQuery(
    wikiEnvironment.files({
      environmentId,
      input: { wikiId, ...scope, paths: [exactWikiPath(file)] },
    }),
  );
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
  const canWrite = useAtomValue(wikiEnvironment.autosave.permissionAtom(environmentId));
  const autosaveCommand = useWikiCommand(wikiEnvironment.autosave, "Couldn't start the canvas");
  const create = async () => {
    setCreating(true);
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
  const commit = files?.commit ?? null;
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
              {savesTo === undefined
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
        changeRequestId={changeRequestId}
        cardsFrom={cardsFrom}
        savesTo={savesTo}
        file={file}
        commit={files.commit}
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
