import { RegistryContext, useAtomMount } from "@effect/atom-react";
import { DocumentSession } from "@t3tools/client-runtime/state/document-session";
import type { EnvironmentId } from "@t3tools/contracts";
import { useContext, useState, useSyncExternalStore } from "react";

import { useStableCallback } from "~/hooks/useStableCallback";
import { documentsEnvironment } from "~/state/documents";

// Unique per editor; `crypto.randomUUID` is missing on plain-HTTP origins such as a LAN address.
const newClientId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

/**
 * Opens a repository file as the environment's live document for as long as the caller is
 * mounted. The caller is keyed by file: the session is made once.
 */
export function useRepositoryDocument(
  environmentId: EnvironmentId,
  cwd: string,
  relativePath: string,
  canWrite: boolean,
) {
  const registry = useContext(RegistryContext);
  const writable = useStableCallback(() => canWrite);
  const [binding] = useState(() => {
    const target = { cwd, relativePath };
    const session = new DocumentSession({
      target,
      clientId: newClientId(),
      channel: documentsEnvironment.channel(registry, environmentId, target),
      canWrite: writable,
    });
    return { session, follow: documentsEnvironment.follow(environmentId, session) };
  });
  useAtomMount(binding.follow);
  const state = useSyncExternalStore(binding.session.subscribe, binding.session.getState);
  return { session: binding.session, state };
}
