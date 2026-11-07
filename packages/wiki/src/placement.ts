/**
 * Where a new file lands, the way Obsidian 1.15 was seen to place them, on every client alike.
 * Clients run this, so it stays free of `toSorted` and of `\p{}`.
 */
import { folderOf, isWikiPath, key, linkPath } from "./resolveLink.ts";

export interface WikiPlacement {
  readonly attachments: "root" | "folder" | "beside" | "subfolder";
  /** The folder from the root, or the subfolder of the document's. */
  readonly attachmentFolder: string;
  readonly newNotes: "beside" | "root" | "folder";
  readonly newNoteFolder: string;
}

const NOTE_ROOT = "";

/** A folder as settings may hold it: its path, or null for one a wiki can't have. */
export function settingsFolder(text: string): string | null {
  const folder = text.trim().replace(/^\.?\/+|\/+$/g, "");
  if (folder === "" || folder === ".") return NOTE_ROOT;
  return isWikiPath(`${folder}/x`) ? folder : null;
}

const joined = (folder: string, name: string) =>
  folder === "" || name === "" ? `${folder}${name}` : `${folder}/${name}`;

/** The folder an attachment of `source` lands in. Missing folders are made by landing there. */
export function attachmentFolder(placement: WikiPlacement, source: string | null): string {
  const near = folderOf(source ?? "");
  const named = settingsFolder(placement.attachmentFolder) ?? NOTE_ROOT;
  switch (placement.attachments) {
    case "root":
      return NOTE_ROOT;
    case "folder":
      return named;
    case "beside":
      return near;
    case "subfolder":
      return joined(near, named);
  }
}

const twoDigits = (value: number) => String(value).padStart(2, "0");

/** `Pasted image YYYYMMDDHHmmss.png`, in local time; the extension follows the type. */
export function pastedImageName(type: string, at: Date): string {
  const stamp = [
    at.getFullYear(),
    twoDigits(at.getMonth() + 1),
    twoDigits(at.getDate()),
    twoDigits(at.getHours()),
    twoDigits(at.getMinutes()),
    twoDigits(at.getSeconds()),
  ].join("");
  return `Pasted image ${stamp}.${type === "image/jpeg" ? "jpg" : "png"}`;
}

/** What a pasted file is called: a PNG or JPEG takes the stamp, anything else its own name. */
export const pastedFileName = (file: { readonly name: string; readonly type: string }, at: Date) =>
  file.type === "image/png" || file.type === "image/jpeg" || file.name === ""
    ? pastedImageName(file.type, at)
    : cleanFileName(file.name);

/** A file's name with what a link can't hold turned to spaces. `[` and `]` stay, as they do. */
export const cleanFileName = (name: string): string => name.replace(/[#^|:/\\]/g, " ");

/**
 * `file` as the first free path: on a taken name, ` 1`, ` 2`, in that folder only, whatever the
 * case. Bytes aren't compared, so the same file dropped twice makes two.
 */
export function freePath(file: string, files: Iterable<string>): string {
  const taken = new Set<string>();
  for (const each of files) taken.add(key(each));
  const dot = file.lastIndexOf(".");
  const named = dot > file.lastIndexOf("/") + 1;
  const stem = named ? file.slice(0, dot) : file;
  const extension = named ? file.slice(dot) : "";
  let candidate = file;
  for (let count = 1; taken.has(key(candidate)); count++) {
    candidate = `${stem} ${count}${extension}`;
  }
  return candidate;
}

/** Where a new attachment named `name` lands for `source`. */
export const attachmentPath = (
  placement: WikiPlacement,
  source: string | null,
  name: string,
  files: Iterable<string>,
): string => freePath(joined(attachmentFolder(placement, source), cleanFileName(name)), files);

const isRelative = (text: string) =>
  text === "." || text === ".." || text.startsWith("./") || text.startsWith("../");

const hasFolder = (folder: string, files: Iterable<string>) => {
  const inside = `${key(folder)}/`;
  for (const file of files) if (key(file).startsWith(inside)) return true;
  return false;
};

/**
 * Where a note named by a link or a person is written. A folder in `target` is a path from the
 * root, and makes folders. Without one, the setting decides, and a named folder that's missing
 * falls back to the root. `./` and `../` create nothing: null.
 */
export function newNoteFile(
  target: string,
  from: string | null,
  placement: WikiPlacement,
  files: Iterable<string>,
): string | null {
  const text = linkPath(target);
  if (isRelative(text)) return null;
  const rooted = text.replace(/^\/+/, "");
  if (rooted === "") return null;
  const file = /\.(md|base|canvas)$/i.test(rooted) ? rooted : `${rooted}.md`;
  if (!isWikiPath(file)) return null;
  if (text.includes("/")) return file;
  if (placement.newNotes === "root") return file;
  if (placement.newNotes === "beside") return joined(folderOf(from ?? ""), file);
  const named = settingsFolder(placement.newNoteFolder);
  return named !== null && named !== "" && hasFolder(named, files) ? joined(named, file) : file;
}
