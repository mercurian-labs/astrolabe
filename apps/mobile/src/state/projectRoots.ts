import { createProjectRootsEnvironmentAtoms } from "@t3tools/client-runtime/state/projectRoots";

import { connectionAtomRuntime } from "../connection/runtime";

/** Astrolabe: a project's roots, which a kept canvas picks its folder from. */
export const projectRootsEnvironment = createProjectRootsEnvironmentAtoms(connectionAtomRuntime);
