import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  createWikiAutosave,
  type WikiAutosave,
  type WikiAutosaveStatus,
  type WikiSaveOutcome,
} from "@t3tools/client-runtime/wikiAutosave";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { TriangleAlertIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from "react";

import { useThreadShell } from "~/state/entities";
import { TabHeader } from "~/panes/TabHeader";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "../ui/alert";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { isTurnRunning } from "./wiki.logic";

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

interface WikiAutosaveInput {
  readonly subject: string;
  readonly save: () => Promise<WikiSaveOutcome>;
  /** A save of what the view shows now, for after it's gone; without it, `save` as it stands. */
  readonly freeze?: () => () => Promise<WikiSaveOutcome>;
  readonly delayMs?: number;
}

/** A document's autosave, which outlives the view by as long as its last edits take to land. */
export function useWikiAutosave(input: WikiAutosaveInput) {
  const [{ autosave, follow, retire }] = useState(() => {
    let latest = input;
    const store = createWikiAutosave({
      save: () => latest.save(),
      ...(input.delayMs === undefined ? {} : { delayMs: input.delayMs }),
      onOrphanedFailure: (message) =>
        toastManager.add({
          type: "error",
          title: `Couldn't save ${latest.subject}`,
          description: message,
        }),
    });
    return {
      autosave: store,
      follow: (next: WikiAutosaveInput) => {
        latest = next;
      },
      retire: () => store.retire(latest.freeze?.() ?? latest.save),
    };
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the store's timers run outside React and read the latest save
  useLayoutEffect(() => follow(input));
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- leaving hands what's unsaved to the store, which outlives the view
  useEffect(() => retire, [retire]);
  const status = useSyncExternalStore(autosave.subscribe, autosave.getStatus);
  return { autosave, status };
}

/** Edits a person would lose by leaving now: nothing else stops them landing by themselves. */
export const holdsEdits = (status: WikiAutosaveStatus) =>
  status.kind === "failed" || status.kind === "waiting-for-turn";

/** How a document's edits stand, in its tab's header. */
export function WikiSaveStatus({
  status,
  waiting = "Saves when the turn ends",
}: {
  readonly status: WikiAutosaveStatus;
  /** What a hold on the edits is waiting for. */
  readonly waiting?: string;
}) {
  switch (status.kind) {
    case "saving":
      return <TabHeader.Status>Saving…</TabHeader.Status>;
    case "waiting-for-turn":
      return <TabHeader.Status>{waiting}</TabHeader.Status>;
    case "failed":
      return <TabHeader.Status>Not saved</TabHeader.Status>;
    case "idle":
      return status.saved ? <TabHeader.Status>Saved</TabHeader.Status> : null;
  }
}

/** A failed save stays in view until it lands, saying whether it's still being tried. */
export function WikiSaveFailure({
  status,
  autosave,
}: {
  readonly status: WikiAutosaveStatus;
  readonly autosave: WikiAutosave;
}) {
  if (status.kind !== "failed") return null;
  return (
    <div className="shrink-0 px-6 pt-3">
      <Alert variant="error">
        <TriangleAlertIcon />
        <AlertTitle>Your edits aren't saved</AlertTitle>
        <AlertDescription>
          {status.retrying ? `${status.message} Still trying.` : status.message}
        </AlertDescription>
        <AlertAction>
          <Button variant="outline" size="sm" onClick={autosave.retry}>
            Try again
          </Button>
        </AlertAction>
      </Alert>
    </div>
  );
}
