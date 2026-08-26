import { useEffect, useRef, useState } from "react";

import { DagExplorer } from "~/components/mercurian/DagExplorer";
import { buildPlanGraph } from "~/components/mercurian/PlanGraph.logic";
import { planCodingSessionRecord } from "~/test/fixtures/sessionsAndSplits";
import {
  codingSessionLeaf,
  message,
  planRevision,
  specRevision,
  timeline,
} from "~/test/fixtures/timeline";

const history = timeline(
  message("story-query", {
    text: "Turn the product direction into a plan.",
  }),
  planRevision("story-plan", {
    sequence: 2,
    parents: ["story-query"],
    authorKind: "assistant",
  }),
  specRevision("story-spec", {
    sequence: 3,
    parents: ["story-plan"],
    authorKind: "assistant",
  }),
  message("story-response", {
    sequence: 4,
    parents: ["story-spec"],
    authorKind: "assistant",
    text: "The plan is ready to explore.",
  }),
  message("product-fork", {
    sequence: 5,
    parents: ["story-response"],
    text: "Take the product direction further.",
  }),
  message("systems-fork", {
    sequence: 6,
    parents: ["story-response"],
    text: "Explore the systems direction instead.",
  }),
  planRevision("product-plan", {
    sequence: 7,
    parents: ["product-fork"],
    authorKind: "assistant",
  }),
  message("systems-response", {
    sequence: 8,
    parents: ["systems-fork"],
    authorKind: "assistant",
    text: "The systems direction is mapped.",
  }),
  message("merge-directions", {
    sequence: 9,
    parents: ["product-plan", "systems-response"],
    text: "Bring both directions back together.",
  }),
  planRevision("merged-plan", {
    sequence: 10,
    parents: ["merge-directions"],
    authorKind: "assistant",
  }),
  specRevision("merged-spec", {
    sequence: 11,
    parents: ["merged-plan"],
    authorKind: "assistant",
  }),
  codingSessionLeaf("web-session", {
    sequence: 12,
    parents: ["merged-spec"],
    repositoryId: "web",
    repositoryName: "web",
    planRevisionCommitId: "merged-plan",
  }),
  codingSessionLeaf("server-session", {
    sequence: 13,
    parents: ["merged-spec"],
    repositoryId: "server",
    repositoryName: "server",
    planRevisionCommitId: "merged-plan",
  }),
);

const captions = [
  "Planning starts as one thread of history.",
  "Return to any earlier point and take a different direction — that's a fork.",
  "Both directions stay first-class. Nothing is overwritten.",
  "Forks and merges are human-driven; a merge brings the directions back together.",
  "From a coherent checkpoint, the plan is implemented through coding sessions.",
] as const;

const lastSequences = [4, 6, 8, 11, 13] as const;
const codingSessions = [
  planCodingSessionRecord("web-session", {
    commitId: "web-session",
    repositoryId: "web",
  }),
  planCodingSessionRecord("server-session", {
    commitId: "server-session",
    repositoryId: "server",
  }),
] as const;
const readyCommitId = history[10]!.commitId;
const readyCommits = new Map([
  [
    readyCommitId,
    {
      commitId: readyCommitId,
      repositoryId: codingSessions[0].repositoryId,
      repositoryName: "web",
    },
  ],
]);

const beats = lastSequences.map((lastSequence, index) => {
  const beatHistory = history.filter((commit) => commit.sequence <= lastSequence);
  return {
    caption: captions[index]!,
    graph: buildPlanGraph(beatHistory),
    anchoredCommitId: beatHistory.at(-1)!.commitId,
    codingSessions: index === lastSequences.length - 1 ? codingSessions : [],
    readyCommits: index === lastSequences.length - 1 ? readyCommits : new Map(),
  };
});
type StoryBeat = (typeof beats)[number];

const staticExplorerProps = {
  providers: [],
  stalePlanCommitIds: new Set<string>(),
  staleSpecCommitIds: new Set<string>(),
  onColumnsWidthCapChange: () => undefined,
  onEditAndBranch: () => undefined,
  onImplementFrom: () => undefined,
  onSelect: () => undefined,
} as const;

const stackedQuery = "(prefers-reduced-motion: reduce), (max-width: 767px)";

function Explorer({ beat }: { readonly beat: StoryBeat }) {
  return <DagExplorer {...staticExplorerProps} {...beat} />;
}

export default function GraphStoryIsland() {
  const [beatIndex, setBeatIndex] = useState(0);
  const [stacked, setStacked] = useState(
    () => typeof window !== "undefined" && window.matchMedia(stackedQuery).matches,
  );
  const waypointRefs = useRef<Array<HTMLDivElement | null>>([]);

  useEffect(() => {
    const media = window.matchMedia(stackedQuery);
    const updateLayout = () => setStacked(media.matches);
    updateLayout();
    media.addEventListener("change", updateLayout);
    return () => media.removeEventListener("change", updateLayout);
  }, []);

  useEffect(() => {
    if (stacked) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];
        if (visible === undefined) return;
        const nextBeat = Number((visible.target as HTMLElement).dataset.beat);
        if (Number.isInteger(nextBeat)) setBeatIndex(nextBeat);
      },
      { rootMargin: "-42% 0px -42% 0px", threshold: [0, 1] },
    );
    for (const waypoint of waypointRefs.current) {
      if (waypoint !== null) observer.observe(waypoint);
    }
    return () => observer.disconnect();
  }, [stacked]);

  if (stacked) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-16 px-4 py-16 sm:px-6">
        {beats.map((beat) => (
          <figure className="flex flex-col gap-6" key={beat.anchoredCommitId}>
            <figcaption className="max-w-2xl text-xl leading-relaxed text-foreground sm:text-2xl">
              {beat.caption}
            </figcaption>
            <div className="flex h-[32rem] min-h-0 overflow-hidden rounded-xl border border-border bg-background shadow-sm">
              <Explorer beat={beat} />
            </div>
          </figure>
        ))}
      </div>
    );
  }

  return (
    <div className="mx-auto grid w-full max-w-7xl grid-cols-[minmax(16rem,0.7fr)_minmax(0,1.8fr)] gap-10 px-8 xl:gap-16">
      <div className="py-[15vh]">
        {beats.map((beat, index) => (
          <div
            className="flex min-h-[70vh] items-center"
            data-beat={index}
            key={beat.anchoredCommitId}
            ref={(waypoint) => {
              waypointRefs.current[index] = waypoint;
            }}
          >
            <p className="text-2xl leading-relaxed text-foreground xl:text-3xl">{beat.caption}</p>
          </div>
        ))}
      </div>
      <div className="relative">
        <div className="sticky top-0 flex h-screen items-center py-8">
          <div className="flex h-[min(78vh,48rem)] min-h-0 w-full overflow-hidden rounded-xl border border-border bg-background shadow-sm">
            <Explorer beat={beats[beatIndex]!} />
          </div>
        </div>
      </div>
    </div>
  );
}
