import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { ChevronDownIcon } from "lucide-react";
import { useState } from "react";

import type { ProjectFaviconProject } from "../ProjectFavicon";
import { ProjectFilterIcon } from "../projects/ProjectFilterIcon";
import {
  projectFilterChoice,
  projectFilterOptions,
  projectFilterValue,
  searchProjectFilterOptions,
  wikiCheckoutKeys,
  type ProjectFilterChoice,
  type ProjectFilterOption,
} from "../projects/projectFilter";
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
import { changeRequestWikiScope } from "../wiki/wikiScope";
import { changeRequestKindStore, useChangeRequestKind } from "./changeRequestKind";

type Project = ProjectFaviconProject & {
  readonly id: ProjectId;
  readonly environmentId: EnvironmentId;
  readonly title: string;
};
type Option = ProjectFilterOption<Project>;

const projectKey = (project: { readonly environmentId: EnvironmentId; readonly id: ProjectId }) =>
  `${project.environmentId}:${project.id}`;

/**
 * Astrolabe: the Change Requests sidebar's project filter, the list every section shares (see
 * `projectFilter`): All projects, every repository or one repository's pull requests, every wiki
 * or one wiki's change requests. The repository picked is the list's own project scope, in the
 * route; the wiki picked is this section's own (`changeRequestWikiScope`).
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
  const [wikiScope, setWikiScope] = changeRequestWikiScope.useScope(overviews);
  const kind = useChangeRequestKind();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const filter = useComboboxFilter();
  const checkouts = wikiCheckoutKeys(overviews);
  const options = projectFilterOptions({
    repositories: projects
      .filter((project) => !checkouts.has(projectKey(project)))
      .map((project) => ({
        key: projectKey(project),
        label: project.title,
        repository: project,
      })),
    wikis: overviews,
  });
  const filtered = searchProjectFilterOptions(options, query, (option, text) =>
    filter.contains(option, text, (item) => item.label),
  );
  const current: ProjectFilterChoice =
    projectId !== undefined && projectEnvironmentId !== undefined
      ? {
          kind: "repository",
          key: projectKey({ environmentId: projectEnvironmentId, id: projectId }),
        }
      : kind === "wikis" && wikiScope !== null
        ? { kind: "wiki", key: wikiScope }
        : { kind };
  const selected =
    options.find((option) => option.value === projectFilterValue(current)) ?? options[0]!;

  const choose = (option: Option) => {
    const choice = projectFilterChoice(option);
    switch (choice.kind) {
      case "all":
      case "repositories":
        changeRequestKindStore.set(choice.kind);
        setWikiScope(null);
        if (projectId !== undefined) onProject(undefined);
        return;
      case "repository": {
        if (option.kind !== "repository") return;
        changeRequestKindStore.set("repositories");
        setWikiScope(null);
        onProject(option.repository.id, option.repository.environmentId);
        return;
      }
      case "wikis":
      case "wiki":
        changeRequestKindStore.set("wikis");
        setWikiScope(choice.kind === "wiki" ? choice.key : null);
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
            aria-label={`Filter by project: ${selected.label}`}
            className="min-w-0 max-w-full"
          />
        }
      >
        <ProjectFilterIcon option={selected} />
        <span className="min-w-0 truncate">{selected.label}</span>
        <ChevronDownIcon className="size-3.5 shrink-0 opacity-60" />
      </ComboboxTrigger>
      <ComboboxPopup align="start" className="min-w-56 max-w-[min(18rem,var(--available-width))]">
        <ComboboxSearchInput
          aria-label="Search projects"
          placeholder="Search projects..."
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <ComboboxEmpty>No matching projects.</ComboboxEmpty>
        <ComboboxList>
          {(item: Option) => (
            <ComboboxItem key={item.value} hideIndicator value={item}>
              <ProjectFilterIcon option={item} />
              <span className="min-w-0 flex-1 truncate text-sm">{item.label}</span>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxPopup>
    </Combobox>
  );
}
