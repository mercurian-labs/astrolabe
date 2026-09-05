import { ClockIcon } from "~/../node_modules/lucide-react";
import {
  DagExplorer,
  EXPLORER_VIEW_STORAGE_KEY,
  ExplorerView,
} from "~/components/mercurian/DagExplorer";
import { PlanArtifact } from "./legacy/PlanArtifact";
import { lastPlanRevision } from "./legacy/PlanArtifact.logic";
import { PlanComposer } from "./legacy/PlanComposer";
import { ancestorClosure, buildPlanGraph } from "~/components/mercurian/PlanGraph.logic";
import { PlanModelPicker } from "./legacy/PlanModelPicker";
import {
  isViewingPast,
  LATEST,
  positionAfterPick,
  resolveHead,
  type PlanPosition,
} from "~/components/mercurian/PlanPosition.logic";
import { PlanPaneToggle } from "./legacy/PlanPaneToggle";
import { PlanTimeline } from "./legacy/PlanTimeline";
import { SpecArtifact } from "./legacy/SpecArtifact";
import { lastSpecRevision } from "./legacy/SpecArtifact.logic";
import { WorkspacePageHeader } from "~/components/WorkspacePageHeader";
import { Button } from "~/components/ui/button";
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "~/components/ui/menu";
import { setLocalStorageItem } from "~/hooks/useLocalStorage";
import { commitId, message, planRevision, specRevision, timeline } from "~/test/fixtures/timeline";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentProps } from "react";

