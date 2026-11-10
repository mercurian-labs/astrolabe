import { assert, it } from "@effect/vitest";
import { canvasDocument, canvasSteps, parseCanvas, placeCanvas } from "@mercurian/wiki";
import {
  type CanvasShowInput,
  ThreadId,
  TurnItemId,
  type WikiAmendResult,
  type WikiError,
  WikiId,
  type WikiTransformInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as CanvasKeep from "./CanvasKeep.ts";
import * as WikiService from "./WikiService.ts";

const THREAD = ThreadId.make("thread-a");
const WIKI = WikiId.make("wiki-a");
const ITEM = TurnItemId.make("item-a");
const LOCAL = "b".repeat(40);
const PUSHED = "a".repeat(40);
const GITHUB = {
  canonicalKey: "github.com/acme/app",
  provider: "github",
  locator: { source: "git-remote", remoteName: "origin", remoteUrl: "git@github.com:acme/app.git" },
};

const drawing: CanvasShowInput = {
  title: "The merge",
  cards: [
    { id: "a", text: "Starts here" },
    { id: "code", path: "src/a.ts", line: 2, endLine: 3, text: "The merge" },
    { id: "b", url: "https://example.com", text: "Docs" },
  ],
  arrows: [{ from: "a", to: "code" }],
  groups: [],
};

interface World {
  readonly name?: string;
  readonly item?: unknown;
  /** Other items of the thread, by id: a call's recorded board. */
  readonly items?: Readonly<Record<string, unknown>>;
  readonly commit?: string | null;
  readonly identity?: unknown;
  readonly pushed?: string | null;
  readonly files?: Readonly<Record<string, string>>;
  readonly comment?: string;
  readonly author?: WikiService.WikiAuthor;
}

const keep = (world: World) => {
  const transforms: WikiTransformInput[] = [];
  const authors: WikiService.WikiAuthor[] = [];
  const remotes: string[] = [];
  const { commit = LOCAL, identity = GITHUB, pushed = LOCAL, files } = world;
  const item = world.item ?? {
    type: "dynamic_tool",
    status: "completed",
    toolName: "mcp__t3-code__astrolabe_canvas_show",
    input: drawing,
    output: {
      structuredContent: { message: "Shown", ...(commit === null ? {} : { code: { commit } }) },
    },
  };
  const layer = CanvasKeep.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(Orchestrator.OrchestratorV2)({
          getTurnItem: ({ itemId }) => Effect.succeed((world.items?.[itemId] ?? item) as never),
          getThreadShell: () => Effect.succeed({ projectId: "project-a" } as never),
        }),
        Layer.mock(ProjectService.ProjectService)({
          // A project's identity fills in behind reads, so a read can miss it.
          getById: () =>
            Effect.succeedSome({ workspaceRoot: "/repo", repositoryIdentity: null } as never),
          readRepositoryIdentity: () => Effect.succeed(identity as never),
        }),
        Layer.mock(GitVcsDriver.GitVcsDriver)({
          nearestPushedCommit: ({ remoteName }) => {
            remotes.push(remoteName);
            return Effect.succeed(pushed);
          },
          readFileAtCommit: ({ path }) =>
            Effect.succeed((files ?? { "src/a.ts": "one\ntwo\nthree\n" })[path] ?? null),
        }),
        Layer.mock(WikiService.WikiService)({
          transform: (input, author) => {
            transforms.push(input);
            authors.push(author);
            return Effect.succeed({
              changeRequest: { changeRequestId: "cr-1" },
            } as unknown as WikiAmendResult);
          },
        }),
      ),
    ),
  );
  return CanvasKeep.CanvasKeep.pipe(
    Effect.flatMap((service) =>
      service.keep(
        {
          wikiId: WIKI,
          threadId: THREAD,
          itemId: ITEM,
          name: world.name ?? "The merge",
          ...(world.comment === undefined ? {} : { comment: world.comment }),
        },
        world.author ?? { actor: "You", threadId: THREAD },
      ),
    ),
    Effect.provide(layer),
    Effect.map((result) => {
      const transform = transforms[0]?.transform;
      const source = transform?.kind === "canvas-create" ? (transform.source ?? "") : "";
      return { result, source, transforms, authors, remotes };
    }),
  );
};

const nodeWith = (source: string, text: string) => {
  const nodes = JSON.parse(source).nodes as ReadonlyArray<Record<string, unknown>>;
  const node = nodes.find((each) => JSON.stringify(each).includes(text));
  assert.isDefined(node);
  return node as Record<string, unknown>;
};

it.effect("keeps a board in the folder its name gives, refusing what no wiki can hold", () =>
  Effect.gen(function* () {
    const { result, transforms } = yield* keep({ name: "/ops/deep/The merge" });
    assert.equal(result.file, "ops/deep/The merge.canvas");
    const transform = transforms[0]?.transform;
    assert.equal(transform?.kind === "canvas-create" ? transform.file : "", result.file);

    const refused = yield* Effect.flip(keep({ name: "../The merge" }));
    assert.equal(refused.reason, "invalid");
  }),
);

