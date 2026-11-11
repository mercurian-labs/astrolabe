import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { serializeCanvas } from "@mercurian/wiki";
import {
  type CanvasEdit,
  CommandId,
  ProjectId,
  ThreadId,
  type WikiChangeRequestId,
  type WikiError,
  WikiId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as TestClock from "effect/testing/TestClock";

import * as ServerConfig from "../config.ts";
import * as RuntimeLayer from "../orchestration-v2/runtimeLayer.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as ProjectEnrichmentService from "../project/ProjectEnrichmentService.ts";
import * as ProjectFaviconResolver from "../project/ProjectFaviconResolver.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as RepositoryIdentityResolver from "../project/RepositoryIdentityResolver.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import * as ThreadWikiCheckouts from "./ThreadWikiCheckouts.ts";
import * as WikiService from "./WikiService.ts";
import { WikiRegistryJson } from "./wikiStorage.ts";
import { withCanvasOutlines } from "./wikiViews.ts";

const CODE_REPOSITORY = {
  canonicalKey: "example.test/acme/code",
  locator: { source: "git-remote" as const, remoteName: "origin", remoteUrl: "git@example.test:a" },
};

const layerEnrichment = ProjectEnrichmentService.layer.pipe(
  Layer.provide(
    Layer.mergeAll(
      Layer.succeed(RepositoryIdentityResolver.RepositoryIdentityResolver, {
        // Only the folder a code card's test names sits in a repository with a remote.
        resolve: (cwd) => Effect.succeed(cwd.endsWith("/code") ? CODE_REPOSITORY : null),
      }),
      Layer.succeed(ProjectFaviconResolver.ProjectFaviconResolver, {
        resolvePath: () => Effect.succeed(null),
        invalidate: () => Effect.void,
      }),
    ),
  ),
);

/** The service over real git and a real (in-memory) project service, with its data at `baseDir`. */
const layer = (baseDir: string) =>
  WikiService.layer.pipe(
    Layer.provideMerge(RuntimeLayer.layerProjectService),
    Layer.provideMerge(layerEnrichment),
    Layer.provideMerge(WorkspacePaths.layer),
    Layer.provideMerge(GitVcsDriver.layer.pipe(Layer.provide(VcsProcess.layer))),
    Layer.provideMerge(SqlitePersistence.layerMemory),
    Layer.provideMerge(ServerSettings.layerTest()),
    Layer.provideMerge(ServerConfig.layerTest(baseDir, baseDir)),
    Layer.provideMerge(NodeServices.layer),
  );

interface Harness {
  readonly baseDir: string;
  /** A fresh folder outside the data dir. */
  readonly folder: (name: string) => Effect.Effect<string, never, FileSystem.FileSystem>;
}

const withWikis = <A, E>(
  body: (
    harness: Harness,
  ) => Effect.Effect<
    A,
    E,
    | WikiService.WikiService
    | ProjectService.ProjectService
    | ServerConfig.ServerConfig
    | NodeServices.NodeServices
    | Scope.Scope
  >,
) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const baseDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-wiki-base-" });
    const scratch = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-wiki-scratch-" });
    const folder = (name: string) =>
      fileSystem
        .makeDirectory(path.join(scratch, name))
        .pipe(
          Effect.orDie,
          Effect.andThen(fileSystem.realPath(path.join(scratch, name))),
          Effect.orDie,
        );
    return yield* body({ baseDir, folder }).pipe(Effect.provide(layer(baseDir)));
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

const git = (cwd: string, args: ReadonlyArray<string>, stdin?: string) =>
  ProcessRunner.ProcessRunner.pipe(
    Effect.flatMap((runner) =>
      runner.run({
        command: "git",
        args: [
          "-C",
          cwd,
          "-c",
          "user.name=Fixture",
          "-c",
          "user.email=fixture@example.com",
          ...args,
        ],
        ...(stdin === undefined ? {} : { stdin }),
      }),
    ),
    Effect.map((result) => result.stdout.trim()),
    Effect.provide(ProcessRunner.layer),
    Effect.orDie,
  );

/** What git itself makes of a command, as `merge-tree` answers with its exit code. */
const gitExit = (cwd: string, args: ReadonlyArray<string>) =>
  ProcessRunner.ProcessRunner.pipe(
    Effect.flatMap((runner) => runner.run({ command: "git", args: ["-C", cwd, ...args] })),
    Effect.map((result) => result.code),
    Effect.provide(ProcessRunner.layer),
    Effect.orDie,
  );

const write = (root: string, files: Readonly<Record<string, string>>) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    for (const [file, content] of Object.entries(files)) {
      const target = path.join(root, file);
      yield* fileSystem.makeDirectory(path.dirname(target), { recursive: true }).pipe(Effect.orDie);
      yield* fileSystem.writeFileString(target, content).pipe(Effect.orDie);
    }
  });

const read = (root: string, file: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    return yield* fileSystem.readFileString(path.join(root, file)).pipe(Effect.orDie);
  });

const MAP = [
  "---",
  "version: 1",
  "name: Product",
  "purpose: How the product fits together",
  "types:",
  "  needs: depends on",
  "edges:",
  "  - { from: Alpha, type: needs, to: Beta, rationale: Alpha builds on Beta }",
  "---",
  "",
  "Start at Alpha.",
  "",
].join("\n");

const FIXTURE = {
  "Alpha.md": "# Alpha\n\nAlpha builds on [[Beta]].\n",
  "Beta.md": "# Beta\n\nBeta stands alone.\n",
  "Product.skillmap.md": MAP,
};

/** A repository with the fixture notes committed on main, registered as a wiki. */
const registeredWiki = (harness: Harness, name = "vault") =>
  Effect.gen(function* () {
    const root = yield* harness.folder(name);
    yield* git(root, ["init", "--quiet", "--initial-branch=main"]);
    yield* write(root, FIXTURE);
    yield* git(root, ["add", "."]);
    yield* git(root, ["commit", "--quiet", "-m", "Notes"]);
    const wikis = yield* WikiService.WikiService;
    const summary = yield* wikis.register({ root });
    return { root, wikiId: summary.wikiId, summary, wikis };
  });

const agent = (thread: string): WikiService.WikiAuthor => ({
  actor: "test-model",
  threadId: ThreadId.make(thread),
});

const failure = <A, R>(effect: Effect.Effect<A, WikiError, R>) => Effect.flip(effect);

it.effect("registers only a repository's top-level folder, and makes no project of it", () =>
  withWikis((harness) =>
    Effect.gen(function* () {
      const wikis = yield* WikiService.WikiService;
      const plain = yield* harness.folder("plain");
      assert.equal((yield* failure(wikis.register({ root: plain }))).reason, "invalid");

      const { root, summary } = yield* registeredWiki(harness);
      assert.equal(summary.root, root);
      assert.equal(summary.mainBranch, "main");
      assert.deepEqual(summary.projectIds, []);
      const projects = yield* ProjectService.ProjectService;
      assert.isTrue(Option.isNone(yield* projects.getByWorkspaceRoot(root)));
      assert.equal(summary.openChangeRequests, 0);

      const path = yield* Path.Path;
      const nested = path.join(root, "nested");
      yield* (yield* FileSystem.FileSystem).makeDirectory(nested).pipe(Effect.orDie);
      assert.equal((yield* failure(wikis.register({ root: nested }))).reason, "invalid");
      assert.equal((yield* failure(wikis.register({ root }))).reason, "invalid");
      assert.deepEqual(
        (yield* wikis.list).wikis.map((wiki) => wiki.wikiId),
        [summary.wikiId],
      );
    }),
  ),
);

it.effect("links repositories, and tells their threads which wikis hold their plans", () =>
  withWikis((harness) =>
    Effect.gen(function* () {
      const { wikiId, summary, wikis } = yield* registeredWiki(harness);
      const repository = ProjectId.make("project-app");
      const other = ProjectId.make("project-other");
      const second = yield* wikis.create({ name: "Research" });
      const checkouts = [
        { wikiId, folder: "/state/wiki-checkouts/thread-1/vault" },
        { wikiId: second.wikiId, folder: "/state/wiki-checkouts/thread-1/research" },
      ];
      const note = (projectId: ProjectId, checkedOut = checkouts) =>
        wikis.agentNote({ projectId, checkouts: checkedOut, reach: "edit" });
      assert.isNull(yield* note(repository));

      const linked = yield* wikis.setProjectLink({ wikiId, projectId: repository, linked: true });
      assert.deepEqual(linked.projectIds, [repository]);
      yield* wikis.setProjectLink({ wikiId, projectId: repository, linked: true });
      assert.deepEqual((yield* wikis.list).wikis[0]?.projectIds, [repository]);
      const one = yield* note(repository);
      assert.include(one, `wiki "${summary.name}"`);
      assert.include(
        one,
        `"${summary.name}" is checked out for this thread at ${checkouts[0]!.folder}.`,
      );
      assert.isNull(yield* note(other));

      yield* wikis.setProjectLink({ wikiId: second.wikiId, projectId: repository, linked: true });
      assert.include(yield* note(repository), `wikis "${summary.name}" and "Research"`);
      // A wiki the thread has no checkout of is one it cannot reach.
      assert.notInclude(yield* note(repository, checkouts.slice(0, 1)), "Research");

      yield* wikis.setProjectLink({ wikiId, projectId: repository, linked: false });
      yield* wikis.setProjectLink({ wikiId: second.wikiId, projectId: repository, linked: false });
      assert.deepEqual((yield* wikis.list).wikis[0]?.projectIds, []);
      assert.isNull(yield* note(repository));
    }),
  ),
);

it.effect("tells a conversation with turns only about wikis linked since its last message", () =>
  withWikis((harness) =>
    Effect.gen(function* () {
      const { wikiId, summary, wikis } = yield* registeredWiki(harness);
      const repository = ProjectId.make("project-app");
      const note = (linkedSince: DateTime.Utc) =>
        wikis.agentNote({
          projectId: repository,
          linkedSince,
          checkouts: [{ wikiId, folder: "/state/wiki-checkouts/thread-1/vault" }],
          reach: "edit",
        });
      const beforeTheLink = yield* DateTime.now;
      yield* TestClock.adjust("1 minute");
      yield* wikis.setProjectLink({ wikiId, projectId: repository, linked: true });
      yield* TestClock.adjust("1 minute");
      const afterTheLink = yield* DateTime.now;

      assert.include(yield* note(beforeTheLink), `wiki "${summary.name}"`);
      assert.isNull(yield* note(afterTheLink));

      // Saving an existing link again is not a new link.
      yield* wikis.setProjectLink({ wikiId, projectId: repository, linked: true });
      assert.isNull(yield* note(afterTheLink));

      yield* wikis.setProjectLink({ wikiId, projectId: repository, linked: false });
      yield* TestClock.adjust("1 minute");
      yield* wikis.setProjectLink({ wikiId, projectId: repository, linked: true });
      assert.include(yield* note(afterTheLink), `wiki "${summary.name}"`);

      // A child working in a checkout hears which wiki it is in, once.
      const inside = (linkedSince?: DateTime.Utc) =>
        wikis.agentNote({
          projectId: repository,
          linkedSince,
          checkouts: [],
          reach: "none",
          workingIn: wikiId,
        });
      const first = yield* inside();
      assert.include(first, `Your working folder is a checkout of the wiki "${summary.name}"`);
      assert.notInclude(first, "delegate");
      assert.isNull(yield* inside(beforeTheLink));
    }),
  ),
);

it.effect("creates a wiki as a new repository under the data dir", () =>
  withWikis((harness) =>
    Effect.gen(function* () {
      const wikis = yield* WikiService.WikiService;
      const created = yield* wikis.create({ name: "Team Notes" });
      const path = yield* Path.Path;
      const fileSystem = yield* FileSystem.FileSystem;
      assert.equal(
        created.root,
        yield* fileSystem
          .realPath(path.join(harness.baseDir, "wikis", "team-notes"))
          .pipe(Effect.orDie),
      );
      assert.equal(yield* read(created.root, "README.md"), "# Team Notes\n");
      assert.equal(yield* git(created.root, ["rev-list", "--count", "main"]), "1");
      assert.equal(yield* git(created.root, ["status", "--porcelain"]), "");
      const second = yield* wikis.create({ name: "Team Notes" });
      assert.isTrue(second.root.endsWith("team-notes-2"));
    }),
  ),
);

it.effect("dates each note by the last commit that changed it, on the line read", () =>
  withWikis((harness) =>
    Effect.gen(function* () {
      const { root, wikiId, wikis } = yield* registeredWiki(harness);
      const first = yield* git(root, ["log", "-1", "--format=%cI", "main"]);
      const amended = yield* wikis.amend(
        { wikiId, message: "Grow Beta", changes: { "Beta.md": "# Beta\n\nBeta grows.\n" } },
        agent("thread-dates"),
      );
      const changeRequestId = amended.changeRequest.changeRequestId;
      const head = yield* git(root, ["log", "-1", "--format=%cI", amended.commit]);
      const editedAt = (
        notes: ReadonlyArray<{ readonly name: string; readonly editedAt?: string | undefined }>,
      ) => Object.fromEntries(notes.map((note) => [note.name, note.editedAt]));
      assert.deepEqual(editedAt((yield* wikis.index({ wikiId })).notes), {
        Alpha: first,
        Beta: first,
      });
      assert.deepEqual(editedAt((yield* wikis.index({ wikiId, changeRequestId })).notes), {
        Alpha: first,
        Beta: head,
      });
    }),
  ),
);

it.effect("runs a base by file, by a note's block, or by source, on the line read", () =>
  withWikis((harness) =>
    Effect.gen(function* () {
      const { root, wikiId, wikis } = yield* registeredWiki(harness);
      yield* write(root, {
        "Alpha.md": "---\nstatus: open\n---\n# Alpha\n\nAlpha builds on [[Beta]].\n",
        "Beta.md": "---\nstatus: done\n---\n# Beta\n\nBeta stands alone.\n",
        "Open.base":
          "filters: 'status == \"open\"'\nviews:\n  - type: cards\n    name: Open\n    order: [file.basename, status]\n",
        "Index.md":
          "# Index\n\nStart at [[Alpha]].\n\n```base\nfilters: '!this.file.links.contains(file) && file.name != this.file.name'\n```\n",
        "attachments/pic.png": "png",
      });
      yield* git(root, ["add", "."]);
      yield* git(root, ["commit", "--quiet", "-m", "Statuses and bases"]);
      const names = (result: { readonly rows: ReadonlyArray<{ readonly name: string }> }) =>
        result.rows.map((row) => row.name);

      assert.deepEqual(
        (yield* wikis.index({ wikiId })).bases.map((base) => base.file),
        ["Open.base"],
      );
      const byFile = yield* wikis.query({ wikiId, base: "Open" });
      assert.deepEqual(byFile.view, { name: "Open", type: "cards" });
      assert.deepEqual(byFile.rows, [
        { name: "Alpha", file: "Alpha.md", values: { "file.basename": "Alpha", status: "open" } },
      ]);
      // A base lists every file in the repository, as an Obsidian vault does.
      assert.deepEqual(names(yield* wikis.query({ wikiId, base: "Index" })), [
        "Beta",
        "Open.base",
        "pic.png",
        "Product.skillmap",
      ]);
      const attachments = yield* wikis.query({
        wikiId,
        source:
          'filters: file.inFolder("attachments")\nviews:\n  - type: table\n    order: [file.path, file.size]\n',
      });
      assert.deepEqual(
        attachments.rows.map((row) => row.values),
        [{ "file.path": "attachments/pic.png", "file.size": 3 }],
      );
      // A block as the editor holds it, unsaved: `this` is the note it sits in.
      assert.deepEqual(
        names(yield* wikis.query({ wikiId, source: "filters: file.hasLink(this)", note: "Beta" })),
        ["Alpha"],
      );

      // Inside a change request, the base sees the change request's notes.
      const amended = yield* wikis.amend(
        {
          wikiId,
          message: "Reopen Beta",
          changes: { "Beta.md": "---\nstatus: open\n---\n# Beta\n" },
        },
        agent("thread-bases"),
      );
      const changeRequestId = amended.changeRequest.changeRequestId;
      assert.deepEqual(names(yield* wikis.query({ wikiId, base: "Open.base", changeRequestId })), [
        "Alpha",
        "Beta",
      ]);
      assert.deepEqual(names(yield* wikis.query({ wikiId, base: "Open.base" })), ["Alpha"]);

      const missing = yield* failure(wikis.query({ wikiId, base: "Nowhere" }));
      assert.equal(missing.reason, "not-found");
      assert.equal((yield* failure(wikis.query({ wikiId, base: "Alpha" }))).reason, "invalid");
      const outside = yield* failure(
        wikis.query({ wikiId, source: "views:\n  - type: table\n    order: [formula.ppu]\n" }),
      );
      assert.equal(outside.reason, "invalid");
      // A base's own error names what to fix.
      assert.equal(outside.message, "No formula named “ppu” in view “Table”'s order.");
      // Another view's error comes back with the view that runs.
      const other = yield* wikis.query({
        wikiId,
        source: "views:\n  - type: table\n  - type: table\n    name: B\n    order: [formula.ppu]\n",
      });
      assert.deepEqual(other.warnings, ["No formula named “ppu” in view “B”'s order."]);
    }),
  ),
);

