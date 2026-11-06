// A language server for tests, configured by `fake-server.json` in its working directory.
// `pushes` publishes instead of answering pulls, nothing at first and the real ones `pushes.after`
// ms later; `quiescentOn` answers pulls with nothing until that file exists, then reports it
// finished; `chatter` writes that many stderr lines at startup. Every "bad" is an error diagnostic.
import * as NodeFS from "node:fs";
import * as NodeURL from "node:url";

// One server of several on a file: `roles[name]` overrides the config, and `word` (what it
// reports), `source`, `without` (capabilities it lacks), `hoverNull`, `completions`, `replacement`,
// `formatInsert` and `slow` (methods answered only when cancelled) tell it from the others.
const role = process.argv.find((arg) => arg.startsWith("--role="))?.slice("--role=".length);
const shared = NodeFS.existsSync("fake-server.json")
  ? JSON.parse(NodeFS.readFileSync("fake-server.json", "utf8"))
  : {};
const config = role === undefined ? shared : { ...shared, ...shared.roles?.[role] };
const startsLog = role === undefined ? "starts.log" : `starts-${role}.log`;
NodeFS.appendFileSync(startsLog, "start\n");
const starts = NodeFS.readFileSync(startsLog, "utf8").trim().split("\n").length;
const word = config.word ?? "bad";

const docs = new Map();
const received = [];
const slow = new Map();
// The server's own requests to the client, by id: what to do with each answer.
const asked = new Map();
let askedCount = 0;
// Each `workspace/didChangeWatchedFiles`'s changes, and `test/watched` requests waiting for more.
const watched = [];
const watchedWaiting = [];
// Each `textDocument/didSave`'s uri, and `test/saved` requests waiting for more.
const saved = [];
const savedWaiting = [];
const answerSaved = () => {
  for (const waiting of savedWaiting.filter(({ count }) => saved.length >= count)) {
    savedWaiting.splice(savedWaiting.indexOf(waiting), 1);
    write({ id: waiting.id, result: saved });
  }
};
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

const diagnosticsOf = (text) =>
  occurrences(text, word).map((offset) => ({
    range: rangeOf(text, offset, offset + word.length),
    severity: 1,
    message: `${word} is not allowed`,
    code: 7,
    ...(config.source === null ? {} : { source: config.source ?? "fake" }),
  }));

const publish = (uri, version, diagnostics) =>
  write({ method: "textDocument/publishDiagnostics", params: { uri, version, diagnostics } });

const pushDiagnostics = (uri, version) => {
  publish(uri, version, []);
  setTimeout(() => publish(uri, version, diagnosticsOf(docs.get(uri).text)), config.pushes.after);
};

if (config.quiescentOn) {
  const watcher = NodeFS.watch(".", () => {
    if (!NodeFS.existsSync(config.quiescentOn)) return;
    watcher.close();
    write({ method: "experimental/serverStatus", params: { health: "ok", quiescent: true } });
  });
}

