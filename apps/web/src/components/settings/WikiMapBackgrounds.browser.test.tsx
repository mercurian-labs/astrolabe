import { EnvironmentId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { render } from "../../../test/render";
import { WikiMapBackgrounds } from "./WikiMapBackgrounds";

const terrain = { name: "Terrain", lightTiles: "https://a/?key=secret", darkTiles: null };
const satellite = { name: "Satellite", lightTiles: "https://b/light", darkTiles: "https://b/dark" };

const state = vi.hoisted(() => ({
  write: (() => undefined) as (value: unknown) => void,
}));

vi.mock("~/hooks/useSettings", async (original) => ({
  ...(await original<typeof import("~/hooks/useSettings")>()),
  useEnvironmentSettings: (_environment: unknown, select: (settings: unknown) => unknown) =>
    select({ wikiMapBackgrounds: [terrain, satellite] }),
  useUpdateEnvironmentSettings: () => (patch: unknown) => state.write(patch),
}));

const environmentId = EnvironmentId.make("laptop");

function setup() {
  const write = vi.fn();
  state.write = write;
  return { write };
}

const written = (backgrounds: ReadonlyArray<unknown>) => ({ wikiMapBackgrounds: backgrounds });

it("adds a background to the end of the list, with no dark tiles when left blank", async () => {
  const { write } = setup();
  await using screen = await render(
    <WikiMapBackgrounds environmentId={environmentId} serverLabel={null} />,
  );

  await userEvent.click(screen.getByRole("button", { name: "Add background" }));
  await userEvent.fill(screen.getByLabelText("Name"), "  Streets ");
  await userEvent.fill(screen.getByLabelText("Light mode"), "https://c/{z}/{x}/{y}.png");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));

  expect(write).toHaveBeenCalledWith(
    written([
      terrain,
      satellite,
      { name: "Streets", lightTiles: "https://c/{z}/{x}/{y}.png", darkTiles: null },
    ]),
  );
  await expect.element(screen.getByLabelText("Name")).not.toBeInTheDocument();
});

it("edits a background, makes one the default and removes one", async () => {
  const { write } = setup();
  await using screen = await render(
    <WikiMapBackgrounds environmentId={environmentId} serverLabel={null} />,
  );

  await userEvent.click(screen.getByRole("button", { name: "Make default" }));
  expect(write).toHaveBeenLastCalledWith(written([satellite, terrain]));

  await userEvent.click(screen.getByRole("button", { name: "Remove" }).first());
  expect(write).toHaveBeenLastCalledWith(written([satellite]));

  await userEvent.click(screen.getByRole("button", { name: "Edit" }).nth(1));
  await userEvent.fill(screen.getByLabelText("Dark mode (optional)"), "");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(write).toHaveBeenLastCalledWith(written([terrain, { ...satellite, darkTiles: null }]));
});

it("shows names only, since an address can hold a key", async () => {
  setup();
  await using screen = await render(
    <WikiMapBackgrounds environmentId={environmentId} serverLabel={null} />,
  );

  await expect.element(screen.getByText("Terrain")).toBeVisible();
  expect(screen.container.textContent).not.toContain("secret");
});
