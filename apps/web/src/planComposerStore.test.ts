import { ProviderDriverKind } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  parseLegacyDrafts,
  parsePersistedState,
  toPersistableState,
  usePlanComposerStore,
  type PlanComposerAttachment,
} from "./planComposerStore";

const PLAN = "plan-a";
const OTHER_PLAN = "plan-b";
const HEAD = "commit-1";
const OTHER_HEAD = "commit-2";

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
const reload = () => {
  const { draftsByPlan, legacyByPlanId } = usePlanComposerStore.getState();
  return parsePersistedState(JSON.stringify(toPersistableState(draftsByPlan, legacyByPlanId)));
};

describe("planComposerStore", () => {
  beforeEach(() => {
    usePlanComposerStore.setState({ draftsByPlan: {}, legacyByPlanId: {} });
  });

  it("keeps an unsent message with its branch, and only with that branch", () => {
    const store = usePlanComposerStore.getState();
    store.setDraftText(PLAN, HEAD, "What about the explorer?", true);
    store.setDraftText(PLAN, OTHER_HEAD, "A different line of thought", true);
    store.setDraftText(OTHER_PLAN, HEAD, "Something else entirely", true);

    // Switching branches is reading another slot: nothing bleeds across.
    const drafts = usePlanComposerStore.getState().draftsByPlan;
    expect(drafts[PLAN]?.[HEAD]?.text).toBe("What about the explorer?");
    expect(drafts[PLAN]?.[OTHER_HEAD]?.text).toBe("A different line of thought");
    expect(drafts[OTHER_PLAN]?.[HEAD]?.text).toBe("Something else entirely");
  });

  it("holds images beside the text and gives them back one at a time", () => {
    const store = usePlanComposerStore.getState();
    store.addAttachments(
      PLAN,
      HEAD,
      [image(), image({ localId: "local-2", name: "second.png" })],
      true,
    );
    expect(usePlanComposerStore.getState().draftsByPlan[PLAN]?.[HEAD]?.attachments).toHaveLength(2);

    store.removeAttachment(PLAN, HEAD, "local-1");
    expect(
      usePlanComposerStore
        .getState()
        .draftsByPlan[PLAN]?.[HEAD]?.attachments.map((one) => one.localId),
    ).toEqual(["local-2"]);
  });

  it("clears only the sending branch's draft when the message is sent", () => {
    const store = usePlanComposerStore.getState();
    store.setDraftText(PLAN, HEAD, "Sending this", true);
    store.addAttachments(PLAN, HEAD, [image()], true);
    store.setDraftText(PLAN, OTHER_HEAD, "Not this one", true);

    store.clearDraft(PLAN, HEAD);

    expect(usePlanComposerStore.getState().draftsByPlan[PLAN]?.[HEAD]).toBeUndefined();
    // Sending on one branch says nothing about another.
    expect(usePlanComposerStore.getState().draftsByPlan[PLAN]?.[OTHER_HEAD]?.text).toBe(
      "Not this one",
    );
  });

  it("keeps no entry for a branch whose draft is empty in every half", () => {
    const store = usePlanComposerStore.getState();
    store.setDraftText(PLAN, HEAD, "typed", true);
    store.setDraftText(PLAN, HEAD, "", true);
    expect(usePlanComposerStore.getState().draftsByPlan[PLAN]).toBeUndefined();
  });

  it("rides a live draft forward as its branch grows, stripping the model flip", () => {
    const directive = { provider: ProviderDriverKind.make("codex"), model: "gpt-5.4" } as const;
    const store = usePlanComposerStore.getState();
    store.setDraftText(PLAN, HEAD, "Still composing", true);
    store.setModelChoice(PLAN, HEAD, directive, true);

    store.followGrowth(PLAN, (headId) => (headId === HEAD ? OTHER_HEAD : null));

    const drafts = usePlanComposerStore.getState().draftsByPlan;
    expect(drafts[PLAN]?.[HEAD]).toBeUndefined();
    expect(drafts[PLAN]?.[OTHER_HEAD]?.text).toBe("Still composing");
    // The flip only applied where it was made.
    expect(drafts[PLAN]?.[OTHER_HEAD]?.modelChoice).toBeUndefined();

    // Racing windows converge: the second pass finds nothing left to move.
    store.followGrowth(PLAN, (headId) => (headId === HEAD ? OTHER_HEAD : null));
    expect(usePlanComposerStore.getState().draftsByPlan[PLAN]?.[OTHER_HEAD]?.text).toBe(
      "Still composing",
    );
  });

  it("never moves an anchored draft, and yields a move to a standing destination draft", () => {
    const store = usePlanComposerStore.getState();
    // An edit-and-branch staging waits at the fork it would open.
    store.setDraftText(PLAN, HEAD, "Edited copy at the fork", false);
    store.followGrowth(PLAN, () => OTHER_HEAD);
    expect(usePlanComposerStore.getState().draftsByPlan[PLAN]?.[HEAD]?.text).toBe(
      "Edited copy at the fork",
    );

    // A rider whose destination already holds a draft yields to it.
    store.setDraftText(PLAN, OTHER_HEAD, "Fresher intent at the tip", true);
    usePlanComposerStore.setState((state) => ({
      draftsByPlan: {
        ...state.draftsByPlan,
        [PLAN]: {
          ...state.draftsByPlan[PLAN],
          [HEAD]: { text: "Rider", attachments: [], live: true },
        },
      },
    }));
    store.followGrowth(PLAN, (headId) => (headId === HEAD ? OTHER_HEAD : null));
    const drafts = usePlanComposerStore.getState().draftsByPlan;
    expect(drafts[PLAN]?.[HEAD]).toBeUndefined();
    expect(drafts[PLAN]?.[OTHER_HEAD]?.text).toBe("Fresher intent at the tip");
  });

  it("survives a reload, text and images alike, branch by branch", () => {
    const store = usePlanComposerStore.getState();
    store.setDraftText(PLAN, HEAD, "Still here", true);
    store.addAttachments(PLAN, HEAD, [image()], true);
    store.setDraftText(PLAN, OTHER_HEAD, "Also here", false);

    const reloaded = reload();
    expect(reloaded.draftsByPlan[PLAN]?.[HEAD]?.text).toBe("Still here");
    expect(reloaded.draftsByPlan[PLAN]?.[HEAD]?.attachments.map((one) => one.localId)).toEqual([
      "local-1",
    ]);
    // Anchoring is intent worth keeping across a reload.
    expect(reloaded.draftsByPlan[PLAN]?.[OTHER_HEAD]?.live).toBe(false);
  });

  it("degrades an unpersistable image to session-only without dropping the text", () => {
    const store = usePlanComposerStore.getState();
    store.setDraftText(PLAN, HEAD, "Look at this", true);
    store.addAttachments(
      PLAN,
      HEAD,
      [image({ localId: "too-big", persistable: false }), image({ localId: "fits" })],
      true,
    );

    // The composer keeps both: it accepted them, so it shows them.
    expect(usePlanComposerStore.getState().draftsByPlan[PLAN]?.[HEAD]?.attachments).toHaveLength(2);

    // A reload keeps what it can, and the text is never the thing sacrificed.
    const reloaded = reload();
    expect(reloaded.draftsByPlan[PLAN]?.[HEAD]?.text).toBe("Look at this");
    expect(reloaded.draftsByPlan[PLAN]?.[HEAD]?.attachments.map((one) => one.localId)).toEqual([
      "fits",
    ]);
  });

  it("reads nothing out of a blob it cannot trust", () => {
    expect(parsePersistedState(null)).toEqual({ draftsByPlan: {}, legacyByPlanId: {} });
    expect(parsePersistedState("not json")).toEqual({ draftsByPlan: {}, legacyByPlanId: {} });
    // A shape from some other version is not half-accepted.
    expect(
      parsePersistedState(JSON.stringify({ draftsByPlan: { [PLAN]: { [HEAD]: { text: 7 } } } })),
    ).toEqual({ draftsByPlan: {}, legacyByPlanId: {} });
    // A per-plan v1 draft is not a per-branch draft; it only enters as legacy.
    expect(
      parsePersistedState(
        JSON.stringify({ draftsByPlan: { [PLAN]: { [HEAD]: { text: "x", attachments: [] } } } }),
      ),
    ).toEqual({ draftsByPlan: {}, legacyByPlanId: {} });
  });

  it("keeps a model flip with its branch, through reload, until the draft clears", () => {
    const directive = {
      provider: ProviderDriverKind.make("codex"),
      model: "gpt-5.4",
      options: [{ id: "effort", value: "high" }],
    } as const;
    const store = usePlanComposerStore.getState();
    store.setModelChoice(PLAN, HEAD, directive, true);

    expect(usePlanComposerStore.getState().draftsByPlan[PLAN]?.[HEAD]?.modelChoice).toEqual(
      directive,
    );
    expect(usePlanComposerStore.getState().draftsByPlan[PLAN]?.[OTHER_HEAD]).toBeUndefined();

    const reloaded = reload();
    expect(reloaded.draftsByPlan[PLAN]?.[HEAD]?.modelChoice).toEqual(directive);

    store.clearDraft(PLAN, HEAD);
    expect(usePlanComposerStore.getState().draftsByPlan[PLAN]).toBeUndefined();
  });

  it("adopts a pre-branch-scoped draft at the first head its plan resolves", () => {
    const directive = { provider: ProviderDriverKind.make("codex"), model: "gpt-5.4" } as const;
    usePlanComposerStore.setState({
      legacyByPlanId: {
        [PLAN]: {
          text: "Written before branches",
          attachments: [image()],
          modelChoice: { directive, atHead: HEAD },
        },
        [OTHER_PLAN]: {
          text: "Waiting for its plan",
          attachments: [],
          modelChoice: { directive, atHead: "some-older-head" },
        },
      },
    });

    usePlanComposerStore.getState().adoptLegacyDraft(PLAN, HEAD);

    const state = usePlanComposerStore.getState();
    expect(state.draftsByPlan[PLAN]?.[HEAD]?.text).toBe("Written before branches");
    expect(state.draftsByPlan[PLAN]?.[HEAD]?.live).toBe(true);
    // The flip was scoped to this very head, so it survives adoption.
    expect(state.draftsByPlan[PLAN]?.[HEAD]?.modelChoice).toEqual(directive);
    // The legacy entry is spent; the other plan's still waits.
    expect(state.legacyByPlanId[PLAN]).toBeUndefined();
    expect(state.legacyByPlanId[OTHER_PLAN]?.text).toBe("Waiting for its plan");

    // A stale-head flip is dropped rather than smuggled onto a new branch.
    usePlanComposerStore.getState().adoptLegacyDraft(OTHER_PLAN, OTHER_HEAD);
    const adopted = usePlanComposerStore.getState().draftsByPlan[OTHER_PLAN]?.[OTHER_HEAD];
    expect(adopted?.text).toBe("Waiting for its plan");
    expect(adopted?.modelChoice).toBeUndefined();
  });

  it("lets a standing draft win over a legacy adoption, spending the legacy either way", () => {
    usePlanComposerStore.setState({
      draftsByPlan: { [PLAN]: { [HEAD]: { text: "Typed today", attachments: [], live: true } } },
      legacyByPlanId: { [PLAN]: { text: "From last week", attachments: [] } },
    });

    usePlanComposerStore.getState().adoptLegacyDraft(PLAN, HEAD);

    const state = usePlanComposerStore.getState();
    expect(state.draftsByPlan[PLAN]?.[HEAD]?.text).toBe("Typed today");
    expect(state.legacyByPlanId[PLAN]).toBeUndefined();
  });

  it("reads a v1 blob into legacy entries and persists them until adoption", () => {
    const legacy = parseLegacyDrafts(
      JSON.stringify({
        draftsByPlanId: {
          [PLAN]: { text: "Old world draft", attachments: [image()] },
          broken: { text: 7 },
        },
      }),
    );
    expect(legacy[PLAN]?.text).toBe("Old world draft");
    expect(legacy["broken"]).toBeUndefined();

    usePlanComposerStore.setState({ legacyByPlanId: legacy });
    const reloaded = reload();
    expect(reloaded.legacyByPlanId[PLAN]?.text).toBe("Old world draft");
  });
});
