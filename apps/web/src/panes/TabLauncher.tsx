import { FileCode2, FileDiff, FileText, Layers, SquarePen, type LucideIcon } from "lucide-react";
import {
  useEffect,
  useEffectEvent,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import { openCommandPalette } from "~/commandPaletteBus";
import { ChangeGroupFinder } from "~/components/changeRequests/groups/ChangeGroupFinder";
import { RepositoryFinder } from "~/components/repositories/RepositoryFinder";
import { useRepositories } from "~/components/repositories/useRepositories";
import {
  LAUNCHER_SHORTCUT_BLOCKING_LAYERS,
  surfaceShortcutActionForKey,
  surfaceShortcutTargetsTypingContext,
} from "~/components/RightPanelTabs";
import { Kbd } from "~/components/ui/kbd";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useWikiOverviews } from "~/components/wiki/wikiEnvironment";
import { WikiFinder } from "~/components/wiki/WikiFinder";
import { wikiTabKey } from "~/components/wiki/wikiTabs";
import { useHandleNewThread } from "~/hooks/useHandleNewThread";
import { takesListKey } from "~/keyboardNav/placeLists";
import { startNewThreadFromContext } from "~/lib/chatThreadActions";
import { cn } from "~/lib/utils";
import { useChangeGroups } from "~/state/changeGroups";
import { useProjects } from "~/state/entities";
import { focusedPane } from "./arrangement";
import { workspace } from "./workspace";

type Finder = "document" | "file" | "diff" | "group";

interface LaunchItem {
  readonly label: string;
  readonly icon: LucideIcon;
  readonly shortcut: string;
  readonly available: boolean;
  readonly disabledReason: string;
  readonly run: () => void;
}

/**
 * Astrolabe: a New tab's launcher, as a browser's new tab page: the things that stand on their
 * own (a new chat, a document, a repository's file or changes, a change group). What is picked
 * takes the New tab's place. Its letters answer only while its pane has focus, and differ from
 * the surface launcher's, which a linked New tab beside it may show.
 */