it.effect("lands an agent's amendments on its thread's one change request", () =>
  withWikis((harness) =>
    Effect.gen(function* () {
      const { root, wikiId, wikis } = yield* registeredWiki(harness);
      const mainBefore = yield* git(root, ["rev-parse", "main"]);
      const first = yield* wikis.amend(
        {
          wikiId,
          message: "Add Gamma\n\nGamma is new.",
          changes: { "Gamma.md": "# Gamma\n\nSee [[Alpha]].\n" },
        },
        agent("thread-a"),
      );
      assert.equal(first.changeRequest.title, "Add Gamma");
      assert.equal(first.changeRequest.status, "open");
      assert.equal(first.changeRequest.threadId, "thread-a");
      assert.equal(first.changeRequest.base, mainBefore);
      const body = yield* git(root, ["log", "-1", "--format=%B", first.commit]);
      assert.include(body, `Wiki-Amendment: ${first.amendment}`);
      assert.include(body, "Wiki-Actor: test-model");
      assert.include(body, `Wiki-Change-Request: ${first.changeRequest.changeRequestId}`);
      assert.include(body, "Wiki-Thread: thread-a");
      assert.equal(
        yield* git(root, ["log", "-1", "--format=%ae", first.commit]),
        "wiki@astrolabe.local",
      );

      const second = yield* wikis.amend(
        { wikiId, message: "Touch Beta", changes: { "Beta.md": "# Beta\n\nBeta is steady.\n" } },
        agent("thread-a"),
      );
      assert.equal(second.changeRequest.changeRequestId, first.changeRequest.changeRequestId);
      assert.deepEqual(
        second.changeRequest.amendments.map((amendment) => [amendment.subject, amendment.files]),
        [
          ["Add Gamma", ["Gamma.md"]],
          ["Touch Beta", ["Beta.md"]],
        ],
      );
      // Another thread gets its own change request; main and the checkout never moved.
      const other = yield* wikis.amend(
        { wikiId, message: "Other", changes: { "Delta.md": "# Delta\n" } },
        agent("thread-b"),
      );
      assert.notEqual(other.changeRequest.changeRequestId, first.changeRequest.changeRequestId);
      assert.equal(yield* git(root, ["rev-parse", "main"]), mainBefore);
      assert.equal(yield* git(root, ["status", "--porcelain"]), "");

      // An agent reads its own amendments; main does not have them yet.
      const own = yield* wikis.readNote({
        wikiId,
        name: "Gamma",
        threadId: ThreadId.make("thread-a"),
      });
      assert.isTrue(own.exists);
      assert.isFalse((yield* wikis.readNote({ wikiId, name: "Gamma" })).exists);
      assert.equal((yield* wikis.list).wikis[0]?.openChangeRequests, 2);

      const unchanged = yield* failure(
        wikis.amend(
          { wikiId, message: "Same", changes: { "Beta.md": "# Beta\n\nBeta is steady.\n" } },
          agent("thread-a"),
        ),
      );
      assert.equal(unchanged.reason, "invalid");
      const outside = yield* failure(
        wikis.amend({ wikiId, message: "Out", changes: { "../X.md": "x" } }, agent("thread-a")),
      );
      assert.equal(outside.reason, "invalid");
    }),
  ),
);

it.effect("reads, links and edits documents in folders, two of them sharing a name", () =>
  withWikis((harness) =>
    Effect.gen(function* () {
      const { root, wikiId, wikis } = yield* registeredWiki(harness);
      yield* write(root, {
        "a/Plan.md": "# One\n\n[[Plan]] [[Note]] [[a/Plan]]\n",
        "a/Note.md": "Beside it.\n",
        "b/Plan.md": "# Two\n\n[[Plan]]\n",
        "b/deep/Board.canvas": '{"nodes":[{"id":"c","type":"file","file":"a/Plan.md"}],"edges":[]}',
        "docs/README.md": "A note like any other.\n",
        ".github/Guide.md": "Hidden.\n",
      });
      yield* git(root, ["add", "."]);
      yield* git(root, ["commit", "--quiet", "-m", "Folders"]);

      const index = yield* wikis.index({ wikiId });
      const notes = new Map(index.notes.map((note) => [note.file, note]));
      assert.deepEqual([...notes.keys()].toSorted(), [
        ".github/Guide.md",
        "Alpha.md",
        "Beta.md",
        "a/Note.md",
        "a/Plan.md",
        "b/Plan.md",
        "docs/README.md",
      ]);
      assert.equal(notes.get("a/Plan.md")?.name, "a/Plan");
      // Itself twice over, and the board's file card.
      assert.equal(notes.get("a/Plan.md")?.outgoing, 2);
      assert.equal(notes.get("a/Plan.md")?.incoming, 2);
      assert.deepEqual(
        index.canvases.map(({ file }) => file),
        ["b/deep/Board.canvas"],
      );
      assert.deepEqual(index.unresolved, []);

      const beside = yield* wikis.readNote({ wikiId, name: "a/Plan" });
      assert.equal(beside.file, "a/Plan.md");
      assert.equal(beside.source, "# One\n\n[[Plan]] [[Note]] [[a/Plan]]\n");
      assert.deepEqual(beside.incoming, ["a/Plan", "b/deep/Board.canvas"]);
      const bare = yield* wikis.readNote({ wikiId, name: "Plan" });
      assert.equal(bare.file, "a/Plan.md");
      assert.deepEqual(bare.ambiguous, [
        { target: "Plan", file: "a/Plan.md", others: ["b/Plan.md"] },
      ]);
      assert.equal((yield* wikis.readNote({ wikiId, name: "/Plan" })).exists, false);
      assert.equal((yield* wikis.readNote({ wikiId, name: "Guide" })).exists, false);
      assert.equal((yield* wikis.readNote({ wikiId, name: ".github/Guide" })).exists, true);

      const saved = yield* wikis.autosave(
        {
          wikiId,
          document: "b/Plan.md",
          write: { kind: "text", file: "b/Plan.md", text: "# Two, edited.\n" },
        },
        WikiService.person,
      );
      const { changeRequestId } = saved.changeRequest!;
      assert.equal(saved.changeRequest?.title, "Edit Plan");
      assert.equal(saved.changeRequest?.amendments[0]?.subject, "Edit Plan");
      assert.equal(
        (yield* wikis.readNote({ wikiId, changeRequestId, name: "b/Plan" })).source,
        "# Two, edited.\n",
      );
      assert.equal(
        (yield* wikis.readNote({ wikiId, name: "b/Plan" })).source,
        "# Two\n\n[[Plan]]\n",
      );

      const unwritten = yield* wikis.readNote({ wikiId, name: "/c/New.md" });
      assert.deepInclude(unwritten, { name: "c/New", file: "c/New.md", exists: false });
      const made = yield* wikis.autosave(
        {
          wikiId,
          changeRequestId,
          document: unwritten.file,
          write: { kind: "text", file: unwritten.file, text: "New, in a new folder.\n" },
        },
        WikiService.person,
      );
      assert.equal(yield* git(root, ["show", `${made.commit}:c/New.md`]), "New, in a new folder.");

      const { files } = yield* wikis.readFiles({
        wikiId,
        from: "b/L.md",
        paths: ["Plan", "/a/Plan.md", "Missing.md"],
      });
      assert.deepEqual(
        files.map(({ file, exists }) => [file, exists]),
        [
          ["b/Plan.md", true],
          ["a/Plan.md", true],
          ["Missing.md", false],
        ],
      );
    }),
  ),
);

it.effect("stamps a warning on the map when an amendment severs an edge's prose", () =>
  withWikis((harness) =>
    Effect.gen(function* () {
      const { wikiId, wikis } = yield* registeredWiki(harness);
      const result = yield* wikis.amend(
        { wikiId, message: "Unlink Beta", changes: { "Alpha.md": "# Alpha\n\nAlpha alone.\n" } },
        agent("thread-a"),
      );
      assert.deepEqual(result.changeRequest.amendments[0]?.files, [
        "Alpha.md",
        "Product.skillmap.md",
      ]);
      assert.isTrue(result.errors.some((error) => error.edge?.to === "Beta"));
      const map = yield* wikis.readNote({
        wikiId,
        name: "Product.skillmap",
        changeRequestId: result.changeRequest.changeRequestId,
      });
      assert.include(map.source, `amendment: ${result.amendment}`);
      const index = yield* wikis.index({
        wikiId,
        changeRequestId: result.changeRequest.changeRequestId,
      });
      assert.equal(index.maps[0]?.openWarnings, 1);
    }),
  ),
);

it.effect("reverts an amendment, unless later work overlaps it", () =>
  withWikis((harness) =>
    Effect.gen(function* () {
      const { wikiId, wikis } = yield* registeredWiki(harness);
      const author = agent("thread-a");
      const gamma = yield* wikis.amend(
        { wikiId, message: "Add Gamma", changes: { "Gamma.md": "# Gamma\n" } },
        author,
      );
      const id = gamma.changeRequest.changeRequestId;
      const beta = yield* wikis.amend(
        { wikiId, message: "Beta v2", changes: { "Beta.md": "# Beta\n\nv2\n" } },
        author,
      );
      yield* wikis.amend(
        { wikiId, message: "Beta v3", changes: { "Beta.md": "# Beta\n\nv3\n" } },
        author,
      );
      const overlapping = yield* failure(
        wikis.revertAmendment({ wikiId, changeRequestId: id, commit: beta.commit }, author),
      );
      assert.equal(overlapping.reason, "conflict");

      const reverted = yield* wikis.revertAmendment(
        { wikiId, changeRequestId: id, commit: gamma.commit },
        author,
      );
      const last = reverted.changeRequest.amendments.at(-1);
      assert.equal(last?.reverts, gamma.commit);
      assert.equal(last?.subject, 'Revert "Add Gamma"');
      assert.isFalse(
        (yield* wikis.readNote({ wikiId, name: "Gamma", changeRequestId: id })).exists,
      );
      assert.include(
        (yield* wikis.readNote({ wikiId, name: "Beta", changeRequestId: id })).source,
        "v3",
      );
    }),
  ),
);

it.effect("merges a change request into main and moves the checkout", () =>
  withWikis((harness) =>
    Effect.gen(function* () {
      const { root, wikiId, wikis } = yield* registeredWiki(harness);
      const amended = yield* wikis.amend(
        { wikiId, message: "Beta v2", changes: { "Beta.md": "# Beta\n\nv2 [[Alpha]]\n" } },
        agent("thread-a"),
      );
      const id = amended.changeRequest.changeRequestId;
      const mainIndex = yield* wikis.index({ wikiId });
      const detail = yield* wikis.changeRequestsGet({ wikiId, changeRequestId: id });
      assert.equal(detail.mergePreview.status, "clean");
      assert.deepEqual(detail.files, [
        { file: "Beta.md", before: FIXTURE["Beta.md"], after: "# Beta\n\nv2 [[Alpha]]\n" },
      ]);

      const merged = yield* wikis.merge({ wikiId, changeRequestId: id });
      assert.equal(merged.changeRequest.status, "merged");
      assert.equal(merged.changeRequest.mergedCommit, merged.commit);
      assert.equal(yield* git(root, ["rev-parse", "main"]), merged.commit);
      assert.equal(yield* read(root, "Beta.md"), "# Beta\n\nv2 [[Alpha]]\n");
      assert.equal(yield* git(root, ["status", "--porcelain"]), "");
      assert.include(
        yield* git(root, ["log", "-1", "--format=%B", "main"]),
        `Wiki-Change-Request: ${id}`,
      );

      // The index follows main to the new commit; the old one is still what it was.
      const after = yield* wikis.index({ wikiId });
      assert.equal(after.commit, merged.commit);
      assert.notEqual(after.commit, mainIndex.commit);
      assert.isTrue(after.links.some((link) => link.from === "Beta" && link.to === "Alpha"));
      assert.isFalse(mainIndex.links.some((link) => link.from === "Beta"));

      assert.equal(
        (yield* failure(wikis.merge({ wikiId, changeRequestId: id }))).reason,
        "invalid",
      );
      assert.equal(
        (yield* failure(
          wikis.setChangeRequestStatus({ wikiId, changeRequestId: id, status: "open" }),
        )).reason,
        "invalid",
      );
    }),
  ),
);

it.effect("merges edits to different sentences of one paragraph that git calls a conflict", () =>
  withWikis((harness) =>
    Effect.gen(function* () {
      const { root, wikiId, wikis } = yield* registeredWiki(harness);
      const paragraph = "# Beta\n\nBeta stands alone. It is small. It is old.\n";
      yield* write(root, { "Beta.md": paragraph });
      yield* git(root, ["commit", "--quiet", "-am", "Longer Beta"]);
      const amended = yield* wikis.amend(
        {
          wikiId,
          message: "Beta is new",
          changes: { "Beta.md": "# Beta\n\nBeta stands alone. It is small. It is new.\n" },
        },
        agent("thread-a"),
      );
      yield* write(root, { "Beta.md": "# Beta\n\nBeta stands apart. It is small. It is old.\n" });
      yield* git(root, ["commit", "--quiet", "-am", "Edit on main"]);
      const id = amended.changeRequest.changeRequestId;
      const detail = yield* wikis.changeRequestsGet({ wikiId, changeRequestId: id });
      assert.equal(detail.mergePreview.status, "clean");
      yield* wikis.merge({ wikiId, changeRequestId: id });
      assert.equal(
        yield* read(root, "Beta.md"),
        "# Beta\n\nBeta stands apart. It is small. It is new.\n",
      );
      assert.equal(yield* git(root, ["status", "--porcelain"]), "");
    }),
  ),
);

it.effect("refuses a merge that conflicts with main", () =>
  withWikis((harness) =>
    Effect.gen(function* () {
      const { root, wikiId, wikis } = yield* registeredWiki(harness);
      const amended = yield* wikis.amend(
        { wikiId, message: "Beta in CR", changes: { "Beta.md": "# Beta\n\nfrom the CR\n" } },
        agent("thread-a"),
      );
      yield* write(root, { "Beta.md": "# Beta\n\nfrom main\n" });
      yield* git(root, ["commit", "--quiet", "-am", "Edit on main"]);
      const id = amended.changeRequest.changeRequestId;
      const detail = yield* wikis.changeRequestsGet({ wikiId, changeRequestId: id });
      assert.deepEqual(detail.mergePreview, {
        status: "conflict",
        conflicts: ["Beta.md"],
        errors: [],
        canvases: [],
      });
      const refused = yield* failure(wikis.merge({ wikiId, changeRequestId: id }));
      assert.equal(refused.reason, "conflict");
      assert.include(refused.message, "Beta.md");
    }),
  ),
);

const boardCard = (id: string, text: string) => ({
  id,
  type: "text",
  text,
  x: 0,
  y: 0,
  width: 250,
  height: 60,
});
const boardArrow = (id: string, fromNode: string, toNode: string) => ({ id, fromNode, toNode });
const boardFile = (nodes: ReadonlyArray<unknown>, edges: ReadonlyArray<unknown> = []) =>
  serializeCanvas({ nodes, edges });

/** A board committed on main, and a change request with a worktree to draw on it in. */
const boardChangeRequest = (harness: Harness, board: string) =>
  Effect.gen(function* () {
    const opened = yield* changeRequestWorktree(harness, { "Board.canvas": board });
    const editBoth = (cr: string, main: string) =>
      Effect.gen(function* () {
        const saved = yield* saveBoard(cr);
        yield* write(opened.root, { "Board.canvas": main });
        yield* git(opened.root, ["commit", "--quiet", "-am", "Board on main"]);
        return saved;
      });
    const saveBoard = (board: string) =>
      Effect.gen(function* () {
        yield* write(opened.worktree, { "Board.canvas": board });
        return yield* opened.wikis.saveWorktree(
          { wikiId: opened.wikiId, changeRequestId: opened.changeRequestId, message: "Board" },
          WikiService.person,
        );
      });
    const preview = opened.wikis
      .changeRequestsGet({ wikiId: opened.wikiId, changeRequestId: opened.changeRequestId })
      .pipe(Effect.map((detail) => detail.mergePreview));
    return { ...opened, editBoth, saveBoard, preview };
  });

