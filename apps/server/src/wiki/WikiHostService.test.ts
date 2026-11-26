import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  CommandId,
  ProjectId,
  projectRootId,
  type PullRequestAction,
  type PullRequestDetail,
  type PullRequestMergeCapabilities,
  type PullRequestState,
  type PullRequestSummary,
  RootKey,
  SourceControlProviderKind,
  ThreadId,
  type WikiError,
  ProjectRootId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../config.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as RuntimeLayer from "../orchestration-v2/runtimeLayer.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as ProjectEnrichmentService from "../project/ProjectEnrichmentService.ts";
import * as ProjectFaviconResolver from "../project/ProjectFaviconResolver.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as RepositoryIdentityResolver from "../project/RepositoryIdentityResolver.ts";
import * as PullRequestService from "../pullRequest/PullRequestService.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as SourceControlProviderRegistry from "../sourceControl/SourceControlProviderRegistry.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as ProjectRoots from "../workspace/ProjectRoots.ts";
import * as TaskFolderStore from "../workspace/TaskFolderStore.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import * as WikiHostService from "./WikiHostService.ts";
import * as WikiService from "./WikiService.ts";

const REPOSITORY = "acme/handbook";

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

const git = (cwd: string, args: ReadonlyArray<string>) =>
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
      }),
    ),
    Effect.map((result) => result.stdout.trim()),
    Effect.provide(ProcessRunner.layer.pipe(Layer.provide(NodeServices.layer))),
    Effect.orDie,
  );

interface FakePull {
  readonly number: number;
  readonly head: string;
  state: PullRequestState;
  isDraft: boolean;
  mergedThroughService: boolean;
}

/** A git host: a bare repository, its pull requests, and a clone that merges them for real. */
interface FakeHost {
  readonly pulls: Array<FakePull>;
  readonly actions: Array<{ readonly action: PullRequestAction; readonly method?: string }>;
  /** Each pull request as it opens, so a test can await work the service does on its own. */
  readonly opened: Queue.Queue<FakePull>;
  supported: ReadonlyArray<PullRequestAction>;
  mergeCapabilities: PullRequestMergeCapabilities;
  /** Whether the host's own line merge conflicts, for a head that lacks main. */
  lineMergeConflicts: boolean;
  /** What the pull request service tells its subscribers, as a merge made on its screen does. */
  readonly merges: Queue.Queue<PullRequestService.PullRequestMergeEvent>;
}

const pullUrl = (number: number) => `https://github.com/${REPOSITORY}/pull/${number}`;

