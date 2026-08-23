import {
  ProviderDriverKind,
  ProviderInstanceId,
  type PlanningModelResolution,
  type PlanningModelSelection,
} from "@t3tools/contracts";

import type { CatalogEntry } from "../../design-system/catalog";
import { PlanComposer } from "./PlanComposer";
import { planningModelGateNotice } from "./PlanComposer.logic";

const selection = {
  provider: ProviderDriverKind.make("claudeAgent"),
  model: "opus",
} satisfies PlanningModelSelection;

const resolved = {
  _tag: "resolved",
  instanceId: ProviderInstanceId.make("claudeAgent"),
  provider: selection.provider,
  model: selection.model,
} satisfies PlanningModelResolution;

const noModelNotice = planningModelGateNotice(null, { _tag: "unset" });
const notSignedInNotice = planningModelGateNotice(selection, {
  _tag: "unresolved",
  reason: "not-signed-in",
});

const baseProps = {
  placeholder: "Ask the assistant to refine this plan",
  text: "",
  attachments: [],
  gateNotice: planningModelGateNotice(selection, resolved),
  modelPicker: (
    <button className="rounded-md border border-border px-2 py-1 text-xs" type="button">
      Claude · Opus
    </button>
  ),
  onChangeText: () => undefined,
  onAddAttachments: () => undefined,
  onRemoveAttachment: () => undefined,
  onSend: () => Promise.resolve(true),
  onStop: () => undefined,
  onImplement: () => undefined,
} as const;

export const PLAN_COMPOSER_CATALOG_ENTRIES = [
  {
    id: "plan-composer-ready-to-send",
    section: "mercurian-grammar",
    group: "PlanComposer",
    title: "Ready to send",
    description: "A composer with a model selected and a prompt ready to submit.",
    sourcePath: "src/components/mercurian/PlanComposer.tsx",
    render: () => (
      <PlanComposer
        {...baseProps}
        text="Turn this catalog into the smallest useful implementation."
      />
    ),
    layout: "preview",
    preferredCanvas: "desktop",
  },
  {
    id: "plan-composer-assistant-working",
    section: "mercurian-grammar",
    group: "PlanComposer",
    title: "Assistant working",
    description: "A composer whose send control is replaced while the assistant works.",
    sourcePath: "src/components/mercurian/PlanComposer.tsx",
    render: () => <PlanComposer {...baseProps} text="Catalog the identity surfaces." turnActive />,
    layout: "preview",
    preferredCanvas: "desktop",
  },
  {
    id: "plan-composer-no-model-chosen-yet",
    section: "mercurian-grammar",
    group: "PlanComposer",
    title: "No model chosen yet",
    description: "A composer gated until the user chooses a planning model.",
    sourcePath: "src/components/mercurian/PlanComposer.tsx",
    render: () => (
      <PlanComposer
        {...baseProps}
        gateNotice={noModelNotice}
        modelPicker={<button type="button">Choose model</button>}
      />
    ),
    layout: "preview",
    preferredCanvas: "desktop",
  },
  {
    id: "plan-composer-not-signed-in",
    section: "mercurian-grammar",
    group: "PlanComposer",
    title: "Not signed in",
    description: "A composer gated because the selected provider is not signed in.",
    sourcePath: "src/components/mercurian/PlanComposer.tsx",
    render: () => <PlanComposer {...baseProps} gateNotice={notSignedInNotice} />,
    layout: "preview",
    preferredCanvas: "desktop",
  },
] satisfies ReadonlyArray<CatalogEntry>;
