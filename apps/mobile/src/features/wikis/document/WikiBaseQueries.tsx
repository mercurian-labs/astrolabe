import {
  embeddedBase,
  type WikiEditorBaseResult,
  type WikiEditorEmbeddedFile,
  type WikiEditorResolvedLink,
} from "@mercurian/wiki-editor/protocol";
import { exactWikiPath, resolveWikiLink, wikiLinkFile } from "@t3tools/client-runtime/wikiLogic";
import type {
  EnvironmentId,
  WikiChangeRequestId,
  WikiId,
  WikiIndexResult,
} from "@t3tools/contracts";
import { useEffect } from "react";

import { useEnvironmentQuery } from "../../../state/query";
import { wikiEnvironment } from "../../../state/wiki";

const NO_FILES: ReadonlyArray<string> = [];

/** What the editor page is told about one ```base block: its view, or why it can't show. */
export interface WikiBaseAnswer {
  readonly result: WikiEditorBaseResult | null;
  readonly error: string | null;
}

interface Scope {
  readonly environmentId: EnvironmentId;
  readonly wikiId: WikiId;
  readonly changeRequestId: WikiChangeRequestId | undefined;
  /** The note the blocks sit in, which `this` names inside them. */
  readonly note: string;
  readonly onAnswer: (source: string, answer: WikiBaseAnswer) => void;
}

function WikiBaseQuery({ source, ...scope }: Scope & { readonly source: string }) {
  const { environmentId, wikiId, changeRequestId, note, onAnswer } = scope;
  // An embedded base runs by its file and view; a block, by its YAML in the note.
  const embedded = embeddedBase(source);
  const { data, error } = useEnvironmentQuery(
    wikiEnvironment.query({
      environmentId,
      input: {
        wikiId,
        ...(changeRequestId === undefined ? {} : { changeRequestId }),
        ...(embedded === null
          ? { source, note }
          : { base: embedded.base, note, ...(embedded.view ? { view: embedded.view } : {}) }),
      },
    }),
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- each answer crosses into the editor's web view, outside React
  useEffect(() => {
    if (data !== null) onAnswer(source, { result: data, error: null });
    else if (error !== null) onAnswer(source, { result: null, error });
  }, [data, error, source, onAnswer]);
  return null;
}

/**
 * Runs the ```base blocks the editor page shows, one live query each, and hands every answer to
 * `onAnswer`: a block's view follows the wiki as it changes. Renders nothing.
 */
export function WikiBaseQueries({
  sources,
  ...scope
}: Scope & { readonly sources: ReadonlyArray<string> }) {
  return sources.map((source) => <WikiBaseQuery key={source} source={source} {...scope} />);
}

function WikiNoteRead({
  name,
  environmentId,
  wikiId,
  changeRequestId,
  index,
  from,
  onRead,
}: Omit<WikiNoteReadsProps, "names"> & { readonly name: string }) {
  const scope = changeRequestId === undefined ? {} : { changeRequestId };
  const file = wikiLinkFile(index, name, from);
  const { data } = useEnvironmentQuery(
    wikiEnvironment.note({ environmentId, input: { wikiId, name: exactWikiPath(file), ...scope } }),
  );
  const { file: landed, others } =
    index === null ? { file: null, others: NO_FILES } : resolveWikiLink(index, name, from);
  const otherFiles = others.join("\0");
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- each read crosses into the editor's web view, outside React
  useEffect(() => {
    const link = { file: landed, others: otherFiles === "" ? NO_FILES : otherFiles.split("\0") };
    if (data !== null) onRead(name, data.exists ? data.source : null, link);
  }, [data, name, landed, otherFiles, onRead]);
  return null;
}

export interface WikiNoteReadsProps {
  readonly names: ReadonlyArray<string>;
  readonly environmentId: EnvironmentId;
  readonly wikiId: WikiId;
  readonly changeRequestId: WikiChangeRequestId | undefined;
  /** What the links search, once it's here. */
  readonly index: WikiIndexResult | null;
  /** The file the links are written in. */
  readonly from: string;
  readonly onRead: (name: string, source: string | null, link: WikiEditorResolvedLink) => void;
}

/** Reads the notes the editor page's link previews show, each live. Renders nothing. */
export function WikiNoteReads({ names, ...scope }: WikiNoteReadsProps) {
  return names.map((name) => <WikiNoteRead key={name} name={name} {...scope} />);
}

function WikiFileRead({
  path,
  environmentId,
  wikiId,
  changeRequestId,
  from,
  onRead,
}: Omit<WikiFileReadsProps, "paths"> & { readonly path: string }) {
  const scope = changeRequestId === undefined ? {} : { changeRequestId };
  const { data } = useEnvironmentQuery(
    wikiEnvironment.files({ environmentId, input: { wikiId, ...scope, from, paths: [path] } }),
  );
  const read = data?.files[0];
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- each read crosses into the editor's web view, outside React
  useEffect(() => {
    if (read) onRead(path, { exists: read.exists, file: read.file, text: read.text });
  }, [read, path, onRead]);
  return null;
}

interface WikiFileReadsProps {
  readonly paths: ReadonlyArray<string>;
  readonly environmentId: EnvironmentId;
  readonly wikiId: WikiId;
  readonly changeRequestId: WikiChangeRequestId | undefined;
  /** The file the embeds are written in. */
  readonly from: string;
  readonly onRead: (path: string, read: WikiEditorEmbeddedFile) => void;
}

/** Reads the canvases the editor page's note embeds, each live. Renders nothing. */
export function WikiFileReads({ paths, ...scope }: WikiFileReadsProps) {
  return paths.map((path) => <WikiFileRead key={path} path={path} {...scope} />);
}
