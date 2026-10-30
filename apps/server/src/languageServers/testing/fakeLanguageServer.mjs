// A language server for tests, configured by `fake-server.json` in its working directory:
// `crashTimes` exits at `initialize` on that many starts (counted in `starts.log`), `waitFor`
// answers `initialize` once that file exists, `watch` registers those file watchers (a base uri
// of "." is its working directory). Every "bad" is an error diagnostic.
import * as NodeFS from "node:fs";
import * as NodeURL from "node:url";

const config = NodeFS.existsSync("fake-server.json")
  ? JSON.parse(NodeFS.readFileSync("fake-server.json", "utf8"))
  : {};
NodeFS.appendFileSync("starts.log", "start\n");
const starts = NodeFS.readFileSync("starts.log", "utf8").trim().split("\n").length;

const docs = new Map();
const received = [];
const slow = new Map();
// The server's own requests to the client, by id: what to do with each answer.
const asked = new Map();
let askedCount = 0;
// Each `workspace/didChangeWatchedFiles`'s changes, and `test/watched` requests waiting for more.
const watched = [];
const watchedWaiting = [];
const answerWatched = () => {
  for (const waiting of watchedWaiting.filter(({ count }) => watched.length >= count)) {
    watchedWaiting.splice(watchedWaiting.indexOf(waiting), 1);
    write({ id: waiting.id, result: watched });
  }
};

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
  if (method === undefined && asked.has(id)) {
    asked.get(id)(message.result);
    asked.delete(id);
    return;
  }
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
            definitionProvider: true,
            documentFormattingProvider: true,
            codeActionProvider: { resolveProvider: true },
            executeCommandProvider: { commands: ["fake.removeLine"] },
            referencesProvider: true,
            completionProvider: { resolveProvider: true, triggerCharacters: ["."] },
          },
        });
      };
      if (config.waitFor && !NodeFS.existsSync(config.waitFor)) {
        let answered = false;
        const check = () => {
          if (answered || !NodeFS.existsSync(config.waitFor)) return;
          answered = true;
          watcher.close();
          answer();
        };
        const watcher = NodeFS.watch(".", check);
        check();
      } else answer();
      return;
    }
    case "initialized": {
      if (!config.watch) return;
      const here = `${NodeURL.pathToFileURL(process.cwd()).href}/`;
      const watchers = config.watch.map((watcher) =>
        watcher.globPattern?.baseUri === "."
          ? { ...watcher, globPattern: { ...watcher.globPattern, baseUri: here } }
          : watcher,
      );
      const askId = `fake-${++askedCount}`;
      asked.set(askId, () => {});
      write({
        id: askId,
        method: "client/registerCapability",
        params: {
          registrations: [
            {
              id: "fake-watch",
              method: "workspace/didChangeWatchedFiles",
              registerOptions: { watchers },
            },
          ],
        },
      });
      return;
    }
    case "workspace/didChangeWatchedFiles":
      watched.push(params.changes);
      return answerWatched();
    case "test/watched":
      // Answers once `count` notifications have come, with all of them.
      watchedWaiting.push({ id, count: params.count });
      return answerWatched();
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
      // A word named `huge` answers with more than a hover may carry.
      const contents = word === "huge" ? `\`\`\`ts\n${"x".repeat(200_000)}\n\`\`\`` : word;
      return reply({ contents, range: rangeOf(text, from, to) });
    }
    case "textDocument/definition":
    case "textDocument/references": {
      // A word's definition is its first use; `elsewhere` in the config places one in another
      // file, given as a path in the checkout and the 0-based line and character there.
      const { text } = docs.get(params.textDocument.uri);
      const { word } = wordAt(text, offsetOf(text, params.position));
      const found = occurrences(text, word).map((offset) => ({
        uri: params.textDocument.uri,
        range: rangeOf(text, offset, offset + word.length),
      }));
      const elsewhere = config.elsewhere?.[word];
      const outside = elsewhere
        ? [
            {
              uri: new URL(elsewhere.path, `file://${process.cwd()}/`).href,
              range: {
                start: { line: elsewhere.line, character: elsewhere.character },
                end: { line: elsewhere.line, character: elsewhere.character + word.length },
              },
            },
          ]
        : [];
      if (method === "textDocument/references") return reply([...found, ...outside]);
      return reply(outside.length > 0 ? outside : found.slice(0, 1));
    }
    case "textDocument/formatting": {
      // Formatting puts one space after each comma; `formatDelay` (ms) makes it slow.
      const { text } = docs.get(params.textDocument.uri);
      const edits = [...text.matchAll(/,(?! )/g)].map((match) => ({
        range: rangeOf(text, match.index + 1, match.index + 1),
        newText: " ",
      }));
      if (config.formatDelay) setTimeout(() => reply(edits), config.formatDelay);
      else reply(edits);
      return;
    }
    case "textDocument/codeAction": {
      // Each "bad" diagnostic offers a fix that needs resolving, and a command that edits.
      const actions = (params.context?.diagnostics ?? []).flatMap((diagnostic) =>
        diagnostic.message !== "bad is not allowed"
          ? []
          : [
              {
                title: "Replace bad with good",
                kind: "quickfix",
                isPreferred: true,
                data: { uri: params.textDocument.uri, range: diagnostic.range },
              },
              {
                title: "Remove the line",
                command: "fake.removeLine",
                arguments: [params.textDocument.uri, diagnostic.range.start.line],
              },
            ],
      );
      return reply(actions);
    }
    case "codeAction/resolve":
      return reply({
        ...params,
        edit: { changes: { [params.data.uri]: [{ range: params.data.range, newText: "good" }] } },
      });
    case "workspace/executeCommand": {
      const [uri, line] = params.arguments;
      const askId = `fake-${++askedCount}`;
      asked.set(askId, () => reply(null));
      write({
        id: askId,
        method: "workspace/applyEdit",
        params: {
          edit: {
            changes: {
              [uri]: [
                {
                  range: { start: { line, character: 0 }, end: { line: line + 1, character: 0 } },
                  newText: "",
                },
              ],
            },
          },
        },
      });
      return;
    }
    case "textDocument/rename": {
      const { text } = docs.get(params.textDocument.uri);
      const { word } = wordAt(text, offsetOf(text, params.position));
      const editsIn = (fileText) =>
        occurrences(fileText, word).map((offset) => ({
          range: rangeOf(fileText, offset, offset + word.length),
          newText: params.newName,
        }));
      const changes = { [params.textDocument.uri]: editsIn(text) };
      // `renameAlso` names a file the server reads from disk, as it does files nobody opened.
      if (config.renameAlso) {
        const uri = new URL(config.renameAlso, `file://${process.cwd()}/`).href;
        changes[uri] = editsIn(NodeFS.readFileSync(config.renameAlso, "utf8"));
      }
      return reply({ changes });
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
    case "completionItem/resolve":
      // An auto-import: the edit lands at the top of the file the completion list was for.
      return reply({
        ...params,
        documentation: `About ${params.label}`,
        additionalTextEdits: [
          {
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
            newText: `import { ${params.label} } from "./lib";\n`,
          },
        ],
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
