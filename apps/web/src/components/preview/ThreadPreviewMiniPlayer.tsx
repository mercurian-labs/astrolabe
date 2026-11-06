import { FILL_PREVIEW_VIEWPORT, type ScopedThreadRef } from "@t3tools/contracts";
import { previewPdfAssetUrl } from "@t3tools/shared/preview";
import { useEnvironmentHttpBaseUrl } from "~/state/environments";
import { GripHorizontalIcon, PanelRightIcon, PictureInPicture2, XIcon } from "lucide-react";
import { type PointerEvent as ReactPointerEvent, type ReactNode, useRef } from "react";
import { create } from "zustand";
import { useAtomValue } from "@effect/atom-react";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";

import { useChatCanvas } from "../chat/ChatCanvasContext";
import type { ChatCanvasPreview } from "../chat/chatCanvasLayout";
import { BrowserSurfaceSlot } from "~/browser/BrowserSurfaceSlot";
import {
  findActiveBrowserRecordingRuntimeTabId,
  useActiveBrowserRecordingTabIds,
} from "~/browser/browserRecording";
import { useBrowserSurfaceStore } from "~/browser/browserSurfaceStore";
import type { BrowserViewportResizeDirection } from "~/browser/browserViewportLayout";
import { previewRuntimeTabId } from "~/browser/previewRuntimeTabId";
import { rendersServerTabNatively } from "~/browser/previewRuntime";
import { primaryEnvironmentIdAtom } from "~/state/primaryEnvironment";
import { type ServerBrowserHandle, ServerBrowserSurface } from "~/browser/ServerBrowserSurface";
import {
  closeServerPictureInPicture,
  openServerPictureInPicture,
  serverPictureInPictureKey,
  supportsServerPictureInPicture,
  useServerPictureInPictureKey,
} from "~/browser/serverPictureInPicture";
import { useBrowserLayoutZoomFactor } from "~/browser/useBrowserLayoutZoomFactor";
import { Button } from "~/components/ui/button";
import { toastManager } from "~/components/ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";
import { useThreadPreviewState } from "~/previewStateStore";
import {
  type PreviewMiniPlayerSize,
  type PreviewMiniPlayerSource,
  type PreviewMiniPlayerState,
  browserMiniPlayerSource,
  previewMiniPlayerSourceKey,
  usePreviewMiniPlayerStore,
} from "~/previewMiniPlayerStore";
import { useRightPanelStore } from "~/rightPanelStore";
import { useDeviceState } from "~/state/device";

import { DeviceStreamView } from "../device/DeviceStreamView";
import type { DeviceScreenSize } from "@t3tools/client-runtime/device/stream";
import { Atom } from "effect/reactivity";
import { deviceScreenKey, deviceStreamScreenAtom } from "../device/deviceStreamSession";
import type { PreviewStreamViewport } from "@t3tools/client-runtime/preview/server-browser-stream";
import { previewBridge } from "./previewBridge";
import { showPreviewPopup } from "./showPreviewPopup";
import {
  clampPreviewMiniPlayerPosition,
  PREVIEW_MINI_PLAYER_BAR_HEIGHT,
  PREVIEW_MINI_PLAYER_CORNER_RADIUS,
  PREVIEW_MINI_PLAYER_PAGE_TOP,
  PREVIEW_MINI_PLAYER_WEBVIEW_Z_INDEX,
  type PreviewMiniPlayerFrame,
  resizePreviewMiniPlayer,
  resolveDeviceMiniPlayerCornerRadius,
  resolveDeviceMiniPlayerSourceSize,
  resolvePreviewMiniPlayerSourceSize,
} from "./previewMiniPlayerLayout";

interface PointerGesture {
  readonly pointerId: number;
  readonly pointerX: number;
  readonly pointerY: number;
  readonly frame: PreviewMiniPlayerFrame;
  readonly direction: BrowserViewportResizeDirection | null;
  moved: boolean;
}

const GESTURE_SLOP_PX = 6;

interface Props {
  readonly threadRef: ScopedThreadRef;
  readonly miniPlayer: PreviewMiniPlayerState;
}

const frameCornerRadius = () => PREVIEW_MINI_PLAYER_CORNER_RADIUS;

