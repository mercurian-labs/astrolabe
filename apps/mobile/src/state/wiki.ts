import { createWikiEnvironmentAtoms } from "@t3tools/client-runtime/state/wiki";

import { connectionAtomRuntime } from "../connection/runtime";

// Astrolabe: a project's documents, read and changed through the same queries and commands as web.
export const wikiEnvironment = createWikiEnvironmentAtoms(connectionAtomRuntime);
