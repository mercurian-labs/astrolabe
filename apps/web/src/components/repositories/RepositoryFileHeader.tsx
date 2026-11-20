import * as Schema from "effect/Schema";
import { Code2Icon, EyeIcon, Table2Icon } from "lucide-react";
import { useState, useSyncExternalStore } from "react";

import { useLocalStorage } from "~/hooks/useLocalStorage";
import { TabHeader } from "~/panes/TabHeader";
import type { RenderedForm } from "./fileView";
import { repositoryFileReveal } from "./repositoryFileReveal";

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
