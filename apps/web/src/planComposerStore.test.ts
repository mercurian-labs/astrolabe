import { ProviderDriverKind } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  modelChoiceForHead,
  parsePersistedDrafts,
  toPersistableDrafts,
  usePlanComposerStore,
  type PlanComposerAttachment,
  type PlanComposerDraft,
} from "./planComposerStore";

const PLAN = "plan-a";
const OTHER_PLAN = "plan-b";

const image = (overrides: Partial<PlanComposerAttachment> = {}): PlanComposerAttachment => ({
  localId: "local-1",
  name: "screenshot.png",
  mimeType: "image/png",
  sizeBytes: 4,
  dataUrl: "data:image/png;base64,AAAA",
  persistable: true,
  ...overrides,
});

/** Storage holds JSON; a round-trip is what a reload actually does. */
const reload = (draftsByPlanId: Record<string, PlanComposerDraft>) =>
  parsePersistedDrafts(JSON.stringify({ draftsByPlanId: toPersistableDrafts(draftsByPlanId) }));

describe("planComposerStore", () => {
  beforeEach(() => {
    usePlanComposerStore.setState({ draftsByPlanId: {} });
  });

  it("keeps an unsent message with its plan, and only with that plan", () => {
    usePlanComposerStore.getState().setDraftText(PLAN, "What about the explorer?");
    usePlanComposerStore.getState().setDraftText(OTHER_PLAN, "Something else entirely");

    // Leaving and coming back is reading the store again: nothing was scoped
    // to the view that was mounted.
    const drafts = usePlanComposerStore.getState().draftsByPlanId;
    expect(drafts[PLAN]?.text).toBe("What about the explorer?");
    expect(drafts[OTHER_PLAN]?.text).toBe("Something else entirely");
  });

  it("holds images beside the text and gives them back one at a time", () => {
    const store = usePlanComposerStore.getState();
    store.addAttachments(PLAN, [image(), image({ localId: "local-2", name: "second.png" })]);
    expect(usePlanComposerStore.getState().draftsByPlanId[PLAN]?.attachments).toHaveLength(2);

    store.removeAttachment(PLAN, "local-1");
    expect(
      usePlanComposerStore.getState().draftsByPlanId[PLAN]?.attachments.map((one) => one.localId),
    ).toEqual(["local-2"]);
  });

  it("clears the plan's draft when the message is sent", () => {
    const store = usePlanComposerStore.getState();
    store.setDraftText(PLAN, "Sending this");
    store.addAttachments(PLAN, [image()]);
    store.setDraftText(OTHER_PLAN, "Not this one");

    store.clearDraft(PLAN);

    expect(usePlanComposerStore.getState().draftsByPlanId[PLAN]).toBeUndefined();
    // Sending in one plan says nothing about another.
    expect(usePlanComposerStore.getState().draftsByPlanId[OTHER_PLAN]?.text).toBe("Not this one");
  });

  it("keeps no entry for a plan whose draft is empty in both halves", () => {
    const store = usePlanComposerStore.getState();
    store.setDraftText(PLAN, "typed");
    store.setDraftText(PLAN, "");
    expect(usePlanComposerStore.getState().draftsByPlanId[PLAN]).toBeUndefined();
  });

  it("survives a reload, text and images alike", () => {
    const store = usePlanComposerStore.getState();
    store.setDraftText(PLAN, "Still here");
    store.addAttachments(PLAN, [image()]);

    const reloaded = reload(usePlanComposerStore.getState().draftsByPlanId);
    expect(reloaded[PLAN]?.text).toBe("Still here");
    expect(reloaded[PLAN]?.attachments.map((one) => one.localId)).toEqual(["local-1"]);
  });

  it("degrades an unpersistable image to session-only without dropping the text", () => {
    const store = usePlanComposerStore.getState();
    store.setDraftText(PLAN, "Look at this");
    store.addAttachments(PLAN, [
      image({ localId: "too-big", persistable: false }),
      image({ localId: "fits" }),
    ]);

    // The composer keeps both: it accepted them, so it shows them.
    expect(usePlanComposerStore.getState().draftsByPlanId[PLAN]?.attachments).toHaveLength(2);

    // A reload keeps what it can, and the text is never the thing sacrificed.
    const reloaded = reload(usePlanComposerStore.getState().draftsByPlanId);
    expect(reloaded[PLAN]?.text).toBe("Look at this");
    expect(reloaded[PLAN]?.attachments.map((one) => one.localId)).toEqual(["fits"]);
  });

  it("reads nothing out of a blob it cannot trust", () => {
    expect(parsePersistedDrafts(null)).toEqual({});
    expect(parsePersistedDrafts("not json")).toEqual({});
    // A shape from some other version is not half-accepted.
    expect(
      parsePersistedDrafts(JSON.stringify({ draftsByPlanId: { [PLAN]: { text: 7 } } })),
    ).toEqual({});
  });

  it("keeps a model flip only at its head, through reload, until the draft clears", () => {
    const directive = {
      _tag: "override",
      selection: { provider: ProviderDriverKind.make("codex"), model: "gpt-5.4" },
    } as const;
    const store = usePlanComposerStore.getState();
    store.setModelChoice(PLAN, directive, "head-left");

    const draft = usePlanComposerStore.getState().draftsByPlanId[PLAN];
    expect(draft).toBeDefined();
    expect(modelChoiceForHead(draft!, "head-left")).toEqual(directive);
    expect(modelChoiceForHead(draft!, "head-right")).toBeUndefined();

    const reloaded = reload(usePlanComposerStore.getState().draftsByPlanId);
    expect(modelChoiceForHead(reloaded[PLAN]!, "head-left")).toEqual(directive);

    store.clearDraft(PLAN);
    expect(usePlanComposerStore.getState().draftsByPlanId[PLAN]).toBeUndefined();
  });
});
