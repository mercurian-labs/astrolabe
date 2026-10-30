import { createCodeLocalGraphAtoms } from "@t3tools/client-runtime/state/codeLocalGraph";

import { connectionAtomRuntime } from "../connection/runtime";

export const codeLocalGraphEnvironment = createCodeLocalGraphAtoms(connectionAtomRuntime);
