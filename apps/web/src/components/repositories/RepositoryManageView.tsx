import { useNavigate } from "@tanstack/react-router";
import { FolderPlusIcon, PlugIcon, SettingsIcon } from "lucide-react";

import { openCommandPalette } from "~/commandPaletteBus";
import { useEnvironments } from "~/state/environments";
import { ProjectFavicon } from "../ProjectFavicon";
import { Button } from "../ui/button";
import { useRepositories } from "./useRepositories";

/**
 * Astrolabe: the Repositories section's Manage view: every repository, where it lives and on
 * which machine, with adding one, each one's settings (its scripts, and removing it), and the
 * hosting providers its remotes talk to. The settings and hosting pages are T3 Code's own.
 */
export function RepositoryManageView() {
  const navigate = useNavigate();
  const repositories = useRepositories();
  const { environments } = useEnvironments();
  const machine = (environmentId: string) =>
    environments.find((environment) => environment.environmentId === environmentId)?.label ?? null;
  return (
    <div className="scrollbar-gutter-both min-h-0 flex-1 overflow-auto">
      <div className="mx-auto flex max-w-2xl flex-col gap-4 px-6 py-8">
        <div className="flex items-center gap-2">
          <h1 className="min-w-0 flex-1 text-lg font-semibold">Repositories</h1>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void navigate({ to: "/settings/source-control" })}
          >
            <PlugIcon />
            Hosting providers
          </Button>
          <Button size="sm" onClick={() => openCommandPalette({ open: "add-project" })}>
            <FolderPlusIcon />
            Add a repository
          </Button>
        </div>
        {repositories.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No repositories yet. Add a folder on one of your machines, or clone one.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {repositories.map((repository) => (
              <li
                key={`${repository.environmentId}:${repository.id}`}
                className="flex items-center gap-3 px-3 py-2.5"
              >
                <ProjectFavicon project={repository} className="size-5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{repository.title}</div>
                  <div className="truncate font-mono text-xs text-muted-foreground">
                    {repository.workspaceRoot}
                  </div>
                </div>
                {machine(repository.environmentId) ? (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {machine(repository.environmentId)}
                  </span>
                ) : null}
                <Button
                  size="icon-sm"
                  variant="ghost-muted"
                  aria-label={`Settings for ${repository.title}`}
                  onClick={() => void navigate({ to: "/settings/projects" })}
                >
                  <SettingsIcon />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
