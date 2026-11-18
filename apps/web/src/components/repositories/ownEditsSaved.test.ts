import type { DocumentSessionState } from "@t3tools/client-runtime/state/document-session";
import { describe, expect, it, vi } from "vite-plus/test";

import { onOwnEditsSaved } from "./ownEditsSaved";

function fakeSession() {
  const listeners = new Set<() => void>();
  let state: DocumentSessionState = {
    status: "open",
    failure: null,
    missing: false,
    unsent: false,
    unsaved: false,
  };
  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getState: () => state,
    set(next: Partial<DocumentSessionState>) {
      state = { ...state, ...next };
      for (const listener of listeners) listener();
    },
  };
}

describe("onOwnEditsSaved", () => {
  it("tells of this editor's edits once they reach disk, and of no one else's", () => {
    const session = fakeSession();
    const saved = vi.fn();
    onOwnEditsSaved(session, saved);
    // Another editor's edits arrive and save.
    session.set({ unsaved: true });
    session.set({ unsaved: false });
    expect(saved).not.toHaveBeenCalled();
    // This editor's: sent, then saved.
    session.set({ unsent: true, unsaved: true });
    session.set({ unsent: false });
    expect(saved).not.toHaveBeenCalled();
    session.set({ unsaved: false });
    expect(saved).toHaveBeenCalledTimes(1);
  });

  it("drops edits a conflict ended with the file's text taken, and tells of ones kept", () => {
    const session = fakeSession();
    const saved = vi.fn();
    onOwnEditsSaved(session, saved);
    session.set({ unsent: true, unsaved: true });
    session.set({ status: "conflict" });
    session.set({ status: "open", unsent: false, unsaved: false });
    expect(saved).not.toHaveBeenCalled();
    session.set({ status: "conflict", unsent: true, unsaved: true });
    session.set({ status: "open" });
    session.set({ unsent: false, unsaved: false });
    expect(saved).toHaveBeenCalledTimes(1);
  });
});
