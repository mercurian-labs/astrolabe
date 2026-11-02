import type { WikiEditorCommand, WikiEditorEvent } from "@mercurian/wiki-editor/protocol";
import { StackActions, useNavigation } from "@react-navigation/native";
import type { EnvironmentId, WikiChangeRequestId, WikiId } from "@t3tools/contracts";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Linking, View } from "react-native";

import { Toolbar } from "../../components/ui/Toolbar";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { useEnvironmentQuery } from "../../state/query";
import { wikiEnvironment } from "../../state/wiki";
import { useEditorTheme } from "./document/useEditorTheme";
import { wikiBaseTitle, wikiDocumentSubtitle } from "./document/wikiDocument.logic";
import type { WikiBaseAnswer } from "./document/WikiBaseQueries";
import { WikiEditorWebView, type WikiEditorHandle } from "./document/WikiEditorWebView";
import type { WikiDocumentParams } from "./wikiRoutes";

/**
 * A `.base` file on its own, read only: the editor page draws its view as it draws a ```base
 * block in a note, and the header's View menu picks among the base's views. A row's note opens
 * on top, read from the same place.
 */
export function WikiBaseScreen({ params }: { readonly params: WikiDocumentParams }) {
  const navigation = useNavigation();
  const environmentId = params.environmentId as EnvironmentId;
  const wikiId = params.wikiId as WikiId;
  const file = params.name;
  const changeRequestId = params.changeRequestId as WikiChangeRequestId | undefined;
  const scope = changeRequestId === undefined ? {} : { changeRequestId };

  const [view, setView] = useState<string | null>(null);
  const query = useEnvironmentQuery(
    wikiEnvironment.query({
      environmentId,
      input: { wikiId, ...scope, base: file, ...(view === null ? {} : { view }) },
    }),
  );
  const wikis = useEnvironmentQuery(wikiEnvironment.list({ environmentId, input: {} }));
  const changeRequests = useEnvironmentQuery(
    wikiEnvironment.changeRequests({ environmentId, input: { wikiId } }),
  );
  const wiki = wikis.data?.wikis.find((entry) => entry.wikiId === wikiId) ?? null;
  const viewing =
    changeRequests.data?.changeRequests.find(
      (changeRequest) => changeRequest.changeRequestId === changeRequestId,
    ) ?? null;

  // A view switch keeps the last view, and the View menu, until the next one lands.
  const [lastResult, setLastResult] = useState(query.data);
  if (query.data !== null && query.data !== lastResult) setLastResult(query.data);
  const result = query.data ?? lastResult;

  const editor = useRef<WikiEditorHandle>(null);
  const theme = useEditorTheme();
  const answer = useMemo<WikiBaseAnswer | null>(
    () =>
      query.error !== null
        ? { result: null, error: query.error }
        : result !== null
          ? { result, error: null }
          : null,
    [result, query.error],
  );
  const shown = useRef({ theme, answer });
  // oxlint-disable-next-line t3code/react-effect-budget -- a reloaded web view reads the latest theme and view
  useLayoutEffect(() => {
    shown.current = { theme, answer };
  });
  const initialCommands = useCallback((): WikiEditorCommand[] => {
    const current = shown.current;
    return [
      { type: "theme", theme: current.theme },
      { type: "showBase", source: file },
      ...(current.answer ? [{ type: "baseResult" as const, source: file, ...current.answer }] : []),
    ];
  }, [file]);
  // oxlint-disable-next-line t3code/react-effect-budget -- the theme crosses into the web view, outside React
  useEffect(() => {
    editor.current?.send({ type: "theme", theme });
  }, [theme]);
  // oxlint-disable-next-line t3code/react-effect-budget -- each answer crosses into the web view, outside React
  useEffect(() => {
    if (answer) editor.current?.send({ type: "baseResult", source: file, ...answer });
  }, [answer, file]);

  const onEvent = (event: WikiEditorEvent) => {
    switch (event.type) {
      case "queryBase":
        if (shown.current.answer) {
          editor.current?.send({ type: "baseResult", source: file, ...shown.current.answer });
        }
        return;
      case "openNote":
        navigation.dispatch(
          StackActions.push("WikiDocument", {
            environmentId: params.environmentId,
            wikiId: params.wikiId,
            name: event.name,
            ...scope,
          }),
        );
        return;
      case "openUrl":
        void Linking.openURL(event.href).catch(() => undefined);
        return;
      case "error":
        console.warn("The wiki editor page failed:", event.message);
        return;
      case "ready":
      case "state":
      case "text":
        return;
    }
  };

  const subtitle = [
    wikiDocumentSubtitle({
      wikiName: wiki?.name ?? null,
      changeRequest: viewing,
      readsChangeRequest: changeRequestId !== undefined,
      agentWorking: false,
    }),
    "Base · read only",
  ].join(" · ");
  const views = result?.views ?? [];
  const current = result?.view.name ?? null;

  return (
    <View className="flex-1 bg-screen">
      <NativeStackScreenOptions
        options={{ title: wikiBaseTitle(file), unstable_headerSubtitle: subtitle }}
        optionsVersion={`${subtitle}|${views.join("\n")}|${current}`}
      />
      {views.length > 1 ? (
        <Toolbar placement="right">
          <Toolbar.Menu icon="rectangle.stack" accessibilityLabel="View" title="View">
            {views.map((name) => (
              <Toolbar.MenuAction key={name} isOn={name === current} onPress={() => setView(name)}>
                <Toolbar.Label>{name}</Toolbar.Label>
              </Toolbar.MenuAction>
            ))}
          </Toolbar.Menu>
        </Toolbar>
      ) : null}
      <WikiEditorWebView ref={editor} onEvent={onEvent} initialCommands={initialCommands} />
    </View>
  );
}
