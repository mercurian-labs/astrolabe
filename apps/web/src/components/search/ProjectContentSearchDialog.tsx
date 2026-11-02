import { Spinner } from "~/components/ui/spinner";
import { AuthFilesystemReadScope, type ProjectContentMatch } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import { ListFilterIcon } from "lucide-react";

import { useState, type KeyboardEvent, type ReactNode } from "react";

import { useActiveProjectTarget } from "~/hooks/useActiveProjectTarget";
import { useWorkspaceFocusedKey } from "~/panes/workspace";
import { useProjects } from "~/state/entities";
import { useRenderedAppearance, useTheme } from "~/hooks/useTheme";
import { cn } from "~/lib/utils";
import { useProjectContentSearch } from "~/state/queries";
import { readEnvironmentScope } from "~/state/session";
import { resolveShortcutCommand, shortcutLabelForCommand } from "~/keybindings";
import { primaryServerKeybindingsAtom } from "~/state/server";

import { PierreEntryIcon } from "../chat/PierreEntryIcon";
import { CommandPaletteContent } from "../CommandPaletteContent";
import { openRepositoryFileAtLine } from "../repositories/openInRepositories";
import { openSearchResults } from "../repositories/multibuffer/openMultibuffer";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { ScrollArea } from "../ui/scroll-area";
import { Toggle } from "../ui/toggle";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { HighlightedSearchLine } from "./HighlightedSearchLine";
import {
  focusedCheckoutTarget,
  groupContentSearchMatches,
  type ContentSearchTarget,
} from "./projectContentSearch.logic";

interface ProjectContentSearchDialogProps {
  readonly onOpenChange: (open: boolean) => void;
}

/** Syntax-highlighting all 500 result rows at once stalls the UI. */
const VISIBLE_MATCH_WINDOW = 100;
const CONTEXT_LINES = 2;

function splitPath(path: string): { readonly name: string; readonly directory: string } {
  const separator = path.lastIndexOf("/");
  return separator === -1
    ? { name: path, directory: "" }
    : { name: path.slice(separator + 1), directory: path.slice(0, separator) };
}

function SearchOptionButton(props: {
  readonly active: boolean;
  readonly disabled: boolean;
  readonly label: string;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Toggle
            aria-label={props.label}
            disabled={props.disabled}
            pressed={props.active}
            size="segmented"
            variant="segmented"
            onClick={props.onClick}
          />
        }
      >
        <span className="font-mono">{props.children}</span>
      </TooltipTrigger>
      <TooltipPopup side="top">{props.label}</TooltipPopup>
    </Tooltip>
  );
}

function EmptyContentSearchDialog() {
  return (
    <CommandPaletteContent
      aria-label="Search project contents"
      escapeLabel="Back"
      footerActionLabel="Open file"
      inputProps={{ disabled: true, placeholder: "Search project contents…" }}
      mode="none"
      panelSize="fill"
      testId="project-content-search"
      value=""
    >
      <p className="m-auto px-6 text-center text-muted-foreground text-sm">
        Open a project to search its files.
      </p>
    </CommandPaletteContent>
  );
}

const scrollSelectedRowIntoView = (row: HTMLElement | null) => {
  row?.scrollIntoView({ block: "nearest" });
};

