/**
 * A synthetic codebase: folders of files, each file holding functions and
 * classes with methods, every symbol inside its container by `parent`, and
 * calls mostly within a file, sometimes across files and folders. Deterministic
 * from its seed: a tree for layout, gathering, and region tests.
 */
import type { LinkKind, Memory, MemoryLink, MemoryNote } from "../src/model/memory.ts";
import { seededRandom } from "./synthetic.ts";

export interface SyntheticTreeOptions {
  readonly folders?: number;
  readonly filesPerFolder?: number;
  readonly symbolsPerFile?: number;
  readonly seed?: number;
}

export function syntheticTree(options: SyntheticTreeOptions = {}): Memory {
  const folders = options.folders ?? 4;
  const filesPerFolder = options.filesPerFolder ?? 5;
  const symbolsPerFile = options.symbolsPerFile ?? 8;
  const random = seededRandom(options.seed ?? 7);
  const notes: Array<MemoryNote> = [];
  const links: Array<MemoryLink> = [];
  const symbols: Array<{ id: string; file: number }> = [];
  let fileIndex = 0;
  for (let folder = 0; folder < folders; folder += 1) {
    const folderId = `src/pkg${folder}`;
    notes.push({ id: folderId, name: `pkg${folder}`, frontier: false, kind: "folder" });
    for (let file = 0; file < filesPerFolder; file += 1, fileIndex += 1) {
      const fileId = `${folderId}/mod${file}.ts`;
      notes.push({
        id: fileId,
        name: `mod${file}.ts`,
        frontier: false,
        kind: "file",
        parent: folderId,
      });
      for (let symbol = 0; symbol < symbolsPerFile; symbol += 1) {
        const isClass = symbol % 4 === 0;
        const id = `${fileId}#s${symbol}`;
        notes.push({
          id,
          name: `${isClass ? "Class" : "fn"}${fileIndex}_${symbol}`,
          frontier: false,
          kind: isClass ? "class" : "function",
          parent: fileId,
        });
        symbols.push({ id, file: fileIndex });
        if (isClass) {
          for (let method = 0; method < 2; method += 1) {
            const methodId = `${id}.m${method}`;
            notes.push({
              id: methodId,
              name: `m${method}`,
              frontier: false,
              kind: "method",
              parent: id,
            });
            symbols.push({ id: methodId, file: fileIndex });
          }
        }
      }
    }
  }
  const kinds: ReadonlyArray<LinkKind> = ["calls", "calls", "references", "instantiates"];
  for (const symbol of symbols) {
    // Two calls within the file, and now and then one across files.
    for (let call = 0; call < 2; call += 1) {
      const sameFile = symbols.filter(
        (other) => other.file === symbol.file && other.id !== symbol.id,
      );
      const target = sameFile[Math.floor(random() * sameFile.length)];
      if (target !== undefined) {
        links.push({
          from: symbol.id,
          to: target.id,
          kind: kinds[call % kinds.length] ?? "calls",
          resolution: "exact",
        });
      }
    }
    if (random() < 0.3) {
      const target = symbols[Math.floor(random() * symbols.length)];
      if (target !== undefined && target.id !== symbol.id) {
        links.push({ from: symbol.id, to: target.id, kind: "calls", resolution: "heuristic" });
      }
    }
  }
  return {
    id: `synthetic-tree-${folders}x${filesPerFolder}x${symbolsPerFile}`,
    notes,
    links,
    lenses: [],
  };
}
