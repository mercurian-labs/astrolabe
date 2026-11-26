import { useAtomValue } from "@effect/atom-react";
import { WikiLinkPreview, type WikiLinkPeek } from "@mercurian/wiki-editor/link-tools";
import { rootPrefix, unwrittenProjectFile, type ProjectFile } from "@mercurian/wiki/resolve-link";
import { projectDocEditTarget } from "@t3tools/client-runtime/projectDocEditTarget";
import type { WikiSaveOutcome } from "@t3tools/client-runtime/wikiAutosave";
import {
  documentPath,
  exactWikiPath,
  linkedFilePath,
  projectWikiLinkOptions,
  resolveProjectWikiLink,
  wikiDocumentScope,
  wikiDraft,
  wikiLinkOpens,
} from "@t3tools/client-runtime/wikiLogic";
import {
  AuthFilesystemWriteScope,
  projectRootId,
  WikiId,
  type EnvironmentId,
  type ProjectId,
  type ProjectRootCheckout,
  type RootKey,
  type WikiReadScope,
} from "@t3tools/contracts";
import { useGT } from "gt-react";
import { useContext } from "react";

import { PanesHostContext } from "~/panes/panesHost";
import { activateTab, allTabs, openTab } from "~/panes/arrangement";
import { recordJump } from "~/panes/jumpHistory";
import { leafWithTab } from "~/panes/tree";
import { registerUnsavedCheck } from "~/panes/unsavedEdits";
import { workspace } from "~/panes/workspace";
import { projectEnvironment } from "~/state/projects";
import { projectIndexesAtom, projectRootsEnvironment } from "~/state/projectRoots";
import { useEnvironmentQuery } from "~/state/query";
import { useEnvironmentScope } from "~/state/session";
import { useAtomCommand } from "~/state/use-atom-command";
import { wikiEnvironment } from "~/state/wiki";
import { useProjectWorktrees, useWorktreeWatch, type WorktreesTarget } from "~/state/worktrees";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";
import { useWikiPlacement } from "../wiki/wikiEnvironment";
import { useWikiTreeView } from "../wiki/wikiTreeView";
import { wikiTabKey } from "../wiki/wikiTabs";
import { WikiBasePage } from "../wiki/WikiBaseView";
import { WikiNoteView, type ProjectNoteLinks, type WikiDraftEdits } from "../wiki/WikiNoteView";
import {
  locateProjectDocument,
  projectBacklinks,
  projectDocumentOwner,
  projectDocumentTab,
  type LocatedDocument,
  type ProjectIndexes,
} from "./projectDocument";
import { ProjectDraftPill } from "./ProjectDraftPill";
import { repositoryTabKey, type CheckedOutRepositoryTab } from "./repositoryTabs";

type FileTab = Extract<CheckedOutRepositoryTab, { kind: "file" }>;

const rootWikiId = (projectId: ProjectId, key: RootKey) =>
  WikiId.make(projectRootId(projectId, key));

/** The worktrees a root's checkouts are among: the project's own for its folder. */
const rootWorktrees = (
  environmentId: EnvironmentId,
  projectId: ProjectId,
  root: ProjectRootCheckout,
): WorktreesTarget =>
  root.kind === "workspace"
    ? { environmentId, projectId }
    : { environmentId, wikiId: rootWikiId(projectId, root.key) };

/** A document's place as a person reads it: `root:path` outside the root it's read from. */
const addressOf = (file: ProjectFile, fromRoot: string) =>
  file.root === fromRoot ? file.file : `${file.root}:${file.file}`;

/**
 * Astrolabe: a note or base in a Projects file tab, in the wiki's editors. Its root, path and
 * checkout come from the tab; its links reach every root of the project. A hosted repository's main checkout on
 * its default branch saves to the person's draft, opened as a pull request when they ask; every
 * other checkout saves on disk (`projectDocEditTarget`).
 */
