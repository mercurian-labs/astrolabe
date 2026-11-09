import { wikiEmbeds } from "@mercurian/wiki-editor/incoming";
import { assetUrlStateFromResult } from "@t3tools/client-runtime/state/assets";
import type { EnvironmentId, WikiId } from "@t3tools/contracts";
import { useRef, useState } from "react";

import { useStableCallback } from "~/hooks/useStableCallback";
import { assetEnvironment } from "~/state/assets";
import { usePreparedConnection } from "~/state/session";
import { useAtomQueryRunner } from "~/state/use-atom-query-runner";

const QUIET_MINT = { reportFailure: false, reportDefect: false, refresh: true };

/**
 * Where a note's embedded images are: `![[image.png]]` found from `from`, at the commit on screen,
 * or the newer one an attachment just landed in, which the read hasn't reached yet.
 */
export function useWikiEmbeds(input: {
  readonly environmentId: EnvironmentId;
  readonly wikiId: WikiId;
  readonly commit: string;
  readonly from: string;
}) {
  const { environmentId, wikiId, commit, from } = input;
  const mintUrl = useAtomQueryRunner(assetEnvironment.createUrl, QUIET_MINT);
  const connection = usePreparedConnection(environmentId);
  const httpBaseUrl = connection._tag === "Some" ? connection.value.httpBaseUrl : null;
  const landed = useRef<{ readonly over: string; readonly commit: string } | null>(null);
  const find = useStableCallback(async (path: string) => {
    const at = landed.current?.over === commit ? landed.current.commit : commit;
    const result = await mintUrl({
      environmentId,
      input: { resource: { _tag: "wiki-file", wikiId, commit: at, path, from } },
    });
    const state = assetUrlStateFromResult(result, httpBaseUrl);
    return state._tag === "Success"
      ? { url: state.url, expiresAt: state.expiresAt }
      : { url: null, expiresAt: 0 };
  });
  const [resolveEmbed] = useState(() => wikiEmbeds(find));
  const landedAt = useStableCallback((next: string) => {
    landed.current = { over: commit, commit: next };
  });
  return { resolveEmbed, landedAt };
}
