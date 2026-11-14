import type { CanvasEdge, CanvasFileNode, CanvasNode } from "@mercurian/wiki/canvas";

import type { CanvasPoint } from "./canvasArrange";
import { arrangementEntries, type CanvasMenuEntry } from "./CanvasChrome";
import type { CanvasCommands } from "./canvasCommands";
import { canvasFileKind } from "./canvasGeometry";

interface BoardMenuOptions {
  readonly commands: CanvasCommands;
  readonly at: CanvasPoint;
  readonly snapToGrid: boolean;
  readonly snapToObjects: boolean;
  readonly setSnap: (key: "snapToGrid" | "snapToObjects", on: boolean) => void;
  readonly setReadOnly: (on: boolean) => void;
  readonly canAttachNotes: boolean;
}

export const boardMenu = ({
  commands,
  at,
  snapToGrid,
  snapToObjects,
  setSnap,
  setReadOnly,
  canAttachNotes,
}: BoardMenuOptions): ReadonlyArray<CanvasMenuEntry> => [
  { label: "Add card", run: () => commands.addCardFromMenu(at) },
  ...(canAttachNotes
    ? [
        { label: "Add note from wiki", run: () => void commands.addFile("note", at) },
        { label: "Add media from wiki", run: () => void commands.addFile("media", at) },
      ]
    : []),
  { label: "Add web page", run: () => void commands.addWebPage(at) },
  { label: "Create section", run: () => commands.createGroup(at) },
  "separator",
  { label: "Paste", run: () => void commands.pasteFromMenu(at) },
  "separator",
  { label: "Snap to grid", checked: snapToGrid, run: () => setSnap("snapToGrid", !snapToGrid) },
  {
    label: "Snap to objects",
    checked: snapToObjects,
    run: () => setSnap("snapToObjects", !snapToObjects),
  },
  { label: "Read-only", checked: false, run: () => setReadOnly(true) },
];

/** A dot's drag, and reaching an arrow, for a keyboard. */
const connections = (commands: CanvasCommands, id: string): ReadonlyArray<CanvasMenuEntry> => [
  { label: "Connect to…", run: () => void commands.connectTo(id) },
  { label: "Select connection…", run: () => void commands.selectConnection(id) },
];

const remove = (commands: CanvasCommands): CanvasMenuEntry => ({
  label: "Remove",
  destructive: true,
  run: () => commands.remove(),
});

const zoomTo = (commands: CanvasCommands): CanvasMenuEntry => ({
  label: "Zoom to selection",
  run: () => commands.zoomToSelection(),
});

/** What a finger needs here, with no ⌘C or ⌥ drag to reach for. */
const clipboard = (commands: CanvasCommands, at: CanvasPoint): ReadonlyArray<CanvasMenuEntry> => [
  { label: "Cut", run: () => commands.cut() },
  { label: "Copy", run: () => commands.copy() },
  { label: "Paste", run: () => void commands.pasteFromMenu(at) },
  { label: "Duplicate", run: () => commands.duplicate() },
];

function fileEntries(commands: CanvasCommands, node: CanvasFileNode): CanvasMenuEntry[] {
  const host = commands.host;
  return [
    ...(host.openInNewTab === undefined
      ? []
      : [{ label: "Open in new tab", run: () => host.openInNewTab?.(node.file) }]),
    ...(host.renameDocument !== undefined && /\.(md|canvas|base)$/i.test(node.file)
      ? [{ label: "Rename…", run: () => void commands.rename(node) }]
      : []),
    ...(host.copyText === undefined
      ? []
      : [{ label: "Copy path", run: () => host.copyText?.(node.file) }]),
  ];
}

export function cardMenu(
  commands: CanvasCommands,
  node: CanvasNode,
  at: CanvasPoint,
  missing: boolean,
): ReadonlyArray<CanvasMenuEntry> {
  const zoom = zoomTo(commands);
  const clip = [...connections(commands, node.id), ...clipboard(commands, at)];
  switch (node.type) {
    case "text":
      return [
        zoom,
        { label: "Edit", run: () => commands.editCard(node.id) },
        { label: "Convert to file…", run: () => void commands.convertToFile(node.id) },
        "separator",
        ...clip,
        "separator",
        remove(commands),
      ];
    case "link":
      return [
        zoom,
        ...(node.astrolabe?.code === undefined
          ? [{ label: "Change URL…", run: () => void commands.changeUrl(node) }]
          : []),
        { label: "Open external link", run: () => commands.host.onOpenUrl?.(node.url) },
        { label: "Copy URL", run: () => commands.host.copyText?.(node.url) },
        { label: "Reload page", run: () => commands.reloadPage(node.id) },
        "separator",
        ...clip,
        "separator",
        remove(commands),
      ];
    case "group":
      return [
        zoom,
        { label: "Edit label", run: () => commands.editSelected() },
        ...connections(commands, node.id),
        "separator",
        remove(commands),
      ];
    case "file": {
      const swap: CanvasMenuEntry = {
        label: "Swap file…",
        run: () => void commands.swapFile(node.id),
      };
      if (missing) return [zoom, swap, "separator", remove(commands)];
      const kind = canvasFileKind(node.file);
      const narrowed = node.subpath !== undefined;
      return [
        zoom,
        swap,
        ...(kind === "note"
          ? [
              { label: "Edit", run: () => commands.editCard(node.id) },
              { label: "Narrow to heading…", run: () => void commands.narrowToHeading(node) },
              { label: "Narrow to block…", run: () => void commands.narrowToBlock(node) },
              ...(narrowed
                ? [{ label: "Show the whole note", run: () => commands.clearSubpath(node.id) }]
                : []),
            ]
          : []),
        ...(kind === "base"
          ? [
              { label: "Pin view…", run: () => void commands.pinView(node) },
              ...(narrowed
                ? [{ label: "Show default view", run: () => commands.clearSubpath(node.id) }]
                : []),
            ]
          : []),
        "separator",
        ...fileEntries(commands, node),
        "separator",
        ...clip,
        "separator",
        remove(commands),
      ];
    }
  }
}

export const arrowMenu = (
  commands: CanvasCommands,
  edge: CanvasEdge,
  at: CanvasPoint,
): ReadonlyArray<CanvasMenuEntry> => [
  { label: "Edit label", run: () => commands.editSelected() },
  { label: "Follow connection", run: () => commands.followConnection(edge.id, at) },
  {
    label: "Line direction",
    items: [
      { label: "Nondirectional", run: () => commands.setLineDirection(edge.id, "none") },
      { label: "Unidirectional", run: () => commands.setLineDirection(edge.id, "end") },
      { label: "Bidirectional", run: () => commands.setLineDirection(edge.id, "both") },
    ],
  },
  { label: "Move the start…", run: () => void commands.moveEnd(edge.id, "from") },
  { label: "Move the end…", run: () => void commands.moveEnd(edge.id, "to") },
  "separator",
  remove(commands),
];

export const selectionMenu = (
  commands: CanvasCommands,
  at: CanvasPoint,
): ReadonlyArray<CanvasMenuEntry> => [
  zoomTo(commands),
  { label: "Create section", run: () => commands.createGroup(at) },
  { label: "Align", items: arrangementEntries((kind) => commands.arrange(kind)) },
  "separator",
  ...clipboard(commands, at),
  "separator",
  { label: "Delete", destructive: true, run: () => commands.remove() },
];

export const readOnlyMenu = (commands: CanvasCommands): ReadonlyArray<CanvasMenuEntry> => [
  zoomTo(commands),
];
