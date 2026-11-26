import { assert, it } from "@effect/vitest";
import {
  canvasDocument,
  canvasFrame,
  canvasFrameCards,
  parseCanvas,
  placeCanvas,
} from "@mercurian/wiki";
import {
  type CanvasShowInput,
  parseRootAddress,
  ProjectId,
  type ProjectRootCheckout,
  projectRootId,
  ProjectRootWriteTargetError,
  RootKey,
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
import * as ProjectRoots from "../workspace/ProjectRoots.ts";
import * as CanvasKeep from "./CanvasKeep.ts";
import * as WikiService from "./WikiService.ts";

const PROJECT = ProjectId.make("project-a");
const THREAD = ThreadId.make("thread-a");
const ITEM = TurnItemId.make("item-a");
const LOCAL = "b".repeat(40);
const PUSHED = "a".repeat(40);
const API_COMMIT = "c".repeat(40);
const GITHUB = {
  canonicalKey: "github.com/acme/app",
  provider: "github",
  locator: { source: "git-remote", remoteName: "origin", remoteUrl: "git@github.com:acme/app.git" },
};
const API_GITHUB = {
  canonicalKey: "github.com/acme/api",
  provider: "github",
  locator: { source: "git-remote", remoteName: "origin", remoteUrl: "git@github.com:acme/api.git" },
};

const root = (
  key: string,
  path: string,
  overrides: Partial<ProjectRootCheckout> = {},
): ProjectRootCheckout => ({
  key: RootKey.make(key),
  name: key,
  path,
  kind: key === "app" ? "workspace" : "tracked",
  state: "git",
  hostBacked: true,
  checkout: path,
  writable: true,
  ...overrides,
});
const APP = root("app", "/repo");
const API = root("api", "/api");

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
  readonly repository?: string;
  readonly item?: unknown;
  /** Other items of the thread, by id: a call's recorded board. */
  readonly items?: Readonly<Record<string, unknown>>;
  readonly commit?: string | null;
  /** Each folder's identity, by its path. */
  readonly identities?: Readonly<Record<string, unknown>>;
  readonly identity?: unknown;
  readonly pushed?: string | null;
  /** Files at the pushed commit, by folder and then path. */
  readonly files?: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly comment?: string;
  readonly author?: WikiService.WikiAuthor;
  /** The project's folders as a thread with each worktree (or none, by "") has them. */
  readonly roots?: Readonly<Record<string, ReadonlyArray<ProjectRootCheckout>>>;
  /** Threads' worktrees, by id; a thread not named has the live checkouts. */
  readonly worktrees?: Readonly<Record<string, string>>;
  /** The branch the live checkout has out. */
  readonly head?: string;
  readonly noTarget?: boolean;
}

