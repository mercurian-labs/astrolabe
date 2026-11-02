import { clampStep, type CodeGraphView as AgentView } from "@t3tools/client-runtime/codeGraphViews";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  FoldVerticalIcon,
  ScanIcon,
  SlidersHorizontalIcon,
  Undo2Icon,
} from "lucide-react";
import { useRef } from "react";

import { useRightPanelStore } from "~/rightPanelStore";
import { codeGraphViewsAtom, codeGraphViewsKey } from "~/state/codeGraphViews";
import { useProject, useThreadCheckpointSummaries, useThreadShell } from "~/state/entities";
import {
  DEFAULT_CODE_GRAPH_OPTIONS,
  NO_KEYED_EXPANSION,
  parseCodeGraphOptions,
  type CodeGraphOptions,
} from "../codeGraph/codeGraphData";
import { CodeGraphView, GraphNotice, type CodeGraphViewHandle } from "../codeGraph/CodeGraphView";
import { storedChoice } from "../projects/storedChoice";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { ownExpansion, threadGraphShown } from "./threadGraph";
import { INITIAL_THREAD_GRAPH, useThreadGraphStore } from "./threadGraphStore";
import { TabHeader } from "~/panes/TabHeader";

/** The filter panel's choices, kept on the device for every thread's graph. */
const graphOptions = storedChoice<CodeGraphOptions>({
  storageKey: "astrolabe:thread-code-graph:v1",
  fallback: DEFAULT_CODE_GRAPH_OPTIONS,
  parse: parseCodeGraphOptions,
  serialize: JSON.stringify,
});

const CHANGES = "changes";

/** The files a thread's turns changed, from its checkpoints, in a stable order. */
function changedFiles(
  summaries: ReadonlyArray<{ readonly files: ReadonlyArray<{ readonly path: string }> }>,
): string[] {
  return [
    ...new Set(summaries.flatMap((summary) => summary.files.map((file) => file.path))),
  ].sort();
}

const viewTitle = (view: AgentView, index: number) =>
  view.title ?? (view.steps.length > 1 ? `Story ${index + 1}` : `Picture ${index + 1}`);

/**
 * Astrolabe: a thread's Graph tab, the code graph (`CodeGraphView`) around the files the thread
 * changed, or a view an agent showed with `astrolabe_code_graph_show`: a picture, or a story the
 * reader steps through.
 */
