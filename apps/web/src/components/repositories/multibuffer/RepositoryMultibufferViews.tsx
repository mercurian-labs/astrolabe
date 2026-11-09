import { RegistryContext, useAtomMount } from "@effect/atom-react";
import { matchHighlight, problemMarks } from "@mercurian/editor/multibuffer/highlights";
import type { MultibufferFile } from "@mercurian/editor/multibuffer";
import { isWholeWord, textMatcher } from "@t3tools/shared/textReplace";
import type { FileDiagnostics } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { RefreshCwIcon } from "lucide-react";
import { type ReactNode, useContext, useEffect, useState, useSyncExternalStore } from "react";

import { useStableCallback } from "~/hooks/useStableCallback";
import { openTab } from "~/panes/arrangement";
import { recordJump } from "~/panes/jumpHistory";
import { PanesHostContext } from "~/panes/panesHost";
import { languageServersEnvironment } from "~/state/languageServers";
import { projectContentSearchPage } from "~/state/projects";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Spinner } from "../../ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../ui/tooltip";
import { repositoryFileReveal } from "../repositoryFileReveal";
import { workspace } from "~/panes/workspace";
import {
  repositoryTabKey,
  type RepositoryLocationsTab,
  type RepositoryProblemsTab,
  type RepositorySearchTab,
} from "../repositoryTabs";
import { MultibufferView } from "./MultibufferView";
import { locationFiles, problemCounts, problemFiles, searchFiles } from "./multibufferInputs";
import { type LocationList, locationList } from "./openMultibuffer";
import { replaceAll, type ReplaceAllDone } from "./replaceAll";
import { newClientId, useMultibuffer, type MultibufferSaveState } from "./useMultibuffer";

/**
 * Astrolabe: the Repositories area's multi-file views: a project search's results (with
 * replace-all), a checkout's problems, and a list of places. Each is a `MultibufferView` over
 * the checkout's live documents.
 */

/** Matches a search tab gathers before it stops and says there are more. */
const SEARCH_MATCH_CAP = 5000;
/** Above this many files, replace-all asks first. */
const REPLACE_CONFIRM_FILES = 10;

type Checkout = Pick<RepositorySearchTab, "environmentId" | "projectId" | "cwd">;

/** Opens a file of the checkout at a line, in the panes the view is in. */
function useOpenFile(tabKey: string, checkout: Checkout) {
  const panes = useContext(PanesHostContext)?.controller ?? workspace.store;
  return (path: string, line: number) => {
    const { environmentId, projectId, cwd } = checkout;
    const key = repositoryTabKey({
      kind: "file",
      environmentId,
      projectId,
      checkout: { cwd },
      path,
    });
    recordJump(tabKey, key);
    panes.update((next) => openTab(next, key));
    repositoryFileReveal.request(key, line);
  };
}

function Toolbar({ children }: { readonly children: ReactNode }) {
  return (
    <div className="flex min-h-8 shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-1 text-xs text-muted-foreground">
      {children}
    </div>
  );
}

function saveLabel(state: MultibufferSaveState, readOnly: boolean): string {
  if (readOnly) return "Read only";
  if (state.unsent > 0) return "Not saved";
  return state.unsaved > 0 ? "Saving…" : "Saved";
}