it.effect("lands a board as a new canvas, at the coordinates the thread showed", () =>
  Effect.gen(function* () {
    const { result, source, transforms, authors } = yield* keep({});
    assert.equal(result.file, "The merge.canvas");
    assert.deepEqual(result.notes, []);
    assert.equal(transforms[0]?.title, "Keep The merge");
    assert.equal(transforms[0]?.wikiId, WIKI);
    assert.isUndefined(transforms[0]?.changeRequestId);
    assert.deepEqual(authors, [{ actor: "You", threadId: THREAD }]);
    assert.equal(transforms[0]?.message, "Keep The merge");

    const shown = placeCanvas(drawing);
    const { nodes, edges } = JSON.parse(source);
    assert.deepEqual(
      nodes.map(({ x, y, width, height }: Record<string, number>) => [x, y, width, height]),
      shown.nodes.map(({ x, y, width, height }) => [x, y, width, height]),
    );
    for (const { id } of [...nodes, ...edges]) assert.match(id, /^[0-9a-f]{16}$/);
    assert.equal(edges[0].fromNode, nodes[0].id);
    assert.equal(edges[0].toNode, nodes[1].id);
    assert.equal(edges[0].fromSide, shown.edges[0]?.fromSide);
  }),
);

it.effect("keeps a recorded board where the thread drew it, even if the layout changed since", () =>
  Effect.gen(function* () {
    const recorded = canvasDocument(placeCanvas(drawing));
    const moved = {
      ...recorded,
      nodes: recorded.nodes.map((node) => ({ ...node, x: node.x + 1000 })),
    };
    const { result, source } = yield* keep({
      item: {
        type: "dynamic_tool",
        status: "completed",
        toolName: "mcp__t3-code__astrolabe_canvas_show",
        input: drawing,
        output: {
          structuredContent: { message: "Shown", canvasItemId: "turn-item:canvas:1" },
        },
      },
      items: {
        "turn-item:canvas:1": {
          type: "canvas",
          status: "completed",
          title: "The merge",
          document: moved,
          code: { commit: LOCAL },
        },
      },
    });
    assert.equal(result.file, "The merge.canvas");
    assert.deepEqual(
      JSON.parse(source).nodes.map(({ x }: { readonly x: number }) => x),
      moved.nodes.map(({ x }) => x),
    );
  }),
);

it.effect("keeps every story, naming its cards by their new ids", () =>
  Effect.gen(function* () {
    const walk: CanvasShowInput = {
      title: "Walk",
      cards: [
        { id: "a", text: "Alpha" },
        { id: "b", text: "Beta" },
        { id: "c", text: "Gamma" },
      ],
      stories: [
        {
          title: "Forwards",
          steps: [
            { note: "First", cards: ["a"] },
            { note: "Second", cards: ["b"] },
            { note: "Back to the start", cards: ["c", "a"] },
          ],
        },
        { title: "Backwards", steps: [{ label: "End", note: "Last", cards: ["c"] }] },
      ],
    };
    const { source } = yield* keep({
      item: {
        type: "dynamic_tool",
        status: "completed",
        toolName: "mcp__t3-code__astrolabe_canvas_show",
        input: walk,
        output: { structuredContent: { message: "Shown" } },
      },
    });
    const parsed = parseCanvas(source);
    assert.isTrue(parsed.ok);
    if (!parsed.ok) return;
    const texts = new Map(
      parsed.data.nodes.map((node) => [node.id, node.type === "text" ? node.text : ""]),
    );
    assert.deepEqual(
      canvasSteps(parsed.data).map((step) => [
        step.note,
        [...step.cards].map((id) => texts.get(id)).toSorted(),
      ]),
      [
        ["First", ["Alpha"]],
        ["Second", ["Beta"]],
        ["Back to the start", ["Alpha", "Gamma"]],
      ],
    );
    assert.deepEqual(
      canvasSteps(parsed.data, 1).map((step) => [
        step.label,
        [...step.cards].map((id) => texts.get(id)),
      ]),
      [["End", ["Gamma"]]],
    );
  }),
);

it.effect("carries the comment and lands as whoever kept it, in their thread", () =>
  Effect.gen(function* () {
    const author = { actor: "claude-opus-5-5", threadId: ThreadId.make("thread-agent") };
    const { transforms, authors } = yield* keep({ comment: "For the review", author });
    assert.equal(transforms[0]?.message, "For the review");
    assert.equal(transforms[0]?.title, "Keep The merge");
    assert.deepEqual(authors, [author]);
  }),
);

