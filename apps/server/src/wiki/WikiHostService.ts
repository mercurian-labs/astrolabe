/**
 * Host wikis: main lines on a git host, change requests as its pull requests. Everything
 * host-shaped goes through the provider drivers, so each host offers what its driver offers.
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
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import * as ProjectService from "../project/ProjectService.ts";
import * as PullRequestService from "../pullRequest/PullRequestService.ts";
import { forkParked } from "../serverActivation.ts";
import type { SourceControlProvider } from "@t3tools/source-control-core/server/SourceControlProvider";
import * as SourceControlProviderRegistry from "../sourceControl/SourceControlProviderRegistry.ts";
import { sourceControlDefinitions } from "../sourceControl/sourceControlDefinitions.ts";
import * as WikiService from "./WikiService.ts";
import { wikiTerms } from "./wikiStorage.ts";

/** How often host wikis pick up what happened on the host. */
const SWEEP_INTERVAL = "1 minute";
/** Unpublished work older than this missed its turn's end; the sweep publishes it. */
const UNPUBLISHED_GRACE_MS = 15 * 60_000;
/**
 * Each read is a host API call per open change request, so most sweeps ask only when main moved,
 * which any merge does; a pull request closed on the host waits for every Nth sweep.
 */
const FULL_SWEEP_EVERY = 5;
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
    /** Moves a wiki onto its folder's origin, pushing its history if the host lacks it. */
    readonly connect: (input: WikiTarget) => Effect.Effect<WikiSummary, WikiError>;
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

