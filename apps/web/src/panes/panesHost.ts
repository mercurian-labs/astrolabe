import { createContext, useContext, type ComponentType, type ReactNode } from "react";

import type { Arrangement } from "./arrangement";
import type { SectionTabMove } from "~/sectionTabs/SectionTabContent";
import type { Leaf } from "./tree";

export interface PaneArrangementSnapshot {
  readonly arrangement: Arrangement;
  /** The pane holding content that renders in one place only, if the panes have such content. */
  readonly hostPaneId: string | null;
}

/** Where a set of panes keeps its arrangement; the panes read it and send it their changes. */
export interface PaneArrangementStore {
  update(change: (arrangement: Arrangement) => Arrangement): void;
  getSnapshot(): PaneArrangementSnapshot | null;
  subscribe(listener: () => void): () => void;
}

/**
 * What the tabs of a set of panes are, given by whoever mounts the panes: the right panel's
 * tabs are a thread's surfaces, the Wikis area's are documents. The panes themselves only
 * arrange keys.
 */
export interface PaneTabs {
  /** A tab's title and icon. A hook: it may subscribe to whatever the title comes from. */
  readonly useLabel: (tabKey: string) => { readonly title: string; readonly icon: ReactNode };
  /** Closes a tab, which may ask first. */
  readonly close: (tabKey: string) => void;
  /** The control after a pane's tabs that opens another tab there. */
  readonly NewTab: ComponentType<{ readonly paneId: string }>;
  /**
   * Puts a pane's content into its slot, after each render of the pane: its tabs' contents
   * move between panes as DOM nodes, so moving a tab never remounts what it shows.
   */
  readonly place: (slot: HTMLElement, leaf: Leaf, hosting: boolean) => void;
  /** Drawn over the slot for a pane's active tab when it shows no content of its own. */
  readonly Overlay: ComponentType<{ readonly leaf: Leaf; readonly hosting: boolean }>;
  /** Whether the top-right strip leaves room for controls pinned over its end. */
  readonly reservesTopRight: boolean;
  /**
   * Astrolabe: for a tab outside its own section (a chat in Wikis, a document beside a thread),
   * the tab menu's "Open in <section>" (see `sectionTabs`).
   */
  readonly openElsewhere?: (tabKey: string) => SectionTabMove | null;
}

export interface PanesHost {
  readonly controller: PaneArrangementStore;
  readonly tabs: PaneTabs;
}

export const PanesHostContext = createContext<PanesHost | null>(null);

export function usePanesHost(): PanesHost {
  const host = useContext(PanesHostContext);
  if (!host) throw new Error("usePanesHost must be used inside a set of panes.");
  return host;
}

/** Names the arrangement on screen, for what is kept per arrangement, like a maximized pane. */
export const PanesLayoutKeyContext = createContext<string | null>(null);

export function usePanesLayoutKey(): string | null {
  return useContext(PanesLayoutKeyContext);
}
