import { useAtomValue } from "@effect/atom-react";
import { ArrowLeftIcon, ArrowRightIcon } from "lucide-react";
import { useSyncExternalStore } from "react";

import { shortcutLabelForCommand } from "~/keybindings";
import { primaryServerKeybindingsAtom } from "~/state/server";
import { tabHistorySlot } from "~/whichKey/handles";
import { SidebarHeaderIconButton } from "./SidebarThreadHeader";

/**
 * Astrolabe: back and forward for the section's tab in front (the chat tab in Agents, the focused
 * pane's tab in Wikis), at the end of the sidebar's title-bar row, as a browser's arrows sit in
 * its title bar. Shown only in a section with tabs, faint with nothing that way.
 */
export function SidebarTabHistory() {
  const handle = useSyncExternalStore(tabHistorySlot.subscribe, tabHistorySlot.get, () => null);
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  if (!handle) return null;
  const label = (text: string, command: "navigation.back" | "navigation.forward") => {
    const shortcut = shortcutLabelForCommand(keybindings, command);
    return shortcut ? `${text} (${shortcut})` : text;
  };
  return (
    <div className="relative z-10 flex shrink-0 items-center gap-0.5" data-tab-history>
      <SidebarHeaderIconButton
        label="Back"
        tooltip={label("Back", "navigation.back")}
        disabled={!handle.canGoBack}
        onClick={() => handle.go("back")}
      >
        <ArrowLeftIcon className="size-4" />
      </SidebarHeaderIconButton>
      <SidebarHeaderIconButton
        label="Forward"
        tooltip={label("Forward", "navigation.forward")}
        disabled={!handle.canGoForward}
        onClick={() => handle.go("forward")}
      >
        <ArrowRightIcon className="size-4" />
      </SidebarHeaderIconButton>
    </div>
  );
}
