/* oxlint-disable t3code/no-untranslated-copy -- Astrolabe-only copy, shipped in English. */
import type { WikiEditorCommand, WikiEditorEvent } from "@mercurian/wiki-editor/protocol";
import { StackActions, useNavigation } from "@react-navigation/native";
import { WIKI_BASE_AUTOSAVE_DELAY_MS } from "@t3tools/client-runtime/wikiAutosave";
import { withUnsentEdit } from "@t3tools/client-runtime/wikiBaseEdits";
import {
  documentTitle,
  filesHoldDocument,
  isSettledChangeRequest,
  wikiDocumentScope,
  wikiDraft,
  wikiTerms,
} from "@t3tools/client-runtime/wikiLogic";
import type { WikiBaseEdit } from "@t3tools/contracts";
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { use, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { Linking, View } from "react-native";

import { Toolbar } from "../../components/ui/Toolbar";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { useEnvironmentQuery } from "../../state/query";
import { wikiEnvironment } from "../../state/wiki";
import { useEditorTheme } from "./document/useEditorTheme";
import { wikiDocumentSubtitle } from "./document/wikiDocument.logic";
import type { WikiBaseAnswer } from "./document/WikiBaseQueries";
import { WikiDraftBar } from "./document/WikiDraftBar";
import { WikiEditorWebView, type WikiEditorHandle } from "./document/WikiEditorWebView";
import { WikiBelowHeader } from "./document/WikiBelowHeader";
import { WikiNotice } from "./document/WikiNotice";
import { openProjectLink } from "./document/openProjectLink";
import { useProjectLinkRoots, type ProjectDocument } from "./document/useProjectDocument";
import {
  useWikiAutosave,
  useWikiAutosaveCommand,
  useWikiDiskCommands,
  wikiSaveLabel,
} from "./document/useWikiAutosave";
import type { WikiDocumentParams } from "./wikiRoutes";

/**
 * A `.base` file on its own, drawn by the editor page as a ```base block in a note is, with the
 * header's View menu picking among its views. A note's cell edits in place, and a board's card
 * moves with its picker; edits show at once and save by themselves, to the change request the
 * route names, else the person's draft, or on disk in the folder when that is where edits go.
 */
export function WikiBaseScreen({
  params,
  doc,
}: {
  readonly params: WikiDocumentParams;
  readonly doc: ProjectDocument;
}) {
  const navigation = useNavigation();
  const { environmentId, wikiId, routeChangeRequestId, disk, placement } = doc;
  const file = params.name;
  const onDisk = disk === null ? {} : { checkout: disk };
  const changeRequests = useEnvironmentQuery(
    disk === null ? wikiEnvironment.changeRequests({ environmentId, input: { wikiId } }) : null,
  );
  const all = changeRequests.data?.changeRequests;
  const draft = wikiDraft(all);
  const changeRequestId = wikiDocumentScope({
    tabChangeRequestId: routeChangeRequestId,
    draft,
    file,
  });
  const scope = changeRequestId === undefined ? {} : { changeRequestId };

  const index = useEnvironmentQuery(
    wikiEnvironment.index({ environmentId, input: { wikiId, ...scope, ...onDisk } }),
  );
  const linkRoots = useProjectLinkRoots({
    environmentId,
    projectId: doc.projectId,
    roots: doc.roots,
    rootKey: doc.rootKey,
    ownIndex: index.data,
    disk: disk !== null,
  });
  const [view, setView] = useState<string | null>(null);
  const [edits, setEdits] = useState<ReadonlyArray<WikiBaseEdit>>([]);
  const [savedCommit, setSavedCommit] = useState<string | null>(null);
  const canDraft = useAtomValue(wikiEnvironment.autosave.permissionAtom(environmentId));
  const canWriteDisk = useAtomValue(wikiEnvironment.transform.permissionAtom(environmentId));
  const canEdit = disk === null ? canDraft : canWriteDisk;
  const viewing = all?.find((entry) => entry.changeRequestId === changeRequestId) ?? null;
  const editable = canEdit && !isSettledChangeRequest(viewing ?? undefined);
  const viewInput = {
    wikiId,
    ...scope,
    ...onDisk,
    base: file,
    ...(view === null ? {} : { view }),
  };
  const query = useEnvironmentQuery(
    wikiEnvironment.query({
      environmentId,
      input: { ...viewInput, ...(edits.length ? { edits: [...edits] } : {}) },
    }),
  );
  const registry = use(RegistryContext);
  const wikis = useEnvironmentQuery(wikiEnvironment.list({ environmentId, input: {} }));
  const wiki = wikis.data?.wikis.find((entry) => entry.wikiId === wikiId) ?? null;

  // A view switch keeps the last view, and the View menu, until the next one lands.
  const [lastResult, setLastResult] = useState(query.data);
  const [saved, setSaved] = useState({ commit: savedCommit, before: lastResult?.commit ?? null });
  if (saved.commit !== savedCommit) {
    setSaved({ commit: savedCommit, before: lastResult?.commit ?? null });
  }
  // Saved edits leave the overlay here, and a read from before them would flash them undone.
  const current = query.data?.commit === saved.before ? null : query.data;
  if (current !== null && current !== lastResult) setLastResult(current);
  const result = current ?? lastResult;

  const send = useWikiAutosaveCommand();
  const writeDisk = useWikiDiskCommands();
  // How many edits are on their way; those can't merge with a new one any more.
  const sent = useRef(0);
  const { autosave, status } = useWikiAutosave({
    subject: documentTitle(file),
    delayMs: WIKI_BASE_AUTOSAVE_DELAY_MS,
    save: async () => {
      const batch = edits;
      if (batch.length === 0) return { ok: true };
      sent.current = batch.length;
      const transform = { kind: "base-edits" as const, edits: [...batch] };
      const outcome =
        disk === null
          ? await send({
              environmentId,
              input: {
                wikiId,
                ...(routeChangeRequestId === undefined
                  ? {}
                  : { changeRequestId: routeChangeRequestId }),
                document: file,
                write: { kind: "transform", transform },
              },
            })
          : await writeDisk.transform({
              environmentId,
              input: { wikiId, checkout: disk, message: `Edit ${documentTitle(file)}`, transform },
            });
      sent.current = 0;
      if (!outcome.ok) return outcome;
      if ("commit" in outcome.value) setSavedCommit(outcome.value.commit);
      // On disk no commit says the save landed: the view without the edits reads the folder again.
      else registry.refresh(wikiEnvironment.query({ environmentId, input: viewInput }));
      setEdits((waiting) => waiting.slice(batch.length));
      return { ok: true };
    },
  });
  const held = query.error !== null;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- edits that can't run hold the autosave store, which lives outside React
  useEffect(() => autosave.setHeld(held), [autosave, held]);

  const editor = useRef<WikiEditorHandle>(null);
  const theme = useEditorTheme();
  const answer = useMemo<WikiBaseAnswer | null>(
    () =>
      query.error !== null
        ? { result: null, error: query.error }
        : result !== null
          ? { result, error: null }
          : null,
    [result, query.error],
  );
  const shown = useRef({ theme, answer, editable });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a reloaded web view reads the latest theme and view
  useLayoutEffect(() => {
    shown.current = { theme, answer, editable };
  });
  const initialCommands = useCallback((): WikiEditorCommand[] => {
    const current = shown.current;
    return [
      { type: "theme", theme: current.theme },
      { type: "showBase", source: file, editable: current.editable },
      ...(current.answer ? [{ type: "baseResult" as const, source: file, ...current.answer }] : []),
    ];
  }, [file]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the theme crosses into the web view, outside React
  useEffect(() => {
    editor.current?.send({ type: "theme", theme });
  }, [theme]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- each answer crosses into the web view, outside React
  useEffect(() => {
    if (answer) editor.current?.send({ type: "baseResult", source: file, ...answer });
  }, [answer, file]);

  const onEvent = (event: WikiEditorEvent) => {
    switch (event.type) {
      case "queryBase":
        if (shown.current.answer) {
          editor.current?.send({ type: "baseResult", source: file, ...shown.current.answer });
        }
        return;
      case "openNote":
        openProjectLink({
          roots: linkRoots,
          params,
          target: event.name,
          from: event.from ?? file,
          placement,
          open: (next) => navigation.dispatch(StackActions.push("ProjectDocument", next)),
        });
        return;
      case "openUrl":
        void Linking.openURL(event.href).catch(() => undefined);
        return;
      case "editBase": {
        const frozen = sent.current;
        setEdits((waiting) =>
          withUnsentEdit(waiting, frozen, {
            kind: "property",
            file: event.file,
            property: event.property,
            value: event.value,
          }),
        );
        autosave.edited();
        return;
      }
      case "error":
        console.warn("The wiki editor page failed:", event.message);
        return;
      default:
        return;
    }
  };

  const subtitle = [
    wikiDocumentSubtitle({
      wikiName: doc.root?.name ?? wiki?.name ?? null,
      file: file,
      changeRequest: viewing,
      readsChangeRequest: changeRequestId !== undefined,
      onDisk: disk !== null,
      noun: wikiTerms(wiki).singular,
      agentWorking: false,
      saving: wikiSaveLabel(status),
    }),
    editable ? "Base" : "Base · read only",
  ].join(" · ");
  const views = result?.views ?? [];
  const shownView = result?.view.name ?? null;

  return (
    <View className="flex-1 bg-screen">
      <NativeStackScreenOptions
        options={{ title: documentTitle(file), unstable_headerSubtitle: subtitle }}
        optionsVersion={`${subtitle}|${views.join("\n")}|${shownView}`}
      />
      {views.length > 1 ? (
        // Direct children only: the toolbar reads its items by component, not through fragments.
        <Toolbar placement="right">
          <Toolbar.Menu icon="rectangle.stack" accessibilityLabel="View" title="View">
            {views.map((name) => (
              <Toolbar.MenuAction
                key={name}
                isOn={name === shownView}
                onPress={() => setView(name)}
              >
                <Toolbar.Label>{name}</Toolbar.Label>
              </Toolbar.MenuAction>
            ))}
          </Toolbar.Menu>
        </Toolbar>
      ) : null}
      <WikiBelowHeader>
        {draft !== null && (routeChangeRequestId === undefined || viewing?.draft) ? (
          <WikiDraftBar
            environmentId={environmentId}
            draft={draft}
            flush={autosave.flush}
            drop={() => {
              setEdits([]);
              autosave.cancel();
            }}
            onLanded={(id, files) => {
              // The document on screen follows where its edits went.
              if (filesHoldDocument(files, file)) navigation.setParams({ changeRequestId: id });
            }}
          />
        ) : null}
        {status.kind === "failed" ? (
          <WikiNotice
            text={`Your changes aren't saved. ${status.message}${status.retrying ? " Still trying." : ""}`}
            action="Try again"
            onAction={autosave.retry}
          />
        ) : null}
      </WikiBelowHeader>
      <WikiEditorWebView ref={editor} onEvent={onEvent} initialCommands={initialCommands} />
    </View>
  );
}
