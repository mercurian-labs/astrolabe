import { defineConfig } from "drizzle-kit";

// Generates SQL only. infra/cloud's migration task applies migrations/auth
// before the relay's folder (see infra/cloud/src/migrate.ts).
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/auth/schema.ts",
  out: "./migrations/auth",
  schemaFilter: ["auth"],
});
