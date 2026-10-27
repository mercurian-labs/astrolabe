#!/usr/bin/env node

// Renders Android launcher, notification and splash art from the Icon Composer sources.
// Android masks a 72dp safe area inside 108dp, so each variant gets a full-bleed background and a
// transparent foreground with the monogram at two thirds of the tile. The 288dp splash crops the
// same proportion, so composing both layers frames the monogram like the launcher does.

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import sharp from "sharp";

type IconVariant = "dev" | "nightly" | "prod";

// 108dp at xxxhdpi. Expo's prebuild derives every launcher density bucket from this.
const ADAPTIVE_CANVAS = 432;
// 288dp at xxxhdpi: the full Android 12+ splash canvas, so the icon needs no upscaling.
const SPLASH_CANVAS = 1152;
// 24dp at xxxhdpi. Expo derives the lower notification densities from this.
const NOTIFICATION_CANVAS = 96;
// The layer SVGs draw the monogram on Icon Composer's 1024pt tile.
const LAYER_CANVAS = 1024;
// The adaptive layers draw the tile's monogram at the 72dp mask's share of the 108dp canvas,
// or smaller where its farthest ink (the needle's tips) would leave the 66dp guaranteed circle:
// as in the branding package's Android icons, that ink sits 2px (at 432) inside it.
const ADAPTIVE_MARK_SCALE = 72 / 108;
const ADAPTIVE_INK_RADIUS = 130 / 432;
const SVG_DENSITY = 300;
const OUTPUT_DIRECTORY = "apps/mobile/assets";

export class AndroidIconRenderError extends Schema.TaggedError<AndroidIconRenderError>()(
  "AndroidIconRenderError",
  { layer: Schema.String, cause: Schema.Defect() },
) {}

// The projects' fills: a vertical gradient (production, nightly) or a solid colour under
// the development terrain.
const IconComposerProject = Schema.Struct({
  fill: Schema.Union([
    Schema.Struct({ solid: Schema.String }),
    Schema.Struct({ "linear-gradient": Schema.Tuple([Schema.String, Schema.String]) }),
  ]),
});
const decodeIconComposerProject = Schema.decodeUnknownEffect(
  Schema.fromJsonString(IconComposerProject),
);

// "srgb:0.98431,0.96471,0.92941,1.00000" -> "rgb(251 246 237 / 1)"
const cssColor = (color: string) => {
  const [r = 0, g = 0, b = 0, a = 1] = color
    .replace(/^[a-z0-9-]+:/, "")
    .split(",")
    .map(Number);
  return `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)} / ${a})`;
};

