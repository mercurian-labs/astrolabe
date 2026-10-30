import type { Memory, MemoryNote, ThreadEvent, ThreadRecord } from "@mercurian/graph/model";
import { links } from "@mercurian/wiki";
import type {
  OrchestrationV2Run,
  OrchestrationV2TurnItem,
  WikiIndexResult,
  WikiSummary,
} from "@t3tools/contracts";
import { t3ToolResultIndicatesFailure } from "@t3tools/client-runtime/t3ToolSummary";

import type { StoryRun } from "~/threadTurns";

/**
 * A thread told as an Atlas Graph over its wikis: each run is a turn whose moves are its completed
 * wiki tool calls in order. A read brings a note into view; an amendment writes or amends a note,
 * and links it added or removed (comparing before and after) become links and unlinks. The memory
 * is the wiki's main line as its index has it.
 */

const WIKI_TOOLS = [
  "read",
  "amend",
  "transform",
  "links",
  "search",
  "orient",
  "change_request",
] as const;
export type WikiTool = (typeof WIKI_TOOLS)[number];

const WORKING_RUN = new Set(["preparing", "starting", "running", "waiting"]);

/** The wiki tool a provider's tool name calls, matched by suffix (`mcp__t3-code__t3_wiki_read`). */
export function wikiToolOf(toolName: string | null | undefined): WikiTool | null {
  if (!toolName) return null;
  for (const tool of WIKI_TOOLS) if (toolName.endsWith(`t3_wiki_${tool}`)) return tool;
  return null;
}

/** One wiki tool call the story tells, reduced to what the story reads. */
export interface WikiToolCall {
  readonly id: string;
  readonly runId: string;
  readonly ordinal: number;
  readonly tool: WikiTool;
  /** The wiki as the agent named it: an id or a name. */
  readonly wiki: string;
  /** The note a read or links call asked for. */
  readonly name?: string;
  /** A read's returned markdown, when the output carried it. */
  readonly source?: string;
  /** An amendment's whole new notes by file; null deletes. */
  readonly changes?: Readonly<Record<string, string | null>>;
  /** A transform's rename, or the note a fill wrote and its content. */
  readonly rename?: { readonly from: string; readonly to: string };
  readonly fill?: { readonly name: string; readonly content: string };
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/** A tool payload as an object: parsed from JSON text, out of an MCP envelope, or as given. */
function payload(value: unknown, depth = 0): Record<string, unknown> | null {
  if (depth > 3) return null;
  if (typeof value === "string") {
    try {
      return payload(JSON.parse(value), depth + 1);
    } catch {
      return null;
    }
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = payload(asRecord(entry)?.text ?? entry, depth + 1);
      if (found) return found;
    }
    return null;
  }
  const record = asRecord(value);
  if (!record) return null;
  // Cursor keeps its MCP args envelope; other adapters keep the arguments directly.
  if (typeof record.toolName === "string" && asRecord(record.args)) return asRecord(record.args);
  const content = record.structuredContent ?? record.content;
  return content === undefined ? record : (payload(content, depth + 1) ?? record);
}

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value : undefined;

/** The thread's completed wiki tool calls that did not fail, in run and item order. */
export function wikiToolCalls(items: ReadonlyArray<OrchestrationV2TurnItem>): WikiToolCall[] {
  const calls: WikiToolCall[] = [];
  for (const item of items) {
    if (item.type !== "dynamic_tool" || item.runId === null || item.status !== "completed")
      continue;
    const tool = wikiToolOf(item.toolName);
    if (tool === null || t3ToolResultIndicatesFailure(item.output)) continue;
    const input = payload(item.input);
    const wiki = text(input?.wiki);
    if (!input || wiki === undefined) continue;
    const base = { id: item.id, runId: item.runId, ordinal: item.ordinal, tool, wiki };
    const name = text(input.name);
    const source = text(payload(item.output)?.source);
    const changes = asRecord(input.changes);
    const transform = asRecord(input.transform);
    calls.push({
      ...base,
      ...(name === undefined ? {} : { name }),
      ...(tool === "read" && source !== undefined ? { source } : {}),
      ...(tool === "amend" && changes
        ? {
            changes: Object.fromEntries(
              Object.entries(changes).flatMap(([file, next]) =>
                typeof next === "string" || next === null ? [[file, next]] : [],
              ),
            ),
          }
        : {}),
      ...(transform?.kind === "rename" && text(transform.from) && text(transform.to)
        ? { rename: { from: String(transform.from), to: String(transform.to) } }
        : {}),
      ...(transform?.kind === "fill" && text(transform.name)
        ? {
            fill: {
              name: String(transform.name),
              content: typeof transform.content === "string" ? transform.content : "",
            },
          }
        : {}),
    });
  }
  return calls.toSorted(
    (left, right) => left.ordinal - right.ordinal || left.id.localeCompare(right.id),
  );
}

