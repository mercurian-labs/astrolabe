import { defineConfig } from "vite-plus";

// Each entry becomes one self-contained file, so the container image is plain
// Node plus the bundle and the migration folders (see Dockerfile).
export default defineConfig({
  pack: {
    entry: ["src/server.ts", "src/migrate.ts"],
    outDir: "dist",
    format: "esm",
    platform: "node",
    clean: true,
    deps: {
      alwaysBundle: () => true,
      onlyBundle: false,
    },
  },
});
