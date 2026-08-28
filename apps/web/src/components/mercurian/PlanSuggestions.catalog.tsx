import type { CatalogEntry } from "../../design-system/catalog";
import { PlanSuggestionsRow } from "./PlanSuggestions";
import type { PlanSuggestion } from "./planSuggestions.logic";

const suggestions: ReadonlyArray<PlanSuggestion> = [
  {
    id: "Composer\0Placement",
    noteName: "Composer",
    question: "Where should suggested next messages appear?",
    label: "Composer: Where should suggested next messages appear?",
    message:
      'Let\'s resolve the open decision on [[Composer]]: "Where should suggested next messages appear?".',
  },
  {
    id: "Memory\0History",
    noteName: "Memory",
    question: "How should amendments appear in history?",
    label: "Memory: How should amendments appear in history?",
    message:
      'Let\'s resolve the open decision on [[Memory]]: "How should amendments appear in history?".',
  },
];

export const PLAN_SUGGESTIONS_CATALOG_ENTRIES = [
  {
    id: "plan-suggestions-open-decisions",
    section: "mercurian-grammar",
    group: "PlanSuggestions",
    title: "Suggested next messages",
    description: "Two unresolved memory decisions offered as optional next messages.",
    sourcePath: "src/components/mercurian/PlanSuggestions.tsx",
    render: () => (
      <PlanSuggestionsRow
        disabled={false}
        suggestions={suggestions}
        onDismiss={() => {}}
        onSelect={() => {}}
      />
    ),
    layout: "preview",
    preferredCanvas: "desktop",
  },
] satisfies ReadonlyArray<CatalogEntry>;
