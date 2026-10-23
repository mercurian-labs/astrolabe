/**
 * The messages between a native app and the wiki editor page it shows in a web view. The app
 * keeps the server connection: it reads the note and hands each version to the page, and the
 * page edits it and says what the person did. Plain data both ways, as JSON.
 */

/** Who wrote a version that lands live, in which turn; the page marks it in their colour. */
export interface WikiEditorAuthor {
  readonly name: string;
  readonly color: string;
  readonly turnId: string;
}

/** The app's colours, as CSS custom properties on the page's root (`--background`, …). */
export interface WikiEditorTheme {
  readonly appearance: "light" | "dark";
  readonly variables: Readonly<Record<string, string>>;
}

/** What the app tells the page. */
export type WikiEditorCommand =
  /** A read of the note. With `author`, a changed version lands live as theirs. */
  | {
      readonly type: "receive";
      readonly source: string;
      readonly author: WikiEditorAuthor | null;
      /** While the author's turn runs, its writes stay one reviewable change. */
      readonly turnRunning: boolean;
    }
  /** Reading follows links on a tap; editing types. A skill map is never editable. */
  | { readonly type: "mode"; readonly mode: "read" | "edit" }
  | { readonly type: "theme"; readonly theme: WikiEditorTheme }
  /** The edits were saved as `text`: the next read should bring it back. */
  | { readonly type: "markSaved"; readonly text: string }
  | { readonly type: "discard" }
  /** Drops the edits for the version that changed underneath them. */
  | { readonly type: "loadChanged" }
  /** Asks for the buffer's text, answered with a `text` event carrying `requestId`. */
  | { readonly type: "requestText"; readonly requestId: number };

/** What the page tells the app. */
export type WikiEditorEvent =
  /** The page is listening; the app sends the theme, mode and note. */
  | { readonly type: "ready" }
  | {
      readonly type: "state";
      /** The buffer holds edits that are not saved. */
      readonly dirty: boolean;
      /** The note changed underneath unsaved edits. */
      readonly changedUnderneath: boolean;
    }
  | { readonly type: "openNote"; readonly name: string }
  | { readonly type: "openUrl"; readonly href: string }
  | { readonly type: "text"; readonly requestId: number; readonly text: string }
  /** The page failed (see `WIKI_EDITOR_ERROR_HOOK`); it may show nothing. */
  | { readonly type: "error"; readonly message: string };

/**
 * Installed by the app before the page's own script runs, so even a page that dies while
 * loading says so instead of staying blank.
 */
export const WIKI_EDITOR_ERROR_HOOK = `(function(){function send(m){window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify({type:"error",message:String(m)}))}window.addEventListener("error",function(e){send(e.message||"The page failed.")});window.addEventListener("unhandledrejection",function(e){send(e.reason&&e.reason.message||e.reason||"The page failed.")})})();true;`;

/** The page's global the app calls with a command, through `injectJavaScript`. */
export const WIKI_EDITOR_RECEIVE = "__wikiEditorReceive";

/** The JavaScript that delivers `command` to the page. */
export function wikiEditorCommandScript(command: WikiEditorCommand): string {
  return `window.${WIKI_EDITOR_RECEIVE}&&window.${WIKI_EDITOR_RECEIVE}(${JSON.stringify(command)});true;`;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** An event from the page's raw message, or null for anything malformed. */
export function parseWikiEditorEvent(raw: string): WikiEditorEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  switch (value.type) {
    case "ready":
      return { type: "ready" };
    case "state":
      return typeof value.dirty === "boolean" && typeof value.changedUnderneath === "boolean"
        ? { type: "state", dirty: value.dirty, changedUnderneath: value.changedUnderneath }
        : null;
    case "openNote":
      return typeof value.name === "string" && value.name.length > 0
        ? { type: "openNote", name: value.name }
        : null;
    case "openUrl":
      return typeof value.href === "string" ? { type: "openUrl", href: value.href } : null;
    case "text":
      return typeof value.requestId === "number" && typeof value.text === "string"
        ? { type: "text", requestId: value.requestId, text: value.text }
        : null;
    case "error":
      return typeof value.message === "string" ? { type: "error", message: value.message } : null;
    default:
      return null;
  }
}

/** A command from the app, or null for anything malformed. */
export function parseWikiEditorCommand(value: unknown): WikiEditorCommand | null {
  if (!isRecord(value)) return null;
  switch (value.type) {
    case "receive":
      if (typeof value.source !== "string" || typeof value.turnRunning !== "boolean") return null;
      return {
        type: "receive",
        source: value.source,
        author: readAuthor(value.author),
        turnRunning: value.turnRunning,
      };
    case "mode":
      return value.mode === "read" || value.mode === "edit"
        ? { type: "mode", mode: value.mode }
        : null;
    case "theme": {
      const theme = value.theme;
      if (!isRecord(theme) || (theme.appearance !== "light" && theme.appearance !== "dark")) {
        return null;
      }
      const variables: Record<string, string> = {};
      if (isRecord(theme.variables)) {
        for (const [name, color] of Object.entries(theme.variables)) {
          if (name.startsWith("--") && typeof color === "string") variables[name] = color;
        }
      }
      return { type: "theme", theme: { appearance: theme.appearance, variables } };
    }
    case "markSaved":
      return typeof value.text === "string" ? { type: "markSaved", text: value.text } : null;
    case "discard":
      return { type: "discard" };
    case "loadChanged":
      return { type: "loadChanged" };
    case "requestText":
      return typeof value.requestId === "number"
        ? { type: "requestText", requestId: value.requestId }
        : null;
    default:
      return null;
  }
}

function readAuthor(value: unknown): WikiEditorAuthor | null {
  if (!isRecord(value)) return null;
  const { name, color, turnId } = value;
  return typeof name === "string" && typeof color === "string" && typeof turnId === "string"
    ? { name, color, turnId }
    : null;
}
