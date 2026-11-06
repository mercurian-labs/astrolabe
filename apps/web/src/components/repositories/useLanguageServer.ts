import { RegistryContext, useAtomMount, useAtomValue } from "@effect/atom-react";
import type { DocumentSession } from "@t3tools/client-runtime/state/document-session";
import { selectEnvironmentQueryData } from "@t3tools/client-runtime/state/runtime";
import {
  type EnvironmentId,
  type LanguageServerId,
  type LanguageServerRoute,
  languageServerRoutesForPath,
  languageServersForPath,
  languageServerToolchain,
  type LanguageServerStatus,
  primaryLanguageServerRoute,
} from "@t3tools/contracts";
import type { Extension } from "@codemirror/state";
import { environmentLsp, type EnvironmentLsp } from "@mercurian/editor/lsp";
import { Atom, type AtomRegistry } from "effect/reactivity";
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

interface LanguageServerHosts {
  readonly openSettings: ((server: LanguageServerId) => void) | null;
  readonly openLogs: (server: LanguageServerId) => void;
}

/** Matches the environment's table on what binds a session, so its arrival rebinds nothing. */
function usualRoutes(path: string): ReadonlyArray<LanguageServerRoute> {
  return languageServersForPath(path).map((route) => ({
    ...route,
    name: route.server,
    off: false,
    toolchain: languageServerToolchain(route.server),
  }));
}

function makeBinding(
  registry: AtomRegistry.AtomRegistry,
  options: {
    readonly environmentId: EnvironmentId;
    readonly cwd: string;
    readonly path: string;
    readonly session: DocumentSession;
    readonly primary: LanguageServerRoute;
    readonly toolchain: LanguageServerFile["toolchain"];
    readonly hosts: LanguageServerHosts;
  },
): Binding {
  const { environmentId, cwd, path, session, primary, toolchain, hosts } = options;
  let sessionId = "";
  let status: LanguageServerStatus | null = null;
  const listeners = new Set<() => void>();
  const send = languageServersEnvironment.sender(registry, environmentId);
  const lsp = environmentLsp({
    uri: fileUri(`${cwd}/${path}`),
    languageId: primary.languageId,
    rootUri: fileUri(cwd),
    document: session,
    channel: {
      send: (message, document) =>
        send({ sessionId, message, ...(document === undefined ? {} : { document }) }),
    },
  });
  const follow = languageServersEnvironment.session(
    environmentId,
    { cwd, server: primary.server },
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
  const { openSettings } = hosts;
  const file: LanguageServerFile = {
    environmentId,
    cwd,
    server: primary.server,
    toolchain,
    status: () => status,
    openLogs: (server = primary.server) => hosts.openLogs(server),
    openSettings: openSettings && (() => openSettings(primary.server)),
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
}

/**
 * One binding per key, however many times a render asks: each opens a client. A session stays
 * bound to the server it opened on, so settings moving the file means a new binding.
 */
const makeBinder = () => {
  let current: { readonly key: string | null; readonly binding: Binding | null } | null = null;
  return (key: string | null, bind: () => Binding | null) => {
    if (current?.key !== key) current = { key, binding: bind() };
    return current.binding;
  };
};

/**
 * Astrolabe: an editor's language server, through the environment's gateway, while the caller is
 * mounted and `enabled`. Null for files no server reads, or without the live document. The
 * environment says which servers read a file; `hosts` are taken as they are at each binding.
 */
export function useLanguageServer(
  environmentId: EnvironmentId,
  cwd: string,
  path: string,
  session: DocumentSession | null,
  enabled: boolean,
  hosts: LanguageServerHosts,
) {
  const registry = useContext(RegistryContext);
  const routes = selectEnvironmentQueryData(
    useAtomValue(languageServersEnvironment.routes(environmentId, cwd)),
  );
  // An environment that hasn't said, or an older one that can't, runs the usual servers.
  const servers = routes ? languageServerRoutesForPath(path, routes) : usualRoutes(path);
  const primary = primaryLanguageServerRoute(servers);
  const toolchain = servers.find((route) => !route.off && route.toolchain)?.toolchain ?? null;
  const key =
    session === null || primary === null
      ? null
      : `${primary.server}\0${primary.languageId}\0${toolchain}`;
  const bind = () =>
    session === null || primary === null
      ? null
      : makeBinding(registry, { environmentId, cwd, path, session, primary, toolchain, hosts });
  const [bindingFor] = useState(makeBinder);
  const binding = bindingFor(key, bind);
  useAtomMount((enabled ? binding?.follow : null) ?? NO_SESSION);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- ends the editor's LSP client with the view that holds it
  useEffect(() => () => binding?.lsp.destroy(), [binding]);
  const status = useSyncExternalStore(
    binding?.status.subscribe ?? noSubscribe,
    binding?.status.get ?? noStatus,
  );
  return {
    extension: binding?.extension ?? null,
    file: binding?.file ?? null,
    status,
    servers,
  };
}

// Mounted in place of a session for files with no language server.
const NO_SESSION = Atom.make(null);
const noSubscribe = () => () => {};
const noStatus = () => null;