const keep = (world: World) => {
  const transforms: WikiTransformInput[] = [];
  const onDisk: WikiTransformInput[] = [];
  const authors: WikiService.WikiAuthor[] = [];
  const remotes: string[] = [];
  const targets: Array<Parameters<ProjectRoots.ProjectRoots["Service"]["writeTarget"]>[0]> = [];
  const { commit = LOCAL, identity = GITHUB, pushed = LOCAL, files, head = "main" } = world;
  const rootsFor = (worktreePath: string | null) =>
    world.roots?.[worktreePath ?? ""] ?? world.roots?.[""] ?? [APP];
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
          getThreadShell: (threadId) =>
            Effect.succeed({
              projectId: PROJECT,
              worktreePath: world.worktrees?.[threadId] ?? null,
            } as never),
        }),
        Layer.mock(ProjectService.ProjectService)({
          // A project's identity fills in behind reads, so a read can miss it.
          getById: () =>
            Effect.succeedSome({ workspaceRoot: "/repo", repositoryIdentity: null } as never),
          readRepositoryIdentity: ({ workspaceRoot }) =>
            Effect.succeed(
              (world.identities === undefined
                ? identity
                : (world.identities[workspaceRoot] ?? null)) as never,
            ),
        }),
        Layer.mock(GitVcsDriver.GitVcsDriver)({
          nearestPushedCommit: ({ remoteName, commit: at }) => {
            remotes.push(remoteName);
            return Effect.succeed(world.identities === undefined ? pushed : at);
          },
          readFileAtCommit: ({ cwd, path }) =>
            Effect.succeed((files?.[cwd] ?? { "src/a.ts": "one\ntwo\nthree\n" })[path] ?? null),
          execute: () => Effect.succeed({ stdout: `${head}\n` } as never),
          resolveDefaultBranchName: () => Effect.succeed("main"),
        }),
        Layer.mock(ProjectRoots.ProjectRoots)({
          host: () => Effect.succeed({ remote: "origin", kind: "github" } as never),
          forThread: ({ worktreePath }) => Effect.succeed(rootsFor(worktreePath)),
          resolveAll: ({ worktreePath, addresses }) => {
            const roots = rootsFor(worktreePath);
            return Effect.succeed({
              roots,
              paths: addresses.map((address) => {
                const parsed = parseRootAddress(
                  address,
                  roots.map((each) => each.key),
                );
                const found = roots.find((each) => each.key === parsed.root) ?? roots[0]!;
                return { root: found, path: parsed.path, anchor: null, absolutePath: null };
              }),
            });
          },
          writeTarget: (input) => {
            targets.push(input);
            const roots = rootsFor(input.worktreePath);
            const parsed = parseRootAddress(
              input.address ?? "",
              roots.map((each) => each.key),
            );
            const found =
              roots.find((each) => each.key === (parsed.root ?? input.repository)) ??
              (roots.length === 1 ? roots[0] : undefined);
            return found === undefined || world.noTarget === true
              ? Effect.fail(
                  new ProjectRootWriteTargetError({
                    detail: "Choose which folder the new file goes in.",
                    candidates: roots.map((each) => each.key),
                  }),
                )
              : Effect.succeed({ root: found, path: parsed.path });
          },
        }),
        Layer.mock(WikiService.WikiService)({
          transform: (input, author) => {
            transforms.push(input);
            authors.push(author);
            return Effect.succeed({
              changeRequest: { changeRequestId: "cr-1" },
            } as unknown as WikiAmendResult);
          },
          transformCheckout: (input, author) => {
            onDisk.push(input);
            authors.push(author);
            return Effect.succeed({ written: [], removed: [], errors: [] });
          },
        }),
      ),
    ),
  );
  return CanvasKeep.CanvasKeep.pipe(
    Effect.flatMap((service) =>
      service.keep(
        {
          projectId: PROJECT,
          ...(world.repository === undefined ? {} : { repository: world.repository }),
          threadId: THREAD,
          itemId: ITEM,
          name: world.name ?? "The merge",
          ...(world.comment === undefined ? {} : { comment: world.comment }),
        },
        world.author ?? WikiService.person,
      ),
    ),
    Effect.provide(layer),
    Effect.map((result) => {
      const transform = (transforms[0] ?? onDisk[0])?.transform;
      const source = transform?.kind === "canvas-create" ? (transform.source ?? "") : "";
      return { result, source, transforms, onDisk, authors, remotes, targets };
    }),
  );
};

const nodeWith = (source: string, text: string) => {
  const nodes = JSON.parse(source).nodes as ReadonlyArray<Record<string, unknown>>;
  const node = nodes.find((each) => JSON.stringify(each).includes(text));
  assert.isDefined(node);
  return node as Record<string, unknown>;
};

