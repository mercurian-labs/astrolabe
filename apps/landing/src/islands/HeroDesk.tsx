import {
  DagExplorer,
  EXPLORER_VIEW_STORAGE_KEY,
  ExplorerView,
} from "~/components/mercurian/DagExplorer";
import { PlanArtifact } from "~/components/mercurian/PlanArtifact";
import { lastPlanRevision } from "~/components/mercurian/PlanArtifact.logic";
import { PlanComposer } from "~/components/mercurian/PlanComposer";
import { ancestorClosure, buildPlanGraph } from "~/components/mercurian/PlanGraph.logic";
import {
  isViewingPast,
  LATEST,
  positionAfterPick,
  resolveHead,
  type PlanPosition,
} from "~/components/mercurian/PlanPosition.logic";
import { PlanPaneToggle } from "~/components/mercurian/PlanningSpace";
import { PlanTimeline } from "~/components/mercurian/PlanTimeline";
import { SpecArtifact } from "~/components/mercurian/SpecArtifact";
import { lastSpecRevision } from "~/components/mercurian/SpecArtifact.logic";
import { WorkspacePageHeader } from "~/components/WorkspacePageHeader";
import { Button } from "~/components/ui/button";
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "~/components/ui/menu";
import { setLocalStorageItem } from "~/hooks/useLocalStorage";
import { message, planRevision, specRevision, timeline } from "~/test/fixtures/timeline";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentProps } from "react";

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
);

const graph = buildPlanGraph(history);
const tip = history[9]!.commitId;
const heroPlanId = "marketing-site-hero" as ComponentProps<typeof PlanArtifact>["planId"];
type HeroInFlight = NonNullable<ComponentProps<typeof PlanTimeline>["inFlight"]>;
type HeroComposerProps = ComponentProps<typeof PlanComposer>;
type HeroProvider = NonNullable<HeroComposerProps["provider"]>;
type HeroSpec = NonNullable<ComponentProps<typeof SpecArtifact>["spec"]>;
type RightPaneState = {
  readonly open: boolean;
  readonly view: "artifact" | "explorer";
  readonly artifact: "plan" | "spec";
};

const DEFAULT_RIGHT_PANE: RightPaneState = {
  open: true,
  view: "explorer",
  artifact: "plan",
};

const planTextByRevisionCreatedAt = new Map([
  [
    history[1]!.createdAt,
    `# First draft

## Page shape
- Lead with a direct statement of what Mercurian is.
- Keep the product window close to the first claim.

## Product proof
- Use the real planning conversation and checkpoint graph.
- Preserve the existing provider band and closing claim.`,
  ],
  [
    history[6]!.createdAt,
    `# Quieter interface path

## Reduce the page
- Keep one opening claim, one product window, and one closing claim.
- Let spacing and typography carry the hierarchy.

## Keep the window calm
- Show the planning header and artifact without extra callouts.
- Avoid ornamental sections around the working product surface.`,
  ],
  [
    history[7]!.createdAt,
    `# Faster workflow path

## Shorten the route to proof
- Put the interactive planning window immediately after the opening claim.
- Start on the checkpoint graph so branching is understandable at a glance.

## Ship in place
- Reuse product components and fixture data.
- Keep the landing-only implementation small and verify the static build.`,
  ],
]);

const specByRevisionCommitId = new Map<string, HeroSpec>([
  [
    history[2]!.commitId,
    {
      revisionCommitId: history[2]!.commitId,
      document: {
        goal: "Give visitors a restrained, concrete view of planning work inside Mercurian, using the real product surface rather than a visual imitation.",
        acceptanceCriteria:
          "- The hero keeps its opening and closing claims.\n- The window shows a real planning conversation beside its checkpoint graph.\n- The page remains usable below desktop width.",
      },
    },
  ],
]);

const heroInFlight = {
  turnId: "hero-desk-turn" as HeroInFlight["turnId"],
  parentCommitId: tip,
  text: "I’m weighing the two paths so we can pick a direction.",
  grounding: [{ kind: "search", label: "open branches" }],
} satisfies HeroInFlight;

const graphProps = {
  graph,
  providers: [],
  codingSessions: [],
  readyCommits: new Map(),
  stalePlanCommitIds: new Set<string>(),
  staleSpecCommitIds: new Set<string>(),
  onColumnsWidthCapChange: () => undefined,
  onEditAndBranch: () => undefined,
  onImplementFrom: () => undefined,
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
  useLayoutEffect(() => {
    const root = document.documentElement;
    const pinLightAppearance = () => {
      if (root.classList.contains("dark")) root.classList.remove("dark");
      if (root.dataset.themeId !== undefined) delete root.dataset.themeId;
    };
    const observer = new MutationObserver(pinLightAppearance);
    observer.observe(root, {
      attributeFilter: ["class", "data-theme-id"],
      attributes: true,
    });
    pinLightAppearance();
    return () => observer.disconnect();
  }, []);

  return <HeroWindowInterior />;
}

