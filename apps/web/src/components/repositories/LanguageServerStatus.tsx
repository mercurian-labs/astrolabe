import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, LanguageServerStatus } from "@t3tools/contracts";

import { languageServersEnvironment } from "~/state/languageServers";
import { useAtomCommand } from "~/state/use-atom-command";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

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

/**
 * Astrolabe: a code file's language server, in its header: what runs, while it starts, and the
 * one action that moves it on when it can't (trusting the project, or restart).
 */
export function LanguageServerStatusEntry({
  environmentId,
  status,
}: {
  readonly environmentId: EnvironmentId;
  readonly status: LanguageServerStatus | null;
}) {
  const canMaintain = useAtomValue(
    languageServersEnvironment.restart.permissionAtom(environmentId),
  );
  const restart = useAtomCommand(languageServersEnvironment.restart, {
    label: "language server restart",
  });
  const trustProject = useAtomCommand(languageServersEnvironment.trustProject, {
    label: "trust project",
  });
  if (status === null) return null;
  const action =
    !canMaintain || status.state === "ready" || status.state === "starting"
      ? null
      : status.state === "trust-needed"
        ? {
            label: "Trust project",
            run: () => void trustProject({ environmentId, input: { cwd: status.cwd } }),
          }
        : status.state === "downloading"
          ? null
          : {
              label: status.state === "missing" ? "Try again" : "Restart",
              run: () =>
                void restart({ environmentId, input: { cwd: status.cwd, server: status.server } }),
            };
  const label = (
    <span role="status">
      {LABELS[status.state](status.name)}
      {status.restricted && status.state !== "trust-needed" ? " (restricted)" : null}
    </span>
  );
  return (
    <span className="flex shrink-0 items-center gap-1">
      {status.message === null ? (
        label
      ) : (
        <Tooltip>
          <TooltipTrigger render={label} />
          <TooltipPopup side="bottom">{status.message}</TooltipPopup>
        </Tooltip>
      )}
      {action ? (
        <Button size="xs" variant="ghost" onClick={action.run}>
          {action.label}
        </Button>
      ) : null}
    </span>
  );
}
