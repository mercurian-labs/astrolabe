import {
  DagExplorer,
  EXPLORER_VIEW_STORAGE_KEY,
  ExplorerView,
} from "~/components/mercurian/DagExplorer";
import { buildPlanGraph } from "~/components/mercurian/PlanGraph.logic";
import { setLocalStorageItem } from "~/hooks/useLocalStorage";
import { message, planRevision, specRevision, timeline } from "~/test/fixtures/timeline";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
} from "react";

const AUTOPLAY_DELAY_MS = 8_000;
const SLIDE_COUNT = 3;

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

const providers = [
  { name: "Claude Code", src: "/harnesses/claude-ai-icon.svg" },
  { name: "Codex", src: "/harnesses/openai_dark.svg" },
  { name: "Cursor", src: "/harnesses/cursor_light.svg" },
  { name: "Grok", src: "/harnesses/grok-dark.svg" },
  { name: "OpenCode", src: "/harnesses/opencode-dark.svg" },
] as const;

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

function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setPrefersReducedMotion(mediaQuery.matches);

    updatePreference();
    mediaQuery.addEventListener("change", updatePreference);
    return () => mediaQuery.removeEventListener("change", updatePreference);
  }, []);

  return prefersReducedMotion;
}

export default function HeroCarousel() {
  const [currentSlide, setCurrentSlide] = useState(0);
  const [timerReset, setTimerReset] = useState(0);
  const [resumeCounter, setResumeCounter] = useState(0);
  const [isHovered, setIsHovered] = useState(false);
  const [hasFocusWithin, setHasFocusWithin] = useState(false);
  const prefersReducedMotion = usePrefersReducedMotion();
  const isAutoplayPaused = isHovered || hasFocusWithin;
  const wasAutoplayPaused = useRef(isAutoplayPaused);

  useLayoutEffect(() => {
    if (wasAutoplayPaused.current && !isAutoplayPaused) {
      setResumeCounter((counter) => counter + 1);
    }
    wasAutoplayPaused.current = isAutoplayPaused;
  }, [isAutoplayPaused]);

  useEffect(() => {
    if (prefersReducedMotion || isAutoplayPaused) return;

    const interval = window.setInterval(() => {
      setCurrentSlide((slide) => (slide + 1) % SLIDE_COUNT);
    }, AUTOPLAY_DELAY_MS);

    return () => window.clearInterval(interval);
  }, [currentSlide, isAutoplayPaused, prefersReducedMotion, timerReset]);

  const navigate = useCallback((slide: number) => {
    setCurrentSlide((slide + SLIDE_COUNT) % SLIDE_COUNT);
    setTimerReset((reset) => reset + 1);
  }, []);

  const handleBlur = (event: ReactFocusEvent<HTMLElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setHasFocusWithin(false);
  };

  return (
    <section
      aria-label="Product highlights"
      className="w-full max-w-full min-w-0"
      onBlur={handleBlur}
      onFocus={() => setHasFocusWithin(true)}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="w-full max-w-full min-w-0 overflow-hidden">
        <div
          className="flex w-full max-w-full min-w-0"
          style={{
            transform: `translateX(-${currentSlide * 100}%)`,
            transition: prefersReducedMotion ? "none" : "transform 500ms ease",
          }}
        >
          <section
            aria-hidden={currentSlide !== 0}
            aria-label="Slide 1 of 3"
            className="grid w-full max-w-full min-w-0 shrink-0 grow-0 basis-full grid-cols-1 items-center gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-12"
            inert={currentSlide !== 0}
            role="group"
          >
            <SlideCopy
              copy="Every message and every plan edit is a commit in one branching, git-style history. Return to any point and take a different direction, explore open decisions side by side, then merge the branches back into a single plan — with fresh, compacted context instead of a rotting thread. Nothing is ever destroyed, and forks and merges are yours alone to make."
              title="Plan in branches. Merge what works."
            />
            <div className="flex h-[25rem] w-full max-w-full min-w-0 overflow-hidden rounded-xl border border-border bg-background/80 shadow-sm">
              <DagExplorer {...graphProps} />
            </div>
          </section>

          <section
            aria-hidden={currentSlide !== 1}
            aria-label="Slide 2 of 3"
            className="grid w-full max-w-full min-w-0 shrink-0 grow-0 basis-full grid-cols-1 items-center gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-12"
            inert={currentSlide !== 1}
            role="group"
          >
            <SlideCopy
              copy="Your project's design truth lives as atomic, linked markdown notes in a git repository you own. Nothing is captured behind your back — the assistant proposes an amendment, you confirm it, and it lands as a commit attributed to the plan it came from. Mercurian is a lens over your memory, never a silo for it: every note stays editable with any tool and portable out of the product entirely."
              title="Memory you can actually read."
            />
            <div className="flex h-[25rem] w-full max-w-full min-w-0 flex-col items-center justify-center rounded-xl border border-border bg-background/80 p-8 shadow-sm">
              <svg
                aria-hidden="true"
                className="h-44 w-full max-w-md text-muted-foreground/45"
                fill="none"
                viewBox="0 0 420 180"
              >
                <path d="M64 91 151 45l92 45 108-53" stroke="currentColor" strokeWidth="1.5" />
                <path d="m64 91 93 53 86-54 108 48" stroke="currentColor" strokeWidth="1.5" />
                <circle className="fill-background stroke-border" cx="64" cy="91" r="15" />
                <circle className="fill-background stroke-border" cx="151" cy="45" r="12" />
                <circle className="fill-background stroke-border" cx="157" cy="144" r="12" />
                <circle className="fill-background stroke-border" cx="243" cy="90" r="16" />
                <circle className="fill-background stroke-border" cx="351" cy="37" r="11" />
                <circle className="fill-background stroke-border" cx="351" cy="138" r="11" />
                <circle className="fill-muted-foreground/20 stroke-border" cx="243" cy="90" r="5" />
              </svg>
              <p className="mt-6 text-center text-sm text-muted-foreground">
                Memory's graph view arrives with the memory system.
              </p>
            </div>
          </section>

          <section
            aria-hidden={currentSlide !== 2}
            aria-label="Slide 3 of 3"
            className="grid w-full max-w-full min-w-0 shrink-0 grow-0 basis-full grid-cols-1 items-center gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-12"
            inert={currentSlide !== 2}
            role="group"
          >
            <SlideCopy
              copy="Mercurian plans with the coding agents you already have — Claude Code, Codex, Cursor, and more — switchable between turns, even mid-plan, with every branch recording exactly what it ran under. It runs on your machine, against your repositories, with no sign up required. Plans, history, and memory are plain text and git: yours to keep, wherever you go next."
              title="Your agents. Your machine. No account."
            />
            <div className="flex h-[25rem] w-full max-w-full min-w-0 items-center rounded-xl border border-border bg-background/80 p-6 shadow-sm sm:p-10">
              <ul className="grid w-full max-w-full min-w-0 grid-cols-2 gap-5 sm:grid-cols-5 sm:gap-3">
                {providers.map((provider) => (
                  <li className="flex min-w-0 flex-col items-center gap-3" key={provider.name}>
                    <span className="flex size-16 items-center justify-center rounded-xl bg-foreground p-3 dark:bg-background">
                      <img
                        alt={provider.name}
                        className="size-10 object-contain"
                        height="40"
                        src={provider.src}
                        width="40"
                      />
                    </span>
                    <span className="text-center text-xs font-medium text-foreground">
                      {provider.name}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        </div>
      </div>

      <nav aria-label="Carousel navigation" className="mt-6 flex items-center justify-center gap-4">
        <button
          aria-label="Previous slide"
          className="flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
          onClick={() => navigate(currentSlide - 1)}
          type="button"
        >
          <Chevron direction="previous" />
        </button>

        <div className="flex items-center gap-1">
          {[
            "Plan in branches. Merge what works.",
            "Memory you can actually read.",
            "Your agents. Your machine. No account.",
          ].map((title, index) => (
            <button
              aria-current={index === currentSlide ? "true" : undefined}
              aria-label={`Go to slide ${index + 1}: ${title}`}
              className="flex h-10 w-12 items-center justify-center rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
              key={title}
              onClick={() => navigate(index)}
              type="button"
            >
              <span className="h-1 w-8 overflow-hidden rounded-full bg-muted-foreground/25">
                {index === currentSlide ? (
                  <span
                    className="block h-full w-full origin-left rounded-full bg-foreground"
                    key={`${currentSlide}-${timerReset}-${resumeCounter}-${prefersReducedMotion}`}
                    style={
                      prefersReducedMotion
                        ? { transform: "scaleX(1)" }
                        : {
                            animation: `hero-carousel-progress ${AUTOPLAY_DELAY_MS}ms linear forwards`,
                            animationPlayState: isAutoplayPaused ? "paused" : "running",
                          }
                    }
                  />
                ) : null}
              </span>
            </button>
          ))}
        </div>

        <button
          aria-label="Next slide"
          className="flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
          onClick={() => navigate(currentSlide + 1)}
          type="button"
        >
          <Chevron direction="next" />
        </button>
      </nav>

      <style>{`
        @keyframes hero-carousel-progress {
          from { transform: scaleX(0); }
          to { transform: scaleX(1); }
        }
      `}</style>
    </section>
  );
}

function SlideCopy({ title, copy }: { readonly title: string; readonly copy: string }) {
  return (
    <div className="w-full max-w-full min-w-0">
      <h2 className="w-full max-w-xl min-w-0 text-4xl leading-[1.05] font-medium tracking-tight sm:text-5xl xl:text-6xl">
        {title}
      </h2>
      <p className="mt-6 w-full max-w-xl min-w-0 text-base leading-relaxed text-muted-foreground sm:text-lg">
        {copy}
      </p>
    </div>
  );
}

function Chevron({ direction }: { readonly direction: "previous" | "next" }) {
  return (
    <svg aria-hidden="true" className="size-4" fill="none" viewBox="0 0 24 24">
      <path
        d={direction === "previous" ? "m15 18-6-6 6-6" : "m9 18 6-6-6-6"}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
