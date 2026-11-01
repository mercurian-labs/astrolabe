// d3-force-3d ships no types; this declaration is part of the package, and a program that
// imports this entry only sees it through it.
/// <reference path="./layout/d3-force-3d.d.ts" />
/**
 * The file graph alone, for a host that draws a file's local graph and nothing else: it reaches
 * its Pixi renderer and the model it needs, never `AtlasGraph`, a thread, or the other renderers.
 */
export {
  FileGraph,
  type FileGraphContextMenu,
  type FileGraphHandle,
  type FileGraphHover,
  type FileGraphProps,
} from "./FileGraph.tsx";
export {
  GROUP_SLOTS,
  type FileGraphCluster,
  type FileGraphData,
  type FileGraphFocus,
  type FileGraphLink,
  type FileGraphNode,
  type FileGraphNodeKind,
} from "./model/fileGraph.ts";
export {
  DEFAULT_FILE_GRAPH_SETTINGS,
  FILE_GRAPH_RANGES,
  FileGraphSettings,
  fileGraphSettingsOf,
  type FileGraphRangeKey,
} from "./model/fileGraphSettings.ts";
