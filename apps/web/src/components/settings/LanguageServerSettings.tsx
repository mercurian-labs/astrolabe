import { RegistryContext, useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, LanguageServerCheck } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { useContext } from "react";

import { languageServersEnvironment } from "../../state/languageServers";
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
  switch (check.state) {
    case "found":
      return `${check.name}, ${SOURCES[check.source ?? "path"]}: ${check.executable}`;
    case "download":
      return "Downloads the first time one of its files opens.";
    case "missing":
      return "Not available.";
  }
};

/**
 * Astrolabe: Settings → Projects, what each language server would run for this project's
 * checkouts, and what's missing. Checking starts and downloads nothing.
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
    return {
      member,
      checks: query?._tag === "Success" ? query.value : null,
      waiting: query?.waiting ?? true,
      failed: query?._tag === "Failure",
    };
  });
  const servers = checkouts.find((checkout) => checkout.checks !== null)?.checks ?? [];
  const waiting = checkouts.some((checkout) => checkout.waiting);
  const prefix = (member: Checkout) =>
    members.length > 1 && member.environmentLabel !== null ? `${member.environmentLabel}: ` : "";

  return (
    <SettingsSection title="Language servers">
      <SettingsRow
        {...searchableSetting("project-language-servers")}
        title="Language servers"
        description="Power completion, go to definition, rename and problems in the editor, and agents' code tools. Astrolabe uses a server installed on the machine, or downloads one the first time a file needs it."
        control={
          <Button size="sm" variant="outline" disabled={waiting} onClick={recheck}>
            {waiting ? "Checking…" : "Check again"}
          </Button>
        }
      />
      {servers.map((server) => (
        <SettingsRow
          key={server.server}
          title={server.languages}
          description={
            <span>
              {checkouts.map(({ member, checks, failed }) => {
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
                    {check?.message ? (
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
