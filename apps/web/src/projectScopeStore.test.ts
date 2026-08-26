import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { useProjectScopeStore } from "./projectScopeStore";

describe("projectScopeStore", () => {
  beforeEach(() => {
    useProjectScopeStore.getState().setProjectScope(null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sets and clears the project scope", () => {
    useProjectScopeStore.getState().setProjectScope("project-1");
    expect(useProjectScopeStore.getState().projectScopeId).toBe("project-1");

    useProjectScopeStore.getState().setProjectScope(null);
    expect(useProjectScopeStore.getState().projectScopeId).toBeNull();
  });

  it("does not persist scope changes", () => {
    const setItem = vi.fn();
    vi.stubGlobal("localStorage", { setItem });

    useProjectScopeStore.getState().setProjectScope("project-1");

    expect(setItem).not.toHaveBeenCalled();
  });
});
