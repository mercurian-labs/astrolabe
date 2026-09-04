import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { MercurianProject } from "@t3tools/contracts";
import { useCallback } from "react";

import { usePrimaryEnvironmentId } from "../state/environments";
import { useEnsureProjectRuntime } from "../state/mercurian";
import { useNewThreadHandler } from "./useHandleNewThread";

export function useNewMercurianThreadHandler() {
  const environmentId = usePrimaryEnvironmentId();
  const ensureProjectRuntime = useEnsureProjectRuntime();
  const newThread = useNewThreadHandler();

  return useCallback(
    async (project: MercurianProject) => {
      if (environmentId === null) return null;
      const orchestrationProjectId =
        project.orchestrationProjectId ??
        (await ensureProjectRuntime({ projectId: project.projectId }))?.orchestrationProjectId ??
        null;
      if (orchestrationProjectId === null) return null;
      return newThread(scopeProjectRef(environmentId, orchestrationProjectId));
    },
    [ensureProjectRuntime, environmentId, newThread],
  );
}
