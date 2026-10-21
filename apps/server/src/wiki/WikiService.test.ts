import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { ThreadId, type WikiError, WikiId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import type * as Scope from "effect/Scope";

import * as ServerConfig from "../config.ts";
import * as RuntimeLayer from "../orchestration-v2/runtimeLayer.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as ProjectEnrichmentService from "../project/ProjectEnrichmentService.ts";
import * as ProjectFaviconResolver from "../project/ProjectFaviconResolver.ts";
import * as RepositoryIdentityResolver from "../project/RepositoryIdentityResolver.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import * as WikiService from "./WikiService.ts";

const layerEnrichment = ProjectEnrichmentService.layer.pipe(
  Layer.provide(
    Layer.mergeAll(
      Layer.succeed(RepositoryIdentityResolver.RepositoryIdentityResolver, {
        resolve: () => Effect.succeed(null),
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
  ) => Effect.Effect<A, E, WikiService.WikiService | NodeServices.NodeServices | Scope.Scope>,
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

const write = (root: string, files: Readonly<Record<string, string>>) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    for (const [file, content] of Object.entries(files)) {
      yield* fileSystem.writeFileString(path.join(root, file), content).pipe(Effect.orDie);
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

it.effect("registers only a repository's top-level folder, and links a project", () =>
  withWikis((harness) =>
    Effect.gen(function* () {
      const wikis = yield* WikiService.WikiService;
      const plain = yield* harness.folder("plain");
      assert.equal((yield* failure(wikis.register({ root: plain }))).reason, "invalid");

      const { root, summary } = yield* registeredWiki(harness);
      assert.equal(summary.root, root);
      assert.equal(summary.mainBranch, "main");
      assert.isNotNull(summary.projectId);
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
      const editedAt = (notes: ReadonlyArray<{ name: string; editedAt?: string }>) =>
        Object.fromEntries(notes.map((note) => [note.name, note.editedAt]));
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
      const nested = yield* failure(
        wikis.amend({ wikiId, message: "Nested", changes: { "dir/X.md": "x" } }, agent("thread-a")),
      );
      assert.equal(nested.reason, "invalid");
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
      });
      const refused = yield* failure(wikis.merge({ wikiId, changeRequestId: id }));
      assert.equal(refused.reason, "conflict");
      assert.include(refused.message, "Beta.md");
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

it.effect("reads a wiki by name, and searches and links from its index", () =>
  withWikis((harness) =>
    Effect.gen(function* () {
      const { wikis } = yield* registeredWiki(harness, "Atlas");
      const byName = WikiId.make("atlas");
      const found = yield* wikis.search({ wikiId: byName, query: "builds on" });
      assert.deepEqual(found.matches, [
        { name: "Alpha", lines: [{ line: 3, text: "Alpha builds on [[Beta]]." }] },
      ]);
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
