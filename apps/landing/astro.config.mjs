import { defineConfig } from "astro/config";

export default defineConfig({
  // The page was written as hand-set HTML; keep its whitespace as written.
  compressHTML: false,
  server: {
    port: Number(process.env.PORT ?? 4174),
  },
});
