/** The languages the index reads, and how a path picks one. */
const LANGUAGES = ["typescript", "tsx", "python", "go", "rust"] as const;
export type LanguageId = (typeof LANGUAGES)[number];

const BY_EXTENSION: Readonly<Record<string, LanguageId>> = {
  ".ts": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".tsx": "tsx",
  ".py": "python",
  ".go": "go",
  ".rs": "rust",
};

export function languageOf(path: string): LanguageId | null {
  if (path.endsWith(".d.ts") || path.endsWith(".d.mts") || path.endsWith(".d.cts")) return null;
  const dot = path.lastIndexOf(".");
  if (dot < 0 || dot < path.lastIndexOf("/")) return null;
  return BY_EXTENSION[path.slice(dot)] ?? null;
}

/**
 * The query files each language reads, relative to the package's `queries/`
 * directory: its tag queries in order, then one file each under `imports/` and `locals/`.
 */
export const QUERY_FILES: Readonly<
  Record<LanguageId, { readonly tags: ReadonlyArray<string>; readonly family: string }>
> = {
  typescript: {
    tags: ["javascript.scm", "typescript.scm", "extra/typescript.scm"],
    family: "typescript",
  },
  tsx: {
    tags: ["javascript.scm", "typescript.scm", "extra/typescript.scm", "extra/tsx.scm"],
    family: "typescript",
  },
  python: { tags: ["python.scm", "extra/python.scm"], family: "python" },
  go: { tags: ["go.scm", "extra/go.scm"], family: "go" },
  rust: { tags: ["rust.scm", "extra/rust.scm"], family: "rust" },
};

/** Directories never indexed: dependencies, vendored code, and checked-in build output. */
const SKIPPED_DIRECTORIES = new Set(["node_modules", ".repos", "dist", "vendor", "third_party"]);

const GENERATED_NAME = /(\.gen\.|\.generated\.|\.min\.|_pb2\.py$|\.pb\.go$)/;

/** Whether a path sits in a directory never indexed, at any depth. */
export function inSkippedDirectory(path: string): boolean {
  return path.split("/").some((segment) => SKIPPED_DIRECTORIES.has(segment));
}

/** Whether a path is worth parsing at all, before its size or text is known. */
export function isIndexable(path: string): boolean {
  if (languageOf(path) === null || GENERATED_NAME.test(path)) return false;
  return !inSkippedDirectory(path);
}

/** Generated files announce themselves in their first lines. */
export function looksGenerated(text: string): boolean {
  const head = text.slice(0, 1024);
  return head.includes("@generated") || /Code generated .* DO NOT EDIT/.test(head);
}
