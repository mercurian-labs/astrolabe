#!/usr/bin/env node

// Copies Astrolabe's approved marks from the branding repository into the product, split into
// the layers it colours separately: lettering ("ink", #292724) and pivot, full stop and loading
// dots ("dots", #A0492A). Usage: `node scripts/sync-brand-marks.ts <branding-repo>`, then `vp fmt`
// astrolabeMarkLayers.ts and run `vp run icons:export` and `vp run icons:export:android`.

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { Argument, Command } from "effect/cli";

const INK = "#292724";
const RUST = "#A0492A";
const MASK = "#000";

interface Element {
  readonly name: string;
  readonly attrs: Map<string, string>;
  readonly children: Element[];
}

/** Parses the generated SVGs the branding scripts write: elements and attributes, no text. */
function parseSvg(source: string): Element {
  const root: Element = { name: "#root", attrs: new Map(), children: [] };
  const stack: Element[] = [root];
  for (const match of source.matchAll(/<(\/?)([\w:-]+)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>/g)) {
    const [, closing, name, rawAttrs, selfClosing] = match;
    if (closing) {
      stack.pop();
      continue;
    }
    const attrs = new Map(
      Array.from(rawAttrs!.matchAll(/([\w:-]+)="([^"]*)"/g), ([, key, value]) => [key!, value!]),
    );
    const element: Element = { name: name!, attrs, children: [] };
    stack.at(-1)!.children.push(element);
    if (!selfClosing) stack.push(element);
  }
  const svg = root.children.find((child) => child.name === "svg");
  if (!svg) throw new Error("No <svg> element.");
  return svg;
}

/** Keeps the shapes `keep` accepts, and the groups that still hold one. */
function filterShapes(element: Element, keep: (shape: Element) => boolean): Element | null {
  if (element.name === "g") {
    const children = element.children
      .map((child) => filterShapes(child, keep))
      .filter((child) => child !== null);
    return children.length > 0 ? { ...element, children } : null;
  }
  if (element.name === "path" || element.name === "circle") return keep(element) ? element : null;
  return null;
}

function withFill(element: Element, fill: string): Element {
  const attrs = new Map(element.attrs);
  if (attrs.has("fill")) attrs.set("fill", fill);
  return { ...element, attrs, children: element.children.map((child) => withFill(child, fill)) };
}

function serialize(element: Element): string {
  const attrs = Array.from(element.attrs, ([key, value]) => ` ${key}="${value}"`).join("");
  if (element.children.length === 0) return `<${element.name}${attrs}/>`;
  return `<${element.name}${attrs}>${element.children.map(serialize).join("")}</${element.name}>`;
}

function svgDocument(source: Element, shapes: ReadonlyArray<Element>): string {
  return `${serialize({ ...source, children: [...shapes] })}\n`;
}

const fillOf = (shape: Element) => shape.attrs.get("fill")?.toUpperCase();

/** One layer as a black mask on the source's canvas. */
function maskLayer(source: Element, keep: (shape: Element) => boolean): Element[] {
  return source.children
    .map((child) => filterShapes(child, keep))
    .filter((child) => child !== null)
    .map((child) => withFill(child, MASK));
}

const loadingDot = (element: Element) => element.attrs.get("data-loading-dot");

interface Layers {
  readonly source: Element;
  readonly ink: Element[];
  readonly dots: Element[];
}

function splitMark(svg: string): Layers {
  const source = parseSvg(svg);
  return {
    source,
    ink: maskLayer(source, (shape) => fillOf(shape) === INK),
    dots: maskLayer(source, (shape) => fillOf(shape) === RUST),
  };
}

const round = (value: string) => Number(Number(value).toFixed(4));

/** A layer as the mobile app's `MarkLayer`: each top-level shape or group under its transform. */
function markLayerSource(name: string, layers: Layers, which: "ink" | "dots"): string {
  const shapeSource = (shape: Element): string =>
    shape.name === "circle"
      ? `{ circle: [${["cx", "cy", "r"].map((key) => round(shape.attrs.get(key)!)).join(", ")}] }`
      : `{ d: ${JSON.stringify(shape.attrs.get("d"))}, evenOdd: ${shape.attrs.get("fill-rule") === "evenodd"} }`;
  const nodeSource = (node: Element): string => {
    const shapes = node.name === "g" ? node.children : [node];
    if (shapes.some((shape) => shape.name === "g")) throw new Error(`${name}: nested groups.`);
    const transform = node.attrs.get("transform");
    return `{ transform: ${transform ? JSON.stringify(transform) : "null"}, children: [${shapes.map(shapeSource).join(", ")}] }`;
  };
  const viewBox = JSON.stringify(layers.source.attrs.get("viewBox"));
  return `export const ${name}: MarkLayer = { viewBox: ${viewBox}, nodes: [${layers[which].map(nodeSource).join(", ")}] };\n`;
}

