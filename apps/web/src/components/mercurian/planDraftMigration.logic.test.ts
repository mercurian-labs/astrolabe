import {
  MercurianProjectId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  LEGACY_PLAN_DRAFTS_STORAGE_KEY,
  type LegacyPlanDraft,
  readLegacyPlanDrafts,
  removeMigratedLegacyPlanDrafts,
  resolvePlanDraftMigrations,
} from "./planDraftMigration.logic";

const draft = (draftId: string, projectId: string): LegacyPlanDraft => ({
  draftId,
  projectId,
  text: `${draftId} text`,
  createdAt: "2026-09-04T00:00:00.000Z",
  modelChoice: { provider: ProviderDriverKind.make("codex"), model: "gpt-5" },
});

const project = (projectId: string, orchestrationProjectId: string | null) => ({
  projectId: MercurianProjectId.make(projectId),
  name: projectId,
  orchestrationProjectId:
    orchestrationProjectId === null ? null : ProjectId.make(orchestrationProjectId),
  createdAt: "2026-09-04T00:00:00.000Z" as never,
  updatedAt: "2026-09-04T00:00:00.000Z" as never,
});

describe("resolvePlanDraftMigrations", () => {
  it("maps only drafts whose Mercurian project has an orchestration project", () => {
    const migrations = resolvePlanDraftMigrations({
      draftsById: {
        ready: draft("ready", "mercurian-ready"),
        pending: draft("pending", "mercurian-pending"),
      },
      projects: [
        project("mercurian-ready", "orchestration-ready"),
        project("mercurian-pending", null),
      ],
      providers: [],
    });

    expect(migrations).toHaveLength(1);
    expect(migrations[0]?.draft.draftId).toBe("ready");
    expect(migrations[0]?.orchestrationProjectId).toBe("orchestration-ready");
    expect(migrations[0]?.modelSelection).toBeNull();
  });

  it("carries a legacy model choice when it resolves on this machine", () => {
    const migrations = resolvePlanDraftMigrations({
      draftsById: { ready: draft("ready", "mercurian-ready") },
      projects: [project("mercurian-ready", "orchestration-ready")],
      providers: [
        {
          instanceId: ProviderInstanceId.make("codex"),
          driver: ProviderDriverKind.make("codex"),
          enabled: true,
          installed: true,
          auth: { status: "authenticated" },
          models: [{ slug: "gpt-5", name: "GPT-5" }],
        } as never,
      ],
    });

    expect(migrations[0]?.modelSelection).toEqual({ instanceId: "codex", model: "gpt-5" });
  });

  it("validates the legacy payload and removes only drafts that migrated", () => {
    const values = new Map<string, string>([
      [
        LEGACY_PLAN_DRAFTS_STORAGE_KEY,
        JSON.stringify({
          draftsById: {
            ready: draft("ready", "mercurian-ready"),
            pending: draft("pending", "mercurian-pending"),
            invalid: { draftId: "invalid", projectId: "project", text: 42 },
          },
        }),
      ],
    ]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    };

    expect(Object.keys(readLegacyPlanDrafts(storage))).toEqual(["ready", "pending"]);
    expect(removeMigratedLegacyPlanDrafts(storage, new Set(["ready"]))).toEqual({
      pending: draft("pending", "mercurian-pending"),
    });
    expect(Object.keys(readLegacyPlanDrafts(storage))).toEqual(["pending"]);

    removeMigratedLegacyPlanDrafts(storage, new Set(["pending"]));
    removeMigratedLegacyPlanDrafts(storage, new Set(["pending"]));
    expect(storage.getItem(LEGACY_PLAN_DRAFTS_STORAGE_KEY)).toBeNull();
  });
});
