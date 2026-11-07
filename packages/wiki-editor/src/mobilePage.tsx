import "./baseLayout.css";
import "./mobilePage.css";

import { useEffect, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";

import type { BaseCellValue } from "./baseCells";
import { BaseBlock } from "./BaseBlock";
import { createWikiEditorPage, type WikiEditorPage } from "./mobilePageController";
import { WikiLinkPreview, type WikiLinkPeek } from "./linkTools";
import { MobileCanvas, MobileCanvasEmbed } from "./mobileCanvas";
import { MobileMermaid } from "./MobileMermaid";
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
const openNote = (name: string, from?: string) =>
  post({ type: "openNote", name, ...(from === undefined ? {} : { from }) });

function LinkPreview({
  page,
  link,
}: {
  readonly page: WikiEditorPage;
  readonly link: WikiLinkPeek;
}) {
  const source = useSyncExternalStore(
    (listener) => page.watchNote(link.name, listener),
    () => page.getNote(link.name),
  );
  return <WikiLinkPreview link={link} source={source} resolved={page.getNoteLink(link.name)} />;
}

function Page({ page }: { readonly page: WikiEditorPage }) {
  const { session } = useSyncExternalStore(page.buffer.subscribe, page.buffer.getSnapshot);
  const { mode, base, baseEditable, canvas, theme, linkTypes } = useSyncExternalStore(
    page.subscribe,
    page.getState,
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- writes the app theme's CSS variables and color scheme onto the page's root element
  useEffect(() => {
    if (!theme) return;
    const root = document.documentElement;
    for (const [name, value] of Object.entries(theme.variables)) {
      root.style.setProperty(name, value);
    }
    root.style.colorScheme = theme.appearance;
    root.dataset.appearance = theme.appearance;
  }, [theme]);
  if (canvas !== null) {
    return <MobileCanvas page={page} data={canvas} post={post} />;
  }
  if (base !== null) {
    return (
      <BaseBlock
        page={page}
        source={base}
        onOpenNote={openNote}
        onOpenUrl={(href) => post({ type: "openUrl", href })}
        {...(baseEditable
          ? {
              onEdit: (file: string, property: string, value: BaseCellValue) =>
                post({ type: "editBase", file, property, value }),
            }
          : {})}
      />
    );
  }
  if (!session) return null;
  return (
    <WikiNoteEditor
      key={session.doc.guid}
      session={session}
      readOnly={mode === "read"}
      onOpenNote={openNote}
      linkTypes={linkTypes}
      renderLinkPreview={(link) => <LinkPreview page={page} link={link} />}
      onOpenUrl={(href) => post({ type: "openUrl", href })}
      renderBase={(source) => (
        <BaseBlock
          page={page}
          source={source}
          onOpenNote={openNote}
          onOpenUrl={(href) => post({ type: "openUrl", href })}
        />
      )}
      renderCanvasEmbed={(target) => (
        <MobileCanvasEmbed page={page} target={target} onOpen={openNote} />
      )}
      renderMermaid={(source) => <MobileMermaid source={source} />}
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
