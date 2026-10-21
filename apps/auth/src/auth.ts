import { passkeyClient } from "@better-auth/passkey/client";
import {
  deviceAuthorizationClient,
  emailOTPClient,
  inferAdditionalFields,
  organizationClient,
  twoFactorClient,
} from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

import { captchaHeaders } from "./turnstile";

/** The pages share the API's origin, so the session is a first-party cookie. */
export const authClient = createAuthClient({
  basePath: "/api/auth",
  fetchOptions: {
    // Turnstile guards the sign-up, sign-in, code and reset endpoints.
    onRequest: (context) => {
      for (const [name, value] of Object.entries(captchaHeaders())) {
        context.headers.set(name, value);
      }
      return context;
    },
  },
  plugins: [
    inferAdditionalFields({
      user: { access: { type: "string", required: false, input: false } },
    }),
    emailOTPClient(),
    twoFactorClient(),
    passkeyClient(),
    deviceAuthorizationClient(),
    organizationClient(),
  ],
});

export type Access = "waitlisted" | "member" | "approved" | "declined";

export const isOnWaitlist = (access: unknown) => access === "waitlisted" || access === "declined";

/** A readable message from a Better Auth error, falling back to `fallback`. */
export function errorMessage(
  error: { message?: string | undefined; error_description?: string | undefined } | null,
  fallback: string,
) {
  return error?.message?.trim() || error?.error_description?.trim() || fallback;
}
