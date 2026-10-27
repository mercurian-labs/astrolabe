import { decodeHTMLStrict } from "entities/decode";

/**
 * Decides whether a link target or image source may be used, returning the string to put
 * in the DOM or `null` when it is blocked. Hosts can supply their own.
 */
export type UrlPolicy = (raw: string, kind: "link" | "image") => string | null;

/**
 * Decodes CommonMark backslash escapes and character references: numeric references and
 * the full, case-sensitive HTML5 named set, semicolon required.
 */
export function decodeDestination(raw: string) {
  return raw
    .replace(/\\([!-/:-@[-`{-~])/g, "$1")
    .replace(
      /&(#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[A-Za-z][A-Za-z0-9]*);/g,
      (whole, body: string) => {
        if (body[0] === "#") {
          const code =
            body[1] === "x" || body[1] === "X"
              ? Number.parseInt(body.slice(2), 16)
              : Number.parseInt(body.slice(1), 10);
          return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "\ufffd";
        }
        // Strict decoding: an unknown name, or a legacy name followed by more letters, stays literal.
        return decodeHTMLStrict(whole);
      },
    );
}

/** Removes the angle brackets of a `<…>` destination. */
function unwrapAngleBrackets(raw: string) {
  return raw.length >= 2 && raw.startsWith("<") && raw.endsWith(">") ? raw.slice(1, -1) : raw;
}

const SCHEME = /^([a-z][a-z0-9+.-]*):/i;
const NETWORK_PATH = /^[/\\]{2}/;
const CONTROL = /[\u0000-\u001f\u007f]/;

/**
 * Accepts http, https, mailto (links), data:image (images), and scheme-less relative
 * paths and fragments. Everything else, protocol-relative URLs included, is blocked.
 */
export const defaultUrlPolicy: UrlPolicy = (raw, kind) => {
  const source = unwrapAngleBrackets(raw.trim()).trim();
  const url = decodeDestination(source).trim();
  if (url === "") return null;
  const scheme = SCHEME.exec(url);
  const colon = url.indexOf(":");
  if (CONTROL.test(colon < 0 ? url : url.slice(0, colon))) return null;
  if (!scheme) {
    // Two leading slashes or backslashes in any mix, before or after decoding: browsers read
    // that as a network path. Checking the source too keeps `\/host` out, escape or not.
    if (NETWORK_PATH.test(url) || NETWORK_PATH.test(source)) return null;
    return url;
  }
  const name = scheme[1]?.toLowerCase();
  if (name === "http" || name === "https") return url;
  if (name === "mailto") return kind === "link" ? url : null;
  if (name === "data") return kind === "image" && /^data:image\//i.test(url) ? url : null;
  return null;
};

/** The href a bare or angle autolink points at: `www.` gains https, emails gain mailto. */
export function autolinkHref(text: string) {
  if (/^www\./i.test(text)) return `https://${text}`;
  if (!SCHEME.test(text) && text.includes("@")) return `mailto:${text}`;
  return text;
}
