// @effect-diagnostics nodeBuiltinImport:off - Reads the install scripts as shipped.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { CLI_RELEASE_REPOSITORY } from "@t3tools/shared/cliRelease";
import { expect, it } from "vite-plus/test";

// The install scripts run on their own, so each keeps a copy of the release repository.
it.each([
  ["install.sh", /^repo="([^"]*)"$/m],
  ["install.ps1", /^\$repo = "([^"]*)"$/m],
])("%s downloads from CLI_RELEASE_REPOSITORY", (file, pattern) => {
  const source = NodeFS.readFileSync(NodePath.join(import.meta.dirname, file), "utf8");
  expect(pattern.exec(source)?.[1]).toBe(CLI_RELEASE_REPOSITORY ?? "");
});
