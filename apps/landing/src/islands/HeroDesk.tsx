import {
  DagExplorer,
  EXPLORER_VIEW_STORAGE_KEY,
  ExplorerView,
} from "~/components/mercurian/DagExplorer";
import { PlanComposer } from "~/components/mercurian/PlanComposer";
import { buildPlanGraph } from "~/components/mercurian/PlanGraph.logic";
import { PlanTimeline } from "~/components/mercurian/PlanTimeline";
import { setLocalStorageItem } from "~/hooks/useLocalStorage";
import { message, planRevision, specRevision, timeline } from "~/test/fixtures/timeline";
import { useEffect, useRef, useState, type ComponentProps } from "react";

const history = timeline(
  message("plan-query", {
    text: "Turn this issue into an implementation plan",
  }),
  planRevision("plan-draft", {
    sequence: 2,
    parents: ["plan-query"],
    authorKind: "assistant",
  }),
  specRevision("plan-spec", {
    sequence: 3,
    parents: ["plan-draft"],
    authorKind: "assistant",
  }),
  message("plan-response", {
    sequence: 4,
    parents: ["plan-spec"],
    authorKind: "assistant",
    text: "The first implementation path is ready.",
  }),
  message("interface-query", {
    sequence: 5,
    parents: ["plan-response"],
    text: "Explore a quieter interface",
  }),
  message("workflow-query", {
    sequence: 6,
    parents: ["plan-response"],
    text: "Explore a faster workflow",
  }),
  planRevision("interface-plan", {
    sequence: 7,
    parents: ["interface-query"],
    authorKind: "assistant",
  }),
  planRevision("workflow-plan", {
    sequence: 8,
    parents: ["workflow-query"],
    authorKind: "assistant",
  }),
  message("interface-response", {
    sequence: 9,
    parents: ["interface-plan"],
    authorKind: "assistant",
    text: "The interface path is ready to compare.",
  }),
  message("workflow-response", {
    sequence: 10,
    parents: ["workflow-plan"],
    authorKind: "assistant",
    text: "The workflow path is ready to compare.",
  }),
  message("merge-query", {
    sequence: 11,
    parents: ["interface-response", "workflow-response"],
    text: "Merge the strongest parts of both paths",
  }),
  planRevision("merge-plan", {
    sequence: 12,
    parents: ["merge-query"],
    authorKind: "assistant",
  }),
  specRevision("merge-spec", {
    sequence: 13,
    parents: ["merge-plan"],
    authorKind: "assistant",
  }),
  message("merge-response", {
    sequence: 14,
    parents: ["merge-spec"],
    authorKind: "assistant",
    text: "The two paths are merged into one plan.",
  }),
);

const graph = buildPlanGraph(history);
const anchoredCommitId = history[13]!.commitId;
type HeroInFlight = NonNullable<ComponentProps<typeof PlanTimeline>["inFlight"]>;
type HeroComposerProps = ComponentProps<typeof PlanComposer>;
type HeroProvider = NonNullable<HeroComposerProps["provider"]>;

const heroInFlight = {
  turnId: "hero-desk-turn" as HeroInFlight["turnId"],
  parentCommitId: anchoredCommitId,
  text: "I’m comparing both branches and preparing the merged plan.",
  grounding: [{ kind: "search", label: "branch decisions" }],
} satisfies HeroInFlight;

const graphProps = {
  graph,
  anchoredCommitId,
  providers: [],
  codingSessions: [],
  readyCommits: new Map(),
  stalePlanCommitIds: new Set<string>(),
  staleSpecCommitIds: new Set<string>(),
  onColumnsWidthCapChange: () => undefined,
  onEditAndBranch: () => undefined,
  onImplementFrom: () => undefined,
  onSelect: () => undefined,
} as const;

const composerProps = {
  placeholder: "Ask the assistant to refine this plan",
  attachments: [],
  gateNotice: null,
  provider: "claudeAgent" as HeroProvider,
  slashCommands: [
    { name: "review", description: "Review the plan for gaps and contradictions" },
    { name: "compact", description: "Summarize the planning conversation" },
  ],
  skills: [
    {
      name: "product-docs",
      displayName: "Product Docs",
      description: "Work with a product documentation set",
      path: "/skills/product-docs/SKILL.md",
      scope: "personal",
      enabled: true,
    },
  ],
  modelPicker: (
    <button className="rounded-md border border-border px-2 py-1 text-xs" type="button">
      Claude · Opus
    </button>
  ),
  onAddAttachments: () => undefined,
  onRemoveAttachment: () => undefined,
  onSend: () => Promise.resolve(false),
  onStop: () => undefined,
  onImplement: () => undefined,
} satisfies Omit<HeroComposerProps, "onChangeText" | "text">;

function seedGraphView() {
  try {
    if (window.localStorage.getItem(EXPLORER_VIEW_STORAGE_KEY) === null) {
      setLocalStorageItem(EXPLORER_VIEW_STORAGE_KEY, "graph", ExplorerView);
    }
  } catch (error) {
    console.error("Could not seed the hero graph view.", error);
  }
}

seedGraphView();

export default function HeroDesk() {
  const [composerText, setComposerText] = useState("Ask the assistant to refine this plan.");

  return (
    <div className="flex h-full min-h-0 bg-background text-[12px] text-foreground">
      <div className="flex min-w-0 flex-1 flex-col lg:basis-2/5 lg:border-r lg:border-border">
        <PlanTimeline
          codingSessions={[]}
          inFlight={heroInFlight}
          timeline={history}
          onAnswerQuestion={() => undefined}
        />
        <PlanComposer {...composerProps} text={composerText} onChangeText={setComposerText} />
      </div>
      <div className="hidden min-w-0 flex-1 lg:flex">
        <HeroDagExplorer />
      </div>
    </div>
  );
}

function HeroDagExplorer() {
  const paneRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const pane = paneRef.current;
    if (pane === null) return;

    const fittedControls = new WeakSet<HTMLButtonElement>();
    const fitGraph = () => {
      const fitControl = pane.querySelector<HTMLButtonElement>(
        'button[aria-label="Fit graph to view"]',
      );
      if (fitControl === null || fittedControls.has(fitControl)) return;
      fittedControls.add(fitControl);
      fitControl.click();
    };

    const observer = new MutationObserver(fitGraph);
    observer.observe(pane, { childList: true, subtree: true });
    fitGraph();

    return () => observer.disconnect();
  }, []);

  return (
    <div className="flex min-w-0 flex-1" ref={paneRef}>
      <DagExplorer {...graphProps} />
    </div>
  );
}
