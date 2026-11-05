/**
 * Edits made from a base's view, as whole-file changes: a view's settings and the base's
 * formulas change its `.base` file, a cell its note's frontmatter, and New writes a note. The
 * server applies them over a read to preview them, and over a change request's head to save them,
 * so they land on whatever the head holds by then.
 */
import { isMap, isSeq, parseDocument, type Document, type YAMLMap } from "yaml";

import { BASE_VIEW_SETTING_KEYS, type BaseViewSettings } from "./baseLayout.ts";
import { BaseError } from "./baseValues.ts";
import { key } from "./links.ts";
import { frontmatterEnd } from "./links.ts";
import type { WikiFiles } from "./wikiIndex.ts";

/** Whole new content per changed file; `null` deletes the file. */
type Changes = Readonly<Record<string, string | null>>;

export type BasePropertyValue =
  | null
  | boolean
  | number
  | string
  | ReadonlyArray<null | boolean | number | string>;

/** A view setting's new value; `null` removes it from the view. */
export type BaseViewSettingsEdit = {
  readonly [Key in keyof BaseViewSettings]?: BaseViewSettings[Key] | null | undefined;
};

export type BaseEdit =
  /** Changes a view's settings, and renames it with `name`. */
  | {
      readonly kind: "view";
      readonly base: string;
      readonly view: string;
      readonly name?: string | undefined;
      readonly type?: string | undefined;
      readonly settings?: BaseViewSettingsEdit | undefined;
    }
  /** Adds a view after the others, its settings copied from `copy` when named. */
  | {
      readonly kind: "add-view";
      readonly base: string;
      readonly name: string;
      readonly type: string;
      readonly copy?: string | undefined;
    }
  | { readonly kind: "remove-view"; readonly base: string; readonly view: string }
  /** Sets a formula; `null` removes it. */
  | {
      readonly kind: "formula";
      readonly base: string;
      readonly name: string;
      readonly expression: string | null;
    }
  /** Sets the heading a property shows under; `null` goes back to its own name. */
  | {
      readonly kind: "display-name";
      readonly base: string;
      readonly property: string;
      readonly displayName: string | null;
    }
  /** Sets one property in a note's frontmatter; `null` removes it. */
  | {
      readonly kind: "property";
      readonly file: string;
      readonly property: string;
      readonly value: BasePropertyValue;
    }
  /** Writes a new note with these properties. */
  | {
      readonly kind: "create";
      readonly file: string;
      readonly properties: Readonly<Record<string, BasePropertyValue>>;
    };

const flat = (file: string, extension: ".md" | ".base") => {
  if (
    !file.endsWith(extension) ||
    file.length === extension.length ||
    /[/\\\0\r\n]/.test(file) ||
    file.startsWith(".")
  ) {
    throw new BaseError(
      extension === ".md"
        ? `Only notes at the top of the wiki can be edited from a base, not ${file}.`
        : `Only a .base file at the top of the wiki can be edited, not ${file}.`,
    );
  }
  return file;
};

const readYaml = (source: string, file: string): Document => {
  const document = parseDocument(source, { schema: "core" });
  if (document.errors.length) {
    throw new BaseError(`${file} is not valid YAML, so it can't be edited from its view.`);
  }
  return document;
};

const viewName = (view: YAMLMap): string => {
  const name = view.get("name");
  if (typeof name === "string" && name.trim()) return name.trim();
  const type = view.get("type");
  const kind = typeof type === "string" ? type : "table";
  return `${kind[0]?.toUpperCase() ?? ""}${kind.slice(1)}`;
};

/** The base's views as YAML, made when it has none: a base without views shows one table. */
function viewsOf(document: Document) {
  if (!isMap(document.contents)) document.contents = document.createNode({}) as YAMLMap;
  let views = document.get("views", true);
  if (!isSeq(views)) {
    views = document.createNode([{ type: "table", name: "Table" }]);
    document.set("views", views);
  }
  if (!isSeq(views)) throw new BaseError("views must be a list.");
  return views;
}

function findView(document: Document, name: string, file: string) {
  const views = viewsOf(document);
  const position = views.items.findIndex(
    (item) => isMap(item) && (viewName(item) === name || key(viewName(item)) === key(name)),
  );
  const view = views.items[position];
  if (position < 0 || !isMap(view)) throw new BaseError(`${file} has no view named “${name}”.`);
  return { views, view, position };
}

const SETTING_KEYS: ReadonlySet<string> = new Set(BASE_VIEW_SETTING_KEYS);

