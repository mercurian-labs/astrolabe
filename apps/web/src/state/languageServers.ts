import { createLanguageServerEnvironmentAtoms } from "@t3tools/client-runtime/state/language-servers";

import { connectionAtomRuntime } from "../connection/runtime";

export const languageServersEnvironment =
  createLanguageServerEnvironmentAtoms(connectionAtomRuntime);
