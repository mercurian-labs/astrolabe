import { describe, expect, it } from "@effect/vitest";
import { CodeIndexError, ProjectId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import type { CodeIndex } from "../codeIndex/CodeIndex.ts";
import type { LanguageServers } from "./LanguageServers.ts";
import { searchProjectSymbols } from "./projectSymbols.ts";

const SERVED = {
  name: "add",
  kind: "function",
  container: null,
  path: "src/add.ts",
  line: 3,
  column: 10,
};
const INDEXED = {
  id: "src/add.ts#add",
  name: "add",
  kind: "function" as const,
  path: "src/add.ts",
  line: 3,
  endLine: 5,
  parent: null,
  signature: null,
  exported: true,
};

const servers = (symbols: ReadonlyArray<typeof SERVED>) =>
  ({
    projectSymbols: () => Effect.succeed({ symbols, truncated: false }),
  }) as unknown as LanguageServers["Service"];

const index = (symbols: Effect.Effect<any, CodeIndexError>) =>
  ({ symbols: () => symbols }) as unknown as CodeIndex["Service"];

const input = { cwd: "/repo", projectId: ProjectId.make("project"), query: "ad" };

describe("searchProjectSymbols", () => {
  it.effect("takes a running server's answer over the index", () =>
    Effect.gen(function* () {
      const found = yield* searchProjectSymbols(
        servers([SERVED]),
        index(Effect.die("not asked")),
        input,
      );
      expect(found.symbols).toEqual([SERVED]);
    }),
  );

  it.effect("falls back to the index, leaving out what no tab can open", () =>
    Effect.gen(function* () {
      const found = yield* searchProjectSymbols(
        servers([]),
        index(
          Effect.succeed({
            symbols: [INDEXED, { ...INDEXED, path: "../other/add.ts" }],
            truncated: true,
          }),
        ),
        input,
      );
      expect(found).toEqual({
        symbols: [{ ...SERVED, column: 1 }],
        truncated: true,
      });
    }),
  );

  it.effect("answers nothing when there is no index to ask", () =>
    Effect.gen(function* () {
      const failed = new CodeIndexError({ reason: "off", message: "off" });
      const off = yield* searchProjectSymbols(servers([]), index(Effect.fail(failed)), input);
      expect(off.symbols).toEqual([]);
      const { projectId: _noProject, ...folder } = input;
      const wiki = yield* searchProjectSymbols(servers([]), index(Effect.die("not asked")), folder);
      expect(wiki.symbols).toEqual([]);
    }),
  );
});
