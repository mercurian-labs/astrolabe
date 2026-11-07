import {
  canvasChangeSections,
  canvasChangeSummary,
  CANVAS_MARK_LABELS,
  reviewCanvasFiles,
  type CanvasChange,
  type CanvasMark,
  type CanvasReview,
} from "@mercurian/wiki/canvas";
import { CanvasBoard, type CanvasBoardHandle } from "@mercurian/wiki-editor/canvas-board";
import type {
  EnvironmentId,
  WikiChangeRequestId,
  WikiFileChange,
  WikiId,
} from "@t3tools/contracts";
import { ChevronRightIcon, TriangleAlertIcon } from "lucide-react";
import { useRef, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Button } from "../ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { documentTitle } from "./wiki.logic";
import { useWikiCanvasHost } from "./wikiCanvasHost";

const MARK_TONE: Readonly<Record<CanvasMark, string>> = {
  added: "text-diff-addition-foreground",
  removed: "text-diff-deletion-foreground",
  text: "text-warning-foreground",
  restyled: "text-info-foreground",
  moved: "text-muted-foreground",
};

/** A board can change thousands of cards at once; a list of them shouldn't mount all at once. */
const ROWS_SHOWN = 200;

type ReviewedChange = CanvasReview["changes"][number];

function ChangeRow({
  change,
  active,
  onPick,
}: {
  readonly change: ReviewedChange;
  readonly active: boolean;
  readonly onPick: (change: CanvasChange) => void;
}) {
  const also = change.also.map((mark) => CANVAS_MARK_LABELS[mark]).join(", ");
  return (
    <li>
      <button
        type="button"
        disabled={!change.drawn}
        aria-pressed={active}
        onClick={() => onPick(change)}
        className="flex w-full flex-col gap-0.5 px-3 py-1.5 text-left text-xs hover:bg-accent focus-visible:bg-accent focus-visible:outline-none disabled:cursor-default disabled:hover:bg-transparent aria-pressed:bg-accent"
      >
        <span className="flex items-baseline gap-2">
          <span className={`shrink-0 font-medium ${MARK_TONE[change.mark]}`}>
            {CANVAS_MARK_LABELS[change.mark]}
          </span>
          <span className="min-w-0 truncate text-foreground">{change.name}</span>
        </span>
        {change.was !== null ? (
          <span className="truncate text-muted-foreground">{`Was: ${change.was}`}</span>
        ) : null}
        {also === "" ? null : <span className="text-muted-foreground">{`Also: ${also}`}</span>}
        {change.drawn ? null : (
          <span className="text-muted-foreground">Not on the board: see the JSON</span>
        )}
      </button>
    </li>
  );
}

function ChangeRows({
  changes,
  active,
  onPick,
}: {
  readonly changes: ReadonlyArray<ReviewedChange>;
  readonly active: string | null;
  readonly onPick: (change: CanvasChange) => void;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? changes : changes.slice(0, ROWS_SHOWN);
  return (
    <>
      <ul className="flex flex-col">
        {shown.map((change) => (
          <ChangeRow
            key={`${change.item}:${change.id}`}
            change={change}
            active={change.id === active}
            onPick={onPick}
          />
        ))}
      </ul>
      {shown.length < changes.length ? (
        <Button variant="ghost-muted" size="xs" onClick={() => setAll(true)}>
          {`Show all ${changes.length}`}
        </Button>
      ) : null}
    </>
  );
}

/** A canvas in a change request: the board with marks on what changed, and a list of it. */
export default function WikiCanvasReview({
  environmentId,
  wikiId,
  changeRequestId,
  commit,
  change,
  onOpenNote,
  onOpenTab,
}: {
  readonly environmentId: EnvironmentId;
  readonly wikiId: WikiId;
  readonly changeRequestId: WikiChangeRequestId | undefined;
  /** Where its cards read their files. */
  readonly commit: string;
  readonly change: WikiFileChange;
  readonly onOpenNote: (name: string) => void;
  readonly onOpenTab: ((key: string) => void) | undefined;
}) {
  const { before, after, file } = change;
  const review = reviewCanvasFiles(before, after);
  const host = useWikiCanvasHost({
    environmentId,
    wikiId,
    file,
    changeRequestId,
    commit,
    onOpenNote,
    onOpenTab,
  });
  const board = useRef<CanvasBoardHandle>(null);
  const [active, setActive] = useState<string | null>(null);
  if ("invalid" in review) {
    return (
      <div className="p-3">
        <Alert variant="warning">
          <TriangleAlertIcon />
          <AlertTitle>This canvas can't be drawn</AlertTitle>
          <AlertDescription>{review.invalid}</AlertDescription>
        </Alert>
      </div>
    );
  }
  const { changed, moved } = canvasChangeSections(review.changes);
  const pick = (picked: CanvasChange) => {
    setActive(picked.id);
    board.current?.selectCard(picked.id);
  };
  return (
    <div className="@container">
      <div className="flex flex-col @2xl:h-[30rem] @2xl:flex-row">
        <div className="h-96 min-w-0 flex-1 @2xl:h-auto">
          <CanvasBoard
            ref={board}
            data={review.data}
            marks={review.marks}
            mode="free"
            host={host}
            label={`Changes to ${documentTitle(file)}`}
            revision={commit}
            wheelOnceFocused
          />
        </div>
        <div className="flex max-h-72 min-h-0 w-full shrink-0 flex-col overflow-y-auto border-t border-border @2xl:max-h-none @2xl:w-64 @2xl:border-t-0 @2xl:border-l">
          <p className="px-3 py-2 text-xs text-muted-foreground">
            {canvasChangeSummary(review.changes)}
          </p>
          <ChangeRows changes={changed} active={active} onPick={pick} />
          {moved.length > 0 ? (
            <Collapsible>
              <CollapsibleTrigger className="group flex w-full items-center gap-1 px-3 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent">
                <ChevronRightIcon className="size-3 group-data-panel-open:rotate-90" />
                {`${moved.length} moved or resized`}
              </CollapsibleTrigger>
              <CollapsiblePanel animate={false}>
                <ChangeRows changes={moved} active={active} onPick={pick} />
              </CollapsiblePanel>
            </Collapsible>
          ) : null}
          {review.rest ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              Data outside the cards and arrows changed too: see the JSON.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
