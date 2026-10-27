import "@mercurian/editor/markdown/theme.css";
import "@mercurian/editor/markdown/katex.css";

import { isProviderSkillUserInvocable } from "@t3tools/client-runtime/providerSkills";
import type { AssistantCitation, ClientSettings, ServerProviderSkill } from "@t3tools/contracts";
import { formatProviderSkillDisplayName } from "@t3tools/shared/inlineSkills";
import {
  memo,
  use,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";

import { useMarkdownEditorKeys } from "~/editorKeybindings";
import { useVimScreenLines } from "~/vimScreenLines";
import { useClientSettings } from "~/hooks/useSettings";
import type { AssistantCitationSourceAnchor } from "~/lib/assistantTextSelection";
import { cn } from "~/lib/utils";
import { basenameOfPath } from "~/pierre-icons";
import { AssistantCitationChip } from "../chat/AssistantCitationChip";
import { FileTagChipContent } from "../chat/FileTagChip";
import { getTimelinePageScrollKey } from "../chat/pageScrollController";
import { SkillChipPopover, skillPopoverDescription } from "../chat/SkillInlineText";
import { WorkspaceEntryTooltip } from "../chat/WorkspaceEntryIcon";
import { ContextChip } from "../ContextChip";
import {
  ComposerContextActionsContext,
  ComposerContextReferenceChip,
  ComposerContextRecordsContext,
} from "../composerContextPresentation";
import type {
  ComposerCitationCommentRequest,
  ComposerPromptEditorProps,
} from "../ComposerPromptEditorTiptap";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ComposerChipRegistry, type ComposerChipEntry } from "./composerChips";
import { ComposerEditor, type ComposerEditorHost, type ComposerEditorMode } from "./composerEditor";

type OpenCitationComment = {
  /** The chip entry whose comment editor is open. */
  key: number;
  sourceAnchor?: AssistantCitationSourceAnchor;
  removeOnCancel?: ComposerCitationCommentRequest["insertedSpaces"];
};

const EDITOR_CLASS_NAME =
  "-m-1 max-h-52 min-h-19.5 overflow-y-auto p-1 whitespace-pre-wrap wrap-break-word bg-transparent leading-relaxed text-foreground focus:outline-none";

const selectVimModeEnabled = (settings: ClientSettings) => settings.vimModeEnabled;
const COMPOSER_EDITOR = { composer: true };

