/**
 * PlanningPrompt — pure assembly of what a planning turn says to its
 * provider: who the assistant is, where it may look, how it writes, and — on
 * a rebuilt session — what the conversation already was.
 *
 * The provider-session contract has no per-session system-prompt seam, so
 * the appendix rides as the head of a fresh session's first turn input. A
 * continued session already carries it in the provider's own context and
 * receives only the new message.
 *
 * Everything here is a pure function of its inputs, tested without a
 * provider — the `.logic.ts` temperament applied server-side.
 *
 * @module PlanningPrompt
 */
import { PROVIDER_SEND_TURN_MAX_INPUT_CHARS, type SpecDocument } from "@t3tools/contracts";

export interface PlanningRepositoryRoot {
  readonly name: string;
  readonly path: string;
}

export interface PlanningIdentityInput {
  readonly planTitle: string;
  /** The roots this session can actually read, cwd first. */
  readonly repositories: ReadonlyArray<PlanningRepositoryRoot>;
  /** Repositories of the project this session cannot reach (cwd-only provider). */
  readonly unreachableRepositories: ReadonlyArray<string>;
  /** Present only when this provider session can reach the designated memory. */
  readonly memoryRoot?: PlanningRepositoryRoot | null | undefined;
}

/**
 * The planning system appendix: identity, the read-only rule, the one write
 * door, and the grounding roots by name and path. Naming the roots matters
 * even for providers that honor `additionalDirectories` — access is granted
 * by the session, awareness by the prompt.
 */
export function planningSystemAppendix(input: PlanningIdentityInput): string {
  const lines: Array<string> = [
    `You are the planning assistant for the plan "${input.planTitle}".`,
    "You are in a planning conversation, not a coding session: you help think through and shape a plan document. There is no mode to enter and no implement step here.",
    "",
    "Ground your replies in the project's repositories. Your filesystem access is read-only — read, search, and list freely; never attempt to run commands or modify files, and do not propose doing so.",
    "",
    "There are two first-class artifacts. The spec has two prose fields: Goal / user story describes the outcome and behavioral context, while Acceptance criteria records the observable conditions that make it complete. The plan describes implementation approach.",
    "Revise them only through their artifact doors: use `read_spec` then `save_spec_revision` for the complete spec, and `read_plan` then `save_plan_revision` for the complete plan. A statement in your response does not change an artifact; never claim a change without a successful save tool call.",
    "When discovery changes the contract, save the spec directly and then reconcile the plan in this same turn when its approach is affected. You may suggest a separate planning space, but only the person can create one, fork, or merge.",
    "When you need a decision from the person you are planning with, ask a structured question with the question tool available to you instead of guessing.",
  ];

  if (input.repositories.length === 0) {
    lines.push(
      "",
      "This project has no repositories connected, so there is nothing to ground in — plan from the conversation alone.",
    );
  } else {
    lines.push("", "Repositories to ground in:");
    for (const repository of input.repositories) {
      lines.push(`- ${repository.name}: ${repository.path}`);
    }
  }

  if (input.memoryRoot != null) {
    lines.push(
      "",
      "Project memory (durable design truth — consult it before repository files):",
      `- ${input.memoryRoot.path}`,
      "Notes are markdown with [[wikilinks]]; maps/*.yaml hold arrangement. Ground design intent in the memory's notes first; consult repository code for what is actually built.",
    );
  }

  if (input.unreachableRepositories.length > 0) {
    lines.push(
      "",
      `Out of reach in this session (the provider grounds a single root): ${input.unreachableRepositories.join(", ")}. Say so if a question depends on them.`,
    );
  }

  return lines.join("\n");
}

/**
 * One entry of the history a rebuilt session has to be told about. Revisions
 * carry the text they produced only when it is the current one — the final
 * artifact travels once, at the end.
 */
export type TranscriptEntry =
  | {
      readonly kind: "message";
      readonly author: "human" | "assistant";
      readonly text: string;
      readonly interrupted?: boolean;
    }
  | { readonly kind: "plan-revision"; readonly author: "human" | "assistant" }
  | { readonly kind: "spec-revision"; readonly author: "human" | "assistant" };

/**
 * Room left for the transcript after the appendix and the current message
 * are budgeted, against the provider send cap. The margin covers the framing
 * lines this module adds around each part.
 */
const TRANSCRIPT_FRAMING_MARGIN = 2_000;

/**
 * The conversation so far, rendered as dialogue for a session that was not
 * there. Oldest entries are elided first when the whole thing cannot fit the
 * provider's input cap — the recent turns are what the next reply hangs on.
 */
