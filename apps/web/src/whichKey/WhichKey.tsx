import { useAtomValue } from "@effect/atom-react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { resolveLeaderKey, type KeybindingCommand } from "@t3tools/contracts";
import { isMacPlatform } from "@t3tools/shared/keybindings";
import { vimConfiguration } from "@mercurian/editor/vim";
import { createVimrcApplier } from "@t3tools/shared/vimrc";
import {
  Fragment,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { isCommandPaletteOpen, openCommandPalette } from "~/commandPaletteBus";
import { useAppSections } from "~/components/sidebar/AppIconRail";
import { isWikisPath } from "~/components/sidebar/mainAppLocation";
import { Kbd, KbdGroup } from "~/components/ui/kbd";
import { Popover, PopoverPopup } from "~/components/ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useWikiOverviews } from "~/components/wiki/wikiEnvironment";
import { WikiFinder } from "~/components/wiki/WikiFinder";
import { useClientSettings } from "~/hooks/useSettings";
import { resolveShortcutCommand, shortcutLabelForCommand } from "~/keybindings";
import { isEditableFocused } from "~/lib/editableFocus";
import { isPreviewFocused } from "~/lib/previewFocus";
import { isTerminalFocused } from "~/lib/terminalFocus";
import { isModelPickerOpen } from "~/modelPickerVisibility";
import {
  primaryServerKeybindingsAtom,
  primaryServerKeybindingTriggersAtom,
  primaryServerVimrcAtom,
} from "~/state/server";
import { appCommand, isAppCommand, type AppCommandContext } from "./commands";
import { handleLeaderRequests, openExLine, type KeyOrigin } from "./doors";
import {
  appCommandsSlot,
  chatTabsSlot,
  panesSlot,
  sidebarSectionSlot,
  tabHistorySlot,
  type AppCommandsHandle,
} from "./handles";
import { isSyntheticKeybinding } from "./keybindingCommands";
import { isInDialog, isLeaderKey, leaderKeyLabel, menuKeyOf } from "./leader";
import {
  menuTrail,
  shortTrail,
  createWhichKeyMenu,
  groupAt,
  keyLabels,
  type WhichKeyDoor,
  type WhichKeyState,
} from "./menu";
import { whichKeyRoot } from "./registry";

/** A keydown's keys, as the menu reads them. */
const pressOf = (event: KeyboardEvent) => ({
  key: event.key,
  metaKey: event.metaKey,
  ctrlKey: event.ctrlKey,
  altKey: event.altKey,
  shiftKey: event.shiftKey,
  isComposing: event.isComposing,
});

/** The menu sits this far in from the main area's top-right corner, below the title bar. */
const INSET_PX = 12;

/** Applies the server's vimrc to every Vim editor on the page, each in place of the last. */
const applyVimrc = createVimrcApplier(vimConfiguration);

/** The registry entry for the Command Palette, reading the menu's latest render at each use. */
function latestAppCommands(latest: {
  readonly current: {
    readonly context: (origin: KeyOrigin | null) => AppCommandContext;
    readonly leaderLabel: string;
  };
}): AppCommandsHandle {
  return {
    command: (id, origin) => appCommand(id, latest.current.context(origin)),
    get leaderLabel() {
      return latest.current.leaderLabel;
    },
  };
}

function focusOrigin(): KeyOrigin {
  return { element: document.activeElement, view: null, write: null };
}

/** The main area's top-right corner, below its title bar, where the menu hangs from. */
function menuAnchor() {
  return {
    getBoundingClientRect() {
      const main = document.querySelector("[data-slot='sidebar-inset']")?.getBoundingClientRect();
      const titlebar = Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue("--workspace-topbar-height"),
      );
      const right = (main?.right ?? window.innerWidth) - INSET_PX;
      const top = (main?.top ?? 0) + (Number.isFinite(titlebar) ? titlebar : 0) + INSET_PX;
      return new DOMRect(right, top, 0, 0);
    },
  };
}

