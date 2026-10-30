/**
 * Astrolabe: the line a Repositories file tab was last asked to show, by whatever opened it (project
 * search). The file view reads it for its own tab key and scrolls there; a repeated request for the
 * same line is new by its id.
 */
export interface RepositoryFileReveal {
  readonly tabKey: string;
  readonly line: number;
  readonly id: number;
}

const listeners = new Set<() => void>();
let current: RepositoryFileReveal | null = null;

export const repositoryFileReveal = {
  request(tabKey: string, line: number) {
    current = { tabKey, line, id: (current?.id ?? 0) + 1 };
    for (const listener of listeners) listener();
  },
  get: (): RepositoryFileReveal | null => current,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
