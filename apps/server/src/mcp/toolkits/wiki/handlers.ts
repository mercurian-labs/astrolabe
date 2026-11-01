import { OrchestratorMcpFailure, type WikiError, WikiId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as WikiService from "../../../wiki/WikiService.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { readCaller } from "../../threadAccess.ts";
import { WikiToolkit } from "./tools.ts";

// Wiki errors carry fixed or validation messages written for the author, so they pass through.
const wikiFailure = (error: WikiError) =>
  new OrchestratorMcpFailure({
    code:
      error.reason === "git-failed" || error.reason === "git-unavailable"
        ? "orchestration_error"
        : "invalid_request",
    message: error.message,
  });

/** The wiki service and who is calling: the thread an agent runs in, and its model as actor. */
const access = Effect.gen(function* () {
  const { scope, caller } = yield* readCaller();
  return {
    wikis: yield* WikiService.WikiService,
    threadId: scope.thread?.threadId,
    actor: caller?.modelSelection.model ?? "Agent",
  };
});

const read = <A>(
  body: (
    wikis: WikiService.WikiService["Service"],
    threadId: WikiService.WikiReadTarget["threadId"],
  ) => Effect.Effect<A, WikiError>,
) =>
  access.pipe(
    Effect.flatMap(({ wikis, threadId }) =>
      body(wikis, threadId).pipe(Effect.mapError(wikiFailure)),
    ),
  );

const write = <A>(
  body: (
    wikis: WikiService.WikiService["Service"],
    author: WikiService.WikiAuthor,
  ) => Effect.Effect<A, WikiError>,
) =>
  access.pipe(
    Effect.flatMap(({ wikis, threadId, actor }) =>
      body(wikis, { actor, threadId: threadId ?? null }).pipe(Effect.mapError(wikiFailure)),
    ),
  );

export const layer = McpToolAccess.toLayer(WikiToolkit, {
  astrolabe_wiki_list: McpToolAccess.reads(() => read((wikis) => wikis.list)),
  astrolabe_wiki_read: McpToolAccess.reads(({ wiki, ...input }) =>
    read((wikis, threadId) => wikis.readNote({ ...input, wikiId: WikiId.make(wiki), threadId })),
  ),
  astrolabe_wiki_search: McpToolAccess.reads(({ wiki, ...input }) =>
    read((wikis, threadId) => wikis.search({ ...input, wikiId: WikiId.make(wiki), threadId })),
  ),
  astrolabe_wiki_orient: McpToolAccess.reads(({ wiki, ...input }) =>
    read((wikis, threadId) => wikis.orient({ ...input, wikiId: WikiId.make(wiki), threadId })),
  ),
  astrolabe_wiki_links: McpToolAccess.reads(({ wiki, ...input }) =>
    read((wikis, threadId) => wikis.links({ ...input, wikiId: WikiId.make(wiki), threadId })),
  ),
  astrolabe_wiki_change_request: McpToolAccess.reads(({ wiki, changeRequestId }) =>
    read((wikis, threadId) =>
      wikis.changeRequestsGet({ wikiId: WikiId.make(wiki), changeRequestId, threadId }),
    ),
  ),
  // Amendments belong to the calling thread's change request; only a live thread may write.
  astrolabe_wiki_amend: McpToolAccess.actsAsCaller(({ wiki, ...input }) =>
    write((wikis, author) => wikis.amend({ ...input, wikiId: WikiId.make(wiki) }, author)),
  ),
  astrolabe_wiki_transform: McpToolAccess.actsAsCaller(({ wiki, ...input }) =>
    write((wikis, author) => wikis.transform({ ...input, wikiId: WikiId.make(wiki) }, author)),
  ),
});
