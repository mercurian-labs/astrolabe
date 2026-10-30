import { FILE_GRAPH_RANGES, GROUP_SLOTS, type FileGraphRangeKey } from "@mercurian/graph/file";
import { ChevronRightIcon, RotateCcwIcon, SearchIcon, XIcon } from "lucide-react";
import { useId, type CSSProperties, type ReactNode } from "react";

import { cn } from "~/lib/utils";
import { LENS_COLORS } from "../graph/atlasColors";
import { Button } from "../ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { Input } from "../ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import { Switch } from "../ui/switch";
import type { LocalGraphOptions, LocalGraphPanel as PanelState } from "./localGraphData";
import { RepositoryTabHeader } from "./RepositoryTabHeader";

type Range = { readonly min: number; readonly max: number; readonly step: number };

const DEPTH_RANGE: Range = { min: 1, max: 3, step: 1 };

/** A value as Obsidian's panel says it: whole steps whole, the rest to two places. */
const formatValue = (value: number, range: Range) =>
  range.step >= 1 ? String(Math.round(value)) : value.toFixed(2);

/**
 * Astrolabe: a local graph's settings, floating in its top-right corner as Obsidian's graph
 * controls do: Filters (search, depth, what shows), Groups (a path query and a colour), Display
 * and Forces, each a section that folds. Everything but the search is kept on the device.
 */
export function LocalGraphPanel({
  options,
  onChange,
  search,
  onSearch,
  usedByLabel,
  dependencies,
  onAnimate,
  onReset,
  onClose,
}: {
  readonly options: LocalGraphOptions;
  readonly onChange: (next: LocalGraphOptions) => void;
  readonly search: string;
  readonly onSearch: (search: string) => void;
  /** "Used by", or how far the index has got while it is first built. */
  readonly usedByLabel: string;
  /** The outside packages the graph reaches, or null before it is read. */
  readonly dependencies: number | null;
  readonly onAnimate: () => void;
  readonly onReset: () => void;
  readonly onClose: () => void;
}) {
  const { panel, settings } = options;
  const section = (key: Exclude<keyof PanelState, "open">) => ({
    open: panel[key],
    onOpenChange: (open: boolean) => onChange({ ...options, panel: { ...panel, [key]: open } }),
  });
  const setting = (key: FileGraphRangeKey) => ({
    value: settings[key],
    range: FILE_GRAPH_RANGES[key],
    onChange: (value: number) => onChange({ ...options, settings: { ...settings, [key]: value } }),
  });
  const groups = options.groups;
  const setGroups = (next: LocalGraphOptions["groups"]) => onChange({ ...options, groups: next });

  return (
    <div className="pointer-events-none absolute inset-2 z-10 flex items-start justify-end">
      <div
        role="region"
        aria-label="Graph settings"
        className="pointer-events-auto max-h-full w-60 overflow-y-auto rounded-lg border border-border bg-popover text-xs text-popover-foreground shadow-md"
      >
        <Section
          title="Filters"
          {...section("filters")}
          accessory={
            <>
              <RepositoryTabHeader.Action label="Restore default settings" onClick={onReset}>
                <RotateCcwIcon />
              </RepositoryTabHeader.Action>
              <RepositoryTabHeader.Action label="Close graph settings" onClick={onClose}>
                <XIcon />
              </RepositoryTabHeader.Action>
            </>
          }
        >
          <InputGroup>
            <InputGroupAddon>
              <SearchIcon aria-hidden />
            </InputGroupAddon>
            <InputGroupInput
              aria-label="Search files"
              placeholder="Search files..."
              size="sm"
              type="search"
              value={search}
              onChange={(event) => onSearch(event.currentTarget.value)}
            />
          </InputGroup>
          <SliderRow
            label="Depth"
            value={options.depth}
            range={DEPTH_RANGE}
            onChange={(value) => {
              if (value === 1 || value === 2 || value === 3) onChange({ ...options, depth: value });
            }}
          />
          <SwitchRow
            label="Uses"
            checked={options.uses}
            onChange={(uses) => onChange({ ...options, uses })}
          />
          <SwitchRow
            label={usedByLabel}
            checked={options.usedBy}
            onChange={(usedBy) => onChange({ ...options, usedBy })}
          />
          <SwitchRow
            label="Tests"
            checked={options.tests}
            onChange={(tests) => onChange({ ...options, tests })}
          />
          <SwitchRow
            label={dependencies === null ? "Dependencies" : `Dependencies · ${dependencies}`}
            checked={options.dependencies}
            onChange={(next) => onChange({ ...options, dependencies: next })}
          />
        </Section>
        <Section title="Groups" {...section("groups")}>
          {groups.map((group, at) => (
            // Groups have no ids: they are their place in the list.
            // oxlint-disable-next-line react/no-array-index-key
            <div key={at} className="flex flex-col gap-1.5">
              <div className="flex items-center gap-1">
                <Input
                  aria-label={`Group ${at + 1} query`}
                  className="min-w-0 flex-1"
                  placeholder="Path, such as packages/"
                  size="sm"
                  value={group.query}
                  onChange={(event) =>
                    setGroups(
                      groups.map((each, index) =>
                        index === at ? { ...each, query: event.currentTarget.value } : each,
                      ),
                    )
                  }
                />
                <RepositoryTabHeader.Action
                  label={`Remove group ${at + 1}`}
                  onClick={() => setGroups(groups.filter((_, index) => index !== at))}
                >
                  <XIcon />
                </RepositoryTabHeader.Action>
              </div>
              <div role="radiogroup" aria-label={`Group ${at + 1} colour`} className="flex gap-1.5">
                {LENS_COLORS.map((color, slot) => (
                  <button
                    key={color.name}
                    type="button"
                    role="radio"
                    aria-checked={group.color === slot}
                    aria-label={color.name}
                    className={cn(
                      "size-4 cursor-pointer rounded-full outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                      group.color === slot && "ring-2 ring-inset ring-foreground/70",
                    )}
                    style={{ background: color.css }}
                    onClick={() =>
                      setGroups(
                        groups.map((each, index) =>
                          index === at ? { ...each, color: slot } : each,
                        ),
                      )
                    }
                  />
                ))}
              </div>
            </div>
          ))}
          <Button
            className="w-full"
            size="xs"
            variant="secondary"
            onClick={() =>
              setGroups([...groups, { query: "", color: groups.length % GROUP_SLOTS }])
            }
          >
            New group
          </Button>
        </Section>
        <Section title="Display" {...section("display")}>
          <SwitchRow
            label="Arrows"
            checked={settings.arrows}
            onChange={(arrows) => onChange({ ...options, settings: { ...settings, arrows } })}
          />
          <SliderRow label="Text fade threshold" {...setting("textFade")} />
          <SliderRow label="Node size" {...setting("nodeSize")} />
          <SliderRow label="Link thickness" {...setting("linkThickness")} />
          <div className="flex justify-end">
            <Button size="xs" variant="secondary" onClick={onAnimate}>
              Animate
            </Button>
          </div>
        </Section>
        <Section title="Forces" {...section("forces")}>
          <SliderRow label="Center force" {...setting("centerForce")} />
          <SliderRow label="Repel force" {...setting("repelForce")} />
          <SliderRow label="Link force" {...setting("linkForce")} />
          <SliderRow label="Link distance" {...setting("linkDistance")} />
        </Section>
      </div>
    </div>
  );
}

