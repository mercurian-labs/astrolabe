import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  CommandId,
  ProjectId,
  projectRootId,
  RootKey,
  type WikiMapBackground,
  WikiId,
} from "@t3tools/contracts";
import type * as SourceControlProvider from "@t3tools/source-control-core/server/SourceControlProvider";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";

import * as ChangeGroupService from "../changeGroups/ChangeGroupService.ts";
import * as ServerConfig from "../config.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as RuntimeLayer from "../orchestration-v2/runtimeLayer.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as ProjectEnrichmentService from "../project/ProjectEnrichmentService.ts";
import * as ProjectFaviconResolver from "../project/ProjectFaviconResolver.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as RepositoryIdentityResolver from "../project/RepositoryIdentityResolver.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as SourceControlProviderRegistry from "../sourceControl/SourceControlProviderRegistry.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as ProjectRoots from "../workspace/ProjectRoots.ts";
import * as TaskFolderStore from "../workspace/TaskFolderStore.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import { migrateWikis } from "./wikiMigration.ts";
import * as WikiService from "./WikiService.ts";
import { type WikiRecord, WikiMigrationJson, WikiRegistryJson } from "./wikiStorage.ts";

const encodeRegistry = Schema.encodeEffect(WikiRegistryJson);
const decodeMigration = Schema.decodeEffect(WikiMigrationJson);

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

const layerNoHosts = Layer.mock(SourceControlProviderRegistry.SourceControlProviderRegistry)({
  resolveLink: () => undefined,
  resolveHandle: () =>
    Effect.succeed({
      provider: {} as SourceControlProvider.SourceControlProvider["Service"],
      context: null,
    }),
});

interface Adopted {
  readonly calls: Array<ChangeGroupService.WikiMemberMigration>;
  /** How many of the next calls fail, as a crash partway through would. */
  failing: number;
}

const layer = (baseDir: string, adopted: Adopted) =>
  WikiService.layer.pipe(
    Layer.provideMerge(
      ProjectRoots.layer.pipe(
        Layer.provide(Layer.mergeAll(ProjectStore.layer, TaskFolderStore.layer, layerNoHosts)),
      ),
    ),
    Layer.provideMerge(
      Layer.mock(ChangeGroupService.ChangeGroupService)({
        adoptWikiMigration: (migration) =>
          Effect.suspend(() => {
            adopted.calls.push(migration);
            if (adopted.failing === 0) return Effect.void;
            adopted.failing -= 1;
            return Effect.die("change groups could not be saved");
          }),
      }),
    ),
    Layer.provideMerge(RuntimeLayer.layerProjectService),
    Layer.provideMerge(layerEnrichment),
    Layer.provideMerge(WorkspacePaths.layer),
    Layer.provideMerge(GitVcsDriver.layer.pipe(Layer.provide(VcsProcess.layer))),
    Layer.provideMerge(SqlitePersistence.layerMemory),
    Layer.provideMerge(ServerSettings.layerTest()),
    Layer.provideMerge(ServerConfig.layerTest(baseDir, baseDir)),
    Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
  );

type Services =
  | WikiService.WikiService
  | ProjectService.ProjectService
  | ProjectRoots.ProjectRoots
  | ServerSettings.ServerSettingsService
  | ChangeGroupService.ChangeGroupService
  | ServerConfig.ServerConfig
  | SecureRandom.SecureRandom
  | NodeServices.NodeServices
  | Scope.Scope;

interface Harness {
  readonly stateDir: string;
  readonly adopted: Adopted;
  /** A fresh Git repository outside the state dir, or below `inside`. */
  readonly repository: (name: string, inside?: string) => Effect.Effect<string>;
  readonly register: (wikis: ReadonlyArray<WikiRecord>) => Effect.Effect<void>;
  readonly project: (
    id: string,
    workspaceRoot: string,
  ) => Effect.Effect<ProjectId, never, Services>;
  readonly exists: (file: string) => Effect.Effect<boolean>;
  readonly migration: Effect.Effect<typeof WikiMigrationJson.Type>;
}

