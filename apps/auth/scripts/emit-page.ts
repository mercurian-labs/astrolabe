// @effect-diagnostics nodeBuiltinImport:off - A build step that runs before any Effect runtime exists.
// Inlines the Vite build into one HTML document and exports it as a module,
// which the cloud API bundles and serves for every page path. Run after `vp build`.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

const dist = NodePath.resolve(import.meta.dirname, "../dist");
let html = NodeFS.readFileSync(NodePath.join(dist, "index.html"), "utf8");

const read = (href: string) =>
  NodeFS.readFileSync(NodePath.join(dist, href.replace(/^\//, "")), "utf8");
// `</script` inside the bundle would end the inline element early.
const escapeScript = (code: string) => code.replaceAll("</script", "<\\/script");

html = html.replace(
  /<script type="module" crossorigin src="([^"]+)"><\/script>/,
  (_, src: string) => `<script type="module">${escapeScript(read(src))}</script>`,
);
html = html.replace(
  /<link rel="stylesheet" crossorigin href="([^"]+)">/,
  (_, href: string) => `<style>${read(href)}</style>`,
);
if (/<script[^>]+src=|<link rel="stylesheet"/.test(html)) {
  throw new Error("emit-page: an asset was not inlined");
}
NodeFS.writeFileSync(NodePath.join(dist, "page.js"), `export default ${JSON.stringify(html)};\n`);
console.log(`emit-page: ${Math.round(html.length / 1024)} KB`);
