import type { ScopedThreadRef } from "@t3tools/contracts";
import { Columns2, SquarePlus } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

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
import { chatTabKey } from "~/sectionTabs/sectionTabs";
import type { LinkedToggle } from "./linkedTabs";
import { workspace } from "./workspace";
import { useTabLabel } from "./workspaceTabs";

/** The open menus of chats whose linked tabs are hidden, by chat tab key. */
const hiddenTabsMenus = new Map<string, () => void>();

/**
 * Opens the menu of `ref`'s hidden linked tabs, as its toggle's click does, so the right-panel
 * shortcut, Space p r and the command palette do what the button does. False with none hidden.
 */
export function openHiddenTabsMenu(ref: ScopedThreadRef | null): boolean {
  const open = ref === null ? undefined : hiddenTabsMenus.get(chatTabKey(ref));
  open?.();
  return open !== undefined;
}

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
  /** T3 Code's right-panel toggle, which hides the tabs or opens an empty panel's launcher. */
  readonly onToggle: () => void;
}

/**
 * Astrolabe: the chat's linked tabs toggle, where T3 Code's right-panel toggle stood, as ChatGPT's
 * is: with none, a new tab; with some hidden, their count and a menu bringing them back; with them
 * showing, hiding them. Hidden tabs are set aside, not closed: each tab's ✕ closes it for good.
 */
export function LinkedTabsToggle({
  owner,
  available,
  shortcutLabel,
  onToggle,
}: LinkedTabsToggleProps) {
  const toggle = useLinkedToggle(owner);
  const [menuOpen, setMenuOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const hidden = toggle.kind === "hidden";
  // oxlint-disable-next-line t3code/react-effect-budget -- lends the menu to the right-panel shortcut while tabs are hidden
  useEffect(() => {
    if (!hidden) return;
    hiddenTabsMenus.set(owner, () => {
      trigger.current?.focus();
      setMenuOpen(true);
    });
    return () => {
      hiddenTabsMenus.delete(owner);
    };
  }, [hidden, owner]);

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
                ref={trigger}
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
          {showing ? <Columns2 className="size-4" /> : <SquarePlus className="size-4" />}
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

/** A rounded square holding how many tabs are hidden, drawn at an icon's size. */
function HiddenCount({ count }: { count: number }) {
  return (
    <span
      aria-hidden
      className="flex h-4 min-w-4 items-center justify-center rounded-[4px] border-[1.5px] border-current px-px text-[9px] leading-none font-semibold tabular-nums opacity-80"
    >
      {count > 9 ? "9+" : count}
    </span>
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
