import { canvasGroups, parseCanvas, type CanvasReview } from "@mercurian/wiki/canvas";
import {
  canvasFileKind,
  cardFileName,
  type CanvasCamera,
} from "@mercurian/wiki-editor/canvas-geometry";
import {
  cardFile,
  filesReadMessages,
  type WikiEditorCodeReference,
  type WikiEditorCommand,
  type WikiEditorEvent,
} from "@mercurian/wiki-editor/protocol";
import { StackActions, useNavigation } from "@react-navigation/native";
import { assetUrlStateFromResult } from "@t3tools/client-runtime/state/assets";
import {
  documentTitle,
  wikiDocumentName,
  wikiDocumentNames,
} from "@t3tools/client-runtime/wikiLogic";
import type { EnvironmentId, WikiChangeRequestId, WikiId } from "@t3tools/contracts";
import { mediaMimeTypeFromExtension } from "@t3tools/shared/filePreview";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ScrollView, View } from "react-native";

import { FilePreviewModal, type FilePreviewSource } from "../../components/FilePreviewModal";
import { LoadingScreen } from "../../components/LoadingScreen";
import { AppText as Text } from "../../components/ui/AppText";
import * as Dialog from "../../components/ui/Dialog";
import { EmptyState } from "../../components/ui/EmptyState";
import { Toolbar } from "../../components/ui/Toolbar";
import { tryOpenExternalUrl } from "../../lib/openExternalUrl";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { assetEnvironment } from "../../state/assets";
import { useProjects } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { usePreparedConnection } from "../../state/session";
import { useAtomQueryRunner } from "../../state/use-atom-query-runner";
import { wikiEnvironment } from "../../state/wiki";
import { fileRoutePathSegments } from "../files/filePath";
import { useEditorTheme } from "./document/useEditorTheme";
import { WikiBaseQueries, type WikiBaseAnswer } from "./document/WikiBaseQueries";
import { wikiDocumentSubtitle } from "./document/wikiDocument.logic";
import { WikiEditorWebView, type WikiEditorHandle } from "./document/WikiEditorWebView";
import { WikiCanvasChanges } from "./WikiCanvasChanges";
import type { WikiDocumentParams } from "./wikiRoutes";

const QUIET_READ = { reportFailure: false, reportDefect: false };
const QUIET_MINT = { ...QUIET_READ, refresh: true };
/** How long a file with no address stays that way before a card asks again. */
const NO_ADDRESS_MS = 60_000;
/** Invalid JSON shows as text, and a phone's text view doesn't need all of a huge file. */
const SOURCE_SHOWN_CHARS = 20_000;

/** What the app's viewers can open that a board can't play in place. */
function previewKind(path: string): FilePreviewSource["kind"] | null {
  switch (canvasFileKind(path)) {
    case "image":
      return "image";
    case "pdf":
      return "pdf";
    case "audio":
    case "video":
      return "document";
    default:
      return null;
  }
}

/**
 * A `.canvas` file on its own, read at the commit the wiki stands at and refreshed per commit with
 * the camera kept. The editor page draws the board; this screen reads for it: visible cards' files
 * in batches, their addresses, and bases. What a card opens goes on top, read from the same place.
 * With `review`, a change request's board with marks takes its place, its cards read at that head.
 */
