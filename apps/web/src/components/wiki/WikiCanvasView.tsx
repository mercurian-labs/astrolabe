import {
  canvasGroups,
  parseCanvas,
  type CanvasData,
  type CanvasMarks,
} from "@mercurian/wiki/canvas";
import { CanvasBoard, type CanvasBoardHandle } from "@mercurian/wiki-editor/canvas-board";
import { useAtomValue } from "@effect/atom-react";
import { changeRequestCanvasReview } from "@t3tools/client-runtime/wikiLogic";
import type {
  EnvironmentId,
  WikiChangeRequest,
  WikiChangeRequestId,
  WikiId,
} from "@t3tools/contracts";
import { ChevronDownIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { TabHeader } from "~/panes/TabHeader";
import { useEnvironmentQuery } from "~/state/query";
import { wikiEnvironment } from "~/state/wiki";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Spinner } from "../ui/spinner";
import { describeWikiFailure, documentTitle } from "./wiki.logic";
import { registerWikiCanvasBoard, type WikiCanvasGroup } from "./wikiCanvasBoards";
import { useWikiCommand } from "./wikiEnvironment";
import { useWikiCanvasHost } from "./wikiCanvasHost";
import { SaveToChangeRequestDialog, type SaveTarget } from "./WikiSaveDialog";

function CanvasBoardPane({
  tabKey,
  environmentId,
  wikiId,
  changeRequestId,
  file,
  commit,
  data,
  marks,
  groups,
  onOpenNote,
  onOpenFile,
  onOpenTab,
}: {
  readonly tabKey: string;
  readonly environmentId: EnvironmentId;
  readonly wikiId: WikiId;
  readonly changeRequestId: WikiChangeRequestId | undefined;
  readonly file: string;
  readonly commit: string;
  readonly data: CanvasData;
  /** What the change request it's read in changes, until that's merged or closed. */
  readonly marks: CanvasMarks | undefined;
  readonly groups: ReadonlyArray<WikiCanvasGroup>;
  readonly onOpenNote: (name: string) => void;
  readonly onOpenFile: ((path: string) => void) | undefined;
  readonly onOpenTab: (key: string) => void;
}) {
  const host = useWikiCanvasHost({
    environmentId,
    wikiId,
    changeRequestId,
    commit,
    onOpenNote,
    onOpenFile,
    onOpenTab,
  });

  const board = useRef<CanvasBoardHandle>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the command palette reaches this canvas through a registry outside React
  useEffect(
    () =>
      registerWikiCanvasBoard(tabKey, {
        groups,
        jumpToGroup: (id) => board.current?.focusCard(id),
      }),
    [tabKey, groups],
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
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
          {...(marks === undefined ? {} : { marks })}
        />
      </div>
    </div>
  );
}

const EMPTY_GROUPS: ReadonlyArray<WikiCanvasGroup> = [];

/**
 * A `.canvas` file in its own tab, read from main or a change request, and refreshed per commit
 * with its camera kept. In a change request it marks what that changes, so an agent's work shows
 * as it lands. Reading only: nothing here writes the file, and a canvas that doesn't exist yet is
 * started in a change request.
 */
export default function WikiCanvasPage({
  tabKey,
  environmentId,
  wikiId,
  file,
  changeRequestId,
  parent,
  openChangeRequests,
  onSaved,
  onOpenNote,
  onOpenFile,
  onOpenTab,
}: {
  readonly tabKey: string;
  readonly environmentId: EnvironmentId;
  readonly wikiId: WikiId;
  readonly file: string;
  readonly changeRequestId: WikiChangeRequestId | undefined;
  /** Where the canvas is read from, as the tab header names it. */
  readonly parent: string;
  readonly openChangeRequests: ReadonlyArray<WikiChangeRequest>;
  readonly onSaved: (changeRequestId: WikiChangeRequestId) => void;
  readonly onOpenNote: (name: string) => void;
  readonly onOpenFile: ((path: string) => void) | undefined;
  readonly onOpenTab: (key: string) => void;
}) {
  const scope = changeRequestId === undefined ? {} : { changeRequestId };
  const query = useEnvironmentQuery(
    wikiEnvironment.files({ environmentId, input: { wikiId, ...scope, paths: [file] } }),
  );
  const read = query.data?.files[0];
  const text = read?.text ?? null;
  const parsed = text === null ? null : parseCanvas(text);
  const groups = parsed?.ok ? canvasGroups(parsed.data) : EMPTY_GROUPS;
  const detail = useEnvironmentQuery(
    changeRequestId === undefined
      ? null
      : wikiEnvironment.changeRequest({ environmentId, input: { wikiId, changeRequestId } }),
  );
  const review = changeRequestCanvasReview(detail.data, file, text);
  const title = documentTitle(file);
  const [creating, setCreating] = useState(false);
  const canCreate = useAtomValue(wikiEnvironment.transform.permissionAtom(environmentId));
  const transform = useWikiCommand(wikiEnvironment.transform, "Couldn't start the canvas");
  const create = async (target: SaveTarget, message: string): Promise<string | null> => {
    const outcome = await transform({
      environmentId,
      input: { wikiId, message, transform: { kind: "canvas-create", file }, ...target },
    });
    if (!outcome.ok) return outcome.message ?? "The save was cancelled.";
    onSaved(outcome.value.changeRequest.changeRequestId);
    return null;
  };

  const body = () => {
    if (query.data === null) {
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
            <EmptyDescription>Start it in a change request.</EmptyDescription>
          </EmptyHeader>
          {canCreate ? (
            <Button size="sm" onClick={() => setCreating(true)}>
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
        file={file}
        commit={query.data.commit}
        data={review?.data ?? parsed.data}
        marks={review?.marks}
        groups={groups}
        onOpenNote={onOpenNote}
        onOpenFile={onOpenFile}
        onOpenTab={onOpenTab}
      />
    );
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <TabHeader.Root>
        <TabHeader.Title label="Canvas" parent={parent}>
          {title}
        </TabHeader.Title>
        <TabHeader.Status>Read only</TabHeader.Status>
      </TabHeader.Root>
      {body()}
      {creating ? (
        <SaveToChangeRequestDialog
          environmentId={environmentId}
          subject={title}
          openChangeRequests={openChangeRequests}
          viewing={changeRequestId}
          onClose={() => setCreating(false)}
          onSave={async (target, message) => {
            const error = await create(target, message);
            if (error === null) setCreating(false);
            return error;
          }}
        />
      ) : null}
    </div>
  );
}
