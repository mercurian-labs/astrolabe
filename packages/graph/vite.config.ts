import "vite-plus/test/config";
import { defineConfig } from "vite-plus";
import * as NodeURL from "node:url";

import { codeFiles } from "./playground/codeFiles.ts";
import { workspaceFiles } from "./playground/workspaceFiles.ts";

const packageDir = NodeURL.fileURLToPath(new URL(".", import.meta.url));

// Vite serves and builds the playground; tests run from the package directory. Knip's Vite
// plugin finds the playground entry through `root/index.html`, so the root lives here
// rather than only on the command line.
export default defineConfig({
  root: NodeURL.fileURLToPath(new URL("./playground", import.meta.url)),
  // The note files the playground's thread writes, and anyone else may: see the plugin.
  plugins: [
    workspaceFiles({ dir: NodeURL.fileURLToPath(new URL("./.workspace", import.meta.url)) }),
    // The code stories' files at each commit, from the repositories their fixtures name.
    codeFiles({
      fixturesDir: NodeURL.fileURLToPath(new URL("../code-graph/fixtures", import.meta.url)),
    }),
  ],
  build: {
    outDir: NodeURL.fileURLToPath(new URL("./dist-playground", import.meta.url)),
    emptyOutDir: true,
    // The playground and the bench page.
    rolldownOptions: {
      input: {
        main: NodeURL.fileURLToPath(new URL("./playground/index.html", import.meta.url)),
        bench: NodeURL.fileURLToPath(new URL("./playground/bench.html", import.meta.url)),
      },
    },
  },
  test: {
    root: packageDir,
    environment: "happy-dom",
    include: [
      "src/**/*.test.{ts,tsx}",
      "fixtures/**/*.test.ts",
      "bench/**/*.test.ts",
      "playground/**/*.test.{ts,tsx}",
    ],
  },
});
