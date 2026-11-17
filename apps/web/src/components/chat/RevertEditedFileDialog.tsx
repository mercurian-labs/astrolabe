import { RegistryContext } from "@effect/atom-react";
import { FileDiff } from "@pierre/diffs/react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type {
  OrchestrationV2FileRevertBlock,
  OrchestrationV2FileRevertPreview,
  ScopedThreadRef,
} from "@t3tools/contracts";
import { useContext, useRef, useState } from "react";

import { useRenderedAppearance } from "~/hooks/useTheme";
import { getRenderablePatch, resolveDiffThemeName } from "~/lib/diffRendering";
import { PREFERRED_HIGHLIGHTER } from "~/lib/syntaxHighlighting";
import { orchestrationEnvironment } from "~/state/orchestration";
import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";
import { DiffWorkerPoolProvider } from "../DiffWorkerPoolProvider";
import { revertEditedFile } from "../files/revertEditedFile";
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
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";

type Loaded =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "ready"; readonly preview: OrchestrationV2FileRevertPreview };

const BLOCKED: Record<OrchestrationV2FileRevertBlock, string> = {
  running:
    "The agent is working, and may be writing this file. Revert it once the turn has finished.",
  committed:
    "A commit since the agent's last turn changed this file. Reverting here would leave an uncommitted change that undoes your commit, so do it in git if you want it.",
  "no-checkpoint": "This thread has no finished turn to go back to.",
  "not-in-checkpoint": "The agent's version has no such file. Delete it yourself to go back.",
  unchanged: "The file already reads as the agent left it.",
  unreadable: "The file, or the agent's version of it, can't be read here.",
};

/**
 * Astrolabe: "Revert to agent's version…" for one file the user edited. The dialog shows what the
 * revert throws away, by the environment's rules, and only then reverts it, as one edit Mod-z or
 * the toast's Undo takes back.
 */
export function useRevertEditedFile(threadRef: ScopedThreadRef) {
  const registry = useContext(RegistryContext);
  const preview = useAtomCommand(orchestrationEnvironment.previewFileRevert, {
    reportFailure: false,
  });
  const recordFileEdit = useAtomCommand(threadEnvironment.recordFileEdit, {
    reportFailure: false,
  });
  const [path, setPath] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Loaded>({ status: "loading" });
  const [busy, setBusy] = useState(false);
  const appearance = useRenderedAppearance();
  // Only the latest opening's answer is shown.
  const latest = useRef(0);

  const open = async (next: string) => {
    const request = ++latest.current;
    setPath(next);
    setLoaded({ status: "loading" });
    const result = await preview({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId, path: next },
    });
    if (request !== latest.current) return;
    if (result._tag === "Success") return setLoaded({ status: "ready", preview: result.value });
    if (isAtomCommandInterrupted(result)) return;
    const error = squashAtomCommandFailure(result);
    setLoaded({
      status: "error",
      message: error instanceof Error ? error.message : "The agent's version could not be read.",
    });
  };

  const name = path === null ? "" : path.slice(path.lastIndexOf("/") + 1);
  const ready = loaded.status === "ready" ? loaded.preview : null;
  const canRevert = ready !== null && ready.blocked === null && ready.checkpointText !== null;

  const confirm = async () => {
    if (!canRevert || path === null || ready.checkpointText === null) return;
    setBusy(true);
    const outcome = await revertEditedFile(
      {
        registry,
        environmentId: threadRef.environmentId,
        cwd: ready.cwd,
        path,
        onSaved: () =>
          void recordFileEdit({
            environmentId: threadRef.environmentId,
            input: { threadId: threadRef.threadId, path },
          }),
      },
      { text: ready.checkpointText, missing: ready.missing },
    );
    setBusy(false);
    setPath(null);
    if (!outcome.ok) {
      toastManager.add({
        type: "error",
        title: `Couldn't revert ${name}`,
        description: outcome.message,
      });
      return;
    }
    const undo = outcome.undo;
    toastManager.add({
      type: "success",
      title: ready.missing
        ? `Recreated ${name} as the agent left it`
        : `Reverted ${name} to the agent's version`,
      ...(undo === null
        ? {}
        : {
            actionProps: {
              children: "Undo",
              onClick: () =>
                void undo().then((message) => {
                  if (message !== null) {
                    toastManager.add({
                      type: "error",
                      title: `Couldn't undo the revert`,
                      description: message,
                    });
                  }
                }),
            },
          }),
    });
  };

  const patch =
    ready?.diff == null || path === null
      ? null
      : getRenderablePatch(`diff --git a/${path} b/${path}\n${ready.diff}`, "file-revert");

  const dialog = (
    <Dialog
      open={path !== null}
      onOpenChange={(next) => {
        if (!next && !busy) setPath(null);
      }}
    >
      <DialogPopup className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Revert {name} to the agent's version?</DialogTitle>
          <DialogDescription>
            {loaded.status === "loading"
              ? "Comparing it with how the agent's last turn left it…"
              : loaded.status === "error"
                ? loaded.message
                : ready?.blocked
                  ? BLOCKED[ready.blocked]
                  : ready?.missing
                    ? "The file was deleted since the agent's last turn. Reverting recreates it as the agent left it."
                    : "These changes since the agent's last turn are thrown away. Undo brings them back."}
          </DialogDescription>
        </DialogHeader>
        {ready !== null && ready.blocked !== "unchanged" && ready.checkpointText !== null ? (
          <DialogPanel>
            {ready.outsideChanges && !ready.missing && ready.blocked === null ? (
              <p className="text-sm">
                Changes made outside the editor, by a terminal, a formatter or another tool, may be
                among them, and are thrown away too.
              </p>
            ) : null}
            {patch?.kind === "files" ? (
              <div
                className="overflow-hidden rounded-lg border text-xs"
                aria-label="Changes thrown away"
              >
                <DiffWorkerPoolProvider>
                  {patch.files.map((fileDiff) => (
                    <FileDiff
                      key={fileDiff.name}
                      fileDiff={fileDiff}
                      options={{
                        collapsed: false,
                        diffStyle: "unified",
                        theme: resolveDiffThemeName(appearance),
                        overflow: "wrap",
                        preferredHighlighter: PREFERRED_HIGHLIGHTER,
                      }}
                    />
                  ))}
                </DiffWorkerPoolProvider>
              </div>
            ) : patch?.kind === "raw" ? (
              <pre className="overflow-x-auto rounded-md bg-muted/40 p-2 text-xs">{patch.text}</pre>
            ) : (
              <p className="text-sm text-muted-foreground">
                The changes are too large to show here. See them in the thread's diff first.
              </p>
            )}
          </DialogPanel>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => setPath(null)} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={!canRevert || busy}
            onClick={() => void confirm()}
          >
            {busy || loaded.status === "loading" ? <Spinner /> : null}
            {ready?.missing
              ? "Recreate the file"
              : ready?.outsideChanges
                ? "Revert, discarding outside changes too"
                : "Revert"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );

  return { open: (next: string) => void open(next), dialog };
}
