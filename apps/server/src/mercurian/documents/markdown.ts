import * as NodeCrypto from "node:crypto";
import * as Schema from "effect/Schema";
import { parseDocument, stringify } from "yaml";

const Metadata = Schema.Struct({
  id: Schema.optional(Schema.String),
  title: Schema.optional(Schema.String),
  kind: Schema.optional(Schema.Literals(["plan", "spec"])),
  counterparts: Schema.optional(Schema.Array(Schema.String)),
  origin: Schema.optional(
    Schema.Struct({ url: Schema.String, revision: Schema.optional(Schema.String) }),
  ),
});

const decodeMetadata = Schema.decodeUnknownSync(Metadata);
const encodeRevisionFields = Schema.encodeSync(Schema.fromJsonString(Schema.Array(Schema.String)));

/** Metadata is optional; malformed metadata never makes the Markdown body unreadable. */
export function readDocumentMarkdown(contents: string, filename: string) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(contents);
  const body = match ? contents.slice(match[0].length) : contents;
  const title = /^#\s+(.+)$/mu.exec(body)?.[1]?.trim() ?? filename.replace(/\.md$/iu, "");
  if (!match) return { title, body, metadata: null, problem: null };
  try {
    const parsed = parseDocument(match[1]!, { uniqueKeys: true });
    if (parsed.errors.length) throw parsed.errors[0];
    const metadata = decodeMetadata(parsed.toJS({ maxAliasCount: 20 }));
    return { title: metadata.title?.trim() || title, body, metadata, problem: null };
  } catch {
    return { title, body, metadata: null, problem: "Invalid document frontmatter" };
  }
}

export function importedSpecMarkdown(input: {
  id: string;
  url: string;
  goal: string;
  acceptanceCriteria: string;
}) {
  return `---\n${stringify({ id: input.id, title: input.goal, kind: "spec", origin: { url: input.url, revision: specRevision(input.goal, input.acceptanceCriteria) } })}---\n\n# Goal\n\n${input.goal}\n\n# Acceptance criteria\n\n${input.acceptanceCriteria}\n`;
}

/** Preserve the exact metadata block while replacing the reviewed spec body. */
export function replaceSpecBody(contents: string, goal: string, acceptanceCriteria: string) {
  const frontmatter = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/u.exec(contents)?.[0] ?? "";
  return `${frontmatter}${frontmatter ? "\n" : ""}# Goal\n\n${goal}\n\n# Acceptance criteria\n\n${acceptanceCriteria}\n`;
}

export function specRevision(goal: string, acceptanceCriteria: string) {
  return NodeCrypto.createHash("sha256")
    .update(encodeRevisionFields([goal, acceptanceCriteria]))
    .digest("hex");
}
export function readSpecBody(contents: string) {
  const body = readDocumentMarkdown(contents, "spec.md").body;
  const goal = /^# Goal\s*\r?\n([\s\S]*?)(?=^# |$(?![\s\S]))/mu.exec(body)?.[1]?.trim();
  const acceptanceCriteria = /^# Acceptance criteria\s*\r?\n([\s\S]*?)(?=^# |$(?![\s\S]))/mu
    .exec(body)?.[1]
    ?.trim();
  return goal === undefined || acceptanceCriteria === undefined
    ? null
    : { goal, acceptanceCriteria };
}
export function refreshSpecMarkdown(
  contents: string,
  goal: string,
  acceptanceCriteria: string,
  upstreamRevision = specRevision(goal, acceptanceCriteria),
) {
  const header = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(contents);
  if (!header || !readSpecBody(contents))
    throw new Error("Imported spec sections or frontmatter are missing");
  const metadata = parseDocument(header[1]!);
  if (metadata.errors.length) throw new Error("Invalid spec frontmatter");
  metadata.setIn(["origin", "revision"], upstreamRevision);
  const body = contents
    .slice(header[0].length)
    .replace(
      /(^# Goal\s*\r?\n)[\s\S]*?(?=^# |$(?![\s\S]))/mu,
      (_, heading: string) => `${heading}\n${goal}\n\n`,
    )
    .replace(
      /(^# Acceptance criteria\s*\r?\n)[\s\S]*?(?=^# |$(?![\s\S]))/mu,
      (_, heading: string) => `${heading}\n${acceptanceCriteria}\n\n`,
    );
  return `---\n${metadata.toString()}---\n${body}`;
}
