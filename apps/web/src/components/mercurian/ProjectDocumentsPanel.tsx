import type { ListProjectDocumentsResult, MercurianProjectId } from "@t3tools/contracts";
import { useEffect, useState } from "react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useRightPanelStore } from "../../rightPanelStore";
import { useListProjectDocuments, useStorageSources } from "../../state/mercurianStorage";
import { Button } from "../ui/button";
import { ManageProjectRepositoriesDialog } from "./ManageProjectRepositoriesDialog";
import { useThreadSpace } from "./ThreadSpaceContext";

/** Navigation into shared Files; the line dashboard can consume the same document references. */
export function useProjectDocumentsPanel() {
  const { detail, projectId, threadId, environmentId, search } = useThreadSpace();
  const { snapshot } = useStorageSources();
  const list = useListProjectDocuments(environmentId);
  const [response, setResponse] = useState<{
    key: string;
    result: ListProjectDocumentsResult | null;
    error: string | null;
  } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [revision, setRevision] = useState(0);
  const sources = snapshot.sources.filter(
    (source) => source.projectId === projectId && source.kind !== "memory",
  );
  const historical = search.at !== undefined;
  const requestKey = JSON.stringify([
    environmentId,
    projectId,
    threadId,
    search.at,
    snapshot.sources,
    detail?.snapshotSequence,
    revision,
  ]);
  const result = response?.key === requestKey ? response.result : null;
  const error = response?.key === requestKey ? response.error : null;
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    void list({ projectId, threadId, ...(search.at ? { positionCommitId: search.at } : {}) }).then(
      (value) => {
        if (!cancelled)
          setResponse({
            key: requestKey,
            result: value.ok ? value.value : null,
            error: value.ok ? null : "Could not load project documents.",
          });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [projectId, threadId, search.at, requestKey, list]);
  return {
    projectId,
    threadId,
    environmentId,
    result,
    error,
    settingsOpen,
    setSettingsOpen,
    setRevision,
    historical,
    sources,
  };
}
export function ProjectDocumentsPanel({
  state,
}: {
  state: ReturnType<typeof useProjectDocumentsPanel>;
}) {
  const {
    projectId,
    threadId,
    environmentId,
    result,
    error,
    settingsOpen,
    setSettingsOpen,
    setRevision,
    sources,
  } = state;
  return (
    <div className="h-full overflow-auto p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">Plans and specs</span>
        <Button size="sm" variant="ghost" onClick={() => setRevision((value) => value + 1)}>
          Refresh list
        </Button>
      </div>
      {sources.length < 2 && (
        <div className="text-xs text-muted-foreground">
          {sources.length === 0
            ? "Choose a location for plans or specs to get started."
            : `Set up ${sources[0]?.kind === "plan" ? "specs" : "plans"} to use both document types.`}
          <Button size="sm" variant="link" onClick={() => setSettingsOpen(true)}>
            Project settings
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {result?.problems.map((problem) => (
        <p key={problem} className="text-xs text-muted-foreground">
          {problem}
        </p>
      ))}
      {sources.length > 0 && result === null && !error && (
        <p className="text-xs text-muted-foreground">Reading documents…</p>
      )}
      {result && result.documents.length === 0 && sources.length > 0 && (
        <p className="text-xs text-muted-foreground">
          No plans or specs in this line's configured locations yet.
        </p>
      )}
      {result && result.documents.some((document) => document.lastCheckpoint !== null) && (
        <p className="text-xs font-medium">Changed on this line</p>
      )}
      {result?.documents.map((document) => (
        <button
          key={`${document.repositoryId}:${document.relativePath}`}
          className="block w-full rounded px-2 py-2 text-left hover:bg-accent/40"
          onClick={() =>
            useRightPanelStore
              .getState()
              .openDocument(scopeThreadRef(environmentId, threadId), document)
          }
        >
          <span className="block text-sm">{document.title}</span>
          <span className="block text-xs text-muted-foreground">
            {document.kind === "plan" ? "Plan" : "Spec"} · {document.relativePath}
            {document.lastCheckpoint !== null
              ? ` · Checkpoint ${document.lastCheckpoint}`
              : " · Project context"}
          </span>
          {document.problem && <span className="text-xs text-destructive">{document.problem}</span>}
        </button>
      ))}
      {projectId && (
        <ManageProjectRepositoriesDialog
          projectId={projectId as MercurianProjectId}
          projectName="Project"
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
        />
      )}
    </div>
  );
}
