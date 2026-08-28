import { useState } from "react";

import { PlanComposer } from "~/components/mercurian/PlanComposer";
import { planningModelGateNotice } from "~/components/mercurian/PlanComposer.logic";

type PlanningModelSelection = NonNullable<Parameters<typeof planningModelGateNotice>[0]>;
type PlanningModelResolution = Parameters<typeof planningModelGateNotice>[1];

const selection = {
  provider: "claudeAgent",
  model: "opus",
} as PlanningModelSelection;

const resolved = {
  _tag: "resolved",
  instanceId: "claudeAgent",
  provider: selection.provider,
  model: selection.model,
} as PlanningModelResolution;

export default function PlanComposerDemo() {
  const [text, setText] = useState("Ask the assistant to refine this plan.");

  return (
    <PlanComposer
      placeholder="Ask the assistant to refine this plan"
      text={text}
      attachments={[]}
      gateNotice={planningModelGateNotice(selection, resolved)}
      modelPicker={
        <button className="rounded-md border border-border px-2 py-1 text-xs" type="button">
          Claude · Opus
        </button>
      }
      onChangeText={setText}
      onAddAttachments={() => undefined}
      onRemoveAttachment={() => undefined}
      onSend={() => Promise.resolve(false)}
      onStop={() => undefined}
      onImplement={() => undefined}
    />
  );
}
