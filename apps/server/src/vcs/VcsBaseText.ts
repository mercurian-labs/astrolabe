import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import {
  VcsBaseTextError,
  type VcsBaseTextInput,
  type VcsBaseTextResult,
} from "@t3tools/contracts";

import * as KnownWorkspaces from "../workspace/KnownWorkspaces.ts";
import * as GitVcsDriver from "./GitVcsDriver.ts";
import * as VcsStatusBroadcaster from "./VcsStatusBroadcaster.ts";

// The same limit as reading the file itself: a file bigger than this opens read only.
const BASE_TEXT_MAX_BYTES = 1024 * 1024;

/**
 * Astrolabe: the text an open file's change markers compare against (its committed text), read
 * once and again whenever the checkout's status changes its blob.
 */
export class VcsBaseText extends Context.Service<
  VcsBaseText,
  {
    readonly read: (input: VcsBaseTextInput) => Effect.Effect<VcsBaseTextResult, VcsBaseTextError>;
    /** The base text now, then each time a status change gives the file another one. */
    readonly stream: (
      input: VcsBaseTextInput,
    ) => Stream.Stream<VcsBaseTextResult, VcsBaseTextError>;
  }
>()("t3/vcs/VcsBaseText") {}

const make = Effect.gen(function* () {
  const git = yield* GitVcsDriver.GitVcsDriver;
  const knownWorkspaces = yield* KnownWorkspaces.KnownWorkspaces;
  const statusBroadcaster = yield* VcsStatusBroadcaster.VcsStatusBroadcaster;

  const failure = (input: VcsBaseTextInput, detail: string) => (cause: unknown) =>
    new VcsBaseTextError({ cwd: input.cwd, path: input.path, detail, cause });

  const runGit = (input: VcsBaseTextInput, operation: string, args: ReadonlyArray<string>) =>
    git
      .execute({
        operation: `VcsBaseText.${operation}`,
        cwd: input.cwd,
        args,
        allowNonZeroExit: true,
        maxOutputBytes: BASE_TEXT_MAX_BYTES + 1,
      })
      .pipe(Effect.mapError(failure(input, "Git could not read it.")));

  /** The base's blob id, or null when the file has no base (untracked, or no repository). */
  const blobId = Effect.fn("VcsBaseText.blobId")(function* (input: VcsBaseTextInput) {
    yield* knownWorkspaces
      .assertContains(input.cwd)
      .pipe(Effect.mapError(failure(input, "Not a known workspace.")));
    // `./` makes the path relative to `cwd`, not to the repository's root.
    const result = yield* runGit(input, "blobId", [
      "rev-parse",
      "--verify",
      "--quiet",
      "--end-of-options",
      `HEAD:./${input.path}`,
    ]);
    const id = result.stdout.trim();
    return result.exitCode === 0 && id.length > 0 ? id : null;
  });

  const readBlob = Effect.fn("VcsBaseText.readBlob")(function* (
    input: VcsBaseTextInput,
    id: string | null,
  ) {
    if (id === null) return null;
    const size = yield* runGit(input, "size", ["cat-file", "-s", id]);
    if (size.exitCode !== 0 || Number(size.stdout.trim()) > BASE_TEXT_MAX_BYTES) return null;
    const blob = yield* runGit(input, "text", ["cat-file", "blob", id]);
    if (blob.exitCode !== 0 || blob.stdout.includes("\0")) return null;
    return { text: blob.stdout, hash: id };
  });

  const read: VcsBaseText["Service"]["read"] = Effect.fn("VcsBaseText.read")(function* (input) {
    return yield* readBlob(input, yield* blobId(input));
  });

  const stream: VcsBaseText["Service"]["stream"] = (input) =>
    statusBroadcaster.streamStatus({ cwd: input.cwd, includeRemote: false }).pipe(
      Stream.mapError(failure(input, "The checkout's status stopped.")),
      Stream.filter((event) => event._tag !== "remoteUpdated"),
      Stream.mapEffect(() => blobId(input)),
      Stream.changes,
      Stream.mapEffect((id) => readBlob(input, id)),
    );

  return VcsBaseText.of({ read, stream });
});

export const layer = Layer.effect(VcsBaseText, make);
