import { queueAfterTransactionHook } from "@better-auth/core/context";
import { electron } from "@better-auth/electron";
import { expo } from "@better-auth/expo";
import { passkey } from "@better-auth/passkey";
import type { BetterAuthOptions } from "better-auth";
import { bearer } from "better-auth/plugins/bearer";
import { captcha } from "better-auth/plugins";
import { deviceAuthorization } from "better-auth/plugins/device-authorization";
import { emailOTP } from "better-auth/plugins/email-otp";
import { haveIBeenPwned } from "better-auth/plugins/haveibeenpwned";
import { jwt, type JwtOptions } from "better-auth/plugins/jwt";
import { organization } from "better-auth/plugins/organization";
import { twoFactor } from "better-auth/plugins/two-factor";

import type { Mail } from "../mail/Mailer.ts";
import { accessGate, accessPlugin, ORGANIZATION_SEATS, organizationRules } from "./access.ts";
import { beforeDeleteAccount } from "./deletion.ts";
import {
  workspaceAccess,
  workspaceFields,
  workspaceHooks,
  workspaceRoles,
  workspacesPlugin,
} from "./workspaces.ts";
import { codeMail, invitationMail } from "../mail/templates.ts";

export interface OAuthCredentials {
  readonly clientId: string;
  readonly clientSecret: string;
}

export interface AuthConfig {
  /** The app's origin, https://app.astrolabe.sh, shared by the hosted app, the sign-in pages and /api/auth. Unset locally, where it follows the request. */
  readonly baseUrl: string | undefined;
  readonly trustedOrigins: ReadonlyArray<string>;
  /** `astrolabe.sh`, the parent domain, so passkeys survive a host move. They are bound to it: set it before anyone registers one. */
  readonly passkeyRpId: string;
  /** Request headers carrying the client's address, e.g. `cf-connecting-ip` behind Cloudflare. */
  readonly ipAddressHeaders: ReadonlyArray<string>;
  readonly turnstileSecret: string | undefined;
  /** The relay's origin: the `aud` of tokens from `/api/auth/token`, and where deletion unlinks machines. */
  readonly relayUrl: string;
  readonly google: OAuthCredentials | undefined;
  readonly github: OAuthCredentials | undefined;
  readonly microsoft: OAuthCredentials | undefined;
  /** Sign in with Apple: the Services ID and a client secret signed with the team's key. */
  readonly apple: OAuthCredentials | undefined;
}

export interface AuthDeps {
  readonly sendMail: (mail: Mail) => Promise<void>;
  /** Unlinks the user's machines and removes their push registrations, using a relay token for them. */
  readonly removeRelayData: (userId: string, relayToken: string) => Promise<void>;
}

/**
 * Where the native apps receive sign-in results: desktop on `astrolabe://`
 * (dev builds `astrolabe-dev://`), and the mobile variants' schemes from
 * apps/mobile/app.config.ts.
 */
export const APP_ORIGINS = ["astrolabe://", "astrolabe-dev://", "astrolabe-preview://"];

/** Device sign-in clients; self-hosted web adds its host, e.g. `astrolabe-web:192.168.1.20:3773`. */
const DEVICE_CLIENTS = new Set(["astrolabe-cli", "astrolabe-desktop", "astrolabe-mobile"]);

type Hook = (data: never) => Promise<unknown>;

/** Runs each source's hook in turn; a `before` hook that throws stops the rest. */
const composeHooks = <A extends Record<string, Hook>, B extends Record<string, Hook>>(
  a: A,
  b: B,
): A & B => {
  const hooks: Record<string, Hook> = { ...a, ...b };
  for (const key of Object.keys(a)) {
    if (!(key in b)) continue;
    const first = a[key]!;
    const second = b[key as keyof B]!;
    hooks[key] = async (data: never) => {
      await first(data);
      await second(data);
    };
  }
  return hooks as A & B;
};

const defined = <T>(entries: Record<string, T | undefined>): Record<string, T> =>
  Object.fromEntries(Object.entries(entries).filter(([, value]) => value !== undefined)) as Record<
    string,
    T
  >;

/**
 * Astrolabe accounts. Every client signs in on the app.astrolabe.sh pages; web keeps the
 * cookie, native apps and the CLI keep a bearer token, and the relay gets a short-lived JWT
 * from `/api/auth/token`. The caller supplies the database and secret (Alchemy's BetterAuth
 * in the API, an in-memory database in tests).
 */
