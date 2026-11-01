import "./mobilePage.css";

import { useEffect, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";

import { BaseBlock } from "./BaseBlock";
import { createWikiEditorPage, type WikiEditorPage } from "./mobilePageController";
import { WikiNoteEditor } from "./NoteEditor";
import { parseWikiEditorCommand, WIKI_EDITOR_RECEIVE, type WikiEditorEvent } from "./protocol";

/**
 * The wiki editor page a native app shows in a web view. The app sends commands by calling
 * `window.__wikiEditorReceive` and listens for events posted through React Native's bridge
 * (see `protocol.ts`). Built into one script by the mobile app (`generate-wiki-editor.mts`).
 */
declare global {
  interface Window {
    ReactNativeWebView?: { postMessage(message: string): void };
    [WIKI_EDITOR_RECEIVE]?: (command: unknown) => void;
  }
}

const post = (event: WikiEditorEvent) =>
  window.ReactNativeWebView?.postMessage(JSON.stringify(event));

function Page({ page }: { readonly page: WikiEditorPage }) {
  const { session } = useSyncExternalStore(page.buffer.subscribe, page.buffer.getSnapshot);
  const { mode, theme } = useSyncExternalStore(page.subscribe, page.getState);
  useEffect(() => {
    if (!theme) return;
    const root = document.documentElement;
    for (const [name, value] of Object.entries(theme.variables)) {
      root.style.setProperty(name, value);
    }
    root.style.colorScheme = theme.appearance;
    root.dataset.appearance = theme.appearance;
  }, [theme]);
  if (!session) return null;
  return (
    <WikiNoteEditor
      key={session.doc.guid}
      session={session}
      readOnly={mode === "read"}
      onOpenNote={(name) => post({ type: "openNote", name })}
      onOpenUrl={(href) => post({ type: "openUrl", href })}
      renderBase={(source) => (
        <BaseBlock
          page={page}
          source={source}
          onOpenNote={(name) => post({ type: "openNote", name })}
        />
      )}
    />
  );
}

const page = createWikiEditorPage(post);
window[WIKI_EDITOR_RECEIVE] = (raw) => {
  const command = parseWikiEditorCommand(raw);
  if (command) page.handle(command);
};
const container =
  document.getElementById("root") ?? document.body.appendChild(document.createElement("div"));
createRoot(container).render(<Page page={page} />);
post({ type: "ready" });
