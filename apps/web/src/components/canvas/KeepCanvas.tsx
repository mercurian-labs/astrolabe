/* oxlint-disable t3code/no-untranslated-copy -- Astrolabe-only copy, shipped in English. */
import { useAtomValue } from "@effect/atom-react";
import { canvasFile } from "@mercurian/wiki/placement";
import { keepCanvasName } from "@t3tools/client-runtime/wikiLogic";
import {
  type EnvironmentId,
  type ProjectId,
  type ProjectRootCheckout,
  projectRootId,
  type ThreadId,
  type TurnItemId,
  type WikiKeepCanvasResult,
  WikiId,
} from "@t3tools/contracts";
import { TriangleAlertIcon } from "lucide-react";
import { useId, useState } from "react";

import { useRightPanelStore } from "~/rightPanelStore";
import { useQuietThreadShell } from "~/state/entities";
import { projectRootsEnvironment } from "~/state/projectRoots";
import { useEnvironmentQuery } from "~/state/query";
import { wikiEnvironment } from "~/state/wiki";
import { Alert, AlertDescription } from "../ui/alert";
import { Button } from "../ui/button";
import { Dialog, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Spinner } from "../ui/spinner";
import { useOpenWikiTab } from "../wiki/LegacyWikiTab";
import { useWikiCommand } from "../wiki/wikiEnvironment";

interface KeptBoard {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly itemId: TurnItemId;
  readonly title: string;
}

function PlaceForm({
  board,
  projectId,
  roots,
  onClose,
  onKept,
}: {
  readonly board: KeptBoard;
  readonly projectId: ProjectId;
  /** The folders a person can write, the project folder first. */
  readonly roots: ReadonlyArray<ProjectRootCheckout>;
  readonly onClose: () => void;
  readonly onKept: (result: WikiKeepCanvasResult) => void;
}) {
  const id = useId();
  const [rootKey, setRootKey] = useState(roots[0]?.key);
  const [name, setName] = useState(() => keepCanvasName(board.title));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keep = useWikiCommand(wikiEnvironment.keepCanvas);
  const placeable = canvasFile(name) !== null;
  const canSubmit = rootKey !== undefined && placeable && !busy;

  const submit = async () => {
    if (!canSubmit || rootKey === undefined) return;
    setBusy(true);
    setError(null);
    const outcome = await keep({
      environmentId: board.environmentId,
      input: {
        projectId,
        repository: rootKey,
        threadId: board.threadId,
        itemId: board.itemId,
        name: name.trim(),
      },
    });
    setBusy(false);
    if (outcome.ok) onKept(outcome.value);
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
        It's saved as a file in the project. In a hosted repository's main checkout it goes to a
        change request for review; anywhere else it's written for you to commit.
      </p>
      {roots.length < 2 ? null : (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-folder`}>Folder</Label>
          <Select
            {...(rootKey === undefined ? {} : { value: rootKey })}
            items={Object.fromEntries(roots.map((root) => [root.key, root.name]))}
            onValueChange={(value) => {
              const picked = roots.find((root) => root.key === value);
              if (picked !== undefined) setRootKey(picked.key);
            }}
          >
            <SelectTrigger id={`${id}-folder`}>
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              {roots.map((root) => (
                <SelectItem key={root.key} value={root.key}>
                  {root.name}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </div>
      )}
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
            ? "A folder can't hold a canvas at this path."
            : "It lands at the top of the folder. Type a folder to file it there: ops/Board."}
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

/** What became of a kept board, and the way to it. */
function Kept({
  board,
  projectId,
  root,
  result,
  onClose,
}: {
  readonly board: KeptBoard;
  readonly projectId: ProjectId;
  readonly root: ProjectRootCheckout | undefined;
  readonly result: WikiKeepCanvasResult;
  readonly onClose: () => void;
}) {
  const openTab = useOpenWikiTab();
  const { changeRequest, file, notes } = result;
  const folder = root?.name ?? result.rootKey;
  // A file on disk opens in the thread's files, which hold only the project folder.
  const open =
    changeRequest !== null
      ? () =>
          openTab({
            kind: "note",
            environmentId: board.environmentId,
            wikiId: WikiId.make(projectRootId(projectId, result.rootKey)),
            file,
            changeRequestId: changeRequest.changeRequestId,
          })
      : root?.kind === "workspace"
        ? () =>
            useRightPanelStore
              .getState()
              .openFile({ environmentId: board.environmentId, threadId: board.threadId }, file)
        : null;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        {changeRequest === null
          ? `${file} is written in ${folder}, uncommitted: commit it with your other changes. The canvas stays in this thread either way.`
          : `${file} is in “${changeRequest.title}” in ${folder}. Merge it to put it on main, or close it to discard it. The canvas stays in this thread either way.`}
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
        {open === null ? null : (
          <Button
            size="xs"
            onClick={() => {
              open();
              onClose();
            }}
          >
            Open it
          </Button>
        )}
      </div>
    </div>
  );
}

/** Where the board goes when it's placed by hand: the person picks, and no agent turn runs. */
function PlaceInProject({
  board,
  onClose,
}: {
  readonly board: KeptBoard;
  readonly onClose: () => void;
}) {
  const { environmentId } = board;
  const shell = useQuietThreadShell({ environmentId, threadId: board.threadId });
  const projectId = shell?.projectId ?? null;
  // A person's choice is any folder on disk; the server writes the thread's checkout of it.
  const list = useEnvironmentQuery(
    projectId === null
      ? null
      : projectRootsEnvironment.list({ environmentId, input: { projectId } }),
  );
  const [kept, setKept] = useState<WikiKeepCanvasResult | null>(null);

  if (projectId === null) {
    return (
      <p className="text-xs text-muted-foreground">
        A canvas is kept in its thread's project, and this thread has none.
      </p>
    );
  }
  const roots = (list.data?.roots ?? []).filter((root) => root.writable);
  if (kept !== null) {
    return (
      <Kept
        board={board}
        projectId={projectId}
        root={roots.find((root) => root.key === kept.rootKey)}
        result={kept}
        onClose={onClose}
      />
    );
  }
  if (list.error !== null) {
    return (
      <Alert variant="error">
        <TriangleAlertIcon />
        <AlertDescription>{`Couldn't read the project's folders. ${list.error}`}</AlertDescription>
      </Alert>
    );
  }
  if (list.data === null) return <Spinner size="md" tone="muted" />;
  if (roots.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        None of this project's folders is on disk, so there's nowhere to keep it.
      </p>
    );
  }
  return (
    <PlaceForm
      board={board}
      projectId={projectId}
      roots={roots}
      onClose={onClose}
      onKept={setKept}
    />
  );
}

/**
 * Keeping a board in a folder of its project the person picks, with its cards fixed by
 * `CanvasKeep`: the board menu's item, while this person can place one, and the dialog it opens.
 */
export function useKeepCanvas(board: KeptBoard | null) {
  const [open, setOpen] = useState(false);
  const canPlace = useAtomValue(
    wikiEnvironment.keepCanvas.permissionAtom(board?.environmentId ?? null),
  );
  if (board === null || !canPlace) return { item: undefined, dialog: null };
  return {
    item: { label: "Keep in the project…", run: () => setOpen(true) },
    dialog: (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogPopup className="max-w-md" aria-label={`Keep ${board.title}`}>
          <DialogHeader>
            <DialogTitle>{`Keep ${board.title}`}</DialogTitle>
          </DialogHeader>
          <DialogPanel>
            <PlaceInProject board={board} onClose={() => setOpen(false)} />
          </DialogPanel>
        </DialogPopup>
      </Dialog>
    ),
  };
}