// Outside the page, like the bar: a desktop page draws above everything in the pane, so anything
// laid over it can be neither seen nor grabbed.
const RESIZE_HANDLES: ReadonlyArray<{
  readonly direction: BrowserViewportResizeDirection;
  readonly className: string;
}> = [
  { direction: "north", className: "inset-x-0 -top-2 h-2 cursor-ns-resize" },
  { direction: "south", className: "inset-x-0 -bottom-2 h-2 cursor-ns-resize" },
  { direction: "west", className: "inset-y-0 -left-2 w-2 cursor-ew-resize" },
  { direction: "east", className: "inset-y-0 -right-2 w-2 cursor-ew-resize" },
  { direction: "northwest", className: "-left-3 -top-3 size-4 cursor-nwse-resize" },
  { direction: "northeast", className: "-right-3 -top-3 size-4 cursor-nesw-resize" },
  { direction: "southwest", className: "-bottom-3 -left-3 size-4 cursor-nesw-resize" },
  { direction: "southeast", className: "-bottom-3 -right-3 size-4 cursor-nwse-resize" },
];

// What the stream reports about its source. It lives outside the player so the
// chat canvas lays out the frame from the same source size the player uses. One
// slot is enough, since only the shown thread renders a player, and it keeps the
// store from collecting an entry for every tab a session ever streamed.
const useStreamedSourceSize = create<{
  readonly key: string;
  readonly viewport: PreviewStreamViewport;
} | null>(() => null);

const NO_DEVICE_SCREEN_ATOM = Atom.make<DeviceScreenSize | null>(null).pipe(
  Atom.withLabel("device-stream-screen:none"),
);

const streamedSourceKey = (threadRef: ScopedThreadRef, sourceKey: string) =>
  `${scopedThreadKey(threadRef)}\u0000${sourceKey}`;

// The mini player's device stream view, named so the canvas can read the
// screen size that view reports.
const miniPlayerDeviceViewId = (
  threadRef: ScopedThreadRef,
  source: Extract<PreviewMiniPlayerSource, { kind: "device" }>,
) =>
  `preview-mini-player\u0000${scopedThreadKey(threadRef)}\u0000${deviceScreenKey(threadRef.environmentId, source.hostId, source.deviceId)}`;

function useBrowserMiniPlayerSource(threadRef: ScopedThreadRef | null, tabId: string | null) {
  const previewState = useThreadPreviewState(threadRef);
  const snapshot = tabId === null ? null : (previewState.sessions[tabId] ?? null);
  const runtimeTabId =
    threadRef && tabId !== null
      ? previewRuntimeTabId(threadRef, previewState.serverEpoch, tabId)
      : null;
  const desktopOverlay = tabId === null ? null : (previewState.desktopByTabId[tabId] ?? null);
  const layoutZoomFactor = useBrowserLayoutZoomFactor(desktopOverlay?.zoomFactor ?? 1);
  const fittedSourceContent = useBrowserSurfaceStore((state) =>
    runtimeTabId === null ? null : (state.byTabId[runtimeTabId]?.fittedSourceContent ?? null),
  );
  const primaryEnvironmentId = useAtomValue(primaryEnvironmentIdAtom);
  const serverTab =
    threadRef !== null &&
    snapshot?.runtime === "server" &&
    !rendersServerTabNatively(threadRef.environmentId, primaryEnvironmentId, snapshot);
  const streamViewport = useStreamedSourceSize((state) =>
    threadRef &&
    tabId !== null &&
    state?.key ===
      streamedSourceKey(threadRef, previewMiniPlayerSourceKey(browserMiniPlayerSource(tabId)))
      ? state.viewport
      : null,
  );
  const sourceSize: PreviewMiniPlayerSize =
    serverTab && streamViewport
      ? streamViewport
      : resolvePreviewMiniPlayerSourceSize(
          snapshot?.viewport ?? FILL_PREVIEW_VIEWPORT,
          fittedSourceContent,
          layoutZoomFactor,
        );
  return { serverEpoch: previewState.serverEpoch, snapshot, desktopOverlay, serverTab, sourceSize };
}

/** The mini player as the chat canvas lays it out; null when no player renders. */
export function useThreadPreviewCanvasSource(
  threadRef: ScopedThreadRef | null,
  miniPlayer: PreviewMiniPlayerState | null,
): ChatCanvasPreview | null {
  const source = miniPlayer?.source ?? null;
  const browser = useBrowserMiniPlayerSource(
    threadRef,
    source?.kind === "browser" ? source.tabId : null,
  );
  const sourceKey = source ? previewMiniPlayerSourceKey(source) : null;
  const screen = useAtomValue(
    threadRef && source?.kind === "device"
      ? deviceStreamScreenAtom(miniPlayerDeviceViewId(threadRef, source))
      : NO_DEVICE_SCREEN_ATOM,
  );
  if (!miniPlayer || !source || sourceKey === null) return null;
  if (source.kind === "browser" && !browser.snapshot) return null;
  return {
    key: sourceKey,
    width: miniPlayer.width,
    position: miniPlayer.position,
    lastInteraction: miniPlayer.lastInteraction,
    source:
      source.kind === "browser"
        ? browser.sourceSize
        : resolveDeviceMiniPlayerSourceSize(source.platform, screen),
  };
}

