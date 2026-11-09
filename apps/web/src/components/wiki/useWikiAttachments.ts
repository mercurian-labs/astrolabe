import { attachmentPath, pastedFileName, type WikiPlacement } from "@mercurian/wiki/placement";
import { linkFiles, shortestLink } from "@mercurian/wiki/resolve-link";
import type { EnvironmentId, WikiChangeRequestId, WikiId } from "@t3tools/contracts";

import { useStableCallback } from "~/hooks/useStableCallback";
import { useAtomQueryRunner } from "~/state/use-atom-query-runner";
import { wikiEnvironment } from "~/state/wiki";
import { useWikiAutosaveCommand } from "./wikiEnvironment";

const QUIET_READ = { reportFailure: false, reportDefect: false };

function toBase64(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}

/** How a file arrived: a pasted one has no name of its own worth keeping. */
export type WikiFileArrival = "paste" | "drop";

/** The file's name as it lands, given how it came. */
const arrivingName = (file: File, arrival: WikiFileArrival, at: Date) =>
  arrival === "paste" ? pastedFileName(file, at) : file.name;

/** Lands attachments of `source` where the wiki's settings put them. */
export function useWikiAttachments(input: {
  readonly environmentId: EnvironmentId;
  readonly wikiId: WikiId;
  /** What's read and written: the change request edits land in, if one's named. */
  readonly savesTo: WikiChangeRequestId | undefined;
  readonly source: string | null;
  readonly placement: WikiPlacement;
  /** The commit an attachment just landed in. */
  readonly onLanded?: (commit: string) => void;
}) {
  const { environmentId, wikiId, savesTo, source, placement, onLanded } = input;
  const landing = savesTo === undefined ? {} : { changeRequestId: savesTo };
  const send = useWikiAutosaveCommand();
  const runFileList = useAtomQueryRunner(wikiEnvironment.fileList, QUIET_READ);
  const listFiles = async () => {
    const listed = await runFileList({ environmentId, input: { wikiId, ...landing } });
    return listed._tag === "Success" ? listed.value.files.map(({ file }) => file) : [];
  };
  /** Lands `name`'s bytes; the path it got, or null when the wiki refused it. */
  const attach = useStableCallback(async (name: string, base64: string) => {
    const path = attachmentPath(placement, source, name);
    const outcome = await send({
      environmentId,
      input: {
        wikiId,
        ...landing,
        document: path,
        write: { kind: "attachment", file: path, base64 },
      },
    });
    if (!outcome.ok) return null;
    if (outcome.value.commit !== null) onLanded?.(outcome.value.commit);
    return outcome.value.attachment ?? path;
  });
  /** Lands `files`, and gives the embed each one writes in a note. */
  const embed = useStableCallback(async (files: ReadonlyArray<File>, arrival: WikiFileArrival) => {
    const embeds: string[] = [];
    for (const file of files) {
      const name = arrivingName(file, arrival, new Date());
      const path = await attach(name, toBase64(new Uint8Array(await file.arrayBuffer())));
      if (path === null) continue;
      embeds.push(`![[${shortestLink(path, linkFiles([...(await listFiles()), path]))}]]`);
    }
    return embeds;
  });
  return { attach, embed };
}
