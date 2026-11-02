import type { EnvironmentId } from "@t3tools/contracts";
import { ChevronDownIcon, GitBranchIcon } from "lucide-react";
import { useState } from "react";

import { useEnvironmentQuery } from "~/state/query";
import { vcsEnvironment } from "~/state/vcs";
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
 * The branch a checkout's changes are against, in a changes tab's title: any local or remote
 * branch can take its place. `base` is null while the branch has none of its own yet.
 */
export function CompareBasePicker({
  environmentId,
  cwd,
  base,
  onPick,
}: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly base: string | null;
  readonly onPick: (branch: string) => void;
}) {
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
  return (
    <Combobox
      items={branches}
      filteredItems={branches}
      open={open}
      onOpenChange={(next) => (next ? setOpen(true) : close())}
      value={null}
      onValueChange={(branch: string | null) => {
        if (!branch) return;
        close();
        onPick(branch);
      }}
    >
      <ComboboxTrigger
        render={
          <button
            type="button"
            aria-label={`Compare with another branch than ${base ?? "its base"}`}
            className="-mx-1 inline-flex cursor-pointer items-center gap-0.5 rounded px-1 hover:bg-accent"
          />
        }
      >
        {base ?? "a branch…"}
        <ChevronDownIcon aria-hidden className="size-3.5 shrink-0 opacity-60" />
      </ComboboxTrigger>
      <ComboboxPopup align="start" className="min-w-56 max-w-[min(18rem,var(--available-width))]">
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
  );
}
