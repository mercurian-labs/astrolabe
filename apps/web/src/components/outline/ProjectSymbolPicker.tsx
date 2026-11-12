import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { useState } from "react";

import { requestCommandPalette } from "~/commandPaletteStore";
import { focusedPane, openTab } from "~/panes/arrangement";
import { recordJump } from "~/panes/jumpHistory";
import type { PaneArrangementStore } from "~/panes/panesHost";
import { languageServersEnvironment } from "~/state/languageServers";
import { useDebouncedValue } from "~/state/queries";
import { useEnvironmentQuery } from "~/state/query";
import { primaryServerKeybindingsAtom } from "~/state/server";
import { readListedProjectWorktrees } from "~/state/worktrees";

import type { CommandPaletteActionItem } from "../CommandPalette.logic";
import { CommandPaletteContent } from "../CommandPaletteContent";
import { CommandPaletteResults } from "../CommandPaletteResults";
import { repositoryFileReveal } from "../repositories/repositoryFileReveal";
import { parseRepositoryTabKey, repositoryTabKey, tabFolder } from "../repositories/repositoryTabs";

/**
 * Astrolabe: names across a project's checkout, as a mode of the Command Palette. The environment
 * answers from its running language servers or its code index (`searchProjectSymbols`); Enter
 * opens the place in the panes the picker was opened from.
 */

interface Pending {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly cwd: string;
  readonly panes: PaneArrangementStore;
  /** The tab in front, which a pick jumps from. */
  readonly tabKey: string;
}

let pending: Pending | null = null;

/** What opens the picker for the repository tab in front of `panes`; null with none. */
export function projectSymbolsOpener(panes: PaneArrangementStore | null): (() => void) | null {
  const arrangement = panes?.getSnapshot()?.arrangement;
  if (panes === null || arrangement === undefined) return null;
  const tabKey = focusedPane(arrangement).active;
  const tab = parseRepositoryTabKey(tabKey);
  if (tab === null || !("projectId" in tab)) return null;
  const { environmentId, projectId } = tab;
  const cwd = tabFolder(
    tab,
    readListedProjectWorktrees({ environmentId, projectId })?.worktrees ?? null,
  );
  if (cwd === null) return null;
  return () => {
    pending = { environmentId, projectId, cwd, panes, tabKey };
    requestCommandPalette({ _tag: "ToggleMode", mode: "symbols" });
  };
}

export function ProjectSymbolPicker(props: { readonly setOpen: (open: boolean) => void }) {
  const [shown] = useState(() => pending);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const asked = useDebouncedValue(query.trim(), 150);
  const answer = useEnvironmentQuery(
    shown && asked !== ""
      ? languageServersEnvironment.projectSymbols({
          environmentId: shown.environmentId,
          input: { cwd: shown.cwd, projectId: shown.projectId, query: asked },
        })
      : null,
  );
  const symbols = answer.data?.symbols ?? [];
  const items: CommandPaletteActionItem[] = symbols.map((symbol, index) => ({
    kind: "action",
    value: `symbol:${index}`,
    searchTerms: [symbol.name, symbol.path],
    title: symbol.name,
    description: `${symbol.path}:${symbol.line}`,
    titleTrailingContent: (
      <span className="ms-auto shrink-0 text-xs text-muted-foreground">{symbol.kind}</span>
    ),
    icon: null,
    run: async () => {
      if (!shown) return;
      const { environmentId, projectId, cwd, panes, tabKey } = shown;
      const key = repositoryTabKey({
        kind: "file",
        environmentId,
        projectId,
        checkout: { cwd },
        path: symbol.path,
      });
      recordJump(tabKey, key);
      panes.update((arrangement) => openTab(arrangement, key));
      repositoryFileReveal.request(key, symbol.line, symbol.column);
    },
  }));
  const waiting = asked !== query.trim() || (answer.isPending && symbols.length === 0);

  return (
    <CommandPaletteContent
      aria-label="Go to symbol in project"
      autoHighlight="always"
      footerActionLabel="Go there"
      inputProps={{ placeholder: "Go to symbol in project…", disabled: !shown }}
      mode="none"
      onItemHighlighted={(value) => setHighlighted(typeof value === "string" ? value : null)}
      onValueChange={(value) => {
        setHighlighted(null);
        setQuery(value);
      }}
      panelSize="tall-list"
      testId="project-symbol-picker"
      value={query}
    >
      <CommandPaletteResults
        groups={
          items.length > 0
            ? [
                {
                  value: "symbols",
                  label: answer.data?.truncated ? `First ${items.length}: type to narrow` : "",
                  items,
                },
              ]
            : []
        }
        highlightedItemValue={highlighted}
        isActionsOnly={false}
        keybindings={keybindings}
        onExecuteItem={(item) => {
          if (item.kind !== "action") return;
          props.setOpen(false);
          void item.run();
        }}
        emptyStateMessage={
          query.trim() === ""
            ? "Type part of a name."
            : waiting
              ? "Searching…"
              : "No matching symbols."
        }
      />
    </CommandPaletteContent>
  );
}
