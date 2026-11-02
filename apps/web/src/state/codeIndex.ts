import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { createCodeIndexEnvironmentAtoms } from "@t3tools/client-runtime/state/codeIndex";
import { Atom } from "effect/reactivity";

import { connectionAtomRuntime } from "../connection/runtime";

export const codeIndexEnvironment = createCodeIndexEnvironmentAtoms(connectionAtomRuntime);

/** The statuses of the checkouts in `key` (a JSON array of [environment, project]); null until reported. */
export const codeIndexStatusesAtom = Atom.family((key: string) =>
  Atom.make((get) =>
    (JSON.parse(key) as Array<[EnvironmentId, ProjectId]>).map(([environmentId, projectId]) =>
      get(codeIndexEnvironment.status(environmentId, projectId)),
    ),
  ).pipe(Atom.withLabel(`code-index-statuses:${key}`)),
);
