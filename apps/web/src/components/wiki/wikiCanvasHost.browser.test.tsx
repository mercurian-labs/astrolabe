import { EnvironmentId, WikiId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";

import { render } from "../../../test/render";
import { WikiAsset } from "./wikiCanvasHost";

const state = vi.hoisted(() => ({ resources: [] as unknown[] }));

vi.mock("~/assets/assetUrls", async (original) => ({
  ...(await original<typeof import("~/assets/assetUrls")>()),
  useAssetUrlState: (_environment: unknown, resource: unknown) => {
    state.resources.push(resource);
    return { _tag: "Loading" };
  },
}));

it("reads a card's image from the board's own folder", async () => {
  await using _screen = await render(
    <WikiAsset
      environmentId={EnvironmentId.make("laptop")}
      wikiId={WikiId.make("wiki")}
      commit="abc"
      board="eb/Board.canvas"
      asset={{ kind: "image", path: "noroot.png" }}
    />,
  );
  expect(state.resources.at(-1)).toMatchObject({ path: "noroot.png", from: "eb/Board.canvas" });
});
