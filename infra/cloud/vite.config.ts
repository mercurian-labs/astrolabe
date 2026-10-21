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
});