function HeroWindowInterior() {
  const [composerText, setComposerText] = useState("Ask the assistant to refine this plan.");
  const [pane, setPane] = useState<RightPaneState>(DEFAULT_RIGHT_PANE);
  const [position, setPosition] = useState<PlanPosition>(LATEST);
  const head = resolveHead(graph, position);
  const visibleCommitIds = useMemo(
    () => (head === null ? null : ancestorClosure(graph, head)),
    [head],
  );
  const visibleTimeline = useMemo(
    () =>
      visibleCommitIds === null
        ? history
        : history.filter((item) => visibleCommitIds.has(item.commitId)),
    [visibleCommitIds],
  );
  const visibleInFlight =
    head === null || visibleCommitIds?.has(heroInFlight.parentCommitId) ? heroInFlight : undefined;
  const viewingPast = isViewingPast(graph, position);
  const planRevision = lastPlanRevision(visibleTimeline);
  const planText =
    planRevision === null ? "" : (planTextByRevisionCreatedAt.get(planRevision.createdAt) ?? "");
  const specRevision = lastSpecRevision(visibleTimeline);
  const spec =
    specRevision === null ? null : (specByRevisionCommitId.get(specRevision.commitId) ?? null);
  const paneToggle = <PlanPaneToggle state={pane} onChange={setPane} />;
  const paneCornerControl = <div className="hidden lg:block">{paneToggle}</div>;
  const backToNow = () => setPosition(LATEST);
  const readOnlyAction = (
    <Button size="sm" variant="ghost" onClick={backToNow}>
      Back to now
    </Button>
  );
  const artifactPicker = (
    <ArtifactPicker value={pane.artifact} onChange={(artifact) => setPane({ ...pane, artifact })} />
  );

  return (
    <div className="flex h-full min-h-0 bg-background text-[12px] text-foreground">
      <div
        className={`flex min-w-0 flex-1 flex-col lg:basis-2/5 ${pane.open ? "lg:border-r lg:border-border" : ""}`}
      >
        <WorkspacePageHeader className="gap-2 border-b border-border">
          <h1 className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
            Marketing site hero
          </h1>
          {pane.open ? null : <div className="hidden lg:block">{paneToggle}</div>}
        </WorkspacePageHeader>
        <PlanTimeline
          codingSessions={[]}
          inFlight={visibleInFlight}
          timeline={visibleTimeline}
          onAnswerQuestion={() => undefined}
        />
        <PlanComposer {...composerProps} text={composerText} onChangeText={setComposerText} />
      </div>
      {pane.open ? (
        <div className="hidden min-w-0 flex-1 lg:flex">
          {pane.view === "explorer" ? (
            <HeroDagExplorer
              anchoredCommitId={head}
              cornerControl={paneCornerControl}
              onSelect={(commitId) => setPosition(positionAfterPick(graph, commitId))}
            />
          ) : pane.artifact === "plan" ? (
            <PlanArtifact
              cornerControl={paneCornerControl}
              parentCommitId={head ?? tip}
              planId={heroPlanId}
              planText={planText}
              readOnly={viewingPast}
              readOnlyAction={readOnlyAction}
              timeline={visibleTimeline}
              titleControl={artifactPicker}
              turnActive={visibleInFlight !== undefined}
            />
          ) : (
            <SpecArtifact
              cornerControl={paneCornerControl}
              parentCommitId={head ?? tip}
              planId={heroPlanId}
              readOnly={viewingPast}
              readOnlyAction={readOnlyAction}
              spec={spec}
              timeline={visibleTimeline}
              titleControl={artifactPicker}
              turnActive={visibleInFlight !== undefined}
            />
          )}
        </div>
      ) : null}
    </div>
  );
}

function HeroDagExplorer({
  anchoredCommitId,
  cornerControl,
  onSelect,
}: Pick<ComponentProps<typeof DagExplorer>, "anchoredCommitId" | "cornerControl" | "onSelect">) {
  const paneRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const pane = paneRef.current;
    if (pane === null) return;

    const stopGraphWheel = (event: WheelEvent) => event.stopPropagation();
    pane.addEventListener("wheel", stopGraphWheel, { capture: true });
    return () => pane.removeEventListener("wheel", stopGraphWheel, { capture: true });
  }, []);

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
      <DagExplorer
        {...graphProps}
        anchoredCommitId={anchoredCommitId}
        cornerControl={cornerControl}
        inFlightAnchorCommitIds={[heroInFlight.parentCommitId]}
        onSelect={onSelect}
      />
    </div>
  );
}

function ArtifactPicker({
  value,
  onChange,
}: {
  readonly value: "plan" | "spec";
  readonly onChange: (value: "plan" | "spec") => void;
}) {
  return (
    <Menu>
      <MenuTrigger
        aria-label="Select planning artifact"
        className="-ml-1 inline-flex h-7 cursor-pointer items-center gap-1 rounded-md px-1 text-sm font-medium text-foreground outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring data-popup-open:bg-accent"
      >
        {value === "spec" ? "Spec" : "Plan"}
        <svg
          aria-hidden="true"
          className="size-3.5 text-muted-foreground"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          viewBox="0 0 24 24"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </MenuTrigger>
      <MenuPopup align="start" className="w-(--anchor-width)">
        <MenuRadioGroup
          value={value}
          onValueChange={(selected) => {
            if (selected === "plan" || selected === "spec") onChange(selected);
          }}
        >
          <MenuRadioItem closeOnClick value="spec">
            Spec
          </MenuRadioItem>
          <MenuRadioItem closeOnClick value="plan">
            Plan
          </MenuRadioItem>
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}
