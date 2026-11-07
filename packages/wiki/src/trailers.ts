/** A file an amendment moved. */
export interface WikiMove {
  readonly from: string;
  readonly to: string;
}

/** Commit trailers that identify an amendment; they survive rebases and merges. */
export interface AmendmentTrailers {
  readonly amendment: string;
  readonly actor: string;
  readonly changeRequest?: string;
  readonly thread?: string;
  readonly reverts?: string;
  /** The document a person's autosave was editing; a later save of it can replace this commit. */
  readonly autosave?: string;
  /** What it moved: an edit can take a move below what git recognises as one. */
  readonly moved?: ReadonlyArray<WikiMove>;
}

const oneLine = (text: string): string => text.replace(/[\r\n]+/g, " ").trim();

export function amendmentMessage(message: string, trailers: AmendmentTrailers): string {
  const lines = [
    `Wiki-Amendment: ${oneLine(trailers.amendment)}`,
    `Wiki-Actor: ${oneLine(trailers.actor)}`,
  ];
  if (trailers.changeRequest) lines.push(`Wiki-Change-Request: ${oneLine(trailers.changeRequest)}`);
  if (trailers.thread) lines.push(`Wiki-Thread: ${oneLine(trailers.thread)}`);
  if (trailers.reverts) lines.push(`Reverts-Amendment: ${oneLine(trailers.reverts)}`);
  if (trailers.autosave) lines.push(`Wiki-Autosave: ${oneLine(trailers.autosave)}`);
  for (const { from, to } of trailers.moved ?? []) {
    lines.push(`Wiki-Moved: ${JSON.stringify([from, to])}`);
  }
  return `${message.trim()}\n\n${lines.join("\n")}\n`;
}

export function parseAmendmentTrailers(body: string): AmendmentTrailers | undefined {
  const value = (name: string) => new RegExp(`^${name}: (.+)$`, "m").exec(body)?.[1]?.trim();
  const amendment = value("Wiki-Amendment") ?? value("Memory-Amendment");
  if (!amendment) return undefined;
  const changeRequest = value("Wiki-Change-Request");
  const thread = value("Wiki-Thread");
  const reverts = value("Reverts-Amendment");
  const autosave = value("Wiki-Autosave");
  return {
    amendment,
    actor: value("Wiki-Actor") ?? value("Memory-Actor") ?? "unknown",
    ...(changeRequest ? { changeRequest } : {}),
    ...(thread ? { thread } : {}),
    ...(reverts ? { reverts } : {}),
    ...(autosave ? { autosave } : {}),
  };
}

/** A `git log --format` that prints each commit's moves, one a line, for {@link parseMoves}. */
export const MOVES_LOG_FORMAT = "%(trailers:key=Wiki-Moved,valueonly)";

const parseMove = (line: string): ReadonlyArray<WikiMove> => {
  try {
    const value: unknown = JSON.parse(line);
    return Array.isArray(value) && typeof value[0] === "string" && typeof value[1] === "string"
      ? [{ from: value[0], to: value[1] }]
      : [];
  } catch {
    return [];
  }
};

export const parseMoves = (output: string): ReadonlyArray<WikiMove> =>
  output.split("\n").flatMap(parseMove);
