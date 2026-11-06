/** Commit trailers that identify an amendment; they survive rebases and merges. */
export interface AmendmentTrailers {
  readonly amendment: string;
  readonly actor: string;
  readonly changeRequest?: string;
  readonly thread?: string;
  readonly reverts?: string;
  /** The document a person's autosave was editing; a later save of it can replace this commit. */
  readonly autosave?: string;
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
