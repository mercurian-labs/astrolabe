import { X } from "lucide-react";
import { useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";

import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { isElectron } from "~/env";
import { cn } from "~/lib/utils";
import { COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS } from "~/workspaceTitlebar";
import { insertIndex } from "../panes/drag";

/** What the strip tells each tab it draws: whether it is in front, and where a drop would land. */
export interface TitlebarTabSlot {
  readonly active: boolean;
  readonly insertBefore: boolean;
  readonly insertAfter: boolean;
  readonly dragType: string;
  readonly onDragEnd: () => void;
}

/**
 * A strip of tabs that is a screen's part of the window's title bar, as the chat tabs and the
 * settings tabs are: it drags the window on desktop, clears a collapsed sidebar's controls on
 * the left, and while it reaches the window's right edge (`atWindowEdge`) leaves room for the
 * window's own controls. `trailing` ends it. Tabs reorder by dragging; the whole strip takes the
 * drop, so dropping short of the first tab, in the strip's padding, puts it at the start. The
 * first tab starts in line with the header's breadcrumb below, which also keeps that padding
 * clear of the sidebar's resize rail. `id` names the strip (`data-tab-strip`).
 */
export function TitlebarTabStrip({
  id,
  label,
  keys,
  activeKey,
  atWindowEdge,
  trailing,
  onMove,
  renderTab,
}: {
  id: string;
  label: string;
  keys: readonly string[];
  activeKey: string | null;
  atWindowEdge: boolean;
  trailing?: ReactNode;
  onMove: (key: string, index: number) => void;
  renderTab: (key: string, slot: TitlebarTabSlot) => ReactNode;
}) {
  const list = useRef<HTMLDivElement>(null);
  const [insertAt, setInsertAt] = useState<number | null>(null);
  const dragType = `application/x-astrolabe-${id}-tab`;

  // The tab in front scrolls into view.
  useEffect(() => {
    const element = list.current;
    if (!element || activeKey === null) return;
    const pill = [...element.querySelectorAll<HTMLElement>("[data-tab]")].find(
      (tab) => tab.dataset.key === activeKey,
    );
    pill?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeKey, keys]);

  const dropIndex = (event: DragEvent) => {
    const tabs = [...(list.current?.querySelectorAll("[data-tab]") ?? [])].map((tab) =>
      tab.getBoundingClientRect(),
    );
    return insertIndex(
      tabs.map((box) => box.left + box.width / 2),
      event.clientX,
    );
  };

  return (
    <div
      data-tab-strip={id}
      className={cn(
        "flex h-[var(--workspace-topbar-height)] min-h-[var(--workspace-topbar-height)] shrink-0 items-center border-b border-border bg-muted ps-3.5 pe-2",
        isElectron && "drag-region",
        isElectron && atWindowEdge && "wco:pe-(--workspace-native-controls-inset)",
        COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS,
      )}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes(dragType)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setInsertAt(dropIndex(event));
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setInsertAt(null);
      }}
      onDrop={(event) => {
        const key = event.dataTransfer.getData(dragType);
        setInsertAt(null);
        if (!key) return;
        event.preventDefault();
        onMove(key, dropIndex(event));
      }}
    >
      <div
        ref={list}
        role="tablist"
        aria-label={label}
        aria-orientation="horizontal"
        // Room on each side for a pill's shadow and focus ring, and for the insertion line before
        // the first tab or after the last, which the scrolling list would otherwise clip.
        className="flex min-w-0 items-center gap-1.5 overflow-x-auto px-1.5 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        onWheel={(event) => {
          // A vertical wheel scrolls the tabs sideways.
          if (event.deltaX === 0 && event.deltaY !== 0) {
            event.currentTarget.scrollLeft += event.deltaY;
          }
        }}
      >
        {keys.map((key, index) =>
          renderTab(key, {
            active: key === activeKey,
            insertBefore: insertAt === index,
            insertAfter: insertAt === keys.length && index === keys.length - 1,
            dragType,
            onDragEnd: () => setInsertAt(null),
          }),
        )}
      </div>
      {trailing ? (
        <div className="ms-auto flex shrink-0 items-center ps-1.5">{trailing}</div>
      ) : null}
    </div>
  );
}

