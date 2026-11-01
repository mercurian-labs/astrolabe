import type { EnvironmentId, WikiNoteContextRecord } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { FileTextIcon } from "lucide-react";
import { useContext } from "react";

import { activateTab, openBeside } from "~/panes/arrangement";
import { PanesHostContext } from "~/panes/panesHost";
import { leafWithTab } from "~/panes/tree";
import { ContextChip, ContextChipLabel } from "./ContextChip";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { wikiTabKey } from "./wiki/wikiTabs";

/** Astrolabe: a referenced wiki note; it opens beside the chat as its own tab, or in Wikis. */
export function WikiNoteContextChip(props: {
  record: Pick<WikiNoteContextRecord, "wikiId" | "wikiName" | "name">;
  environmentId: EnvironmentId | null;
  copyMarkdown?: string;
}) {
  const { wikiId, wikiName, name } = props.record;
  const { environmentId } = props;
  const panes = useContext(PanesHostContext);
  const navigate = useNavigate();
  const open = () => {
    if (environmentId === null) return;
    if (panes !== null) {
      const key = wikiTabKey({
        kind: "note",
        environmentId,
        wikiId,
        name,
        changeRequestId: undefined,
      });
      panes.controller.update((arrangement) =>
        leafWithTab(arrangement.root, key)
          ? activateTab(arrangement, key)
          : openBeside(arrangement, key, arrangement.focused, "right"),
      );
      return;
    }
    void navigate({
      to: "/wikis/$wikiId",
      params: { wikiId },
      search: { environmentId, note: name },
    });
  };
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <ContextChip
            kind="wiki-note"
            render={<button type="button" disabled={environmentId === null} />}
            aria-label={`Wiki note, ${name} in ${wikiName}`}
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
