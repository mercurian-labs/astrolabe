import * as NodeURL from "node:url";

import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

const webSource = NodeURL.fileURLToPath(new URL("../web/src", import.meta.url));

export default defineConfig({
  integrations: [react()],
  server: {
    port: Number(process.env.PORT ?? 4321),
  },
  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        "~": webSource,
      },
      dedupe: ["react", "react-dom"],
    },
  },
});
