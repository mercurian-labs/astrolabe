import { isWikiDocument, isWikiPath } from "@mercurian/wiki/resolve-link";
import { type ProjectId, projectRootId, type ProjectRootCheckout } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { useGT } from "gt-react";
import { useId, useState, useSyncExternalStore, type FormEvent } from "react";

import {
  getLocalStorageItem,
  removeLocalStorageItem,
  setLocalStorageItem,
} from "~/hooks/useLocalStorage";
import { allTabs, replaceTab } from "~/panes/arrangement";
import { hasUnsavedEdits } from "~/panes/unsavedEdits";
import { workspace } from "~/panes/workspace";
import { projectRootsEnvironment } from "~/state/projectRoots";
import { useEnvironmentQuery } from "~/state/query";
import { wikiEnvironment } from "~/state/wiki";
import { useProjectWorktrees } from "~/state/worktrees";
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
import { toastManager } from "../ui/toast";
import { canvasReadOnlyKey } from "../wiki/wikiCanvasBoards";
import { useWikiCommand } from "../wiki/wikiEnvironment";
import { locateProjectDocument, projectDocumentOwner } from "./projectDocument";
import {
  parseRepositoryTabKey,
  repositoryTabKey,
  sameCheckout,
  tabFolder,
  type RepositoryFileTab,
} from "./repositoryTabs";

/** A document or folder to move, as a Projects tree or file tab shows it. */
export interface ProjectMoveRequest {
  /** Its path in the tab's checkout. */
  readonly tab: RepositoryFileTab;
  readonly folder: boolean;
}

let requested: ProjectMoveRequest | null = null;
const listeners = new Set<() => void>();

/** Opens the dialog, from a tree row's menu or the command palette. */
export function requestProjectMove(next: ProjectMoveRequest | null) {
  requested = next;
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Whether a tree row moves with its links: a note, canvas or base, or a folder that may hold one. */
export const movesWithLinks = (path: string, isDirectory: boolean) =>
  isDirectory || isWikiDocument(path);

/** Where `path` goes when `from` moves to `to`; null when it stays. */
const movedPath = (path: string, from: string, to: string, folder: boolean) =>
  folder
    ? path.startsWith(`${from}/`)
      ? `${to}${path.slice(from.length)}`
      : null
    : path === from
      ? to
      : null;

const extensionOf = (file: string) => /\.[^./]+$/.exec(file)?.[0] ?? "";

/**
 * Astrolabe: moves or renames a project's document or folder by typing where it goes, with every
 * link to it in the project's folders following. Open tabs on what moved follow it.
 */
export function ProjectMoveDialog() {
  const request = useSyncExternalStore(subscribe, () => requested);
  const onClose = () => requestProjectMove(null);
  return (
    <Dialog open={request !== null} onOpenChange={(open) => !open && onClose()}>
      {request === null ? null : (
        <DialogPopup className="sm:max-w-md">
          <ProjectMoveForm
            key={repositoryTabKey(request.tab)}
            request={request}
            onClose={onClose}
          />
        </DialogPopup>
      )}
    </Dialog>
  );
}

function ProjectMoveForm({
  request,
  onClose,
}: {
  readonly request: ProjectMoveRequest;
  readonly onClose: () => void;
}) {
  const gt = useGT();
  const { tab } = request;
  const owner = projectDocumentOwner(tab);
  const listed = useEnvironmentQuery(
    owner === null
      ? null
      : projectRootsEnvironment.list({
          environmentId: tab.environmentId,
          input: { projectId: owner.projectId },
        }),
  );
  const worktrees = useProjectWorktrees(
    "branch" in tab.checkout
      ? {
          environmentId: tab.environmentId,
          ...("wikiId" in tab ? { wikiId: tab.wikiId } : { projectId: tab.projectId }),
        }
      : null,
  );
  const cwd = tabFolder(tab, worktrees.data?.worktrees ?? null);
  const roots = listed.data?.roots ?? null;
  const located =
    owner === null || roots === null || cwd === null
      ? null
      : locateProjectDocument(roots, owner.rootKey, cwd, tab.path);
  // A branch's folder is known once its worktrees are read; then a tab in no root is refused.
  const unplaced = roots !== null && located === null && (cwd !== null || worktrees.data !== null);
  if (owner === null || listed.error !== null || unplaced) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>{gt("This can't be moved here")}</DialogTitle>
          <DialogDescription>
            {listed.error ?? gt("It isn't in any of the project's folders.")}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {gt("Close")}
          </Button>
        </DialogFooter>
      </>
    );
  }
  if (located === null || cwd === null || roots === null) return null;
  return (
    <MoveForm
      request={request}
      projectId={owner.projectId}
      roots={roots}
      root={located.root}
      from={located.file}
      checkout={located.checkout}
      prefix={located.prefix}
      onClose={onClose}
    />
  );
}

