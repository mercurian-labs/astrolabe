import { isCodingSessionBlockedError, type ModelSelection } from "@t3tools/contracts";
import { useMemo, useState } from "react";

import { useCodingSessionDraftStore } from "../../codingSessionDraftStore";
import { usePrimarySettings } from "../../hooks/useSettings";
import { useMercurianTree, useStartCodingSession } from "../../state/mercurian";
import { useProjectRepositories } from "../../state/mercurianRepositories";
import { usePlanningModel } from "../../state/mercurianWorkspace";
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
import {
  CODING_SESSION_RUNTIME_MODES,
  codingSessionModelGroups,
  startCodingSessionPayload,
} from "./codingSessionDraft.logic";

export function CodingSessionDraftSheet({
  open,
  draftId,
  onOpenChange,
  onLineBranchMissing,
}: {
  readonly open: boolean;
  readonly draftId: string | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly onLineBranchMissing: (input: { readonly commitId: string }) => void;
}) {
  const draft = useCodingSessionDraftStore((state) =>
    draftId === null ? undefined : state.draftsById[draftId],
  );
  const updateDraft = useCodingSessionDraftStore((state) => state.updateDraft);
  const completeStart = useCodingSessionDraftStore((state) => state.completeStart);
  const tree = useMercurianTree().snapshot;
  const plan = tree.plans.find((candidate) => candidate.planId === draft?.planId);
  const repositories = useProjectRepositories(plan?.projectId ?? null);
  const planningModel = usePlanningModel();
  const settings = usePrimarySettings();
  const groups = useMemo(
    () => codingSessionModelGroups(planningModel.providers, settings),
    [planningModel.providers, settings],
  );
  const start = useStartCodingSession();
  const [starting, setStarting] = useState(false);

  const canStart =
    draft !== undefined &&
    groups.some(
      (group) =>
        group.instance.instanceId === draft.modelSelection.instanceId &&
        group.models.some((model) => model.slug === draft.modelSelection.model),
    );

  const setModel = (value: string) => {
    if (draft === undefined) return;
    const separator = value.indexOf("\u0000");
    if (separator < 1) return;
    updateDraft(draft.draftId, {
      modelSelection: {
        instanceId: value.slice(0, separator) as ModelSelection["instanceId"],
        model: value.slice(separator + 1),
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Start a coding session</DialogTitle>
          <DialogDescription>
            Shape the isolated workspace before the first turn starts.
          </DialogDescription>
        </DialogHeader>
        {draft === undefined ? null : (
          <DialogPanel className="flex flex-col gap-4">
            <div className="rounded-lg border border-border/70 bg-muted/20 p-3 text-sm">
              <p className="font-medium">
                Works across: {repositories.map((repository) => repository.name).join(", ")}
              </p>
              <p className="text-xs text-muted-foreground">
                Implements commit {draft.parentCommitId.slice(0, 8)}
              </p>
            </div>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Runtime mode</span>
              <select
                className="h-9 rounded-md border border-input bg-background px-2"
                value={draft.runtimeMode}
                onChange={(event) =>
                  updateDraft(draft.draftId, {
                    runtimeMode: event.target.value as typeof draft.runtimeMode,
                  })
                }
              >
                {CODING_SESSION_RUNTIME_MODES.map((mode) => (
                  <option key={mode.value} value={mode.value}>
                    {mode.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Agent and model</span>
              <select
                className="h-9 rounded-md border border-input bg-background px-2"
                value={`${draft.modelSelection.instanceId}\u0000${draft.modelSelection.model}`}
                onChange={(event) => setModel(event.target.value)}
              >
                {groups.flatMap((group) =>
                  group.models.map((model) => (
                    <option
                      key={`${group.instance.instanceId}:${model.slug}`}
                      value={`${group.instance.instanceId}\u0000${model.slug}`}
                    >
                      {group.instance.displayName} — {model.name}
                    </option>
                  )),
                )}
              </select>
              {groups.length === 0 ? (
                <span className="text-xs text-muted-foreground">
                  Install and enable an agent before starting a coding session.
                </span>
              ) : null}
            </label>
          </DialogPanel>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button
            disabled={!canStart || starting}
            onClick={() => {
              if (draft === undefined) return;
              setStarting(true);
              void start(startCodingSessionPayload(draft)).then((result) => {
                setStarting(false);
                if (!result.ok) {
                  if (
                    isCodingSessionBlockedError(result.error) &&
                    result.error.reason === "line-branch-missing"
                  ) {
                    onLineBranchMissing({ commitId: draft.parentCommitId });
                    onOpenChange(false);
                  }
                  return;
                }
                completeStart(draft.draftId);
                onOpenChange(false);
              });
            }}
          >
            {starting ? "Starting…" : "Start"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
