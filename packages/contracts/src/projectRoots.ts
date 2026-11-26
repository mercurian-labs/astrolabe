import * as Schema from "effect/Schema";

import { ProjectId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { WorkspaceFolderState } from "./workspaceFolders.ts";

/** Names one root of a project in addresses such as `api:docs/Plan.md#Goal`. Unique per project. */
export const RootKey = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9._-]*$/)).pipe(
  Schema.brand("RootKey"),
);
export type RootKey = typeof RootKey.Type;

/** One root as other entities key it: `<encoded projectId>:<encoded rootKey>`. */
export const ProjectRootId = TrimmedNonEmptyString.pipe(Schema.brand("ProjectRootId"));
export type ProjectRootId = typeof ProjectRootId.Type;

/** The project folder itself, or one of the folders it tracks. */
export const ProjectRoot = Schema.Struct({
  key: RootKey,
  name: TrimmedNonEmptyString,
  /** The live checkout, as the project stores it. */
  path: TrimmedNonEmptyString,
  kind: Schema.Literals(["workspace", "tracked"]),
  state: WorkspaceFolderState,
  /** A Git repository whose remote is a host that takes pull requests. */
  hostBacked: Schema.Boolean,
});
export type ProjectRoot = typeof ProjectRoot.Type;

/** A root as one thread has it. */
export const ProjectRootCheckout = Schema.Struct({
  ...ProjectRoot.fields,
  /** Where the thread reads this root. Null when its worktrees leave the root out. */
  checkout: Schema.NullOr(TrimmedNonEmptyString),
  writable: Schema.Boolean,
});
export type ProjectRootCheckout = typeof ProjectRootCheckout.Type;

export const ProjectRootsListInput = Schema.Struct({
  projectId: ProjectId,
  /** The thread's `worktreePath`. Absent or null for the live checkouts. */
  worktreePath: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
});
export type ProjectRootsListInput = typeof ProjectRootsListInput.Type;

export const ProjectRootsListResult = Schema.Struct({
  /** The project folder first, then its folders in the order the project lists them. */
  roots: Schema.Array(ProjectRootCheckout),
});
export type ProjectRootsListResult = typeof ProjectRootsListResult.Type;

export class ProjectRootsError extends Schema.TaggedError<ProjectRootsError>()(
  "ProjectRootsError",
  {
    operation: Schema.Literals(["list", "resolve"]),
    detail: Schema.String,
  },
) {
  override get message(): string {
    return this.detail;
  }
}

/** No root could be picked for a new file; `candidates` are the roots the caller may write. */
export class ProjectRootWriteTargetError extends Schema.TaggedError<ProjectRootWriteTargetError>()(
  "ProjectRootWriteTargetError",
  {
    detail: Schema.String,
    candidates: Schema.Array(RootKey),
  },
) {
  override get message(): string {
    return this.detail;
  }
}

const ROOT_KEY_FALLBACK = "root";

const slugRootKey = (name: string) => {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .replace(/-+$/, "");
  return slug === "" ? ROOT_KEY_FALLBACK : slug;
};

const basename = (folder: string) =>
  folder
    .replace(/[\\/]+$/, "")
    .split(/[\\/]/)
    .at(-1) ?? "";

/**
 * Keys for the project folder and then each of `folders`, in that order. A key repeated earlier in
 * the list gets `-2`, `-3`, so adding a folder at the end never renames one before it.
 */
export const projectRootKeys = (
  workspaceRoot: string,
  folders: ReadonlyArray<{ readonly name: string }>,
): ReadonlyArray<RootKey> => {
  const taken = new Set<string>();
  return [basename(workspaceRoot), ...folders.map((folder) => folder.name)].map((name) => {
    const slug = slugRootKey(name);
    let key = slug;
    for (let suffix = 2; taken.has(key); suffix += 1) key = `${slug}-${suffix}`;
    taken.add(key);
    return RootKey.make(key);
  });
};

export interface RootAddress {
  /** Null for a bare path, which belongs to whichever root the reader starts from. */
  readonly root: RootKey | null;
  readonly path: string;
  readonly anchor: string | null;
}

/**
 * Reads `<rootKey>:<path>#<anchor>`. A prefix is a root only when it is exactly one of `keys`, so
 * `[[Note: subtitle]]` stays a bare path.
 */
export const parseRootAddress = (address: string, keys: Iterable<RootKey>): RootAddress => {
  const hash = address.indexOf("#");
  const body = hash === -1 ? address : address.slice(0, hash);
  const anchor = hash === -1 ? null : address.slice(hash + 1);
  const colon = body.indexOf(":");
  const prefix = colon > 0 ? body.slice(0, colon) : null;
  const root = prefix === null ? undefined : [...keys].find((key) => key === prefix);
  return root === undefined
    ? { root: null, path: body, anchor }
    : { root, path: body.slice(colon + 1), anchor };
};

export const formatRootAddress = (address: RootAddress): string =>
  `${address.root === null ? "" : `${address.root}:`}${address.path}${
    address.anchor === null ? "" : `#${address.anchor}`
  }`;

export const projectRootId = (projectId: ProjectId, rootKey: RootKey): ProjectRootId =>
  ProjectRootId.make(`${encodeURIComponent(projectId)}:${encodeURIComponent(rootKey)}`);

const isProjectId = Schema.is(ProjectId);
const isRootKey = Schema.is(RootKey);

export const parseProjectRootId = (
  id: string,
): { readonly projectId: ProjectId; readonly rootKey: RootKey } | null => {
  const parts = id.split(":");
  if (parts.length !== 2) return null;
  try {
    const projectId = decodeURIComponent(parts[0]!);
    const rootKey = decodeURIComponent(parts[1]!);
    return isProjectId(projectId) && isRootKey(rootKey) ? { projectId, rootKey } : null;
  } catch {
    return null;
  }
};
