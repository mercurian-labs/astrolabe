import * as NodeURL from "node:url";

import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

const webSource = NodeURL.fileURLToPath(new URL("../web/src", import.meta.url));
const connectionPlatform = NodeURL.fileURLToPath(
  new URL("../web/src/connection/platform.ts", import.meta.url),
);
const connectionPlatformStub = NodeURL.fileURLToPath(
  new URL("./src/runtime/connectionPlatform.stub.ts", import.meta.url),
);

const quietConnectionPlatform = {
  name: "landing-quiet-connection-platform",
  enforce: "pre",
  async resolveId(source, importer, options) {
    if (importer === connectionPlatformStub) {
      return null;
    }

    const resolved = await this.resolve(source, importer, {
      ...options,
      skipSelf: true,
    });
    return resolved?.id === connectionPlatform ? connectionPlatformStub : null;
  },
};

export default defineConfig({
  integrations: [react()],
  server: {
    port: Number(process.env.PORT ?? 4321),
  },
  vite: {
    plugins: [quietConnectionPlatform, tailwindcss()],
    resolve: {
      alias: {
        "~": webSource,
      },
      dedupe: ["react", "react-dom"],
    },
  },
});