const mergedBoard = (
  {
    wikis,
    wikiId,
    root,
  }: { wikis: WikiService.WikiService["Service"]; wikiId: WikiId; root: string },
  changeRequestId: WikiChangeRequestId,
) =>
  Effect.gen(function* () {
    yield* wikis.merge({ wikiId, changeRequestId });
    return JSON.parse(yield* read(root, "Board.canvas")) as {
      readonly nodes: ReadonlyArray<{ readonly id: string; readonly text?: string }>;
      readonly edges: ReadonlyArray<{ readonly id: string }>;
    };
  });

it.effect("sends the same sentence of a card changed on both sides to a conflict", () =>
  withWikis((harness) =>
    Effect.gen(function* () {
      const cr = yield* boardChangeRequest(harness, boardFile([boardCard("a", "old")]));
      yield* cr.editBoth(
        boardFile([boardCard("a", "from the change request")]),
        boardFile([boardCard("a", "from main")]),
      );
      const preview = yield* cr.preview;
      assert.equal(preview.status, "conflict");
      assert.deepEqual(preview.conflicts, ["Board.canvas"]);
      assert.include(preview.canvases[0]?.notes[0], "both sides changed the same sentence");

      const refused = yield* failure(
        cr.wikis.merge({ wikiId: cr.wikiId, changeRequestId: cr.changeRequestId }),
      );
      assert.equal(refused.reason, "conflict");
      assert.include(refused.message, "worktree");
      assert.notInclude(refused.message, "Amend");

      // The way out: the change request's worktree comes to agree with main.
      yield* cr.saveBoard(boardFile([boardCard("a", "from main")]));
      assert.equal((yield* cr.preview).status, "clean");
    }),
  ),
);

it.effect("merges cards on adjacent lines, which git calls a conflict", () =>
  withWikis((harness) =>
    Effect.gen(function* () {
      const [a, b] = [boardCard("a", "Alpha"), boardCard("b", "Beta")];
      const cr = yield* boardChangeRequest(harness, boardFile([a, b]));
      yield* cr.editBoth(
        boardFile([{ ...a, text: "Alpha, edited" }, b]),
        boardFile([a, { ...b, text: "Beta, edited" }]),
      );
      const conflicted = yield* gitExit(cr.root, [
        "merge-tree",
        "--write-tree",
        "main",
        `cr/${cr.changeRequestId}`,
      ]);
      assert.equal(conflicted, 1);
      const preview = yield* cr.preview;
      assert.equal(preview.status, "clean");
      assert.deepEqual(preview.canvases, []);
      const merged = yield* mergedBoard(cr, cr.changeRequestId);
      assert.deepEqual(
        merged.nodes.map((node) => node.text),
        ["Alpha, edited", "Beta, edited"],
      );
    }),
  ),
);

it.effect("drops an arrow git merges cleanly onto a card main deleted, and says so", () =>
  withWikis((harness) =>
    Effect.gen(function* () {
      const cards = ["a", "b", "c", "d", "e", "f"].map((id) => boardCard(id, id.toUpperCase()));
      const cr = yield* boardChangeRequest(harness, boardFile(cards));
      yield* cr.editBoth(
        boardFile(cards, [boardArrow("af", "a", "f")]),
        boardFile(cards.filter((card) => card.id !== "f")),
      );
      const gitAlone = yield* gitExit(cr.root, [
        "merge-tree",
        "--write-tree",
        "main",
        `cr/${cr.changeRequestId}`,
      ]);
      assert.equal(gitAlone, 0);
      const preview = yield* cr.preview;
      assert.equal(preview.status, "clean");
      assert.equal(preview.canvases[0]?.file, "Board.canvas");
      assert.include(preview.canvases[0]?.notes[0], "is dropped");
      assert.deepEqual((yield* mergedBoard(cr, cr.changeRequestId)).edges, []);
    }),
  ),
);

it.effect("refuses a card's text edit against its delete, even where git merges both", () =>
  withWikis((harness) =>
    Effect.gen(function* () {
      const cards = ["a", "b", "c", "d"].map((id) => boardCard(id, id.toUpperCase()));
      const cr = yield* boardChangeRequest(harness, boardFile(cards));
      yield* cr.editBoth(
        boardFile(cards.map((card) => (card.id === "a" ? { ...card, text: "Edited" } : card))),
        boardFile(cards.filter((card) => card.id !== "a")),
      );
      const preview = yield* cr.preview;
      assert.equal(preview.status, "conflict");
      assert.include(preview.canvases[0]?.notes[0], "edited on one side and deleted on the other");

      // Keeping it: under a new id, the card is no longer the one main deleted.
      const kept = { ...boardCard("a2", "Edited") };
      yield* cr.saveBoard(boardFile([kept, ...cards.filter((card) => card.id !== "a")]));
      assert.equal((yield* cr.preview).status, "clean");
    }),
  ),
);

it.effect("leaves a canvas whose JSON one side broke as a conflict, unrewritten", () =>
  withWikis((harness) =>
    Effect.gen(function* () {
      const a = boardCard("a", "Alpha");
      const cr = yield* boardChangeRequest(harness, boardFile([a]));
      yield* cr.editBoth(boardFile([{ ...a, x: 10 }]), "{ not json");
      const preview = yield* cr.preview;
      assert.equal(preview.status, "conflict");
      assert.equal(yield* read(cr.root, "Board.canvas"), "{ not json");
    }),
  ),
);

it.effect("reverts an amendment and drops the arrows later work drew on its cards", () =>
  withWikis((harness) =>
    Effect.gen(function* () {
      const [a, b, c, d] = ["a", "b", "c", "d"].map((id) => boardCard(id, id.toUpperCase()));
      const cr = yield* boardChangeRequest(harness, boardFile([a!, b!, c!]));
      const added = yield* cr.saveBoard(boardFile([a!, b!, c!, d!]));
      yield* cr.saveBoard(boardFile([a!, b!, c!, d!], [boardArrow("ad", "a", "d")]));
      const reverted = yield* cr.wikis.revertAmendment(
        { wikiId: cr.wikiId, changeRequestId: cr.changeRequestId, commit: added.commit },
        WikiService.person,
      );
      assert.include(reverted.canvases?.[0]?.notes[0], "is dropped");
      const { files } = yield* cr.wikis.readFiles({
        wikiId: cr.wikiId,
        commit: reverted.commit,
        paths: ["Board.canvas"],
      });
      assert.deepEqual(JSON.parse(files[0]?.text ?? ""), {
        nodes: [a, b, c],
        edges: [],
      });
    }),
  ),
);

it.effect("refuses a revert that overlaps a later card, sending it to the worktree", () =>
  withWikis((harness) =>
    Effect.gen(function* () {
      const a = boardCard("a", "old");
      const cr = yield* boardChangeRequest(harness, boardFile([a]));
      const first = yield* cr.saveBoard(boardFile([{ ...a, text: "second" }]));
      yield* cr.saveBoard(boardFile([{ ...a, text: "third" }]));
      const refused = yield* failure(
        cr.wikis.revertAmendment(
          { wikiId: cr.wikiId, changeRequestId: cr.changeRequestId, commit: first.commit },
          WikiService.person,
        ),
      );
      assert.equal(refused.reason, "conflict");
      assert.include(refused.message, "worktree");
    }),
  ),
);

it.effect("refuses a canvas in an amendment, while a worktree and a revert still land one", () =>
  withWikis((harness) =>
    Effect.gen(function* () {
      const { wikiId, wikis, changeRequestId, worktree } = yield* changeRequestWorktree(harness);
      const refused = yield* failure(
        wikis.amend(
          { wikiId, message: "Draw", changes: { "Board.canvas": "{}" } },
          agent("thread-a"),
        ),
      );
      assert.equal(refused.reason, "invalid");
      assert.include(refused.message, "Board.canvas is a canvas");
      assert.include(refused.message, '"canvas" transform');

      yield* write(worktree, { "Board.canvas": '{"nodes":[],"edges":[]}' });
      const saved = yield* wikis.saveWorktree(
        { wikiId, changeRequestId, message: "Hand edit" },
        WikiService.person,
      );
      const reverted = yield* wikis.revertAmendment(
        { wikiId, changeRequestId, commit: saved.commit },
        WikiService.person,
      );
      const read = yield* wikis.readFiles({
        wikiId,
        commit: reverted.commit,
        paths: ["Board.canvas"],
      });
      assert.equal(read.files[0]?.exists, false);
    }),
  ),
);

it.effect("lands canvas edits on the head, placed by the server, with the ids it minted", () =>
  withWikis((harness) =>
    Effect.gen(function* () {
      const { wikiId, wikis } = yield* registeredWiki(harness);
      const thread = agent("thread-canvas");
      const drawn = yield* wikis.transform(
        {
          wikiId,
          message: "Draw the board",
          transform: {
            kind: "canvas",
            file: "Board.canvas",
            edits: [
              { op: "create" },
              { op: "add", ref: "login", text: "Login" },
              { op: "add", ref: "token", text: "Token" },
              { op: "connect", from: "login", to: "token" },
            ],
          },
        },
        thread,
      );
      const login = drawn.canvas?.cards.login ?? "";
      assert.match(login, /^[0-9a-f]{16}$/);
      const added = yield* wikis.transform(
        {
          wikiId,
          message: "Add a step",
          transform: {
            kind: "canvas",
            file: "Board.canvas",
            edits: [{ op: "add", ref: "check", text: "Check", near: login }],
          },
        },
        thread,
      );
      assert.equal(added.changeRequest.changeRequestId, drawn.changeRequest.changeRequestId);
      const { files } = yield* wikis.readFiles({
        wikiId,
        changeRequestId: drawn.changeRequest.changeRequestId,
        paths: ["Board.canvas"],
      });
      const { nodes, edges } = JSON.parse(files[0]?.text ?? "");
      assert.lengthOf(nodes, 3);
      assert.lengthOf(edges, 1);
      assert.equal(nodes[0].id, login);
      assert.equal(nodes[2].id, added.canvas?.cards.check);
      assert.notDeepEqual([nodes[2].x, nodes[2].y], [nodes[1].x, nodes[1].y]);

      const onMain = yield* wikis.readFiles({ wikiId, paths: ["Board.canvas"] });
      assert.isFalse(onMain.files[0]?.exists);

      const kept = yield* wikis.transform(
        {
          wikiId,
          message: "Keep",
          transform: {
            kind: "canvas-create",
            file: "Kept.canvas",
            source: '{"nodes":[{"id":"a","type":"text","text":"Hi","x":1,"y":2}]}',
          },
        },
        thread,
      );
      const written = yield* wikis.readFiles({
        wikiId,
        commit: kept.commit,
        paths: ["Kept.canvas"],
      });
      assert.equal(
        written.files[0]?.text,
        serializeCanvas({ nodes: [{ id: "a", type: "text", text: "Hi", x: 1, y: 2 }] }),
      );

      const refused = yield* failure(
        wikis.transform(
          {
            wikiId,
            message: "Nothing here",
            transform: {
              kind: "canvas",
              file: "Other.canvas",
              edits: [{ op: "add", ref: "a", text: "A" }],
            },
          },
          thread,
        ),
      );
      assert.equal(refused.reason, "invalid");
      assert.include(refused.message, "start one with `create`");
    }),
  ),
);

it.effect("reads any file at a commit, and a change request's own at its head", () =>
  withWikis((harness) =>
    Effect.gen(function* () {
      const { root, wikiId, wikis } = yield* registeredWiki(harness);
      yield* write(root, { "deep/er/Note.md": "# Deep\n" });
      yield* git(root, ["add", "."]);
      yield* git(root, ["commit", "--quiet", "-m", "Deep"]);
      const first = yield* git(root, ["rev-parse", "HEAD"]);
      const created = yield* wikis.transform(
        {
          wikiId,
          message: "New board",
          transform: { kind: "canvas-create", file: "Board.canvas" },
        },
        agent("thread-a"),
      );
      const { changeRequestId } = created.changeRequest;

      const onMain = yield* wikis.readFiles({
        wikiId,
        paths: ["deep/er/Note.md", "DEEP/ER/note.md", "Board.canvas"],
      });
      assert.equal(onMain.commit, first);
      assert.deepEqual(
        onMain.files.map((file) => [file.exists, file.file, file.text]),
        [
          [true, "deep/er/Note.md", "# Deep\n"],
          [true, "deep/er/Note.md", "# Deep\n"],
          [false, "Board.canvas", null],
        ],
      );
      const inChange = yield* wikis.readFiles({
        wikiId,
        changeRequestId,
        paths: ["Board.canvas"],
      });
      assert.equal(inChange.files[0]?.text, '{\n\t"nodes":[],\n\t"edges":[]\n}');
      const pinned = yield* wikis.readFiles({ wikiId, commit: first, paths: ["Board.canvas"] });
      assert.equal(pinned.files[0]?.exists, false);

      assert.equal(
        (yield* wikis.readFiles({ wikiId, paths: ["Note.md"] })).files[0]?.file,
        "deep/er/Note.md",
      );
      assert.deepEqual(yield* wikis.locateFile({ wikiId, path: "deep/er/note.md" }), {
        root,
        commit: first,
        path: "deep/er/Note.md",
      });
      assert.equal(
        (yield* failure(wikis.locateFile({ wikiId, path: "Board.canvas" }))).reason,
        "not-found",
      );
      assert.equal(
        (yield* wikis.locateFile({ wikiId, changeRequestId, path: "Board.canvas" })).commit,
        created.commit,
      );
      assert.equal(
        (yield* failure(wikis.readFiles({ wikiId, commit: "--all", paths: ["Alpha.md"] }))).reason,
        "not-found",
      );
    }),
  ),
);

it.effect("reads a binary file as present but not as text", () =>
  withWikis((harness) =>
    Effect.gen(function* () {
      const { root, wikiId, wikis } = yield* registeredWiki(harness);
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      yield* fileSystem
        .writeFile(path.join(root, "pic.png"), new Uint8Array([0x89, 0x50, 0x00, 0xff]))
        .pipe(Effect.orDie);
      yield* git(root, ["add", "."]);
      yield* git(root, ["commit", "--quiet", "-m", "Picture"]);
      const read = yield* wikis.readFiles({ wikiId, paths: ["pic.png"] });
      assert.deepEqual(read.files, [
        { path: "pic.png", exists: true, file: "pic.png", size: 4, text: null },
      ]);
    }),
  ),
);

it.effect("indexes a canvas beside the notes, for links, search and agents' reads", () =>
  withWikis((harness) =>
    Effect.gen(function* () {
      const { root, wikiId, wikis } = yield* registeredWiki(harness);
      yield* write(root, {
        "Board.canvas": JSON.stringify({
          nodes: [
            { id: "a", type: "text", text: "Links [[Alpha]] and [[Ghost]]", x: 10, y: 20 },
            { id: "b", type: "file", file: "Beta.md", x: 400, y: 20 },
          ],
          edges: [{ id: "e", fromNode: "a", toNode: "b", label: "uses" }],
        }),
        "Index.md": "# Index\n\nSee [[Board.canvas]] and [[Board]].\n",
      });
      yield* git(root, ["add", "."]);
      yield* git(root, ["commit", "--quiet", "-m", "Board"]);

      const index = yield* wikis.index({ wikiId });
      assert.deepEqual(
        index.canvases.map(({ file, outgoing, incoming }) => [file, outgoing, incoming]),
        [["Board.canvas", 3, 1]],
      );
      assert.notOk(index.notes.some((note) => note.file === "Board.canvas"));
      assert.deepEqual(
        index.unresolved.map((entry) => entry.name),
        ["Board", "Ghost"],
      );
      assert.equal(index.notes.find((note) => note.name === "Beta")?.incoming, 2);
      assert.deepInclude(index.links, { from: "Board.canvas", to: "Beta" });

      const note = yield* wikis.readNote({ wikiId, name: "Board.canvas" });
      assert.isTrue(note.exists);
      assert.include(note.source, "[a] Links [[Alpha]] and [[Ghost]]");
      assert.include(note.source, "[a] -> [b]: uses");
      assert.notInclude(note.source, '"x"');
      assert.deepEqual(note.incoming, ["Index"]);
      assert.isFalse((yield* wikis.readNote({ wikiId, name: "Board" })).exists);

      const links = yield* wikis.links({ wikiId, name: "Beta" });
      assert.include(links.backlinks, "Board.canvas");
      const fromIndex = yield* wikis.links({ wikiId, name: "Index" });
      assert.deepEqual(
        fromIndex.outgoing.map(({ target, unresolved }) => [target, unresolved]),
        [
          ["Board.canvas", false],
          ["Board", true],
        ],
      );
    }),
  ),
);

