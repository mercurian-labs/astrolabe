// A tiny language server for tests. It reads `fake-server.json` in its working directory:
//   crashTimes: exit right after `initialize` on this many starts (counted in `starts.log`)
//   waitFor: answer `initialize` only once this file exists
// Diagnostics: every "bad" is an error. Hover answers the word at the position, rename renames
// it everywhere, `test/slow` waits for its cancel, `test/state` reports what the server holds.
import { appendFileSync, existsSync, readFileSync, watch } from "node:fs";

const config = existsSync("fake-server.json")
  ? JSON.parse(readFileSync("fake-server.json", "utf8"))
  : {};
appendFileSync("starts.log", "start\n");
const starts = readFileSync("starts.log", "utf8").trim().split("\n").length;

const docs = new Map();
const received = [];
const slow = new Map();

const write = (message) => {
  const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", ...message }));
  process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
  process.stdout.write(body);
};

const offsetOf = (text, { line, character }) => {
  const lines = text.split("\n");
  let offset = 0;
  for (let index = 0; index < line; index++) offset += lines[index].length + 1;
  return offset + character;
};
const positionOf = (text, offset) => {
  const before = text.slice(0, offset).split("\n");
  return { line: before.length - 1, character: before.at(-1).length };
};
const rangeOf = (text, from, to) => ({ start: positionOf(text, from), end: positionOf(text, to) });

const wordAt = (text, offset) => {
  let from = offset;
  let to = offset;
  while (from > 0 && /\w/.test(text[from - 1])) from--;
  while (to < text.length && /\w/.test(text[to])) to++;
  return { from, to, word: text.slice(from, to) };
};

const occurrences = (text, word) => {
  const found = [];
  for (const match of text.matchAll(new RegExp(`\\b${word}\\b`, "g"))) found.push(match.index);
  return found;
};

const handle = (message) => {
  received.push(message.method ?? `response:${message.id}`);
  const { id, method, params } = message;
  const reply = (result) => write({ id, result });
  switch (method) {
    case "initialize": {
      if (starts <= (config.crashTimes ?? 0)) {
        process.stderr.write("boom\n", () => process.exit(1));
        return;
      }
      const answer = () => {
        reply({
          capabilities: {
            textDocumentSync: 2,
            diagnosticProvider: { interFileDependencies: false, workspaceDiagnostics: false },
            hoverProvider: true,
            renameProvider: true,
            completionProvider: {},
          },
        });
      };
      if (config.waitFor && !existsSync(config.waitFor)) {
        let answered = false;
        const check = () => {
          if (answered || !existsSync(config.waitFor)) return;
          answered = true;
          watcher.close();
          answer();
        };
        const watcher = watch(".", check);
        check();
      } else answer();
      return;
    }
    case "shutdown":
      return reply(null);
    case "exit":
      return process.exit(0);
    case "textDocument/didOpen":
      docs.set(params.textDocument.uri, {
        version: params.textDocument.version,
        text: params.textDocument.text,
      });
      return;
    case "textDocument/didChange": {
      const doc = docs.get(params.textDocument.uri);
      for (const change of params.contentChanges) {
        const from = offsetOf(doc.text, change.range.start);
        const to = offsetOf(doc.text, change.range.end);
        doc.text = doc.text.slice(0, from) + change.text + doc.text.slice(to);
      }
      doc.version = params.textDocument.version;
      return;
    }
    case "textDocument/didClose":
      docs.delete(params.textDocument.uri);
      return;
    case "textDocument/diagnostic": {
      const { text } = docs.get(params.textDocument.uri);
      return reply({
        kind: "full",
        items: occurrences(text, "bad").map((offset) => ({
          range: rangeOf(text, offset, offset + 3),
          severity: 1,
          message: "bad is not allowed",
          code: 7,
          source: "fake",
        })),
      });
    }
    case "textDocument/hover": {
      const { text } = docs.get(params.textDocument.uri);
      const { from, to, word } = wordAt(text, offsetOf(text, params.position));
      return reply({ contents: word, range: rangeOf(text, from, to) });
    }
    case "textDocument/rename": {
      const { text } = docs.get(params.textDocument.uri);
      const { word } = wordAt(text, offsetOf(text, params.position));
      return reply({
        changes: {
          [params.textDocument.uri]: occurrences(text, word).map((offset) => ({
            range: rangeOf(text, offset, offset + word.length),
            newText: params.newName,
          })),
        },
      });
    }
    case "textDocument/completion":
      return reply({
        isIncomplete: false,
        items: Array.from({ length: 500 }, (_, index) => ({
          label: `item${index}`,
          sortText: String(index).padStart(4, "0"),
          documentation: "x".repeat(100),
        })),
      });
    case "test/slow":
      slow.set(id, true);
      return;
    case "$/cancelRequest":
      if (slow.delete(params.id)) {
        write({ id: params.id, error: { code: -32800, message: "Cancelled by the server" } });
      }
      return;
    case "test/state":
      return reply({
        docs: Object.fromEntries(docs),
        received,
      });
    default:
      if (id !== undefined && method !== undefined) {
        write({ id, error: { code: -32601, message: "Not supported" } });
      }
  }
};

let buffer = Buffer.alloc(0);
process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const end = buffer.indexOf("\r\n\r\n");
    if (end < 0) return;
    const length = Number(/Content-Length: (\d+)/i.exec(buffer.subarray(0, end).toString())[1]);
    if (buffer.length < end + 4 + length) return;
    const body = buffer.subarray(end + 4, end + 4 + length).toString();
    buffer = buffer.subarray(end + 4 + length);
    handle(JSON.parse(body));
  }
});