function OpenContentSearchDialog(props: {
  readonly onOpenChange: (open: boolean) => void;
  readonly target: ContentSearchTarget;
}) {
  const { target } = props;
  const { resolvedTheme } = useTheme();
  const renderedAppearance = useRenderedAppearance();
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [include, setInclude] = useState("");
  const [exclude, setExclude] = useState("");
  const [includeIgnored, setIncludeIgnored] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const navigate = useNavigate();

  const [visibleCount, setVisibleCount] = useState(VISIBLE_MATCH_WINDOW);

  // Hidden filters don't apply, whatever their fields hold.
  const search = useProjectContentSearch({
    environmentId: target.environmentId,
    cwd: target.cwd,
    query,
    caseSensitive,
    wholeWord,
    useRegex,
    contextLines: CONTEXT_LINES,
    ...(showFilters ? { include, exclude, includeIgnored } : {}),
  });
  const canOpenMatches = search.canReadFiles && !search.isPending && search.error === null;
  const matches = search.matches;
  const [resultsFor, setResultsFor] = useState(search.searchKey);
  if (resultsFor !== search.searchKey) {
    setResultsFor(search.searchKey);
    setSelectedIndex(0);
    setVisibleCount(VISIBLE_MATCH_WINDOW);
  }
  if (selectedIndex >= visibleCount) {
    setVisibleCount(selectedIndex + VISIBLE_MATCH_WINDOW);
  }
  const visibleMatches = matches.slice(0, visibleCount);
  const groups = groupContentSearchMatches(visibleMatches);
  const filtersActive =
    showFilters && (include.trim() !== "" || exclude.trim() !== "" || includeIgnored);

  const observeLoadMoreSentinel = (sentinel: HTMLElement | null) => {
    if (!sentinel) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisibleCount((current) => current + VISIBLE_MATCH_WINDOW);
      }
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  };

  const openMatch = (match: ProjectContentMatch) => {
    if (!canOpenMatches || !readEnvironmentScope(target.environmentId, AuthFilesystemReadScope)) {
      return;
    }
    props.onOpenChange(false);
    openRepositoryFileAtLine(
      {
        environmentId: target.environmentId,
        projectId: target.projectId,
        cwd: target.cwd,
        worktreePath: target.worktreePath,
        path: match.path,
        line: match.lineNumber,
      },
      navigate,
    );
  };
  // Astrolabe: every result as one editor of excerpts, in the Repositories area.
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const openInEditorContext = { context: { projectSearchFocus: true } };
  const openInEditorLabel = shortcutLabelForCommand(
    keybindings,
    "projectSearch.openInEditor",
    openInEditorContext,
  );
  const openInEditor = () => {
    if (!canOpenMatches || matches.length === 0) return;
    if (!readEnvironmentScope(target.environmentId, AuthFilesystemReadScope)) return;
    props.onOpenChange(false);
    openSearchResults(
      target,
      {
        query,
        caseSensitive,
        wholeWord,
        useRegex,
        ...(showFilters && include.trim() !== "" ? { include } : {}),
        ...(showFilters && exclude.trim() !== "" ? { exclude } : {}),
        ...(showFilters && includeIgnored ? { includeIgnored: true } : {}),
      },
      navigate,
    );
  };
  const handleListKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (
      resolveShortcutCommand(event.nativeEvent, keybindings, openInEditorContext) ===
      "projectSearch.openInEditor"
    ) {
      event.preventDefault();
      openInEditor();
      return;
    }
    if (event.key === "ArrowDown" && matches.length > 0) {
      event.preventDefault();
      setSelectedIndex((current) => (current + 1) % matches.length);
    } else if (event.key === "ArrowUp" && matches.length > 0) {
      event.preventDefault();
      setSelectedIndex((current) => (current - 1 + matches.length) % matches.length);
    } else if (event.key === "Enter") {
      if (!canOpenMatches) {
        event.preventDefault();
        return;
      }
      const match = matches[selectedIndex];
      if (match) {
        event.preventDefault();
        openMatch(match);
      }
    }
  };
  const fileCount = new Set(matches.map((match) => match.path)).size;
  const showSearchStatus =
    search.canReadFiles &&
    (search.hasQuery || search.isPending || search.error !== null || search.invalidRegex);

  return (
    <CommandPaletteContent
      aria-label={`Search file contents in ${target.projectName}`}
      escapeLabel="Back"
      footerActionLabel="Open file"
      inputAccessory={
        <div className="absolute inset-e-2.5 top-1/2 flex shrink-0 -translate-y-1/2 items-center gap-0.5 rounded-lg border bg-muted/30 p-0.5">
          <SearchOptionButton
            active={caseSensitive}
            disabled={!search.canReadFiles}
            label="Match case"
            onClick={() => setCaseSensitive((current) => !current)}
          >
            Aa
          </SearchOptionButton>
          <SearchOptionButton
            active={wholeWord}
            disabled={!search.canReadFiles}
            label="Match whole word"
            onClick={() => setWholeWord((current) => !current)}
          >
            <span className="underline decoration-2 underline-offset-2">ab</span>
          </SearchOptionButton>
          <SearchOptionButton
            active={useRegex}
            disabled={!search.canReadFiles}
            label="Use regular expression"
            onClick={() => setUseRegex((current) => !current)}
          >
            .*
          </SearchOptionButton>
          <SearchOptionButton
            active={showFilters}
            disabled={!search.canReadFiles}
            label={filtersActive ? "Filters (on)" : "Filters"}
            onClick={() => setShowFilters((current) => !current)}
          >
            <ListFilterIcon className={cn("size-3.5", filtersActive && "text-primary")} />
          </SearchOptionButton>
        </div>
      }
      inputProps={{
        className: "pe-38",
        disabled: !search.canReadFiles,
        placeholder: `Search in ${target.projectName}`,
        onKeyDown: handleListKeyDown,
      }}
      mode="none"
      onValueChange={setQuery}
      panelSize="fill"
      testId="project-content-search"
      value={query}
    >
      {showFilters ? (
        <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
          <Input
            aria-label="Files to include"
            className="min-w-0 flex-1"
            disabled={!search.canReadFiles}
            onChange={(event) => setInclude(event.target.value)}
            onKeyDown={handleListKeyDown}
            placeholder="Include: e.g. src/**/*.ts"
            size="compact"
            value={include}
          />
          <Input
            aria-label="Files to exclude"
            className="min-w-0 flex-1"
            disabled={!search.canReadFiles}
            onChange={(event) => setExclude(event.target.value)}
            onKeyDown={handleListKeyDown}
            placeholder="Exclude: e.g. vendor/*, *.lock"
            size="compact"
            value={exclude}
          />
          <Toggle
            aria-label="Include gitignored files"
            disabled={!search.canReadFiles}
            pressed={includeIgnored}
            size="compact"
            variant="outline"
            onClick={() => setIncludeIgnored((current) => !current)}
          >
            <span className="px-1">Ignored files</span>
          </Toggle>
        </div>
      ) : null}
      {showSearchStatus ? (
        <div className="flex h-9 shrink-0 items-center border-b px-3 text-xs text-muted-foreground">
          {search.isPending ? (
            <span className="flex items-center gap-2">
              <Spinner size="sm" /> Searching…
            </span>
          ) : search.error ? (
            <span className="text-destructive">{search.error}</span>
          ) : search.invalidRegex ? (
            <span className="text-destructive">Invalid regular expression</span>
          ) : (
            <span className="flex items-center gap-2">
              {`${matches.length.toLocaleString()}${search.limited ? "+" : ""} results in ${fileCount.toLocaleString()} files${search.truncated && !search.limited ? " so far" : ""}`}
              {search.isLoadingMore ? <Spinner size="sm" /> : null}
            </span>
          )}
          {matches.length > 0 && canOpenMatches ? (
            <Button className="ml-auto" size="compact" variant="ghost-muted" onClick={openInEditor}>
              Open results in editor
              {openInEditorLabel ? (
                <span className="text-muted-foreground">{openInEditorLabel}</span>
              ) : null}
            </Button>
          ) : null}
        </div>
      ) : null}

      {matches.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
          {search.isCheckingAccess
            ? "Checking file access…"
            : !search.canReadFiles
              ? search.error
              : search.hasQuery && !search.isPending && !search.error
                ? "No results found."
                : "Type to search across your project."}
        </div>
      ) : (
        <ScrollArea className="min-h-0 flex-1" scrollFade>
          <div className="py-2">
            {groups.map((group) => {
              const path = splitPath(group.path);
              return (
                <section className="pb-2" key={group.path}>
                  <div className="sticky top-0 z-10 flex h-8 items-center gap-2 bg-popover/95 px-3 text-xs backdrop-blur-sm">
                    <PierreEntryIcon
                      pathValue={group.path}
                      kind="file"
                      theme={resolvedTheme}
                      className="size-3.5"
                    />
                    <span className="font-medium text-foreground">{path.name}</span>
                    {path.directory ? (
                      <span className="min-w-0 truncate text-muted-foreground">
                        {path.directory}
                      </span>
                    ) : null}
                    <span className="ml-auto rounded-full bg-muted px-1.5 py-0.5 tabular-nums text-3xs text-muted-foreground">
                      {group.matchCount}
                    </span>
                  </div>
                  {group.rows.map((row) => {
                    if (row.kind === "gap") {
                      return (
                        <div
                          aria-hidden="true"
                          className="mx-3 my-1 border-t border-dashed border-border/60"
                          key={`gap:${row.lineNumber}`}
                        />
                      );
                    }
                    if (row.kind === "context") {
                      return (
                        <div
                          className="flex h-6 w-full min-w-0 items-center gap-3 px-3 font-mono text-xs text-muted-foreground/70"
                          key={`context:${row.lineNumber}`}
                        >
                          <span className="w-10 shrink-0 text-right tabular-nums text-muted-foreground/50">
                            {row.lineNumber}
                          </span>
                          <span className="min-w-0 flex-1 truncate whitespace-pre">{row.text}</span>
                        </div>
                      );
                    }
                    const { match } = row;
                    return (
                      <button
                        type="button"
                        key={`${match.path}:${match.lineNumber}:${match.resultIndex}`}
                        ref={
                          match.resultIndex === selectedIndex
                            ? scrollSelectedRowIntoView
                            : undefined
                        }
                        className={cn(
                          "flex h-7 w-full min-w-0 items-center gap-3 px-3 text-left font-mono text-xs hover:bg-accent/60 disabled:pointer-events-none",
                          match.resultIndex === selectedIndex && "bg-accent text-accent-foreground",
                        )}
                        disabled={!canOpenMatches}
                        onMouseEnter={() => setSelectedIndex(match.resultIndex)}
                        onClick={() => openMatch(match)}
                      >
                        <span className="w-10 shrink-0 text-right tabular-nums text-muted-foreground/70">
                          {match.lineNumber}
                        </span>
                        <span className="min-w-0 flex-1 truncate whitespace-pre">
                          <HighlightedSearchLine
                            match={match}
                            path={group.path}
                            theme={renderedAppearance}
                          />
                        </span>
                      </button>
                    );
                  })}
                </section>
              );
            })}
            {matches.length > visibleCount ? (
              <div ref={observeLoadMoreSentinel} className="h-8" aria-hidden="true" />
            ) : search.canLoadMore || search.isLoadingMore ? (
              <div className="flex justify-center py-2">
                <Button
                  disabled={search.isLoadingMore}
                  onClick={search.loadMore}
                  size="compact"
                  variant="ghost-muted"
                >
                  {search.isLoadingMore ? (
                    <Spinner size="sm" />
                  ) : search.limited ? (
                    "Load more results"
                  ) : (
                    "Keep searching"
                  )}
                </Button>
              </div>
            ) : null}
          </div>
        </ScrollArea>
      )}
    </CommandPaletteContent>
  );
}

export function ProjectContentSearchDialog(props: ProjectContentSearchDialogProps) {
  const thread = useActiveProjectTarget();
  const inFront = focusedCheckoutTarget(useWorkspaceFocusedKey(), useProjects());
  const active: ContentSearchTarget | null = inFront ?? thread;
  // Astrolabe: opening a match leaves the thread while the palette closes; swapping to the empty
  // dialog then would drop the focused field, and the closing dialog would take focus back.
  const [opened, setOpened] = useState(active);
  if (opened === null && active !== null) setOpened(active);
  const target = opened ?? active;

  return target ? (
    <OpenContentSearchDialog
      key={`${target.environmentId}:${target.cwd}`}
      onOpenChange={props.onOpenChange}
      target={target}
    />
  ) : (
    <EmptyContentSearchDialog />
  );
}
