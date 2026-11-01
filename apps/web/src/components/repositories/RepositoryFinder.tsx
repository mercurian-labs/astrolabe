import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { FileDiffIcon, FolderGit2Icon, GitCompareArrowsIcon } from "lucide-react";
import { useState } from "react";

import { useTheme } from "~/hooks/useTheme";
import { primaryServerKeybindingsAtom } from "~/state/server";
import { PierreEntryIcon } from "../chat/PierreEntryIcon";
import type { CommandPaletteActionItem } from "../CommandPalette.logic";
import { CommandPaletteContent } from "../CommandPaletteContent";
import { CommandPaletteResults } from "../CommandPaletteResults";
import {
  getProjectFilePickerMatches,
  PROJECT_FILE_PICKER_RESULT_LIMIT,
} from "../files/ProjectFilePicker.logic";
import { useProjectFilePickerQuery } from "../files/projectFilesQueryState";
import { CommandDialog, CommandDialogPopup } from "../ui/command";
import { repositoryTabKey } from "./repositoryTabs";
import { useRepositories } from "./useRepositories";

const ICON_CLASS = "size-4 shrink-0 text-muted-foreground/85";

/**
 * Astrolabe: finds a repository's file, or its changes, to open as a tab, as the Repositories
 * sidebar opens them: a file of the repository's own checkout, its uncommitted changes, or its
 * branch against its base. With several repositories, a file is found in one picked first.
 */
export function RepositoryFinder({
  mode,
  onClose,
  onPick,
}: {
  readonly mode: "file" | "diff";
  readonly onClose: () => void;
  readonly onPick: (key: string) => void;
}) {
  const label = mode === "file" ? "Open a project file" : "Open a project diff";
  const pick = (key: string) => {
    onClose();
    onPick(key);
  };
  return (
    <CommandDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <CommandDialogPopup
        aria-label={label}
        className="overflow-hidden"
        onBackdropPointerDown={onClose}
      >
        {mode === "file" ? <FileFinder onPick={pick} /> : <DiffFinder onPick={pick} />}
      </CommandDialogPopup>
    </CommandDialog>
  );
}

function matches(query: string, ...terms: string[]) {
  const needle = query.trim().toLowerCase();
  return needle === "" || terms.some((term) => term.toLowerCase().includes(needle));
}

function useFinderList() {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState<string | null>(null);
  return {
    keybindings,
    query,
    highlighted,
    setQuery,
    contentProps: {
      autoHighlight: "always" as const,
      mode: "none" as const,
      onItemHighlighted: (value: unknown) =>
        setHighlighted(typeof value === "string" ? value : null),
      onValueChange: (value: string) => {
        setHighlighted(null);
        setQuery(value);
      },
      panelSize: "tall-list" as const,
      value: query,
    },
  };
}

/** Each repository's uncommitted changes and its branch against its base. */
function DiffFinder({ onPick }: { readonly onPick: (key: string) => void }) {
  const repositories = useRepositories();
  const list = useFinderList();
  const several = repositories.length > 1;
  const items = repositories.flatMap((repository): CommandPaletteActionItem[] =>
    (["working-tree", "branch-range"] as const).flatMap((source) => {
      const title = source === "working-tree" ? "Uncommitted changes" : "Branch changes";
      if (!matches(list.query, title, repository.title)) return [];
      const key = repositoryTabKey({
        kind: "diff",
        environmentId: repository.environmentId,
        projectId: repository.id,
        cwd: repository.workspaceRoot,
        source,
      });
      return [
        {
          kind: "action",
          value: key,
          searchTerms: [title, repository.title],
          title: several ? `${repository.title} · ${title}` : title,
          description: source === "branch-range" ? "against its base branch" : "",
          icon:
            source === "working-tree" ? (
              <FileDiffIcon className={ICON_CLASS} />
            ) : (
              <GitCompareArrowsIcon className={ICON_CLASS} />
            ),
          run: async () => onPick(key),
        },
      ];
    }),
  );
  return (
    <CommandPaletteContent
      aria-label="Open a project diff"
      footerActionLabel="Open"
      inputProps={{ placeholder: "Find a project's changes…" }}
      testId="repository-diff-finder"
      {...list.contentProps}
    >
      <CommandPaletteResults
        groups={items.length > 0 ? [{ value: "repository-diffs", label: "Changes", items }] : []}
        highlightedItemValue={list.highlighted}
        isActionsOnly={false}
        keybindings={list.keybindings}
        onExecuteItem={(item) => {
          if (item.kind === "action") void item.run();
        }}
        emptyStateMessage={repositories.length === 0 ? "No projects yet." : "No matching projects."}
      />
    </CommandPaletteContent>
  );
}