export default function GraphPanel({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const { environmentId } = threadRef;
  const key = codeGraphViewsKey(threadRef);
  const shell = useThreadShell(threadRef);
  const project = useProject(shell === null ? null : { environmentId, projectId: shell.projectId });
  const cwd = shell?.worktreePath ?? project?.workspaceRoot ?? null;
  const summaries = useThreadCheckpointSummaries(threadRef);
  // Checkpoint summaries change on every turn; the roots change only when the files do.
  const changedKey = JSON.stringify(changedFiles(summaries));
  const changed = JSON.parse(changedKey) as string[];
  const views = useAtomValue(codeGraphViewsAtom(key)) ?? [];
  const state = useThreadGraphStore((store) => store.byThread[key]) ?? INITIAL_THREAD_GRAPH;
  const update = useThreadGraphStore((store) => store.update);
  const options = graphOptions.useValue();
  const viewRef = useRef<CodeGraphViewHandle>(null);

  const {
    view,
    stepIndex,
    step,
    roots,
    expansionKey,
    own,
    expansion,
    options: shownOptions,
  } = threadGraphShown({ state, views, changed, options });

  const setStep = (next: number) =>
    update(key, (current) =>
      view === null ? current : { ...current, view: { id: view.id, step: clampStep(view, next) } },
    );
  const choose = (value: string) =>
    update(key, (current) => ({
      ...current,
      view: value === CHANGES ? null : { id: value, step: 0 },
      roots: null,
    }));

  const panel = options.panel;
  const opened = own.neighbours.length + own.contents.length + own.collapsed.length > 0;

  let body;
  if (cwd === null || shell === null) {
    body = <GraphNotice>The graph needs the thread's project.</GraphNotice>;
  } else if (roots === null) {
    body = (
      <GraphNotice>
        This thread hasn't changed any files yet. Its graph shows the files it changes and what they
        connect to.
      </GraphNotice>
    );
  } else {
    body = (
      <CodeGraphView
        ref={viewRef}
        environmentId={environmentId}
        checkout={{ projectId: shell.projectId, cwd }}
        roots={roots}
        options={shownOptions}
        onOptionsChange={(next) =>
          // A story's step owns its level and depth; the rest of the panel stays the reader's.
          graphOptions.set(
            step === null ? next : { ...next, level: options.level, depth: options.depth },
          )
        }
        defaultOptions={DEFAULT_CODE_GRAPH_OPTIONS}
        expansion={expansion}
        onExpansionChange={(next) =>
          update(key, (current) => ({
            ...current,
            expansion: {
              key: expansionKey,
              expansion: ownExpansion(step, next),
            },
          }))
        }
        step={step === null ? null : { nodes: step.focus, links: step.links }}
        rootsLabel={roots.length === 1 ? roots[0] : "These files"}
        onOpen={(target) =>
          useRightPanelStore.getState().openFile(threadRef, target.path, target.line ?? undefined)
        }
        onReRoot={(root) =>
          update(key, (current) => ({
            ...current,
            view: null,
            roots: [root],
            expansion: NO_KEYED_EXPANSION,
          }))
        }
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <TabHeader.Root>
        {views.length === 0 ? (
          <TabHeader.Title label="Graph">
            {state.roots === null ? "Changes" : state.roots.join(", ")}
          </TabHeader.Title>
        ) : (
          <Select
            value={view?.id ?? CHANGES}
            items={{
              [CHANGES]: "Changes",
              ...Object.fromEntries(views.map((each, index) => [each.id, viewTitle(each, index)])),
            }}
            onValueChange={(value) => {
              if (typeof value === "string") choose(value);
            }}
          >
            <SelectTrigger
              size="sm"
              variant="ghost"
              className="min-w-0 flex-1"
              aria-label="Graph view"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectPopup alignItemWithTrigger={false}>
              <SelectItem value={CHANGES}>Changes</SelectItem>
              {views.map((each, index) => (
                <SelectItem key={each.id} value={each.id}>
                  {viewTitle(each, index)}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        )}
        <TabHeader.Actions>
          {state.roots !== null && view === null ? (
            <TabHeader.Action
              label="Back to the thread's changes"
              onClick={() => update(key, (current) => ({ ...current, roots: null }))}
            >
              <Undo2Icon />
            </TabHeader.Action>
          ) : null}
          {opened ? (
            <TabHeader.Action
              label="Reset the graph"
              tooltip="Undo the neighbours and contents you opened"
              onClick={() =>
                update(key, (current) => ({ ...current, expansion: NO_KEYED_EXPANSION }))
              }
            >
              <FoldVerticalIcon />
            </TabHeader.Action>
          ) : null}
          <TabHeader.Action
            label="Fit the graph"
            disabled={roots === null}
            onClick={() => viewRef.current?.fit()}
          >
            <ScanIcon />
          </TabHeader.Action>
          <TabHeader.Action
            label="Graph settings"
            tooltip={panel.open ? "Close graph settings" : "Graph settings"}
            pressed={panel.open}
            onClick={() => graphOptions.set({ ...options, panel: { ...panel, open: !panel.open } })}
          >
            <SlidersHorizontalIcon />
          </TabHeader.Action>
        </TabHeader.Actions>
      </TabHeader.Root>
      {view === null || step === null ? null : (
        <div className="flex shrink-0 items-start gap-1 border-b px-2 py-1.5">
          <p className="min-w-0 flex-1 py-0.5 text-sm text-foreground">{step.caption}</p>
          {view.steps.length > 1 ? (
            <div className="flex shrink-0 items-center gap-0.5">
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label="Previous step"
                disabled={stepIndex === 0}
                onClick={() => setStep(stepIndex - 1)}
              >
                <ChevronLeftIcon />
              </Button>
              <span className="text-xs tabular-nums text-muted-foreground">
                {stepIndex + 1} / {view.steps.length}
              </span>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label="Next step"
                disabled={stepIndex === view.steps.length - 1}
                onClick={() => setStep(stepIndex + 1)}
              >
                <ChevronRightIcon />
              </Button>
            </div>
          ) : null}
        </div>
      )}
      {body}
    </div>
  );
}
