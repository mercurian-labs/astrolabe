import { SparklesIcon, XIcon } from "lucide-react";

import { Button } from "../ui/button";
import type { PlanSuggestion } from "./planSuggestions.logic";

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
