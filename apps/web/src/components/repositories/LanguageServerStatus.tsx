import { useAtomValue } from "@effect/atom-react";
import { selectEnvironmentQueryData } from "@t3tools/client-runtime/state/runtime";
import type {
  LanguageServerRoute,
  LanguageServerStatus,
  LanguageServerToolchainOption,
} from "@t3tools/contracts";
import { Fragment } from "react";

import { formatBytes } from "~/lib/formatBytes";
import { languageServersEnvironment } from "~/state/languageServers";
import { useEnvironmentQuery } from "~/state/query";
import { Button } from "../ui/button";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "../ui/menu";
import {
  restartLanguageServer,
  selectInterpreter,
  stopLanguageServer,
  trustLanguageServerProject,
  turnOnLanguageServer,
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

/** ".venv, Python 3.12.1": what a person picking one needs to tell them apart. */
export const describeInterpreter = (option: LanguageServerToolchainOption) =>
  option.version === null || option.label.includes(option.version)
    ? option.label
    : `${option.label}, Python ${option.version}`;

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
  servers,
}: {
  readonly file: LanguageServerFile | null;
  readonly status: LanguageServerStatus | null;
  /** Every server settings put on this file, primary first. */
  readonly servers: ReadonlyArray<LanguageServerRoute>;
}) {
  if (file === null || status === null) return null;
  return <Entry file={file} status={status} servers={servers} />;
}

function Entry({
  file,
  status,
  servers,
}: {
  readonly file: LanguageServerFile;
  readonly status: LanguageServerStatus;
  readonly servers: ReadonlyArray<LanguageServerRoute>;
}) {
  const canMaintain = useAtomValue(
    languageServersEnvironment.restart.permissionAtom(file.environmentId),
  );
  const running = selectEnvironmentQueryData(
    useAtomValue(languageServersEnvironment.statuses(file.environmentId)),
  );
  const others = servers.filter(({ server }) => server !== file.server);
  const off = others.filter((route) => route.off);
  // Companions the checkout doesn't use have no status; Settings says why.
  const companions = others
    .filter((route) => !route.off)
    .flatMap(
      ({ server }) =>
        running?.find((other) => other.cwd === file.cwd && other.server === server) ?? [],
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
        : state === "disabled"
          ? { label: "Turn on", run: () => turnOnLanguageServer(file, file.server) }
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
          {off.map((route) => (
            <Fragment key={route.server}>
              <MenuSeparator />
              <MenuGroup>
                <MenuGroupLabel>{route.name}</MenuGroupLabel>
                <p className="max-w-72 px-2 pb-1 text-xs text-muted-foreground">Off in settings</p>
              </MenuGroup>
              <MenuItem
                disabled={!canMaintain}
                onClick={() => turnOnLanguageServer(file, route.server)}
              >
                Turn on
              </MenuItem>
            </Fragment>
          ))}
          {file.toolchain === "python" ? (
            <>
              <MenuSeparator />
              <PythonInterpreter file={file} canMaintain={canMaintain} />
            </>
          ) : null}
          {trustable ? (
            <>
              <MenuSeparator />
              <MenuItem disabled={!canMaintain} onClick={() => trustLanguageServerProject(file)}>
                Trust project
              </MenuItem>
            </>
          ) : null}
          {file.openSettings ? (
            <>
              <MenuSeparator />
              <MenuItem onClick={file.openSettings}>Language server settings</MenuItem>
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

/** What a Python file's servers read, and the way to choose another. */
function PythonInterpreter({
  file,
  canMaintain,
}: {
  readonly file: LanguageServerFile;
  readonly canMaintain: boolean;
}) {
  const { data } = useEnvironmentQuery(
    languageServersEnvironment.toolchains({
      environmentId: file.environmentId,
      input: { cwd: file.cwd },
    }),
  );
  const active = data?.active ?? null;
  const automatic = data?.selected === null || data?.selectedMissing === true;
  const AUTOMATIC = "automatic";
  return (
    <>
      <MenuGroup>
        <MenuGroupLabel>Python interpreter</MenuGroupLabel>
        <p className="max-w-72 px-2 pb-1 text-xs text-muted-foreground">
          {data === null
            ? "Looking…"
            : !data.trusted
              ? "Applies once this project is trusted"
              : active === null
                ? "Automatic: none in this checkout"
                : `${describeInterpreter(active)}${automatic ? " (automatic)" : ""}`}
          {data?.selectedMissing ? (
            <span className="block">The interpreter chosen here is gone: {data.selected}</span>
          ) : null}
        </p>
      </MenuGroup>
      {data?.selectedMissing ? (
        <MenuItem disabled={!canMaintain} onClick={() => selectInterpreter(file, null)}>
          Clear chosen interpreter
        </MenuItem>
      ) : null}
      <MenuSub>
        <MenuSubTrigger disabled={!canMaintain || data === null}>
          Select Python interpreter
        </MenuSubTrigger>
        <MenuSubPopup>
          <MenuRadioGroup
            value={data?.selected ?? AUTOMATIC}
            onValueChange={(path: string) =>
              selectInterpreter(file, path === AUTOMATIC ? null : path)
            }
          >
            <MenuRadioItem value={AUTOMATIC}>Automatic</MenuRadioItem>
            {data?.options.map((option) => (
              <MenuRadioItem key={option.path} value={option.path} title={option.path}>
                {describeInterpreter(option)}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuSubPopup>
      </MenuSub>
    </>
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
      {state === "disabled" ? (
        <MenuItem disabled={!canMaintain} onClick={() => turnOnLanguageServer(file, server)}>
          Turn on
        </MenuItem>
      ) : (
        <MenuItem disabled={!canMaintain} onClick={() => restartLanguageServer(file, server)}>
          Restart
        </MenuItem>
      )}
      {state === "ready" || state === "starting" ? (
        <MenuItem disabled={!canMaintain} onClick={() => stopLanguageServer(file, server)}>
          Stop
        </MenuItem>
      ) : null}
      <MenuItem onClick={() => file.openLogs(server)}>View logs</MenuItem>
    </>
  );
}
