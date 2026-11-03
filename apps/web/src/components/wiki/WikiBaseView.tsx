import "@mercurian/wiki-editor/base-layout.css";

import { useAtomValue } from "@effect/atom-react";
import { BaseLayout, type BaseLayoutHost } from "@mercurian/wiki-editor/base-layout";
import type {
  EnvironmentId,
  WikiBaseCell,
  WikiBaseEdit,
  WikiBaseFilter,
  WikiChangeRequest,
  WikiChangeRequestId,
  WikiId,
  WikiQueryResult,
} from "@t3tools/contracts";
import { useBlocker } from "@tanstack/react-router";
import DOMPurify from "dompurify";
import type { LucideIcon } from "lucide-react";
import { TriangleAlertIcon } from "lucide-react";
import { lazy, Suspense, useEffect, useId, useState } from "react";

import { useAssetUrlState } from "~/assets/assetUrls";
import { useTheme } from "~/hooks/useTheme";
import { ensureLocalApi } from "~/localApi";
import { TabHeader } from "~/panes/TabHeader";
import { useEnvironmentQuery } from "~/state/query";
import { wikiEnvironment } from "~/state/wiki";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Spinner } from "../ui/spinner";
import { describeWikiFailure, wikiDocumentName } from "./wiki.logic";
import {
  isEditableNote,
  isNoteProperty,
  newNoteProperties,
  withEdit,
} from "@t3tools/client-runtime/wikiBaseEdits";
import { ColumnMenu, WikiBaseToolbar } from "./WikiBaseToolbar";
import { useWikiCommand } from "./wikiEnvironment";
import { SaveToChangeRequestDialog, type SaveTarget } from "./WikiSaveDialog";

const WikiBaseMap = lazy(() => import("./WikiBaseMap"));

/** A base by name (a `.base` file, or a note's first block), or a block's source in `note`. */
export type WikiBaseSource =
  | { readonly base: string }
  | { readonly source: string; readonly note: string };

type Row = WikiQueryResult["rows"][number];

/** How a row's own name opens: a wiki document by name, any other file as a file. */
interface RowOpeners {
  readonly onOpenNote: (name: string) => void;
  /** Absent where files can't open; such rows show their name as text. */
  readonly onOpenFile?: ((file: string) => void) | undefined;
}

/** What a base's own tab can change: the view's settings, and the notes it shows. */
interface BaseEditing {
  readonly file: string;
  readonly edits: ReadonlyArray<WikiBaseEdit>;
  readonly onEdit: (edit: WikiBaseEdit) => void;
  /** New, with what the view's filters and the group it was asked from say the note needs. */
  readonly onNew: (
    filters: WikiBaseFilter | undefined,
    group?: { readonly property: string; readonly value: WikiBaseCell },
  ) => void;
}

/** A repository file shown as an image, read from the wiki's checkout. */
function WikiFileImage({
  environmentId,
  root,
  path,
  className,
}: {
  readonly environmentId: EnvironmentId;
  readonly root: string | null;
  readonly path: string;
  readonly className: string;
}) {
  const state = useAssetUrlState(
    environmentId,
    root === null ? null : { _tag: "draft-workspace-file", cwd: root, path },
  );
  if (state._tag !== "Success") return <span className={className} data-image-missing />;
  return <img className={className} src={state.url} alt="" loading="lazy" decoding="async" />;
}

let iconModule: Promise<(name: string) => LucideIcon | undefined> | null = null;
const loadIcons = () =>
  (iconModule ??= import("~/lib/lucideIconByName").then((module) => module.lucideIconByName));

/** A Lucide icon by name, as `icon()` gives one; the set loads the first time one shows. */
function BaseIcon({ name }: { readonly name: string }) {
  const [icon, setIcon] = useState<{ readonly name: string; readonly Icon: LucideIcon } | null>(
    null,
  );
  // oxlint-disable-next-line t3code/react-effect-budget -- the icon set is a lazily loaded module
  useEffect(() => {
    let live = true;
    void loadIcons().then((lookup) => {
      const found = lookup(name);
      if (live && found) setIcon({ name, Icon: found });
    });
    return () => {
      live = false;
    };
  }, [name]);
  if (icon === null || icon.name !== name) return null;
  return <icon.Icon className="inline size-4 align-text-bottom" aria-label={name} />;
}

