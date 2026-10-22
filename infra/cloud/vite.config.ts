import { defineConfig } from "vite-plus";

// The migrator becomes one self-contained file, so its image is plain Node
// plus the bundle and the migration folders (see Dockerfile).
export default defineConfig({
  pack: {
    entry: ["src/migrate.ts"],
    // Alchemy bundles the hosted API into dist/ itself; keep clear of it.
    outDir: "dist/migrate",
    format: "esm",
    platform: "node",
    clean: true,
    deps: {
      alwaysBundle: () => true,
      onlyBundle: false,
    },
  },
  // test/stack.integ.test.ts drives a deployed stack: two sign-ins and Electric's replication
  // and long-polls take longer than Vitest's default. Its deploy hook sets its own timeout.
  test: { testTimeout: 120_000 },
});