export function ThreadPreviewMiniPlayer({ threadRef, miniPlayer }: Props) {
  const { source } = miniPlayer;
  return source.kind === "browser" ? (
    <BrowserMiniPlayer
      key={source.tabId}
      threadRef={threadRef}
      tabId={source.tabId}
      miniPlayer={miniPlayer}
    />
  ) : (
    <DeviceMiniPlayer
      key={previewMiniPlayerSourceKey(source)}
      threadRef={threadRef}
      source={source}
      miniPlayer={miniPlayer}
    />
  );
}

function BrowserMiniPlayer({ threadRef, tabId, miniPlayer }: Props & { readonly tabId: string }) {
  const httpBaseUrl = useEnvironmentHttpBaseUrl(threadRef.environmentId);
  const { serverEpoch, snapshot, desktopOverlay, serverTab, sourceSize } =
    useBrowserMiniPlayerSource(threadRef, tabId);
  const runtimeTabId = previewRuntimeTabId(threadRef, serverEpoch, tabId);
  const recordingTabIds = useActiveBrowserRecordingTabIds();
  const recording =
    recordingTabIds.has(runtimeTabId) ||
    findActiveBrowserRecordingRuntimeTabId(threadRef, tabId) !== null;
  const serverSurfaceRef = useRef<ServerBrowserHandle | null>(null);
  const serverPictureInPicture =
    useServerPictureInPictureKey() === serverPictureInPictureKey(threadRef.threadId, tabId);
  const viewportKey = streamedSourceKey(
    threadRef,
    previewMiniPlayerSourceKey(browserMiniPlayerSource(tabId)),
  );

  const openInPanel = () => {
    usePreviewMiniPlayerStore.getState().close(threadRef);
    useRightPanelStore.getState().openBrowser(threadRef, tabId);
  };

  const toggleNativePictureInPicture = async () => {
    try {
      if (serverTab) {
        if (serverPictureInPicture) closeServerPictureInPicture();
        else
          await openServerPictureInPicture({
            ...threadRef,
            tabId,
            seed: serverSurfaceRef.current?.canvas() ?? null,
          });
      } else if (previewBridge) {
        const operation = desktopOverlay?.pictureInPicture
          ? previewBridge.pictureInPicture.close
          : previewBridge.pictureInPicture.open;
        await operation(runtimeTabId);
      }
    } catch (error) {
      toastManager.add({
        type: "error",
        title: serverTab ? "Unable to pop out preview" : "Unable to update popped-out preview",
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    }
  };

  if (!snapshot) return null;
  const pdfUrl =
    snapshot.navStatus._tag === "Success"
      ? previewPdfAssetUrl(snapshot.navStatus.url, httpBaseUrl)
      : null;
  const poppedOut = serverTab ? serverPictureInPicture : Boolean(desktopOverlay?.pictureInPicture);
  const canPopOut = serverTab
    ? poppedOut || (pdfUrl === null && supportsServerPictureInPicture())
    : true;

  return (
    <MiniPlayerShell
      threadRef={threadRef}
      miniPlayer={miniPlayer}
      sourceSize={sourceSize}
      label="Floating browser preview"
      recording={recording}
      onOpenInPanel={openInPanel}
      barActions={
        canPopOut ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant={poppedOut ? "secondary" : "ghost"}
                  size="icon-xs"
                  aria-label={
                    poppedOut ? "Close popped-out preview" : "Pop preview into separate window"
                  }
                  disabled={!serverTab && !desktopOverlay?.hasWebContents}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={toggleNativePictureInPicture}
                />
              }
            >
              <PictureInPicture2 />
            </TooltipTrigger>
            <TooltipPopup side="top">
              {poppedOut ? "Close separate window" : "Pop into separate window"}
            </TooltipPopup>
          </Tooltip>
        ) : null
      }
    >
      {(frame) =>
        serverTab ? (
          <div
            className="pointer-events-auto absolute inset-0 overflow-hidden rounded-[inherit]"
            style={{ zIndex: PREVIEW_MINI_PLAYER_WEBVIEW_Z_INDEX }}
          >
            <ServerBrowserSurface
              ref={serverSurfaceRef}
              environmentId={threadRef.environmentId}
              threadId={threadRef.threadId}
              tabId={tabId}
              pdfUrl={pdfUrl}
              visible
              followSize={false}
              controlPosition="bottom"
              onViewport={(viewport) =>
                useStreamedSourceSize.setState(
                  (state) =>
                    state?.key === viewportKey &&
                    state.viewport.width === viewport.width &&
                    state.viewport.height === viewport.height
                      ? state
                      : { key: viewportKey, viewport },
                  true,
                )
              }
              onPopup={(popupTabId) => showPreviewPopup(threadRef, popupTabId, "floating")}
              className="size-full"
            />
          </div>
        ) : (
          <>
            <BrowserSurfaceSlot
              tabId={runtimeTabId}
              visible={Boolean(desktopOverlay?.hasWebContents)}
              cornerRadius={PREVIEW_MINI_PLAYER_CORNER_RADIUS}
              zIndex={PREVIEW_MINI_PLAYER_WEBVIEW_Z_INDEX}
              fitSourceContent
              layoutVersion={`${frame.x}:${frame.y}`}
              className="absolute inset-0"
            />
            {!desktopOverlay?.hasWebContents ? (
              <div className="pointer-events-none absolute inset-0 z-[49] flex items-center justify-center rounded-[inherit] bg-muted text-xs text-muted-foreground">
                Reconnecting preview…
              </div>
            ) : null}
          </>
        )
      }
    </MiniPlayerShell>
  );
}

