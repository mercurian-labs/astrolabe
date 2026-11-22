import { EyeIcon, EyeOffIcon, SquarePlus, Trash2Icon } from "lucide-react";
import { useState, useSyncExternalStore, type ReactNode } from "react";

import { ThreadsFilterCheckbox } from "~/components/projects/ThreadsFilterParts";
import { SidebarPickerAction, SidebarPickerFooter } from "~/components/sidebar/SidebarThreadHeader";
import {
  Combobox,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxSearchInput,
  ComboboxTrigger,
} from "~/components/ui/combobox";
import { Kbd } from "~/components/ui/kbd";
import { shortcutLabelForCommand } from "~/keybindings";
import { Toggle } from "~/components/ui/toggle";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useRightPanelStore } from "~/rightPanelStore";
import { parseChatTerminalKey } from "~/sectionTabs/sectionTabs";
import { endChatTerminals } from "./chatBridge";
import type { LinkedTab } from "./linkedTabs";
import { usePanesHost } from "./panesHost";
import { workspace } from "./workspace";

function subscribe(listener: () => void) {
  const stopPanes = workspace.store.subscribe(listener);
  const stopRecords = useRightPanelStore.subscribe(listener);
  return () => {
    stopPanes();
    stopRecords();
  };
}

/** The chat's linked tabs, through a string so the snapshot is stable between changes. */
function useLinkedTabs(owner: string): LinkedTab[] {
  const snapshot = useSyncExternalStore(subscribe, () =>
    workspace
      .linkedTabsOf(owner)
      .map((tab) => `${tab.shown ? "1" : "0"}${tab.key}`)
      .join("\n"),
  );
  if (snapshot === "") return [];
  return snapshot.split("\n").map((line) => ({ key: line.slice(1), shown: line[0] === "1" }));
}

interface LinkedTabsFilterProps {
  /** The chat whose header holds it, by tab key. */
  readonly owner: string;
  readonly available: boolean;
  readonly shortcutLabel: string | null;
  /**
   * T3 Code's right-panel toggle, which hides the tabs, or brings the hidden ones back where they
   * stood. Its shortcut does the same.
   */
  readonly onToggle: () => void;
}

/**
 * Astrolabe: the chat's one linked tabs control, where T3 Code's right-panel toggle stood. With no
 * linked tabs it opens a New linked tab at once. With some it opens a filter of them: ticking
 * shows a tab and unticking sets it aside, while its trash closes it for good.
 */
export function LinkedTabsFilter({
  owner,
  available,
  shortcutLabel,
  onToggle,
}: LinkedTabsFilterProps) {
  const tabs = useLinkedTabs(owner);
  // A terminal hidden with mod+j is no reason to trade the one-click button for a filter.
  if (tabs.some((tab) => tab.shown || parseChatTerminalKey(tab.key) === null)) {
    return (
      <TabsFilter
        owner={owner}
        tabs={tabs}
        available={available}
        shortcutLabel={shortcutLabel}
        onToggle={onToggle}
      />
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="flex shrink-0" />}>
        <Toggle
          className="shrink-0 [-webkit-app-region:no-drag]"
          pressed={false}
          onPressedChange={() => workspace.newLinkedTab(owner)}
          aria-label="New linked tab"
          data-new-linked-tab
          variant="ghost"
          size="sm"
          disabled={!available}
        >
          <SquarePlus className="size-4" />
        </Toggle>
      </TooltipTrigger>
      <TooltipPopup side="bottom">New linked tab</TooltipPopup>
    </Tooltip>
  );
}