function resolvedThemeFromDocument(): "light" | "dark" {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

/** What an editor hands the one that replaces it. */
interface EditorHandoff {
  value: string;
  cursor: number;
  /** The exact caret, which the collapsed cursor cannot give inside `$name` text. */
  expandedCursor: number;
  /** Whether it had typing focus. */
  focused: boolean;
}

/**
 * The composer editor on CodeMirror and the Atlas live preview. The prompt is the document,
 * verbatim; chips are React components drawn over their source text.
 */
export function ComposerPromptEditorCodeMirror(props: ComposerPromptEditorProps) {
  const handoffRef = useRef<EditorHandoff | null>(null);
  const mode: ComposerEditorMode = props.literalText
    ? "literal"
    : props.richTextEnabled
      ? "rich"
      : "plain";
  // A new draft gets a new editor, so undo never reaches back into another draft's history.
  // Extensions are creation-time, so changing text mode remounts the editor too; every mode
  // initializes from the controlled value, preserving the draft. The new editor keeps the
  // old one's typing focus and exact caret.
  return (
    <ComposerPromptEditorCodeMirrorInner
      key={`${props.draftKey ?? ""}:${mode}`}
      mode={mode}
      handoffRef={handoffRef}
      {...props}
    />
  );
}

function ComposerPromptEditorCodeMirrorInner(
  props: ComposerPromptEditorProps & {
    mode: ComposerEditorMode;
    handoffRef: React.RefObject<EditorHandoff | null>;
  },
) {
  const {
    mode,
    handoffRef,
    value,
    cursor,
    contextRecords,
    skills,
    disabled,
    placeholder,
    ariaLabel,
    suggestionListId,
    activeSuggestionId,
    containerClassName,
    className,
    placeholderClassName,
    onPageScrollKeyDown,
    onPageScrollKeyUp,
    onPageScrollRelease,
    onPaste,
    editorRef,
  } = props;
  const hostRef = useRef<HTMLDivElement>(null);
  const editorInstance = useRef<ComposerEditor | null>(null);
  const [registry] = useState(() => new ComposerChipRegistry());
  const [isEmpty, setIsEmpty] = useState(value.length === 0);
  const [openCitation, setOpenCitation] = useState<OpenCitationComment | null>(null);
  // Vim is a device setting (Settings › Keybindings), shared with the wiki's note editor.
  const vim = useClientSettings(selectVimModeEnabled);
  useVimScreenLines();
  // Astrolabe: the formatting keys follow the keybindings; a change recreates the editor, from
  // the current draft.
  const markdownKeys = useMarkdownEditorKeys(COMPOSER_EDITOR);

  // The editor reads its callbacks through this, so they can change between renders.
  const propsRef = useRef(props);
  useLayoutEffect(() => {
    propsRef.current = props;
  });

  const presentation = {
    className: cn(EDITOR_CLASS_NAME, className),
    attributes: {
      "data-testid": "composer-editor",
      "data-composer-rich-text": mode === "rich" ? "true" : "false",
      spellcheck: "true",
      autocorrect: "on",
      autocapitalize: "sentences",
      ...(ariaLabel ? { "aria-label": ariaLabel } : {}),
      ...(!disabled && suggestionListId
        ? {
            "aria-autocomplete": "list",
            "aria-haspopup": "listbox",
            ...(activeSuggestionId
              ? {
                  "aria-controls": suggestionListId,
                  "aria-activedescendant": activeSuggestionId,
                }
              : {}),
          }
        : {}),
      "aria-placeholder": placeholder,
    },
  };

  // The latest state to create the editor from; a remount (Strict Mode) must not start
  // from the first render's draft.
  const creation = useRef({ value, cursor, disabled, presentation, vim, skills });
  useLayoutEffect(() => {
    creation.current = { value, cursor, disabled, presentation, vim, skills };
  });

  // Created in a layout effect so the composer's own layout effects, which measure the
  // prompt, run against a mounted editor with its classes applied.
  useLayoutEffect(() => {
    const parent = hostRef.current;
    if (!parent) return;
    const host = (): ComposerEditorHost => {
      const current = propsRef.current;
      return {
        onChange: current.onChange,
        onVisibleSelectionChange: current.onVisibleSelectionChange,
        onCommandKeyDown: current.onCommandKeyDown,
        buildContextClipboardFragment: current.buildContextClipboardFragment,
        importContextFragment: current.importContextFragment,
        onEmptyChange: setIsEmpty,
        onCitationDraftSave: current.onCitationDraftSave,
        openCitationComment: (pos, request) => {
          const entry = editorInstance.current
            ? registry.entryAt(editorInstance.current.view, pos)
            : null;
          if (!entry) return;
          setOpenCitation({
            key: entry.id,
            sourceAnchor: request.sourceAnchor,
            removeOnCancel: request.insertedSpaces,
          });
        },
      };
    };
    const previous = handoffRef.current;
    handoffRef.current = null;
    const initial = creation.current;
    const editor = new ComposerEditor({
      parent,
      mode,
      ...initial,
      ...(previous?.value === initial.value && previous.cursor === initial.cursor
        ? { expandedCursor: previous.expandedCursor }
        : {}),
      markdownKeys,
      registry,
      host,
    });
    editorInstance.current = editor;
    // Typing carries on in the editor that replaces a focused one; focus elsewhere stays put.
    if (previous?.focused) editor.view.focus();
    return () => {
      const { value: lastValue, cursor: lastCursor, expandedCursor } = editor.readSnapshot();
      handoffRef.current = {
        value: lastValue,
        cursor: lastCursor,
        expandedCursor,
        focused: editor.view.hasFocus,
      };
      editorInstance.current = null;
      editor.destroy();
    };
  }, [mode, registry, markdownKeys, handoffRef]);

  useLayoutEffect(() => {
    editorInstance.current?.setSkills(skills);
  }, [skills]);

  useLayoutEffect(() => {
    editorInstance.current?.setDisabled(disabled);
  }, [disabled]);

  useLayoutEffect(() => {
    editorInstance.current?.setPresentation(presentation);
  }, [presentation]);

  useLayoutEffect(() => {
    editorInstance.current?.setVim(vim);
  }, [vim]);

  // Controlled value and cursor from the store (history recall, chip insertion…).
  useLayoutEffect(() => {
    editorInstance.current?.syncControlled(value, cursor);
  }, [value, cursor]);

  useImperativeHandle(
    editorRef,
    () => ({
      focus: () => editorInstance.current?.focus(),
      focusAt: (nextCursor) => editorInstance.current?.focusAt(nextCursor),
      focusAtEnd: () => editorInstance.current?.focusAtEnd(),
      readSelectionRange: () =>
        editorInstance.current?.readSelectionRange() ?? { start: 0, end: 0 },
      requestCitationComment: (request) => editorInstance.current?.requestCitationComment(request),
      readSnapshot: () =>
        editorInstance.current?.readSnapshot() ?? {
          value: propsRef.current.value,
          cursor: 0,
          expandedCursor: 0,
          contextIds: [],
        },
      isCaretOnVisualEdge: (edge) => editorInstance.current?.isCaretOnVisualEdge(edge) ?? false,
    }),
    [],
  );

  const onWrapperKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (
      event.key === "Control" ||
      event.key === "Meta" ||
      event.key === "Alt" ||
      event.key === "Shift"
    ) {
      onPageScrollRelease?.();
    }
    if (event.key !== "PageUp" && event.key !== "PageDown") return;
    const scroller = editorInstance.current?.view.scrollDOM;
    if (!scroller) return;
    const pageScrollKey = getTimelinePageScrollKey({
      altKey: event.altKey,
      clientHeight: scroller.clientHeight,
      ctrlKey: event.ctrlKey,
      defaultPrevented: event.defaultPrevented,
      isComposing: event.nativeEvent.isComposing,
      key: event.key,
      keyCode: event.keyCode,
      metaKey: event.metaKey,
      scrollHeight: scroller.scrollHeight,
      scrollTop: scroller.scrollTop,
      shiftKey: event.shiftKey,
    });
    if (!pageScrollKey) {
      onPageScrollRelease?.();
      return;
    }
    if (!onPageScrollKeyDown) return;
    event.preventDefault();
    onPageScrollKeyDown(pageScrollKey);
  };

  return (
    <ComposerContextRecordsContext value={contextRecords}>
      <div
        className={cn(
          "relative flow-root font-(family-name:--font-composer,var(--font-sans)) text-(length:--font-size-prompt,var(--text-sm)) max-sm:pointer-coarse:text-(length:--font-size-prompt-touch)",
          containerClassName,
        )}
      >
        <div
          ref={hostRef}
          onKeyDown={onWrapperKeyDown}
          onKeyUp={(event) => onPageScrollKeyUp?.(event.key)}
          onBlur={onPageScrollRelease}
          onPasteCapture={onPaste}
        />
        {isEmpty && contextRecords.size === 0 && placeholder ? (
          <div
            className={cn(
              "pointer-events-none absolute inset-0 leading-relaxed text-placeholder/75",
              placeholderClassName,
            )}
          >
            {placeholder}
          </div>
        ) : null}
        <ComposerChipPortals
          registry={registry}
          editorInstance={editorInstance}
          skills={skills}
          openCitation={openCitation}
          setOpenCitation={setOpenCitation}
          propsRef={propsRef}
        />
      </div>
    </ComposerContextRecordsContext>
  );
}

