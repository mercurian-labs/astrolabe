/**
 * Host wikis: a wiki whose main line is a repository on a git host and whose change requests are
 * that host's pull requests. Everything host-shaped goes through the provider drivers and
 * `PullRequestService`, so every host works the same way and offers what its driver offers.
 * `WikiService` keeps the git half and holds no knowledge of pull requests.
 *
 * @module WikiHostService
 */
import {
  CommandId,
  ProjectId,
  type PullRequestMergeCapabilities,
  type PullRequestMergeMethod,
  type PullRequestRef,
  type ThreadId,
  type WikiChangeRequest,
  type WikiChangeRequestId,
  type WikiChangeRequestTarget,
  type WikiConnectHostInput,
  WikiError,
  type WikiId,
  type WikiMergeResult,
  type WikiPullRequestLink,
  type WikiSetChangeRequestStatusInput,
  type WikiSummary,
  type WikiTarget,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import * as ProjectService from "../project/ProjectService.ts";
import * as PullRequestService from "../pullRequest/PullRequestService.ts";
import { forkParked } from "../serverActivation.ts";
import * as SourceControlProviderRegistry from "../sourceControl/SourceControlProviderRegistry.ts";
import { sourceControlDefinitions } from "../sourceControl/sourceControlDefinitions.ts";
import * as WikiService from "./WikiService.ts";

/** How often host wikis pick up what happened on the host. */
const SWEEP_INTERVAL = "1 minute";
/** Unpublished work older than this missed its turn's end; the sweep publishes it. */
const UNPUBLISHED_GRACE_MS = 5 * 60_000;
/** How long a closed pull request is watched for being reopened on the host. */
const CLOSED_WATCH_MS = 7 * 24 * 60 * 60_000;

/**
 * The methods that keep a change request's amendments, best first; squashing joins them, so it
 * is the last resort and only for a repository that allows nothing else.
 */
export const preferredMergeMethod = (
  allowed: PullRequestMergeCapabilities,
): PullRequestMergeMethod | null =>
  allowed.merge ? "merge" : allowed.rebase ? "rebase" : allowed.squash ? "squash" : null;

export class WikiHostService extends Context.Service<
  WikiHostService,
  {
    /** Moves a wiki onto a remote of its folder, pushing its history if the host lacks it. */
    readonly connect: (input: WikiConnectHostInput) => Effect.Effect<WikiSummary, WikiError>;
    /** Makes it a local wiki again; the host keeps its copy and its review history. */
    readonly disconnect: (input: WikiTarget) => Effect.Effect<WikiSummary, WikiError>;
    readonly sync: (input: WikiTarget) => Effect.Effect<WikiSummary, WikiError>;
    /** Pushes a change request and opens its pull request if it has none. */
    readonly publish: (
      input: WikiChangeRequestTarget,
    ) => Effect.Effect<WikiChangeRequest, WikiError>;
    /** Merges locally, or through the host for a host wiki. */
    readonly merge: (input: WikiChangeRequestTarget) => Effect.Effect<WikiMergeResult, WikiError>;
    readonly setChangeRequestStatus: (
      input: WikiSetChangeRequestStatusInput,
    ) => Effect.Effect<WikiChangeRequest, WikiError>;
    /** Queues a thread's change requests for publishing; returns at once. */
    readonly publishThread: (threadId: ThreadId) => Effect.Effect<void>;
    /** Runs one pass over every host wiki. */
    readonly sweep: Effect.Effect<void>;
  }
>()("t3/wiki/WikiHostService") {}

/**
 * What the runtime needs from the host layer, which sits above it beside pull requests. The
 * defaults are a server with no host layer: nothing to publish, and merges stay local.
 */
export class WikiHostBridge extends Context.Reference<{
  readonly publishThread: (threadId: ThreadId) => Effect.Effect<void>;
  readonly merge: WikiHostService["Service"]["merge"] | null;
}>("t3/wiki/WikiHostBridge", {
  defaultValue: () => ({ publishThread: () => Effect.void, merge: null }),
}) {}

export const layerBridge = Layer.effect(
  WikiHostBridge,
  Effect.map(WikiHostService, (host) => ({
    publishThread: host.publishThread,
    merge: host.merge,
  })),
);

type Job =
  | { readonly kind: "thread"; readonly threadId: ThreadId }
  | {
      readonly kind: "edited";
      readonly wikiId: WikiId;
      readonly changeRequestId: WikiChangeRequestId;
    }
  | { readonly kind: "sweep" };

const isWikiError = Schema.is(WikiError);

const hostError = (message: string) => (cause: unknown) =>
  isWikiError(cause) ? cause : new WikiError({ reason: "git-failed", message, cause });

const make = Effect.gen(function* () {
  const wikis = yield* WikiService.WikiService;
  const pullRequests = yield* PullRequestService.PullRequestService;
  const providers = yield* SourceControlProviderRegistry.SourceControlProviderRegistry;
  const projects = yield* ProjectService.ProjectService;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;

  const jobs = yield* Queue.unbounded<Job>();
  // Listing then creating is what stops one change request opening two pull requests.
  const opening = yield* Semaphore.make(1);

  const hostOf = (wiki: WikiSummary) =>
    wiki.host == null
      ? Effect.fail(
          new WikiError({ reason: "invalid", message: "This wiki is not connected to a host." }),
        )
      : Effect.succeed(wiki.host);

  const changeRequest = (input: WikiChangeRequestTarget) =>
    wikis.changeRequestsList({ wikiId: input.wikiId }).pipe(
      Effect.map(({ changeRequests }) =>
        changeRequests.find((entry) => entry.changeRequestId === input.changeRequestId),
      ),
      Effect.filterOrFail(
        (found): found is WikiChangeRequest => found !== undefined,
        () =>
          new WikiError({
            reason: "not-found",
            message: "No change request has this id in this wiki.",
            changeRequestId: input.changeRequestId,
          }),
      ),
    );

  const refOf = (projectId: ProjectId, link: WikiPullRequestLink): PullRequestRef => ({
    projectId,
    repository: link.repository,
    number: link.number,
  });

  /** The repository's name as `PullRequestRef` wants it, from the host's own link. */
  const repositoryOf = Effect.fn("WikiHostService.repositoryOf")(function* (
    projectId: ProjectId,
    url: string,
  ) {
    const parsed = sourceControlDefinitions.parseChangeRequestUrl(url)?.link;
    if (parsed !== undefined) return parsed.repository;
    const project = yield* projects
      .getById(projectId)
      .pipe(Effect.mapError(hostError("The wiki's project could not be read.")));
    const repository = Option.isSome(project)
      ? sourceControlDefinitions.repositorySelector(project.value.repositoryIdentity)
      : null;
    if (repository === null) {
      return yield* new WikiError({
        reason: "invalid",
        message: "The pull request could not be matched to a repository.",
      });
    }
    return repository;
  });

  const describe = (entry: WikiChangeRequest) =>
    entry.amendments.length === 0
      ? `Wiki change request ${entry.changeRequestId}.`
      : entry.amendments.map((amendment) => `- ${amendment.subject}`).join("\n");

  const openPullRequest = Effect.fn("WikiHostService.openPullRequest")(function* (
    wiki: WikiSummary,
    projectId: ProjectId,
    entry: WikiChangeRequest,
  ) {
    const failed = hostError("The pull request could not be opened on the host.");
    const provider = yield* providers.resolve({ cwd: wiki.root }).pipe(Effect.mapError(failed));
    const headSelector = entry.branch.slice("refs/heads/".length);
    const find = provider
      .listChangeRequests({ cwd: wiki.root, headSelector, state: "open", limit: 1 })
      .pipe(
        Effect.map((found) => found[0]),
        Effect.mapError(failed),
      );
    const existing = yield* find;
    if (existing === undefined) {
      yield* Effect.scoped(
        Effect.gen(function* () {
          const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-wiki-pr-" });
          const bodyFile = path.join(directory, "body.md");
          yield* fileSystem.writeFileString(bodyFile, describe(entry));
          yield* provider.createChangeRequest({
            cwd: wiki.root,
            baseRefName: wiki.mainBranch,
            headSelector,
            title: entry.title,
            bodyFile,
          });
        }),
      ).pipe(Effect.mapError(failed));
    }
    const opened = existing ?? (yield* find);
    if (opened === undefined) {
      return yield* new WikiError({
        reason: "git-failed",
        message: "The host accepted the pull request but does not list it yet.",
      });
    }
    const link: WikiPullRequestLink = {
      repository: yield* repositoryOf(projectId, opened.url),
      number: opened.number,
      url: opened.url,
    };
    const linked = yield* wikis.recordPullRequest({
      wikiId: wiki.wikiId,
      changeRequestId: entry.changeRequestId,
      pullRequest: link,
    });
    // An agent's work asks no reviewer until a person marks it ready, where the host can say so.
    if (existing === undefined && entry.threadId !== null) {
      yield* pullRequests.detail(refOf(projectId, link)).pipe(
        Effect.flatMap((detail) =>
          detail.capabilities.actions.includes("draft")
            ? pullRequests.runAction({ ...refOf(projectId, link), action: "draft" })
            : Effect.void,
        ),
        Effect.catch((cause) =>
          Effect.logWarning("A wiki pull request could not be made a draft").pipe(
            Effect.annotateLogs({ wikiId: wiki.wikiId, cause }),
          ),
        ),
      );
    }
    yield* pullRequests.refreshAfterTurn(projectId);
    return linked;
  });

  const publish: WikiHostService["Service"]["publish"] = Effect.fn("WikiHostService.publish")(
    function* (input) {
      const wiki = yield* wikis.get(input.wikiId);
      const host = yield* hostOf(wiki);
      const pushed = yield* wikis.pushChangeRequest(input);
      if (pushed.pullRequest != null || pushed.amendments.length === 0) return pushed;
      return yield* opening.withPermits(1)(
        Effect.gen(function* () {
          const current = yield* changeRequest(input);
          return current.pullRequest != null
            ? current
            : yield* openPullRequest(wiki, host.projectId, current);
        }),
      );
    },
  );

  /** Follows one change request's pull request; what moved on the host is the host's to say. */
  const settle = Effect.fn("WikiHostService.settle")(function* (
    projectId: ProjectId,
    entry: WikiChangeRequest,
  ) {
    if (entry.pullRequest == null) return;
    const target = { wikiId: entry.wikiId, changeRequestId: entry.changeRequestId };
    const { state } = yield* pullRequests
      .summary(refOf(projectId, entry.pullRequest))
      .pipe(Effect.mapError(hostError("The pull request could not be read from the host.")));
    if (state === "merged") {
      yield* wikis.recordHostMerge(target);
    } else if (state !== entry.status) {
      yield* wikis.setChangeRequestStatus({ ...target, status: state });
    }
  });

  const syncWiki = Effect.fn("WikiHostService.syncWiki")(function* (wikiId: WikiId) {
    const wiki = yield* wikis.get(wikiId);
    const host = yield* hostOf(wiki);
    yield* wikis.syncFromHost(wikiId);
    const { changeRequests } = yield* wikis.changeRequestsList({ wikiId });
    const now = DateTime.toEpochMillis(yield* DateTime.now);
    const age = (entry: WikiChangeRequest) => now - Date.parse(entry.updatedAt);
    for (const entry of changeRequests) {
      if (entry.status === "merged") continue;
      if (entry.status === "closed" && age(entry) > CLOSED_WATCH_MS) continue;
      yield* settle(host.projectId, entry);
    }
    const unpublished = changeRequests.filter(
      (entry) =>
        entry.status === "open" &&
        entry.pushedHead !== entry.head &&
        entry.amendments.length > 0 &&
        age(entry) > UNPUBLISHED_GRACE_MS,
    );
    for (const entry of unpublished) {
      yield* publish({ wikiId, changeRequestId: entry.changeRequestId });
    }
  });

  /** Syncs one wiki for a person who asked; the failure reaches them and the wiki records it. */
  const syncRecording = (wikiId: WikiId) =>
    syncWiki(wikiId).pipe(
      Effect.tapError((error) =>
        wikis.recordHostError(wikiId, error.message).pipe(Effect.ignore),
      ),
    );

  const sync: WikiHostService["Service"]["sync"] = (input) =>
    syncRecording(input.wikiId).pipe(Effect.andThen(wikis.get(input.wikiId)));

  const connect: WikiHostService["Service"]["connect"] = Effect.fn("WikiHostService.connect")(
    function* (input) {
      const wiki = yield* wikis.get(input.wikiId);
      yield* providers
        .resolve({ cwd: wiki.root })
        .pipe(
          Effect.mapError(
            hostError("This wiki's folder is not connected to a git host we can reach."),
          ),
        );
      const uuid = yield* crypto.randomUUIDv4().pipe(Effect.orDie);
      const { project } = yield* projects
        .bootstrap({
          commandId: CommandId.make(`wiki-host-connect:${uuid}`),
          projectId: ProjectId.make(uuid),
          title: wiki.name,
          workspaceRoot: wiki.root,
        })
        .pipe(Effect.mapError(hostError("The wiki's project could not be created.")));
      const mirror = wiki.mirror;
      yield* wikis.setHost(input.wikiId, {
        projectId: project.id,
        remote: input.remote ?? "origin",
      });
      const undo = wikis
        .setHost(input.wikiId, null)
        .pipe(
          Effect.andThen(
            mirror === null
              ? Effect.void
              : wikis.setMirror({ wikiId: input.wikiId, url: mirror.url }),
          ),
          Effect.ignore,
        );
      const settled = wikis.syncFromHost(input.wikiId).pipe(
        Effect.flatMap((relation) => {
          if (relation === "diverged") {
            return Effect.fail(
              new WikiError({
                reason: "conflict",
                message:
                  "The wiki and the host have different histories. Bring them together in git, then connect again.",
              }),
            );
          }
          return relation === "ahead"
            ? wikis
                .pushMainToHost(input.wikiId)
                .pipe(Effect.andThen(wikis.syncFromHost(input.wikiId)))
            : Effect.succeed(relation);
        }),
        Effect.tapError(() => undo),
      );
      yield* settled;
      return yield* wikis.get(input.wikiId);
    },
  );

  const disconnect: WikiHostService["Service"]["disconnect"] = (input) =>
    wikis.setHost(input.wikiId, null);

  const merge: WikiHostService["Service"]["merge"] = Effect.fn("WikiHostService.merge")(
    function* (input) {
      const wiki = yield* wikis.get(input.wikiId);
      if (wiki.host == null) return yield* wikis.merge(input);
      const { projectId } = wiki.host;
      yield* syncWiki(input.wikiId);
      const published = yield* publish(input);
      if (published.pullRequest == null) {
        return yield* new WikiError({
          reason: "invalid",
          message: "This change request has nothing to merge yet.",
        });
      }
      const ref = refOf(projectId, published.pullRequest);
      const unreadable = hostError("The pull request could not be read from the host.");
      let detail = yield* pullRequests.detail(ref).pipe(Effect.mapError(unreadable));
      // The markdown merge settles what the host's line merge cannot.
      if (detail.mergeability === "conflicting") {
        yield* wikis.reconcileChangeRequest(input);
        yield* publish(input);
        detail = yield* pullRequests.detail(ref).pipe(Effect.mapError(unreadable));
      }
      const mergeMethod = preferredMergeMethod(detail.mergeCapabilities);
      if (mergeMethod === null) {
        return yield* new WikiError({
          reason: "invalid",
          message: "This repository's settings allow no way to merge this pull request.",
        });
      }
      yield* pullRequests
        .runAction({ ...ref, action: "merge", mergeMethod })
        .pipe(Effect.mapError(hostError("The host refused to merge this pull request.")));
      const { state } = yield* pullRequests.summary(ref).pipe(Effect.mapError(unreadable));
      if (state !== "merged") {
        return yield* new WikiError({
          reason: "invalid",
          message: "The host has not merged this pull request yet. It may be waiting on checks.",
        });
      }
      yield* wikis.syncFromHost(input.wikiId);
      const merged = yield* wikis.recordHostMerge(input);
      return { changeRequest: merged, commit: merged.mergedCommit ?? "" };
    },
  );

  const setChangeRequestStatus: WikiHostService["Service"]["setChangeRequestStatus"] = Effect.fn(
    "WikiHostService.setChangeRequestStatus",
  )(function* (input) {
    const wiki = yield* wikis.get(input.wikiId);
    const entry = yield* changeRequest(input);
    if (wiki.host != null && entry.pullRequest != null && entry.status !== input.status) {
      const ref = refOf(wiki.host.projectId, entry.pullRequest);
      const action = input.status === "open" ? "reopen" : "close";
      const failed = hostError("The host refused to change this pull request.");
      const detail = yield* pullRequests.detail(ref).pipe(Effect.mapError(failed));
      if (!detail.capabilities.actions.includes(action)) {
        return yield* new WikiError({
          reason: "invalid",
          message: "This host can't reopen a pull request. Open a new change request instead.",
        });
      }
      yield* pullRequests.runAction({ ...ref, action }).pipe(Effect.mapError(failed));
    }
    return yield* wikis.setChangeRequestStatus(input);
  });

  const publishThread: WikiHostService["Service"]["publishThread"] = (threadId) =>
    Queue.offer(jobs, { kind: "thread", threadId }).pipe(Effect.asVoid);

  /** A failure stays on the wiki, where its settings show it, and the next sweep tries again. */
  const quietly = (wikiId: WikiId, effect: Effect.Effect<unknown, WikiError>) =>
    effect.pipe(
      Effect.asVoid,
      Effect.catch((error) =>
        wikis
          .recordHostError(wikiId, error.message)
          .pipe(
            Effect.andThen(
              Effect.logWarning("Wiki host work failed").pipe(
                Effect.annotateLogs({ wikiId, cause: error }),
              ),
            ),
            Effect.ignore,
          ),
      ),
    );

  const publishForThread = Effect.fn("WikiHostService.publishForThread")(function* (
    threadId: ThreadId,
  ) {
    const hosted = yield* wikis.hosted;
    for (const wikiId of hosted) {
      const { changeRequests } = yield* wikis.changeRequestsList({
        wikiId,
        threadId,
        status: "open",
      });
      for (const entry of changeRequests) {
        yield* quietly(wikiId, publish({ wikiId, changeRequestId: entry.changeRequestId }));
      }
    }
  });

  /** A person's edit has no turn to wait for; an agent's waits for its turn to end. */
  const publishIfPerson = Effect.fn("WikiHostService.publishIfPerson")(function* (
    wikiId: WikiId,
    changeRequestId: WikiChangeRequestId,
  ) {
    const entry = yield* changeRequest({ wikiId, changeRequestId });
    if (entry.status !== "open") return;
    if (entry.amendments.at(-1)?.actor !== WikiService.person.actor) return;
    yield* publish({ wikiId, changeRequestId });
  });

  const sweep: WikiHostService["Service"]["sweep"] = wikis.hosted.pipe(
    Effect.flatMap((hosted) =>
      Effect.forEach(hosted, (wikiId) => quietly(wikiId, syncWiki(wikiId)), { discard: true }),
    ),
    Effect.catch((cause) =>
      Effect.logWarning("Wiki host sweep failed").pipe(Effect.annotateLogs({ cause })),
    ),
  );

  const run = (job: Job): Effect.Effect<void> => {
    switch (job.kind) {
      case "sweep":
        return sweep;
      case "thread":
        return publishForThread(job.threadId).pipe(
          Effect.catch((cause) =>
            Effect.logWarning("A thread's wiki work could not be published").pipe(
              Effect.annotateLogs({ cause }),
            ),
          ),
        );
      case "edited":
        return quietly(job.wikiId, publishIfPerson(job.wikiId, job.changeRequestId));
    }
  };

  // One worker keeps pushes and sweeps from racing each other for no gain.
  yield* forkParked(Queue.take(jobs).pipe(Effect.flatMap(run), Effect.forever));
  yield* forkParked(
    Queue.offer(jobs, { kind: "sweep" }).pipe(Effect.repeat(Schedule.spaced(SWEEP_INTERVAL))),
  );
  yield* forkParked(
    wikis.subscribe.pipe(
      Stream.runForEach((event) =>
        event.kind === "amended" && event.changeRequestId !== null
          ? Queue.offer(jobs, {
              kind: "edited",
              wikiId: event.wikiId,
              changeRequestId: event.changeRequestId,
            })
          : Effect.void,
      ),
    ),
  );

  return WikiHostService.of({
    connect,
    disconnect,
    sync,
    publish,
    merge,
    setChangeRequestStatus,
    publishThread,
    sweep,
  });
});

export const layer = Layer.effect(WikiHostService, make);