const hasUnpublishedAmendments = (entry: WikiChangeRequest) =>
  entry.status === "open" && entry.amendments.length > 0 && entry.pushedHead !== entry.head;

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
  const sweeps = yield* Ref.make(0);
  // A slow host must not stack sweeps up ahead of the work queued behind them.
  const sweepQueued = yield* Ref.make(false);
  // Listing then creating is what stops one change request opening two pull requests.
  const opening = yield* Semaphore.make(1);

  const hostOf = (wiki: WikiSummary) =>
    wiki.host == null
      ? Effect.fail(
          new WikiError({ reason: "invalid", message: "This wiki is not connected to a host." }),
        )
      : Effect.succeed(wiki.host);

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

  const describe = (wiki: WikiSummary, entry: WikiChangeRequest) =>
    entry.amendments.length === 0
      ? `Wiki ${wikiTerms(wiki).singular} ${entry.changeRequestId}.`
      : entry.amendments.map((amendment) => `- ${amendment.subject}`).join("\n");

  const openPullRequest = Effect.fn("WikiHostService.openPullRequest")(function* (
    wiki: WikiSummary,
    projectId: ProjectId,
    entry: WikiChangeRequest,
  ) {
    const failed = hostError(`The ${wikiTerms(wiki).singular} could not be opened on the host.`);
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
          yield* fileSystem.writeFileString(bodyFile, describe(wiki, entry));
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
      // A reviewer's commit on the host and an amendment here: bring them together, then push.
      const pushed = yield* wikis.pushChangeRequest(input).pipe(
        Effect.catchIf(
          (error) => error.reason === "stale",
          () =>
            wikis
              .syncFromHost(input.wikiId)
              .pipe(
                Effect.andThen(wikis.adoptHostBranch(input)),
                Effect.andThen(wikis.pushChangeRequest(input)),
              ),
        ),
      );
      if (pushed.pullRequest != null || pushed.amendments.length === 0) return pushed;
      return yield* opening.withPermits(1)(
        Effect.gen(function* () {
          const current = yield* wikis.changeRequest(input);
          return current.pullRequest != null
            ? current
            : yield* openPullRequest(wiki, host.projectId, current);
        }),
      );
    },
  );

  /**
   * Follows one change request's pull request. This asks the driver rather than
   * `PullRequestService`, whose reads answer from a cache that nothing here would ever refresh
   * for a merge made on the host's site.
   */
  const settle = Effect.fn("WikiHostService.settle")(function* (
    wiki: WikiSummary,
    provider: SourceControlProvider["Service"],
    entry: WikiChangeRequest,
  ) {
    if (entry.pullRequest == null) return;
    const target = { wikiId: entry.wikiId, changeRequestId: entry.changeRequestId };
    const { state } = yield* provider
      .getChangeRequest({ cwd: wiki.root, reference: String(entry.pullRequest.number) })
      .pipe(
        Effect.mapError(
          hostError(`The ${wikiTerms(wiki).singular} could not be read from the host.`),
        ),
      );
    if (state === "merged") {
      yield* wikis.recordHostMerge(target);
    } else if (state !== entry.status) {
      yield* wikis.setChangeRequestStatus({ ...target, status: state });
    }
  });

  const syncWiki = Effect.fn("WikiHostService.syncWiki")(function* (wikiId: WikiId, full: boolean) {
    const wiki = yield* wikis.get(wikiId);
    yield* hostOf(wiki);
    const before = wiki.host?.lastSyncedCommit ?? null;
    yield* wikis.syncFromHost(wikiId);
    const after = (yield* wikis.get(wikiId)).host?.lastSyncedCommit ?? null;
    const { changeRequests } = yield* wikis.changeRequestsList({ wikiId });
    const now = DateTime.toEpochMillis(yield* DateTime.now);
    const age = (entry: WikiChangeRequest) => now - Date.parse(entry.updatedAt);
    const issues: Array<string> = [];
    /** One stuck change request must not hold up the others, or the wiki's sync. */
    const isolated = (entry: WikiChangeRequest, effect: Effect.Effect<unknown, WikiError>) =>
      effect.pipe(
        Effect.asVoid,
        Effect.catch((error) =>
          Effect.sync(() => issues.push(`${entry.title}: ${error.message}`)).pipe(
            Effect.andThen(
              Effect.logWarning("A wiki change request could not follow the host").pipe(
                Effect.annotateLogs({ wikiId, cause: error }),
              ),
            ),
          ),
        ),
      );
    if (full || before !== after) {
      const watched = changeRequests.filter(
        (entry) =>
          entry.pullRequest != null &&
          entry.status !== "merged" &&
          !(entry.status === "closed" && age(entry) > CLOSED_WATCH_MS),
      );
      if (watched.length > 0) {
        const provider = yield* providers
          .resolve({ cwd: wiki.root })
          .pipe(Effect.mapError(hostError("The wiki's git host could not be reached.")));
        for (const entry of watched) yield* isolated(entry, settle(wiki, provider, entry));
      }
    }
    const unpublished = changeRequests.filter(
      (entry) => hasUnpublishedAmendments(entry) && age(entry) > UNPUBLISHED_GRACE_MS,
    );
    for (const entry of unpublished) {
      yield* isolated(entry, publish({ wikiId, changeRequestId: entry.changeRequestId }));
    }
    // Work still waiting may be what an earlier publish failed on, so only a clean wiki clears it.
    const waiting = changeRequests.some(hasUnpublishedAmendments);
    if (issues[0] !== undefined || !waiting) {
      yield* wikis.recordChangeRequestIssue(wikiId, issues[0] ?? null);
    }
  });

  /** Syncs one wiki for a person who asked; the failure reaches them and the wiki records it. */
  const syncRecording = (wikiId: WikiId) =>
    syncWiki(wikiId, true).pipe(
      Effect.tapError((error) => wikis.recordHostError(wikiId, error.message).pipe(Effect.ignore)),
    );

  const sync: WikiHostService["Service"]["sync"] = (input) =>
    syncRecording(input.wikiId).pipe(Effect.andThen(wikis.get(input.wikiId)));

  /** Leaves a project with threads in it: it is someone's work now. */
  const deleteBackingProject = (projectId: ProjectId) =>
    crypto.randomUUIDv4().pipe(
      Effect.flatMap((uuid) =>
        projects.delete({ commandId: CommandId.make(`wiki-host-remove:${uuid}`), projectId }),
      ),
      Effect.catchCause((cause) =>
        Effect.logInfo("A wiki's project stayed behind").pipe(Effect.annotateLogs({ cause })),
      ),
    );

  const connect: WikiHostService["Service"]["connect"] = Effect.fn("WikiHostService.connect")(
    function* (input) {
      const wiki = yield* wikis.get(input.wikiId);
      // A failed connect undoes itself by disconnecting, which must never touch a working wiki.
      if (wiki.host != null) return yield* sync(input);
      const provider = yield* providers
        .resolve({ cwd: wiki.root })
        .pipe(
          Effect.mapError(
            hostError("This wiki's folder is not connected to a git host we can reach."),
          ),
        );
      const uuid = yield* crypto.randomUUIDv4().pipe(Effect.orDie);
      const { project, created } = yield* projects
        .bootstrap({
          commandId: CommandId.make(`wiki-host-connect:${uuid}`),
          projectId: ProjectId.make(uuid),
          title: wiki.name,
          workspaceRoot: wiki.root,
        })
        .pipe(Effect.mapError(hostError("The wiki's project could not be created.")));
      const mirror = wiki.mirror;
      const removeProject = created ? deleteBackingProject(project.id) : Effect.void;
      yield* wikis
        .setHost(input.wikiId, {
          projectId: project.id,
          remote: "origin",
          kind: provider.kind,
          createdProject: created,
        })
        .pipe(Effect.tapError(() => removeProject));
      const undo = wikis
        .setHost(input.wikiId, null)
        .pipe(
          Effect.andThen(
            mirror === null
              ? Effect.void
              : wikis.setMirror({ wikiId: input.wikiId, url: mirror.url }),
          ),
          Effect.andThen(removeProject),
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

  const disconnect: WikiHostService["Service"]["disconnect"] = Effect.fn(
    "WikiHostService.disconnect",
  )(function* (input) {
    const host = (yield* wikis.get(input.wikiId)).host;
    const summary = yield* wikis.setHost(input.wikiId, null);
    if (host?.createdProject === true) yield* deleteBackingProject(host.projectId);
    return summary;
  });

  const merge: WikiHostService["Service"]["merge"] = Effect.fn("WikiHostService.merge")(
    function* (input) {
      const wiki = yield* wikis.get(input.wikiId);
      if (wiki.host == null) return yield* wikis.merge(input);
      const { projectId } = wiki.host;
      yield* wikis.syncFromHost(input.wikiId);
      const published = yield* publish(input);
      if (published.pullRequest == null) {
        return yield* new WikiError({
          reason: "invalid",
          message: `This ${wikiTerms(wiki).singular} has nothing to merge yet.`,
        });
      }
      const ref = refOf(projectId, published.pullRequest);
      const unreadable = hostError(
        `The ${wikiTerms(wiki).singular} could not be read from the host.`,
      );
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
          message: `This repository's settings allow no way to merge this ${wikiTerms(wiki).singular}.`,
        });
      }
      yield* pullRequests
        .runAction({ ...ref, action: "merge", mergeMethod })
        .pipe(
          Effect.mapError(hostError(`The host refused to merge this ${wikiTerms(wiki).singular}.`)),
        );
      const { state } = yield* pullRequests.summary(ref).pipe(Effect.mapError(unreadable));
      if (state !== "merged") {
        return yield* new WikiError({
          reason: "invalid",
          message: `The host has not merged this ${wikiTerms(wiki).singular} yet. It may be waiting on checks.`,
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
    const entry = yield* wikis.changeRequest(input);
    if (wiki.host != null && entry.pullRequest != null && entry.status !== input.status) {
      const ref = refOf(wiki.host.projectId, entry.pullRequest);
      const action = input.status === "open" ? "reopen" : "close";
      const failed = hostError(`The host refused to change this ${wikiTerms(wiki).singular}.`);
      const detail = yield* pullRequests.detail(ref).pipe(Effect.mapError(failed));
      if (!detail.capabilities.actions.includes(action)) {
        return yield* new WikiError({
          reason: "invalid",
          message: `This host can't reopen a ${wikiTerms(wiki).singular}. Open a new one instead.`,
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

  /** A refused push is this change request's trouble, not the wiki's sync's. */
  const publishQuietly = (wikiId: WikiId, entry: WikiChangeRequest) =>
    publish({ wikiId, changeRequestId: entry.changeRequestId }).pipe(
      Effect.asVoid,
      Effect.catch((error) =>
        wikis
          .recordChangeRequestIssue(wikiId, `${entry.title}: ${error.message}`)
          .pipe(
            Effect.andThen(
              Effect.logWarning("A wiki change request could not be published").pipe(
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
        yield* publishQuietly(wikiId, entry);
      }
    }
  });

  /** A person's edit has no turn to wait for; an agent's waits for its turn to end. */
  const publishIfPerson = Effect.fn("WikiHostService.publishIfPerson")(function* (
    wikiId: WikiId,
    changeRequestId: WikiChangeRequestId,
  ) {
    const entry = yield* wikis.changeRequest({ wikiId, changeRequestId });
    if (entry.status !== "open") return;
    if (entry.amendments.at(-1)?.actor !== WikiService.person.actor) return;
    yield* publishQuietly(wikiId, entry);
  });

  const sweep: WikiHostService["Service"]["sweep"] = Effect.gen(function* () {
    const count = yield* Ref.updateAndGet(sweeps, (value) => value + 1);
    yield* Effect.forEach(
      yield* wikis.hosted,
      (wikiId) => quietly(wikiId, syncWiki(wikiId, count % FULL_SWEEP_EVERY === 0)),
      { discard: true },
    );
  }).pipe(
    Effect.catch((cause) =>
      Effect.logWarning("Wiki host sweep failed").pipe(Effect.annotateLogs({ cause })),
    ),
  );

  const run = (job: Job): Effect.Effect<void> => {
    switch (job.kind) {
      case "sweep":
        return sweep.pipe(Effect.ensuring(Ref.set(sweepQueued, false)));
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
    Ref.getAndSet(sweepQueued, true).pipe(
      Effect.flatMap((queued) => (queued ? Effect.void : Queue.offer(jobs, { kind: "sweep" }))),
      Effect.repeat(Schedule.spaced(SWEEP_INTERVAL)),
    ),
  );
  yield* forkParked(
    wikis.subscribe.pipe(
      Stream.runForEach((event) => {
        const { changeRequestId, wikiId } = event;
        if (event.kind !== "amended" || changeRequestId === null) return Effect.void;
        return wikis.hosted.pipe(
          Effect.flatMap((hosted) =>
            hosted.includes(wikiId)
              ? Queue.offer(jobs, { kind: "edited", wikiId, changeRequestId })
              : Effect.void,
          ),
          Effect.ignore,
        );
      }),
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
