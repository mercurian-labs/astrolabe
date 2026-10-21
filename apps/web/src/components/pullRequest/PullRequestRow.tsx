import type { PullRequestAction } from "@t3tools/contracts";
import { sourceControlClients } from "@t3tools/client-runtime/source-control-clients";
import { SearchIcon } from "lucide-react";
import { PullRequestChangeBreakdownStat } from "./PullRequestChangeBreakdownStat";
import { PullRequestStackPopover } from "./PullRequestStackPopover";
import {
  PullRequestSpeedActions,
  type PullRequestSpeedActionResult,
} from "./PullRequestSpeedActions";
import { memo, type RefCallback } from "react";

import { cn } from "~/lib/utils";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { getSourceControlPresentationForKind } from "~/sourceControlPresentation";

import {
  SIDEBAR_ROW_ACTIVE_CLASS,
  SIDEBAR_ROW_IDLE_CLASS,
  SIDEBAR_ROW_SURFACE_CLASS,
  SidebarCardContent,
  SidebarCardFooter,
  SidebarCardHeader,
  SIDEBAR_CARD_ITEM_CLASS,
  SidebarCardTitle,
} from "../sidebar/SidebarCard";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { PullRequestChecksPopover } from "./PullRequestChecksPopover";
import type { EnvironmentPullRequestEntry } from "./pullRequestList.logic";
import { openOnHostLabel, showPullRequestLinkContextMenu } from "./pullRequestLinkContextMenu";
import {
  PULL_REQUEST_ROW_CLASS,
  PULL_REQUEST_ROW_NUMBER_CLASS,
  PullRequestRowAuthor,
  PullRequestRowGlyph,
  PullRequestRowLines,
} from "./PullRequestListRow";
import { PullRequestLabelChip, PullRequestReviewDecisionGlyph } from "./pullRequestPresentation";

const LABEL_SLOTS = [
  { overflow: "@xl/pr-row-meta:hidden" },
  { overflow: "@3xl/pr-row-meta:hidden" },
  { overflow: "" },
] as const;

function PullRequestRowLabels({ labels }: { labels: EnvironmentPullRequestEntry["labels"] }) {
  if (labels.length === 0) return null;
  return (
    <span className="flex min-w-0 items-center gap-1">
      {LABEL_SLOTS.map((slot, index) => {
        const label = labels[index];
        if (!label) return null;
        const remaining = labels.length - index - 1;
        return (
          <PullRequestLabelChip
            key={label.name}
            label={label}
            className={
              index === 0
                ? ""
                : index === 1
                  ? "hidden @xl/pr-row-meta:inline-flex"
                  : "hidden @3xl/pr-row-meta:inline-flex"
            }
          >
            {remaining > 0 ? (
              <span className={cn("shrink-0", slot.overflow)}>+{remaining}</span>
            ) : null}
          </PullRequestLabelChip>
        );
      })}
    </span>
  );
}

const PAGE_ROW_CLASS = "px-3 py-2.5";

export type PullRequestRowTarget = Pick<
  EnvironmentPullRequestEntry,
  "environmentId" | "projectId" | "host" | "repository" | "number"
>;

