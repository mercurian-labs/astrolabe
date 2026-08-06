import type { TrackerKind } from "@t3tools/contracts";
import { useCallback, useEffect, useState } from "react";

import { useConnectTracker } from "../../state/mercurianTrackers";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Spinner } from "../ui/spinner";
import {
  presentConnectFailure,
  TRACKER_KIND_PRESENTATION,
  TRACKER_KINDS,
} from "./TrackersSettings.logic";

/**
 * Connecting a tracker: pick which one, then hand over a key.
 *
 * The tracker list is rendered from the shipped connectors, so today it reads
 * as "connect Linear" and grows a step the day a second connector lands. The
 * key lives in this component's state and nowhere else — it is dropped when the
 * dialog closes, and nothing that comes back from the server carries it.
 */
export function ConnectTrackerDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const connectTracker = useConnectTracker();
  const [kind, setKind] = useState<TrackerKind>(TRACKER_KINDS[0] ?? "linear");
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);

  // The credential does not outlive the dialog.
  useEffect(() => {
    if (!open) {
      setToken("");
      setError(null);
      setIsConnecting(false);
    }
  }, [open]);

  const presentation = TRACKER_KIND_PRESENTATION[kind];
  const trimmedToken = token.trim();

  const handleConnect = useCallback(async () => {
    if (trimmedToken.length === 0 || isConnecting) return;
    setIsConnecting(true);
    setError(null);
    const outcome = await connectTracker({ kind, token: trimmedToken });
    setIsConnecting(false);
    if (outcome.ok) {
      // The row arrives through the subscription; there is nothing to insert.
      onOpenChange(false);
      return;
    }
    setError(presentConnectFailure(outcome.failure as { readonly _tag?: string }, kind));
  }, [connectTracker, isConnecting, kind, onOpenChange, trimmedToken]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>Connect a tracker</DialogTitle>
          <DialogDescription>
            Mercurian reads issues from the tracker and never writes back to it.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          {TRACKER_KINDS.length > 1 ? (
            <div className="space-y-2">
              <Label>Tracker</Label>
              <div className="flex flex-wrap gap-2">
                {TRACKER_KINDS.map((candidate) => (
                  <Button
                    key={candidate}
                    type="button"
                    size="xs"
                    variant={candidate === kind ? "default" : "outline"}
                    onClick={() => {
                      setKind(candidate);
                      setError(null);
                    }}
                  >
                    {TRACKER_KIND_PRESENTATION[candidate].name}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="tracker-api-key">{presentation.name} API key</Label>
            <Input
              id="tracker-api-key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={token}
              placeholder="lin_api_…"
              onChange={(event) => {
                setToken(event.currentTarget.value);
                setError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void handleConnect();
                }
              }}
            />
            <p className="text-[13px] leading-[1.45] text-muted-foreground/80">
              {presentation.credentialHint}
            </p>
          </div>
          {error === null ? null : (
            <p role="alert" className="text-[13px] leading-[1.45] text-destructive-foreground">
              {error}
            </p>
          )}
        </DialogPanel>
        <DialogFooter variant="bare">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isConnecting}>
            Cancel
          </Button>
          <Button
            onClick={() => void handleConnect()}
            disabled={trimmedToken.length === 0 || isConnecting}
          >
            {isConnecting ? (
              <>
                <Spinner className="size-3.5" />
                Connecting…
              </>
            ) : (
              "Connect"
            )}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
