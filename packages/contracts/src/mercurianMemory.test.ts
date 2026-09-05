import {
  MercurianReadMemoryIndexInput,
  MercurianReadMemoryNoteInput,
  MercurianReadLineMemoryChangesInput,
  MemoryCatalog,
  MemoryReadUnavailableError,
} from "./mercurianMemory.ts";
import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import {
  MercurianReadMemoryDashboardInput,
  MemoryDocumentSelection,
  MemoryComparisonSelection,
  MemoryDashboard,
  MemoryDocumentComment,
} from "./mercurianMemory.ts";

const decodeMercurianReadMemoryDashboardInput = Schema.decodeUnknownSync(
  MercurianReadMemoryDashboardInput,
);
const decodeMemoryDocumentSelection = Schema.decodeUnknownSync(MemoryDocumentSelection);
const decodeMemoryComparisonSelection = Schema.decodeUnknownSync(MemoryComparisonSelection);
const decodeMemoryDocumentComment = Schema.decodeUnknownSync(MemoryDocumentComment);
const decodeMemoryDashboard = Schema.decodeUnknownSync(MemoryDashboard);

const decodeIndexRequest = Schema.decodeUnknownSync(MercurianReadMemoryIndexInput);
const decodeNoteRequest = Schema.decodeUnknownSync(MercurianReadMemoryNoteInput);
const decodeChangesRequest = Schema.decodeUnknownSync(MercurianReadLineMemoryChangesInput);
const decodeCatalog = Schema.decodeUnknownSync(MemoryCatalog);
const decodeReadRefusal = Schema.decodeUnknownSync(MemoryReadUnavailableError);

const oid = "a".repeat(40);
const position = {
  projectId: "project",
  repositoryId: "repository",
  lineRootCommitId: "root",
  memoryRoot: "memory",
  reading: { kind: "turn", threadId: "thread", turnCount: 3 },
  baselineTreeOid: oid,
  baselineSnapshotOid: null,
  baseCommitOid: oid,
  snapshotOid: oid,
  treeOid: oid,
  recordedHeadOid: oid,
  headOid: oid,
  captureKind: "settled",
};
const target = { position, path: "memory/Note.md", treeOid: oid, blobOid: oid, deleted: false };
describe("immutable Memory wire contracts", () => {
  it("requires an explicit project, line and reading selection", () => {
    expect(
      decodeMercurianReadMemoryDashboardInput({
        projectId: "project",
        line: { threadId: "thread" },
        position: position.reading,
      }),
    ).toMatchObject({ position: { turnCount: 3 } });
    expect(() =>
      decodeMercurianReadMemoryDashboardInput({
        projectId: "project",
        line: { threadId: "thread" },
      }),
    ).toThrow();
  });
  it("retains environment, repository and immutable versions for shared surfaces and comments", () => {
    const selection = { environmentId: "remote", target };
    expect(decodeMemoryDocumentSelection(selection)).toEqual(selection);
    const comparison = {
      environmentId: "remote",
      target: { position, beforeTreeOid: oid, afterTreeOid: "b".repeat(40), paths: [target.path] },
    };
    expect(decodeMemoryComparisonSelection(comparison)).toEqual(comparison);
    expect(
      decodeMemoryDocumentComment({
        ...selection,
        startLine: 2,
        endLine: 4,
        text: "Review this version",
      }),
    ).toMatchObject(selection);
    expect(() =>
      decodeMemoryDocumentSelection({
        ...selection,
        target: { ...target, treeOid: "refs/heads/main" },
      }),
    ).toThrow();
  });
  it("distinguishes missing history from an available empty dashboard", () => {
    expect(decodeMemoryDashboard({ kind: "unavailable", reason: "object-missing" })).toEqual({
      kind: "unavailable",
      reason: "object-missing",
    });
    expect(
      decodeMemoryDashboard({
        kind: "available",
        position,
        documents: [],
        amendments: [],
        graph: { nodes: [], edges: [], outsideReferences: [] },
        unreviewedCount: 0,
        limitations: [],
      }),
    ).toMatchObject({ kind: "available" });
  });
  it("preserves legacy latest defaults while carrying an explicit historical position", () => {
    const line = { planId: "plan", commitId: "line-root" };
    expect(decodeIndexRequest({ projectId: "project", line })).toEqual({
      projectId: "project",
      line,
    });
    const at = { kind: "checkpoint", commitId: "selected-checkpoint" };
    expect(decodeIndexRequest({ projectId: "project", line, position: at }).position).toEqual(at);
    expect(
      decodeNoteRequest({ projectId: "project", line, name: "A", position: at }).position,
    ).toEqual(at);
    expect(decodeChangesRequest({ line, position: at }).position).toEqual(at);
    expect(
      decodeReadRefusal({ _tag: "MemoryReadUnavailableError", reason: "object-missing" }).reason,
    ).toBe("object-missing");
  });
  it("carries one immutable position for a lazy catalog", () => {
    const value = {
      kind: "available",
      position,
      entries: [{ path: "memory/Note.md", blobOid: oid, kind: "note" }],
    };
    expect(decodeCatalog(value)).toEqual(value);
  });
});