/** The listed wiki an agent's `wiki` argument names: its id, else its name (case-insensitive). */
export function resolveWiki(
  wikis: ReadonlyArray<Pick<WikiSummary, "wikiId" | "name">>,
  named: string,
): Pick<WikiSummary, "wikiId" | "name"> | null {
  const lowered = named.toLowerCase();
  return (
    wikis.find((wiki) => wiki.wikiId === named) ??
    wikis.find((wiki) => wiki.name.toLowerCase() === lowered) ??
    null
  );
}

/** The wikis the calls touched, most recently touched first, by resolved id. */
export function touchedWikis<W extends Pick<WikiSummary, "wikiId" | "name">>(
  wikis: ReadonlyArray<W>,
  calls: ReadonlyArray<WikiToolCall>,
): W[] {
  const order: W[] = [];
  for (const call of calls.toReversed()) {
    const wiki = resolveWiki(wikis, call.wiki);
    if (wiki && !order.some((entry) => entry.wikiId === wiki.wikiId)) {
      order.push(wikis.find((entry) => entry.wikiId === wiki.wikiId)!);
    }
  }
  return order;
}

const nameKey = (name: string) => name.normalize("NFC").toLowerCase();
const noteNameOf = (file: string) => file.replace(/\.md$/i, "");
const isNoteFile = (file: string) => /\.md$/i.test(file) && !/\.skillmap\.md$/i.test(file);

/** The wiki's main line as a memory: its notes, red links as frontier, and its links. */
export function wikiMemory(
  index: Pick<WikiIndexResult, "wikiId" | "notes" | "links" | "unresolved">,
): Memory {
  const notes: MemoryNote[] = index.notes.map((note) => ({
    id: note.name,
    name: note.name,
    frontier: false,
  }));
  const known = new Set(notes.map((note) => nameKey(note.id)));
  for (const missing of index.unresolved) {
    if (known.has(nameKey(missing.name))) continue;
    known.add(nameKey(missing.name));
    notes.push({ id: missing.name, name: missing.name, frontier: true });
  }
  const canonical = new Map(notes.map((note) => [nameKey(note.id), note.id]));
  return {
    id: index.wikiId,
    notes,
    links: index.links.flatMap((link) => {
      const from = canonical.get(nameKey(link.from));
      const to = canonical.get(nameKey(link.to));
      return from && to ? [{ from, to }] : [];
    }),
    lenses: [],
  };
}

/** The notes whose main-line text the story needs: amended before the thread read or wrote them. */
export function notesNeedingMainText(memory: Memory, calls: ReadonlyArray<WikiToolCall>): string[] {
  const written = new Set(
    memory.notes.filter((note) => !note.frontier).map((note) => nameKey(note.id)),
  );
  const seen = new Set<string>();
  const needed: string[] = [];
  for (const call of calls) {
    if (call.tool === "read" && call.name && call.source !== undefined)
      seen.add(nameKey(call.name));
    for (const file of Object.keys(call.changes ?? {})) {
      if (!isNoteFile(file)) continue;
      const name = noteNameOf(file);
      const key = nameKey(name);
      if (!seen.has(key) && written.has(key) && !needed.some((each) => nameKey(each) === key)) {
        needed.push(name);
      }
      seen.add(key);
    }
  }
  return needed;
}

/** The turn the graph shows by default: the one being worked, else the last. */
export function shownTurn(
  turns: ReadonlyArray<StoryRun>,
  runs: ReadonlyArray<OrchestrationV2Run>,
): number {
  const working = new Set<string>(
    runs.filter((run) => WORKING_RUN.has(run.status)).map((run) => run.id),
  );
  const index = turns.findIndex((turn) => working.has(turn.id));
  return index >= 0 ? index : Math.max(0, turns.length - 1);
}