const makeLayers = (baseDir: string, bare: string, clone: string, host: FakeHost) => {
  const pullFor = (number: number) => {
    const pull = host.pulls.find((entry) => entry.number === number);
    if (pull === undefined) throw new Error(`no pull request ${number}`);
    return pull;
  };
  const mergePull = (pull: FakePull) =>
    Effect.gen(function* () {
      yield* git(clone, ["fetch", "--quiet", "origin"]);
      yield* git(clone, ["checkout", "--quiet", "main"]);
      yield* git(clone, ["reset", "--quiet", "--hard", "origin/main"]);
      yield* git(clone, ["merge", "--quiet", "--no-ff", "-m", "Merge", `origin/${pull.head}`]);
      yield* git(clone, ["push", "--quiet", "origin", "main"]);
      pull.state = "merged";
    });
  const layerPullRequests = Layer.mock(PullRequestService.PullRequestService)({
    refreshAfterTurn: () => Effect.void,
    subscribeMerges: Effect.succeed(Stream.fromQueue(host.merges)),
    subscribeStateChanges: Effect.succeed(Stream.never),
    // Like the real service, this answers from its cache unless a mutation went through it.
    summary: (input) =>
      Effect.sync(() => {
        const pull = pullFor(input.number);
        return { state: pull.mergedThroughService ? "merged" : "open" } as PullRequestSummary;
      }),
    detail: (input) =>
      Effect.gen(function* () {
        const pull = pullFor(input.number);
        const behind = yield* git(bare, ["rev-list", "--count", `${pull.head}..main`]);
        return {
          capabilities: { actions: host.supported },
          mergeability: host.lineMergeConflicts && behind !== "0" ? "conflicting" : "mergeable",
          mergeCapabilities: host.mergeCapabilities,
        } as unknown as PullRequestDetail;
      }),
    runAction: (input) =>
      Effect.gen(function* () {
        const pull = pullFor(input.number);
        host.actions.push({
          action: input.action,
          ...(input.mergeMethod === undefined ? {} : { method: input.mergeMethod }),
        });
        if (input.action === "merge") {
          yield* mergePull(pull);
          pull.mergedThroughService = true;
        }
        if (input.action === "draft") pull.isDraft = true;
        if (input.action === "close") pull.state = "closed";
        if (input.action === "reopen") pull.state = "open";
        return undefined;
      }),
  });
  const provider = {
    kind: "gitlab",
    listChangeRequests: (input: { readonly headSelector: string }) =>
      Effect.sync(() =>
        host.pulls
          .filter((pull) => pull.head === input.headSelector && pull.state === "open")
          .map((pull) => ({ number: pull.number, url: pullUrl(pull.number) })),
      ),
    getChangeRequest: (input: { readonly reference: string }) =>
      Effect.sync(() => ({ state: pullFor(Number(input.reference)).state })),
    createChangeRequest: (input: { readonly headSelector: string }) =>
      Effect.gen(function* () {
        const pull: FakePull = {
          number: host.pulls.length + 1,
          head: input.headSelector,
          state: "open",
          isDraft: false,
          mergedThroughService: false,
        };
        host.pulls.push(pull);
        yield* Queue.offer(host.opened, pull);
      }),
  };
  const layerRegistry = Layer.mock(SourceControlProviderRegistry.SourceControlProviderRegistry)({
    resolve: () => Effect.succeed(provider as never),
    resolveLink: () => undefined,
    // Every folder with an origin is on this host.
    resolveHandle: ({ cwd }) =>
      git(cwd, ["remote", "get-url", "origin"]).pipe(
        Effect.map((remoteUrl) => ({
          provider: provider as never,
          context:
            remoteUrl === ""
              ? null
              : {
                  provider: {
                    kind: SourceControlProviderKind.make("gitlab"),
                    name: "GitLab",
                    baseUrl: "https://gitlab.com",
                  },
                  remoteName: "origin",
                  remoteUrl,
                },
        })),
      ),
  });
  const layerProjects = RuntimeLayer.layerProjectService;
  return WikiHostService.layer.pipe(
    Layer.provideMerge(
      WikiService.layer.pipe(
        Layer.provide(
          ProjectRoots.layer.pipe(
            Layer.provide(Layer.mergeAll(ProjectStore.layer, TaskFolderStore.layer, layerRegistry)),
          ),
        ),
      ),
    ),
    Layer.provideMerge(Layer.mergeAll(layerPullRequests, layerRegistry)),
    Layer.provideMerge(layerProjects),
    Layer.provideMerge(layerEnrichment),
    Layer.provideMerge(WorkspacePaths.layer),
    Layer.provideMerge(GitVcsDriver.layer.pipe(Layer.provide(VcsProcess.layer))),
    Layer.provideMerge(SqlitePersistence.layerMemory),
    Layer.provideMerge(ServerSettings.layerTest()),
    Layer.provideMerge(ServerConfig.layerTest(baseDir, baseDir)),
    Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
  );
};

interface Fixture {
  readonly root: string;
  readonly bare: string;
  /** A teammate's clone of the host. */
  readonly clone: string;
  readonly host: FakeHost;
  readonly wikiId: ProjectRootId;
  readonly wikis: WikiService.WikiService["Service"];
  readonly hosts: WikiHostService.WikiHostService["Service"];
  readonly commitOnHost: (file: string, content: string) => Effect.Effect<void>;
  readonly write: (file: string, content: string) => Effect.Effect<void>;
}

const agent = (thread: string): WikiService.WikiAuthor => ({
  actor: "Agent",
  threadId: ThreadId.make(thread),
});

