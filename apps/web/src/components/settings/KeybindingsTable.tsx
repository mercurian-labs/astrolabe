import type {
  KeybindingCommand,
  ResolvedKeybindingTrigger,
  ServerUpsertKeybindingInput,
} from "@t3tools/contracts";
import { EllipsisIcon, PlusIcon } from "lucide-react";
import { Fragment, useState, type ReactNode } from "react";

import { cn } from "~/lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  commandLabel,
  type KeybindingGroup,
  type KeybindingRow,
} from "./KeybindingsSettings.logic";
import {
  commandRowActions,
  KEYBINDING_KIND_LABELS,
  type KeybindingCommandRow,
  type KeybindingCommandRowChange,
  type KeybindingKind,
} from "./KeybindingsTable.logic";
import { TriggerBinding } from "./KeybindingTriggerRows";
import { SettingsSearchTarget, SettingsSection } from "./settingsLayout";
import { keybindingSearchAnchorId } from "./settingsSearch";

/**
 * Astrolabe: the Keybindings table: a section per command area, a row per command, and a column
 * per kind of trigger (Shortcut, Menu keys, Alias). A click on a binding edits it, and a cell's `+`
 * adds one of its kind; the row's `⋯` removes, resets, and restores. Upstream's own editors do the
 * shortcuts (`editors`). Narrow, the columns stack as labelled lines in the row.
 */

/** Focuses the key field in `node`, once, as it mounts. */
function focusKeyField(node: HTMLDivElement | null) {
  node?.querySelector<HTMLElement>("[data-keybinding-capture], input")?.focus();
}

/** A popover holding a key field, which takes focus as it opens so the keys pressed go to it. */
export function KeyFieldPopoverContent({ children }: { children: ReactNode }) {
  return (
    <PopoverContent align="start" width="lg" initialFocus={false}>
      <div ref={focusKeyField}>{children}</div>
    </PopoverContent>
  );
}

/** Upstream's shortcut editors, lent by the Keybindings page. */
export interface KeybindingsTableEditors {
  /** A shortcut's keycaps, which open upstream's row to change it. */
  readonly renderShortcut: (row: KeybindingRow) => ReactNode;
  /** Upstream's new-binding form, for one more binding of `kind` for `command`. */
  readonly renderAdd: (
    command: KeybindingCommand,
    kind: KeybindingKind,
    done: () => void,
  ) => ReactNode;
  /** The page's conflict glyph. */
  readonly renderConflict: (labels: ReadonlyArray<string>) => ReactNode;
}

interface KeybindingsTableProps {
  readonly groups: ReadonlyArray<KeybindingGroup<KeybindingCommandRow>>;
  readonly kinds: ReadonlyArray<KeybindingKind>;
  /** Every menu and alias trigger in effect. */
  readonly triggers: ReadonlyArray<ResolvedKeybindingTrigger>;
  readonly savingCommand: KeybindingCommand | null;
  /** The keyboard menu's chord, as its keycaps read: `⌘K`. */
  readonly chordLabel: string;
  readonly editors: KeybindingsTableEditors;
  readonly onSaveTriggers: (inputs: ReadonlyArray<ServerUpsertKeybindingInput>) => void;
  readonly onChange: (change: KeybindingCommandRowChange) => void;
}

/**
 * What a row is given: its command row and what every row shares, but not `groups`, which
 * changes with each search keystroke, so a row that stays visible keeps its props.
 */
type KeybindingRowViewProps = Omit<KeybindingsTableProps, "groups"> & {
  readonly row: KeybindingCommandRow;
};

/**
 * The grid at the table's full width: the command, a column per kind shown, and the `⋯`. The
 * shortcut column fits a key and `When !terminalFocus` under it beside the `+`.
 */
const GRID_COLUMNS = {
  all: "@min-[44rem]/keybindings:grid @min-[44rem]/keybindings:grid-cols-[minmax(0,1fr)_minmax(0,12rem)_minmax(0,10rem)_minmax(0,8rem)_1.75rem]",
  one: "@min-[44rem]/keybindings:grid @min-[44rem]/keybindings:grid-cols-[minmax(0,1fr)_minmax(0,18rem)_1.75rem]",
} as const;

const gridFor = (kinds: ReadonlyArray<KeybindingKind>) =>
  kinds.length > 1 ? GRID_COLUMNS.all : GRID_COLUMNS.one;

