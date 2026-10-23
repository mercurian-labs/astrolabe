import "vite-plus/test/config";
import { defineConfig } from "vite-plus";
import * as NodeURL from "node:url";

export default defineConfig({
  test: {
    root: NodeURL.fileURLToPath(new URL(".", import.meta.url)),
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
