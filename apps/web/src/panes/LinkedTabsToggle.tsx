import { SquareMinus, SquarePlus } from "lucide-react";
import { useSyncExternalStore } from "react";

import { Kbd } from "~/components/ui/kbd";
import { Toggle } from "~/components/ui/toggle";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useRightPanelStore } from "~/rightPanelStore";
import type { LinkedToggle } from "./linkedTabs";
import { workspace } from "./workspace";

function subscribe(listener: () => void) {
  const stopPanes = workspace.store.subscribe(listener);
  const stopRecords = useRightPanelStore.subscribe(listener);
  return () => {
    stopPanes();
    stopRecords();
  };
}

/** The chat's toggle as its kind and hidden count, stable between changes. */
function useLinkedToggle(owner: string): LinkedToggle["kind"] | number {
  return useSyncExternalStore(subscribe, () => {
    const toggle = workspace.toggleOf(owner);
    return toggle.kind === "hidden" ? toggle.tabs.length : toggle.kind;
  });
}

interface LinkedTabsToggleProps {
  /** The chat whose header holds them, by tab key. */
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
 * Astrolabe: the chat's linked tabs controls, where T3 Code's right-panel toggle stood. A New
 * linked tab button, always; and with linked tabs, a toggle hiding them, or with them hidden,
 * their count, which brings them all back. Hidden tabs are set aside, not closed: each tab's ✕
 * closes it for good.
 */
export function LinkedTabsToggle({
  owner,
  available,
  shortcutLabel,
  onToggle,
}: LinkedTabsToggleProps) {
  const toggle = useLinkedToggle(owner);
  const hidden = typeof toggle === "number" ? toggle : 0;
  const showing = toggle === "showing";
  const label = showing ? "Hide tabs" : `Show tabs (${hidden} hidden)`;
  return (
    <>
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
      {toggle === "none" ? null : (
        <Tooltip>
          <TooltipTrigger render={<span className="flex shrink-0" />}>
            <Toggle
              className="shrink-0 [-webkit-app-region:no-drag]"
              pressed={showing}
              onPressedChange={onToggle}
              aria-label={label}
              data-right-panel-toggle
              variant="ghost"
              size="sm"
              disabled={!available}
            >
              {showing ? <SquareMinus className="size-4" /> : <HiddenCount count={hidden} />}
            </Toggle>
          </TooltipTrigger>
          <TooltipPopup side="bottom">
            <span className="flex items-center gap-2">
              {label}
              {shortcutLabel ? <Kbd>{shortcutLabel}</Kbd> : null}
            </span>
          </TooltipPopup>
        </Tooltip>
      )}
    </>
  );
}

/** How many tabs are hidden, in lucide's square, so it sits in the header as its other icons. */
function HiddenCount({ count }: { count: number }) {
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
