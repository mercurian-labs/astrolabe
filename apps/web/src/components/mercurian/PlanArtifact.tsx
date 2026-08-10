import type {
  MercurianCommitId,
  MercurianProjectId,
  MercurianRepositoryId,
  PlanId,
  PlanTimelineItem,
} from "@t3tools/contracts";
import { ChevronDownIcon, FileCode2Icon, PencilIcon, RotateCwIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

import { cn } from "../../lib/utils";
import { useDeriveTechnicalPlan, useSavePlanRevision } from "../../state/mercurian";
import { useProjectRepositories } from "../../state/mercurianRepositories";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { lastPlanRevision } from "./PlanArtifact.logic";
import { deriveMenuItems } from "./technicalPlans.logic";

/**
 * The plan artifact: the standing object the planning space orbits.
 *
 * Its text is never held anywhere but the history — what renders here is the
 * fold of the plan's revisions, and saving an edit lands another commit rather
 * than writing a document somewhere else.
 */
export function PlanArtifact({
  planId,
  projectId,
  planText,
  parentCommitId,
  timeline,
  turnActive = false,
  readOnly = false,
  readOnlyAction,
  onDerivationStarted,
}: {
  readonly planId: PlanId;
  readonly projectId: MercurianProjectId;
  readonly planText: string;
  /**
   * Where the surface is standing. An edit is a commit like any other, so it
   * hangs from the branch its author was on — not from whichever branch last
   * received one.
   */
  readonly parentCommitId?: MercurianCommitId;
  readonly timeline: ReadonlyArray<PlanTimelineItem>;
  /** Replies and derivations share the plan's one active-turn claim. */
  readonly turnActive?: boolean;
  /**
   * Set while the surface is looking at an earlier commit. Editing there is
   * not a smaller version of editing — it is a fork — so the affordance goes
   * away rather than quietly appending at the tip.
   */
  readonly readOnly?: boolean;
  /** What takes Edit's place while read-only: the way back to now. */
  readonly readOnlyAction?: ReactNode;
  /** Makes an earlier position live so the settling commit is followed. */
  readonly onDerivationStarted?: () => void;
}) {
  const savePlanRevision = useSavePlanRevision();
  const [draft, setDraft] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const save = useCallback(async () => {
    if (draft === null || isSaving) return;
    setIsSaving(true);
    const saved = await savePlanRevision({
      planId,
      text: draft,
      ...(parentCommitId === undefined ? {} : { parentCommitId }),
    });
    setIsSaving(false);
    if (saved !== null) {
      // The stream delivers the new text; the buffer's job is done.
      setDraft(null);
    }
  }, [draft, isSaving, parentCommitId, planId, savePlanRevision]);

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2 sm:px-4">
        <h2 className="text-sm font-medium text-foreground">Plan</h2>
        <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground/70">
          {lastRevisionLabel(timeline)}
        </span>
        <DeriveMenu
          {...(parentCommitId === undefined ? {} : { parentCommitId })}
          planId={planId}
          planText={planText}
          projectId={projectId}
          timeline={timeline}
          turnActive={turnActive}
          {...(onDerivationStarted === undefined ? {} : { onStarted: onDerivationStarted })}
        />
        {readOnly ? (
          readOnlyAction
        ) : draft === null ? (
          <Button size="sm" variant="ghost" onClick={() => setDraft(planText)}>
            <PencilIcon className="size-3.5" />
            Edit
          </Button>
        ) : (
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              // A no-op edit should not mint a no-op revision.
              disabled={isSaving || draft === planText}
              onClick={() => void save()}
            >
              Save
            </Button>
          </div>
        )}
      </div>
      {draft === null || readOnly ? (
        <PlanMarkdown planText={planText} />
      ) : (
        <PlanArtifactEditor value={draft} onChange={setDraft} onSave={() => void save()} />
      )}
    </section>
  );
}

