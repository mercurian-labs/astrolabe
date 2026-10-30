/**
 * A file graph (`model/fileGraph.ts`) on the Lean renderer, links drawn at rest and arrows from
 * importer to imported. No thread: each new graph is a new picture, framed whole, and the renderer
 * sleeps once it settles. Hosts import `@mercurian/graph/styles.css` and set `--atlas-*`, as for
 * `AtlasGraph`.
 */
import { useEffect, useEffectEvent, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { Ref } from "react";

import {
  fileGraphLayout,
  fileGraphSignature,
  fileGraphUniverse,
  fileGraphView,
  type FileGraphData,
} from "./model/fileGraph.ts";
import { DEFAULT_SETTINGS, type GraphSettings } from "./model/settings.ts";
import { createLeanRenderer } from "./render/lean/LeanRenderer.ts";
import type { GraphRenderer, HoverTarget, RendererStats } from "./render/renderer.ts";

export interface FileGraphHandle {
  /** Frame the whole graph. */
  fit(): void;
  stats(now: number): RendererStats | null;
}

/** The hovered node, and where it sits in the graph's frame, in CSS pixels. */
export interface FileGraphHover {
  readonly id: string;
  readonly x: number;
  readonly y: number;
}

export interface FileGraphProps {
  readonly graph: FileGraphData;
  /** A node was clicked; `modifier` while ⌘ or Ctrl was held. */
  readonly onOpen: (id: string, modifier: boolean) => void;
  readonly onHover?: (hover: FileGraphHover | null) => void;
  /** A font file (woff, ttf, or otf) for labels. */
  readonly labelFont?: string;
  /** Changing this re-reads the `--atlas-*` colors. */
  readonly themeKey?: string;
  readonly ref?: Ref<FileGraphHandle>;
}

/** Arrowheads say which way an import runs; nodes a little larger than a memory's, as there are few. */
const SETTINGS: GraphSettings = { ...DEFAULT_SETTINGS, arrows: true, nodeSize: 1.5 };

export function FileGraph({
  graph: given,
  onOpen,
  onHover,
  labelFont,
  themeKey,
  ref,
}: FileGraphProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [renderer, setRenderer] = useState<GraphRenderer | null>(null);
  // A graph equal to the one drawn (a host reading again) keeps the picture and the camera.
  const [graph, setGraph] = useState(given);
  if (given !== graph && fileGraphSignature(given) !== fileGraphSignature(graph)) setGraph(given);
  const universe = useMemo(() => fileGraphUniverse(graph), [graph]);
  const layout = useMemo(() => fileGraphLayout(universe, graph), [universe, graph]);
  const view = useMemo(() => fileGraphView(universe, graph), [universe, graph]);
  /** Whether ⌘ or Ctrl was held as the last press began: a pick fires on its release. */
  const modifier = useRef(false);

  const hovered = useEffectEvent((target: HoverTarget | null) => {
    const id = target?.kind === "node" ? universe.nodes[target.index]?.id : undefined;
    onHover?.(id === undefined || target === null ? null : { id, x: target.x, y: target.y });
  });
  const picked = useEffectEvent((index: number) => {
    const id = universe.nodes[index]?.id;
    if (id !== undefined) onOpen(id, modifier.current);
  });

  // oxlint-disable-next-line t3code/react-effect-budget -- owns the WebGL renderer for the mount
  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    const created = createLeanRenderer(host, {
      onHover: (target) => hovered(target),
      onPick: (index) => picked(index),
      onBackground: () => {},
      onFollowingChange: () => {},
    });
    created.setSettings(SETTINGS);
    setRenderer(created);
    return () => {
      created.dispose();
      setRenderer(null);
    };
  }, []);

  // oxlint-disable-next-line t3code/react-effect-budget -- hands the renderer the theme and font
  useEffect(() => {
    renderer?.setLabelFont(labelFont);
    renderer?.setThemeKey(themeKey);
  }, [renderer, labelFont, themeKey]);

  // oxlint-disable-next-line t3code/react-effect-budget -- hands the renderer each new graph
  useEffect(() => {
    if (renderer === null) return;
    renderer.setGraph(universe, layout, true);
    renderer.setView(view, {
      layout,
      gathering: null,
      reading: false,
      thisTurnOnly: false,
      localGraph: true,
    });
  }, [renderer, universe, layout, view]);

  useImperativeHandle(
    ref,
    () => ({
      fit: () => renderer?.fit(),
      stats: (now) => renderer?.stats(now) ?? null,
    }),
    [renderer],
  );

  return (
    <div
      className="atlas-graph"
      onPointerDownCapture={(event) => {
        modifier.current = event.metaKey || event.ctrlKey;
      }}
    >
      <div ref={hostRef} className="atlas-graph-canvas" />
    </div>
  );
}
