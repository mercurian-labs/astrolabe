import "@mercurian/graph/styles.css";
import {
  AtlasGraph,
  createLeanRenderer,
  DEFAULT_SETTINGS,
  defaultDepth,
  holdSeconds,
  NO_FILTERS,
  type AtlasGraphHandle,
  type PlayPick,
} from "@mercurian/graph";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type {
  EnvironmentId,
  ScopedThreadRef,
  ThreadId,
  WikiChangeRequestId,
  WikiId,
} from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import { ChevronLeftIcon, ChevronRightIcon, PauseIcon, PlayIcon } from "lucide-react";
import { useContext, useEffect, useRef, useState } from "react";

import { useTheme } from "~/hooks/useTheme";
import { PanesHostContext } from "~/panes/panesHost";
import { workspace } from "~/panes/workspace";
import { showKeyIn } from "~/sectionTabs/SectionTabContent";
import { useThreadProjection, useThreadShell, useThreadShells } from "~/state/entities";
import { useEnvironmentQuery } from "~/state/query";
import { wikiEnvironment } from "~/state/wiki";
import { storyRuns, turnLabels, type StoryRun } from "~/threadTurns";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { isTurnRunning } from "../wiki/wiki.logic";
import { WikiPart } from "../wiki/WikiParts";
import { wikiTabKey, type WikiTab } from "../wiki/wikiTabs";
import { ATLAS_COLORS } from "./atlasColors";
import { coordinatorWork, threadChangeRequestOn, type CoordinatorWork } from "./coordinatorWork";
import {
  useGraphPanelStore,
  CLOSED_PANEL,
  type GraphPanelAction,
  type GraphPanelState,
} from "./graphPanelStore";
import { clampStrip, popoverClosesOnPark, shownCheckpoint, stripIsLive } from "./turnStrip";
import {
  notesNeedingMainText,
  resolveWiki,
  shownTurn,
  touchedWikis,
  wikiMemory,
  wikiStory,
  wikiToolCalls,
  type WikiToolCall,
} from "./wikiStory";

/** The graph reads its colours from these on its own element; they follow the app's theme. */

const NO_CALLS: WikiToolCall[] = [];
const NO_RUNS: StoryRun[] = [];

/**
 * Main-line text of the notes a story needs (see `notesNeedingMainText`), by name; null while any
 * is still loading. A refreshed read keeps the last value, so the story does not blink.
 */
const mainTextsAtom = Atom.family((key: string) => {
  const [environmentId, wikiId, names] = JSON.parse(key) as [EnvironmentId, WikiId, string[]];
  return Atom.make((get): Record<string, string> | null => {
    const texts: Record<string, string> = {};
    for (const name of names) {
      const result = get(wikiEnvironment.note({ environmentId, input: { wikiId, name } }));
      const value = Option.getOrNull(AsyncResult.value(result));
      if (value !== null) texts[name] = value.source;
      else if (result._tag !== "Failure") return null;
    }
    return texts;
  }).pipe(Atom.withLabel(`web-graph:main-texts:${key}`));
});

/**
 * The thread told as an Atlas Graph over the wiki it worked in, plus a Work list of child threads
 * and their change requests. The projection changes on every streamed token, so the story's inputs
 * are reduced to strings first and parsed back behind memos keyed on them: the story, and so the
 * graph's layout, only changes when a wiki call does.
 */
