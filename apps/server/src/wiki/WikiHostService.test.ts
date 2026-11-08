import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  type PullRequestAction,
  type PullRequestDetail,
  type PullRequestMergeCapabilities,
  type PullRequestState,
  type PullRequestSummary,
  ThreadId,
  type WikiChangeRequestId,
  type WikiError,
  type WikiId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../config.ts";
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
  });
  const layerProjects = RuntimeLayer.layerProjectService;
  return WikiHostService.layer.pipe(
    Layer.provideMerge(WikiService.layer),
    Layer.provideMerge(Layer.mergeAll(layerPullRequests, layerRegistry)),
    Layer.provideMerge(layerProjects),
    Layer.provideMerge(layerEnrichment),
    Layer.provideMerge(WorkspacePaths.layer),
    Layer.provideMerge(GitVcsDriver.layer.pipe(Layer.provide(VcsProcess.layer))),
    Layer.provideMerge(SqlitePersistence.layerMemory),
    Layer.provideMerge(ServerSettings.layerTest()),
    Layer.provideMerge(ServerConfig.layerTest(baseDir, baseDir)),
    Layer.provideMerge(NodeServices.layer),
  );
};

interface Fixture {
  readonly root: string;
  readonly bare: string;
  /** A teammate's clone of the host. */
  readonly clone: string;
  readonly host: FakeHost;
  readonly wikiId: WikiId;
  readonly wikis: WikiService.WikiService["Service"];
  readonly hosts: WikiHostService.WikiHostService["Service"];
  readonly commitOnHost: (file: string, content: string) => Effect.Effect<void>;
  readonly write: (file: string, content: string) => Effect.Effect<void>;
}

const agent = (thread: string): WikiService.WikiAuthor => ({
  actor: "Agent",
  threadId: ThreadId.make(thread),
});

/** A wiki with history on this machine, a remote that is an empty host, and nothing connected. */
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
  options: { readonly connect?: boolean } = {},
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
    yield* git(root, ["remote", "add", "origin", bare]);

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
      const { wikiId } = yield* wikis.register({ root });
      if (options.connect !== false) {
        yield* hosts.connect({ wikiId });
        yield* git(clone, ["clone", "--quiet", bare, "."]);
      }
      return yield* body({ root, bare, clone, host, wikiId, wikis, hosts, commitOnHost, write });
    }).pipe(Effect.provide(makeLayers(baseDir, bare, clone, host)));
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

const amendment = (fixture: Fixture, file: string, thread = "thread-a") =>
  fixture.wikis
    .amend(
      { wikiId: fixture.wikiId, message: `Add ${file}`, changes: { [file]: `# ${file}\n` } },
      agent(thread),
    )
    .pipe(Effect.map((result) => result.changeRequest));

it.effect("connecting moves a local wiki's history to an empty host and gives it a project", () =>
  withFixture(
    ({ root, bare, wikiId, wikis, hosts }) =>
      Effect.gen(function* () {
        const summary = yield* hosts.connect({ wikiId });
        assert.equal(summary.host?.kind, "gitlab");
        const local = yield* git(root, ["rev-parse", "main"]);
        assert.equal(yield* git(bare, ["rev-parse", "main"]), local);
        assert.equal(summary.host?.relation, "up-to-date");
        const projects = yield* ProjectService.ProjectService;
        const project = yield* projects.getByWorkspaceRoot(root);
        assert.equal(project._tag, "Some");
        assert.equal(summary.host?.projectId, project._tag === "Some" ? project.value.id : "");
        // Connecting again keeps the same project.
        const again = yield* hosts.connect({ wikiId });
        assert.equal(again.host?.projectId, summary.host?.projectId);
        const refused = yield* Effect.flip(wikis.setMirror({ wikiId, url: bare }));
        assert.equal(refused.reason, "invalid");
      }),
    { connect: false },
  ),
);

it.effect("connecting refuses a host with a different history and leaves the mirror alone", () =>
  withFixture(
    ({ bare, clone, wikiId, wikis, hosts }) =>
      Effect.gen(function* () {
        yield* git(clone, ["init", "--quiet", "--initial-branch=main"]);
        yield* git(clone, ["commit", "--quiet", "--allow-empty", "-m", "Unrelated"]);
        yield* git(clone, ["push", "--quiet", bare, "main"]);
        yield* wikis.setMirror({ wikiId, url: "https://example.com/backup.git" });
        const error = yield* Effect.flip(hosts.connect({ wikiId }));
        assert.equal(error.reason, "conflict");
        const summary = yield* wikis.get(wikiId);
        assert.isNull(summary.host ?? null);
        assert.equal(summary.mirror?.url, "https://example.com/backup.git");
      }),
    { connect: false },
  ),
);