function PullRequestRowImpl({
  entry,
  selected,
  showProjectTitle,
  showProvider,
  environmentLabel,
  matchedElsewhere,
  statsKey,
  statsRef,
  onSelect,
  speedMode,
  hostActions,
  onActed,
  closing = false,
  sweeping = false,
  onCloseSweepStart,
  layout = "row",
}: {
  entry: EnvironmentPullRequestEntry;
  selected: boolean;
  showProjectTitle: boolean;
  showProvider: boolean;
  environmentLabel?: string;
  matchedElsewhere?: boolean;
  /** Used by the list's shared visibility observer to defer optional line-count reads. */
  statsKey?: string;
  statsRef?: RefCallback<HTMLDivElement>;
  onSelect: (entry: PullRequestRowTarget) => void;
  speedMode: boolean;
  hostActions: ReadonlySet<PullRequestAction>;
  onActed: (result: PullRequestSpeedActionResult) => void;
  closing?: boolean;
  sweeping?: boolean;
  onCloseSweepStart?: (entry: EnvironmentPullRequestEntry, event: PointerEvent) => void;
  /**
   * Astrolabe: `card` draws the row as the sidebar's thread and document cards are drawn (where
   * it lives and when, the title, then who and how it stands), for the Pull Requests sidebar.
   */
  layout?: "row" | "card";
}) {
  const { Icon, providerName } = getSourceControlPresentationForKind(entry.provider);
  const glyph = (
    <PullRequestRowGlyph
      state={entry.state}
      isDraft={entry.isDraft}
      mergeability={entry.mergeability}
      baseBranch={entry.baseBranch}
      className={layout === "card" ? "shrink-0" : "mt-0.75 self-start"}
    />
  );
  const numberLink = (
    // The number carries the link, here as much as on the detail: a right-click on it copies
    // the pull request's own address rather than opening the editing menu.
    <span
      className={PULL_REQUEST_ROW_NUMBER_CLASS}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void showPullRequestLinkContextMenu({
          url: entry.url,
          openLabel: openOnHostLabel(sourceControlClients.get(entry.provider)),
          position: { x: event.clientX, y: event.clientY },
        });
      }}
    >
      #{entry.number}
    </span>
  );
  const signals = (
    <>
      {entry.checksState === undefined ? null : (
        <PullRequestChecksPopover
          checksState={entry.checksState}
          environmentId={entry.environmentId}
          reference={{
            projectId: entry.projectId,
            repository: entry.repository,
            number: entry.number,
          }}
        />
      )}
      {/* Only a verdict the host actually reports: an approval, a request for changes, or a
        review the branch rules still require. No glyph on the common case of a pull request
        nobody has reviewed, so a row only wears a person when the person has said something. */}
      {entry.reviewDecision === undefined ? null : (
        <PullRequestReviewDecisionGlyph decision={entry.reviewDecision} />
      )}
    </>
  );
  const speedActions =
    hostActions.size > 0 ? (
      <PullRequestSpeedActions
        entry={entry}
        hostActions={hostActions}
        visible={speedMode}
        onActed={onActed}
        closing={closing}
        sweeping={sweeping}
        {...(onCloseSweepStart ? { onCloseSweepStart } : {})}
      />
    ) : null;

  if (layout === "card") {
    return (
      <div
        ref={statsRef}
        data-pull-request-stats-key={statsKey}
        data-pull-request-key={statsKey}
        className={cn("flex items-center", SIDEBAR_CARD_ITEM_CLASS)}
      >
        <button
          type="button"
          aria-current={selected ? "page" : undefined}
          onClick={() => onSelect(entry)}
          className={cn(
            SIDEBAR_ROW_SURFACE_CLASS,
            "min-w-0 flex-1",
            selected ? SIDEBAR_ROW_ACTIVE_CLASS : SIDEBAR_ROW_IDLE_CLASS,
          )}
        >
          <SidebarCardContent>
            <SidebarCardHeader>
              {glyph}
              <span className="min-w-0 flex-1 truncate text-xs font-medium text-secondary-label">
                {entry.repository}
                {environmentLabel ? ` · ${environmentLabel}` : null}
              </span>
              <span className="ml-auto shrink-0 text-xs tabular-nums text-secondary-label">
                {formatRelativeTimeLabel(entry.updatedAt)}
              </span>
            </SidebarCardHeader>
            <SidebarCardTitle>
              <span className="flex min-w-0 flex-1 items-center gap-1.5">
                {numberLink}
                <span className="min-w-0 truncate text-sm font-medium text-foreground/90">
                  {entry.title}
                </span>
              </span>
            </SidebarCardTitle>
            <SidebarCardFooter>
              <PullRequestRowAuthor
                actor={entry.author}
                className="min-w-3.5 max-w-32"
                labelClassName="truncate"
              />
              {matchedElsewhere ? (
                <SearchIcon aria-label="Matched in the description" className="size-3 shrink-0" />
              ) : null}
              <span className="ml-auto flex shrink-0 items-center gap-1.5">
                {signals}
                <PullRequestChangeBreakdownStat
                  environmentId={entry.environmentId}
                  reference={{
                    projectId: entry.projectId,
                    host: entry.host,
                    repository: entry.repository,
                    number: entry.number,
                  }}
                  additions={entry.additions}
                  deletions={entry.deletions}
                  className="font-mono"
                />
              </span>
            </SidebarCardFooter>
          </SidebarCardContent>
        </button>
        {speedActions}
      </div>
    );
  }
  return (
    <div
      ref={statsRef}
      data-pull-request-stats-key={statsKey}
      data-pull-request-key={statsKey}
      className={cn(
        "flex items-center rounded-md [content-visibility:auto] [contain-intrinsic-block-size:56.5px]",
        selected ? "bg-accent" : "hover:bg-accent/60",
      )}
    >
      <button
        type="button"
        aria-current={selected ? "true" : undefined}
        onClick={() => onSelect(entry)}
        className={cn(
          PULL_REQUEST_ROW_CLASS,
          PAGE_ROW_CLASS,
          "min-w-0 flex-1 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
        )}
      >
        {glyph}
        <PullRequestRowLines
          number={numberLink}
          title={entry.title}
          signals={signals}
          status={
            <>
              {entry.stack ? (
                <PullRequestStackPopover
                  environmentId={entry.environmentId}
                  reference={{
                    projectId: entry.projectId,
                    host: entry.host,
                    repository: entry.repository,
                    number: entry.number,
                  }}
                  membership={entry.stack}
                  onSelect={(target) =>
                    onSelect({ ...target, host: entry.host, environmentId: entry.environmentId })
                  }
                />
              ) : null}
              <PullRequestChangeBreakdownStat
                environmentId={entry.environmentId}
                reference={{
                  projectId: entry.projectId,
                  host: entry.host,
                  repository: entry.repository,
                  number: entry.number,
                }}
                additions={entry.additions}
                deletions={entry.deletions}
                className="font-mono"
              />
            </>
          }
          metaClassName="@container/pr-row-meta"
          meta={
            <>
              {matchedElsewhere ? (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <span className="flex min-w-6 items-center gap-1 overflow-hidden rounded-full border border-border/60 px-1 text-3xs" />
                    }
                  >
                    <span className="sr-only">matched in the description</span>
                    <SearchIcon aria-hidden className="size-3 shrink-0" />
                    <span aria-hidden className="hidden truncate @xs/pr-row-meta:block">
                      matched in the description
                    </span>
                  </TooltipTrigger>
                  <TooltipPopup side="top">Matched in the description</TooltipPopup>
                </Tooltip>
              ) : null}
              {showProvider ? (
                <Tooltip>
                  <TooltipTrigger render={<span className="inline-flex shrink-0" />}>
                    <Icon aria-label={providerName} className="size-3" />
                  </TooltipTrigger>
                  <TooltipPopup>{providerName}</TooltipPopup>
                </Tooltip>
              ) : null}
              <PullRequestRowAuthor
                actor={entry.author}
                className="min-w-3.5 max-w-40"
                labelClassName="sr-only @xs/pr-row-meta:not-sr-only @xs/pr-row-meta:truncate"
              />
              {showProjectTitle ? <span className="truncate">{entry.repository}</span> : null}
              {environmentLabel ? (
                <span className="min-w-0 max-w-32 truncate">{environmentLabel}</span>
              ) : null}
              {entry.labels.length > 0 ? <PullRequestRowLabels labels={entry.labels} /> : null}
            </>
          }
          updatedAt={entry.updatedAt}
        />
      </button>
      {speedActions}
    </div>
  );
}

export const PullRequestRow = memo(PullRequestRowImpl);
