import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { describeCodeIndexStatus } from "@t3tools/client-runtime/state/codeIndex";
import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useRef, useState } from "react";

import { useNowMinute } from "../../hooks/useNowMinute";
import { formatBytes } from "../../lib/formatBytes";
import { codeIndexEnvironment, codeIndexStatusesAtom } from "../../state/codeIndex";
import { environmentAtomList, environmentIdsKey } from "../../state/environmentAtomList";
import { useAtomCommand } from "../../state/use-atom-command";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";
import { ScopedSwitch } from "./ScopedSwitch";
import { SettingResetButton, SettingsRow, SettingsSection } from "./settingsLayout";
import { settingsScopeEnvironmentLabel } from "./settingsScopeAxis";
import { useSettingsScope } from "./SettingsScopeContext";
import { searchableSetting } from "./settingsSearch";
import {
  useScopedSettings,
  useScopedSettingsMixed,
  useUpdateScopedSettings,
} from "./useScopedSettings";

const count = (value: number, noun: string) =>
  `${value.toLocaleString()} ${value === 1 ? noun : `${noun}s`}`;

const rebuildPermissionsAtom = environmentAtomList(
  "web-code-index-rebuild-permissions",
  codeIndexEnvironment.rebuild.permissionAtom,
);

/**
 * Settings → Projects: a repository's code index. Shown only for checkouts the server indexes
 * (git repositories, not wikis), which report a status even while turned off.
 */
export function CodeIndexProjectSettings({
  members,
}: {
  members: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly id: ProjectId;
    readonly environmentLabel: string | null;
  }>;
}) {
  const nowMinute = useNowMinute();
  const nowMs = Date.parse(`${nowMinute}:00.000Z`);
  const { targets } = useSettingsScope();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const mixed = useScopedSettingsMixed(["codeIndex"]);
  const statuses = useAtomValue(
    codeIndexStatusesAtom(
      JSON.stringify(members.map((member) => [member.environmentId, member.id])),
    ),
  );
  const environmentIds = members.map((member) => member.environmentId);
  const allowed = useAtomValue(rebuildPermissionsAtom(environmentIdsKey(environmentIds)));
  const rebuild = useAtomCommand(codeIndexEnvironment.rebuild, { reportFailure: false });
  const skippedEdited = useRef(false);
  const [rebuilding, setRebuilding] = useState(false);
  const indexed = members.flatMap((member, index) => {
    const status = statuses[index];
    return status === null || status === undefined
      ? []
      : [{ member, status, allowed: allowed[index] === true }];
  });
  if (indexed.length === 0) return null;
  const scopeKey = targets.map((target) => `${target.environmentId}:${target.projectId}`).join(",");
  const codeIndex = settings.codeIndex;
  const skippedText = codeIndex.skippedPaths.join("\n");

  const rebuildAll = async () => {
    setRebuilding(true);
    await Promise.all(
      indexed
        .filter((entry) => entry.allowed && entry.status.state !== "off")
        .map(async ({ member }) => {
          const result = await rebuild({
            environmentId: member.environmentId,
            input: { projectId: member.id },
          });
          if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
            toastManager.add({
              type: "error",
              title: "Could not rebuild the code index",
              description: String(squashAtomCommandFailure(result)),
            });
          }
        }),
    ).finally(() => setRebuilding(false));
  };

  return (
    <SettingsSection title="Code index">
      <SettingsRow
        {...searchableSetting("project-code-index")}
        serverScoped
        settingKeys={["codeIndex"]}
        mixed={mixed}
        title="Index this project"
        description={
          <span>
            <span className="block">
              Reads every file's definitions and imports so agents and the local graph can find
              code. Every branch and worktree shares one index.
            </span>
            {indexed.map(({ member, status }) => (
              <span key={`${member.environmentId}:${member.id}`} className="mt-1 block">
                {indexed.length > 1 && member.environmentLabel !== null
                  ? `${member.environmentLabel}: `
                  : ""}
                {describeCodeIndexStatus(status, (iso) => formatRelativeTimeLabel(iso, nowMs))}
              </span>
            ))}
          </span>
        }
        control={
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={
                rebuilding ||
                !indexed.some((entry) => entry.allowed && entry.status.state !== "off")
              }
              onClick={() => void rebuildAll()}
            >
              {rebuilding ? "Rebuilding…" : "Rebuild"}
            </Button>
            <ScopedSwitch
              settingKeys={["codeIndex"]}
              aria-label="Index this project"
              checked={codeIndex.enabled}
              onCheckedChange={(enabled) =>
                updateSettings({ codeIndex: { ...codeIndex, enabled } })
              }
            />
          </div>
        }
      />
      <SettingsRow
        serverScoped
        settingKeys={["codeIndex"]}
        title="Skipped paths"
        description="Ignored files, node_modules, vendored and generated code are already skipped. Add gitignore-style patterns, one per line, for anything else."
        resetAction={
          codeIndex.skippedPaths.length > 0 ? (
            <SettingResetButton
              label="skipped paths"
              onClick={() => updateSettings({ codeIndex: { ...codeIndex, skippedPaths: [] } })}
            />
          ) : null
        }
      >
        <div className="mt-3 max-w-2xl pb-3.5">
          <Textarea
            key={`${scopeKey}:${mixed}:${skippedText}`}
            aria-label="Skipped paths"
            rows={3}
            defaultValue={mixed ? "" : skippedText}
            placeholder={
              mixed
                ? "Mixed. Enter patterns to apply to all selected checkouts."
                : "fixtures/\n*.snap.ts"
            }
            onChange={() => {
              skippedEdited.current = true;
            }}
            onBlur={(event) => {
              const skippedPaths = event.target.value
                .split("\n")
                .map((line) => line.trim())
                .filter((line) => line !== "");
              if (skippedEdited.current && (mixed || skippedPaths.join("\n") !== skippedText)) {
                updateSettings({ codeIndex: { ...codeIndex, skippedPaths } });
              }
              skippedEdited.current = false;
            }}
          />
        </div>
      </SettingsRow>
    </SettingsSection>
  );
}

