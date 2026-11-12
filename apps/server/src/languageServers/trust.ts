import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import { parseJson, stringifyJson } from "./json.ts";

/**
 * Which projects' language servers may run in full, on this environment. A project is its
 * repository, so a worktree of a trusted project is trusted; a folder without git is itself.
 */

const TrustFile = Schema.Struct({ projects: Schema.Array(Schema.String) });
const decode = Schema.decodeUnknownOption(TrustFile);

export const makeProjectTrust = Effect.fn("LanguageServers.makeProjectTrust")(function* (options: {
  readonly file: string;
  readonly repositoryOf: (cwd: string) => Effect.Effect<string | null>;
}) {
  const fileSystem = yield* FileSystem.FileSystem;
  // Anything unreadable trusts nothing: the worst it does is ask again.
  const stored = yield* fileSystem.readFileString(options.file).pipe(
    Effect.map((text) => decode(parseJson(text))),
    Effect.orElseSucceed(() => Option.none()),
  );
  const projects = new Set(Option.match(stored, { onNone: () => [], onSome: (s) => s.projects }));
  const writes = yield* Semaphore.make(1);

  const keyOf = Effect.fn("LanguageServers.trustKey")(function* (cwd: string) {
    const folder = (yield* options.repositoryOf(cwd)) ?? cwd;
    return yield* fileSystem.realPath(folder).pipe(Effect.orElseSucceed(() => folder));
  });

  const set = Effect.fn("LanguageServers.setTrust")(function* (cwd: string, trusted: boolean) {
    const key = yield* keyOf(cwd);
    yield* writes.withPermit(
      Effect.gen(function* () {
        const next = new Set(projects);
        if (trusted) next.add(key);
        else next.delete(key);
        yield* writeFileStringAtomically({
          filePath: options.file,
          contents: stringifyJson({ projects: [...next].toSorted() }),
        });
        if (trusted) projects.add(key);
        else projects.delete(key);
      }),
    );
  });

  return {
    keyOf,
    set,
    isTrusted: (cwd: string) => keyOf(cwd).pipe(Effect.map((key) => projects.has(key))),
  };
});