export function TabLauncher({ paneId, tabKey }: { paneId: string; tabKey: string }) {
  const [finding, setFinding] = useState<Finder | null>(null);
  const [highlight, setHighlight] = useState(-1);
  const focused = useSyncExternalStore(
    workspace.store.subscribe,
    () => focusedPane(workspace.arrangement()).id === paneId,
  );
  const { overviews, loading: wikisLoading } = useWikiOverviews();
  const repositories = useRepositories();
  const groups = useChangeGroups();
  const newChat = useNewChat();
  const fill = (key: string) => workspace.fill(tabKey, key);
  // Takes the keyboard as it opens in the focused pane, as the surface launcher does; once only.
  const [focusOnMount] = useState(() => (node: HTMLDivElement | null) => {
    if (node && focusedPane(workspace.arrangement()).id === paneId) node.focus();
  });

  const items: readonly LaunchItem[] = [
    {
      label: "New chat",
      icon: SquarePen,
      shortcut: "N",
      available: true,
      disabledReason: "",
      run: newChat,
    },
    {
      label: "Document",
      icon: FileText,
      shortcut: "O",
      available: overviews.length > 0 || wikisLoading,
      disabledReason: "Add a wiki from the wiki filter in the sidebar first.",
      run: () => setFinding("document"),
    },
    {
      label: "Project file",
      icon: FileCode2,
      shortcut: "R",
      available: repositories.length > 0,
      disabledReason: "Add a project first.",
      run: () => setFinding("file"),
    },
    {
      label: "Project diff",
      icon: FileDiff,
      shortcut: "C",
      available: repositories.length > 0,
      disabledReason: "Add a project first.",
      run: () => setFinding("diff"),
    },
    {
      label: "Change group",
      icon: Layers,
      shortcut: "K",
      available: groups.length > 0,
      disabledReason: "No change groups yet.",
      run: () => setFinding("group"),
    },
  ];
  const available = items.filter((item) => item.available);
  const highlightIndex = available.length === 0 ? -1 : Math.min(highlight, available.length - 1);

  const onShortcut = useEffectEvent((event: KeyboardEvent) => {
    if (!focused || finding !== null) return;
    const item = surfaceShortcutActionForKey(available, event);
    if (!item || document.querySelector(LAUNCHER_SHORTCUT_BLOCKING_LAYERS)) return;
    const target = event.composedPath()[0] ?? event.target;
    if (target instanceof Element && surfaceShortcutTargetsTypingContext(target)) return;
    if (takesListKey(target, event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    item.run();
  });
  // oxlint-disable-next-line t3code/react-effect-budget -- the launcher's letters are window keys, as the surface launcher's are
  useEffect(() => {
    const handler = (event: KeyboardEvent) => onShortcut(event);
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, []);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    if (available.length === 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault();
      setHighlight((highlightIndex + 1) % available.length);
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault();
      setHighlight(
        highlightIndex === -1
          ? available.length - 1
          : (highlightIndex - 1 + available.length) % available.length,
      );
    } else if (event.key === "Enter" && event.target === event.currentTarget) {
      const item = available[highlightIndex];
      if (!item) return;
      event.preventDefault();
      item.run();
    }
  };

  return (
    <div
      ref={focusOnMount}
      tabIndex={0}
      onKeyDown={onKeyDown}
      aria-label="Open a tab"
      data-surface-launcher-keys={focused ? available.map((item) => item.shortcut).join("") : ""}
      className="scrollbar-gutter-both flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-6 pb-(--workspace-topbar-height) outline-none"
    >
      <div className="w-full max-w-xs py-6">
        <h3 className="mb-3 text-center font-medium text-foreground text-sm">Open a tab</h3>
        <div className="flex flex-col gap-0.5">
          {items.map((item) => {
            const Icon = item.icon;
            const index = available.indexOf(item);
            if (!item.available) {
              return (
                <Tooltip key={item.label}>
                  <TooltipTrigger
                    render={
                      <div
                        tabIndex={0}
                        aria-disabled="true"
                        className="flex h-8 w-full cursor-default items-center gap-2.5 rounded-(--control-radius) px-2.5 text-left text-sm opacity-50"
                      />
                    }
                  >
                    <Icon className="size-4 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    <Kbd>{item.shortcut}</Kbd>
                  </TooltipTrigger>
                  <TooltipPopup side="top">{item.disabledReason}</TooltipPopup>
                </Tooltip>
              );
            }
            return (
              <button
                key={item.label}
                type="button"
                onClick={item.run}
                onMouseEnter={() => setHighlight(index)}
                onMouseLeave={() => setHighlight((current) => (current === index ? -1 : current))}
                className={cn(
                  "flex h-8 w-full cursor-pointer items-center gap-2.5 rounded-(--control-radius) px-2.5 text-left text-sm transition-colors hover:bg-accent/60",
                  highlightIndex === index && "bg-accent/60",
                )}
              >
                <Icon className="size-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                <Kbd>{item.shortcut}</Kbd>
              </button>
            );
          })}
        </div>
      </div>
      {finding === "document" ? (
        <WikiFinder
          open
          onOpenChange={(open) => {
            if (!open) setFinding(null);
          }}
          overviews={overviews}
          scope={null}
          mode="find"
          onPick={(tab) => fill(wikiTabKey(tab))}
        />
      ) : null}
      {finding === "file" || finding === "diff" ? (
        <RepositoryFinder mode={finding} onClose={() => setFinding(null)} onPick={fill} />
      ) : null}
      {finding === "group" ? (
        <ChangeGroupFinder onClose={() => setFinding(null)} onPick={fill} />
      ) : null}
    </div>
  );
}

/**
 * Starts a new chat as the sidebar's New thread does: in the project of the chat in front, or
 * with several projects, from the Command Palette's list of them. The panes put it in the New tab
 * in focus as it arrives (`workspace.openChat`).
 */
function useNewChat() {
  const { activeDraftThread, activeThread, defaultProjectRef, handleNewThread } =
    useHandleNewThread();
  const several = useProjects().length > 1;
  return () => {
    if (several) {
      openCommandPalette({ open: "new-thread-in" });
      return;
    }
    void startNewThreadFromContext({
      activeDraftThread,
      activeThread: activeThread ?? undefined,
      defaultProjectRef,
      handleNewThread,
    }).then((started) => {
      if (!started) openCommandPalette({ open: "new-thread-in" });
    });
  };
}
