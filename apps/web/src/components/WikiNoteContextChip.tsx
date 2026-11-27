/* oxlint-disable t3code/no-untranslated-copy -- Astrolabe-only copy, shipped in English. */
import type { EnvironmentId, WikiNoteContextRecord } from "@t3tools/contracts";
import { FileTextIcon } from "lucide-react";

import { ContextChip, ContextChipLabel } from "./ContextChip";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { useOpenWikiTab } from "./wiki/LegacyWikiTab";
import { documentFile } from "./wiki/wiki.logic";

/**
 * Astrolabe: a wiki note a message referenced before Projects took wikis in; it opens as its
 * Projects file tab beside the chat.
 */
export function WikiNoteContextChip(props: {
  record: Pick<WikiNoteContextRecord, "wikiId" | "wikiName" | "name">;
  environmentId: EnvironmentId | null;
  copyMarkdown?: string;
}) {
  const { wikiId, wikiName, name } = props.record;
  const { environmentId } = props;
  const openWikiTab = useOpenWikiTab();
  const open = () => {
    if (environmentId === null) return;
    openWikiTab({
      kind: "note",
      environmentId,
      wikiId,
      file: documentFile(name),
      changeRequestId: undefined,
    });
  };
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <ContextChip
            kind="wiki-note"
            render={<button type="button" disabled={environmentId === null} />}
            aria-label={`Document, ${name} in ${wikiName}`}
            data-markdown-copy={props.copyMarkdown}
            onClick={open}
          >
            <FileTextIcon />
            <ContextChipLabel>{name}</ContextChipLabel>
          </ContextChip>
        }
      />
      <TooltipPopup side="top">{wikiName}</TooltipPopup>
    </Tooltip>
  );
}
