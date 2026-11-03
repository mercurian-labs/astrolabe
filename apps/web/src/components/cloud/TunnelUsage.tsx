import { TriangleAlertIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "../../lib/utils";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "../ui/alert";
import { Button } from "../ui/button";

// Above this, one slot per tunnel is too thin to read, so the bar fills instead.
const MAX_SEGMENTS = 10;

/** "2 of 3 tunnels in use" with one bar slot per tunnel. */
export function TunnelUsageMeter({
  used,
  limit,
  action,
  className,
}: {
  readonly used: number;
  readonly limit: number;
  readonly action?: ReactNode;
  readonly className?: string;
}) {
  const full = used >= limit;
  const fill = full ? "bg-warning" : "bg-foreground/72";
  return (
    <div className={cn("flex max-w-sm flex-col gap-1.5", className)}>
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className={cn("tabular-nums", full ? "text-warning-foreground" : "text-foreground")}>
          {used} of {limit} tunnels in use
        </span>
        {action}
      </div>
      <div
        role="meter"
        aria-label="Remote access tunnels in use"
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={used}
        className="flex h-1.5 gap-1"
      >
        {limit <= MAX_SEGMENTS ? (
          Array.from({ length: limit }, (_, index) => (
            <span
              key={index}
              className={cn("flex-1 rounded-full", index < used ? fill : "bg-muted")}
            />
          ))
        ) : (
          <span className="flex-1 overflow-hidden rounded-full bg-muted">
            <span
              className={cn("block h-full rounded-full", fill)}
              style={{ width: `${Math.min(100, (used / limit) * 100)}%` }}
            />
          </span>
        )}
      </div>
    </div>
  );
}

/** Shown when the relay refuses a new tunnel because the account is at its cap. */
export function TunnelLimitAlert({
  onManageTunnels,
}: {
  readonly onManageTunnels: (() => void) | null;
}) {
  return (
    <Alert variant="warning">
      <TriangleAlertIcon />
      <AlertTitle>You&apos;re out of tunnels (they cost us money).</AlertTitle>
      <AlertDescription>
        Switch to Tailscale or deregister an environment you no longer use (sorry!)
      </AlertDescription>
      {onManageTunnels ? (
        <AlertAction>
          <Button size="sm" variant="outline" onClick={() => onManageTunnels()}>
            Manage tunnels
          </Button>
        </AlertAction>
      ) : null}
    </Alert>
  );
}
