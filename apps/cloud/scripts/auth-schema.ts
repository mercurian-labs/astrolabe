/**
 * Entry for `vp run auth:schema`: Better Auth's CLI reads the plugin list from
 * this instance and writes the Drizzle schema to src/auth/schema.ts. Nothing
 * connects; the database handle is never used.
 */
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { drizzle } from "drizzle-orm/node-postgres";

import { authOptions } from "../src/auth/options.ts";

export const auth = betterAuth({
  ...authOptions(
    {
      baseUrl: undefined,
      trustedOrigins: [],
      passkeyRpId: "localhost",
      ipAddressHeaders: [],
      turnstileSecret: "schema-generation-only",
      relayUrl: "http://localhost:8787",
      google: undefined,
      github: undefined,
      microsoft: undefined,
      apple: undefined,
    },
    {
      sendMail: async () => {},
      removeRelayData: async () => {},
    },
  ),
  database: drizzleAdapter(drizzle.mock(), { provider: "pg", schemaName: "auth" }),
  secret: "schema-generation-only",
});
