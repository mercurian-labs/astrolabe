import { createProjectRootsEnvironmentAtoms } from "@t3tools/client-runtime/state/projectRoots";

import { connectionAtomRuntime } from "../connection/runtime";

/** Astrolabe: a project's roots, and what the Projects tree's Docs filter keeps of one. */
export const projectRootsEnvironment = createProjectRootsEnvironmentAtoms(connectionAtomRuntime);
