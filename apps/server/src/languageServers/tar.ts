/** The files of a tar archive as npm packs them (ustar, with pax and GNU long names). */

export interface TarFile {
  /** Relative, with npm's leading `package/` folder removed. */
  readonly path: string;
  readonly mode: number;
  readonly data: Uint8Array;
}

const decoder = new TextDecoder();
const BLOCK = 512;

const text = (block: Uint8Array, offset: number, length: number) => {
  const field = block.subarray(offset, offset + length);
  const end = field.indexOf(0);
  return decoder.decode(end < 0 ? field : field.subarray(0, end));
};

const octal = (block: Uint8Array, offset: number, length: number) =>
  Number.parseInt(text(block, offset, length).trim() || "0", 8);

const paxPath = (data: Uint8Array): string | null => {
  for (const record of decoder.decode(data).split("\n")) {
    const match = /^\d+ path=(.*)$/.exec(record);
    if (match) return match[1]!;
  }
  return null;
};

export class TarError extends Error {}

/** A path inside the package; anything absolute or climbing out is refused. */
const safePath = (raw: string) => {
  const parts = raw
    .replaceAll("\\", "/")
    .split("/")
    .filter((part) => part !== "" && part !== ".");
  if (parts.some((part) => part === "..") || raw.startsWith("/")) {
    throw new TarError("An archive entry points outside its package.");
  }
  // npm packs every file under one top folder, usually `package/`.
  return parts.slice(1).join("/");
};

export const readTar = (archive: Uint8Array): Array<TarFile> => {
  const files: Array<TarFile> = [];
  let offset = 0;
  let longName: string | null = null;
  while (offset + BLOCK <= archive.length) {
    const header = archive.subarray(offset, offset + BLOCK);
    if (header.every((byte) => byte === 0)) break;
    const size = octal(header, 124, 12);
    const type = String.fromCharCode(header[156] ?? 0);
    const prefix = text(header, 345, 155);
    const name = text(header, 0, 100);
    const data = archive.subarray(offset + BLOCK, offset + BLOCK + size);
    offset += BLOCK + Math.ceil(size / BLOCK) * BLOCK;
    if (type === "x") {
      longName = paxPath(data);
      continue;
    }
    if (type === "L") {
      longName = decoder.decode(data).replace(/\0+$/, "");
      continue;
    }
    if (type === "g") continue;
    const path = longName ?? (prefix ? `${prefix}/${name}` : name);
    longName = null;
    if (type !== "0" && type !== "\0") continue;
    const relative = safePath(path);
    if (relative === "") continue;
    files.push({ path: relative, mode: octal(header, 100, 8), data: data.slice() });
  }
  return files;
};
