import { RegistryContext, useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, LanguageServerCheck } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { useContext } from "react";

import { languageServersEnvironment } from "../../state/languageServers";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

interface Checkout {
  readonly environmentId: EnvironmentId;
  readonly workspaceRoot: string;
  readonly environmentLabel: string | null;
}

const checksAtom = Atom.family((key: string) =>
  Atom.make((get) =>
    (JSON.parse(key) as Array<[EnvironmentId, string]>).map(([environmentId, cwd]) =>
      get(languageServersEnvironment.check(environmentId, cwd)),
    ),
  ).pipe(Atom.withLabel(`language-server-checks:${key}`)),
);

const SOURCES: Record<NonNullable<LanguageServerCheck["source"]>, string> = {
  project: "the project's own",
  path: "installed on this machine",
  cache: "downloaded by Astrolabe",
  download: "downloaded by Astrolabe",
};

const describe = (check: LanguageServerCheck) => {
  if (check.companion?.active === false) return check.companion.reason;
  switch (check.state) {
    case "found":
      return `${check.name}, ${SOURCES[check.source ?? "path"]}: ${check.executable}`;
    case "download":
      return "Downloads the first time one of its files opens.";
    case "trust":
      return "Waits until this project is trusted.";
    case "missing":
      return "Not available.";
  }
};

/** Whether a checkout's project is trusted on its machine, and the way to change it. */
function ProjectTrustRow({
  member,
  label,
  trusted,
  onChanged,
}: {
  readonly member: Checkout;
  readonly label: string;
  readonly trusted: boolean | null;
  readonly onChanged: () => void;
}) {
  const canMaintain = useAtomValue(
    languageServersEnvironment.trustProject.permissionAtom(member.environmentId),
  );
  const trust = useAtomCommand(languageServersEnvironment.trustProject, "trust project");
  const revoke = useAtomCommand(languageServersEnvironment.revokeProjectTrust, "revoke trust");
  const change = async () => {
    const run = trusted ? revoke : trust;
    await run({ environmentId: member.environmentId, input: { cwd: member.workspaceRoot } });
    onChanged();
  };
  return (
    <SettingsRow
      title={`${label}${trusted === null ? "Checking…" : trusted ? "Trusted" : "Not trusted"}`}
      description={
        trusted
          ? "Its language servers download and start with full features, in every checkout of this repository."
          : "Only servers that run no project code and are already here start, restricted. Trust it to run the rest."
      }
      control={
        <Button
          size="sm"
          variant="outline"
          disabled={trusted === null || !canMaintain}
          onClick={() => void change()}
        >
          {trusted ? "Revoke" : "Trust"}
        </Button>
      }
    />
  );
}

/**
 * Astrolabe: Settings → Projects, what each language server would run for this project's
 * checkouts, what's missing, and whether each checkout's project is trusted. Checking starts and
 * downloads nothing.
 */
export function LanguageServerProjectSettings({ members }: { members: ReadonlyArray<Checkout> }) {
  const key = JSON.stringify(members.map((member) => [member.environmentId, member.workspaceRoot]));
  const registry = useContext(RegistryContext);
  const checks = useAtomValue(checksAtom(key));
  const recheck = () => {
    for (const member of members) {
      registry.refresh(
        languageServersEnvironment.check(member.environmentId, member.workspaceRoot),
      );
    }
  };
  const checkouts = members.map((member, index) => {
    const query = checks[index];
    const result = query?._tag === "Success" ? query.value : null;
    return {
      member,
      trusted: result?.trusted ?? null,
      checks: result?.servers ?? null,
      waiting: query?.waiting ?? true,
      failed: query?._tag === "Failure",
    };
  });
  const servers = checkouts.find((checkout) => checkout.checks !== null)?.checks ?? [];
  // Each language's companions follow its primary.
  const rows = servers
    .filter((server) => server.companion === null)
    .flatMap((primary) => [
      primary,
      ...servers.filter(
        (server) => server.companion !== null && server.languages === primary.languages,
      ),
    ]);
  const waiting = checkouts.some((checkout) => checkout.waiting);
  const prefix = (member: Checkout) =>
    members.length > 1 && member.environmentLabel !== null ? `${member.environmentLabel}: ` : "";

  return (
    <SettingsSection title="Language servers">
      <SettingsRow
        {...searchableSetting("project-language-servers")}
        title="Language servers"
        description="Power completion, go to definition, rename and problems in the editor, and agents' code tools. In a trusted project Astrolabe uses the project's server or one installed on the machine, or downloads one the first time a file needs it."
        control={
          <Button size="sm" variant="outline" disabled={waiting} onClick={recheck}>
            {waiting ? "Checking…" : "Check again"}
          </Button>
        }
      />
      {checkouts.map(({ member, trusted, failed }) =>
        failed ? null : (
          <ProjectTrustRow
            key={`trust:${member.environmentId}:${member.workspaceRoot}`}
            member={member}
            label={prefix(member)}
            trusted={trusted}
            onChanged={recheck}
          />
        ),
      )}
      {rows.map((server) => (
        <SettingsRow
          key={server.server}
          title={server.companion === null ? server.languages : server.name}
          description={
            <span>
              {checkouts.map(({ member, trusted, checks, failed }) => {
                const check = checks?.find((candidate) => candidate.server === server.server);
                return (
                  <span key={`${member.environmentId}:${member.workspaceRoot}`} className="block">
                    {prefix(member)}
                    {check !== undefined
                      ? describe(check)
                      : failed
                        ? "Couldn't check this machine."
                        : checks === null
                          ? "Checking…"
                          : "Unavailable on this machine."}
                    {check?.companion?.active === true ? (
                      <span className="block text-muted-foreground">{check.companion.reason}</span>
                    ) : null}
                    {check?.state === "found" &&
                    trusted === false &&
                    check.companion?.active !== false ? (
                      <span className="block text-muted-foreground">
                        Runs restricted until this project is trusted.
                      </span>
                    ) : null}
                    {check?.message && check.companion?.active !== false ? (
                      <span className="block text-muted-foreground">{check.message}</span>
                    ) : null}
                  </span>
                );
              })}
            </span>
          }
        />
      ))}
      {servers.length === 0 && !waiting ? (
        <SettingsRow title="Unavailable" description="This machine could not check its servers." />
      ) : null}
    </SettingsSection>
  );
}
