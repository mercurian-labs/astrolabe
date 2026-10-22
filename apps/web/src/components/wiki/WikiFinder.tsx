import type { WikiOverview } from "@t3tools/client-runtime/state/wiki";
import { useAtomValue } from "@effect/atom-react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { FilePenLineIcon, FilePlusIcon, FileTextIcon } from "lucide-react";

import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import { useState } from "react";

import { primaryServerKeybindingsAtom } from "~/state/server";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import type { CommandPaletteActionItem, CommandPaletteGroup } from "../CommandPalette.logic";
import { CommandPaletteContent } from "../CommandPaletteContent";
import { CommandPaletteResults } from "../CommandPaletteResults";
import { CommandDialog, CommandDialogPopup } from "../ui/command";
import { isWikisPath } from "../sidebar/mainAppLocation";
import { noteKey } from "./wiki.logic";
import { useWikiOverviews } from "./wikiEnvironment";
import { openWikiTab, showWikiTab } from "./wikiPanes";
import { wikiScopeKey, wikiSidebarItems, type WikiDocumentItem, type WikiTab } from "./wikiTabs";

const RESULT_LIMIT = 60;
const ITEM_ICON_CLASS = "size-4 shrink-0 text-muted-foreground/85";

/**
 * Finds a document to open, as the command palette finds a thread: every wiki's documents and
 * open change requests, filtered by name. A name no document has can be written: in `new`
 * mode that comes first, and the dialog is how a new document starts.
 */
export function WikiFinder({
  open,
  onOpenChange,
  overviews,
  scope,
  mode,
  paneId,
  onPick,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly overviews: ReadonlyArray<WikiOverview>;
  /** The wiki the sidebar is filtered to, whose documents come first and where new ones go. */
  readonly scope: string | null;
  readonly mode: "find" | "new";
  /** The pane a picked document opens in; the focused one by default. */
  readonly paneId?: string;
  /** Astrolabe: where a pick goes instead of the Wikis area, as for a pane in another section. */
  readonly onPick?: (tab: WikiTab) => void;
}) {
  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      {open ? (
        <CommandDialogPopup
          aria-label={mode === "new" ? "New document" : "Find or create a document"}
          className="overflow-hidden"
          onBackdropPointerDown={() => onOpenChange(false)}
        >
          <WikiFinderContent
            overviews={overviews}
            scope={scope}
            mode={mode}
            onPick={(tab) => {
              onOpenChange(false);
              // An empty pane's finder fills that pane; elsewhere a pick shows in the focused
              // pane's tab in front, as a sidebar row's click does.
              if (onPick) onPick(tab);
              else if (paneId === undefined) showWikiTab(tab);
              else openWikiTab(tab, "tab", paneId);
            }}
          />
        </CommandDialogPopup>
      ) : null}
    </CommandDialog>
  );
}

function WikiFinderContent({
  overviews,
  scope,
  mode,
  onPick,
}: {
  readonly overviews: ReadonlyArray<WikiOverview>;
  readonly scope: string | null;
  readonly mode: "find" | "new";
  readonly onPick: (tab: WikiTab) => void;
}) {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const groups = finderGroups({ overviews, scope, mode, query, onPick });
  return (
    <CommandPaletteContent
      aria-label={mode === "new" ? "New document" : "Find or create a document"}
      autoHighlight="always"
      footerActionLabel="Open"
      inputProps={{
        placeholder: mode === "new" ? "Name the new document…" : "Find or create a document…",
      }}
      mode="none"
      onItemHighlighted={(value) => setHighlighted(typeof value === "string" ? value : null)}
      onValueChange={(value) => {
        setHighlighted(null);
        setQuery(value);
      }}
      panelSize="tall-list"
      testId="wiki-finder"
      value={query}
    >
      <CommandPaletteResults
        groups={groups}
        highlightedItemValue={highlighted}
        isActionsOnly={false}
        keybindings={keybindings}
        onExecuteItem={(item) => {
          if (item.kind === "action") void item.run();
        }}
        emptyStateMessage={
          overviews.length === 0
            ? "No wikis yet. Add one from the wiki filter."
            : mode === "new"
              ? "Type the new document's name."
              : "No matching documents."
        }
      />
    </CommandPaletteContent>
  );
}

/** A document as a palette row, which opens it through `onPick`. */
function documentRow(
  document: WikiDocumentItem,
  multipleWikis: boolean,
  onPick: (tab: WikiTab) => void,
): CommandPaletteActionItem {
  return {
    kind: "action",
    value: `wiki-finder:${document.key}`,
    searchTerms: [document.name],
    title: document.name,
    description: [
      multipleWikis ? document.wiki.name : null,
      document.editedAt ? `edited ${formatRelativeTimeLabel(document.editedAt)}` : null,
      document.changes.length > 0 ? "in a change request" : null,
    ]
      .filter(Boolean)
      .join(" · "),
    icon:
      document.changes.length > 0 ? (
        <FilePenLineIcon className={ITEM_ICON_CLASS} />
      ) : (
        <FileTextIcon className={ITEM_ICON_CLASS} />
      ),
    run: async () =>
      onPick({
        kind: "note",
        environmentId: document.environmentId,
        wikiId: document.wiki.wikiId,
        name: document.name,
        changeRequestId: undefined,
      }),
  };
}

