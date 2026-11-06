import { describe, expect, it } from "vitest";

import { languageServerForPath } from "./languageServers.ts";

describe("languageServerForPath", () => {
  it.each([
    ["src/app.ts", "typescript", "typescript"],
    ["config/deploy.yml", "yaml", "yaml"],
    ["package.json", "json", "json"],
    ["tsconfig.json", "json", "jsonc"],
    ["apps/web/tsconfig.app.json", "json", "jsonc"],
    [".vscode/settings.json", "json", "jsonc"],
    ["Dockerfile", "dockerfile", "dockerfile"],
    ["docker/Dockerfile.prod", "dockerfile", "dockerfile"],
    ["Containerfile", "dockerfile", "dockerfile"],
    ["web.dockerfile", "dockerfile", "dockerfile"],
    [".bashrc", "bash", "shellscript"],
    ["Gemfile", "ruby-lsp", "ruby"],
  ])("reads %s with %s as %s", (path, server, languageId) => {
    expect(languageServerForPath(path)).toEqual({ server, languageId });
  });

  it.each(["LICENSE", "Makefile", ".gitignore", "notes.txt", "dockerfiles/readme"])(
    "leaves %s alone",
    (path) => {
      expect(languageServerForPath(path)).toBeNull();
    },
  );
});