function DeviceMiniPlayer({
  threadRef,
  source,
  miniPlayer,
}: Props & { readonly source: Extract<PreviewMiniPlayerSource, { kind: "device" }> }) {
  const { state: deviceState } = useDeviceState(threadRef.environmentId);
  const viewId = miniPlayerDeviceViewId(threadRef, source);
  const screen = useAtomValue(deviceStreamScreenAtom(viewId));
  const sourceSize = resolveDeviceMiniPlayerSourceSize(source.platform, screen);
  const device = deviceState.devices.find(
    (entry) => entry.hostId === source.hostId && entry.id === source.deviceId,
  );
  const host = deviceState.hosts.find((entry) => entry.id === source.hostId);
  const hostLabel = host?.label ?? "Device host";
  const cornerRadius = (player: PreviewMiniPlayerSize) =>
    resolveDeviceMiniPlayerCornerRadius(source.platform, player);

  const openInPanel = () => {
    usePreviewMiniPlayerStore.getState().close(threadRef);
    useRightPanelStore.getState().openDevice(threadRef, {
      hostId: source.hostId,
      deviceId: source.deviceId,
      platform: source.platform,
      name: source.name,
    });
  };

  return (
    <MiniPlayerShell
      threadRef={threadRef}
      miniPlayer={miniPlayer}
      sourceSize={sourceSize}
      label="Floating device preview"
      onOpenInPanel={openInPanel}
      cornerRadius={cornerRadius}
    >
      {() => (
        <div
          className="pointer-events-auto absolute inset-0 overflow-hidden rounded-[inherit]"
          style={{ zIndex: PREVIEW_MINI_PLAYER_WEBVIEW_Z_INDEX }}
        >
          <DeviceStreamView
            environmentId={threadRef.environmentId}
            platform={source.platform}
            deviceId={source.deviceId}
            hostId={source.hostId}
            deviceName={device?.name ?? source.name}
            deviceDescription={`${hostLabel} · ${device?.version ?? source.platform}`}
            visible
            viewId={viewId}
            serveSimOnly={host?.kind === "simlock"}
          />
        </div>
      )}
    </MiniPlayerShell>
  );
}

