import { StorageSourceStore } from "../storage/StorageSourceStore.ts";
import { assert, it } from "@effect/vitest";
import { layer as NodeServicesLayer } from "@effect/platform-node/NodeServices";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { MercurianProjectId, MercurianRepositoryId } from "@t3tools/contracts";

import * as Config from "../../config.ts";
import * as ProcessRunner from "../../processRunner.ts";
import * as MercurianSqlite from "../persistence/Sqlite.ts";
import * as RepositoryStore from "./RepositoryStore.ts";

const at = DateTime.makeUnsafe("2026-08-06T00:00:00.000Z");

/**
 * The git probes, scripted per test. `git` runs against real directories in
 * these tests would make "is this a repository" a fact about the machine the
 * suite happens to run on; the store's contract is what it does with the
 * answer, so the answer is the thing that gets fixtured.
 */
interface GitScript {
  /** Paths the probe reports as repositories. Everything else is not one. */
  readonly repositories: ReadonlySet<string>;
  /** Worktree paths `git worktree list --porcelain` reports, per repository. */
  readonly worktreesByPath: ReadonlyMap<string, ReadonlyArray<string>>;
  /** `git remote -v` output, per repository. */
  readonly remotesByPath: ReadonlyMap<string, string>;
}

const emptyGitScript: GitScript = {
  repositories: new Set(),
  worktreesByPath: new Map(),
  remotesByPath: new Map(),
};

let gitScript: GitScript = emptyGitScript;
let remoteProbeRuns = new Map<string, number>();

const setGitScript = (next: Partial<GitScript>) =>
  Effect.sync(() => {
    gitScript = { ...emptyGitScript, ...next };
    remoteProbeRuns = new Map();
  });

const remoteProbeCount = (repositoryPath: string) => remoteProbeRuns.get(repositoryPath) ?? 0;

const stubProcessRunner = Layer.succeed(
  ProcessRunner.ProcessRunner,
  ProcessRunner.ProcessRunner.of({
    run: (input) => {
      const cwd = input.args[1] ?? "";
      const verb = input.args[2] ?? "";
      const isRepository = gitScript.repositories.has(cwd);
      if (verb === "rev-parse") {
        return Effect.succeed({
          stdout: isRepository ? `${cwd}\n` : "",
          stderr: isRepository ? "" : "fatal: not a git repository",
          code: (isRepository ? 0 : 128) as never,
          timedOut: false,
          stdoutTruncated: false,
          stderrTruncated: false,
          stdoutInvalidUtf8: false,
          stderrInvalidUtf8: false,
        });
      }
      if (verb === "remote") {
        remoteProbeRuns.set(cwd, remoteProbeCount(cwd) + 1);
        return Effect.succeed({
          stdout: gitScript.remotesByPath.get(cwd) ?? "",
          stderr: "",
          code: 0 as never,
          timedOut: false,
          stdoutTruncated: false,
          stderrTruncated: false,
          stdoutInvalidUtf8: false,
          stderrInvalidUtf8: false,
        });
      }
      const worktrees = gitScript.worktreesByPath.get(cwd) ?? [];
      return Effect.succeed({
        stdout: worktrees.map((worktreePath) => `worktree ${worktreePath}\n`).join("\n"),
        stderr: "",
        code: 0 as never,
        timedOut: false,
        stdoutTruncated: false,
        stderrTruncated: false,
        stdoutInvalidUtf8: false,
        stderrInvalidUtf8: false,
      });
    },
  }),
);

const layer = it.layer(
  RepositoryStore.layer.pipe(
    Layer.provideMerge(stubProcessRunner),
    Layer.provideMerge(MercurianSqlite.layerMemory),
    Layer.provideMerge(Config.layerTest(process.cwd(), { prefix: "mercurian-repositories-" })),
    Layer.provideMerge(NodeServicesLayer),
  ),
);

