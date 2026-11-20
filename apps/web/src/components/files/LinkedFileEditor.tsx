import type { ScopedThreadRef } from "@t3tools/contracts";
import { useContext, useEffect } from "react";

import { useStableCallback } from "~/hooks/useStableCallback";
import { PaneTabKeyContext } from "~/panes/PaneSurfaceHost";
import { chatSurfaceKey, chatTabKey } from "~/sectionTabs/sectionTabs";
import { useThreadShell } from "~/state/entities";
import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";
import { repositoryFileReveal } from "../repositories/repositoryFileReveal";
import { RepositoryFileView } from "../repositories/RepositoryFileView";
import { checkoutName } from "../repositories/repositoryTabs";

/**
 * Astrolabe: a thread's linked file tab in Edit: the file of the thread's checkout in our editor,
 * as a Projects tab shows it, in this tab. What the editor saves is recorded on the thread, so the
 * next message tells the agent.
 */
export default function LinkedFileEditor(props: {
  readonly threadRef: ScopedThreadRef;
  readonly surfaceId: string;
  /** The thread's checkout. */
  readonly cwd: string;
  /** The file's path in the checkout. */
  readonly path: string;
  readonly revealLine: number | null;
  readonly revealRequestId: number;
  readonly onPreview: () => void;
}) {
  const { threadRef, cwd, path, revealLine, revealRequestId } = props;
  const thread = useThreadShell(threadRef);
  // Outside the shared panes (the narrow window's sheet) the tab has no pane key of its own.
  const tabKey =
    useContext(PaneTabKeyContext) ?? chatSurfaceKey(chatTabKey(threadRef), props.surfaceId);
  const recordFileEdit = useAtomCommand(threadEnvironment.recordFileEdit, {
    reportFailure: false,
  });
  const saved = useStableCallback(() => {
    void recordFileEdit({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId, path },
    });
  });
  const preview = useStableCallback(props.onPreview);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- hands each line the tab is asked to show to the editor's reveal store
  useEffect(() => {
    if (revealLine !== null && revealRequestId > 0)
      repositoryFileReveal.request(tabKey, revealLine);
  }, [tabKey, revealLine, revealRequestId]);
  if (thread === null) return null;
  return (
    <RepositoryFileView
      tabKey={tabKey}
      tab={{
        kind: "file",
        environmentId: threadRef.environmentId,
        projectId: thread.projectId,
        checkout: { cwd },
        path,
        cwd,
        checkoutName: checkoutName({ cwd }, { branch: thread.branch }),
      }}
      linked={{ preview, saved }}
    />
  );
}