/**
 * A repository on this machine whose main the host already has, the only folder of a project;
 * with `remote: false` it has no host, and with `project: false` no project yet either.
 */
const withFixture = <A, E>(
  body: (
    fixture: Fixture,
  ) => Effect.Effect<
    A,
    E,
    | WikiService.WikiService
    | WikiHostService.WikiHostService
    | ProjectService.ProjectService
    | NodeServices.NodeServices
  >,
  options: { readonly remote?: boolean; readonly project?: boolean } = {},
) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const scratch = yield* fileSystem
      .makeTempDirectoryScoped({ prefix: "t3-wiki-host-" })
      .pipe(Effect.flatMap((directory) => fileSystem.realPath(directory)));
    const baseDir = path.join(scratch, "data");
    const root = path.join(scratch, "wiki");
    const bare = path.join(scratch, "host.git");
    const clone = path.join(scratch, "clone");
    for (const directory of [baseDir, root, bare, clone]) {
      yield* fileSystem.makeDirectory(directory);
    }
    yield* git(bare, ["init", "--quiet", "--bare", "--initial-branch=main"]);
    yield* git(root, ["init", "--quiet", "--initial-branch=main"]);
    yield* fileSystem.writeFileString(path.join(root, "Home.md"), "# Home\n\nFirst.\n\nSecond.\n");
    yield* git(root, ["add", "."]);
    yield* git(root, ["commit", "--quiet", "-m", "Start"]);
    if (options.remote !== false) yield* git(root, ["remote", "add", "origin", bare]);

    const host: FakeHost = {
      pulls: [],
      actions: [],
      opened: yield* Queue.unbounded<FakePull>(),
      supported: ["merge", "draft", "close", "reopen"],
      mergeCapabilities: { merge: true, squash: true, rebase: true },
      lineMergeConflicts: false,
      merges: yield* Queue.unbounded<PullRequestService.PullRequestMergeEvent>(),
    };

    const write = (file: string, content: string) =>
      fileSystem.writeFileString(path.join(root, file), content).pipe(Effect.orDie);
    const commitOnHost = (file: string, content: string) =>
      Effect.gen(function* () {
        yield* git(clone, ["fetch", "--quiet", "origin"]);
        yield* git(clone, ["reset", "--quiet", "--hard", "origin/main"]);
        yield* fileSystem.writeFileString(path.join(clone, file), content).pipe(Effect.orDie);
        yield* git(clone, ["add", "."]);
        yield* git(clone, ["commit", "--quiet", "-m", `Host edit of ${file}`]);
        yield* git(clone, ["push", "--quiet", "origin", "HEAD:main"]);
      });

    return yield* Effect.gen(function* () {
      const wikis = yield* WikiService.WikiService;
      const hosts = yield* WikiHostService.WikiHostService;
      if (options.remote !== false && options.project !== false) {
        yield* git(root, ["push", "--quiet", "origin", "main"]);
        yield* git(clone, ["clone", "--quiet", bare, "."]);
      }
      const projectId = ProjectId.make("project-wiki");
      if (options.project !== false) {
        yield* (yield* ProjectService.ProjectService)
          .create({
            commandId: CommandId.make("cmd-wiki"),
            projectId,
            title: "Handbook",
            workspaceRoot: root,
            trackedFolders: [],
          })
          .pipe(Effect.orDie);
      }
      const wikiId = projectRootId(projectId, RootKey.make("wiki"));
      return yield* body({ root, bare, clone, host, wikiId, wikis, hosts, commitOnHost, write });
    }).pipe(Effect.provide(makeLayers(baseDir, bare, clone, host)));
  }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)));

const amendment = (fixture: Fixture, file: string, thread = "thread-a") =>
  fixture.wikis
    .amend(
      { wikiId: fixture.wikiId, message: `Add ${file}`, changes: { [file]: `# ${file}\n` } },
      agent(thread),
    )
    .pipe(Effect.map((result) => result.changeRequest));