it.effect("renames a note across a canvas, and shows agents an outline in review", () =>
  withWikis((harness) =>
    Effect.gen(function* () {
      const { root, wikiId, wikis } = yield* registeredWiki(harness);
      yield* write(root, {
        "Board.canvas": JSON.stringify({
          nodes: [
            { id: "b", type: "file", file: "Beta.md", subpath: "#Top" },
            { id: "w", type: "weird", kept: true },
          ],
          edges: [],
        }),
      });
      yield* git(root, ["add", "."]);
      yield* git(root, ["commit", "--quiet", "-m", "Board"]);
      const renamed = yield* wikis.transform(
        {
          wikiId,
          message: "Rename",
          transform: { kind: "rename", from: "Beta", to: "Gamma" },
        },
        agent("thread-a"),
      );
      const { changeRequestId } = renamed.changeRequest;
      const detail = yield* wikis.changeRequestsGet({ wikiId, changeRequestId });
      const board = detail.files.find((file) => file.file === "Board.canvas");
      assert.include(board?.after ?? "", '"file":"Gamma.md","subpath":"#Top"');
      assert.include(board?.after ?? "", '"type":"weird","kept":true');
      const outline = withCanvasOutlines(detail).files.find((file) => file.file === "Board.canvas");
      assert.include(outline?.after ?? "", "[b] File: Gamma.md#Top");
      assert.notInclude(outline?.after ?? "", "{");
    }),
  ),
);

it.effect("compares a code card's file at its commit with the project's head", () =>
  withWikis((harness) =>
    Effect.gen(function* () {
      const projects = yield* ProjectService.ProjectService;
      const wikis = yield* WikiService.WikiService;
      const root = yield* harness.folder("code");
      yield* git(root, ["init", "--quiet", "--initial-branch=main"]);
      yield* write(root, { "kept.ts": "a\n", "changed.ts": "a\n", "gone.ts": "a\n" });
      yield* git(root, ["add", "."]);
      yield* git(root, ["commit", "--quiet", "-m", "Code"]);
      const pinned = yield* git(root, ["rev-parse", "HEAD"]);
      yield* write(root, { "changed.ts": "b\n" });
      yield* git(root, ["rm", "--quiet", "gone.ts"]);
      yield* git(root, ["commit", "--quiet", "-am", "Later"]);
      const repository = CODE_REPOSITORY.canonicalKey;
      yield* projects.bootstrap({
        commandId: CommandId.make("cmd-code"),
        projectId: ProjectId.make("project-code"),
        title: "Code",
        workspaceRoot: root,
      });
      const reference = (path: string, commit = pinned) => ({ repository, commit, path });
      assert.deepEqual(
        (yield* wikis.codeStatus({
          references: [
            reference("kept.ts"),
            reference("changed.ts"),
            reference("gone.ts"),
            reference("never.ts"),
            reference("kept.ts", "0".repeat(40)),
            { repository: "elsewhere", commit: pinned, path: "kept.ts" },
          ],
        })).statuses,
        ["current", "changed", "gone", "unknown", "unknown", "unknown"],
      );
    }),
  ),
);

it.effect("refuses a merge over local edits and leaves everything as it was", () =>
  withWikis((harness) =>
    Effect.gen(function* () {
      const { root, wikiId, wikis } = yield* registeredWiki(harness);
      const amended = yield* wikis.amend(
        { wikiId, message: "Beta in CR", changes: { "Beta.md": "# Beta\n\nfrom the CR\n" } },
        agent("thread-a"),
      );
      const main = yield* git(root, ["rev-parse", "main"]);
      yield* write(root, { "Beta.md": "# Beta\n\nunsaved local edit\n" });
      const refused = yield* failure(
        wikis.merge({ wikiId, changeRequestId: amended.changeRequest.changeRequestId }),
      );
      assert.equal(refused.reason, "checkout-busy");
      assert.include(refused.message, "Beta.md");
      assert.equal(yield* git(root, ["rev-parse", "main"]), main);
      assert.equal(yield* read(root, "Beta.md"), "# Beta\n\nunsaved local edit\n");
      const detail = yield* wikis.changeRequestsGet({
        wikiId,
        changeRequestId: amended.changeRequest.changeRequestId,
      });
      assert.equal(detail.changeRequest.status, "open");
    }),
  ),
);

it.effect("closes and reopens a change request, keeping its history", () =>
  withWikis((harness) =>
    Effect.gen(function* () {
      const { root, wikiId, wikis } = yield* registeredWiki(harness);
      const opened = yield* wikis.changeRequestsOpen(
        { wikiId, title: "Ideas" },
        WikiService.person,
      );
      assert.equal(opened.createdBy, "You");
      assert.deepEqual(opened.amendments, []);
      const id = opened.changeRequestId;
      const closed = yield* wikis.setChangeRequestStatus({
        wikiId,
        changeRequestId: id,
        status: "closed",
      });
      assert.equal(closed.status, "closed");
      const blocked = yield* failure(
        wikis.amend(
          { wikiId, changeRequestId: id, message: "x", changes: { "X.md": "x" } },
          WikiService.person,
        ),
      );
      assert.equal(blocked.reason, "invalid");
      assert.deepEqual(
        (yield* wikis.changeRequestsList({ wikiId, status: "closed" })).changeRequests.map(
          (cr) => cr.changeRequestId,
        ),
        [id],
      );
      const reopened = yield* wikis.setChangeRequestStatus({
        wikiId,
        changeRequestId: id,
        status: "open",
      });
      assert.equal(reopened.status, "open");
      assert.equal(
        yield* git(root, ["rev-list", "--count", `refs/wiki/change-requests/${id}`]),
        "3",
      );
    }),
  ),
);

it.effect("previews a view's unsaved edits, then saves them to a change request", () =>
  withWikis((harness) =>
    Effect.gen(function* () {
      const { root, wikiId, wikis } = yield* registeredWiki(harness);
      yield* write(root, {
        "Alpha.md": "---\nstatus: open\n---\n# Alpha\n",
        "Beta.md": "---\nstatus: done\n---\n# Beta\n",
        "Open.base": "filters: 'status == \"open\"'\nviews:\n  - type: table\n    name: Open\n",
      });
      yield* git(root, ["add", "."]);
      yield* git(root, ["commit", "--quiet", "-m", "Statuses"]);
      const names = (result: { readonly rows: ReadonlyArray<{ readonly name: string }> }) =>
        result.rows.map((row) => row.name);
      const edits = [
        { kind: "property", file: "Beta.md", property: "status", value: "open" },
        { kind: "create", file: "Gamma.md", properties: { status: "open" } },
        {
          kind: "view",
          base: "Open.base",
          view: "Open",
          settings: { sort: [{ property: "file.name", direction: "DESC" }] },
        },
      ] as const;

      const preview = yield* wikis.query({ wikiId, base: "Open", edits });
      assert.deepEqual(names(preview), ["Gamma", "Beta", "Alpha"]);
      assert.deepEqual(preview.settings?.sort, [{ property: "file.name", direction: "DESC" }]);
      // Nothing is written until the edits are saved.
      assert.deepEqual(names(yield* wikis.query({ wikiId, base: "Open" })), ["Alpha"]);

      const saved = yield* wikis.transform(
        {
          wikiId,
          title: "Reopen Beta",
          message: "Reopen Beta",
          transform: { kind: "base-edits", edits },
        },
        agent("thread-base-edits"),
      );
      const changeRequestId = saved.changeRequest.changeRequestId;
      assert.deepEqual(names(yield* wikis.query({ wikiId, base: "Open", changeRequestId })), [
        "Gamma",
        "Beta",
        "Alpha",
      ]);
      assert.deepEqual(names(yield* wikis.query({ wikiId, base: "Open" })), ["Alpha"]);

      const refused = yield* failure(
        wikis.query({
          wikiId,
          base: "Open",
          edits: [{ kind: "property", file: "Nope.md", property: "status", value: "open" }],
        }),
      );
      assert.equal(refused.reason, "invalid");
      assert.equal(refused.message, "No note Nope.md to edit.");
    }),
  ),
);

it.effect("renames a note through a transform, rewriting its links and map edges", () =>
  withWikis((harness) =>
    Effect.gen(function* () {
      const { wikiId, wikis } = yield* registeredWiki(harness);
      const result = yield* wikis.transform(
        {
          wikiId,
          message: "Rename Beta",
          transform: { kind: "rename", from: "Beta", to: "Base" },
        },
        agent("thread-a"),
      );
      const id = result.changeRequest.changeRequestId;
      assert.deepEqual(result.errors, []);
      assert.include(
        (yield* wikis.readNote({ wikiId, name: "Alpha", changeRequestId: id })).source,
        "[[Base]]",
      );
      assert.isFalse((yield* wikis.readNote({ wikiId, name: "Beta", changeRequestId: id })).exists);
      const oriented = yield* wikis.orient({ wikiId, map: "Product", changeRequestId: id });
      assert.equal(oriented.edges[0]?.to, "Base");
      assert.equal(oriented.edges[0]?.supportingProse?.note, "Alpha");
    }),
  ),
);

const decodeRegistry = Schema.decodeSync(WikiRegistryJson);

it("reads a registry saved before wikis had map backgrounds", () => {
  const registry = decodeRegistry(
    JSON.stringify({
      version: 1,
      wikis: [
        {
          wikiId: "plans",
          name: "Plans",
          root: "/wikis/plans",
          mainBranch: "main",
          mirror: null,
          createdAt: "2026-11-04T00:00:00.000Z",
        },
      ],
    }),
  );
  assert.deepEqual(registry.wikis[0]?.mapBackgrounds, []);
});

it.effect("keeps map backgrounds on the server, in order, and out of the wiki's repository", () =>
  withWikis((harness) =>
    Effect.gen(function* () {
      const { root, wikiId, wikis } = yield* registeredWiki(harness);
      const backgrounds = [
        {
          name: "Paid",
          lightTiles: "https://tiles.test/{z}/{x}/{y}.png?key=secret",
          darkTiles: null,
        },
        { name: "Free", lightTiles: "https://free.test/style", darkTiles: "http://free.test/dark" },
      ];
      yield* wikis.setMapBackgrounds({ wikiId, backgrounds });
      assert.deepEqual((yield* wikis.list).wikis[0]?.mapBackgrounds, backgrounds);
      assert.equal(yield* git(root, ["status", "--porcelain"]), "");

      const twice = yield* wikis
        .setMapBackgrounds({
          wikiId,
          backgrounds: [...backgrounds, { ...backgrounds[1]!, name: "paid" }],
        })
        .pipe(Effect.flip);
      assert.equal(twice.message, "Two map backgrounds can't share a name.");
      const script = yield* wikis
        .setMapBackgrounds({
          wikiId,
          backgrounds: [{ name: "Bad", lightTiles: "javascript:alert(1)", darkTiles: null }],
        })
        .pipe(Effect.flip);
      assert.equal(script.message, "A map background's address starts with http:// or https://.");
      assert.deepEqual((yield* wikis.list).wikis[0]?.mapBackgrounds, backgrounds);
    }),
  ),
);

it.effect("pushes main to a mirror after a merge and notices overwritten remote work", () =>
  withWikis((harness) =>
    Effect.gen(function* () {
      const { root, wikiId, wikis } = yield* registeredWiki(harness);
      const bare = yield* harness.folder("mirror.git");
      yield* git(bare, ["init", "--quiet", "--bare", "--initial-branch=main"]);
      yield* wikis.setMirror({ wikiId, url: bare });

      const first = yield* wikis.amend(
        { wikiId, message: "One", changes: { "One.md": "# One\n" } },
        agent("thread-a"),
      );
      const merged = yield* wikis.merge({
        wikiId,
        changeRequestId: first.changeRequest.changeRequestId,
      });
      assert.equal(yield* git(bare, ["rev-parse", "main"]), merged.commit);
      let mirror = (yield* wikis.list).wikis[0]?.mirror;
      assert.equal(mirror?.lastPushedCommit, merged.commit);
      assert.isNull(mirror?.lastError ?? null);
      assert.isNull(mirror?.overwroteRemoteAt ?? null);

      // Someone commits on the mirror directly; the next merge replaces it and says so.
      const clone = yield* harness.folder("clone");
      yield* git(clone, ["clone", "--quiet", bare, "."]);
      yield* write(clone, { "Remote.md": "# Remote\n" });
      yield* git(clone, ["add", "."]);
      yield* git(clone, ["commit", "--quiet", "-m", "Remote edit"]);
      yield* git(clone, ["push", "--quiet", "origin", "main"]);

      const second = yield* wikis.amend(
        { wikiId, message: "Two", changes: { "Two.md": "# Two\n" } },
        agent("thread-a"),
      );
      const again = yield* wikis.merge({
        wikiId,
        changeRequestId: second.changeRequest.changeRequestId,
      });
      assert.equal(yield* git(bare, ["rev-parse", "main"]), again.commit);
      mirror = (yield* wikis.list).wikis[0]?.mirror;
      assert.isNotNull(mirror?.overwroteRemoteAt ?? null);
      assert.equal(yield* git(root, ["rev-parse", "main"]), again.commit);

      // A push that fails is recorded, never raised.
      yield* wikis.setMirror({ wikiId, url: `${bare}-missing` });
      const failed = yield* wikis.pushMirror({ wikiId });
      assert.isNotNull(failed.mirror?.lastError ?? null);
    }),
  ),
);

it.effect("reads a wiki by name, and links from its index", () =>
  withWikis((harness) =>
    Effect.gen(function* () {
      const { wikis } = yield* registeredWiki(harness, "Atlas");
      const byName = WikiId.make("atlas");
      const links = yield* wikis.links({ wikiId: byName, name: "Beta" });
      assert.deepEqual(links.backlinks, ["Alpha"]);
      assert.deepEqual(links.outgoing, []);
      const index = yield* wikis.index({ wikiId: byName });
      assert.deepEqual(index.links, [{ from: "Alpha", to: "Beta" }]);
      assert.deepEqual(
        index.notes.map((note) => [note.name, note.outgoing, note.incoming]),
        [
          ["Alpha", 1, 0],
          ["Beta", 0, 1],
        ],
      );
      // The same commit reads the same, served from the cache.
      assert.deepEqual(yield* wikis.index({ wikiId: byName }), index);
      assert.equal(
        (yield* failure(wikis.index({ wikiId: WikiId.make("nope") }))).reason,
        "not-found",
      );
    }),
  ),
);

it.effect("reports link types from both ends, and every type the wiki uses", () =>
  withWikis((harness) =>
    Effect.gen(function* () {
      const { wikis, wikiId } = yield* registeredWiki(harness);
      const { changeRequest } = yield* wikis.amend(
        {
          wikiId,
          message: "Say what Alpha's link means",
          changes: {
            "Alpha.md": "# Alpha\n\nAlpha [[Beta|builds on @depends_on]] and [[beta|@blocks]].\n",
          },
        },
        agent("thread-types"),
      );
      const scope = { wikiId, changeRequestId: changeRequest.changeRequestId };
      const alpha = yield* wikis.links({ ...scope, name: "Alpha" });
      assert.deepEqual(alpha.outgoing, [
        { target: "Beta", unresolved: false, types: ["depends_on", "blocks"] },
      ]);
      const beta = yield* wikis.links({ ...scope, name: "Beta" });
      assert.deepEqual(beta.typedBacklinks, [{ source: "Alpha", types: ["depends_on", "blocks"] }]);
      assert.deepEqual((yield* wikis.index(scope)).linkTypes, ["blocks", "depends_on"]);
    }),
  ),
);

/** A change request opened by an agent, checked out in a worktree of its own. */
const changeRequestWorktree = (harness: Harness, onMain: Readonly<Record<string, string>> = {}) =>
  Effect.gen(function* () {
    const wiki = yield* registeredWiki(harness);
    if (Object.keys(onMain).length > 0) {
      yield* write(wiki.root, onMain);
      yield* git(wiki.root, ["add", "."]);
      yield* git(wiki.root, ["commit", "--quiet", "-m", "Before the change request"]);
    }
    const opened = yield* wiki.wikis.amend(
      {
        wikiId: wiki.wikiId,
        message: "Grow Beta",
        changes: { "Beta.md": "# Beta\n\nBeta grows.\n" },
      },
      agent("thread-worktree"),
    );
    const changeRequestId = opened.changeRequest.changeRequestId;
    const worktree = yield* harness.folder("worktree");
    yield* git(wiki.root, ["worktree", "add", "--quiet", worktree, `cr/${changeRequestId}`]);
    return { ...wiki, changeRequestId, worktree };
  });

it.effect("carries a change request's worktree along when an amendment lands on it", () =>
  withWikis((harness) =>
    Effect.gen(function* () {
      const { wikiId, wikis, changeRequestId, worktree } = yield* changeRequestWorktree(harness);
      yield* wikis.amend(
        {
          wikiId,
          changeRequestId,
          message: "Steady Alpha",
          changes: { "Alpha.md": "# Alpha\n\nAlpha builds on [[Beta]], steadily.\n" },
        },
        agent("thread-worktree"),
      );
      assert.equal(
        yield* read(worktree, "Alpha.md"),
        "# Alpha\n\nAlpha builds on [[Beta]], steadily.\n",
      );
      assert.equal(yield* git(worktree, ["status", "--porcelain"]), "");
    }),
  ),
);

