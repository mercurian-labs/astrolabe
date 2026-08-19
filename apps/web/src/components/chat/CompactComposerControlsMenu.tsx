import { RuntimeMode } from "@t3tools/contracts";
import { memo, type ReactNode } from "react";
import { EllipsisIcon } from "lucide-react";
import { runtimeModeOptionsFor } from "../../composer-logic";
import { Button } from "../ui/button";
import {
  Menu,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator as MenuDivider,
  MenuTrigger,
} from "../ui/menu";

export const CompactComposerControlsMenu = memo(function CompactComposerControlsMenu(props: {
  runtimeMode: RuntimeMode;
  traitsMenuContent?: ReactNode;
  onRuntimeModeChange: (mode: RuntimeMode) => void;
}) {
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            size="sm"
            variant="ghost"
            className="shrink-0 px-2 text-muted-foreground/70 hover:text-foreground/80"
            aria-label="More composer controls"
          />
        }
      >
        <EllipsisIcon aria-hidden="true" className="size-4" />
      </MenuTrigger>
      <MenuPopup align="start">
        {props.traitsMenuContent ? (
          <>
            {props.traitsMenuContent}
            <MenuDivider />
          </>
        ) : null}
        <div className="px-2 py-1.5 font-medium text-muted-foreground text-xs">Access</div>
        <MenuRadioGroup
          value={props.runtimeMode}
          onValueChange={(value) => {
            if (!value || value === props.runtimeMode) return;
            props.onRuntimeModeChange(value as RuntimeMode);
          }}
        >
          {runtimeModeOptionsFor(props.runtimeMode).map((mode) => (
            <MenuRadioItem key={mode} value={mode}>
              {mode === "approval-required"
                ? "Supervised"
                : mode === "auto-accept-edits"
                  ? "Auto-accept edits"
                  : mode === "full-access"
                    ? "Full access"
                    : "Auto"}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
});
