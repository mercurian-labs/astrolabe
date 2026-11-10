import {
  OrchestratorMcpFailure,
  type WikiAgentTransform,
  WikiChangeRequestId,
  type WikiError,
  WikiId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";

import * as ServerConfig from "../../../config.ts";
import { withCanvasOutlines } from "../../../wiki/wikiViews.ts";
import { checkoutOwner } from "../../../wiki/ThreadWikiCheckouts.ts";
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

/**
 * The wiki service and who is calling: the thread an agent runs in, and its model as actor. A
 * child working in a thread's checkout of `wiki` acts for that thread on it.
 */
const access = Effect.fn("WikiToolkit.access")(function* (wiki: string) {
  const { scope, caller } = yield* readCaller();
  const wikis = yield* WikiService.WikiService;
  const owner = checkoutOwner(
    yield* Path.Path,
    (yield* ServerConfig.ServerConfig).stateDir,
    caller?.worktreePath ?? null,
  );
  const ownWiki =
    owner === undefined || caller === undefined
      ? false
      : yield* wikis.linkedWiki(caller.projectId, wiki.trim()).pipe(
          Effect.map((wikiId) => wikiId === owner.wikiId),
          Effect.orElseSucceed(() => false),
        );
  return {
    wikis,
    threadId: ownWiki ? owner?.threadId : scope.thread?.threadId,
    actor: caller?.modelSelection.model ?? "Agent",
  };
});

const read = <A>(
  wiki: string,
  body: (
    wikis: WikiService.WikiService["Service"],
    threadId: WikiService.WikiReadTarget["threadId"],
  ) => Effect.Effect<A, WikiError>,
) =>
  access(wiki).pipe(
    Effect.flatMap(({ wikis, threadId }) =>
      body(wikis, threadId).pipe(Effect.mapError(wikiFailure)),
    ),
  );

const write = <A>(
  wiki: string,
  body: (
    wikis: WikiService.WikiService["Service"],
    author: WikiService.WikiAuthor,
  ) => Effect.Effect<A, WikiError>,
) =>
  access(wiki).pipe(
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

/** A commit message for a transform that lands now without one. */
const subjectOf = (transform: WikiAgentTransform) =>
  transform.kind === "rename"
    ? `Move ${transform.from.trim()} to ${transform.to.trim()}`
    : transform.kind === "canvas"
      ? `Change ${transform.file.trim()}`
      : `Change ${transform.map}`;

export const layer = McpToolAccess.toLayer(WikiToolkit, {
  // Reads see the calling thread's checkout as it stands, unsaved edits included.
  astrolabe_wiki_orient: McpToolAccess.reads((input) =>
    read(input.wiki, (wikis, threadId) =>
      wikis.orient({ ...target(input), map: input.map.trim(), threadId, checkout: true }),
    ),
  ),
  astrolabe_wiki_links: McpToolAccess.reads((input) =>
    read(input.wiki, (wikis, threadId) =>
      wikis.links({ ...target(input), threadId, checkout: true }),
    ),
  ),
  astrolabe_wiki_query: McpToolAccess.reads(({ base, view, ...input }) =>
    read(input.wiki, (wikis, threadId) =>
      wikis
        .query({
          ...target(input),
          base: base.trim(),
          ...(view === undefined ? {} : { view: view.trim() }),
          threadId,
          checkout: true,
        })
        // The property picker's list is for the app; an agent reads the base's YAML instead.
        .pipe(Effect.map(({ properties: _properties, ...result }) => result)),
    ),
  ),
  astrolabe_wiki_change_request: McpToolAccess.reads((input) =>
    read(input.wiki, (wikis, threadId) =>
      wikis
        .changeRequestsGet({ ...target(input), threadId, checkout: true })
        .pipe(Effect.map(withCanvasOutlines)),
    ),
  ),
  // Changes belong to the calling thread's checkout or change request; only a live thread may write.
  astrolabe_wiki_transform: McpToolAccess.actsAsCaller(({ message, title, ...input }) =>
    write(input.wiki, (wikis, author) =>
      wikis.transformCheckout(
        {
          ...target(input),
          message: message?.trim() || subjectOf(input.transform),
          ...(title === undefined ? {} : { title: title.trim() }),
        },
        author,
      ),
    ),
  ),
  // For a session whose file tools can't reach its checkout: files there, never commits.
  astrolabe_wiki_read: McpToolAccess.reads((input) =>
    read(input.wiki, (wikis, threadId) =>
      wikis.checkoutRead({ ...target(input), path: input.path.trim(), threadId }),
    ),
  ),
  astrolabe_wiki_search: McpToolAccess.reads((input) =>
    read(input.wiki, (wikis, threadId) =>
      wikis.checkoutSearch({ ...target(input), query: input.query.trim(), threadId }),
    ),
  ),
  astrolabe_wiki_write: McpToolAccess.actsAsCaller((input) =>
    write(input.wiki, (wikis, author) =>
      wikis.checkoutWrite({ ...target(input), path: input.path.trim() }, author),
    ),
  ),
});
