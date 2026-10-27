import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import {
  VcsRepositoryDetectionError,
  VcsUnsupportedOperationError,
  type ReviewDiffFileContentsInput,
  type ReviewDiffFileContentsResult,
  type ReviewDiffPreviewError,
  type ReviewDiffPreviewInput,
  type ReviewDiffPreviewResult,
  type ReviewRecentFile,
  type ReviewRecentFilesInput,
  type ReviewRecentFilesResult,
} from "@t3tools/contracts";

import * as ServerConfig from "../config.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as KnownWorkspaces from "../workspace/KnownWorkspaces.ts";

export class ReviewService extends Context.Service<
  ReviewService,
  {
    readonly getDiffPreview: (
      input: ReviewDiffPreviewInput,
    ) => Effect.Effect<ReviewDiffPreviewResult, ReviewDiffPreviewError>;
    readonly getDiffFileContents: (
      input: ReviewDiffFileContentsInput,
    ) => Effect.Effect<ReviewDiffFileContentsResult, ReviewDiffPreviewError>;
    /** Astrolabe: the files the checkout's recent commits changed, newest first. */
    readonly getRecentFiles: (
      input: ReviewRecentFilesInput,
    ) => Effect.Effect<ReviewRecentFilesResult, ReviewDiffPreviewError>;
  }
>()("t3/review/ReviewService") {}

/** @public */
export const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const vcsRegistry = yield* VcsDriverRegistry.VcsDriverRegistry;
  const git = yield* GitVcsDriver.GitVcsDriver;
  const knownWorkspaces = yield* KnownWorkspaces.KnownWorkspaces;

  const canonicalizePath = (value: string) => {
    const resolvedPath = path.resolve(value);
    return fileSystem.realPath(resolvedPath).pipe(
      Effect.catchTags({
        PlatformError: (cause) =>
          cause.reason._tag === "NotFound"
            ? Effect.succeed(resolvedPath)
            : Effect.fail(
                new VcsRepositoryDetectionError({
                  operation: "ReviewService.assertWorkspaceBoundCwd.canonicalizePath",
                  cwd: resolvedPath,
                  detail: "Failed to resolve a path while validating the review workspace.",
                  cause,
                }),
              ),
      }),
    );
  };

  const assertWorkspaceBoundCwd = Effect.fn("ReviewService.assertWorkspaceBoundCwd")(function* (
    operation:
      | "ReviewService.getDiffPreview"
      | "ReviewService.getDiffFileContents"
      | "ReviewService.getRecentFiles",
    cwd: string,
  ) {
    const [candidate, workspaceRoot] = yield* Effect.all([
      canonicalizePath(cwd),
      canonicalizePath(config.cwd),
    ]);
    if (
      KnownWorkspaces.isWithinRoot(path, candidate, workspaceRoot) ||
      (yield* knownWorkspaces.contains(candidate))
    ) {
      return;
    }

    return yield* new VcsRepositoryDetectionError({
      operation,
      cwd,
      detail:
        operation === "ReviewService.getDiffFileContents"
          ? "Review diff file contents cwd must stay within the configured workspace root."
          : "Review diff preview cwd must stay within the configured workspace root.",
    });
  });

  const getDiffPreview: ReviewService["Service"]["getDiffPreview"] = Effect.fn(
    "ReviewService.getDiffPreview",
  )(function* (input) {
    yield* assertWorkspaceBoundCwd("ReviewService.getDiffPreview", input.cwd);

    const handle = yield* vcsRegistry.detect({ cwd: input.cwd, requestedKind: "auto" });
    if (!handle) {
      return {
        cwd: input.cwd,
        generatedAt: yield* DateTime.now,
        sources: [],
      };
    }

    const getDriverDiffPreview = handle.driver.getDiffPreview;
    if (!getDriverDiffPreview) {
      if (handle.kind === "git") {
        return yield* git.getReviewDiffPreview(input);
      }
      return yield* new VcsUnsupportedOperationError({
        operation: "ReviewService.getDiffPreview",
        kind: handle.kind,
        detail: `The ${handle.kind} VCS driver does not support review diff previews.`,
      });
    }

    return yield* getDriverDiffPreview(input);
  });

  const getDiffFileContents: ReviewService["Service"]["getDiffFileContents"] = Effect.fn(
    "ReviewService.getDiffFileContents",
  )(function* (input) {
    yield* assertWorkspaceBoundCwd("ReviewService.getDiffFileContents", input.cwd);

    const handle = yield* vcsRegistry.detect({ cwd: input.cwd, requestedKind: "auto" });
    if (handle?.kind !== "git") {
      return yield* new VcsUnsupportedOperationError({
        operation: "ReviewService.getDiffFileContents",
        kind: handle?.kind ?? "unknown",
        detail: "Unchanged diff expansion currently requires a Git repository.",
      });
    }

    return yield* git.getReviewDiffFileContents(input);
  });

  const getRecentFiles: ReviewService["Service"]["getRecentFiles"] = Effect.fn(
    "ReviewService.getRecentFiles",
  )(function* (input) {
    yield* assertWorkspaceBoundCwd("ReviewService.getRecentFiles", input.cwd);
    const handle = yield* vcsRegistry.detect({ cwd: input.cwd, requestedKind: "auto" });
    if (handle?.kind !== "git") return { cwd: input.cwd, files: [] };
    const limit = Math.min(Math.max(Math.trunc(input.limit ?? 50), 1), 200);
    // Enough commits to fill the list most of the time; a big commit fills it on its own.
    const result = yield* git.execute({
      operation: "ReviewService.getRecentFiles",
      cwd: input.cwd,
      args: [
        "log",
        "--no-merges",
        "--name-only",
        "--no-renames",
        `--max-count=${limit}`,
        `--format=${RECENT_FILES_COMMIT_MARK}%cI%x09%s`,
      ],
      allowNonZeroExit: true,
      maxOutputBytes: 1_000_000,
    });
    if (result.exitCode !== 0) return { cwd: input.cwd, files: [] };
    // A file a later commit deleted has nothing left to open.
    const files = yield* Effect.filter(
      parseRecentFiles(result.stdout, limit),
      (file) =>
        fileSystem.exists(path.join(input.cwd, file.path)).pipe(Effect.orElseSucceed(() => false)),
      { concurrency: 16 },
    );
    return { cwd: input.cwd, files };
  });

  return ReviewService.of({
    getDiffPreview,
    getDiffFileContents,
    getRecentFiles,
  });
});

export const layer = Layer.effect(ReviewService, make);

const RECENT_FILES_COMMIT_MARK = "\u001e";

/**
 * Reads `git log --name-only` output, each commit headed by `RECENT_FILES_COMMIT_MARK` then its
 * date and subject, into each file once, at its newest commit, up to `limit` files.
 */
export function parseRecentFiles(stdout: string, limit: number): ReviewRecentFile[] {
  const files: ReviewRecentFile[] = [];
  const seen = new Set<string>();
  let changedAt = "";
  let subject = "";
  for (const line of stdout.split("\n")) {
    if (line.startsWith(RECENT_FILES_COMMIT_MARK)) {
      const header = line.slice(RECENT_FILES_COMMIT_MARK.length);
      const tab = header.indexOf("\t");
      changedAt = tab === -1 ? header : header.slice(0, tab);
      subject = tab === -1 ? "" : header.slice(tab + 1);
      continue;
    }
    const path = line.trim();
    if (path === "" || seen.has(path)) continue;
    seen.add(path);
    files.push({ path, changedAt, subject });
    if (files.length >= limit) break;
  }
  return files;
}