it.effect("refuses an amendment that would overwrite unsaved edits in the worktree", () =>
  withWikis((harness) =>
    Effect.gen(function* () {
      const { root, wikiId, wikis, changeRequestId, worktree } =
        yield* changeRequestWorktree(harness);
      yield* write(worktree, { "Beta.md": "# Beta\n\nMine, unsaved.\n" });
      const head = yield* git(root, ["rev-parse", `cr/${changeRequestId}`]);
      const refused = yield* failure(
        wikis.amend(
          {
            wikiId,
            changeRequestId,
            message: "Beta again",
            changes: { "Beta.md": "# Beta\n\nTheirs.\n" },
          },
          agent("thread-worktree"),
        ),
      );
      assert.equal(refused.reason, "checkout-busy");
      assert.include(refused.message, "Beta.md");
      assert.equal(yield* git(root, ["rev-parse", `cr/${changeRequestId}`]), head);
      assert.equal(yield* read(worktree, "Beta.md"), "# Beta\n\nMine, unsaved.\n");

      // A change elsewhere still lands, and leaves the unsaved edit where it is.
      yield* wikis.amend(
        {
          wikiId,
          changeRequestId,
          message: "Alpha",
          changes: { "Alpha.md": "# Alpha\n\nAlpha builds on [[Beta]] now.\n" },
        },
        agent("thread-worktree"),
      );
      assert.equal(yield* read(worktree, "Alpha.md"), "# Alpha\n\nAlpha builds on [[Beta]] now.\n");
      assert.equal(yield* read(worktree, "Beta.md"), "# Beta\n\nMine, unsaved.\n");
    }),
  ),
);

it.effect("saves a worktree's unsaved document edits as one amendment and leaves it clean", () =>
  withWikis((harness) =>
    Effect.gen(function* () {
      const { root, wikiId, wikis, changeRequestId, worktree } =
        yield* changeRequestWorktree(harness);
      yield* write(worktree, {
        "Beta.md": "# Beta\n\nEdited by hand.\n",
        "Gamma.md": "# Gamma\n\nSee [[Beta]].\n",
        "notes.txt": "not a document\n",
      });
      const saved = yield* wikis.saveWorktree(
        { wikiId, changeRequestId, message: "Hand edits" },
        WikiService.person,
      );
      assert.equal(yield* git(root, ["rev-parse", `cr/${changeRequestId}`]), saved.commit);
      assert.equal(
        yield* git(root, ["show", `${saved.commit}:Beta.md`]),
        "# Beta\n\nEdited by hand.",
      );
      assert.equal(
        yield* git(root, ["show", `${saved.commit}:Gamma.md`]),
        "# Gamma\n\nSee [[Beta]].",
      );
      assert.equal(yield* git(worktree, ["status", "--porcelain"]), "?? notes.txt");
      assert.equal(
        (yield* failure(
          wikis.saveWorktree({ wikiId, changeRequestId, message: "Again" }, WikiService.person),
        )).message,
        "No document in this worktree has unsaved changes.",
      );
    }),
  ),
);

it.effect("saves a worktree's documents in folders, and nothing git ignores", () =>
  withWikis((harness) =>
    Effect.gen(function* () {
      const { root, wikiId, wikis, changeRequestId, worktree } =
        yield* changeRequestWorktree(harness);
      yield* write(worktree, {
        ".gitignore": "build/\nsecret.md\n",
        "notes/deep/Gamma.md": "In a folder.\n",
        "build/Generated.md": "Ignored by its folder.\n",
        "notes/secret.md": "Ignored by its name.\n",
      });
      const saved = yield* wikis.saveWorktree(
        { wikiId, changeRequestId, message: "Hand edits" },
        WikiService.person,
      );
      assert.equal(
        yield* git(root, ["show", `${saved.commit}:notes/deep/Gamma.md`]),
        "In a folder.",
      );
      const tree = yield* git(root, ["ls-tree", "-r", "--name-only", saved.commit]);
      assert.notInclude(tree, "Generated.md");
      assert.notInclude(tree, "secret.md");
    }),
  ),
);

it.effect("checks a thread out at main until its first save opens its change request", () =>
  withWikis((harness) =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const { root, wikiId, wikis } = yield* registeredWiki(harness);
      const threadId = ThreadId.make("thread-checkout");
      const folder = path.join(harness.baseDir, "wiki-checkouts", threadId, wikiId);
      const main = yield* git(root, ["rev-parse", "main"]);
      const target = { wikiId, threadId, folder };
      const save = { ...target, title: "Tidy Beta", message: "Tidy Beta" };

      assert.equal(yield* wikis.checkoutForThread(target), folder);
      assert.equal(yield* wikis.checkoutForThread(target), folder);
      assert.equal(yield* git(folder, ["rev-parse", "HEAD"]), main);
      assert.isNull(yield* wikis.saveThreadCheckout(save, agent(threadId)));
      assert.equal(yield* git(root, ["for-each-ref", "refs/heads/cr/"]), "");

      yield* write(folder, { "Beta.md": "# Beta\n\nTidied.\n" });
      const saved = yield* wikis.saveThreadCheckout(save, agent(threadId));
      assert.isNotNull(saved);
      const { changeRequestId } = saved!.changeRequest;
      assert.equal(saved!.changeRequest.title, "Tidy Beta");
      assert.equal(saved!.changeRequest.threadId, threadId);
      assert.equal(saved!.changeRequest.amendments.length, 1);
      assert.equal(
        yield* git(folder, ["symbolic-ref", "HEAD"]),
        `refs/heads/cr/${changeRequestId}`,
      );
      assert.equal(yield* git(folder, ["status", "--porcelain"]), "");
      assert.isNull(yield* wikis.saveThreadCheckout(save, agent(threadId)));

      // The next turn's edits join the same change request, which a new checkout lands on.
      yield* write(folder, { "Alpha.md": "# Alpha\n\nAlpha builds on [[Beta]], tidily.\n" });
      const again = yield* wikis.saveThreadCheckout(save, agent(threadId));
      assert.equal(again!.changeRequest.changeRequestId, changeRequestId);
      assert.equal(again!.changeRequest.amendments.length, 2);
      assert.equal(yield* wikis.checkoutForThread(target), folder);
      assert.equal(yield* git(folder, ["rev-parse", "HEAD"]), again!.commit);

      // Closed, it leaves the thread with none, so the checkout goes back to main.
      yield* wikis.setChangeRequestStatus({ wikiId, changeRequestId, status: "closed" });
      assert.equal(yield* wikis.checkoutForThread(target), folder);
      assert.equal(yield* git(folder, ["rev-parse", "HEAD"]), main);

      yield* wikis.removeCheckout({ wikiId, folder });
      assert.notInclude(yield* git(root, ["worktree", "list"]), folder);
    }),
  ),
);

it.effect("saves a checkout onto the change request a tool opened during the turn", () =>
  withWikis((harness) =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const { wikiId, wikis } = yield* registeredWiki(harness);
      const threadId = ThreadId.make("thread-tool-opened");
      const folder = path.join(harness.baseDir, "wiki-checkouts", threadId, wikiId);
      yield* wikis.checkoutForThread({ wikiId, threadId, folder });
      yield* write(folder, { "Beta.md": "# Beta\n\nFrom the checkout.\n" });
      const opened = yield* wikis.amend(
        {
          wikiId,
          message: "Alpha by tool",
          changes: { "Alpha.md": "# Alpha\n\nAlpha builds on [[Beta]], by tool.\n" },
        },
        agent(threadId),
      );
      const saved = yield* wikis.saveThreadCheckout(
        { wikiId, threadId, folder, title: "Turn", message: "Turn" },
        agent(threadId),
      );
      assert.equal(saved!.changeRequest.changeRequestId, opened.changeRequest.changeRequestId);
      assert.equal(
        yield* read(folder, "Alpha.md"),
        "# Alpha\n\nAlpha builds on [[Beta]], by tool.\n",
      );
      assert.equal(yield* read(folder, "Beta.md"), "# Beta\n\nFrom the checkout.\n");
      assert.equal(yield* git(folder, ["rev-parse", "HEAD"]), saved!.commit);
      assert.equal(yield* git(folder, ["status", "--porcelain"]), "");
    }),
  ),
);

/** A thread with a checkout of the fixture wiki, where the server keeps it. */
const threadWithCheckout = (harness: Harness, thread: string) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const { stateDir } = yield* ServerConfig.ServerConfig;
    const registered = yield* registeredWiki(harness);
    const threadId = ThreadId.make(thread);
    const folder = path.join(stateDir, "wiki-checkouts", threadId, registered.wikiId);
    yield* registered.wikis.checkoutForThread({ wikiId: registered.wikiId, threadId, folder });
    const save = () =>
      registered.wikis.saveThreadCheckout(
        { wikiId: registered.wikiId, threadId, folder, title: "Turn", message: "Turn" },
        agent(threadId),
      );
    return { ...registered, threadId, folder, save };
  });

it.effect("lands commits an agent makes in its checkout with the turn's save", () =>
  withWikis((harness) =>
    Effect.gen(function* () {
      const { root, wikiId, wikis, threadId, folder, save } = yield* threadWithCheckout(
        harness,
        "thread-git",
      );
      const main = yield* git(root, ["rev-parse", "main"]);
      // Before the first save the checkout sits detached at main.
      yield* write(folder, { "Beta.md": "# Beta\n\nCommitted by hand.\n" });
      yield* git(folder, ["commit", "--quiet", "-am", "By hand"]);
      const first = yield* save();
      assert.equal(first!.changeRequest.base, main);
      assert.deepEqual(first!.changeRequest.files, ["Beta.md"]);
      assert.equal(first!.changeRequest.amendments.length, 1);
      assert.equal(yield* read(folder, "Beta.md"), "# Beta\n\nCommitted by hand.\n");
      assert.equal(yield* git(folder, ["status", "--porcelain"]), "");

      // On the change request's branch a commit is its own amendment, under its git author.
      yield* write(folder, { "Alpha.md": "# Alpha\n\nAlpha builds on [[Beta]], by hand.\n" });
      yield* git(folder, ["commit", "--quiet", "-am", "Alpha by hand"]);
      assert.isNull(yield* save());
      yield* write(folder, { "Beta.md": "# Beta\n\nThen saved.\n" });
      const second = yield* save();
      const { amendments } = (yield* wikis.changeRequestsGet({
        wikiId,
        changeRequestId: second!.changeRequest.changeRequestId,
      })).changeRequest;
      assert.deepEqual(
        amendments.map((amendment) => amendment.actor),
        ["test-model", "Fixture", "test-model"],
      );
      assert.equal(yield* git(folder, ["rev-parse", "HEAD"]), second!.commit);
      assert.equal(second!.changeRequest.threadId, threadId);
    }),
  ),
);

it.effect("a child working in a thread's checkout saves onto that thread's change request", () =>
  withWikis((harness) =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const fileSystem = yield* FileSystem.FileSystem;
      const { stateDir } = yield* ServerConfig.ServerConfig;
      const { root, wikiId, summary, wikis } = yield* registeredWiki(harness);
      const projectId = ProjectId.make("project-app");
      yield* wikis.setProjectLink({ wikiId, projectId, linked: true });
      const checkouts = yield* ThreadWikiCheckouts.ThreadWikiCheckouts;
      const parent = ThreadId.make("thread-parent");
      const child = ThreadId.make("thread-child");
      const checkoutFor = (threadId: ThreadId, wiki: string, worktreePath: string | null = null) =>
        checkouts.checkoutFor({ threadId, projectId, worktreePath, wiki });

      const unknown = yield* failure(checkoutFor(parent, "Research"));
      assert.equal(
        unknown.message,
        `No wiki has this id or name. Its linked wikis: "${summary.name}".`,
      );
      yield* wikis.create({ name: "Research" });
      assert.include(
        (yield* failure(checkoutFor(parent, "research"))).message,
        "That wiki is not linked to this project.",
      );

      const folder = yield* checkoutFor(parent, summary.name.toUpperCase());
      assert.equal(folder, path.join(stateDir, "wiki-checkouts", parent, wikiId));
      // The child mounts no checkout of its own, and a task it delegates shares the same one.
      assert.deepEqual(
        yield* checkouts.ensure({ threadId: child, projectId, worktreePath: folder }),
        { checkouts: [], workingIn: wikiId },
      );
      assert.equal(yield* checkoutFor(child, wikiId, folder), folder);

      const turn = (threadId: ThreadId, actor: string) =>
        checkouts.saveTurn({
          threadId,
          projectId,
          worktreePath: threadId === child ? folder : null,
          title: "Turn",
          author: { actor, threadId },
        });
      const amendments = Effect.gen(function* () {
        const [open] = (yield* wikis.changeRequestsList({ wikiId })).changeRequests;
        if (open === undefined) return [];
        return (yield* wikis.changeRequestsGet({ wikiId, changeRequestId: open.changeRequestId }))
          .changeRequest.amendments;
      });

      // The child's turn ends after its parent's: it saves the folder itself.
      yield* write(folder, { "Beta.md": "# Beta\n\nBy the child.\n" });
      yield* turn(child, "child-model");
      const saved = yield* amendments;
      assert.deepEqual(
        saved.map((amendment) => amendment.actor),
        ["child-model"],
      );
      const [open] = (yield* wikis.changeRequestsList({ wikiId })).changeRequests;
      assert.equal(open?.threadId, parent);
      assert.equal(yield* git(folder, ["rev-parse", "HEAD"]), saved[0]?.commit);

      // Turns ending together save the folder once between them.
      yield* write(folder, { "Beta.md": "# Beta\n\nBy both.\n" });
      yield* Effect.all([turn(child, "child-model"), turn(parent, "parent-model")], {
        concurrency: "unbounded",
      });
      assert.equal((yield* amendments).length, 2);
      yield* Effect.all([turn(child, "child-model"), turn(parent, "parent-model")]);
      assert.equal((yield* amendments).length, 2);
      assert.isFalse(yield* fileSystem.exists(path.join(stateDir, "wiki-checkouts", child)));
      assert.notInclude(yield* git(root, ["worktree", "list"]), child);
    }).pipe(Effect.provide(ThreadWikiCheckouts.layer)),
  ),
);

it.effect("reads a thread's checkout as it stands, unsaved edits included", () =>
  withWikis((harness) =>
    Effect.gen(function* () {
      const { wikiId, wikis, threadId, folder, save } = yield* threadWithCheckout(
        harness,
        "thread-r",
      );
      yield* write(folder, {
        "Beta.md": "---\nstatus: open\n---\n# Beta\n\nBeta now needs [[Delta]].\n",
        "Open.base":
          "filters: 'status == \"open\"'\nviews:\n  - type: table\n    name: Open\n    columns: [x]\n",
        "Product.skillmap.md": MAP.replace("How the product fits together", "Edited on disk"),
      });
      const warning = "views[0].columns is not a view key and is ignored; did you mean order?";
      const inCheckout = { wikiId, threadId, checkout: true };
      const links = yield* wikis.links({ ...inCheckout, name: "Beta" });
      assert.deepEqual(links.outgoing, [{ target: "Delta", unresolved: true, types: [] }]);
      assert.equal(
        (yield* wikis.orient({ ...inCheckout, map: "Product" })).purpose,
        "Edited on disk",
      );
      const rows = yield* wikis.query({ ...inCheckout, base: "Open" });
      assert.deepEqual(
        rows.rows.map((row) => row.file),
        ["Beta.md"],
      );
      assert.deepEqual(rows.warnings, [warning]);
      const unopened = yield* failure(wikis.changeRequestsGet(inCheckout));
      assert.include(unopened.message, "Beta.md, Open.base, Product.skillmap.md");

      // Without a checkout, or naming none, a read sees the commit.
      const committed = { wikiId, threadId: ThreadId.make("thread-elsewhere"), checkout: true };
      assert.deepEqual((yield* wikis.links({ ...committed, name: "Beta" })).outgoing, []);
      assert.deepEqual((yield* wikis.links({ wikiId, threadId, name: "Beta" })).outgoing, []);

      const saved = yield* save();
      const detail = yield* wikis.changeRequestsGet(inCheckout);
      assert.equal(detail.changeRequest.changeRequestId, saved!.changeRequest.changeRequestId);
      assert.deepEqual(detail.unsaved, []);
      assert.deepEqual(detail.warnings, [{ file: "Open.base", warning }]);
    }),
  ),
);