/**
 * Astrolabe: the keyboard menu, after LazyVim's leader key and which-key, over every page. Its
 * doors are the `whichKey.open` chord (⌘K / Ctrl+K by default), and the device's leader key
 * (Space unless set otherwise, or none) while focus is on no field or control or in a Vim
 * editor's normal and visual modes. Its rows are the keybindings' menu keys, each running
 * its command from the registry (`commands.ts`), which also runs Astrolabe's commands bound to
 * shortcuts, and lends itself to the Command Palette. It applies the server's vimrc too. The
 * chord shows the menu at once; the leader waits a moment, so a fast sequence runs without it
 * drawing. Open, it reads every key: a group key walks in, a command key runs and
 * closes it, Backspace goes up, Escape closes it, and so do a click elsewhere and the window
 * losing focus. Ctrl+N and Ctrl+P on a Mac, and the arrow keys in a group that does not bind
 * them (the root binds them to focus moves), move a cursor over the rows, which Enter or a click
 * chooses. It never times out. Focus stays where it was throughout. A repeatable command chosen
 * by its key (the focus moves' arrows and h/j/k/l) leaves the menu armed for the device's repeat
 * window (`menuRepeatWindowMs`): its key runs it again without the menu showing, each run
 * restarting the window, until another key (which the page then gets, Escape aside), a click,
 * or the window passing.
 */