/** HTML a formula made, cleaned of anything that runs or loads. */
function BaseHtml({ html }: { readonly html: string }) {
  const clean = DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, FORBID_TAGS: ["style"] });
  return <span dangerouslySetInnerHTML={{ __html: clean }} />;
}

/** What the web app gives a base's layout: its files, images, icons, HTML, map, and edits. */
function webHost({
  environmentId,
  root,
  result,
  dark,
  openRow,
  onOpenNote,
  canOpenFiles,
  editing,
}: {
  readonly environmentId: EnvironmentId;
  readonly root: string | null;
  readonly result: WikiQueryResult;
  readonly dark: boolean;
  readonly openRow: (row: Row) => void;
  readonly onOpenNote: (name: string) => void;
  readonly canOpenFiles: boolean;
  readonly editing: BaseEditing | undefined;
}): BaseLayoutHost {
  const groupProperty = result.settings?.groupBy?.property ?? result.groupBy?.id;
  return {
    canOpenRow: (row) => wikiDocumentName(row.file) !== null || canOpenFiles,
    openRow,
    openLink: onOpenNote,
    renderImage: (image, className) =>
      image.kind === "file" ? (
        <WikiFileImage
          environmentId={environmentId}
          root={root}
          path={image.path}
          className={className}
        />
      ) : null,
    renderIcon: (name) => <BaseIcon name={name} />,
    renderHtml: (html) => <BaseHtml html={html} />,
    renderMap: (shown) => (
      <Suspense fallback={<Spinner size="md" tone="muted" />}>
        <WikiBaseMap result={shown as WikiQueryResult} dark={dark} openRow={openRow} />
      </Suspense>
    ),
    ...(editing === undefined
      ? {}
      : {
          canEdit: (row, column) => isEditableNote(row.file) && isNoteProperty(column),
          onEdit: (row, column, value) =>
            editing.onEdit({ kind: "property", file: row.file, property: column, value }),
          onMove: (row, group) => {
            if (groupProperty === undefined || !isNoteProperty(groupProperty)) return;
            editing.onEdit({
              kind: "property",
              file: row.file,
              property: groupProperty,
              value: group,
            });
          },
          onNew: (group) =>
            editing.onNew(
              result.settings?.filters,
              groupProperty === undefined || group === undefined
                ? undefined
                : { property: groupProperty, value: group },
            ),
          columnHeading: (column, label) => (
            <ColumnMenu
              column={column}
              label={label}
              result={result}
              file={editing.file}
              onEdit={editing.onEdit}
            />
          ),
          onResize: (column, width) =>
            editing.onEdit({
              kind: "view",
              base: editing.file,
              view: result.view.name,
              settings: { columnSize: { ...result.settings?.columnSize, [column]: width } },
            }),
        }),
  };
}

/**
 * A base's view, drawn as Obsidian draws its layout. Every row opens its file; with `editing`,
 * cells of notes at the top of the wiki edit in place, a board's cards move between groups, and
 * column headings sort, summarize, rename and hide.
 */
export function WikiBaseResults({
  environmentId,
  wikiId,
  result,
  onOpenNote,
  onOpenFile,
  editing,
}: {
  readonly environmentId: EnvironmentId;
  readonly wikiId: WikiId;
  readonly result: WikiQueryResult;
  readonly editing?: BaseEditing | undefined;
} & RowOpeners) {
  const overviews = useAtomValue(wikiEnvironment.overview(environmentId));
  const root = overviews?.find((overview) => overview.wiki.wikiId === wikiId)?.wiki.root ?? null;
  const { resolvedTheme } = useTheme();
  const openRow = (row: Row) => {
    const document = wikiDocumentName(row.file);
    if (document !== null) onOpenNote(document);
    else onOpenFile?.(row.file);
  };
  const host = webHost({
    environmentId,
    root,
    result,
    dark: resolvedTheme === "dark",
    openRow,
    onOpenNote,
    canOpenFiles: onOpenFile !== undefined,
    editing,
  });
  return <BaseLayout result={result} host={host} />;
}

