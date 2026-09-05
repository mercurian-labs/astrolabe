import { FileTextIcon, WaypointsIcon } from "~/../node_modules/lucide-react";

import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";

type RightPaneState = {
  readonly open: boolean;
  readonly view: "artifact" | "explorer";
  readonly artifact: "plan" | "spec";
};

/**
 * The corner's two icons: the plan artifact and the DAG explorer. One of them
 * is the pane's content; pressing the pressed one closes the pane and leaves
 * the conversation full-width.
 */
export function PlanPaneToggle({
  state,
  onChange,
}: {
  readonly state: RightPaneState;
  readonly onChange: (next: RightPaneState) => void;
}) {
  return (
    <ToggleGroup
      className="shrink-0"
      size="xs"
      value={state.open ? [state.view] : []}
      variant="ghost"
      onValueChange={(next) => {
        const chosen = next[0];
        // Deselecting the active icon is how the pane closes — and the view it
        // was showing is remembered for the next time it opens.
        if (chosen === undefined) {
          onChange({ ...state, open: false });
          return;
        }
        if (chosen === "artifact" || chosen === "explorer") {
          onChange({ ...state, open: true, view: chosen });
        }
      }}
    >
      <Tooltip>
        <TooltipTrigger render={<Toggle aria-label="Plan" value="artifact" />}>
          <FileTextIcon className="size-3.5" />
        </TooltipTrigger>
        <TooltipPopup side="bottom">Plan</TooltipPopup>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger render={<Toggle aria-label="Checkpoint Graph" value="explorer" />}>
          <WaypointsIcon className="size-3.5" />
        </TooltipTrigger>
        <TooltipPopup side="bottom">Checkpoint Graph</TooltipPopup>
      </Tooltip>
    </ToggleGroup>
  );
}
