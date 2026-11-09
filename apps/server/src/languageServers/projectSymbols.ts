import type { ProjectSymbols, ProjectSymbolsInput } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import type { CodeIndex } from "../codeIndex/CodeIndex.ts";
import type { LanguageServers } from "./LanguageServers.ts";

/**
 * Names across a checkout: what its running servers know, which is exact and current, or with
 * none of them, or nothing from them, what the code index has parsed. An index that isn't there
 * (turned off, still building, a wiki's folder) is an empty answer, not a failure.
 */
export const searchProjectSymbols = Effect.fn("LanguageServers.searchProjectSymbols")(function* (
  languageServers: LanguageServers["Service"],
  codeIndex: CodeIndex["Service"],
  input: ProjectSymbolsInput,
) {
  const served = yield* languageServers.projectSymbols(input);
  if (served.symbols.length > 0 || input.projectId === undefined) return served;
  const { projectId, cwd, query } = input;
  return yield* codeIndex.symbols({ projectId, cwd, query }).pipe(
    Effect.map(({ symbols, truncated }): ProjectSymbols => ({
      symbols: symbols.flatMap((symbol) =>
        // Above a checkout that is a folder of its repository: no tab can open it.
        symbol.path.startsWith("../")
          ? []
          : [
              {
                name: symbol.name,
                kind: symbol.kind,
                container: symbol.parent,
                path: symbol.path,
                line: symbol.line,
                column: 1,
              },
            ],
      ),
      truncated,
    })),
    Effect.orElseSucceed(() => served),
  );
});
