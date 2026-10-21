/** Better Auth on an in-memory database, for tests and the apps/auth dev server. */
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";

import type { Mail } from "../mail/Mailer.ts";
import { authOptions } from "./options.ts";

export const ORIGIN = "http://localhost:4399";
export const PASSWORD = "a-long-and-unremarkable-passphrase";

export const makeAuth = (
  overrides: {
    removeRelayData?: (userId: string, relayToken: string) => Promise<void>;
    /** The origin the pages and API share; the dev server passes its own. */
    origin?: string;
    onMail?: (mail: Mail) => void;
  } = {},
) => {
  const origin = overrides.origin ?? ORIGIN;
  const mail: Array<Mail> = [];
  const db = Object.fromEntries(
    [
      "user",
      "session",
      "account",
      "verification",
      "twoFactor",
      "passkey",
      "jwks",
      "deviceCode",
      "organization",
      "team",
      "teamMember",
      "member",
      "invitation",
      "rateLimit",
    ].map((model) => [model, [] as Array<unknown>]),
  );
  const options = authOptions(
    {
      baseUrl: origin,
      trustedOrigins: [origin],
      passkeyRpId: "localhost",
      ipAddressHeaders: ["x-forwarded-for"],
      turnstileSecret: undefined,
      relayUrl: "http://localhost:8787",
      google: undefined,
      github: undefined,
      microsoft: undefined,
      apple: undefined,
    },
    {
      sendMail: async (message) => {
        mail.push(message);
        overrides.onMail?.(message);
      },
      removeRelayData: overrides.removeRelayData ?? (async () => {}),
    },
  );
  const auth = betterAuth({
    ...options,
    // Better Auth skips its origin check under test; keep it, as in production.
    advanced: { ...options.advanced, disableOriginCheck: false },
    database: memoryAdapter(db),
    secret: "test-secret-that-is-at-least-32-characters",
    // Each test signs in many times from one address.
    rateLimit: { enabled: false },
  });

  const post = async (path: string, body: unknown, cookie?: string) => {
    const response = await auth.handler(
      new Request(`${origin}/api/auth${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin,
          ...(cookie ? { cookie } : {}),
        },
        body: JSON.stringify(body),
      }),
    );
    const setCookie = response.headers.getSetCookie().map((value) => value.split(";")[0]);
    const text = await response.text();
    return {
      status: response.status,
      json: text ? JSON.parse(text) : null,
      cookie: setCookie.join("; "),
    };
  };
  const get = async (path: string, cookie: string) => {
    const response = await auth.handler(
      new Request(`${origin}/api/auth${path}`, { headers: { cookie, origin } }),
    );
    return { status: response.status, headers: response.headers, json: await response.json() };
  };
  const lastCode = (email: string) => {
    const message = mail.findLast((candidate) => candidate.to === email);
    return message?.subject.split(" ")[0] ?? "";
  };
  return { auth, post, get, lastCode, db };
};

export const signUpVerified = async (app: ReturnType<typeof makeAuth>, email: string) => {
  await app.post("/sign-up/email", { email, password: PASSWORD, name: "Someone" });
  await app.post("/email-otp/verify-email", { email, otp: app.lastCode(email) });
};

/** Signs in with an emailed code, creating the account if needed; returns the session cookie. */
export const signInWithCode = async (app: ReturnType<typeof makeAuth>, email: string) => {
  await app.post("/email-otp/send-verification-otp", { email, type: "sign-in" });
  const signIn = await app.post("/sign-in/email-otp", { email, otp: app.lastCode(email) });
  return signIn.cookie;
};

export const setAccess = (app: ReturnType<typeof makeAuth>, email: string, access: string) => {
  const user = (app.db.user as Array<{ email: string; access: string }>).find(
    (candidate) => candidate.email === email,
  );
  if (user) user.access = access;
};
