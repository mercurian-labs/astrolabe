import type { EnvironmentId, ProjectId, WikiId, WikiSummary } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { ChevronDownIcon } from "lucide-react";

import { openCommandPalette } from "~/commandPaletteBus";
import { wikiEnvironment } from "~/state/wiki";
import { useRepositories } from "../repositories/useRepositories";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "../ui/menu";
import { useWikiCommand, useWikiOverviews } from "./wikiEnvironment";

interface LinkRow {
  readonly key: string;
  readonly label: string;
  readonly environmentId: EnvironmentId;
  readonly wikiId: WikiId;
  readonly projectId: ProjectId;
  readonly linked: boolean;
}

function LinkMenuRow({ row }: { readonly row: LinkRow }) {
  const canLink = useAtomValue(wikiEnvironment.setProjectLink.permissionAtom(row.environmentId));
  const link = useWikiCommand(wikiEnvironment.setProjectLink, "Failed to change the link");
  return (
    <DropdownMenuCheckboxItem
      checked={row.linked}
      disabled={!canLink}
      onCheckedChange={(linked) =>
        void link({
          environmentId: row.environmentId,
          input: { wikiId: row.wikiId, projectId: row.projectId, linked },
        })
      }
    >
      {row.label}
    </DropdownMenuCheckboxItem>
  );
}

function LinkMenu({
  rows,
  label,
  emptyLabel,
}: {
  readonly rows: ReadonlyArray<LinkRow>;
  readonly label: string;
  readonly emptyLabel: string;
}) {
  const linked = rows.filter((row) => row.linked).map((row) => row.label);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button size="sm" variant="outline" aria-label={label} />}
        disabled={rows.length === 0}
      >
        <span className="max-w-56 truncate">
          {rows.length === 0 ? emptyLabel : linked.length === 0 ? "None" : linked.join(", ")}
        </span>
        <ChevronDownIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {rows.map((row) => (
          <LinkMenuRow key={row.key} row={row} />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Astrolabe: the repositories a wiki is linked to, on the wiki's server. */
export function WikiRepositoriesMenu({
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
  return (
    <LinkMenu
      rows={rows}
      label="Repositories this wiki is linked to"
      emptyLabel="No repositories"
    />
  );
}

/**
 * Astrolabe: the wikis a repository is linked to. A repository can have a checkout on several
 * servers and a wiki lives on one, so each wiki links to the checkout on its own server.
 */
export function RepositoryWikisMenu({
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
            key: `${overview.environmentId}:${overview.wiki.wikiId}`,
            label: overview.wiki.name,
            environmentId: overview.environmentId,
            wikiId: overview.wiki.wikiId,
            projectId: checkout.id,
            linked: overview.wiki.projectIds.includes(checkout.id),
          },
        ];
  });
  if (rows.length === 0) {
    return (
      <Button size="sm" variant="outline" onClick={() => openCommandPalette({ open: "add-wiki" })}>
        Add a wiki…
      </Button>
    );
  }
  return <LinkMenu rows={rows} label="Wikis this repository is linked to" emptyLabel="No wikis" />;
}