export default function GraphPanel({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const { environmentId, threadId } = threadRef;
  const navigate = useNavigate();
  const projection = useThreadProjection(threadRef)?.projection ?? null;
  const self = useThreadShell(threadRef);
  const shells = useThreadShells();
  const wikis = useEnvironmentQuery(wikiEnvironment.list({ environmentId, input: {} }));
  const allChangeRequests = useEnvironmentQuery(
    wikiEnvironment.changeRequests({ environmentId, input: {} }),
  );

  const callsKey = JSON.stringify(
    projection === null ? NO_CALLS : wikiToolCalls(projection.turnItems),
  );
  const calls = JSON.parse(callsKey) as WikiToolCall[];
  const runsKey = JSON.stringify(projection === null ? NO_RUNS : storyRuns(projection.runs));
  const runs = JSON.parse(runsKey) as StoryRun[];
  const labelKey = turnLabels(runs, projection?.messages ?? [])
    .map((label) => label.replaceAll("\u0000", ""))
    .join("\u0000");
  const labels = labelKey.split("\u0000");
  const live = shownTurn(runs, projection?.runs ?? []);

  const listed = wikis.data?.wikis ?? [];
  const touched = touchedWikis(listed, calls);
  const [chosenWiki, setChosenWiki] = useState<string | null>(null);
  const wiki = touched.find((entry) => entry.wikiId === chosenWiki) ?? touched[0] ?? null;
  const wikiCalls =
    wiki === null
      ? NO_CALLS
      : calls.filter((call) => resolveWiki(listed, call.wiki)?.wikiId === wiki.wikiId);

  const work = coordinatorWork({
    threadId,
    self,
    threads: shells.filter((shell) => shell.environmentId === environmentId),
    changeRequests: allChangeRequests.data?.changeRequests ?? [],
  });
  const hasWork = work.children.length > 0 || work.changeRequests.length > 0;
  const [view, setView] = useState<"story" | "work" | null>(null);
  const shownView = !hasWork ? "story" : (view ?? (wikiCalls.length === 0 ? "work" : "story"));

  // Astrolabe: beside the thread, a document or change request opens in the right panel's
  // panes next to the graph, where its tab offers to open in its own section.
  const panes = useContext(PanesHostContext);
  const openWiki = (
    wikiId: string,
    search: { readonly note?: string; readonly changeRequest?: WikiChangeRequestId },
  ) => {
    const tab: WikiTab | null =
      search.note !== undefined
        ? {
            kind: "note",
            environmentId,
            wikiId: wikiId as WikiId,
            name: search.note,
            changeRequestId: search.changeRequest,
          }
        : search.changeRequest !== undefined
          ? {
              kind: "change-request",
              environmentId,
              wikiId: wikiId as WikiId,
              changeRequestId: search.changeRequest,
            }
          : null;
    if (panes !== null && tab !== null) {
      const key = wikiTabKey(tab);
      // Astrolabe: in the shared panes, beside the thread, linked to its chat.
      if (panes.controller === workspace.store) workspace.openLinked(key);
      else panes.controller.update((arrangement) => showKeyIn(arrangement, key, "beside"));
      return;
    }
    void navigate({
      to: "/wikis/$wikiId",
      params: { wikiId },
      search: {
        environmentId,
        ...(search.note === undefined ? {} : { note: search.note }),
        ...(search.changeRequest === undefined
          ? {}
          : {
              changeRequest: search.changeRequest,
              list: "changes" as const,
            }),
      },
    });
  };

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      {hasWork || touched.length > 1 ? (
        <div className="flex shrink-0 items-center gap-2 border-b px-1.5 py-1">
          {hasWork ? (
            <ToggleGroup
              aria-label="Graph view"
              value={[shownView]}
              onValueChange={(next) => {
                const value = next[0];
                if (value === "story" || value === "work") setView(value);
              }}
            >
              <Toggle value="story">Wiki story</Toggle>
              <Toggle value="work">Work</Toggle>
            </ToggleGroup>
          ) : null}
          {shownView === "story" && touched.length > 1 && wiki !== null ? (
            <Select
              value={wiki.wikiId}
              items={Object.fromEntries(touched.map((entry) => [entry.wikiId, entry.name]))}
              onValueChange={(value) => {
                if (typeof value === "string") setChosenWiki(value);
              }}
            >
              <SelectTrigger size="xs" variant="ghost" aria-label="Wiki">
                <SelectValue />
              </SelectTrigger>
              <SelectPopup alignItemWithTrigger={false}>
                {touched.map((entry) => (
                  <SelectItem key={entry.wikiId} value={entry.wikiId}>
                    {entry.name}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          ) : null}
        </div>
      ) : null}
      {shownView === "work" ? (
        <CoordinatorWorkList
          work={work}
          wikiName={(wikiId) => listed.find((entry) => entry.wikiId === wikiId)?.name ?? "Wiki"}
          onOpenThread={(childId) =>
            void navigate({
              to: "/$environmentId/$threadId",
              params: { environmentId, threadId: childId },
            })
          }
          onOpenChangeRequest={(wikiId, changeRequestId) =>
            openWiki(wikiId, { changeRequest: changeRequestId })
          }
        />
      ) : wiki === null ? (
        <GraphEmpty>
          {calls.length === 0
            ? "The graph shows the wiki notes this thread reads and writes. It hasn't touched a wiki yet."
            : wikis.data === null
              ? "Loading the thread's wikis…"
              : "The wikis this thread worked in aren't on this server any more."}
        </GraphEmpty>
      ) : (
        <WikiStoryGraph
          key={wiki.wikiId}
          threadKey={`${scopedThreadKey(threadRef)}|${wiki.wikiId}`}
          threadId={threadId}
          environmentId={environmentId}
          wikiId={wiki.wikiId}
          runs={runs}
          labels={labels}
          calls={wikiCalls}
          live={live}
          onOpenNote={(note) => {
            const own = threadChangeRequestOn(
              allChangeRequests.data?.changeRequests ?? [],
              threadId,
              wiki.wikiId,
            );
            openWiki(wiki.wikiId, {
              note,
              ...(own === null ? {} : { changeRequest: own.changeRequestId }),
            });
          }}
        />
      )}
    </div>
  );
}

function GraphEmpty({ children }: { readonly children: string }) {
  return (
    <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

/** One wiki's story, with the turn strip that steps, picks, and plays its turns. */
function WikiStoryGraph({
  threadKey,
  threadId,
  environmentId,
  wikiId,
  runs,
  labels,
  calls,
  live,
  onOpenNote,
}: {
  readonly threadKey: string;
  readonly threadId: string;
  readonly environmentId: EnvironmentId;
  readonly wikiId: WikiId;
  readonly runs: ReadonlyArray<StoryRun>;
  readonly labels: ReadonlyArray<string>;
  readonly calls: ReadonlyArray<WikiToolCall>;
  readonly live: number;
  readonly onOpenNote: (note: string) => void;
}) {
  const { theme, resolvedTheme } = useTheme();
  const index = useEnvironmentQuery(wikiEnvironment.index({ environmentId, input: { wikiId } }));
  const memory = index.data === null ? null : wikiMemory(index.data);
  const needed = memory === null ? [] : notesNeedingMainText(memory, calls);
  const mainTexts = useAtomValue(mainTextsAtom(JSON.stringify([environmentId, wikiId, needed])));
  const mainKey = mainTexts === null ? null : JSON.stringify(mainTexts);
  const texts = mainKey === null ? null : (JSON.parse(mainKey) as Record<string, string>);
  const story =
    memory === null || texts === null
      ? null
      : wikiStory({
          threadId,
          memory,
          runs,
          labels,
          calls,
          mainText: (name) => texts[name] ?? "",
        });

  const saved = useGraphPanelStore((store) => store.byThread[threadKey]);
  const panel: GraphPanelState = saved ?? CLOSED_PANEL;
  const dispatch = (action: GraphPanelAction) =>
    useGraphPanelStore.getState().dispatch(threadKey, action, panel);
  const strip = runs.length === 0 ? panel.strip : clampStrip(panel.strip, runs.length);
  const liveWorking = runs[live]?.active ?? false;
  useEffect(() => {
    // A thread still loading (no turns yet) says nothing about what was rolled back.
    if (runs.length === 0) return;
    const store = useGraphPanelStore.getState();
    const start = store.byThread[threadKey] ?? CLOSED_PANEL;
    store.dispatch(threadKey, { type: "turns", turns: runs.length }, start);
    store.dispatch(threadKey, { type: "settled", live, working: liveWorking }, start);
  }, [threadKey, runs.length, live, liveWorking]);
  const checkpoint = shownCheckpoint(strip, live);
  const turnRunning = strip.playing || (runs[checkpoint]?.active ?? false);
  const [following, setFollowing] = useState(true);
  const graph = useRef<AtlasGraphHandle>(null);
  const settings =
    story === null
      ? DEFAULT_SETTINGS
      : { ...DEFAULT_SETTINGS, depth: defaultDepth(story.memory, story.thread) };

  // Playback holds each move, then asks for the next; a write arriving mid-hold does not restart it.
  const thread = useRef(story?.thread ?? null);
  useEffect(() => {
    thread.current = story?.thread ?? null;
  }, [story]);
  const { playing, step } = strip;
  useEffect(() => {
    if (!playing || step === null || thread.current === null) return;
    const timer = setTimeout(
      () => {
        if (thread.current === null) return;
        useGraphPanelStore
          .getState()
          .dispatch(threadKey, { type: "advance", thread: thread.current }, CLOSED_PANEL);
      },
      holdSeconds(thread.current, step) * 1000,
    );
    return () => clearTimeout(timer);
  }, [playing, step, threadKey]);

  if (story === null) {
    return <GraphEmpty>{index.error ?? "Loading the wiki…"}</GraphEmpty>;
  }
  const moves = story.thread.turns.reduce((count, turn) => count + turn.events.length, 0);
  if (moves === 0) {
    return (
      <GraphEmpty>
        {turnRunning
          ? "The agent hasn't read or written a note of this wiki yet."
          : "This thread's turns didn't read or write a note of this wiki."}
      </GraphEmpty>
    );
  }

  const pickTurn = (turn: number) =>
    dispatch({ type: "pick", turn: Math.max(0, Math.min(runs.length - 1, turn)), live });
  const choose = (play: PlayPick | null) => dispatch({ type: "choose", play, live });
  const onCursor = (play: number | null) => {
    if (popoverClosesOnPark(strip, play)) dispatch({ type: "popover", open: false });
  };
  const isLive = stripIsLive(strip, following);
  const label = (at: number) => {
    const count = new Set(
      (story.thread.turns[at]?.events ?? []).flatMap((event) =>
        event.kind === "write" || event.kind === "amend" ? [event.note] : [],
      ),
    ).size;
    const working = at === live && (runs[at]?.active ?? false) ? " · working" : "";
    const changed = count === 0 ? "" : ` · ${count} ${count === 1 ? "note" : "notes"}`;
    return `${at + 1}. ${story.thread.turns[at]?.label ?? ""}${changed}${working}`;
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-0.5 border-b px-1.5 py-1">
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="Previous turn"
          disabled={checkpoint <= 0}
          onClick={() => pickTurn(checkpoint - 1)}
        >
          <ChevronLeftIcon />
        </Button>
        <Select
          value={String(checkpoint)}
          onValueChange={(value) => {
            const turn = Number(value);
            if (Number.isInteger(turn)) pickTurn(turn);
          }}
        >
          <SelectTrigger size="xs" variant="ghost" className="min-w-0 flex-1" aria-label="Turn">
            <SelectValue>{label(checkpoint)}</SelectValue>
          </SelectTrigger>
          <SelectPopup alignItemWithTrigger={false}>
            {story.thread.turns.map((turn, at) => (
              <SelectItem key={turn.id} value={String(at)}>
                {label(at)}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="Next turn"
          disabled={checkpoint >= runs.length - 1}
          onClick={() => pickTurn(checkpoint + 1)}
        >
          <ChevronRightIcon />
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={strip.playing ? "Pause" : "Play the thread"}
          aria-pressed={strip.playing}
          onClick={() => dispatch({ type: "toggle-play", thread: story.thread, live })}
        >
          {strip.playing ? <PauseIcon /> : <PlayIcon />}
        </Button>
        <Button
          size="xs"
          variant="ghost"
          aria-pressed={isLive}
          data-pressed={isLive ? "" : undefined}
          onClick={() => {
            dispatch({ type: "live" });
            graph.current?.resumeFollowing();
          }}
        >
          Live
        </Button>
      </div>
      <div className="min-h-0 flex-1" style={ATLAS_COLORS}>
        <AtlasGraph
          ref={graph}
          memory={story.memory}
          thread={story.thread}
          checkpoint={checkpoint}
          play={strip.play}
          onPlayChange={choose}
          onCursor={onCursor}
          turnRunning={turnRunning}
          mode="lean"
          createRenderer={createLeanRenderer}
          settings={settings}
          filters={NO_FILTERS}
          themeKey={`${theme}|${resolvedTheme}`}
          popover={panel.popover}
          onPopoverChange={(open) => dispatch({ type: "popover", open })}
          onOpenNote={onOpenNote}
          showFollowing="paused"
          quietAncestors
          fillFrame
          onFollowingChange={setFollowing}
        />
      </div>
    </div>
  );
}

const STATUS_BADGE = { open: "info", merged: "success", closed: "secondary" } as const;

/** A coordinator's children and the change requests they opened, read only. */
function CoordinatorWorkList({
  work,
  wikiName,
  onOpenThread,
  onOpenChangeRequest,
}: {
  readonly work: CoordinatorWork<EnvironmentThreadShell>;
  readonly wikiName: (wikiId: string) => string;
  readonly onOpenThread: (threadId: ThreadId) => void;
  readonly onOpenChangeRequest: (wikiId: string, changeRequestId: WikiChangeRequestId) => void;
}) {
  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="flex flex-col gap-4 p-2">
        <WikiPart.Section title={`Threads (${work.children.length})`}>
          {work.children.length === 0 ? (
            <WikiPart.Muted>This thread hasn't handed work to another thread.</WikiPart.Muted>
          ) : (
            work.children.map((child) => (
              <WikiPart.Row
                key={child.id}
                title={child.title}
                meta={isTurnRunning(child.source.status) ? "Working" : "Idle"}
                onClick={() => onOpenThread(child.id)}
              />
            ))
          )}
        </WikiPart.Section>
        <WikiPart.Section title={`Wiki change requests (${work.changeRequests.length})`}>
          {work.changeRequests.length === 0 ? (
            <WikiPart.Muted>No change request yet.</WikiPart.Muted>
          ) : (
            work.changeRequests.map(({ changeRequest, thread }) => (
              <WikiPart.Row
                key={changeRequest.changeRequestId}
                title={changeRequest.title}
                detail={`${wikiName(changeRequest.wikiId)} · ${
                  thread?.title ?? "this thread"
                } · ${formatRelativeTimeLabel(changeRequest.updatedAt)}`}
                meta={
                  <Badge variant={STATUS_BADGE[changeRequest.status]}>{changeRequest.status}</Badge>
                }
                onClick={() =>
                  onOpenChangeRequest(changeRequest.wikiId, changeRequest.changeRequestId)
                }
              />
            ))
          )}
        </WikiPart.Section>
      </div>
    </ScrollArea>
  );
}
