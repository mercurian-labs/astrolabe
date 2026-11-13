import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { resolvePathLinkTarget } from "@t3tools/shared/fileLinks";
import * as Schema from "effect/Schema";
import { Code2Icon, EyeIcon, Table2Icon } from "lucide-react";
import { useState, useSyncExternalStore } from "react";

import { OpenInPicker } from "~/components/chat/OpenInPicker";
import { useLocalStorage } from "~/hooks/useLocalStorage";
import { TabHeader } from "~/panes/TabHeader";
import { useRemoteOpenState } from "~/remoteOpen";
import { usePrimaryEnvironmentId } from "~/state/environments";
import {
  primaryServerAvailableEditorsAtom,
  primaryServerKeybindingsAtom,
  serverEnvironment,
} from "~/state/server";
import type { RenderedForm } from "./fileView";
import { repositoryFileReveal } from "./repositoryFileReveal";

/** The open-in-editor picker for one file, with reveal in the file manager where the host has it. */
export function FileOpenIn(props: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly path: string;
}) {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const availableEditors = useAtomValue(primaryServerAvailableEditorsAtom);
  const config = useAtomValue(serverEnvironment.configValueAtom(props.environmentId));
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const remote = useRemoteOpenState(props.environmentId);
  if (props.environmentId !== primaryEnvironmentId && remote.mode === "local-exec") return null;
  return (
    <OpenInPicker
      environmentId={props.environmentId}
      keybindings={keybindings}
      availableEditors={availableEditors}
      openInCwd={resolvePathLinkTarget(props.path, props.cwd)}
      openInCwdIsFile
      compact
      // The favourite-editor key opens the chat's checkout.
      enableShortcut={false}
      revealFileManager={config?.shellRevealInFileManager === true}
    />
  );
}

// The thread's file panel's keys, so both views open a kind the same way.
const RENDERED_STORAGE_KEYS = {
  table: "t3code.renderTable",
  mermaid: "t3code.renderMermaid",
  html: "t3code.renderBrowserFile",
} as const;

/**
 * Whether a text file shows its rendered form in place of the editor. A line asked for (project
 * search) shows the source until the rendered form is asked for again.
 */
export function useRenderedForm(form: RenderedForm | null, tabKey: string) {
  const [preferred, setPreferred] = useLocalStorage(
    RENDERED_STORAGE_KEYS[form ?? "table"],
    true,
    Schema.Boolean,
  );
  const reveal = useSyncExternalStore(repositoryFileReveal.subscribe, repositoryFileReveal.get);
  const revealing = reveal?.tabKey === tabKey;
  const [revealed, setRevealed] = useState(false);
  if (revealing && !revealed) setRevealed(true);
  const shown = form !== null && preferred && !revealing && !revealed;
  return {
    shown,
    toggle: () => {
      setPreferred(!shown);
      setRevealed(false);
    },
  };
}

export function RenderedFormToggle(props: {
  readonly form: RenderedForm;
  readonly shown: boolean;
  readonly onToggle: () => void;
}) {
  const label = props.shown
    ? props.form === "table"
      ? "Show source"
      : props.form === "mermaid"
        ? "Show Mermaid source"
        : "Show HTML source"
    : props.form === "table"
      ? "Show table"
      : props.form === "mermaid"
        ? "Show rendered diagram"
        : "Show rendered page";
  return (
    <TabHeader.Action label={label} pressed={props.shown} onClick={props.onToggle}>
      {props.shown ? <Code2Icon /> : props.form === "table" ? <Table2Icon /> : <EyeIcon />}
    </TabHeader.Action>
  );
}
