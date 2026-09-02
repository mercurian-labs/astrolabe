import { assert, it } from "@effect/vitest";
import { layer as NodeServicesLayer } from "@effect/platform-node/NodeServices";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import {
  isConfirmMemoryAmendmentBlockedError,
  isProductMapAlreadyExistsError,
  MercurianProjectId,
  MercurianRepositoryId,
  PlanTurnId,
} from "@t3tools/contracts";

import * as ProcessRunner from "../../processRunner.ts";
import * as MercurianSqlite from "../persistence/Sqlite.ts";
import * as MemoryIndex from "./MemoryIndex.ts";
import * as MemorySourceStore from "./MemorySourceStore.ts";

const layer = it.layer(
  MemoryIndex.layer.pipe(
    Layer.provideMerge(MemorySourceStore.layer),
    Layer.provideMerge(MercurianSqlite.layerMemory),
    Layer.provideMerge(ProcessRunner.layer),
    Layer.provideMerge(NodeServicesLayer),
  ),
);
const now = DateTime.makeUnsafe("2026-08-27T00:00:00.000Z");

const runGit = Effect.fn("test.runGit")(function* (cwd: string, args: ReadonlyArray<string>) {
  const runner = yield* ProcessRunner.ProcessRunner;
  const result = yield* runner.run({ command: "git", args: ["-C", cwd, ...args] });
  assert.strictEqual(result.code, 0, result.stderr);
  return result.stdout.trim();
});

