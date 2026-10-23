import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { makeAuth, PASSWORD, signUpVerified } from "./testing.ts";

describe("sign-in rule", () => {
  beforeEach(() => {
    // The leaked-password check would call api.pwnedpasswords.com.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(""));
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("asks a password sign-in for an emailed code before issuing a session", async () => {
    const app = makeAuth();
    await signUpVerified(app, "pw@example.com");

    const signIn = await app.post("/sign-in/email", {
      email: "pw@example.com",
      password: PASSWORD,
    });
    expect(signIn.json).toEqual({ twoFactorRedirect: true, twoFactorMethods: ["otp"] });

    await app.post("/two-factor/send-otp", {}, signIn.cookie);
    const verified = await app.post(
      "/two-factor/verify-otp",
      { code: app.lastCode("pw@example.com") },
      signIn.cookie,
    );
    expect(verified.status).toBe(200);
    expect(verified.json.token).toEqual(expect.any(String));
  });

  it("signs in with an emailed code directly, with no second step", async () => {
    const app = makeAuth();
    await app.post("/email-otp/send-verification-otp", {
      email: "code@example.com",
      type: "sign-in",
    });
    const signIn = await app.post("/sign-in/email-otp", {
      email: "code@example.com",
      otp: app.lastCode("code@example.com"),
    });
    expect(signIn.status).toBe(200);
    expect(signIn.json.token).toEqual(expect.any(String));
  });

  it("keeps the second step on when someone tries to switch it off", async () => {
    const app = makeAuth();
    await signUpVerified(app, "off@example.com");
    const session = await app.post("/sign-in/email-otp", {
      email: "off@example.com",
      otp: await app
        .post("/email-otp/send-verification-otp", { email: "off@example.com", type: "sign-in" })
        .then(() => app.lastCode("off@example.com")),
    });

    const disabled = await app.post("/two-factor/disable", { password: PASSWORD }, session.cookie);
    expect(disabled.status).toBe(200);

    const signIn = await app.post("/sign-in/email", {
      email: "off@example.com",
      password: PASSWORD,
    });
    expect(signIn.json.twoFactorRedirect).toBe(true);
  });

  it("starts every new account on the waitlist", async () => {
    const app = makeAuth();
    const signUp = await app.post("/sign-up/email", {
      email: "new@example.com",
      password: PASSWORD,
      name: "New",
      access: "approved",
    });
    expect(signUp.json.user.access).toBe("waitlisted");
  });
});