const withMigration = <A, E>(body: (harness: Harness) => Effect.Effect<A, E, Services>) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const baseDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-wiki-migration-" });
    const scratch = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-wiki-folders-" });
    const adopted: Adopted = { calls: [], failing: 0 };
    const config = yield* ServerConfig.ServerConfig.pipe(
      Effect.provide(ServerConfig.layerTest(baseDir, baseDir)),
    );
    const stateFile = (file: string) => path.join(config.stateDir, file);
    const repository = (name: string, inside = scratch) =>
      Effect.gen(function* () {
        const folder = path.join(inside, name);
        yield* fileSystem.makeDirectory(folder, { recursive: true });
        yield* ProcessRunner.ProcessRunner.pipe(
          Effect.flatMap((runner) =>
            runner.run({ command: "git", args: ["-C", folder, "init", "--quiet", "-b", "main"] }),
          ),
          Effect.provide(ProcessRunner.layer),
          Effect.provide(NodeServices.layer),
        );
        return yield* fileSystem.realPath(folder);
      }).pipe(Effect.orDie);
    const register = (wikis: ReadonlyArray<WikiRecord>) =>
      encodeRegistry({ version: 1, wikis }).pipe(
        Effect.flatMap((contents) =>
          fileSystem
            .makeDirectory(config.stateDir, { recursive: true })
            .pipe(Effect.andThen(fileSystem.writeFileString(stateFile("wikis.json"), contents))),
        ),
        Effect.orDie,
      );
    const project = (id: string, workspaceRoot: string) =>
      ProjectService.ProjectService.pipe(
        Effect.flatMap((projects) =>
          projects.create({
            commandId: CommandId.make(`create-${id}`),
            projectId: ProjectId.make(id),
            title: id,
            workspaceRoot,
          }),
        ),
        Effect.map((created) => created.id),
        Effect.orDie,
      );
    const exists = (file: string) => fileSystem.exists(stateFile(file)).pipe(Effect.orDie);
    const migration = fileSystem
      .readFileString(stateFile("wiki-migration.json"))
      .pipe(Effect.flatMap(decodeMigration), Effect.orDie);
    return yield* body({
      stateDir: config.stateDir,
      adopted,
      repository,
      register,
      project,
      exists,
      migration,
    }).pipe(Effect.provide(layer(baseDir, adopted)));
  }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)));

const wiki = (
  id: string,
  root: string,
  fields: Partial<Pick<WikiRecord, "projectIds" | "host" | "mirror" | "mapBackgrounds">> = {},
): WikiRecord => ({
  wikiId: WikiId.make(id),
  name: `Wiki ${id}`,
  root,
  mainBranch: "main",
  projectIds: [],
  projectLinkedAt: {},
  mirror: null,
  host: null,
  mapBackgrounds: [],
  createdAt: "2026-11-01T00:00:00.000Z",
  ...fields,
});

const background = (name: string): WikiMapBackground => ({
  name,
  lightTiles: `https://tiles.example.test/${name}/{z}/{x}/{y}.png?token=secret`,
  darkTiles: null,
});

const trackedPaths = (projectId: ProjectId) =>
  ProjectService.ProjectService.pipe(
    Effect.flatMap((projects) => projects.getById(projectId)),
    Effect.map((found) =>
      found._tag === "Some"
        ? (found.value.trackedFolders ?? [])
            .filter((folder) => folder.discovered !== true)
            .map((folder) => folder.path)
        : [],
    ),
  );

const projectCount = ProjectService.ProjectService.pipe(
  Effect.flatMap((projects) => projects.listShells()),
  Effect.map((shells) => shells.length),
);

