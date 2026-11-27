/**
 * Host-backed project roots: a draft becomes a pull request on the root's host when a person
 * opens one. Everything host-shaped goes through the provider drivers, so each host offers what
 * its driver offers.
 *
 * @module WikiHostService
 */
import {
  ProjectId,
  type ProjectRootId,
  type PullRequestRef,
  type WikiChangeRequest,
  type WikiChangeRequestTarget,
  WikiError,
  type WikiPullRequestLink,
  type WikiSetChangeRequestStatusInput,
  type WikiSummary,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import * as ProjectService from "../project/ProjectService.ts";
import * as PullRequestService from "../pullRequest/PullRequestService.ts";
import * as SourceControlProviderRegistry from "../sourceControl/SourceControlProviderRegistry.ts";
import { sourceControlDefinitions } from "../sourceControl/sourceControlDefinitions.ts";
import * as WikiService from "./WikiService.ts";
import { wikiTerms } from "./wikiStorage.ts";

export class WikiHostService extends Context.Service<
  WikiHostService,
  {
    /** Pushes a change request and opens its pull request, as a draft, if it has none. */
    readonly publish: (
      input: WikiChangeRequestTarget,
    ) => Effect.Effect<WikiChangeRequest, WikiError>;
    /** Merges main into a change request with the markdown merge, then pushes it. */
    readonly resolveConflicts: (
      input: WikiChangeRequestTarget,
    ) => Effect.Effect<WikiChangeRequest, WikiError>;
    readonly setChangeRequestStatus: (
      input: WikiSetChangeRequestStatusInput,
    ) => Effect.Effect<WikiChangeRequest, WikiError>;
    /**
     * Marks a root's open change requests merged or closed where the host merged or closed their
     * pull requests there. Asks the host at most once a minute per root; nothing polls it.
     */
    readonly followHost: (wikiId: ProjectRootId) => Effect.Effect<void, WikiError>;
  }
>()("t3/wiki/WikiHostService") {}

/** How long a root's pull requests' states are trusted before a read asks the host again. */
const FOLLOW_EVERY_MS = 60_000;

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

  // Listing then creating is what stops one change request opening two pull requests.
  const opening = yield* Semaphore.make(1);
  // Two pushes of one branch at once, such as a save's and Resolve conflicts', make the host
  // refuse one; one at a time, the second finds nothing left to push.
  const publishing = yield* Semaphore.make(1);

  const hostOf = (wiki: WikiSummary) =>
    wiki.host == null
      ? Effect.fail(
          new WikiError({ reason: "invalid", message: "This wiki is not connected to a host." }),
        )
      : Effect.succeed(wiki.host);

  /** A project's folder may hold another repository than the project's own, so it reads there. */
  const refOf = (
    wiki: WikiSummary,
    projectId: ProjectId,
    link: WikiPullRequestLink,
  ): PullRequestRef =>
    PullRequestService.throughCheckout(
      { projectId, repository: link.repository, number: link.number },
      wiki.root,
    );

  /** The repository's name as `PullRequestRef` wants it, from the host's own link. */
  const repositoryOf = Effect.fn("WikiHostService.repositoryOf")(function* (
    wiki: WikiSummary,
    url: string,
  ) {
    const parsed = sourceControlDefinitions.parseChangeRequestUrl(url)?.link;
    if (parsed !== undefined) return parsed.repository;
    const identity = yield* projects.readRepositoryIdentity({ workspaceRoot: wiki.root });
    const repository = sourceControlDefinitions.repositorySelector(identity);
    if (repository === null) {
      return yield* new WikiError({
        reason: "invalid",
        message: "The wiki's repository could not be identified.",
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
        message: `The host accepted the ${wikiTerms(wiki).singular} but does not list it yet.`,
      });
    }
    const link: WikiPullRequestLink = {
      repository: yield* repositoryOf(wiki, opened.url),
      number: opened.number,
      url: opened.url,
    };
    const linked = yield* wikis.recordPullRequest({
      wikiId: wiki.wikiId,
      changeRequestId: entry.changeRequestId,
      pullRequest: link,
    });
    // A person's draft asks no reviewer until they mark it ready, where the host can say so (D3).
    if (existing === undefined) {
      yield* pullRequests.detail(refOf(wiki, projectId, link)).pipe(
        Effect.flatMap((detail) =>
          detail.capabilities.actions.includes("draft")
            ? pullRequests
                .runAction({ ...refOf(wiki, projectId, link), action: "draft" })
                .pipe(Effect.asVoid)
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
      if ((yield* wikis.changeRequest(input)).draft) {
        return yield* new WikiError({
          reason: "invalid",
          message: `A draft stays here. Make it a ${wikiTerms(wiki).singular} to publish it.`,
        });
      }
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
    publishing.withPermits(1),
  );

  const resolveConflicts: WikiHostService["Service"]["resolveConflicts"] = Effect.fn(
    "WikiHostService.resolveConflicts",
  )(function* (input) {
    yield* hostOf(yield* wikis.get(input.wikiId));
    yield* wikis.syncFromHost(input.wikiId);
    // Publishing first takes in what reviewers pushed to the branch on the host.
    yield* publish(input);
    yield* wikis.reconcileChangeRequest(input);
    return yield* publish(input);
  });

  const setChangeRequestStatus: WikiHostService["Service"]["setChangeRequestStatus"] = Effect.fn(
    "WikiHostService.setChangeRequestStatus",
  )(function* (input) {
    const wiki = yield* wikis.get(input.wikiId);
    const entry = yield* wikis.changeRequest(input);
    if (wiki.host != null && entry.pullRequest != null && entry.status !== input.status) {
      const ref = refOf(wiki, wiki.host.projectId, entry.pullRequest);
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

  const followedAt = new Map<ProjectRootId, number>();

  const followHost: WikiHostService["Service"]["followHost"] = Effect.fn(
    "WikiHostService.followHost",
  )(function* (wikiId) {
    const now = yield* Clock.currentTimeMillis;
    const last = followedAt.get(wikiId);
    if (last !== undefined && now - last < FOLLOW_EVERY_MS) return;
    followedAt.set(wikiId, now);
    const wiki = yield* wikis.get(wikiId);
    const host = wiki.host;
    if (host == null) return;
    const { changeRequests } = yield* wikis.changeRequestsList({ wikiId }, WikiService.person);
    yield* Effect.forEach(
      changeRequests.filter((entry) => entry.status === "open" && entry.pullRequest != null),
      (entry) =>
        pullRequests
          .summary({ ...refOf(wiki, host.projectId, entry.pullRequest!), allowStale: false })
          .pipe(
            Effect.flatMap(({ state }) => {
              const target = { wikiId, changeRequestId: entry.changeRequestId };
              if (state === "merged") return wikis.recordHostMerge(target);
              if (state === "closed") {
                return wikis.setChangeRequestStatus({ ...target, status: "closed" });
              }
              return Effect.void;
            }),
            Effect.catch((cause) =>
              Effect.logWarning("A wiki pull request's state could not be read").pipe(
                Effect.annotateLogs({ wikiId, cause }),
              ),
            ),
          ),
      { concurrency: 2, discard: true },
    );
  });

  return WikiHostService.of({ publish, resolveConflicts, setChangeRequestStatus, followHost });
});

export const layer = Layer.effect(WikiHostService, make);