const history = timeline(
  message("plan-query", {
    sequence: 1,
    text: "Plan a restrained landing page for Mercurian",
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
    text: "A first pass for the landing page is ready.",
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
  message("interface-tangent-query", {
    sequence: 11,
    parents: ["interface-response"],
    text: "Could we drop the headline entirely?",
  }),
  message("interface-tangent-response", {
    sequence: 12,
    parents: ["interface-tangent-query"],
    authorKind: "assistant",
    text: "We considered it, then parked the idea so the page keeps a clear introduction.",
  }),
  message("workflow-tangent-query", {
    sequence: 13,
    parents: ["workflow-response"],
    text: "Can the product demo run on fixture data alone?",
  }),
  message("workflow-tangent-response", {
    sequence: 14,
    parents: ["workflow-tangent-query"],
    authorKind: "assistant",
    text: "Yes. Fixture data keeps the demo immediate and self-contained.",
  }),
  message("interface-continue-query", {
    sequence: 15,
    parents: ["interface-response"],
    text: "Trim the below-fold page to fewer sections",
  }),
  planRevision("interface-plan-2", {
    sequence: 16,
    parents: ["interface-continue-query"],
    authorKind: "assistant",
  }),
  message("interface-continue-response", {
    sequence: 17,
    parents: ["interface-plan-2"],
    authorKind: "assistant",
    text: "The quieter path now keeps only the essential sections below the fold.",
  }),
  message("workflow-continue-query", {
    sequence: 18,
    parents: ["workflow-response"],
    text: "Fold deployment into the first milestone",
  }),
  planRevision("workflow-plan-2", {
    sequence: 19,
    parents: ["workflow-continue-query"],
    authorKind: "assistant",
  }),
  message("workflow-continue-response", {
    sequence: 20,
    parents: ["workflow-plan-2"],
    authorKind: "assistant",
    text: "The workflow path now includes deployment in the first milestone.",
  }),
  message("workflow-tangent-fold-ask", {
    sequence: 21,
    parents: ["workflow-tangent-response"],
    text: "Fold the fixture approach into the plan.",
  }),
);

const openingAskCommitId = commitId("workflow-tangent-fold-ask");
const tip = openingAskCommitId;
const heroPlanId = "marketing-site-hero" as ComponentProps<typeof PlanArtifact>["planId"];
type HeroInFlight = NonNullable<ComponentProps<typeof PlanTimeline>["inFlight"]>;
type HeroComposerProps = ComponentProps<typeof PlanComposer>;
type HeroProvider = NonNullable<HeroComposerProps["provider"]>;
type HeroProviderSnapshot = ComponentProps<typeof PlanModelPicker>["providers"][number];
type HeroModelSelection = NonNullable<ComponentProps<typeof PlanModelPicker>["selection"]>;
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

const claudeDriver = "claudeAgent" as HeroProvider;
const codexDriver = "codex" as HeroProvider;
const opencodeDriver = "opencode" as HeroProvider;
const heroProviders = [
  {
    instanceId: "claudeAgent" as HeroProviderSnapshot["instanceId"],
    driver: claudeDriver,
    displayName: "Claude Code",
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-08-30T00:00:00.000Z",
    models: [
      { slug: "opus", name: "Opus", isCustom: false, isDefault: true, capabilities: null },
      { slug: "sonnet", name: "Sonnet", isCustom: false, capabilities: null },
    ],
    slashCommands: [],
    skills: [],
  },
  {
    instanceId: "codex" as HeroProviderSnapshot["instanceId"],
    driver: codexDriver,
    displayName: "Codex",
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-08-30T00:00:00.000Z",
    models: [
      { slug: "gpt-5.6", name: "GPT-5.6", isCustom: false, isDefault: true, capabilities: null },
      { slug: "gpt-5.4", name: "GPT-5.4", isCustom: false, capabilities: null },
    ],
    slashCommands: [],
    skills: [],
  },
  {
    instanceId: "opencode" as HeroProviderSnapshot["instanceId"],
    driver: opencodeDriver,
    displayName: "OpenCode",
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-08-30T00:00:00.000Z",
    models: [
      {
        slug: "openai/gpt-5",
        name: "GPT-5",
        isCustom: false,
        isDefault: true,
        capabilities: null,
      },
      {
        slug: "anthropic/claude-opus-5",
        name: "Claude Opus 5",
        isCustom: false,
        capabilities: null,
      },
    ],
    slashCommands: [],
    skills: [],
  },
] satisfies ReadonlyArray<HeroProviderSnapshot>;

const DEFAULT_MODEL_SELECTION = {
  provider: claudeDriver,
  model: "opus",
} satisfies HeroModelSelection;

const INITIAL_POSITION = {
  _tag: "at",
  commitId: openingAskCommitId,
  live: true,
} satisfies PlanPosition;

const OPENING_STREAMING_TEXT = "I'm folding the fixture approach into the plan now.";
const OPENING_LANDED_TEXT = "The fixture approach is folded into the plan.";

const INITIAL_IN_FLIGHT = {
  turnId: "hero-opening-turn" as HeroInFlight["turnId"],
  parentCommitId: openingAskCommitId,
  text: OPENING_STREAMING_TEXT,
  grounding: [{ kind: "search", label: "fixture-only demo" }],
} satisfies HeroInFlight;

const OPENING_REPLY_NAME = "hero-opening-assistant";
const OPENING_REPLY_COMMIT_ID = commitId(OPENING_REPLY_NAME);
const HERO_REPLY_TEXT =
  "To try Astrolabe, checkout the project [here](https://github.com/mercurian-labs/astrolabe).";

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
    history[15]!.createdAt,
    `# Trimmed page

## Above the fold
- Keep the short opening claim and the live planning window.
- Let the product surface provide the detail.

## Below the fold
- Retain the provider band and closing statement.
- Remove supporting sections that repeat the same proof.`,
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
  [
    history[18]!.createdAt,
    `# Folded delivery path

## First milestone
- Build the interactive hero from real product components and fixture history.
- Include the static build and deployment in the same delivery step.

## Follow-through
- Polish the page copy after the deployed surface is stable.
- Keep all site-specific behavior inside the landing app.`,
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

const graphProps = {
  providers: [],
  codingSessions: [],
  readyCommits: new Map(),
  stalePlanCommitIds: new Set<string>(),
  staleSpecCommitIds: new Set<string>(),
  onEditAndBranch: () => undefined,
  onImplementFrom: () => undefined,
  onOpenChanges: () => undefined,
  onContinueFromCheckpoint: () => undefined,
} as const;

const composerProps = {
  placeholder: "Research, plan, or build...",
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
  onAddAttachments: () => undefined,
  onRemoveAttachment: () => undefined,
} satisfies Omit<
  HeroComposerProps,
  "banner" | "modelPicker" | "onChangeText" | "onSend" | "onStop" | "text" | "turnActive"
>;

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
  const documentScrollPosition = useRef({ x: 0, y: 0 });
  const [composerText, setComposerText] = useState("");
  const [pane, setPane] = useState<RightPaneState>(DEFAULT_RIGHT_PANE);
  const [timelineExtensions, setTimelineExtensions] = useState<
    ReadonlyArray<(typeof history)[number]>
  >([]);
  const [heroInFlight, setHeroInFlight] = useState<HeroInFlight | undefined>(INITIAL_IN_FLIGHT);
  const [modelSelection, setModelSelection] = useState<HeroModelSelection>(DEFAULT_MODEL_SELECTION);
  const [position, setPosition] = useState<PlanPosition>(INITIAL_POSITION);
  const replyTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const visitorTurnCounter = useRef(0);
  const heroTimeline = useMemo(() => [...history, ...timelineExtensions], [timelineExtensions]);
  const graph = useMemo(() => buildPlanGraph(heroTimeline), [heroTimeline]);
  const head = resolveHead(graph, position);
  const headRef = useRef(head);

  // Product components assume a pinned viewport; the landing page scrolls, so
  // neutralize document scrolling caused by effects inside this island.
  useLayoutEffect(() => {
    documentScrollPosition.current = { x: window.scrollX, y: window.scrollY };
  });
  useEffect(() => {
    const saved = documentScrollPosition.current;
    if (window.scrollX !== saved.x || window.scrollY !== saved.y) {
      window.scrollTo(saved.x, saved.y);
    }
  });

  useLayoutEffect(() => {
    headRef.current = head;
  }, [head]);
  const visibleCommitIds = useMemo(
    () => (head === null ? null : ancestorClosure(graph, head)),
    [graph, head],
  );
  const visibleTimeline = useMemo(
    () =>
      visibleCommitIds === null
        ? heroTimeline
        : heroTimeline.filter((item) => visibleCommitIds.has(item.commitId)),
    [heroTimeline, visibleCommitIds],
  );
  const visibleInFlight =
    heroInFlight !== undefined &&
    (head === null || visibleCommitIds?.has(heroInFlight.parentCommitId))
      ? heroInFlight
      : undefined;
  const viewingPast = isViewingPast(graph, position);
  const planRevision = lastPlanRevision(visibleTimeline);
  const planText =
    planRevision === null ? "" : (planTextByRevisionCreatedAt.get(planRevision.createdAt) ?? "");
  const specRevision = lastSpecRevision(visibleTimeline);
  const spec =
    specRevision === null ? null : (specByRevisionCommitId.get(specRevision.commitId) ?? null);
  const paneToggle = <PlanPaneToggle state={pane} onChange={setPane} />;
  const paneCornerControl = paneToggle;
  const backToNow = () => setPosition(LATEST);
  const readOnlyAction = (
    <Button size="sm" variant="ghost" onClick={backToNow}>
      Back to now
    </Button>
  );
  const artifactPicker = (
    <ArtifactPicker value={pane.artifact} onChange={(artifact) => setPane({ ...pane, artifact })} />
  );
  const banner = viewingPast ? <ViewingEarlierBanner onBack={backToNow} /> : null;
  const modelPicker = (
    <PlanModelPicker
      disabled={visibleInFlight !== undefined}
      providers={heroProviders}
      selection={modelSelection}
      onChange={setModelSelection}
    />
  );
  const sendMessage: HeroComposerProps["onSend"] = async ({ text }) => {
    if (head === null) return false;

    visitorTurnCounter.current += 1;
    const turnNumber = visitorTurnCounter.current;
    const userMessageName = `hero-visitor-user-${turnNumber}`;
    const userCommitId = commitId(userMessageName);
    const assistantMessageName = `hero-visitor-assistant-${turnNumber}`;
    const assistantCommitId = commitId(assistantMessageName);
    const pendingReply = {
      turnId: `hero-visitor-turn-${turnNumber}` as HeroInFlight["turnId"],
      parentCommitId: userCommitId,
      text: HERO_REPLY_TEXT,
      grounding: [],
    } satisfies HeroInFlight;

    setTimelineExtensions((current) => [
      ...current,
      message(userMessageName, {
        sequence: history.length + current.length + 1,
        parents: [head],
        text,
      }),
    ]);
    setPosition(LATEST);
    setHeroInFlight(pendingReply);
    const timer = setTimeout(() => {
      setTimelineExtensions((current) => [
        ...current,
        message(assistantMessageName, {
          sequence: history.length + current.length + 1,
          parents: [userCommitId],
          authorKind: "assistant",
          text: HERO_REPLY_TEXT,
        }),
      ]);
      setPosition((current) =>
        current._tag === "latest" ||
        (current._tag === "at" && current.commitId === userCommitId && current.live)
          ? { _tag: "at", commitId: assistantCommitId, live: true }
          : current,
      );
      setHeroInFlight((current) => (current?.turnId === pendingReply.turnId ? undefined : current));
      replyTimers.current.delete(pendingReply.turnId);
    }, 1_500);
    replyTimers.current.set(pendingReply.turnId, timer);
    setComposerText("");
    return true;
  };
  const stopReply = () => {
    if (heroInFlight === undefined) return;
    const timer = replyTimers.current.get(heroInFlight.turnId);
    if (timer !== undefined) clearTimeout(timer);
    replyTimers.current.delete(heroInFlight.turnId);
    setHeroInFlight(undefined);
  };

  useEffect(() => {
    const timers = replyTimers.current;
    const openingTimer = setTimeout(() => {
      const standingHead = headRef.current;
      setTimelineExtensions((current) => [
        ...current,
        message(OPENING_REPLY_NAME, {
          sequence: history.length + current.length + 1,
          parents: [openingAskCommitId],
          authorKind: "assistant",
          text: OPENING_LANDED_TEXT,
        }),
      ]);
      setPosition((current) => {
        if (
          current._tag === INITIAL_POSITION._tag &&
          current.commitId === INITIAL_POSITION.commitId &&
          current.live === INITIAL_POSITION.live
        ) {
          return { _tag: "at", commitId: OPENING_REPLY_COMMIT_ID, live: true };
        }
        // LATEST follows the global sequence, so pin the visitor's current branch
        // before this opening reply lands elsewhere in the graph.
        return current._tag === "latest" && standingHead !== null
          ? { _tag: "at", commitId: standingHead, live: true }
          : current;
      });
      setHeroInFlight((current) =>
        current?.turnId === INITIAL_IN_FLIGHT.turnId ? undefined : current,
      );
      timers.delete(INITIAL_IN_FLIGHT.turnId);
    }, 2_500);
    timers.set(INITIAL_IN_FLIGHT.turnId, openingTimer);

    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-[12px] text-foreground">
      {pane.open ? null : (
        <WorkspacePageHeader className="gap-2 border-b border-border md:hidden">
          <h1 className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
            Marketing site hero
          </h1>
          {paneToggle}
        </WorkspacePageHeader>
      )}
      <div className="flex min-h-0 min-w-0 flex-1">
        <div
          className={`min-w-0 flex-1 flex-col md:basis-2/5 ${pane.open ? "hidden md:flex md:border-r md:border-border" : "flex"}`}
        >
          <WorkspacePageHeader className="hidden gap-2 border-b border-border md:flex">
            <h1 className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
              Marketing site hero
            </h1>
            {/* The artifacts carry the toggle in their corner; the graph pane has no
                corner of its own, so the header keeps it while the graph shows. */}
            {pane.open && pane.view === "artifact" ? null : paneToggle}
          </WorkspacePageHeader>
          <PlanTimeline
            codingSessions={[]}
            inFlight={visibleInFlight}
            timeline={visibleTimeline}
            onAnswerQuestion={() => undefined}
          />
          <div data-hero-composer>
            <PlanComposer
              {...composerProps}
              banner={banner}
              modelPicker={modelPicker}
              text={composerText}
              turnActive={visibleInFlight !== undefined}
              onChangeText={setComposerText}
              onSend={sendMessage}
              onStop={stopReply}
            />
          </div>
        </div>
        {pane.open ? (
          <div className="flex min-w-0 flex-1">
            {pane.view === "explorer" ? (
              <HeroDagExplorer
                anchoredCommitId={head}
                graph={graph}
                inFlightAnchorCommitIds={
                  heroInFlight === undefined ? [] : [heroInFlight.parentCommitId]
                }
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
    </div>
  );
}

function HeroDagExplorer({
  anchoredCommitId,
  graph,
  inFlightAnchorCommitIds,
  onSelect,
}: Pick<
  ComponentProps<typeof DagExplorer>,
  "anchoredCommitId" | "graph" | "inFlightAnchorCommitIds" | "onSelect"
>) {
  const paneRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const pane = paneRef.current;
    if (pane === null) return;

    const stopGraphWheel = (event: WheelEvent) => event.stopPropagation();
    pane.addEventListener("wheel", stopGraphWheel, { capture: true });
    return () => pane.removeEventListener("wheel", stopGraphWheel, { capture: true });
  }, []);

  return (
    <div className="flex min-w-0 flex-1" ref={paneRef}>
      <DagExplorer
        {...graphProps}
        graph={graph}
        anchoredCommitId={anchoredCommitId}
        inFlightAnchorCommitIds={inFlightAnchorCommitIds}
        onSelect={onSelect}
      />
    </div>
  );
}

function ViewingEarlierBanner({ onBack }: { readonly onBack: () => void }) {
  return (
    <div className="flex items-center gap-2 border-b border-border/65 bg-muted/20 px-3 py-2">
      <ClockIcon className="size-3.5 shrink-0 text-muted-foreground/70" />
      {/* Wraps rather than truncates: what sending does from here is the one
          thing that must not get cut off in a narrow window. */}
      <span className="min-w-0 flex-1 text-xs leading-snug text-muted-foreground">
        Viewing an earlier point — sending starts a new branch from here
      </span>
      <Button className="shrink-0" size="xs" variant="outline" onClick={onBack}>
        Back to now
      </Button>
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