/** A real directory to register — path resolution is not stubbed. */
const makeDirectory = Effect.fn("test.makeDirectory")(function* (name: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const base = yield* fs.makeTempDirectoryScoped({ prefix: "mercurian-repo-" });
  const directory = path.join(base, name);
  yield* fs.makeDirectory(directory, { recursive: true });
  // Resolved, because that is the spelling the store stores.
  return yield* fs.realPath(directory);
});

/**
 * The store under test is one layer for the whole file, so every assertion
 * scopes itself to the rows its own test made rather than to the database.
 */
const findRepository = (snapshot: RepositoryStore.RepositoriesSnapshot, repositoryId: string) =>
  snapshot.repositories.find((repository) => repository.repositoryId === repositoryId);

const repositoriesOfProject = (snapshot: RepositoryStore.RepositoriesSnapshot, projectId: string) =>
  snapshot.projectRepositories
    .filter((link) => link.projectId === projectId)
    .map((link) => link.repositoryId);

const insertProject = (projectId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      INSERT INTO projects (project_id, name, created_at, updated_at)
      VALUES (${projectId}, ${projectId}, '2026-08-06', '2026-08-06')
    `;
    return MercurianProjectId.make(projectId);
  });

layer("RepositoryStore", (it) => {
  it.effect(
    "adds storage worktrees without changing code context and retains previous document repositories",
    () =>
      Effect.gen(function* () {
        const store = yield* RepositoryStore.RepositoryStore;
        const storage = yield* StorageSourceStore;
        const code = yield* store.addRepository({
          path: yield* makeDirectory("code-with-docs"),
          createdAt: at,
        });
        const documents = yield* store.addRepository({
          path: yield* makeDirectory("document-repository"),
          createdAt: at,
        });
        const projectId = yield* insertProject("project-with-document-locations");
        yield* store.setProjectRepositories({
          projectId,
          repositoryIds: [code.repositoryId],
          addedAt: at,
        });
        yield* storage.designate({
          projectId,
          repositoryId: code.repositoryId,
          kind: "plan",
          subpath: "plans",
          now: at,
        });
        yield* storage.designate({
          projectId,
          repositoryId: documents.repositoryId,
          kind: "spec",
          subpath: "specs",
          now: at,
        });
        assert.deepStrictEqual(repositoriesOfProject(yield* store.getSnapshot, projectId), [
          code.repositoryId,
        ]);
        assert.deepStrictEqual(repositoriesOfProject(yield* store.getWorkingSnapshot, projectId), [
          code.repositoryId,
          documents.repositoryId,
        ]);
        yield* storage.remove(projectId, "spec");
        assert.deepStrictEqual(repositoriesOfProject(yield* store.getWorkingSnapshot, projectId), [
          code.repositoryId,
          documents.repositoryId,
        ]);
      }),
  );

  it.effect("registers a directory, naming it after its last segment", () =>
    Effect.gen(function* () {
      yield* setGitScript({});
      const store = yield* RepositoryStore.RepositoryStore;
      const directory = yield* makeDirectory("astrolabe");

      const added = yield* store.addRepository({ path: directory, createdAt: at });
      assert.strictEqual(added.name, "astrolabe");
      assert.strictEqual(added.path, directory);
      assert.deepStrictEqual([...added.scripts], []);

      const snapshot = yield* store.getSnapshot;
      const seen = findRepository(snapshot, added.repositoryId);
      assert.strictEqual(seen?.name, "astrolabe");
      assert.strictEqual(seen?.path, directory);
    }),
  );

  it.effect("takes the name it is given, and resolves the path before storing it", () =>
    Effect.gen(function* () {
      yield* setGitScript({});
      const store = yield* RepositoryStore.RepositoryStore;
      const path = yield* Path.Path;
      const directory = yield* makeDirectory("astrolabe");

      const added = yield* store.addRepository({
        // A spelling that resolves to the same place.
        path: path.join(directory, "..", "astrolabe"),
        name: "Astrolabe",
        createdAt: at,
      });
      assert.strictEqual(added.name, "Astrolabe");
      assert.strictEqual(added.path, directory);
    }),
  );

  it.effect("does not demand git: a plain directory registers and reads hasGit false", () =>
    Effect.gen(function* () {
      yield* setGitScript({});
      const store = yield* RepositoryStore.RepositoryStore;
      const directory = yield* makeDirectory("plain");

      const added = yield* store.addRepository({ path: directory, createdAt: at });
      assert.strictEqual(added.hasGit, false);
      assert.strictEqual(added.hosting, null);
      assert.strictEqual(remoteProbeCount(directory), 0);

      const snapshot = yield* store.getSnapshot;
      assert.strictEqual(findRepository(snapshot, added.repositoryId)?.hasGit, false);

      // Nothing about git is stored, so nothing about it can be stale.
      const sql = yield* SqlClient.SqlClient;
      const columns = yield* sql<{ readonly name: string }>`PRAGMA table_info(repositories)`;
      assert.ok(!columns.some((column) => column.name.includes("git")));
    }),
  );

  it.effect("derives hosting from fetch remotes, preferring origin", () =>
    Effect.gen(function* () {
      const store = yield* RepositoryStore.RepositoryStore;
      const directory = yield* makeDirectory("origin-wins");
      yield* setGitScript({
        repositories: new Set([directory]),
        remotesByPath: new Map([
          [
            directory,
            [
              "fork\tgit@gitlab.com:someone/fork.git (fetch)",
              "fork\tgit@gitlab.com:someone/fork.git (push)",
              "origin\thttps://github.com/mercurian-labs/astrolabe.git (fetch)",
              "origin\thttps://github.com/mercurian-labs/astrolabe.git (push)",
            ].join("\n"),
          ],
        ]),
      });

      const repository = yield* store.addRepository({ path: directory, createdAt: at });
      assert.deepStrictEqual(repository.hosting, {
        provider: "github",
        providerName: "GitHub",
        remoteName: "origin",
        remoteUrl: "https://github.com/mercurian-labs/astrolabe.git",
      });
    }),
  );

  it.effect("uses the single non-origin fetch remote", () =>
    Effect.gen(function* () {
      const store = yield* RepositoryStore.RepositoryStore;
      const directory = yield* makeDirectory("single-remote");
      yield* setGitScript({
        repositories: new Set([directory]),
        remotesByPath: new Map([[directory, "upstream\tgit@gitlab.com:group/project.git (fetch)"]]),
      });

      const repository = yield* store.addRepository({ path: directory, createdAt: at });
      assert.strictEqual(repository.hosting?.provider, "gitlab");
      assert.strictEqual(repository.hosting?.remoteName, "upstream");
    }),
  );

  it.effect("classifies supported hosting URL shapes and preserves unknown hosts", () =>
    Effect.gen(function* () {
      const store = yield* RepositoryStore.RepositoryStore;
      const cases = [
        ["github", "git@github.com:owner/repo.git", "github", "GitHub"],
        ["gitlab", "https://gitlab.com/group/repo.git", "gitlab", "GitLab"],
        ["bitbucket", "ssh://git@bitbucket.org/workspace/repo.git", "bitbucket", "Bitbucket"],
        ["azure", "https://dev.azure.com/org/project/_git/repo", "azure-devops", "Azure DevOps"],
        ["unknown", "ssh://git@git.example.test/team/repo.git", "unknown", "git.example.test"],
      ] as const;

      for (const [name, remoteUrl, provider, providerName] of cases) {
        const directory = yield* makeDirectory(name);
        yield* setGitScript({
          repositories: new Set([directory]),
          remotesByPath: new Map([[directory, `origin\t${remoteUrl} (fetch)`]]),
        });
        const repository = yield* store.addRepository({ path: directory, createdAt: at });
        assert.strictEqual(repository.hosting?.provider, provider);
        assert.strictEqual(repository.hosting?.providerName, providerName);
      }
    }),
  );

  it.effect("returns no hosting for a git repository without remotes", () =>
    Effect.gen(function* () {
      const store = yield* RepositoryStore.RepositoryStore;
      const directory = yield* makeDirectory("no-remotes");
      yield* setGitScript({ repositories: new Set([directory]) });

      const repository = yield* store.addRepository({ path: directory, createdAt: at });
      assert.strictEqual(repository.hasGit, true);
      assert.strictEqual(repository.hosting, null);
      assert.strictEqual(remoteProbeCount(directory), 1);
    }),
  );

  it.effect("carries hosting in snapshots without storing provider or auth columns", () =>
    Effect.gen(function* () {
      const store = yield* RepositoryStore.RepositoryStore;
      const sql = yield* SqlClient.SqlClient;
      const directory = yield* makeDirectory("derived-hosting");
      yield* setGitScript({
        repositories: new Set([directory]),
        remotesByPath: new Map([[directory, "origin\thttps://github.com/owner/repo.git (fetch)"]]),
      });
      const repository = yield* store.addRepository({ path: directory, createdAt: at });

      const snapshot = yield* store.getSnapshot;
      assert.strictEqual(
        findRepository(snapshot, repository.repositoryId)?.hosting?.provider,
        "github",
      );
      const columns = yield* sql<{ readonly name: string }>`PRAGMA table_info(repositories)`;
      assert.ok(!columns.some((column) => /provider|auth|hosting/u.test(column.name)));
    }),
  );

  it.effect("refreshes cached repository facts and signals the snapshot stream", () =>
    Effect.gen(function* () {
      const store = yield* RepositoryStore.RepositoryStore;
      const directory = yield* makeDirectory("refresh-hosting");
      yield* setGitScript({
        repositories: new Set([directory]),
        remotesByPath: new Map([[directory, "origin\thttps://github.com/owner/repo.git (fetch)"]]),
      });
      const repository = yield* store.addRepository({ path: directory, createdAt: at });
      assert.strictEqual(repository.hosting?.provider, "github");
      assert.strictEqual(remoteProbeCount(directory), 1);

      gitScript = {
        ...gitScript,
        remotesByPath: new Map([[directory, "origin\thttps://gitlab.com/group/repo.git (fetch)"]]),
      };
      const cached = yield* store.getSnapshot;
      assert.strictEqual(
        findRepository(cached, repository.repositoryId)?.hosting?.provider,
        "github",
      );
      assert.strictEqual(remoteProbeCount(directory), 1);

      const change = yield* Effect.forkChild(Stream.runCollect(Stream.take(store.changes, 1)), {
        startImmediately: true,
      });
      yield* store.refreshRepositories;
      assert.strictEqual((yield* Fiber.join(change)).length, 1);

      const refreshed = yield* store.getSnapshot;
      assert.strictEqual(
        findRepository(refreshed, repository.repositoryId)?.hosting?.provider,
        "gitlab",
      );
      assert.strictEqual(remoteProbeCount(directory), 2);
    }),
  );

  it.effect("lights up on its own once the directory is a repository", () =>
    Effect.gen(function* () {
      yield* setGitScript({});
      const store = yield* RepositoryStore.RepositoryStore;
      const directory = yield* makeDirectory("becomes-git");
      const added = yield* store.addRepository({ path: directory, createdAt: at });
      assert.strictEqual(added.hasGit, false);

      // `git init` happens; the probe is what changes, and nothing is
      // rescanned. A second store reads the same rows — this is the TTL
      // expiring, without the test waiting a minute for it.
      yield* setGitScript({ repositories: new Set([directory]) });
      const fresh = yield* RepositoryStore.make;
      const snapshot = yield* fresh.getSnapshot;
      assert.strictEqual(findRepository(snapshot, added.repositoryId)?.hasGit, true);
    }),
  );

  it.effect("refuses a path that is not a directory", () =>
    Effect.gen(function* () {
      yield* setGitScript({});
      const store = yield* RepositoryStore.RepositoryStore;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* makeDirectory("with-a-file");
      const file = path.join(directory, "README.md");
      yield* fs.writeFileString(file, "hello");

      const missing = yield* store
        .addRepository({ path: path.join(directory, "nowhere"), createdAt: at })
        .pipe(Effect.flip);
      assert.strictEqual(missing._tag, "RepositoryPathInvalidError");

      const notADirectory = yield* store
        .addRepository({ path: file, createdAt: at })
        .pipe(Effect.flip);
      assert.strictEqual(notADirectory._tag, "RepositoryPathInvalidError");
    }),
  );

  it.effect("refuses a second registration of the same path, and names the first", () =>
    Effect.gen(function* () {
      yield* setGitScript({});
      const store = yield* RepositoryStore.RepositoryStore;
      const directory = yield* makeDirectory("astrolabe");
      const first = yield* store.addRepository({
        path: directory,
        name: "Astrolabe",
        createdAt: at,
      });

      const refusal = yield* store
        .addRepository({ path: directory, createdAt: at })
        .pipe(Effect.flip);
      assert.strictEqual(refusal._tag, "RepositoryAlreadyRegisteredError");
      if (refusal._tag === "RepositoryAlreadyRegisteredError") {
        assert.strictEqual(refusal.repositoryId, first.repositoryId);
        assert.strictEqual(refusal.name, "Astrolabe");
      }
    }),
  );

  it.effect("replaces the script list, keeping carried ids and minting the rest", () =>
    Effect.gen(function* () {
      yield* setGitScript({});
      const store = yield* RepositoryStore.RepositoryStore;
      const directory = yield* makeDirectory("scripted");
      const repository = yield* store.addRepository({ path: directory, createdAt: at });

      const saved = yield* store.saveScripts({
        repositoryId: repository.repositoryId,
        scripts: [
          {
            name: "Dev server",
            command: "pnpm dev",
            previewUrl: "http://localhost:3000",
            isSetup: false,
          },
          { name: "Install", command: "pnpm i", isSetup: true },
          // Same name twice: a suffix, not one script eating the other.
          { name: "Install", command: "pnpm i --frozen-lockfile", isSetup: true },
        ],
        updatedAt: at,
      });

      assert.deepStrictEqual(
        saved.scripts.map((script) => script.scriptId),
        ["dev-server", "install", "install-2"],
      );
      assert.strictEqual(saved.scripts[0]?.previewUrl, "http://localhost:3000");
      assert.strictEqual(saved.scripts[0]?.isSetup, false);
      assert.strictEqual(saved.scripts[1]?.isSetup, true);
      // Declared order is the order it reads back in.
      assert.deepStrictEqual(
        saved.scripts.map((script) => script.command),
        ["pnpm dev", "pnpm i", "pnpm i --frozen-lockfile"],
      );

      // An edit carries its id, so it stays the same script; the new one gets
      // its own, and the dropped one is gone.
      const edited = yield* store.saveScripts({
        repositoryId: repository.repositoryId,
        scripts: [
          {
            scriptId: saved.scripts[1]!.scriptId,
            name: "Install",
            command: "pnpm i",
            isSetup: false,
          },
          { name: "Test", command: "pnpm test", isSetup: false },
        ],
        updatedAt: at,
      });
      assert.deepStrictEqual(
        edited.scripts.map((script) => script.scriptId),
        ["install", "test"],
      );
      assert.strictEqual(edited.scripts[0]?.isSetup, false);
      assert.strictEqual(edited.scripts[0]?.previewUrl, undefined);
    }),
  );

  it.effect("refuses scripts for a repository that does not exist", () =>
    Effect.gen(function* () {
      const store = yield* RepositoryStore.RepositoryStore;
      const refusal = yield* store
        .saveScripts({
          repositoryId: MercurianRepositoryId.make("nowhere"),
          scripts: [],
          updatedAt: at,
        })
        .pipe(Effect.flip);
      assert.strictEqual(refusal._tag, "MercurianRepositoryNotFoundError");
    }),
  );

  it.effect("replaces a project's repository set, and refuses unknown ends", () =>
    Effect.gen(function* () {
      yield* setGitScript({});
      const store = yield* RepositoryStore.RepositoryStore;
      const projectId = yield* insertProject("project-a");
      const first = yield* store.addRepository({
        path: yield* makeDirectory("one"),
        createdAt: at,
      });
      const second = yield* store.addRepository({
        path: yield* makeDirectory("two"),
        createdAt: at,
      });

      yield* store.setProjectRepositories({
        projectId,
        repositoryIds: [first.repositoryId, second.repositoryId],
        addedAt: at,
      });
      const both = yield* store.getSnapshot;
      assert.deepStrictEqual(
        repositoriesOfProject(both, projectId).toSorted(),
        [first.repositoryId, second.repositoryId].toSorted(),
      );

      yield* store.setProjectRepositories({
        projectId,
        repositoryIds: [second.repositoryId],
        addedAt: at,
      });
      const narrowed = yield* store.getSnapshot;
      assert.deepStrictEqual(repositoriesOfProject(narrowed, projectId), [second.repositoryId]);

      const unknownProject = yield* store
        .setProjectRepositories({
          projectId: MercurianProjectId.make("nowhere"),
          repositoryIds: [],
          addedAt: at,
        })
        .pipe(Effect.flip);
      assert.strictEqual(unknownProject._tag, "MercurianProjectNotFoundError");

      const unknownRepository = yield* store
        .setProjectRepositories({
          projectId,
          repositoryIds: [MercurianRepositoryId.make("nowhere")],
          addedAt: at,
        })
        .pipe(Effect.flip);
      assert.strictEqual(unknownRepository._tag, "MercurianRepositoryNotFoundError");
      // Refused whole: the set it already had is untouched.
      const unchanged = yield* store.getSnapshot;
      assert.deepStrictEqual(repositoriesOfProject(unchanged, projectId), [second.repositoryId]);
    }),
  );

  it.effect("removal disconnects: the row, its scripts, and its memberships", () =>
    Effect.gen(function* () {
      yield* setGitScript({});
      const store = yield* RepositoryStore.RepositoryStore;
      const sql = yield* SqlClient.SqlClient;
      const projectId = yield* insertProject("project-b");
      const repository = yield* store.addRepository({
        path: yield* makeDirectory("doomed"),
        createdAt: at,
      });
      yield* store.saveScripts({
        repositoryId: repository.repositoryId,
        scripts: [{ name: "Dev", command: "pnpm dev", isSetup: false }],
        updatedAt: at,
      });
      yield* store.setProjectRepositories({
        projectId,
        repositoryIds: [repository.repositoryId],
        addedAt: at,
      });

      yield* store.removeRepository({ repositoryId: repository.repositoryId });

      const snapshot = yield* store.getSnapshot;
      assert.strictEqual(findRepository(snapshot, repository.repositoryId), undefined);
      assert.deepStrictEqual(repositoriesOfProject(snapshot, projectId), []);
      const scripts = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS "count"
        FROM repository_scripts
        WHERE repository_id = ${repository.repositoryId}
      `;
      assert.strictEqual(scripts[0]?.count, 0);
      // The project itself is untouched: removal disconnects, it does not
      // reach into what the repository was context for.
      const projects = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS "count" FROM projects WHERE project_id = ${projectId}
      `;
      assert.strictEqual(projects[0]?.count, 1);
    }),
  );

  it.effect("refuses removal while the app holds a live worktree", () =>
    Effect.gen(function* () {
      const store = yield* RepositoryStore.RepositoryStore;
      const config = yield* Config.ServerConfig;
      const path = yield* Path.Path;
      const directory = yield* makeDirectory("busy");
      yield* setGitScript({
        repositories: new Set([directory]),
        worktreesByPath: new Map([
          [directory, [directory, path.join(config.worktreesDir, "session-1")]],
        ]),
      });

      const repository = yield* store.addRepository({ path: directory, createdAt: at });
      const refusal = yield* store
        .removeRepository({ repositoryId: repository.repositoryId })
        .pipe(Effect.flip);
      assert.strictEqual(refusal._tag, "RepositoryHasLiveWorktreesError");
      if (refusal._tag === "RepositoryHasLiveWorktreesError") {
        assert.strictEqual(refusal.worktreeCount, 1);
      }

      // Nothing was deleted.
      const snapshot = yield* store.getSnapshot;
      assert.ok(findRepository(snapshot, repository.repositoryId) !== undefined);
    }),
  );

  it.effect("counts project slot membership as a live worktree", () =>
    Effect.gen(function* () {
      yield* setGitScript({});
      const store = yield* RepositoryStore.RepositoryStore;
      const sql = yield* SqlClient.SqlClient;
      const projectId = yield* insertProject("slot-project");
      const repository = yield* store.addRepository({
        path: yield* makeDirectory("slot-member"),
        createdAt: at,
      });
      yield* sql`
        INSERT INTO worktree_slots (
          slot_id, project_id, path, current_line_root_commit_id, created_at, last_used_at
        ) VALUES (
          'slot-project:slot-1', ${projectId}, '/tmp/slot-project/slot-1',
          'line-a', '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z'
        )
      `;
      yield* sql`
        INSERT INTO worktree_slot_members (
          slot_id, repository_id, relative_path, current_branch
        ) VALUES (
          'slot-project:slot-1', ${repository.repositoryId}, 'slot-member', 'mercurian/line-a'
        )
      `;

      const refusal = yield* store
        .removeRepository({ repositoryId: repository.repositoryId })
        .pipe(Effect.flip);
      assert.strictEqual(refusal._tag, "RepositoryHasLiveWorktreesError");
      if (refusal._tag === "RepositoryHasLiveWorktreesError") {
        assert.strictEqual(refusal.worktreeCount, 1);
      }
    }),
  );

  it.effect("a worktree the app does not own never blocks removal", () =>
    Effect.gen(function* () {
      const store = yield* RepositoryStore.RepositoryStore;
      const directory = yield* makeDirectory("hand-made");
      yield* setGitScript({
        repositories: new Set([directory]),
        worktreesByPath: new Map([[directory, [directory, "/Users/someone/elsewhere/wt"]]]),
      });

      const repository = yield* store.addRepository({ path: directory, createdAt: at });
      yield* store.removeRepository({ repositoryId: repository.repositoryId });
      const snapshot = yield* store.getSnapshot;
      assert.strictEqual(findRepository(snapshot, repository.repositoryId), undefined);
    }),
  );

  it.effect("refuses removing a repository that does not exist", () =>
    Effect.gen(function* () {
      const store = yield* RepositoryStore.RepositoryStore;
      const refusal = yield* store
        .removeRepository({ repositoryId: MercurianRepositoryId.make("nowhere") })
        .pipe(Effect.flip);
      assert.strictEqual(refusal._tag, "MercurianRepositoryNotFoundError");
    }),
  );

  it.effect("signals a change on every mutation", () =>
    Effect.gen(function* () {
      yield* setGitScript({});
      const store = yield* RepositoryStore.RepositoryStore;

      // Take before mutating: the signal is live, not replayed.
      const changes = yield* Effect.forkChild(Stream.runCollect(Stream.take(store.changes, 3)), {
        startImmediately: true,
      });

      const repository = yield* store.addRepository({
        path: yield* makeDirectory("watched"),
        createdAt: at,
      });
      yield* store.saveScripts({
        repositoryId: repository.repositoryId,
        scripts: [{ name: "Dev", command: "pnpm dev", isSetup: false }],
        updatedAt: at,
      });
      yield* store.removeRepository({ repositoryId: repository.repositoryId });

      const signals = yield* Fiber.join(changes);
      assert.strictEqual(signals.length, 3);
    }),
  );
});
