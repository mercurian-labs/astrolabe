import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  ChatFileAttachment,
  INCOGNITO_BROWSER_PROFILE_ID,
  PreviewSessionSnapshot,
  ScopedThreadRef,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { decodeLinkedThreadSurface } from "./linkedThreadSurface";
import { resolveStorage } from "./lib/storage";
import { randomUUID } from "./lib/utils";
import { decodeThreadSurface, type RightPanelSurface } from "./rightPanelStore";

export type ClosedView =
  | {
      kind: "panel-tab";
      threadRef: ScopedThreadRef;
      surface: Exclude<RightPanelSurface, { kind: "terminal" }>;
    }
  | { kind: "browser"; threadRef: ScopedThreadRef; snapshot: PreviewSessionSnapshot }
  // Astrolabe: a chat's own tab in the shared panes.
  | { kind: "chat-tab"; threadRef: ScopedThreadRef }
  // Astrolabe: a chat's terminal tab, set aside with its sessions running.
  | { kind: "terminal-tab"; threadRef: ScopedThreadRef };

/** Astrolabe: where a closed tab stood, so reopening it puts it back while its pane is open. */
export interface ClosedPlace {
  readonly paneId: string;
  readonly index: number;
  /** A tab that stayed in that pane, so a later pane reusing its id is not taken for it. */
  readonly beside?: string;
}

export type ClosedViewEntry = ClosedView & { id: string; place?: ClosedPlace };

let placeOf: (view: ClosedView) => ClosedPlace | null = () => null;

/** Astrolabe: how the shared panes say where a view's tab stood when it closed. */
export function setClosedViewPlaces(resolve: (view: ClosedView) => ClosedPlace | null) {
  placeOf = resolve;
}

/** The place an entry recorded, when it is well formed. */
export function closedPlaceOf(entry: ClosedViewEntry): ClosedPlace | null {
  const place = entry.place;
  return place && typeof place.paneId === "string" && Number.isSafeInteger(place.index)
    ? place
    : null;
}

interface ClosedViewStoreState {
  entries: ClosedViewEntry[];
  remember: (view: ClosedView) => string;
  defer: (id: string) => void;
  remove: (id: string) => void;
}

const sameTarget = (entry: ClosedViewEntry, view: ClosedView): boolean => {
  if (
    entry.kind !== view.kind ||
    scopedThreadKey(entry.threadRef) !== scopedThreadKey(view.threadRef)
  ) {
    return false;
  }
  switch (entry.kind) {
    case "panel-tab":
      return view.kind === "panel-tab" && entry.surface.id === view.surface.id;
    case "browser":
      return view.kind === "browser" && entry.snapshot.tabId === view.snapshot.tabId;
    case "chat-tab":
    case "terminal-tab":
      return true;
  }
};

const isPersistentView = (entry: ClosedViewEntry) =>
  entry.kind !== "browser" || entry.snapshot.profileId !== INCOGNITO_BROWSER_PROFILE_ID;

const isThreadRef = Schema.is(ScopedThreadRef);
const isSnapshot = Schema.is(PreviewSessionSnapshot);
const isAttachment = Schema.is(ChatFileAttachment);

const isClosedViewEntry = (entry: unknown): entry is ClosedViewEntry => {
  const view = entry as ClosedViewEntry | null;
  if (!view || typeof view.id !== "string" || !isThreadRef(view.threadRef)) return false;
  if (view.kind === "browser") return isSnapshot(view.snapshot);
  if (view.kind === "chat-tab" || view.kind === "terminal-tab") return true;
  if (view.kind !== "panel-tab") return false;
  const surface = view.surface;
  if (!surface || typeof surface.id !== "string") return false;
  switch (surface.kind) {
    case "diff":
    case "files":
    case "pull-requests":
    case "graph":
    case "canvas":
    case "lineage":
      return surface.id === surface.kind;
    case "preview":
      return surface.resourceId === null || typeof surface.resourceId === "string";
    case "file":
      return (
        typeof surface.relativePath === "string" &&
        (surface.revealLine === null || Number.isSafeInteger(surface.revealLine)) &&
        Number.isSafeInteger(surface.revealRequestId) &&
        (surface.attachment === undefined || isAttachment(surface.attachment))
      );
    case "device":
      return (
        (surface.title === undefined || typeof surface.title === "string") &&
        (surface.target === undefined ||
          (surface.target !== null &&
            typeof surface.target.hostId === "string" &&
            typeof surface.target.deviceId === "string" &&
            typeof surface.target.name === "string" &&
            (surface.target.platform === "ios" || surface.target.platform === "android")))
      );
    case "thread":
      return typeof surface.threadId === "string" && surface.id === `thread:${surface.threadId}`;
    case "linked-thread":
      return (
        (surface.title === null || typeof surface.title === "string") &&
        decodeLinkedThreadSurface(surface)?.id === surface.id
      );
    case "pull-request":
      return (
        typeof surface.projectId === "string" &&
        typeof surface.repository === "string" &&
        Number.isSafeInteger(surface.number) &&
        surface.number > 0 &&
        (surface.environmentId === undefined || typeof surface.environmentId === "string") &&
        (surface.host === undefined || typeof surface.host === "string") &&
        (surface.url === undefined || typeof surface.url === "string")
      );
    case "issue":
      return (
        typeof surface.projectId === "string" &&
        typeof surface.tracker === "string" &&
        typeof surface.scope === "string" &&
        typeof surface.key === "string" &&
        (surface.environmentId === undefined || typeof surface.environmentId === "string") &&
        (surface.host === undefined || typeof surface.host === "string") &&
        (surface.url === undefined || typeof surface.url === "string")
      );
    default:
      return false;
  }
};

/** A closed side chat tab saved before its surface became `thread`. */
const renamedSideChatTab = (entry: unknown): unknown => {
  const view = entry as { kind?: unknown; surface?: { kind?: unknown } | null } | null;
  if (view?.kind !== "panel-tab" || view.surface?.kind !== "side-chat") return entry;
  return { ...view, surface: decodeThreadSurface(view.surface) };
};

export const useClosedViewStore = create<ClosedViewStoreState>()(
  persist(
    (set) => ({
      entries: [],
      remember: (view) => {
        const id = randomUUID();
        const place = placeOf(view);
        set((state) => ({
          entries: [
            { ...view, id, ...(place ? { place } : {}) },
            ...state.entries.filter((entry) => !sameTarget(entry, view)),
          ].slice(0, 20),
        }));
        return id;
      },
      defer: (id) =>
        set((state) => {
          const entry = state.entries.find((entry) => entry.id === id);
          return entry
            ? { entries: [...state.entries.filter((entry) => entry.id !== id), entry] }
            : state;
        }),
      remove: (id) =>
        set((state) => ({ entries: state.entries.filter((entry) => entry.id !== id) })),
    }),
    {
      name: "t3code:closed-views:v2",
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      version: 3,
      migrate: (persisted) => {
        const entries = (persisted as Partial<Pick<ClosedViewStoreState, "entries">> | null)
          ?.entries;
        return {
          entries: Array.isArray(entries)
            ? entries.map(renamedSideChatTab).filter(isClosedViewEntry).filter(isPersistentView)
            : [],
        };
      },
      partialize: ({ entries }) => ({ entries: entries.filter(isPersistentView) }),
    },
  ),
);
