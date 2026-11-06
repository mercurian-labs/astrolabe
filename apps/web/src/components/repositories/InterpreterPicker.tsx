import { useAtomValue } from "@effect/atom-react";
import { useState } from "react";

import { requestCommandPalette } from "~/commandPaletteStore";
import { languageServersEnvironment } from "~/state/languageServers";
import { useEnvironmentQuery } from "~/state/query";
import { primaryServerKeybindingsAtom } from "~/state/server";

import type { CommandPaletteActionItem } from "../CommandPalette.logic";
import { CommandPaletteContent } from "../CommandPaletteContent";
import { CommandPaletteResults } from "../CommandPaletteResults";
import { selectInterpreter, type LanguageServerFile } from "./languageServerFile";
import { describeInterpreter } from "./LanguageServerStatus";

/** Astrolabe: a checkout's Python interpreters, as a mode of the Command Palette. */

type Target = Pick<LanguageServerFile, "environmentId" | "cwd">;

let pending: Target | null = null;

export function openInterpreterPicker(target: Target) {
  pending = target;
  requestCommandPalette({ _tag: "ToggleMode", mode: "interpreter" });
}

export function InterpreterPicker(props: { readonly setOpen: (open: boolean) => void }) {
  const [shown] = useState(() => pending);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const { data, isPending } = useEnvironmentQuery(
    shown
      ? languageServersEnvironment.toolchains({
          environmentId: shown.environmentId,
          input: { cwd: shown.cwd },
        })
      : null,
  );
  const item = (
    value: string,
    title: string,
    description: string,
    path: string | null,
  ): CommandPaletteActionItem => ({
    kind: "action",
    value,
    searchTerms: [title, description],
    title,
    description,
    titleTrailingContent:
      data?.selected === path || (path === null && data?.selectedMissing === true) ? (
        <span className="ms-auto shrink-0 text-xs text-muted-foreground">In use</span>
      ) : undefined,
    icon: null,
    run: async () => {
      if (shown) selectInterpreter(shown, path);
    },
  });
  const words = query.trim().toLowerCase();
  const items = [
    item("automatic", "Automatic", "This checkout's .venv or venv, if it has one", null),
    ...(data?.options ?? []).map((option) =>
      item(option.path, describeInterpreter(option), option.path, option.path),
    ),
  ].filter(({ searchTerms }) => searchTerms.some((term) => term.toLowerCase().includes(words)));

  return (
    <CommandPaletteContent
      aria-label="Select Python interpreter"
      autoHighlight="always"
      footerActionLabel="Use it"
      inputProps={{ placeholder: "Select Python interpreter…", disabled: !shown }}
      mode="none"
      onItemHighlighted={(value) => setHighlighted(typeof value === "string" ? value : null)}
      onValueChange={(value) => {
        setHighlighted(null);
        setQuery(value);
      }}
      panelSize="tall-list"
      testId="interpreter-picker"
      value={query}
    >
      <CommandPaletteResults
        groups={[
          {
            value: "interpreters",
            label: data?.selectedMissing
              ? "The interpreter chosen here is gone: Automatic clears it"
              : data && !data.trusted
                ? "Applies once this project is trusted"
                : "",
            items,
          },
        ]}
        highlightedItemValue={highlighted}
        isActionsOnly={false}
        keybindings={keybindings}
        onExecuteItem={(chosen) => {
          if (chosen.kind !== "action") return;
          props.setOpen(false);
          void chosen.run();
        }}
        emptyStateMessage={isPending ? "Looking…" : "No matching interpreters."}
      />
    </CommandPaletteContent>
  );
}
