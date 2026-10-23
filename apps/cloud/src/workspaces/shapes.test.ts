import { describe, expect, it } from "vite-plus/test";

import { defineShape, electricShapeUrl } from "./shapes.ts";

const reader = { userId: "u1", verifiedEmail: "Someone@Example.com" };

describe("workspace shapes", () => {
  it("sends Electric the cloud's table, columns and filter, never the client's", () => {
    const client = new URLSearchParams({
      shape: "people",
      offset: "-1",
      live: "true",
      table: "auth.session",
      where: "true",
      columns: "id,token",
    });
    const url = new URL(
      electricShapeUrl("http://electric:3000", client, defineShape("people", reader)),
    );
    expect(url.searchParams.get("table")).toBe("auth.user");
    expect(url.searchParams.get("columns")).toBe("id,name,email,image");
    expect(url.searchParams.get("where")).toContain("auth.member");
    expect(url.searchParams.get("offset")).toBe("-1");
    expect(url.searchParams.get("live")).toBe("true");
    expect(url.searchParams.get("params[1]")).toBe("u1");
    expect(url.searchParams.get("params[2]")).toBe("someone@example.com");
    expect(url.searchParams.has("shape")).toBe(false);
  });

  it("shows invitations addressed to you only once your address is verified", () => {
    const verified = defineShape("invitations", reader);
    expect(verified.where).toContain("email = $2");
    expect(verified.params).toEqual(["u1", "someone@example.com"]);

    const unverified = defineShape("invitations", { userId: "u1", verifiedEmail: null });
    expect(unverified.where).not.toContain("$2");
    expect(unverified.params).toEqual(["u1"]);
  });

  it("never syncs people's access, verification or two-factor state", () => {
    expect(defineShape("people", reader).columns).toEqual(["id", "name", "email", "image"]);
  });
});