const canvasSvg = (inner: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${LAYER_CANVAS}" height="${LAYER_CANVAS}" viewBox="0 0 ${LAYER_CANVAS} ${LAYER_CANVAS}" fill="none">${inner}</svg>`;

const svgBody = (svg: string) => svg.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");

const scaledAboutCenter = (scale: number, inner: string) => {
  const offset = (LAYER_CANVAS * (1 - scale)) / 2;
  return `<g transform="translate(${offset} ${offset}) scale(${scale})">${inner}</g>`;
};

// The farthest ink from the canvas centre, as a share of the canvas. The layer SVGs draw one
// absolute M/L path under the tile's `translate() scale() translate()`.
const markReach = (mark: string) => {
  const transform =
    /transform="translate\(([-\d.]+) ([-\d.]+)\) scale\(([-\d.]+)\) translate\(([-\d.]+) ([-\d.]+)\)"/.exec(
      mark,
    );
  const path = / d="([MLZ\d\s.-]+)"/.exec(mark);
  if (!transform || !path)
    throw new Error("mark.svg is not one absolute path under the tile's transform.");
  const [tx, ty, scale, ox, oy] = transform.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  const numbers = (path[1]!.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  let reach = 0;
  for (let index = 0; index + 1 < numbers.length; index += 2) {
    const x = tx + scale * (numbers[index]! + ox) - LAYER_CANVAS / 2;
    const y = ty + scale * (numbers[index + 1]! + oy) - LAYER_CANVAS / 2;
    reach = Math.max(reach, Math.hypot(x, y));
  }
  return reach / LAYER_CANVAS;
};

const adaptiveMarkScale = (mark: string) =>
  Math.min(ADAPTIVE_MARK_SCALE, ADAPTIVE_INK_RADIUS / markReach(mark));

const rasterize = (layer: string, svg: string, size: number) =>
  Effect.tryPromise({
    try: () =>
      sharp(Buffer.from(svg), { density: SVG_DENSITY }).resize(size, size).png().toBuffer(),
    catch: (cause) => new AndroidIconRenderError({ layer, cause }),
  });

const resizeImage = (layer: string, image: Uint8Array, size: number) =>
  Effect.tryPromise({
    try: () => sharp(image).resize(size, size).ensureAlpha().png().toBuffer(),
    catch: (cause) => new AndroidIconRenderError({ layer, cause }),
  });

const composite = (layer: string, base: Buffer, overlay: Buffer) =>
  Effect.tryPromise({
    try: () =>
      sharp(base)
        .composite([{ input: overlay }])
        .png()
        .toBuffer(),
    catch: (cause) => new AndroidIconRenderError({ layer, cause }),
  });

const projectPath = (repositoryRoot: string, variant: IconVariant, file: string) =>
  Effect.map(Path.Path, (path) =>
    path.join(repositoryRoot, "assets", variant, "app-icon.icon", file),
  );

const readProjectString = Effect.fn("androidIcons.readProjectString")(function* (
  repositoryRoot: string,
  variant: IconVariant,
  file: string,
) {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs.readFileString(yield* projectPath(repositoryRoot, variant, file));
});

const renderForeground = Effect.fn("androidIcons.renderForeground")(function* (
  repositoryRoot: string,
  variant: IconVariant,
  size: number,
) {
  const mark = yield* readProjectString(repositoryRoot, variant, "Assets/mark.svg");
  const pivot = yield* readProjectString(repositoryRoot, variant, "Assets/pivot.svg");
  return yield* rasterize(
    `${variant}-foreground`,
    canvasSvg(scaledAboutCenter(adaptiveMarkScale(mark), svgBody(mark) + svgBody(pivot))),
    size,
  );
});

// Android tints these from their alpha, so they draw the monogram without the pivot.
const renderSilhouette = Effect.fn("androidIcons.renderSilhouette")(function* (
  repositoryRoot: string,
  layer: string,
  adaptive: boolean,
  size: number,
) {
  const mark = yield* readProjectString(repositoryRoot, "prod", "Assets/mark.svg");
  const white = svgBody(mark).replace(/fill="#[0-9A-Fa-f]{6}"/g, 'fill="#FFFFFF"');
  const scale = adaptive ? adaptiveMarkScale(mark) : 1;
  return yield* rasterize(layer, canvasSvg(scaledAboutCenter(scale, white)), size);
});

const renderBackground = Effect.fn("androidIcons.renderBackground")(function* (
  repositoryRoot: string,
  variant: IconVariant,
  size: number,
) {
  const fs = yield* FileSystem.FileSystem;
  if (variant === "dev") {
    const terrain = yield* fs.readFile(
      yield* projectPath(repositoryRoot, variant, "Assets/terrain.png"),
    );
    return yield* resizeImage("dev-background", terrain, size);
  }
  const project = yield* decodeIconComposerProject(
    yield* readProjectString(repositoryRoot, variant, "icon.json"),
  );
  const ground =
    "solid" in project.fill
      ? `<rect width="100%" height="100%" fill="${cssColor(project.fill.solid)}"/>`
      : `<defs><linearGradient id="ground" x1="0" y1="0" x2="0" y2="1">${project.fill[
          "linear-gradient"
        ]
          .map((color, index) => `<stop offset="${index}" stop-color="${cssColor(color)}"/>`)
          .join("")}</linearGradient></defs><rect width="100%" height="100%" fill="url(#ground)"/>`;
  return yield* rasterize(`${variant}-background`, canvasSvg(ground), size);
});

const renderSplashIcon = Effect.fn("androidIcons.renderSplashIcon")(function* (
  repositoryRoot: string,
  variant: IconVariant,
) {
  const background = yield* renderBackground(repositoryRoot, variant, SPLASH_CANVAS);
  const foreground = yield* renderForeground(repositoryRoot, variant, SPLASH_CANVAS);
  return yield* composite(`${variant}-splash`, background, foreground);
});

const exportAndroidIcons = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const repositoryRoot = path.resolve(import.meta.dirname, "..");
  // Development and production share the dark ink, so they share one foreground.
  const outputs = [
    [
      "android-icon-foreground.png",
      yield* renderForeground(repositoryRoot, "prod", ADAPTIVE_CANVAS),
    ],
    [
      "android-icon-foreground-nightly.png",
      yield* renderForeground(repositoryRoot, "nightly", ADAPTIVE_CANVAS),
    ],
    [
      "android-icon-background-dev.png",
      yield* renderBackground(repositoryRoot, "dev", ADAPTIVE_CANVAS),
    ],
    [
      "android-icon-background-nightly.png",
      yield* renderBackground(repositoryRoot, "nightly", ADAPTIVE_CANVAS),
    ],
    [
      "android-icon-background-prod.png",
      yield* renderBackground(repositoryRoot, "prod", ADAPTIVE_CANVAS),
    ],
    [
      "android-icon-mark.png",
      yield* renderSilhouette(repositoryRoot, "monochrome", true, ADAPTIVE_CANVAS),
    ],
    [
      "android-notification-icon.png",
      yield* renderSilhouette(repositoryRoot, "notification", false, NOTIFICATION_CANVAS),
    ],
    ["android-splash-icon-dev.png", yield* renderSplashIcon(repositoryRoot, "dev")],
    ["android-splash-icon-nightly.png", yield* renderSplashIcon(repositoryRoot, "nightly")],
    ["android-splash-icon-prod.png", yield* renderSplashIcon(repositoryRoot, "prod")],
  ] as const;
  for (const [name, contents] of outputs) {
    yield* fs.writeFile(path.join(repositoryRoot, OUTPUT_DIRECTORY, name), contents);
    yield* Console.log(`wrote ${OUTPUT_DIRECTORY}/${name}`);
  }
});

if (import.meta.main) {
  exportAndroidIcons.pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain);
}