function editBase(document: Document, edit: BaseEdit & { readonly base: string }): void {
  switch (edit.kind) {
    case "view": {
      const { view, views } = findView(document, edit.view, edit.base);
      if (edit.name !== undefined) {
        const name = edit.name.trim();
        if (!name) throw new BaseError("A view needs a name.");
        const taken = views.items.some(
          (item) => item !== view && isMap(item) && key(viewName(item)) === key(name),
        );
        if (taken) throw new BaseError(`${edit.base} already has a view named “${name}”.`);
        view.set("name", name);
      }
      if (edit.type !== undefined) view.set("type", edit.type);
      for (const [setting, value] of Object.entries(edit.settings ?? {})) {
        if (!SETTING_KEYS.has(setting)) throw new BaseError(`Views have no setting “${setting}”.`);
        if (value === undefined) continue;
        if (value === null) view.delete(setting);
        else view.set(setting, document.createNode(value));
      }
      return;
    }
    case "add-view": {
      const views = viewsOf(document);
      const name = edit.name.trim();
      if (!name) throw new BaseError("A view needs a name.");
      if (views.items.some((item) => isMap(item) && key(viewName(item)) === key(name))) {
        throw new BaseError(`${edit.base} already has a view named “${name}”.`);
      }
      const copied =
        edit.copy === undefined
          ? {}
          : (findView(document, edit.copy, edit.base).view.toJSON() as Record<string, unknown>);
      views.add(document.createNode({ ...copied, type: edit.type, name }));
      return;
    }
    case "remove-view": {
      const { views, position } = findView(document, edit.view, edit.base);
      if (views.items.length === 1) throw new BaseError("A base keeps at least one view.");
      views.delete(position);
      return;
    }
    case "formula": {
      const name = edit.name.trim();
      if (!/^[\p{L}_][\p{L}\p{N}_]*$/u.test(name)) {
        throw new BaseError(`“${edit.name}” can't name a formula: use letters, digits and _.`);
      }
      if (edit.expression === null) document.deleteIn(["formulas", name]);
      else document.setIn(["formulas", name], edit.expression);
      return;
    }
    case "display-name": {
      if (edit.displayName === null || !edit.displayName.trim()) {
        document.deleteIn(["properties", edit.property, "displayName"]);
        const left = document.getIn(["properties", edit.property]);
        if (isMap(left) && left.items.length === 0)
          document.deleteIn(["properties", edit.property]);
      } else document.setIn(["properties", edit.property, "displayName"], edit.displayName.trim());
      return;
    }
    default:
      return;
  }
}

const noteKey = (property: string): string => {
  const name = property.startsWith("note.") ? property.slice("note.".length) : property;
  if (!name || property.startsWith("file.") || property.startsWith("formula.")) {
    throw new BaseError(`${property} is worked out, not written, so it can't be edited.`);
  }
  return name;
};

/** A note with one frontmatter property set or removed; its prose keeps every byte. */
export function setNoteProperty(
  source: string,
  property: string,
  value: BasePropertyValue,
  file = "The note",
): string {
  const end = frontmatterEnd(source);
  const yaml =
    end === 0
      ? ""
      : source
          .slice(0, end)
          .replace(/^---\r?\n/, "")
          .replace(/---[ \t]*\r?\n?$/, "");
  const document = parseDocument(yaml, { schema: "core" });
  if (document.errors.length) {
    throw new BaseError(`${file}'s properties aren't valid YAML, so they can't be edited here.`);
  }
  if (document.contents !== null && !isMap(document.contents)) {
    throw new BaseError(`${file}'s properties aren't a mapping, so they can't be edited here.`);
  }
  const name = noteKey(property);
  if (value === null) document.delete(name);
  else document.set(name, document.createNode(value, { flow: false }));
  const body = source.slice(end);
  const empty = !isMap(document.contents) || document.contents.items.length === 0;
  if (empty) return end === 0 ? body : body.replace(/^\r?\n/, "");
  const text = String(document).replace(/\n*$/, "\n");
  return `---\n${text}---\n${end === 0 && body && !body.startsWith("\n") ? "\n" : ""}${body}`;
}

/**
 * Applies `edits` in order over `files` (the wiki's top-level documents), returning each file
 * they change. Throws `BaseError` naming what can't be done.
 */
export function applyBaseEdits(files: WikiFiles, edits: ReadonlyArray<BaseEdit>): Changes {
  const next = new Map(Object.entries(files));
  const touched = new Set<string>();
  for (const edit of edits) {
    if (edit.kind === "property") {
      const file = flat(edit.file, ".md");
      const source = next.get(file);
      if (source === undefined) throw new BaseError(`No note ${file} to edit.`);
      next.set(file, setNoteProperty(source, edit.property, edit.value, file));
      touched.add(file);
    } else if (edit.kind === "create") {
      const file = flat(edit.file, ".md");
      if ([...next.keys()].some((existing) => key(existing) === key(file))) {
        throw new BaseError(`${file.replace(/\.md$/, "")} already exists.`);
      }
      let source = "";
      for (const [property, value] of Object.entries(edit.properties)) {
        if (value !== null) source = setNoteProperty(source, property, value, file);
      }
      next.set(file, source);
      touched.add(file);
    } else {
      const file = flat(edit.base, ".base");
      const source = next.get(file);
      if (source === undefined) throw new BaseError(`No base ${file} to edit.`);
      const document = readYaml(source, file);
      editBase(document, edit);
      next.set(file, String(document));
      touched.add(file);
    }
  }
  return Object.fromEntries(
    [...touched].flatMap((file) => {
      const content = next.get(file) ?? null;
      return content === (files[file] ?? null) ? [] : [[file, content] as const];
    }),
  );
}
