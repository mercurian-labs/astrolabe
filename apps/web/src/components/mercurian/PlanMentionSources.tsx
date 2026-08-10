import type { MercurianProjectId } from "@t3tools/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useComposerPathSearch } from "../../lib/composerPathSearchState";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useProjectRepositories } from "../../state/mercurianRepositories";
import {
  buildMentionSearchTargets,
  mergeMentionCandidates,
  type MentionCandidate,
  type MentionSearchTarget,
} from "./planMentions.logic";

/**
 * What `@` can reach in a planning space: the files of the repositories the
 * plan's project is working in.
 *
 * The fan-out is one mounted searcher per repository, because a hook cannot be
 * called in a loop of changing length and a searcher is what a hook is. Each
 * reports its answers up; the merge and the labelling are pure.
 *
 * Nothing new crosses the wire for this: it is the app's existing path-search
 * door, pointed at each repository root in turn.
 */
export function usePlanMentionCandidates(projectId: MercurianProjectId | null) {
  const environmentId = usePrimaryEnvironmentId();
  const repositories = useProjectRepositories(projectId);
  const [query, setQuery] = useState<string | null>(null);
  const [entriesByRepository, setEntriesByRepository] = useState<
    Readonly<Record<string, ReadonlyArray<{ readonly path: string }>>>
  >({});

  const targets = useMemo(() => buildMentionSearchTargets(repositories), [repositories]);

  const report = useCallback(
    (repositoryId: string, entries: ReadonlyArray<{ readonly path: string }>) => {
      setEntriesByRepository((current) =>
        current[repositoryId] === entries ? current : { ...current, [repositoryId]: entries },
      );
    },
    [],
  );

  const candidates = useMemo(
    () =>
      query === null
        ? []
        : mergeMentionCandidates(
            targets.map((target) => ({
              repositoryId: target.repositoryId,
              repositoryName: target.repositoryName,
              entries: entriesByRepository[target.repositoryId] ?? [],
            })),
          ),
    [entriesByRepository, query, targets],
  );

  /**
   * Mounted by the surface beside its composer. Renders nothing — it exists so
   * each repository gets its own live search without the caller knowing how
   * many there are.
   */
  const sources = (
    <>
      {targets.map((target) => (
        <MentionSource
          key={target.repositoryId}
          environmentId={environmentId}
          query={query}
          target={target}
          onEntries={report}
        />
      ))}
    </>
  );

  return { candidates, sources, onMentionQueryChange: setQuery } as const;
}

function MentionSource({
  target,
  environmentId,
  query,
  onEntries,
}: {
  readonly target: MentionSearchTarget;
  readonly environmentId: ReturnType<typeof usePrimaryEnvironmentId>;
  readonly query: string | null;
  readonly onEntries: (
    repositoryId: string,
    entries: ReadonlyArray<{ readonly path: string }>,
  ) => void;
}) {
  const state = useComposerPathSearch({
    environmentId,
    cwd: target.cwd,
    query,
  });

  const entries = state.entries;
  const repositoryId = target.repositoryId;
  useEffect(() => {
    onEntries(repositoryId, entries);
  }, [entries, onEntries, repositoryId]);

  return null;
}

export type { MentionCandidate };
