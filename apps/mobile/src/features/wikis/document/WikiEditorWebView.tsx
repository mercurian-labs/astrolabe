import {
  WIKI_EDITOR_ERROR_HOOK,
  parseWikiEditorEvent,
  wikiEditorCommandScript,
  type WikiEditorCommand,
  type WikiEditorEvent,
} from "@mercurian/wiki-editor/protocol";
import wikiEditorPage from "@t3tools/mobile-wiki-editor";
import { forwardRef, useImperativeHandle, useLayoutEffect, useMemo, useRef } from "react";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

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
  }
>(function WikiEditorWebView(props, ref) {
  const webView = useRef<WebView<object>>(null);
  const ready = useRef(false);
  const queued = useRef<WikiEditorCommand[]>([]);
  const latest = useRef(props);
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
      // errors arrive as a bare "Script error." and storage APIs refuse it.
      baseUrl: "https://localhost/",
    }),
    [],
  );

  const onMessage = (message: WebViewMessageEvent) => {
    const event = parseWikiEditorEvent(message.nativeEvent.data);
    if (!event) return;
    if (event.type === "ready") {
      ready.current = true;
      for (const command of latest.current.initialCommands()) inject(command);
      for (const command of queued.current.splice(0)) inject(command);
    }
    latest.current.onEvent(event);
  };

  return (
    <WebView<object>
      ref={webView}
      source={source}
      originWhitelist={["*"]}
      injectedJavaScriptBeforeContentLoaded={WIKI_EDITOR_ERROR_HOOK}
      onMessage={onMessage}
      // The page is the app's own; links leave through `openUrl` events, never by navigating.
      onShouldStartLoadWithRequest={(request) =>
        request.url === "about:blank" || request.url.startsWith(source.baseUrl)
      }
      onContentProcessDidTerminate={() => {
        // iOS reclaimed the page's process: reload it, and resend everything once it is ready.
        ready.current = false;
        webView.current?.reload();
      }}
      keyboardDisplayRequiresUserAction={false}
      hideKeyboardAccessoryView
      allowsLinkPreview={false}
      contentInsetAdjustmentBehavior="automatic"
      automaticallyAdjustContentInsets
      style={{ flex: 1, backgroundColor: "transparent" }}
      containerStyle={{ backgroundColor: "transparent" }}
    />
  );
});
