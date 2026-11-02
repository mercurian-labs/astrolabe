import { useAtomValue } from "@effect/atom-react";
import { CHANGE_GROUP_STATE_LABELS } from "@t3tools/shared/changeGroups";
import { LayersIcon } from "lucide-react";
import { useState } from "react";

import { useChangeGroups } from "~/state/changeGroups";
import { primaryServerKeybindingsAtom } from "~/state/server";
import type { CommandPaletteActionItem } from "../../CommandPalette.logic";
import { CommandPaletteContent } from "../../CommandPaletteContent";
import { CommandPaletteResults } from "../../CommandPaletteResults";
import { CommandDialog, CommandDialogPopup } from "../../ui/command";
import { changeGroupTabKey } from "./changeGroupTabs";

/** Astrolabe: finds a change group by its title, to open its own tab. */
export function ChangeGroupFinder({
  onClose,
  onPick,
}: {
  readonly onClose: () => void;
  readonly onPick: (key: string) => void;
}) {
  const groups = useChangeGroups();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const needle = query.trim().toLowerCase();
  const items = groups
    .filter((group) => needle === "" || group.title.toLowerCase().includes(needle))
    .map((group): CommandPaletteActionItem => {
      const key = changeGroupTabKey(group);
      return {
        kind: "action",
        value: key,
        searchTerms: [group.title],
        title: group.title,
        description: CHANGE_GROUP_STATE_LABELS[group.state],
        icon: <LayersIcon className="size-4 shrink-0 text-muted-foreground/85" />,
        run: async () => {
          onClose();
          onPick(key);
        },
      };
    });
  return (
    <CommandDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <CommandDialogPopup
        aria-label="Open a change group"
        className="overflow-hidden"
        onBackdropPointerDown={onClose}
      >
        <CommandPaletteContent
          aria-label="Open a change group"
          autoHighlight="always"
          footerActionLabel="Open"
          inputProps={{ placeholder: "Find a change group…" }}
          mode="none"
          onItemHighlighted={(value) => setHighlighted(typeof value === "string" ? value : null)}
          onValueChange={(value) => {
            setHighlighted(null);
            setQuery(value);
          }}
          panelSize="tall-list"
          testId="change-group-finder"
          value={query}
        >
          <CommandPaletteResults
            groups={
              items.length > 0 ? [{ value: "change-groups", label: "Change groups", items }] : []
            }
            highlightedItemValue={highlighted}
            isActionsOnly={false}
            keybindings={keybindings}
            onExecuteItem={(item) => {
              if (item.kind === "action") void item.run();
            }}
            emptyStateMessage={
              groups.length === 0 ? "No change groups yet." : "No matching groups."
            }
          />
        </CommandPaletteContent>
      </CommandDialogPopup>
    </CommandDialog>
  );
}