it.effect("publishing pushes the branch and opens one pull request, as a draft", () =>
  withFixture((fixture) =>
    Effect.gen(function* () {
      const { bare, host, hosts, wikiId } = fixture;
      const first = yield* amendment(fixture, "One.md");
      const target = { wikiId, changeRequestId: first.changeRequestId };
      assert.isNull(first.pushedHead ?? null);

      const published = yield* hosts.publish(target);
      assert.equal(published.pushedHead, published.head);
      assert.deepEqual(published.pullRequest, {
        repository: REPOSITORY,
        number: 1,
        url: pullUrl(1),
      });
      assert.equal(yield* git(bare, ["rev-parse", `cr/${first.changeRequestId}`]), published.head);
      assert.isTrue(host.pulls[0]?.isDraft);

      const second = yield* amendment(fixture, "Two.md");
      assert.equal(second.changeRequestId, first.changeRequestId);
      // An open view has to hear that the work went up, or it keeps saying it hasn't.
      const told = yield* fixture.wikis.subscribe.pipe(
        Stream.filter((event) => event.kind === "status"),
        Stream.take(1),
        Stream.runCollect,
        Effect.forkChild({ startImmediately: true }),
      );
      const republished = yield* hosts.publish(target);
      assert.equal(republished.pushedHead, republished.head);
      assert.lengthOf(host.pulls, 1);
      assert.equal((yield* Fiber.join(told))[0]?.changeRequestId, first.changeRequestId);
    }),
  ),
);

it.effect(
  "a draft stays off the host until it's made a pull request and published, then builds on it",
  () =>
    withFixture(({ host, hosts, wikiId, wikis }) =>
      Effect.gen(function* () {
        const saved = yield* wikis.autosave(
          {
            wikiId,
            document: "Draft.md",
            write: { kind: "text", file: "Draft.md", text: "# Draft\n" },
          },
          WikiService.person,
        );
        const draft = saved.changeRequest!;
        assert.isTrue(draft.draft);
        const refused = yield* Effect.flip(
          hosts.publish({ wikiId, changeRequestId: draft.changeRequestId }),
        );
        assert.equal(refused.reason, "invalid");

        const target = { wikiId, changeRequestId: draft.changeRequestId };
        yield* wikis.draftPromote({ ...target, title: "Launch notes" }, WikiService.person);
        assert.lengthOf(host.pulls, 0, "promoting opens nothing by itself");
        yield* hosts.publish(target);
        assert.equal(host.pulls[0]?.head, `cr/${draft.changeRequestId}`);
        assert.isTrue(host.pulls[0]?.isDraft);

        // The host has the save now, so the next one in the same sitting goes on top of it.
        const next = yield* wikis.autosave(
          {
            wikiId,
            changeRequestId: draft.changeRequestId,
            document: "Draft.md",
            write: { kind: "text", file: "Draft.md", text: "# Draft\n\nMore.\n" },
          },
          WikiService.person,
        );
        assert.lengthOf(next.changeRequest!.amendments, 2);
      }),
    ),
);

it.effect("resolving conflicts merges main in by markdown and pushes, without merging", () =>
  withFixture((fixture) =>
    Effect.gen(function* () {
      const { bare, host, hosts, wikis, wikiId, commitOnHost } = fixture;
      host.lineMergeConflicts = true;
      const amended = yield* wikis.amend(
        {
          wikiId,
          message: "Edit the first sentence",
          changes: { "Home.md": "# Home\n\nFirst, edited here.\n\nSecond.\n" },
        },
        agent("thread-a"),
      );
      const target = { wikiId, changeRequestId: amended.changeRequest.changeRequestId };
      yield* hosts.publish(target);
      yield* commitOnHost("Home.md", "# Home\n\nFirst.\n\nSecond, edited on the host.\n");

      const resolved = yield* hosts.resolveConflicts(target);
      assert.equal(resolved.status, "open");
      assert.equal(resolved.pushedHead, resolved.head);
      assert.equal(yield* git(bare, ["rev-parse", `cr/${target.changeRequestId}`]), resolved.head);
      assert.lengthOf(resolved.amendments, 1);
      assert.notInclude(
        host.actions.map((entry) => entry.action),
        "merge",
      );
      const note = yield* wikis.readNote({ ...target, name: "Home" });
      assert.include(note.source, "First, edited here.");
      assert.include(note.source, "Second, edited on the host.");
    }),
  ),
);