function Notice({ children }: { readonly children: ReactNode }) {
  return (
    <p role="status" className="px-4 py-6 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count.toLocaleString()} ${count === 1 ? one : many}`;

export function RepositorySearchView({
  tabKey,
  tab,
}: {
  readonly tabKey: string;
  readonly tab: RepositorySearchTab;
}) {
  const { environmentId, cwd, search } = tab;
  const registry = useContext(RegistryContext);
  const openFile = useOpenFile(tabKey, tab);
  const { multibuffer, canWrite, saveState } = useMultibuffer({
    tabKey,
    environmentId,
    cwd,
    openFile,
  });
  const [state, setState] = useState<{
    readonly status: "searching" | "done" | "failed";
    readonly matches: number;
    readonly files: number;
    readonly truncated: boolean;
    readonly message: string | null;
  }>({ status: "searching", matches: 0, files: 0, truncated: false, message: null });
  const [run, setRun] = useState(0);
  const [replacement, setReplacement] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [done, setDone] = useState<ReplaceAllDone | null>(null);
  const [report, setReport] = useState<string | null>(null);
  const [clientId] = useState(() => `replace-${newClientId()}`);
  const [highlight] = useState(() => {
    const matcher = textMatcher(search);
    if (matcher.error !== null) return () => [];
    const extension = matchHighlight(
      matcher.regex,
      search.wholeWord ? (line, start, end) => isWholeWord(line, start, end) : undefined,
    );
    return () => extension;
  });

  // Every page of the search, gathered once per run; the excerpts then stay live by themselves.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- runs the project search the tab names, again on refresh
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const matches = [];
      let cursor: string | undefined;
      do {
        const result = await projectContentSearchPage.run(registry, {
          environmentId,
          input: {
            cwd,
            query: search.query,
            limit: 500,
            caseSensitive: search.caseSensitive,
            wholeWord: search.wholeWord,
            useRegex: search.useRegex,
            contextLines: 2,
            ...(search.include ? { include: search.include } : {}),
            ...(search.exclude ? { exclude: search.exclude } : {}),
            ...(search.includeIgnored ? { includeIgnored: true } : {}),
            ...(cursor === undefined ? {} : { cursor }),
          },
        });
        if (cancelled) return;
        if (!AsyncResult.isSuccess(result)) {
          setState((current) => ({ ...current, status: "failed", message: "Searching failed." }));
          return;
        }
        matches.push(...result.value.matches);
        cursor = result.value.nextCursor;
      } while (cursor !== undefined && matches.length < SEARCH_MATCH_CAP);
      const files = searchFiles(matches);
      multibuffer.set(files);
      setState({
        status: "done",
        matches: matches.length,
        files: files.length,
        truncated: cursor !== undefined,
        message: null,
      });
    })();
    return () => {
      cancelled = true;
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- the refresh button searches again by bumping `run`
  }, [registry, environmentId, cwd, search, multibuffer, run]);

  const startReplace = useStableCallback(async () => {
    setConfirming(false);
    setReplacing(true);
    setReport(null);
    const result = await replaceAll({
      registry,
      environmentId,
      cwd,
      clientId,
      query: search,
      replacement,
      paths: multibuffer.fileList().map((file) => file.path),
    });
    setReplacing(false);
    if (!result.ok) {
      setReport(result.message);
      return;
    }
    setDone(result.done);
    const failed = result.done.failed.length;
    setReport(
      `Replaced ${plural(result.done.replacements, "match", "matches")} in ${plural(result.done.files, "file")}.${
        failed > 0 ? ` ${plural(failed, "file")} could not be changed.` : ""
      }`,
    );
  });
  const replaceClicked = () => {
    if (multibuffer.fileList().length > REPLACE_CONFIRM_FILES) setConfirming(true);
    else void startReplace();
  };
  const searchAgain = () => {
    setState((current) => ({ ...current, status: "searching", message: null }));
    setRun((count) => count + 1);
  };
  const undo = async () => {
    const record = done;
    if (record === null) return;
    setDone(null);
    setReport((await record.undo()) ?? "Replace-all undone.");
    searchAgain();
  };

  const readOnly = !canWrite;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Toolbar>
        <span className="min-w-0 truncate">
          {state.status === "searching" ? (
            <span className="flex items-center gap-2">
              <Spinner size="sm" /> Searching for “{search.query}”…
            </span>
          ) : state.status === "failed" ? (
            <span className="text-destructive-foreground">{state.message}</span>
          ) : (
            `${plural(state.matches, "result")}${state.truncated ? "+" : ""} for “${search.query}” in ${plural(state.files, "file")}`
          )}
        </span>
        <Button
          aria-label="Search again"
          size="icon-xs"
          variant="ghost-muted"
          onClick={searchAgain}
        >
          <RefreshCwIcon />
        </Button>
        <span className="ml-auto shrink-0">{saveLabel(saveState, readOnly)}</span>
      </Toolbar>
      {readOnly ? null : (
        <Toolbar>
          <Input
            aria-label="Replace with"
            className="min-w-40 flex-1"
            placeholder={search.useRegex ? "Replace with ($1 for groups)" : "Replace with"}
            size="compact"
            value={replacement}
            onChange={(event) => setReplacement(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                replaceClicked();
              }
            }}
          />
          {confirming ? (
            <>
              <span>{`Replace in ${plural(multibuffer.fileList().length, "file")}?`}</span>
              <Button size="xs" variant="outline" onClick={() => void startReplace()}>
                Replace all
              </Button>
              <Button size="xs" variant="ghost" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button
              size="xs"
              variant="outline"
              disabled={replacing || state.status !== "done" || state.files === 0}
              onClick={replaceClicked}
            >
              {replacing ? <Spinner size="sm" /> : "Replace all"}
            </Button>
          )}
          {done !== null ? (
            <Button size="xs" variant="ghost" onClick={() => void undo()}>
              Undo replace-all
            </Button>
          ) : null}
          {report !== null ? <span className="min-w-0 truncate">{report}</span> : null}
        </Toolbar>
      )}
      <MultibufferView
        multibuffer={multibuffer}
        environmentId={environmentId}
        cwd={cwd}
        readOnly={readOnly}
        extensions={highlight}
        empty={state.status === "done" ? <Notice>No results.</Notice> : null}
      />
    </div>
  );
}