export default function ProjectDocumentView({
  tabKey,
  tab,
}: {
  readonly tabKey: string;
  readonly tab: FileTab;
}) {
  const gt = useGT();
  const owner = projectDocumentOwner(tab);
  const environmentId = tab.environmentId;
  const listed = useEnvironmentQuery(
    owner === null
      ? null
      : projectRootsEnvironment.list({ environmentId, input: { projectId: owner.projectId } }),
  );
  const roots = listed.data?.roots ?? null;
  const located =
    owner === null || roots === null
      ? null
      : locateProjectDocument(roots, owner.rootKey, tab.cwd, tab.path);
  const root = located?.root ?? null;
  // Only a hosted repository can draft; its worktrees and default branch say whether this one does.
  const asks = root !== null && root.state === "git" && root.hostBacked;
  const worktrees = useProjectWorktrees(
    asks && owner !== null ? rootWorktrees(environmentId, owner.projectId, root) : null,
  );
  const wikis = useEnvironmentQuery(
    asks ? wikiEnvironment.list({ environmentId, input: {} }) : null,
  );
  if (owner === null || listed.error !== null || (roots !== null && located === null)) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{gt("This document can't be opened here")}</EmptyTitle>
          <EmptyDescription>
            {listed.error ?? gt("It isn't in any of the project's folders.")}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  if (located === null || (asks && (worktrees.data === null || wikis.data === null))) {
    return (
      <Empty>
        <Spinner size="md" tone="muted" />
      </Empty>
    );
  }
  const worktree = worktrees.data?.worktrees.find((each) => each.path === located.checkout) ?? null;
  const defaultBranch =
    wikis.data?.wikis.find(
      (wiki) => wiki.projectId === owner.projectId && wiki.rootKey === located.root.key,
    )?.mainBranch ?? null;
  const target = projectDocEditTarget({
    root: located.root,
    checkout: located.checkout,
    onDefaultBranch:
      worktree !== null &&
      worktree.isMain &&
      worktree.branch !== null &&
      worktree.branch === defaultBranch,
    file: located.file,
  });
  const route = target.kind === "draft" ? "draft" : "disk";
  return (
    <ProjectDocument
      // A tab moved to another checkout or route is another document.
      key={`${located.root.key}\0${located.checkout}\0${route}`}
      tabKey={tabKey}
      tab={tab}
      projectId={owner.projectId}
      roots={roots ?? []}
      located={located}
      route={route}
    />
  );
}