it.effect(
  "transforms a checkout's files in place, for the turn's save to land as one amendment",
  () =>
    withWikis((harness) =>
      Effect.gen(function* () {
        const { root, wikiId, wikis, threadId, folder, save } = yield* threadWithCheckout(
          harness,
          "thread-t",
        );
        const author = agent(threadId);
        yield* write(folder, {
          "Beta.md": "# Beta\n\nBeta, edited natively.\n",
          "area/pic.png": "png",
        });
        const renamed = yield* wikis.transformCheckout(
          {
            wikiId,
            message: "Move",
            transform: { kind: "rename", from: "Beta", to: "area/Gamma" },
          },
          author,
        );
        assert.notProperty(renamed, "changeRequest");
        assert.deepEqual(renamed, {
          written: ["Alpha.md", "Product.skillmap.md", "area/Gamma.md"],
          removed: ["Beta.md"],
          errors: [],
        });
        assert.equal(yield* read(folder, "area/Gamma.md"), "# Beta\n\nBeta, edited natively.\n");
        assert.include(yield* read(folder, "Alpha.md"), "[[Gamma]]");
        assert.equal(yield* git(root, ["for-each-ref", "refs/heads/cr/"]), "");
        const backlinks = yield* wikis.links({ wikiId, threadId, checkout: true, name: "Gamma" });
        assert.deepEqual(backlinks.backlinks, ["Alpha"]);

        const moved = yield* wikis.transformCheckout(
          {
            wikiId,
            message: "Move",
            transform: { kind: "rename", from: "area", to: "zone", folder: true },
          },
          author,
        );
        assert.includeMembers([...("removed" in moved ? moved.removed : [])], ["area/pic.png"]);
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        assert.isFalse(yield* fileSystem.exists(path.join(folder, "area")).pipe(Effect.orDie));

        const saved = yield* save();
        assert.equal(saved!.changeRequest.amendments.length, 1);
        assert.sameMembers(
          (yield* git(root, ["ls-tree", "-r", "--name-only", saved!.commit])).split("\n"),
          ["Alpha.md", "Product.skillmap.md", "zone/Gamma.md", "zone/pic.png"],
        );
        assert.equal(
          yield* git(root, ["show", `${saved!.commit}:zone/Gamma.md`]),
          "# Beta\n\nBeta, edited natively.",
        );
        assert.deepEqual(saved!.changeRequest.moves, [{ from: "Beta.md", to: "zone/Gamma.md" }]);
        assert.equal(yield* git(folder, ["status", "--porcelain"]), "");
      }),
    ),
);

it.effect("stamps a checkout's warnings with the amendment the turn's save lands", () =>
  withWikis((harness) =>
    Effect.gen(function* () {
      const { wikiId, wikis, threadId, folder, save } = yield* threadWithCheckout(
        harness,
        "thread-w",
      );
      yield* write(folder, { "Alpha.md": "# Alpha\n\nAlpha alone, see [[Delta]].\n" });
      yield* wikis.transformCheckout(
        {
          wikiId,
          message: "Fill Delta",
          transform: {
            kind: "fill",
            map: "Product",
            name: "Delta",
            content: "# Delta\n",
            edge: { from: "Alpha", type: "needs", to: "Delta", rationale: "Alpha points at Delta" },
          },
        },
        agent(threadId),
      );
      const saved = yield* save();
      const map = yield* read(folder, "Product.skillmap.md");
      assert.equal(map.match(/amendment: /g)?.length, 1);
      assert.include(map, `amendment: ${saved!.amendment}`);
      assert.include(map, `id: ${saved!.amendment}-1`);
    }),
  ),
);

it.effect("lands a transform at once for a thread with no checkout of the wiki", () =>
  withWikis((harness) =>
    Effect.gen(function* () {
      const { wikiId, wikis } = yield* registeredWiki(harness);
      const landed = yield* wikis.transformCheckout(
        { wikiId, message: "Rename", transform: { kind: "rename", from: "Beta", to: "Gamma" } },
        agent("thread-none"),
      );
      assert.property(landed, "commit");
    }),
  ),
);

it.effect("reads, searches and writes a checkout's files for the turn's one amendment", () =>
  withWikis((harness) =>
    Effect.gen(function* () {
      const { root, wikiId, wikis, threadId, folder, save } = yield* threadWithCheckout(
        harness,
        "thread-files",
      );
      const author = agent(threadId);
      const edit = (input: Omit<WikiService.WikiCheckoutWriteInput, "wikiId">) =>
        wikis.checkoutWrite({ wikiId, ...input }, author);

      assert.deepEqual(yield* wikis.checkoutRead({ wikiId, threadId, path: "Alpha.md" }), {
        path: "Alpha.md",
        text: FIXTURE["Alpha.md"],
        startLine: 1,
        endLine: 3,
        totalLines: 3,
      });
      assert.equal(
        (yield* wikis.checkoutRead({ wikiId, threadId, path: "Alpha.md", startLine: 3 })).text,
        "Alpha builds on [[Beta]].",
      );

      assert.deepEqual(
        yield* edit({ path: "Beta.md", oldText: "stands alone", newText: "waits" }),
        {
          path: "Beta.md",
          change: "updated",
        },
      );
      assert.equal(yield* read(folder, "Beta.md"), "# Beta\n\nBeta waits.\n");
      assert.equal(
        (yield* edit({ path: "area/Gamma.md", content: "Gamma, Gamma.\n" })).change,
        "created",
      );
      assert.include(
        (yield* failure(edit({ path: "area/Gamma.md", oldText: "Gamma", newText: "G" }))).message,
        "more than once",
      );
      assert.include(
        (yield* failure(edit({ path: "Beta.md", oldText: "stands alone", newText: "x" }))).message,
        "is not in Beta.md",
      );
      assert.equal((yield* edit({ path: "Draft.md", content: "Gone soon.\n" })).change, "created");
      assert.equal((yield* edit({ path: "Draft.md", delete: true })).change, "deleted");
      // A broken base is written all the same, with what is wrong in it.
      const based = yield* edit({
        path: "Draft.md",
        content: "```base\nviews:\n  - type: table\n    columns: [x]\n```\n",
      });
      assert.deepEqual(based.warnings, [
        "views[0].columns is not a view key and is ignored; did you mean order?",
      ]);
      yield* edit({ path: "Draft.md", delete: true });

      const found = yield* wikis.checkoutSearch({ wikiId, threadId, query: "WAITS" });
      assert.deepEqual(found, {
        matches: [{ path: "Beta.md", lines: [{ line: 3, text: "Beta waits." }] }],
        truncated: false,
      });

      // Nothing lands until the turn's save, which carries every write as one amendment.
      assert.equal(yield* git(root, ["for-each-ref", "refs/heads/cr/"]), "");
      const saved = yield* save();
      assert.equal(saved!.changeRequest.amendments.length, 1);
      assert.sameMembers([...saved!.changeRequest.files], ["Beta.md", "area/Gamma.md"]);
      assert.equal(yield* git(folder, ["status", "--porcelain"]), "");
    }),
  ),
);

it.effect("keeps the checkout file tools inside the checkout, and bounds a search", () =>
  withWikis((harness) =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const { wikiId, wikis, threadId, folder } = yield* threadWithCheckout(harness, "thread-out");
      const outside = yield* harness.folder("outside");
      yield* fileSystem.symlink(outside, path.join(folder, "link")).pipe(Effect.orDie);
      for (const file of ["../Escape.md", "/tmp/Escape.md", ".git/Escape.md", "link/Escape.md"]) {
        const refused = yield* failure(
          wikis.checkoutWrite({ wikiId, path: file, content: "Out." }, agent(threadId)),
        );
        assert.include(refused.message, "is not a path inside the wiki", file);
      }
      assert.deepEqual(yield* fileSystem.readDirectory(outside).pipe(Effect.orDie), []);
      yield* fileSystem.remove(path.join(folder, "link")).pipe(Effect.orDie);
      assert.equal(
        (yield* failure(
          wikis.checkoutRead({ wikiId, threadId: ThreadId.make("thread-none"), path: "Alpha.md" }),
        )).reason,
        "not-found",
      );

      yield* write(
        folder,
        Object.fromEntries(
          Array.from({ length: 41 }, (_, at) => [`many/Note ${at}.md`, `A needle, ${at}.\n`]),
        ),
      );
      const found = yield* wikis.checkoutSearch({ wikiId, threadId, query: "needle" });
      assert.equal(found.matches.length, 40);
      assert.isTrue(found.truncated);
    }),
  ),
);

const noteEdit = (text: string, readAt?: string) => ({
  document: "Alpha.md",
  write: {
    kind: "text" as const,
    file: "Alpha.md",
    text,
    ...(readAt === undefined ? {} : { readAt }),
  },
});

const mainAt = (root: string) => git(root, ["rev-parse", "main"]);

it.effect("starts one draft on the first edit, and collects every document in it", () =>
  withWikis((harness) =>
    Effect.gen(function* () {
      const { root, wikiId, wikis } = yield* registeredWiki(harness);
      const main = yield* mainAt(root);

      const [first, second] = yield* Effect.all(
        [
          wikis.autosave({ wikiId, ...noteEdit("# Alpha\n\nEdited.\n") }, WikiService.person),
          wikis.autosave(
            {
              wikiId,
              document: "Beta.md",
              write: { kind: "text", file: "Beta.md", text: "# Beta\n\nEdited.\n" },
            },
            WikiService.person,
          ),
        ],
        { concurrency: "unbounded" },
      );
      assert.equal(first.changeRequest?.changeRequestId, second.changeRequest?.changeRequestId);
      assert.isTrue(second.changeRequest?.draft);
      assert.equal(first.changeRequest?.title, "Edit Alpha");
      assert.equal(yield* mainAt(root), main);
      assert.equal(yield* read(root, "Alpha.md"), FIXTURE["Alpha.md"]);

      const { changeRequests } = yield* wikis.changeRequestsList({ wikiId }, WikiService.person);
      assert.equal(changeRequests.length, 1);
      assert.equal(changeRequests[0]?.amendments.length, 2);
    }),
  ),
);

it.effect("keeps a draft from everyone but its author, and from agents' writes", () =>
  withWikis((harness) =>
    Effect.gen(function* () {
      const { wikiId, wikis } = yield* registeredWiki(harness);
      const saved = yield* wikis.autosave({ wikiId, ...noteEdit("Mine.\n") }, WikiService.person);
      const draft = saved.changeRequest!;

      assert.equal((yield* wikis.changeRequestsList({ wikiId })).changeRequests.length, 0);
      assert.equal(
        (yield* wikis.changeRequestsList({ wikiId }, agent("t1"))).changeRequests.length,
        0,
      );
      assert.equal((yield* wikis.list).wikis[0]?.openChangeRequests, 0);

      const changes = { "Alpha.md": "An agent's.\n" };
      const target = { wikiId, message: "Change", changeRequestId: draft.changeRequestId };
      const refused = yield* failure(wikis.amend({ ...target, changes }, agent("t1")));
      assert.equal(refused.reason, "invalid");
      const revert = { wikiId, changeRequestId: draft.changeRequestId, commit: draft.head };
      assert.equal((yield* failure(wikis.revertAmendment(revert, agent("t1")))).reason, "invalid");

      // Without naming it, an agent's write opens its own change request as ever.
      const own = yield* wikis.amend({ wikiId, message: "Change", changes }, agent("t1"));
      assert.isFalse(own.changeRequest.draft);
      assert.notEqual(own.changeRequest.changeRequestId, draft.changeRequestId);
    }),
  ),
);

it.effect("counts saves of one document in a run as one amendment", () =>
  withWikis((harness) =>
    Effect.gen(function* () {
      const { root, wikiId, wikis } = yield* registeredWiki(harness);
      const save = (text: string) =>
        wikis.autosave({ wikiId, ...noteEdit(text) }, WikiService.person);
      const first = yield* save("One.\n");
      yield* save("Two.\n");
      const third = yield* save("Three.\n");
      const draft = third.changeRequest!;
      assert.equal(draft.amendments.length, 1);
      assert.notEqual(third.commit, first.commit);
      assert.equal(yield* git(root, ["rev-parse", `${third.commit}^`]), draft.base);
      assert.equal(yield* git(root, ["show", `${third.commit}:Alpha.md`]), "Three.");

      // Another document ends the run, and past the gap a new one starts.
      const other = {
        document: "Beta.md",
        write: { kind: "text" as const, file: "Beta.md", text: "Beta edited.\n" },
      };
      yield* wikis.autosave({ wikiId, ...other }, WikiService.person);
      const back = yield* save("Four.\n");
      assert.equal(back.changeRequest?.amendments.length, 3);
      yield* save("Five.\n");
      yield* TestClock.adjust("10 minutes");
      const later = yield* save("Six.\n");
      assert.equal(later.changeRequest?.amendments.length, 4);
    }),
  ),
);

it.effect("ends a run when an agent's amendment or a revert lands on top of it", () =>
  withWikis((harness) =>
    Effect.gen(function* () {
      const { wikiId, wikis } = yield* registeredWiki(harness);
      const { changeRequest } = yield* wikis.amend(
        { wikiId, title: "Work", message: "Start", changes: { "Beta.md": "Beta one.\n" } },
        agent("t1"),
      );
      const { changeRequestId } = changeRequest;
      const save = (text: string) =>
        wikis.autosave({ wikiId, changeRequestId, ...noteEdit(text) }, WikiService.person);

      const typed = yield* save("Typed.\n");
      assert.equal(typed.changeRequest?.changeRequestId, changeRequestId);
      assert.isFalse(typed.changeRequest?.draft);
      yield* wikis.amend(
        { wikiId, changeRequestId, message: "More", changes: { "Beta.md": "Beta two.\n" } },
        agent("t1"),
      );
      const after = yield* save("Typed again.\n");
      assert.equal(after.changeRequest?.amendments.length, 4);

      yield* wikis.revertAmendment(
        { wikiId, changeRequestId, commit: after.commit! },
        WikiService.person,
      );
      const reverted = yield* save("Typed after a revert.\n");
      assert.equal(reverted.changeRequest?.amendments.length, 6);
    }),
  ),
);

it.effect("drops an amendment edited back to where it began, and saves nothing for no edit", () =>
  withWikis((harness) =>
    Effect.gen(function* () {
      const { wikiId, wikis } = yield* registeredWiki(harness);
      const unchanged = yield* wikis.autosave(
        { wikiId, ...noteEdit(FIXTURE["Alpha.md"]) },
        WikiService.person,
      );
      assert.deepEqual(unchanged, { changeRequest: null, commit: null });
      assert.equal(
        (yield* wikis.changeRequestsList({ wikiId }, WikiService.person)).changeRequests.length,
        0,
      );

      const edited = yield* wikis.autosave(
        { wikiId, ...noteEdit("Edited.\n") },
        WikiService.person,
      );
      const same = yield* wikis.autosave({ wikiId, ...noteEdit("Edited.\n") }, WikiService.person);
      assert.equal(same.commit, edited.commit);

      const undone = yield* wikis.autosave(
        { wikiId, ...noteEdit(FIXTURE["Alpha.md"]) },
        WikiService.person,
      );
      assert.equal(undone.changeRequest?.amendments.length, 0);
      assert.equal(undone.changeRequest?.status, "open");
      assert.equal(undone.changeRequest?.head, undone.changeRequest?.base);

      // The next edit reuses the empty draft.
      const again = yield* wikis.autosave({ wikiId, ...noteEdit("Again.\n") }, WikiService.person);
      assert.equal(again.changeRequest?.changeRequestId, undone.changeRequest?.changeRequestId);
    }),
  ),
);

it.effect("leaves no warning from a link broken for a moment in a run", () =>
  withWikis((harness) =>
    Effect.gen(function* () {
      const { root, wikiId, wikis } = yield* registeredWiki(harness);
      yield* wikis.autosave({ wikiId, ...noteEdit("Mid-edit, no link.\n") }, WikiService.person);
      const restored = yield* wikis.autosave(
        { wikiId, ...noteEdit("Alpha builds on [[Beta]] still.\n") },
        WikiService.person,
      );
      assert.equal(restored.changeRequest?.amendments.length, 1);
      assert.deepEqual(restored.changeRequest?.amendments[0]?.files, ["Alpha.md"]);
      assert.equal(
        yield* git(root, ["show", `${restored.commit}:Product.skillmap.md`]),
        MAP.trim(),
      );
    }),
  ),
);

