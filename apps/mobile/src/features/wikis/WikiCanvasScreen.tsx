/* oxlint-disable t3code/no-untranslated-copy -- Astrolabe-only copy, shipped in English. */
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import {
  canvasGroups,
  parseCanvas,
  type CanvasData,
  type CanvasMarks,
} from "@mercurian/wiki/canvas";
import { isWikiDocument } from "@mercurian/wiki/resolve-link";
import type { CanvasHandEdit } from "@mercurian/wiki/canvas-edits";
import type { CanvasBoardSettings } from "@mercurian/wiki-editor/canvas-board";
import {
  canvasFileKind,
  cardFileName,
  type CanvasCamera,
} from "@mercurian/wiki-editor/canvas-geometry";
import {
  cardFile,
  filesReadMessages,
  type WikiEditorCanvasAnswer,
  type WikiEditorCanvasAsk,
  type WikiEditorCodeReference,
  type WikiEditorCommand,
  type WikiEditorEvent,
} from "@mercurian/wiki-editor/protocol";
import { StackActions, useNavigation } from "@react-navigation/native";
import { assetUrlStateFromResult } from "@t3tools/client-runtime/state/assets";
import {
  changeRequestCanvasReview,
  documentTitle,
  exactWikiPath,
  filesHoldDocument,
  isDocumentFile,
  isSettledChangeRequest,
  wikiDocumentFiles,
  wikiDocumentScope,
  wikiDraft,
  NO_NOTE_FROM_RELATIVE_LINK,
  wikiTerms,
} from "@t3tools/client-runtime/wikiLogic";
import type { WikiChangeRequestId } from "@t3tools/contracts";
import { mediaMimeTypeFromExtension } from "@t3tools/shared/filePreview";
import { DEFAULT_WIKI_CANVAS_SETTINGS } from "@t3tools/contracts";
import { typedNoteFile } from "@mercurian/wiki/placement";
import { use, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ScrollView, View } from "react-native";

import { FilePreviewModal, type FilePreviewSource } from "../../components/ui/FilePreviewModal";
import { LoadingScreen } from "../../components/LoadingScreen";
import { AppText as Text } from "../../components/ui/AppText";
import * as Dialog from "../../components/ui/Dialog";
import { EmptyState } from "../../components/ui/EmptyState";
import { Toolbar } from "../../components/ui/Toolbar";
import { tryOpenExternalUrl } from "../../lib/openExternalUrl";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { assetEnvironment } from "../../state/assets";
import { useProjects } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import { projectEnvironment } from "../../state/projects";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { usePreparedConnection } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { useAtomQueryRunner } from "../../state/use-atom-query-runner";
import { wikiEnvironment } from "../../state/wiki";
import { fileRoutePathSegments } from "../files/filePath";
import { useEditorTheme } from "./document/useEditorTheme";
import {
  useWikiAutosave,
  useWikiAutosaveCommand,
  useWikiDiskCommands,
  wikiSaveLabel,
} from "./document/useWikiAutosave";
import { openProjectLink } from "./document/openProjectLink";
import { useProjectLinkRoots, type ProjectDocument } from "./document/useProjectDocument";
import { WikiBaseQueries, type WikiBaseAnswer } from "./document/WikiBaseQueries";
import { projectLinkOpens, wikiDocumentSubtitle } from "./document/wikiDocument.logic";
import { WikiBelowHeader } from "./document/WikiBelowHeader";
import { WikiNotice } from "./document/WikiNotice";
import { WikiDraftBar } from "./document/WikiDraftBar";
import { WikiEditorWebView, type WikiEditorHandle } from "./document/WikiEditorWebView";
import type { WikiDocumentParams } from "./wikiRoutes";

