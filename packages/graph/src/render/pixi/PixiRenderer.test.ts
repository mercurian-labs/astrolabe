import { describe, expect, it, vi } from "vite-plus/test";

import type { FrameClock } from "../scheduler.ts";

// Pixi needs WebGL, which happy-dom lacks: a stand-in Application whose init
// resolves when the test says so, and just enough of the rest to construct.
const pixi = vi.hoisted(() => {
  let finishInit = () => {};
  const resizes: Array<readonly [number, number]> = [];
  return {
    resizes,
    finishInit: () => finishInit(),
    arm: (resolve: () => void) => {
      finishInit = resolve;
    },
  };
});

vi.mock("pixi.js", () => {
  class Node {
    visible = true;
    alpha = 1;
    tint = 0;
    readonly anchor = { set: () => {} };
    readonly position = { set: () => {} };
    readonly scale = { set: () => {} };
    readonly children: Array<Node> = [];
    eventMode = "auto";
    addChild(...nodes: Array<Node>) {
      this.children.push(...nodes);
    }
    removeChildren() {
      return this.children.splice(0);
    }
    destroy() {}
  }
  class Graphics extends Node {
    clear() {
      return this;
    }
  }
  class Application {
    readonly stage = new Node();
    readonly canvas = document.createElement("canvas");
    readonly ticker = { stop: () => {} };
    readonly renderer = {
      resize: (width: number, height: number) => pixi.resizes.push([width, height]),
      background: { color: 0 },
      render: () => {},
    };
    init() {
      return new Promise<void>((resolve) => pixi.arm(resolve));
    }
    destroy() {}
  }
  return {
    AccessibilitySystem: { defaultOptions: {} },
    Application,
    BitmapFont: { install: () => {}, uninstall: () => {} },
    BitmapText: Node,
    Container: Node,
    Graphics,
    Sprite: Node,
    Texture: { WHITE: { destroy: () => {} }, from: () => ({ destroy: () => {} }) },
    Ticker: { system: { autoStart: true, stop: () => {}, update: () => {} } },
    // The stand-in renderer is no WebGLRenderer, so draw-call counting and GL stats stay off.
    WebGLRenderer: class {
      readonly gl = null;
    },
  };
});

const { createPixiRenderer } = await import("./PixiRenderer.ts");

const idleClock: FrameClock = { request: () => 1, cancel: () => {} };

describe("the pixi drawer", () => {
  it("sizes its canvas from the size the host gave while the app was still initialising", async () => {
    const container = document.createElement("div");
    Object.defineProperty(container, "clientWidth", { value: 1140 });
    Object.defineProperty(container, "clientHeight", { value: 833 });
    const renderer = createPixiRenderer(
      container,
      { onHover: () => {}, onPick: () => {}, onBackground: () => {}, onFollowingChange: () => {} },
      { clock: idleClock },
    );
    // The host sized the drawer on construction, before init finished: nothing to resize yet.
    expect(pixi.resizes).toEqual([]);
    pixi.finishInit();
    await vi.waitFor(() => expect(pixi.resizes.at(-1)).toEqual([1140, 833]));
    renderer.dispose();
  });
});