/**
 * One view of a base, run on the server over the files the tab reads (main, or a change
 * request's head) with any unsaved edits applied. With `editing`, its toolbar changes the view;
 * without, a picker chooses among its views.
 */
export function WikiBase({
  environmentId,
  wikiId,
  changeRequestId,
  from,
  view: initialView,
  onOpenNote,
  onOpenFile,
  editing,
}: {
  readonly environmentId: EnvironmentId;
  readonly wikiId: WikiId;
  readonly changeRequestId: WikiChangeRequestId | undefined;
  readonly from: WikiBaseSource;
  /** The view to show first, as an embed names it. */
  readonly view?: string | undefined;
  readonly editing?: BaseEditing | undefined;
} & RowOpeners) {
  const [view, setView] = useState<string | null>(initialView ?? null);
  const edits = editing?.edits ?? [];
  const query = useEnvironmentQuery(
    wikiEnvironment.query({
      environmentId,
      input: {
        wikiId,
        ...(changeRequestId === undefined ? {} : { changeRequestId }),
        ...from,
        ...(view === null ? {} : { view }),
        ...(edits.length ? { edits: [...edits] } : {}),
      },
    }),
  );
  // An edit keeps the last view on screen until the new one lands.
  const [lastResult, setLastResult] = useState(query.data);
  if (query.data !== null && query.data !== lastResult) setLastResult(query.data);
  const result = query.data ?? (query.error === null ? lastResult : null);
  if (result === null) {
    return query.error !== null ? (
      <Alert variant="warning">
        <TriangleAlertIcon />
        <AlertTitle>This base can't be shown</AlertTitle>
        <AlertDescription>{describeWikiFailure(query.failure ?? query.error)}</AlertDescription>
      </Alert>
    ) : (
      <div className="flex justify-center py-4">
        <Spinner size="md" tone="muted" />
      </div>
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {editing ? (
        <WikiBaseToolbar
          result={result}
          file={editing.file}
          onPickView={setView}
          onEdit={editing.onEdit}
          onNew={() => editing.onNew(result.settings?.filters)}
        />
      ) : result.views.length > 1 ? (
        <Select
          value={result.view.name}
          items={Object.fromEntries(result.views.map((name) => [name, name]))}
          onValueChange={(value) => {
            if (typeof value === "string") setView(value);
          }}
        >
          <SelectTrigger size="compact" aria-label="View">
            <SelectValue />
          </SelectTrigger>
          <SelectPopup>
            {result.views.map((name) => (
              <SelectItem key={name} value={name}>
                {name}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      ) : null}
      {editing && query.error !== null ? (
        <Alert variant="warning">
          <TriangleAlertIcon />
          <AlertDescription>{describeWikiFailure(query.failure ?? query.error)}</AlertDescription>
        </Alert>
      ) : null}
      <WikiBaseResults
        environmentId={environmentId}
        wikiId={wikiId}
        result={result}
        onOpenNote={onOpenNote}
        onOpenFile={onOpenFile}
        editing={editing}
      />
    </div>
  );
}

/** Names a new note made from a base's view; it gets what the view's filters and group ask for. */
function NewNoteDialog({
  onClose,
  onCreate,
}: {
  readonly onClose: () => void;
  readonly onCreate: (name: string) => void;
}) {
  const id = useId();
  const [name, setName] = useState("");
  const clean = name.trim();
  const valid = clean.length > 0 && !/[/\\#^[\]|:]/.test(clean) && !clean.startsWith(".");
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogPopup className="sm:max-w-sm">
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            if (valid) onCreate(clean);
          }}
        >
          <DialogHeader>
            <DialogTitle>New note</DialogTitle>
            <DialogDescription>
              It gets the properties this view's filters and group ask for.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={id}>Name</Label>
              <Input
                id={id}
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid}>
              Add
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

const editCount = (count: number) =>
  count === 1 ? "1 unsaved change" : `${count} unsaved changes`;

/**
 * A `.base` file opened in its own tab. Its view edits in place, as in Obsidian: the view's
 * settings, its notes' properties, new notes. Edits show at once and stay unsaved until they
 * are saved to a change request, as a note's are; main changes only when one merges.
 */
export function WikiBasePage({
  environmentId,
  wikiId,
  file,
  changeRequestId,
  parent,
  openChangeRequests,
  onOpenNote,
  onOpenFile,
  onSaved,
  registerUnsaved,
}: {
  readonly environmentId: EnvironmentId;
  readonly wikiId: WikiId;
  readonly file: string;
  readonly changeRequestId: WikiChangeRequestId | undefined;
  /** Where the base is read from, as the tab header names it. */
  readonly parent: string;
  readonly openChangeRequests: ReadonlyArray<WikiChangeRequest>;
  readonly onSaved: (changeRequestId: WikiChangeRequestId) => void;
  readonly registerUnsaved?: (isUnsaved: () => boolean) => () => void;
} & RowOpeners) {
  const [edits, setEdits] = useState<ReadonlyArray<WikiBaseEdit>>([]);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState<Readonly<Record<string, WikiBaseCell>> | null>(null);
  const canEdit = useAtomValue(wikiEnvironment.transform.permissionAtom(environmentId));
  const transform = useWikiCommand(wikiEnvironment.transform, "Couldn't save the base");
  const editable = canEdit && /^[^/]+\.base$/.test(file);
  const dirty = edits.length > 0;
  // oxlint-disable-next-line t3code/react-effect-budget -- closing the tab asks whether edits are unsaved
  useEffect(() => registerUnsaved?.(() => dirty), [registerUnsaved, dirty]);
  useBlocker({
    disabled: !dirty,
    enableBeforeUnload: () => dirty,
    shouldBlockFn: async () => {
      const leave = await ensureLocalApi().dialogs.confirm(
        `Leave ${file.replace(/\.base$/, "")}? Your unsaved changes will be lost.`,
        { variant: "destructive" },
      );
      return !leave;
    },
  });
  const save = async (target: SaveTarget, message: string): Promise<string | null> => {
    const outcome = await transform({
      environmentId,
      input: { wikiId, message, transform: { kind: "base-edits", edits: [...edits] }, ...target },
    });
    if (!outcome.ok) return outcome.message ?? "The save was cancelled.";
    setEdits([]);
    onSaved(outcome.value.changeRequest.changeRequestId);
    return null;
  };

  const editing: BaseEditing | undefined = editable
    ? {
        file,
        edits,
        onEdit: (edit) => setEdits((current) => withEdit(current, edit)),
        onNew: (filters, group) => setCreating(newNoteProperties(filters, group)),
      }
    : undefined;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <TabHeader.Root>
        <TabHeader.Title label="Base" parent={parent}>
          {file.replace(/\.base$/, "")}
        </TabHeader.Title>
        {!editable ? <TabHeader.Status>Base · read only</TabHeader.Status> : null}
        {dirty ? (
          <TabHeader.Actions>
            <TabHeader.Status>{editCount(edits.length)}</TabHeader.Status>
            <Button variant="ghost" size="sm" onClick={() => setEdits([])}>
              Discard
            </Button>
            <Button size="sm" onClick={() => setSaving(true)}>
              Save to change request
            </Button>
          </TabHeader.Actions>
        ) : null}
      </TabHeader.Root>
      <div className="topbar-scroll-fade scrollbar-gutter-both min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-6 pt-6 pb-12">
          <WikiBase
            environmentId={environmentId}
            wikiId={wikiId}
            changeRequestId={changeRequestId}
            from={{ base: file }}
            onOpenNote={onOpenNote}
            onOpenFile={onOpenFile}
            editing={editing}
          />
        </div>
      </div>
      {saving ? (
        <SaveToChangeRequestDialog
          environmentId={environmentId}
          subject={file.replace(/\.base$/, "")}
          openChangeRequests={openChangeRequests}
          viewing={changeRequestId}
          onClose={() => setSaving(false)}
          onSave={async (target, message) => {
            const error = await save(target, message);
            if (error === null) setSaving(false);
            return error;
          }}
        />
      ) : null}
      {creating !== null ? (
        <NewNoteDialog
          onClose={() => setCreating(null)}
          onCreate={(name) => {
            setCreating(null);
            setEdits((current) =>
              withEdit(current, { kind: "create", file: `${name}.md`, properties: creating }),
            );
          }}
        />
      ) : null}
    </div>
  );
}
