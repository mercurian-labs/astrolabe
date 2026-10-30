/**
 * Every renderer family's factory, for the playground and the bench, which switch between them.
 * The package's entry never imports this module: the app draws with Lean alone
 * (`createLeanRenderer`), so the Atlas renderer, Pixi, and their libraries stay out of its bundle.
 */
import { AtlasRenderer } from "./AtlasRenderer.ts";
import { createLeanRenderer } from "./lean/LeanRenderer.ts";
import { createPixiRenderer } from "./pixi/PixiRenderer.ts";
import type { RendererFactory, RendererFamily } from "./renderer.ts";

export const RENDERERS: Readonly<Record<RendererFamily, RendererFactory>> = {
  atlas: (host, callbacks) => new AtlasRenderer(host, callbacks),
  lean: createLeanRenderer,
  pixi: createPixiRenderer,
};
