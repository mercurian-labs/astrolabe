import { SquareMinus, SquarePlus } from "lucide-react";
import { useState, useSyncExternalStore, type ReactNode } from "react";

import { Kbd } from "~/components/ui/kbd";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuTrigger,
} from "~/components/ui/menu";
import { Toggle } from "~/components/ui/toggle";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useRightPanelStore } from "~/rightPanelStore";
import type { LinkedToggle } from "./linkedTabs";
import { workspace } from "./workspace";
import { useTabLabel } from "./workspaceTabs";

function subscribe(listener: () => void) {
  const stopPanes = workspace.store.subscribe(listener);
  const stopRecords = useRightPanelStore.subscribe(listener);
  return () => {
    stopPanes();
    stopRecords();
  };
}

/** The chat's toggle as a string, stable between changes, read back into its state. */
function useLinkedToggle(owner: string): LinkedToggle {
  const key = useSyncExternalStore(subscribe, () => {
    const toggle = workspace.toggleOf(owner);
    return toggle.kind === "hidden" ? ["hidden", ...toggle.tabs].join("\n") : toggle.kind;
  });
  const [kind, ...tabs] = key.split("\n");
  return kind === "hidden" ? { kind, tabs } : { kind: kind === "showing" ? "showing" : "none" };
}

interface LinkedTabsToggleProps {
  /** The chat whose header holds it, by tab key. */
  readonly owner: string;
  readonly available: boolean;
  readonly shortcutLabel: string | null;
  /**
   * T3 Code's right-panel toggle, which hides the tabs, or shows them: the hidden ones back where
   * they stood, else an empty panel's launcher. Its shortcut does the same.
   */
  readonly onToggle: () => void;
}

/**
 * Astrolabe: the chat's linked tabs toggle, where T3 Code's right-panel toggle stood, as ChatGPT's
 * is: with none, a new tab; with some hidden, their count and a menu bringing them back; with them
 * showing, hiding them. Hidden tabs are set aside, not closed: each tab's ✕ closes it for good.
 * The shortcut skips the menu and brings them all back, so pressing it twice hides and restores.
 */
export function LinkedTabsToggle({
  owner,
  available,
  shortcutLabel,
  onToggle,
}: LinkedTabsToggleProps) {
  const toggle = useLinkedToggle(owner);
  const [menuOpen, setMenuOpen] = useState(false);

  if (toggle.kind === "hidden") {
    const bringBack = (key: string | null) => {
      setMenuOpen(false);
      workspace.showLinked(owner, key);
    };
    return (
      <Menu open={menuOpen} onOpenChange={setMenuOpen}>
        <Tooltip>
          <TooltipTrigger
            render={
              <MenuTrigger
                render={
                  <Toggle
                    className="shrink-0 [-webkit-app-region:no-drag]"
                    pressed={false}
                    aria-label={`Open tabs (${toggle.tabs.length} hidden)`}
                    data-right-panel-toggle
                    variant="ghost"
                    size="sm"
                    disabled={!available}
                  />
                }
              />
            }
          >
            <HiddenCount count={toggle.tabs.length} />
          </TooltipTrigger>
          <TooltipPopup side="bottom">
            <ShortcutTip label="Open tabs" shortcut={shortcutLabel} />
          </TooltipPopup>
        </Tooltip>
        <MenuPopup align="end" side="bottom" sideOffset={6}>
          <MenuGroup>
            <MenuGroupLabel>Open tabs</MenuGroupLabel>
            {toggle.tabs.map((key) => (
              <HiddenTabItem key={key} tabKey={key} onPick={() => bringBack(key)} />
            ))}
          </MenuGroup>
          <MenuItem onClick={() => bringBack(null)}>
            <SquarePlus />
            New tab
          </MenuItem>
        </MenuPopup>
      </Menu>
    );
  }

  const showing = toggle.kind === "showing";
  const label = showing ? "Hide tabs" : "New tab";
  return (
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
          {showing ? <SquareMinus className="size-4" /> : <SquarePlus className="size-4" />}
        </Toggle>
      </TooltipTrigger>
      <TooltipPopup side="bottom">
        <ShortcutTip label={label} shortcut={shortcutLabel} />
      </TooltipPopup>
    </Tooltip>
  );
}

function ShortcutTip({ label, shortcut }: { label: string; shortcut: string | null }) {
  return (
    <span className="flex items-center gap-2">
      {label}
      {shortcut ? <Kbd>{shortcut}</Kbd> : null}
    </span>
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

function HiddenTabItem({ tabKey, onPick }: { tabKey: string; onPick: () => void }) {
  const { title, icon } = useTabLabel(tabKey);
  return (
    <MenuItem onClick={onPick}>
      <TabIcon>{icon}</TabIcon>
      <span className="min-w-0 truncate">{title}</span>
    </MenuItem>
  );
}

function TabIcon({ children }: { children: ReactNode }) {
  return <span className="flex size-4 shrink-0 items-center justify-center">{children}</span>;
}
