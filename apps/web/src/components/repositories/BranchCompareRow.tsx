import type { EnvironmentId } from "@t3tools/contracts";
import { ArrowRightIcon, GitBranchIcon, GitCompareArrowsIcon } from "lucide-react";
import { useState } from "react";

import { useEnvironmentQuery } from "~/state/query";
import { vcsEnvironment } from "~/state/vcs";
import { SidebarHeaderIconButton } from "../sidebar/SidebarThreadHeader";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxSearchInput,
  ComboboxTrigger,
} from "../ui/combobox";

/**
 * A checkout's branch against a base: its own base by default, or any branch picked with the
 * compare button beside it. Without a base yet (a default branch with no remote, say), the row
 * opens the picker too. `onOpen` gets the picked branch, or nothing for the branch's own base.
 */
export function BranchCompareRow({
  environmentId,
  cwd,
  defaultBase,
  onOpen,
}: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  /** The branch's own base; null when it has none. */
  readonly defaultBase: string | null;
  readonly onOpen: (base: string | undefined) => void;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const refs = useEnvironmentQuery(
    open
      ? vcsEnvironment.listRefs({
          environmentId,
          input: {
            cwd,
            refKind: "all",
            limit: 100,
            ...(query.trim() ? { query: query.trim() } : {}),
          },
        })
      : null,
  );
  const branches = [...new Set((refs.data?.refs ?? []).map((ref) => ref.name))];
  const close = () => {
    setOpen(false);
    setQuery("");
  };
  const base = picked ?? defaultBase;
  return (
    <li className="mx-0.5 flex list-none items-center gap-0.5">
      <button
        type="button"
        className="flex h-8 min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-md px-2 text-xs font-medium text-sidebar-muted-foreground transition-colors hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
        onClick={() => (base === null ? setOpen(true) : onOpen(picked ?? undefined))}
      >
        <GitBranchIcon aria-hidden className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-left">
          {base === null ? "Changes against…" : `Changes against ${base}`}
        </span>
        {base === null ? null : <ArrowRightIcon aria-hidden className="size-3.5 shrink-0" />}
      </button>
      <Combobox
        items={branches}
        filteredItems={branches}
        open={open}
        onOpenChange={(next) => (next ? setOpen(true) : close())}
        value={null}
        onValueChange={(branch: string | null) => {
          if (!branch) return;
          close();
          setPicked(branch);
          onOpen(branch);
        }}
      >
        <ComboboxTrigger render={<SidebarHeaderIconButton label="Compare with another branch" />}>
          <GitCompareArrowsIcon className="size-3.5" />
        </ComboboxTrigger>
        <ComboboxPopup align="end" className="min-w-56 max-w-[min(18rem,var(--available-width))]">
          <ComboboxSearchInput
            aria-label="Find a branch to compare with"
            placeholder="Compare with..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <ComboboxEmpty>{refs.isPending ? "Reading branches…" : "No such branch."}</ComboboxEmpty>
          <ComboboxList>
            {(branch: string) => (
              <ComboboxItem key={branch} hideIndicator value={branch}>
                <GitBranchIcon className="size-3.5 shrink-0 opacity-70" />
                <span className="min-w-0 flex-1 truncate text-sm">{branch}</span>
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxPopup>
      </Combobox>
    </li>
  );
}
