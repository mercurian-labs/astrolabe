/* oxlint-disable t3code/no-untranslated-copy -- Astrolabe-only copy, shipped in English. */
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { ChevronDownIcon } from "lucide-react";
import { useState } from "react";

import type { ProjectFaviconProject } from "../ProjectFavicon";
import { ProjectFilterIcon } from "../projects/ProjectFilterIcon";
import {
  projectFilterOptions,
  projectFilterValue,
  searchProjectFilterOptions,
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

type Project = ProjectFaviconProject & {
  readonly id: ProjectId;
  readonly environmentId: EnvironmentId;
  readonly title: string;
};
type Option = ProjectFilterOption<Project>;

const projectKey = (project: { readonly environmentId: EnvironmentId; readonly id: ProjectId }) =>
  `${project.environmentId}:${project.id}`;

/**
 * Astrolabe: the Changes sidebar's project filter, the list every section shares (see
 * `projectFilter`): every project's pull requests, or one project's. The project picked is the
 * list's own project scope, in the route.
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
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const filter = useComboboxFilter();
  const options = projectFilterOptions({
    repositories: projects.map((project) => ({
      key: projectKey(project),
      label: project.title,
      repository: project,
    })),
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
      : { kind: "all" };
  const selected =
    options.find((option) => option.value === projectFilterValue(current)) ?? options[0]!;

  const choose = (option: Option) => {
    if (option.kind === "repository") {
      onProject(option.repository.id, option.repository.environmentId);
    } else if (projectId !== undefined) {
      onProject(undefined);
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
