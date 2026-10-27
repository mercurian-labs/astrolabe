// @effect-diagnostics nodeBuiltinImport:off globalConsole:off preferSchemaOverJson:off - A dev-server plugin: it owns a scratch folder of note files on disk.
/**
 * The playground's workspace: note files the dev server owns in `.workspace/`, seeded from the
 * vault, which is only ever read. Any write there reaches every open playground as a change event.
 *   GET  /__workspace/events  a stream of { note, previous, text }, or { note, text, reset: true }
 *   POST /__workspace/show    { start, to }: write the thread's events up to `to` as an agent would
 */
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import type * as NodeHttp from "node:http";
import type { Plugin } from "vite-plus";

import { ATLAS_THREAD } from "../fixtures/thread.ts";
import { ATLAS_THREAD_PROSE, filesAt, ThreadFiles, writtenNotes } from "../fixtures/threadFiles.ts";

export type WorkspaceEvent =
  | { readonly note: string; readonly previous: string; readonly text: string }
  | { readonly note: string; readonly text: string; readonly reset: true };

/** Editors write in bursts (truncate, then write); a change settles this long before it is read. */
const SETTLE_MS = 30;

function readVault(vault: string | null): Map<string, string> {
  const notes = new Map<string, string>();
  if (vault === null || !NodeFS.existsSync(vault)) return notes;
  for (const entry of NodeFS.readdirSync(vault, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".md") || entry.name.includes(".skillmap.")) {
      continue;
    }
    notes.set(
      entry.name.slice(0, -3),
      NodeFS.readFileSync(NodePath.join(vault, entry.name), "utf8"),
    );
  }
  return notes;
}

export function workspaceFiles(options: { dir: string; vault?: string }): Plugin {
  return {
    name: "atlas-workspace-files",
    apply: "serve",
    configureServer(server) {
      const { dir } = options;
      const vault =
        options.vault ??
        process.env.ATLAS_VAULT ??
        NodePath.join(NodeOS.homedir(), "dev", "mercurian", "almagest");
      const seeds = readVault(vault);
      if (seeds.size === 0) console.warn(`[workspace] no notes at ${vault}; set ATLAS_VAULT`);

      // Start from the vault every time the server starts.
      NodeFS.rmSync(dir, { recursive: true, force: true });
      NodeFS.mkdirSync(dir, { recursive: true });
      for (const [note, text] of seeds) NodeFS.writeFileSync(fileOf(note), text);
      /** Each file's text as the playgrounds last heard it. */
      const known = new Map(seeds);
      let files = new ThreadFiles(ATLAS_THREAD, seeds, ATLAS_THREAD_PROSE);
      const clients = new Set<NodeHttp.ServerResponse>();

      function fileOf(note: string) {
        return NodePath.join(dir, `${note}.md`);
      }
      function broadcast(event: WorkspaceEvent) {
        const frame = `data: ${JSON.stringify(event)}\n\n`;
        for (const client of clients) client.write(frame);
      }

      const pending = new Map<string, ReturnType<typeof setTimeout>>();
      const check = (note: string) => {
        pending.delete(note);
        let text: string;
        try {
          text = NodeFS.readFileSync(fileOf(note), "utf8");
        } catch {
          return;
        }
        const previous = known.get(note) ?? "";
        if (text === previous) return;
        known.set(note, text);
        broadcast({ note, previous, text });
      };
      const watcher = NodeFS.watch(dir, (_event, name) => {
        if (name === null || !name.endsWith(".md")) return;
        const note = name.slice(0, -3);
        clearTimeout(pending.get(note));
        pending.set(
          note,
          setTimeout(() => check(note), SETTLE_MS),
        );
      });

      /** Sets a file without it counting as an edit: the watcher finds nothing new. */
      const setQuietly = (note: string, text: string | undefined) => {
        if (text === known.get(note)) return;
        if (text === undefined) {
          known.delete(note);
          NodeFS.rmSync(fileOf(note), { force: true });
        } else {
          known.set(note, text);
          NodeFS.writeFileSync(fileOf(note), text);
        }
        broadcast({ note, text: text ?? "", reset: true });
      };

      const show = (start: number, to: number) => {
        if (files.position < start || files.position > to) {
          files = filesAt(ATLAS_THREAD, seeds, start, ATLAS_THREAD_PROSE);
          for (const note of writtenNotes(ATLAS_THREAD)) setQuietly(note, files.texts.get(note));
        }
        while (files.position < to) {
          const before = files.position;
          const note = files.step();
          if (files.position === before) break;
          const text = note === null ? undefined : files.texts.get(note);
          if (note !== null && text !== undefined) NodeFS.writeFileSync(fileOf(note), text);
        }
      };

      server.middlewares.use("/__workspace/events", (_req, res) => {
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        res.write(": connected\n\n");
        clients.add(res);
        res.on("close", () => clients.delete(res));
      });

      server.middlewares.use("/__workspace/show", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end();
          return;
        }
        let body = "";
        req.on("data", (chunk: Buffer) => {
          body += chunk.toString("utf8");
        });
        req.on("end", () => {
          try {
            const { start, to } = JSON.parse(body) as { start?: unknown; to?: unknown };
            if (!Number.isInteger(start) || !Number.isInteger(to)) throw new Error("start and to");
            show(start as number, to as number);
            res.statusCode = 204;
            res.end();
          } catch (error) {
            res.statusCode = 400;
            res.end(String(error));
          }
        });
      });

      server.httpServer?.on("close", () => {
        watcher.close();
        for (const timer of pending.values()) clearTimeout(timer);
        for (const client of clients) client.end();
      });
      console.info(`[workspace] ${seeds.size} notes in ${dir}; edit them and watch the graph`);
    },
  };
}