const handle = (message) => {
  received.push(message.method ?? `response:${message.id}`);
  const { id, method, params } = message;
  const reply = (result) => write({ id, result });
  if (method === undefined && asked.has(id)) {
    asked.get(id)(message.result);
    asked.delete(id);
    return;
  }
  if (config.slow?.includes(method)) {
    slow.set(id, true);
    return;
  }
  switch (method) {
    case "initialize": {
      if (starts <= (config.crashTimes ?? 0)) {
        process.stderr.write("boom\n", () => process.exit(1));
        return;
      }
      for (let line = 1; line <= (config.chatter ?? 0); line++) {
        process.stderr.write(`chatter ${line}\n`);
      }
      write({ method: "window/logMessage", params: { type: 3, message: "fake is starting" } });
      write({ method: "window/showMessage", params: { type: 2, message: "fake wants a look" } });
      const answer = () => {
        const capabilities = {
          textDocumentSync: config.fullSync
            ? 1
            : config.save
              ? { openClose: true, change: 2, save: true }
              : 2,
          ...(config.pushes
            ? {}
            : {
                diagnosticProvider: { interFileDependencies: false, workspaceDiagnostics: false },
              }),
          hoverProvider: true,
          renameProvider: true,
          definitionProvider: true,
          documentFormattingProvider: true,
          codeActionProvider: { resolveProvider: true },
          executeCommandProvider: { commands: ["fake.removeLine"] },
          referencesProvider: true,
          inlayHintProvider: true,
          documentHighlightProvider: true,
          linkedEditingRangeProvider: true,
          semanticTokensProvider: {
            legend: { tokenTypes: ["variable"], tokenModifiers: [] },
            full: { delta: true },
          },
          completionProvider: {
            resolveProvider: true,
            triggerCharacters: config.triggerCharacters ?? ["."],
          },
        };
        for (const capability of config.without ?? []) delete capabilities[capability];
        reply({ serverInfo: { name: "fake", version: "9.9.9" }, capabilities });
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
    case "textDocument/didSave":
      saved.push(params.textDocument.uri);
      return answerSaved();
    case "test/push":
      publish(params.uri, params.version, params.diagnostics);
      return reply(null);
    case "test/saved":
      savedWaiting.push({ id, count: params.count });
      return answerSaved();
    case "test/configuration": {
      // Asks the client for these sections, and answers with what it said.
      const askId = `fake-${++askedCount}`;
      asked.set(askId, (result) => reply(result));
      write({ id: askId, method: "workspace/configuration", params: { items: params.items } });
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
      if (config.pushes) pushDiagnostics(params.textDocument.uri, params.textDocument.version);
      return;
    case "textDocument/didChange": {
      const doc = docs.get(params.textDocument.uri);
      for (const change of params.contentChanges) {
        if (config.fullSync) {
          if (change.range) throw new Error("This server takes whole texts.");
          doc.text = change.text;
          continue;
        }
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
      const loading = config.quiescentOn && !NodeFS.existsSync(config.quiescentOn);
      return reply({ kind: "full", items: loading ? [] : diagnosticsOf(text) });
    }
    case "textDocument/hover": {
      if (config.hoverNull) return reply(null);
      const { text } = docs.get(params.textDocument.uri);
      const hovered = wordAt(text, offsetOf(text, params.position));
      // A word named `huge` answers with more than a hover may carry.
      const contents =
        hovered.word === "huge"
          ? `\`\`\`ts\n${"x".repeat(200_000)}\n\`\`\``
          : role === undefined
            ? hovered.word
            : `${role}: ${hovered.word}`;
      return reply({ contents, range: rangeOf(text, hovered.from, hovered.to) });
    }
    case "textDocument/definition":
    case "textDocument/references": {
      // A word's definition is its first use; `elsewhere` in the config places one in another
      // file, given as a path in the checkout and the 0-based line and character there.
      const { text } = docs.get(params.textDocument.uri);
      const target = wordAt(text, offsetOf(text, params.position)).word;
      const found = occurrences(text, target).map((offset) => ({
        uri: params.textDocument.uri,
        range: rangeOf(text, offset, offset + target.length),
      }));
      const elsewhere = config.elsewhere?.[target];
      const outside = elsewhere
        ? [
            {
              uri: new URL(elsewhere.path, `file://${process.cwd()}/`).href,
              range: {
                start: { line: elsewhere.line, character: elsewhere.character },
                end: { line: elsewhere.line, character: elsewhere.character + target.length },
              },
            },
          ]
        : [];
      if (method === "textDocument/references") return reply([...found, ...outside]);
      return reply(outside.length > 0 ? outside : found.slice(0, 1));
    }
    case "textDocument/inlayHint": {
      // After each `point`, a type its click writes.
      const { text } = docs.get(params.textDocument.uri);
      const from = offsetOf(text, params.range.start);
      const to = offsetOf(text, params.range.end);
      return reply(
        occurrences(text, "point")
          .map((offset) => offset + "point".length)
          .filter((offset) => from <= offset && offset <= to)
          .map((offset) => ({
            position: positionOf(text, offset),
            label: ": Point",
            kind: 1,
            textEdits: [{ range: rangeOf(text, offset, offset), newText: ": Point" }],
          })),
      );
    }
    case "textDocument/documentHighlight": {
      // The word's first use is its write.
      const { text } = docs.get(params.textDocument.uri);
      const target = wordAt(text, offsetOf(text, params.position)).word;
      return reply(
        occurrences(text, target).map((offset, index) => ({
          range: rangeOf(text, offset, offset + target.length),
          kind: index === 0 ? 3 : 2,
        })),
      );
    }
    case "textDocument/linkedEditingRange": {
      const { text } = docs.get(params.textDocument.uri);
      const target = wordAt(text, offsetOf(text, params.position)).word;
      return reply({
        ranges: occurrences(text, target).map((offset) =>
          rangeOf(text, offset, offset + target.length),
        ),
      });
    }
    case "textDocument/semanticTokens/full": {
      // Each `point`, as a variable.
      const { text } = docs.get(params.textDocument.uri);
      let line = 0;
      let character = 0;
      const data = occurrences(text, "point").flatMap((offset) => {
        const at = positionOf(text, offset);
        const token = [
          at.line - line,
          at.line === line ? at.character - character : at.character,
          "point".length,
          0,
          0,
        ];
        line = at.line;
        character = at.character;
        return token;
      });
      return reply({ resultId: "1", data });
    }
    case "test/refresh": {
      const askId = `fake-${++askedCount}`;
      asked.set(askId, () => {});
      reply(null);
      write({ id: askId, method: params.method });
      return;
    }
    case "textDocument/formatting": {
      // Formatting puts one space after each comma; `formatDelay` (ms) makes it slow.
      const { text } = docs.get(params.textDocument.uri);
      const edits = [...text.matchAll(/,(?! )/g)].map((match) => ({
        range: rangeOf(text, match.index + 1, match.index + 1),
        newText: config.formatInsert ?? " ",
      }));
      if (config.formatDelay) setTimeout(() => reply(edits), config.formatDelay);
      else reply(edits);
      return;
    }
    case "textDocument/codeAction": {
      // Each "bad" diagnostic offers a fix that needs resolving, and a command that edits.
      const actions = (params.context?.diagnostics ?? []).flatMap((diagnostic) =>
        diagnostic.message !== `${word} is not allowed`
          ? []
          : [
              {
                title: `Replace ${word} with ${config.replacement ?? "good"}`,
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
        edit: {
          changes: {
            [params.data.uri]: [
              { range: params.data.range, newText: config.replacement ?? "good" },
            ],
          },
        },
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
      const target = wordAt(text, offsetOf(text, params.position)).word;
      const editsIn = (fileText) =>
        occurrences(fileText, target).map((offset) => ({
          range: rangeOf(fileText, offset, offset + target.length),
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
        isIncomplete: config.incomplete === true,
        items:
          config.completions?.map((label) => ({ label })) ??
          Array.from({ length: 500 }, (_, index) => ({
            label: `item${index}`,
            sortText: String(index).padStart(4, "0"),
            documentation: "x".repeat(100),
          })),
      });
    case "completionItem/resolve":
      // An auto-import: the edit lands at the top of the file the completion list was for.
      return reply({
        ...params,
        documentation: `About ${params.label}${role === undefined ? "" : ` from ${role}`}`,
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
