import type { EnvironmentId, WikiId } from "@t3tools/contracts";
import { isWikiPath } from "@mercurian/wiki/resolve-link";
import { useId, useState, useSyncExternalStore, type FormEvent } from "react";

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
import { useWikiMove } from "./useWikiMove";

export interface WikiMoveRequest {
  readonly environmentId: EnvironmentId;
  readonly wikiId: WikiId;
  /** The wiki's name, for the dialog to say where. */
  readonly name: string;
  /** A document's path, or a folder's when `folder`. */
  readonly from: string;
  readonly folder: boolean;
}

let requested: WikiMoveRequest | null = null;
const listeners = new Set<() => void>();

/** Opens the dialog, from a tree's menu or the command palette. */
export function requestWikiMove(next: WikiMoveRequest | null) {
  requested = next;
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Moves a document or a folder by typing where it goes: the tree's drag, from the keyboard. */
export function WikiMoveDialog() {
  const request = useSyncExternalStore(subscribe, () => requested);
  const onClose = () => requestWikiMove(null);
  return (
    <Dialog open={request !== null} onOpenChange={(open) => !open && onClose()}>
      {request === null ? null : (
        <DialogPopup className="sm:max-w-md">
          <WikiMoveForm key={request.from} request={request} onClose={onClose} />
        </DialogPopup>
      )}
    </Dialog>
  );
}

function WikiMoveForm({
  request,
  onClose,
}: {
  readonly request: WikiMoveRequest;
  readonly onClose: () => void;
}) {
  const move = useWikiMove();
  const id = useId();
  const [path, setPath] = useState(request.from);
  const [busy, setBusy] = useState(false);
  const to = path.trim().replace(/^\/+|\/+$/g, "");
  const canMove = to !== request.from && isWikiPath(to);
  return (
    <form
      className="flex min-h-0 flex-col"
      onSubmit={async (event: FormEvent) => {
        event.preventDefault();
        if (!canMove || busy) return;
        setBusy(true);
        const { environmentId, wikiId, from, folder } = request;
        const moved = await move({ environmentId, wikiId, from, to, folder });
        setBusy(false);
        if (moved) onClose();
      }}
    >
      <DialogHeader>
        <DialogTitle>{request.folder ? "Move folder" : "Move document"}</DialogTitle>
        <DialogDescription>
          {`The path from the top of ${request.name}. Links to it follow.`}
        </DialogDescription>
      </DialogHeader>
      <DialogPanel>
        <div className="flex flex-col gap-2">
          <Label htmlFor={id}>Path</Label>
          <Input
            id={id}
            autoFocus
            value={path}
            onChange={(event) => setPath(event.target.value)}
            spellCheck={false}
          />
        </div>
      </DialogPanel>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={!canMove || busy}>
          Move
        </Button>
      </DialogFooter>
    </form>
  );
}
