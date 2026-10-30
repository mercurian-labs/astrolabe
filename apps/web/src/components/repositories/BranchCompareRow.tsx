import type { EnvironmentId } from "@t3tools/contracts";
import { ArrowRightIcon, GitBranchIcon, GitCompareArrowsIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

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

const ROW_CLASS =
  "flex h-8 w-full cursor-pointer items-center gap-1.5 rounded-md px-2 text-xs font-medium text-sidebar-muted-foreground transition-colors hover:bg-sidebar-row-hover hover:text-sidebar-foreground";

/**
 * A checkout's branch against a base: its own base by default, or any branch picked beside it.
 * On a branch with nothing against its base (the default branch, say), the row only picks one.
 * `onOpen` gets the picked branch, or nothing for the branch's own base.
 */
export function BranchCompareRow({
  environmentId,
  cwd,
  defaultBase,
  onOpen,
}: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  /** The branch's own base when it has changes against it; null otherwise. */
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
  const picker = (className: string, label: string, children: ReactNode) => (
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
      <ComboboxTrigger render={<button type="button" className={className} aria-label={label} />}>
        {children}
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
  );
  if (base === null) {
    return (
      <li className="mx-0.5 list-none">
        {picker(
          ROW_CLASS,
          "Compare with a branch",
          <>
            <GitCompareArrowsIcon aria-hidden className="size-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate text-left">Compare with a branch…</span>
          </>,
        )}
      </li>
    );
  }
  return (
    <li className="mx-0.5 flex list-none items-center gap-0.5">
      <button
        type="button"
        className={`${ROW_CLASS} min-w-0 flex-1`}
        onClick={() => onOpen(picked ?? undefined)}
      >
        <GitBranchIcon aria-hidden className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-left">{`Changes against ${base}`}</span>
        <ArrowRightIcon aria-hidden className="size-3.5 shrink-0" />
      </button>
      {picker(
        "inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground",
        "Compare with another branch",
        <GitCompareArrowsIcon aria-hidden className="size-3.5" />,
      )}
    </li>
  );
}
