import type { EnvironmentId, WikiChangeRequestId, WikiId } from "@t3tools/contracts";

import { wikiEnvironment } from "~/state/wiki";
import { toastManager } from "../ui/toast";
import { useWikiCommand } from "./wikiEnvironment";
import { followWikiMove, saveWikiTabsMoving } from "./wikiPanes";

export interface WikiMove {
  readonly environmentId: EnvironmentId;
  readonly wikiId: WikiId;
  readonly changeRequestId?: WikiChangeRequestId | undefined;
  readonly from: string;
  readonly to: string;
  readonly folder?: boolean;
}

/** Where `file` went in `move`; null for a file it left alone. */
function movedFile(file: string, move: Pick<WikiMove, "from" | "to" | "folder">): string | null {
  if (move.folder === true) {
    return file.startsWith(`${move.from}/`) ? `${move.to}${file.slice(move.from.length)}` : null;
  }
  return file === move.from ? move.to : null;
}

/**
 * Moves a document or a folder, in the change request named or the person's draft, and brings the
 * tabs showing what moved along. Their edits land first, under the path they were read from.
 */
export function useWikiMove() {
  const send = useWikiCommand(wikiEnvironment.move, "Couldn't move it");
  return async ({ environmentId, ...input }: WikiMove): Promise<boolean> => {
    const from = (file: string) => movedFile(file, input);
    const scope = { environmentId, wikiId: input.wikiId, changeRequestId: input.changeRequestId };
    if (!(await saveWikiTabsMoving(scope, from))) {
      toastManager.add({
        type: "error",
        title: "Couldn't move it",
        description: "An open document's edits haven't saved yet.",
      });
      return false;
    }
    const outcome = await send({
      environmentId,
      input: {
        wikiId: input.wikiId,
        from: input.from,
        to: input.to,
        ...(input.changeRequestId === undefined ? {} : { changeRequestId: input.changeRequestId }),
        ...(input.folder === true ? { folder: true } : {}),
      },
    });
    if (outcome.ok) followWikiMove(scope, from);
    return outcome.ok;
  };
}