const QUIET_READ = { reportFailure: false, reportDefect: false };
const QUIET_MINT = { ...QUIET_READ, refresh: true };
/** How long a file with no address stays that way before a card asks again. */
const NO_ADDRESS_MS = 60_000;
/** Invalid JSON shows as text, and a phone's text view doesn't need all of a huge file. */
const SOURCE_SHOWN_CHARS = 20_000;

/** A board as the page takes it. */
function canvasCommand(
  camera: CanvasCamera | null,
  current: {
    readonly data: CanvasData;
    readonly commit: string;
    readonly marks: CanvasMarks | undefined;
    readonly document: unknown;
    readonly readOnly: boolean;
    readonly settings: CanvasBoardSettings;
  },
): WikiEditorCommand {
  return {
    type: "showCanvas",
    data: current.data,
    revision: current.commit,
    camera,
    marks: current.marks,
    readOnly: current.readOnly,
    settings: current.settings,
    ...(current.document === undefined ? {} : { document: current.document }),
  };
}

/** A board's own read-only toggle, for as long as the app runs: the page has nowhere to keep it. */
const readOnlyBoards = new Set<string>();

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
 * A `.canvas` file on its own, read at the commit its folder stands at and refreshed per commit
 * with the camera kept, or as it stands on disk when that is where its edits go. The editor page
 * draws the board; this screen reads for it. A canvas read in a change request marks what that
 * changes.
 */
