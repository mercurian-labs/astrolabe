import type {
  EnvironmentId,
  ThreadId,
  WikiChangeRequest,
  WikiChangeRequestId,
  WikiId,
} from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useAtomValue } from "@effect/atom-react";
import { TriangleAlertIcon } from "lucide-react";
import { useId, useState } from "react";

import { useThreadShell } from "~/state/entities";
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
import { defaultSaveTarget, isTurnRunning, type QueuedWikiSave } from "./wiki.logic";
import { useWikiTerms } from "./wikiEnvironment";
import { WikiPart } from "./WikiParts";

const NEW_CHANGE_REQUEST = "new";

/** Where a save lands: an open change request, or a new one with this title. */
export type SaveTarget =
  | { readonly changeRequestId: WikiChangeRequestId }
  | { readonly title: string };

/** Whether the turn of the change request's thread is running, read from its thread shell. */
export function useChangeRequestTurn(
  environmentId: EnvironmentId,
  threadId: ThreadId | null | undefined,
) {
  const shell = useThreadShell(
    threadId === null || threadId === undefined ? null : scopeThreadRef(environmentId, threadId),
  );
  const running = isTurnRunning(shell?.source.status);
  return { running, runId: running ? (shell?.latestRun?.runId ?? null) : null };
}

/** Saves edits as one amendment: into an open change request, or a new one. */
export function SaveToChangeRequestDialog({
  environmentId,
  wikiId,
  subject,
  openChangeRequests,
  viewing,
  onClose,
  onSave,
  onQueue,
}: {
  readonly environmentId: EnvironmentId;
  readonly wikiId: WikiId;
  /** What was edited, for the title and message it starts with. */
  readonly subject: string;
  readonly openChangeRequests: ReadonlyArray<WikiChangeRequest>;
  readonly viewing: WikiChangeRequestId | undefined;
  readonly onClose: () => void;
  /** Saves now; resolves to the failure's message, or null. */
  readonly onSave: (target: SaveTarget, message: string) => Promise<string | null>;
  /** Saves once the turn of the target's thread ends; without it, a save lands at once. */
  readonly onQueue?: (save: QueuedWikiSave) => void;
}) {
  const id = useId();
  const terms = useWikiTerms(environmentId, wikiId);
  const canAmend = useAtomValue(wikiEnvironment.amend.permissionAtom(environmentId));
  const [target, setTarget] = useState<string>(
    () => defaultSaveTarget(openChangeRequests, viewing) ?? NEW_CHANGE_REQUEST,
  );
  const [title, setTitle] = useState(`Edit ${subject}`);
  const [message, setMessage] = useState(`Edit ${subject}`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const opensNew = target === NEW_CHANGE_REQUEST;
  const shownError = error ?? (canAmend ? null : "You don't have permission to change this wiki.");
  const canSubmit =
    canAmend && message.trim().length > 0 && (!opensNew || title.trim().length > 0) && !busy;
  const targetChange = openChangeRequests.find(
    (changeRequest) => changeRequest.changeRequestId === target,
  );
  // The target's thread is mid-turn: the save waits for the turn to end rather than steer it.
  const waitsForTurn =
    useChangeRequestTurn(environmentId, targetChange?.threadId).running && onQueue !== undefined;

  const submit = async () => {
    if (!canSubmit) return;
    if (waitsForTurn && targetChange && onQueue) {
      onQueue({ changeRequestId: targetChange.changeRequestId, message: message.trim() });
      return;
    }
    setBusy(true);
    setError(null);
    const failure = await onSave(
      opensNew ? { title: title.trim() } : { changeRequestId: target as WikiChangeRequestId },
      message.trim(),
    );
    setBusy(false);
    setError(failure);
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogPopup className="sm:max-w-md">
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{`Save to ${terms.singular}`}</DialogTitle>
            <DialogDescription>
              {`Your edit is added to a ${terms.singular}. Main changes only when someone merges it.`}
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${id}-target`}>{terms.Singular}</Label>
                <Select
                  value={target}
                  items={{
                    [NEW_CHANGE_REQUEST]: `New ${terms.singular}`,
                    ...Object.fromEntries(
                      openChangeRequests.map((changeRequest) => [
                        changeRequest.changeRequestId,
                        changeRequest.title,
                      ]),
                    ),
                  }}
                  onValueChange={(value) => {
                    if (typeof value === "string") setTarget(value);
                  }}
                >
                  <SelectTrigger id={`${id}-target`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectPopup>
                    <SelectItem value={NEW_CHANGE_REQUEST}>{`New ${terms.singular}`}</SelectItem>
                    {openChangeRequests.map((changeRequest) => (
                      <SelectItem
                        key={changeRequest.changeRequestId}
                        value={changeRequest.changeRequestId}
                      >
                        {changeRequest.title}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </div>
              {opensNew ? (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`${id}-title`}>Title</Label>
                  <Input
                    id={`${id}-title`}
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                  />
                </div>
              ) : null}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${id}-message`}>What changed</Label>
                <Input
                  id={`${id}-message`}
                  autoFocus
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                />
              </div>
              {waitsForTurn ? (
                <WikiPart.Muted>
                  {`The agent is working in this ${terms.singular}. Your edit is saved when its turn ends; until then the agent's writes keep landing around it.`}
                </WikiPart.Muted>
              ) : null}
              {shownError ? (
                <Alert variant="error">
                  <TriangleAlertIcon />
                  <AlertDescription>{shownError}</AlertDescription>
                </Alert>
              ) : null}
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {busy ? <Spinner /> : null}
              {waitsForTurn ? "Save when the turn ends" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