export function transcriptPreamble(input: {
  readonly entries: ReadonlyArray<TranscriptEntry>;
  /** The plan artifact's current text along this path. `""` renders as empty. */
  readonly planText: string;
  readonly spec: SpecDocument | null;
  /** Characters already spoken for: appendix + the current message. */
  readonly reservedChars: number;
}): string {
  const rendered = input.entries.map((entry) => {
    if (entry.kind !== "message") {
      const artifact = entry.kind === "plan-revision" ? "plan" : "spec";
      return entry.author === "human"
        ? `[The person revised the ${artifact}.]`
        : `[You revised the ${artifact}.]`;
    }
    const speaker = entry.author === "human" ? "Person" : "You";
    const suffix = entry.interrupted === true ? "\n[This reply was stopped mid-response.]" : "";
    return `${speaker}:\n${entry.text}${suffix}`;
  });

  const planSection =
    input.planText.length === 0
      ? "The plan document is currently empty."
      : `The plan document currently reads:\n---\n${input.planText}\n---`;
  const specSection =
    input.spec === null
      ? "The spec artifact does not exist yet."
      : `The spec artifact currently reads:\nGoal / user story:\n${input.spec.goal}\n\nAcceptance criteria:\n---\n${input.spec.acceptanceCriteria}\n---`;

  const budget = Math.max(
    0,
    PROVIDER_SEND_TURN_MAX_INPUT_CHARS -
      input.reservedChars -
      planSection.length -
      specSection.length -
      TRANSCRIPT_FRAMING_MARGIN,
  );

  const kept: Array<string> = [];
  let used = 0;
  let elided = 0;
  for (let index = rendered.length - 1; index >= 0; index -= 1) {
    const entry = rendered[index]!;
    if (used + entry.length > budget) {
      elided = index + 1;
      break;
    }
    kept.unshift(entry);
    used += entry.length;
  }

  const header =
    elided === 0
      ? "You are resuming a planning conversation. Here is what has happened so far:"
      : `You are resuming a planning conversation. Its first ${elided} entries are elided for length; here is the rest:`;

  return [header, "", kept.join("\n\n"), "", specSection, "", planSection].join("\n");
}

/**
 * A fresh session's first turn: appendix, then the transcript when the
 * conversation predates this session, then the message being replied to. A
 * continued session sends the message alone.
 */
export function composeFirstTurnInput(input: {
  readonly appendix: string;
  readonly preamble: string | null;
  readonly message: string;
  readonly memoryMentionStanza?: string | null | undefined;
}): string {
  let composed: string;
  if (/^\s*[/$]\S+/.test(input.message)) {
    const context = [
      "Context for this conversation (it predates this session):",
      input.appendix,
      ...(input.preamble === null ? [] : [input.preamble]),
    ].join("\n\n");
    composed = [input.message, context].join("\n\n---\n\n");
  } else {
    composed = [
      input.appendix,
      ...(input.preamble === null ? [] : [input.preamble]),
      `Reply to this message:\n${input.message}`,
    ].join("\n\n---\n\n");
  }
  return appendMemoryMentionStanza(composed, input.memoryMentionStanza ?? null);
}

export interface MemoryMentionResolution {
  readonly name: string;
  readonly path?: string | undefined;
  readonly referencedBy?: ReadonlyArray<string> | undefined;
}

export function memoryMentionResolutionStanza(
  resolutions: ReadonlyArray<MemoryMentionResolution>,
): string | null {
  if (resolutions.length === 0) return null;
  return [
    "Memory notes mentioned in this message:",
    ...resolutions.map((resolution) =>
      resolution.path !== undefined
        ? `- ${resolution.name}: ${resolution.path}`
        : `- ${resolution.name}: not yet written — linked from ${(resolution.referencedBy ?? []).join(", ")}`,
    ),
  ].join("\n");
}

export function appendMemoryMentionStanza(input: string, stanza: string | null): string {
  return stanza === null ? input : `${input}\n\n---\n\n${stanza}`;
}

/** A one-shot implement analysis whose only output is the proposal tool. */
export function implementTurnInput(input: {
  readonly repositories: ReadonlyArray<string>;
  readonly planText: string;
}): string {
  const repositories = input.repositories.map((name) => `- ${name}`).join("\n");
  return [
    "Analyze where the plan below must be implemented across the project's repositories.",
    `Use repository names exactly as listed:\n${repositories}`,
    "If exactly one repository is required, call `save_implement_proposal` with that repository and omit splits.",
    "If several repositories are required, also provide one self-contained plan projection per repository and a one-line rationale for the cut. Each projection must contain only what that repository owns while carrying everything its implementation needs.",
    "Call `save_implement_proposal` with the complete result; the last call wins. Do not edit files, do not revise the source plan, do not ask questions, and do not treat narration as the result.",
    `Source plan:\n---\n${input.planText}\n---`,
  ].join("\n\n");
}
