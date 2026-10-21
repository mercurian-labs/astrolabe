import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { BookOpenIcon, ChevronDownIcon, LayersIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { ProjectFavicon, type ProjectFaviconProject } from "../ProjectFavicon";
import { Button } from "../ui/button";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxSearchInput,
  ComboboxTrigger,
  useComboboxFilter,
} from "../ui/combobox";
import { useWikiOverviews } from "../wiki/wikiEnvironment";
import { WikiIcon } from "../wiki/WikiIcon";
import { useWikiScope } from "../wiki/WikiSidebar";
import { setChangeRequestKind, useChangeRequestKind } from "./changeRequestKind";
import {
  changeRequestSourceOptions,
  currentSource,
  sourceValue,
  type ChangeRequestSourceOption,
} from "./changeRequestSource";

type Project = ProjectFaviconProject & { readonly id: ProjectId };
type Option = ChangeRequestSourceOption<Project>;

/**
 * Astrolabe: the Change Requests sidebar's filter by source, as Threads filters by project and
 * Wikis by wiki: All, one project's pull requests, or the wikis' changes (all, or one wiki's).
 * A project is the list's own project scope; a wiki is the Wikis section's wiki filter, so the
 * two sections narrow to the same wiki.
 */
export function ChangeRequestSourceFilter({
  projects,
  projectId,
  projectEnvironmentId,
  onProject,
}: {
  readonly projects: ReadonlyArray<Project>;
  readonly projectId: ProjectId | undefined;
  readonly projectEnvironmentId: EnvironmentId | undefined;
  readonly onProject: (projectId: ProjectId | undefined, environmentId?: EnvironmentId) => void;
}) {
  const { overviews } = useWikiOverviews();
  const [wikiScope, setWikiScope] = useWikiScope(overviews);
  const kind = useChangeRequestKind();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const filter = useComboboxFilter();
  const options = useMemo(
    () => changeRequestSourceOptions(projects, overviews),
    [projects, overviews],
  );
  const filtered = useMemo(
    () =>
      query.trim() === ""
        ? options
        : options.filter((option) => filter.contains(option, query, (item) => item.label)),
    [filter, options, query],
  );
  const value = sourceValue(
    currentSource({ wikisOnly: kind === "wikis", projectId, projectEnvironmentId, wikiScope }),
  );
  const selected = options.find((option) => option.value === value) ?? options[0]!;

  const choose = (option: Option) => {
    switch (option.kind) {
      case "all":
        setChangeRequestKind("all");
        setWikiScope(null);
        if (projectId !== undefined) onProject(undefined);
        return;
      case "project":
        setChangeRequestKind("all");
        onProject(option.project.id, option.project.environmentId);
        return;
      case "wikis":
      case "wiki":
        setChangeRequestKind("wikis");
        setWikiScope(option.kind === "wiki" ? option.value.slice("wiki:".length) : null);
        if (projectId !== undefined) onProject(undefined);
        return;
    }
  };

  return (
    <Combobox
      items={options}
      filteredItems={filtered}
      autoHighlight
      itemToStringLabel={(item: Option) => item.label}
      isItemEqualToValue={(a: Option, b: Option) => a.value === b.value}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
      value={selected}
      onValueChange={(item: Option | null) => {
        if (item) choose(item);
      }}
    >
      <ComboboxTrigger
        render={
          <Button
            variant="outline"
            aria-label={`Filter by source: ${selected.label}`}
            className="min-w-0 max-w-full"
          />
        }
      >
        <SourceIcon option={selected} />
        <span className="min-w-0 truncate">{selected.label}</span>
        <ChevronDownIcon className="size-3.5 shrink-0 opacity-60" />
      </ComboboxTrigger>
      <ComboboxPopup align="start" className="min-w-56 max-w-[min(18rem,var(--available-width))]">
        <ComboboxSearchInput
          aria-label="Search projects and wikis"
          placeholder="Search projects and wikis..."
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <ComboboxEmpty>No matching projects or wikis.</ComboboxEmpty>
        <ComboboxList>
          {(item: Option) => (
            <ComboboxItem key={item.value} hideIndicator value={item}>
              <SourceIcon option={item} />
              <span className="min-w-0 flex-1 truncate text-sm">{item.label}</span>
              {item.kind === "wiki" ? (
                <span className="shrink-0 text-xs text-muted-foreground">Wiki</span>
              ) : null}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxPopup>
    </Combobox>
  );
}

function SourceIcon({ option }: { readonly option: Option }) {
  switch (option.kind) {
    case "all":
      return <LayersIcon className="size-4 shrink-0" />;
    case "wikis":
      return <BookOpenIcon className="size-4 shrink-0" />;
    case "project":
      return <ProjectFavicon project={option.project} className="size-4 shrink-0" />;
    case "wiki":
      return (
        <WikiIcon
          environmentId={option.overview.environmentId}
          wiki={option.overview.wiki}
          className="size-4 shrink-0"
        />
      );
  }
}