export function WhichKey() {
  const [menu] = useState(createWhichKeyMenu<KeyOrigin>);
  const state = useSyncExternalStore(menu.subscribe, menu.getState);
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const triggers = useAtomValue(primaryServerKeybindingTriggersAtom);
  const leaderKey = useClientSettings(resolveLeaderKey);
  const leaderLabel = leaderKey === null ? "Space" : leaderKeyLabel(leaderKey);
  const repeatMs = useClientSettings((settings) => settings.menuRepeatWindowMs);
  const armed = useSyncExternalStore(menu.subscribe, menu.isArmed);
  const vimrc = useAtomValue(primaryServerVimrcAtom);
  const sections = useAppSections();
  const navigate = useNavigate();
  const onWikis = useLocation({ select: (location) => isWikisPath(location.pathname) });
  const [finding, setFinding] = useState(false);
  const popup = useRef<HTMLDivElement>(null);
  const chordLabel = shortcutLabelForCommand(keybindings, "whichKey.open") ?? "⌘K";
  const [mac] = useState(() => isMacPlatform(navigator.platform));

  const context = (origin: KeyOrigin | null): AppCommandContext => ({
    section: sidebarSectionSlot.get(),
    chatTabs: chatTabsSlot.get(),
    panes: panesSlot.get(),
    tabHistory: tabHistorySlot.get(),
    sections,
    keybindings,
    origin,
    openSearch: () => openCommandPalette(),
    openFilePicker: () => openCommandPalette({ open: "files" }),
    openCommandLine: (text) => openExLine(origin, text),
    findDocument: () => {
      if (!onWikis) void navigate({ to: "/wikis" });
      setFinding(true);
    },
  });
  const command = (origin: KeyOrigin | null) => (id: KeybindingCommand) =>
    appCommand(id, context(origin));
  const root = () => whichKeyRoot(triggers, command(menu.origin()));

  // The Command Palette runs commands through this registry too, as the latest render has it.
  const latest = useRef({ context, leaderLabel });
  useLayoutEffect(() => {
    latest.current = { context, leaderLabel };
  });
  useEffect(() => appCommandsSlot.register(latestAppCommands(latest)), []);

  // The server's vimrc, in place of the last one, for every Vim editor on the page.
  useEffect(() => {
    applyVimrc(vimrc);
  }, [vimrc]);

  const commandOf = (event: KeyboardEvent) =>
    resolveShortcutCommand(event, keybindings, {
      context: {
        terminalFocus: isTerminalFocused(),
        previewFocus: isPreviewFocused(),
        editableFocus: isEditableFocused(event.target),
        modelPickerOpen: isModelPickerOpen(),
      },
    });
  const isChord = (event: KeyboardEvent) => commandOf(event) === "whichKey.open";

  // In the repeat window, a repeatable key of the group runs again, and Escape only ends it.
  const onRepeatKeyDown = (event: KeyboardEvent) => {
    // A held key repeats too, as a held shortcut does.
    const key = menuKeyOf({ ...pressOf(event), repeat: false }, isChord(event), { mac });
    if (key === null) return;
    // Focus has moved since the menu opened: the commands act from where it is now.
    const step = menu.pressRepeat(whichKeyRoot(triggers, command(focusOrigin())), key, repeatMs);
    if (!step?.consumed) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    step.run?.();
  };

  // Open, every key is the menu's: captured on the window, ahead of every element and editor.
  // In the repeat window, only the keys that repeat are, and Escape.
  const onOpenKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (isSyntheticKeybinding(event)) return;
    if (!menu.getState()) {
      if (menu.isArmed()) onRepeatKeyDown(event);
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    const key = menuKeyOf(event, isChord(event), { mac });
    if (key === null) return;
    menu.press(root(), key, { repeatMs })?.();
  });

  // Closed, the doors listen after the page has had the key, so an element that binds the chord
  // itself keeps it, as it did the palette's.
  const onDoorKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (menu.getState() || event.defaultPrevented || isSyntheticKeybinding(event)) return;
    // The open palette takes the chord back, to close (see CommandPalette).
    if (event.isComposing || isCommandPaletteOpen()) return;
    const shortcut = commandOf(event);
    // An Astrolabe command bound to a shortcut runs from the registry, as from the menu.
    if (shortcut !== null && isAppCommand(shortcut)) {
      event.preventDefault();
      event.stopPropagation();
      const entry = command(focusOrigin())(shortcut);
      if (!event.repeat || entry.repeatable) entry.run();
      return;
    }
    const door: WhichKeyDoor | null =
      shortcut === "whichKey.open"
        ? "chord"
        : isLeaderKey(event, event.target, { leaderKey })
          ? "leader"
          : null;
    if (door === null) return;
    event.preventDefault();
    event.stopPropagation();
    menu.open(door, focusOrigin());
  });

  // An editor's Vim offers its leader key through `appVimKeys`.
  const onLeaderRequest = useEffectEvent((from: KeyOrigin) => {
    if (leaderKey === null || menu.getState() || isInDialog(from.element)) return false;
    menu.open("leader", from);
    return true;
  });
  const currentLeaderKey = useEffectEvent(() => leaderKey);

  useEffect(() => {
    const capture = (event: KeyboardEvent) => onOpenKeyDown(event);
    const bubble = (event: KeyboardEvent) => onDoorKeyDown(event);
    // The repeat window outlives a move landing in a text field (the composer, a note), so a run
    // of moves passes through it; the first key that does not repeat reaches the field.
    window.addEventListener("keydown", capture, true);
    window.addEventListener("keydown", bubble);
    const stop = handleLeaderRequests({
      open: (from) => onLeaderRequest(from),
      key: () => currentLeaderKey(),
    });
    return () => {
      window.removeEventListener("keydown", capture, true);
      window.removeEventListener("keydown", bubble);
      stop();
    };
  }, []);

  // It closes as it loses focus: a click outside it, or the window losing focus. Either ends a
  // repeat window too.
  const listening = state !== null || armed;
  useEffect(() => {
    if (!listening) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!popup.current?.contains(event.target as Node | null)) menu.close();
    };
    const onBlur = () => menu.close();
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("blur", onBlur);
    };
  }, [listening, menu]);

  const [anchor] = useState(menuAnchor);
  // The popover keeps what it last showed while it fades out.
  const [lastShown, setLastShown] = useState<WhichKeyState | null>(null);
  if (state?.shown && state !== lastShown) setLastShown(state);
  const view = state?.shown ? state : lastShown;
  const rootGroup = view ? root() : null;
  const group = view && rootGroup ? groupAt(rootGroup, view.path) : null;
  const trail = view && rootGroup ? menuTrail(rootGroup, view.path) : [];

  return (
    <>
      <Popover
        open={state?.shown === true}
        onOpenChange={(next) => {
          if (!next) menu.close();
        }}
      >
        <PopoverPopup
          ref={popup}
          anchor={anchor}
          side="bottom"
          align="end"
          sideOffset={0}
          padding="compact"
          width="sm"
          initialFocus={false}
          finalFocus={false}
          aria-label="Keyboard commands"
          data-which-key=""
        >
          {view && group ? (
            <div className="flex flex-col gap-2 text-sm">
              {shortTrail(trail).length < trail.length ? (
                // A folded trail shows the whole of it on hover.
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <p className="truncate px-1 text-xs font-medium text-muted-foreground" />
                    }
                  >
                    {shortTrail(trail).join(" › ")}
                  </TooltipTrigger>
                  <TooltipPopup side="top">{trail.join(" › ")}</TooltipPopup>
                </Tooltip>
              ) : (
                <p className="truncate px-1 text-xs font-medium text-muted-foreground">
                  {trail.join(" › ")}
                </p>
              )}
              {/* One grid for every row, so labels line up past a row with several keys. */}
              <ul className="grid grid-cols-[auto_minmax(0,1fr)_auto] gap-y-0.5">
                {group.items.map((item, index) => (
                  <li
                    key={item.keys[0]}
                    data-highlighted={view.cursor === index ? "" : undefined}
                    className={
                      item.disabled
                        ? "col-span-3 grid cursor-default grid-cols-subgrid items-center gap-x-2 rounded px-1 py-0.5 text-muted-foreground opacity-60 data-highlighted:bg-accent"
                        : "col-span-3 grid cursor-default grid-cols-subgrid items-center gap-x-2 rounded px-1 py-0.5 data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                    }
                    // Pointing moves the cursor; a click chooses the row without taking focus.
                    onPointerMove={() => menu.point(index)}
                    onPointerDown={(event) => event.preventDefault()}
                    onClick={() => {
                      menu.point(index);
                      menu.press(root(), "Enter")?.();
                    }}
                  >
                    <KbdGroup>
                      {keyLabels(item, chordLabel).map((label, at) => (
                        <Fragment key={label}>
                          {at > 0 ? <span className="text-muted-foreground">|</span> : null}
                          <Kbd>{label}</Kbd>
                        </Fragment>
                      ))}
                    </KbdGroup>
                    <span className="min-w-0 truncate">{item.label}</span>
                    <span aria-hidden className="text-muted-foreground">
                      {item.group ? "›" : null}
                    </span>
                  </li>
                ))}
              </ul>
              {view.note !== null ? (
                <p role="status" className="px-1 text-muted-foreground">
                  {view.note}
                </p>
              ) : null}
              {/* The footer's hints do what they say when clicked, without taking focus. */}
              <p className="flex gap-1 px-1 text-xs text-muted-foreground">
                {view.path.length > 0 ? (
                  <>
                    <button
                      type="button"
                      className="cursor-default hover:text-foreground"
                      onPointerDown={(event) => event.preventDefault()}
                      onClick={() => menu.press(root(), "Backspace")}
                    >
                      Backspace back
                    </button>
                    <span aria-hidden>·</span>
                  </>
                ) : null}
                <button
                  type="button"
                  className="cursor-default hover:text-foreground"
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => menu.press(root(), "Escape")}
                >
                  Esc close
                </button>
              </p>
            </div>
          ) : null}
        </PopoverPopup>
      </Popover>
      {finding ? <WikiDocumentFinder onClose={() => setFinding(false)} /> : null}
    </>
  );
}

/** The Wikis finder, for the menu's `w f`; mounted only while open, so wikis load only then. */
function WikiDocumentFinder({ onClose }: { readonly onClose: () => void }) {
  const { overviews } = useWikiOverviews();
  return (
    <WikiFinder
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      overviews={overviews}
      scope={null}
      mode="find"
    />
  );
}
