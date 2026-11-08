import type { GitStatusEntry } from "@pierre/trees";
import { FileTree, useFileTree, useFileTreeSelector } from "@pierre/trees/react";
import type { ContextMenuItem } from "@t3tools/contracts";
import { useEffect, useRef, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";

import { useStableCallback } from "~/hooks/useStableCallback";
import { useTheme } from "~/hooks/useTheme";
import { isMacPlatform } from "~/lib/utils";
import { readLocalApi } from "~/localApi";
import { endDrag } from "~/panes/drag";
import { T3_PIERRE_ICONS } from "~/pierre-icons";
import { PIERRE_TREE_UNSAFE_CSS, pierreTreeStyle } from "~/pierre-tree-theme";
import { NEW_TAB_CLICK, type RowClick } from "~/tabNavigation.logic";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import type { WikiDocumentItem } from "./wikiTabs";

const ICONS = {
  ...T3_PIERRE_ICONS,
  byFileExtension: {
    ...T3_PIERRE_ICONS.byFileExtension,
    base: "t3-file-icon-wiki-base",
    canvas: "t3-file-icon-wiki-canvas",
  },
};

// Rows line up with the sidebar's own, as a worktree's file tree does.
const TREE_STYLE: CSSProperties = {
  ["--trees-fg-override" as string]: "var(--color-sidebar-foreground)",
  ["--trees-hover-bg-override" as string]: "var(--color-sidebar-row-hover)",
  ["--trees-selected-bg-override" as string]: "var(--color-sidebar-row-active)",
  ["--trees-selected-focused-border-color-override" as string]: "transparent",
  ["--trees-font-size-override" as string]: "0.875rem",
  ["--trees-padding-inline-override" as string]: "0px",
  ["--trees-item-margin-x-override" as string]: "0px",
  ["--trees-item-padding-x-override" as string]: "10px",
};

/** As tall as its rows, so the sidebar scrolls it, up to where a long list should virtualize. */
const MOST_ROWS_DRAWN = 400;

const asFolder = (path: string) => path.replace(/\/$/, "");
const nameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);

function foldersOf(files: ReadonlyArray<string>): ReadonlyArray<string> {
  const folders = new Set<string>();
  for (const file of files) {
    for (let at = file.indexOf("/"); at >= 0; at = file.indexOf("/", at + 1)) {
      folders.add(file.slice(0, at + 1));
    }
  }
  return [...folders];
}

/** The row a click or drag came from, through the tree's shadow root. */
function itemPath(event: { composedPath(): ReadonlyArray<unknown> }): string | null {
  for (const node of event.composedPath()) {
    if (!(node instanceof Element)) continue;
    const path = node.getAttribute("data-item-path");
    if (path !== null) return path;
  }
  return null;
}

type FileTreeModel = ReturnType<typeof useFileTree>["model"];

/** What a row says at its end: that an agent's on it, it's outside the filter, or how old it is. */
function rowDecoration(item: WikiDocumentItem, outside: boolean) {
  if (outside) return { text: "Outside filter" };
  if (item.editedAt === null) return null;
  const label = formatRelativeTimeLabel(item.editedAt);
  return { text: label === "just now" ? "now" : label.replace(/ ago$/, "") };
}

/** A person's way to change where documents sit, the same from every row. */
export interface WikiTreeActions {
  readonly open: (file: string, event: WikiTreeClick | null) => void;
  readonly select: (files: ReadonlyArray<string>) => void;
  /** How many rows an action on `file` takes: the selection, when it's in it. */
  readonly selection: (file: string) => number;
  readonly openAll: (file: string) => void;
  /** Hands the rows to the panes, to open or to land on a board. */
  readonly carry: (file: string) => void;
  /** Hands a folder to whatever board it lands on, for all it holds. */
  readonly carryFolder: (folder: string) => void;
  /** Files and folders in the tree's terms; false when it didn't land. */
  readonly move: (from: string, to: string, folder: boolean) => Promise<boolean>;
  readonly moveTo: (path: string, folder: boolean) => void;
  readonly create: (folder: string) => void;
}

export type WikiTreeClick = RowClick;

/**
 * A wiki's documents by folder. A click opens a document, as a list row's does; Cmd and Shift
 * select, F2 renames, and a drag moves onto a folder, or carries the rows out to the panes.
 */