it.effect("adds a linked wiki's folder to each project it was linked to", () =>
  withMigration((harness) =>
    Effect.gen(function* () {
      const app = yield* harness.project("app", yield* harness.repository("app"));
      const api = yield* harness.project("api", yield* harness.repository("api"));
      const notes = yield* harness.repository("notes");
      yield* harness.register([wiki("w1", notes, { projectIds: [app, api] })]);

      yield* migrateWikis();

      assert.deepEqual(yield* trackedPaths(app), [notes]);
      assert.deepEqual(yield* trackedPaths(api), [notes]);
      const recorded = yield* harness.migration;
      assert.deepEqual(recorded.wikis[WikiId.make("w1")], {
        projectId: app,
        rootKey: RootKey.make("wiki-w1"),
      });
      assert.isFalse(yield* harness.exists("wikis.json"));
      assert.isTrue(yield* harness.exists("wikis.json.pre-projects"));
      assert.deepEqual(harness.adopted.calls.at(-1)?.wikiIds, new Map([["w1", "app:wiki-w1"]]));
    }),
  ),
);

it.effect("adds no folder for a wiki already inside the project's folder", () =>
  withMigration((harness) =>
    Effect.gen(function* () {
      const appRoot = yield* harness.repository("app");
      const app = yield* harness.project("app", appRoot);
      const docs = yield* harness.repository("docs", appRoot);
      yield* harness.register([
        wiki("inner", docs, { projectIds: [app] }),
        wiki("same", appRoot, { projectIds: [app] }),
      ]);

      yield* migrateWikis();

      assert.deepEqual(yield* trackedPaths(app), []);
      const recorded = yield* harness.migration;
      assert.deepEqual(recorded.wikis[WikiId.make("inner")], {
        projectId: app,
        rootKey: RootKey.make("docs"),
      });
      assert.deepEqual(recorded.wikis[WikiId.make("same")], {
        projectId: app,
        rootKey: RootKey.make("app"),
      });
    }),
  ),
);

it.effect("gives an unlinked wiki its host's project, which stays", () =>
  withMigration((harness) =>
    Effect.gen(function* () {
      const notes = yield* harness.repository("notes");
      const backing = yield* harness.project("backing", notes);
      yield* harness.register([
        wiki("hosted", notes, {
          host: {
            projectId: backing,
            remote: "origin",
            lastSyncedAt: null,
            lastSyncedCommit: null,
            relation: null,
            lastError: null,
            createdProject: true,
          },
        }),
      ]);
      const before = yield* projectCount;

      yield* migrateWikis();

      assert.equal(yield* projectCount, before);
      assert.deepEqual((yield* harness.migration).wikis[WikiId.make("hosted")], {
        projectId: backing,
        rootKey: RootKey.make("notes"),
      });
    }),
  ),
);

it.effect("makes a project of an unlinked wiki without one", () =>
  withMigration((harness) =>
    Effect.gen(function* () {
      const notes = yield* harness.repository("notes");
      yield* harness.register([wiki("alone", notes)]);

      yield* migrateWikis();

      const projects = yield* ProjectService.ProjectService;
      const made = yield* projects.getByWorkspaceRoot(notes);
      assert.isTrue(made._tag === "Some");
      if (made._tag !== "Some") return;
      assert.equal(made.value.title, "Wiki alone");
      assert.deepEqual((yield* harness.migration).wikis[WikiId.make("alone")], {
        projectId: made.value.id,
        rootKey: RootKey.make("notes"),
      });
    }),
  ),
);

it.effect("logs and records each mirror it stops pushing", () =>
  withMigration((harness) =>
    Effect.gen(function* () {
      const notes = yield* harness.repository("notes");
      const url = "https://example.test/acme/notes-mirror.git";
      yield* harness.register([
        wiki("mirrored", notes, {
          mirror: {
            url,
            lastPushedAt: null,
            lastPushedCommit: null,
            lastError: null,
            overwroteRemoteAt: null,
          },
        }),
      ]);
      const warnings: Array<unknown> = [];
      const logger = Logger.make(({ logLevel, message }) => {
        if (logLevel === "Warn") warnings.push(message);
      });

      yield* migrateWikis().pipe(
        Effect.provide(Logger.layer([logger], { mergeWithExisting: false })),
      );

      assert.include(JSON.stringify(warnings), url);
      assert.include(JSON.stringify(warnings), "Wiki mirrored");
      assert.deepEqual((yield* harness.migration).droppedMirrors, [
        { wikiId: WikiId.make("mirrored"), name: "Wiki mirrored", url },
      ]);
    }),
  ),
);

