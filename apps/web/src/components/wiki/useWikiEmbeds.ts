import { wikiEmbeds } from "@mercurian/wiki-editor/incoming";
import { assetUrlStateFromResult } from "@t3tools/client-runtime/state/assets";
import type { AssetResource, EnvironmentId, ProjectRootId } from "@t3tools/contracts";
import { useRef, useState } from "react";

import { useStableCallback } from "~/hooks/useStableCallback";
import { assetEnvironment } from "~/state/assets";
import { usePreparedConnection } from "~/state/session";
import { useAtomQueryRunner } from "~/state/use-atom-query-runner";
import { wikiEnvironment } from "~/state/wiki";

const QUIET_READ = { reportFailure: false, reportDefect: false };
const QUIET_MINT = { ...QUIET_READ, refresh: true };

/**
 * A root's file as it stands in `checkout` on disk: the path a link names found from `from`
 * there, or the link's own path for a file nothing resolves to yet.
 */
function useCheckoutFile(environmentId: EnvironmentId, wikiId: ProjectRootId) {
  const runFiles = useAtomQueryRunner(wikiEnvironment.files, QUIET_READ);
  return useStableCallback(
    async (
      checkout: string,
      path: string,
      from: string,
    ): Promise<Extract<AssetResource, { _tag: "draft-workspace-file" }>> => {
      const result = await runFiles({
        environmentId,
        input: { wikiId, checkout, from, paths: [path] },
      });
      const read = result._tag === "Success" ? result.value.files[0] : undefined;
      return {
        _tag: "draft-workspace-file",
        cwd: checkout,
        path: read?.exists === true ? read.file : path,
      };
    },
  );
}

/**
 * Where a note's embedded images are: `![[image.png]]` found from `from`, at the commit on screen,
 * or the newer one an attachment just landed in, which the read hasn't reached yet. With
 * `checkout`, as they stand there on disk.
 */
export function useWikiEmbeds(input: {
  readonly environmentId: EnvironmentId;
  readonly wikiId: ProjectRootId;
  readonly commit: string;
  readonly from: string;
  readonly checkout?: string | undefined;
}) {
  const { environmentId, wikiId, commit, from, checkout } = input;
  const mintUrl = useAtomQueryRunner(assetEnvironment.createUrl, QUIET_MINT);
  const onDisk = useCheckoutFile(environmentId, wikiId);
  const connection = usePreparedConnection(environmentId);
  const httpBaseUrl = connection._tag === "Some" ? connection.value.httpBaseUrl : null;
  const landed = useRef<{ readonly over: string; readonly commit: string } | null>(null);
  const find = useStableCallback(async (path: string) => {
    const at = landed.current?.over === commit ? landed.current.commit : commit;
    const resource: AssetResource =
      checkout === undefined
        ? { _tag: "wiki-file", wikiId, commit: at, path, from }
        : await onDisk(checkout, path, from);
    const result = await mintUrl({ environmentId, input: { resource } });
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