function MoveForm({
  request,
  projectId,
  roots,
  root,
  from,
  checkout,
  prefix,
  onClose,
}: {
  readonly request: ProjectMoveRequest;
  readonly projectId: ProjectId;
  readonly roots: ReadonlyArray<ProjectRootCheckout>;
  readonly root: ProjectRootCheckout;
  /** Its path from the root. */
  readonly from: string;
  readonly checkout: string;
  /** The root's folder from the tab's, "" when they're one. */
  readonly prefix: string;
  readonly onClose: () => void;
}) {
  const gt = useGT();
  const { tab, folder } = request;
  const move = useWikiCommand(wikiEnvironment.move, gt("Couldn't move it"));
  const id = useId();
  const [path, setPath] = useState(from);
  const [busy, setBusy] = useState(false);
  const typed = path.trim().replace(/^\/+|\/+$/g, "");
  const to = folder || isWikiDocument(typed) ? typed : `${typed}${extensionOf(from)}`;
  const canMove = to !== from && isWikiPath(to);
  const inTab = (file: string) => (prefix === "" ? file : `${prefix}/${file}`);
  const wikiId = projectRootId(projectId, root.key);

  const followingTabs = () => {
    const arrangement = workspace.store.getSnapshot()?.arrangement;
    return (arrangement === undefined ? [] : allTabs(arrangement)).flatMap((key) => {
      const open = parseRepositoryTabKey(key);
      if (open?.kind !== "file" || !sameCheckout(open, tab)) return [];
      const next = movedPath(open.path, inTab(from), inTab(to), folder);
      return next === null ? [] : [{ key, next: repositoryTabKey({ ...open, path: next }) }];
    });
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canMove || busy) return;
    const moving = followingTabs();
    if (moving.some(({ key }) => hasUnsavedEdits(key))) {
      toastManager.add({
        type: "error",
        title: gt("Couldn't move it"),
        description: gt("An open document's edits haven't saved yet."),
      });
      return;
    }
    setBusy(true);
    const outcome = await move({
      environmentId: tab.environmentId,
      input: { wikiId, checkout, from, to, ...(folder ? { folder: true } : {}) },
    });
    setBusy(false);
    if (!outcome.ok) return;
    workspace.store.update((arrangement) =>
      moving.reduce((next, each) => replaceTab(next, each.key, each.next), arrangement),
    );
    followReadOnly(wikiId, from, to, folder);
    const nameOf = (key: string) => roots.find((each) => each.key === key)?.name ?? key;
    const { unchanged, savedTo } = outcome.value;
    if (unchanged.length > 0) {
      toastManager.add({
        type: "warning",
        title: gt("Moved, but some links still lead to {place}", { place: from }),
        description: gt("{folders} can't be written here, so their links were left as they were.", {
          folders: unchanged.map((each) => nameOf(each.rootKey)).join(", "),
        }),
      });
    } else if (savedTo === "draft") {
      toastManager.add({
        type: "success",
        title: gt("Moved in your draft"),
        description: gt("It moves in {place} when your pull request merges.", {
          place: root.name,
        }),
      });
    }
    onClose();
  };

  return (
    <form className="flex min-h-0 flex-col" onSubmit={submit}>
      <DialogHeader>
        <DialogTitle>{folder ? gt("Move folder") : gt("Move or rename document")}</DialogTitle>
        <DialogDescription>
          {gt("The path from the top of {place}. Links to it across the project follow.", {
            place: root.name,
          })}
        </DialogDescription>
      </DialogHeader>
      <DialogPanel>
        <div className="flex flex-col gap-2">
          <Label htmlFor={id}>{gt("Path")}</Label>
          <Input
            id={id}
            autoFocus
            value={path}
            onChange={(event) => setPath(event.target.value)}
            spellCheck={false}
          />
        </div>
      </DialogPanel>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          {gt("Cancel")}
        </Button>
        <Button type="submit" disabled={!canMove || busy}>
          {gt("Move", { $context: "verb, moves a document" })}
        </Button>
      </DialogFooter>
    </form>
  );
}

const ReadOnlyFlag = Schema.Boolean;

/** A canvas's read-only choice on this device goes where it went. */
function followReadOnly(wikiId: string, from: string, to: string, folder: boolean) {
  if (folder || !/\.canvas$/i.test(from)) return;
  try {
    if (getLocalStorageItem(canvasReadOnlyKey(wikiId, from), ReadOnlyFlag) !== true) return;
    setLocalStorageItem(canvasReadOnlyKey(wikiId, to), true, ReadOnlyFlag);
    removeLocalStorageItem(canvasReadOnlyKey(wikiId, from));
  } catch {
    // Storage this device refuses keeps no choice to carry.
  }
}