it.effect("refuses text that hasn't seen another device's save, unless nothing was touched", () =>
  withWikis((harness) =>
    Effect.gen(function* () {
      const { root, wikiId, wikis } = yield* registeredWiki(harness);
      const main = yield* mainAt(root);
      const phone = yield* wikis.autosave(
        { wikiId, ...noteEdit("From the phone.\n", main) },
        WikiService.person,
      );
      assert.equal(phone.changeRequest?.base, main);

      const stale = yield* failure(
        wikis.autosave({ wikiId, ...noteEdit("From the laptop.\n", main) }, WikiService.person),
      );
      assert.equal(stale.reason, "stale");
      const caughtUp = yield* wikis.autosave(
        { wikiId, ...noteEdit("From both.\n", phone.commit!) },
        WikiService.person,
      );
      assert.equal(caughtUp.changeRequest?.amendments.length, 1);

      // Beta is untouched by the draft, so text read from a newer main has nothing to overwrite.
      yield* wikis.merge({
        wikiId,
        changeRequestId: (yield* wikis.amend(
          { wikiId, title: "Other", message: "Other", changes: { "Beta.md": "Beta on main.\n" } },
          WikiService.person,
        )).changeRequest.changeRequestId,
      });
      const landed = yield* wikis.autosave(
        {
          wikiId,
          document: "Beta.md",
          write: {
            kind: "text",
            file: "Beta.md",
            text: "Beta on main, edited.\n",
            readAt: yield* mainAt(root),
          },
        },
        WikiService.person,
      );
      assert.equal(landed.changeRequest?.amendments.length, 2);
    }),
  ),
);

it.effect("takes in what reached main at each save, so a newer document can be edited", () =>
  withWikis((harness) =>
    Effect.gen(function* () {
      const { root, wikiId, wikis } = yield* registeredWiki(harness);
      yield* wikis.autosave({ wikiId, ...noteEdit("Mine.\n") }, WikiService.person);
      const board =
        '{"nodes":[{"id":"a","type":"text","text":"","x":0,"y":0,"width":250,"height":60}],"edges":[]}';
      yield* write(root, { "New.canvas": board });
      yield* git(root, ["add", "."]);
      yield* git(root, ["commit", "--quiet", "-m", "A board on main"]);

      const saved = yield* wikis.autosave(
        {
          wikiId,
          document: "New.canvas",
          write: {
            kind: "transform",
            transform: {
              kind: "canvas",
              file: "New.canvas",
              edits: [{ op: "set-card", card: "a", keys: { text: "Edited" } }],
            },
          },
        },
        WikiService.person,
      );
      assert.equal(saved.changeRequest?.base, yield* mainAt(root));
      assert.includeMembers([...(saved.changeRequest?.files ?? [])], ["Alpha.md", "New.canvas"]);
      assert.deepEqual(
        saved.changeRequest?.amendments.map((amendment) => amendment.subject),
        ["Edit Alpha", "Edit New"],
      );
      assert.include(yield* git(root, ["show", `${saved.commit}:New.canvas`]), "Edited");

      // Text read before main moved would take main's change back out.
      const read = yield* mainAt(root);
      yield* write(root, { "Beta.md": "Beta, newer.\n" });
      yield* git(root, ["add", "."]);
      yield* git(root, ["commit", "--quiet", "-m", "Beta on main"]);
      const stale = yield* failure(
        wikis.autosave(
          {
            wikiId,
            document: "Beta.md",
            write: { kind: "text", file: "Beta.md", text: "Older, edited.\n", readAt: read },
          },
          WikiService.person,
        ),
      );
      assert.equal(stale.reason, "stale");
    }),
  ),
);

it.effect("says why a clashing draft can't take a document newer than it", () =>
  withWikis((harness) =>
    Effect.gen(function* () {
      const { root, wikiId, wikis } = yield* registeredWiki(harness);
      yield* wikis.autosave({ wikiId, ...noteEdit("Mine.\n") }, WikiService.person);
      yield* write(root, { "Alpha.md": "Theirs.\n", "New.md": "New.\n" });
      yield* git(root, ["add", "."]);
      yield* git(root, ["commit", "--quiet", "-m", "Clash"]);
      const refused = yield* failure(
        wikis.autosave(
          {
            wikiId,
            document: "New.md",
            write: { kind: "text", file: "New.md", text: "New, edited.\n" },
          },
          WikiService.person,
        ),
      );
      assert.equal(refused.reason, "conflict");
      assert.include(refused.message, "Alpha.md");

      const beta = { kind: "text" as const, file: "Beta.md", text: "Beta, edited.\n" };
      const landed = yield* wikis.autosave(
        { wikiId, document: "Beta.md", write: beta },
        WikiService.person,
      );
      assert.equal(landed.changeRequest?.amendments.length, 2);
    }),
  ),
);

it.effect("moves one document out of a draft that followed main, and nothing else", () =>
  withWikis((harness) =>
    Effect.gen(function* () {
      const { root, wikiId, wikis } = yield* registeredWiki(harness);
      const target = yield* wikis.amend(
        { wikiId, title: "Older", message: "Older", changes: { "Gamma.md": "Gamma, older.\n" } },
        WikiService.person,
      );
      yield* wikis.autosave({ wikiId, ...noteEdit("Mine.\n") }, WikiService.person);
      yield* write(root, { "Late.md": "Late.\n" });
      yield* git(root, ["add", "."]);
      yield* git(root, ["commit", "--quiet", "-m", "Late"]);
      const saved = yield* wikis.autosave(
        {
          wikiId,
          document: "Beta.md",
          write: { kind: "text", file: "Beta.md", text: "Beta, edited.\n" },
        },
        WikiService.person,
      );
      const moved = yield* wikis.draftMove(
        {
          wikiId,
          changeRequestId: saved.changeRequest!.changeRequestId,
          to: target.changeRequest.changeRequestId,
          files: ["Alpha.md"],
        },
        WikiService.person,
      );
      assert.notInclude([...moved.files], "Late.md");
      assert.include([...moved.files], "Alpha.md");
    }),
  ),
);

it.effect("lands a base's edits and a canvas's in the draft, replayed in a run", () =>
  withWikis((harness) =>
    Effect.gen(function* () {
      const { root, wikiId, wikis } = yield* registeredWiki(harness);
      yield* write(root, { "Tasks.base": "views:\n  - type: table\n    name: All\n" });
      yield* git(root, ["add", "."]);
      yield* git(root, ["commit", "--quiet", "-m", "Base"]);
      const property = (value: string) => ({
        document: "Tasks.base",
        write: {
          kind: "transform" as const,
          transform: {
            kind: "base-edits" as const,
            edits: [{ kind: "property" as const, file: "Alpha.md", property: "status", value }],
          },
        },
      });
      yield* wikis.autosave({ wikiId, ...property("open") }, WikiService.person);
      const based = yield* wikis.autosave({ wikiId, ...property("done") }, WikiService.person);
      assert.equal(based.changeRequest?.amendments.length, 1);
      assert.include(yield* git(root, ["show", `${based.commit}:Alpha.md`]), "status: done");

      const board = {
        document: "Board.canvas",
        write: {
          kind: "transform" as const,
          transform: { kind: "canvas-create" as const, file: "Board.canvas" },
        },
      };
      const canvas = yield* wikis.autosave({ wikiId, ...board }, WikiService.person);
      assert.isTrue(canvas.changeRequest?.draft);
      assert.equal(canvas.changeRequest?.amendments.length, 2);
      const carded = yield* wikis.autosave(
        {
          wikiId,
          document: "Board.canvas",
          write: {
            kind: "transform",
            transform: {
              kind: "canvas",
              file: "Board.canvas",
              edits: [{ op: "add", ref: "a", text: "A card" }],
            },
          },
        },
        WikiService.person,
      );
      assert.equal(carded.changeRequest?.amendments.length, 2);
      assert.include(yield* git(root, ["show", `${carded.commit}:Board.canvas`]), "A card");
    }),
  ),
);

it.effect("lands hand edits on a canvas, attaches a file beside it, and lists both", () =>
  withWikis((harness) =>
    Effect.gen(function* () {
      const { root, wikiId, wikis } = yield* registeredWiki(harness);
      const hands = (edits: ReadonlyArray<CanvasEdit>) =>
        wikis.autosave(
          {
            wikiId,
            document: "Board.canvas",
            write: {
              kind: "transform",
              transform: { kind: "canvas", file: "Board.canvas", edits },
            },
          },
          WikiService.person,
        );
      yield* wikis.autosave(
        {
          wikiId,
          document: "Board.canvas",
          write: {
            kind: "transform",
            transform: { kind: "canvas-create", file: "Board.canvas" },
          },
        },
        WikiService.person,
      );
      const node = {
        id: "card",
        x: 0,
        y: 0,
        width: 250,
        height: 60,
        type: "text",
        text: "Hello",
        future: 1,
      };
      yield* hands([{ op: "put-card", node }]);
      const moved = yield* hands([{ op: "move", card: "card", x: 40, y: 20 }]);
      assert.equal(moved.changeRequest?.amendments.length, 1);
      const written = yield* git(root, ["show", `${moved.commit}:Board.canvas`]);
      assert.equal(
        written,
        '{\n\t"nodes":[\n\t\t{"id":"card","x":40,"y":20,"width":250,"height":60,"type":"text","text":"Hello","future":1}\n\t],\n\t"edges":[]\n}',
      );

      const pixel = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
      const attached = yield* wikis.autosave(
        {
          wikiId,
          document: "Board.canvas",
          write: {
            kind: "attachment",
            file: "Pasted image 1.png",
            base64: pixel.toString("base64"),
          },
        },
        WikiService.person,
      );
      const stored = yield* git(root, ["cat-file", "-s", `${attached.commit}:Pasted image 1.png`]);
      assert.equal(stored, String(pixel.length));
      const { files } = yield* wikis.listFiles({
        wikiId,
        changeRequestId: attached.changeRequest!.changeRequestId,
      });
      assert.includeMembers(
        files.map(({ file }) => file),
        ["Board.canvas", "Pasted image 1.png"],
      );

      for (const file of ["Sneaky.md", "../up.png", ".hidden"]) {
        const refused = yield* failure(
          wikis.autosave(
            { wikiId, document: "Board.canvas", write: { kind: "attachment", file, base64: "" } },
            WikiService.person,
          ),
        );
        assert.equal(refused.reason, "invalid");
      }
    }),
  ),
);

it.effect(
  "numbers attachments that want one name, in the folder they land in, under the lock",
  () =>
    withWikis((harness) =>
      Effect.gen(function* () {
        const { root, wikiId, wikis } = yield* registeredWiki(harness);
        const attach = (file: string, text: string) =>
          wikis.autosave(
            {
              wikiId,
              document: "Board.canvas",
              write: { kind: "attachment", file, base64: Buffer.from(text).toString("base64") },
            },
            WikiService.person,
          );
        // Both pastes asked with the same list in hand: only the write can tell them apart.
        const [first, second] = yield* Effect.all(
          [attach("a/Pasted.png", "one"), attach("a/Pasted.png", "two")],
          { concurrency: "unbounded" },
        );
        assert.deepEqual(
          [first?.attachment, second?.attachment],
          ["a/Pasted.png", "a/Pasted 1.png"],
        );
        const head = second!.commit!;
        assert.equal(yield* git(root, ["show", `${head}:a/Pasted.png`]), "one");
        assert.equal(yield* git(root, ["show", `${head}:a/Pasted 1.png`]), "two");

        const cased = yield* attach("A/PASTED.PNG", "three");
        assert.equal(cased.attachment, "A/PASTED 2.PNG");
        const elsewhere = yield* attach("b/Pasted.png", "four");
        assert.equal(elsewhere.attachment, "b/Pasted.png");
        const same = yield* attach("a/Pasted.png", "one");
        assert.equal(same.attachment, "a/Pasted 3.png");
      }),
    ),
);

it.effect("reads and saves a new note named with a # as itself, not the note before the #", () =>
  withWikis((harness) =>
    Effect.gen(function* () {
      const { root, wikiId, wikis } = yield* registeredWiki(harness);
      yield* write(root, { "Issue.md": "The issue.\n" });
      yield* git(root, ["add", "."]);
      yield* git(root, ["commit", "--quiet", "-m", "Issue"]);
      const opened = yield* wikis.readNote({ wikiId, name: "/Issue #12.md" });
      assert.isFalse(opened.exists);
      assert.equal(opened.file, "Issue #12.md");
      const saved = yield* wikis.autosave(
        {
          wikiId,
          document: opened.file,
          write: { kind: "text", file: opened.file, text: "Twelve.\n" },
        },
        WikiService.person,
      );
      assert.deepEqual(saved.changeRequest!.files, ["Issue #12.md"]);
      assert.equal(yield* git(root, ["show", `${saved.commit}:Issue.md`]), "The issue.");
    }),
  ),
);

it.effect("makes a draft a change request, which merges; a draft itself doesn't", () =>
  withWikis((harness) =>
    Effect.gen(function* () {
      const { root, wikiId, wikis } = yield* registeredWiki(harness);
      const saved = yield* wikis.autosave({ wikiId, ...noteEdit("Done.\n") }, WikiService.person);
      const { changeRequestId } = saved.changeRequest!;

      assert.equal((yield* failure(wikis.merge({ wikiId, changeRequestId }))).reason, "invalid");

      const promoted = yield* wikis.draftPromote(
        { wikiId, changeRequestId, title: "A real title" },
        WikiService.person,
      );
      assert.isFalse(promoted.draft);
      assert.equal(promoted.title, "A real title");
      assert.equal((yield* wikis.list).wikis[0]?.openChangeRequests, 1);
      assert.equal(
        (yield* failure(
          wikis.draftPromote({ wikiId, changeRequestId, title: "Again" }, WikiService.person),
        )).reason,
        "invalid",
      );

      // The next edit on main starts a new draft, not more of the change request.
      const next = yield* wikis.autosave(
        {
          wikiId,
          document: "Beta.md",
          write: { kind: "text", file: "Beta.md", text: "Next.\n" },
        },
        WikiService.person,
      );
      assert.isTrue(next.changeRequest?.draft);
      assert.notEqual(next.changeRequest?.changeRequestId, changeRequestId);

      yield* wikis.merge({ wikiId, changeRequestId });
      assert.equal(yield* read(root, "Alpha.md"), "Done.\n");
    }),
  ),
);

it.effect("moves a draft into a change request, whole or a document at a time", () =>
  withWikis((harness) =>
    Effect.gen(function* () {
      const { wikiId, wikis } = yield* registeredWiki(harness);
      const target = yield* wikis.amend(
        { wikiId, title: "Target", message: "Start", changes: { "New.md": "New.\n" } },
        WikiService.person,
      );
      const to = target.changeRequest.changeRequestId;
      const beta = {
        document: "Beta.md",
        write: { kind: "text" as const, file: "Beta.md", text: "Beta in the draft.\n" },
      };
      yield* wikis.autosave(
        { wikiId, ...noteEdit("Alpha in the draft, on [[Beta]].\n") },
        WikiService.person,
      );
      const saved = yield* wikis.autosave({ wikiId, ...beta }, WikiService.person);
      const changeRequestId = saved.changeRequest!.changeRequestId;

      const one = yield* wikis.draftMove(
        { wikiId, changeRequestId, to, files: ["Alpha.md"] },
        WikiService.person,
      );
      assert.equal(one.amendments.length, 2);
      const inTarget = (name: string) =>
        wikis.readNote({ wikiId, changeRequestId: to, name }).pipe(Effect.map((n) => n.source));
      assert.equal(yield* inTarget("Alpha"), "Alpha in the draft, on [[Beta]].\n");
      assert.equal(yield* inTarget("Beta"), FIXTURE["Beta.md"]);
      const detail = yield* wikis.changeRequestsGet({ wikiId, changeRequestId });
      assert.deepEqual(
        detail.files.map((file) => file.file),
        ["Beta.md"],
      );
      assert.deepEqual(detail.changeRequest.files, ["Beta.md"]);
      assert.equal(detail.changeRequest.status, "open");

      yield* wikis.draftMove({ wikiId, changeRequestId, to }, WikiService.person);
      assert.equal(yield* inTarget("Beta"), "Beta in the draft.\n");
      const closed = yield* wikis.changeRequestsGet({ wikiId, changeRequestId });
      assert.equal(closed.changeRequest.status, "closed");
    }),
  ),
);

const PIXEL = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0xfe, 0x80]);

const attachPixel = (wikiId: WikiId, file: string, changeRequestId?: WikiChangeRequestId) =>
  WikiService.WikiService.pipe(
    Effect.flatMap((wikis) =>
      wikis.autosave(
        {
          wikiId,
          ...(changeRequestId === undefined ? {} : { changeRequestId }),
          document: "Alpha.md",
          write: { kind: "attachment", file, base64: PIXEL.toString("base64") },
        },
        WikiService.person,
      ),
    ),
  );