export function WikiCanvasScreen({
  params,
  review,
}: {
  readonly params: WikiDocumentParams;
  readonly review?: { readonly board: CanvasReview; readonly commit: string };
}) {
  const navigation = useNavigation();
  const environmentId = params.environmentId as EnvironmentId;
  const wikiId = params.wikiId as WikiId;
  const file = params.name;
  const changeRequestId = params.changeRequestId as WikiChangeRequestId | undefined;
  const scope = changeRequestId === undefined ? {} : { changeRequestId };
  const title = documentTitle(cardFileName(file));

  const query = useEnvironmentQuery(
    wikiEnvironment.files({ environmentId, input: { wikiId, ...scope, paths: [file] } }),
  );
  const index = useEnvironmentQuery(
    wikiEnvironment.index({ environmentId, input: { wikiId, ...scope } }),
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

  const read = query.data?.files[0];
  const text = read?.text ?? null;
  const commit = review?.commit ?? query.data?.commit ?? null;
  const parsed = useMemo(() => (text === null ? null : parseCanvas(text)), [text]);
  const data = review?.board.data ?? (parsed?.ok ? parsed.data : null);
  const marks = review?.board.marks;
  const groups = useMemo(() => (data === null ? [] : canvasGroups(data)), [data]);
  const names = useMemo(
    () => (index.data === null ? null : wikiDocumentNames(index.data)),
    [index.data],
  );

  const editor = useRef<WikiEditorHandle>(null);
  const theme = useEditorTheme();
  const camera = useRef<CanvasCamera | null>(null);
  // Until the page first asks, what it would be sent is in `initialCommands`: a board is one
  // large message, so it isn't sent twice.
  const pageAsked = useRef(false);
  const shown = useRef({ theme, data, commit, names, marks });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a reloaded web view reads the latest board, commit and names
  useLayoutEffect(() => {
    shown.current = { theme, data, commit, names, marks };
  });
  const initialCommands = useCallback((): WikiEditorCommand[] => {
    pageAsked.current = true;
    const current = shown.current;
    return [
      { type: "theme", theme: current.theme },
      ...(current.names === null
        ? []
        : [{ type: "knownDocuments" as const, names: current.names }]),
      ...(current.data === null || current.commit === null
        ? []
        : [
            {
              type: "showCanvas" as const,
              data: current.data,
              revision: current.commit,
              camera: camera.current,
              marks: current.marks,
            },
          ]),
    ];
  }, []);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the theme crosses into the web view, outside React
  useEffect(() => {
    editor.current?.send({ type: "theme", theme });
  }, [theme]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the wiki's documents cross into the web view, outside React
  useEffect(() => {
    if (names !== null && pageAsked.current) {
      editor.current?.send({ type: "knownDocuments", names });
    }
  }, [names]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a new version of the board crosses into the web view, outside React
  useEffect(() => {
    const revision = shown.current.commit;
    if (data === null || revision === null || !pageAsked.current) return;
    const { marks } = shown.current;
    editor.current?.send({ type: "showCanvas", data, revision, camera: camera.current, marks });
  }, [data]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a new commit crosses into the web view, outside React
  useEffect(() => {
    if (commit !== null && pageAsked.current) {
      editor.current?.send({ type: "canvasRevision", revision: commit });
    }
  }, [commit]);

  const runFiles = useAtomQueryRunner(wikiEnvironment.files, QUIET_READ);
  const runCode = useAtomQueryRunner(wikiEnvironment.codeStatus, QUIET_READ);
  const mintUrl = useAtomQueryRunner(assetEnvironment.createUrl, QUIET_MINT);
  const connection = usePreparedConnection(environmentId);
  const httpBaseUrl = connection._tag === "Some" ? connection.value.httpBaseUrl : null;

  const answerFiles = async (requestId: number, paths: ReadonlyArray<string>) => {
    const revision = shown.current.commit;
    const result = await runFiles({
      environmentId,
      input: { wikiId, ...(revision === null ? scope : { commit: revision }), paths: [...paths] },
    });
    const files =
      result._tag === "Success"
        ? result.value.files.map((each) =>
            cardFile(each.file, { exists: each.exists, text: each.text }),
          )
        : [];
    for (const message of filesReadMessages(requestId, files)) editor.current?.send(message);
  };
  const answerCodeStatus = async (
    requestId: number,
    references: ReadonlyArray<WikiEditorCodeReference>,
  ) => {
    const result = await runCode({ environmentId, input: { references: [...references] } });
    const statuses = result._tag === "Success" ? result.value.statuses : [];
    editor.current?.send({ type: "codeStatusRead", requestId, statuses });
  };
  const answerAsset = async (path: string) => {
    const revision = shown.current.commit;
    if (revision === null) return;
    const result = await mintUrl({
      environmentId,
      input: { resource: { _tag: "wiki-file", wikiId, commit: revision, path } },
    });
    const state = assetUrlStateFromResult(result, httpBaseUrl);
    editor.current?.send({
      type: "assetRead",
      path,
      revision,
      url: state._tag === "Success" ? state.url : null,
      expiresAt: state._tag === "Success" ? state.expiresAt : Date.now() + NO_ADDRESS_MS,
    });
  };

  const [baseSources, setBaseSources] = useState<ReadonlyArray<string>>([]);
  const baseAnswers = useRef(new Map<string, WikiBaseAnswer>());
  const onBaseAnswer = useCallback((source: string, answer: WikiBaseAnswer) => {
    baseAnswers.current.set(source, answer);
    editor.current?.send({ type: "baseResult", source, ...answer });
  }, []);

  const projects = useProjects();
  const [preview, setPreview] = useState<FilePreviewSource | null>(null);
  const openFile = (path: string) => {
    const kind = previewKind(path);
    const revision = shown.current.commit;
    if (kind === null || revision === null) {
      Dialog.alert(`${cardFileName(path)} doesn't open here`, "Open it on a computer.");
      return;
    }
    const mimeType = mediaMimeTypeFromExtension(path.slice(path.lastIndexOf(".")));
    setPreview({
      kind,
      ...(mimeType === null ? {} : { mimeType }),
      environmentId,
      resource: { _tag: "wiki-file", wikiId, commit: revision, path },
      name: cardFileName(path),
    });
  };
  const openLink = (name: string) => {
    // A bare name is a note's. Anything with a file's extension that's no document opens as a file.
    const document = canvasFileKind(name) === "other" ? name : wikiDocumentName(name);
    if (document === null) {
      openFile(name);
      return;
    }
    navigation.dispatch(
      StackActions.push("WikiDocument", {
        environmentId: params.environmentId,
        wikiId: params.wikiId,
        name: document,
        ...scope,
      }),
    );
  };

  const onEvent = (event: WikiEditorEvent) => {
    switch (event.type) {
      case "readFiles":
        void answerFiles(event.requestId, event.paths);
        return;
      case "readCodeStatus":
        void answerCodeStatus(event.requestId, event.references);
        return;
      case "readAsset":
        void answerAsset(event.path);
        return;
      case "queryBase": {
        const known = baseAnswers.current.get(event.source);
        if (known) editor.current?.send({ type: "baseResult", source: event.source, ...known });
        setBaseSources((sources) =>
          sources.includes(event.source) ? sources : [...sources, event.source],
        );
        return;
      }
      case "camera":
        camera.current = event.camera;
        return;
      case "openNote":
        openLink(event.name);
        return;
      case "openFile":
        openFile(event.path);
        return;
      case "openUrl":
        void tryOpenExternalUrl(event.href, "canvas");
        return;
      case "openCode": {
        const { code, url } = event;
        const project =
          code.repository === undefined
            ? undefined
            : projects.find(
                (each) =>
                  each.environmentId === environmentId &&
                  each.repositoryIdentity?.canonicalKey === code.repository,
              );
        if (project === undefined) {
          if (url !== "") void tryOpenExternalUrl(url, "canvas");
          return;
        }
        navigation.dispatch(
          StackActions.push("RepositoryFile", {
            environmentId: params.environmentId,
            cwd: project.workspaceRoot,
            projectName: project.title,
            path: fileRoutePathSegments(code.path),
            ...(code.lines === undefined ? {} : { line: String(code.lines[0]) }),
          }),
        );
        return;
      }
      case "error":
        console.warn("The wiki editor page failed:", event.message);
        return;
      default:
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
    review === undefined ? "Canvas · read only" : "Canvas · changes",
  ].join(" · ");
  const header = (
    <NativeStackScreenOptions
      options={{ title, unstable_headerSubtitle: subtitle }}
      optionsVersion={`${subtitle}|${groups.map((group) => group.id).join(",")}`}
    />
  );

  const body = () => {
    if (review !== undefined) {
      return (
        <>
          <View className="flex-1">
            <WikiEditorWebView
              ref={editor}
              onEvent={onEvent}
              initialCommands={initialCommands}
              fixed
            />
          </View>
          <WikiCanvasChanges
            review={review.board}
            onPick={(id) => editor.current?.send({ type: "focusCard", id, select: true })}
          />
        </>
      );
    }
    if (query.data === null) {
      return query.error !== null ? (
        <EmptyState title={`Couldn't open ${title}`} detail={query.error} />
      ) : (
        <LoadingScreen message="Opening the canvas…" />
      );
    }
    if (read === undefined || !read.exists) {
      return (
        <EmptyState
          title={`No canvas is called ${title} yet`}
          detail="Start one in a change request on a computer."
        />
      );
    }
    if (parsed === null) {
      return (
        <EmptyState title={`${title} is too large to show here`} detail="Open it on a computer." />
      );
    }
    if (!parsed.ok) {
      return (
        <ScrollView contentContainerClassName="gap-3 p-4">
          <Text className="text-sm text-foreground-muted">
            {`This canvas isn't valid JSON: ${parsed.error} Fix the file and it opens again; it is left as it is until then.`}
          </Text>
          <Text selectable className="font-mono text-xs text-foreground">
            {text?.slice(0, SOURCE_SHOWN_CHARS)}
          </Text>
        </ScrollView>
      );
    }
    return (
      <WikiEditorWebView ref={editor} onEvent={onEvent} initialCommands={initialCommands} fixed />
    );
  };

  return (
    <View className="flex-1 bg-screen">
      {header}
      {groups.length > 0 ? (
        // Direct children only: the toolbar reads its items by component, not through fragments.
        <Toolbar placement="right">
          <Toolbar.Menu
            icon="rectangle.3.group"
            accessibilityLabel="Jump to group"
            title="Jump to group"
          >
            {groups.map((group) => (
              <Toolbar.MenuAction
                key={group.id}
                onPress={() => editor.current?.send({ type: "focusCard", id: group.id })}
              >
                <Toolbar.Label>{group.label}</Toolbar.Label>
              </Toolbar.MenuAction>
            ))}
          </Toolbar.Menu>
        </Toolbar>
      ) : null}
      {body()}
      <WikiBaseQueries
        sources={baseSources}
        environmentId={environmentId}
        wikiId={wikiId}
        changeRequestId={changeRequestId}
        note={file}
        onAnswer={onBaseAnswer}
      />
      <FilePreviewModal source={preview} onRequestClose={() => setPreview(null)} />
    </View>
  );
}
