import type {
  PlanModelDirective,
  PlanningModelSelection,
  ServerProvider,
} from "@t3tools/contracts";
import { CheckIcon, ChevronsUpDownIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { usePrimarySettings } from "../../hooks/useSettings";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import {
  Command,
  CommandGroup,
  CommandGroupLabel,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "../ui/command";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import {
  derivePlanModelPickerGroups,
  describePlanModelPickerChoice,
  FOLLOW_DEFAULT,
  serializePlanModelDirective,
  workspaceDefaultOptionLabel,
} from "./PlanModelPicker.logic";

export function PlanModelPicker({
  directive,
  workspaceDefault,
  providers,
  disabled = false,
  onChange,
}: {
  readonly directive: PlanModelDirective;
  readonly workspaceDefault: PlanningModelSelection | null;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly disabled?: boolean;
  readonly onChange: (directive: PlanModelDirective) => void;
}) {
  const settings = usePrimarySettings();
  const [open, setOpen] = useState(false);
  const groups = useMemo(
    () => derivePlanModelPickerGroups(providers, settings),
    [providers, settings],
  );
  const choice = useMemo(
    () => describePlanModelPickerChoice(directive, workspaceDefault, providers),
    [directive, providers, workspaceDefault],
  );

  const choose = (next: PlanModelDirective) => {
    onChange(next);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            aria-label="Planning model for this branch"
            className="min-w-0 max-w-52 shrink text-muted-foreground"
            disabled={disabled}
            size="sm"
            variant="ghost"
          >
            <span className="truncate">{choice.triggerLabel}</span>
            {choice.followsDefault ? (
              <span className="shrink-0 text-[10px] text-muted-foreground/60">default</span>
            ) : null}
            <ChevronsUpDownIcon className="size-3 shrink-0 opacity-50" />
          </Button>
        }
      />
      <PopoverPopup align="start" className="w-72 p-0">
        <Command autoHighlight={false} mode="none">
          <CommandList className="max-h-80">
            <CommandGroup>
              <CommandItem
                className={cn(
                  "cursor-pointer select-none gap-2",
                  directive._tag === "follow-default" && "text-foreground",
                )}
                value={serializePlanModelDirective(FOLLOW_DEFAULT)}
                onClick={() => choose(FOLLOW_DEFAULT)}
              >
                <CheckIcon
                  className={cn(
                    "size-3.5 shrink-0",
                    directive._tag === "follow-default" ? "" : "opacity-0",
                  )}
                />
                <span className="truncate">
                  {workspaceDefaultOptionLabel(workspaceDefault, providers)}
                </span>
              </CommandItem>
            </CommandGroup>
            <CommandSeparator className="my-0.5" />
            {groups.length === 0 ? (
              <p className="px-3 py-3 text-xs text-muted-foreground/70">
                No provider on this machine has models to offer.
              </p>
            ) : (
              groups.map((group) => (
                <CommandGroup key={group.provider}>
                  <CommandGroupLabel className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/55">
                    {group.label}
                  </CommandGroupLabel>
                  {group.options.map((option) => {
                    const selected =
                      directive._tag === "override" &&
                      directive.selection.provider === option.provider &&
                      directive.selection.model === option.model;
                    return (
                      <CommandItem
                        key={`${option.provider}:${option.model}`}
                        className={cn(
                          "cursor-pointer select-none gap-2",
                          selected && "text-foreground",
                        )}
                        value={serializePlanModelDirective({
                          _tag: "override",
                          selection: { provider: option.provider, model: option.model },
                        })}
                        onClick={() =>
                          choose({
                            _tag: "override",
                            selection: { provider: option.provider, model: option.model },
                          })
                        }
                      >
                        <CheckIcon
                          className={cn("size-3.5 shrink-0", selected ? "" : "opacity-0")}
                        />
                        <span className="truncate">{option.label}</span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              ))
            )}
            {choice.display.kind !== "unresolved" ? null : (
              <p className="border-t border-border/60 px-3 py-2 text-[11px] leading-snug text-amber-600 dark:text-amber-500">
                {choice.display.message}
              </p>
            )}
          </CommandList>
        </Command>
      </PopoverPopup>
    </Popover>
  );
}
