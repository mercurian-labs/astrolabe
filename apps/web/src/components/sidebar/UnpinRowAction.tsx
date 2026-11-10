import { PinOffIcon } from "lucide-react";
import type { MouseEvent } from "react";

import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/**
 * A pinned thread row's Unpin, among its hover actions: the row has no pin glyph, since the
 * Pinned heading marks the pinned rows.
 */
export function UnpinRowAction(props: { onClick: (event: MouseEvent) => void }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label="Unpin thread"
            onClick={props.onClick}
            className="inline-flex cursor-pointer items-center rounded-md bg-transparent px-1.5 text-xs text-muted-foreground hover:text-foreground"
          />
        }
      >
        <PinOffIcon className="size-3.5" />
      </TooltipTrigger>
      <TooltipPopup side="top">Unpin thread</TooltipPopup>
    </Tooltip>
  );
}
