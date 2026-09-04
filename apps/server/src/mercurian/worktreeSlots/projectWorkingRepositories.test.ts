import { assert, describe, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";

import { MercurianProjectId, MercurianRepositoryId } from "@t3tools/contracts";

import type { MemorySource } from "../memory/schema.ts";
import type { RepositoriesSnapshot } from "../repositories/RepositoryStore.ts";
import type { RepositoryView } from "../repositories/schema.ts";
import { projectWorkingRepositories } from "./projectWorkingRepositories.ts";

const projectId = MercurianProjectId.make("project");
const otherProjectId = MercurianProjectId.make("other-project");
const at = DateTime.makeUnsafe("2026-09-04T00:00:00.000Z");
const repository = (id: string, path: string): RepositoryView => ({
  repositoryId: MercurianRepositoryId.make(id),
  name: id,
  path,
  scripts: [],
  hasGit: true,
  hosting: null,
  createdAt: at,
  updatedAt: at,
});
const code = repository("code", "/workspace/code");
const memory = repository("memory", "/workspace/memory");
const snapshot: RepositoriesSnapshot = {
  repositories: [code, memory],
  projectRepositories: [
    { projectId, repositoryId: code.repositoryId },
    { projectId: otherProjectId, repositoryId: memory.repositoryId },
  ],
};
const source = (repositoryId: MercurianRepositoryId, subpath: string | null): MemorySource => ({
  projectId,
  repositoryId,
  subpath,
  createdAt: at,
  updatedAt: at,
});

describe("projectWorkingRepositories", () => {
  it("returns linked repositories when memory is not designated", () => {
    assert.deepStrictEqual(projectWorkingRepositories(snapshot, projectId, null), [code]);
  });

  it("does not duplicate a linked memory repository", () => {
    assert.deepStrictEqual(
      projectWorkingRepositories(snapshot, projectId, source(code.repositoryId, null)),
      [code],
    );
  });

  it("appends a standalone memory repository", () => {
    assert.deepStrictEqual(
      projectWorkingRepositories(snapshot, projectId, source(memory.repositoryId, null)),
      [code, memory],
    );
  });

  it("uses the containing repository for a memory subpath", () => {
    assert.deepStrictEqual(
      projectWorkingRepositories(snapshot, projectId, source(code.repositoryId, "notes")),
      [code],
    );
  });
});
