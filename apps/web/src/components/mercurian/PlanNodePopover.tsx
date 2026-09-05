/**
 * One checkpoint reading shared by the explorer's three views.
 *
 * Rows and map nodes own only how the popover is summoned. Identity, recorded
 * model facts, effects, honesty warnings, and acts stay here so a
 * checkpoint cannot tell a different story when the explorer changes shape.
 */
import type {
  MercurianCommitId,
  PlanCodingSessionRecord,
  PlanTimelineItem,
  PlanningModelSelection,
  ServerProvider,
} from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import {
  BookOpenCheckIcon,
  CircleDotIcon,
  FileTextIcon,
  InfoIcon,
  MessageSquareIcon,
  SquareTerminalIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { scopeThreadRef } from "@t3tools/client-runtime/environment";

import { cn } from "../../lib/utils";
import { revealMemorySelection } from "../../memoryPanelStore";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { Button } from "../ui/button";
import { Popover, PopoverPopup } from "../ui/popover";
import { useOptionalThreadSpace } from "./ThreadSpaceContext";
import { PLAN_MAY_BE_STALE_DESCRIPTION, PLAN_MAY_BE_STALE_LABEL } from "./PlanFreshness";
import { planningModelOptionLabels, providerLabel } from "./PlanningModel.logic";
import type { PlanGraph, PlanGraphNode } from "./PlanGraph.logic";
import {
  derivePlanNodePopover,
  memoryAmendmentSelection,
  repositoryFactsLabel,
  type PlanNodePopoverAct,
} from "./PlanNodePopover.logic";

export const NODE_POPOVER_HOVER_DELAY = 500;
const NODE_POPOVER_CLOSE_DELAY = 160;

export interface PlanNodePopoverAnchor {
  readonly anchor: Element;
  readonly commitId: MercurianCommitId;
}

export interface PlanNodePopoverController {
  readonly state: PlanNodePopoverAnchor | null;
  readonly open: (commitId: MercurianCommitId, anchor: Element) => void;
  readonly linger: (commitId: MercurianCommitId, anchor: Element) => void;
  readonly cancelClose: () => void;
  readonly scheduleClose: () => void;
  readonly close: () => void;
}

/** A single timer pair keeps travel from an anchor into its popup stable. */
export function usePlanNodePopover(): PlanNodePopoverController {
  const [state, setState] = useState<PlanNodePopoverAnchor | null>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearOpen = useCallback(() => {
    if (openTimer.current !== null) clearTimeout(openTimer.current);
    openTimer.current = null;
  }, []);
  const cancelClose = useCallback(() => {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }, []);
  const open = useCallback(
    (commitId: MercurianCommitId, anchor: Element) => {
      clearOpen();
      cancelClose();
      setState({ anchor, commitId });
    },
    [cancelClose, clearOpen],
  );
  const linger = useCallback(
    (commitId: MercurianCommitId, anchor: Element) => {
      clearOpen();
      cancelClose();
      openTimer.current = setTimeout(() => {
        openTimer.current = null;
        setState({ anchor, commitId });
      }, NODE_POPOVER_HOVER_DELAY);
    },
    [cancelClose, clearOpen],
  );
  const close = useCallback(() => {
    clearOpen();
    cancelClose();
    setState(null);
  }, [cancelClose, clearOpen]);
  const scheduleClose = useCallback(() => {
    clearOpen();
    cancelClose();
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null;
      setState(null);
    }, NODE_POPOVER_CLOSE_DELAY);
  }, [cancelClose, clearOpen]);

  useEffect(
    () => () => {
      clearOpen();
      cancelClose();
    },
    [cancelClose, clearOpen],
  );

  return { state, open, linger, cancelClose, scheduleClose, close };
}

export function PlanNodeDetailsButton({
  node,
  controller,
}: {
  readonly node: PlanGraphNode;
  readonly controller: PlanNodePopoverController;
}) {
  return (
    <Button
      aria-label={`Details for ${nodeAccessibleName(node)}`}
      className="shrink-0 opacity-0 transition-opacity group-focus-within/node:opacity-100 group-hover/node:opacity-100 focus:opacity-100"
      size="icon-xs"
      type="button"
      variant="ghost"
      onClick={(event) => {
        event.stopPropagation();
        controller.open(node.commitId, event.currentTarget);
      }}
    >
      <InfoIcon aria-hidden />
    </Button>
  );
}

