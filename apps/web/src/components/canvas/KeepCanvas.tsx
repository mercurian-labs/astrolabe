import { useAtomValue } from "@effect/atom-react";
import { canvasFile } from "@mercurian/wiki/placement";
import { keepCanvasName } from "@t3tools/client-runtime/wikiLogic";
import {
  type EnvironmentId,
  type ThreadId,
  type TurnItemId,
  type WikiKeepCanvasResult,
  type WikiSummary,
} from "@t3tools/contracts";
import { BookmarkPlusIcon, TriangleAlertIcon } from "lucide-react";
import { useId, useState } from "react";

import { useEnvironmentQuery } from "~/state/query";
import { wikiEnvironment } from "~/state/wiki";
import { Alert, AlertDescription } from "../ui/alert";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Spinner } from "../ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { useOpenWikiTab } from "../wiki/useOpenWiki";
import { useWikiCommand } from "../wiki/wikiEnvironment";

interface KeptBoard {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly itemId: TurnItemId;
  readonly title: string;
}

function PlaceForm({
  board,
  wikis,
  onClose,
  onKept,
}: {
  readonly board: KeptBoard;
  readonly wikis: ReadonlyArray<WikiSummary>;
  readonly onClose: () => void;
  readonly onKept: (wikiId: WikiSummary["wikiId"], result: WikiKeepCanvasResult) => void;
}) {
  const id = useId();
  const [wikiId, setWikiId] = useState(wikis[0]?.wikiId);
  const [name, setName] = useState(() => keepCanvasName(board.title));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keep = useWikiCommand(wikiEnvironment.keepCanvas);
  const placeable = canvasFile(name) !== null;
  const canSubmit = wikiId !== undefined && placeable && !busy;

  const submit = async () => {
    if (!canSubmit || wikiId === undefined) return;
    setBusy(true);
    setError(null);
    const outcome = await keep({
      environmentId: board.environmentId,
      input: {
        wikiId,
        threadId: board.threadId,
        itemId: board.itemId,
        name: name.trim(),
      },
    });
    setBusy(false);
    if (outcome.ok) onKept(wikiId, outcome.value);
    else setError(outcome.message ?? "The canvas wasn't kept.");
  };

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <p className="text-xs text-muted-foreground">
        It goes to a wiki for review. Main changes only when someone merges it.
      </p>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-wiki`}>Wiki</Label>
        <Select
          {...(wikiId === undefined ? {} : { value: wikiId })}
          items={Object.fromEntries(wikis.map((wiki) => [wiki.wikiId, wiki.name]))}
          onValueChange={(value) => {
            const picked = wikis.find((wiki) => wiki.wikiId === value);
            if (picked !== undefined) setWikiId(picked.wikiId);
          }}
        >
          <SelectTrigger id={`${id}-wiki`}>
            <SelectValue />
          </SelectTrigger>
          <SelectPopup>
            {wikis.map((wiki) => (
              <SelectItem key={wiki.wikiId} value={wiki.wikiId}>
                {wiki.name}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-name`}>Name</Label>
        <Input
          id={`${id}-name`}
          autoFocus
          value={name}
          aria-describedby={`${id}-name-hint`}
          onChange={(event) => setName(event.target.value)}
        />
        <p id={`${id}-name-hint`} className="text-xs text-muted-foreground">
          {!placeable && name.trim() !== ""
            ? "A wiki can't hold a canvas at this path."
            : "It lands at the top of the wiki. Type a folder to file it there: ops/Board."}
        </p>
      </div>
      {error === null ? null : (
        <Alert variant="error">
          <TriangleAlertIcon />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" size="xs" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" size="xs" disabled={!canSubmit}>
          {busy ? <Spinner /> : null}
          Place it
        </Button>
      </div>
    </form>
  );
}

/** Where the board goes when it's placed by hand: the person picks, and no agent turn runs. */
function PlaceInWiki({
  board,
  onClose,
}: {
  readonly board: KeptBoard;
  readonly onClose: () => void;
}) {
  const { environmentId } = board;
  const list = useEnvironmentQuery(wikiEnvironment.list({ environmentId, input: {} }));
  const openTab = useOpenWikiTab();
  const [kept, setKept] = useState<{
    readonly wikiId: WikiSummary["wikiId"];
    readonly result: WikiKeepCanvasResult;
  } | null>(null);

  if (kept !== null) {
    const { changeRequest, file, notes } = kept.result;
    return (
      <div className="flex flex-col gap-3">
        <p className="text-xs text-muted-foreground">
          {`${file} is in “${changeRequest.title}”. Merge it to put it on the wiki, or close it to discard it. The canvas stays in this thread either way.`}
        </p>
        {notes.length === 0 ? null : (
          <Alert variant="warning">
            <TriangleAlertIcon />
            <AlertDescription>{notes.join(" ")}</AlertDescription>
          </Alert>
        )}
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" size="xs" onClick={onClose}>
            Done
          </Button>
          <Button
            size="xs"
            onClick={() => {
              openTab({
                kind: "note",
                environmentId,
                wikiId: kept.wikiId,
                file,
                changeRequestId: changeRequest.changeRequestId,
              });
              onClose();
            }}
          >
            Open it
          </Button>
        </div>
      </div>
    );
  }
  if (list.data === null) return <Spinner size="md" tone="muted" />;
  if (list.data.wikis.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        A canvas is kept in a wiki, and this server has none yet. Add one from the Wikis section,
        then keep it.
      </p>
    );
  }
  return (
    <PlaceForm
      board={board}
      wikis={list.data.wikis}
      onClose={onClose}
      onKept={(wikiId, result) => setKept({ wikiId, result })}
    />
  );
}

/** Keep a board in a wiki the person picks, with its cards fixed by `CanvasKeep`. */
export function KeepCanvasButton({
  size,
  ...board
}: KeptBoard & { readonly size: "icon-xs" | "icon-sm" }) {
  const [open, setOpen] = useState(false);
  const canPlace = useAtomValue(wikiEnvironment.keepCanvas.permissionAtom(board.environmentId));
  if (!canPlace) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={<Button variant="ghost" size={size} aria-label={`Keep ${board.title}`} />}
            />
          }
        >
          <BookmarkPlusIcon />
        </TooltipTrigger>
        <TooltipPopup side="bottom">Keep in a wiki</TooltipPopup>
      </Tooltip>
      <PopoverPopup
        aria-label={`Keep ${board.title}`}
        side="bottom"
        align="end"
        width="md"
        padding="compact"
      >
        <p className="truncate px-1 pb-1 text-sm font-medium">{`Keep ${board.title}`}</p>
        <PlaceInWiki board={board} onClose={() => setOpen(false)} />
      </PopoverPopup>
    </Popover>
  );
}
