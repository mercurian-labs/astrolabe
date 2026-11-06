import { useAtomValue } from "@effect/atom-react";
import type { LanguageServerStatus } from "@t3tools/contracts";

import { formatBytes } from "~/lib/formatBytes";
import { languageServersEnvironment } from "~/state/languageServers";
import { Button } from "../ui/button";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import {
  restartLanguageServer,
  stopLanguageServer,
  trustLanguageServerProject,
  type LanguageServerFile,
} from "./languageServerFile";

const LABELS: Record<LanguageServerStatus["state"], (name: string) => string> = {
  "trust-needed": (name) => `${name} needs this project trusted`,
  downloading: (name) => `Downloading ${name}…`,
  starting: (name) => `${name} starting…`,
  ready: (name) => name,
  failed: (name) => `${name} failed`,
  missing: (name) => `${name} isn't installed`,
  stopped: (name) => `${name} stopped`,
  capped: (name) => `${name} paused to save memory`,
};

const STATES: Record<LanguageServerStatus["state"], string> = {
  "trust-needed": "Waiting for this project to be trusted",
  downloading: "Downloading",
  starting: "Starting",
  ready: "Running",
  failed: "Failed",
  missing: "Not installed",
  stopped: "Stopped",
  capped: "Paused to save memory",
};

/**
 * Astrolabe: a code file's language server, in its header: what runs and how it stands, as a menu
 * of what can be done to it, with the one action that moves it on when it can't run beside it.
 */
export function LanguageServerStatusEntry({
  file,
  status,
}: {
  readonly file: LanguageServerFile | null;
  readonly status: LanguageServerStatus | null;
}) {
  if (file === null || status === null) return null;
  return <Entry file={file} status={status} />;
}

function Entry({
  file,
  status,
}: {
  readonly file: LanguageServerFile;
  readonly status: LanguageServerStatus;
}) {
  const canMaintain = useAtomValue(
    languageServersEnvironment.restart.permissionAtom(file.environmentId),
  );
  const { state, restricted } = status;
  const running = state === "ready" || state === "starting";
  const trustable = state === "trust-needed" || restricted;
  const nudge =
    !canMaintain || running || state === "downloading"
      ? null
      : state === "trust-needed"
        ? { label: "Trust project", run: () => trustLanguageServerProject(file) }
        : {
            label: state === "missing" ? "Try again" : "Restart",
            run: () => restartLanguageServer(file),
          };
  return (
    <span className="flex shrink-0 items-center gap-1">
      <Menu>
        <MenuTrigger render={<Button size="xs" variant="ghost" />}>
          <span role="status">
            {LABELS[state](status.name)}
            {restricted && state !== "trust-needed" ? " (restricted)" : null}
          </span>
        </MenuTrigger>
        <MenuPopup align="end">
          <MenuGroup>
            <MenuGroupLabel>{status.name}</MenuGroupLabel>
            <p className="max-w-72 px-2 pb-1 text-xs text-muted-foreground">
              {STATES[state]}
              {restricted && state !== "trust-needed" ? ", restricted" : ""}
              {status.memoryBytes === null ? "" : ` · ${formatBytes(status.memoryBytes)}`}
              {status.message === null ? null : <span className="block">{status.message}</span>}
            </p>
          </MenuGroup>
          <MenuSeparator />
          {trustable ? (
            <MenuItem disabled={!canMaintain} onClick={() => trustLanguageServerProject(file)}>
              Trust project
            </MenuItem>
          ) : null}
          <MenuItem disabled={!canMaintain} onClick={() => restartLanguageServer(file)}>
            Restart
          </MenuItem>
          {running ? (
            <MenuItem disabled={!canMaintain} onClick={() => stopLanguageServer(file)}>
              Stop
            </MenuItem>
          ) : null}
          <MenuItem onClick={file.openLogs}>View logs</MenuItem>
        </MenuPopup>
      </Menu>
      {nudge ? (
        <Button size="xs" variant="ghost" onClick={nudge.run}>
          {nudge.label}
        </Button>
      ) : null}
    </span>
  );
}
