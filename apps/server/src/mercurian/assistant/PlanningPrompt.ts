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
import type { SpecDocument } from "@t3tools/contracts";

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
  readonly documentRoots?: ReadonlyArray<{
    readonly kind: "plan" | "spec";
    readonly path: string | null;
  }>;
  readonly memoryAmendmentsAvailable?: boolean | undefined;
}

export function memoryAppendix(memoryRoot: PlanningRepositoryRoot): string {
  return [
    "Project memory (durable design truth — consult it before repository files):",
    `- ${memoryRoot.path}`,
    "Notes are markdown with [[wikilinks]]; .skillmap.md files hold arrangement and teaching. Ground design intent in the memory's notes first; consult repository code for what is actually built.",
    "Use `propose_memory_amendment` when the person asks, or when this conversation resolves something memory records. An amendment lands on this line's memory branch as its own commit. Make one amendment per call and put nothing except memory changes in that commit.",
  ].join("\n");
}

/**
 * The planning system appendix: identity, artifact doors, runtime permissions,
 * and the grounding roots by name and path. Naming the roots matters
 * even for providers that honor `additionalDirectories` — access is granted
 * by the session, awareness by the prompt.
 */
export function planningSystemAppendix(input: PlanningIdentityInput): string {
  const lines: Array<string> = [
    `You are the planning assistant for the plan "${input.planTitle}".`,
    "You help think through, shape, and build from this plan in one continuous conversation.",
    "",
    "Ground your replies in the project's repositories. The working tree is editable within the runtime mode and permissions the person chose for this turn.",
    "",
    "Plans and specs are durable project Markdown files. A spec describes behavior and acceptance criteria; a plan describes the approach. Read and edit them with ordinary file tools. Continue existing documents where relevant; a thread does not own a mandatory pair.",
    "Use optional YAML frontmatter for id, kind, counterparts (explicit document ids), and origin.url. Preserve existing metadata; never infer counterpart links from names. Create no empty documents and add no change-summary reporting calls.",
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

  lines.push(documentLocationStanza(input.documentRoots));

  if (input.memoryRoot != null) {
    lines.push("", memoryAppendix(input.memoryRoot));
  }

  if (input.unreachableRepositories.length > 0) {
    lines.push(
      "",
      `Out of reach in this session (the provider grounds a single root): ${input.unreachableRepositories.join(", ")}. Say so if a question depends on them.`,
    );
  }

  return lines.join("\n");
}

export function documentLocationStanza(roots: PlanningIdentityInput["documentRoots"]) {
  return (["plan", "spec"] as const)
    .map((kind) => {
      const root = roots?.find((candidate) => candidate.kind === kind);
      const name = kind === "plan" ? "Plans" : "Specs";
      return root
        ? root.path
          ? `${name} directory: ${root.path}`
          : `${name} repository is unavailable on this line. Do not substitute another checkout.`
        : `${name} location is not configured. Ask the user to select it in project settings before creating documents of this type.`;
    })
    .join("\n");
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
export const TRANSCRIPT_FRAMING_MARGIN = 2_000;

function renderTranscript(input: {
  readonly entries: ReadonlyArray<TranscriptEntry>;
  readonly planText?: string;
  readonly spec?: SpecDocument | null;
}) {
  const renderedEntries = input.entries.map((entry) => {
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
    input.planText === undefined
      ? ""
      : input.planText.length === 0
        ? "The plan document is currently empty."
        : `The plan document currently reads:\n---\n${input.planText}\n---`;
  const specSection =
    input.spec === undefined
      ? ""
      : input.spec === null
        ? "The spec artifact does not exist yet."
        : `The spec artifact currently reads:\nGoal / user story:\n${input.spec.goal}\n\nAcceptance criteria:\n---\n${input.spec.acceptanceCriteria}\n---`;

  return { renderedEntries, planSection, specSection };
}