/** A channel tile's mark group as Icon Composer's two layers: the lettering and the pivot. */
function iconLayers(tileSvg: string, label: string): { mark: string; pivot: string } {
  const group = parseSvg(tileSvg).children.find(
    (child) => child.name === "g" && child.attrs.get("transform")?.startsWith("translate(512 512)"),
  );
  if (!group) throw new Error(`${label}: no mark group.`);
  const layer = (keep: (shape: Element) => boolean) =>
    [
      '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024" fill="none">',
      serialize(filterShapes(group, keep)!),
      "</svg>\n",
    ].join("\n");
  return {
    mark: layer((shape) => shape.name === "path"),
    pivot: layer((shape) => shape.name === "circle"),
  };
}

const syncBrandMarks = Effect.fn("brandMarks.sync")(function* (brandingRoot: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const repositoryRoot = path.resolve(import.meta.dirname, "..");
  const read = (file: string) =>
    fs.readFileString(path.join(brandingRoot, "identity/astrolabe", file));
  const outputs: Array<readonly [string, string]> = [];

  // Web: the small monogram (every in-app use is under 48px tall) and both wordmark drawings.
  const markSmall = splitMark(yield* read("symbol-small.svg"));
  const wordmark = splitMark(yield* read("wordmark.svg"));
  const wordmarkSmall = splitMark(yield* read("wordmark-small.svg"));
  for (const [name, layers] of [
    ["mark-small", markSmall],
    ["wordmark", wordmark],
    ["wordmark-small", wordmarkSmall],
  ] as const) {
    outputs.push(
      [`apps/web/src/assets/brand/${name}-ink.svg`, svgDocument(layers.source, layers.ink)],
      [`apps/web/src/assets/brand/${name}-dots.svg`, svgDocument(layers.source, layers.dots)],
    );
  }

  // The boot screen's loading wordmark, from the small drawing (at its 224px width the mark is
  // under 48px tall): dots two and three blink on their own layers.
  const loading = splitMark(yield* read("wordmark-loading-small.svg"));
  const inDot = (dot: string) => (element: Element) => loadingDot(element) === dot;
  outputs.push(
    ["apps/web/public/brand/wordmark-loading-ink.svg", svgDocument(loading.source, loading.ink)],
    [
      "apps/web/public/brand/wordmark-loading-dots-1.svg",
      svgDocument(
        loading.source,
        loading.dots.filter((element) => !inDot("2")(element) && !inDot("3")(element)),
      ),
    ],
    ...["2", "3"].map(
      (dot) =>
        [
          `apps/web/public/brand/wordmark-loading-dot-${dot}.svg`,
          svgDocument(loading.source, loading.dots.filter(inDot(dot))),
        ] as const,
    ),
  );

  // Mobile.
  outputs.push([
    "apps/mobile/src/components/brand/astrolabeMarkLayers.ts",
    [
      "// Generated by scripts/sync-brand-marks.ts from the branding repository's approved masters.",
      "// Regenerate rather than edit: each layer is one mark's ink or dots, on a shared canvas.",
      "",
      'import type { MarkLayer } from "./markLayer";',
      "",
      markLayerSource("WORDMARK_INK", wordmark, "ink"),
      markLayerSource("WORDMARK_DOTS", wordmark, "dots"),
      markLayerSource("WORDMARK_SMALL_INK", wordmarkSmall, "ink"),
      markLayerSource("WORDMARK_SMALL_DOTS", wordmarkSmall, "dots"),
      markLayerSource("MARK_SMALL_INK", markSmall, "ink"),
      markLayerSource("MARK_SMALL_DOTS", markSmall, "dots"),
    ].join("\n"),
  ]);

  // Icon Composer layers, from each channel's square tiles (the master and the small drawing).
  for (const [channel, folder] of [
    ["development", "dev"],
    ["nightly", "nightly"],
    ["production", "prod"],
  ] as const) {
    for (const [tile, project] of [
      ["square", "app-icon"],
      ["small", "app-icon-small"],
    ] as const) {
      const layers = iconLayers(
        yield* read(`icons/${channel}/${tile}.svg`),
        `${channel}/${tile}.svg`,
      );
      outputs.push(
        [`assets/${folder}/${project}.icon/Assets/mark.svg`, layers.mark],
        [`assets/${folder}/${project}.icon/Assets/pivot.svg`, layers.pivot],
      );
    }
  }

  for (const [file, contents] of outputs) {
    yield* fs.writeFileString(path.join(repositoryRoot, file), contents);
    yield* Console.log(`wrote ${file}`);
  }
});

export const syncBrandMarksCommand = Command.make(
  "sync-brand-marks",
  {
    brandingRoot: Argument.String("branding-repo").pipe(
      Argument.withDescription("Checkout of the branding repository."),
    ),
  },
  ({ brandingRoot }) => syncBrandMarks(brandingRoot),
).pipe(Command.withDescription("Copy Astrolabe's approved marks from the branding repository."));

if (import.meta.main) {
  Command.run(syncBrandMarksCommand, { version: "0.0.0" }).pipe(
    Effect.provide(NodeServices.layer),
    NodeRuntime.runMain,
  );
}
