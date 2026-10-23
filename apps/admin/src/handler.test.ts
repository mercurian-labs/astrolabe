// @effect-diagnostics globalDate:off - Fixture dates for rendering.
import type { Decision, Waitlist } from "@mercurian/cloud/waitlist";
import { describe, expect, it } from "vite-plus/test";

import { makeAdminHandler } from "./handler.ts";

const ORIGIN = "https://admin.example.ts.net";

function setup(options: { allowAnonymous?: boolean; failMailTo?: string } = {}) {
  const decided: Array<{ decision: Decision; emails: ReadonlyArray<string> }> = [];
  const mailed: Array<string> = [];
  const waitlist: Waitlist = {
    pending: async (search) =>
      [
        {
          email: "ada@example.test",
          name: "Ada <Lovelace>",
          joinedAt: new Date("2026-10-14T09:30:00Z"),
          methods: ["credential", "google"],
          wantsOrganization: false,
        },
      ].filter((entry) => !search || entry.email.includes(search)),
    recent: async () => [],
    decide: async (decision, emails) => {
      decided.push({ decision, emails });
      return [...emails];
    },
  };
  const handler = makeAdminHandler({
    waitlist,
    sendApproval: async (email) => {
      if (email === options.failMailTo) throw new Error("SES down");
      mailed.push(email);
    },
    allowAnonymous: options.allowAnonymous ?? false,
    log: () => {},
  });
  return { handler, decided, mailed };
}

const asOperator = { "tailscale-user-login": "venk@example.test" };

const post = (body: Record<string, string | ReadonlyArray<string>>, headers = {}) => {
  const form = new URLSearchParams();
  for (const [name, value] of Object.entries(body)) {
    for (const item of typeof value === "string" ? [value] : value) form.append(name, item);
  }
  return new Request(`${ORIGIN}/decide`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    body: form,
  });
};

describe("admin handler", () => {
  it("only answers requests that came through the tailnet", async () => {
    const { handler } = setup();
    const response = await handler(new Request(`${ORIGIN}/`));
    expect(response.status).toBe(403);
  });

  it("lists the waitlist for an operator, escaping what people typed", async () => {
    const { handler } = setup();
    const response = await handler(new Request(`${ORIGIN}/`, { headers: asOperator }));
    const page = await response.text();

    expect(response.status).toBe(200);
    expect(page).toContain("ada@example.test");
    expect(page).toContain("Ada &lt;Lovelace&gt;");
    expect(page).toContain("password, Google");
    expect(page).toContain("Signed in as venk@example.test");
    expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
  });

  it("approves one person, emails them, and reports it", async () => {
    const { handler, decided, mailed } = setup();
    const response = await handler(
      post({ one: "approve ada@example.test" }, { ...asOperator, origin: ORIGIN }),
    );

    expect(decided).toEqual([{ decision: "approve", emails: ["ada@example.test"] }]);
    expect(mailed).toEqual(["ada@example.test"]);
    expect(response.status).toBe(303);
    expect(new URL(response.headers.get("location")!).searchParams.get("done")).toBe(
      "Approved 1 account.",
    );
  });

  it("declines a selection without sending email", async () => {
    const { handler, decided, mailed } = setup();
    await handler(
      post(
        { action: "decline", email: ["a@example.test", "b@example.test"] },
        { ...asOperator, origin: ORIGIN },
      ),
    );

    expect(decided).toEqual([
      { decision: "decline", emails: ["a@example.test", "b@example.test"] },
    ]);
    expect(mailed).toEqual([]);
  });

  it("says when an approval email failed", async () => {
    const { handler } = setup({ failMailTo: "ada@example.test" });
    const response = await handler(
      post({ one: "approve ada@example.test" }, { ...asOperator, origin: ORIGIN }),
    );

    expect(new URL(response.headers.get("location")!).searchParams.get("done")).toBe(
      "Approved 1 account. 1 approval email failed to send.",
    );
  });

  it("refuses a decision posted from another site", async () => {
    const { handler, decided } = setup();
    const response = await handler(
      post({ one: "approve ada@example.test" }, { ...asOperator, origin: "https://evil.test" }),
    );

    expect(response.status).toBe(403);
    expect(decided).toEqual([]);
  });

  it("refuses an unknown action", async () => {
    const { handler, decided } = setup();
    const response = await handler(
      post({ one: "delete ada@example.test" }, { ...asOperator, origin: ORIGIN }),
    );

    expect(response.status).toBe(400);
    expect(decided).toEqual([]);
  });
});