/** Match native clipping and DOM radii to align their separately composited edges. */
function MiniPlayerShell({
  threadRef,
  miniPlayer,
  sourceSize,
  label,
  onOpenInPanel,
  barActions,
  recording = false,
  cornerRadius = frameCornerRadius,
  children,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly miniPlayer: PreviewMiniPlayerState;
  readonly sourceSize: PreviewMiniPlayerSize;
  readonly label: string;
  readonly onOpenInPanel: () => void;
  readonly barActions?: ReactNode;
  readonly recording?: boolean;
  readonly cornerRadius?: (frame: PreviewMiniPlayerSize) => number;
  readonly children: (frame: PreviewMiniPlayerFrame) => ReactNode;
}) {
  const canvas = useChatCanvas();
  const gestureRef = useRef<PointerGesture | null>(null);
  const container = canvas?.container ?? null;
  const sourceKey = previewMiniPlayerSourceKey(miniPlayer.source);
  const frame = canvas?.previewKey === sourceKey ? canvas.layout.frame : null;

  const radius = frame
    ? cornerRadius({
        width: frame.width,
        height: frame.height - PREVIEW_MINI_PLAYER_PAGE_TOP,
      })
    : PREVIEW_MINI_PLAYER_CORNER_RADIUS;

  const close = () => {
    usePreviewMiniPlayerStore.getState().close(threadRef);
  };

  const beginGesture = (
    event: ReactPointerEvent<HTMLElement>,
    direction: BrowserViewportResizeDirection | null,
  ) => {
    if (event.button !== 0 || !frame) return;
    gestureRef.current = {
      pointerId: event.pointerId,
      pointerX: event.clientX,
      pointerY: event.clientY,
      frame,
      direction,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId || !container) return;
    const delta = { x: event.clientX - gesture.pointerX, y: event.clientY - gesture.pointerY };
    if (!gesture.moved && Math.hypot(delta.x, delta.y) < GESTURE_SLOP_PX) return;
    gesture.moved = true;
    const store = usePreviewMiniPlayerStore.getState();
    if (gesture.direction === null) {
      store.move(
        threadRef,
        sourceKey,
        clampPreviewMiniPlayerPosition(
          { x: gesture.frame.x + delta.x, y: gesture.frame.y + delta.y },
          container,
          gesture.frame,
        ),
      );
      return;
    }
    const next = resizePreviewMiniPlayer({
      start: gesture.frame,
      direction: gesture.direction,
      delta,
      source: sourceSize,
      container,
    });
    store.resize(threadRef, sourceKey, next.width, { x: next.x, y: next.y });
  };

  const endGesture = (event: ReactPointerEvent<HTMLElement>) => {
    const gesture = gestureRef.current;
    if (gesture?.pointerId !== event.pointerId) return;
    gestureRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <div className="pointer-events-none absolute inset-0">
      {frame ? (
        <section
          aria-label={label}
          data-preview-mini-player={sourceKey}
          className="pointer-events-none absolute select-none"
          style={{
            left: frame.x,
            top: frame.y,
            width: frame.width,
            height: frame.height,
            borderRadius: radius,
          }}
        >
          <div
            data-preview-mini-player-bar=""
            className="pointer-events-auto absolute inset-x-0 top-0 z-[49] flex cursor-grab touch-none items-center justify-between rounded-lg border border-border/80 bg-popover pl-2 pr-1 shadow-lg/20 active:cursor-grabbing"
            style={{ height: PREVIEW_MINI_PLAYER_BAR_HEIGHT }}
            onPointerDown={(event) => beginGesture(event, null)}
            onPointerMove={handlePointerMove}
            onPointerUp={endGesture}
            onPointerCancel={endGesture}
          >
            <GripHorizontalIcon aria-hidden className="size-3.5 text-muted-foreground" />
            <div className="flex items-center gap-0.5">
              {recording ? (
                <span
                  role="status"
                  aria-label="Recording preview"
                  className="flex size-6 shrink-0 items-center justify-center"
                >
                  <span className="size-2 rounded-full bg-destructive motion-safe:animate-status-pulse" />
                </span>
              ) : null}
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label="Open preview in right panel"
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={onOpenInPanel}
                    />
                  }
                >
                  <PanelRightIcon />
                </TooltipTrigger>
                <TooltipPopup side="top">Open in right panel</TooltipPopup>
              </Tooltip>
              {barActions}
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label="Close floating preview"
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={close}
                    />
                  }
                >
                  <XIcon />
                </TooltipTrigger>
                <TooltipPopup side="top">Close floating preview</TooltipPopup>
              </Tooltip>
            </div>
          </div>
          <div
            className="absolute inset-x-0 bottom-0 rounded-[inherit]"
            style={{ top: PREVIEW_MINI_PLAYER_PAGE_TOP }}
          >
            <div className="absolute inset-0 z-[47] rounded-[inherit] bg-muted shadow-2xl/35 ring-1 ring-border/80" />
            {children(frame)}
            {RESIZE_HANDLES.map(({ direction, className }) => (
              <div
                key={direction}
                role="presentation"
                data-preview-mini-player-resize={direction}
                className={cn("pointer-events-auto absolute z-[49] touch-none", className)}
                onPointerDown={(event) => beginGesture(event, direction)}
                onPointerMove={handlePointerMove}
                onPointerUp={endGesture}
                onPointerCancel={endGesture}
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