export function PlanNodePopover({
  controller,
  node,
  commitGraph,
  codingSessions,
  providers,
  stalePlan,
  staleSpec,
  suppressUnanswered,
  onEditAndBranch,
}: {
  readonly controller: PlanNodePopoverController;
  readonly node: PlanGraphNode | undefined;
  readonly commitGraph: PlanGraph;
  readonly codingSessions: ReadonlyArray<PlanCodingSessionRecord>;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly stalePlan: boolean;
  readonly staleSpec: boolean;
  readonly suppressUnanswered: boolean;
  readonly onEditAndBranch: (
    query: Extract<PlanTimelineItem, { readonly _tag: "message" }>,
  ) => void;
}) {
  return (
    <Popover
      open={controller.state !== null && node !== undefined}
      onOpenChange={(open) => {
        if (!open) controller.close();
      }}
    >
      <PopoverPopup
        anchor={controller.state?.anchor}
        className="w-80 max-w-[calc(100vw-1rem)]"
        side="right"
        viewportClassName="p-3"
        onPointerEnter={controller.cancelClose}
        onPointerLeave={controller.scheduleClose}
      >
        {node === undefined ? null : (
          <PlanNodePopoverContent
            codingSessions={codingSessions}
            commitGraph={commitGraph}
            node={node}
            providers={providers}
            stalePlan={stalePlan}
            staleSpec={staleSpec}
            suppressUnanswered={suppressUnanswered}
            onClose={controller.close}
            onEditAndBranch={onEditAndBranch}
          />
        )}
      </PopoverPopup>
    </Popover>
  );
}

