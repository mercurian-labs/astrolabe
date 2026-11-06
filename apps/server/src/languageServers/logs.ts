// @effect-diagnostics globalDate:off - lines arrive in synchronous process callbacks.
import type {
  LanguageServerLogLine,
  LanguageServerLogSource,
  LanguageServerTraceEntry,
} from "@t3tools/contracts";

/**
 * What a server has been doing, for a person to read: its output and, while someone records it,
 * its LSP traffic. Bounded and in memory only, since a trace holds file contents.
 */

const LINES_KEPT = 2000;
const LINE_LENGTH = 4000;
const TRACE_LENGTH_KEPT = 2 * 1024 * 1024;
const TRACE_ENTRY_LENGTH = 16 * 1024;

const cut = (text: string, length: number) =>
  text.length <= length ? text : `${text.slice(0, length)}… (${text.length} characters)`;

/** The newest items whose sizes fit in `limit`. */
const makeRing = <Item>(size: (item: Item) => number, limit: number) => {
  let items: Array<Item> = [];
  let start = 0;
  let total = 0;
  return {
    push(item: Item) {
      items.push(item);
      total += size(item);
      while (total > limit) total -= size(items[start++]!);
      // Dropping from the front by index: a server can log thousands of lines a second.
      if (start > 1024 && start > items.length / 2) {
        items = items.slice(start);
        start = 0;
      }
    },
    items: () => items.slice(start),
    clear() {
      items = [];
      start = 0;
      total = 0;
    },
  };
};

export type LogEvent =
  | { readonly type: "line"; readonly line: LanguageServerLogLine }
  | { readonly type: "trace"; readonly entry: LanguageServerTraceEntry }
  | { readonly type: "state" };

export interface LogSubscriber {
  readonly offer: (event: LogEvent) => void;
}

export const makeServerLog = () => {
  const lines = makeRing<LanguageServerLogLine>(() => 1, LINES_KEPT);
  const trace = makeRing<LanguageServerTraceEntry>((entry) => entry.text.length, TRACE_LENGTH_KEPT);
  const subscribers = new Set<LogSubscriber>();
  let partial = "";

  const send = (event: LogEvent) => {
    for (const subscriber of subscribers) subscriber.offer(event);
  };

  const line = (
    source: LanguageServerLogSource,
    text: string,
    severity?: LanguageServerLogLine["severity"],
  ) => {
    const added: LanguageServerLogLine = {
      at: Date.now(),
      source,
      ...(severity === undefined ? {} : { severity }),
      text: cut(text, LINE_LENGTH),
    };
    lines.push(added);
    send({ type: "line", line: added });
  };

  const log = {
    subscribers,
    tracing: false,
    line,
    /** A chunk of stderr, which can end anywhere in a line. */
    stderr(text: string) {
      const parts = `${partial}${text}`.split(/\r?\n/);
      partial = parts.pop() ?? "";
      for (const part of parts) line("stderr", part);
      if (partial.length > LINE_LENGTH) {
        line("stderr", partial);
        partial = "";
      }
    },
    /** The process ended: what it wrote without a line ending is all there will be. */
    endStderr() {
      if (partial !== "") line("stderr", partial);
      partial = "";
    },
    trace(direction: LanguageServerTraceEntry["direction"], text: string) {
      const entry = { at: Date.now(), direction, text: cut(text, TRACE_ENTRY_LENGTH) };
      trace.push(entry);
      send({ type: "trace", entry });
    },
    setTracing(tracing: boolean) {
      if (log.tracing === tracing) return;
      log.tracing = tracing;
      send({ type: "state" });
    },
    stateChanged: () => send({ type: "state" }),
    /** Nobody is reading: a trace stops, and what it held goes. */
    onLastSubscriberGone() {
      log.tracing = false;
      trace.clear();
    },
    lines: () => lines.items(),
    entries: () => trace.items(),
  };
  return log;
};

export type ServerLog = ReturnType<typeof makeServerLog>;
