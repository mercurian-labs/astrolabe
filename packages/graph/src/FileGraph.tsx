/**
 * A file graph (`model/fileGraph.ts`) drawn as Obsidian draws a vault, on Pixi (`render/file`):
 * forces lay it out, a node drags, the view pans and zooms, and it sleeps once it settles. Hosts
 * import `@mercurian/graph/styles.css` and set the `--atlas-*` colours on an ancestor, as for
 * `AtlasGraph`; labels take the host's font.
 */
import { useEffect, useEffectEvent, useImperativeHandle, useRef, useState } from "react";
import type { Ref } from "react";

import type { FileGraphData, FileGraphFocus } from "./model/fileGraph.ts";
import { DEFAULT_FILE_GRAPH_SETTINGS, type FileGraphSettings } from "./model/fileGraphSettings.ts";
import {
  FileGraphRenderer,
  type FileGraphContextMenu,
  type FileGraphHover,
} from "./render/file/FileGraphRenderer.ts";
import { createPixiFileDrawer } from "./render/file/pixiFileDrawer.ts";

export type { FileGraphContextMenu, FileGraphHover } from "./render/file/FileGraphRenderer.ts";

export interface FileGraphHandle {
  /** Frame the whole graph. */
  fit(): void;
  /** Lay it out again from a scatter. */
  animate(): void;
}

export interface FileGraphProps {
  readonly graph: FileGraphData;
  readonly settings?: FileGraphSettings;
  /** A story's step to light, or none. */
  readonly focus?: FileGraphFocus | null;
  /** A node was clicked once; `modifier` while ⌘ or Ctrl was held. */
  readonly onClick: (id: string, modifier: boolean) => void;
  readonly onDoubleClick?: (id: string) => void;
  /** An open cluster's disc was clicked, off its nodes. */
  readonly onClusterClick?: (id: string) => void;
  readonly onContextMenu?: (menu: FileGraphContextMenu) => void;
  readonly onHover?: (hover: FileGraphHover | null) => void;
  /** Changing this re-reads the `--atlas-*` colours and the font. */
  readonly themeKey?: string;
  readonly ref?: Ref<FileGraphHandle>;
}

export function FileGraph({
  graph,
  settings = DEFAULT_FILE_GRAPH_SETTINGS,
  focus = null,
  onClick,
  onDoubleClick,
  onClusterClick,
  onContextMenu,
  onHover,
  themeKey,
  ref,
}: FileGraphProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [renderer, setRenderer] = useState<FileGraphRenderer | null>(null);
  const hovered = useEffectEvent((hover: FileGraphHover | null) => onHover?.(hover));
  const clicked = useEffectEvent((id: string, modifier: boolean) => onClick(id, modifier));
  const doubleClicked = useEffectEvent((id: string) => onDoubleClick?.(id));
  const clusterClicked = useEffectEvent((id: string) => onClusterClick?.(id));
  const menu = useEffectEvent((at: FileGraphContextMenu) => onContextMenu?.(at));

  // oxlint-disable-next-line t3code/react-effect-budget -- owns the Pixi renderer for the mount
  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    const created = new FileGraphRenderer(
      host,
      {
        onHover: (hover) => hovered(hover),
        onClick: (id, modifier) => clicked(id, modifier),
        onDoubleClick: (id) => doubleClicked(id),
        onClusterClick: (id) => clusterClicked(id),
        onContextMenu: (at) => menu(at),
      },
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
  // oxlint-disable-next-line t3code/react-effect-budget -- hands the renderer a story's step
  useEffect(() => renderer?.setFocus(focus), [renderer, focus]);

  useImperativeHandle(
    ref,
    () => ({ fit: () => renderer?.fit(), animate: () => renderer?.animate() }),
    [renderer],
  );

  return <div ref={hostRef} className="file-graph" />;
}
