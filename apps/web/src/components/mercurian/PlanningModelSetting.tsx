import { type PlanningModelSelection, type ProviderDriverKind } from "@t3tools/contracts";
import { CheckIcon, ChevronsUpDownIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { cn } from "~/lib/utils";
import { usePlanningModel, useSetPlanningModel } from "../../state/mercurianWorkspace";
import { usePrimarySettings } from "../../hooks/useSettings";
import { SettingsRow } from "../settings/settingsLayout";
import { Button } from "../ui/button";
import { Command, CommandGroup, CommandGroupLabel, CommandItem, CommandList } from "../ui/command";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import {
  derivePlanningModelOptionGroups,
  describePlanningModel,
} from "./PlanningModelSetting.logic";

const DESCRIPTION =
  "The default new planning follows. It names a provider and a model — never one machine's account — and each machine runs it on its own instance of that provider.";

function AccentDot({ color }: { color: string | undefined }) {
  if (color === undefined) return null;
  return (
    <span
      aria-hidden="true"
      className="inline-block size-2 shrink-0 rounded-full"
      style={{ backgroundColor: color }}
    />
  );
}

/**
 * The workspace's planning model, chosen and shown where the instances it
 * resolves against live.
 *
 * Two things are deliberately separate here. The saved pair always renders
 * from the setting itself, so a machine with no matching instance still shows
 * the workspace what it chose. The line beneath it is this machine's answer —
 * which instance runs it, or why nothing does — and it never writes back.
 */
export function PlanningModelSetting() {
  // `providers` comes from the hook rather than the raw stream so the options
  // and the resolution below are computed from exactly the same snapshots.
  const { setting, resolution, providers, isPending, error } = usePlanningModel();
  const setPlanningModel = useSetPlanningModel();
  const settings = usePrimarySettings();
  const [isPickerOpen, setIsPickerOpen] = useState(false);

  const groups = useMemo(
    () => derivePlanningModelOptionGroups(providers, settings),
    [providers, settings],
  );
  const display = useMemo(
    () => describePlanningModel(setting, resolution, providers),
    [setting, resolution, providers],
  );

  const choose = (provider: ProviderDriverKind, model: string) => {
    setIsPickerOpen(false);
    void setPlanningModel({ provider, model } satisfies PlanningModelSelection);
  };

  const triggerLabel =
    display.kind === "unset"
      ? "Choose a model"
      : `${display.providerLabel} · ${display.modelLabel}`;

  const status = (() => {
    if (error !== null) return <span className="text-destructive">{error}</span>;
    if (isPending) return "Loading the workspace setting…";
    if (display.kind === "unset") {
      return "No planning model chosen yet.";
    }
    if (display.kind === "resolved") {
      return (
        <span className="inline-flex items-center gap-1.5">
          <AccentDot color={display.accentColor} />
          Runs on <span className="text-foreground/80">{display.instanceLabel}</span> on this
          machine.
        </span>
      );
    }
    return (
      <span className="text-amber-600 dark:text-amber-500">
        {display.message}
        {display.upgrade?.canUpdate === true
          ? " The update is one click away on that instance below."
          : ""}
      </span>
    );
  })();

  return (
    <SettingsRow
      id="mercurian-planning-model"
      title="Planning model"
      description={DESCRIPTION}
      status={status}
      control={
        <Popover open={isPickerOpen} onOpenChange={setIsPickerOpen}>
          <PopoverTrigger
            render={
              <Button
                variant="outline"
                size="sm"
                aria-label="Planning model"
                className="min-w-0 max-w-none shrink-0 justify-between gap-2 text-foreground/90 hover:text-foreground"
              >
                <span className="truncate">{triggerLabel}</span>
                <ChevronsUpDownIcon className="size-3.5 shrink-0 opacity-60" />
              </Button>
            }
          />
          <PopoverPopup align="end" className="w-72 p-0">
            <Command autoHighlight={false} mode="none">
              <CommandList className="max-h-80">
                {groups.length === 0 ? (
                  <p className="px-3 py-3 text-xs text-muted-foreground/70">
                    No provider on this machine has models to offer. Add an instance below, then
                    choose a model.
                  </p>
                ) : (
                  groups.map((group) => (
                    <CommandGroup key={group.provider}>
                      <CommandGroupLabel className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/55">
                        {group.label}
                      </CommandGroupLabel>
                      {group.options.map((option) => {
                        const isSelected =
                          setting?.provider === option.provider && setting.model === option.model;
                        return (
                          <CommandItem
                            key={`${option.provider}:${option.model}`}
                            value={`${option.provider}:${option.model}`}
                            className={cn(
                              "cursor-pointer select-none gap-2",
                              isSelected && "text-foreground",
                            )}
                            onClick={() => choose(option.provider, option.model)}
                          >
                            <CheckIcon
                              className={cn("size-3.5 shrink-0", isSelected ? "" : "opacity-0")}
                            />
                            <span className="truncate">{option.label}</span>
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  ))
                )}
              </CommandList>
            </Command>
          </PopoverPopup>
        </Popover>
      }
    />
  );
}