const makeFixture = Effect.fn("test.makeMemoryFixture")(function* (
  suffix: string,
  options: { readonly git?: boolean } = {},
) {
  const fs = yield* FileSystem.FileSystem;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: `mercurian-memory-${suffix}-` });
  if (options.git === true) {
    yield* runGit(root, ["init"]);
    yield* runGit(root, ["config", "user.name", "Memory Test"]);
    yield* runGit(root, ["config", "user.email", "memory@example.com"]);
  }
  const repositoryId = MercurianRepositoryId.make(`memory-index-${suffix}`);
  const projectId = MercurianProjectId.make(`memory-index-project-${suffix}`);
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    INSERT INTO repositories (repository_id, name, path, created_at, updated_at)
    VALUES (${repositoryId}, ${suffix}, ${root}, '2026-08-27', '2026-08-27')
  `;
  const store = yield* MemorySourceStore.MemorySourceStore;
  yield* store.designate({ projectId, repositoryId, now });
  return { root, projectId };
});

layer("MemoryIndex", (it) => {
  it.effect("uses git discovery so the memory's gitignore governs", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const index = yield* MemoryIndex.MemoryIndex;
      const fixture = yield* makeFixture("gitignore", { git: true });
      yield* fs.writeFileString(path.join(fixture.root, ".gitignore"), "logseq/\n");
      yield* fs.writeFileString(path.join(fixture.root, "Visible.md"), "visible");
      yield* fs.makeDirectory(path.join(fixture.root, "logseq"));
      yield* fs.writeFileString(path.join(fixture.root, "logseq", "Ignored.md"), "ignored");

      const result = yield* index.readIndex(fixture.projectId);
      assert.deepStrictEqual(
        result.notes.map(({ name }) => name),
        ["Visible"],
      );
    }),
  );

  it.effect("classifies skill maps before notes and surfaces legacy YAML maps as refusals", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const index = yield* MemoryIndex.MemoryIndex;
      const fixture = yield* makeFixture("walk");
      yield* fs.writeFileString(path.join(fixture.root, "Visible.md"), "visible");
      yield* fs.makeDirectory(path.join(fixture.root, ".private"));
      yield* fs.writeFileString(path.join(fixture.root, ".private", "Hidden.md"), "hidden");
      yield* fs.makeDirectory(path.join(fixture.root, "maps"));
      yield* fs.writeFileString(path.join(fixture.root, "maps", "NotANote.md"), "map");
      yield* fs.writeFileString(
        path.join(fixture.root, "Product.skillmap.md"),
        "---\nname: Product\npurpose: Structure\ntypes:\n  contains: Child territory.\nedges: []\n---\nTeaching.\n",
      );
      yield* fs.writeFileString(
        path.join(fixture.root, "maps", "old.yaml"),
        "name: Old\npurpose: Old shape\narrangement: []\n",
      );

      const result = yield* index.readIndex(fixture.projectId);
      assert.deepStrictEqual(
        result.notes.map(({ name }) => name),
        ["Visible"],
      );
      assert.strictEqual(result.maps.length, 2);
      assert.deepStrictEqual(
        result.maps.find((map) => !("refusal" in map)),
        {
          file: "Product.skillmap.md",
          name: "Product",
          purpose: "Structure",
          types: [{ name: "contains", meaning: "Child territory." }],
          edges: [],
          body: "Teaching.\n",
        },
      );
      const legacy = result.maps.find((map) => "refusal" in map);
      assert.include(
        legacy !== undefined && "refusal" in legacy ? legacy.refusal : "",
        "maps/old.yaml: superseded tree-YAML map — rewrite it as a .skillmap.md skill map",
      );
    }),
  );

  it.effect("reflects an external edit on the next read and reads red links", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const index = yield* MemoryIndex.MemoryIndex;
      const fixture = yield* makeFixture("freshness");
      const plansPath = path.join(fixture.root, "Plans.md");
      yield* fs.writeFileString(plansPath, "No links.");
      assert.deepStrictEqual((yield* index.readIndex(fixture.projectId)).unresolved, []);

      yield* fs.writeFileString(plansPath, "Now links to [[Future Design]].");
      assert.deepStrictEqual((yield* index.readIndex(fixture.projectId)).unresolved, [
        { name: "Future Design", referencedBy: ["Plans"] },
      ]);
      const unwritten = yield* index.readNote(fixture.projectId, "Future Design");
      assert.strictEqual(unwritten.exists, false);
      assert.deepStrictEqual(unwritten.backlinks, ["Plans"]);
      const plans = yield* index.readNote(fixture.projectId, "Plans");
      assert.strictEqual(plans.exists, true);
      assert.deepStrictEqual(plans.links, [{ name: "Future Design", exists: false }]);
    }),
  );

  it.effect("writes and commits a generated product map, then refuses replacement", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const index = yield* MemoryIndex.MemoryIndex;
      const fixture = yield* makeFixture("generate", { git: true });
      yield* fs.writeFileString(path.join(fixture.root, "Product.md"), "contains:: [[Composer]]\n");
      yield* fs.writeFileString(path.join(fixture.root, "Composer.md"), "A component.\n");
      yield* runGit(fixture.root, ["add", "Product.md", "Composer.md"]);
      yield* runGit(fixture.root, ["commit", "-m", "Seed memory"]);

      const offer = (yield* index.readIndex(fixture.projectId)).productMapOffer;
      assert.deepStrictEqual(offer, { declarationCount: 1 });
      yield* index.generateProductMap(fixture.projectId);
      const productPath = path.join(fixture.root, "Product.skillmap.md");
      assert.isTrue(yield* fs.exists(productPath));
      assert.include(
        yield* fs.readFileString(productPath),
        "Use this map to orient by containment",
      );
      assert.strictEqual(
        yield* runGit(fixture.root, ["log", "-1", "--pretty=%s"]),
        "Generate product map from containment declarations",
      );
      assert.deepStrictEqual((yield* index.readIndex(fixture.projectId)).productMapOffer, null);

      const error = yield* Effect.flip(index.generateProductMap(fixture.projectId));
      assert.isTrue(isProductMapAlreadyExistsError(error));
      assert.strictEqual(error.message, "Product.skillmap.md already exists");
    }),
  );

  it.effect("applies note and placement as one attributed commit and resolves a red link", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const index = yield* MemoryIndex.MemoryIndex;
      const fixture = yield* makeFixture("apply-amendment", { git: true });
      yield* fs.writeFileString(path.join(fixture.root, "Product.md"), "See [[Composer]].\n");
      yield* fs.writeFileString(
        path.join(fixture.root, "Product.skillmap.md"),
        "---\nname: Product\npurpose: Product structure\ntypes:\n  contains: Child territory.\n  depends-on: Source needs target.\nedges: []\n---\nTeach from the product root.\n",
      );
      yield* runGit(fixture.root, ["add", "Product.md", "Product.skillmap.md"]);
      yield* runGit(fixture.root, ["commit", "-m", "Seed memory"]);

      const proposal = yield* index.prepareAmendment({
        projectId: fixture.projectId,
        turnId: PlanTurnId.make("turn-amendment"),
        amendment: {
          title: "Record the composer boundary",
          notes: [{ name: "Composer", markdown: "The composer belongs to [[Product]].\n" }],
          placements: [{ map: "Product", parent: "Product", note: "Composer", type: "contains" }],
        },
      });
      assert.include(proposal.patch, "Composer.md");
      assert.include(proposal.patch, "Product.skillmap.md");
      assert.notInclude(proposal.patch, "before/");
      assert.notInclude(proposal.patch, "after/");
      const sha = yield* index.applyAmendment({
        projectId: fixture.projectId,
        proposal,
        planId: "plan-181",
        planName: "Project memory amendments",
      });
      assert.isString(sha);
      assert.strictEqual(
        yield* runGit(fixture.root, ["log", "-1", "--pretty=%B"]),
        "Record the composer boundary\n\nAmended-from-plan: Project memory amendments (plan-181)",
      );
      const note = yield* index.readNote(fixture.projectId, "Composer");
      assert.strictEqual(note.exists, true);
      const memory = yield* index.readIndex(fixture.projectId);
      assert.deepStrictEqual(memory.unresolved, []);
      const productMap = memory.maps.find((map) => !("refusal" in map));
      assert.deepStrictEqual(
        productMap !== undefined && !("refusal" in productMap) ? productMap.edges : [],
        [{ from: "Product", type: "contains", to: "Composer" }],
      );
      assert.strictEqual(
        productMap !== undefined && !("refusal" in productMap) ? productMap.body : "",
        "Teach from the product root.\n",
      );
    }),
  );

  it.effect("prepares a note edit that removes an Open Decisions heading", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const index = yield* MemoryIndex.MemoryIndex;
      const fixture = yield* makeFixture("remove-open-decision-heading", { git: true });
      const notePath = path.join(fixture.root, "Plans.md");
      const before = "# Plans\n\n## Open Decisions\n\n### Which shape?\n\nStill open.\n";
      const after = "# Plans\n\n## Open Decisions\n\nNo outstanding questions.\n";
      yield* fs.writeFileString(notePath, before);
      yield* runGit(fixture.root, ["add", "Plans.md"]);
      yield* runGit(fixture.root, ["commit", "-m", "Seed memory"]);

      const proposal = yield* index.prepareAmendment({
        projectId: fixture.projectId,
        turnId: PlanTurnId.make("turn-remove-open-decision-heading"),
        amendment: {
          title: "Retire the answered question",
          notes: [{ name: "Plans", markdown: after }],
          placements: [],
        },
      });

      assert.deepStrictEqual(proposal.changes, [{ path: "Plans.md", before, after }]);
      assert.include(proposal.patch, "-### Which shape?");
    }),
  );

  it.effect("refuses amendment drift before touching any proposed file", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const index = yield* MemoryIndex.MemoryIndex;
      const fixture = yield* makeFixture("amendment-drift", { git: true });
      const notePath = path.join(fixture.root, "Plans.md");
      yield* fs.writeFileString(notePath, "Before\n");
      yield* runGit(fixture.root, ["add", "Plans.md"]);
      yield* runGit(fixture.root, ["commit", "-m", "Seed"]);
      const proposal = yield* index.prepareAmendment({
        projectId: fixture.projectId,
        turnId: PlanTurnId.make("turn-drift"),
        amendment: {
          title: "Change plans",
          notes: [{ name: "Plans", markdown: "After\n" }],
          placements: [],
        },
      });
      yield* fs.writeFileString(notePath, "External\n");
      const error = yield* Effect.flip(
        index.applyAmendment({
          projectId: fixture.projectId,
          proposal,
          planId: "plan-drift",
          planName: "Drift",
        }),
      );
      assert.isTrue(isConfirmMemoryAmendmentBlockedError(error));
      assert.strictEqual(yield* fs.readFileString(notePath), "External\n");
    }),
  );
});