function ProjectDocument({
  tabKey,
  tab,
  projectId,
  roots,
  located,
  route,
}: {
  readonly tabKey: string;
  readonly tab: FileTab;
  readonly projectId: ProjectId;
  readonly roots: ReadonlyArray<ProjectRootCheckout>;
  readonly located: LocatedDocument;
  readonly route: "draft" | "disk";
}) {
  const gt = useGT();
  const { environmentId } = tab;
  const { root, file, checkout } = located;
  const wikiId = rootWikiId(projectId, root.key);
  const changeRequests = useEnvironmentQuery(
    route === "draft" ? wikiEnvironment.changeRequests({ environmentId, input: { wikiId } }) : null,
  );
  const all = changeRequests.data?.changeRequests ?? null;
  const draft = route === "draft" ? wikiDraft(all) : null;
  const draftScope = wikiDocumentScope({ tabChangeRequestId: undefined, draft, file });
  // The same input the note's own view reads, so the two share one query.
  const ownRead: WikiReadScope =
    route === "disk"
      ? { wikiId, checkout }
      : draftScope === undefined
        ? { wikiId }
        : { wikiId, changeRequestId: draftScope };
  const readOf = (each: ProjectRootCheckout): WikiReadScope =>
    each.key === root.key
      ? ownRead
      : { wikiId: rootWikiId(projectId, each.key), checkout: each.path };
  const reads = roots
    .filter((each) => each.state !== "missing")
    .map((each) => ({ key: each.key, input: readOf(each) }));
  const indexed = useAtomValue(projectIndexesAtom(JSON.stringify({ environmentId, reads })));
  const indexes: ProjectIndexes = new Map(
    indexed.flatMap(([key, index]) => (index === null ? [] : [[key, index] as const])),
  );
  const { showHidden } = useWikiTreeView();
  const placement = useWikiPlacement(environmentId);
  const canWriteFiles = useEnvironmentScope(environmentId, AuthFilesystemWriteScope);
  const writeFile = useAtomCommand(projectEnvironment.writeFile, { reportFailure: false });
  const watch = useWorktreeWatch(
    route === "disk" ? rootWorktrees(environmentId, projectId, root) : null,
    checkout,
  );

  const panes = useContext(PanesHostContext)?.controller ?? workspace.store;
  const openKey = (key: string) => {
    recordJump(tabKey, key);
    panes.update((arrangement) =>
      allTabs(arrangement).includes(key)
        ? activateTab(arrangement, key)
        : openTab(arrangement, key, leafWithTab(arrangement.root, tabKey)?.id),
    );
  };
  const openDocument = (target: ProjectFile) => {
    const next = projectDocumentTab({
      environmentId,
      projectId,
      roots,
      target,
      current: { owner: tab, checkout: tab.checkout, located },
    });
    if (next === null) {
      toastManager.add({
        type: "warning",
        title: gt("{place} isn't on disk", { place: addressOf(target, root.key) }),
      });
      return;
    }
    openKey(repositoryTabKey(next));
  };
  const ambiguity = (matches: ReadonlyArray<ProjectFile>) =>
    gt("Fits {places}. Put a folder's name first, as {example}, to choose one.", {
      places: matches.map((match) => `${match.root}:${documentPath(match.file)}`).join(", "),
      example: `${matches[0]?.root ?? root.key}:${documentPath(matches[0]?.file ?? file)}`,
    });
  const landing = (target: string, from: string = file) =>
    resolveProjectWikiLink(indexes, target, { root: root.key, file: from });
  const openLink = (target: string, from?: string) => {
    // A whole path to a code file opens that file, never a note to write.
    const linked = linkedFilePath(target);
    if (linked !== null) return openDocument({ root: root.key, file: linked });
    const found = landing(target, from);
    if (found.file !== null) return openDocument(found.file);
    if (found.ambiguous.length > 0) {
      toastManager.add({
        type: "warning",
        title: gt("{name} could mean several documents", { name: target }),
        description: ambiguity(found.ambiguous),
      });
      return;
    }
    // A new note goes in the root the link names, else this note's own (ruling 8).
    const named = rootPrefix(target, indexes);
    const unwritten =
      named === null
        ? wikiLinkOpens(indexes.get(root.key) ?? null, target, from ?? file, placement)
        : unwrittenProjectFile(target, { root: root.key, file: from ?? file }, indexes).file;
    if (unwritten === null) {
      toastManager.add({
        type: "warning",
        title: gt("This link says where it is from here, so no note can be made from it."),
      });
      return;
    }
    openDocument({ root: named?.root ?? root.key, file: unwritten });
  };

  const projectLinks: ProjectNoteLinks = {
    options: projectWikiLinkOptions(indexes, root.key, showHidden),
    resolve: (target) => {
      const found = landing(target);
      return {
        file: found.file === null ? null : addressOf(found.file, root.key),
        others: found.others.map((each) => addressOf(each, root.key)),
        ambiguous: found.ambiguous.map((each) => addressOf(each, root.key)),
      };
    },
    incoming: projectBacklinks(indexes, { root: root.key, file }).map((source) => ({
      key: `${source.root}:${source.file}`,
      title: addressOf({ ...source, file: documentPath(source.file) }, root.key),
      open: () => openDocument(source),
    })),
    renderPreview: (link) => (
      <ProjectLinkPreview
        environmentId={environmentId}
        link={link}
        found={landing(link.name)}
        readOf={(key) => {
          const each = roots.find((candidate) => candidate.key === key);
          return each === undefined ? null : readOf(each);
        }}
        ambiguity={ambiguity}
        onOpen={() => openLink(link.name)}
      />
    ),
    ambiguousMeta: gt("Ambiguous", { $context: "a link that fits several documents" }),
  };

  if (route === "draft" && all === null && changeRequests.error === null) {
    return (
      <Empty>
        <Spinner size="md" tone="muted" />
      </Empty>
    );
  }
  const title = documentPath(file);
  const location = located.prefix === "" ? tab.checkoutName : root.name;
  const registerUnsaved = (check: () => boolean, save: () => Promise<boolean>) =>
    registerUnsavedCheck(tabKey, check, save);
  const diskRevision = String(watch?.changes ?? 0);
  const renderDraftPill = (edits: WikiDraftEdits) =>
    draft === null ? null : (
      <ProjectDraftPill
        environmentId={environmentId}
        projectId={projectId}
        draft={draft}
        changeRequests={all ?? []}
        edits={edits}
        onOpenDraft={() =>
          openKey(
            wikiTabKey({
              kind: "change-request",
              environmentId,
              wikiId,
              changeRequestId: draft.changeRequestId,
            }),
          )
        }
        onOpenTab={openKey}
      />
    );
  if (/\.base$/i.test(file)) {
    return (
      <WikiBasePage
        environmentId={environmentId}
        wikiId={wikiId}
        file={file}
        changeRequestId={route === "draft" ? draftScope : undefined}
        savesTo={undefined}
        changeRequests={all ?? []}
        parent={location}
        registerUnsaved={registerUnsaved}
        onOpenNote={openLink}
        onOpenFile={(path) => openDocument({ root: root.key, file: path })}
        {...(route === "disk"
          ? { checkout, canWrite: canWriteFiles, diskRevision }
          : { renderDraftPill })}
      />
    );
  }
  const saveText = async (path: string, text: string): Promise<WikiSaveOutcome> => {
    const result = await writeFile({
      environmentId,
      input: { cwd: checkout, relativePath: path, contents: text },
    });
    return result._tag === "Success"
      ? { ok: true }
      : { ok: false, message: gt("The file couldn't be written. Try again."), retry: true };
  };
  return (
    <WikiNoteView
      environmentId={environmentId}
      wikiId={wikiId}
      file={file}
      changeRequestId={route === "draft" ? draftScope : undefined}
      savesTo={undefined}
      changeRequests={all ?? []}
      location={location}
      onOpenNote={openLink}
      registerUnsaved={registerUnsaved}
      projectLinks={projectLinks}
      {...(route === "disk"
        ? {
            checkout,
            saveText,
            canWrite: canWriteFiles,
            diskRevision,
            notWritten: gt(
              "No note is called {title} yet. Write it here, and it saves in {place}.",
              {
                title,
                place: location,
              },
            ),
          }
        : {
            notWritten: gt(
              "No note is called {title} yet. Write it here, and it saves to your draft for a pull request.",
              { title },
            ),
            renderDraftPill,
          })}
    />
  );
}

