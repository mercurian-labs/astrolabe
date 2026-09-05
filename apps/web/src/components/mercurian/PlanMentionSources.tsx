import type { MemoryLineRef, MercurianProjectId } from "@t3tools/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useComposerPathSearch } from "../../lib/composerPathSearchState";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useMemorySourceForProject, useReadMemoryIndex } from "../../state/mercurianMemory";
import { useProjectRepositories } from "../../state/mercurianRepositories";
import {
  buildMentionSearchTargets,
  mergeMentionCandidates,
  type MentionCandidate,
  type MentionSearchTarget,
} from "./planMentions.logic";

/**
 * What `@` can reach in a thread: the files of the repositories the
 * plan's project is working in.
 *
 * The fan-out is one mounted searcher per repository, because a hook cannot be
 * called in a loop of changing length and a searcher is what a hook is. Each
 * reports its answers up; the merge and the labelling are pure.
 *
 * Nothing new crosses the wire for this: it is the app's existing path-search
 * door, pointed at each repository root in turn.
 */
export function usePlanMentionCandidates(
  projectId: MercurianProjectId | null,
  line?: MemoryLineRef,
) {
  const environmentId = usePrimaryEnvironmentId();
  const repositories = useProjectRepositories(projectId);
  const memorySource = useMemorySourceForProject(projectId);
  const readMemoryIndex = useReadMemoryIndex();
  const [query, setQuery] = useState<string | null>(null);
  const [notesOnly, setNotesOnly] = useState(false);
  const [noteNames, setNoteNames] = useState<ReadonlyArray<string>>([]);
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
            notesOnly
              ? []
              : targets.map((target) => ({
                  repositoryId: target.repositoryId,
                  repositoryName: target.repositoryName,
                  entries: entriesByRepository[target.repositoryId] ?? [],
                })),
            { noteNames, query },
          ),
    [entriesByRepository, noteNames, notesOnly, query, targets],
  );

  useEffect(() => {
    if (query === null || projectId === null || memorySource === null) {
      setNoteNames([]);
      return;
    }
    let active = true;
    const timeout = window.setTimeout(() => {
      void readMemoryIndex(projectId, line).then((result) => {
        if (active) setNoteNames(result.ok ? result.value.notes.map((note) => note.name) : []);
      });
    }, 120);
    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [line, memorySource, projectId, query, readMemoryIndex]);

  const onMentionQueryChange = useCallback(
    (nextQuery: string | null, options?: { readonly notesOnly?: boolean }) => {
      setQuery(nextQuery);
      setNotesOnly(options?.notesOnly === true);
    },
    [],
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
          query={notesOnly ? null : query}
          target={target}
          onEntries={report}
        />
      ))}
    </>
  );

  return { candidates, sources, onMentionQueryChange } as const;
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
