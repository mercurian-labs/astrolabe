import {
  WIKI_EDITOR_ERROR_HOOK,
  parseWikiEditorEvent,
  wikiEditorCommandScript,
  type WikiEditorCommand,
  type WikiEditorEvent,
} from "@mercurian/wiki-editor/protocol";
import wikiEditorPage from "@t3tools/mobile-wiki-editor";
import { forwardRef, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

import { diagramScript } from "./wikiEditorDiagrams";

export interface WikiEditorHandle {
  /** Sends a command to the page; held until the page says it is ready. */
  send(command: WikiEditorCommand): void;
}

/**
 * The wiki editor, a CodeMirror page shipped with the app (`@t3tools/mobile-wiki-editor`) in
 * a WebView. The screen around it keeps the server connection: it sends the note's versions,
 * the theme and the mode, and hears what the person did (see `@mercurian/wiki-editor/protocol`).
 */
export const WikiEditorWebView = forwardRef<
  WikiEditorHandle,
  {
    readonly onEvent: (event: WikiEditorEvent) => void;
    /** Sent before anything else once the page loads (and again after a reload). */
    readonly initialCommands: () => ReadonlyArray<WikiEditorCommand>;
    /** The page handles its own pans and pinches: the web view itself must not scroll. */
    readonly fixed?: boolean;
  }
>(function WikiEditorWebView(props, ref) {
  const webView = useRef<WebView<object>>(null);
  const ready = useRef(false);
  const queued = useRef<WikiEditorCommand[]>([]);
  const latest = useRef(props);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps the latest props for the web view's load and message callbacks
  useLayoutEffect(() => {
    latest.current = props;
  });

  const inject = (command: WikiEditorCommand) =>
    webView.current?.injectJavaScript(wikiEditorCommandScript(command));

  useImperativeHandle(
    ref,
    () => ({
      send(command) {
        if (ready.current) inject(command);
        else queued.current.push(command);
      },
    }),
    [],
  );

  const source = useMemo(
    () => ({
      html: wikiEditorPage,
      // A real origin on both platforms: under iOS's `file:///` the page is opaque, so its
      // errors arrive as a bare "Script error." and storage APIs refuse it. Not https: WebKit
      // upgrades a plain-http server's files on such a page, and the upgraded request fails.
      baseUrl: "http://localhost/",
    }),
    [],
  );

  // The OS reclaimed the page's process: a new web view, resent everything once it is ready. Not
  // `reload()`: that asks the network for the document's base URL, not this HTML.
  const [generation, setGeneration] = useState(0);
  const restart = () => {
    ready.current = false;
    setGeneration((current) => current + 1);
  };

  const onMessage = (message: WebViewMessageEvent) => {
    const event = parseWikiEditorEvent(message.nativeEvent.data);
    if (!event) return;
    if (event.type === "loadDiagram") {
      webView.current?.injectJavaScript(diagramScript(event.diagram));
      return;
    }
    if (event.type === "ready") {
      ready.current = true;
      for (const command of latest.current.initialCommands()) inject(command);
      for (const command of queued.current.splice(0)) inject(command);
    }
    latest.current.onEvent(event);
  };

  return (
    <WebView<object>
      key={generation}
      ref={webView}
      source={source}
      originWhitelist={["*"]}
      injectedJavaScriptBeforeContentLoaded={WIKI_EDITOR_ERROR_HOOK}
      onMessage={onMessage}
      // The page is the app's own; links leave through `openUrl` events, never by navigating.
      onShouldStartLoadWithRequest={(request) =>
        request.url === "about:blank" || request.url.startsWith(source.baseUrl)
      }
      onContentProcessDidTerminate={restart}
      onRenderProcessGone={restart}
      keyboardDisplayRequiresUserAction={false}
      allowsInlineMediaPlayback
      scrollEnabled={props.fixed !== true}
      bounces={props.fixed !== true}
      hideKeyboardAccessoryView
      allowsLinkPreview={false}
      // The page pads itself by `env(safe-area-inset-*)` (mobilePage.css). An automatic inset
      // lands after the first layout and leaves the page scrolled under the header.
      contentInsetAdjustmentBehavior="never"
      automaticallyAdjustContentInsets={false}
      style={{ flex: 1, backgroundColor: "transparent" }}
      containerStyle={{ backgroundColor: "transparent" }}
    />
  );
});
