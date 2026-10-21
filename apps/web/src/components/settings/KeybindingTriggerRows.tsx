import type { ResolvedKeybindingTrigger, ServerUpsertKeybindingInput } from "@t3tools/contracts";
import { formatMenuKeys, parseMenuKeys } from "@t3tools/shared/keybindingTriggers";
import { useState, type KeyboardEvent, type ReactNode } from "react";

import { leaderKeyLabel } from "~/whichKey/leader";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Kbd, KbdGroup } from "../ui/kbd";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { commandLabel } from "./KeybindingsSettings.logic";
import {
  TRIGGER_KIND_LABELS,
  triggerDraftConflicts,
  triggerDraftIssue,
  triggerEditInputs,
  type KeybindingTriggerKind,
  type KeybindingTriggerRow,
} from "./KeybindingTriggerSettings.logic";

/**
 * Astrolabe: the Keybindings table's menu keys and aliases: their keycaps, the field that records
 * one, and the popover a click on one opens to change it.
 */

/** Menu keys or an alias as keycaps: `t` `]`, or `q[uit]`. */
export function TriggerPill({ row }: { row: KeybindingTriggerRow }) {
  if (row.trigger.kind === "alias") return <Kbd>{row.label}</Kbd>;
  // Keys repeat (`menu g g`): each repeat is keyed by its count so far.
  const seen = new Map<string, number>();
  const caps = row.trigger.sequence.map((key) => {
    const label = leaderKeyLabel(key);
    const count = seen.get(label) ?? 0;
    seen.set(label, count + 1);
    return { label, id: `${label}:${count}` };
  });
  return (
    <KbdGroup>
      {caps.map(({ label, id }) => (
        <Kbd key={id}>{label}</Kbd>
      ))}
    </KbdGroup>
  );
}

/**
 * The key field for a trigger, holding the rule's key (`menu t ]`, `:q[uit]`). An alias is typed
 * without its colon; menu keys are recorded, each plain key pressed appended, Backspace taking the
 * last back. Enter is `onDone`; Escape leaves the field as it is.
 */
export function TriggerKeyInput({
  kind,
  value,
  ariaLabel,
  autoFocus = false,
  className,
  onChange,
  onDone,
}: {
  kind: KeybindingTriggerKind;
  value: string;
  ariaLabel: string;
  autoFocus?: boolean;
  className?: string | undefined;
  onChange: (value: string) => void;
  onDone?: () => void;
}) {
  if (kind === "alias") {
    return (
      <Input
        autoFocus={autoFocus}
        aria-label={ariaLabel}
        value={value.replace(/^:/, "")}
        placeholder="name[tail]"
        size="sm"
        font="mono"
        className={className}
        onChange={(event) => {
          const text = event.currentTarget.value.trim().replace(/^:/, "");
          onChange(text === "" ? "" : `:${text}`);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") onDone?.();
        }}
      />
    );
  }
  const sequence = parseMenuKeys(value) ?? [];
  const record = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Tab") return;
    event.preventDefault();
    if (event.key === "Enter") {
      onDone?.();
      return;
    }
    if (event.key === "Escape") {
      event.currentTarget.blur();
      return;
    }
    if (event.key === "Backspace") {
      onChange(sequence.length > 1 ? formatMenuKeys(sequence.slice(0, -1)) : "");
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (Array.from(event.key).length !== 1) return;
    onChange(formatMenuKeys([...sequence, event.key]));
  };
  return (
    <Input
      data-keybinding-capture=""
      autoFocus={autoFocus}
      aria-label={ariaLabel}
      value={sequence.map(leaderKeyLabel).join(" ")}
      placeholder="Press keys"
      size="sm"
      font="mono"
      className={className}
      onChange={() => {}}
      onKeyDown={record}
    />
  );
}

/** Menu keys or an alias in its cell: its keycaps, which open a popover to change them. */
export function TriggerBinding({
  row,
  triggers,
  isSaving,
  chordLabel,
  conflictWarning,
  onSave,
}: {
  row: KeybindingTriggerRow;
  /** Every trigger in effect, to warn of a change that collides with another command's. */
  triggers: ReadonlyArray<ResolvedKeybindingTrigger>;
  isSaving: boolean;
  /** The keyboard menu's chord, as its keycaps read: `⌘K`. */
  chordLabel: string;
  /** The page's conflict glyph, for the labels a binding collides with. */
  conflictWarning: (labels: ReadonlyArray<string>) => ReactNode;
  onSave: (inputs: ReadonlyArray<ServerUpsertKeybindingInput>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(row.key);
  const kindLabel = TRIGGER_KIND_LABELS[row.kind];
  const label = commandLabel(row.command);
  if (row.source === "Removed") {
    return (
      <span className="px-1 font-mono text-xs text-muted-foreground line-through">
        <span className="sr-only">Removed default: </span>
        {row.label}
      </span>
    );
  }
  const issue = triggerDraftIssue(row.kind, draft);
  const dirty = draft.trim() !== row.key;
  const save = () => {
    if (!dirty || issue !== null) return;
    onSave(triggerEditInputs(row, draft));
    setOpen(false);
  };
  return (
    <span className="inline-flex items-center gap-0.5">
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) setDraft(row.key);
        }}
      >
        <PopoverTrigger
          render={
            <button
              type="button"
              aria-label={`Edit ${kindLabel.toLowerCase()} for ${label}: ${row.label}`}
              className="inline-flex h-7 cursor-pointer items-center rounded-md border border-transparent px-1 outline-none transition-colors hover:border-border/70 hover:bg-accent focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/24 data-popup-open:bg-accent"
            />
          }
        >
          <TriggerPill row={row} />
        </PopoverTrigger>
        <PopoverContent align="start" width="md">
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">
              {kindLabel}: {label}
            </p>
            <div className="flex items-center gap-2">
              <TriggerKeyInput
                kind={row.kind}
                value={draft}
                ariaLabel={`${kindLabel} for ${label}`}
                autoFocus
                className="min-w-0 flex-1"
                onChange={setDraft}
                onDone={save}
              />
              {conflictWarning(dirty ? triggerDraftConflicts(triggers, row.command, draft) : [])}
              <Button size="sm" disabled={isSaving || !dirty || issue !== null} onClick={save}>
                {isSaving ? "Saving" : "Save"}
              </Button>
            </div>
            <p
              className={
                issue && dirty ? "text-xs text-destructive" : "text-xs text-muted-foreground"
              }
            >
              {issue && dirty
                ? issue
                : row.kind === "menu"
                  ? `Press the keys, as after ${chordLabel} or the leader key. Backspace takes one back.`
                  : "Type it without a colon; a tail in brackets is optional: q[uit]."}
            </p>
          </div>
        </PopoverContent>
      </Popover>
      {conflictWarning(row.conflicts)}
    </span>
  );
}