/** A repository, then a file of its own checkout; with one repository, its files straight away. */
function FileFinder({ onPick }: { readonly onPick: (key: string) => void }) {
  const repositories = useRepositories();
  const [picked, setPicked] = useState<EnvironmentProject | null>(null);
  const only = repositories.length === 1 ? repositories[0] : undefined;
  const repository = picked ?? only ?? null;
  if (repository === null) return <RepositoryList repositories={repositories} onPick={setPicked} />;
  return (
    <RepositoryFiles
      repository={repository}
      onBack={picked === null ? null : () => setPicked(null)}
      onPick={onPick}
    />
  );
}

function RepositoryList({
  repositories,
  onPick,
}: {
  readonly repositories: ReadonlyArray<EnvironmentProject>;
  readonly onPick: (repository: EnvironmentProject) => void;
}) {
  const list = useFinderList();
  const items = repositories
    .filter((repository) => matches(list.query, repository.title))
    .map((repository): CommandPaletteActionItem => ({
      kind: "action",
      value: `${repository.environmentId}:${repository.id}`,
      searchTerms: [repository.title],
      title: repository.title,
      description: repository.workspaceRoot,
      icon: <FolderGit2Icon className={ICON_CLASS} />,
      run: async () => onPick(repository),
    }));
  return (
    <CommandPaletteContent
      aria-label="Open a project file"
      footerActionLabel="Choose"
      inputProps={{ placeholder: "Find a project…" }}
      testId="repository-file-finder"
      {...list.contentProps}
    >
      <CommandPaletteResults
        groups={items.length > 0 ? [{ value: "repositories", label: "Projects", items }] : []}
        highlightedItemValue={list.highlighted}
        isActionsOnly={false}
        keybindings={list.keybindings}
        onExecuteItem={(item) => {
          if (item.kind === "action") void item.run();
        }}
        emptyStateMessage={repositories.length === 0 ? "No projects yet." : "No matching projects."}
      />
    </CommandPaletteContent>
  );
}

function RepositoryFiles({
  repository,
  onBack,
  onPick,
}: {
  readonly repository: EnvironmentProject;
  readonly onBack: (() => void) | null;
  readonly onPick: (key: string) => void;
}) {
  const list = useFinderList();
  const { resolvedTheme } = useTheme();
  const cwd = repository.workspaceRoot;
  const result = useProjectFilePickerQuery(
    repository.environmentId,
    cwd,
    list.query,
    PROJECT_FILE_PICKER_RESULT_LIMIT,
  );
  const items = getProjectFilePickerMatches(result.entries, result.matchedQuery).map(
    (match): CommandPaletteActionItem => {
      const key = repositoryTabKey({
        kind: "file",
        environmentId: repository.environmentId,
        projectId: repository.id,
        cwd,
        path: match.path,
      });
      return {
        kind: "action",
        value: key,
        searchTerms: [match.name, match.path],
        title: match.name,
        description: match.path,
        icon: <PierreEntryIcon pathValue={match.path} kind="file" theme={resolvedTheme} />,
        run: async () => onPick(key),
      };
    },
  );
  const searching = list.query.trim().length > 0;
  return (
    <CommandPaletteContent
      aria-label="Open a project file"
      escapeLabel="Close"
      footerActionLabel="Open file"
      inputProps={{
        placeholder: `Search ${repository.title}'s files…`,
        onKeyDown: (event) => {
          if (event.key === "Backspace" && list.query === "" && onBack) {
            event.preventDefault();
            onBack();
          }
        },
      }}
      showBackHint={onBack !== null}
      testId="repository-file-finder"
      {...list.contentProps}
    >
      <CommandPaletteResults
        groups={items.length > 0 ? [{ value: "files", label: repository.title, items }] : []}
        highlightedItemValue={list.highlighted}
        isActionsOnly={false}
        keybindings={list.keybindings}
        onExecuteItem={(item) => {
          if (item.kind === "action") void item.run();
        }}
        emptyStateMessage={
          result.error ??
          (result.isPending
            ? searching
              ? "Searching files…"
              : "Indexing files…"
            : searching
              ? "No matching files."
              : "No files found.")
        }
      />
    </CommandPaletteContent>
  );
}
