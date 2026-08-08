import type {
  MercurianProjectId,
  PlanId,
  TrackerConnectionId,
  TrackerIssue,
} from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { CircleDotIcon, ExternalLinkIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "../../lib/utils";
import { useImportPlan } from "../../state/mercurian";
import { useListTrackerIssues, useTrackers } from "../../state/mercurianTrackers";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Spinner } from "../ui/spinner";
import { stackedThreadToast, toastManager } from "../ui/toast";
import {
  appendIssuePage,
  buildIssuesRequest,
  describeImportOutcome,
  EMPTY_BROWSE,
  resolveConnectionId,
  type IssueBrowseState,
} from "./ImportIssueDialog.logic";
import { trackerName } from "./TrackersSettings.logic";

const SEARCH_DEBOUNCE_MS = 250;

/**
 * Browsing the connected trackers and importing an issue as a plan.
 *
 * Nothing here is stored. The issues live in this component's state for exactly
 * as long as the dialog is open and are read live from the tracker each time —
 * the tracker keeps the backlog, and Mercurian keeps the plans that people
 * chose to start.
 *
 * Importing is idempotent by origin, so all three outcomes end the same way:
 * you land in the plan. The two that were not a creation say so on the way.
 */
export function ImportIssueDialog({
  open,
  projectId,
  onOpenChange,
  onImported,
}: {
  readonly open: boolean;
  readonly projectId: MercurianProjectId;
  readonly onOpenChange: (open: boolean) => void;
  /** Where the caller goes once an issue has a plan. */
  readonly onImported: (planId: PlanId) => void;
}) {
  const { connections, isPending: connectionsPending, error: connectionsError } = useTrackers();
  const listTrackerIssues = useListTrackerIssues();
  const importPlan = useImportPlan();

  const [chosenConnectionId, setChosenConnectionId] = useState<TrackerConnectionId | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [browse, setBrowse] = useState<IssueBrowseState>(EMPTY_BROWSE);
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
  const [isBrowsing, setIsBrowsing] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [browseError, setBrowseError] = useState<string | null>(null);

  // A connection can be disconnected in another window while this is open, so
  // which one is being browsed is derived rather than remembered.
  const connectionId = resolveConnectionId(connections, chosenConnectionId);
  const selectedIssue = browse.issues.find((one) => one.id === selectedIssueId) ?? null;

  // Nothing survives the dialog: what was fetched dies with it.
  useEffect(() => {
    if (open) return;
    setChosenConnectionId(null);
    setSearch("");
    setDebouncedSearch("");
    setBrowse(EMPTY_BROWSE);
    setSelectedIssueId(null);
    setBrowseError(null);
    setIsImporting(false);
  }, [open]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [search]);

  /**
   * Which read is allowed to write the list. A search typed quickly fires
   * several, and only the newest one's answer is the answer.
   */
  const readGeneration = useRef(0);

  useEffect(() => {
    if (!open || connectionId === null) return;
    const generation = (readGeneration.current += 1);
    setIsBrowsing(true);
    setBrowseError(null);
    void listTrackerIssues(buildIssuesRequest({ connectionId, search: debouncedSearch })).then(
      (page) => {
        if (generation !== readGeneration.current) return;
        setIsBrowsing(false);
        if (page === null) {
          setBrowse(EMPTY_BROWSE);
          setBrowseError("Could not read issues from this tracker.");
          return;
        }
        setBrowse((current) => appendIssuePage(current, page, "replace"));
      },
    );
  }, [connectionId, debouncedSearch, listTrackerIssues, open]);

  const loadMore = useCallback(() => {
    if (connectionId === null || browse.nextCursor === undefined || isLoadingMore) return;
    const generation = readGeneration.current;
    setIsLoadingMore(true);
    void listTrackerIssues(
      buildIssuesRequest({ connectionId, search: debouncedSearch, cursor: browse.nextCursor }),
    ).then((page) => {
      // A search that landed while this page was in flight owns the list now.
      if (generation !== readGeneration.current) return;
      setIsLoadingMore(false);
      if (page === null) {
        setBrowseError("Could not read more issues from this tracker.");
        return;
      }
      setBrowse((current) => appendIssuePage(current, page, "append"));
    });
  }, [browse.nextCursor, connectionId, debouncedSearch, isLoadingMore, listTrackerIssues]);

  const handleImport = useCallback(async () => {
    if (connectionId === null || selectedIssue === null || isImporting) return;
    setIsImporting(true);
    const imported = await importPlan({ projectId, connectionId, issue: selectedIssue });
    setIsImporting(false);
    if (imported === null) return;

    const notice = describeImportOutcome(imported.outcome);
    if (notice !== null) {
      toastManager.add(
        stackedThreadToast({ type: "info", title: notice.title, description: notice.description }),
      );
    }
    onOpenChange(false);
    onImported(imported.detail.plan.planId);
  }, [connectionId, importPlan, isImporting, onImported, onOpenChange, projectId, selectedIssue]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Import an issue</DialogTitle>
          <DialogDescription>
            Issues are read from the tracker as you browse. Importing one starts a plan from it —
            nothing else is stored, and nothing is written back.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-3">
          {connectionsError !== null ? (
            <p role="alert" className="text-[13px] leading-[1.45] text-destructive-foreground">
              {connectionsError}
            </p>
          ) : connectionsPending ? (
            <p className="text-[13px] text-muted-foreground/80">Looking for connected trackers…</p>
          ) : connections.length === 0 ? (
            <NoConnections onNavigate={() => onOpenChange(false)} />
          ) : (
            <>
              {connections.length === 1 ? null : (
                <div className="flex flex-wrap gap-2">
                  {connections.map((one) => (
                    <Button
                      key={one.connectionId}
                      type="button"
                      size="xs"
                      variant={one.connectionId === connectionId ? "default" : "outline"}
                      onClick={() => {
                        setChosenConnectionId(one.connectionId);
                        setBrowse(EMPTY_BROWSE);
                        setSelectedIssueId(null);
                      }}
                    >
                      {trackerName(one.kind)} · {one.label}
                    </Button>
                  ))}
                </div>
              )}
              {connectionId === null ? (
                <p className="text-[13px] text-muted-foreground/80">
                  Pick a tracker to browse its issues.
                </p>
              ) : (
                <>
                  <Input
                    aria-label="Search issues"
                    autoComplete="off"
                    placeholder="Search issues"
                    spellCheck={false}
                    value={search}
                    onChange={(event) => setSearch(event.currentTarget.value)}
                  />
                  <IssueList
                    browse={browse}
                    isBrowsing={isBrowsing}
                    isLoadingMore={isLoadingMore}
                    selectedIssueId={selectedIssueId}
                    onLoadMore={loadMore}
                    onSelect={setSelectedIssueId}
                  />
                </>
              )}
              {browseError === null ? null : (
                <p role="alert" className="text-[13px] leading-[1.45] text-destructive-foreground">
                  {browseError}
                </p>
              )}
            </>
          )}
        </DialogPanel>
        <DialogFooter variant="bare">
          <Button variant="outline" disabled={isImporting} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={selectedIssue === null || isImporting}
            onClick={() => void handleImport()}
          >
            {isImporting ? (
              <>
                <Spinner className="size-3.5" />
                Importing…
              </>
            ) : (
              "Import"
            )}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

/**
 * The way in, when there is no way in yet. A dead Import button with nothing
 * behind it would be a one-way door; this says what trackers are for and points
 * at the page that connects one.
 */
function NoConnections({ onNavigate }: { readonly onNavigate: () => void }) {
  return (
    <div className="space-y-2 py-2">
      <p className="text-[13px] leading-[1.45] text-muted-foreground/85">
        No trackers are connected yet. Connect one and its issues can become the starting points of
        plans.
      </p>
      <Button
        render={<Link to="/settings/trackers" />}
        size="xs"
        variant="outline"
        onClick={onNavigate}
      >
        Go to Settings → Trackers
      </Button>
    </div>
  );
}

function IssueList({
  browse,
  isBrowsing,
  isLoadingMore,
  selectedIssueId,
  onLoadMore,
  onSelect,
}: {
  readonly browse: IssueBrowseState;
  readonly isBrowsing: boolean;
  readonly isLoadingMore: boolean;
  readonly selectedIssueId: string | null;
  readonly onLoadMore: () => void;
  readonly onSelect: (issueId: string) => void;
}) {
  if (isBrowsing && browse.issues.length === 0) {
    return <p className="py-6 text-center text-[13px] text-muted-foreground/80">Reading issues…</p>;
  }
  if (browse.issues.length === 0) {
    return (
      <p className="py-6 text-center text-[13px] text-muted-foreground/80">
        No issues matched. The tracker decides what a search finds.
      </p>
    );
  }

  return (
    <div className="max-h-80 overflow-y-auto rounded-md border border-border/60">
      <ul>
        {browse.issues.map((issue) => (
          <li key={issue.id}>
            <IssueRow
              issue={issue}
              isSelected={issue.id === selectedIssueId}
              onSelect={() => onSelect(issue.id)}
            />
          </li>
        ))}
      </ul>
      {browse.nextCursor === undefined ? null : (
        <div className="border-t border-border/60 p-2">
          <Button
            className="w-full"
            size="xs"
            variant="ghost"
            disabled={isLoadingMore}
            onClick={onLoadMore}
          >
            {isLoadingMore ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}
    </div>
  );
}

function IssueRow({
  issue,
  isSelected,
  onSelect,
}: {
  readonly issue: TrackerIssue;
  readonly isSelected: boolean;
  readonly onSelect: () => void;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 border-b border-border/40 px-2 py-1.5 last:border-b-0",
        isSelected && "bg-accent",
      )}
    >
      <button
        aria-current={isSelected ? "true" : undefined}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 text-left ring-ring outline-hidden focus-visible:ring-2"
        type="button"
        onClick={onSelect}
      >
        <CircleDotIcon className="size-3.5 shrink-0 text-muted-foreground/70" />
        <span className="min-w-0 flex-1 truncate text-sm text-foreground">{issue.title}</span>
        <span className="shrink-0 text-[11px] text-muted-foreground/70">{issue.id}</span>
        {/* The tracker's own status word, uninterpreted. */}
        <span className="shrink-0 text-[11px] text-muted-foreground/70">{issue.status}</span>
      </button>
      {/* The origin is one click away, which is where everything this dialog
          does not show still lives. */}
      <a
        aria-label={`Open ${issue.id} in the tracker`}
        className="shrink-0 rounded-md p-1 text-muted-foreground/70 hover:text-foreground"
        href={issue.url}
        rel="noreferrer"
        target="_blank"
      >
        <ExternalLinkIcon className="size-3.5" />
      </a>
    </div>
  );
}
