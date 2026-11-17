import {
  type OrchestrationV2Checkpoint,
  type OrchestrationV2FileRevertBlock,
  type OrchestrationV2FileRevertPreview,
  OrchestrationV2PreviewFileRevertError,
  type OrchestrationV2PreviewFileRevertInput,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as Documents from "../documents/Documents.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import {
  checkoutFiles,
  fileDiff,
  isCheckoutRelativePath,
  latestTurnCheckpoint,
} from "./EditedFilesNote.ts";
import * as ProjectStore from "./ProjectStore.ts";
import * as ThreadManagementService from "./ThreadManagementService.ts";

const isPreviewError = Schema.is(OrchestrationV2PreviewFileRevertError);

/** A diff longer than this is not sent to be shown. */
const MAX_PREVIEW_DIFF_CHARS = 256 * 1024;

const lineBreak = /\r\n?|\n/;
const normalizeLineBreaks = (text: string) => text.split(lineBreak).join("\n");

type CheckoutGit = Effect.Success<ReturnType<typeof checkoutFiles>>["git"];

/**
 * Whether a commit made since `checkpoint` changed `path` to other than the checkpoint has it, so
 * putting the checkpoint's text back would leave a change undoing that commit. Undefined when git
 * can't tell.
 */
const committedSince = Effect.fn("EditedFileRevert.committedSince")(function* (
  git: CheckoutGit,
  checkpoint: OrchestrationV2Checkpoint,
  path: string,
) {
  const head = yield* git("head", ["rev-parse", "--verify", "--quiet", "HEAD"]);
  if (head === null) return undefined;
  if (head.exitCode !== 0) return false;
  // A checkpoint commit's parent is HEAD at its capture and its tree holds uncommitted agent work,
  // so: some commit in parent..HEAD touched the path, and HEAD's blob differs from the checkpoint's.
  const parents = yield* git("checkpointParent", [
    "log",
    "-1",
    "--format=%P",
    `${checkpoint.ref}^{commit}`,
  ]);
  if (parents === null || parents.exitCode !== 0) return undefined;
  const parent = parents.stdout.trim().split(" ")[0] ?? "";
  const touched = yield* git("touchedSince", [
    "rev-list",
    "-1",
    parent === "" ? "HEAD" : `${parent}..HEAD`,
    "--",
    `./${path}`,
  ]);
  if (touched === null || touched.exitCode !== 0) return undefined;
  if (touched.stdout.trim() === "") return false;
  const blob = (revision: string) =>
    git("blob", ["rev-parse", "--verify", "--quiet", `${revision}:./${path}`]).pipe(
      Effect.map((result) =>
        result === null ? undefined : result.exitCode === 0 ? result.stdout.trim() : null,
      ),
    );
  const [atHead, atCheckpoint] = yield* Effect.all([blob("HEAD"), blob(checkpoint.ref)]);
  if (atHead === undefined || atCheckpoint === undefined) return undefined;
  return atHead !== atCheckpoint;
});

/**
 * Astrolabe: what putting `path` back as `checkpoint` has it would throw away, and whether it may
 * be done here. The file now is its open document's text, else disk's.
 */
export const fileRevertPreview = Effect.fn("EditedFileRevert.fileRevertPreview")(function* (
  input: {
    readonly cwd: string;
    readonly path: string;
    readonly checkpoint: OrchestrationV2Checkpoint | undefined;
    readonly running: boolean;
  },
  git: GitVcsDriver.GitVcsDriver["Service"] | null,
  documents: Pick<Documents.Documents["Service"], "unsavedTexts" | "editedOnlyHere">,
) {
  const { cwd, path, checkpoint } = input;
  const blocked = (reason: OrchestrationV2FileRevertBlock): OrchestrationV2FileRevertPreview => ({
    cwd,
    checkpointText: null,
    missing: false,
    diff: null,
    outsideChanges: false,
    blocked: reason,
  });
  if (checkpoint === undefined) return blocked("no-checkpoint");
  const files = yield* checkoutFiles({ cwd, checkpoint }, git);
  const base = yield* files.base(path);
  const live = (yield* documents.unsavedTexts(cwd)).find((file) => file.relativePath === path);
  const now = live === undefined ? yield* files.now(path) : live.text;
  if (base === undefined || now === undefined) return blocked("unreadable");
  if (base === null) return blocked("not-in-checkpoint");
  const before = normalizeLineBreaks(base);
  const after = now === null ? null : normalizeLineBreaks(now);
  if (before === after) return blocked("unchanged");
  const committed = input.running ? false : yield* committedSince(files.git, checkpoint, path);
  if (committed === undefined) return blocked("unreadable");
  const onlyHere =
    now !== null &&
    (yield* documents
      .editedOnlyHere({ cwd, relativePath: path, base })
      .pipe(Effect.orElseSucceed(() => false)));
  const diff = fileDiff(path, before, after);
  return {
    cwd,
    checkpointText: base,
    missing: now === null,
    diff: diff.length > MAX_PREVIEW_DIFF_CHARS ? null : diff,
    outsideChanges: !onlyHere,
    blocked: input.running ? "running" : committed ? "committed" : null,
  } satisfies OrchestrationV2FileRevertPreview;
});

/**
 * Astrolabe: for "Revert to agent's version", what putting a file the user edited back as the
 * thread's latest finished turn left it would throw away. The revert itself is an edit in the
 * user's editor, so it stays undoable there.
 */
export class EditedFileRevert extends Context.Service<
  EditedFileRevert,
  {
    readonly preview: (
      input: OrchestrationV2PreviewFileRevertInput,
    ) => Effect.Effect<OrchestrationV2FileRevertPreview, OrchestrationV2PreviewFileRevertError>;
  }
>()("t3/orchestration-v2/EditedFileRevert") {}

const make = Effect.gen(function* () {
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const documents = yield* Documents.Documents;
  const git = Option.getOrNull(yield* Effect.serviceOption(GitVcsDriver.GitVcsDriver));
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const preview = Effect.fn("EditedFileRevert.preview")(
    function* (input: OrchestrationV2PreviewFileRevertInput) {
      if (!isCheckoutRelativePath(input.path)) {
        return yield* new OrchestrationV2PreviewFileRevertError({ threadId: input.threadId });
      }
      const { thread, checkpoints, checkpointScopes, runs } = yield* threads.getThreadRecords(
        input.threadId,
        ["checkpoints", "checkpointScopes", "runs"],
        { runStatuses: ThreadManagementService.ACTIVE_RUN_STATUSES },
      );
      const cwd =
        thread.worktreePath ??
        Option.getOrUndefined(yield* projects.get(thread.projectId))?.workspaceRoot;
      if (cwd === undefined) {
        return yield* new OrchestrationV2PreviewFileRevertError({ threadId: input.threadId });
      }
      return yield* fileRevertPreview(
        {
          cwd,
          path: input.path,
          checkpoint: latestTurnCheckpoint(
            checkpoints,
            checkpointScopes,
            cwd,
            Number.POSITIVE_INFINITY,
          ),
          running: runs.some(ThreadManagementService.isActiveRun),
        },
        git,
        documents,
      );
    },
    (effect, input) =>
      effect.pipe(
        Effect.provideService(FileSystem.FileSystem, fileSystem),
        Effect.provideService(Path.Path, path),
        Effect.mapError((cause) =>
          isPreviewError(cause)
            ? cause
            : new OrchestrationV2PreviewFileRevertError({ threadId: input.threadId, cause }),
        ),
      ),
  );

  return EditedFileRevert.of({ preview });
});

export const layer = Layer.effect(EditedFileRevert, make);