it.effect("writes a code card as a link pinned to the commit, read back as a code card", () =>
  Effect.gen(function* () {
    const { source } = yield* keep({});
    const card = nodeWith(source, "src/a.ts");
    assert.equal(card.type, "link");
    assert.equal(card.url, `https://github.com/acme/app/blob/${LOCAL}/src/a.ts#L2-L3`);
    assert.deepEqual(card.astrolabe, {
      repository: "github.com/acme/app",
      commit: LOCAL,
      path: "src/a.ts",
      lines: [2, 3],
      caption: "The merge",
    });
    const parsed = parseCanvas(source);
    assert.isTrue(parsed.ok);
    const node = parsed.ok ? parsed.data.nodes[1] : undefined;
    assert.deepEqual(node?.type === "link" ? node.astrolabe?.code : undefined, {
      path: "src/a.ts",
      lines: [2, 3],
      repository: "github.com/acme/app",
      commit: LOCAL,
    });
    assert.deepEqual(nodeWith(source, "example.com").astrolabe, { caption: "Docs" });
  }),
);

it.effect("links a fork's code to the fork, where its commits are, not the project it forked", () =>
  Effect.gen(function* () {
    const { source, remotes } = yield* keep({
      identity: {
        canonicalKey: "github.com/upstream/app",
        provider: "github",
        locator: {
          source: "git-remote",
          remoteName: "upstream",
          remoteUrl: "https://github.com/upstream/app.git",
        },
        origin: {
          canonicalKey: "github.com/acme/app",
          remoteUrl: "git@github.com:acme/app.git",
        },
      },
    });
    const card = nodeWith(source, "src/a.ts");
    assert.equal(card.url, `https://github.com/acme/app/blob/${LOCAL}/src/a.ts#L2-L3`);
    assert.deepEqual(remotes, ["origin"]);
    // Astrolabe still opens it in the project, which goes by the upstream's key.
    assert.equal((card.astrolabe as { repository: string }).repository, "github.com/upstream/app");
  }),
);

it.effect("pins unpushed code to the nearest pushed commit, and says so", () =>
  Effect.gen(function* () {
    const { result, source } = yield* keep({ pushed: PUSHED });
    assert.equal(
      nodeWith(source, "src/a.ts").url,
      `https://github.com/acme/app/blob/${PUSHED}/src/a.ts#L2-L3`,
    );
    assert.deepEqual(result.notes, [
      `1 code card points at unpushed code, so it links to the nearest pushed commit, ${PUSHED.slice(0, 12)}. The code there may differ.`,
    ]);
  }),
);

it.effect("drops lines the pinned file doesn't reach, and keeps the link", () =>
  Effect.gen(function* () {
    const { source } = yield* keep({ files: { "src/a.ts": "only one line" } });
    const card = nodeWith(source, "src/a.ts");
    assert.equal(card.url, `https://github.com/acme/app/blob/${LOCAL}/src/a.ts`);
    assert.notProperty(card.astrolabe as object, "lines");
  }),
);

const TEXT_CARDS: ReadonlyArray<readonly [string, World, string]> = [
  ["the file isn't at the pushed commit", { files: {} }, "the file isn't in the nearest pushed"],
  ["nothing was pushed", { pushed: null }, "no commit of theirs has been pushed"],
  ["the repository has no remote", { identity: null }, "no remote to link to"],
  ["the thread had no commit", { commit: null }, "no commit of theirs has been pushed"],
  [
    "the host has no file page",
    { identity: { ...GITHUB, canonicalKey: "git.acme.test/a/b", provider: "bitbucket" } },
    "this host has no link",
  ],
];

it.effect.each(TEXT_CARDS)("writes a text card when %s", ([, world, note]) =>
  Effect.gen(function* () {
    const { result, source } = yield* keep(world);
    const card = nodeWith(source, "src/a.ts");
    assert.equal(card.type, "text");
    assert.include(card.text as string, "The merge\n\n`src/a.ts:2-3`");
    assert.notProperty(card, "astrolabe");
    assert.lengthOf(result.notes, 1);
    assert.include(result.notes[0], note);
    if (world.commit !== null) {
      assert.include(card.text as string, ` at \`${LOCAL.slice(0, 12)}\``);
    }
  }),
);

it.effect("refuses what isn't a finished board of this thread", () =>
  Effect.gen(function* () {
    const finished = {
      type: "dynamic_tool",
      status: "completed",
      toolName: "astrolabe_canvas_show",
      input: drawing,
      output: {},
    };
    for (const item of [
      { ...finished, status: "running" },
      { ...finished, toolName: "html_render" },
      { ...finished, input: { title: "No cards" } },
      { type: "agent_message" },
    ]) {
      const failure: WikiError = yield* Effect.flip(keep({ item }));
      assert.equal(failure.reason, "not-found");
    }
  }),
);