export interface WikiStory {
  readonly memory: Memory;
  readonly thread: ThreadRecord;
}

/**
 * The story of one wiki in a thread. `calls` are the thread's wiki calls already narrowed to this
 * wiki; `mainText` gives a note's main-line markdown for the first amendment of a note the thread
 * neither read nor wrote before (see `notesNeedingMainText`).
 */
export function wikiStory(input: {
  readonly threadId: string;
  readonly memory: Memory;
  readonly runs: ReadonlyArray<StoryRun>;
  readonly labels: ReadonlyArray<string>;
  readonly calls: ReadonlyArray<WikiToolCall>;
  readonly mainText: (name: string) => string;
}): WikiStory {
  const { memory } = input;
  // Ids are names as the wiki spells them; a name the wiki lacks keeps its first spelling.
  const canonical = new Map(memory.notes.map((note) => [nameKey(note.id), note.id]));
  const id = (name: string) => {
    const key = nameKey(name);
    const known = canonical.get(key);
    if (known !== undefined) return known;
    canonical.set(key, name);
    return name;
  };
  const written = new Set(
    memory.notes.filter((note) => !note.frontier).map((note) => nameKey(note.id)),
  );
  // The text the thread last saw of each note: its own last write, else what it read.
  const lastText = new Map<string, string>();
  const previous = (name: string) =>
    lastText.get(nameKey(name)) ?? (written.has(nameKey(name)) ? input.mainText(name) : "");

  const byRun = new Map<string, WikiToolCall[]>();
  for (const call of input.calls) {
    const calls = byRun.get(call.runId) ?? [];
    calls.push(call);
    byRun.set(call.runId, calls);
  }

  const write = (events: ThreadEvent[], name: string, next: string) => {
    const note = id(name);
    const before = previous(name);
    if (written.has(nameKey(name))) events.push({ kind: "amend", note });
    else {
      written.add(nameKey(name));
      events.push({ kind: "write", note, name: note });
    }
    const targets = (source: string) =>
      new Map(links(source).map((link) => [nameKey(link.target), link.target]));
    const was = targets(before);
    const now = targets(next);
    for (const [key, target] of now) {
      if (!was.has(key) && key !== nameKey(name))
        events.push({ kind: "link", from: note, to: id(target) });
    }
    for (const [key, target] of was) {
      if (!now.has(key) && key !== nameKey(name))
        events.push({ kind: "unlink", from: note, to: id(target) });
    }
    lastText.set(nameKey(name), next);
  };

  const turns = input.runs.map((run, index) => {
    const events: ThreadEvent[] = [];
    for (const call of byRun.get(run.id) ?? []) {
      switch (call.tool) {
        case "read":
        case "links":
          if (call.name === undefined) break;
          if (call.source !== undefined && !lastText.has(nameKey(call.name))) {
            lastText.set(nameKey(call.name), call.source);
          }
          if (canonical.has(nameKey(call.name)) || written.has(nameKey(call.name))) {
            events.push({ kind: "read", note: id(call.name) });
          }
          break;
        case "amend":
          for (const [file, next] of Object.entries(call.changes ?? {})) {
            if (!isNoteFile(file)) continue;
            const name = noteNameOf(file);
            if (next === null) {
              // A deletion: the note's links go, and it stays on the map as amended.
              if (written.has(nameKey(name))) write(events, name, "");
            } else write(events, name, next);
          }
          break;
        case "transform":
          if (call.rename) {
            // A rename rewrites both names: the old note is amended away, the new one written.
            const text = previous(call.rename.from);
            if (written.has(nameKey(call.rename.from))) {
              events.push({ kind: "amend", note: id(call.rename.from) });
            }
            write(events, call.rename.to, text);
          } else if (call.fill) write(events, call.fill.name, call.fill.content);
          break;
        default:
          break;
      }
    }
    return { id: run.id, label: input.labels[index] ?? `Turn ${index + 1}`, events };
  });
  return {
    memory,
    thread: { id: input.threadId, title: "", memoryId: memory.id, turns },
  };
}