export function PlanNodePopoverContent({
  node,
  commitGraph,
  codingSessions,
  providers,
  stalePlan,
  staleSpec,
  suppressUnanswered,
  onClose,
  onEditAndBranch,
}: {
  readonly node: PlanGraphNode;
  readonly commitGraph: PlanGraph;
  readonly codingSessions: ReadonlyArray<PlanCodingSessionRecord>;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly stalePlan: boolean;
  readonly staleSpec: boolean;
  readonly suppressUnanswered: boolean;
  readonly onClose: () => void;
  readonly onEditAndBranch: (
    query: Extract<PlanTimelineItem, { readonly _tag: "message" }>,
  ) => void;
}) {
  const reading = derivePlanNodePopover({
    node,
    commitGraph,
    codingSessions,
    stalePlan,
    staleSpec,
    suppressUnanswered,
  });

  return (
    <div className="flex flex-col gap-3 text-xs">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          {reading.query === undefined ? (
            <StandaloneIdentity item={node.item} label={reading.label} />
          ) : (
            <>
              <MessageIdentity item={reading.query} label="You" providers={providers} />
              {reading.response === undefined ? null : (
                <MessageIdentity item={reading.response} label="Assistant" providers={providers} />
              )}
            </>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="text-[11px] text-muted-foreground/70">
            {formatRelativeTimeLabel(reading.createdAt)}
          </span>
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-[10px] font-medium",
              reading.published
                ? "bg-sky-500/15 text-sky-700 dark:text-sky-400"
                : "bg-muted text-muted-foreground",
            )}
          >
            {reading.published ? "Published" : "Private"}
          </span>
        </div>
      </div>

      {reading.modelSwitch === undefined ? null : (
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span>Switched from</span>
          <ModelAttribution selection={reading.modelSwitch} providers={providers} />
        </div>
      )}

      <section className="flex flex-col gap-1.5">
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
          What changed
        </p>
        {reading.queryText === undefined ? (
          <p className="truncate text-foreground">{reading.label}</p>
        ) : (
          <p className="whitespace-pre-wrap break-words text-foreground">{reading.queryText}</p>
        )}
        {reading.responseExcerpt === undefined ? null : (
          <p className="line-clamp-4 whitespace-pre-wrap break-words text-muted-foreground">
            {reading.responseExcerpt}
          </p>
        )}
        {reading.effects.length === 0 ? null : (
          <div className="flex flex-wrap gap-1">
            {reading.effects.map((effect) => (
              <span
                className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                key={effect}
              >
                {effect}
              </span>
            ))}
          </div>
        )}
      </section>

      {reading.session === undefined ? null : (
        <section className="flex flex-col gap-1.5 border-t border-border pt-3">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
            Coding session
          </p>
          {reading.session.repositoryName === undefined ? null : (
            <Fact label="Repository" value={reading.session.repositoryName} />
          )}
          <Fact label="Plan revision" value={reading.session.planRevisionCommitId.slice(0, 8)} />
          {reading.session.status === undefined ? null : (
            <Fact label="Status" value={reading.session.status} />
          )}
          {reading.session.branch === undefined ? null : (
            <Fact label="Branch" value={reading.session.branch} />
          )}
          {reading.session.commits === undefined ? null : (
            <Fact label="Commits" value={reading.session.commits} />
          )}
          {reading.session.departedRef === undefined ? null : (
            <Fact label="Departed to" value={reading.session.departedRef} />
          )}
          {reading.session.prUrl === undefined ? null : (
            <a
              className="w-fit underline"
              href={reading.session.prUrl}
              rel="noreferrer"
              target="_blank"
            >
              Pull request
            </a>
          )}
          {reading.session.repositories?.map((repository) => (
            <div className="flex items-center justify-between gap-2" key={repository.repositoryId}>
              <span>
                {repository.repositoryName} · {repositoryFactsLabel(repository)}
              </span>
              {repository.prUrl === null ? null : (
                <a className="underline" href={repository.prUrl} rel="noreferrer" target="_blank">
                  Pull request
                </a>
              )}
            </div>
          ))}
        </section>
      )}

      {!reading.staleSpec && !reading.stalePlan && !reading.movedPastPlan ? null : (
        <section className="flex flex-col gap-1.5 border-t border-border pt-3">
          {reading.staleSpec ? (
            <Warning label="Spec stale" description="Spec changed since this branch's base" />
          ) : null}
          {reading.stalePlan ? (
            <Warning label={PLAN_MAY_BE_STALE_LABEL} description={PLAN_MAY_BE_STALE_DESCRIPTION} />
          ) : null}
          {reading.movedPastPlan ? (
            <Warning
              label={`Planning has moved past this plan${reading.movedPastRepositoryName === undefined ? "" : ` for ${reading.movedPastRepositoryName}`}`}
            />
          ) : null}
        </section>
      )}

      {reading.acts.length === 0 ? null : (
        <div className="flex flex-wrap gap-1.5 border-t border-border pt-3">
          {reading.acts.map((act) =>
            act === "open-memory" ? (
              <OpenInMemoryAct key={act} node={node} onClose={onClose} />
            ) : act === "open-session" && reading.session?.threadId !== undefined ? (
              <Button
                key={act}
                render={
                  <Link to="/sessions/$threadId" params={{ threadId: reading.session.threadId }} />
                }
                size="sm"
                variant="outline"
                onClick={onClose}
              >
                Open line
              </Button>
            ) : (
              <Button
                key={act}
                size="sm"
                type="button"
                variant="outline"
                onClick={() => {
                  if (reading.query !== undefined) onEditAndBranch(reading.query);
                  onClose();
                }}
              >
                {actLabel(act)}
              </Button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

/** Only a line inside a thread space can address its Memory tab; elsewhere the act stays quiet. */
function OpenInMemoryAct({
  node,
  onClose,
}: {
  readonly node: PlanGraphNode;
  readonly onClose: () => void;
}) {
  const threadSpace = useOptionalThreadSpace();
  const selection =
    node.item._tag === "message" && node.item.memoryAmendment !== undefined
      ? memoryAmendmentSelection(node.item.memoryAmendment)
      : null;
  if (threadSpace === null || selection === null) return null;
  return (
    <Button
      size="sm"
      type="button"
      variant="outline"
      onClick={() => {
        revealMemorySelection(
          scopeThreadRef(threadSpace.environmentId, threadSpace.threadId),
          selection,
        );
        onClose();
      }}
    >
      {actLabel("open-memory")}
    </Button>
  );
}

function MessageIdentity({
  item,
  label,
  providers,
}: {
  readonly item: Extract<PlanTimelineItem, { readonly _tag: "message" }>;
  readonly label: "You" | "Assistant";
  readonly providers: ReadonlyArray<ServerProvider>;
}) {
  const selection = label === "Assistant" ? item.generatedBy : undefined;
  return (
    <div className={cn("flex min-w-0 items-center gap-1.5", label === "You" && "justify-end")}>
      {label === "Assistant" ? (
        <MessageSquareIcon aria-hidden className="size-3.5 shrink-0" />
      ) : null}
      <span className="shrink-0 text-[11px] font-medium text-muted-foreground">{label}</span>
      {selection === undefined ? null : (
        <ModelAttribution selection={selection} providers={providers} />
      )}
      {label === "You" ? (
        <MessageSquareIcon aria-hidden className="size-3.5 shrink-0 -scale-x-100" />
      ) : null}
    </div>
  );
}

/** The provider/model that produced a settled reply, quiet but always visible. */
function ModelAttribution({
  selection,
  providers,
}: {
  readonly selection: PlanningModelSelection;
  readonly providers: ReadonlyArray<ServerProvider>;
}) {
  const modelLabel =
    providers
      .flatMap((provider) => (provider.driver === selection.provider ? provider.models : []))
      .find((model) => model.slug === selection.model)?.name ?? selection.model;
  const optionLabels = planningModelOptionLabels(selection, providers);
  return (
    <span className="text-[11px] text-muted-foreground/65">
      {providerLabel(selection.provider)} · {modelLabel}
      {optionLabels.length === 0 ? "" : ` · ${optionLabels.join(" · ")}`}
    </span>
  );
}

function StandaloneIdentity({
  item,
  label,
}: {
  readonly item: PlanTimelineItem;
  readonly label: string;
}) {
  const Glyph =
    item._tag === "message" && item.memoryAmendment !== undefined
      ? BookOpenCheckIcon
      : item._tag === "coding-session"
        ? SquareTerminalIcon
        : item._tag === "plan-revision"
          ? FileTextIcon
          : item._tag === "spec-revision"
            ? CircleDotIcon
            : MessageSquareIcon;
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <Glyph
        aria-hidden
        className={cn(
          "size-3.5 shrink-0",
          item._tag === "message" && item.authorKind === "human" && "-scale-x-100",
        )}
      />
      <span className="truncate font-medium text-foreground">{label}</span>
    </div>
  );
}

function Fact({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right text-foreground">{value}</span>
    </div>
  );
}

function Warning({
  label,
  description,
}: {
  readonly label: string;
  readonly description?: string;
}) {
  return (
    <div>
      <p className="font-medium text-amber-700 dark:text-amber-400">{label}</p>
      {description === undefined ? null : (
        <p className="mt-0.5 text-[11px] text-muted-foreground">{description}</p>
      )}
    </div>
  );
}

function actLabel(act: PlanNodePopoverAct): string {
  if (act === "edit-and-branch") return "Fork here";
  if (act === "open-memory") return "Open in Memory";
  return "Open line";
}

function nodeAccessibleName(node: PlanGraphNode): string {
  const checkpoint = node.checkpoint;
  if (checkpoint !== undefined) {
    const response = checkpoint.response;
    return response?._tag === "message"
      ? `You: ${checkpoint.query._tag === "message" ? checkpoint.query.text : "checkpoint"}; Assistant: ${response.text}`
      : `You: ${checkpoint.query._tag === "message" ? checkpoint.query.text : "checkpoint"}`;
  }
  return node.item._tag === "message"
    ? `${node.item.authorKind === "human" ? "You" : "Assistant"}: ${node.item.text}`
    : node.item._tag === "coding-session"
      ? node.item.repositoryName === undefined
        ? "Coding session"
        : `Coding session in ${node.item.repositoryName}`
      : node.item._tag === "plan-revision" && node.item.split !== undefined
        ? `Plan for ${node.item.split.repositoryName}`
        : node.item._tag === "plan-revision"
          ? `${node.item.authorKind === "human" ? "You" : "The assistant"} edited the plan`
          : "Spec revision";
}
