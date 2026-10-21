import { useEffect } from "react";

import { focusRegion, noteFocus, notePointer, regionToward } from "./regions";
import { openLeaderFrom } from "~/whichKey/doors";
import { forgetEnteredRow, handleListKey, isListRow, roveTo } from "./placeLists";

/** The tab buttons of the panes' and the chats' strips. */
const TAB_BUTTONS = "[data-pane-tab], [data-chat-tab]";

/**
 * Astrolabe: the page's keyboard navigation between places and through their lists (the
 * sidebar's rows, the icon rail's buttons). It follows focus and the pointer (what each place last
 * had focused, for the focus moves to return to, and which place keys act from, which
 * `regions.ts` marks), and reads the lists' keys ahead of the rows (`placeLists.ts`). The
 * commands themselves are in the registry (`commands.ts`).
 */
export function KeyboardNavigation() {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // A focus move lands on a pane's tab in front, a button that would take Space as a press:
      // there the leader opens the keyboard menu, as it does on a list's row.
      const target = event.target;
      if (
        target instanceof Element &&
        target.matches(TAB_BUTTONS) &&
        !event.repeat &&
        !event.shiftKey &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        openLeaderFrom(target, event.key)
      ) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      handleListKey(event, {
        onEscape: (row) => {
          const right = regionToward("right", row);
          if (right) focusRegion(right);
        },
      });
    };
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      noteFocus(target);
      if (isListRow(target)) roveTo(target);
    };
    const onPointerDown = (event: PointerEvent) => {
      forgetEnteredRow();
      notePointer(event.target instanceof Element ? event.target : null);
    };

    // Capturing on the document: after the open keyboard menu (on the window) has had its keys,
    // ahead of the rows' own handlers.
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, []);
  return null;
}
