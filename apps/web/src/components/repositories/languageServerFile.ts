import { Facet, type EditorState } from "@codemirror/state";
import { derivePhysicalProjectKey } from "@t3tools/client-runtime/state/project-grouping";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  LanguageServerId,
  LanguageServerStatus,
  LanguageServerToolchainKind,
  ProjectId,
} from "@t3tools/contracts";

import { getClientSettings } from "~/hooks/useSettings";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { buildPhysicalToLogicalProjectKeyMap } from "~/sidebarProjectGrouping";
import { languageServersEnvironment } from "~/state/languageServers";
import { environmentProjects } from "~/state/projects";

/**
 * Astrolabe: a code file's language server, for what acts on it from outside the editor: the
 * header's menu, and the commands of the keyboard menu and Command Palette.
 */
export interface LanguageServerFile {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  /** The file's primary server: what the commands act on, and the session's own. */
  readonly server: LanguageServerId;
  /** The toolchain a server on this file reads, which people can choose. */
  readonly toolchain: LanguageServerToolchainKind | null;
  readonly status: () => LanguageServerStatus | null;
  /** A server's logs, the primary's unless told. */
  readonly openLogs: (server?: LanguageServerId) => void;
  /** Settings → Projects at the file's project; null for a file no project owns (a wiki's). */
  readonly openSettings: (() => void) | null;
}

export const languageServerFile = Facet.define<LanguageServerFile, LanguageServerFile | null>({
  combine: (files) => files[0] ?? null,
});

export function hasLanguageServerFile(state: EditorState): boolean {
  return state.facet(languageServerFile) !== null;
}

// The focused pane's file when focus has not gone into its editor: opening one leaves it behind.
const filesByTab = new Map<string, LanguageServerFile>();

export function registerLanguageServerFile(tabKey: string, file: LanguageServerFile) {
  filesByTab.set(tabKey, file);
  return () => {
    if (filesByTab.get(tabKey) === file) filesByTab.delete(tabKey);
  };
}

export const languageServerFileOfTab = (tabKey: string) => filesByTab.get(tabKey) ?? null;

export const canMaintainLanguageServers = (environmentId: EnvironmentId) =>
  appAtomRegistry.get(languageServersEnvironment.restart.permissionAtom(environmentId));

const REPORT = { reportFailure: true, reportDefect: true };

export const restartLanguageServer = (
  file: LanguageServerFile,
  server: LanguageServerId = file.server,
) =>
  void runAtomCommand(
    appAtomRegistry,
    languageServersEnvironment.restart,
    { environmentId: file.environmentId, input: { cwd: file.cwd, server } },
    { ...REPORT, label: "restart language server" },
  );

export const stopLanguageServer = (
  file: LanguageServerFile,
  server: LanguageServerId = file.server,
) =>
  void runAtomCommand(
    appAtomRegistry,
    languageServersEnvironment.stop,
    { environmentId: file.environmentId, input: { cwd: file.cwd, server } },
    { ...REPORT, label: "stop language server" },
  );

/** Turns a server on for this project, however it came to be off. */
export const turnOnLanguageServer = (file: LanguageServerFile, server: LanguageServerId) =>
  void runAtomCommand(
    appAtomRegistry,
    languageServersEnvironment.updateSettings,
    {
      environmentId: file.environmentId,
      input: {
        cwd: file.cwd,
        change: { type: "enabled", scope: "project", server, enabled: true },
      },
    },
    { ...REPORT, label: "turn on language server" },
  );

/** A checkout's interpreter; null goes back to finding one automatically. */
export const selectInterpreter = (
  target: Pick<LanguageServerFile, "environmentId" | "cwd">,
  path: string | null,
) =>
  void runAtomCommand(
    appAtomRegistry,
    languageServersEnvironment.updateSettings,
    {
      environmentId: target.environmentId,
      input: { cwd: target.cwd, change: { type: "toolchain", kind: "python", path } },
    },
    { ...REPORT, label: "select interpreter" },
  );

export const trustLanguageServerProject = (file: LanguageServerFile) =>
  void runAtomCommand(
    appAtomRegistry,
    languageServersEnvironment.trustProject,
    { environmentId: file.environmentId, input: { cwd: file.cwd } },
    { ...REPORT, label: "trust project" },
  );

/** The key Settings → Projects names a project by. */
export function projectSettingsKey(environmentId: EnvironmentId, projectId: ProjectId) {
  const projects = appAtomRegistry.get(environmentProjects.projectsAtom);
  const project = projects.find(
    (candidate) => candidate.environmentId === environmentId && candidate.id === projectId,
  );
  if (project === undefined) return null;
  return (
    buildPhysicalToLogicalProjectKeyMap({
      projects,
      settings: getClientSettings(),
      primaryEnvironmentId: null,
    }).get(derivePhysicalProjectKey(project)) ?? null
  );
}