export function WikiCanvasScreen({
  params,
  doc,
}: {
  readonly params: WikiDocumentParams;
  readonly doc: ProjectDocument;
}) {
  const navigation = useNavigation();
  const registry = use(RegistryContext);
  const { environmentId, wikiId, routeChangeRequestId, disk, placement } = doc;
  const file = params.name;
  const onDisk = disk === null ? {} : { checkout: disk };
  const changeRequests = useEnvironmentQuery(
    disk === null ? wikiEnvironment.changeRequests({ environmentId, input: { wikiId } }) : null,
  );
  const all = changeRequests.data?.changeRequests;
  const draft = wikiDraft(all);
  const changeRequestId = wikiDocumentScope({
    tabChangeRequestId: routeChangeRequestId,
    draft,
    file,
  });
  const scope = changeRequestId === undefined ? {} : { changeRequestId };
  const title = documentTitle(file);

  const fromLine = useEnvironmentQuery(
    disk === null
      ? wikiEnvironment.files({
          environmentId,
          input: { wikiId, ...scope, paths: [exactWikiPath(file)] },
        })
      : null,
  );
  const diskRead = disk === null ? null : { cwd: disk, relativePath: file, allowMissing: true };
  const fromDisk = useEnvironmentQuery(
    diskRead === null ? null : projectEnvironment.readFile({ environmentId, input: diskRead }),
  );
  const index = useEnvironmentQuery(
    wikiEnvironment.index({ environmentId, input: { wikiId, ...scope, ...onDisk } }),
  );
  const linkRoots = useProjectLinkRoots({
    environmentId,
    projectId: doc.projectId,
    roots: doc.roots,
    rootKey: doc.rootKey,
    ownIndex: index.data,
    disk: disk !== null,
  });
  // On disk the folder's index says what it stands at; the board reads the file as it is.
  const diskCommit = index.data?.commit ?? null;
  const diskData = useMemo(
    () =>
      fromDisk.data === null || diskCommit === null
        ? null
        : {
            commit: diskCommit,
            files: [
              {
                exists: fromDisk.data.exists !== false,
                text: fromDisk.data.truncated ? null : fromDisk.data.contents,
              },
            ],
          },
    [fromDisk.data, diskCommit],
  );
  const query = disk === null ? fromLine : { error: fromDisk.error, data: diskData };
  const wikis = useEnvironmentQuery(wikiEnvironment.list({ environmentId, input: {} }));
  const wiki = wikis.data?.wikis.find((entry) => entry.wikiId === wikiId) ?? null;
  const viewing =
    all?.find((changeRequest) => changeRequest.changeRequestId === changeRequestId) ?? null;

  // The first edit moves the screen onto the draft: a new read, which mustn't take the board down.
  const [files, setFiles] = useState(query.data);
  if (query.data !== null && query.data !== files) setFiles(query.data);
  const read = files?.files[0];
  const text = read?.text ?? null;
  const commit = files?.commit ?? null;
  const parsed = useMemo(() => (text === null ? null : parseCanvas(text)), [text]);
  // Read in a change request, it marks what that changes.
  const detail = useEnvironmentQuery(
    changeRequestId === undefined
      ? null
      : wikiEnvironment.changeRequest({ environmentId, input: { wikiId, changeRequestId } }),
  );
  const changes = detail.data;
  const board = useMemo(
    () => changeRequestCanvasReview(changes, file, text),
    [changes, file, text],
  );
  const data = board?.data ?? (parsed?.ok ? parsed.data : null);
  // Your own draft's cards all read as changed, which says nothing a person doesn't know.
  const marks = changes?.changeRequest.draft === true ? undefined : board?.marks;
  const canDraft = useAtomValue(wikiEnvironment.autosave.permissionAtom(environmentId));
  const canWriteDisk = useAtomValue(wikiEnvironment.transform.permissionAtom(environmentId));
  const canWrite = disk === null ? canDraft : canWriteDisk;
  const editable =
    canWrite &&
    (routeChangeRequestId === undefined || changes !== null) &&
    !isSettledChangeRequest(changes?.changeRequest);
  const document = editable && parsed?.ok === true ? parsed.document : undefined;
  const boardKey = `${wikiId}:${file}`;
  const [readOnly, setReadOnly] = useState(() => readOnlyBoards.has(boardKey));
  const { environments } = useEnvironments();
  const settings =
    environments.find((each) => each.environmentId === environmentId)?.serverConfig?.settings
      .wikiCanvas ?? DEFAULT_WIKI_CANVAS_SETTINGS;
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, {
    label: "canvas settings update",
    reportFailure: true,
  });
  const groups = useMemo(() => (data === null ? [] : canvasGroups(data)), [data]);
  const documents = useMemo(
    () => (index.data === null ? null : wikiDocumentFiles(index.data)),
    [index.data],
  );

  const editor = useRef<WikiEditorHandle>(null);
  const theme = useEditorTheme();
  const camera = useRef<CanvasCamera | null>(null);
  // Until the page first asks, what it would be sent is in `initialCommands`: a board is one
  // large message, so it isn't sent twice.
  const pageAsked = useRef(false);
  const shown = useRef({
    theme,
    file,
    data,
    commit,
    documents,
    marks,
    document,
    readOnly,
    settings,
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a reloaded web view reads the latest board, commit and documents
  useLayoutEffect(() => {
    shown.current = { theme, file, data, commit, documents, marks, document, readOnly, settings };
  });
  const initialCommands = useCallback((): WikiEditorCommand[] => {
    pageAsked.current = true;
    const current = shown.current;
    return [
      { type: "theme", theme: current.theme },
      ...(current.documents === null
        ? []
        : [{ type: "knownDocuments" as const, files: current.documents, from: current.file }]),
      ...(current.data === null || current.commit === null
        ? []
        : [
            canvasCommand(camera.current, {
              ...current,
              data: current.data,
              commit: current.commit,
            }),
          ]),
    ];
  }, []);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the theme crosses into the web view, outside React
  useEffect(() => {
    editor.current?.send({ type: "theme", theme });
  }, [theme]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the wiki's documents cross into the web view, outside React
  useEffect(() => {
    if (documents !== null && pageAsked.current) {
      editor.current?.send({ type: "knownDocuments", files: documents, from: file });
    }
  }, [documents, file]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a new version of the board crosses into the web view, outside React
  useEffect(() => {
    const { commit, marks } = shown.current;
    if (data === null || commit === null || !pageAsked.current) return;
    editor.current?.send(
      canvasCommand(camera.current, { data, commit, marks, document, readOnly, settings }),
    );
  }, [data, document, readOnly, settings]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a new commit crosses into the web view, outside React
  useEffect(() => {
    if (commit !== null && pageAsked.current) {
      editor.current?.send({ type: "canvasRevision", revision: commit });
    }
  }, [commit]);

  const runFiles = useAtomQueryRunner(wikiEnvironment.files, QUIET_READ);
  const runRead = useAtomQueryRunner(projectEnvironment.readFile, QUIET_MINT);
  /** A document as it stands in the folder on disk; null where it can't be read as text. */
  const readOnDisk = async (folder: string, path: string) => {
    const result = await runRead({
      environmentId,
      input: { cwd: folder, relativePath: path, allowMissing: true },
    });
    if (result._tag !== "Success") return { file: path, exists: false, text: null };
    const read = result.value;
    return {
      file: path,
      exists: read.exists !== false,
      text: read.exists === false || read.truncated ? null : read.contents,
    };
  };
  // The first note of a new draft reads back before the list of change requests has it.
  const noteDraft = useRef<WikiChangeRequestId | undefined>(undefined);
  const runCode = useAtomQueryRunner(wikiEnvironment.codeStatus, QUIET_READ);
  const mintUrl = useAtomQueryRunner(assetEnvironment.createUrl, QUIET_MINT);
  const connection = usePreparedConnection(environmentId);
  const httpBaseUrl = connection._tag === "Some" ? connection.value.httpBaseUrl : null;

  const answerFiles = async (requestId: number, paths: ReadonlyArray<string>) => {
    if (disk !== null) {
      // Documents as they stand on disk; any other file as the folder's commit holds it.
      const documents = paths.filter((path) => isWikiDocument(path));
      const others = paths.filter((path) => !isWikiDocument(path));
      const [read, held] = await Promise.all([
        Promise.all(documents.map((path) => readOnDisk(disk, path))),
        others.length === 0
          ? null
          : runFiles({ environmentId, input: { wikiId, from: file, paths: others } }),
      ]);
      const byPath = new Map<string, { file: string; exists: boolean; text: string | null }>(
        read.map((each) => [each.file, each]),
      );
      if (held?._tag === "Success") {
        held.value.files.forEach((each, position) => byPath.set(others[position]!, each));
      }
      const cards = paths.flatMap((path) => {
        const each = byPath.get(path);
        return each === undefined ? [] : [cardFile(each.file, each)];
      });
      for (const message of filesReadMessages(requestId, cards)) editor.current?.send(message);
      return;
    }
    const cardsFrom = draft?.changeRequestId ?? noteDraft.current;
    const revision = shown.current.commit;
    const result = await runFiles({
      environmentId,
      input: {
        wikiId,
        ...(revision === null ? scope : { commit: revision }),
        from: file,
        paths: [...paths],
      },
    });
    // A note made from a missing card sits in the draft, not at the board's commit.
    const missing =
      result._tag === "Success" && cardsFrom !== undefined
        ? result.value.files.filter((each) => !each.exists).map((each) => each.file)
        : [];
    const drafted =
      missing.length === 0 || cardsFrom === undefined
        ? null
        : await runFiles({
            environmentId,
            input: { wikiId, changeRequestId: cardsFrom, from: file, paths: missing },
          });
    const inDraft = new Map(
      drafted?._tag === "Success" ? drafted.value.files.map((each) => [each.file, each]) : [],
    );
    const files =
      result._tag === "Success"
        ? result.value.files.map((each) => {
            const read = inDraft.get(each.file) ?? each;
            return cardFile(read.file, { exists: read.exists, text: read.text });
          })
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
      input: { resource: { _tag: "wiki-file", wikiId, commit: revision, path, from: file } },
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

  const send = useWikiAutosaveCommand();
  const writeDisk = useWikiDiskCommands();
  /** Lands a transform: on disk in the folder, else in the change request or the draft. */
  const land = (
    document: string,
    transform: Parameters<typeof writeDisk.transform>[0]["input"]["transform"],
  ) =>
    disk !== null
      ? writeDisk.transform({
          environmentId,
          input: { wikiId, checkout: disk, message: `Edit ${documentTitle(document)}`, transform },
        })
      : send({
          environmentId,
          input: { wikiId, ...landing, document, write: { kind: "transform", transform } },
        });
  // The page's latest list of everything unlanded: each `canvasEdited` replaces the last.
  const unlanded = useRef<{
    readonly edits: ReadonlyArray<CanvasHandEdit>;
    readonly through: number;
  } | null>(null);
  const landing =
    routeChangeRequestId === undefined ? {} : { changeRequestId: routeChangeRequestId };
  const { autosave, status } = useWikiAutosave({
    subject: title,
    save: async () => {
      const taken = unlanded.current;
      if (taken === null) return { ok: true };
      const outcome = await land(file, { kind: "canvas", file, edits: [...taken.edits] });
      if (!outcome.ok) return outcome;
      if (unlanded.current === taken) unlanded.current = null;
      editor.current?.send({
        type: "canvasLanded",
        through: taken.through,
        commit: "commit" in outcome.value ? outcome.value.commit : null,
      });
      if (diskRead !== null) {
        registry.refresh(projectEnvironment.readFile({ environmentId, input: diskRead }));
      }
      return { ok: true };
    },
  });
  const runFileList = useAtomQueryRunner(wikiEnvironment.fileList, QUIET_READ);
  const answer = async (ask: WikiEditorCanvasAsk): Promise<WikiEditorCanvasAnswer> => {
    switch (ask.kind) {
      case "list-files": {
        const result = await runFileList({ environmentId, input: { wikiId, ...scope } });
        return {
          kind: "files",
          files: result._tag === "Success" ? result.value.files.map((each) => each.file) : [],
        };
      }
      case "read-file": {
        if (disk !== null) {
          return { kind: "value", value: (await readOnDisk(disk, ask.path)).text };
        }
        const revision = shown.current.commit;
        const result = await runFiles({
          environmentId,
          input: {
            wikiId,
            ...(revision === null ? scope : { commit: revision }),
            paths: [ask.path],
          },
        });
        return {
          kind: "value",
          value: result._tag === "Success" ? (result.value.files[0]?.text ?? null) : null,
        };
      }
      case "asset-url": {
        const revision = shown.current.commit;
        if (revision === null) return { kind: "value", value: null };
        const result = await mintUrl({
          environmentId,
          input: {
            resource: { _tag: "wiki-file", wikiId, commit: revision, path: ask.path, from: file },
          },
        });
        const state = assetUrlStateFromResult(result, httpBaseUrl);
        return { kind: "value", value: state._tag === "Success" ? state.url : null };
      }
      case "place-note":
        return {
          kind: "value",
          value: typedNoteFile(ask.name, file, placement, documents ?? []),
        };
      case "write-note": {
        const { file: note, text, readAt } = ask;
        if (disk !== null) {
          const written = await writeDisk.writeText({
            environmentId,
            input: { cwd: disk, relativePath: note, contents: text },
          });
          return { kind: "failure", message: written.ok ? null : written.message };
        }
        const outcome = await send({
          environmentId,
          input: {
            wikiId,
            ...landing,
            document: note,
            write: {
              kind: "text",
              file: note,
              text,
              ...(readAt === undefined ? {} : { readAt }),
            },
          },
        });
        if (outcome.ok) noteDraft.current = outcome.value.changeRequest?.changeRequestId;
        return { kind: "failure", message: outcome.ok ? null : outcome.message };
      }
      case "rename": {
        const outcome = await land(ask.file, {
          kind: "rename",
          from: ask.file.replace(/\.md$/i, ""),
          to: ask.to,
        });
        return { kind: "failure", message: outcome.ok ? null : outcome.message };
      }
    }
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
      resource: { _tag: "wiki-file", wikiId, commit: revision, path, from: file },
      name: cardFileName(path),
    });
  };
  const openLink = (name: string, from: string = file) => {
    // A bare name is a note's. Anything with a file's extension that's no document opens as a file.
    const media = !["other", "note", "canvas", "base"].includes(canvasFileKind(name));
    const opens = projectLinkOpens({
      roots: linkRoots,
      root: doc.rootKey,
      target: name,
      from,
      placement,
    });
    if (opens.kind === "none") {
      Dialog.alert("No note made", NO_NOTE_FROM_RELATIVE_LINK);
      return;
    }
    if (media || (opens.kind === "open" && !isDocumentFile(opens.file))) {
      openFile(name);
      return;
    }
    openProjectLink({
      roots: linkRoots,
      params,
      target: name,
      from,
      placement,
      open: (next) => navigation.dispatch(StackActions.push("ProjectDocument", next)),
    });
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
      case "canvasEdited":
        unlanded.current = event;
        autosave.edited();
        return;
      case "canvasAsk":
        void answer(event.ask).then((result) =>
          editor.current?.send({
            type: "canvasAnswer",
            requestId: event.requestId,
            answer: result,
          }),
        );
        return;
      case "canvasSettings":
        void updateSettings({
          environmentId,
          input: { patch: { wikiCanvas: { ...settings, ...event.settings } } },
        });
        return;
      case "canvasReadOnly":
        if (event.on) readOnlyBoards.add(boardKey);
        else readOnlyBoards.delete(boardKey);
        setReadOnly(event.on);
        return;
      case "openNote":
        openLink(event.name, event.from);
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

  const saveLabel = wikiSaveLabel(status);
  const subtitle = [
    wikiDocumentSubtitle({
      wikiName: doc.root?.name ?? wiki?.name ?? null,
      file: file,
      changeRequest: viewing,
      readsChangeRequest: changeRequestId !== undefined,
      onDisk: disk !== null,
      noun: wikiTerms(wiki).singular,
      agentWorking: false,
    }),
    editable && !readOnly
      ? `Canvas${saveLabel === null ? "" : ` · ${saveLabel}`}`
      : "Canvas · read only",
  ].join(" · ");
  const header = (
    <NativeStackScreenOptions
      options={{ title, unstable_headerSubtitle: subtitle }}
      optionsVersion={`${subtitle}|${groups.map((group) => group.id).join(",")}`}
    />
  );

  const body = () => {
    if (files === null) {
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
          detail={`Start one in a ${wikiTerms(wiki).singular} on a computer.`}
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
            accessibilityLabel="Jump to section"
            title="Jump to section"
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
      <WikiBelowHeader>
        {draft !== null && (routeChangeRequestId === undefined || viewing?.draft) ? (
          <WikiDraftBar
            environmentId={environmentId}
            draft={draft}
            onLanded={(id, files) => {
              // The document on screen follows where its edits went.
              if (filesHoldDocument(files, file)) navigation.setParams({ changeRequestId: id });
            }}
          />
        ) : null}
        {status.kind === "failed" ? (
          <WikiNotice
            text={`Your changes aren't saved. ${status.message}${status.retrying ? " Still trying." : ""}`}
            action="Try again"
            onAction={autosave.retry}
          />
        ) : null}
      </WikiBelowHeader>
      {body()}
      <WikiBaseQueries
        sources={baseSources}
        environmentId={environmentId}
        wikiId={wikiId}
        changeRequestId={changeRequestId}
        checkout={disk}
        note={file}
        onAnswer={onBaseAnswer}
      />
      <FilePreviewModal source={preview} onRequestClose={() => setPreview(null)} />
    </View>
  );
}
