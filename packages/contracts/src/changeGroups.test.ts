import { describe, expect, it } from "vite-plus/test";

import {
  changeGroupMemberKey,
  changeGroupMemberRefOfKey,
  type ChangeGroupMemberRef,
} from "./changeGroups.ts";

describe("change group member keys", () => {
  it("name pull requests and threads, and read back what they name", () => {
    const refs: ReadonlyArray<ChangeGroupMemberRef> = [
      { kind: "pull-request", host: "github.com", repository: "acme/app", number: 12 },
      { kind: "thread", threadId: "1b2c3d" },
    ];
    expect(refs.map(changeGroupMemberKey)).toEqual(["pr:github.com/acme/app#12", "thread:1b2c3d"]);
    expect(refs.map((ref) => changeGroupMemberRefOfKey(changeGroupMemberKey(ref)))).toEqual(refs);
    expect(changeGroupMemberRefOfKey("issue:M-12")).toBeNull();
    // A wiki change request was a member before wikis became project roots; it names none now.
    expect(changeGroupMemberRefOfKey("wiki:w1/cr1")).toBeNull();
  });
});
