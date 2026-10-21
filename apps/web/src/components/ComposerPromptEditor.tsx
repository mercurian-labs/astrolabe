import { ComposerPromptEditorCodeMirror } from "./composerCodeMirror/ComposerPromptEditorCodeMirror";
import type { ComposerPromptEditorProps } from "./ComposerPromptEditorTiptap";

export type {
  ComposerCitationCommentRequest,
  ComposerPromptEditorHandle,
  ComposerPromptEditorProps,
} from "./ComposerPromptEditorTiptap";

/**
 * The composer editor: CodeMirror with the Atlas live preview, whose document is the prompt
 * verbatim. The `richTextEnabled` setting turns the live preview on; plain mode keeps
 * Markdown as source with chips, and `literalText` also keeps context-token sources as text.
 */
export function ComposerPromptEditor(props: ComposerPromptEditorProps) {
  // A new draft gets a new editor, so undo never reaches back into another draft's history.
  return <ComposerPromptEditorCodeMirror key={props.draftKey ?? ""} {...props} />;
}