it.effect("closing reaches the host, and a host that cannot reopen says so", () =>
  withFixture((fixture) =>
    Effect.gen(function* () {
      const { host, hosts, wikiId } = fixture;
      const changeRequest = yield* amendment(fixture, "One.md");
      const target = { wikiId, changeRequestId: changeRequest.changeRequestId };
      yield* hosts.publish(target);
      const closed = yield* hosts.setChangeRequestStatus({ ...target, status: "closed" });
      assert.equal(closed.status, "closed");
      assert.equal(host.pulls[0]?.state, "closed");

      host.supported = ["merge", "close"];
      const refused: WikiError = yield* Effect.flip(
        hosts.setChangeRequestStatus({ ...target, status: "open" }),
      );
      assert.equal(refused.reason, "invalid");
      assert.equal(host.pulls[0]?.state, "closed");
    }),
  ),
);

it.effect("syncing fetches the host and leaves the folder's own main where it was", () =>
  withFixture(({ root, wikiId, wikis, commitOnHost }) =>
    Effect.gen(function* () {
      const main = yield* git(root, ["rev-parse", "main"]);
      yield* commitOnHost("Home.md", "# Home\n\nFirst.\n\nSecond, from the host.\n");
      yield* wikis.syncFromHost(wikiId);
      assert.equal(yield* git(root, ["rev-parse", "main"]), main);
      assert.equal(yield* git(root, ["status", "--porcelain"]), "");
      assert.notEqual(yield* git(root, ["rev-parse", "refs/wiki/host/origin/main"]), main);
    }),
  ),
);

it.effect("a change request follows work added on the host, and a push never overwrites it", () =>
  withFixture((fixture) =>
    Effect.gen(function* () {
      const { clone, hosts, wikis, wikiId } = fixture;
      const changeRequest = yield* amendment(fixture, "One.md");
      const target = { wikiId, changeRequestId: changeRequest.changeRequestId };
      const published = yield* hosts.publish(target);
      const branch = `cr/${target.changeRequestId}`;

      const addOnHost = (message: string) =>
        Effect.gen(function* () {
          yield* git(clone, ["fetch", "--quiet", "origin"]);
          yield* git(clone, ["checkout", "--quiet", "-B", branch, `origin/${branch}`]);
          yield* git(clone, ["commit", "--quiet", "--allow-empty", "-m", message]);
          yield* git(clone, ["push", "--quiet", "origin", `HEAD:${branch}`]);
          return yield* git(clone, ["rev-parse", "HEAD"]);
        });

      const hostHead = yield* addOnHost("Teammate's work");
      yield* wikis.syncFromHost(wikiId);
      const followed = (yield* wikis.changeRequestsList({ wikiId })).changeRequests[0];
      assert.equal(followed?.head, hostHead);
      assert.equal(followed?.pushedHead, hostHead);
      assert.notEqual(followed?.head, published.head);

      // Both sides move: publishing brings them together and replaces nothing.
      yield* amendment(fixture, "Two.md");
      const moved = yield* addOnHost("More from the teammate");
      const merged = yield* hosts.publish(target);
      assert.equal(merged.pushedHead, merged.head);
      assert.equal(yield* git(fixture.bare, ["rev-parse", branch]), merged.head);
      yield* git(fixture.bare, ["merge-base", "--is-ancestor", moved, branch]);
      assert.deepEqual(merged.amendments.map((entry) => entry.subject).toSorted(), [
        "Add One.md",
        "Add Two.md",
        "More from the teammate",
        "Teammate's work",
      ]);
    }),
  ),
);

