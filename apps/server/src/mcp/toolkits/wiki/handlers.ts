import {
  OrchestratorMcpFailure,
  WikiChangeRequestId,
  type WikiError,
  WikiId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { withCanvasOutlines } from "../../../wiki/wikiViews.ts";
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

// The tool schemas take plain strings, whose descriptions reach agents; the service gets them trimmed.
const target = <
  I extends { readonly wiki: string; readonly changeRequestId?: string | undefined },
>({
  wiki,
  changeRequestId,
  ...rest
}: I) => ({
  ...rest,
  wikiId: WikiId.make(wiki.trim()),
  ...(changeRequestId === undefined
    ? {}
    : { changeRequestId: WikiChangeRequestId.make(changeRequestId.trim()) }),
});

const written = <I extends { readonly message: string; readonly title?: string | undefined }>(
  input: I,
) => ({
  ...input,
  message: input.message.trim(),
  ...(input.title === undefined ? {} : { title: input.title.trim() }),
});

export const layer = McpToolAccess.toLayer(WikiToolkit, {
  astrolabe_wiki_list: McpToolAccess.reads(() =>
    read((wikis) =>
      wikis.list.pipe(
        // Tile addresses can hold access tokens, and agents have no use for them.
        Effect.map(({ wikis }) => ({
          wikis: wikis.map(({ mapBackgrounds: _, ...wiki }) => wiki),
        })),
      ),
    ),
  ),
  astrolabe_wiki_read: McpToolAccess.reads((input) =>
    read((wikis, threadId) =>
      wikis.readNote({ ...target(input), name: input.name.trim(), threadId }),
    ),
  ),
  astrolabe_wiki_search: McpToolAccess.reads((input) =>
    read((wikis, threadId) => wikis.search({ ...target(input), threadId })),
  ),
  astrolabe_wiki_orient: McpToolAccess.reads((input) =>
    read((wikis, threadId) => wikis.orient({ ...target(input), map: input.map.trim(), threadId })),
  ),
  astrolabe_wiki_links: McpToolAccess.reads((input) =>
    read((wikis, threadId) => wikis.links({ ...target(input), threadId })),
  ),
  astrolabe_wiki_query: McpToolAccess.reads(({ base, view, ...input }) =>
    read((wikis, threadId) =>
      wikis
        .query({
          ...target(input),
          base: base.trim(),
          ...(view === undefined ? {} : { view: view.trim() }),
          threadId,
        })
        // The property picker's list is for the app; an agent reads the base's YAML instead.
        .pipe(Effect.map(({ properties: _properties, ...result }) => result)),
    ),
  ),
  astrolabe_wiki_change_request: McpToolAccess.reads((input) =>
    read((wikis, threadId) =>
      wikis.changeRequestsGet({ ...target(input), threadId }).pipe(Effect.map(withCanvasOutlines)),
    ),
  ),
  // Amendments belong to the calling thread's change request; only a live thread may write.
  astrolabe_wiki_amend: McpToolAccess.actsAsCaller((input) =>
    write((wikis, author) => wikis.amend(written(target(input)), author)),
  ),
  astrolabe_wiki_transform: McpToolAccess.actsAsCaller((input) =>
    write((wikis, author) => wikis.transform(written(target(input)), author)),
  ),
});
