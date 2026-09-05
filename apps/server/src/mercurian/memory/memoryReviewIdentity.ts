import * as NodeCrypto from "node:crypto";

export const memoryReviewVersion = (value: unknown) =>
  NodeCrypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");

export const unmarkedReviewId = (head: string, snapshot: string, paths: readonly string[]) =>
  `unmarked:${head}:${snapshot}:${memoryReviewVersion([...paths].sort())}`;
