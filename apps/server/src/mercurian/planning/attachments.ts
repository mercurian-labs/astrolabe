/**
 * Images a plan message carries, on their way in.
 *
 * A plan's attachments are the server's attachments: the same id shape, the
 * same directory, the same assets door reading them back — nothing about that
 * pipeline was ever thread-scoped, so pointing it at a plan takes no second
 * store and no second door. What a commit keeps is the metadata; the bytes
 * land here, once, before anything is written to the history.
 *
 * Normalizing at the boundary rather than inside {@link PlanningStore} is the
 * repository's existing division: the store is a sqlite-and-commits module,
 * and turning a base64 upload into a file on disk is what the wire handler
 * does before handing over a value. `Normalizer` does exactly this for a
 * thread's turn.
 *
 * A refusal after some files are written leaves them behind unreferenced —
 * the same shape of leak the thread path already has, and no sweep exists for
 * either yet.
 *
 * @module PlanAttachments
 */
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import {
  type ChatAttachment,
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  type UploadChatAttachment,
} from "@t3tools/contracts";

import { createAttachmentId, resolveAttachmentPath } from "../../attachmentStore.ts";
import { ServerConfig } from "../../config.ts";
import { parseBase64DataUrl } from "../../imageMime.ts";

/**
 * An upload this server will not take. Never a refusal the surface renders:
 * the composer caps count and size before sending, so reaching here means a
 * client sent something it should not have.
 */
export class PlanAttachmentError extends Schema.TaggedErrorClass<PlanAttachmentError>()(
  "PlanAttachmentError",
  { reason: Schema.String },
) {
  override get message(): string {
    return this.reason;
  }
}

/**
 * Persist a message's uploads and answer with what the commit should record.
 *
 * `owner` is what the attachment id's leading segment names — the plan for a
 * message, the project for a plan's birth message, since a plan being born has
 * no id yet. Nothing reads that segment back to decide anything: the assets
 * door resolves an attachment by its id alone. It is a grouping prefix, so
 * files in the directory say where they came from.
 */
export const normalizePlanAttachments = Effect.fn("PlanAttachments.normalize")(function* (input: {
  readonly owner: string;
  readonly uploads: ReadonlyArray<UploadChatAttachment> | undefined;
}) {
  const uploads = input.uploads ?? [];
  if (uploads.length === 0) {
    return [] as ReadonlyArray<ChatAttachment>;
  }
  if (uploads.length > PROVIDER_SEND_TURN_MAX_ATTACHMENTS) {
    return yield* new PlanAttachmentError({
      reason: `A message takes at most ${PROVIDER_SEND_TURN_MAX_ATTACHMENTS} attachments.`,
    });
  }

  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const serverConfig = yield* ServerConfig;

  return yield* Effect.forEach(
    uploads,
    (upload) =>
      Effect.gen(function* () {
        const parsed = parseBase64DataUrl(upload.dataUrl);
        if (!parsed || !parsed.mimeType.startsWith("image/")) {
          return yield* new PlanAttachmentError({
            reason: `Invalid image attachment payload for '${upload.name}'.`,
          });
        }

        const bytes = Buffer.from(parsed.base64, "base64");
        if (bytes.byteLength === 0 || bytes.byteLength > PROVIDER_SEND_TURN_MAX_IMAGE_BYTES) {
          return yield* new PlanAttachmentError({
            reason: `Image attachment '${upload.name}' is empty or too large.`,
          });
        }

        const attachmentId = createAttachmentId(input.owner);
        if (!attachmentId) {
          return yield* new PlanAttachmentError({
            reason: "Failed to create a safe attachment id.",
          });
        }

        const attachment = {
          type: "image" as const,
          id: attachmentId,
          name: upload.name,
          mimeType: parsed.mimeType.toLowerCase(),
          sizeBytes: bytes.byteLength,
        } satisfies ChatAttachment;

        const attachmentPath = resolveAttachmentPath({
          attachmentsDir: serverConfig.attachmentsDir,
          attachment,
        });
        if (!attachmentPath) {
          return yield* new PlanAttachmentError({
            reason: `Failed to resolve persisted path for '${upload.name}'.`,
          });
        }

        yield* fileSystem.makeDirectory(path.dirname(attachmentPath), { recursive: true }).pipe(
          Effect.mapError(
            () =>
              new PlanAttachmentError({
                reason: `Failed to create attachment directory for '${upload.name}'.`,
              }),
          ),
        );
        yield* fileSystem.writeFile(attachmentPath, bytes).pipe(
          Effect.mapError(
            () =>
              new PlanAttachmentError({
                reason: `Failed to persist attachment '${upload.name}'.`,
              }),
          ),
        );

        return attachment;
      }),
    // One at a time, as the thread path does: a burst of large images should
    // not race the disk.
    { concurrency: 1 },
  );
});
