/* oxlint-disable t3code/no-untranslated-copy -- Astrolabe-only copy, shipped in English. */
import type { WikiPlacement } from "@mercurian/wiki/placement";
import { documentPath, NO_NOTE_FROM_RELATIVE_LINK } from "@t3tools/client-runtime/wikiLogic";
import type { WikiIndexResult } from "@t3tools/contracts";

import * as Dialog from "../../../components/ui/Dialog";
import type { WikiDocumentParams } from "../wikiRoutes";
import { projectFileLabel, projectLinkOpens } from "./wikiDocument.logic";

/**
 * Opens what a link in a project's document names, in whichever folder it lands; this folder's
 * next document is read from the same place. A bare link several other folders match is never
 * picked for the person: they choose one, or write it as `folder:path`.
 */
export function openProjectLink(input: {
  readonly roots: ReadonlyMap<string, WikiIndexResult> | null;
  readonly params: WikiDocumentParams;
  readonly target: string;
  readonly from: string | null;
  readonly placement: WikiPlacement;
  readonly open: (next: WikiDocumentParams) => void;
}) {
  const { params } = input;
  const go = (root: string, file: string) => {
    const here = root === params.rootKey;
    input.open({
      environmentId: params.environmentId,
      projectId: params.projectId,
      rootKey: root,
      name: file,
      ...(here && params.checkout !== undefined ? { checkout: params.checkout } : {}),
      ...(here && params.changeRequestId !== undefined
        ? { changeRequestId: params.changeRequestId }
        : {}),
    });
  };
  const opens = projectLinkOpens({
    roots: input.roots,
    root: params.rootKey,
    target: input.target,
    from: input.from,
    placement: input.placement,
  });
  switch (opens.kind) {
    case "none":
      Dialog.alert("No note made", NO_NOTE_FROM_RELATIVE_LINK);
      return;
    case "open":
      go(opens.root, opens.file);
      return;
    case "ambiguous":
      Dialog.alert(
        "Several documents match",
        `This folder has no ${input.target}, and more than one other folder does. Open one, or write the link with its folder, as folder:path.`,
        [
          ...opens.candidates.map((candidate) => ({
            text: documentPath(projectFileLabel(candidate, params.rootKey)),
            onPress: () => go(candidate.root, candidate.file),
          })),
          { text: "Cancel", style: "cancel" as const },
        ],
      );
      return;
  }
}
