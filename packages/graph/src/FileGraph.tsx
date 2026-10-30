/**
 * A file graph (`model/fileGraph.ts`) drawn as Obsidian draws a vault, on Pixi (`render/file`):
 * forces lay it out, a node drags, the view pans and zooms, and it sleeps once it settles. Hosts
 * import `@mercurian/graph/styles.css` and set the `--atlas-*` colours on an ancestor, as for
 * `AtlasGraph`; labels take the host's font.
 */
import { useEffect, useEffectEvent, useImperativeHandle, useRef, useState } from "react";
import type { Ref } from "react";

import type { FileGraphData } from "./model/fileGraph.ts";
import { DEFAULT_FILE_GRAPH_SETTINGS, type FileGraphSettings } from "./model/fileGraphSettings.ts";
import { FileGraphRenderer, type FileGraphHover } from "./render/file/FileGraphRenderer.ts";
import { createPixiFileDrawer } from "./render/file/pixiFileDrawer.ts";

export type { FileGraphHover } from "./render/file/FileGraphRenderer.ts";

export interface FileGraphHandle {
  /** Frame the whole graph. */
  fit(): void;
  /** Lay it out again from a scatter. */
  animate(): void;
}

export interface FileGraphProps {
  readonly graph: FileGraphData;
  readonly settings?: FileGraphSettings;
  /** A node was clicked; `modifier` while ⌘ or Ctrl was held. */
  readonly onOpen: (id: string, modifier: boolean) => void;
  readonly onHover?: (hover: FileGraphHover | null) => void;
  /** Changing this re-reads the `--atlas-*` colours and the font. */
  readonly themeKey?: string;
  readonly ref?: Ref<FileGraphHandle>;
}

export function FileGraph({
  graph,
  settings = DEFAULT_FILE_GRAPH_SETTINGS,
  onOpen,
  onHover,
  themeKey,
  ref,
}: FileGraphProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [renderer, setRenderer] = useState<FileGraphRenderer | null>(null);
  const hovered = useEffectEvent((hover: FileGraphHover | null) => onHover?.(hover));
  const opened = useEffectEvent((id: string, modifier: boolean) => onOpen(id, modifier));

  // oxlint-disable-next-line t3code/react-effect-budget -- owns the Pixi renderer for the mount
  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    const created = new FileGraphRenderer(
      host,
      { onHover: (hover) => hovered(hover), onOpen: (id, modifier) => opened(id, modifier) },
      { createDrawer: createPixiFileDrawer },
    );
    setRenderer(created);
    return () => {
      created.dispose();
      setRenderer(null);
    };
  }, []);

  // Settings land before the first graph, so it lays out with the forces the host keeps.
  // oxlint-disable-next-line t3code/react-effect-budget -- hands the renderer the theme
  useEffect(() => renderer?.setTheme(themeKey), [renderer, themeKey]);
  // oxlint-disable-next-line t3code/react-effect-budget -- hands the renderer the settings
  useEffect(() => renderer?.setSettings(settings), [renderer, settings]);
  // oxlint-disable-next-line t3code/react-effect-budget -- hands the renderer each new graph
  useEffect(() => renderer?.setGraph(graph), [renderer, graph]);

  useImperativeHandle(
    ref,
    () => ({ fit: () => renderer?.fit(), animate: () => renderer?.animate() }),
    [renderer],
  );

  return <div ref={hostRef} className="file-graph" />;
}