export function KeybindingsTable(props: KeybindingsTableProps) {
  const { groups, ...rowProps } = props;
  return (
    <div className="@container/keybindings flex flex-col gap-8">
      {groups.map((group) => (
        <SettingsSection key={group.id} id={`keybindings-${group.id}`} title={group.title}>
          <KeybindingsTableHeader kinds={rowProps.kinds} chordLabel={rowProps.chordLabel} />
          {group.rows.map((row) => (
            <KeybindingCommandRowView key={row.id} row={row} {...rowProps} />
          ))}
        </SettingsSection>
      ))}
    </div>
  );
}

/** The column names, at full width; narrow, each cell carries its own. */
function KeybindingsTableHeader({
  kinds,
  chordLabel,
}: {
  kinds: ReadonlyArray<KeybindingKind>;
  chordLabel: string;
}) {
  return (
    <div
      className={cn(
        "hidden items-center gap-3 px-3 py-1.5 text-xs text-muted-foreground sm:px-4",
        gridFor(kinds),
      )}
    >
      <span>Command</span>
      {kinds.map((kind) =>
        kind === "menu" ? (
          <Tooltip key={kind}>
            <TooltipTrigger
              render={
                <span
                  tabIndex={0}
                  className="w-fit rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                />
              }
            >
              {KEYBINDING_KIND_LABELS.menu}
              <span className="text-muted-foreground/60"> · after {chordLabel}</span>
            </TooltipTrigger>
            <TooltipPopup side="top">
              Keys pressed in the keyboard menu, after {chordLabel} or the leader key
            </TooltipPopup>
          </Tooltip>
        ) : (
          <span key={kind}>{KEYBINDING_KIND_LABELS[kind]}</span>
        ),
      )}
      <span />
    </div>
  );
}

function KeybindingCommandRowView({
  row,
  kinds,
  triggers,
  savingCommand,
  chordLabel,
  editors,
  onSaveTriggers,
  onChange,
}: KeybindingRowViewProps) {
  const isSaving = savingCommand === row.command;
  return (
    <SettingsSearchTarget
      id={keybindingSearchAnchorId(row.command)}
      className={cn(
        "group/row relative flex flex-col gap-1.5 px-3 py-2.5 outline-none sm:px-4 @min-[44rem]/keybindings:items-center @min-[44rem]/keybindings:gap-3 @min-[44rem]/keybindings:py-1.5",
        gridFor(kinds),
      )}
    >
      <div className="flex min-h-7 min-w-0 items-center gap-2 pe-8 text-sm font-medium @min-[44rem]/keybindings:pe-0">
        <Tooltip>
          <TooltipTrigger render={<span className="min-w-0 truncate" />}>
            {commandLabel(row.command)}
          </TooltipTrigger>
          <TooltipPopup side="top">{row.command}</TooltipPopup>
        </Tooltip>
        {row.badge ? (
          <Badge variant="outline" size="sm">
            {row.badge}
          </Badge>
        ) : null}
      </div>
      {kinds.map((kind) => (
        <KeybindingCell
          key={kind}
          kind={kind}
          row={row}
          triggers={triggers}
          isSaving={isSaving}
          chordLabel={chordLabel}
          editors={editors}
          onSaveTriggers={onSaveTriggers}
        />
      ))}
      <span className="absolute top-2.5 right-2 flex items-center opacity-0 transition-opacity group-focus-within/row:opacity-100 group-hover/row:opacity-100 has-data-popup-open:opacity-100 pointer-coarse:opacity-100 @min-[44rem]/keybindings:static">
        <KeybindingCommandRowMenu row={row} kinds={kinds} isSaving={isSaving} onChange={onChange} />
      </span>
    </SettingsSearchTarget>
  );
}