export const authOptions = (config: AuthConfig, deps: AuthDeps) => {
  const authUrl = config.baseUrl ?? "http://localhost:4310";
  const jwtOptions = {
    jwks: { keyPairConfig: { alg: "EdDSA", crv: "Ed25519" } },
    jwt: {
      issuer: authUrl,
      audience: config.relayUrl,
      expirationTime: "15m",
      // The relay needs only who you are (`sub`).
      definePayload: () => ({}),
    },
    // Relay tokens come only from `/token`, where the waitlist gate runs;
    // otherwise every session response would carry one too.
    disableSettingJwtHeader: true,
  } satisfies JwtOptions;
  return {
    appName: "Astrolabe",
    basePath: "/api/auth",
    ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
    trustedOrigins: [
      ...config.trustedOrigins,
      ...APP_ORIGINS,
      // Apple returns sign-ins with a form POST from its own origin.
      ...(config.apple ? ["https://appleid.apple.com"] : []),
    ],
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      // Password sign-ins ask for a second step (twoFactor below), and an
      // unverified address can't receive it.
      requireEmailVerification: true,
    },
    emailVerification: { autoSignInAfterVerification: true },
    socialProviders: defined({
      google: config.google,
      github: config.github,
      microsoft: config.microsoft && { ...config.microsoft, tenantId: "common" },
      apple: config.apple,
    }),
    account: {
      accountLinking: {
        enabled: true,
        // Linking a provider from settings may use a different address; implicit
        // linking at sign-in still needs both sides to have verified the email.
        allowDifferentEmails: true,
      },
    },
    user: {
      additionalFields: {
        access: {
          type: ["waitlisted", "member", "approved", "declined"],
          required: true,
          defaultValue: "waitlisted",
          input: false,
        },
        // Set while a member waits for approval to own an organization.
        orgRequestedAt: { type: "date", required: false, input: false },
      },
      // Leaving the waitlist deletes the account; so does deleting it later.
      deleteUser: {
        enabled: true,
        beforeDelete: beforeDeleteAccount({ jwtOptions, removeRelayData: deps.removeRelayData }),
      },
    },
    hooks: { before: accessGate },
    // Every password sign-in asks for a second step: an emailed code, or an authenticator code
    // if one is set up. Better Auth only challenges password sign-ins, so enabling it for everyone
    // leaves email-code, passkey and provider sign-ins direct. Removing an authenticator falls
    // back to emailed codes rather than switching the step off.
    databaseHooks: {
      user: {
        create: {
          before: async (user) => ({ data: { ...user, twoFactorEnabled: true } }),
        },
        update: {
          before: async (user) =>
            user.twoFactorEnabled === false
              ? { data: { ...user, twoFactorEnabled: true } }
              : undefined,
        },
      },
    },
    rateLimit: { enabled: true, storage: "database" },
    advanced: {
      ipAddress: { ipAddressHeaders: [...config.ipAddressHeaders] },
    },
    plugins: [
      bearer(),
      accessPlugin(),
      workspacesPlugin(),
      // Desktop signs in through the system browser and returns on astrolabe://.
      electron(),
      // Mobile signs in through the in-app browser sheet.
      expo(),
      emailOTP({
        storeOTP: "hashed",
        overrideDefaultEmailVerification: true,
        sendVerificationOTP: ({ email, otp, type }) => deps.sendMail(codeMail(email, otp, type)),
      }),
      twoFactor({
        issuer: "Astrolabe",
        otpOptions: {
          storeOTP: "hashed",
          sendOTP: ({ user, otp }) => deps.sendMail(codeMail(user.email, otp, "two-factor")),
        },
      }),
      passkey({ rpID: config.passkeyRpId, rpName: "Astrolabe", origin: authUrl }),
      haveIBeenPwned(),
      jwt(jwtOptions),
      deviceAuthorization({
        verificationUri: `${authUrl}/device`,
        // Only our clients can start a device sign-in; the approval page names
        // the requester from this id, so a forwarded code looks wrong.
        validateClient: (clientId) =>
          DEVICE_CLIENTS.has(clientId) || /^astrolabe-web:[^\s/]+$/u.test(clientId),
      }),
      organization({
        allowUserToCreateOrganization: organizationRules.allowUserToCreateOrganization,
        organizationHooks: composeHooks(organizationRules.organizationHooks, workspaceHooks),
        ac: workspaceAccess,
        roles: workspaceRoles,
        schema: { organization: { additionalFields: workspaceFields } },
        teams: { enabled: true },
        membershipLimit: ORGANIZATION_SEATS,
        // Sent once the invitation commits, so a write that rolls back sends nothing.
        sendInvitationEmail: ({ email, id, organization, inviter }) =>
          queueAfterTransactionHook(() =>
            deps.sendMail(
              invitationMail({
                to: email,
                inviterName: inviter.user.name || inviter.user.email,
                organizationName: organization.name,
                url: `${authUrl}/invite/${id}`,
              }),
            ),
          ),
      }),
      ...(config.turnstileSecret
        ? [
            captcha({
              provider: "cloudflare-turnstile",
              secretKey: config.turnstileSecret,
              endpoints: [
                "/sign-up/email",
                "/sign-in/email",
                "/email-otp/send-verification-otp",
                "/email-otp/request-password-reset",
              ],
            }),
          ]
        : []),
    ],
  } satisfies BetterAuthOptions;
};
