import "vite-plus/test/config";
import { defineConfig } from "vite-plus";
import * as NodeURL from "node:url";

const packageDir = NodeURL.fileURLToPath(new URL(".", import.meta.url));

// Vite serves and builds the playground; tests run from the package directory. Knip's Vite
// plugin finds the playground entry through `root/index.html`, so the root lives here
// rather than only on the command line.
export default defineConfig({
  root: NodeURL.fileURLToPath(new URL("./playground", import.meta.url)),
  build: {
    outDir: NodeURL.fileURLToPath(new URL("./dist-playground", import.meta.url)),
    emptyOutDir: true,
  },
  test: {
    root: packageDir,
    environment: "happy-dom",
    include: ["src/**/*.test.{ts,tsx}"],
    // The theme test reads the stylesheet's text; Vitest otherwise stubs CSS out.
    css: { include: [/theme\.css/] },
  },
});