/** A link's preview across a project: the document it lands on, read from its own root. */
function ProjectLinkPreview({
  environmentId,
  link,
  found,
  readOf,
  ambiguity,
  onOpen,
}: {
  readonly environmentId: EnvironmentId;
  readonly link: WikiLinkPeek;
  readonly found: ReturnType<typeof resolveProjectWikiLink>;
  readonly readOf: (root: string) => WikiReadScope | null;
  readonly ambiguity: (matches: ReadonlyArray<ProjectFile>) => string;
  readonly onOpen: () => void;
}) {
  const read = found.file === null ? null : readOf(found.file.root);
  const { data } = useEnvironmentQuery(
    read === null || found.file === null
      ? null
      : wikiEnvironment.note({
          environmentId,
          input: { ...read, name: exactWikiPath(found.file.file) },
        }),
  );
  if (found.ambiguous.length > 0) {
    return (
      <WikiLinkPreview link={link} source={undefined}>
        <p className="m-0 text-muted-foreground">{ambiguity(found.ambiguous)}</p>
      </WikiLinkPreview>
    );
  }
  // A red link previews as not written; a found one as its text once read.
  const source =
    found.file === null ? null : data === null ? undefined : data.exists ? data.source : null;
  return <WikiLinkPreview link={link} source={source} onOpen={onOpen} />;
}
