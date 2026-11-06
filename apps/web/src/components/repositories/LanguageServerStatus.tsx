import { useAtomValue } from "@effect/atom-react";
import { selectEnvironmentQueryData } from "@t3tools/client-runtime/state/runtime";
import type { LanguageServerStatus } from "@t3tools/contracts";
import { Fragment } from "react";

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
  disabled: (name) => `${name}: Off in settings`,
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
  disabled: "Off in settings",
  downloading: "Downloading",
  starting: "Starting",
  ready: "Running",
  failed: "Failed",
  missing: "Not installed",
  stopped: "Stopped",
  capped: "Paused to save memory",
};

/**
 * Astrolabe: a code file's language servers, in its header: its primary and how it stands, as a
 * menu of every server on the file and what can be done to each, with the one action that moves
 * the primary on when it can't run beside it.
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
  const running = selectEnvironmentQueryData(
    useAtomValue(languageServersEnvironment.statuses(file.environmentId)),
  );
  // Companions the checkout doesn't use have no status; Settings says why.
  const companions = file.servers
    .slice(1)
    .flatMap(
      (server) => running?.find((other) => other.cwd === file.cwd && other.server === server) ?? [],
    );
  const { state, restricted } = status;
  const alive = state === "ready" || state === "starting";
  const trustable = [status, ...companions].some(
    (entry) => entry.state === "trust-needed" || entry.restricted,
  );
  const nudge =
    !canMaintain || alive || state === "downloading"
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
            {companions.length > 0 ? ` +${companions.length}` : null}
          </span>
        </MenuTrigger>
        <MenuPopup align="end">
          {[status, ...companions].map((entry, index) => (
            <Fragment key={entry.server}>
              {index > 0 ? <MenuSeparator /> : null}
              <ServerItems file={file} status={entry} canMaintain={canMaintain} />
            </Fragment>
          ))}
          {trustable ? (
            <>
              <MenuSeparator />
              <MenuItem disabled={!canMaintain} onClick={() => trustLanguageServerProject(file)}>
                Trust project
              </MenuItem>
            </>
          ) : null}
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

function ServerItems({
  file,
  status,
  canMaintain,
}: {
  readonly file: LanguageServerFile;
  readonly status: LanguageServerStatus;
  readonly canMaintain: boolean;
}) {
  const { server, state, restricted } = status;
  return (
    <>
      <MenuGroup>
        <MenuGroupLabel>{status.name}</MenuGroupLabel>
        <p className="max-w-72 px-2 pb-1 text-xs text-muted-foreground">
          {STATES[state]}
          {restricted && state !== "trust-needed" ? ", restricted" : ""}
          {status.memoryBytes === null ? "" : ` · ${formatBytes(status.memoryBytes)}`}
          {status.message === null ? null : <span className="block">{status.message}</span>}
        </p>
      </MenuGroup>
      <MenuItem disabled={!canMaintain} onClick={() => restartLanguageServer(file, server)}>
        Restart
      </MenuItem>
      {state === "ready" || state === "starting" ? (
        <MenuItem disabled={!canMaintain} onClick={() => stopLanguageServer(file, server)}>
          Stop
        </MenuItem>
      ) : null}
      <MenuItem onClick={() => file.openLogs(server)}>View logs</MenuItem>
    </>
  );
}