function Section({
  title,
  open,
  onOpenChange,
  accessory = null,
  children,
}: {
  readonly title: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly accessory?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <div className="border-b border-border last:border-b-0">
      <Collapsible open={open} onOpenChange={onOpenChange}>
        <div className="flex h-8 items-center gap-0.5 ps-1.5 pe-1">
          <CollapsibleTrigger className="flex h-6 min-w-0 flex-1 items-center gap-1 rounded-sm text-xs font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
            <ChevronRightIcon
              aria-hidden
              className={cn(
                "size-3.5 shrink-0 text-muted-foreground transition-transform",
                open && "rotate-90",
              )}
            />
            {title}
          </CollapsibleTrigger>
          {accessory}
        </div>
        <CollapsiblePanel>
          <div className="flex flex-col gap-2.5 px-3 pt-0.5 pb-3">{children}</div>
        </CollapsiblePanel>
      </Collapsible>
    </div>
  );
}

function SwitchRow({
  label,
  checked,
  onChange,
}: {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-2">
      <label htmlFor={id} className="min-w-0 truncate">
        {label}
      </label>
      <Switch id={id} size="sm" checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

/** A slider as Obsidian's panel has one: its name, then its value beside the track. */
function SliderRow({
  label,
  value,
  range,
  onChange,
}: {
  readonly label: string;
  readonly value: number;
  readonly range: Range;
  readonly onChange: (value: number) => void;
}) {
  const id = useId();
  const ratio = (value - range.min) / (range.max - range.min);
  const progress = {
    "--settings-slider-progress": `${ratio * 100}%`,
    "--settings-slider-fill-offset": `${0.5 - ratio}rem`,
  } as CSSProperties;
  return (
    <div className="flex flex-col gap-0.5">
      <label htmlFor={id}>{label}</label>
      <div className="flex items-center gap-2">
        <output htmlFor={id} className="w-9 shrink-0 tabular-nums text-muted-foreground">
          {formatValue(value, range)}
        </output>
        <input
          id={id}
          className="settings-slider min-w-0 flex-1"
          max={range.max}
          min={range.min}
          step={range.step}
          style={progress}
          type="range"
          value={value}
          onChange={(event) => {
            const next = Number(event.currentTarget.value);
            if (Number.isFinite(next)) onChange(next);
          }}
        />
      </div>
    </div>
  );
}