it.effect("moves a draft's pasted image out whole, or goes back on it", () =>
  withWikis((harness) =>
    Effect.gen(function* () {
      const { root, wikiId, wikis } = yield* registeredWiki(harness);
      const target = yield* wikis.amend(
        { wikiId, title: "Target", message: "Open", changes: { "Gamma.md": "Gamma.\n" } },
        WikiService.person,
      );
      const to = target.changeRequest.changeRequestId;
      const edited = yield* wikis.autosave(
        { wikiId, ...noteEdit("Mine, on [[Beta]].\n") },
        WikiService.person,
      );
      const changeRequestId = edited.changeRequest!.changeRequestId;
      const attached = yield* attachPixel(wikiId, "Pasted image.png", changeRequestId);

      // Only the image: the draft stays open, and loses it.
      const moved = yield* wikis.draftMove(
        { wikiId, changeRequestId, to, files: ["Pasted image.png"] },
        WikiService.person,
      );
      assert.equal(
        yield* git(root, ["rev-parse", `${moved.head}:Pasted image.png`]),
        yield* git(root, ["rev-parse", `${attached.commit}:Pasted image.png`]),
      );
      const left = yield* wikis.changeRequestsGet({ wikiId, changeRequestId });
      assert.deepEqual(left.changeRequest.files, ["Alpha.md"]);

      const pasted = yield* attachPixel(wikiId, "Another.png", changeRequestId);
      const undone = yield* wikis.revertAmendment(
        { wikiId, changeRequestId, commit: pasted.commit! },
        WikiService.person,
      );
      assert.notInclude(
        yield* git(root, ["ls-tree", "-r", "--name-only", undone.commit]),
        "Another.png",
      );
      const redone = yield* wikis.revertAmendment(
        { wikiId, changeRequestId, commit: undone.commit },
        WikiService.person,
      );
      assert.equal(
        yield* git(root, ["rev-parse", `${redone.commit}:Another.png`]),
        yield* git(root, ["rev-parse", `${pasted.commit}:Another.png`]),
      );
    }),
  ),
);

const LONG_NOTE = `${"A line the note keeps through its move.\n".repeat(8)}Links to [[Beta]].\n`;

const REWRITTEN = `${"Nothing of this was in the note before.\n".repeat(12)}`;

it.effect("keeps a move a move when an edit took it below what git can see", () =>
  withWikis((harness) =>
    Effect.gen(function* () {
      const { root, wikiId, wikis } = yield* registeredWiki(harness);
      yield* write(root, { "Long.md": LONG_NOTE });
      yield* git(root, ["add", "."]);
      yield* git(root, ["commit", "--quiet", "-m", "Long"]);
      const person = WikiService.person;
      const edited = yield* wikis.autosave(
        { wikiId, document: "Long.md", write: { kind: "text", file: "Long.md", text: REWRITTEN } },
        person,
      );
      const changeRequestId = edited.changeRequest!.changeRequestId;
      const first = yield* wikis.move({ wikiId, from: "Long.md", to: "shelf/Long.md" }, person);
      assert.deepEqual(first.changeRequest!.moves, [{ from: "Long.md", to: "shelf/Long.md" }]);
      const detail = yield* wikis.changeRequestsGet({ wikiId, changeRequestId });
      assert.deepEqual(
        detail.files.map(({ file, movedFrom }) => [file, movedFrom]),
        [["shelf/Long.md", "Long.md"]],
      );
      assert.equal(detail.files[0]?.before, LONG_NOTE);
      assert.equal(detail.files[0]?.after, REWRITTEN);

      // Moved again, it's one move from where it began.
      const second = yield* wikis.move(
        { wikiId, from: "shelf/Long.md", to: "desk/Short.md" },
        person,
      );
      assert.deepEqual(second.changeRequest!.moves, [{ from: "Long.md", to: "desk/Short.md" }]);

      // Going back on the second leaves the first; going back on the first leaves an edit.
      const back = yield* wikis.revertAmendment(
        { wikiId, changeRequestId, commit: second.commit! },
        person,
      );
      assert.deepEqual(back.changeRequest.moves, [{ from: "Long.md", to: "shelf/Long.md" }]);
      const home = yield* wikis.revertAmendment(
        { wikiId, changeRequestId, commit: first.commit! },
        person,
      );
      assert.isUndefined(home.changeRequest.moves);
      assert.deepEqual(home.changeRequest.files, ["Long.md"]);
    }),
  ),
);

it.effect("brings a move an edit hid along when its draft moves into a change request", () =>
  withWikis((harness) =>
    Effect.gen(function* () {
      const { root, wikiId, wikis } = yield* registeredWiki(harness);
      yield* write(root, { "Long.md": LONG_NOTE });
      yield* git(root, ["add", "."]);
      yield* git(root, ["commit", "--quiet", "-m", "Long"]);
      const person = WikiService.person;
      const target = yield* wikis.amend(
        { wikiId, title: "Target", message: "Open", changes: { "Gamma.md": "Gamma.\n" } },
        person,
      );
      const edited = yield* wikis.autosave(
        { wikiId, document: "Long.md", write: { kind: "text", file: "Long.md", text: REWRITTEN } },
        person,
      );
      yield* wikis.move({ wikiId, from: "Long.md", to: "shelf/Long.md" }, person);
      const moved = yield* wikis.draftMove(
        {
          wikiId,
          changeRequestId: edited.changeRequest!.changeRequestId,
          to: target.changeRequest.changeRequestId,
        },
        person,
      );
      assert.deepEqual(moved.moves, [{ from: "Long.md", to: "shelf/Long.md" }]);
    }),
  ),
);

it.effect("shows a moved document as a move, with its creation time carried", () =>
  withWikis((harness) =>
    Effect.gen(function* () {
      const { root, wikiId, wikis } = yield* registeredWiki(harness);
      yield* write(root, { "Long.md": LONG_NOTE, "Mentions.md": "See [[Long]].\n" });
      yield* git(root, ["add", "."]);
      yield* git(root, ["commit", "--quiet", "-m", "Long"]);
      const before = yield* wikis.query({
        wikiId,
        source: "views:\n  - type: table\n    order: [file.path, file.ctime]\n",
      });
      const created = before.rows.find((row) => row.file === "Long.md")?.values["file.ctime"];
      yield* TestClock.adjust("1 hour");
      const moved = yield* wikis.move(
        { wikiId, from: "Long.md", to: "shelf/deep/Long.md" },
        WikiService.person,
      );
      const changeRequestId = moved.changeRequest!.changeRequestId;
      const detail = yield* wikis.changeRequestsGet({ wikiId, changeRequestId });
      const change = detail.files.find(({ file }) => file === "shelf/deep/Long.md");
      assert.equal(change?.movedFrom, "Long.md");
      assert.equal(change?.before, LONG_NOTE);
      assert.equal(change?.after, LONG_NOTE);
      assert.isFalse(detail.files.some(({ file }) => file === "Long.md"));
      assert.isFalse(detail.files.some(({ file }) => file === "Mentions.md"));
      // What travels keeps seeing both paths: a draft can hand on either.
      assert.includeMembers([...detail.changeRequest.files], ["Long.md", "shelf/deep/Long.md"]);
      assert.deepEqual(detail.changeRequest.moves, [{ from: "Long.md", to: "shelf/deep/Long.md" }]);
      assert.equal(moved.changeRequest!.amendments.at(-1)?.subject, "Move Long to shelf/deep");
      const after = yield* wikis.query({
        wikiId,
        changeRequestId,
        source: "views:\n  - type: table\n    order: [file.path, file.ctime]\n",
      });
      const carried = after.rows.find((row) => row.file === "shelf/deep/Long.md");
      assert.deepEqual(carried?.values["file.ctime"], created);
    }),
  ),
);

it.effect("keeps a move in a draft that follows main, and merges it", () =>
  withWikis((harness) =>
    Effect.gen(function* () {
      const { root, wikiId, wikis } = yield* registeredWiki(harness);
      yield* write(root, { "Long.md": LONG_NOTE });
      yield* git(root, ["add", "."]);
      yield* git(root, ["commit", "--quiet", "-m", "Long"]);
      const moved = yield* wikis.move(
        { wikiId, from: "Long.md", to: "shelf/Long.md" },
        WikiService.person,
      );
      const changeRequestId = moved.changeRequest!.changeRequestId;
      yield* write(root, { "Long.md": `${LONG_NOTE}Added on main.\n`, "Late.md": "Late.\n" });
      yield* git(root, ["add", "."]);
      yield* git(root, ["commit", "--quiet", "-m", "On main"]);

      const saved = yield* wikis.autosave(
        { wikiId, ...noteEdit("Edited in the draft.\n") },
        WikiService.person,
      );
      assert.equal(saved.changeRequest?.changeRequestId, changeRequestId);
      const tree = yield* git(root, ["ls-tree", "-r", "--name-only", saved.commit!]);
      assert.notInclude(tree.split("\n"), "Long.md");
      assert.include(tree.split("\n"), "Late.md");
      assert.include(yield* git(root, ["show", `${saved.commit}:shelf/Long.md`]), "Added on main.");

      yield* wikis.draftPromote({ wikiId, changeRequestId, title: "Moved" }, WikiService.person);
      yield* wikis.merge({ wikiId, changeRequestId });
      const landed = yield* git(root, ["ls-tree", "-r", "--name-only", "HEAD"]);
      assert.include(landed.split("\n"), "shelf/Long.md");
      assert.notInclude(landed.split("\n"), "Long.md");
    }),
  ),
);

it.effect("finds a linked file from the file linking to it", () =>
  withWikis((harness) =>
    Effect.gen(function* () {
      const { root, wikiId, wikis } = yield* registeredWiki(harness);
      yield* write(root, { "a/shot.png": "a", "b/shot.png": "b" });
      yield* git(root, ["add", "."]);
      yield* git(root, ["commit", "--quiet", "-m", "Shots"]);
      const fromA = yield* wikis.locateFile({ wikiId, path: "shot.png", from: "a/N.md" });
      const fromB = yield* wikis.locateFile({ wikiId, path: "shot.png", from: "b/N.md" });
      assert.equal(fromA.path, "a/shot.png");
      assert.equal(fromB.path, "b/shot.png");
    }),
  ),
);

it.effect("reverts a move, keeping what was edited after it", () =>
  withWikis((harness) =>
    Effect.gen(function* () {
      const { root, wikiId, wikis } = yield* registeredWiki(harness);
      yield* write(root, { "Long.md": LONG_NOTE, "Mentions.md": "See [[Long]].\n" });
      yield* git(root, ["add", "."]);
      yield* git(root, ["commit", "--quiet", "-m", "Long"]);
      yield* wikis.autosave({ wikiId, ...noteEdit("Mine.\n") }, WikiService.person);
      yield* write(root, { "other/Long.md": "Another of the same name.\n" });
      yield* git(root, ["add", "."]);
      yield* git(root, ["commit", "--quiet", "-m", "Copy"]);
      const moved = yield* wikis.move(
        { wikiId, from: "Long.md", to: "shelf/Long.md" },
        WikiService.person,
      );
      const changeRequestId = moved.changeRequest!.changeRequestId;
      assert.equal(
        yield* git(root, ["show", `${moved.commit}:Mentions.md`]),
        "See [[shelf/Long]].",
      );
      yield* wikis.autosave(
        {
          wikiId,
          changeRequestId,
          document: "shelf/Long.md",
          write: { kind: "text", file: "shelf/Long.md", text: `${LONG_NOTE}Later.\n` },
        },
        WikiService.person,
      );
      const reverted = yield* wikis.revertAmendment(
        { wikiId, changeRequestId, commit: moved.commit! },
        WikiService.person,
      );
      const files = (yield* git(root, ["ls-tree", "-r", "--name-only", reverted.commit])).split(
        "\n",
      );
      assert.include(files, "Long.md");
      assert.notInclude(files, "shelf/Long.md");
      assert.include(yield* git(root, ["show", `${reverted.commit}:Long.md`]), "Later.");
      assert.equal(yield* git(root, ["show", `${reverted.commit}:Mentions.md`]), "See [[Long]].");
    }),
  ),
);

it.effect("moves an agent's note and folder on its change request, refusing a bare twin", () =>
  withWikis((harness) =>
    Effect.gen(function* () {
      const { root, wikiId, wikis } = yield* registeredWiki(harness);
      yield* write(root, { "a/Plan.md": "[[Beta]]\n", "b/Plan.md": "Two.\n" });
      yield* git(root, ["add", "."]);
      yield* git(root, ["commit", "--quiet", "-m", "Twins"]);
      const author = agent("thread-move");
      const moved = (from: string, to: string, folder?: boolean) =>
        wikis.transform(
          {
            wikiId,
            message: `Move ${from}`,
            transform: { kind: "rename", from, to, ...(folder ? { folder } : {}) },
          },
          author,
        );

      const refused = yield* failure(moved("Plan", "c/Plan"));
      assert.equal(refused.message, "Plan could be a/Plan.md or b/Plan.md: name its path");

      yield* moved("Beta", "/ops/Beta");
      const { commit } = yield* moved("a", "z/a", true);
      assert.equal(yield* git(root, ["show", `${commit}:z/a/Plan.md`]), "[[Beta]]");
      assert.equal(
        yield* git(root, ["show", `${commit}:ops/Beta.md`]),
        "# Beta\n\nBeta stands alone.",
      );
    }),
  ),
);

it.effect("renames a folder as one amendment, carrying what it holds, and takes it back", () =>
  withWikis((harness) =>
    Effect.gen(function* () {
      const { root, wikiId, wikis } = yield* registeredWiki(harness);
      yield* write(root, {
        "a/Long.md": LONG_NOTE,
        "a/sub/shot.txt": "A picture of sorts.\n",
        "Mentions.md": "See [[a/Long]] and ![[a/sub/shot.txt]].\n",
      });
      yield* git(root, ["add", "."]);
      yield* git(root, ["commit", "--quiet", "-m", "Folder"]);
      const moved = yield* wikis.move(
        { wikiId, from: "a", to: "z/y", folder: true },
        WikiService.person,
      );
      assert.equal(moved.changeRequest!.amendments.length, 1);
      const files = (yield* git(root, ["ls-tree", "-r", "--name-only", moved.commit!])).split("\n");
      assert.includeMembers(files, ["z/y/Long.md", "z/y/sub/shot.txt"]);
      assert.isFalse(files.some((file) => file.startsWith("a/")));
      assert.equal(
        yield* git(root, ["show", `${moved.commit}:Mentions.md`]),
        "See [[Long]] and ![[shot.txt]].",
      );
      const changeRequestId = moved.changeRequest!.changeRequestId;
      const undone = yield* wikis.revertAmendment(
        { wikiId, changeRequestId, commit: moved.commit! },
        WikiService.person,
      );
      const restored = yield* git(root, ["ls-tree", "-r", "--name-only", undone.commit]);
      assert.includeMembers(restored.split("\n"), ["a/Long.md", "a/sub/shot.txt"]);
    }),
  ),
);

it.effect("refuses a move that conflicts, leaving both sides as they were", () =>
  withWikis((harness) =>
    Effect.gen(function* () {
      const { wikiId, wikis } = yield* registeredWiki(harness);
      const target = yield* wikis.amend(
        {
          wikiId,
          title: "Target",
          message: "Start",
          changes: { "Alpha.md": "# Alpha\n\nTheirs.\n" },
        },
        WikiService.person,
      );
      const to = target.changeRequest.changeRequestId;
      const saved = yield* wikis.autosave(
        { wikiId, ...noteEdit("# Alpha\n\nMine.\n") },
        WikiService.person,
      );
      const changeRequestId = saved.changeRequest!.changeRequestId;
      const refused = yield* failure(
        wikis.draftMove({ wikiId, changeRequestId, to }, WikiService.person),
      );
      assert.equal(refused.reason, "conflict");
      assert.include(refused.message, "Alpha.md");
      const draft = yield* wikis.changeRequestsGet({ wikiId, changeRequestId });
      assert.equal(draft.changeRequest.status, "open");
      assert.equal(draft.changeRequest.head, saved.commit);
      const unmoved = yield* wikis.changeRequestsGet({ wikiId, changeRequestId: to });
      assert.equal(unmoved.changeRequest.amendments.length, 1);
    }),
  ),
);

it.effect("reopens a discarded draft, unless another has started since", () =>
  withWikis((harness) =>
    Effect.gen(function* () {
      const { wikiId, wikis } = yield* registeredWiki(harness);
      const saved = yield* wikis.autosave({ wikiId, ...noteEdit("Kept.\n") }, WikiService.person);
      const { changeRequestId } = saved.changeRequest!;
      const status = (next: "open" | "closed", id = changeRequestId) =>
        wikis.setChangeRequestStatus({ wikiId, changeRequestId: id, status: next });

      yield* status("closed");
      const reopened = yield* status("open");
      assert.equal(reopened.head, saved.commit);
      assert.isTrue(reopened.draft);

      yield* status("closed");
      const next = yield* wikis.autosave({ wikiId, ...noteEdit("New.\n") }, WikiService.person);
      assert.notEqual(next.changeRequest?.changeRequestId, changeRequestId);
      assert.equal((yield* failure(status("open"))).reason, "invalid");
      yield* status("closed", next.changeRequest!.changeRequestId);
      assert.equal((yield* status("open")).status, "open");
    }),
  ),
);