export function RepositoryProblemsView({
  tabKey,
  tab,
}: {
  readonly tabKey: string;
  readonly tab: RepositoryProblemsTab;
}) {
  const { environmentId, cwd } = tab;
  const openFile = useOpenFile(tabKey, tab);
  const { multibuffer, canWrite, saveState } = useMultibuffer({
    tabKey,
    environmentId,
    cwd,
    openFile,
  });
  const [files, setFiles] = useState<ReadonlyMap<string, FileDiagnostics>>(new Map());
  const [follow] = useState(() =>
    languageServersEnvironment.problems(environmentId, cwd, (item) => {
      setFiles((current) => {
        if (item.type === "snapshot") return new Map(item.files.map((file) => [file.path, file]));
        const next = new Map(current);
        if (item.file.diagnostics.length === 0) next.delete(item.file.path);
        else next.set(item.file.path, item.file);
        return next;
      });
    }),
  );
  useAtomMount(follow);
  const inputs = problemFiles(files.values());
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- hands each problems update to the excerpts' model, outside render
  useEffect(() => multibuffer.set(problemFiles(files.values())), [multibuffer, files]);
  // A new function per update, so each excerpt redraws its file's problems.
  const marks = (file: MultibufferFile) => problemMarks(files.get(file.path)?.diagnostics ?? []);
  let errors = 0;
  let warnings = 0;
  for (const input of inputs) {
    errors += input.counts.errors;
    warnings += input.counts.warnings;
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Toolbar>
        <span>
          {inputs.length === 0
            ? "No problems in the files language servers have checked"
            : `${plural(errors, "error")}, ${plural(warnings, "warning")} in ${plural(inputs.length, "file")}`}
        </span>
        <span className="ml-auto shrink-0">{saveLabel(saveState, !canWrite)}</span>
      </Toolbar>
      <MultibufferView
        multibuffer={multibuffer}
        environmentId={environmentId}
        cwd={cwd}
        readOnly={!canWrite}
        extensions={marks}
        renderHeaderExtra={(file) => <ProblemCountsLabel diagnostics={files.get(file.path)} />}
        empty={
          <Notice>
            Problems show here for files a language server has open: open a file, or let an agent
            check one.
          </Notice>
        }
      />
    </div>
  );
}

function ProblemCountsLabel({
  diagnostics,
}: {
  readonly diagnostics: FileDiagnostics | undefined;
}) {
  if (diagnostics === undefined) return null;
  const counts = problemCounts(diagnostics);
  return (
    <span className="tabular-nums text-muted-foreground">
      {[
        counts.errors > 0 ? plural(counts.errors, "error") : null,
        counts.warnings > 0 ? plural(counts.warnings, "warning") : null,
        counts.other > 0 ? `${counts.other.toLocaleString()} other` : null,
      ]
        .filter(Boolean)
        .join(", ")}
    </span>
  );
}

function editedPlaces(edit: NonNullable<LocationList["edit"]>, listed: number) {
  const all = `${plural(edit.edits, "place")} in ${plural(edit.files, "file")}`;
  return listed < edit.edits ? `${all}, the first ${listed.toLocaleString()} shown` : all;
}

function UndoEdit({ edit }: { readonly edit: NonNullable<LocationList["edit"]> }) {
  const state = useSyncExternalStore(edit.undo.subscribe, edit.undo.state);
  if (state === "undone") return <span className="shrink-0">Undone</span>;
  if (state === "failed") return <span className="shrink-0">Could not be undone</span>;
  if (state === "partly") {
    const skipped = edit.undo.skipped();
    return (
      <Tooltip>
        <TooltipTrigger render={<span className="shrink-0" />}>
          {`Undone, except ${plural(skipped.length, "file")} changed since`}
        </TooltipTrigger>
        <TooltipPopup>
          {skipped.map((path) => (
            <div key={path} className="text-xs">
              {path}
            </div>
          ))}
        </TooltipPopup>
      </Tooltip>
    );
  }
  return (
    <Button
      size="xs"
      variant="outline"
      disabled={state === "undoing"}
      onClick={() => edit.undo.run()}
    >
      {edit.undoLabel}
    </Button>
  );
}

export function RepositoryLocationsView({
  tabKey,
  tab,
}: {
  readonly tabKey: string;
  readonly tab: RepositoryLocationsTab;
}) {
  const { environmentId, cwd } = tab;
  const openFile = useOpenFile(tabKey, tab);
  const { multibuffer, canWrite, saveState } = useMultibuffer({
    tabKey,
    environmentId,
    cwd,
    openFile,
  });
  const [list] = useState(() => {
    const found = locationList(tab.id);
    // Before the list subscribes: the excerpts are there on its first render.
    if (found !== null) multibuffer.set(locationFiles(found.locations));
    return found;
  });
  if (list === null) return <Notice>These places are no longer listed. Look them up again.</Notice>;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Toolbar>
        <span className="min-w-0 truncate">
          {`${list.title} · ${list.edit ? editedPlaces(list.edit, list.locations.length) : plural(list.locations.length, "place")}`}
        </span>
        {list.edit ? <UndoEdit edit={list.edit} /> : null}
        <span className="ml-auto shrink-0">{saveLabel(saveState, !canWrite)}</span>
      </Toolbar>
      <MultibufferView
        multibuffer={multibuffer}
        environmentId={environmentId}
        cwd={cwd}
        readOnly={!canWrite}
        empty={<Notice>No places.</Notice>}
      />
    </div>
  );
}
