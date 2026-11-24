import { createGitClientEnvironmentAtoms } from "@t3tools/client-runtime/state/gitClient";

import { connectionAtomRuntime } from "../connection/runtime";

/** Astrolabe: a checkout's Git tab. */
export const gitClientEnvironment = createGitClientEnvironmentAtoms(connectionAtomRuntime);