export function WikiDocumentTree({
  documents,
  outsideFilter,
  focusedFile,
  actions,
}: {
  readonly documents: ReadonlyArray<WikiDocumentItem>;
  /** The document listed only because it's in front, when the filter hides it otherwise. */
  readonly outsideFilter: string | null;
  readonly focusedFile: string | null;
  readonly actions: WikiTreeActions;
}) {
  const { resolvedTheme } = useTheme();
  const rows = useRef(new Map<string, WikiDocumentItem>());
  const outside = useRef(outsideFilter);
  const syncing = useRef(false);
  const shownPaths = useRef<ReadonlyArray<string> | null>(null);
  const pointer = useRef<{ x: number; y: number; at: number } | null>(null);
  const tree = useRef<FileTreeModel | null>(null);

  const showMenu = useStableCallback(
    (
      item: { readonly kind: "file" | "directory"; readonly path: string },
      close: (options?: { readonly restoreFocus?: boolean }) => void,
      anchor: { readonly x: number; readonly y: number },
    ) => {
      const api = readLocalApi();
      if (!api) {
        close();
        return;
      }
      const folder = item.kind === "directory";
      const path = asFolder(item.path);
      const selected = folder ? 0 : actions.selection(path);
      const entries: ContextMenuItem<string>[] = [
        ...(folder
          ? [
              { id: "create", label: "New document here" },
              { id: "create-folder", label: "New folder here" },
            ]
          : selected > 1
            ? [{ id: "all", label: `Open ${selected} in new tabs`, icon: "square-plus" as const }]
            : [
                { id: "new-tab", label: "Open in new tab", icon: "square-plus" as const },
                { id: "beside", label: "Open to the right" },
              ]),
        { id: "rename", label: "Rename" },
        { id: "move", label: "Move to…" },
      ];
      close({ restoreFocus: false });
      void api.contextMenu.show(entries, anchor).then((picked) => {
        if (picked === "create" || picked === "create-folder") actions.create(path);
        if (picked === "all") actions.openAll(path);
        if (picked === "new-tab") actions.open(path, NEW_TAB_CLICK);
        if (picked === "beside") {
          const mac = isMacPlatform(navigator.platform);
          actions.open(path, { ...NEW_TAB_CLICK, altKey: false, metaKey: mac, ctrlKey: !mac });
        }
        if (picked === "rename") tree.current?.startRenaming(item.path);
        if (picked === "move") actions.moveTo(path, folder);
      });
    },
  );

  const landed = useStableCallback((from: string, to: string, folder: boolean) =>
    actions.move(from, to, folder).then((moved) => {
      // The model moved on its own; a refused move puts it back.
      if (!moved && shownPaths.current !== null) tree.current?.resetPaths(shownPaths.current);
    }),
  );

  const { model } = useFileTree({
    composition: {
      contextMenu: {
        triggerMode: "right-click",
        onOpen: (item, context) => {
          const mark = pointer.current;
          const box = context.anchorElement.getBoundingClientRect();
          showMenu(
            item,
            context.close,
            mark !== null && performance.now() - mark.at < 1000
              ? mark
              : { x: box.left, y: box.bottom },
          );
        },
      },
    },
    density: "compact",
    dragAndDrop: {
      onDropComplete: ({ draggedPaths, target }) => {
        const into = target.directoryPath === null ? "" : asFolder(target.directoryPath);
        void (async () => {
          for (const path of draggedPaths) {
            const from = asFolder(path);
            const to = into === "" ? nameOf(from) : `${into}/${nameOf(from)}`;
            if (to !== from) await landed(from, to, path.endsWith("/"));
          }
        })();
      },
    },
    flattenEmptyDirectories: false,
    icons: ICONS,
    initialExpansion: "closed",
    onSelectionChange: (paths) => {
      if (syncing.current) return;
      actions.select(paths.filter((path) => !path.endsWith("/")));
    },
    paths: [],
    renaming: {
      onRename: ({ sourcePath, destinationPath, isFolder }) => {
        void landed(asFolder(sourcePath), asFolder(destinationPath), isFolder);
      },
    },
    renderRowDecoration: ({ item, row }) => {
      if (row.kind === "directory") return null;
      const document = rows.current.get(item.path);
      return document === undefined ? null : rowDecoration(document, outside.current === item.path);
    },
    search: false,
    unsafeCSS: PIERRE_TREE_UNSAFE_CSS,
  });
  const visibleRows = useFileTreeSelector(model, (current) => current.getVisibleCount());

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the model's own callbacks reach it through this
  useEffect(() => {
    tree.current = model;
  }, [model]);

  const fingerprint = documents.map((document) => document.file).join("\0");
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- applies the wiki's documents to the imperative Pierre tree model, keeping what's open
  useEffect(() => {
    const previous = shownPaths.current;
    const next = fingerprint === "" ? [] : fingerprint.split("\0");
    shownPaths.current = next;
    const expanded = foldersOf(previous ?? []).filter((path) => {
      const folder = model.getItem(path);
      return folder !== null && "isExpanded" in folder && folder.isExpanded();
    });
    model.resetPaths(next, { initialExpandedPaths: expanded });
  }, [fingerprint, model]);

  const applyRows = useStableCallback(() => {
    rows.current = new Map(documents.map((document) => [document.file, document]));
    outside.current = outsideFilter;
    const changed: ReadonlyArray<GitStatusEntry> = documents.flatMap((document) =>
      document.changes.length > 0 ? [{ path: document.file, status: "modified" as const }] : [],
    );
    model.setGitStatus(changed);
    // The model only redraws decorations when its composition is set again.
    model.setComposition(model.getComposition());
  });
  const rowsKey = documents
    .map(({ file, editedAt, changes }) => `${file}\0${editedAt}\0${changes.length}`)
    .join("\0");
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- pushes what the rows say into the imperative Pierre tree model
  useEffect(() => {
    if (rowsKey !== "" || outsideFilter === null) applyRows();
  }, [applyRows, outsideFilter, rowsKey]);

  const reveal = useStableCallback(() => {
    if (focusedFile === null) return;
    const row = model.getItem(focusedFile);
    if (row === null || model.getSelectedPaths().includes(focusedFile)) return;
    syncing.current = true;
    for (const path of model.getSelectedPaths()) model.getItem(path)?.deselect();
    for (const folder of foldersOf([focusedFile])) {
      const item = model.getItem(folder);
      if (item !== null && "expand" in item) item.expand();
    }
    row.select();
    model.scrollToPath(focusedFile, { offset: "nearest" });
    queueMicrotask(() => {
      syncing.current = false;
    });
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reveals the document in front by expanding its folders and selecting it in the Pierre tree model
  useEffect(() => {
    if (fingerprint !== "" && focusedFile !== null) reveal();
  }, [fingerprint, focusedFile, reveal]);

  const clickFile = (event: ReactMouseEvent) => {
    const path = itemPath(event.nativeEvent);
    if (path === null || path.endsWith("/")) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey) return;
    actions.open(path, event);
  };

  return (
    // The tree's rows live in its shadow root, so their events are read here as they pass.
    <li
      className="list-none"
      onClickCapture={clickFile}
      onAuxClickCapture={(event) => {
        if (event.button === 1) clickFile(event);
      }}
      onContextMenuCapture={(event) => {
        pointer.current = { x: event.clientX, y: event.clientY, at: performance.now() };
      }}
      onKeyDownCapture={(event) => {
        const typing = event.nativeEvent.composedPath()[0] instanceof HTMLInputElement;
        if (typing) return;
        const focused = model.getFocusedPath();
        if (focused === null) return;
        const folder = focused.endsWith("/");
        if (event.key === "Enter" && !folder) {
          event.preventDefault();
          actions.open(focused, null);
        } else if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
          event.preventDefault();
          const box = event.currentTarget.getBoundingClientRect();
          showMenu({ kind: folder ? "directory" : "file", path: focused }, () => {}, {
            x: box.left + 24,
            y: box.top + 24,
          });
        }
      }}
      onDragStartCapture={(event) => {
        const path = itemPath(event.nativeEvent);
        if (path === null) return;
        if (path.endsWith("/")) actions.carryFolder(asFolder(path));
        else actions.carry(path);
      }}
      onDragEnd={endDrag}
    >
      <FileTree
        model={model}
        aria-label="Documents"
        className="shrink-0 overflow-hidden"
        style={{
          ...pierreTreeStyle(resolvedTheme),
          ...TREE_STYLE,
          height: Math.min(visibleRows, MOST_ROWS_DRAWN) * model.getItemHeight(),
        }}
      />
    </li>
  );
}
