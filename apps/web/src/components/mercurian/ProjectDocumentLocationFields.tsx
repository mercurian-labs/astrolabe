import type { MercurianRepository, ProjectStorageKind } from "@t3tools/contracts";
import { Input } from "../ui/input";

export interface StorageLocationDraft {
  repositoryId: string;
  subpath: string;
}
export const storageLabels = { memory: "Memory", plan: "Plans", spec: "Specs" } as const;
export const emptyStorageLocations = (): Record<ProjectStorageKind, StorageLocationDraft> => ({
  memory: { repositoryId: "", subpath: "" },
  plan: { repositoryId: "", subpath: "plans" },
  spec: { repositoryId: "", subpath: "specs" },
});

/** The same optional destination fields are used during creation and later settings edits. */
export function ProjectDocumentLocationFields({
  kind,
  repositories,
  value,
  onChange,
  disabled = false,
}: {
  kind: ProjectStorageKind;
  repositories: ReadonlyArray<MercurianRepository>;
  value: StorageLocationDraft;
  onChange: (value: StorageLocationDraft) => void;
  disabled?: boolean;
}) {
  const label = storageLabels[kind];
  return (
    <fieldset disabled={disabled} className="space-y-2">
      <legend className="text-sm font-medium">{label}</legend>
      <label className="block space-y-1 text-xs text-muted-foreground">
        <span>Repository</span>
        <select
          aria-label={`${label} repository`}
          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"
          value={value.repositoryId}
          onChange={(event) => onChange({ ...value, repositoryId: event.target.value })}
        >
          <option value="">Not configured</option>
          {repositories.map((repository) => (
            <option key={repository.repositoryId} value={repository.repositoryId}>
              {repository.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block space-y-1 text-xs text-muted-foreground">
        <span>Directory (relative to repository)</span>
        <Input
          aria-label={`${label} directory`}
          disabled={!value.repositoryId || disabled}
          placeholder="Repository root"
          value={value.subpath}
          onChange={(event) => onChange({ ...value, subpath: event.target.value })}
        />
      </label>
    </fieldset>
  );
}