/**
 * One tab: an icon and a title up to 220px, a close control over its end on hover, middle-click
 * to close, and dragging to reorder. Selecting the tab in front does nothing.
 */
export function TitlebarTab({
  tabKey,
  title,
  icon,
  slot,
  onSelect,
  onClose,
}: {
  tabKey: string;
  title: string;
  icon: ReactNode;
  slot: TitlebarTabSlot;
  onSelect: () => void;
  onClose: () => void;
}) {
  const { active } = slot;
  return (
    <div
      role="tab"
      tabIndex={active ? 0 : -1}
      aria-selected={active}
      aria-label={title}
      draggable
      data-tab
      data-key={tabKey}
      className={cn(
        // A pill as wide as its title up to 220px; short of room the pills shrink together to
        // 96px, then the strip scrolls. `--pill` is its fill, which the close control fades to.
        "group/tab relative flex h-7 max-w-[220px] min-w-24 shrink cursor-pointer items-center gap-1.5 rounded-md border border-transparent bg-(--pill) px-2.25 text-xs font-medium transition-colors duration-75 outline-none select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        isElectron && "[-webkit-app-region:no-drag]",
        active
          ? "border-border text-foreground shadow-xs/5 [--pill:var(--card)]"
          : "text-muted-foreground [--pill:color-mix(in_oklch,var(--muted),black_4%)] hover:text-foreground hover:[--pill:color-mix(in_oklch,var(--muted),var(--foreground)_7%)] dark:[--pill:color-mix(in_oklch,var(--muted),black_22%)] dark:hover:[--pill:color-mix(in_oklch,var(--muted),var(--foreground)_7%)]",
      )}
      onClick={() => {
        if (!active) onSelect();
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          if (!active) onSelect();
        }
      }}
      onMouseDown={(event) => {
        // Middle-click closes; keep the browser from starting its autoscroll.
        if (event.button === 1) event.preventDefault();
      }}
      onAuxClick={(event) => {
        if (event.button === 1) onClose();
      }}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData(slot.dragType, tabKey);
      }}
      onDragEnd={slot.onDragEnd}
    >
      {slot.insertBefore ? <InsertionLine side="start" /> : null}
      <span className="flex size-4 shrink-0 items-center justify-center [&_svg]:size-3 [&_svg]:shrink-0">
        {icon}
      </span>
      <Tooltip>
        <TooltipTrigger render={<span className="min-w-0 truncate">{title}</span>} />
        <TooltipPopup>{title}</TooltipPopup>
      </Tooltip>
      {/* Over the pill's end while it is hovered or focus is inside it, on a backdrop that fades
          the title out before it, so the pill keeps its width. Only the 16px ✕ takes clicks. */}
      <span className="pointer-events-none absolute inset-y-0 end-0 flex items-center opacity-0 group-focus-within/tab:opacity-100 group-hover/tab:opacity-100">
        <span className="h-full w-6 bg-linear-to-r from-transparent to-(--pill)" />
        <span className="flex h-full items-center rounded-e-md bg-(--pill) pe-1.5">
          <button
            type="button"
            aria-label={`Close ${title}`}
            className="pointer-events-auto flex size-4 cursor-pointer items-center justify-center rounded-sm text-muted-foreground outline-none hover:bg-foreground/8 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            onClick={(event) => {
              event.stopPropagation();
              onClose();
            }}
          >
            <X className="size-3" />
          </button>
        </span>
      </span>
      {slot.insertAfter ? <InsertionLine side="end" /> : null}
    </div>
  );
}

function InsertionLine({ side }: { side: "start" | "end" }) {
  return (
    <span
      className={cn(
        "pointer-events-none absolute inset-y-0.5 w-0.5 rounded-xs bg-primary",
        side === "start" ? "-start-[5px]" : "-end-[5px]",
      )}
    />
  );
}
