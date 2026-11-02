import { useEffect } from "react";

import { focusRegion, noteFocus, notePointer, regionToward } from "./regions";
import { openLeaderFrom } from "~/whichKey/doors";
import { forgetEnteredRow, handleListKey, isListRow, roveTo } from "./placeLists";

/** The tab buttons of the panes' and the chats' strips. */
const TAB_BUTTONS = "[data-pane-tab]";

/**
 * Page keyboard navigation between places and through their lists. It tracks focus and pointer
 * (what each place last focused, for focus moves to return to, and the place keys act from, marked
 * by `regions.ts`) and reads list keys ahead of the rows (`placeLists.ts`); commands are in
 * `commands.ts`.
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
