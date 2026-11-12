import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";

import { createMemoryStorage } from "~/lib/storage";

const commands = vi.hoisted(() => ({ run: vi.fn(() => Promise.resolve()) }));
vi.mock("@t3tools/client-runtime/state/runtime", () => ({ runAtomCommand: commands.run }));
vi.mock("~/rpc/atomRegistry", () => ({ appAtomRegistry: { refresh: () => undefined } }));
vi.mock("~/state/changeGroups", () => ({
  changeGroupEnvironment: { update: "update", decisions: () => "decisions" },
}));

it("a draft started from a change group still joins it when sent after a reload", async () => {
  vi.stubGlobal("window", { localStorage: createMemoryStorage() });
  const environmentId = EnvironmentId.make("env-1");
  const ref = { environmentId, threadId: ThreadId.make("thread-draft") };
  const { DraftId } = await import("~/composerDraftStore");
  const before = await import("./changeGroupJoins");
  before.joinChangeGroupOnFirstSend(DraftId.make("draft-1"), ref, {
    environmentId,
    groupId: "root-thread",
  });

  vi.resetModules();
  const after = await import("./changeGroupJoins");
  await after.useChangeGroupDraftStore.persist.rehydrate();
  after.draftThreadSent(ref);

  expect(commands.run).toHaveBeenCalledWith(expect.anything(), "update", {
    environmentId,
    input: {
      groupId: "root-thread",
      change: {
        type: "add",
        member: { kind: "thread", threadId: "thread-draft" },
        reason: "manual",
        note: "",
      },
    },
  });
  vi.unstubAllGlobals();
});
