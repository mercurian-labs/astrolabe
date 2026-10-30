import { stringifyJson } from "./json.ts";

/** LSP's base protocol: each JSON-RPC message behind a `Content-Length` header. */

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const HEADER_END = encoder.encode("\r\n\r\n");

export const encodeMessage = (message: unknown): Uint8Array => {
  const body = encoder.encode(stringifyJson(message));
  const header = encoder.encode(`Content-Length: ${body.length}\r\n\r\n`);
  const framed = new Uint8Array(header.length + body.length);
  framed.set(header);
  framed.set(body, header.length);
  return framed;
};

const indexOfHeaderEnd = (buffer: Uint8Array): number => {
  outer: for (let index = 0; index + HEADER_END.length <= buffer.length; index++) {
    for (let offset = 0; offset < HEADER_END.length; offset++) {
      if (buffer[index + offset] !== HEADER_END[offset]) continue outer;
    }
    return index;
  }
  return -1;
};

class FramingError extends Error {}

/** Splits a byte stream into message bodies, as text; chunks may cut anywhere. */
export class MessageDecoder {
  private buffer = new Uint8Array(0);

  push(chunk: Uint8Array): Array<string> {
    const joined = new Uint8Array(this.buffer.length + chunk.length);
    joined.set(this.buffer);
    joined.set(chunk, this.buffer.length);
    this.buffer = joined;
    const messages: Array<string> = [];
    for (;;) {
      const end = indexOfHeaderEnd(this.buffer);
      if (end < 0) break;
      const header = decoder.decode(this.buffer.subarray(0, end));
      const match = /content-length:\s*(\d+)/i.exec(header);
      if (match === null) throw new FramingError("A message has no Content-Length header.");
      const start = end + HEADER_END.length;
      const length = Number(match[1]);
      if (this.buffer.length < start + length) break;
      messages.push(decoder.decode(this.buffer.subarray(start, start + length)));
      this.buffer = this.buffer.slice(start + length);
    }
    return messages;
  }
}
