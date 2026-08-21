import {
  ProviderDriverKind,
  ProviderInstanceId,
  type PlanningModelResolution,
  type PlanningModelSelection,
} from "@t3tools/contracts";
import type { Meta, StoryObj } from "@storybook/react";

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

const meta = {
  title: "Mercurian/Composer/Plan Composer",
  component: PlanComposer,
  parameters: { layout: "centered" },
  args: {
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
  },
} satisfies Meta<typeof PlanComposer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ReadyToSend: Story = {
  name: "Ready to send",
  args: { text: "Turn this catalog into the smallest useful implementation." },
};

export const AssistantWorking: Story = {
  name: "Assistant working",
  args: { text: "Catalog the identity surfaces.", turnActive: true },
};

export const NoModelChosenYet: Story = {
  name: "No model chosen yet",
  args: { gateNotice: noModelNotice, modelPicker: <button type="button">Choose model</button> },
};

export const NotSignedIn: Story = {
  name: "Not signed in",
  args: { gateNotice: notSignedInNotice },
};