it.effect("a push a branch rule refuses is named as that, not as work to sync", () =>
  withFixture((fixture) =>
    Effect.gen(function* () {
      const { bare, hosts, wikiId } = fixture;
      const changeRequest = yield* amendment(fixture, "One.md");
      yield* git(bare, ["config", "receive.denyUpdates", "false"]);
      yield* Effect.flatMap(FileSystem.FileSystem, (fileSystem) =>
        fileSystem
          .writeFileString(`${bare}/hooks/pre-receive`, "#!/bin/sh\nexit 1\n")
          .pipe(Effect.andThen(fileSystem.chmod(`${bare}/hooks/pre-receive`, 0o755))),
      ).pipe(Effect.orDie);
      const refused = yield* Effect.flip(
        hosts.publish({ wikiId, changeRequestId: changeRequest.changeRequestId }),
      );
      assert.equal(refused.reason, "git-failed");
      assert.include(refused.message, "refused");

      yield* Effect.flatMap(FileSystem.FileSystem, (fileSystem) =>
        fileSystem.remove(`${bare}/hooks/pre-receive`),
      ).pipe(Effect.orDie);
      const published = yield* hosts.publish({
        wikiId,
        changeRequestId: changeRequest.changeRequestId,
      });
      assert.equal(published.pushedHead, published.head);
    }),
  ),
);

it.effect("publishing a change request in a folder with no host is an error", () =>
  withFixture(
    (fixture) =>
      Effect.gen(function* () {
        const changeRequest = yield* amendment(fixture, "One.md");
        const error = yield* Effect.flip(
          fixture.hosts.publish({
            wikiId: fixture.wikiId,
            changeRequestId: changeRequest.changeRequestId,
          }),
        );
        assert.equal(error.reason, "invalid");
      }),
    { remote: false },
  ),
);

it.effect("a folder a project tracks publishes through that project, leaving its main", () =>
  withFixture(
    ({ root, bare, clone, host, wikis, hosts }) =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        yield* git(root, ["push", "--quiet", "origin", "main"]);
        yield* git(clone, ["clone", "--quiet", bare, "."]);
        // The project's own folder is another repository, with no host at all.
        const app = path.join(path.dirname(root), "app");
        yield* fileSystem.makeDirectory(app).pipe(Effect.orDie);
        yield* git(app, ["init", "--quiet", "--initial-branch=main"]);
        yield* git(app, ["commit", "--quiet", "--allow-empty", "-m", "App"]);
        const projects = yield* ProjectService.ProjectService;
        const project = yield* projects
          .create({
            commandId: CommandId.make("cmd-app"),
            projectId: ProjectId.make("project-app"),
            title: "App",
            workspaceRoot: app,
            trackedFolders: [{ name: "handbook", path: root }],
          })
          .pipe(Effect.orDie);
        const wikiId = projectRootId(project.id, RootKey.make("handbook"));
        assert.equal((yield* wikis.get(wikiId)).host?.projectId, project.id);

        const main = yield* git(root, ["rev-parse", "main"]);
        const { changeRequest } = yield* wikis.amend(
          { wikiId, message: "Add One", changes: { "One.md": "# One\n" } },
          agent("thread-a"),
        );
        const target = { wikiId, changeRequestId: changeRequest.changeRequestId };
        const published = yield* hosts.publish(target);
        assert.equal(published.pullRequest?.number, 1);
        assert.isTrue(host.pulls[0]?.isDraft);

        assert.equal(yield* git(root, ["rev-parse", "main"]), main);
        assert.isTrue(Option.isNone(yield* projects.getByWorkspaceRoot(root)));

        // A person's draft opens a draft pull request too, and only when they publish it.
        const saved = yield* wikis.autosave(
          {
            wikiId,
            document: "Two.md",
            write: { kind: "text", file: "Two.md", text: "# Two\n" },
          },
          WikiService.person,
        );
        assert.lengthOf(host.pulls, 1, "an autosave opens nothing");
        const draft = { wikiId, changeRequestId: saved.changeRequest!.changeRequestId };
        yield* wikis.draftPromote({ ...draft, title: "Two" }, WikiService.person);
        const opened = yield* hosts.publish(draft);
        assert.equal(opened.pullRequest?.number, 2);
        assert.isTrue(host.pulls[1]?.isDraft);
      }),
    { project: false },
  ),
);
