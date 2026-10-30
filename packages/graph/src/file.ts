// d3-force-3d and troika-three-text ship no types; these declarations are part of the
// package, and a program that imports this entry only sees them through it.
/// <reference path="./layout/d3-force-3d.d.ts" />
/// <reference path="./render/troika-three-text.d.ts" />
/**
 * The file graph alone, for a host that draws a file's local graph and nothing else: it reaches
 * the Lean renderer and the model it needs, never `AtlasGraph`, a thread, or the other renderers.
 */
export {
  FileGraph,
  type FileGraphHandle,
  type FileGraphHover,
  type FileGraphProps,
} from "./FileGraph.tsx";
export type {
  FileGraphData,
  FileGraphLink,
  FileGraphNode,
  FileGraphNodeKind,
} from "./model/fileGraph.ts";
