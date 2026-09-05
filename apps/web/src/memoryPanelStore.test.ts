import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  revealMemorySelection,
  selectMemoryGraphOpen,
  selectMemorySelection,
  useMemoryPanelStore,
} from "./memoryPanelStore";
import { selectActiveRightPanel, useRightPanelStore } from "./rightPanelStore";

const refA = scopeThreadRef(EnvironmentId.make("env-1"), ThreadId.make("thread-A"));
const refB = scopeThreadRef(EnvironmentId.make("env-1"), ThreadId.make("thread-B"));

beforeEach(() => {
  useMemoryPanelStore.setState({ selectionByThreadKey: {}, graphOpenByThreadKey: {} });
  useRightPanelStore.setState({ byThreadKey: {} });
});

describe("memoryPanelStore", () => {
  it("keeps selection and graph state per thread and clears them on removal", () => {
    const store = useMemoryPanelStore.getState();
    store.select(refA, { kind: "document", id: "doc-1" });
    store.select(refB, { kind: "amendment", id: "abc" });
    store.setGraphOpen(refA, true);

    expect(
      selectMemorySelection(useMemoryPanelStore.getState().selectionByThreadKey, refA),
    ).toEqual({
      kind: "document",
      id: "doc-1",
    });
    expect(
      selectMemorySelection(useMemoryPanelStore.getState().selectionByThreadKey, refB),
    ).toEqual({
      kind: "amendment",
      id: "abc",
    });
    expect(selectMemoryGraphOpen(useMemoryPanelStore.getState().graphOpenByThreadKey, refA)).toBe(
      true,
    );
    expect(selectMemoryGraphOpen(useMemoryPanelStore.getState().graphOpenByThreadKey, refB)).toBe(
      false,
    );

    useMemoryPanelStore.getState().select(refA, null);
    expect(
      selectMemorySelection(useMemoryPanelStore.getState().selectionByThreadKey, refA),
    ).toBeNull();
    useMemoryPanelStore.getState().removeThread(refB);
    expect(useMemoryPanelStore.getState().selectionByThreadKey).toEqual({});
  });

  it("reveals the Memory singleton with the requested selection without opening a diff", () => {
    revealMemorySelection(refA, { kind: "note", name: "Composer" });
    expect(selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, refA)).toBe("memory");
    expect(
      selectMemorySelection(useMemoryPanelStore.getState().selectionByThreadKey, refA),
    ).toEqual({
      kind: "note",
      name: "Composer",
    });
    expect(
      useRightPanelStore.getState().byThreadKey["env-1:thread-A"]?.surfaces.map(({ kind }) => kind),
    ).toEqual(["memory"]);
  });
});
