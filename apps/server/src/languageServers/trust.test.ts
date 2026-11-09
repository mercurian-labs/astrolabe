import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

import { makeProjectTrust } from "./trust.ts";

const setup = Effect.fn("setup")(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-lsp-trust-" });
  const file = `${root}/caches/trust.json`;
  const open = makeProjectTrust({
    file,
    // Two folders of one repository, and one folder without git.
    repositoryOf: (cwd) => Effect.succeed(cwd === root ? null : `${root}/.git`),
  });
  return { root, file, open };
});

describe("project trust", () => {
  it.effect("remembers a project across restarts until it is revoked", () =>
    Effect.gen(function* () {
      const { root, open } = yield* setup();
      const first = yield* open;
      expect(yield* first.isTrusted("/a")).toBe(false);
      yield* first.set("/a", true);
      expect(yield* first.isTrusted("/worktree-of-a")).toBe(true);
      expect(yield* first.isTrusted(root)).toBe(false);
      const second = yield* open;
      expect(yield* second.isTrusted("/a")).toBe(true);
      yield* second.set("/worktree-of-a", false);
      expect(yield* (yield* open).isTrusted("/a")).toBe(false);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("trusts nothing when its file can't be read", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const { root, file, open } = yield* setup();
      yield* fileSystem.makeDirectory(`${root}/caches`);
      yield* fileSystem.writeFileString(file, "{ not json");
      expect(yield* (yield* open).isTrusted("/a")).toBe(false);
      yield* fileSystem.writeFileString(file, '{"projects":"everything"}');
      expect(yield* (yield* open).isTrusted("/a")).toBe(false);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
