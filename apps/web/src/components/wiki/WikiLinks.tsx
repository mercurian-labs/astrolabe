import type { EnvironmentId, ProjectId, WikiId, WikiSummary } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { Link } from "@tanstack/react-router";
import { PlusIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { openCommandPalette } from "~/commandPaletteBus";
import { wikiEnvironment } from "~/state/wiki";
import { useRepositories } from "../repositories/useRepositories";
import { SettingsRow, SettingsSection } from "../settings/settingsLayout";
import { Button } from "../ui/button";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxSearchInput,
  ComboboxTrigger,
} from "../ui/combobox";
import { useWikiCommand, useWikiOverviews } from "./wikiEnvironment";
import { wikiScopeKey } from "./wikiTabs";

/** A scratch folder left by an earlier home keeps this title but is not today's scratch root. */
const SCRATCH_PROJECT_TITLE = "No project";

interface LinkRow {
  readonly key: string;
  readonly label: string;
  readonly environmentId: EnvironmentId;
  readonly wikiId: WikiId;
  readonly projectId: ProjectId;
  readonly linked: boolean;
}

const linkInput = (row: LinkRow, linked: boolean) => ({
  environmentId: row.environmentId,
  input: { wikiId: row.wikiId, projectId: row.projectId, linked },
});

function LinkPickerItem({ row }: { readonly row: LinkRow }) {
  const canLink = useAtomValue(wikiEnvironment.setProjectLink.permissionAtom(row.environmentId));
  return (
    <ComboboxItem value={row} disabled={!canLink}>
      <span className="min-w-0 flex-1 truncate">{row.label}</span>
    </ComboboxItem>
  );
}

function LinkPicker({
  rows,
  label,
  searchLabel,
}: {
  readonly rows: ReadonlyArray<LinkRow>;
  readonly label: string;
  readonly searchLabel: string;
}) {
  const link = useWikiCommand(wikiEnvironment.setProjectLink, "Failed to change the link");
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  return (
    <Combobox
      items={rows}
      filteredItems={rows.filter((row) => row.label.toLowerCase().includes(needle))}
      filter={null}
      autoHighlight
      itemToStringLabel={(row: LinkRow) => row.label}
      isItemEqualToValue={(a: LinkRow, b: LinkRow) => a.key === b.key}
      value={null}
      onOpenChange={(open) => {
        if (!open) setQuery("");
      }}
      onValueChange={(row) => {
        if (row) void link(linkInput(row, true));
      }}
    >
      <ComboboxTrigger
        aria-label={label}
        render={<Button size="xs" variant="outline" disabled={rows.length === 0} />}
      >
        <PlusIcon />
        {label}
      </ComboboxTrigger>
      <ComboboxPopup align="end" className="w-72">
        <ComboboxSearchInput
          aria-label={searchLabel}
          placeholder={searchLabel}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <ComboboxEmpty>No matches found.</ComboboxEmpty>
        <ComboboxList>{(row: LinkRow) => <LinkPickerItem key={row.key} row={row} />}</ComboboxList>
      </ComboboxPopup>
    </Combobox>
  );
}

function LinkedRow({
  row,
  title,
  description,
}: {
  readonly row: LinkRow;
  readonly title: ReactNode;
  readonly description: string;
}) {
  const canLink = useAtomValue(wikiEnvironment.setProjectLink.permissionAtom(row.environmentId));
  const link = useWikiCommand(wikiEnvironment.setProjectLink, "Failed to change the link");
  return (
    <SettingsRow
      title={title}
      description={description}
      control={
        <Button
          size="xs"
          variant="outline"
          disabled={!canLink}
          onClick={() => void link(linkInput(row, false))}
        >
          Unlink
        </Button>
      }
    />
  );
}

/** The projects a wiki is linked to, on the wiki's server, as a section of its settings. */
export function WikiProjectLinks({
  environmentId,
  wiki,
}: {
  readonly environmentId: EnvironmentId;
  readonly wiki: WikiSummary;
}) {
  const rows = useRepositories()
    .filter((repository) => repository.environmentId === environmentId)
    .map((repository): LinkRow => ({
      key: repository.id,
      label: repository.title,
      environmentId,
      wikiId: wiki.wikiId,
      projectId: repository.id,
      linked: wiki.projectIds.includes(repository.id),
    }));
  const linked = rows.filter((row) => row.linked);
  return (
    <SettingsSection
      title="Projects"
      headerAction={
        <LinkPicker
          rows={rows.filter((row) => !row.linked && row.label !== SCRATCH_PROJECT_TITLE)}
          label="Link a project"
          searchLabel="Search projects"
        />
      }
    >
      {linked.length === 0 ? (
        <SettingsRow
          title="Not linked to a project"
          description="Link the projects this wiki plans, so their agents know where research and plans live."
        />
      ) : (
        linked.map((row) => (
          <LinkedRow
            key={row.key}
            row={row}
            title={row.label}
            description={`Agents in ${row.label} search this wiki first and write their plans here.`}
          />
        ))
      )}
    </SettingsSection>
  );
}

/**
 * The wikis a project is linked to, as a section of its settings. A project can have a checkout
 * on several servers and a wiki lives on one, so each wiki links to the checkout on its server.
 */
export function ProjectWikiLinks({
  checkouts,
}: {
  readonly checkouts: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly id: ProjectId;
  }>;
}) {
  const { overviews } = useWikiOverviews();
  const rows = overviews.flatMap((overview): LinkRow[] => {
    const checkout = checkouts.find((each) => each.environmentId === overview.environmentId);
    return checkout === undefined
      ? []
      : [
          {
            key: wikiScopeKey(overview.environmentId, overview.wiki.wikiId),
            label: overview.wiki.name,
            environmentId: overview.environmentId,
            wikiId: overview.wiki.wikiId,
            projectId: checkout.id,
            linked: overview.wiki.projectIds.includes(checkout.id),
          },
        ];
  });
  const linked = rows.filter((row) => row.linked);
  return (
    <SettingsSection
      title="Wikis"
      headerAction={
        rows.length === 0 ? (
          <Button
            size="xs"
            variant="outline"
            onClick={() => openCommandPalette({ open: "add-wiki" })}
          >
            <PlusIcon />
            Add a wiki
          </Button>
        ) : (
          <LinkPicker
            rows={rows.filter((row) => !row.linked)}
            label="Link a wiki"
            searchLabel="Search wikis"
          />
        )
      }
    >
      {linked.length === 0 ? (
        <SettingsRow
          title="Not linked to a wiki"
          description="Link the wiki that holds this project's research and plans, so its agents know to read and write there."
        />
      ) : (
        linked.map((row) => (
          <LinkedRow
            key={row.key}
            row={row}
            title={
              <Link to="/settings/wikis" search={{ wiki: row.key }} className="hover:underline">
                {row.label}
              </Link>
            }
            description={`Agents in this project search ${row.label} first and write their plans there.`}
          />
        ))
      )}
    </SettingsSection>
  );
}
