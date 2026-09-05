/** Representative dashboard shapes shared by the catalog and the logic tests. */
import {
  MercurianCommitId,
  MercurianProjectId,
  MercurianRepositoryId,
  type MemoryAmendmentSummary,
  type MemoryCatalog,
  type MemoryChangedDocument,
  type MemoryComparisonTarget,
  type MemoryPosition,
} from "@t3tools/contracts";

import type { MemoryAvailableDashboard } from "./MemoryTab.logic";

const oid = (seed: string) => seed.padEnd(40, "0").slice(0, 40);

export const MEMORY_FIXTURE_POSITION: MemoryPosition = {
  projectId: MercurianProjectId.make("project-1"),
  repositoryId: MercurianRepositoryId.make("repository-memory"),
  memoryRoot: "",
  lineRootCommitId: MercurianCommitId.make("line-root"),
  reading: { kind: "latest" },
  baselineTreeOid: oid("aaa1"),
  baselineSnapshotOid: null,
  baseCommitOid: oid("bbb1"),
  snapshotOid: oid("ccc1"),
  treeOid: oid("ddd1"),
  recordedHeadOid: oid("eee1"),
  headOid: oid("eee1"),
  captureKind: null,
};

const comparison = (
  paths: ReadonlyArray<string>,
  before = MEMORY_FIXTURE_POSITION.baselineTreeOid,
  after = MEMORY_FIXTURE_POSITION.treeOid,
): MemoryComparisonTarget => ({
  position: MEMORY_FIXTURE_POSITION,
  beforeTreeOid: before,
  afterTreeOid: after,
  paths,
});

const document = (
  id: string,
  path: string,
  overrides: Partial<MemoryChangedDocument> = {},
): MemoryChangedDocument => ({
  id,
  path,
  previousPaths: [],
  kind: "note",
  status: "modified",
  latestCheckpoint: null,
  amendmentIds: [],
  document: {
    position: MEMORY_FIXTURE_POSITION,
    path,
    treeOid: MEMORY_FIXTURE_POSITION.treeOid,
    blobOid: oid(`f${id.replace(/\D/gu, "")}`),
    deleted: false,
  },
  comparison: comparison([path]),
  ...overrides,
});

export const MEMORY_FIXTURE_AMENDMENTS: ReadonlyArray<MemoryAmendmentSummary> = [
  {
    id: oid("1a1"),
    kind: "marked",
    title: "Record the composer boundary",
    turnId: "turn-42",
    reviewed: true,
    documentIds: ["doc-composer", "doc-drafts"],
    comparison: comparison(["Composer.md", "Drafts.md"], oid("aaa1"), oid("aaa2")),
  },
  {
    id: oid("2b2"),
    kind: "hand",
    title: "Clarify project vocabulary",
    turnId: null,
    reviewed: false,
    documentIds: ["doc-glossary", "doc-product-map"],
    comparison: comparison(["Glossary.md", "Product.skillmap.md"], oid("aaa2"), oid("aaa3")),
  },
  {
    id: oid("3c3"),
    kind: "marked",
    title: 'Revert "Record the composer boundary"',
    turnId: `revert:${oid("1a1")}`,
    revertsAmendmentId: oid("1a1"),
    reviewed: false,
    documentIds: ["doc-composer"],
    comparison: comparison(["Composer.md"], oid("aaa3"), oid("aaa4")),
  },
  {
    id: `unmarked:${oid("eee1")}:${oid("ccc1")}:9f2c`,
    kind: "unmarked",
    title: "Captured line work",
    turnId: null,
    reviewed: false,
    documentIds: ["doc-plans", "doc-workspaces"],
    comparison: comparison(["Plans.md", "Workspaces.md"], oid("aaa4"), oid("ddd1")),
  },
];

export const MEMORY_FIXTURE_DOCUMENTS: ReadonlyArray<MemoryChangedDocument> = [
  document("doc-composer", "Composer.md", { amendmentIds: [oid("1a1"), oid("3c3")] }),
  document("doc-drafts", "Drafts.md", {
    status: "renamed",
    previousPaths: ["Draft.md"],
    amendmentIds: [oid("1a1")],
  }),
  document("doc-glossary", "Glossary.md", { status: "added", amendmentIds: [oid("2b2")] }),
  document("doc-product-map", "Product.skillmap.md", {
    kind: "skill-map",
    amendmentIds: [oid("2b2")],
  }),
  document("doc-plans", "Plans.md", {
    status: "deleted",
    amendmentIds: [`unmarked:${oid("eee1")}:${oid("ccc1")}:9f2c`],
    document: {
      position: MEMORY_FIXTURE_POSITION,
      path: "Plans.md",
      treeOid: oid("aaa4"),
      blobOid: oid("f9"),
      deleted: true,
    },
  }),
  document("doc-workspaces", "Workspaces.md", {
    status: "restored",
    amendmentIds: [`unmarked:${oid("eee1")}:${oid("ccc1")}:9f2c`],
  }),
];

export const MEMORY_FIXTURE_DASHBOARD: MemoryAvailableDashboard = {
  kind: "available",
  position: MEMORY_FIXTURE_POSITION,
  documents: MEMORY_FIXTURE_DOCUMENTS,
  amendments: MEMORY_FIXTURE_AMENDMENTS,
  graph: {
    nodes: [
      { id: "doc-composer", name: "Composer" },
      { id: "doc-drafts", name: "Drafts" },
      { id: "doc-glossary", name: "Glossary" },
      { id: "doc-plans", name: "Plans" },
      { id: "doc-workspaces", name: "Workspaces" },
    ],
    edges: [
      { from: "doc-composer", to: "doc-drafts", status: "added" },
      { from: "doc-drafts", to: "doc-composer", status: "unchanged" },
      { from: "doc-glossary", to: "doc-composer", status: "removed" },
      { from: "doc-plans", to: "doc-plans", status: "unchanged" },
    ],
    outsideReferences: [{ from: "doc-composer", name: "Threads", side: "selected" }],
  },
  unreviewedCount: 3,
  limitations: [
    "Configured Plan/Spec document locations (M-214/M-216) are not available; classification currently follows the memory designation.",
    "M-203 stamps and structured rationales are not available; authored map fields remain available in raw detail.",
  ],
};

export const MEMORY_FIXTURE_MAP_ONLY_DASHBOARD: MemoryAvailableDashboard = {
  ...MEMORY_FIXTURE_DASHBOARD,
  documents: MEMORY_FIXTURE_DOCUMENTS.filter((entry) => entry.kind === "skill-map"),
  amendments: [MEMORY_FIXTURE_AMENDMENTS[1]!],
  graph: { nodes: [], edges: [], outsideReferences: [] },
  unreviewedCount: 1,
};

export const MEMORY_FIXTURE_EMPTY_DASHBOARD: MemoryAvailableDashboard = {
  ...MEMORY_FIXTURE_DASHBOARD,
  documents: [],
  amendments: [],
  graph: { nodes: [], edges: [], outsideReferences: [] },
  unreviewedCount: 0,
};

export const MEMORY_FIXTURE_CATALOG: Extract<MemoryCatalog, { readonly kind: "available" }> = {
  kind: "available",
  position: MEMORY_FIXTURE_POSITION,
  entries: [
    { path: "Threads.md", blobOid: oid("f11"), kind: "note" },
    { path: "Composer.md", blobOid: oid("f12"), kind: "note" },
    { path: "Product.skillmap.md", blobOid: oid("f13"), kind: "skill-map" },
  ],
};
