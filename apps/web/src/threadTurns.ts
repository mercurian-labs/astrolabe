import type { OrchestrationV2ConversationMessage, OrchestrationV2Run } from "@t3tools/contracts";

/**
 * A thread's turns as its views tell them (the Graph tab's story, the Lineage tab's checkpoints):
 * the runs the conversation shows, and what the person asked in each.
 */

const LABEL_LENGTH = 48;
const ACTIVE_RUN = new Set(["preparing", "queued", "starting", "running", "waiting"]);

/** One turn's input: its run and whether it is still being worked. */
export interface StoryRun {
  readonly id: string;
  readonly active: boolean;
}

/** The runs the conversation shows, in order: a rolled-back run is not one. */
export function storyRuns(
  runs: ReadonlyArray<Pick<OrchestrationV2Run, "id" | "ordinal" | "status">>,
): StoryRun[] {
  return runs
    .filter((run) => run.status !== "rolled_back")
    .toSorted((left, right) => left.ordinal - right.ordinal)
    .map((run) => ({ id: run.id, active: ACTIVE_RUN.has(run.status) }));
}

const MARKDOWN_LINK = /!?\[([^\]\n]*)\]\([^)\n]*\)/g;
const LEADING_LINKS = /^(?:\s*!?\[[^\]\n]*\]\([^)\n]*\))+/;
const IMAGE = /\s*!\[[^\]\n]*\]\([^)\n]*\)/g;

/**
 * What the person asked, as one line, in full: the first line with real text. Images, and links
 * that open a line (attachments, preview annotations), are passed over; when nothing else is
 * there, the first link's text stands in. Null when the message says nothing.
 */
export function askedLine(text: string): string | null {
  let linkText: string | null = null;
  for (const each of text.split("\n")) {
    const line = each.trim();
    if (line === "") continue;
    const rest = line.replace(LEADING_LINKS, "").replace(IMAGE, "").trim();
    if (rest !== "") return rest;
    linkText ??=
      [...line.matchAll(MARKDOWN_LINK)]
        .map((link) => link[1]!.trim())
        .find((label) => label !== "") ?? null;
  }
  return linkText;
}

/** Block marks a line can open with in markdown: a heading, a list item, a quote. */
const LINE_MARK = /^(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s*)/;
const INLINE_MARK = /\*\*|__|`/g;

/**
 * The start of an agent's reply as one line: its first line with text, its markdown marks
 * dropped and its links read as their text. Null when the reply says nothing.
 */
export function replyLine(text: string): string | null {
  for (const each of text.split("\n")) {
    const line = each
      .trim()
      .replace(LINE_MARK, "")
      .replace(MARKDOWN_LINK, (_, label: string) => label)
      .replace(INLINE_MARK, "")
      .trim();
    if (line !== "") return line;
  }
  return null;
}

/**
 * What the person asked in each run, as `askedLine` tells it, by run id. A run whose message is
 * not loaded, or says nothing, has none.
 */
export function askedLines(
  messages: ReadonlyArray<OrchestrationV2ConversationMessage>,
): ReadonlyMap<string, string> {
  const lines = new Map<string, string>();
  const seen = new Set<string>();
  for (const message of messages) {
    if (message.role !== "user" || message.runId === null || seen.has(message.runId)) continue;
    seen.add(message.runId);
    const line = askedLine(message.text);
    if (line !== null) lines.set(message.runId, line);
  }
  return lines;
}

/** Each turn's label: the first line of what the person asked in its run, shortened. */
export function turnLabels(
  turns: ReadonlyArray<StoryRun>,
  messages: ReadonlyArray<OrchestrationV2ConversationMessage>,
): string[] {
  const asked = askedLines(messages);
  return turns.map((turn, index) => {
    const line = asked.get(turn.id) ?? `Turn ${index + 1}`;
    return line.length > LABEL_LENGTH ? `${line.slice(0, LABEL_LENGTH - 1)}…` : line;
  });
}
