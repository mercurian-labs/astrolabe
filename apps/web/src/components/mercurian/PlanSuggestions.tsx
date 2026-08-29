import type { MemoryNote, MercurianProjectId, PlanId, PlanTimelineItem } from "@t3tools/contracts";
import { SparklesIcon, XIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { useReadMemoryNote } from "../../state/mercurianMemory";
import { Button } from "../ui/button";
import {
  collectMentionedMemoryNoteNames,
  suggestionsAfterDismiss,
  unresolvedMemoryNoteSuggestions,
  type PlanSuggestion,
} from "./planSuggestions.logic";

const EMPTY_DISMISSED_IDS: ReadonlySet<string> = new Set();

export function PlanSuggestions({
  planId,
  projectId,
  timeline,
  disabled,
  onSend,
}: {
  readonly planId: PlanId;
  readonly projectId: MercurianProjectId;
  readonly timeline: ReadonlyArray<PlanTimelineItem>;
  readonly disabled: boolean;
  readonly onSend: (text: string) => Promise<boolean>;
}) {
  const readNote = useReadMemoryNote();
  const mentionedNames = useMemo(() => collectMentionedMemoryNoteNames(timeline), [timeline]);
  const amendmentVersions = useMemo(() => {
    const versions = new Map<string, string>();
    for (const item of timeline) {
      if (item._tag !== "message" || item.memoryAmendment === undefined) continue;
      for (const name of item.memoryAmendment.notes) {
        versions.set(name.toLocaleLowerCase(), item.commitId);
      }
    }
    return versions;
  }, [timeline]);
  const [notesByKey, setNotesByKey] = useState<ReadonlyMap<string, MemoryNote>>(new Map());
  const requestedVersionByKey = useRef(new Map<string, string>());
  const [dismissedByPlan, setDismissedByPlan] = useState<ReadonlyMap<string, ReadonlySet<string>>>(
    new Map(),
  );
  const [sending, setSending] = useState(false);

  useEffect(() => {
    for (const name of mentionedNames) {
      const key = `${planId}\0${name.toLocaleLowerCase()}`;
      const version = amendmentVersions.get(name.toLocaleLowerCase()) ?? "initial";
      if (requestedVersionByKey.current.get(key) === version) continue;
      requestedVersionByKey.current.set(key, version);
      void readNote({ projectId, name }).then((result) => {
        if (!result.ok || requestedVersionByKey.current.get(key) !== version) return;
        setNotesByKey((current) => {
          const next = new Map(current);
          next.set(key, result.value);
          return next;
        });
      });
    }
  }, [amendmentVersions, mentionedNames, planId, projectId, readNote]);

  const notes = useMemo(
    () =>
      mentionedNames.flatMap((name) => {
        const note = notesByKey.get(`${planId}\0${name.toLocaleLowerCase()}`);
        return note === undefined ? [] : [note];
      }),
    [mentionedNames, notesByKey, planId],
  );
  const suggestions = useMemo(() => unresolvedMemoryNoteSuggestions(notes), [notes]);
  const dismissedIds = dismissedByPlan.get(planId) ?? EMPTY_DISMISSED_IDS;
  const visibleSuggestions = suggestionsAfterDismiss(suggestions, dismissedIds);

  return (
    <PlanSuggestionsRow
      disabled={disabled || sending}
      suggestions={visibleSuggestions}
      onDismiss={() => {
        setDismissedByPlan((current) => {
          const next = new Map(current);
          next.set(planId, new Set(suggestions.map((suggestion) => suggestion.id)));
          return next;
        });
      }}
      onSelect={(suggestion) => {
        if (disabled || sending) return;
        setSending(true);
        void onSend(suggestion.message).finally(() => setSending(false));
      }}
    />
  );
}

export function PlanSuggestionsRow({
  suggestions,
  disabled,
  onSelect,
  onDismiss,
}: {
  readonly suggestions: ReadonlyArray<PlanSuggestion>;
  readonly disabled: boolean;
  readonly onSelect: (suggestion: PlanSuggestion) => void;
  readonly onDismiss: () => void;
}) {
  if (suggestions.length === 0) return null;
  return (
    <section
      aria-label="Suggested next messages"
      className="mx-auto flex w-full max-w-3xl items-start gap-2 border-x border-t border-border/65 bg-muted/20 px-3 py-2.5"
    >
      <SparklesIcon aria-hidden className="mt-1 size-3.5 shrink-0 text-muted-foreground" />
      <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
        {suggestions.map((suggestion) => (
          <Button
            key={suggestion.id}
            className="h-auto max-w-full justify-start whitespace-normal rounded-full px-2.5 py-1 text-left text-xs"
            disabled={disabled}
            size="sm"
            type="button"
            variant="outline"
            onClick={() => onSelect(suggestion)}
          >
            {suggestion.label}
          </Button>
        ))}
      </div>
      <Button
        aria-label="Dismiss suggested next messages"
        className="shrink-0"
        size="icon-xs"
        type="button"
        variant="ghost"
        onClick={onDismiss}
      >
        <XIcon aria-hidden className="size-3.5" />
      </Button>
    </section>
  );
}