it.effect("keeps a board in the folder its name gives, refusing what no folder can hold", () =>
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
    assert.equal(result.rootKey, "app");
    assert.deepEqual(result.notes, []);
    assert.equal(transforms[0]?.title, "Keep The merge");
    assert.equal(transforms[0]?.wikiId, WikiId.make(projectRootId(PROJECT, RootKey.make("app"))));
    assert.isUndefined(transforms[0]?.changeRequestId);
    assert.deepEqual(authors, [WikiService.person]);
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

it.effect("keeps a board an older thread drew with stories as its board and frames alone", () =>
  Effect.gen(function* () {
    // Drawn before stories were retired: the call still holds them, and keeping it drops them.
    const walk = {
      title: "Walk",
      cards: [
        { id: "a", text: "Alpha", group: "g" },
        { id: "b", text: "Beta" },
      ],
      groups: [{ id: "g", label: "Start" }],
      stories: [{ title: "Forwards", steps: [{ note: "First", group: "g" }] }],
    } as CanvasShowInput;
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
    assert.notProperty(JSON.parse(source), "astrolabe");
    const frame = canvasFrame(parsed.data, "start");
    assert.isDefined(frame);
    if (frame === undefined) return;
    const texts = new Map(
      parsed.data.nodes.map((node) => [node.id, node.type === "text" ? node.text : ""]),
    );
    assert.deepEqual(
      [...canvasFrameCards(parsed.data, frame)].map((id) => texts.get(id)),
      ["Alpha"],
    );
  }),
);

it.effect("writes an agent's keep in its own thread's checkout, with the comment", () =>
  Effect.gen(function* () {
    const author = { actor: "claude-opus-5-5", threadId: ThreadId.make("thread-agent") };
    const { result, transforms, onDisk, authors, targets } = yield* keep({
      comment: "For the review",
      author,
      worktrees: { "thread-agent": "/wt/agent" },
      roots: { "/wt/agent": [{ ...APP, checkout: "/wt/agent" }] },
    });
    assert.lengthOf(transforms, 0);
    assert.equal(onDisk[0]?.message, "For the review");
    assert.equal(onDisk[0]?.title, "Keep The merge");
    assert.equal(onDisk[0]?.checkout, "/wt/agent");
    assert.deepEqual(authors, [author]);
    assert.equal(targets[0]?.worktreePath, "/wt/agent");
    assert.isNull(result.changeRequest);
    assert.equal(result.checkout, "/wt/agent");
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
    const { source } = yield* keep({ files: { "/repo": { "src/a.ts": "only one line" } } });
    const card = nodeWith(source, "src/a.ts");
    assert.equal(card.url, `https://github.com/acme/app/blob/${LOCAL}/src/a.ts`);
    assert.notProperty(card.astrolabe as object, "lines");
  }),
);

const TEXT_CARDS: ReadonlyArray<readonly [string, World, string]> = [
  [
    "the file isn't at the pushed commit",
    { files: { "/repo": {} } },
    "the file isn't in the nearest pushed",
  ],
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

const TWO_ROOTS = { "": [APP, API] } as const;
const twoRootDrawing: CanvasShowInput = {
  title: "Both",
  cards: [
    { id: "web", path: "src/index.ts", text: "App entry" },
    { id: "server", path: "api:src/index.ts", text: "API entry" },
  ],
};
const twoRoots = (item: unknown, items?: Readonly<Record<string, unknown>>) =>
  keep({
    name: "api:Both",
    roots: TWO_ROOTS,
    identities: { "/repo": GITHUB, "/api": API_GITHUB },
    files: {
      "/repo": { "src/index.ts": "export {};\n" },
      "/api": { "src/index.ts": "export {};\n" },
    },
    item,
    ...(items === undefined ? {} : { items }),
  });

it.effect("pins each code card to its own folder's remote and commit, the same path in both", () =>
  Effect.gen(function* () {
    const { result, source, targets } = yield* twoRoots({
      type: "dynamic_tool",
      status: "completed",
      toolName: "mcp__t3-code__astrolabe_canvas_show",
      input: twoRootDrawing,
      output: {
        structuredContent: {
          message: "Shown",
          code: { commit: LOCAL },
          codes: { app: { commit: LOCAL }, api: { commit: API_COMMIT } },
        },
      },
    });
    assert.equal(result.rootKey, "api");
    assert.equal(result.file, "Both.canvas");
    assert.equal(targets[0]?.address, "api:Both");
    assert.deepEqual(result.notes, []);
    assert.deepEqual(nodeWith(source, "App entry").astrolabe, {
      repository: "github.com/acme/app",
      commit: LOCAL,
      path: "src/index.ts",
      caption: "App entry",
    });
    assert.equal(
      nodeWith(source, "App entry").url,
      `https://github.com/acme/app/blob/${LOCAL}/src/index.ts`,
    );
    assert.deepEqual(nodeWith(source, "API entry").astrolabe, {
      repository: "github.com/acme/api",
      commit: API_COMMIT,
      path: "src/index.ts",
      caption: "API entry",
    });
    assert.equal(
      nodeWith(source, "API entry").url,
      `https://github.com/acme/api/blob/${API_COMMIT}/src/index.ts`,
    );
  }),
);

it.effect("reads a recorded board's folder from each card, and an older call's lone code", () =>
  Effect.gen(function* () {
    const recorded = canvasDocument(placeCanvas(twoRootDrawing));
    const document = {
      ...recorded,
      nodes: recorded.nodes.map((node) =>
        node.id === "server"
          ? {
              ...node,
              astrolabe: { caption: "API entry", code: { root: "api", path: "src/index.ts" } },
            }
          : node,
      ),
    };
    const { source, result } = yield* twoRoots(
      {
        type: "dynamic_tool",
        status: "completed",
        toolName: "mcp__t3-code__astrolabe_canvas_show",
        input: twoRootDrawing,
        // Drawn before `codes`: only the project folder's commit is known.
        output: { structuredContent: { message: "Shown", canvasItemId: "turn-item:canvas:2" } },
      },
      {
        "turn-item:canvas:2": {
          type: "canvas",
          status: "completed",
          title: "Both",
          document,
          code: { commit: LOCAL },
        },
      },
    );
    assert.equal(nodeWith(source, "App entry").type, "link");
    const api = nodeWith(source, "API entry");
    assert.equal(api.type, "text");
    assert.include(api.text as string, "`api:src/index.ts`");
    assert.deepEqual(result.notes, [
      "1 code card became text: no commit of theirs has been pushed.",
    ]);
  }),
);

it.effect("asks which folder when nothing picks one, naming those it could write", () =>
  Effect.gen(function* () {
    const failure = yield* Effect.flip(keep({ roots: TWO_ROOTS }));
    assert.equal(failure.reason, "invalid");
    assert.include(failure.message, "Name one as repository: app, api.");

    const { targets, result } = yield* keep({ roots: TWO_ROOTS, repository: "api" });
    assert.deepEqual(targets[0], {
      projectId: PROJECT,
      worktreePath: null,
      address: "The merge",
      repository: "api",
    });
    assert.equal(result.rootKey, "api");
  }),
);

it.effect("writes a person's keep in the thread's own worktree of the folder", () =>
  Effect.gen(function* () {
    const { result, transforms, onDisk } = yield* keep({
      worktrees: { [THREAD]: "/wt/1" },
      roots: { "": [APP], "/wt/1": [{ ...APP, checkout: "/wt/1" }] },
    });
    assert.lengthOf(transforms, 0);
    assert.equal(onDisk[0]?.checkout, "/wt/1");
    assert.equal(result.checkout, "/wt/1");
  }),
);

const OUTSIDE: ReadonlyArray<readonly [string, World, string | null]> = [
  ["a hosted repository's main checkout on its default branch", {}, null],
  ["a repository with no host", { roots: { "": [{ ...APP, hostBacked: false }] } }, "/repo"],
  [
    "a folder without Git",
    { roots: { "": [{ ...APP, state: "plain", hostBacked: false }] } },
    "/repo",
  ],
  ["a hosted main checkout on another branch", { head: "feature" }, "/repo"],
  [
    "a folder the thread's worktrees leave out",
    {
      worktrees: { [THREAD]: "/wt/1" },
      roots: { "": [APP], "/wt/1": [{ ...APP, checkout: null, writable: false }] },
    },
    null,
  ],
];

it.effect.each(OUTSIDE)("keeps a person's board from %s by ruling 5", ([, world, disk]) =>
  Effect.gen(function* () {
    const { result, transforms, onDisk } = yield* keep(world);
    if (disk === null) {
      assert.lengthOf(onDisk, 0);
      assert.lengthOf(transforms, 1);
      assert.isNotNull(result.changeRequest);
      assert.notProperty(result, "checkout");
    } else {
      assert.lengthOf(transforms, 0);
      assert.equal(onDisk[0]?.checkout, disk);
      assert.isNull(result.changeRequest);
      assert.equal(result.checkout, disk);
    }
  }),
);
