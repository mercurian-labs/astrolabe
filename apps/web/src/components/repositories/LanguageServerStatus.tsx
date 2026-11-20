import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { selectEnvironmentQueryData } from "@t3tools/client-runtime/state/runtime";
import type {
  LanguageServerRoute,
  LanguageServerStatus,
  LanguageServerToolchainOption,
} from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { ShieldIcon } from "lucide-react";
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
  "trust-needed": (name) => `${name}: Not trusted`,
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

/** What the header entry and the trust bar both read: the companions and whether trust helps. */
function useServers(
  file: LanguageServerFile,
  status: LanguageServerStatus,
  servers: ReadonlyArray<LanguageServerRoute>,
) {
  const canMaintain = useAtomValue(
    languageServersEnvironment.restart.permissionAtom(file.environmentId),
  );
  const running = selectEnvironmentQueryData(
    useAtomValue(languageServersEnvironment.statuses(file.environmentId)),
  );
  const others = servers.filter(({ server }) => server !== file.server);
  // Companions the checkout doesn't use have no status; Settings says why.
  const companions = others
    .filter((route) => !route.off)
    .flatMap(
      ({ server }) =>
        running?.find((other) => other.cwd === file.cwd && other.server === server) ?? [],
    );
  const trustable = [status, ...companions].some(
    (entry) => entry.state === "trust-needed" || entry.restricted,
  );
  // The route's name has no version: the label stays short while nothing runs.
  const name = servers.find(({ server }) => server === file.server)?.name ?? status.name;
  return { canMaintain, others, companions, trustable, name };
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
  const { canMaintain, others, companions, trustable, name } = useServers(file, status, servers);
  const off = others.filter((route) => route.off);
  const { state, restricted } = status;
  const alive = state === "ready" || state === "starting";
  // Trust is asked in the bar under the header, which has room to say what it allows.
  const nudge =
    !canMaintain || alive || state === "downloading" || state === "trust-needed"
      ? null
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
            {LABELS[state](state === "trust-needed" ? name : status.name)}
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

const trustBarDismissed = Atom.family((checkout: string) =>
  Atom.make(false).pipe(Atom.keepAlive, Atom.withLabel(`language-servers:trust-bar:${checkout}`)),
);

/**
 * Astrolabe: the question an untrusted project's code file asks once, under its header. "Not now"
 * hides it for the checkout until the app reloads; the header's menu and the commands still trust.
 */
export function LanguageServerTrustBar({
  file,
  status,
  servers,
}: {
  readonly file: LanguageServerFile | null;
  readonly status: LanguageServerStatus | null;
  readonly servers: ReadonlyArray<LanguageServerRoute>;
}) {
  if (file === null || status === null) return null;
  return <TrustBar file={file} status={status} servers={servers} />;
}

function TrustBar({
  file,
  status,
  servers,
}: {
  readonly file: LanguageServerFile;
  readonly status: LanguageServerStatus;
  readonly servers: ReadonlyArray<LanguageServerRoute>;
}) {
  const { canMaintain, trustable, name } = useServers(file, status, servers);
  const dismissedAtom = trustBarDismissed(`${file.environmentId}\0${file.cwd}`);
  const dismissed = useAtomValue(dismissedAtom);
  const dismiss = useAtomSet(dismissedAtom);
  if (!canMaintain || !trustable || dismissed) return null;
  return (
    <div
      role="region"
      aria-label="Project trust"
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border bg-muted/40 px-(--workspace-gutter-start) py-2 text-xs"
    >
      <ShieldIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      <p className="min-w-0 flex-1 basis-64">
        <span className="font-medium text-foreground">
          {status.state === "trust-needed"
            ? `${name} starts once you trust this project.`
            : "Some language features are off until you trust this project."}
        </span>{" "}
        <span className="text-muted-foreground">
          Trusting lets its language servers download and run code from it.
        </span>
      </p>
      <span className="flex shrink-0 items-center gap-1">
        <Button size="xs" variant="ghost" onClick={() => dismiss(true)}>
          Not now
        </Button>
        <Button size="xs" variant="outline" onClick={() => trustLanguageServerProject(file)}>
          Trust project
        </Button>
      </span>
    </div>
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