it.effect("sync fast-forwards main, and unsaved edits hold it back without losing them", () =>
  withFixture(({ root, wikiId, wikis, hosts, commitOnHost, write }) =>
    Effect.gen(function* () {
      yield* commitOnHost("Home.md", "# Home\n\nFrom the host.\n\nSecond.\n");
      yield* hosts.sync({ wikiId });
      const note = yield* wikis.readNote({ wikiId, name: "Home" });
      assert.include(note.source, "From the host.");

      yield* commitOnHost("Home.md", "# Home\n\nAgain from the host.\n\nSecond.\n");
      yield* write("Home.md", "# Home\n\nMine, unsaved.\n\nSecond.\n");
      const held = yield* hosts.sync({ wikiId });
      assert.isNotNull(held.host?.lastError ?? null);
      assert.equal(held.host?.relation, "behind");
      assert.include(yield* git(root, ["show", "HEAD:Home.md"]), "From the host.");
      yield* git(root, ["checkout", "--quiet", "--", "Home.md"]);
      const clear = yield* hosts.sync({ wikiId });
      assert.isNull(clear.host?.lastError ?? null);
      assert.equal(clear.host?.relation, "up-to-date");
    }),
  ),
);

it.effect("sync reports a main line that has left the host's", () =>
  withFixture(({ root, wikiId, hosts, commitOnHost }) =>
    Effect.gen(function* () {
      yield* git(root, ["commit", "--quiet", "--allow-empty", "-m", "Local only"]);
      assert.equal((yield* hosts.sync({ wikiId })).host?.relation, "ahead");
      yield* commitOnHost("Host.md", "# Host\n");
      assert.equal((yield* hosts.sync({ wikiId })).host?.relation, "diverged");
    }),
  ),
);

