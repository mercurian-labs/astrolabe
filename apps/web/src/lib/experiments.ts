import * as Schema from "effect/Schema";

import { useLocalStorage } from "../hooks/useLocalStorage";

export const Experiments = Schema.Struct({
  historyWalkViews: Schema.Boolean,
});
export type Experiments = typeof Experiments.Type;

export const DEFAULT_EXPERIMENTS: Experiments = {
  historyWalkViews: false,
};

export const EXPERIMENTS_STORAGE_KEY = "mercurian:experiments:v1";

/** Persisted experiments fail closed as one set, never as a partially valid mix. */
export function decodeExperiments(value: unknown): Experiments {
  try {
    return Schema.decodeUnknownSync(Experiments)(value);
  } catch {
    return DEFAULT_EXPERIMENTS;
  }
}

type ExperimentsUpdater = (value: Experiments | ((current: Experiments) => Experiments)) => void;

const useStoredExperiments = (): [Experiments, ExperimentsUpdater] =>
  useLocalStorage(EXPERIMENTS_STORAGE_KEY, DEFAULT_EXPERIMENTS, Experiments);

const ignoreExperimentUpdate: ExperimentsUpdater = () => undefined;
const useDefaultExperiments = (): [Experiments, ExperimentsUpdater] => [
  DEFAULT_EXPERIMENTS,
  ignoreExperimentUpdate,
];

/** Production builds neither read nor honor development experiment storage. */
export const useExperiments = import.meta.env.DEV ? useStoredExperiments : useDefaultExperiments;
