/**
 * The indexed files' folders as symbols, from the story's root down: every folder from a `--paths`
 * root to an indexed file is a note; the root has no parent. A Go folder holding `.go` files and a
 * Rust module folder (`mod.rs`, `lib.rs`, `main.rs`, or named like a sibling `x.rs`) are packages.
 */
import type { CodeSymbol } from "../model/code.ts";
import type { LanguageId } from "../parse/languages.ts";

const dirname = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf("/")));
const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const RUST_MODULE_ROOTS = new Set(["mod.rs", "lib.rs", "main.rs"]);

export class FolderTree {
  private readonly roots: ReadonlyArray<string>;
  /** Indexed files at or below each folder. */
  private readonly below = new Map<string, number>();
  /** Folders holding a Go file or a Rust module root directly, by count. */
  private readonly packageFiles = new Map<string, number>();
  private readonly rustFiles = new Set<string>();

  constructor(paths: ReadonlyArray<string>) {
    this.roots = paths.map((spec) => spec.replace(/\/+$/, "")).filter((spec) => spec !== "");
  }

  /** The folder a path's chain starts at: the longest `--paths` root holding it, or none. */
  private rootOf(path: string): string {
    let root = "";
    for (const spec of this.roots) {
      const candidate = path === spec ? dirname(spec) : path.startsWith(`${spec}/`) ? spec : null;
      if (candidate !== null && candidate.length >= root.length) root = candidate;
    }
    return root;
  }

  /** The folders from the root down to the file's own, outermost first. */
  private chain(path: string): ReadonlyArray<string> {
    const root = this.rootOf(path);
    const folders: Array<string> = [];
    for (let dir = dirname(path); dir !== "" && dir.length >= root.length; dir = dirname(dir)) {
      folders.unshift(dir);
      if (dir === root) break;
    }
    return folders;
  }

  add(path: string, language: LanguageId): void {
    this.count(path, language, 1);
  }

  remove(path: string, language: LanguageId): void {
    this.count(path, language, -1);
  }

  private count(path: string, language: LanguageId, step: 1 | -1) {
    for (const dir of this.chain(path)) this.bump(this.below, dir, step);
    const direct =
      language === "go" || (language === "rust" && RUST_MODULE_ROOTS.has(baseName(path)));
    if (direct) this.bump(this.packageFiles, dirname(path), step);
    if (language === "rust") {
      if (step > 0) this.rustFiles.add(path);
      else this.rustFiles.delete(path);
    }
  }

  private bump(map: Map<string, number>, key: string, step: number) {
    const next = (map.get(key) ?? 0) + step;
    if (next > 0) map.set(key, next);
    else map.delete(key);
  }

  private id(dir: string): string {
    const isPackage = this.packageFiles.has(dir) || this.rustFiles.has(`${dir}.rs`);
    return `${dir}#${isPackage ? "package" : "folder"}:${baseName(dir)}`;
  }

  /** The folder a file hangs off, if its chain has one. */
  parentOf(path: string): string | undefined {
    const folders = this.chain(path);
    const own = folders.at(-1);
    return own === undefined ? undefined : this.id(own);
  }

  private symbolOf(dir: string): CodeSymbol {
    const id = this.id(dir);
    const parentDir = this.chain(`${dir}/.`).at(-2);
    const base: CodeSymbol = {
      id,
      name: baseName(dir),
      kind: id.includes("#package:") ? "package" : "folder",
      path: dir,
      range: { startLine: 0, endLine: 0 },
      hash: "",
    };
    return parentDir === undefined ? base : { ...base, parent: this.id(parentDir) };
  }

  /** Every folder that holds an indexed file. */
  symbols(): ReadonlyArray<CodeSymbol> {
    return [...this.below.keys()].map((dir) => this.symbolOf(dir));
  }

  /**
   * The folders on the chains of `paths` (and, for a Rust `x.rs`, the folder `x`
   * it may make a package) that currently hold an indexed file.
   */
  around(paths: Iterable<string>): ReadonlyArray<CodeSymbol> {
    const found = new Map<string, CodeSymbol>();
    for (const path of paths) {
      const probes = path.endsWith(".rs") ? [path, `${path.slice(0, -3)}/.`] : [path];
      for (const probe of probes) {
        for (const dir of this.chain(probe)) {
          if (this.below.has(dir) && !found.has(dir)) found.set(dir, this.symbolOf(dir));
        }
      }
    }
    return [...found.values()];
  }
}