/** One kind's bindings for a command, joined by `|`, and the `+` that adds another. */
function KeybindingCell({
  row,
  kind,
  triggers,
  isSaving,
  chordLabel,
  editors,
  onSaveTriggers,
}: Pick<
  KeybindingRowViewProps,
  "row" | "triggers" | "chordLabel" | "editors" | "onSaveTriggers"
> & {
  readonly kind: KeybindingKind;
  readonly isSaving: boolean;
}) {
  const bindings: ReadonlyArray<{ id: string; node: ReactNode }> =
    kind === "shortcut"
      ? row.shortcuts.map((shortcut) => ({
          id: shortcut.id,
          node: (
            <span className="inline-flex min-w-0 max-w-full flex-col items-start">
              <span className="inline-flex items-center gap-0.5">
                {editors.renderShortcut(shortcut)}
                {editors.renderConflict(shortcut.conflicts)}
              </span>
              <ShortcutCondition when={shortcut.when} />
            </span>
          ),
        }))
      : row[kind].map((trigger) => ({
          id: trigger.id,
          node: (
            <TriggerBinding
              row={trigger}
              triggers={triggers}
              isSaving={isSaving}
              chordLabel={chordLabel}
              conflictWarning={editors.renderConflict}
              onSave={onSaveTriggers}
            />
          ),
        }));
  return (
    <div className="group/cell flex min-h-7 min-w-0 items-center gap-2">
      <span className="w-20 shrink-0 text-xs text-muted-foreground @min-[44rem]/keybindings:hidden">
        {KEYBINDING_KIND_LABELS[kind]}
      </span>
      {/* The `+` stays beside the bindings, not wrapped under a shortcut's condition. */}
      <div className="flex min-w-0 items-center gap-1">
        {bindings.length > 0 ? (
          <div className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5">
            {bindings.map(({ id, node }, index) => (
              <Fragment key={id}>
                {index > 0 ? (
                  <span aria-hidden className="text-muted-foreground">
                    |
                  </span>
                ) : null}
                {node}
              </Fragment>
            ))}
          </div>
        ) : null}
        <KeybindingAddButton
          row={row}
          kind={kind}
          empty={bindings.length === 0}
          disabled={isSaving}
          editors={editors}
        />
      </div>
    </div>
  );
}

/**
 * When a shortcut applies, under its keycaps, worded as upstream's rows: `When terminalFocus`, or
 * `Always`. A long condition is cut short; the editor its keycaps open shows it whole.
 */
function ShortcutCondition({ when }: { when: string }) {
  return (
    <span className="max-w-full truncate px-1 text-xs leading-4 text-muted-foreground/70">
      {when ? (
        <>
          When <span className="font-mono text-muted-foreground">{when}</span>
        </>
      ) : (
        "Always"
      )}
    </span>
  );
}

/** A cell's `+`, shown on hover (in an empty cell, in place of its dash); opens upstream's form. */
function KeybindingAddButton({
  row,
  kind,
  empty,
  disabled,
  editors,
}: {
  row: KeybindingCommandRow;
  kind: KeybindingKind;
  empty: boolean;
  disabled: boolean;
  editors: KeybindingsTableEditors;
}) {
  const [open, setOpen] = useState(false);
  const label = `Add ${KEYBINDING_KIND_LABELS[kind].toLowerCase()} for ${commandLabel(row.command)}`;
  return (
    <span className="relative inline-flex items-center">
      {empty ? (
        <span
          aria-hidden
          className="px-1 text-muted-foreground/60 group-focus-within/cell:invisible group-hover/cell:invisible"
        >
          —
        </span>
      ) : null}
      <span
        className={cn(
          "inline-flex opacity-0 transition-opacity group-focus-within/cell:opacity-100 group-hover/cell:opacity-100 has-data-popup-open:opacity-100 pointer-coarse:opacity-100",
          empty && "absolute start-0",
        )}
      >
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger
            render={
              <Button
                type="button"
                variant="ghost-muted"
                size="icon-xs"
                disabled={disabled}
                aria-label={label}
              />
            }
          >
            <PlusIcon className="size-3.5" />
          </PopoverTrigger>
          <KeyFieldPopoverContent>
            {open ? editors.renderAdd(row.command, kind, () => setOpen(false)) : null}
          </KeyFieldPopoverContent>
        </Popover>
      </span>
    </span>
  );
}

function KeybindingCommandRowMenu({
  row,
  kinds,
  isSaving,
  onChange,
}: {
  row: KeybindingCommandRow;
  kinds: ReadonlyArray<KeybindingKind>;
  isSaving: boolean;
  onChange: (change: KeybindingCommandRowChange) => void;
}) {
  const actions = commandRowActions(row, kinds, navigator.platform);
  if (actions.length === 0) return null;
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            type="button"
            variant="ghost-muted"
            size="icon-sm"
            disabled={isSaving}
            aria-label={`Actions for ${commandLabel(row.command)}`}
          />
        }
      >
        <EllipsisIcon className="size-3.5" />
      </MenuTrigger>
      <MenuPopup align="end">
        {actions.map((action) => (
          <MenuItem
            key={action.id}
            {...(action.destructive ? { variant: "destructive" as const } : {})}
            disabled={isSaving}
            onClick={() => onChange(action.change)}
          >
            {action.label}
          </MenuItem>
        ))}
      </MenuPopup>
    </Menu>
  );
}
