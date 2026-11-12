import type { ScopedThreadRef, ThreadPullRequestLink } from "@t3tools/contracts";

import { useServerConfigs } from "~/state/entities";
import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";

/**
 * Astrolabe: what T3 Code's linked pull requests panel did to one of a thread's links, for the
 * thread details rows and the command palette that took its place. `setWatching` is null where
 * the server cannot watch.
 */
export function useLinkedPullRequestActions(threadRef: ScopedThreadRef | null) {
  const unlinkCommand = useAtomCommand(threadEnvironment.unlinkPullRequest, {
    reportFailure: true,
  });
  const watchCommand = useAtomCommand(threadEnvironment.watchPullRequest, { reportFailure: true });
  const configs = useServerConfigs();
  const supportsWatch =
    threadRef !== null &&
    configs.get(threadRef.environmentId)?.environment.capabilities.threadPullRequestWatch === true;
  const target = (link: ThreadPullRequestLink) => ({
    host: link.host,
    repository: link.repository,
    number: link.number,
  });
  return {
    unlink: (link: ThreadPullRequestLink) => {
      if (threadRef === null) return;
      void unlinkCommand({
        environmentId: threadRef.environmentId,
        input: { threadId: threadRef.threadId, ...target(link) },
      });
    },
    setWatching:
      threadRef === null || !supportsWatch
        ? null
        : (link: ThreadPullRequestLink, watching: boolean) =>
            void watchCommand({
              environmentId: threadRef.environmentId,
              input: { threadId: threadRef.threadId, ...target(link), watching },
            }),
  };
}
