import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";

import {
  PaneSurfaceHostProvider,
  PanesThreadContext,
  RightPanelHostContext,
  type RightPanelHost,
} from "./PaneSurfaceHost";
import { GroupPanelRunsSync } from "./GroupPanelRunsSync";
import { createPanesController } from "./panesController";
import { PanesHostContext, PanesLayoutKeyContext } from "./panesHost";
import { createRightPanelHost, RightPanelSectionTabs } from "./rightPanelPaneTabs";
import type { StorageLike } from "./persistence";
import { NO_TAB_SELECTION, useTabSelectionStore } from "./tabSelection";

/** The device's storage; null where reading it throws, as with blocked site data. */
function deviceStorage(): StorageLike | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * A thread view's right panel as panes: one controller follows the on-screen thread, loading and
 * saving its arrangement as the thread changes, so ChatView stays mounted across the switch as in
 * T3 Code. ChatView draws the panel as `RightPanelPanes`, showing the shared runs of the thread's
 * change groups (`GroupPanelRunsSync`).
 */
export function ThreadPanesProvider({
  threadRef,
  children,
}: {
  threadRef: ScopedThreadRef;
  children: ReactNode;
}) {
  const threadKey = scopedThreadKey(threadRef);
  const [storage] = useState(deviceStorage);
  const [host] = useState<RightPanelHost>(() =>
    createRightPanelHost(createPanesController(storage)),
  );
  const { controller } = host;

  useLayoutEffect(() => {
    // A selection of tabs is one thread's: another thread starts with none.
    useTabSelectionStore.getState().change(() => NO_TAB_SELECTION);
    controller.load(threadRef, threadKey);
  }, [controller, threadKey, threadRef]);

  // Declared after the load so it subscribes once the thread is loaded, and pairs its own
  // cleanup, as StrictMode's remount checks.
  useLayoutEffect(() => controller.follow(), [controller]);

  // Escape clears a selection of tabs.
  useEffect(() => {
    const { change } = useTabSelectionStore.getState();
    const clear = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (useTabSelectionStore.getState().selection.keys.length === 0) return;
      change(() => NO_TAB_SELECTION);
    };
    window.addEventListener("keydown", clear);
    return () => window.removeEventListener("keydown", clear);
  }, []);

  useEffect(() => {
    const save = () => controller.flush();
    window.addEventListener("pagehide", save);
    return () => {
      window.removeEventListener("pagehide", save);
      save();
    };
  }, [controller]);

  return (
    <PanesHostContext.Provider value={host}>
      <RightPanelHostContext.Provider value={host}>
        <PanesLayoutKeyContext.Provider value={threadKey}>
          <PanesThreadContext.Provider value={threadRef}>
            <PaneSurfaceHostProvider>
              {children}
              <RightPanelSectionTabs />
              <GroupPanelRunsSync controller={controller} threadRef={threadRef} />
            </PaneSurfaceHostProvider>
          </PanesThreadContext.Provider>
        </PanesLayoutKeyContext.Provider>
      </RightPanelHostContext.Provider>
    </PanesHostContext.Provider>
  );
}