interface ChipPortalsProps {
  registry: ComposerChipRegistry;
  editorInstance: React.RefObject<ComposerEditor | null>;
  skills: ReadonlyArray<ServerProviderSkill>;
  openCitation: OpenCitationComment | null;
  setOpenCitation: React.Dispatch<React.SetStateAction<OpenCitationComment | null>>;
  /** The editor's latest props, read when a chip acts. */
  propsRef: React.RefObject<ComposerPromptEditorProps>;
}

/** Renders each chip's React component into its widget, through portals that keep context. */
const ComposerChipPortals = memo(function ComposerChipPortals(props: ChipPortalsProps) {
  const entries = useSyncExternalStore(props.registry.subscribe, props.registry.getSnapshot);
  return entries.map((entry) =>
    createPortal(<ComposerChip entry={entry} {...props} />, entry.dom, entry.id),
  );
});

function ComposerChip(props: ChipPortalsProps & { entry: ComposerChipEntry }) {
  const { chip } = props.entry;
  switch (chip.kind) {
    case "mention":
      return <MentionChip path={chip.path} />;
    case "skill":
      return <SkillChip name={chip.name} skills={props.skills} />;
    case "citation":
      return <CitationChip {...props} citation={chip.citation} />;
    case "context-reference":
      return (
        <ComposerContextReferenceChip
          kind={chip.contextKind}
          contextId={chip.contextId}
          label={chip.label}
        />
      );
  }
}

