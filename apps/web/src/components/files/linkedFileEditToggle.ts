import { resolvePathLinkTarget } from "@t3tools/shared/fileLinks";

import { selectThreadRightPanelState, useRightPanelStore } from "~/rightPanelStore";
import { parseChatSurfaceKey, parseChatTabKey } from "~/sectionTabs/sectionTabs";
import { readProject, readThreadShell } from "~/state/entities";
import { linkedFileEditorPath } from "../repositories/fileView";

/**
 * Astrolabe: Edit or Preview for a thread's linked file tab, by its tab key, as its header's button
 * switches it; null for any other tab, or a file our editor doesn't open.
 */
export function linkedFileEditToggle(
  tabKey: string | null,
): { readonly label: string; readonly run: () => void } | null {
  const parsed = tabKey === null ? null : parseChatSurfaceKey(tabKey);
  const ref = parsed === null ? null : parseChatTabKey(parsed.chatKey);
  if (parsed === null || ref === null) return null;
  const store = useRightPanelStore.getState();
  const surface = selectThreadRightPanelState(store.byThreadKey, ref).surfaces.find(
    (candidate) => candidate.id === parsed.surfaceId,
  );
  if (surface?.kind !== "file" || surface.attachment !== undefined) return null;
  const set = (editing: boolean) => () => store.setFileEditing(ref, surface.id, editing);
  if (surface.editing) return { label: "Preview file", run: set(false) };
  const thread = readThreadShell(ref);
  const cwd =
    thread === null
      ? undefined
      : (thread.worktreePath ??
        readProject({ environmentId: ref.environmentId, projectId: thread.projectId })
          ?.workspaceRoot);
  if (!cwd) return null;
  const path = linkedFileEditorPath(false, cwd, resolvePathLinkTarget(surface.relativePath, cwd));
  return path === null ? null : { label: "Edit file", run: set(true) };
}
