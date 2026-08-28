import * as DateTime from "effect/DateTime";

import type { MemorySourcesSnapshot, ProjectMemorySource } from "@t3tools/contracts";

import type { MemorySource } from "./schema.ts";

export const toWireMemorySource = (source: MemorySource): ProjectMemorySource => ({
  projectId: source.projectId,
  repositoryId: source.repositoryId,
  subpath: source.subpath,
  createdAt: DateTime.formatIso(source.createdAt),
  updatedAt: DateTime.formatIso(source.updatedAt),
});

export const toWireMemorySourcesSnapshot = (
  sources: ReadonlyArray<MemorySource>,
): MemorySourcesSnapshot => ({
  sources: sources.map(toWireMemorySource),
});
