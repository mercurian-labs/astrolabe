import { useAtomValue } from "@effect/atom-react";
import { keepCanvasName } from "@t3tools/client-runtime/wikiLogic";
import type {
  EnvironmentId,
  ThreadId,
  TurnItemId,
  WikiKeepCanvasResult,
  WikiSummary,
} from "@t3tools/contracts";
import { BookmarkPlusIcon, TriangleAlertIcon } from "lucide-react";
import { useId, useState } from "react";

import { useEnvironmentQuery } from "~/state/query";
import { wikiEnvironment } from "~/state/wiki";
import { Alert, AlertDescription } from "../ui/alert";
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
import { Input } from "../ui/input";
import { Label } from "../ui/label";
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

function KeepForm({
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
  const canSubmit = wikiId !== undefined && name.trim().length > 0 && !busy;

  const submit = async () => {
    if (!canSubmit || wikiId === undefined) return;
    setBusy(true);
    setError(null);
    const outcome = await keep({
      environmentId: board.environmentId,
      input: { wikiId, threadId: board.threadId, itemId: board.itemId, name: name.trim() },
    });
    setBusy(false);
    if (outcome.ok) onKept(wikiId, outcome.value);
    else setError(outcome.message ?? "The canvas wasn't kept.");
  };

  return (
    <form
      className="flex min-h-0 flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <DialogHeader>
        <DialogTitle>Keep this canvas</DialogTitle>
        <DialogDescription>
          It goes to a change request on a wiki. Main changes only when someone merges it.
        </DialogDescription>
      </DialogHeader>
      <DialogPanel>
        <div className="flex flex-col gap-4">
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
        </div>
      </DialogPanel>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={!canSubmit}>
          {busy ? <Spinner /> : null}
          Keep
        </Button>
      </DialogFooter>
    </form>
  );
}

function KeepDialog({
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

  const body = () => {
    if (kept !== null) {
      const { changeRequest, file, notes } = kept.result;
      return (
        <>
          <DialogHeader>
            <DialogTitle>Kept in a change request</DialogTitle>
            <DialogDescription>
              {`${file} is in “${changeRequest.title}”. Merge it to put it on the wiki, or close it to discard it. The canvas stays in this thread either way.`}
            </DialogDescription>
          </DialogHeader>
          {notes.length === 0 ? null : (
            <DialogPanel>
              <Alert variant="warning">
                <TriangleAlertIcon />
                <AlertDescription>{notes.join(" ")}</AlertDescription>
              </Alert>
            </DialogPanel>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={onClose}>
              Done
            </Button>
            <Button
              onClick={() => {
                openTab({
                  kind: "note",
                  environmentId,
                  wikiId: kept.wikiId,
                  name: file,
                  changeRequestId: changeRequest.changeRequestId,
                });
                onClose();
              }}
            >
              Open it
            </Button>
          </DialogFooter>
        </>
      );
    }
    if (list.data === null) {
      return (
        <DialogPanel>
          <Spinner size="md" tone="muted" />
        </DialogPanel>
      );
    }
    if (list.data.wikis.length === 0) {
      return (
        <>
          <DialogHeader>
            <DialogTitle>Keep this canvas</DialogTitle>
            <DialogDescription>
              A canvas is kept in a wiki, and this server has none yet. Add one from the Wikis
              section, then keep it.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
          </DialogFooter>
        </>
      );
    }
    return (
      <KeepForm
        board={board}
        wikis={list.data.wikis}
        onClose={onClose}
        onKept={(wikiId, result) => setKept({ wikiId, result })}
      />
    );
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogPopup className="sm:max-w-md">{body()}</DialogPopup>
    </Dialog>
  );
}

/** Saves a thread's board into a wiki, as a change request. Without write access there's none. */
export function KeepCanvasButton({
  size,
  ...board
}: KeptBoard & { readonly size: "icon-xs" | "xs" }) {
  const [open, setOpen] = useState(false);
  const allowed = useAtomValue(wikiEnvironment.keepCanvas.permissionAtom(board.environmentId));
  if (!allowed) return null;
  return (
    <>
      <Button
        variant="ghost"
        size={size}
        aria-label={`Keep ${board.title} in a wiki`}
        onClick={() => setOpen(true)}
      >
        <BookmarkPlusIcon />
        {size === "xs" ? "Keep" : null}
      </Button>
      {open ? <KeepDialog board={board} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
