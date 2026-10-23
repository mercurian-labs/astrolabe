import type { ChangeGroupDecisions } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { applyChangeGroupChange } from "./ChangeGroupService.ts";

const empty: ChangeGroupDecisions = {
  groupId: "thread-1",
  title: null,
  armed: null,
  added: [],
  removed: [],
  dismissed: [],
  pending: [],
  updatedAt: "2026-10-19T00:00:00Z",
};
const pr = { kind: "pull-request" as const, host: "github.com", repository: "acme/app", number: 7 };
const at = "2026-10-19T01:00:00Z";

describe("a change group's decisions", () => {
  it("add a member, which undoes taking it out or dismissing it", () => {
    const removed = applyChangeGroupChange(
      empty,
      { type: "remove", memberKey: "pr:github.com/acme/app#7" },
      at,
    );
    expect(removed.removed).toEqual(["pr:github.com/acme/app#7"]);
    const added = applyChangeGroupChange(
      { ...removed, dismissed: ["pr:github.com/acme/app#7"] },
      { type: "add", member: pr, reason: "suggested", note: "Same importer" },
      at,
    );
    expect(added.added).toEqual([{ member: pr, reason: "suggested", note: "Same importer" }]);
    expect(added.removed).toEqual([]);
    expect(added.dismissed).toEqual([]);
    expect(added.updatedAt).toBe(at);
  });

  it("take out an added member", () => {
    const added = applyChangeGroupChange(
      empty,
      { type: "add", member: pr, reason: "manual", note: "" },
      at,
    );
    const removed = applyChangeGroupChange(
      added,
      { type: "remove", memberKey: "pr:github.com/acme/app#7" },
      at,
    );
    expect(removed.added).toEqual([]);
    expect(removed.removed).toEqual(["pr:github.com/acme/app#7"]);
  });

  it("keep an agent's suggestion until someone accepts or dismisses it", () => {
    const suggested = applyChangeGroupChange(
      empty,
      { type: "suggest", member: pr, note: "Same importer" },
      at,
    );
    expect(suggested.pending).toEqual([{ member: pr, note: "Same importer" }]);
    const dismissed = applyChangeGroupChange(
      suggested,
      { type: "dismiss", memberKey: "pr:github.com/acme/app#7" },
      at,
    );
    expect(dismissed.pending).toEqual([]);
    expect(
      applyChangeGroupChange(dismissed, { type: "suggest", member: pr, note: "Again" }, at),
    ).toBe(dismissed);
  });

  it("arm and name the group", () => {
    const armed = applyChangeGroupChange(empty, { type: "arm", armed: false }, at);
    expect(armed.armed).toBe(false);
    expect(applyChangeGroupChange(armed, { type: "title", title: "Search" }, at).title).toBe(
      "Search",
    );
  });
});
