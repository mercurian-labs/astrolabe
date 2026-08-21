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
  buildConnectInput,
  presentConnectFailure,
  TRACKER_KIND_PRESENTATION,
  TRACKER_KINDS,
} from "./TrackersSettings.logic";

/**
 * Connecting a tracker: pick which one, then hand over its credential fields.
 *
 * The tracker list and credential fields are rendered from the shipped
 * connectors' presentation metadata. Field values live in this component's
 * state and nowhere else — they are dropped when the dialog closes, and
 * nothing that comes back from the server carries them.
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
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);

  // The credential does not outlive the dialog.
  useEffect(() => {
    if (!open) {
      setValues({});
      setError(null);
      setIsConnecting(false);
    }
  }, [open]);

  const presentation = TRACKER_KIND_PRESENTATION[kind];
  const connectInput = buildConnectInput(kind, values);

  const handleConnect = useCallback(async () => {
    if (connectInput === null || isConnecting) return;
    setIsConnecting(true);
    setError(null);
    const outcome = await connectTracker(connectInput);
    setIsConnecting(false);
    if (outcome.ok) {
      // The row arrives through the subscription; there is nothing to insert.
      onOpenChange(false);
      return;
    }
    setError(presentConnectFailure(outcome.error as { readonly _tag?: string }, kind));
  }, [connectInput, connectTracker, isConnecting, kind, onOpenChange]);

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
                      setValues({});
                      setError(null);
                    }}
                  >
                    {TRACKER_KIND_PRESENTATION[candidate].name}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}
          <div className="space-y-3">
            {presentation.fields.map((field) => {
              const id = `tracker-${kind}-${field.key}`;
              return (
                <div key={field.key} className="space-y-2">
                  <Label htmlFor={id}>
                    {field.label}
                    {field.optional === true ? (
                      <span className="text-muted-foreground"> (optional)</span>
                    ) : null}
                  </Label>
                  <Input
                    id={id}
                    type={field.secret ? "password" : "text"}
                    autoComplete="off"
                    spellCheck={false}
                    value={values[field.key] ?? ""}
                    placeholder={field.placeholder}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      setValues((current) => ({ ...current, [field.key]: value }));
                      setError(null);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void handleConnect();
                      }
                    }}
                  />
                </div>
              );
            })}
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
            disabled={connectInput === null || isConnecting}
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
