import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

/** LSP messages are opaque JSON here; each reader checks the shape it needs. */
const JsonText = Schema.fromJsonString(Schema.Unknown);
const decode = Schema.decodeUnknownOption(JsonText);

export const parseJson = (text: string): unknown => Option.getOrNull(decode(text));

export const stringifyJson: (value: unknown) => string = Schema.encodeSync(JsonText);