/**
 * Astrolabe: every wiki's documents as the Search Palette's rows, newest first, for it to match
 * as it matches threads; a pick shows the document in the Wikis section's tab in front, as `:e`
 * and a sidebar row's click do.
 * Asks for the wikis only while `enabled`, and builds the rows only when they change, not per
 * keystroke.
 */
export function useDocumentSearchRows(enabled: boolean): ReadonlyArray<CommandPaletteActionItem> {
  const { overviews } = useWikiOverviews(enabled);
  const navigate = useNavigate();
  const onWikis = useLocation({ select: (location) => isWikisPath(location.pathname) });
  const { documents } = wikiSidebarItems(overviews, null);
  const onPick = (tab: WikiTab) => {
    showWikiTab(tab);
    if (!onWikis) void navigate({ to: "/wikis" });
  };
  return documents.map((document) => documentRow(document, overviews.length > 1, onPick));
}

/**
 * The finder's groups for a query: documents, change requests, and where to write a new one.
 * The command palette's `:e` shows the same.
 */
export function finderGroups(input: {
  readonly overviews: ReadonlyArray<WikiOverview>;
  readonly scope: string | null;
  readonly mode: "find" | "new";
  readonly query: string;
  readonly onPick: (tab: WikiTab) => void;
}): CommandPaletteGroup[] {
  const { overviews, scope, mode, query, onPick } = input;
  const needle = noteKey(query.trim());
  const multipleWikis = overviews.length > 1;
  const { changes, documents } = wikiSidebarItems(overviews, null);
  // The filtered wiki's documents first, the rest after, each newest first.
  const inScope = (document: WikiDocumentItem) =>
    scope === null || wikiScopeKey(document.environmentId, document.wiki.wikiId) === scope ? 0 : 1;

  const documentItems: CommandPaletteActionItem[] = documents
    .filter((document) => needle === "" || noteKey(document.name).includes(needle))
    .toSorted((a, b) => inScope(a) - inScope(b))
    .slice(0, RESULT_LIMIT)
    .map((document) => documentRow(document, multipleWikis, onPick));

  const changeItems: CommandPaletteActionItem[] =
    mode === "new"
      ? []
      : changes
          .filter((change) => needle === "" || noteKey(change.changeRequest.title).includes(needle))
          .slice(0, RESULT_LIMIT)
          .map((change) => ({
            kind: "action",
            value: `wiki-finder:${change.key}`,
            searchTerms: [change.changeRequest.title],
            title: change.changeRequest.title,
            description: [
              multipleWikis ? change.wiki.name : null,
              `updated ${formatRelativeTimeLabel(change.changeRequest.updatedAt)}`,
            ]
              .filter(Boolean)
              .join(" · "),
            icon: <PullRequestGlyph.pullRequest className={ITEM_ICON_CLASS} />,
            run: async () =>
              onPick({
                kind: "change-request",
                environmentId: change.environmentId,
                wikiId: change.wiki.wikiId,
                changeRequestId: change.changeRequest.changeRequestId,
              }),
          }));

  // A name no document has can be written, in the filtered wiki or any of them.
  const name = query.trim();
  const taken = documents.some((document) => noteKey(document.name) === needle);
  const writeItems: CommandPaletteActionItem[] =
    name === "" || taken
      ? []
      : overviews
          .filter(
            (overview) =>
              scope === null ||
              wikiScopeKey(overview.environmentId, overview.wiki.wikiId) === scope,
          )
          .map((overview) => ({
            kind: "action",
            value: `wiki-finder:write:${overview.environmentId}:${overview.wiki.wikiId}`,
            searchTerms: [name],
            title: `Write “${name}”`,
            description: multipleWikis ? `in ${overview.wiki.name}` : "",
            icon: <FilePlusIcon className={ITEM_ICON_CLASS} />,
            run: async () =>
              onPick({
                kind: "note",
                environmentId: overview.environmentId,
                wikiId: overview.wiki.wikiId,
                name,
                changeRequestId: undefined,
              }),
          }));

  const groups: CommandPaletteGroup[] = [];
  const add = (value: string, label: string, items: CommandPaletteActionItem[]) => {
    if (items.length > 0) groups.push({ value, label, items });
  };
  if (mode === "new") add("write", "New document", writeItems);
  add("documents", "Documents", documentItems);
  add("changes", "Open changes", changeItems);
  if (mode === "find") add("write", "New document", writeItems);
  return groups;
}
