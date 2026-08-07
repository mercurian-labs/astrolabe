import type { TrackerConnection } from "@t3tools/contracts";
import { CircleDotIcon, PlusIcon } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { useTrackers, useDisconnectTracker } from "../../state/mercurianTrackers";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { Skeleton } from "../ui/skeleton";
import { ConnectTrackerDialog } from "./ConnectTrackerDialog";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "../settings/settingsLayout";

import { presentConnection, trackerName } from "./TrackersSettings.logic";

const formatConnectedDate = (isoDate: string): string => {
  const parsed = new Date(isoDate);
  return Number.isNaN(parsed.getTime())
    ? isoDate
    : parsed.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
};

/**
 * Tracker connections, managed from Settings.
 *
 * Issues never arrive through this page — connections are workspace
 * configuration, and browsing a tracker's backlog is its own act elsewhere.
 * What lives here is the whole lifecycle: which trackers are connected, where
 * each one stands right now, and the way out of each.
 */
export function TrackersSettings() {
  const { connections, isPending, error } = useTrackers();
  const [isConnectDialogOpen, setIsConnectDialogOpen] = useState(false);

  return (
    <SettingsPageContainer>
      <SettingsSection
        id="trackers"
        title="Trackers"
        icon={<CircleDotIcon className="size-4 text-muted-foreground" />}
        headerAction={
          connections.length === 0 ? null : (
            <Button size="xs" variant="outline" onClick={() => setIsConnectDialogOpen(true)}>
              <PlusIcon />
              Connect tracker
            </Button>
          )
        }
      >
        {error !== null ? (
          <SettingsRow
            title="Could not load tracker connections"
            description={error}
            className="bg-destructive/8"
          />
        ) : isPending ? (
          <div className="space-y-2 px-3 sm:px-4">
            <Skeleton className="h-12 w-full rounded-xl" />
          </div>
        ) : connections.length === 0 ? (
          <TrackersEmptyState onConnect={() => setIsConnectDialogOpen(true)} />
        ) : (
          connections.map((connection) => (
            <TrackerConnectionRow key={connection.connectionId} connection={connection} />
          ))
        )}
      </SettingsSection>
      <ConnectTrackerDialog open={isConnectDialogOpen} onOpenChange={setIsConnectDialogOpen} />
    </SettingsPageContainer>
  );
}

function TrackersEmptyState({ onConnect }: { onConnect: () => void }) {
  return (
    <Empty className="min-h-52">
      <EmptyMedia variant="icon">
        <CircleDotIcon />
      </EmptyMedia>
      <EmptyHeader>
        <EmptyTitle>No trackers connected</EmptyTitle>
        <EmptyDescription>
          Connect a tracker and its issues can become the starting points of plans. Mercurian only
          reads — nothing you do here is written back.
        </EmptyDescription>
      </EmptyHeader>
      <Button size="xs" variant="outline" onClick={onConnect}>
        <PlusIcon />
        Connect tracker
      </Button>
    </Empty>
  );
}

function TrackerConnectionRow({ connection }: { connection: TrackerConnection }) {
  const disconnectTracker = useDisconnectTracker();
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const presented = useMemo(() => presentConnection(connection, formatConnectedDate), [connection]);

  const handleDisconnect = useCallback(async () => {
    setIsDisconnecting(true);
    await disconnectTracker(connection.connectionId);
    setIsDisconnecting(false);
    // The row leaves through the subscription; there is nothing to remove here.
    setIsConfirmOpen(false);
  }, [connection.connectionId, disconnectTracker]);

  return (
    <SettingsRow
      title={presented.title}
      description={presented.subtitle}
      status={
        presented.standing.tone === "warning" ? (
          <span className="text-warning-foreground">{presented.standing.detail}</span>
        ) : null
      }
      control={
        <>
          <Badge variant={presented.standing.tone === "warning" ? "warning" : "outline"}>
            {presented.standing.label}
          </Badge>
          <Button size="xs" variant="outline" onClick={() => setIsConfirmOpen(true)}>
            Disconnect
          </Button>
          <AlertDialog
            open={isConfirmOpen}
            onOpenChange={(open) => {
              if (isDisconnecting) return;
              setIsConfirmOpen(open);
            }}
          >
            <AlertDialogPopup>
              <AlertDialogHeader>
                <AlertDialogTitle>Disconnect {presented.title}?</AlertDialogTitle>
                <AlertDialogDescription>
                  The connection and its API key are removed from this workspace. Nothing in{" "}
                  {trackerName(connection.kind)} is touched.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogClose
                  disabled={isDisconnecting}
                  render={<Button variant="outline" disabled={isDisconnecting} />}
                >
                  Cancel
                </AlertDialogClose>
                <Button
                  variant="destructive"
                  disabled={isDisconnecting}
                  onClick={() => void handleDisconnect()}
                >
                  {isDisconnecting ? "Disconnecting…" : "Disconnect"}
                </Button>
              </AlertDialogFooter>
            </AlertDialogPopup>
          </AlertDialog>
        </>
      }
    />
  );
}
