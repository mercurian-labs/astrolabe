import type { CanvasCamera } from "@mercurian/wiki-editor/canvas-geometry";
import type { WikiEditorCommand, WikiEditorEvent } from "@mercurian/wiki-editor/protocol";
import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { canvasViewFromToolItem } from "@t3tools/client-runtime/canvasViews";
import { EnvironmentId, ThreadId, TurnItemId } from "@t3tools/contracts";
import { useCallback, useEffect, useRef } from "react";
import { View } from "react-native";

import { tryOpenExternalUrl } from "../../lib/openExternalUrl";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { orchestrationEnvironment } from "../../state/orchestration";
import { useEnvironmentQuery } from "../../state/query";
import { fileRoutePathSegments } from "../files/filePath";
import { useEditorTheme } from "../wikis/document/useEditorTheme";
import { WikiEditorWebView, type WikiEditorHandle } from "../wikis/document/WikiEditorWebView";

type ThreadCanvasScreenProps = StaticScreenProps<{
  readonly environmentId: string;
  readonly threadId: string;
  readonly itemId: string;
}>;

/** A canvas from a thread, to pan and pinch. It reads the stored call: nothing else holds it. */
export function ThreadCanvasScreen({ route }: ThreadCanvasScreenProps) {
  const navigation = useNavigation();
  const { environmentId, threadId, itemId } = route.params;
  const detail = useEnvironmentQuery(
    orchestrationEnvironment.turnItem({
      environmentId: EnvironmentId.make(environmentId),
      input: { threadId: ThreadId.make(threadId), itemId: TurnItemId.make(itemId) },
    }),
  );
  const item = detail.data?.item;
  const view = item?.type === "dynamic_tool" ? canvasViewFromToolItem(item) : undefined;
  const theme = useEditorTheme();
  const editor = useRef<WikiEditorHandle>(null);
  const camera = useRef<CanvasCamera | null>(null);

  const initialCommands = useCallback((): WikiEditorCommand[] => {
    const commands: WikiEditorCommand[] = [{ type: "theme", theme }];
    if (view !== undefined) {
      commands.push({ type: "showCanvas", data: view.data, camera: camera.current });
    }
    return commands;
  }, [theme, view]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- hands the page the board once the stored call loads, which can land after the page is ready
  useEffect(() => {
    if (view !== undefined) {
      editor.current?.send({ type: "showCanvas", data: view.data, camera: camera.current });
    }
  }, [view]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the theme crosses into the web view, outside React
  useEffect(() => {
    editor.current?.send({ type: "theme", theme });
  }, [theme]);

  const onEvent = (event: WikiEditorEvent) => {
    if (event.type === "camera") {
      camera.current = event.camera;
    } else if (event.type === "openUrl") {
      void tryOpenExternalUrl(event.href, "canvas");
    } else if (event.type === "openCode") {
      navigation.navigate("ThreadFile", {
        environmentId,
        threadId,
        path: fileRoutePathSegments(event.code.path),
        ...(event.code.lines === undefined ? {} : { line: String(event.code.lines[0]) }),
      });
    }
  };

  return (
    <View className="flex-1 bg-screen">
      <NativeStackScreenOptions options={{ title: view?.title ?? "Canvas" }} />
      <WikiEditorWebView ref={editor} onEvent={onEvent} initialCommands={initialCommands} fixed />
    </View>
  );
}