it.effect("publishing pushes the branch and opens one pull request, a draft for an agent", () =>
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

it.effect("a person's edit publishes on its own; an agent's waits for its turn to end", () =>
  withFixture((fixture) =>
    Effect.gen(function* () {
      const { host, hosts, wikiId, wikis } = fixture;
      const agents = yield* amendment(fixture, "Agent.md");
      yield* hosts.publishThread(ThreadId.make("thread-a"));
      const forAgent = yield* Queue.take(host.opened);
      assert.equal(forAgent.head, `cr/${agents.changeRequestId}`);

      const edit = yield* wikis.amend(
        { wikiId, message: "By hand", changes: { "Hand.md": "# Hand\n" } },
        WikiService.person,
      );
      const forPerson = yield* Queue.take(host.opened);
      assert.equal(forPerson.head, `cr/${edit.changeRequest.changeRequestId}`);
      assert.isFalse(forPerson.isDraft);
      assert.lengthOf(host.pulls, 2, "the agent's amendment opened nothing by itself");
    }),
  ),
);

it.effect(
  "a draft stays off the host until it's made a pull request, then never rewrites what it pushed",
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

        // Publishes run in order, so the first to open shows whether the draft's save opened one.
        const edit = yield* wikis.amend(
          { wikiId, message: "By hand", changes: { "Hand.md": "# Hand\n" } },
          WikiService.person,
        );
        const first = yield* Queue.take(host.opened);
        assert.equal(first.head, `cr/${edit.changeRequest.changeRequestId}`);

        yield* wikis.draftPromote(
          { wikiId, changeRequestId: draft.changeRequestId, title: "Launch notes" },
          WikiService.person,
        );
        const promoted = yield* Queue.take(host.opened);
        assert.equal(promoted.head, `cr/${draft.changeRequestId}`);
        assert.lengthOf(host.pulls, 2);

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

it.effect("a change request with nothing in it opens no pull request", () =>
  withFixture(({ host, hosts, wikiId, wikis }) =>
    Effect.gen(function* () {
      const empty = yield* wikis.changeRequestsOpen({ wikiId, title: "Empty" }, agent("thread-a"));
      yield* hosts.publish({ wikiId, changeRequestId: empty.changeRequestId });
      assert.lengthOf(host.pulls, 0);
    }),
  ),
);

it.effect("merging goes through the host, keeps the amendments and moves main", () =>
  withFixture((fixture) =>
    Effect.gen(function* () {
      const { host, hosts, root, bare, wikiId } = fixture;
      const changeRequest = yield* amendment(fixture, "One.md");
      const target = { wikiId, changeRequestId: changeRequest.changeRequestId };
      const merged = yield* hosts.merge(target);
      assert.equal(merged.changeRequest.status, "merged");
      assert.deepEqual(host.actions.at(-1), { action: "merge", method: "merge" });
      assert.equal(merged.commit, yield* git(bare, ["rev-parse", "main"]));
      assert.equal(yield* git(root, ["rev-parse", "main"]), merged.commit);
      assert.isTrue((yield* git(bare, ["log", "--format=%B", "main"])).includes("Wiki-Amendment:"));
    }),
  ),
);

it.effect("a local merge is refused on a host wiki, and works again after disconnecting", () =>
  withFixture((fixture) =>
    Effect.gen(function* () {
      const { host, hosts, wikis, wikiId } = fixture;
      const changeRequest = yield* amendment(fixture, "One.md");
      const target = { wikiId, changeRequestId: changeRequest.changeRequestId };
      assert.equal((yield* Effect.flip(wikis.merge(target))).reason, "invalid");
      const summary = yield* hosts.disconnect({ wikiId });
      assert.isNull(summary.host ?? null);
      const merged = yield* hosts.merge(target);
      assert.equal(merged.changeRequest.status, "merged");
      assert.lengthOf(host.actions, 0);
    }),
  ),
);

it.effect("the markdown merge settles what the host's line merge cannot", () =>
  withFixture((fixture) =>
    Effect.gen(function* () {
      const { host, hosts, wikis, wikiId, commitOnHost } = fixture;
      host.lineMergeConflicts = true;
      const amended = yield* wikis.amend(
        {
          wikiId,
          message: "Edit the first sentence",
          changes: { "Home.md": "# Home\n\nFirst, edited here. Then more.\n\nSecond.\n" },
        },
        agent("thread-a"),
      );
      const target = { wikiId, changeRequestId: amended.changeRequest.changeRequestId };
      yield* hosts.publish(target);
      yield* commitOnHost("Home.md", "# Home\n\nFirst.\n\nSecond, edited on the host.\n");

      const merged = yield* hosts.merge(target);
      assert.equal(merged.changeRequest.status, "merged");
      assert.lengthOf(
        merged.changeRequest.amendments,
        1,
        "the reconciling merge is not an amendment",
      );
      const note = yield* wikis.readNote({ wikiId, name: "Home" });
      assert.include(note.source, "First, edited here.");
      assert.include(note.source, "Second, edited on the host.");
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

it.effect("a merge made on the pull request's own screen is recorded at once", () =>
  withFixture((fixture) =>
    Effect.gen(function* () {
      const { bare, host, hosts, root, wikis, wikiId } = fixture;
      const changeRequest = yield* amendment(fixture, "One.md");
      const target = { wikiId, changeRequestId: changeRequest.changeRequestId };
      const published = yield* hosts.publish(target);
      const recorded = yield* wikis.subscribe.pipe(
        Stream.filter((event) => event.kind === "merged"),
        Stream.runHead,
        Effect.forkChild,
      );
      const summary = yield* wikis.get(wikiId);
      const pull = host.pulls[0]!;
      // What the pull request screen's Merge does: the service merges, then says so.
      yield* git(fixture.clone, ["fetch", "--quiet", "origin"]);
      yield* git(fixture.clone, ["reset", "--quiet", "--hard", "origin/main"]);
      yield* git(fixture.clone, ["merge", "--quiet", "--no-ff", "-m", "M", `origin/${pull.head}`]);
      yield* git(fixture.clone, ["push", "--quiet", "origin", "HEAD:main"]);
      pull.state = "merged";
      yield* Queue.offer(host.merges, {
        projectId: summary.host!.projectId,
        repository: published.pullRequest!.repository,
        number: pull.number,
        mergedAt: "2026-11-07T00:00:00.000Z",
      });
      yield* Fiber.join(recorded);
      const settled = yield* wikis.changeRequest(target);
      assert.equal(settled.status, "merged");
      assert.equal(
        yield* git(root, ["rev-parse", "main"]),
        yield* git(bare, ["rev-parse", "main"]),
      );
    }),
  ),
);

it.effect("picks the merge method that keeps amendments, and squashes only as a last resort", () =>
  Effect.sync(() => {
    const allow = (merge: boolean, rebase: boolean, squash: boolean) =>
      WikiHostService.preferredMergeMethod({ merge, rebase, squash });
    assert.equal(allow(true, true, true), "merge");
    assert.equal(allow(false, true, true), "rebase");
    assert.equal(allow(false, false, true), "squash");
    assert.isNull(allow(false, false, false));
  }),
);

it.effect("sync follows a pull request merged, closed or reopened on the host", () =>
  withFixture((fixture) =>
    Effect.gen(function* () {
      const { clone, host, hosts, root, wikis, wikiId } = fixture;
      const merging = yield* amendment(fixture, "One.md", "thread-a");
      const closing = yield* amendment(fixture, "Two.md", "thread-b");
      const merged = { wikiId, changeRequestId: merging.changeRequestId };
      const closed = { wikiId, changeRequestId: closing.changeRequestId };
      yield* hosts.publish(merged);
      yield* hosts.publish(closed);

      // Someone merges the first on the host's site and closes the second.
      yield* git(clone, ["fetch", "--quiet", "origin"]);
      yield* git(clone, ["reset", "--quiet", "--hard", "origin/main"]);
      yield* git(clone, [
        "merge",
        "--quiet",
        "--no-ff",
        "-m",
        "M",
        `origin/cr/${merged.changeRequestId}`,
      ]);
      yield* git(clone, ["push", "--quiet", "origin", "HEAD:main"]);
      host.pulls[0]!.state = "merged";
      host.pulls[1]!.state = "closed";

      yield* hosts.sync({ wikiId });
      const read = (changeRequestId: WikiChangeRequestId) =>
        wikis
          .changeRequestsList({ wikiId })
          .pipe(
            Effect.map(({ changeRequests }) =>
              changeRequests.find((entry) => entry.changeRequestId === changeRequestId)!,
            ),
          );
      const settled = yield* read(merged.changeRequestId);
      assert.equal(settled.status, "merged");
      assert.equal(settled.mergedCommit, yield* git(root, ["rev-parse", "main"]));
      assert.equal((yield* read(closed.changeRequestId)).status, "closed");

      host.pulls[1]!.state = "open";
      yield* hosts.sync({ wikiId });
      assert.equal((yield* read(closed.changeRequestId)).status, "open");
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
      yield* hosts.sync({ wikiId });
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

it.effect("a change request stuck on the host holds up neither the sync nor another's merge", () =>
  withFixture((fixture) =>
    Effect.gen(function* () {
      const { clone, hosts, root, wikis, wikiId } = fixture;
      const stuck = yield* wikis.amend(
        { wikiId, message: "Mine", changes: { "Shared.md": "# Mine\n" } },
        agent("thread-a"),
      );
      const stuckTarget = { wikiId, changeRequestId: stuck.changeRequest.changeRequestId };
      yield* hosts.publish(stuckTarget);
      const branch = `cr/${stuckTarget.changeRequestId}`;
      yield* git(clone, ["fetch", "--quiet", "origin"]);
      yield* git(clone, ["checkout", "--quiet", "-B", branch, `origin/${branch}`]);
      yield* Effect.flatMap(FileSystem.FileSystem, (fileSystem) =>
        fileSystem.writeFileString(`${clone}/Shared.md`, "# Theirs\n"),
      ).pipe(Effect.orDie);
      yield* git(clone, ["add", "."]);
      yield* git(clone, ["commit", "--quiet", "-m", "Theirs"]);
      yield* git(clone, ["push", "--quiet", "origin", `HEAD:${branch}`]);
      yield* wikis.amend(
        {
          wikiId,
          changeRequestId: stuckTarget.changeRequestId,
          message: "Mine again",
          changes: { "Shared.md": "# Mine, again\n" },
        },
        agent("thread-a"),
      );
      const refused = yield* Effect.flip(hosts.publish(stuckTarget));
      assert.equal(refused.reason, "conflict");

      const other = yield* amendment(fixture, "Other.md", "thread-b");
      const merged = yield* hosts.merge({ wikiId, changeRequestId: other.changeRequestId });
      assert.equal(merged.changeRequest.status, "merged");
      assert.equal(yield* git(root, ["rev-parse", "main"]), merged.commit);
      const healthy = yield* hosts.sync({ wikiId });
      assert.isNull(healthy.host?.lastError ?? null);
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

      // Published by the turn's end, the same refusal is the change request's, not the sync's.
      const { wikis } = fixture;
      yield* wikis.recordChangeRequestIssue(wikiId, "One.md: refused");
      yield* hosts.sweep;
      const held = (yield* wikis.get(wikiId)).host;
      assert.equal(held?.changeRequestIssue, "One.md: refused", "work is still waiting");
      assert.isNull(held?.lastError ?? null);
      assert.equal(held?.relation, "up-to-date");

      yield* Effect.flatMap(FileSystem.FileSystem, (fileSystem) =>
        fileSystem.remove(`${bare}/hooks/pre-receive`),
      ).pipe(Effect.orDie);
      yield* hosts.publish({ wikiId, changeRequestId: changeRequest.changeRequestId });
      yield* hosts.sync({ wikiId });
      assert.isNull((yield* wikis.get(wikiId)).host?.changeRequestIssue ?? null);
    }),
  ),
);

it.effect("connecting a connected wiki syncs it and leaves its pull requests linked", () =>
  withFixture((fixture) =>
    Effect.gen(function* () {
      const { hosts, wikis, wikiId } = fixture;
      const changeRequest = yield* amendment(fixture, "One.md");
      const target = { wikiId, changeRequestId: changeRequest.changeRequestId };
      yield* hosts.publish(target);
      yield* hosts.connect({ wikiId });
      assert.equal((yield* wikis.changeRequest(target)).pullRequest?.number, 1);
    }),
  ),
);

it.effect("a merge held back by unsaved edits still records the host's merge", () =>
  withFixture((fixture) =>
    Effect.gen(function* () {
      const { bare, hosts, root, wikiId, write } = fixture;
      const changeRequest = yield* amendment(fixture, "One.md");
      yield* write("One.md", "# Mine, unsaved\n");
      const merged = yield* hosts.merge({ wikiId, changeRequestId: changeRequest.changeRequestId });
      assert.equal(merged.commit, yield* git(bare, ["rev-parse", "main"]));
      assert.notEqual(yield* git(root, ["rev-parse", "main"]), merged.commit);
    }),
  ),
);

it.effect("disconnecting forgets pull requests, and takes away a project it made", () =>
  withFixture((fixture) =>
    Effect.gen(function* () {
      const { host, hosts, root, wikis, wikiId } = fixture;
      const changeRequest = yield* amendment(fixture, "One.md");
      const target = { wikiId, changeRequestId: changeRequest.changeRequestId };
      yield* hosts.publish(target);
      yield* hosts.disconnect({ wikiId });
      const unlinked = yield* wikis.changeRequest(target);
      assert.isNull(unlinked.pullRequest ?? null);
      assert.isNull(unlinked.pushedHead ?? null);
      const projects = yield* ProjectService.ProjectService;
      assert.equal((yield* projects.getByWorkspaceRoot(root))._tag, "None");

      // Reconnecting finds the pull request that is still open rather than opening another.
      yield* hosts.connect({ wikiId });
      const relinked = yield* hosts.publish(target);
      assert.equal(relinked.pullRequest?.number, 1);
      assert.lengthOf(host.pulls, 1);
    }),
  ),
);

it.effect("a sweep records a host it cannot reach and leaves the wiki working", () =>
  withFixture((fixture) =>
    Effect.gen(function* () {
      const { root, hosts, wikis, wikiId } = fixture;
      yield* git(root, ["remote", "set-url", "origin", `${fixture.bare}-gone`]);
      yield* hosts.sweep;
      assert.isNotNull((yield* wikis.get(wikiId)).host?.lastError ?? null);
      const changeRequest = yield* amendment(fixture, "One.md");
      assert.equal(changeRequest.status, "open");
      yield* git(root, ["remote", "set-url", "origin", fixture.bare]);
      yield* hosts.sweep;
      assert.isNull((yield* wikis.get(wikiId)).host?.lastError ?? null);
    }),
  ),
);

it.effect("publishing a change request on a wiki with no host is an error", () =>
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
    { connect: false },
  ),
);
