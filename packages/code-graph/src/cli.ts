/**
 * Index a git tree, or tell a run of commits as an Atlas Graph story (see USAGE). Reads the
 * repository through git only; it never checks anything out.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import {
  buildIndex,
  DEFAULT_MAX_BYTES,
  timed,
  type IndexState,
  type Timings,
} from "./index/build.ts";
import { compareText, type CodeIndex } from "./model/code.ts";
import { languageOf } from "./parse/languages.ts";
import { layerOf, violations } from "./boundaries.ts";
import { buildStory } from "./story.ts";

const USAGE = `usage:
  node src/cli.ts index <repo> [ref] --out index.json [--paths <pathspec...>]
  node src/cli.ts story <repo> <fromRef>..<toRef> --out story.json [--paths <pathspec...>] [--id <id>] [--title <title>]`;

interface Args {
  readonly positional: ReadonlyArray<string>;
  readonly out: string | undefined;
  readonly paths: ReadonlyArray<string>;
  readonly id: string | undefined;
  readonly title: string | undefined;
  readonly boundaries: string | undefined;
  readonly maxBytes: number;
}

function parseArgs(argv: ReadonlyArray<string>): Args {
  const positional: Array<string> = [];
  const paths: Array<string> = [];
  let out: string | undefined;
  let id: string | undefined;
  let title: string | undefined;
  let boundaries: string | undefined;
  let maxBytes = DEFAULT_MAX_BYTES;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";
    if (arg === "--out") out = argv[++index];
    else if (arg === "--id") id = argv[++index];
    else if (arg === "--title") title = argv[++index];
    else if (arg === "--boundaries") boundaries = argv[++index];
    else if (arg === "--max-bytes") maxBytes = Number(argv[++index]);
    else if (arg === "--paths") {
      while (argv[index + 1] !== undefined && !argv[index + 1]?.startsWith("--")) {
        paths.push(argv[++index] ?? "");
      }
    } else positional.push(arg);
  }
  return { positional, out, paths, id, title, boundaries, maxBytes };
}

const count = <T>(items: Iterable<T>, key: (item: T) => string) => {
  const counts: Record<string, number> = {};
  for (const item of items) counts[key(item)] = (counts[key(item)] ?? 0) + 1;
  return Object.fromEntries(
    Object.entries(counts).toSorted(([left], [right]) => compareText(left, right)),
  );
};

function report(state: IndexState, index: CodeIndex, timings: Timings) {
  const line = (label: string, value: unknown) =>
    console.log(`${label.padEnd(22)}${typeof value === "string" ? value : JSON.stringify(value)}`);
  line(
    "files parsed",
    count(state.stats.parsed, (path) => languageOf(path) ?? "?"),
  );
  line("symbols", index.symbols.length);
  line(
    "symbols by kind",
    count(index.symbols, (symbol) => symbol.kind),
  );
  line("with signature / doc", {
    signature: index.symbols.filter((symbol) => symbol.signature !== undefined).length,
    doc: index.symbols.filter((symbol) => symbol.doc !== undefined).length,
  });
  line("edges", index.edges.length);
  line(
    "edges by kind",
    count(index.edges, (edge) => edge.kind),
  );
  line(
    "edges by resolution",
    count(index.edges, (edge) => edge.resolution),
  );
  line("frontier", index.frontier.length);
  line("frontier names", index.frontier.map((symbol) => symbol.name).join(" "));
  line("external uses", index.externals.length);
  line(
    "ms per phase",
    Object.fromEntries(Object.entries(timings).map(([phase, ms]) => [phase, Math.round(ms)])),
  );
}

const PRIMITIVE_ARRAY =
  /^( *)((?:"(?:[^"\\]|\\.)*": )?)\[\n((?: *(?:"(?:[^"\\]|\\.)*"|-?[\d.eE+-]+|true|false|null),?\n)+) *\](,?)$/gm;

/**
 * JSON as the repository's formatter leaves it, so a regenerated fixture is
 * already formatted: two-space indents, and an array of plain values on one
 * line when that line fits in 100 columns.
 */
function formattedJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`.replace(
    PRIMITIVE_ARRAY,
    (whole, indent: string, key: string, items: string, comma: string) => {
      const values = items
        .split("\n")
        .map((item) => item.trim().replace(/,$/, ""))
        .filter((item) => item !== "");
      const line = `${indent}${key}[${values.join(", ")}]${comma}`;
      return line.length <= 100 ? line : whole;
    },
  );
}

function write(out: string, value: unknown) {
  NodeFS.mkdirSync(NodePath.dirname(out), { recursive: true });
  NodeFS.writeFileSync(out, formattedJson(value));
}

async function main(argv: ReadonlyArray<string>) {
  const [command, ...rest] = argv;
  const args = parseArgs(rest);
  const [repoArg, refArg] = args.positional;
  if (
    repoArg === undefined ||
    args.out === undefined ||
    !["index", "story"].includes(command ?? "")
  ) {
    console.error(USAGE);
    process.exit(2);
  }
  const repo = NodePath.resolve(repoArg);
  const out = NodePath.resolve(args.out);
  const options = { paths: args.paths, maxBytes: args.maxBytes };

  if (command === "index") {
    const state = await buildIndex(repo, refArg ?? "HEAD", options);
    const index = state.indexer.snapshot(refArg ?? "HEAD", state.commit);
    await timed(state.timings, "write", async () => write(out, index));
    console.log(out);
    report(state, index, state.timings);
    return;
  }

  const range = /^(.+?)\.\.(.+)$/.exec(refArg ?? "");
  if (range === null) {
    console.error(`story needs a range <fromRef>..<toRef>\n${USAGE}`);
    process.exit(2);
  }
  const [, from = "", to = ""] = range;
  const id = args.id ?? NodePath.basename(out).replace(/(\.story)?\.json$/, "");
  const run = await buildStory(repo, from, to, {
    ...options,
    id,
    ...(args.title === undefined ? {} : { title: args.title }),
    ...(args.boundaries === undefined ? {} : { boundariesFile: args.boundaries }),
  });
  await timed(run.state.timings, "write", async () => write(out, run.story));
  const events = run.story.thread.turns.flatMap((turn) => turn.events);
  console.log(out);
  console.log(`${"turns".padEnd(22)}${run.commits.length}`);
  console.log(
    `${"events by kind".padEnd(22)}${JSON.stringify(count(events, (event) => event.kind))}`,
  );
  for (const turn of run.story.thread.turns) {
    console.log(
      `  ${turn.id.slice(0, 10)} ${JSON.stringify(count(turn.events, (event) => event.kind))} ${turn.label}`,
    );
  }
  console.log(
    `${"memory (first commit)".padEnd(22)}${JSON.stringify({
      notes: run.story.memory.notes.length,
      frontier: run.story.memory.notes.filter((note) => note.frontier).length,
      links: run.story.memory.links.length,
    })}`,
  );
  console.log(`${"removed".padEnd(22)}${run.story.removed.length}`);
  const { boundaries } = run.story;
  if (boundaries !== undefined) {
    const symbols = new Map(run.index.symbols.map((symbol) => [symbol.id, symbol]));
    const crossing = violations(boundaries, run.index.edges, symbols);
    console.log(
      `${"boundaries".padEnd(22)}${boundaries.layers.length} layers, ${boundaries.allowed.length} allowed pairs`,
    );
    console.log(
      `${"violations (last)".padEnd(22)}${crossing.length} ${JSON.stringify(count(crossing, (edge) => edge.kind))}`,
    );
    const pairs = count(crossing, (edge) => {
      const layer = (id: string) => layerOf(boundaries, symbols.get(id)?.path ?? "") ?? "?";
      return `${layer(edge.from)} → ${layer(edge.to)}`;
    });
    console.log(`${"  by layer pair".padEnd(22)}${JSON.stringify(pairs)}`);
  }
  console.log("index at the last commit (files parsed and ms cover the whole run):");
  report(run.state, run.index, run.state.timings);
}

await main(process.argv.slice(2));