/** The sole client entry point for compiling this plan into a repository. */
function DeriveMenu({
  planId,
  projectId,
  parentCommitId,
  timeline,
  planText,
  turnActive,
  onStarted,
}: {
  readonly planId: PlanId;
  readonly projectId: MercurianProjectId;
  readonly parentCommitId?: MercurianCommitId;
  readonly timeline: ReadonlyArray<PlanTimelineItem>;
  readonly planText: string;
  readonly turnActive: boolean;
  readonly onStarted?: () => void;
}) {
  const repositories = useProjectRepositories(projectId);
  const deriveTechnicalPlan = useDeriveTechnicalPlan();
  const [startingRepositoryId, setStartingRepositoryId] = useState<MercurianRepositoryId | null>(
    null,
  );
  const items = useMemo(
    () => deriveMenuItems(repositories, timeline, planText, turnActive),
    [planText, repositories, timeline, turnActive],
  );
  const triggerDisabled =
    repositories.length === 0 ||
    turnActive ||
    startingRepositoryId !== null ||
    items.some((item) => item.disabledReason === "plan-empty");

  const derive = useCallback(
    async (repositoryId: MercurianRepositoryId) => {
      if (startingRepositoryId !== null) return;
      setStartingRepositoryId(repositoryId);
      const started = await deriveTechnicalPlan({
        planId,
        repositoryId,
        ...(parentCommitId === undefined ? {} : { parentCommitId }),
      });
      setStartingRepositoryId(null);
      if (started !== null) onStarted?.();
    },
    [deriveTechnicalPlan, onStarted, parentCommitId, planId, startingRepositoryId],
  );

  return (
    <Menu>
      <MenuTrigger
        disabled={triggerDisabled}
        render={<Button size="sm" variant="ghost" aria-label="Derive technical plan" />}
      >
        <FileCode2Icon className="size-3.5" />
        Derive
        <ChevronDownIcon className="size-3" />
      </MenuTrigger>
      <MenuPopup align="end" className="w-72">
        {items.map((item) => {
          const starting = startingRepositoryId === item.repository.repositoryId;
          const stateLabel =
            item.state === "up-to-date"
              ? "Derived from the current plan"
              : item.state === "stale"
                ? "Plan changed — re-derive"
                : "Create a technical plan";
          return (
            <MenuItem
              key={item.repository.repositoryId}
              disabled={item.disabled || startingRepositoryId !== null}
              onClick={() => void derive(item.repository.repositoryId)}
            >
              {item.state === "stale" ? (
                <RotateCwIcon className="size-4" />
              ) : (
                <FileCode2Icon className="size-4" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate">{item.repository.name}</span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {starting ? "Starting…" : stateLabel}
                </span>
              </span>
            </MenuItem>
          );
        })}
      </MenuPopup>
    </Menu>
  );
}

/**
 * The plan reads as the markdown document the team already writes plans as.
 *
 * Deliberately not `ChatMarkdown`: that renderer is entangled with the thread
 * surface — scoped thread refs, the right panel, workspace file links — and
 * mounting it here would drag that machinery into the planning space.
 */
export function PlanMarkdown({ planText }: { readonly planText: string }) {
  if (planText.length === 0) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-6 sm:px-4">
        <p className="text-sm text-muted-foreground/70">No plan yet — edit to start one.</p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "min-h-0 flex-1 overflow-y-auto px-3 py-4 text-sm text-foreground sm:px-4",
        "[&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
        "[&_code]:rounded [&_code]:bg-muted/60 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.85em]",
        "[&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-base [&_h1]:font-semibold first:[&_h1]:mt-0",
        "[&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-sm [&_h2]:font-semibold first:[&_h2]:mt-0",
        "[&_h3]:mt-3 [&_h3]:mb-1 [&_h3]:text-sm [&_h3]:font-medium",
        "[&_li]:my-0.5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5",
        "[&_p]:my-2 [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted/60 [&_pre]:p-3",
        "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5",
      )}
    >
      <ReactMarkdown rehypePlugins={[rehypeSanitize]} remarkPlugins={[remarkGfm]}>
        {planText}
      </ReactMarkdown>
    </div>
  );
}

/**
 * The edit buffer is ephemeral on purpose: an unsaved edit is not a commit,
 * and it is not the per-plan composer draft either. It works on what it was
 * seeded with until it is saved or cancelled.
 */
function PlanArtifactEditor({
  value,
  onChange,
  onSave,
}: {
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly onSave: () => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  return (
    <textarea
      ref={textareaRef}
      aria-label="Plan"
      className="min-h-0 flex-1 resize-none bg-background px-3 py-4 font-mono text-sm text-foreground outline-hidden sm:px-4"
      placeholder="Write the plan"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          onSave();
        }
      }}
    />
  );
}

function lastRevisionLabel(timeline: ReadonlyArray<PlanTimelineItem>): string {
  const revision = lastPlanRevision(timeline);
  if (revision === null) return "Not edited yet";
  const who = revision.authorKind === "human" ? "you" : "the assistant";
  return `Edited by ${who} · ${formatRelativeTimeLabel(revision.createdAt)}`;
}
