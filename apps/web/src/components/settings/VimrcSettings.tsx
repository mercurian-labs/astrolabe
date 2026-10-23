import { useAtomValue } from "@effect/atom-react";
import {
  AuthOrchestrationOperateScope,
  type ServerSetVimOptionInput,
  type ServerUpsertVimMappingInput,
  type VimMapping,
  type VimMappingMode,
  type VimMappingTarget,
} from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import { isMacPlatform } from "@t3tools/shared/keybindings";
import {
  VIM_OPTION_DEFAULT_VALUES,
  vimrcMappings,
  vimrcOptions,
  type VimrcMappingRow,
} from "@t3tools/shared/vimrc";
import { Atom } from "effect/reactivity";
import { EllipsisIcon, PlusIcon, XIcon } from "lucide-react";
import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";

import { useOpenInPreferredEditor } from "~/editorPreferences";
import { serverEnvironment } from "~/state/server";
import { useEnvironmentScope } from "~/state/session";
import { useAtomCommand } from "~/state/use-atom-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Kbd, KbdGroup } from "../ui/kbd";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { NumberField, NumberFieldGroup, NumberFieldInput } from "../ui/number-field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { useSettingsScope } from "./SettingsScopeContext";
import { SettingResetButton, SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import {
  VIM_MAPPING_MODE_LABELS,
  vimKeycaps,
  vimKeyNotation,
  vimMappingDraftIssue,
} from "./VimrcSettings.logic";

/**
 * Astrolabe: Settings › Keybindings › Vim, the server's vimrc as controls: its key mappings, a row
 * each, and the three options worth a control. Each change rewrites only its own lines of the
 * file (the server keeps the rest), and goes to every environment the page edits, as keybindings
 * do; the file itself opens from the section's header. Lines the vimrc cannot apply are reported
 * in the keybindings toast, not here.
 */

const NO_GROUPING: Intl.NumberFormatOptions = { useGrouping: false };
const MODES: ReadonlyArray<VimMappingMode> = ["normal", "visual", "insert", "all"];

type Editing = { readonly row: VimrcMappingRow } | "new" | null;

export function VimrcSection() {
  const { environment: primaryEnvironment, connectedEnvironments } = useSettingsScope();
  const serverConfig = primaryEnvironment?.serverConfig;
  const text = serverConfig?.vimrc?.text ?? "";
  const supported = serverConfig?.vimrc !== undefined;
  const mappings = vimrcMappings(text);
  const options = vimrcOptions(text);
  const canWrite = useAtomValue(
    Atom.make(
      (get) =>
        connectedEnvironments.length > 0 &&
        connectedEnvironments.every((environment) =>
          get(serverEnvironment.upsertVimMapping.permissionAtom(environment.environmentId)),
        ),
    ),
  );
  const upsertMapping = useAtomCommand(serverEnvironment.upsertVimMapping, {
    reportFailure: false,
  });
  const removeMapping = useAtomCommand(serverEnvironment.removeVimMapping, {
    reportFailure: false,
  });
  const setOption = useAtomCommand(serverEnvironment.setVimOption, { reportFailure: false });
  const [editing, setEditing] = useState<Editing>(null);
  const [saving, setSaving] = useState(false);

  /** Runs one write on every environment the page edits, and says so if one fails. */
  const write = (
    run: (
      environmentId: (typeof connectedEnvironments)[number]["environmentId"],
    ) => Promise<AtomCommandResult<unknown, unknown>>,
    failure: string,
  ) => {
    if (!canWrite) return;
    setSaving(true);
    void (async () => {
      const results = await Promise.all(
        connectedEnvironments.map((environment) => run(environment.environmentId)),
      );
      setSaving(false);
      const failed = results.find((result) => result._tag === "Failure");
      if (!failed) {
        setEditing(null);
        return;
      }
      if (isAtomCommandInterrupted(failed)) return;
      const error = squashAtomCommandFailure(failed);
      toastManager.add({
        type: "error",
        title: failure,
        description: error instanceof Error ? error.message : "The vimrc was not changed.",
      });
    })();
  };
  const saveMapping = (input: ServerUpsertVimMappingInput) =>
    write((environmentId) => upsertMapping({ environmentId, input }), "Unable to save the mapping");
  const deleteMapping = (target: VimMappingTarget) =>
    write(
      (environmentId) => removeMapping({ environmentId, input: target }),
      "Unable to remove the mapping",
    );
  const saveOption = (input: ServerSetVimOptionInput) =>
    write((environmentId) => setOption({ environmentId, input }), "Unable to save the option");

  const disabled = !canWrite || !supported || saving;
  const pcre = options.pcre ?? VIM_OPTION_DEFAULT_VALUES.pcre;

  return (
    <SettingsSection
      {...searchableSetting("vim-configuration")}
      title="Vim"
      headerAction={
        <OpenVimrcButton
          environmentId={primaryEnvironment?.environmentId ?? null}
          configPath={serverConfig?.vimrcConfigPath ?? null}
          availableEditors={serverConfig?.availableEditors ?? []}
        />
      }
    >
      <SettingsRow
        title="Key mappings"
        description={
          supported
            ? "Keys that do something else in the composer's and notes' Vim, as in a vimrc."
            : "This server predates the vimrc. Update it to configure Vim here."
        }
        control={
          <Button
            size="sm"
            variant="outline"
            disabled={disabled || editing !== null}
            onClick={() => setEditing("new")}
          >
            <PlusIcon aria-hidden className="size-4" />
            Add
          </Button>
        }
      >
        {mappings.length > 0 || editing === "new" ? (
          <div className="flex flex-col pb-2">
            {mappings.map((row) =>
              editing !== null && editing !== "new" && sameTarget(editing.row, row) ? (
                <VimMappingEditor
                  key={`${row.mode}:${row.keys}`}
                  initial={row}
                  mappings={mappings}
                  editing={row}
                  isSaving={saving}
                  onSave={(mapping) =>
                    saveMapping({ ...mapping, replace: { mode: row.mode, keys: row.keys } })
                  }
                  onCancel={() => setEditing(null)}
                />
              ) : (
                <VimMappingRowView
                  key={`${row.mode}:${row.keys}`}
                  row={row}
                  disabled={disabled || editing !== null}
                  onEdit={() => setEditing({ row })}
                  onRemove={() => deleteMapping({ mode: row.mode, keys: row.keys })}
                />
              ),
            )}
            {editing === "new" ? (
              <VimMappingEditor
                initial={null}
                mappings={mappings}
                editing={null}
                isSaving={saving}
                onSave={saveMapping}
                onCancel={() => setEditing(null)}
              />
            ) : null}
          </div>
        ) : null}
      </SettingsRow>
      <SettingsRow
        title="Search patterns"
        description="How / and :s read a pattern: as a JavaScript regular expression, or as Vim's."
        resetAction={
          options.pcre !== undefined ? (
            <SettingResetButton
              label="search patterns"
              disabled={disabled}
              onClick={() => saveOption({ name: "pcre", value: null })}
            />
          ) : null
        }
        control={
          <Select
            value={pcre ? "javascript" : "vim"}
            disabled={disabled}
            onValueChange={(value) => {
              const next = value === "javascript";
              if (next !== pcre) saveOption({ name: "pcre", value: next });
            }}
          >
            <SelectTrigger size="sm" aria-label="Search patterns">
              <SelectValue>
                {(value: string) => (value === "javascript" ? "JavaScript" : "Vim")}
              </SelectValue>
            </SelectTrigger>
            <SelectContent align="end" alignItemWithTrigger={false}>
              <SelectItem value="javascript">JavaScript</SelectItem>
              <SelectItem value="vim">Vim</SelectItem>
            </SelectContent>
          </Select>
        }
      />
      <VimNumberOptionRow
        name="insertModeEscKeysTimeout"
        title="Escape key timeout"
        description="How long insert mode waits for the rest of a mapping such as jk, in milliseconds."
        value={options.insertModeEscKeysTimeout}
        min={0}
        max={10_000}
        unit="ms"
        disabled={disabled}
        onSave={(value) => saveOption({ name: "insertModeEscKeysTimeout", value })}
      />
    </SettingsSection>
  );
}

const sameTarget = (left: VimMappingTarget, right: VimMappingTarget) =>
  left.mode === right.mode && left.keys === right.keys;

/** Opens the vimrc file in the user's editor, as Keybindings opens keybindings.json. */
function OpenVimrcButton({
  environmentId,
  configPath,
  availableEditors,
}: {
  environmentId: Parameters<typeof useOpenInPreferredEditor>[0];
  configPath: string | null;
  availableEditors: Parameters<typeof useOpenInPreferredEditor>[1];
}) {
  const canOpen = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const openInEditor = useOpenInPreferredEditor(environmentId, availableEditors);
  return (
    <Button
      size="xs"
      variant="outline"
      disabled={!canOpen || configPath === null || availableEditors.length === 0}
      onClick={() => {
        if (configPath === null) return;
        void openInEditor(configPath).then((result) => {
          if (result._tag === "Success" || isAtomCommandInterrupted(result)) return;
          const error = squashAtomCommandFailure(result);
          toastManager.add({
            type: "error",
            title: "Unable to open vimrc",
            description: error instanceof Error ? error.message : "The vimrc was not opened.",
          });
        });
      }}
    >
      Open vimrc
    </Button>
  );
}

/** A mapping as the keybindings table shows a binding: its keycaps, and a `⋯` to change it. */
function VimMappingRowView({
  row,
  disabled,
  onEdit,
  onRemove,
}: {
  row: VimrcMappingRow;
  disabled: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const label = `${VIM_MAPPING_MODE_LABELS[row.mode]} ${row.keys}`;
  return (
    <div className="group/row flex min-h-9 items-center gap-3 rounded-md py-1">
      <span className="w-14 shrink-0 text-xs text-muted-foreground">
        {VIM_MAPPING_MODE_LABELS[row.mode]}
      </span>
      <VimKeycaps keys={row.keys} />
      <span aria-hidden className="text-muted-foreground">
        →
      </span>
      <code className="min-w-0 flex-1 truncate font-mono text-xs">{row.does}</code>
      {row.recursive ? <span className="text-xs text-muted-foreground/70">recursive</span> : null}
      <span className="opacity-0 transition-opacity group-focus-within/row:opacity-100 group-hover/row:opacity-100 has-data-popup-open:opacity-100 pointer-coarse:opacity-100">
        <Menu>
          <MenuTrigger
            render={
              <Button
                type="button"
                variant="ghost-muted"
                size="icon-sm"
                disabled={disabled}
                aria-label={`Actions for ${label}`}
              />
            }
          >
            <EllipsisIcon className="size-3.5" />
          </MenuTrigger>
          <MenuPopup align="end">
            <MenuItem disabled={disabled} onClick={onEdit}>
              Edit
            </MenuItem>
            <MenuItem variant="destructive" disabled={disabled} onClick={onRemove}>
              Remove
            </MenuItem>
          </MenuPopup>
        </Menu>
      </span>
    </div>
  );
}

function VimKeycaps({ keys }: { keys: string }) {
  // Keys repeat (`jj`): each repeat is keyed by its count so far.
  const seen = new Map<string, number>();
  const caps = vimKeycaps(keys).map((cap) => {
    const count = seen.get(cap) ?? 0;
    seen.set(cap, count + 1);
    return { cap, id: `${cap}:${count}` };
  });
  return (
    <KbdGroup>
      {caps.map(({ cap, id }) => (
        <Kbd key={id}>{cap}</Kbd>
      ))}
    </KbdGroup>
  );
}

/** A mapping's form, in its row's place (or after the rows for a new one). */
function VimMappingEditor({
  initial,
  mappings,
  editing,
  isSaving,
  onSave,
  onCancel,
}: {
  initial: VimMapping | null;
  mappings: ReadonlyArray<VimMappingTarget>;
  editing: VimMappingTarget | null;
  isSaving: boolean;
  onSave: (mapping: VimMapping) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<VimMapping>(
    () => initial ?? { mode: "normal", keys: "", does: "", recursive: false },
  );
  const issue = vimMappingDraftIssue(draft, mappings, editing);
  const touched = draft.keys !== "" || draft.does !== "";
  const save = () => {
    if (issue === null && !isSaving) onSave({ ...draft, does: draft.does.trim() });
  };
  return (
    <div className="flex flex-col gap-1.5 rounded-lg bg-muted/15 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={draft.mode}
          onValueChange={(value) => {
            const mode = MODES.find((candidate) => candidate === value);
            if (mode) setDraft({ ...draft, mode });
          }}
        >
          <SelectTrigger size="sm" aria-label="Mode" className="w-28">
            <SelectValue>{(value: VimMappingMode) => VIM_MAPPING_MODE_LABELS[value]}</SelectValue>
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            {MODES.map((mode) => (
              <SelectItem key={mode} value={mode}>
                {VIM_MAPPING_MODE_LABELS[mode]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <VimKeysInput
          value={draft.keys}
          onChange={(keys) => setDraft({ ...draft, keys })}
          onDone={save}
        />
        <span aria-hidden className="text-muted-foreground">
          →
        </span>
        <Input
          aria-label="Does"
          placeholder="Keys it sends: <Esc>"
          size="sm"
          font="mono"
          className="w-44"
          spellCheck={false}
          autoCapitalize="none"
          value={draft.does}
          onChange={(event) => setDraft({ ...draft, does: event.currentTarget.value })}
          onKeyDown={(event) => {
            if (event.key === "Enter") save();
          }}
        />
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Switch
            size="sm"
            checked={draft.recursive}
            onCheckedChange={(recursive) => setDraft({ ...draft, recursive })}
          />
          Recursive
        </label>
        <Button size="sm" disabled={isSaving || issue !== null} onClick={save}>
          {isSaving ? "Saving" : "Save"}
        </Button>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost-muted"
                size="icon-sm"
                disabled={isSaving}
                aria-label="Cancel"
                onClick={onCancel}
              />
            }
          >
            <XIcon className="size-3.5" />
          </TooltipTrigger>
          <TooltipPopup side="top">Cancel</TooltipPopup>
        </Tooltip>
      </div>
      <p
        className={
          issue && touched ? "text-xs text-destructive" : "text-xs text-muted-foreground/80"
        }
      >
        {issue && touched
          ? issue
          : "Press the keys, or type them in Vim notation (<C-d>, <Space>). Recursive maps what it sends again."}
      </p>
    </div>
  );
}

/**
 * A mapping's keys: typed as text, while a press Vim names in brackets (Ctrl or Alt held, Space,
 * F-keys) goes in as its notation at the caret. Enter is `onDone`.
 */
function VimKeysInput({
  value,
  onChange,
  onDone,
}: {
  value: string;
  onChange: (value: string) => void;
  onDone: () => void;
}) {
  const [mac] = useState(() => isMacPlatform(navigator.platform));
  const input = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (caret.current === null) return;
    input.current?.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  });
  const record = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && !event.ctrlKey && !event.altKey) {
      onDone();
      return;
    }
    const notation = vimKeyNotation(event, { mac });
    if (notation === null) return;
    event.preventDefault();
    const field = event.currentTarget;
    const start = field.selectionStart ?? value.length;
    const end = field.selectionEnd ?? value.length;
    caret.current = start + notation.length;
    onChange(`${value.slice(0, start)}${notation}${value.slice(end)}`);
  };
  return (
    <Input
      ref={input}
      autoFocus
      aria-label="Keys"
      placeholder="Press keys: jk"
      size="sm"
      font="mono"
      className="w-36"
      spellCheck={false}
      autoCapitalize="none"
      value={value}
      onChange={(event) => onChange(event.currentTarget.value.replace(/\s/gu, ""))}
      onKeyDown={record}
    />
  );
}

/** A number option: its value, or the default when the vimrc does not set it. */
function VimNumberOptionRow({
  name,
  title,
  description,
  value,
  min,
  max,
  unit,
  disabled,
  onSave,
}: {
  name: "insertModeEscKeysTimeout";
  title: string;
  description: string;
  value: number | boolean | undefined;
  min: number;
  max: number;
  unit?: string;
  disabled: boolean;
  onSave: (value: number | null) => void;
}) {
  const current = typeof value === "number" ? value : VIM_OPTION_DEFAULT_VALUES[name];
  return (
    <SettingsRow
      title={title}
      description={description}
      resetAction={
        value !== undefined ? (
          <SettingResetButton
            label={title.toLowerCase()}
            disabled={disabled}
            onClick={() => onSave(null)}
          />
        ) : null
      }
      control={
        <div className="flex items-center gap-1.5">
          <NumberField
            value={current}
            min={min}
            max={max}
            step={1}
            disabled={disabled}
            format={NO_GROUPING}
            size="sm"
            className="w-24"
            onValueCommitted={(next) => {
              if (next === null || !Number.isInteger(next)) return;
              // A typed value can sit outside min and max; the server would refuse it.
              const clamped = Math.min(max, Math.max(min, next));
              if (clamped !== current) onSave(clamped);
            }}
          >
            <NumberFieldGroup>
              <NumberFieldInput aria-label={title} />
            </NumberFieldGroup>
          </NumberField>
          {unit ? <span className="text-xs text-muted-foreground">{unit}</span> : null}
        </div>
      }
    />
  );
}
