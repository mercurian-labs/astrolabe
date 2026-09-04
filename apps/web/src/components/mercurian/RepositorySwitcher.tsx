import type { MercurianRepository, ThreadWorkspaceMember } from "@t3tools/contracts";

export function resolveCodingSessionMember(
  members: ReadonlyArray<ThreadWorkspaceMember>,
  selectedRepositoryId: string | null,
): ThreadWorkspaceMember | null {
  return (
    members.find((member) => member.repositoryId === selectedRepositoryId) ?? members[0] ?? null
  );
}

export function CodingSessionRepositorySwitcher(props: {
  readonly members: ReadonlyArray<ThreadWorkspaceMember>;
  readonly repositories: ReadonlyArray<Pick<MercurianRepository, "repositoryId" | "name">>;
  readonly selectedRepositoryId: string | null;
  readonly onSelect: (repositoryId: string) => void;
}) {
  if (props.members.length <= 1) return null;

  return (
    <select
      aria-label="Repository"
      className="h-8 max-w-36 rounded-md border border-input bg-background px-2 text-xs"
      value={props.selectedRepositoryId ?? ""}
      onChange={(event) => props.onSelect(event.target.value)}
    >
      {props.members.map((member) => (
        <option key={member.repositoryId} value={member.repositoryId}>
          {props.repositories.find((candidate) => candidate.repositoryId === member.repositoryId)
            ?.name ?? member.repositoryId}
        </option>
      ))}
    </select>
  );
}
