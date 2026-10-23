import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite-plus";

const PORT = 5791;

/**
 * `vp dev` runs Better Auth in-process: the cloud API's real options on an
 * in-memory database, so the pages and API share one origin like in
 * production and work without the cloud stack. Emailed codes are printed to
 * the terminal. Set AUTH_DEV_API to proxy to a running stack instead.
 */
function inMemoryAuth(): Plugin {
  return {
    name: "mercurian-in-memory-auth",
    apply: "serve",
    async configureServer(server) {
      const { makeAuth } = await import("@mercurian/cloud/testing");
      const origin = `http://localhost:${PORT}`;
      const { auth } = makeAuth({
        origin,
        onMail: (mail) => server.config.logger.info(`\n  [mail to ${mail.to}] ${mail.subject}\n`),
      });
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith("/api/auth/")) return next();
        handle(req, res).catch(next);
      });
      const handle = async (
        req: import("node:http").IncomingMessage,
        res: import("node:http").ServerResponse,
      ) => {
        const url = req.url ?? "/";
        const chunks: Array<Buffer> = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const headers = new Headers();
        for (const [name, value] of Object.entries(req.headers)) {
          if (typeof value === "string") headers.set(name, value);
        }
        const response = await auth.handler(
          new Request(new URL(url, origin), {
            method: req.method ?? "GET",
            headers,
            ...(chunks.length > 0 ? { body: Buffer.concat(chunks) } : {}),
          }),
        );
        res.statusCode = response.status;
        response.headers.forEach((value, name) => {
          if (name !== "set-cookie") res.setHeader(name, value);
        });
        const cookies = response.headers.getSetCookie();
        if (cookies.length > 0) res.setHeader("set-cookie", cookies);
        res.end(Buffer.from(await response.arrayBuffer()));
      };
    },
  };
}

// The pages ship inside the cloud API as one HTML document (scripts/emit-page.ts),
// so the build inlines every asset and emits a single script and stylesheet.
export default defineConfig({
  plugins: [react(), tailwindcss(), ...(process.env.AUTH_DEV_API ? [] : [inMemoryAuth()])],
  build: {
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    cssCodeSplit: false,
    modulePreload: false,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
  server: {
    port: PORT,
    strictPort: true,
    proxy: process.env.AUTH_DEV_API
      ? { "/api/auth": { target: process.env.AUTH_DEV_API, changeOrigin: true } }
      : {},
  },
});
