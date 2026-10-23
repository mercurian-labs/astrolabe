import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { build } from "vite-plus";

const mobileRoot = NodePath.resolve(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "..");
const workspaceRoot = NodePath.resolve(mobileRoot, "../..");

/** The page's source, which the generated document is rebuilt from when it changes. */
export const wikiEditorSources = [
  NodePath.join(workspaceRoot, "packages/wiki-editor/src"),
  NodePath.join(workspaceRoot, "packages/editor/src"),
];

/**
 * Builds the wiki editor page (`@mercurian/wiki-editor`'s `mobilePage.tsx`) into one HTML
 * document, script and styles inline, which Metro embeds as a string and the document screen
 * loads into a WebView. The page then needs nothing from the network or the server.
 */
export async function generateWikiEditorPage() {
  const result = await build({
    configFile: false,
    logLevel: "silent",
    // Always a production page, whatever NODE_ENV Metro runs under: a development JSX
    // transform against React's production build leaves `jsxDEV` undefined and the page blank.
    mode: "production",
    oxc: { jsx: { runtime: "automatic", development: false } },
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    resolve: {
      // What a phone's reading and editing never reach stays out of the inline script.
      alias: {
        "@codemirror/language-data": NodePath.join(
          mobileRoot,
          "scripts/wiki-editor-stubs/language-data.ts",
        ),
        "@replit/codemirror-vim": NodePath.join(
          mobileRoot,
          "scripts/wiki-editor-stubs/codemirror-vim.ts",
        ),
      },
    },
    build: {
      write: false,
      target: "es2022",
      minify: true,
      cssCodeSplit: false,
      lib: {
        entry: NodePath.join(workspaceRoot, "packages/wiki-editor/src/mobilePage.tsx"),
        name: "T3WikiEditor",
        formats: ["iife"],
      },
    },
  });
  const bundles = Array.isArray(result) ? result : [result];
  const outputs = bundles.flatMap((bundle) => ("output" in bundle ? bundle.output : []));
  const chunk = outputs.find((output) => output.type === "chunk");
  if (!chunk || chunk.type !== "chunk") throw new Error("The wiki editor build emitted no script.");
  // KaTeX lists each font as woff2, woff and ttf, all inlined; every WebView reads woff2.
  const css = outputs
    .filter((output) => output.type === "asset" && output.fileName.endsWith(".css"))
    .map((output) => (output.type === "asset" ? String(output.source) : ""))
    .join("\n")
    .replace(
      /,\s*url\(["']?data:font\/(?:woff|ttf|truetype)[^)]*\)\s*format\(["']?(?:woff|truetype)["']?\)/g,
      "",
    );
  // A script's text ends at the first `</script`, wherever it appears.
  const script = chunk.code.replaceAll("</script", "<\\/script");
  const html = [
    "<!doctype html>",
    '<html><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover">',
    `<style>${css.replaceAll("</style", "<\\/style")}</style>`,
    '</head><body><div id="root"></div>',
    `<script>${script}</script>`,
    "</body></html>",
  ].join("");
  const root = NodePath.join(mobileRoot, ".generated", "wiki-editor");
  await NodeFSP.mkdir(root, { recursive: true });
  for (const [file, contents] of [
    ["index.js", `module.exports = ${JSON.stringify(html)};\n`],
    ["package.json", '{"main":"index.js"}\n'],
  ] as const) {
    const destination = NodePath.join(root, file);
    const previous = await NodeFSP.readFile(destination, "utf8").catch(() => null);
    if (previous !== contents) await NodeFSP.writeFile(destination, contents);
  }
  return html.length;
}
