import { RegistryContext, useAtomMount } from "@effect/atom-react";
import type { DocumentSession } from "@t3tools/client-runtime/state/document-session";
import {
  type EnvironmentId,
  languageServerForPath,
  type LanguageServerStatus,
} from "@t3tools/contracts";
import type { Extension } from "@codemirror/state";
import { environmentLsp, type EnvironmentLsp } from "@mercurian/editor/lsp";
import { Atom } from "effect/reactivity";
import { useContext, useEffect, useState, useSyncExternalStore } from "react";

import { languageServersEnvironment } from "~/state/languageServers";
import { languageServerFile, type LanguageServerFile } from "./languageServerFile";

/** A `file:` URI the environment's Node reads back to the same path. */
function fileUri(path: string): string {
  const slashed = path.replaceAll("\\", "/");
  return `file://${slashed.startsWith("/") ? "" : "/"}${slashed
    .split("/")
    .map((part) => encodeURIComponent(part).replaceAll("%3A", ":"))
    .join("/")}`;
}

const newSessionId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

interface Binding {
  readonly lsp: EnvironmentLsp;
  readonly file: LanguageServerFile;
  readonly extension: Extension;
  readonly status: {
    get: () => LanguageServerStatus | null;
    subscribe: (listener: () => void) => () => void;
  };
  readonly follow: ReturnType<typeof languageServersEnvironment.session>;
}

/**
 * Astrolabe: an editor's language server, through the environment's gateway, while the caller is
 * mounted and `enabled`. Null for files no server reads, or without the live document.
 * The caller is keyed by file: the session is made once, with `hosts` as they were then.
 */
export function useLanguageServer(
  environmentId: EnvironmentId,
  cwd: string,
  path: string,
  session: DocumentSession | null,
  enabled: boolean,
  hosts: Pick<LanguageServerFile, "openLogs" | "openSettings">,
) {
  const registry = useContext(RegistryContext);
  const [binding] = useState((): Binding | null => {
    const match = languageServerForPath(path);
    if (match === null || session === null) return null;
    let sessionId = "";
    let status: LanguageServerStatus | null = null;
    const listeners = new Set<() => void>();
    const send = languageServersEnvironment.sender(registry, environmentId);
    const lsp = environmentLsp({
      uri: fileUri(`${cwd}/${path}`),
      languageId: match.languageId,
      rootUri: fileUri(cwd),
      document: session,
      channel: {
        send: (message, document) =>
          send({ sessionId, message, ...(document === undefined ? {} : { document }) }),
      },
    });
    const follow = languageServersEnvironment.session(
      environmentId,
      { cwd, server: match.server },
      {
        openSession: () => {
          // A new session knows nothing of this editor: initialize and open the file again.
          lsp.reset();
          sessionId = newSessionId();
          return sessionId;
        },
        onItem: (item) => {
          if (item.type === "message") return lsp.receive(item.message, item.version);
          status = item.status;
          if (status.state === "ready") lsp.connect();
          for (const listener of listeners) listener();
        },
      },
    );
    const file: LanguageServerFile = {
      environmentId,
      cwd,
      server: match.server,
      status: () => status,
      ...hosts,
    };
    return {
      lsp,
      file,
      extension: [lsp.extension, languageServerFile.of(file)],
      follow,
      status: {
        get: () => status,
        subscribe: (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
    };
  });
  useAtomMount((enabled ? binding?.follow : null) ?? NO_SESSION);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- ends the editor's LSP client with the view that holds it
  useEffect(() => () => binding?.lsp.destroy(), [binding]);
  const status = useSyncExternalStore(
    binding?.status.subscribe ?? noSubscribe,
    binding?.status.get ?? noStatus,
  );
  return { extension: binding?.extension ?? null, file: binding?.file ?? null, status };
}

// Mounted in place of a session for files with no language server.
const NO_SESSION = Atom.make(null);
const noSubscribe = () => () => {};
const noStatus = () => null;