function TabsFilter({
  owner,
  tabs,
  available,
  shortcutLabel,
  onToggle,
  trigger,
  align = "end",
}: LinkedTabsFilterProps & {
  readonly tabs: readonly LinkedTab[];
  /** What opens it, a `ComboboxTrigger` inside; the header's count by default. */
  readonly trigger?: (label: string) => ReactNode;
  readonly align?: "start" | "end";
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const showing = tabs.filter((tab) => tab.shown);
  const hiddenCount = tabs.length - showing.length;
  const label =
    hiddenCount === 0
      ? `Linked tabs (${tabs.length})`
      : `Linked tabs (${tabs.length}, ${hiddenCount} hidden)`;
  const toggle = (key: string) => {
    const shown = showing.some((tab) => tab.key === key);
    // The last one showing goes with its panel, which keeps it to bring back.
    if (shown && showing.length === 1 && parseChatTerminalKey(key) === null) onToggle();
    else workspace.setLinkedTabShown(owner, key, !shown);
  };
  const terminal = showing.find((tab) => parseChatTerminalKey(tab.key) !== null);
  const hideAll = () => {
    if (terminal) workspace.setLinkedTabShown(owner, terminal.key, false);
    if (showing.length > (terminal ? 1 : 0)) onToggle();
  };
  return (
    <Combobox<string, true>
      multiple
      items={tabs.map((tab) => tab.key)}
      autoHighlight
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
      value={showing.map((tab) => tab.key)}
      onValueChange={(next: string[]) => {
        const value =
          next.find((key) => !showing.some((tab) => tab.key === key)) ??
          showing.find((tab) => !next.includes(tab.key))?.key;
        if (value !== undefined) toggle(value);
      }}
      filter={null}
    >
      {trigger ? (
        trigger(label)
      ) : (
        <Tooltip>
          <TooltipTrigger render={<span className="flex shrink-0" />}>
            <ComboboxTrigger
              render={
                <Toggle
                  className="relative shrink-0 [-webkit-app-region:no-drag]"
                  pressed={showing.length > 0}
                  aria-label={label}
                  data-right-panel-toggle
                  variant="ghost"
                  size="sm"
                  disabled={!available}
                />
              }
            >
              <TabCount count={tabs.length} />
              {/* As a filter in force shows from its icon: some are not on screen. */}
              {hiddenCount > 0 ? (
                <span
                  aria-hidden
                  className="pointer-events-none absolute top-1 right-1 size-1.5 rounded-full bg-primary"
                />
              ) : null}
            </ComboboxTrigger>
          </TooltipTrigger>
          <TooltipPopup side="bottom">{label}</TooltipPopup>
        </Tooltip>
      )}
      <ComboboxPopup
        align={align}
        className="min-w-56 max-w-[min(18rem,var(--available-width))] overflow-hidden"
      >
        <ComboboxSearchInput
          aria-label="Search linked tabs"
          placeholder="Filter..."
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <ComboboxList>
          {tabs.map((tab) => (
            <LinkedTabRow key={tab.key} tab={tab} query={query} />
          ))}
        </ComboboxList>
        <SidebarPickerFooter>
          <SidebarPickerAction
            icon={SquarePlus}
            onClick={() => {
              setOpen(false);
              setQuery("");
              workspace.newLinkedTab(owner);
            }}
          >
            New linked tab
          </SidebarPickerAction>
          {hiddenCount > 0 ? (
            <SidebarPickerAction icon={EyeIcon} onClick={() => workspace.showAllLinkedTabs(owner)}>
              Show all
            </SidebarPickerAction>
          ) : null}
          {showing.length > 0 ? (
            <SidebarPickerAction icon={EyeOffIcon} onClick={hideAll}>
              <span className="flex flex-1 items-center justify-between gap-2">
                Hide all
                {/* The shortcut is the panel's: it leaves a terminal showing. */}
                {shortcutLabel && !terminal ? <Kbd>{shortcutLabel}</Kbd> : null}
              </span>
            </SidebarPickerAction>
          ) : null}
        </SidebarPickerFooter>
      </ComboboxPopup>
    </Combobox>
  );
}

/**
 * The chat's linked tabs menu from the chain mark on its own tab, which stays on screen while a
 * linked tab covers the chat (and its header's control) in the same pane. Only the chat in front
 * shows linked tabs, so its panel props are the ones the panes hold.
 */
export function LinkedTabsMarkMenu({
  owner,
  children,
}: {
  readonly owner: string;
  /** The mark: a `ComboboxTrigger` given the menu's label. */
  readonly children: (label: string) => ReactNode;
}) {
  const tabs = useLinkedTabs(owner);
  const panel = workspace.getPanel();
  if (tabs.length === 0) return null;
  return (
    <TabsFilter
      owner={owner}
      tabs={tabs}
      available
      shortcutLabel={panel ? shortcutLabelForCommand(panel.keybindings, "rightPanel.toggle") : null}
      onToggle={() => workspace.getPanel()?.onHide?.()}
      trigger={children}
      align="start"
    />
  );
}

/** A tab in the filter, under its own title and icon; only the tab knows its title. */
function LinkedTabRow({ tab, query }: { readonly tab: LinkedTab; readonly query: string }) {
  const { tabs } = usePanesHost();
  return (
    <tabs.Label tabKey={tab.key}>
      {({ title, icon }) =>
        title.toLowerCase().includes(query.trim().toLowerCase()) ? (
          <ComboboxItem hideIndicator selectedFill={false} value={tab.key}>
            <ThreadsFilterCheckbox checked={tab.shown} />
            <span className="flex size-4 shrink-0 items-center justify-center">{icon}</span>
            <span className="min-w-0 flex-1 truncate text-sm">{title}</span>
            <button
              type="button"
              aria-label={`Delete ${title}`}
              className="-me-1 inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
              onPointerDown={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                if (parseChatTerminalKey(tab.key) !== null) endChatTerminals(tab.key);
                else tabs.close(tab.key);
              }}
            >
              <Trash2Icon className="size-3.5" />
            </button>
          </ComboboxItem>
        ) : null
      }
    </tabs.Label>
  );
}

/** How many linked tabs, in lucide's square, so it sits in the header as its other icons. */
function TabCount({ count }: { readonly count: number }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      className="size-4"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <text
        x="12"
        y="16.5"
        textAnchor="middle"
        fontSize="12.5"
        fontWeight="600"
        fill="currentColor"
        stroke="none"
      >
        {count > 9 ? "9+" : count}
      </text>
    </svg>
  );
}