function MentionChip({ path }: { path: string }) {
  const actions = use(ComposerContextActionsContext);
  const chip = (
    <ContextChip
      kind="mention"
      render={<button type="button" />}
      onClick={() => actions.openMention(path)}
      aria-label={`Preview ${path}`}
      spellCheck={false}
      data-composer-mention-chip="true"
    >
      <FileTagChipContent
        path={path}
        environmentId={actions.environmentId}
        cwd={actions.cwd}
        label={basenameOfPath(path)}
        theme={resolvedThemeFromDocument()}
      />
    </ContextChip>
  );
  return (
    <Tooltip>
      <TooltipTrigger render={chip} />
      <TooltipPopup side="top">
        <WorkspaceEntryTooltip
          path={path}
          environmentId={actions.environmentId}
          cwd={actions.cwd}
        />
      </TooltipPopup>
    </Tooltip>
  );
}

function SkillChip({ name, skills }: { name: string; skills: ReadonlyArray<ServerProviderSkill> }) {
  const actions = use(ComposerContextActionsContext);
  const skill = skills.find(
    (candidate) => candidate.name === name && isProviderSkillUserInvocable(candidate),
  );
  return (
    <SkillChipPopover
      label={formatProviderSkillDisplayName(skill ?? { name })}
      description={skill ? skillPopoverDescription(skill) : null}
      onViewInstructions={
        skill?.path && actions.environmentId ? () => actions.openMention(skill.path) : undefined
      }
    />
  );
}

function CitationChip({
  entry,
  editorInstance,
  openCitation,
  setOpenCitation,
  propsRef,
  citation,
}: ChipPortalsProps & { entry: ComposerChipEntry; citation: AssistantCitation }) {
  const target = openCitation?.key === entry.id ? openCitation : null;
  const removeOnCancel = target?.removeOnCancel;
  const editable = () => editorInstance.current?.editable ?? false;
  const save = (comment: string) =>
    editorInstance.current?.saveCitationComment(entry.dom, comment) ?? false;
  const restoreFocus = () => editorInstance.current?.focusAfterCitation(entry.dom);
  return (
    <span
      className="inline-flex min-w-0 max-w-full"
      onKeyDown={(event) => {
        // Tab from the comment button returns to the caret after the chip.
        if (
          !editable() ||
          event.key !== "Tab" ||
          event.shiftKey ||
          event.altKey ||
          event.metaKey ||
          event.ctrlKey ||
          !(event.target instanceof HTMLElement) ||
          event.target.dataset.citationCommentTrigger === undefined
        ) {
          return;
        }
        event.preventDefault();
        restoreFocus();
      }}
    >
      <AssistantCitationChip
        citation={citation}
        composer
        commentEditor={{
          open: target !== null,
          sourceAnchor: target?.sourceAnchor,
          onOpenChange: (open) => {
            if (open && !editable()) return;
            if (!open) editorInstance.current?.setCitationDraft(entry.dom, null);
            // One comment editor at a time.
            setOpenCitation((current) => {
              if (open) return current?.key === entry.id ? current : { key: entry.id };
              return current?.key === entry.id ? null : current;
            });
          },
          ...(removeOnCancel
            ? {
                onCancel: () => editorInstance.current?.removeCitation(entry.dom, removeOnCancel),
              }
            : {}),
          onSave: save,
          // Kept so a question or approval that replaces the prompt saves it.
          onDraftChange: (comment) => editorInstance.current?.setCitationDraft(entry.dom, comment),
          onSaveAndSend: (comment) => {
            if (!save(comment)) return false;
            propsRef.current.onCitationSubmitAndSend?.();
            return true;
          },
          onRestoreFocus: restoreFocus,
        }}
      />
    </span>
  );
}
