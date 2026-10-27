/**
 * The sidebar's title row: upstream's search row with the section's name heading the list and
 * search, scope filter and new item as icon buttons. Search swaps in upstream's field while it has
 * focus or a query. The scope picker is passed in because its combobox state lives with the
 * sidebar's scope logic; its icon becomes the project favicon so the header still names the scope.
 */
import { FolderPlusIcon, SearchIcon, SquarePenIcon, XIcon } from "lucide-react";
import {
  type ComponentProps,
  type ComponentType,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { observeResize } from "~/lib/observeResize";

import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { SidebarInput, SidebarMenuButton, useSidebar } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { focusListRow, listDefaultRow } from "../../keyboardNav/placeLists";
import { sidebarSectionSlot } from "../../whichKey/handles";

export interface SidebarThreadHeaderProps {
  searchFieldRef?: RefObject<HTMLDivElement | null>;
  hasProjects: boolean;
  projectScope: ReactNode;
  /** Astrolabe: without an event when the keyboard menu asks (see `sidebarSectionSlot`). */
  onNewThread: (event?: ReactMouseEvent) => void;
  newThreadDisabled: boolean;
  newThreadShortcutLabel: string | null | undefined;
  newThreadInProjectShortcutLabel: string | null | undefined;
  showNewThreadInProjectHint: boolean;
  searchInputRef: RefObject<HTMLInputElement | null>;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  onSearchKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
  isSearching: boolean;
  searchResultCount: number;
  activeSearchResultIndex: number;
  onClearSearch: () => void;
  /** Astrolabe: the section's name, heading the list. */
  title: string;
  /** Astrolabe: what the list holds, for naming its search ("thread", "document"). */
  searchNoun?: string;
  /** Astrolabe: what the new button makes, for headers of lists other than threads. */
  newItemLabel?: string;
}

export function SidebarThreadHeader({
  searchFieldRef,
  hasProjects,
  projectScope,
  onNewThread,
  newThreadDisabled,
  newThreadShortcutLabel,
  newThreadInProjectShortcutLabel,
  showNewThreadInProjectHint,
  searchInputRef,
  searchQuery,
  onSearchQueryChange,
  onSearchKeyDown,
  isSearching,
  searchResultCount,
  activeSearchResultIndex,
  onClearSearch,
  title,
  searchNoun = "thread",
  newItemLabel = "New thread",
}: SidebarThreadHeaderProps) {
  // Astrolabe: the field shows from the search button until it loses focus, and while it holds a
  // query, so picking a result or leaving it empty puts the section's name back.
  const { isMobile, open, setOpen } = useSidebar();
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchFocusRequest, setSearchFocusRequest] = useState(0);
  const fieldShown = searchOpen || isSearching;
  const collapsed = !isMobile && !open;
  useEffect(() => {
    if (searchFocusRequest === 0) return;
    // The sidebar may still be sliding in; focusing must not scroll it.
    searchInputRef.current?.focus({ preventScroll: true });
  }, [searchFocusRequest, searchInputRef]);
  const openSearch = () => {
    if (collapsed) setOpen(true);
    setSearchOpen(true);
    setSearchFocusRequest((request) => request + 1);
  };
  const searchLabel = `Search ${searchNoun}s`;
  // Astrolabe: the keyboard menu's `n` is this row's new button, and the list's `/` its search.
  const newItem = useRef(onNewThread);
  const search = useRef(openSearch);
  useLayoutEffect(() => {
    newItem.current = onNewThread;
    search.current = openSearch;
  });
  useEffect(
    () =>
      sidebarSectionSlot.register({
        newItem: () => newItem.current(),
        newItemLabel,
        newItemDisabled: newThreadDisabled,
        openSearch: () => search.current(),
      }),
    [newItemLabel, newThreadDisabled],
  );
  const resultsVisible = isSearching && searchResultCount > 0;
  // Shrinking results can remove the active option; never leave aria-activedescendant pointing at it.
  const activeResultExists = resultsVisible && activeSearchResultIndex < searchResultCount;
  const newThreadLabel = newThreadShortcutLabel
    ? `${newItemLabel} (${newThreadShortcutLabel})`
    : newItemLabel;

  return (
    <div className="flex items-center gap-1">
      {/* Astrolabe: the section's name holds the field's place until search opens it. */}
      {fieldShown ? null : <SidebarSectionTitle ref={searchFieldRef}>{title}</SidebarSectionTitle>}
      <div
        ref={fieldShown ? searchFieldRef : undefined}
        className={cn(
          "flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground redesign:focus-within:bg-sidebar-row-hover redesign:focus-within:text-sidebar-foreground redesign:focus-within:ring-1 redesign:focus-within:ring-inset redesign:focus-within:ring-ring/70",
          !fieldShown && "hidden",
        )}
      >
        <SearchIcon className="size-4 shrink-0 text-(--sidebar-icon-color)" />
        <SidebarInput
          ref={searchInputRef}
          nativeInput
          type="search"
          value={searchQuery}
          onChange={(event) => onSearchQueryChange(event.currentTarget.value)}
          onKeyDown={(event) => {
            onSearchKeyDown(event);
            // Astrolabe: Escape on an empty field puts the section's name back, and focus on
            // the list's row, rather than nowhere once the field hides.
            if (event.key === "Escape" && !event.defaultPrevented) {
              event.preventDefault();
              event.stopPropagation();
              setSearchOpen(false);
              const sidebar = event.currentTarget.closest("[data-app-sidebar]");
              const row = sidebar ? listDefaultRow(sidebar) : null;
              if (row) focusListRow(row);
            }
          }}
          // Astrolabe: an empty field shows only while it has focus.
          onFocus={() => setSearchOpen(true)}
          onBlur={() => setSearchOpen(false)}
          placeholder="Search"
          aria-label={searchLabel}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={resultsVisible}
          aria-controls={resultsVisible ? "sidebar-thread-search-results" : undefined}
          aria-activedescendant={
            activeResultExists
              ? `sidebar-thread-search-result-${activeSearchResultIndex}`
              : undefined
          }
          className="min-w-0 flex-1"
        />
        {isSearching ? (
          <Button
            type="button"
            size="icon-micro"
            variant="ghost-muted"
            className="shrink-0"
            aria-label={`Clear ${searchNoun} search`}
            onClick={() => {
              onClearSearch();
              searchInputRef.current?.focus();
            }}
          >
            <XIcon className="size-3" />
          </Button>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center">
        {fieldShown ? null : (
          <SidebarHeaderIconButton label={searchLabel} onClick={openSearch}>
            <SearchIcon />
          </SidebarHeaderIconButton>
        )}
        {hasProjects ? projectScope : null}
        <SidebarHeaderIconButton
          label={newItemLabel}
          tooltip={
            showNewThreadInProjectHint ? (
              <span className="flex flex-col gap-0.5">
                <span>{newThreadLabel}</span>
                <span className="text-muted-foreground">
                  New thread in current project: Shift+click
                  {newThreadInProjectShortcutLabel ? ` (${newThreadInProjectShortcutLabel})` : ""}
                </span>
              </span>
            ) : (
              newThreadLabel
            )
          }
          disabled={newThreadDisabled}
          onClick={onNewThread}
        >
          <SquarePenIcon />
        </SidebarHeaderIconButton>
      </div>
    </div>
  );
}

/** Astrolabe: the section's name, as large as a dialog's title, on the search field's row height. */
export function SidebarSectionTitle({
  ref,
  children,
}: {
  ref?: RefObject<HTMLDivElement | null> | undefined;
  children: ReactNode;
}) {
  return (
    <div ref={ref} className="flex h-8 min-w-0 flex-1 items-center px-2">
      <h2 className="truncate text-xl font-semibold text-sidebar-foreground">{children}</h2>
    </div>
  );
}

/** The project picker's last row: adding a project, which used to be its own header button. */
export function SidebarNewProjectRow({ onClick }: { onClick: () => void }) {
  return (
    <SidebarPickerFooter>
      <SidebarPickerAction icon={FolderPlusIcon} onClick={onClick}>
        New project
      </SidebarPickerAction>
    </SidebarPickerFooter>
  );
}

/** Astrolabe: the rows below a header picker's list, for actions rather than picks. */
export function SidebarPickerFooter({ children }: { children: ReactNode }) {
  return <div className="border-t border-border p-1">{children}</div>;
}

export function SidebarPickerAction({
  icon: Icon,
  onClick,
  children,
}: {
  icon: ComponentType<{ className?: string }>;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="flex min-h-8 w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1 text-base outline-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent sm:min-h-7 sm:text-sm"
      onClick={onClick}
    >
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      {children}
    </button>
  );
}

/**
 * Astrolabe: what the title bar holds after the window's own controls while the sidebar is
 * collapsed (the section's back and forward, see `SidebarTabHistory`). It publishes its width as
 * `--workspace-collapsed-sidebar-actions`, so titlebars that inset for the window's controls clear
 * it too; `gap` includes the room after it.
 */
export function SidebarCollapsedActionsSlot({
  gap = false,
  children,
}: {
  gap?: boolean;
  children: ReactNode;
}) {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!element) return;
    const root = document.documentElement;
    const publish = () =>
      root.style.setProperty("--workspace-collapsed-sidebar-actions", `${element.offsetWidth}px`);
    publish();
    const stop = observeResize(element, publish);
    return () => {
      stop();
      root.style.removeProperty("--workspace-collapsed-sidebar-actions");
    };
  }, [element]);
  return (
    <div
      ref={setElement}
      className={cn(
        "pointer-events-auto flex items-center empty:hidden [-webkit-app-region:no-drag]",
        gap && "pe-(--workspace-titlebar-control-gap)",
      )}
    >
      {children}
    </div>
  );
}

/**
 * Icon button with a tooltip, sized for the header's group. Spreads unknown props through so it
 * can serve as a popup trigger's render target, which injects its own handlers, ref and aria
 * state.
 */
export function SidebarHeaderIconButton({
  label,
  tooltip = label,
  className,
  children,
  ...rest
}: {
  /** Accessible name; also the tooltip unless `tooltip` says more. */
  label: string;
  tooltip?: ReactNode;
  className?: string | undefined;
  children?: ReactNode;
} & Omit<
  ComponentProps<typeof SidebarMenuButton>,
  "children" | "className" | "tooltip" | "isActive" | "aria-label"
>) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <SidebarMenuButton
            size="icon"
            type="button"
            aria-label={label}
            {...rest}
            className={cn("relative size-7 shrink-0", className)}
          />
        }
      >
        {children}
        {/* Coarse-pointer hit area, matching the rest of the sidebar chrome. */}
        <span
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 size-[max(100%,3rem)] -translate-1/2 pointer-fine:hidden"
        />
      </TooltipTrigger>
      <TooltipPopup side="bottom">{tooltip}</TooltipPopup>
    </Tooltip>
  );
}
