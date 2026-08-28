import { create } from "zustand";

interface ProjectScopeStore {
  readonly projectScopeId: string | null;
  readonly setProjectScope: (id: string | null) => void;
}

/**
 * The sidebar's project scope is deliberately ephemeral: it is shared across
 * web surfaces, but resets to all projects whenever the client reloads.
 */
export const useProjectScopeStore = create<ProjectScopeStore>((set) => ({
  projectScopeId: null,
  setProjectScope: (projectScopeId) => set({ projectScopeId }),
}));
