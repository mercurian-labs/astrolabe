import { assert, it } from "@effect/vitest";
import { layer as NodeServicesLayer } from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import { PROVIDER_SEND_TURN_MAX_ATTACHMENTS, type UploadChatAttachment } from "@t3tools/contracts";

import { resolveAttachmentPathById } from "../../attachmentStore.ts";
import * as ServerConfig from "../../config.ts";
import { normalizePlanAttachments, removePlanAttachments } from "./attachments.ts";

// Real files, in a temporary state directory: where the bytes land is the
// thing under test, so there is nothing here to fake.
const layer = it.layer(
  ServerConfig.layerTest(process.cwd(), { prefix: "t3-plan-attachments-test-" }).pipe(
    Layer.provideMerge(NodeServicesLayer),
  ),
);

/** A one-pixel PNG, small enough to keep the test's intent visible. */
const PIXEL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const upload = (overrides: Partial<UploadChatAttachment> = {}) =>
  ({
    type: "image",
    name: "mock.png",
    mimeType: "image/png",
    sizeBytes: 70,
    dataUrl: `data:image/png;base64,${PIXEL_PNG_BASE64}`,
    ...overrides,
  }) as UploadChatAttachment;

const OWNER = "1f0a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8";

layer("normalizePlanAttachments", (it) => {
  it.effect("writes the bytes where the assets door will look for them", () =>
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;

      const attachments = yield* normalizePlanAttachments({
        owner: OWNER,
        uploads: [upload({ name: "screenshot.png" })],
      });

      assert.strictEqual(attachments.length, 1);
      const attachment = attachments[0]!;
      assert.strictEqual(attachment.name, "screenshot.png");
      assert.strictEqual(attachment.mimeType, "image/png");
      assert.ok(attachment.sizeBytes > 0);

      // The door resolves by id alone, and it has to find what we wrote.
      const resolved = resolveAttachmentPathById({
        attachmentsDir: config.attachmentsDir,
        attachmentId: attachment.id,
      });
      assert.ok(resolved !== null);
      const written = yield* fileSystem.readFile(resolved);
      assert.strictEqual(written.byteLength, attachment.sizeBytes);
    }),
  );

  it.effect("answers with nothing when a message carries no images", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(
        [...(yield* normalizePlanAttachments({ owner: OWNER, uploads: undefined }))],
        [],
      );
      assert.deepStrictEqual(
        [...(yield* normalizePlanAttachments({ owner: OWNER, uploads: [] }))],
        [],
      );
    }),
  );

  it.effect("refuses more images than a message may carry", () =>
    Effect.gen(function* () {
      const tooMany = Array.from({ length: PROVIDER_SEND_TURN_MAX_ATTACHMENTS + 1 }, () =>
        upload(),
      );
      const refusal = yield* Effect.flip(
        normalizePlanAttachments({ owner: OWNER, uploads: tooMany }),
      );
      assert.strictEqual(refusal._tag, "PlanAttachmentError");
    }),
  );

  it.effect("refuses a payload that is not an image data url", () =>
    Effect.gen(function* () {
      const malformed = yield* Effect.flip(
        normalizePlanAttachments({
          owner: OWNER,
          uploads: [upload({ dataUrl: "not-a-data-url" })],
        }),
      );
      assert.strictEqual(malformed._tag, "PlanAttachmentError");

      // A well-formed data url of the wrong kind is refused just as firmly.
      const notAnImage = yield* Effect.flip(
        normalizePlanAttachments({
          owner: OWNER,
          uploads: [upload({ dataUrl: "data:text/plain;base64,aGVsbG8=" })],
        }),
      );
      assert.strictEqual(notAnImage._tag, "PlanAttachmentError");
    }),
  );

  it.effect("refuses an empty image", () =>
    Effect.gen(function* () {
      const empty = yield* Effect.flip(
        normalizePlanAttachments({
          owner: OWNER,
          uploads: [upload({ dataUrl: "data:image/png;base64," })],
        }),
      );
      assert.strictEqual(empty._tag, "PlanAttachmentError");
    }),
  );
});

layer("removePlanAttachments", (it) => {
  it.effect("unlinks the files a deleted plan's messages named", () =>
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;

      const attachments = yield* normalizePlanAttachments({
        owner: OWNER,
        uploads: [upload({ name: "one.png" }), upload({ name: "two.png" })],
      });
      const ids = attachments.map((attachment) => attachment.id);
      const resolve = (attachmentId: string) =>
        resolveAttachmentPathById({ attachmentsDir: config.attachmentsDir, attachmentId });
      assert.ok(ids.every((id) => resolve(id) !== null));

      yield* removePlanAttachments({ attachmentIds: ids });

      // Resolution answers null once nothing with that id is on disk, which is
      // exactly what "leaves no trace" means for the bytes.
      assert.ok(ids.every((id) => resolve(id) === null));
    }),
  );

  it.effect("tolerates ids whose files are already gone", () =>
    Effect.gen(function* () {
      const attachments = yield* normalizePlanAttachments({
        owner: OWNER,
        uploads: [upload({ name: "swept.png" })],
      });
      const id = attachments[0]!.id;

      yield* removePlanAttachments({ attachmentIds: [id] });
      // A missing file is not a failed delete: the plan is destroyed either
      // way, so a second sweep — or a message that never carried an image —
      // has to pass silently.
      yield* removePlanAttachments({ attachmentIds: [id, "never-written-at-all"] });
      yield* removePlanAttachments({ attachmentIds: [] });
    }),
  );
});