it.effect("carries every wiki's map backgrounds to the server, the first as the default", () =>
  withMigration((harness) =>
    Effect.gen(function* () {
      const app = yield* harness.project("app", yield* harness.repository("app"));
      yield* harness.register([
        wiki("one", yield* harness.repository("one"), {
          projectIds: [app],
          mapBackgrounds: [background("Streets"), background("Satellite")],
        }),
        wiki("two", yield* harness.repository("two"), {
          mapBackgrounds: [background("satellite"), background("Terrain")],
        }),
      ]);

      yield* migrateWikis();

      const settings = yield* (yield* ServerSettings.ServerSettingsService).getSettings;
      assert.deepEqual(
        settings.wikiMapBackgrounds.map(({ name }) => name),
        ["Streets", "Satellite", "Terrain"],
      );
      const root = yield* (yield* WikiService.WikiService).get(
        WikiId.make(projectRootId(app, RootKey.make("wiki-one"))),
      );
      assert.deepEqual(root.mapBackgrounds, settings.wikiMapBackgrounds);
    }),
  ),
);

it.effect("does nothing once the registry is set aside", () =>
  withMigration((harness) =>
    Effect.gen(function* () {
      const app = yield* harness.project("app", yield* harness.repository("app"));
      const notes = yield* harness.repository("notes");
      yield* harness.register([wiki("w1", notes, { projectIds: [app] }), wiki("w2", notes)]);
      yield* migrateWikis();
      const recorded = yield* harness.migration;
      const projects = yield* projectCount;

      yield* migrateWikis();

      assert.deepEqual(yield* harness.migration, recorded);
      assert.equal(yield* projectCount, projects);
      assert.deepEqual(yield* trackedPaths(app), [notes]);
      assert.equal(harness.adopted.calls.length, 1);
    }),
  ),
);

it.effect("runs again whole after a run that failed partway", () =>
  withMigration((harness) =>
    Effect.gen(function* () {
      const app = yield* harness.project("app", yield* harness.repository("app"));
      const linked = yield* harness.repository("linked");
      const alone = yield* harness.repository("alone");
      yield* harness.register([
        wiki("linked", linked, { projectIds: [app] }),
        wiki("alone", alone),
      ]);
      harness.adopted.failing = 1;

      const failed = yield* Effect.exit(migrateWikis());
      assert.isTrue(failed._tag === "Failure");
      assert.isTrue(yield* harness.exists("wikis.json"));
      assert.isFalse(yield* harness.exists("wiki-migration.json"));
      const projects = yield* projectCount;

      yield* migrateWikis();

      assert.equal(yield* projectCount, projects);
      assert.deepEqual(yield* trackedPaths(app), [linked]);
      assert.deepEqual(Object.keys((yield* harness.migration).wikis).toSorted(), [
        "alone",
        "linked",
      ]);
      assert.isFalse(yield* harness.exists("wikis.json"));
    }),
  ),
);

it.effect("still finds a wiki by its old id, as the project root it became", () =>
  withMigration((harness) =>
    Effect.gen(function* () {
      const app = yield* harness.project("app", yield* harness.repository("app"));
      const notes = yield* harness.repository("notes");
      yield* harness.register([wiki("w1", notes, { projectIds: [app] })]);
      const wikis = yield* WikiService.WikiService;
      assert.equal((yield* wikis.get(WikiId.make("w1"))).wikiId, "w1");

      yield* migrateWikis();

      const found = yield* wikis.get(WikiId.make("w1"));
      assert.equal<string>(found.wikiId, projectRootId(app, RootKey.make("wiki-w1")));
      assert.equal(found.root, notes);
      assert.equal(yield* wikis.root(WikiId.make("w1")), notes);
      assert.deepEqual(
        (yield* wikis.list).wikis.map((entry) => entry.wikiId).toSorted(),
        [projectRootId(app, RootKey.make("app")), found.wikiId].toSorted(),
      );
    }),
  ),
);
