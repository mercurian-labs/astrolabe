import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, LanguageServerStatus } from "@t3tools/contracts";

import { languageServersEnvironment } from "~/state/languageServers";
import { useAtomCommand } from "~/state/use-atom-command";
import { Button } from "../ui/button";

const LABELS: Record<LanguageServerStatus["state"], (name: string) => string> = {
  "download-needed": (name) => `${name} needs a download`,
  downloading: (name) => `Downloading ${name}…`,
  starting: (name) => `${name} starting…`,
  ready: (name) => name,
  failed: (name) => `${name} failed`,
  stopped: (name) => `${name} stopped`,
  capped: (name) => `${name} paused to save memory`,
};

/**
 * Astrolabe: a code file's language server, in its header: what runs, while it starts, and the
 * one action that moves it on when it can't (download, or restart).
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
  const confirmDownload = useAtomCommand(languageServersEnvironment.confirmDownload, {
    label: "language server download",
  });
  if (status === null) return null;
  const action =
    !canMaintain || status.state === "ready" || status.state === "starting"
      ? null
      : status.state === "download-needed"
        ? {
            label: "Download",
            run: () => void confirmDownload({ environmentId, input: {} }),
          }
        : status.state === "downloading"
          ? null
          : {
              label: "Restart",
              run: () =>
                void restart({ environmentId, input: { cwd: status.cwd, server: status.server } }),
            };
  return (
    <span
      className="flex shrink-0 items-center gap-1"
      title={status.message ?? undefined}
      role="status"
    >
      {LABELS[status.state](status.name)}
      {status.restricted ? " (restricted)" : null}
      {action ? (
        <Button size="xs" variant="ghost" onClick={action.run}>
          {action.label}
        </Button>
      ) : null}
    </span>
  );
}
