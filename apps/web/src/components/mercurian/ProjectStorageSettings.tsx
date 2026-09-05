import type {
  MercurianProjectId,
  MercurianRepository,
  MercurianRepositoryId,
  ProjectStorageKind,
} from "@t3tools/contracts";
import { useEffect, useState } from "react";
import {
  useDesignateStorageSource,
  useRemoveStorageSource,
  useStorageSourceForProject,
} from "../../state/mercurianStorage";
import { Button } from "../ui/button";
import {
  emptyStorageLocations,
  ProjectDocumentLocationFields,
  storageLabels,
} from "./ProjectDocumentLocationFields";

export function ProjectStorageSettings({
  projectId,
  kind,
  repositories,
}: {
  projectId: MercurianProjectId;
  kind: ProjectStorageKind;
  repositories: ReadonlyArray<MercurianRepository>;
}) {
  const source = useStorageSourceForProject(projectId, kind);
  const designate = useDesignateStorageSource();
  const remove = useRemoveStorageSource();
  const [value, setValue] = useState(emptyStorageLocations()[kind]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setValue(
      source
        ? { repositoryId: source.repositoryId, subpath: source.subpath ?? "" }
        : emptyStorageLocations()[kind],
    );
  }, [source?.repositoryId, source?.subpath, projectId, kind]);
  const save = async () => {
    setBusy(true);
    setError(null);
    const result = value.repositoryId
      ? await designate({
          projectId,
          kind,
          repositoryId: value.repositoryId as MercurianRepositoryId,
          subpath: value.subpath,
        })
      : await remove(projectId, kind);
    if (!result.ok)
      setError(
        result.error instanceof Error
          ? result.error.message
          : `Could not save ${storageLabels[kind].toLowerCase()} location.`,
      );
    setBusy(false);
  };
  return (
    <section className="space-y-2 border-t border-border pt-4">
      <ProjectDocumentLocationFields
        kind={kind}
        repositories={repositories}
        value={value}
        onChange={setValue}
        disabled={busy}
      />
      <p className="text-xs text-muted-foreground">
        Changing this location does not move existing documents.
      </p>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void save()}>
        Save {storageLabels[kind].toLowerCase()} location
      </Button>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
