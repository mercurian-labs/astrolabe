import { useAtomValue } from "@effect/atom-react";
import { keepCanvasName } from "@t3tools/client-runtime/wikiLogic";
import {
  COMPOSER_CONTEXT_CANVAS_COMMENT_MAX_CHARS,
  type EnvironmentId,
  type ThreadId,
  type TurnItemId,
  type WikiKeepCanvasResult,
  type WikiSummary,
} from "@t3tools/contracts";
import { canvasContextRecord } from "@t3tools/shared/composerContextReferences";
import { BookmarkPlusIcon, TriangleAlertIcon } from "lucide-react";
import { useId, useRef, useState } from "react";

import { useComposerHandleContext } from "~/composerHandleContext";
import { useEnvironmentQuery } from "~/state/query";
import { wikiEnvironment } from "~/state/wiki";
import { ComposerCommentEditor } from "../chat/ComposerCommentEditor";
import { Alert, AlertDescription } from "../ui/alert";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Spinner } from "../ui/spinner";
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
  comment,
  wikis,
  onClose,
  onKept,
}: {
  readonly board: KeptBoard;
  readonly comment: string;
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
  const canSubmit = wikiId !== undefined && name.trim().length > 0 && !busy;

  const submit = async () => {
    if (!canSubmit || wikiId === undefined) return;
    setBusy(true);
    setError(null);
    const trimmed = comment.trim();
    const outcome = await keep({
      environmentId: board.environmentId,
      input: {
        wikiId,
        threadId: board.threadId,
        itemId: board.itemId,
        name: name.trim(),
        ...(trimmed === "" ? {} : { comment: trimmed }),
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
        It goes to a change request on a wiki. Main changes only when someone merges it.
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
          onChange={(event) => setName(event.target.value)}
        />
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
  comment,
  onClose,
}: {
  readonly board: KeptBoard;
  readonly comment: string;
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
      comment={comment}
      wikis={list.data.wikis}
      onClose={onClose}
      onKept={(wikiId, result) => setKept({ wikiId, result })}
    />
  );
}

/**
 * Keep a board: it goes in the composer as a chip for the person's own instruction, or into a wiki
 * they pick here. Either way its cards are fixed by `CanvasKeep`.
 */
export function KeepCanvasButton({
  size,
  ...board
}: KeptBoard & { readonly size: "icon-xs" | "xs" }) {
  const [open, setOpen] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [refused, setRefused] = useState(false);
  const [comment, setComment] = useState("");
  const commentInput = useRef<HTMLTextAreaElement>(null);
  const composer = useComposerHandleContext();
  const canPlace = useAtomValue(wikiEnvironment.keepCanvas.permissionAtom(board.environmentId));
  const canChat = composer !== null;
  if (!canPlace && !canChat) return null;

  const change = (next: boolean) => {
    setOpen(next);
    if (next) return;
    setPlacing(false);
    setRefused(false);
    setComment("");
  };
  const close = () => change(false);
  const addToChat = (text: string, send: boolean) => {
    const added =
      composer?.current?.addCanvas(canvasContextRecord({ ...board, comment: text }), { send }) ??
      false;
    if (added) close();
    else setRefused(true);
    return added;
  };

  return (
    <Popover open={open} onOpenChange={change}>
      <PopoverTrigger
        render={<Button variant="ghost" size={size} aria-label={`Keep ${board.title}`} />}
      >
        <BookmarkPlusIcon />
        {size === "xs" ? "Keep" : null}
      </PopoverTrigger>
      <PopoverPopup
        aria-label={`Keep ${board.title}`}
        side="bottom"
        align="end"
        width="md"
        padding="compact"
        initialFocus={() => {
          commentInput.current?.focus({ preventScroll: true });
          return false;
        }}
      >
        <p className="truncate px-1 pb-1 text-sm font-medium">{`Keep ${board.title}`}</p>
        {placing || !canChat ? (
          <PlaceInWiki board={board} comment={comment} onClose={close} />
        ) : (
          <>
            <ComposerCommentEditor
              initialComment={comment}
              maxLength={COMPOSER_CONTEXT_CANVAS_COMMENT_MAX_CHARS}
              label="Comment on this canvas"
              description="Enter to add it to the chat; Command/Ctrl+Enter to add and send; Shift+Enter for a new line."
              saveLabel="Add to chat"
              inputRef={commentInput}
              extraActions={
                canPlace ? (
                  <Button
                    variant="outline"
                    size="xs"
                    onPointerDown={(event) => event.preventDefault()}
                    onClick={() => setPlacing(true)}
                  >
                    Place in wiki
                  </Button>
                ) : null
              }
              onDraftChange={setComment}
              onSubmit={(text) => addToChat(text, false)}
              onSubmitAndSend={(text) => addToChat(text, true)}
              onCancel={close}
            />
            {refused ? (
              <p role="status" className="px-1 pt-2 text-xs text-destructive">
                The composer can't take this right now. Answer the agent's question first.
              </p>
            ) : null}
          </>
        )}
      </PopoverPopup>
    </Popover>
  );
}
