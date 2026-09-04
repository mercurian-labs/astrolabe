import { MercurianCommitId, ThreadId } from "@t3tools/contracts";

export type ThreadSpaceRouteSearch = Readonly<{
  line?: ThreadId;
  at?: MercurianCommitId;
}>;

export function validateThreadSpaceSearch(search: Record<string, unknown>): ThreadSpaceRouteSearch {
  return {
    ...(typeof search.line === "string" && search.line.trim().length > 0
      ? { line: ThreadId.make(search.line) }
      : {}),
    ...(typeof search.at === "string" && search.at.trim().length > 0
      ? { at: MercurianCommitId.make(search.at) }
      : {}),
  };
}
