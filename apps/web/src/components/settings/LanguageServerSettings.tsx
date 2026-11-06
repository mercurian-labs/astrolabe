import { RegistryContext, useAtomValue } from "@effect/atom-react";
import {
  type BuiltInLanguageServerId,
  type CustomLanguageServer,
  type CustomLanguageServerFields,
  type EnvironmentId,
  isBuiltInLanguageServerId,
  type LanguageServerCheck,
  type LanguageServerOverride,
  type LanguageServerSettingsChange,
  type LanguageServerSettingsScope,
} from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";
import { type ChangeEvent, useContext, useId, useState } from "react";

import { languageServersEnvironment } from "../../state/languageServers";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import {
  type CustomFormErrors,
  type CustomFormFields,
  customFormFields,
  describeOverrides,
  EMPTY_CUSTOM_FORM,
  moved,
  parseCustomForm,
  parseServerForm,
  type ServerFormErrors,
  type ServerFormFields,
  serverFormFields,
} from "./LanguageServerSettings.logic";
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
  if (check.off) return "Off in settings. Turn it on here to use it.";
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

/** Each language's servers together, in the order they run; those added in settings on their own. */
const languageGroups = (servers: ReadonlyArray<LanguageServerCheck>) => {
  const groups = new Map<string, Array<LanguageServerCheck>>();
  for (const server of servers) {
    const group = server.language ?? server.server;
    groups.set(group, [...(groups.get(group) ?? []), server]);
  }
  return [...groups.values()];
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

/** Lives out here because React Compiler can't take a computed key in a destructure. */
const withoutField = <Errors extends object>(errors: Errors, name: keyof Errors) => {
  const { [name]: _cleared, ...others } = errors;
  return others as Errors;
};

/** A server's settings at one scope, each field's problem shown beside it. */
function ServerForm({
  check,
  override,
  custom,
  onSave,
}: {
  readonly check: LanguageServerCheck;
  readonly override: LanguageServerOverride | undefined;
  /** A server added in settings is run as its own form says, not by this one. */
  readonly custom: boolean;
  readonly onSave: (next: LanguageServerOverride) => void;
}) {
  const [fields, setFields] = useState<ServerFormFields>(() => serverFormFields(override));
  const [errors, setErrors] = useState<ServerFormErrors>({});
  const field = (name: keyof ServerFormFields) => ({
    value: fields[name],
    error: errors[name],
    onChange: (value: string) => {
      setFields((current) => ({ ...current, [name]: value }));
      setErrors((current) => withoutField(current, name));
    },
  });
  const save = () => {
    const parsed = parseServerForm(fields, override?.enabled);
    if ("errors" in parsed) setErrors(parsed.errors);
    else onSave(parsed.override);
  };
  return (
    <div className="mt-2 grid gap-2">
      {custom ? null : (
        <>
          <FormField
            label="Binary"
            hint="A full path or a name on PATH. Empty finds it as usual."
            {...field("binary")}
          />
          <FormField
            label="Arguments"
            hint="One per line, in place of the usual ones."
            lines
            {...field("args")}
          />
          <FormField label="Environment" hint="NAME=value, one per line." lines {...field("env")} />
        </>
      )}
      <FormField
        label="Initialization options"
        hint="JSON, merged over what it's usually started with."
        lines
        {...field("initializationOptions")}
      />
      <FormField
        label="Settings"
        hint="JSON, the server's answers to workspace/configuration."
        lines
        {...field("settings")}
      />
      <div className="flex justify-end">
        <Button size="sm" variant="outline" onClick={save} aria-label={`Save ${check.name}`}>
          Save and restart
        </Button>
      </div>
    </div>
  );
}

function FormField({
  label,
  hint,
  value,
  error,
  lines = false,
  onChange,
}: {
  readonly label: string;
  readonly hint: string;
  readonly value: string;
  readonly error: string | undefined;
  readonly lines?: boolean;
  readonly onChange: (value: string) => void;
}) {
  const id = useId();
  const noteId = `${id}-note`;
  const control = {
    id,
    value,
    size: "sm",
    font: "mono",
    "aria-describedby": noteId,
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      onChange(event.target.value),
    ...(error === undefined ? {} : { "aria-invalid": true }),
  } as const;
  return (
    <div className="grid gap-1 text-xs">
      <label htmlFor={id} className="font-medium text-foreground">
        {label}
      </label>
      {lines ? <Textarea {...control} /> : <Input {...control} />}
      {error === undefined ? (
        <span id={noteId} className="text-muted-foreground">
          {hint}
        </span>
      ) : (
        <span id={noteId} role="alert" className="text-destructive-foreground">
          {error}
        </span>
      )}
    </div>
  );
}

/** A new server, or one to edit: no code, just what to run and which files it reads. */
function CustomServerForm({
  initial,
  onSave,
  onCancel,
}: {
  readonly initial: CustomFormFields;
  readonly onSave: (server: CustomLanguageServerFields) => void;
  readonly onCancel: () => void;
}) {
  const [fields, setFields] = useState(initial);
  const [errors, setErrors] = useState<CustomFormErrors>({});
  const field = (name: Exclude<keyof CustomFormFields, "replaces">) => ({
    value: fields[name],
    error: errors[name],
    onChange: (value: string) => {
      setFields((current) => ({ ...current, [name]: value }));
      setErrors((current) => withoutField(current, name));
    },
  });
  const save = () => {
    const parsed = parseCustomForm(fields);
    if ("errors" in parsed) setErrors(parsed.errors);
    else onSave(parsed.server);
  };
  return (
    <div className="mt-2 grid gap-2">
      <FormField label="Name" hint="As it shows in the status menu." {...field("name")} />
      <FormField
        label="Command"
        hint="A full path or a name on PATH. It runs in trusted projects only."
        {...field("command")}
      />
      <FormField label="Arguments" hint="One per line." lines {...field("args")} />
      <FormField label="Environment" hint="NAME=value, one per line." lines {...field("env")} />
      <FormField
        label="File extensions"
        hint="One per line, with its LSP language id after a space: foo foolang. Without one, the extension is its id."
        lines
        {...field("extensions")}
      />
      <FormField
        label="Root files"
        hint="Optional, one per line: it runs only in checkouts with one of these at their root."
        lines
        {...field("rootFiles")}
      />
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-medium text-foreground">Beside the usual server</span>
        <Select
          value={fields.replaces ? "replaces" : "joins"}
          onValueChange={(value) =>
            setFields((current) => ({ ...current, replaces: value === "replaces" }))
          }
        >
          <SelectTrigger size="sm" aria-label="Beside the usual server">
            <SelectValue>
              {(value: string | null) =>
                value === "replaces" ? "Replaces it on these files" : "Joins it on these files"
              }
            </SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            <SelectItem value="joins">Joins it on these files</SelectItem>
            <SelectItem value="replaces">Replaces it on these files</SelectItem>
          </SelectPopup>
        </Select>
      </div>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" variant="outline" onClick={save}>
          Save
        </Button>
      </div>
    </div>
  );
}

/** One server: on or off, its place in its language, and its settings at the chosen scope. */
function ServerControls({
  check,
  order,
  disabled,
  open,
  onToggleOpen,
  onEnabled,
  onMove,
}: {
  readonly check: LanguageServerCheck;
  /** The language's servers in the order they run; just this one for a server alone. */
  readonly order: ReadonlyArray<LanguageServerCheck["server"]>;
  readonly disabled: boolean;
  readonly open: boolean;
  readonly onToggleOpen: () => void;
  readonly onEnabled: (enabled: boolean) => void;
  readonly onMove: (by: -1 | 1) => void;
}) {
  const at = order.indexOf(check.server);
  return (
    <span className="flex items-center gap-1">
      {order.length > 1 ? (
        <>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={`Run ${check.name} earlier`}
            disabled={disabled || at <= 0}
            onClick={() => onMove(-1)}
          >
            <ArrowUpIcon />
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={`Run ${check.name} later`}
            disabled={disabled || at === order.length - 1}
            onClick={() => onMove(1)}
          >
            <ArrowDownIcon />
          </Button>
        </>
      ) : null}
      <Button size="xs" variant="ghost" aria-expanded={open} onClick={onToggleOpen}>
        Configure
      </Button>
      <Switch
        aria-label={`${check.name} on`}
        checked={!check.off}
        disabled={disabled}
        onCheckedChange={onEnabled}
      />
    </span>
  );
}

/**
 * Astrolabe: Settings → Projects, what each language server would run for this project's
 * checkouts, what's missing, whether each checkout's project is trusted, and what people have
 * changed about it. Checking starts and downloads nothing; a change restarts what it reaches.
 */
export function LanguageServerProjectSettings({ members }: { members: ReadonlyArray<Checkout> }) {
  const key = JSON.stringify(members.map((member) => [member.environmentId, member.workspaceRoot]));
  const registry = useContext(RegistryContext);
  const checks = useAtomValue(checksAtom(key));
  const [scope, setScope] = useState<LanguageServerSettingsScope>("project");
  const [editingIndex, setEditingIndex] = useState(0);
  const [configuring, setConfiguring] = useState<LanguageServerCheck["server"] | null>(null);
  const [customForm, setCustomForm] = useState<"new" | CustomLanguageServer["id"] | null>(null);
  const update = useAtomCommand(
    languageServersEnvironment.updateSettings,
    "language server settings",
  );
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
      result,
      trusted: result?.trusted ?? null,
      checks: result?.servers ?? null,
      waiting: query?.waiting ?? true,
      failed: query?._tag === "Failure",
    };
  });
  const servers = checkouts.find((checkout) => checkout.checks !== null)?.checks ?? [];
  const editing = checkouts[editingIndex] ?? checkouts[0];
  const edited = editing?.result ?? null;
  const editable = useAtomValue(
    languageServersEnvironment.updateSettings.permissionAtom(
      editing?.member.environmentId ?? (members[0]?.environmentId as EnvironmentId),
    ),
  );
  const canEdit = editable && edited !== null && edited.settingsProblem === null;
  const groups = languageGroups(servers);
  const layer = edited?.settings[scope];
  const change = async (next: LanguageServerSettingsChange) => {
    if (editing === undefined) return;
    await update({
      environmentId: editing.member.environmentId,
      input: { cwd: editing.member.workspaceRoot, change: next },
    });
    recheck();
  };
  const waiting = checkouts.some((checkout) => checkout.waiting);
  const prefix = (member: Checkout) =>
    members.length > 1 && member.environmentLabel !== null ? `${member.environmentLabel}: ` : "";
  const custom = edited?.settings.custom ?? [];

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
      <SettingsRow
        title="Changes here apply to"
        description="All projects is everything on this machine. A project's own settings go over that, and over its .astrolabe/language-servers.json."
        control={
          <span className="flex items-center gap-2">
            {members.length > 1 ? (
              <Select
                value={String(editingIndex)}
                onValueChange={(value) => setEditingIndex(Number(value))}
              >
                <SelectTrigger size="sm" aria-label="Machine to change">
                  <SelectValue>
                    {(value: string | null) =>
                      members[Number(value)]?.environmentLabel ?? "This machine"
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  {members.map((member, index) => (
                    <SelectItem
                      key={`${member.environmentId}:${member.workspaceRoot}`}
                      value={String(index)}
                    >
                      {member.environmentLabel ?? "This machine"}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            ) : null}
            <Select
              value={scope}
              onValueChange={(value) => {
                if (value === "project" || value === "machine") setScope(value);
              }}
            >
              <SelectTrigger size="sm" aria-label="Changes here apply to">
                <SelectValue>
                  {(value: string | null) =>
                    value === "machine" ? "All projects" : "This project"
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem value="project">This project</SelectItem>
                <SelectItem value="machine">All projects</SelectItem>
              </SelectPopup>
            </Select>
          </span>
        }
      />
      {edited?.settingsProblem ? (
        <SettingsRow title="Settings can't be read" description={edited.settingsProblem} />
      ) : null}
      {edited?.projectFile.problem ? (
        <SettingsRow
          title={`${edited.projectFile.path} is ignored`}
          description={edited.projectFile.problem}
        />
      ) : null}
      {groups.flatMap((group) =>
        group.map((server, index) => (
          <SettingsRow
            key={server.server}
            title={server.companion === null ? server.languages : server.name}
            status={group.length > 1 && index === 0 ? "Runs first" : undefined}
            description={
              <span>
                {checkouts.map(({ member, trusted, checks, failed }) => {
                  const check = checks?.find((candidate) => candidate.server === server.server);
                  const inactive = check?.companion?.active === false;
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
                      {check?.companion?.active === true && !check.off ? (
                        <span className="block text-muted-foreground">
                          {check.companion.reason}
                        </span>
                      ) : null}
                      {check?.state === "found" && trusted === false && !inactive && !check.off ? (
                        <span className="block text-muted-foreground">
                          Runs restricted until this project is trusted.
                        </span>
                      ) : null}
                      {check?.message && !inactive && !check.off ? (
                        <span className="block text-muted-foreground">{check.message}</span>
                      ) : null}
                      {check !== undefined && check.replacedBy.length > 0 ? (
                        <span className="block text-muted-foreground">
                          {check.replacedBy.join(", ")} takes its place on some files.
                        </span>
                      ) : null}
                      {check !== undefined && check.overrides.length > 0 ? (
                        <span className="block text-muted-foreground">
                          {describeOverrides(check)}
                        </span>
                      ) : null}
                    </span>
                  );
                })}
              </span>
            }
            control={
              <ServerControls
                check={server}
                order={group.map(({ server: id }) => id)}
                disabled={!canEdit}
                open={configuring === server.server}
                onToggleOpen={() =>
                  setConfiguring(configuring === server.server ? null : server.server)
                }
                onEnabled={(enabled) =>
                  void change({ type: "enabled", scope, server: server.server, enabled })
                }
                onMove={(by) => {
                  if (server.language === null) return;
                  const order = moved(
                    group.flatMap(({ server: id }) => (isBuiltInLanguageServerId(id) ? [id] : [])),
                    server.server as BuiltInLanguageServerId,
                    by,
                  );
                  void change({ type: "order", scope, language: server.language, order });
                }}
              />
            }
          >
            {configuring === server.server && layer !== undefined && canEdit ? (
              <>
                <ServerForm
                  key={scope}
                  check={server}
                  override={layer.servers[server.server]}
                  custom={server.language === null}
                  onSave={(override) =>
                    void change({ type: "server", scope, server: server.server, override })
                  }
                />
                {server.language === null ? (
                  <div className="mt-2 flex justify-end gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setCustomForm(server.server as CustomLanguageServer["id"])}
                    >
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive-outline"
                      onClick={() => {
                        setConfiguring(null);
                        void change({
                          type: "removeCustom",
                          id: server.server as CustomLanguageServer["id"],
                        });
                      }}
                    >
                      Remove
                    </Button>
                  </div>
                ) : null}
              </>
            ) : null}
            {customForm === server.server ? (
              <CustomServerForm
                initial={customFormFields(custom.find(({ id }) => id === server.server)!)}
                onCancel={() => setCustomForm(null)}
                onSave={(fields) => {
                  setCustomForm(null);
                  void change({
                    type: "custom",
                    id: server.server as CustomLanguageServer["id"],
                    server: fields,
                  });
                }}
              />
            ) : null}
          </SettingsRow>
        )),
      )}
      {servers.length === 0 && !waiting ? (
        <SettingsRow title="Unavailable" description="This machine could not check its servers." />
      ) : null}
      {servers.length > 0 ? (
        <SettingsRow
          title="Add language server"
          description="Any language server that speaks LSP over stdio, for any file extension, on this machine. It needs no extension, and runs in trusted projects only."
          control={
            <Button
              size="sm"
              variant="outline"
              disabled={!canEdit}
              aria-expanded={customForm === "new"}
              onClick={() => setCustomForm(customForm === "new" ? null : "new")}
            >
              Add
            </Button>
          }
        >
          {customForm === "new" ? (
            <CustomServerForm
              initial={EMPTY_CUSTOM_FORM}
              onCancel={() => setCustomForm(null)}
              onSave={(fields) => {
                setCustomForm(null);
                void change({ type: "custom", id: null, server: fields });
              }}
            />
          ) : null}
        </SettingsRow>
      ) : null}
    </SettingsSection>
  );
}
