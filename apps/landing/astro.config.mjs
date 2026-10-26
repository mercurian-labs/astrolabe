import { defineConfig } from "astro/config";

export default defineConfig({
  // The public origin: canonical URLs and the share cards' absolute addresses are built on it.
  site: "https://astrolabe.sh",
  // The page was written as hand-set HTML; keep its whitespace as written.
  compressHTML: false,
  server: {
    port: Number(process.env.PORT ?? 4174),
  },
});
