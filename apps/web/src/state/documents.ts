import { createDocumentEnvironmentAtoms } from "@t3tools/client-runtime/state/documents";

import { connectionAtomRuntime } from "../connection/runtime";

export const documentsEnvironment = createDocumentEnvironmentAtoms(connectionAtomRuntime);