const storageAtom = environmentAtomList("web-code-index-storage", codeIndexEnvironment.storage);
const prunePermissionsAtom = environmentAtomList(
  "web-code-index-prune-permissions",
  codeIndexEnvironment.prune.permissionAtom,
);
const clearPermissionsAtom = environmentAtomList(
  "web-code-index-clear-permissions",
  codeIndexEnvironment.clear.permissionAtom,
);

/** Settings → Maintenance: what the code indexes hold on disk, with Clean up and Clear all. */
export function CodeIndexStorageSection() {
  const { scope, connectedEnvironments } = useSettingsScope();
  const environmentIds = connectedEnvironments.map(({ environmentId }) => environmentId);
  const key = environmentIdsKey(environmentIds);
  const storage = useAtomValue(storageAtom(key));
  const canPrune = useAtomValue(prunePermissionsAtom(key));
  const canClear = useAtomValue(clearPermissionsAtom(key));
  const prune = useAtomCommand(codeIndexEnvironment.prune, { reportFailure: false });
  const clear = useAtomCommand(codeIndexEnvironment.clear, { reportFailure: false });
  const [pending, setPending] = useState<"prune" | "clear" | null>(null);
  if (scope.kind === "project" || scope.kind === "checkout") return null;
  const rows = connectedEnvironments.map((environment, index) => {
    const query = storage[index]!;
    return {
      environment,
      label: settingsScopeEnvironmentLabel(environment, connectedEnvironments),
      storage: query._tag === "Success" ? query.value : null,
      loading: query.waiting,
      canPrune: canPrune[index] === true,
      canClear: canClear[index] === true,
    };
  });
  const run = async (action: "prune" | "clear") => {
    setPending(action);
    await Promise.all(
      rows
        .filter((row) => row.storage !== null && (action === "prune" ? row.canPrune : row.canClear))
        .map(async ({ environment }) => {
          const target = { environmentId: environment.environmentId, input: {} };
          const result = action === "prune" ? await prune(target) : await clear(target);
          if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
            toastManager.add({
              type: "error",
              title: `Could not ${action === "prune" ? "clean up" : "clear"} the code index on ${environment.label}`,
              description: String(squashAtomCommandFailure(result)),
            });
          }
        }),
    ).finally(() => setPending(null));
  };
  const available = rows.filter((row) => row.storage !== null);
  return (
    <SettingsSection id="code-index-storage-section" title="Code index">
      <SettingsRow
        {...searchableSetting("code-index-storage")}
        title="Code index storage"
        description={
          <span>
            {rows.map(({ environment, label, storage: held, loading }) => (
              <span key={environment.environmentId} className="block">
                {rows.length > 1 ? `${label}: ` : ""}
                {held !== null
                  ? `${formatBytes(held.bytes)} · ${count(held.fileVersions, "file version")} · ${held.unusedFileVersions.toLocaleString()} unused`
                  : loading
                    ? "Measuring…"
                    : "Unavailable on this machine."}
              </span>
            ))}
            <span className="mt-1 block">
              Clean up removes file versions no branch, worktree or checkpoint uses. Clear all
              deletes every index; projects that index build again.
            </span>
          </span>
        }
        control={
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={
                pending !== null ||
                !available.some((row) => row.canPrune && row.storage!.unusedFileVersions > 0)
              }
              onClick={() => void run("prune")}
            >
              {pending === "prune" ? "Cleaning…" : "Clean up"}
            </Button>
            <Button
              size="sm"
              variant="destructive-outline"
              disabled={
                pending !== null ||
                !available.some((row) => row.canClear && row.storage!.fileVersions > 0)
              }
              onClick={() => void run("clear")}
            >
              {pending === "clear" ? "Clearing…" : "Clear all"}
            </Button>
          </div>
        }
      />
    </SettingsSection>
  );
}
